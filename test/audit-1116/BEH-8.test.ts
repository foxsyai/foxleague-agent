// BEH-8: while a 1v1 of the agent's own waits for an opponent, the snapshot scouts no open challenge of another team
// (snapshot.ts: the scouting runs only when `!auth.myTournaments.active.some(t => t.max_teams === 2)`), so the plan
// reads those challenges without the rival's ELO and lineup. The prompt tells it to close its own unanswered challenge
// "when a clearly better 1v1 is open" (leave_tournament), which it then cannot judge.
// Production, 9 to 16 Nov: an unanswered 1v1 of the agent's own was out for 473 hours (39 percent of the ten agents'
// active hours); in 26 plans the summary says, with its own challenge still out, that the other open challenges are
// "of unknown strength" (plans 15150, 15196, 15245, 15504, 15530, 15531, ...), three of them concluding "the executor
// would refuse them". The one open challenge of a weak team an agent did take that week (T5891, agent 3, 14 Nov) was
// won 5-0; four agents saw it, all four with no challenge of their own out.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { takeSnapshot } from '../../src/snapshot/snapshot.ts'
import { renderDigest } from '../../src/snapshot/digest.ts'
import { ADDR, OTHER, dryWallet, rivalSquad, snapshot, tournament } from '../fixtures.ts'

const hours = (h: number): string => new Date(Date.now() + h * 3600_000).toISOString()

test('BEH-8: an open challenge of another team is scouted while the agent\'s own 1v1 waits, so the plan can tell a better one', async () => {
  const mine = (tournament(6000, { max_teams: 2, min_teams: 2, format: 'knockout', creator_user_id: 100, target_user_id: 12158, targeted: true, deadline: hours(3), participant_count: 1 }) as { tournament: Record<string, unknown> }).tournament
  const theirs = tournament(7000, { max_teams: 2, min_teams: 2, format: 'knockout', creator_user_id: 900, target_user_id: null, deadline: hours(2), participant_count: 1 }, [{ user_id: 900, wallet_address: OTHER }]) as { tournament: Record<string, unknown>; participants: unknown[] }
  const rival = { id: 900, wallet_address: OTHER, username: null, elo_rating: 1187, league: 'Silver', matches_won: 1, matches_lost: 9, matches_drawn: 0, team_name: 'Cobra United', badge: null, verified: false, tournament_wins: 0, active_title: null, player_count: 18 }
  const fox: Record<string, unknown> = {
    config: async () => snapshot().config,
    user: async (a: string) => (a === ADDR ? snapshot().profile : a === OTHER ? rival : null),
    ...rivalSquad(14), // far weaker than ours (20): the kind of open challenge T5891 was
    tournaments: async (q: { status?: string; kind?: string }) => (q?.status === 'open' ? [mine, theirs.tournament] : []),
    tournament: async (id: number) => {
      if (id === 7000) return theirs
      throw new Error(`no T${id} in this test`)
    },
    leaderboard: async () => ({ users: [rival], total: 1, limit: 200, offset: 0 }), floorPrices: async () => [], listings: async () => [],
    shopStatus: async () => snapshot().auth!.shop, dailyAllowance: async () => snapshot().auth!.allowance, activeMatch: async () => null,
    myTournaments: async () => ({ active: [mine], completed: [] }), upcomingMatches: async () => ({ lead_minutes: 30, my_team_name: 'Agent', matches: [] }),
    challengesForMe: async () => [], matchHistory: async () => [], leagueInvitations: async () => [], bestXiOvr: async () => ({ best_xi_ovr: 20 }),
  }
  // Our own team and roster for our address, the rival's for its own.
  const own = snapshot()
  const rivalTeam = fox.team as () => Promise<unknown>
  const rivalPlayers = fox.players as () => Promise<unknown>
  fox.team = async (a: string) => (a === ADDR ? own.team : rivalTeam())
  fox.players = async (a: string) => (a === ADDR ? [] : rivalPlayers())
  const chain = { account: async () => ({ balance: 10n ** 19n, nonce: 1 }), esdts: async () => [], egldUsd: async () => 25, query: async () => { throw new Error('no pool in this test') } }

  // Control: with no 1v1 of our own out, the same challenge is scouted (the mocks answer every read it needs).
  const free = await takeSnapshot({ chain, fox: { ...fox, myTournaments: async () => ({ active: [], completed: [] }), tournaments: async (q: { status?: string }) => (q?.status === 'open' ? [theirs.tournament] : []) } } as never, { wallet: { ...dryWallet, address: ADDR } }, new Date())
  assert.deepEqual(free.market.scouted?.map(x => [x.id, x.elo]), [[7000, 1187]], 'control: scouted when no 1v1 of ours is out')

  const s = await takeSnapshot({ chain, fox } as never, { wallet: { ...dryWallet, address: ADDR } }, new Date())
  assert.equal(s.auth?.myTournaments?.active.some(t => t.max_teams === 2), true, 'our own 1v1 waits for an opponent')
  assert.equal(s.market.openChallenges.some(t => t.id === 7000), true, 'the other team\'s open challenge is listed for the plan')
  const line = renderDigest(s).split('\n').find(l => l.trimStart().startsWith('T7000 ')) ?? ''
  assert.ok(s.market.scouted?.some(x => x.id === 7000), `T7000 must be scouted (rival ELO and lineup) though our own 1v1 is out; the plan reads: ${line.trim()}`)

  // Once another team has taken ours it cannot be left, so no other 1v1 is in reach: nothing is scouted (no reads spent).
  const takenMine = { ...mine, participant_count: 2 }
  const taken = await takeSnapshot({ chain, fox: { ...fox, myTournaments: async () => ({ active: [takenMine], completed: [] }) } } as never, { wallet: { ...dryWallet, address: ADDR } }, new Date())
  assert.deepEqual(taken.market.scouted, [], 'our own 1v1 already taken: nothing scouted')
})
