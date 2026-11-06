// Owner, 2026-11-04: the casual test bench. FoxLeague plays a casual game against an AI it builds at the team's own
// OVR with a random formation: no ELO, XP or FOXSY, 5 condition for each player who takes the pitch (more after age 30)
// and one of the 5 daily starts. The agents test formations there, 1 to 3 a day (no cap of their own since 2026-11-06), only when every
// card that plays is back to full condition before the next match that counts, rotating through every formation the
// squad can field. The results go into their own pooled record, never into the formation record or the pooled one.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAction } from '../src/executor/actions.ts'
import { ApiRefusal } from '../src/foxleague/api.ts'
import { takeSnapshot } from '../src/snapshot/snapshot.ts'
import { renderDigest } from '../src/snapshot/digest.ts'
import { formationsToTest, type FormationRecord } from '../src/snapshot/formations.ts'
import { Store } from '../src/store/db.ts'
import { ADDR, card, dryWallet, liveWallet, setup, snapshot, withLive } from './fixtures.ts'

// The fixture's squad: 1 GK, 2-5 DEF, 6-9 MID, 10-11 FWD; bench 12 GK, 13-14 DEF, 15-16 MID, 17-18 FWD.
const XI_523 = [1, 2, 3, 4, 5, 13, 6, 7, 10, 11, 17]
const BENCH_523 = [12, 14, 8, 9, 15, 16, 18]
const TEST = { formation: '5-2-3', lineup: XI_523, substitutes: BENCH_523 }
const casual = (t: unknown = TEST) => ({ type: 'play_match' as const, match_type: 'casual' as const, test: t as typeof TEST })
const HOUR = 3600_000
const at = (h: number) => new Date(Date.now() + h * HOUR).toISOString()

/** A tournament match of ours whose strategy lock is `h` hours away (kickoff 30 minutes later). */
function withLock(s: ReturnType<typeof snapshot>, h: number) {
  s.auth!.upcoming!.matches = [{ tournament_id: 9, tournament_title: 'Cup', round_label: 'Round 1', is_home: true, opponent_name: 'Rival FC', scheduled_at: at(h + 0.5), strategy_locks_at: at(h), locked: false, phase: 'upcoming', home_score: null, away_score: null }] as never
  return s
}

async function verdict(s: ReturnType<typeof snapshot>, a: unknown = casual()) {
  const { exec, agent } = setup()
  const [r] = await exec.run(agent(), dryWallet, s, [{ action: a as never, reason: '' }])
  return r!
}

test('CB1: a casual game may carry a test formation with its eleven and bench; a ranked one may not', () => {
  assert.deepEqual(parseAction(casual()), casual())
  assert.deepEqual(parseAction({ type: 'play_match', match_type: 'ranked' }), { type: 'play_match', match_type: 'ranked' }, 'no test key without one')
  assert.throws(() => parseAction({ type: 'play_match', match_type: 'ranked', test: TEST }), /test.*casual/)
  assert.throws(() => parseAction(casual({ ...TEST, formation: '4-4-2a' })), /formation/)
  assert.throws(() => parseAction(casual({ ...TEST, lineup: XI_523.slice(0, 10) })), /lineup/)
})

test('CB2: a casual test runs only when every card that plays is back to full condition before the next match that counts', async () => {
  const soon = await verdict(withLock(snapshot(), 2))
  assert.equal(soon.status, 'refused', soon.summary)
  assert.match(soon.summary, /back to full condition/)
  assert.match(soon.summary, /T9/)
  const later = await verdict(withLock(snapshot(), 3))
  assert.equal(later.status, 'dry_run', later.summary)
  const free = await verdict(snapshot())
  assert.equal(free.status, 'dry_run', 'no match that counts ahead: free')
})

test('CB3: a tired card or an old one recovers slower, and the test waits for it', async () => {
  const tired = snapshot()
  tired.players.find(p => p.nonce === 17)!.condition = 90
  const r1 = await verdict(withLock(tired, 6))
  assert.equal(r1.status, 'refused', '90 - 5 + 12 = 97 at the lock')
  assert.match(r1.summary, /#17/)
  const old = snapshot()
  old.players[16] = card(17, 'FWD', 'bench', { ageYears: 39 })
  assert.equal((await verdict(withLock(old, 10))).status, 'refused', 'age 39: 15 condition, 1 a hour back')
  assert.equal((await verdict(withLock(snapshot([]), 10))).status, 'dry_run')
  const old2 = snapshot()
  old2.players[16] = card(17, 'FWD', 'bench', { ageYears: 39 })
  assert.equal((await verdict(withLock(old2, 16))).status, 'dry_run')
})

test('CB4: no casual test while a 1v1 of ours waits for an opponent: it can be accepted and played at any time', async () => {
  const s = snapshot()
  s.auth!.myTournaments!.active = [{ id: 55, max_teams: 2, status: 'open', format: 'knockout', starts_at: at(4), tier: 'silver' }] as never
  const r = await verdict(s)
  assert.equal(r.status, 'refused', r.summary)
  assert.match(r.summary, /T55/)
  assert.match(r.summary, /accepted at any time/)
})

// CB5 (at most 4 casual games a game day) went on 2026-11-06 (OP-7 in test/open-play.test.ts): casual and ranked
// share FoxLeague's 5 daily starts.

test('CB6: a calendar that cannot be read is no free time', async () => {
  const s = snapshot()
  s.auth!.myTournaments = null as never
  const r = await verdict(s)
  assert.equal(r.status, 'refused')
  assert.match(r.summary, /could not be read/)
})

test('CB7: the test eleven must fit the test formation', async () => {
  const s = snapshot()
  const r = await verdict(s, casual({ formation: '5-2-3', lineup: s.team!.lineup, substitutes: s.team!.substitutes }))
  assert.equal(r.status, 'refused')
  assert.match(r.summary, /slot 5 of 5-2-3 wants a DEF/)
})

const recorder = (calls: string[], over: Record<string, unknown> = {}) => ({
  setLineup: async (_w: unknown, _l: number[], _s: number[], f?: string) => { calls.push(`lineup ${f}`) },
  setFormation: async (_w: unknown, f: string) => { calls.push(`formation ${f}`) },
  playMatch: async (_w: unknown, type: string) => { calls.push(`play ${type}`); return { match_id: 77 } },
  ...over,
})

test('CB8: the test formation is saved, the game starts and the proven formation is put back at once', async () => {
  const calls: string[] = []
  const m = setup({ fox: recorder(calls) })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, snapshot(), [{ action: casual(), reason: '' }])
    assert.equal(r!.status, 'confirmed', r!.summary)
    assert.match(r!.summary, /match #77 started \(casual\)/)
    assert.match(r!.summary, /4-4-2 put back/)
  })
  assert.deepEqual(calls, ['lineup 5-2-3', 'play casual', 'lineup 4-4-2'])
})

test('CB9: a start FoxLeague refuses puts the proven formation back too', async () => {
  const calls: string[] = []
  const m = setup({ fox: recorder(calls, { playMatch: async () => { calls.push('play casual'); throw new ApiRefusal('Daily match limit reached') } }) })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, snapshot(), [{ action: casual(), reason: '' }])
    assert.notEqual(r!.status, 'confirmed', r!.summary)
  })
  assert.deepEqual(calls, ['lineup 5-2-3', 'play casual', 'lineup 4-4-2'])
})

test('CB10: a put-back that fails twice is an error that names the formation still saved and the one to put back', async () => {
  const calls: string[] = []
  const m = setup({
    fox: recorder(calls, {
      setLineup: async (_w: unknown, _l: number[], _s: number[], f?: string) => { calls.push(`lineup ${f}`); if (f === '4-4-2') throw new Error('HTTP 502') },
      team: async () => ({ ...snapshot().team!, formation: '5-2-3', lineup: XI_523, substitutes: BENCH_523 }),
    }),
  })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, snapshot(), [{ action: casual(), reason: '' }])
    assert.equal(r!.status, 'error', r!.summary)
    assert.match(r!.summary, /5-2-3 may still be saved/)
    assert.match(r!.summary, /put back 4-4-2/)
  })
  assert.deepEqual(calls, ['lineup 5-2-3', 'play casual', 'lineup 4-4-2', 'lineup 4-4-2'])
})

test('CB11: a test of the formation and eleven already saved needs no save', async () => {
  const calls: string[] = []
  const m = setup({ fox: recorder(calls) })
  const s = snapshot()
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, s, [{ action: casual({ formation: '4-4-2', lineup: s.team!.lineup, substitutes: s.team!.substitutes }), reason: '' }])
    assert.equal(r!.status, 'confirmed', r!.summary)
  })
  assert.deepEqual(calls, ['play casual'])
})

test('CB12: in a dry run nothing is saved or started, and the log names the test', async () => {
  const calls: string[] = []
  const m = setup({ fox: recorder(calls) })
  const [r] = await m.exec.run(m.agent(), dryWallet, snapshot(), [{ action: casual(), reason: '' }])
  assert.equal(r!.status, 'dry_run', r!.summary)
  assert.match(r!.summary, /play casual match \(test 5-2-3/)
  assert.deepEqual(calls, [])
})

// ---- the records ----

type Row = Record<string, unknown>
const row = (key: string, home: number, away: number | null, score: [number, number], more: Row = {}): Row => ({
  id: Number(key), tournament_match_id: null, home_user_id: home, away_user_id: away, home_team_name: 'Agent', away_team_name: 'AI',
  home_score: score[0], away_score: score[1], match_type: 'ranked', status: 'finished', finished_at: new Date(Date.now() - HOUR).toISOString(),
  home_elo_at_match: 1200, away_elo_at_match: 1200, tournament_id: null, ...more,
})

function fakes(history: Row[], facts: Record<string, unknown>) {
  const fox: Record<string, unknown> = {
    config: async () => snapshot().config, user: async (a: string) => (a === ADDR ? snapshot().profile : null), team: async () => snapshot().team,
    players: async () => [], tournaments: async () => [], leaderboard: async () => ({ users: [], total: 0, limit: 200, offset: 0 }), listings: async () => [],
    floorPrices: async () => [], shopStatus: async () => snapshot().auth!.shop, dailyAllowance: async () => snapshot().auth!.allowance, activeMatch: async () => null,
    myTournaments: async () => ({ active: [], completed: [] }), upcomingMatches: async () => ({ lead_minutes: 30, my_team_name: 'Agent', matches: [] }), challengesForMe: async () => [],
    matchHistory: async (a: string) => (a === ADDR ? history : []),
    matchFormations: async (m: Row) => facts[String(m.id)] ?? null,
  }
  const chain = { account: async () => ({ balance: 0n, nonce: 1 }), esdts: async () => [], egldUsd: async () => 25, query: async () => { throw new Error('no pool') } }
  return { chain, fox } as never
}
const cache = () => { const m = new Map<string, unknown>(); return { get: (k: string) => m.get(k) as never, put: (k: string, v: unknown) => void m.set(k, v) } }

test('CB13: a casual game goes to the test bench, not the formation record; a ranked game the AI filled goes to neither', async () => {
  const deps = fakes(
    [row('31', 100, null, [2, 1], { match_type: 'casual' }), row('32', 100, null, [1, 1]), row('33', 100, 200, [0, 1])],
    { 31: { home: '5-2-3', away: '4-3-3w', homeStrength: 1500, awayStrength: 1480 }, 32: { home: '4-4-2', away: '4-4-2', homeStrength: 1, awayStrength: 1 }, 33: { home: '4-4-2', away: '4-3-3', homeStrength: 1500, awayStrength: 1500 } },
  )
  const s = await takeSnapshot(deps, { wallet: dryWallet }, new Date(), { matchFacts: cache() } as never)
  const r = s.formationRecord as FormationRecord
  assert.equal(r.matches, 1, 'm:33 only')
  assert.deepEqual(r.casual?.map(g => [g.key, g.mine, g.theirs, g.gf, g.ga]), [['m:31', '5-2-3', '4-3-3w', 2, 1]])
})

test('CB14: the test bench pools the casual games of every team the install runs over 40 days, by formation', () => {
  const store = new Store('', ':memory:')
  // A minute ago: no game from before FoxLeague's AI played at its full strength counts (R85-3).
  const g = (key: string, mine: string, gf: number, ga: number, ago = 60_000) => ({ key, at: new Date(Date.now() - ago).toISOString(), mine, theirs: '4-4-2', gf, ga, edge: 1, rivalUserId: null })
  store.putCasualResults(0, [g('m:1', '4-3-3', 2, 1), g('m:2', '4-3-3', 0, 1)])
  store.putCasualResults(1, [g('m:3', '5-2-3', 1, 1), g('m:4', '5-3-2', 3, 0, 45 * 86_400_000)])
  store.putCasualResults(0, [g('m:1', '4-3-3', 2, 1)])
  const bench = store.casualBench()
  assert.equal(bench.matches, 3)
  assert.deepEqual(bench.rows.map(r => [r.mine, r.theirs, r.played, r.won, r.drawn, r.lost]), [['4-3-3', 'AI', 2, 1, 0, 1], ['5-2-3', 'AI', 1, 0, 1, 0]])
})

test('CB15: the rotation names the formations the squad can field, fewest tests first', () => {
  const players = snapshot().players
  const bench = { matches: 3, unread: 0, rows: [{ mine: '4-3-3', played: 2 }, { mine: '5-2-3', played: 1 }], field: [] } as unknown as FormationRecord
  assert.deepEqual(formationsToTest(players, bench).map(f => `${f.formation} ${f.tests}`), ['4-4-2 0', '4-4-2o 0', '4-3-3w 0', '4-3-3b 0', '5-3-2 0', '4-2-3-1 0', '5-2-3 1', '4-3-3 2'])
  const oneForward = players.filter(p => p.position !== 'FWD').concat(card(30, 'FWD', 'reserve'))
  assert.deepEqual(formationsToTest(oneForward, bench).map(f => f.formation), ['4-2-3-1'])
  assert.deepEqual(formationsToTest(players.map(p => (p.position === 'FWD' && p.nonce !== 10 ? { ...p, listed: true } : p)), bench).map(f => f.formation), ['4-2-3-1'], 'a listed card cannot play')
})

test('CB16: the plan sees the bench, the next formations to test, today\'s count and whether a casual game is free now', () => {
  const s = withLock(snapshot(), 2) as ReturnType<typeof snapshot> & { casualBench?: FormationRecord; casualToday?: number }
  s.casualBench = { matches: 3, unread: 0, rows: [{ mine: '4-3-3', theirs: 'AI', played: 2, won: 1, drawn: 0, lost: 1, goalsFor: 2, goalsAgainst: 2, edge: 1, bands: { stronger: [0, 0, 0], even: [1, 0, 1], weaker: [0, 0, 0] } }], field: [] }
  s.casualToday = 1
  const d = renderDigest(s)
  assert.match(d, /Casual test bench \(the casual games of every team your owner runs here in the last 40 days, against FoxLeague's AI built at the team's own OVR with a random formation; no ELO, XP or FOXSY\):/)
  assert.match(d, /\n {2}4-3-3 vs AI: 2 played, W1 D0 L1/)
  assert.match(d, /Next formations to test \(fewest casual tests first, ones your squad can field\): 4-4-2 0, 4-4-2o 0, 4-3-3w 0/)
  assert.match(d, /Casual games today: 1 \(casual and ranked share FoxLeague's daily starts\)/)
  assert.match(d, /Casual game now: not free: .*back to full condition/)
  const free = snapshot() as ReturnType<typeof snapshot> & { casualBench?: FormationRecord; casualToday?: number }
  free.casualBench = { matches: 0, unread: 0, rows: [], field: [] }
  free.casualToday = 0
  assert.match(renderDigest(free), /Casual game now: free for your saved eleven and bench/)
})

test('CB17: the prompt runs the bench: 1 to 3 tests a day, the rotation, the action and how to judge a formation', async () => {
  const { SYSTEM_PROMPT } = await import('../src/strategist/prompt.ts')
  assert.match(SYSTEM_PROMPT, /Casual test bench/)
  assert.match(SYSTEM_PROMPT, /1 to 3 casual tests a day/)
  assert.match(SYSTEM_PROMPT, /the formation the snapshot names first/)
  assert.match(SYSTEM_PROMPT, /\{"type":"play_match","match_type":"casual","test":\{"formation":"[^"]+","lineup":\[11 nonces in its slot order\],"substitutes":\[up to 7 nonces\]\}\}/)
  assert.match(SYSTEM_PROMPT, /the bench is the even test, the league table the real field/)
})

test('CB18: a planning snapshot keeps its casual games for the bench and carries the bench and today\'s count', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { Mnemonic } = await import('@multiversx/sdk-core')
  const { Service } = await import('../src/service.ts')
  const svc = new Service({ mnemonic: Mnemonic.generate().toString(), dataDir: mkdtempSync(join(tmpdir(), 'foxagent-')), gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9', gatewayRps: 5, apiRps: 1, foxleagueRps: 5, isServer: false, defaultDryRun: true, maxAgents: 3 } as never)
  svc.ensureAgents()
  ;(svc as unknown as { schedule: unknown }).schedule = () => undefined
  const fail = async () => { throw new Error('offline') }
  const fakeFox: Record<string, unknown> = {
    user: async () => snapshot().profile,
    team: async () => snapshot().team,
    players: async () => [],
    matchHistory: async () => [row('41', 100, null, [3, 1], { match_type: 'casual', finished_at: new Date(Date.now() - 60_000).toISOString() })],
    matchFormations: async () => ({ home: '4-2-3-1', away: '5-3-2', homeStrength: 1500, awayStrength: 1500 }),
  }
  const fox = svc.fox as unknown as Record<string, unknown>
  for (const client of [svc.chain, svc.fox] as unknown as Record<string, unknown>[]) {
    for (const k of Object.getOwnPropertyNames(Object.getPrototypeOf(client))) if (k !== 'constructor' && typeof client[k] === 'function') client[k] = (client === fox ? fakeFox[k] : undefined) ?? fail
  }
  svc.store.log({ agentIndex: 0, kind: 'play_match', status: 'dry_run', summary: 'DRY RUN play casual match (test 4-2-3-1): match #41 started (casual)' })
  const planned = await (svc as unknown as { snapshot(i: number, plan: boolean): Promise<{ casualBench?: FormationRecord; casualToday?: number; formationPool?: FormationRecord }> }).snapshot(0, true)
  assert.equal(planned.casualBench?.matches, 1)
  assert.equal(planned.casualToday, 1)
  assert.equal(planned.formationPool?.matches, 0, 'not in the pooled record')
})

// Agent review of PR #49 (medium): a save of the test that failed without FoxLeague's refusal, followed by a put-back
// that failed twice, dropped the put-back's message: the log said only the first error, not what the next plan must do.
test('R49A-1: a failed save of the test followed by a failed put-back still says what to put back', async () => {
  const calls: string[] = []
  const m = setup({
    fox: recorder(calls, {
      setLineup: async (_w: unknown, _l: number[], _s: number[], f?: string) => { calls.push(`lineup ${f}`); throw new Error('HTTP 502') },
      team: async () => { throw new Error('HTTP 502') },
    }),
  })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, snapshot(), [{ action: casual(), reason: '' }])
    assert.equal(r!.status, 'error', r!.summary)
    assert.match(r!.summary, /5-2-3 may still be saved/)
    assert.match(r!.summary, /put back 4-4-2 with set_formation/)
  })
  assert.deepEqual(calls, ['lineup 5-2-3', 'lineup 4-4-2', 'lineup 4-4-2'], 'no game started')
})

// Agent review of PR #49 (low): the check for starters at condition 0 read the saved eleven, so a test eleven with an
// exhausted card was saved before FoxLeague refused the start.
test('R49A-2: a test eleven with a starter at condition 0 is refused before anything is saved', async () => {
  const s = snapshot()
  s.players.find(p => p.nonce === 13)!.condition = 0
  const r = await verdict(s)
  assert.equal(r.status, 'refused', r.summary)
  assert.match(r.summary, /starters at condition 0: #13/)
})
