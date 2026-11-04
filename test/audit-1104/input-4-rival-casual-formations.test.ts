// Audit 2026-11-04 (five Fable 5.1 reviewers at max effort, PRs #29 to #50): the proof of a finding, failing before its fix.
// INPUT-4: "their last formations" (the Upcoming line and the 1v1 scouting) read the rival's last 3 revealed matches of
// any kind. Since the casual test bench every team the owner runs plays 1 to 3 casual games a day with a test formation
// that is put back right after the start; other players' casual games are tests against the AI too. The rival's test
// formations are then shown as what it plays, and the plan picks its formation against them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { takeSnapshot } from '../../src/snapshot/snapshot.ts'
import { renderDigest } from '../../src/snapshot/digest.ts'
import { ADDR, OTHER, dryWallet, snapshot } from '../fixtures.ts'

type Row = Record<string, unknown>
const row = (key: string, home: number, away: number | null, score: [number, number], more: Row = {}): Row => ({
  id: /^\d+$/.test(key) ? Number(key) : null, tournament_match_id: /^\d+$/.test(key) ? null : key,
  home_user_id: home, away_user_id: away, home_team_name: `T${home}`, away_team_name: `T${away}`,
  home_score: score[0], away_score: score[1], match_type: /^\d+$/.test(key) ? 'ranked' : 'tournament',
  status: 'finished', finished_at: new Date(Date.now() - 3600_000).toISOString(),
  home_elo_at_match: 1200, away_elo_at_match: 1200, tournament_id: null, ...more,
})

function fakes(o: { history: Record<string, Row[]>; facts: Record<string, unknown>; tournaments?: Record<number, unknown>; upcoming?: unknown[] }) {
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
    upcomingMatches: async () => ({ lead_minutes: 30, my_team_name: 'Agent', matches: o.upcoming ?? [] }),
    challengesForMe: async () => [],
    tournament: async (id: number) => o.tournaments?.[id] ?? assert.fail(`T${id} not expected`),
    matchHistory: async (a: string) => o.history[a] ?? [],
    matchFormations: async (m: Row) => o.facts[String(m.tournament_match_id ?? m.id)] ?? null,
  }
  const chain = { account: async () => ({ balance: 0n, nonce: 1 }), esdts: async () => [], egldUsd: async () => 25, query: async () => { throw new Error('no pool in this test') } }
  return { deps: { chain, fox } as never }
}
const cache = () => { const m = new Map<string, unknown>(); return { get: (k: string) => m.get(k) as never, put: (k: string, v: unknown) => void m.set(k, v) } }

test('INPUT-4: a rival\'s casual tests against the AI are not "their last formations"', async () => {
  const lock = new Date(Date.now() + 2 * 3600_000).toISOString()
  const { deps } = fakes({
    history: {
      [ADDR]: [],
      // Newest first: two casual tests (5-2-3 and 4-2-3-1 against the AI), then the matches it plays for real in 4-3-3b.
      [OTHER]: [row('91', 900, null, [2, 1], { match_type: 'casual' }), row('92', 900, null, [0, 0], { match_type: 'casual' }), row('R1', 900, 700, [2, 1]), row('R2', 800, 900, [0, 0])],
    },
    facts: {
      91: { home: '5-2-3', away: '4-4-2', homeStrength: 1, awayStrength: 1 },
      92: { home: '4-2-3-1', away: '4-3-3', homeStrength: 1, awayStrength: 1 },
      R1: { home: '4-3-3b', away: '4-4-2', homeStrength: 1, awayStrength: 1 },
      R2: { home: '5-3-2', away: '4-3-3b', homeStrength: 1, awayStrength: 1 },
    },
    tournaments: { 7: { tournament: { id: 7 }, participants: [{ user_id: 100, wallet_address: ADDR, team_name: 'Agent' }, { user_id: 900, wallet_address: OTHER, team_name: 'Rival FC' }] } },
    upcoming: [{ tournament_id: 7, tournament_title: 'Cup', round_label: 'Round 1', is_home: true, opponent_name: 'Rival FC', scheduled_at: lock, strategy_locks_at: lock, locked: false, phase: 'upcoming', home_score: null, away_score: null }],
  })
  const s = await takeSnapshot(deps, { wallet: dryWallet }, new Date(), { matchFacts: cache() } as never)
  const d = renderDigest(s)
  assert.match(d, /their last formations, newest first: 4-3-3b, 4-3-3b;/, d.split('\n').find(l => l.startsWith('Upcoming')))
})
