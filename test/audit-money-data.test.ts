// Audit of 2026-10-23 (money and data): one test per finding, each seen failing on the unchanged code first.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Executor } from '../src/executor/executor.ts'
import { budgetView, gameDayKey } from '../src/executor/budget.ts'
import { Store } from '../src/store/db.ts'
import { DEFAULT_SETTINGS } from '../src/store/settings.ts'
import { renderPlanRequest } from '../src/strategist/strategist.ts'
import { numberToHex, wholeToAtomic } from '../src/util/encoding.ts'
import { ADDR, OTHER, STRANGER, TEST_SETTINGS, dryWallet, liveWallet, rivalSquad, setup, snapshot, withLive } from './fixtures.ts'

// ---- A1: a 1v1 that errored before any FoxLeague call keeps no rival ----

const RIVAL = { id: 50, wallet_address: STRANGER, team_name: 'Rival', elo_rating: 1190, league: 'Bronze', accepted7d: 3 }
const CHALLENGE = { type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: 50, deadline_minutes: 240 } as const
const rivalSnap = () => { const s = snapshot(); s.leaderboardNeighbours = [RIVAL]; return s }

function twoAgents(stopping: () => boolean) {
  const store = new Store('', ':memory:')
  store.addAgent(0, ADDR); store.updateSettings(0, TEST_SETTINGS)
  store.addAgent(1, OTHER); store.updateSettings(1, TEST_SETTINGS)
  const chain = { simulate: async () => ({ ok: true, detail: 'success', raw: {} }), query: async () => [], account: async () => ({ nonce: 1, balance: wholeToAtomic(10) }), send: async () => 'hash1', waitForOutcome: async () => ({ kind: 'success' }) }
  const fox = { user: async () => null, tournament: async () => { throw new Error('no tournament') }, ...rivalSquad(20), createTournament: async () => { throw new Error('createTournament reached: the C1 check let this agent through') } }
  return { store, exec: () => new Executor({ cfg: {} as never, chain: chain as never, fox: fox as never, store, stopping }) }
}

test('A1a: a 1v1 create that errored before any FoxLeague call (the service stopping) releases its rival claim', async () => {
  let stopping = true
  const { store, exec } = twoAgents(() => stopping)
  const e = exec()
  await withLive(store, async () => {
    const [a] = await e.run(store.agent(0)!, liveWallet, rivalSnap(), [{ action: CHALLENGE, reason: '' }])
    assert.equal(a!.status, 'error', a!.summary)
    assert.match(a!.summary, /the service is stopping .* nothing sent/)
    stopping = false
    const [b] = await e.run(store.agent(1)!, { ...liveWallet, index: 1, address: OTHER }, rivalSnap(), [{ action: CHALLENGE, reason: '' }])
    assert.doesNotMatch(b!.summary, /another of your owner's teams already has a 1v1 out/, `nothing was created by agent 1, yet agent 2 is refused: ${b!.summary}`)
  })
})

test('A1b: after a restart, the error row of a 1v1 that never reached FoxLeague keeps no other agent off the rival', async () => {
  let stopping = true
  const { store, exec } = twoAgents(() => stopping)
  await withLive(store, async () => {
    const [a] = await exec().run(store.agent(0)!, liveWallet, rivalSnap(), [{ action: CHALLENGE, reason: '' }])
    assert.equal(a!.status, 'error', a!.summary)
    stopping = false
    const row = store.activityOf(0, ['create_challenge'], new Date(Date.now() - 60_000))[0]!
    assert.equal(row.status, 'error')
    assert.equal(JSON.parse(row.detail!).opponentUserId, 50, 'the error row carries the rival')
    const [b] = await exec().run(store.agent(1)!, { ...liveWallet, index: 1, address: OTHER }, rivalSnap(), [{ action: CHALLENGE, reason: '' }])
    assert.doesNotMatch(b!.summary, /another of your owner's teams already has a 1v1 out/, `nothing was created by agent 1, yet agent 2 is refused after the restart: ${b!.summary}`)
    assert.equal(JSON.parse(row.detail!).untouched, true, 'the row says nothing reached FoxLeague')
  })
})

test('A1 control: a 1v1 create that errored at FoxLeague (the create may have landed) keeps the rival claimed', async () => {
  const { store, exec } = twoAgents(() => false)
  const e = exec()
  await withLive(store, async () => {
    const [a] = await e.run(store.agent(0)!, liveWallet, rivalSnap(), [{ action: CHALLENGE, reason: '' }])
    assert.equal(a!.status, 'error', a!.summary)
    assert.match(a!.summary, /createTournament reached/)
    const row = store.activityOf(0, ['create_challenge'], new Date(Date.now() - 60_000))[0]!
    assert.equal(JSON.parse(row.detail!).untouched, undefined)
    const [b] = await exec().run(store.agent(1)!, { ...liveWallet, index: 1, address: OTHER }, rivalSnap(), [{ action: CHALLENGE, reason: '' }])
    assert.equal(b!.status, 'refused', b!.summary)
    assert.match(b!.summary, /another of your owner's teams already has a 1v1 out against user 50/)
  })
})

// ---- A2: a retired agent's 1v1 still out keeps the other agents off the rival ----

function siblingChallenge(store: Store) {
  store.addAgent(1, OTHER)
  const id = store.log({ agentIndex: 1, kind: 'create_challenge', status: 'dry_run', summary: 'create silver 1v1, stake 1000 vs user 50', detail: { action: { ...CHALLENGE }, opponentUserId: 50 } })
  store.db.prepare('UPDATE activity SET at = ? WHERE id = ?').run(new Date(Date.now() - 10 * 60_000).toISOString(), id)
}

test('A2: a retired sibling with a 1v1 still out against the rival keeps this agent off it', async () => {
  const m = setup()
  siblingChallenge(m.store)
  m.store.retireAgent(1, { at: new Date().toISOString(), by: 'owner', team: 'Parked FC', egld: null, foxsy: null, usd: null })
  const [r] = await m.exec.run(m.agent(), dryWallet, rivalSnap(), [{ action: { ...CHALLENGE, deadline_minutes: 60 }, reason: '' }])
  assert.equal(r!.status, 'refused', `the retired agent's challenge is still out on FoxLeague, yet: ${r!.status}: ${r!.summary}`)
  assert.match(r!.summary, /another of your owner's teams already has a 1v1 out against user 50/)
})

test('A2: so does a removed imported team whose 1v1 is still out', async () => {
  const m = setup()
  const imported = m.store.addImportedAgent(OTHER)
  const id = m.store.log({ agentIndex: imported.index, kind: 'create_challenge', status: 'dry_run', summary: 'create silver 1v1', detail: { action: { ...CHALLENGE }, opponentUserId: 50 } })
  m.store.db.prepare('UPDATE activity SET at = ? WHERE id = ?').run(new Date(Date.now() - 10 * 60_000).toISOString(), id)
  m.store.removeImportedAgent(imported.index)
  const [r] = await m.exec.run(m.agent(), dryWallet, rivalSnap(), [{ action: { ...CHALLENGE, deadline_minutes: 60 }, reason: '' }])
  assert.equal(r!.status, 'refused', r!.summary)
  assert.match(r!.summary, /another of your owner's teams already has a 1v1 out against user 50/)
})

// ---- A3 = B3: the buying power line reads the swap allowances the executor holds swaps to ----

test('A3: the buying power line promises no more FOXSY from the EGLD than the daily swap allowance still lets the agent swap', async () => {
  const settings = { ...DEFAULT_SETTINGS, egldGasReserve: '1', maxSwapFoxsy: 50_000, dailyCapUsd: 150, monthlyBudgetUsd: 3000 }
  const { store, exec, agent } = setup()
  store.updateSettings(0, settings)
  const now = new Date()
  // $140 of EGLD swapped away earlier this game day (the dry ledger the plan is judged in): $10 may still be swapped today.
  store.recordSpend({ agentIndex: 0, at: now, gameDay: gameDayKey(now, 14), category: 'swap', action: '', foxsyAtomic: 0n, egldAtomic: wholeToAtomic(31), usd: 140, txHash: null, dryRun: true })
  const s = snapshot()
  s.chain!.egld = wholeToAtomic(200)
  s.chain!.foxsy = wholeToAtomic(2270)
  // The executor: a swap of 10,000 FOXSY (about $22.50 of EGLD) is refused by the daily swap allowance.
  const b64 = (n: bigint) => Buffer.from(numberToHex(n), 'hex').toString('base64')
  const answers: Record<string, string[]> = {
    getState: [b64(1n)],
    getFirstTokenId: [Buffer.from('FOXSY-5d5f3e').toString('base64')],
    getSecondTokenId: [Buffer.from('WEGLD-bd4d79').toString('base64')],
    getReservesAndTotalSupply: [b64(wholeToAtomic(1_000_000)), b64(wholeToAtomic(500)), b64(1n)],
    getAmountIn: [b64(wholeToAtomic(5))],
  }
  ;(exec as unknown as { d: { chain: unknown } }).d.chain = { simulate: async () => ({ ok: true, detail: 'success', raw: {} }), query: async (_sc: string, fn: string) => answers[fn] ?? assert.fail(`unexpected query ${fn}`) }
  const [r] = await exec.run(agent(), dryWallet, s, [{ action: { type: 'swap_egld_for_foxsy', foxsy: 10_000 }, reason: '' }])
  assert.equal(r!.status, 'refused', r!.summary)
  assert.match(r!.summary, /daily swap allowance: \$\d+\.\d\d needed, \$140\.00 of \$150\.00 already swapped today/)
  // The plan request: no more FOXSY from the EGLD than the $10 left to swap buys, and what was swapped already.
  const text = renderPlanRequest({ snapshot: s, settings, budget: budgetView(store, 0, settings, true, now), recent: [], dryRun: true })
  const line = /Buying power:[^\n]*/.exec(text)?.[0] ?? '(no buying power line)'
  const promised = Number(/plus about ([\d,]+) FOXSY from/.exec(line)?.[1]?.replace(/,/g, '') ?? NaN)
  const swappable = Math.floor(10 / s.prices!.foxsyUsd)
  assert.ok(promised <= swappable, `the line promises ${promised} FOXSY from the EGLD while at most ${swappable} ($10) may be swapped today:\n${line}`)
  assert.match(line, /\$140\.00 of \$150\.00 today, \$140\.00 of \$3000\.00 this month/)
})

test('B3: with the daily swap allowance used up, the plan is not told that a swap still buys FOXSY today', () => {
  const { store } = setup()
  const now = new Date()
  const settings = { ...DEFAULT_SETTINGS, egldGasReserve: '1', maxSwapFoxsy: 50_000, dailyCapUsd: 150 }
  store.recordSpend({ agentIndex: 0, at: now, gameDay: gameDayKey(now, 14), category: 'swap', action: '', foxsyAtomic: 0n, egldAtomic: 0n, usd: 150, txHash: null, dryRun: true })
  const s = snapshot()
  s.chain!.egld = wholeToAtomic(200)
  s.chain!.foxsy = wholeToAtomic(2270)
  const text = renderPlanRequest({ snapshot: s, settings, budget: budgetView(store, 0, settings, true, now, 14), recent: [], dryRun: true })
  const line = text.split('\n').find(l => l.startsWith('Buying power:'))!
  assert.doesNotMatch(line, /buys about 66,667 FOXSY/, `a swap of that is refused by the daily swap allowance: ${line}`)
  assert.match(line, /plus about 0 FOXSY from the 199 EGLD above the gas reserve/)
  assert.match(line, /\$150\.00 of \$150\.00 today/)
})

// ---- B1: the pool leaves out matches against every team of the install known by its user id ----

test('B1: a match against an own team known by its user id, but without rows of its own, is left out of the pool', () => {
  const store = new Store('', ':memory:')
  store.addAgent(0, ADDR)
  store.addAgent(1, OTHER)
  store.setKv('agent_user_id:0', '100')
  store.setKv('agent_user_id:1', '200') // agent 1 is FoxLeague user 200; it has no formation_results rows
  const at = new Date(Date.now() - 3600_000).toISOString()
  store.putFormationResults(0, 100, [
    { key: 't:A', at, mine: '4-4-2', theirs: '4-3-3', gf: 0, ga: 1, edge: -4, rivalUserId: 200 },
    { key: 't:B', at, mine: '4-4-2', theirs: '5-3-2', gf: 2, ga: 0, edge: 3, rivalUserId: 300 },
  ])
  const pool = store.formationPool()
  assert.deepEqual(pool.rows.map(r => [r.mine, r.theirs]), [['4-4-2', '5-3-2']], 'only the match against the stranger')
  assert.equal(pool.matches, 1)
})

// ---- E2: the formations test does not depend on the calendar ----

test('E2: test/formations.test.ts still passes with the clock at 2026-11-10', () => {
  const clock = `const R = Date; const S = new R('2026-11-10T12:00:00Z').getTime() - R.now();
globalThis.Date = class extends R { constructor(...a) { if (a.length === 0) super(R.now() + S); else super(...a) } static now() { return R.now() + S } }`
  const file = fileURLToPath(new URL('./formations.test.ts', import.meta.url))
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', `data:text/javascript,${encodeURIComponent(clock)}`, '--test', '--test-reporter=tap', file], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 120_000, env })
  const failed = (r.stdout + r.stderr).split('\n').filter(l => /^\s*not ok|^# fail/.test(l))
  assert.equal(r.status, 0, `exit ${r.status}\n${failed.join('\n')}`)
})
