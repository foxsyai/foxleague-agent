// Owner, 2026-11-04: every agent had moved to 4-3-3b from its own record and the pooled one, but none had ever played
// plain 4-3-3 or 4-3-3w, so nothing told the plan what those do. FoxLeague's public match history and statistics show
// what every team played. The league formation table counts the public matches of the top 100 teams by ELO, by
// formation pair, by strength band and as the ELO underdog, so the plan learns from the whole league and not only from
// what its owner's teams happened to try.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { takeSnapshot } from '../src/snapshot/snapshot.ts'
import { renderDigest } from '../src/snapshot/digest.ts'
import { leagueTable, summariseFormations, type LeagueMatch, type LeagueTable } from '../src/snapshot/formations.ts'
import { Store } from '../src/store/db.ts'
import { ADDR, dryWallet, snapshot } from './fixtures.ts'

type Row = Record<string, unknown>
const HOUR = 3600_000
// Finished `hoursAgo` hours ago (1 by default); a key of digits is a ranked match, any other a tournament match.
const row = (key: string, home: number | null, away: number | null, score: [number, number] | null, more: Row = {}, hoursAgo = 1): Row => ({
  id: /^\d+$/.test(key) ? Number(key) : null, tournament_match_id: /^\d+$/.test(key) ? null : key,
  home_user_id: home, away_user_id: away, home_team_name: `T${home}`, away_team_name: `T${away}`,
  home_score: score?.[0] ?? null, away_score: score?.[1] ?? null, match_type: /^\d+$/.test(key) ? 'ranked' : 'tournament',
  status: score ? 'finished' : 'scheduled', finished_at: score ? new Date(Date.now() - hoursAgo * HOUR).toISOString() : null,
  home_elo_at_match: 1400, away_elo_at_match: 1400, tournament_id: null, ...more,
})
const facts = (home: string, away: string, homeStrength = 1500, awayStrength = 1500) => ({ home, away, homeStrength, awayStrength })
const user = (id: number, wallet: string, elo = 1500) => ({ id, wallet_address: wallet, elo_rating: elo, team_name: `T${id}`, league: 'Silver', matches_won: 0, matches_lost: 0, matches_drawn: 0 })

function fakes(o: { users: Row[]; history: Record<string, Row[] | Error>; facts: Record<string, unknown> }) {
  const reads: string[] = []
  const histories: string[] = []
  const fox: Record<string, unknown> = {
    config: async () => snapshot().config,
    user: async (a: string) => (a === ADDR ? snapshot().profile : null),
    team: async () => snapshot().team,
    players: async () => [],
    tournaments: async () => [],
    leaderboard: async () => ({ users: o.users, total: o.users.length, limit: 200, offset: 0 }),
    listings: async () => [],
    floorPrices: async () => [],
    shopStatus: async () => snapshot().auth!.shop,
    dailyAllowance: async () => snapshot().auth!.allowance,
    activeMatch: async () => null,
    myTournaments: async () => ({ active: [], completed: [] }),
    upcomingMatches: async () => ({ lead_minutes: 30, my_team_name: 'Agent', matches: [] }),
    challengesForMe: async () => [],
    matchHistory: async (a: string) => {
      if (a !== ADDR) histories.push(a)
      const h = o.history[a] ?? []
      if (h instanceof Error) throw h
      return h
    },
    matchFormations: async (m: Row) => {
      const key = String(m.tournament_match_id ?? m.id)
      reads.push(key)
      const f = o.facts[key]
      if (f instanceof Error) throw f
      return f ?? null
    },
  }
  const chain = { account: async () => ({ balance: 0n, nonce: 1 }), esdts: async () => [], egldUsd: async () => 25, query: async () => { throw new Error('no pool in this test') } }
  return { deps: { chain, fox } as never, reads, histories }
}

function cache() {
  const m = new Map<string, unknown>()
  return { get: (k: string) => m.get(k) as never, put: (k: string, v: unknown) => void m.set(k, v) }
}

const plan = (deps: never, store: Store, facts = cache()) => takeSnapshot(deps, { wallet: dryWallet }, new Date(), { matchFacts: facts, league: store.leagueCache() } as never)
const rowsOf = (t: LeagueTable) => t.rows.map(r => `${r.mine} vs ${r.theirs} ${r.played} W${r.won} D${r.drawn} L${r.lost}`)

test('LF1: the league table counts the matches of the top teams from both sides, without AI, casual, own teams or same-formation rows', async () => {
  const store = new Store('', ':memory:')
  store.setKv('agent_user_id:2', '101') // another team the owner runs here
  const { deps } = fakes({
    users: [user(100, ADDR), user(201, 'wA'), user(202, 'wB'), user(101, 'wOwn')],
    history: {
      wA: [
        row('1', 201, 300, [2, 1]),
        row('2', 201, null, [3, 0], { match_type: 'ranked' }), // the AI stood in
        row('3', 201, null, [1, 0], { match_type: 'casual' }),
        row('4', 201, 101, [0, 1]), // against one of the owner's teams
        row('5', 100, 201, [1, 1]), // against this agent itself
        row('TA', 201, 202, [1, 1]),
        row('TB', 201, 300, null), // not played yet
      ],
      wB: [row('TA', 201, 202, [1, 1]), row('6', 202, 400, [0, 2]), row('7', 202, 400, [1, 0], {}, 20 * 24)],
      wOwn: [row('8', 101, 500, [5, 0])],
    },
    facts: { 1: facts('4-3-3', '4-3-3b'), 2: facts('4-3-3', '4-4-2'), 3: facts('4-3-3', '4-4-2'), 4: facts('4-3-3', '4-4-2'), 5: facts('4-3-3', '4-4-2'), TA: facts('4-3-3', '4-3-3'), 6: facts('4-4-2', '4-3-3'), 7: facts('4-4-2', '4-3-3'), 8: facts('4-4-2', '4-3-3') },
  })
  await plan(deps, store)
  const t = store.leagueFormations()
  assert.equal(t.matches, 3, 'm:1, t:TA (read from both teams, kept once) and m:6; m:7 is older than 14 days')
  assert.equal(t.teams, 4)
  assert.deepEqual(rowsOf(t).sort(), ['4-3-3 vs 4-3-3b 1 W1 D0 L0', '4-3-3 vs 4-4-2 1 W1 D0 L0', '4-3-3b vs 4-3-3 1 W0 D0 L1', '4-4-2 vs 4-3-3 1 W0 D0 L1'])
  assert.deepEqual(t.field, [{ formation: '4-3-3', matches: 4 }, { formation: '4-3-3b', matches: 1 }, { formation: '4-4-2', matches: 1 }], 'each side of each match once, the same-formation match too')
})

test('LF2: each plan reads up to 3 team histories and at most 6 new matches, newest first, and the next plan moves on to the next teams', async () => {
  const store = new Store('', ':memory:')
  const teams = [1, 2, 3, 4, 5].map(i => user(200 + i, `w${i}`))
  const history: Record<string, Row[]> = {}
  const all: Record<string, unknown> = {}
  for (const i of [1, 2, 3, 4, 5]) {
    history[`w${i}`] = [0, 1].map(j => row(String(i * 10 + j), 200 + i, 300 + j, [1, 0], {}, 1 + j))
    for (const j of [0, 1]) all[String(i * 10 + j)] = facts('4-3-3', '4-4-2')
  }
  const one = fakes({ users: teams, history, facts: all })
  await plan(one.deps, store)
  assert.deepEqual(one.histories, ['w1', 'w2', 'w3'])
  assert.deepEqual(one.reads, ['10', '11', '20', '21', '30', '31'])
  const two = fakes({ users: teams, history, facts: all })
  await plan(two.deps, store)
  assert.deepEqual(two.histories, ['w4', 'w5', 'w1'])
  assert.deepEqual(two.reads, ['40', '41', '50', '51'], 'the kept matches of w1 are not read again')
  assert.equal(store.leagueFormations().matches, 10)
})

test('LF3: a ranked match read more than 6 hours after its end counts its result but no strength; a tournament match keeps its kickoff strengths', async () => {
  const store = new Store('', ':memory:')
  const { deps } = fakes({
    users: [user(201, 'wA')],
    history: { wA: [row('1', 201, 300, [2, 0], {}, 8), row('TA', 201, 300, [0, 1], {}, 8)] },
    facts: { 1: facts('4-3-3', '4-4-2', 1800, 1500), TA: facts('4-3-3', '4-4-2', 1300, 1500) },
  })
  await plan(deps, store)
  const t = store.leagueFormations()
  assert.equal(t.matches, 2)
  assert.equal(t.withStrength, 1, 'only the tournament match')
  const r = t.rows.find(x => x.mine === '4-3-3')!
  assert.deepEqual(r.bands, { stronger: [0, 0, 0], even: [0, 0, 0], weaker: [0, 0, 1] }, 'the ranked win is in no band')
})

test('LF4: a failed history or statistics read is skipped and read again later, never kept as anything', async () => {
  const store = new Store('', ':memory:')
  const users = [user(201, 'wA'), user(202, 'wB')]
  const f: Record<string, unknown> = { 41: new Error('HTTP 502'), 42: facts('4-3-3', '4-4-2') }
  const history = { wA: [] as Row[], wB: [row('41', 202, 300, [1, 0]), row('42', 202, 301, [0, 0])] }
  const one = fakes({ users, history: { ...history, wA: new Error('HTTP 500') }, facts: f })
  await plan(one.deps, store)
  assert.equal(store.leagueFormations().matches, 1, 'm:42 only')
  f[41] = facts('4-3-3b', '4-4-2')
  const soon = fakes({ users, history, facts: f })
  await plan(soon.deps, store)
  assert.deepEqual(soon.reads, [], 'tried again 6 hours later at the earliest (R48A-1)')
  const later = fakes({ users, history, facts: f })
  await takeSnapshot(later.deps, { wallet: dryWallet }, new Date(Date.now() + 7 * HOUR), { matchFacts: cache(), league: store.leagueCache() } as never)
  assert.deepEqual(later.reads, ['41'])
  assert.equal(store.leagueFormations().matches, 2)
})

test('LF5: each pairing also counts its results as the ELO underdog (rated more than 100 below the rival at kickoff)', () => {
  const g = (gf: number, ga: number, eloGap: number | null) => ({ key: `k${Math.random()}`, at: new Date().toISOString(), mine: '4-3-3', theirs: '4-3-3b', gf, ga, edge: null, rivalUserId: 1, eloGap })
  const [r] = summariseFormations([g(1, 0, -150), g(0, 2, -101), g(1, 1, -100), g(2, 0, 50), g(0, 0, null)]).rows
  assert.deepEqual(r!.underdog, [1, 0, 1])
  const [own] = summariseFormations([{ key: 'k', at: '', mine: '4-3-3', theirs: '4-4-2', gf: 1, ga: 0, edge: null, rivalUserId: 1 }]).rows
  assert.equal(own!.underdog, undefined, 'a record without ELO has no underdog count')
  const m = (homeElo: number | null, awayElo: number | null): LeagueMatch => ({ key: `m:${Math.random()}`, at: new Date().toISOString(), kind: 'ranked', homeUserId: 1, awayUserId: 2, home: '4-3-3', away: '4-3-3b', homeScore: 2, awayScore: 1, homeStrength: null, awayStrength: null, homeElo, awayElo })
  const t = leagueTable([m(1300, 1450), m(null, 1450)], new Set())
  assert.deepEqual(t.rows.find(r => r.mine === '4-3-3')!.underdog, [1, 0, 0], 'the home side was 150 below and won; an unknown ELO is no gap')
  assert.deepEqual(t.rows.find(r => r.mine === '4-3-3b')!.underdog, [0, 0, 0])
})

test('LF6: the store keeps a match once, prunes after 30 days, counts 14 days and leaves out a team of the owner learned later', () => {
  const store = new Store('', ':memory:')
  const m = (key: string, days: number, home = 1, away = 2): LeagueMatch => ({ key, at: new Date(Date.now() - days * 86_400_000).toISOString(), kind: 'ranked', homeUserId: home, awayUserId: away, home: '4-3-3', away: '4-4-2', homeScore: 1, awayScore: 0, homeStrength: null, awayStrength: null, homeElo: null, awayElo: null })
  store.putLeagueMatch(m('m:1', 1))
  store.putLeagueMatch(m('m:1', 1))
  store.putLeagueMatch(m('m:2', 20))
  store.putLeagueMatch(m('m:3', 1, 3, 4))
  assert.equal(store.hasLeagueMatch('m:2'), true, 'kept 30 days')
  assert.equal(store.leagueFormations().matches, 2, 'm:1 and m:3; m:2 is older than 14 days')
  store.putLeagueMatch(m('m:4', 31))
  assert.equal(store.hasLeagueMatch('m:4'), false, 'pruned')
  store.setKv('agent_user_id:5', '3')
  assert.equal(store.leagueFormations().matches, 1, 'm:3 was against a team the owner runs')
})

test('LF7: the plan sees the league table, pairings of fewer than 8 matches left out', () => {
  const s = snapshot() as ReturnType<typeof snapshot> & { leagueFormations?: LeagueTable }
  const bands = { stronger: [0, 0, 0] as [number, number, number], even: [10, 4, 6] as [number, number, number], weaker: [2, 1, 5] as [number, number, number] }
  s.leagueFormations = {
    matches: 640, teams: 92, withStrength: 410,
    rows: [
      { mine: '4-3-3', theirs: '4-3-3b', played: 40, won: 18, drawn: 8, lost: 14, goalsFor: 60, goalsAgainst: 50, edge: 1, bands, underdog: [3, 1, 4] },
      { mine: '5-2-3', theirs: '4-3-3b', played: 7, won: 5, drawn: 0, lost: 2, goalsFor: 12, goalsAgainst: 6, edge: 0, bands, underdog: [0, 0, 0] },
    ],
    field: [{ formation: '4-3-3b', matches: 700 }, { formation: '4-3-3', matches: 420 }],
  }
  const d = renderDigest(s)
  assert.match(d, /League formation table \(the public matches of the top 100 teams by ELO in the last 14 days, your owner's teams left out, names not shown: 640 matches between 92 teams, 410 with both strengths known; each match counted from both sides, same-formation matches left out, pairings of fewer than 8 matches not shown; underdog = rated more than 100 ELO below the rival at kickoff\):/)
  assert.match(d, /\n {2}4-3-3 vs 4-3-3b: 40 played, W18 D8 L14, goals 60-50, strength edge \+1%; by strength: even W10 D4 L6, weaker W2 D1 L5; as the ELO underdog: W3 D1 L4\n/)
  assert.doesNotMatch(d, /5-2-3 vs 4-3-3b/)
  assert.match(d, /Formations the league played \(each side of each match once\): 4-3-3b 700, 4-3-3 420/)
  s.leagueFormations = { matches: 0, teams: 0, withStrength: 0, rows: [], field: [] }
  assert.doesNotMatch(renderDigest(s), /League formation table/)
})

test('LF8: a planning snapshot collects league matches and carries the table; the checks before an action read nothing', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { Mnemonic } = await import('@multiversx/sdk-core')
  const { Service } = await import('../src/service.ts')
  const svc = new Service({ mnemonic: Mnemonic.generate().toString(), dataDir: mkdtempSync(join(tmpdir(), 'foxagent-')), gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9', gatewayRps: 5, apiRps: 1, foxleagueRps: 5, isServer: false, defaultDryRun: true, maxAgents: 3 } as never)
  svc.ensureAgents()
  ;(svc as unknown as { schedule: unknown }).schedule = () => undefined
  const fail = async () => { throw new Error('offline') }
  let histories = 0
  const fakeFox: Record<string, unknown> = {
    user: async () => snapshot().profile,
    team: async () => snapshot().team,
    players: async () => [],
    leaderboard: async () => ({ users: [user(201, 'wA')], total: 1, limit: 200, offset: 0 }),
    matchHistory: async (a: string) => {
      if (a !== 'wA') return []
      histories++
      return [row('11', 201, 300, [2, 0])]
    },
    matchFormations: async () => facts('4-3-3', '4-3-3b'),
  }
  const fox = svc.fox as unknown as Record<string, unknown>
  for (const client of [svc.chain, svc.fox] as unknown as Record<string, unknown>[]) {
    for (const k of Object.getOwnPropertyNames(Object.getPrototypeOf(client))) if (k !== 'constructor' && typeof client[k] === 'function') client[k] = (client === fox ? fakeFox[k] : undefined) ?? fail
  }
  const planned = await (svc as unknown as { snapshot(i: number, plan: boolean): Promise<{ leagueFormations?: LeagueTable }> }).snapshot(0, true)
  assert.equal(planned.leagueFormations?.matches, 1)
  const check = await (svc as unknown as { snapshot(i: number): Promise<{ leagueFormations?: unknown }> }).snapshot(0)
  assert.equal(check.leagueFormations, undefined)
  assert.equal(histories, 1, 'the check before an action read no history')
})

test('LF9: the prompt tells the plan to weigh the league table, and to look at its weaker band and underdog results against a stronger rival', async () => {
  const { SYSTEM_PROMPT } = await import('../src/strategist/prompt.ts')
  assert.match(SYSTEM_PROMPT, /The league formation table adds the public matches of the top teams by ELO/)
  assert.match(SYSTEM_PROMPT, /against a stronger rival look at its weaker band and its underdog results/)
})

// Agent review of PR #48 (low): the turn moved on by 3 teams even when this plan's reads ran out inside the first one,
// so the teams after it waited a whole round of the top 100 and their history reads were spent for nothing.
test('R48A-1: a plan whose reads run out stays on the team it could not finish and reads no further history', async () => {
  const store = new Store('', ':memory:')
  const teams = [1, 2, 3, 4].map(i => user(600 + i, `x${i}`))
  const history: Record<string, Row[]> = { x1: Array.from({ length: 8 }, (_, j) => row(String(6100 + j), 601, 700 + j, [1, 0], {}, 1 + j)) }
  for (const i of [2, 3, 4]) history[`x${i}`] = [0, 1].map(j => row(String(6000 + i * 10 + j), 600 + i, 700 + j, [0, 1], {}, 1 + j))
  const all = Object.fromEntries(Object.values(history).flat().map(m => [String(m.id), facts('4-3-3', '4-4-2')]))
  const one = fakes({ users: teams, history, facts: all })
  await plan(one.deps, store)
  assert.deepEqual(one.histories, ['x1'], 'no history read once the reads are spent')
  assert.equal(one.reads.length, 6)
  assert.equal(store.leagueCursor, 0, 'x1 is not finished')
  const two = fakes({ users: teams, history, facts: all })
  await plan(two.deps, store)
  assert.deepEqual(two.histories, ['x1', 'x2', 'x3'])
  assert.deepEqual(two.reads, ['6106', '6107', '6020', '6021', '6030', '6031'])
  assert.equal(store.leagueCursor, 3, 'x4 is next')
})

test('R48A-1: a match whose statistics never answer is tried again after 6 hours at the earliest, so it never holds the turn', async () => {
  const store = new Store('', ':memory:')
  const teams = [1, 2].map(i => user(800 + i, `y${i}`))
  const history: Record<string, Row[]> = {
    y1: Array.from({ length: 8 }, (_, j) => row(String(8100 + j), 801, 900 + j, [1, 0], {}, 1 + j)),
    y2: [row('8200', 802, 900, [2, 2])],
  }
  const f: Record<string, unknown> = { 8107: facts('4-3-3', '4-4-2'), 8200: facts('4-3-3', '4-3-3w') } // 8100 to 8106 have no statistics
  const one = fakes({ users: teams, history, facts: f })
  await plan(one.deps, store)
  assert.deepEqual(one.reads, ['8100', '8101', '8102', '8103', '8104', '8105'])
  const two = fakes({ users: teams, history, facts: f })
  await plan(two.deps, store)
  assert.deepEqual(two.reads, ['8106', '8107', '8200'], 'the six that did not answer are not read again yet')
  assert.equal(store.leagueFormations().matches, 2)
})

// Agent review of PR #48 (note R48A-2), seen live on 2026-11-04: right after the deploy all 10 agents planned within 22
// seconds, so their league reads ran at once from the same turn and read the same newest matches of the same first
// team (about 60 reads for 17 matches kept). Plans that run at once now take turns within the process.
test('R48A-2: plans that run at once take turns, so each reads other teams and no match twice', async () => {
  const store = new Store('', ':memory:')
  const teams = [1, 2, 3, 4, 5, 6].map(i => user(1000 + i, `z${i}`))
  const history: Record<string, Row[]> = {}
  const all: Record<string, unknown> = {}
  for (const i of [1, 2, 3, 4, 5, 6]) {
    history[`z${i}`] = [0, 1].map(j => row(String(10_000 + i * 10 + j), 1000 + i, 1100 + j, [1, 0], {}, 1 + j))
    for (const j of [0, 1]) all[String(10_000 + i * 10 + j)] = facts('4-3-3', '4-4-2')
  }
  const slow = (f: ReturnType<typeof fakes>) => {
    const fox = (f.deps as unknown as { fox: Record<string, (...a: unknown[]) => Promise<unknown>> }).fox
    const read = fox.matchHistory!
    fox.matchHistory = async (...a: unknown[]) => { await new Promise(r => setTimeout(r, 5)); return read(...a) }
    return f
  }
  const one = slow(fakes({ users: teams, history, facts: all }))
  const two = slow(fakes({ users: teams, history, facts: all }))
  await Promise.all([plan(one.deps, store), plan(two.deps, store)])
  assert.deepEqual([...one.histories, ...two.histories].sort(), ['z1', 'z2', 'z3', 'z4', 'z5', 'z6'])
  const reads = [...one.reads, ...two.reads]
  assert.equal(new Set(reads).size, reads.length, 'no statistics read twice')
  assert.equal(store.leagueFormations().matches, 12)
})

test('R48A-2: a plan waits a bounded time for its turn and otherwise reads no league matches this time', async () => {
  const { takeLeagueTurn } = await import('../src/snapshot/snapshot.ts')
  let release!: () => void
  const held = takeLeagueTurn(() => new Promise<void>(r => { release = r }), 1000)
  let ran = false
  assert.equal(await takeLeagueTurn(async () => { ran = true }, 20), false, 'gave up waiting')
  assert.equal(ran, false, 'and never runs later')
  release()
  assert.equal(await held, true)
  assert.equal(await takeLeagueTurn(async () => { ran = true }, 20), true, 'the turn is free again')
  assert.equal(ran, true)
})
