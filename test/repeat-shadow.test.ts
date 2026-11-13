// Repeat shadow (the owner, 2026-11-13): "medium agreed with xhigh 6 of 10" cannot be read without knowing how often
// xhigh agrees with itself. The entry word `same` in a shadow list asks the very model and effort the real plan of that
// tick was asked with, once more, as a shadow plan: the baseline. It never rests, and the settings of before mean what
// they meant (an explicit entry at the playing pair still rests). Each test was seen failing on 0774eee (no `same`:
// it was left out as "not a model on the list") for the reason its name gives.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Config } from '../src/config.ts'
import type { PlannedAction } from '../src/executor/actions.ts'
import { Store } from '../src/store/db.ts'
import type { AgentSettings } from '../src/store/settings.ts'
import * as strategist from '../src/strategist/strategist.ts'
import type { Strategist } from '../src/strategist/strategist.ts'
import * as shadow from '../src/strategist/shadow.ts'
import { Sessions, hashPassword } from '../src/web/auth.ts'
import * as web from '../src/web/server.ts'
import { snapshot } from './fixtures.ts'

const REPO = resolve(import.meta.dirname, '..')
const OPUS = 'claude-opus-5-5'
const SONNET = 'claude-sonnet-5-5'
const HAIKU = 'claude-haiku-5-5'
const FABLE = 'claude-fable-5-2'

type Pair = { model: string; effort: string }
type Choices = { models: string[]; effort: string; leftOut: string[]; repeat?: Pair }
const S = shadow as unknown as {
  shadowChoices: (store: Store, playing: string | Pair, agentIndex?: number | null) => Choices
  shadowRuns: (choices: Choices) => Pair[]
  shadowModelsSet: (store: Store, agentIndex?: number | null) => string[]
  shadowNote: (choices: Choices) => string | null
  rests: (entry: string, playing: string | Pair) => boolean
}

function withoutEnv<T>(f: () => T): T {
  const prev = [process.env.AGENT_SHADOW_MODEL, process.env.AGENT_SHADOW_EFFORT]
  delete process.env.AGENT_SHADOW_MODEL
  delete process.env.AGENT_SHADOW_EFFORT
  try {
    return f()
  } finally {
    for (const [i, k] of (['AGENT_SHADOW_MODEL', 'AGENT_SHADOW_EFFORT'] as const).entries()) {
      if (prev[i] === undefined) delete process.env[k]
      else process.env[k] = prev[i]
    }
  }
}

test('RS-1 the setting: `same` asks the real plan\'s own model and effort again and never rests; an explicit entry at the playing pair still rests, and with `same` beside it the pair runs once', () => withoutEnv(() => {
  const store = new Store('', ':memory:')
  const runs = (playing: string | Pair, index: number | null = null) => S.shadowRuns(S.shadowChoices(store, playing, index))
  // Agent 7 (index 6) plays Opus 5.5 at xhigh: the repeat first, then the three other efforts, in the order written.
  store.setKv('shadow_model_agent_7', `same,${OPUS}:low,${OPUS}:medium,${OPUS}:high`)
  const opusX = { model: OPUS, effort: 'xhigh' }
  const seven = S.shadowChoices(store, opusX, 6)
  assert.deepEqual(seven.models, ['same', `${OPUS}:low`, `${OPUS}:medium`, `${OPUS}:high`])
  assert.deepEqual(seven.leftOut, [])
  assert.deepEqual(runs(opusX, 6), [{ model: OPUS, effort: 'xhigh' }, { model: OPUS, effort: 'low' }, { model: OPUS, effort: 'medium' }, { model: OPUS, effort: 'high' }])
  // It follows the pair that plays, whatever that is: never rests.
  for (const model of Object.keys(strategist.MODELS)) {
    for (const effort of strategist.EFFORTS) {
      store.setKv('shadow_model_agent_2', 'same')
      assert.deepEqual(runs({ model, effort }, 1), [{ model, effort }], `${model} ${effort}`)
      assert.equal(S.rests('same', { model, effort }), false)
      assert.equal(S.rests('same', model), false)
    }
  }
  // The settings of before mean what they meant: an explicit entry at the playing pair rests, no repeat comes of it.
  store.setKv('shadow_model_agent_10', `${HAIKU}:low,${HAIKU}:medium,${HAIKU}:high`)
  const haikuH = { model: HAIKU, effort: 'high' }
  assert.deepEqual(runs(haikuH, 9), [{ model: HAIKU, effort: 'low' }, { model: HAIKU, effort: 'medium' }])
  assert.deepEqual(S.shadowChoices(store, haikuH, 9).leftOut, [`${HAIKU}:high is the model and effort that play, and a shadow plan needs another model or effort`])
  // `same` beside an explicit entry of the same pair: the explicit one rests as before, `same` runs once.
  for (const list of [`same,${HAIKU}:high`, `${HAIKU}:high,same`, `${HAIKU},same`, 'same, same ,same', `same,${HAIKU}:high,same`]) {
    store.setKv('shadow_model_agent_10', list)
    assert.deepEqual(runs(haikuH, 9), [{ model: HAIKU, effort: 'high' }], list)
  }
  // The all-agents list takes it too, for every agent without its own list.
  store.setKv('shadow_model', `same, ${HAIKU}:low`)
  assert.deepEqual(runs({ model: SONNET, effort: 'high' }, 0), [{ model: SONNET, effort: 'high' }, { model: HAIKU, effort: 'low' }])
  assert.deepEqual(runs({ model: HAIKU, effort: 'low' }, 0), [{ model: HAIKU, effort: 'low' }], 'the explicit Haiku 5.5 low rests, the repeat runs at Haiku 5.5 low')
  // What it cannot be: an effort after it, another spelling, a playing pair it cannot know. Each is left out with its
  // reason and the others run.
  store.setKv('shadow_model_agent_3', `same:low, SAME, Same, ${HAIKU}:low`)
  const odd = S.shadowChoices(store, { model: SONNET, effort: 'high' }, 2)
  assert.deepEqual(odd.models, [`${HAIKU}:low`])
  assert.equal(odd.leftOut.length, 3)
  assert.match(odd.leftOut[0]!, /^same:low has an effort, and same takes none: it is the real plan's model and effort$/)
  assert.match(odd.leftOut[1]!, /^SAME is not a model on the list/)
  store.setKv('shadow_model_agent_3', `same, ${HAIKU}:low`)
  // The playing model given alone (the settings of before, no effort known): the repeat cannot know its effort.
  const alone = S.shadowChoices(store, SONNET, 2)
  assert.deepEqual(S.shadowRuns(alone), [{ model: HAIKU, effort: 'low' }])
  assert.deepEqual(alone.leftOut, ['same needs the effort that plays, which is not known here'])
  // A playing model the list does not have (AGENT_MODEL naming another model): no repeat by it, never a guess.
  const unknown = S.shadowChoices(store, { model: 'gpt-oss', effort: 'high' }, 2)
  assert.deepEqual(S.shadowRuns(unknown), [{ model: HAIKU, effort: 'low' }])
  assert.deepEqual(unknown.leftOut, ['same needs a model of the list, and the one that plays (gpt-oss) is not'])
  // The web rule and the CLI read it as an entry that can run.
  store.setKv('shadow_model_agent_7', `same,${OPUS}:low`)
  assert.deepEqual(S.shadowModelsSet(store, 6), ['same', `${OPUS}:low`])
  store.setKv('shadow_model_agent_7', `same:low,${OPUS}:low`)
  assert.deepEqual(S.shadowModelsSet(store, 6), [`${OPUS}:low`])
  // "off" still switches every entry off, `same` too.
  store.setKv('shadow_model_agent_7', 'same,off')
  assert.deepEqual(runs(opusX, 6), [])
  // The log names it in plain words.
  store.setKv('shadow_model_agent_7', `same,${OPUS}:xhigh`)
  assert.equal(S.shadowNote(S.shadowChoices(store, opusX, 6)), `shadow plans run by same (the real plan's model and effort again) only: ${OPUS}:xhigh is the model and effort that play, and a shadow plan needs another model or effort`)
}))

// ---- in the service ----

function testConfig(dir: string, model = SONNET): Config {
  return {
    mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: 'sk-ant-not-a-real-key-for-this-test-only', model, telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 12,
  } as Config
}

type Request = { model: string; system: { text: string; cache_control?: unknown }[]; messages: { role: string; content: string }[]; output_config: { effort: string }; max_tokens: number }
const planned = (p: Request, actions: unknown[] = [{ type: 'sync' }]) => ({
  model: p.model, stop_reason: 'tool_use', usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  content: [{ type: 'tool_use', id: 't', name: 'submit_plan', input: { summary: `PLAN by ${p.model} at ${p.output_config.effort}`, actions: actions.map(action => ({ action, reason: 'because' })) } }],
})
type Inner = {
  shadows: Map<unknown, Promise<void>>
  shadowTimeoutMs: number
  shadowStrategistFor(model: string, effort: string): Strategist
  strategistFor(model: string): Strategist
  wallet(i: number): { address: string }
}

async function service(o: { agents?: number; own?: Record<number, Partial<AgentSettings>>; answer?: (p: Request, who: string) => unknown } = {}) {
  const { Service } = await import('../src/service.ts')
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-rs-'))))
  svc.ensureAgents()
  const inner = svc as unknown as Inner
  for (let i = 1; i < (o.agents ?? 1); i++) svc.store.addAgent(i, inner.wallet(i).address)
  for (const [i, own] of Object.entries(o.own ?? {})) svc.store.updateSettings(Number(i), own)
  const requests: Request[] = []
  const by = new Map<Request, string>()
  const connect = (s: Strategist, who: string) => {
    ;(s as unknown as { client: unknown }).client = {
      beta: { messages: { stream: (p: Request) => ({ finalMessage: async () => {
        requests.push(p)
        by.set(p, who)
        return o.answer ? o.answer(p, who) : planned(p)
      } }) } },
    }
  }
  connect(svc.strategist!, 'all')
  for (const model of Object.keys(strategist.MODELS)) {
    connect(inner.strategistFor(model), `playing ${model}`)
    connect(inner.shadowStrategistFor(model, 'medium'), `shadow ${model}`)
  }
  const ran: { index: number; types: string[] }[] = []
  Object.assign(svc as object, {
    schedule: () => undefined, notify: () => undefined, inActiveHours: () => true, waitingForFunds: () => null,
    retryPending: async () => undefined, noticeInvitations: async () => undefined, snapshot: async () => snapshot(), pause: async () => undefined,
  })
  ;(svc.executor as unknown as { run: unknown }).run = async (a: { index: number }, _w: unknown, _s: unknown, actions: PlannedAction[]) => {
    ran.push({ index: a.index, types: actions.map(p => p.action.type) })
    return actions.map(() => ({ status: 'dry_run', summary: 'DRY RUN ok' }))
  }
  const settled = async () => { await Promise.all([...(inner.shadows?.values() ?? [])]) }
  return { svc, inner, requests, by, ran, settled }
}
const asked = (r: Request) => [r.model, r.output_config.effort, r.max_tokens]

test('RS-2 in the service: a repeat gets the real plan\'s request word for word at its model and effort, through the shadow strategist, with its own row, record and cost; it follows the pair that plays; the guard holds back only its own next one', async () => {
  const hang = { on: false }
  const m = await service({ agents: 2, own: { 0: { aiModel: OPUS, aiEffort: 'xhigh' } }, answer: (p, who) => (hang.on && who.startsWith('shadow') && p.output_config.effort === 'xhigh' ? new Promise(() => undefined) : planned(p)) })
  m.inner.shadowTimeoutMs = 60_000
  m.svc.store.setKv('shadow_model_agent_1', `same,${OPUS}:low`)
  try {
    await m.svc.tick(0)
    await m.settled()
    assert.deepEqual(m.requests.map(asked), [[OPUS, 'xhigh', 80_000], [OPUS, 'xhigh', 80_000], [OPUS, 'low', 16_000]], 'the real plan, its repeat, the other effort')
    for (const r of m.requests.slice(1)) assert.deepEqual(r.messages, m.requests[0]!.messages, 'word for word')
    assert.deepEqual(m.requests.map(r => m.by.get(r)), [`playing ${OPUS}`, `shadow ${OPUS}`, `shadow ${OPUS}`], 'the repeat is a shadow request: never the playing strategist')
    // Only the real plan's actions ran.
    assert.deepEqual(m.ran, [{ index: 0, types: ['sync'] }])
    // The record: the repeat's shadow pair is the real pair.
    const kept = m.svc.store.shadowPlans(null)
    assert.deepEqual(kept.map(k => [k.realModel, k.realEffort, k.shadowModel, k.shadowEffort, k.outcome]).sort(), [[OPUS, 'xhigh', OPUS, 'low', 'plan'], [OPUS, 'xhigh', OPUS, 'xhigh', 'plan']])
    // The activity line says it is the same model and effort again; the other shadow's line reads as before.
    const lines = m.svc.store.activity(0, 20).filter(r => r.kind === 'shadow').map(r => r.summary.match(/^shadow plan by [^$]+\$[\d.]+/)?.[0]).sort()
    assert.deepEqual(lines, ['shadow plan by Opus 5.5 (low), $0.0080', 'shadow plan by Opus 5.5 (xhigh), the real plan\'s own model and effort again, $0.0080'])
    // The bill: the real plan and both shadow plans at Opus 5.5's price.
    assert.ok(Math.abs(Number(m.svc.store.getKv('model_usd_total')) - 3 * 0.008) < 1e-12, m.svc.store.getKv('model_usd_total'))
    // Another agent follows the all-agents list, which is off: one request, no repeat.
    let before = m.requests.length
    await m.svc.tick(1)
    await m.settled()
    assert.deepEqual(m.requests.slice(before).map(asked), [[SONNET, 'medium', 16_000]])
    // It follows the pair that plays: agent 1 moved to Opus 5.5 at high, its repeat is at high too.
    m.svc.store.updateSettings(0, { aiEffort: 'high' })
    before = m.requests.length
    await m.svc.tick(0)
    await m.settled()
    assert.deepEqual(m.requests.slice(before).map(asked), [[OPUS, 'high', 32_000], [OPUS, 'high', 32_000], [OPUS, 'low', 16_000]])
    // The guard: a repeat still on its way holds back only its own next repeat, not the other effort.
    m.svc.store.updateSettings(0, { aiEffort: 'xhigh' })
    hang.on = true
    await m.svc.tick(0)
    await new Promise(r => setTimeout(r, 30))
    before = m.requests.length
    hang.on = false
    await m.svc.tick(0)
    await new Promise(r => setTimeout(r, 30))
    assert.deepEqual(m.requests.slice(before).map(asked), [[OPUS, 'xhigh', 80_000], [OPUS, 'low', 16_000]], 'the repeat at xhigh is still on its way: not asked again')
  } finally {
    await m.svc.stop()
  }
})

// ---- shadow-report ----

type Row = Parameters<Store['addShadowPlan']>[0]
const ok = (type: string) => ({ ok: true, type, action: { type }, reason: 'r' })
const row = (more: Partial<Row> = {}): Row => ({
  agentIndex: 6, realModel: OPUS, realEffort: 'xhigh', shadowModel: OPUS, shadowEffort: 'low', outcome: 'plan',
  real: { summary: 'REAL sync and a casual game', actions: [ok('sync'), ok('play_match')], usd: 0.2, servedBy: OPUS },
  shadow: { summary: 'SHADOW sync', actions: [ok('sync')] },
  inputTokens: 90_000, outputTokens: 2_000, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0.01, ms: 10_000, ...more,
})

test('RS-3 shadow-report: the repeats are their own group, named in plain words, with the same lines as the others, apart from a shadow of another real pair at the same model and effort; each tick marks its repeat', () => {
  const store = new Store('', ':memory:')
  const add = (at: string, more: Partial<Row>) => {
    const id = store.addShadowPlan(row(more))
    store.db.prepare('UPDATE shadow_plans SET at = ? WHERE id = ?').run(`2026-11-13T${at}:07.000Z`, id)
  }
  // Agent 7 on Opus 5.5 at xhigh, two plans, each with a repeat and Opus 5.5 at low.
  for (const [at, real] of [['10:00', 'REAL sync and a casual game'], ['11:00', 'REAL nothing to do']] as const) {
    const r = { summary: real, actions: real.includes('sync') ? [ok('sync'), ok('play_match')] : [], usd: 0.2, servedBy: OPUS }
    add(at, { real: r, shadowEffort: 'xhigh', usd: 0.19, ms: 50_000, shadow: { summary: 'REPEAT sync and a game', actions: [ok('play_match'), ok('sync')] } })
    add(at, { real: r, shadowEffort: 'low', usd: 0.005, ms: 6_000 })
  }
  const text = shadowReportOf(store.shadowPlans(6), { agentIndex: 6, last: 1 })
  assert.deepEqual(text.split('\n'), [
    'Shadow plans (agent 7): 4, from 2026-11-13 10:00 to 2026-11-13 11:00 UTC; 2 of them by the real plan\'s own model and effort again',
    '',
    'Opus 5.5 (low): 2 shadow plans',
    'Models: Opus 5.5 (low) next to Opus 5.5 (xhigh)',
    'With a valid tool call: 2 of 2',
    'Actions proposed by the shadow: 2, of which 2 parsed',
    'Same action types as the real plan of the same tick: 0 of 2',
    'Average cost: $0.0050 a shadow plan ($0.01 in all); the real plans of the same ticks: $0.2000 each',
    'Average time: 6 s over the 2 that answered',
    '',
    'Opus 5.5 (xhigh), the real plan\'s own model and effort again: 2 shadow plans',
    'Models: Opus 5.5 (xhigh) next to Opus 5.5 (xhigh)',
    'With a valid tool call: 2 of 2',
    'Actions proposed by the shadow: 4, of which 4 parsed',
    'Same action types as the real plan of the same tick: 1 of 2',
    'Average cost: $0.1900 a shadow plan ($0.38 in all); the real plans of the same ticks: $0.2000 each',
    'Average time: 50 s over the 2 that answered',
    '',
    'A shadow plan is judged by reading it: nothing here says which plan was the better one.',
    'A repeat asks the real plan\'s own model and effort again: how often it agrees with the real plan is the baseline for the other groups.',
    '',
    'The last 1:',
    '2026-11-13 11:00 agent 7',
    '  real   Opus 5.5 (xhigh): no actions',
    '         REAL nothing to do',
    '  shadow Opus 5.5 (low), $0.0050, 6 s: sync',
    '         SHADOW sync',
    '  repeat Opus 5.5 (xhigh), $0.1900, 50 s: play_match, sync',
    '         REPEAT sync and a game',
  ])
  // Another agent plays Opus 5.5 at high and lets Opus 5.5 at xhigh plan in the shadow: the same shadow pair, but not a
  // repeat. All agents: it is its own group, apart from agent 7's repeats.
  add('11:30', { agentIndex: 0, realEffort: 'high', shadowEffort: 'xhigh', usd: 0.18 })
  const all = shadowReportOf(store.shadowPlans(null), { agentIndex: null }).split('\n')
  assert.equal(all[0], 'Shadow plans (all agents): 5, from 2026-11-13 10:00 to 2026-11-13 11:30 UTC; 2 of them by the real plan\'s own model and effort again')
  assert.deepEqual(all.filter(l => / shadow plans?$/.test(l)), ['Opus 5.5 (low): 2 shadow plans', 'Opus 5.5 (xhigh): 1 shadow plan', 'Opus 5.5 (xhigh), the real plan\'s own model and effort again: 2 shadow plans'])
  assert.ok(all.includes('Models: Opus 5.5 (xhigh) next to Opus 5.5 (high)'))
  assert.equal(all.filter(l => l.startsWith('  repeat ')).length, 2)
  assert.equal(all.filter(l => l.startsWith('  shadow ')).length, 3)
  // Only repeats: still named as such.
  const only = new Store('', ':memory:')
  only.addShadowPlan(row({ shadowEffort: 'xhigh' }))
  const one = shadowReportOf(only.shadowPlans(null)).split('\n')
  assert.equal(one[0]!.endsWith('; 1 of them by the real plan\'s own model and effort again'), true, one[0])
  assert.equal(one[2], 'Opus 5.5 (xhigh), the real plan\'s own model and effort again: 1 shadow plan')
  // No repeat: the report reads as before (SHADOW-13, SHADOWS-10 and PAM-12 pin every line of it).
  const none = new Store('', ':memory:')
  none.addShadowPlan(row())
  assert.match(shadowReportOf(none.shadowPlans(null)), /^Shadow plans \(all agents\): 1, from [^\n]+ UTC\nModels: Opus 5\.5 \(low\) next to Opus 5\.5 \(xhigh\)\n/)
})
const shadowReportOf = (rows: Parameters<typeof shadow.shadowReport>[0], o?: Parameters<typeof shadow.shadowReport>[1]) => shadow.shadowReport(rows, o)

// ---- the readers: the CLI, /api/state, the password rule, the page ----

/** Several functions of the dashboard's script together (one may call another), the last one returned. */
function pageFunctions<T>(names: string[], state: unknown): T {
  const html = readFileSync(join(REPO, 'src/web/dashboard.html'), 'utf8')
  const src = names.map(name => {
    const found = html.match(new RegExp(`\\nfunction ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0]
    assert.ok(found, `the dashboard defines ${name}()`)
    return found
  })
  return new Function('S', `${src.join('\n')}; return ${names.at(-1)}`)(state) as T
}

test('RS-4 the readers: cli model and the page name `same` in plain words; /api/state lists it among the entries but not among the models; it never wakes, so only a dearer pair asks for the password', async () => {
  // cli model, as agentctl.sh runs it.
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-rs-cli-'))
  const env = { PATH: process.env.PATH!, HOME: dir, AGENT_ENV_FILE: join(dir, 'no-such.env'), AGENT_DATA_DIR: dir, MVX_GATEWAY_URL: 'http://127.0.0.1:9', MVX_API_URL: 'http://127.0.0.1:9', FOXLEAGUE_URL: 'http://127.0.0.1:9' }
  const store = new Store(dir)
  for (const i of [0, 1]) store.addAgent(i, `erd1agent${i}`)
  store.updateSettings(0, { aiModel: OPUS, aiEffort: 'xhigh' })
  store.setKv('shadow_model_agent_1', `same,${OPUS}:low`)
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(REPO, 'src/cli.ts'), 'model', '1'], { env, cwd: dir, encoding: 'utf8', timeout: 90_000 })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout.trim(), `agent 1: Opus 5.5 at xhigh effort (its own model and its own effort); shadow plans by same (the real plan's model and effort again), ${OPUS}:low (its own list)`)

  // /api/state: the agent's entries with `same`; the models of the all-agents list without it (it names no model).
  const { Service } = await import('../src/service.ts')
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-rs-web-'))))
  svc.ensureAgents()
  ;(svc as unknown as { schedule: unknown }).schedule = () => undefined
  svc.notify = () => undefined
  svc.store.setKv('shadow_model', `same, ${FABLE}`)
  svc.store.setKv('shadow_model_agent_1', `same,${HAIKU}:low`)
  const creds = { username: 'admin', passwordHash: hashPassword('correct-horse-battery'), secretKey: 'k'.repeat(64) }
  const server = web.startWeb(svc, creds, 0)
  if (!server.listening) await once(server, 'listening')
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const cookie = new Sessions(creds.secretKey, creds.passwordHash).issue('admin')
    const s = (await (await fetch(`${url}/api/state`, { headers: { cookie: `foxagent_session=${cookie}` } })).json()) as { instance: { shadowModels: string[]; shadowEntries: string[] }; agents: { ai: { shadows: string[] } }[] }
    assert.deepEqual(s.agents[0]!.ai.shadows, ['same', `${HAIKU}:low`])
    assert.deepEqual(s.instance.shadowEntries, ['same', FABLE])
    assert.deepEqual(s.instance.shadowModels, [FABLE], 'an older page reads these as model ids: `same` is none')
  } finally {
    server.close()
  }

  // The password rule: `same` never rests, so no switch starts it; its cost follows the pair, which raisesAiSpend weighs.
  const rules = web as unknown as {
    wakesShadow: (shadows: readonly string[], current: string | Pair, next: string | Pair) => boolean
    agentAiNeedsPassword: (current: Pair, next: Pair, shadows: readonly string[]) => boolean
    allAgentsAiNeedsPassword: (all: Pair, next: Pair, agents: { settings: { aiModel: string; aiEffort: string }; shadows: string[] }[]) => boolean
  }
  const ids = Object.keys(strategist.MODELS)
  for (const a of ids) for (const ea of strategist.EFFORTS) for (const b of ids) for (const eb of strategist.EFFORTS) {
    const cur = { model: a, effort: ea }, next = { model: b, effort: eb }
    assert.equal(rules.wakesShadow(['same'], cur, next), false)
    assert.equal(rules.agentAiNeedsPassword(cur, next, ['same']), rules.agentAiNeedsPassword(cur, next, []), `${a} ${ea} to ${b} ${eb}`)
    assert.equal(rules.allAgentsAiNeedsPassword(cur, next, [{ settings: { aiModel: '', aiEffort: '' }, shadows: ['same'] }]), rules.allAgentsAiNeedsPassword(cur, next, []))
  }
  assert.equal(rules.agentAiNeedsPassword({ model: OPUS, effort: 'high' }, { model: OPUS, effort: 'xhigh' }, ['same']), true, 'a higher effort raises the repeat too: the password')
  assert.equal(rules.agentAiNeedsPassword({ model: OPUS, effort: 'xhigh' }, { model: OPUS, effort: 'high' }, ['same']), false, 'a lower one is one click')

  // The page: the line under an agent's AI fields names it in plain words; the page's rule never wakes it either.
  const models = ids.map(id => ({ id, label: strategist.MODELS[id]!.label, price: strategist.MODELS[id]!.price, ...strategist.priceRange(id)! }))
  const instance = { model: SONNET, effort: 'medium', models, efforts: [...strategist.EFFORTS], shadowModels: [], shadowEntries: ['same'], ownAi: 1 }
  const hint = pageFunctions<(b: unknown, form: unknown) => string>(['ownAiHint'], { instance })
  assert.equal(hint({ ai: { model: OPUS, effort: 'xhigh', own: { model: OPUS, effort: 'xhigh' }, ignored: [], shadows: ['same', `${OPUS}:low`, `${OPUS}:medium`], ownShadows: true } }, { aiModel: OPUS, aiEffort: 'xhigh' }),
    'Plays Opus 5.5 at xhigh effort, its own. Shadow plans set on the server for this agent: a repeat of the model and effort it plays, Opus 5.5 (low) and Opus 5.5 (medium).')
  const costsMore = pageFunctions<(model: string, effort: string) => boolean>(['wakesShadow', 'aiCostsMore'], { instance, agents: [{ index: 0, ai: { own: {}, shadows: ['same'] } }] })
  assert.equal(costsMore(HAIKU, 'low'), false, 'a cheaper pair with a repeat set is one click')
  assert.equal(costsMore(SONNET, 'high'), true)
})

// ---- the guides and the review ----

test('RS-5 the guides: the server guide gives the three test agents\' lists with `same` and they run as written; the site says what a repeat is for; the review has its section, after the one before it, in the table format', () => withoutEnv((): void => {
  const read = (f: string) => readFileSync(join(REPO, f), 'utf8')
  const guide = read('docs/SERVER.md')
  const script = guide.match(/^SET='([^'\n]+)'$/m)?.[1]
  assert.ok(script, 'the guide\'s one-line script')
  const from = guide.indexOf('### The same model and effort again: a repeat')
  assert.ok(from > guide.indexOf('### The same model at other efforts, on three agents'), 'after the example of other efforts')
  const block = guide.slice(from, guide.indexOf('```\n', guide.indexOf('```', from) + 3))
  const sets = [...block.matchAll(/-e "\$SET" (shadow_model\S*) (\S+)\n/g)].map(m => [m[1]!, m[2]!] as [string, string])
  // The owner's three test agents: today's lists with `same` in front.
  assert.deepEqual(sets, [
    ['shadow_model_agent_7', `same,${OPUS}:low,${OPUS}:medium,${OPUS}:high`],
    ['shadow_model_agent_1', `same,${SONNET}:low,${SONNET}:medium,${SONNET}:high`],
    ['shadow_model_agent_9', `same,${HAIKU}:low,${HAIKU}:medium,${HAIKU}:high`],
  ])
  // As written, against a database of this test, with the three agents playing as the owner's do.
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-rs-guide-'))
  const store = new Store(dir)
  for (const [key, value] of sets) {
    const r: { status: number | null; stderr: string } = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', script.replace('/var/lib/foxleague-agent/agent.db', join(dir, 'agent.db')), key, value], { encoding: 'utf8', timeout: 60_000 })
    assert.equal(r.status, 0, r.stderr)
  }
  const runs = (playing: Pair, index: number) => S.shadowRuns(S.shadowChoices(store, playing, index))
  assert.deepEqual(runs({ model: OPUS, effort: 'xhigh' }, 6), [['xhigh'], ['low'], ['medium'], ['high']].map(([effort]) => ({ model: OPUS, effort })), 'agent 7: a repeat and three other efforts')
  assert.deepEqual(runs({ model: SONNET, effort: 'xhigh' }, 0), ['xhigh', 'low', 'medium', 'high'].map(effort => ({ model: SONNET, effort })), 'agent 1')
  assert.deepEqual(runs({ model: HAIKU, effort: 'high' }, 8), ['high', 'low', 'medium'].map(effort => ({ model: HAIKU, effort })), 'agent 9: its high entry rests, the repeat is at high')
  const part = guide.slice(guide.indexOf('## Shadow plans: trying another model without letting it play')).replace(/\s+/g, ' ')
  for (const said of [
    /`same` asks the real plan's own model and effort again: a repeat\./,
    /It never rests: it follows the model and effort the agent plays, also after you change them\./,
    /An entry that names the playing model and effort itself still rests, as before; with `same` beside it that pair runs once\./,
    /A repeat costs what the real plan costs, on top of it\./,
    /"Opus 5\.5 \(xhigh\), the real plan's own model and effort again"/,
    /marked "repeat"/,
  ]) assert.match(part, said)
  assert.doesNotMatch(guide.slice(guide.indexOf('## Shadow plans')), /—|\bbot\b/i)
  assert.match(read('.env.example'), /^# same in the list asks the playing model and effort again, the baseline for the others \(docs\/SERVER\.md\)\.$/m)

  // The site: what a repeat is for, still no number, no model and no promise.
  const costs = read('site/src/content/docs/help/costs.md')
  const para = costs.slice(costs.indexOf('## Comparing a second model before you switch'), costs.indexOf('## To start')).replace(/\s+/g, ' ')
  assert.match(para, /The model that plays can also plan once more in the shadow at its own effort, to see how much its plans differ from one request to the very same request\./)
  assert.doesNotMatch(para, /\$|\d|Haiku|Sonnet|Opus|Fable|cheaper|better|—|, and |, or /)
  assert.match(read('site/src/content/docs/help/server.mdx').replace(/\s+/g, ' '), /how to let the model that plays plan once more at its own effort/)
  assert.match(read('site/src/content/docs/use/dashboard.md').replace(/\s+/g, ' '), /A row marked "shadow plan, not carried out" is what another AI model would have planned, recorded only to compare[^.]*\. A shadow plan by the agent's own model and effort says so: it is the same model planning the same request a second time\./)
  assert.match(read('site/src/content/docs/use/talk-to-your-manager.md').replace(/\s+/g, ' '), /While the manager is answering, \*\*Send\*\* waits: the answer is written and paid for even when the page loses the connection, so a second Send would pay twice\./)
  for (const f of ['site/src/content/docs/help/costs.md', 'site/src/content/docs/help/server.mdx', 'site/src/content/docs/use/dashboard.md']) assert.doesNotMatch(read(f), /—|\bbot\b/i, f)
  // The talk page names "your Telegram bot" elsewhere, as Telegram calls it; the new words do not.
  const talk = read('site/src/content/docs/use/talk-to-your-manager.md').replace(/\s+/g, ' ')
  assert.doesNotMatch(talk.slice(talk.indexOf('While the manager is answering'), talk.indexOf('### What the manager remembers')), /—|, and |, or |\bbot\b/i)

  // The review: its own section, after the one before it, in the table format, with what stays open.
  const review = read('docs/SECURITY-REVIEW.md')
  const start = review.indexOf('\n## Repeat shadow, chat Send and model output limits (2026-11-13)\n')
  assert.ok(start > 0, 'the section is in the review')
  assert.ok(start > review.indexOf('\n## Extra-high room (2026-11-13)\n'), 'after the section before it')
  const end = review.indexOf('\n## ', start + 1)
  const section = review.slice(start, end < 0 ? undefined : end)
  assert.match(section, /\| Id \| Severity \| Finding \| Fix \|\n\|---\|---\|---\|---\|\n\| RS-1 \| design \(the owner, 2026-11-13\) \|/)
  for (const id of ['RS-2', 'RS-3', 'RS-4', 'RS-5', 'SEND-1', 'LIM-1']) assert.match(section, new RegExp(`\\n\\| ${id} \\|`), id)
  for (const line of section.split('\n').filter(l => /^\| (RS|SEND|LIM)-/.test(l))) assert.equal(line.split(' | ').length, 4, line.slice(0, 40))
  assert.ok(section.includes('\nStays open:\n'))
  assert.doesNotMatch(section, /—|\bbot\b/i)
}))

// ---- the agent review of pull request #67 ----

test('R67A-1 rule 7: `same` rests under a playing model the list does not have, so a switch from there to a model of the list starts it and asks for the password, also when the new model is not dearer', async () => {
  const rules = web as unknown as {
    wakesShadow: (shadows: readonly string[], current: string | Pair, next: string | Pair) => boolean
    agentAiNeedsPassword: (current: Pair, next: Pair, shadows: readonly string[]) => boolean
    allAgentsAiNeedsPassword: (all: Pair, next: Pair, agents: { settings: { aiModel: string; aiEffort: string }; shadows: string[] }[]) => boolean
  }
  const OPUS_48 = 'claude-opus-4-8' // priced (5/25/0.5), not on the list, no successor: AGENT_MODEL may still name it
  assert.ok(Object.hasOwn(strategist.PRICES, OPUS_48) && !Object.hasOwn(strategist.MODELS, OPUS_48) && strategist.currentModel(OPUS_48) === OPUS_48)
  // Under it `same` is left out (shadowChoices), so each plan is one request.
  withoutEnv(() => {
    const store = new Store('', ':memory:')
    store.setKv('shadow_model', 'same')
    const choices = S.shadowChoices(store, { model: OPUS_48, effort: 'medium' }, 0)
    assert.deepEqual(S.shadowRuns(choices), [])
    assert.deepEqual(choices.leftOut, [`same needs a model of the list, and the one that plays (${OPUS_48}) is not`])
  })
  // From a model the list does not have (priced or not) to any pair of the list, `same` starts: the password.
  const ids = Object.keys(strategist.MODELS)
  for (const from of [OPUS_48, 'gpt-oss']) for (const ea of strategist.EFFORTS) for (const to of ids) for (const eb of strategist.EFFORTS) {
    const cur = { model: from, effort: ea }, next = { model: to, effort: eb }
    const what = `${from} ${ea} to ${to} ${eb}`
    assert.equal(rules.wakesShadow(['same'], cur, next), true, what)
    assert.equal(rules.agentAiNeedsPassword(cur, next, ['same']), true, what)
    assert.equal(rules.allAgentsAiNeedsPassword(cur, next, [{ settings: { aiModel: '', aiEffort: '' }, shadows: ['same'] }]), true, what)
    // An agent with its own model of the list is not moved by the all-agents switch: its repeat ran before and after.
    assert.equal(rules.wakesShadow(['same'], strategist.agentChoice({ aiModel: HAIKU }, cur), strategist.agentChoice({ aiModel: HAIKU }, next)), false, what)
  }
  // Without `same` the cheaper Opus 5.5 is one click from Opus 4.8, as before: only the repeat makes it a raise.
  assert.equal(rules.agentAiNeedsPassword({ model: OPUS_48, effort: 'medium' }, { model: OPUS, effort: 'medium' }, []), false)
  // Where it ran before it still never wakes: a model of the list, or one that left it and runs its successor.
  assert.equal(rules.wakesShadow(['same'], { model: 'claude-sonnet-5', effort: 'high' }, { model: HAIKU, effort: 'high' }), false, 'Sonnet 5 runs Sonnet 5.5')
  assert.equal(rules.wakesShadow(['same'], { model: OPUS, effort: 'high' }, { model: HAIKU, effort: 'low' }), false)
  // Models alone (no effort known): it can run on neither side, so nothing starts.
  assert.equal(rules.wakesShadow(['same'], OPUS_48, OPUS), false)

  // The routes: AGENT_MODEL names Opus 4.8, nothing is saved in the dashboard, `same` is set for all agents.
  const { Service } = await import('../src/service.ts')
  const password = 'correct-horse-battery'
  const creds = { username: 'admin', passwordHash: hashPassword(password), secretKey: 'k'.repeat(64) }
  const web48 = async (set: (svc: InstanceType<typeof Service>) => void) => {
    const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-r67-')), OPUS_48))
    svc.ensureAgents()
    ;(svc as unknown as { schedule: unknown }).schedule = () => undefined
    svc.notify = () => undefined
    set(svc)
    const server = web.startWeb(svc, creds, 0)
    if (!server.listening) await once(server, 'listening')
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const sessions = new Sessions(creds.secretKey, creds.passwordHash)
    const cookie = sessions.issue('admin')
    const post = (path: string, body: unknown) => fetch(`${url}${path}`, { method: 'POST', headers: { cookie: `foxagent_session=${cookie}`, origin: url, 'x-csrf-token': sessions.csrfFor(cookie), 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return { svc, server, post }
  }
  // The Strategist box: Opus 5.5 at the same effort is not dearer than Opus 4.8, but it starts the repeat.
  const a = await web48(svc => svc.store.setKv('shadow_model', 'same'))
  try {
    assert.equal(a.svc.strategist!.model, OPUS_48)
    let res = await a.post('/api/strategist', { model: OPUS, effort: a.svc.strategist!.effort })
    assert.equal(res.status, 403, 'a switch that starts the repeat went through without the password')
    assert.equal(a.svc.strategist!.model, OPUS_48)
    res = await a.post('/api/strategist', { model: OPUS, effort: a.svc.strategist!.effort, password })
    assert.equal(res.status, 200, await res.text())
  } finally {
    a.server.close()
  }
  // One agent that follows the all-agents Opus 4.8, with `same` in its own list, gets Opus 5.5 of its own.
  const b = await web48(svc => svc.store.setKv('shadow_model_agent_1', 'same'))
  try {
    let res = await b.post('/api/agents/0/settings', { aiModel: OPUS })
    assert.equal(res.status, 403, 'an own model that starts the repeat went through without the password')
    assert.equal(b.svc.store.agent(0)!.settings.aiModel, '')
    res = await b.post('/api/agents/0/settings', { aiModel: OPUS, password })
    assert.equal(res.status, 200, await res.text())
  } finally {
    b.server.close()
  }

  // The page applies the same rule: the dialog says shadow plans start, and names the repeat.
  const models = ids.map(id => ({ id, label: strategist.MODELS[id]!.label, price: strategist.MODELS[id]!.price, ...strategist.priceRange(id)! }))
  const instance = { model: OPUS_48, effort: 'medium', models, efforts: [...strategist.EFFORTS], shadowModels: [], shadowEntries: ['same'], ownAi: 0 }
  const page = { instance, agents: [{ index: 0, ai: { model: OPUS_48, effort: 'medium', own: {}, shadows: ['same'] } }] }
  assert.equal(pageFunctions<(model: string, effort: string) => boolean>(['wakesShadow'], page)(OPUS, 'medium'), true)
  assert.equal(pageFunctions<(model: string, effort: string) => boolean>(['wakesShadow'], { instance: { ...instance, model: OPUS }, agents: [{ index: 0, ai: { own: {}, shadows: ['same'] } }] })(HAIKU, 'low'), false, 'from a model of the list: nothing starts')
  assert.match(pageFunctions<(model: string, effort: string) => string>(['wakesShadow', 'aiRaiseText'], page)(OPUS, 'medium'), /would start with this switch: a repeat of the model and effort that plays for agent 1 and any agent you add\./)
  const agentText = pageFunctions<(b: unknown, form: unknown) => string>(['agentAiText'], { instance: { ...instance, aiAll: { model: OPUS_48, effort: 'medium' } } })
  assert.match(agentText({ ai: { model: OPUS_48, effort: 'medium', own: {}, shadows: ['same'] } }, { aiModel: OPUS, aiEffort: '' }), /^Shadow plans by a repeat of its model and effort are set on the server for this agent\./)
  // The guide and the review say it.
  const guide = readFileSync(join(REPO, 'docs/SERVER.md'), 'utf8').replace(/\s+/g, ' ')
  assert.doesNotMatch(guide, /No switch of the playing model or effort starts it/)
  assert.match(guide, /A switch from such a model to one of the list starts the repeat, so it asks for your password, also when the new model is not dearer\./)
  const review = readFileSync(join(REPO, 'docs/SECURITY-REVIEW.md'), 'utf8')
  const section = review.slice(review.indexOf('\n## Repeat shadow, chat Send and model output limits (2026-11-13)\n'))
  assert.match(section, /\n\| R67A-1 \| medium \(rule 7; agent review of PR #67\) \| [^\n]+ \| [^\n]+ \|\n/)
  assert.doesNotMatch(section, /`same` never rests, so `wakesShadow` never starts it/)
})
