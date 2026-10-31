// 2026-10-22: nine of the ten agents played one formation in all of their last 50 matches (seven of them 4-4-2), while
// the 4-3-3 family beat 4-4-2 at equal strength across those 483 matches. The agents could change formation, but they
// saw no record of what each formation did against which, nor what their next opponent plays; and a formation
// change ran apart from the lineup it needs, so a match in between could play with players out of position.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAction } from '../src/executor/actions.ts'
import { ApiRefusal } from '../src/foxleague/api.ts'
import { takeSnapshot } from '../src/snapshot/snapshot.ts'
import { renderDigest } from '../src/snapshot/digest.ts'
import { Store } from '../src/store/db.ts'
import { ADDR, OTHER, STRANGER, dryWallet, liveWallet, setup, snapshot, tournament, withLive } from './fixtures.ts'

// The fixture's squad starts in 4-4-2: 1 GK, 2-5 DEF, 6-9 MID, 10-11 FWD; bench 12 GK, 13-14 DEF, 15-16 MID, 17-18 FWD.
const XI_433 = [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 17]
const BENCH_433 = [12, 13, 14, 15, 16, 18, 9]

test('a formation change the eleven does not fit is refused without its new lineup', async () => {
  const { exec, agent } = setup()
  const [r] = await exec.run(agent(), dryWallet, snapshot(), [{ action: { type: 'set_formation', formation: '4-3-3' }, reason: '' }])
  assert.equal(r!.status, 'refused', r!.summary)
  assert.match(r!.summary, /4-3-3 needs a lineup that fits it/)
  // A change the eleven already fits (same slots) needs no new lineup.
  const [same] = await exec.run(agent(), dryWallet, snapshot(), [{ action: { type: 'set_formation', formation: '4-4-2o' }, reason: '' }])
  assert.notEqual(same!.status, 'refused', same!.summary)
})

test('set_formation takes its lineup and bench together', () => {
  assert.deepEqual(parseAction({ type: 'set_formation', formation: '4-3-3', lineup: XI_433, substitutes: BENCH_433 }), { type: 'set_formation', formation: '4-3-3', lineup: XI_433, substitutes: BENCH_433 })
  assert.throws(() => parseAction({ type: 'set_formation', formation: '4-3-3', lineup: XI_433 }), /substitutes/)
  assert.deepEqual(parseAction({ type: 'set_formation', formation: '4-4-2o' }), { type: 'set_formation', formation: '4-4-2o' })
})

test('the new lineup is checked against the new formation', async () => {
  const { exec, agent } = setup()
  const s = snapshot()
  const [r] = await exec.run(agent(), dryWallet, s, [{ action: { type: 'set_formation', formation: '4-3-3', lineup: s.team!.lineup, substitutes: s.team!.substitutes }, reason: '' }])
  assert.equal(r!.status, 'refused', r!.summary)
  assert.match(r!.summary, /slot 8 of 4-3-3 wants a FWD, #9 is a MID/)
})

// FoxLeague rc.78 (#566): POST /teams/formation alone refuses a formation the saved eleven does not fit, so a change of
// lines goes as one save, POST /teams/lineup with its formation, written together or not at all. Live, agent 6 was
// refused twice ("Save the formation together with a lineup that fits it").
const TO_433 = { type: 'set_formation' as const, formation: '4-3-3', lineup: XI_433, substitutes: BENCH_433 }
const recorder = (calls: string[], over: Record<string, unknown>) => ({
  setFormation: async (_w: unknown, f: string) => { calls.push(`formation ${f}`) },
  setLineup: async (_w: unknown, l: number[], _s: number[], f?: string) => { calls.push(`lineup ${l.join(',')} in ${f}`) },
  ...over,
})

test('R78-1: formation and lineup go in one save, and the formation alone is never sent ahead of them', async () => {
  const calls: string[] = []
  const ok = setup({ fox: recorder(calls, { setFormation: async () => { calls.push('formation alone'); throw new ApiRefusal('Conor Smith is a MID. Slot requires FW in 4-3-3. Save the formation together with a lineup that fits it.') } }) })
  await withLive(ok.store, async () => {
    const [r] = await ok.exec.run(ok.agent(), liveWallet, snapshot(), [{ action: TO_433, reason: '' }])
    assert.equal(r!.status, 'confirmed', r!.summary)
  })
  assert.deepEqual(calls, [`lineup ${XI_433.join(',')} in 4-3-3`])
})

test('R78-1: a refused save changed nothing, so nothing is put back', async () => {
  const calls: string[] = []
  const bad = setup({ fox: recorder(calls, { setLineup: async () => { calls.push('lineup'); throw new ApiRefusal('Some players are not owned by you or are listed for sale') }, team: async () => { calls.push('read'); return snapshot().team } }) })
  await withLive(bad.store, async () => {
    const [r] = await bad.exec.run(bad.agent(), liveWallet, snapshot(), [{ action: TO_433, reason: '' }])
    assert.notEqual(r!.status, 'confirmed')
    assert.match(r!.summary, /not owned by you/)
  })
  assert.deepEqual(calls, ['lineup'], 'FoxLeague writes both or neither')
})

test('a formation between the same lines still goes alone', async () => {
  const calls: string[] = []
  const m = setup({ fox: recorder(calls, {}) })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, snapshot(), [{ action: { type: 'set_formation', formation: '4-4-2o' }, reason: '' }])
    assert.equal(r!.status, 'confirmed', r!.summary)
  })
  assert.deepEqual(calls, ['formation 4-4-2o'])
})

// Review of PR #15 (medium), kept for the one save: a failure that is not FoxLeague's refusal (a timeout, a 502 after
// the save) may have saved it, so the team is read back and nothing is changed blind.
test('a save that fails without a refusal is read back', async () => {
  const calls: string[] = []
  const timeout = async () => { calls.push('lineup'); throw new Error('timeout after 30000 ms') }
  const saved = setup({ fox: recorder(calls, { setLineup: timeout, team: async () => { calls.push('read'); return { ...snapshot().team!, formation: '4-3-3', lineup: XI_433, substitutes: BENCH_433 } } }) })
  await withLive(saved.store, async () => {
    const [r] = await saved.exec.run(saved.agent(), liveWallet, snapshot(), [{ action: TO_433, reason: '' }])
    assert.equal(r!.status, 'confirmed', r!.summary)
    assert.match(r!.summary, /read back/)
  })
  assert.deepEqual(calls, ['lineup', 'read'])

  calls.length = 0
  const lost = setup({ fox: recorder(calls, { setLineup: timeout, team: async () => { calls.push('read'); return snapshot().team } }) })
  await withLive(lost.store, async () => {
    const [r] = await lost.exec.run(lost.agent(), liveWallet, snapshot(), [{ action: TO_433, reason: '' }])
    assert.notEqual(r!.status, 'confirmed', r!.summary)
  })
  assert.deepEqual(calls, ['lineup', 'read'], 'not saved: the old formation and eleven still stand')

  calls.length = 0
  const blind = setup({ fox: recorder(calls, { setLineup: timeout, team: async () => { calls.push('read'); throw new Error('HTTP 502') } }) })
  await withLive(blind.store, async () => {
    const [r] = await blind.exec.run(blind.agent(), liveWallet, snapshot(), [{ action: TO_433, reason: '' }])
    assert.equal(r!.status, 'error')
    assert.match(r!.summary, /could not be read back/)
  })
  assert.deepEqual(calls, ['lineup', 'read'], 'unknown: nothing is changed blind')
})

// Re-review of PR #15 (not verified, closed): an answer that is not FoxLeague's envelope ("unexpected answer") is no
// refusal: the eleven may have been saved, so it is read back like a timeout.
test('an unexpected answer to the save is read back, not taken as a refusal', async () => {
  const calls: string[] = []
  const m = setup({ fox: recorder(calls, { setLineup: async () => { calls.push('lineup'); throw new ApiRefusal('unexpected answer from /teams/lineup (HTTP 502)') }, team: async () => { calls.push('read'); return { ...snapshot().team!, formation: '4-3-3', lineup: XI_433, substitutes: BENCH_433 } } }) })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, snapshot(), [{ action: TO_433, reason: '' }])
    assert.equal(r!.status, 'confirmed', r!.summary)
  })
  assert.deepEqual(calls, ['lineup', 'read'])
})

test('no match, entry or 1v1 while the saved eleven does not fit the saved formation', async () => {
  const { exec, agent } = setup()
  const s = snapshot()
  s.team!.formation = '4-3-3' // saved elsewhere with the 4-4-2 eleven: a midfielder would play up front
  const [r] = await exec.run(agent(), dryWallet, s, [{ action: { type: 'play_match', match_type: 'ranked' }, reason: '' }])
  assert.equal(r!.status, 'refused', r!.summary)
  assert.match(r!.summary, /does not fit the formation 4-3-3/)
  assert.match(renderDigest(s), /LINEUP DOES NOT FIT 4-3-3/)
  // Review of PR #15 (low): the entries that pay FOXSY too.
  const t = setup({ fox: { tournament: async () => tournament(7) } })
  const [join] = await t.exec.run(t.agent(), dryWallet, s, [{ action: { type: 'join_tournament', tournament_id: 7 }, reason: '' }])
  assert.equal(join!.status, 'refused', join!.summary)
  assert.match(join!.summary, /does not fit the formation 4-3-3/)
  const [duel] = await exec.run(agent(), dryWallet, s, [{ action: { type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: null, deadline_minutes: 60 }, reason: '' }])
  assert.equal(duel!.status, 'refused', duel!.summary)
  assert.match(duel!.summary, /does not fit the formation 4-3-3/)
})

// ---- the formation record ----

type Row = Record<string, unknown>
// Finished an hour ago, whatever the date: the pool keeps 14 days, so a fixed date would turn the test red later (E2).
const row = (key: string, home: number, away: number, score: [number, number] | null, more: Row = {}): Row => ({
  id: /^\d+$/.test(key) ? Number(key) : null, tournament_match_id: /^\d+$/.test(key) ? null : key,
  home_user_id: home, away_user_id: away, home_team_name: `T${home}`, away_team_name: `T${away}`,
  home_score: score?.[0] ?? null, away_score: score?.[1] ?? null, match_type: /^\d+$/.test(key) ? 'ranked' : 'tournament',
  status: score ? 'finished' : 'scheduled', finished_at: score ? new Date(Date.now() - 3600_000).toISOString() : null,
  home_elo_at_match: 1200, away_elo_at_match: 1200, tournament_id: null, ...more,
})

function fakes(o: { history: Record<string, Row[]>; facts: Record<string, unknown>; tournaments?: Record<number, unknown>; upcoming?: unknown[]; players?: (a: string) => Promise<unknown[]> }) {
  const reads: string[] = []
  const fox: Record<string, unknown> = {
    config: async () => snapshot().config,
    user: async (a: string) => (a === ADDR ? snapshot().profile : null),
    team: async () => snapshot().team,
    players: o.players ?? (async () => []),
    tournaments: async () => [],
    leaderboard: async () => ({ users: [], total: 0, limit: 200, offset: 0 }),
    listings: async () => [],
    floorPrices: async () => [],
    shopStatus: async () => snapshot().auth!.shop,
    dailyAllowance: async () => snapshot().auth!.allowance,
    activeMatch: async () => null,
    myTournaments: async () => ({ active: [], completed: [] }),
    upcomingMatches: async () => ({ lead_minutes: 30, my_team_name: 'Agent', matches: o.upcoming ?? [] }),
    challengesForMe: async () => [],
    tournament: async (id: number) => o.tournaments?.[id] ?? assert.fail(`T${id} not expected`),
    matchHistory: async (a: string) => o.history[a] ?? [],
    matchFormations: async (m: Row) => {
      const key = String(m.tournament_match_id ?? m.id)
      reads.push(key)
      const f = o.facts[key]
      if (f instanceof Error) throw f
      return f ?? null
    },
  }
  const chain = { account: async () => ({ balance: 0n, nonce: 1 }), esdts: async () => [], egldUsd: async () => 25, query: async () => { throw new Error('no pool in this test') } }
  return { deps: { chain, fox } as never, reads }
}

function cache() {
  const m = new Map<string, unknown>()
  return { get: (k: string) => m.get(k) as never, put: (k: string, v: unknown) => void m.set(k, v), size: () => m.size }
}

test('the record counts each revealed match by your formation against the rival\'s, with the strength edge in percent', async () => {
  // Agent is user 100. A2 is unrevealed (no score): it is neither counted nor waiting.
  const { deps } = fakes({
    history: { [ADDR]: [row('A1', 100, 200, [1, 2]), row('11', 300, 100, [0, 0]), row('12', 100, 400, [3, 0]), row('A2', 100, 500, null)] },
    facts: {
      A1: { home: '4-4-2', away: '4-3-3', homeStrength: 1500, awayStrength: 1600 },
      11: { home: '4-3-3', away: '4-4-2', homeStrength: 1500, awayStrength: 1550 },
      12: { home: '4-4-2', away: '4-4-2', homeStrength: 1500, awayStrength: 1400 },
    },
  })
  const s = await takeSnapshot(deps, { wallet: dryWallet }, new Date(), { matchFacts: cache() } as never)
  const r = (s as unknown as { formationRecord?: { matches: number; unread: number } }).formationRecord
  assert.equal(r?.matches, 3)
  assert.equal(r?.unread, 0)
  const d = renderDigest(s)
  assert.match(d, /Formation record \(your last 3 revealed matches/)
  assert.match(d, /4-4-2 vs 4-3-3: 2 played, W0 D1 L1, goals 1-2, strength edge -1%/)
  assert.match(d, /4-4-2 vs 4-4-2: 1 played, W1 D0 L0, goals 3-0, strength edge \+7%/)
  assert.match(d, /Rival formations in those matches: 4-3-3 2, 4-4-2 1/)
})

test('a match whose formations could not be read is waiting, never counted as anything', async () => {
  const facts: Record<string, unknown> = { 11: new Error('HTTP 502'), 12: null, 13: { home: '4-4-2', away: '5-3-2', homeStrength: 1500, awayStrength: 1500 } }
  const history = { [ADDR]: [row('11', 100, 200, [2, 0]), row('12', 100, 300, [0, 1]), row('13', 100, 400, [1, 1])] }
  const c = cache()
  const first = fakes({ history, facts })
  const s = await takeSnapshot(first.deps, { wallet: dryWallet }, new Date(), { matchFacts: c } as never)
  const r = (s as unknown as { formationRecord?: { matches: number; unread: number } }).formationRecord
  assert.equal(r?.matches, 1)
  assert.equal(r?.unread, 2)
  assert.match(renderDigest(s), /2 more finished matches not read yet/)
  assert.equal(c.size(), 1, 'only a full read is kept')
  // Read again next tick, once FoxLeague answers.
  facts[11] = { home: '4-3-3', away: '4-4-2', homeStrength: 1500, awayStrength: 1500 }
  facts[12] = { home: '4-3-3', away: '4-4-2', homeStrength: 1500, awayStrength: 1500 }
  const again = fakes({ history, facts })
  const s2 = await takeSnapshot(again.deps, { wallet: dryWallet }, new Date(), { matchFacts: c } as never)
  assert.deepEqual(again.reads, ['11', '12'], 'the kept match is not read again')
  assert.equal((s2 as unknown as { formationRecord?: { matches: number } }).formationRecord?.matches, 3)
})

test('each tick reads at most 10 new matches, newest first, and keeps them', async () => {
  const history = { [ADDR]: Array.from({ length: 30 }, (_, i) => row(String(100 + i), 100, 200, [1, 0])) }
  const facts = Object.fromEntries(history[ADDR]!.map(m => [String(m.id), { home: '4-4-2', away: '4-3-3', homeStrength: 1500, awayStrength: 1500 }]))
  const c = cache()
  const one = fakes({ history, facts })
  const s1 = await takeSnapshot(one.deps, { wallet: dryWallet }, new Date(), { matchFacts: c } as never)
  assert.deepEqual(one.reads, Array.from({ length: 10 }, (_, i) => String(100 + i)))
  assert.deepEqual([(s1 as never as { formationRecord: { matches: number; unread: number } }).formationRecord.matches, (s1 as never as { formationRecord: { unread: number } }).formationRecord.unread], [10, 20])
  const two = fakes({ history, facts })
  await takeSnapshot(two.deps, { wallet: dryWallet }, new Date(), { matchFacts: c } as never)
  assert.deepEqual(two.reads, Array.from({ length: 10 }, (_, i) => String(110 + i)))
})

test('the record is read only when asked (the planning snapshot), not on every check before an action', async () => {
  const { deps, reads } = fakes({ history: { [ADDR]: [row('11', 100, 200, [1, 0])] }, facts: { 11: { home: '4-4-2', away: '4-3-3', homeStrength: 1, awayStrength: 1 } } })
  const s = await takeSnapshot(deps, { wallet: dryWallet })
  assert.equal(reads.length, 0)
  assert.doesNotMatch(renderDigest(s), /Formation record/)
})

test('the next opponent\'s recent formations are on its Upcoming line', async () => {
  const lock = new Date(Date.now() + 2 * 3600_000).toISOString()
  const { deps } = fakes({
    history: {
      [ADDR]: [],
      [OTHER]: [row('R1', 900, 700, [2, 1]), row('R2', 800, 900, [0, 0]), row('R3', 900, 600, [1, 0])],
    },
    facts: {
      R1: { home: '4-3-3w', away: '4-4-2', homeStrength: 1, awayStrength: 1 },
      R2: { home: '5-3-2', away: '4-3-3w', homeStrength: 1, awayStrength: 1 },
      R3: { home: '4-2-3-1', away: '4-4-2', homeStrength: 1, awayStrength: 1 },
    },
    tournaments: { 7: { tournament: { id: 7 }, participants: [{ user_id: 100, wallet_address: ADDR, team_name: 'Agent' }, { user_id: 900, wallet_address: OTHER, team_name: 'Rival FC' }] } },
    upcoming: [{ tournament_id: 7, tournament_title: 'Cup', round_label: 'Round 1', is_home: true, opponent_name: 'Rival FC', scheduled_at: lock, strategy_locks_at: lock, locked: false, phase: 'upcoming', home_score: null, away_score: null }],
  })
  const s = await takeSnapshot(deps, { wallet: dryWallet }, new Date(), { matchFacts: cache() } as never)
  assert.match(renderDigest(s), /Upcoming: T7 "Cup" Round 1 vs Rival FC .*\[their last formations, newest first: 4-3-3w, 4-3-3w, 4-2-3-1; their strength: unknown\]/)
})

test('the store keeps the facts of a read match', () => {
  const store = new Store('', ':memory:') as unknown as { putMatchFacts(k: string, f: unknown): void; matchFacts(k: string): unknown }
  const f = { home: '4-4-2', away: '4-3-3', homeStrength: 1500, awayStrength: 1600 }
  store.putMatchFacts('A1', f)
  assert.deepEqual(store.matchFacts('A1'), f)
  assert.equal(store.matchFacts('nope'), undefined)
})

test('every level is told to learn from its formation record, to test formations and how to switch', async () => {
  const { SYSTEM_PROMPT } = await import('../src/strategist/prompt.ts')
  assert.match(SYSTEM_PROMPT, /Formations: .*formation record/)
  assert.match(SYSTEM_PROMPT, /test another formation in ranked matches/)
  assert.match(SYSTEM_PROMPT, /against the formations it played last/)
  assert.match(SYSTEM_PROMPT, /\{"type":"set_formation","formation":"[^"]+","lineup":\[11 nonces in the new formation's slot order\],"substitutes":\[up to 7 nonces\]\}/)
})

// ---- the pooled record (owner, 2026-10-22: the agents learn faster from one table) ----

const game = (key: string, rivalUserId: number | null, mine: string, theirs: string, gf: number, ga: number, edge: number | null = 0) =>
  ({ key, at: new Date(Date.now() - 3600_000).toISOString(), mine, theirs, gf, ga, edge, rivalUserId })

test('the pooled record adds the matches of every team the install runs, and leaves out matches between them', () => {
  const store = new Store('', ':memory:') as unknown as { putFormationResults(i: number, own: number, g: unknown[]): void; formationPool(): { matches: number; rows: { mine: string; theirs: string; played: number; won: number; drawn: number; lost: number; edge: number | null }[] } }
  store.putFormationResults(0, 100, [game('t:A', 200, '4-4-2', '4-3-3', 0, 1, -4), game('t:X', 101, '4-4-2', '4-4-2', 1, 1)])
  store.putFormationResults(1, 101, [game('t:B', 300, '4-3-3b', '4-4-2', 2, 0, 6), game('t:X', 100, '4-4-2', '4-4-2', 1, 1), game('m:C', 400, '4-4-2', '4-3-3', 1, 3, 2)])
  store.putFormationResults(0, 100, [game('t:A', 200, '4-4-2', '4-3-3', 0, 1, -4)]) // read again next plan: counted once
  const pool = store.formationPool()
  assert.equal(pool.matches, 3, 'A, B and C; X was between two of the teams')
  assert.deepEqual(pool.rows.map(r => [r.mine, r.theirs, r.played, r.won, r.drawn, r.lost, r.edge]), [['4-4-2', '4-3-3', 2, 0, 0, 2, -1], ['4-3-3b', '4-4-2', 1, 1, 0, 0, 6]])
})

test('the plan sees the pooled record without the names of the teams in it', () => {
  const s = snapshot() as ReturnType<typeof snapshot> & { formationPool?: unknown }
  s.formationPool = { matches: 3, unread: 0, rows: [{ mine: '4-3-3b', theirs: '4-4-2', played: 3, won: 3, drawn: 0, lost: 0, goalsFor: 7, goalsAgainst: 1, edge: 5, bands: { stronger: [0, 0, 0], even: [3, 0, 0], weaker: [0, 0, 0] } }], field: [{ formation: '4-4-2', matches: 3 }] }
  const d = renderDigest(s)
  assert.match(d, /Pooled formation record \(3 matches of the last 14 days of every team your owner runs here, yours included, matches between them left out; names not shown\):/)
  assert.match(d, /\n {2}4-3-3b vs 4-4-2: 3 played, W3 D0 L0, goals 7-1, strength edge \+5%/)
})

test('a planning snapshot keeps its matches for the pool and carries the pooled record', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { Mnemonic } = await import('@multiversx/sdk-core')
  const { Service } = await import('../src/service.ts')
  const svc = new Service({ mnemonic: Mnemonic.generate().toString(), dataDir: mkdtempSync(join(tmpdir(), 'foxagent-')), gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9', gatewayRps: 5, apiRps: 1, foxleagueRps: 5, isServer: false, defaultDryRun: true, maxAgents: 3 } as never)
  svc.ensureAgents()
  ;(svc as unknown as { schedule: unknown }).schedule = () => undefined
  const fail = async () => { throw new Error('offline') }
  const fakes: Record<string, unknown> = {
    user: async () => snapshot().profile,
    team: async () => snapshot().team,
    players: async () => [],
    matchHistory: async () => [row('11', 100, 200, [2, 0])],
    matchFormations: async () => ({ home: '4-3-3', away: '4-4-2', homeStrength: 1500, awayStrength: 1500 }),
  }
  const fox = svc.fox as unknown as Record<string, unknown>
  for (const client of [svc.chain, svc.fox] as unknown as Record<string, unknown>[]) {
    for (const k of Object.getOwnPropertyNames(Object.getPrototypeOf(client))) if (k !== 'constructor' && typeof client[k] === 'function') client[k] = (client === fox ? fakes[k] : undefined) ?? fail
  }
  ;(svc.store as unknown as { putFormationResults(i: number, own: number, g: unknown[]): void }).putFormationResults(1, 101, [game('t:B', 300, '4-3-3', '4-4-2', 1, 1)])
  const plan = await (svc as unknown as { snapshot(i: number, plan: boolean): Promise<{ formationPool?: { matches: number } }> }).snapshot(0, true)
  assert.equal(plan.formationPool?.matches, 2, 'its own match and the other team\'s')
  const check = await (svc as unknown as { snapshot(i: number): Promise<{ formationPool?: unknown }> }).snapshot(0)
  assert.equal(check.formationPool, undefined, 'not on the checks before an action')
})

test('the prompt starts a test with the formation that does best in the pooled record', async () => {
  const { SYSTEM_PROMPT } = await import('../src/strategist/prompt.ts')
  assert.match(SYSTEM_PROMPT, /pooled formation record/)
  assert.match(SYSTEM_PROMPT, /test first the formation that does best in the pooled record against the formations your rivals play most/)
})

// ---- strength bands (owner, 2026-10-23): a formation is judged on matches at a like strength gap ----

test('each pairing splits its results by strength: more than 10 percent stronger, within 10 percent, more than 10 percent weaker', async () => {
  const { summariseFormations } = await import('../src/snapshot/formations.ts')
  const g = (gf: number, ga: number, edge: number | null) => ({ key: `k${Math.random()}`, at: new Date().toISOString(), mine: '4-4-2', theirs: '4-3-3', gf, ga, edge, rivalUserId: 1 })
  const [row] = summariseFormations([g(3, 0, 25), g(1, 1, 8), g(0, 2, -4), g(0, 1, -10), g(0, 3, -30), g(2, 2, null)]).rows as unknown as { bands: Record<string, [number, number, number]> }[]
  assert.deepEqual(row!.bands, { stronger: [1, 0, 0], even: [0, 1, 2], weaker: [0, 0, 1] }, 'a match whose strength is unknown is in no band')
})

test('the digest shows each pairing by strength band', () => {
  const s = snapshot() as ReturnType<typeof snapshot> & { formationRecord?: unknown }
  s.formationRecord = { matches: 12, unread: 0, rows: [{ mine: '4-4-2', theirs: '4-3-3', played: 12, won: 0, drawn: 2, lost: 10, goalsFor: 6, goalsAgainst: 25, edge: 2, bands: { stronger: [0, 0, 1], even: [0, 2, 9], weaker: [0, 0, 0] } }], field: [{ formation: '4-3-3', matches: 12 }] }
  assert.match(renderDigest(s), /4-4-2 vs 4-3-3: 12 played, W0 D2 L10, goals 6-25, strength edge \+2%; by strength: stronger W0 D0 L1, even W0 D2 L9\n/)
})

test('the next opponent\'s eleven is compared with yours on its Upcoming line', async () => {
  const lock = new Date(Date.now() + 2 * 3600_000).toISOString()
  const POS = ['GK', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'FWD', 'FWD', 'GK', 'DEF', 'DEF', 'MID', 'MID', 'FWD', 'FWD']
  const STATS = ['speed', 'accuracy', 'defense', 'power', 'control', 'vision', 'stamina']
  const card = (n: number, position: string, stat: number) => ({
    nft_nonce: n, name: `P${n}`, position, rarity: 'Common', condition: 100, stats_dirty: false, competitive_matches: 0, listed_for_sale: false,
    created_at: '2026-10-01T00:00:00Z', ...Object.fromEntries(STATS.flatMap(k => [[k, stat], [`${k}_synced`, stat], [`${k}_xp`, 0]])),
  })
  // A wallet no other test reads: rival strengths are kept for 20 minutes within the process.
  const { deps } = fakes({
    history: { [ADDR]: [], [STRANGER]: [row('R1', 900, 700, [2, 1])] },
    facts: { R1: { home: '4-3-3', away: '4-4-2', homeStrength: 1, awayStrength: 1 } },
    tournaments: { 7: { tournament: { id: 7 }, participants: [{ user_id: 100, wallet_address: ADDR, team_name: 'Agent' }, { user_id: 900, wallet_address: STRANGER, team_name: 'Rival FC' }] } },
    upcoming: [{ tournament_id: 7, tournament_title: 'Cup', round_label: 'Round 1', is_home: true, opponent_name: 'Rival FC', scheduled_at: lock, strategy_locks_at: lock, locked: false, phase: 'upcoming', home_score: null, away_score: null }],
    // Ours: 11 starters with every stat at 20 at full condition (1540); theirs: every stat at 22 (1694).
    players: async (a: string) => (a === ADDR ? POS.map((p, i) => card(i + 1, p, 20)) : POS.slice(0, 11).map((p, i) => card(9001 + i, p, 22))),
  })
  const s = await takeSnapshot(deps, { wallet: dryWallet }, new Date(), { matchFacts: cache() } as never)
  assert.match(renderDigest(s), /vs Rival FC .*\[their last formations, newest first: 4-3-3; their best eleven 1694 at full condition, yours 1540 today: you are 9% weaker\]/)
})

// Agent review of PR #17 (low, coverage): an own roster that cannot be read is unknown strength, never zero, so the
// line never says "you are 100% weaker".
test('the comparison with the coming rival is unknown when our own roster cannot be read', async () => {
  const lock = new Date(Date.now() + 2 * 3600_000).toISOString()
  const STATS = ['speed', 'accuracy', 'defense', 'power', 'control', 'vision', 'stamina']
  const rivalCard = (n: number) => ({ nft_nonce: n, ...Object.fromEntries(STATS.map(k => [`${k}_synced`, 22])) })
  const RIVAL = 'erd1lhyk6d3g02sr9v4wvqvqtvtnmsd6jdlkhx06jwafnwp3c9ejpqhs5vpc9e' // its own wallet: rival strengths are kept 20 minutes
  const { deps } = fakes({
    history: { [ADDR]: [], [RIVAL]: [] },
    facts: {},
    tournaments: { 8: { tournament: { id: 8 }, participants: [{ user_id: 100, wallet_address: ADDR, team_name: 'Agent' }, { user_id: 901, wallet_address: RIVAL, team_name: 'Other FC' }] } },
    upcoming: [{ tournament_id: 8, tournament_title: 'Cup', round_label: 'Round 1', is_home: true, opponent_name: 'Other FC', scheduled_at: lock, strategy_locks_at: lock, locked: false, phase: 'upcoming', home_score: null, away_score: null }],
    players: async (a: string) => {
      if (a === ADDR) throw new Error('HTTP 502')
      return Array.from({ length: 11 }, (_, i) => rivalCard(9101 + i))
    },
  })
  const d = renderDigest(await takeSnapshot(deps, { wallet: dryWallet }, new Date(), { matchFacts: cache() } as never))
  assert.match(d, /vs Other FC .*their strength: unknown\]/)
  assert.doesNotMatch(d, /100% weaker/)
})

test('the prompt judges a formation on matches at the strength gap of the coming one', async () => {
  const { SYSTEM_PROMPT } = await import('../src/strategist/prompt.ts')
  assert.match(SYSTEM_PROMPT, /the even band is the fair test of a formation/)
  assert.match(SYSTEM_PROMPT, /look at the band of the coming match/)
})
