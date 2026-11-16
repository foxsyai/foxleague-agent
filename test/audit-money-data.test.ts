// Audit of 2026-10-23 (money and data): one test per finding, each seen failing on the unchanged code first.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import { Mnemonic } from '@multiversx/sdk-core'
import { checkAction, type RulesContext } from '../src/executor/rules.ts'
import { budgetView, gameDayKey } from '../src/executor/budget.ts'
import { estimateMinutes } from '../src/executor/slots.ts'
import { FoxLeague } from '../src/foxleague/api.ts'
import { gateLine } from '../src/foxleague/gate.ts'
import type { MatchWaiverQuote } from '../src/foxleague/types.ts'
import { Service } from '../src/service.ts'
import { takeSnapshot } from '../src/snapshot/snapshot.ts'
import { Store } from '../src/store/db.ts'
import { DEFAULT_SETTINGS } from '../src/store/settings.ts'
import { renderPlanRequest } from '../src/strategist/strategist.ts'
import { numberToHex, wholeToAtomic } from '../src/util/encoding.ts'
import { ADDR, OTHER, TEST_SETTINGS, card, dryWallet, liveWallet, setup, snapshot, tournament, withLive } from './fixtures.ts'

const hours = (h: number): string => new Date(Date.now() + h * 3600_000).toISOString()

// A1 and A2 (a 1v1 claim between the owner's agents) went with the rule on 2026-10-27: test/agents-alone.test.ts.

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

// ---- B2: a failed read of the agent's own history does not hide the pooled record ----

function offlineService() {
  const svc = new Service({ mnemonic: Mnemonic.generate().toString(), dataDir: mkdtempSync(join(tmpdir(), 'foxagent-audit-')), gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9', gatewayRps: 5, apiRps: 1, foxleagueRps: 5, isServer: false, defaultDryRun: true, maxAgents: 3 } as never)
  svc.ensureAgents()
  ;(svc as unknown as { schedule: unknown }).schedule = () => undefined
  return svc
}

test('B2: the pooled record reaches the plan even when the agent\'s own match history could not be read', async () => {
  const svc = offlineService()
  const fail = async () => { throw new Error('offline') }
  const fakes: Record<string, unknown> = {
    user: async () => snapshot().profile,
    team: async () => snapshot().team,
    players: async () => [],
    matchHistory: async () => { throw new Error('HTTP 502') },
  }
  const fox = svc.fox as unknown as Record<string, unknown>
  for (const client of [svc.chain, svc.fox] as unknown as Record<string, unknown>[]) {
    for (const k of Object.getOwnPropertyNames(Object.getPrototypeOf(client))) if (k !== 'constructor' && typeof client[k] === 'function') client[k] = (client === fox ? fakes[k] : undefined) ?? fail
  }
  const at = new Date(Date.now() - 3600_000).toISOString()
  svc.store.putFormationResults(1, 101, [{ key: 't:B', at, mine: '4-3-3', theirs: '4-4-2', gf: 1, ga: 1, edge: 0, rivalUserId: 300 }])
  const plan = await (svc as unknown as { snapshot(i: number, plan: boolean): Promise<{ formationRecord?: unknown; formationPool?: { matches: number } }> }).snapshot(0, true)
  assert.equal(plan.formationRecord, null, 'control: the own record is unknown')
  assert.equal(plan.formationPool?.matches, 1, 'the other team\'s match is in the pool the plan sees')
})

// ---- B-P1: a ranked or casual match's statistics rebuild both elevens at read time ----

type HistoryRow = Record<string, unknown>
const historyRow = (key: string, home: number, away: number, score: [number, number], finishedHoursAgo: number): HistoryRow => ({
  id: /^\d+$/.test(key) ? Number(key) : null, tournament_match_id: /^\d+$/.test(key) ? null : key, home_user_id: home, away_user_id: away,
  home_team_name: `T${home}`, away_team_name: `T${away}`, home_score: score[0], away_score: score[1], match_type: /^\d+$/.test(key) ? 'ranked' : 'tournament',
  status: 'finished', finished_at: hours(-finishedHoursAgo), home_elo_at_match: 1200, away_elo_at_match: 1200, tournament_id: null,
})

function recordDeps(history: HistoryRow[], facts: Record<string, unknown>) {
  const fox: Record<string, unknown> = {
    config: async () => snapshot().config,
    user: async (a: string) => (a === ADDR ? snapshot().profile : null),
    team: async () => snapshot().team,
    players: async () => [],
    tournaments: async () => [],
    leaderboard: async () => ({ users: [], total: 0, limit: 200, offset: 0 }),
    listings: async () => [],
    floorPrices: async () => [],
    shopStatus: async () => snapshot().auth!.shop,
    dailyAllowance: async () => snapshot().auth!.allowance,
    activeMatch: async () => null,
    myTournaments: async () => ({ active: [], completed: [] }),
    upcomingMatches: async () => ({ lead_minutes: 30, my_team_name: 'Agent', matches: [] }),
    challengesForMe: async () => [],
    matchHistory: async (a: string) => (a === ADDR ? history : []),
    matchFormations: async (m: HistoryRow) => facts[String(m.tournament_match_id ?? m.id)] ?? null,
  }
  const chain = { account: async () => ({ balance: 0n, nonce: 1 }), esdts: async () => [], egldUsd: async () => 25, query: async () => { throw new Error('no pool in this test') } }
  return { chain, fox } as never
}

test('B-P1: a ranked match\'s strength edge counts only when its statistics were read within 6 hours of its end; a tournament match keeps its edge', async () => {
  const kept = new Map<string, unknown>()
  const cache = { get: (k: string) => kept.get(k) as never, put: (k: string, v: unknown) => void kept.set(k, v) }
  // Read before this tick: a ranked match without a read time, and one read 2 hours after it ended.
  kept.set('m:13', { home: '4-4-2', away: '4-3-3', homeStrength: 1500, awayStrength: 1000 })
  kept.set('m:14', { home: '4-4-2', away: '4-3-3', homeStrength: 1500, awayStrength: 1000, readAt: hours(-8) })
  const history = [
    historyRow('T1', 100, 200, [1, 2], 10), // tournament, kickoff snapshot: its edge stands whenever it is read
    historyRow('11', 100, 300, [3, 0], 10), // ranked, read now, 10 h after its end: today's cards, not the match's
    historyRow('12', 100, 400, [1, 0], 1), // ranked, read now, 1 h after its end
    historyRow('13', 100, 500, [0, 0], 1), // ranked, kept without a read time
    historyRow('14', 100, 600, [2, 2], 10), // ranked, kept with a read 2 h after its end
  ]
  const facts = {
    T1: { home: '4-4-2', away: '4-3-3', homeStrength: 1500, awayStrength: 1600 },
    11: { home: '4-4-2', away: '4-3-3', homeStrength: 1500, awayStrength: 1000 },
    12: { home: '4-4-2', away: '4-3-3', homeStrength: 1500, awayStrength: 1400 },
  }
  const s = await takeSnapshot(recordDeps(history, facts), { wallet: dryWallet }, new Date(), { matchFacts: cache } as never)
  const games = (s.formationRecord?.games ?? []).map(g => [g.key, g.edge === null ? null : Math.round(g.edge)])
  assert.deepEqual(games, [['t:T1', -6], ['m:11', null], ['m:12', 7], ['m:13', null], ['m:14', 50]])
  assert.match(String((kept.get('m:12') as { readAt?: string }).readAt), /^\d{4}-\d\d-\d\dT/, 'a fresh read is kept with its read time')
})

test('B-P1: formation_results is emptied once, so the pool is rebuilt under the read-time rule', () => {
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-audit-pool-'))
  const at = new Date(Date.now() - 3600_000).toISOString()
  const g = { key: 'm:1', at, mine: '4-4-2', theirs: '4-3-3', gf: 1, ga: 0, edge: 40, rivalUserId: 300 }
  let store = new Store(dir)
  store.putFormationResults(0, 100, [g])
  // A database from before the rule: no clean-up recorded yet.
  store.db.prepare("DELETE FROM kv WHERE key LIKE 'formation_results%'").run()
  store.db.close()
  store = new Store(dir)
  assert.equal(store.formationPool().matches, 0, 'the rows stored under the old rule are gone')
  store.putFormationResults(0, 100, [g])
  store.db.close()
  store = new Store(dir)
  assert.equal(store.formationPool().matches, 1, 'only once: the rows stored since stay')
  store.db.close()
})

// ---- C1: a Legendary's match waiver serves its listing gate ----

test('C1: a spare Legendary at 300 played may buy the 105 matches it misses to its listing gate', () => {
  const s = snapshot([card(501, 'FWD', 'reserve', { rarity: 'Legendary', cap: 100, competitiveMatches: 300, syncedTotal: 50 })])
  s.chain!.foxsy = wholeToAtomic(20_000)
  // What the model is told (the snapshot's gate line): a Legendary's rest is waivable and counts for listing.
  assert.match(gateLine(s.config!), /Legendary 405 \(135 played, the rest waivable at 100 FOXSY a match\)/)
  const quote: MatchWaiverQuote = { max_purchasable: 105, chain_played: 300, credit: 0, price_wei: wholeToAtomic(100).toString(), rarity: 'Legendary', gate: 405, floor: 135, price_per_match: 100, meets_gate: false }
  const ctx = { settings: { ...TEST_SETTINGS, maxShopPaymentFoxsy: 11_000 }, now: new Date(), matchQuote: quote }
  const v = checkAction({ type: 'fusion_match_waiver', nonce: 501, matches: 105 }, s, ctx)
  assert.equal(v.ok, true, `the agent refuses what FoxLeague sells: ${v.refusal}`)
  assert.equal(v.foxsy, wholeToAtomic(10_500))
  assert.match(v.notes.join(' '), /reaches 405 competitive matches for listing/)
})

test('C1: a Legendary waiver still needs a card the agent would list (a spare, 18 cards left) and stays within the max shop payment', () => {
  const quote: MatchWaiverQuote = { max_purchasable: 105, chain_played: 300, credit: 0, price_wei: wholeToAtomic(100).toString(), rarity: 'Legendary', gate: 405, floor: 135, price_per_match: 100, meets_gate: false }
  const ctx = (max = 11_000) => ({ settings: { ...TEST_SETTINGS, maxShopPaymentFoxsy: max }, now: new Date(), matchQuote: quote })
  const legend = (more = {}) => card(501, 'FWD', 'reserve', { rarity: 'Legendary', cap: 100, competitiveMatches: 300, syncedTotal: 50, ...more })
  const strong = snapshot([legend({ syncedTotal: 600 })])
  strong.chain!.foxsy = wholeToAtomic(20_000)
  assert.match(checkAction({ type: 'fusion_match_waiver', nonce: 501, matches: 105 }, strong, ctx()).refusal ?? '', /among the 18 strongest cards/)
  const short = snapshot([legend()])
  short.chain!.foxsy = wholeToAtomic(20_000)
  short.players = short.players.filter(p => p.nonce !== 18)
  short.team!.substitutes = short.team!.substitutes.filter(n => n !== 18)
  assert.match(checkAction({ type: 'fusion_match_waiver', nonce: 501, matches: 105 }, short, ctx()).refusal ?? '', /fewer than 18 cards/)
  const benched = snapshot([legend()])
  benched.chain!.foxsy = wholeToAtomic(20_000)
  benched.team!.substitutes = [...benched.team!.substitutes.slice(0, 6), 501]
  assert.match(checkAction({ type: 'fusion_match_waiver', nonce: 501, matches: 105 }, benched, ctx()).refusal ?? '', /in the lineup or on the bench/)
  const spare = snapshot([legend()])
  spare.chain!.foxsy = wholeToAtomic(20_000)
  assert.match(checkAction({ type: 'fusion_match_waiver', nonce: 501, matches: 105 }, spare, ctx(10_000)).refusal ?? '', /10500 FOXSY exceeds the per-action maximum 10000/)
  assert.match(checkAction({ type: 'fusion_match_waiver', nonce: 501, matches: 100 }, spare, ctx()).refusal ?? '', /needs exactly 105/)
  // The cooldown waiver buys a Legendary nothing: it cannot be fused.
  const cooling = snapshot([legend({ fusionReadyAt: hours(24 * 10) })])
  assert.match(checkAction({ type: 'fusion_cooldown_waiver', nonce: 501 }, cooling, { ...ctx(), cooldownQuote: { days: 7, costAtomic: wholeToAtomic(700) } }).refusal ?? '', /a Legendary cannot be fused/)
})

// ---- C2: Play waits for FoxLeague's match slot (up to 30 s), and a lost answer is read back ----

test('C2: play_match waits out FoxLeague holding the answer 30 s for a match slot (the app allows 90 s; the agent gave up at 20 s)', async () => {
  // Every request timeout runs 20 times faster: the old 20 s give-up is 1 s, FoxLeague's 30 s wait is 1.5 s. (At 100 times
  // the sign-in before it had 200 ms, too short on a busy machine running the whole suite.)
  const SCALE = 20
  const realTimeout = AbortSignal.timeout
  AbortSignal.timeout = (ms: number) => realTimeout.call(AbortSignal, Math.ceil(ms / SCALE))
  const server = createServer((req, res) => {
    req.resume()
    res.setHeader('content-type', 'application/json')
    if (req.url === '/api/auth/verify') return void res.end(JSON.stringify({ success: true, data: { token: 't' } }))
    if (req.url === '/api/matches/play') return void setTimeout(() => res.end(JSON.stringify({ success: true, data: { match_id: 7, status: 'simulating' } })), 30_000 / SCALE)
    res.statusCode = 404
    res.end('{}')
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
  try {
    const fox = new FoxLeague(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 50)
    const r = await fox.playMatch({ ...dryWallet, signMessage: () => 'sig' }, 'casual').catch((err: Error) => assert.fail(`playMatch gave up with ${err.name}: ${err.message} (the match starts on FoxLeague all the same)`))
    assert.equal(r.match_id, 7)
  } finally {
    AbortSignal.timeout = realTimeout
    server.close()
  }
})

test('C2: a Play whose answer was lost reads the active match back: a match found is a match started', async () => {
  const timeout = async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError') }
  const started = setup({ fox: { playMatch: timeout, activeMatch: async () => ({ match_id: 7, kind: 'ranked', status: 'simulating', tournament_id: null, created_at: new Date().toISOString() }) } })
  await withLive(started.store, async () => {
    const [r] = await started.exec.run(started.agent(), liveWallet, snapshot(), [{ action: { type: 'play_match', match_type: 'ranked' }, reason: '' }])
    assert.equal(r!.status, 'confirmed', r!.summary)
    assert.match(r!.summary, /match #7 started \(ranked\)/)
  })
  const none = setup({ fox: { playMatch: timeout, activeMatch: async () => null } })
  await withLive(none.store, async () => {
    const [r] = await none.exec.run(none.agent(), liveWallet, snapshot(), [{ action: { type: 'play_match', match_type: 'ranked' }, reason: '' }])
    assert.equal(r!.status, 'error', r!.summary)
    assert.match(r!.summary, /aborted due to timeout/)
  })
})

// ---- C4: the slot window of a League + Knockout tournament ----

test('C4: the slot estimate of a 36-team League + Knockout tournament is FoxLeague\'s 570 minutes', () => {
  assert.equal(estimateMinutes('league_knockout', 36, false), (36 * 8 / 2 + 46) * 3)
})

// ---- D9: Zeus buys the XP booster only once a competitive fixture of its own is listed ----

test('D9: Zeus buys the XP booster only once a competitive fixture of its own is scheduled within 24 hours', () => {
  const ctx = (): RulesContext => ({ settings: { ...TEST_SETTINGS, maxShopPaymentFoxsy: 2500 }, now: new Date(), boostersThisWeek: 0 })
  const booster = { type: 'buy', product: 'xp_booster' } as const
  const seat = (more: Record<string, unknown> = {}) => ({ ...(tournament(60) as { tournament: Record<string, unknown> }).tournament, format: 'swiss', max_teams: 10, min_teams: 3, status: 'open', deadline: hours(1), starts_at: hours(1.5), ...more })
  const fixture = (more: Record<string, unknown> = {}) => ({ tournament_id: 60, tournament_title: 'T60', round_label: 'Round 1', group_name: null, is_home: true, opponent_name: 'Rival', scheduled_at: hours(1.5), strategy_locks_at: hours(1), locked: false, phase: 'upcoming', home_score: null, away_score: null, ...more })
  const drawn = snapshot()
  drawn.auth!.myTournaments!.active = [seat({ status: 'active' }) as never]
  drawn.auth!.upcoming!.matches = [fixture() as never]
  assert.equal(checkAction(booster, drawn, ctx()).ok, true, 'a fixture in the next 24 hours: the booster has matches to double')

  const seated = snapshot()
  seated.auth!.myTournaments!.active = [seat() as never]
  seated.auth!.upcoming!.matches = []
  assert.match(checkAction(booster, seated, ctx()).refusal ?? '', /no competitive match of yours is scheduled/, 'no fixture of ours exists yet')

  const late = snapshot()
  late.auth!.myTournaments!.active = [seat({ status: 'active' }) as never]
  late.auth!.upcoming!.matches = [fixture({ scheduled_at: hours(30) }) as never]
  assert.equal(checkAction(booster, late, ctx()).ok, false, 'a fixture beyond the booster\'s 24 hours')

  const bronze = snapshot()
  bronze.auth!.myTournaments!.active = [seat({ status: 'active', tier: 'bronze' }) as never]
  bronze.auth!.upcoming!.matches = [fixture() as never]
  assert.equal(checkAction(booster, bronze, ctx()).ok, false, 'a Bronze match earns no XP')

  const blind = snapshot()
  blind.auth!.upcoming = null as never
  assert.match(checkAction(booster, blind, ctx()).refusal ?? '', /could not be read/)

  // Every level since 2026-11-06 (one brain): no level buys a booster with nothing of its own to double.
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

// The prompt follows C1 and D9 (audit 2026-10-23): the AI is told what the rules now allow and require.
test('the prompt says a Legendary buys its match waiver for its listing gate, and the booster is bought once the fixtures are drawn', async () => {
  const { SYSTEM_PROMPT } = await import('../src/strategist/prompt.ts')
  assert.match(SYSTEM_PROMPT, /A Legendary is never fused, but its match waiver \(100 FOXSY a match, at most 270\) buys the matches of its listing gate, only for a spare you would sell/)
  assert.match(SYSTEM_PROMPT, /The executor sells the booster only once a Silver, Gold or 1v1 match of your own is drawn within its 24 hours/)
})
