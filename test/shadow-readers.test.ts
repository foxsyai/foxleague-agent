// Shadow plans (the owner, 2026-11-11): one row of kind "shadow" in the activity per shadow plan. Every reader of
// the activity that counts rows or replays them must leave it out: the daily summary, the executor's counts (1v1s per
// rival, boosters, packs, medicine, bids, match starts), "was this wallet ever used", the history the next plan
// reads, and the dashboard's list with its filters. And the report that reads the structured copy.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Config } from '../src/config.ts'
import { Store } from '../src/store/db.ts'
import { parseAction } from '../src/executor/actions.ts'
import { budgetView } from '../src/executor/budget.ts'
import { oneVOnesThisWeek, ownCreations } from '../src/executor/rivals.ts'
import { lastMatchStarts } from '../src/executor/match-starts.ts'
import { renderPlanRequest } from '../src/strategist/strategist.ts'
import { DEFAULT_SETTINGS } from '../src/store/settings.ts'
import { Sessions, hashPassword } from '../src/web/auth.ts'
import { TEST_SETTINGS, dryWallet, setup, snapshot, withFixture } from './fixtures.ts'

const REPO = resolve(import.meta.dirname, '..')
const html = readFileSync(join(REPO, 'src/web/dashboard.html'), 'utf8')

function testConfig(dir: string): Config {
  return {
    mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-sonnet-5-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config
}

/** The line the service writes for a shadow plan that proposed a bid, a booster, medicine and a 1v1. */
const SHADOW_LINE = 'shadow plan by Haiku 5.5 (medium), $0.0002, 12 s: SHADOWMARKER buy everything. [{"ok":true,"action":{"type":"bid","nonce":4242,"foxsy":777}},{"ok":true,"action":{"type":"buy","product":"xp_booster"}}]'
/** A shadow row as the service logs it, and the worst rows a mistake could log: with an action in the detail and every status. */
function logShadow(store: Store, more: { status?: 'info' | 'dry_run' | 'confirmed' | 'refused' | 'failed' | 'error'; detail?: unknown } = {}): void {
  store.log({ agentIndex: 0, kind: 'shadow', status: more.status ?? 'info', summary: SHADOW_LINE, detail: more.detail ?? { shadow: { model: 'claude-haiku-5-5', effort: 'medium', outcome: 'plan', usd: 0.0002, ms: 12_000 }, carriedOut: false } })
}

test('SHADOW-7 the daily summary counts a shadow row nowhere: not as a plan, not as an action done, refused or failed, whatever its status', async () => {
  const { Service } = await import('../src/service.ts')
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-shadow-'))))
  svc.ensureAgents()
  svc.notify = () => undefined
  svc.snapshots.set(0, snapshot())
  // The summary counts the rows before the moment it is asked: a few milliseconds later, so the last row is in.
  const later = () => new Promise(r => setTimeout(r, 10))
  for (const [kind, status] of [['train', 'dry_run'], ['train', 'dry_run'], ['sync', 'refused'], ['plan', 'info'], ['tick', 'error']] as const) svc.store.log({ agentIndex: 0, kind, status, summary: 'x' })
  await later()
  const before = await svc.command('summary', ['today'], 'today')
  assert.match(before, /agent 1[^\n]*: 2 done, 1 refused/)
  logShadow(svc.store)
  logShadow(svc.store)
  // The service writes "info" only; were one ever written otherwise, it still must not pass for an action.
  for (const status of ['dry_run', 'confirmed', 'refused', 'failed', 'error'] as const) logShadow(svc.store, { status })
  await later()
  assert.equal(await svc.command('summary', ['today'], 'today'), before)
})

test('SHADOW-8 the executor\'s counts never see a shadow row: 1v1s per rival, own creations, match starts, boosters, medicine and bids', async () => {
  const m = setup()
  const now = new Date()
  const since = new Date(now.getTime() - 30 * 86_400_000)
  // Shadow rows whose detail looks like the real thing: an action, an opponent, a created tournament.
  const booster = { action: { type: 'buy', product: 'xp_booster' }, reason: '' }
  logShadow(m.store, { status: 'confirmed', detail: booster })
  logShadow(m.store, { status: 'dry_run', detail: booster })
  logShadow(m.store, { status: 'dry_run', detail: { action: { type: 'buy', product: 'medicine', quantity: 18 }, reason: '' } })
  logShadow(m.store, { status: 'dry_run', detail: { action: { type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: 877, deadline_minutes: 60 }, opponentUserId: 877, createdTournamentId: 2283 } })
  logShadow(m.store, { status: 'dry_run', detail: { action: { type: 'play_match', match_type: 'ranked' }, matchId: 870 } })
  logShadow(m.store, { status: 'dry_run', detail: { action: { type: 'bid', nonce: 4242, foxsy: 777 } } })
  for (const kinds of [['play_match'], ['fuse'], ['create_challenge', 'join_tournament', 'accept_challenge'], ['create_tournament', 'create_challenge'], ['buy'], ['bid'], ['join_tournament']]) {
    assert.deepEqual(m.store.activityOf(0, kinds, since), [], `rows of ${kinds.join(', ')}`)
  }
  assert.equal(oneVOnesThisWeek(m.store, 0, true, now).size, 0, 'no 1v1 counted against a rival')
  assert.equal(ownCreations(m.store, 0, now).size, 0, 'nothing counted as created by the agent')
  assert.deepEqual(lastMatchStarts(m.store, 0, now), { match: null, ranked: null }, 'no match start')
  // The booster a week: with one allowed, two shadow "purchases" leave it free; one real purchase uses it up.
  m.store.updateSettings(0, { ...TEST_SETTINGS, boostersPerWeek: 1 })
  const s = withFixture(snapshot())
  const [free] = await m.exec.run(m.agent(), dryWallet, s, [{ action: parseAction({ type: 'buy', product: 'xp_booster' }), reason: '' }])
  assert.equal(free!.status, 'dry_run', `the shadow rows took the week's booster: ${free!.summary}`)
  // That simulated purchase is a real row of kind "buy": now the week's one booster is used.
  const [used] = await m.exec.run(m.agent(), dryWallet, s, [{ action: parseAction({ type: 'buy', product: 'xp_booster' }), reason: '' }])
  assert.equal(used!.status, 'refused', `a real purchase counts: ${used!.summary}`)
})

test('SHADOW-9 a wallet that only has shadow rows was never used', () => {
  const store = new Store('', ':memory:')
  store.addAgent(0, 'erd1x')
  logShadow(store)
  logShadow(store, { status: 'confirmed' })
  assert.equal(store.everUsed(0), false)
  assert.equal(store.activity(0, 10).every(r => r.txHash === null && r.costUsd === null), true)
})

test('SHADOW-10 the next plan reads the agent\'s own history: its previous plan in full, no shadow row, and still its full 20 rows', () => {
  const store = new Store('', ':memory:')
  store.addAgent(0, 'erd1x')
  for (let i = 0; i < 25; i++) store.log({ agentIndex: 0, kind: 'train', status: 'dry_run', summary: `DRY RUN would train card ${i}` })
  store.log({ agentIndex: 0, kind: 'plan', status: 'info', summary: 'agent 1 plan: REALMARKER train, then wait for the 1v1.\n1. train #6\nmodel cost $0.0812 (cache read 51234 tokens)' })
  // Newer than the real plan: three shadow plans.
  for (let i = 0; i < 3; i++) logShadow(store)
  const history = store.planHistory(0, 20)
  assert.equal(history.length, 20, 'twenty rows of its own')
  assert.equal(history.some(r => r.kind === 'shadow'), false)
  assert.equal(history[0]!.kind, 'plan', 'its own plan is the newest row it reads')
  assert.equal(store.activity(0, 20).filter(r => r.kind === 'shadow').length, 3, 'the full activity, for the owner, still has them')
  const base = { snapshot: snapshot(), settings: DEFAULT_SETTINGS, budget: budgetView(store, 0, DEFAULT_SETTINGS, true, new Date()), dryRun: true }
  // Whatever a caller passes, also the full activity: no shadow row reaches the request.
  for (const recent of [history, store.activity(0, 20)]) {
    const text = renderPlanRequest({ ...base, recent })
    assert.doesNotMatch(text, /shadow|SHADOWMARKER|4242|Haiku/i)
    assert.match(text, /## Your previous plan \([^)]*in full\)[\s\S]*REALMARKER train, then wait for the 1v1\./)
    assert.match(text, /\[info\] your previous plan, in full below/)
  }
})

/** A function of the dashboard's script by name. */
function pageFunction<T>(name: string): T {
  const src = html.match(new RegExp(`\\nfunction ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0]
  assert.ok(src, `the dashboard defines ${name}()`)
  return new Function(`${src}; return ${name}`)() as T
}

test('SHADOW-11 the dashboard shows a shadow row marked as not carried out, and no filter counts it as a plan, an action or a problem', async () => {
  const shown = pageFunction<(rows: { kind: string; status: string }[], f: string) => { kind: string; status: string }[]>('shownActivity')
  const rows = [
    { kind: 'shadow', status: 'info' }, { kind: 'plan', status: 'info' }, { kind: 'train', status: 'dry_run' }, { kind: 'bid', status: 'refused' },
    { kind: 'tick', status: 'error' }, { kind: 'control', status: 'info' }, { kind: 'shadow', status: 'error' },
  ]
  const kinds = (f: string) => shown(rows, f).map(r => r.kind)
  assert.deepEqual(kinds(''), ['shadow', 'plan', 'train', 'bid', 'tick', 'control', 'shadow'], 'All shows everything')
  assert.deepEqual(kinds('plan'), ['plan'])
  assert.deepEqual(kinds('act'), ['train', 'bid'], 'a shadow plan is not an action')
  assert.deepEqual(kinds('problem'), ['bid', 'tick'], 'nor a problem of the agent')
  assert.deepEqual(kinds('shadow'), ['shadow', 'shadow'])
  assert.match(html, /const SHADOW_MARK = \['stale', 'shadow plan, not carried out'\]/)
  assert.match(html, /const \[cls, label\] = r\.kind === 'shadow' \? SHADOW_MARK : STATUS\[r\.status\]/, 'the row carries the mark in place of its status')
  assert.match(html, /const rows = shownActivity\(activityRows, pick\.value\)/, 'the list is filtered by that function')
  const tip = html.match(/activity: \['Activity', `([^`]*)`/)?.[1] ?? ''
  assert.match(tip, /A row marked <b>shadow plan, not carried out<\/b> is what a second AI model would have planned from the same request\. It is recorded only to compare the two models: nothing of it was done, it counts as neither a plan nor an action and the agent never reads it\./)
  assert.doesNotMatch(tip, /—|, and |, or /)

  // The list the page loads holds the row, for the owner to read.
  const { Service } = await import('../src/service.ts')
  const { startWeb } = await import('../src/web/server.ts')
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-shadow-'))))
  svc.ensureAgents()
  ;(svc as unknown as { schedule: unknown }).schedule = () => undefined
  logShadow(svc.store)
  const creds = { username: 'admin', passwordHash: hashPassword('correct-horse-battery'), secretKey: 'k'.repeat(64) }
  const server = startWeb(svc, creds, 0)
  if (!server.listening) await once(server, 'listening')
  try {
    const cookie = new Sessions(creds.secretKey, creds.passwordHash).issue('admin')
    const list = (await (await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/agents/0/activity?limit=50`, { headers: { cookie: `foxagent_session=${cookie}` } })).json()) as { kind: string; status: string; summary: string }[]
    assert.deepEqual(list.filter(r => r.kind === 'shadow').map(r => [r.status, r.summary]), [['info', SHADOW_LINE]])
  } finally {
    server.close()
  }
})

// ---- the structured copy and its report ----

type Row = Parameters<Store['addShadowPlan']>[0]
const ok = (action: { type: string } & Record<string, unknown>) => ({ ok: true, type: action.type, action, reason: 'r' })
const bad = (type: string, error: string) => ({ ok: false, type, action: { type }, error })
const row = (more: Partial<Row> = {}): Row => ({
  agentIndex: 0, realModel: 'claude-sonnet-5-5', realEffort: 'medium', shadowModel: 'claude-haiku-5-5', shadowEffort: 'medium', outcome: 'plan',
  real: { summary: 'REAL sync and a casual game', actions: [ok({ type: 'sync' }), ok({ type: 'play_match', match_type: 'casual' })], usd: 0.15, servedBy: 'claude-sonnet-5-5' },
  shadow: { summary: 'SHADOW the same', actions: [ok({ type: 'play_match', match_type: 'ranked' }), ok({ type: 'sync' })] },
  inputTokens: 90_000, outputTokens: 2_000, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0.01, ms: 12_000, ...more,
})

test('SHADOW-12 the structured copy keeps both plans of a tick and cannot grow without bound: the newest 2,000', async () => {
  const { SHADOW_PLANS_KEPT } = await import('../src/store/db.ts')
  assert.equal(SHADOW_PLANS_KEPT, 2000)
  const store = new Store('', ':memory:')
  store.addAgent(0, 'erd1x')
  store.addAgent(1, 'erd1y')
  const first = store.addShadowPlan(row())
  const [kept] = store.shadowPlans(null)
  assert.deepEqual({ ...kept, at: '' }, { id: first, at: '', ...row() })
  assert.match(kept!.at, /^\d{4}-\d\d-\d\dT/)
  store.db.exec('BEGIN')
  for (let i = 0; i < SHADOW_PLANS_KEPT + 5; i++) store.addShadowPlan(row({ agentIndex: i % 2, ms: i }))
  store.db.exec('COMMIT')
  const all = store.shadowPlans(null)
  assert.equal(all.length, SHADOW_PLANS_KEPT)
  assert.equal(Number((store.db.prepare('SELECT COUNT(*) AS n FROM shadow_plans').get() as { n: number }).n), SHADOW_PLANS_KEPT, 'the table itself holds no more')
  assert.equal(all[0]!.ms, SHADOW_PLANS_KEPT + 4, 'newest first')
  assert.equal(all.at(-1)!.ms, 5, 'the oldest went')
  assert.equal(store.shadowPlans(1).every(r => r.agentIndex === 1), true)
  assert.equal(store.shadowPlans(1, 3).length, 3)
  // An agent deleted for good takes its shadow plans with it.
  store.deleteAgent(1, 'test')
  assert.equal(store.shadowPlans(1).length, 0)
  assert.equal(store.shadowPlans(0).length, SHADOW_PLANS_KEPT / 2)
})

test('SHADOW-13 shadow-report: how many, how many with a valid tool call, actions parsed, same action types as the real plan, average cost and time, the last pairs', async () => {
  const { shadowReport } = await import('../src/strategist/shadow.ts')
  assert.match(shadowReport([], { agentIndex: null }), /^No shadow plans recorded \(all agents\)\. Shadow plans are off unless shadow_model is set on this machine/)
  const store = new Store('', ':memory:')
  store.addShadowPlan(row()) // the same types in another order: the same
  store.addShadowPlan(row({ shadow: { summary: 'SHADOW a bid', actions: [ok({ type: 'bid', nonce: 4242, foxsy: 777 }), ok({ type: 'sync' }), bad('fly_to_the_moon', 'unknown action type')] }, usd: 0.03, ms: 20_000 }))
  store.addShadowPlan(row({ agentIndex: 1, outcome: 'refused', shadow: { summary: 'model declined to plan (cyber)', actions: [] }, usd: 0.002, ms: 1_000 }))
  store.addShadowPlan(row({ outcome: 'error', shadow: { summary: '', actions: [] }, inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, usd: 0, ms: 500 }))
  store.addShadowPlan(row({ outcome: 'timeout', shadow: { summary: '', actions: [] }, inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, usd: 0, ms: 600_000 }))
  store.addShadowPlan(row({ real: { summary: 'REAL nothing to do', actions: [], usd: 0.15 }, shadow: { summary: 'SHADOW nothing either', actions: [] }, usd: 0.008, ms: 4_000 }))
  const text = shadowReport(store.shadowPlans(null), { agentIndex: null, last: 2 })
  const lines = text.split('\n')
  assert.match(lines[0]!, /^Shadow plans \(all agents\): 6, from \d{4}-\d\d-\d\d \d\d:\d\d to \d{4}-\d\d-\d\d \d\d:\d\d UTC$/)
  assert.equal(lines[1], 'Models: Haiku 5.5 (medium) next to Sonnet 5.5 (medium)')
  assert.equal(lines[2], 'With a valid tool call: 3 of 6 (1 declined, 1 error, 1 no answer in time)')
  assert.equal(lines[3], 'Actions proposed by the shadow: 5, of which 4 parsed (the parser rejected 1)')
  assert.equal(lines[4], 'Same action types as the real plan of the same tick: 2 of 3', 'the same types in another order, and no action on both sides')
  assert.equal(lines[5], 'Average cost: $0.0083 a shadow plan ($0.05 in all); the real plans of the same ticks: $0.1500 each')
  assert.equal(lines[6], 'Average time: 9 s over the 4 that answered')
  assert.equal(lines[7], 'A shadow plan is judged by reading it: nothing here says which plan was the better one.')
  assert.equal(lines[9], 'The last 2:')
  assert.match(lines[10]!, /^\d{4}-\d\d-\d\d \d\d:\d\d agent 1$/)
  assert.equal(lines[11], '  real   Sonnet 5.5 (medium): no actions')
  assert.equal(lines[12], '         REAL nothing to do')
  assert.equal(lines[13], '  shadow Haiku 5.5 (medium), $0.0080, 4 s: no actions')
  assert.equal(lines[14], '         SHADOW nothing either')
  assert.equal(lines[18], '  shadow Haiku 5.5 (medium), $0.0000, 600 s: no answer in time')
  assert.equal(lines.length, 20)
  // One agent only.
  assert.match(shadowReport(store.shadowPlans(1), { agentIndex: 1 }), /^Shadow plans \(agent 2\): 1, /)
})

test('SHADOW-14 cli shadow-report reads next to an open database and writes nothing, also where the table does not exist yet', () => {
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-shadow-'))
  const env = {
    PATH: process.env.PATH!, HOME: dir, AGENT_ENV_FILE: join(dir, 'no-such.env'), // the install's real .env is never read
    AGENT_DATA_DIR: dir, MVX_GATEWAY_URL: 'http://127.0.0.1:9', MVX_API_URL: 'http://127.0.0.1:9', FOXLEAGUE_URL: 'http://127.0.0.1:9',
  }
  const cli = (...args: string[]) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(REPO, 'src/cli.ts'), 'shadow-report', ...args], { env, cwd: dir, encoding: 'utf8', timeout: 90_000 })
  // No database at all: it says so and creates none.
  let r = cli()
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^No shadow plans recorded \(all agents\)/)
  assert.throws(() => readFileSync(join(dir, 'agent.db')), /ENOENT/, 'the report created a database')
  // The service's own connection stays open while the report runs.
  const store = new Store(dir)
  store.addAgent(0, 'erd1x')
  store.addShadowPlan(row())
  store.addShadowPlan(row({ shadow: { summary: 'SHADOW a bid', actions: [ok({ type: 'bid', nonce: 4242, foxsy: 777 })] } }))
  const counts = () => JSON.stringify([store.db.prepare('SELECT COUNT(*) AS n FROM activity').get(), store.db.prepare('SELECT COUNT(*) AS n FROM kv').get(), store.db.prepare('SELECT COUNT(*) AS n FROM shadow_plans').get(), store.db.prepare('PRAGMA data_version').get()])
  const before = counts()
  r = cli()
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^Shadow plans \(all agents\): 2, from /)
  assert.match(r.stdout, /Same action types as the real plan of the same tick: 1 of 2/)
  assert.match(r.stdout, /shadow Haiku 5\.5 \(medium\), \$0\.0100, 12 s: bid\n/)
  r = cli('1')
  assert.match(r.stdout, /^Shadow plans \(agent 1\): 2, /)
  r = cli('2')
  assert.match(r.stdout, /^No shadow plans recorded \(agent 2\)/)
  assert.equal(counts(), before, 'the report changed the database')
  r = cli('zero')
  assert.notEqual(r.status, 0, 'an agent number that is none')
  // A database of a version before shadow plans: no table, no error, and none is made.
  store.db.exec('DROP TABLE shadow_plans')
  r = cli()
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^No shadow plans recorded/)
  assert.equal(store.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'shadow_plans'").get(), undefined)
  const usage = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(REPO, 'src/cli.ts')], { env, cwd: dir, encoding: 'utf8', timeout: 90_000 })
  assert.match(usage.stdout, /shadow-report \[N\]\s+what a second model would have planned next to the real plans/)
})

test('SHADOW-15 the guides: the server guide\'s own command switches shadow plans on and off, the costs page promises no number, the review has its section', async () => {
  const { shadowChoice } = await import('../src/strategist/shadow.ts')
  const read = (f: string) => readFileSync(join(REPO, f), 'utf8')
  const guide = read('docs/SERVER.md')
  // The one-line script of the guide, as written, against a database of this test.
  const script = guide.match(/^SET='([^'\n]+)'$/m)?.[1]
  assert.ok(script, 'docs/SERVER.md gives the script as SET=\'...\'')
  assert.match(guide, /node --disable-warning=ExperimentalWarning -e "\$SET" shadow_model claude-haiku-5-5\n/)
  assert.match(guide, /-e "\$SET" shadow_effort medium\n/)
  assert.match(guide, /-e "\$SET" shadow_model off\n/)
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-shadow-'))
  const store = new Store(dir) // the running service's connection
  const set = (key: string, value: string) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', script.replace('/var/lib/foxleague-agent/agent.db', join(dir, 'agent.db')), key, value], { encoding: 'utf8', timeout: 60_000 })
  assert.deepEqual(shadowChoice(store, 'claude-sonnet-5-5'), { on: false, why: null }, 'off before anything is set')
  let r = set('shadow_model', 'claude-haiku-5-5')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(shadowChoice(store, 'claude-sonnet-5-5'), { on: true, model: 'claude-haiku-5-5', effort: 'medium' })
  r = set('shadow_effort', 'low')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(shadowChoice(store, 'claude-sonnet-5-5'), { on: true, model: 'claude-haiku-5-5', effort: 'low' })
  r = set('shadow_model', 'off')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(shadowChoice(store, 'claude-sonnet-5-5'), { on: false, why: null })
  assert.match(guide, /`agents`, `snapshot 1`, `log 1`, `mode dry`, `kill on`, `check-keys`, `shadow-report`/, 'among the operator commands')
  assert.match(guide, /agentctl\.sh shadow-report 3 {4}# agent 3/)
  assert.match(read('README.md'), /npm run cli -- shadow-report \[N\]/)
  assert.match(read('.env.example'), /^# AGENT_SHADOW_MODEL=claude-haiku-5-5\n# AGENT_SHADOW_EFFORT=medium$/m)

  // The public page: what it is, that it costs that model's price per plan and never plays; no figure, no model named.
  const costs = read('site/src/content/docs/help/costs.md')
  const para = costs.slice(costs.indexOf('## Comparing a second model before you switch'), costs.indexOf('## To start')).replace(/\s+/g, ' ')
  assert.match(para, /you can let that model plan in the shadow/)
  assert.match(para, /A shadow plan never plays: nothing of it is carried out and the playing model never reads it\./)
  assert.match(para, /Each one costs what one plan costs on the second model, on top of the real plan\./)
  assert.doesNotMatch(para, /\$|\d|Haiku|Sonnet|Opus|Fable|cheaper|better|—|, and |, or /, 'no number, no model and no promise')
  assert.match(read('site/src/content/docs/use/dashboard.md').replace(/\s+/g, ' '), /A row marked "shadow plan, not carried out" is what a second AI model would have planned, recorded only to compare/)
  assert.match(read('site/src/content/docs/help/server.mdx').replace(/\s+/g, ' '), /how to read the comparison with `agentctl\.sh shadow-report`/)

  const review = read('docs/SECURITY-REVIEW.md')
  const section = review.slice(review.lastIndexOf('\n## '))
  assert.match(section, /^\n## Shadow plans, Claude Haiku 5\.5 and the model list of four \(2026-11-11\)\n/, 'the last section of the file')
  assert.match(section, /\| Id \| Severity \| Finding \| Fix \|\n\|---\|---\|---\|---\|\n\| SHADOW-1 \| design \(the owner, 2026-11-11\) \|/)
  for (const id of ['SHADOW-2', 'SHADOW-3', 'SHADOW-4', 'SHADOW-5', 'SHADOW-6', 'SHADOW-7', 'SHADOW-12', 'HAIKU-1', 'LIST-4', 'R63A-1', 'R63A-2']) assert.match(section, new RegExp(`\\n\\| ${id}[ ,]`), id)
  for (const open of [/Haiku 5\.5's two rate cards comes from Anthropic's wording, not from an invoice/, /judged by people or by `shadow-report`, not by the rules/, /doubles the requests of a plan/]) assert.match(section.slice(section.indexOf('Stays open:')), open)
  assert.doesNotMatch(section, /—/)
})
