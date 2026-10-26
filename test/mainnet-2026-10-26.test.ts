// Owner, 2026-10-26: FoxLeague upgraded mainnet. Checked read-only that day:
// - the players contract carries the refundable shop record (getPackDistributedInWindow answers,
//   getTreasuryRefundedInEpoch is gone): a shop payment now costs about 8.58M gas, and FoxLeague's app signs it with
//   12,864,100 (1.5x; frontend/src/lib/gasLimits.ts). The agent's 12,000,000 left 1.40x;
// - every team answer and every leaderboard row carries best_xi_ovr, the one team OVR FoxLeague now shows everywhere;
//   team_overall is gone from the team answer, so the import preview read 0;
// - the leaderboard's best_xi_ovr is the read of any team's OVR the owner asked for: the plan sees each rival's and how
//   many teams a range would let in.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shopPayTx } from '../src/executor/tx.ts'
import { renderDigest } from '../src/snapshot/digest.ts'
import { ADDR, dryWallet, snapshot } from './fixtures.ts'

test('a shop payment is signed with FoxLeague\'s gas limit for the upgraded players contract', () => {
  assert.equal(shopPayTx(10n ** 21n).gasLimit, 12_864_100n)
})

test('the plan sees each rival\'s best XI OVR, and how many teams the suggested range lets in', () => {
  const s = snapshot()
  s.auth!.bestXiOvr = 31.4
  s.leaderboardNeighbours = [
    { id: 50, wallet_address: 'erd1a', team_name: 'Near', elo_rating: 1190, league: 'Bronze', accepted7d: 2, bestXiOvr: 30.2 },
    { id: 51, wallet_address: 'erd1b', team_name: 'Strong', elo_rating: 1210, league: 'Bronze', accepted7d: 1, bestXiOvr: 44.9 },
    { id: 52, wallet_address: 'erd1c', team_name: 'Quiet', elo_rating: 1200, league: 'Bronze', accepted7d: 0, bestXiOvr: 33 },
  ] as never
  s.market.boardOvrs = { all: [30.2, 44.9, 33, 28, 36], takers: [30.2, 44.9] }
  const text = renderDigest(s)
  assert.match(text, /Near \(user 50\) 1190, accepted 2 1v1 in 7 days, best XI OVR 30\.2/)
  assert.match(text, /a range about 10 percent either way for what you create: ovr_min 28, ovr_max 35 \(inside it: 3 of the 5 leaderboard teams read, 1 of the 2 that accepted a 1v1 in 7 days\)/)
})

test('the snapshot keeps each leaderboard team\'s best XI OVR', async () => {
  const { takeSnapshot } = await import('../src/snapshot/snapshot.ts')
  const users = [
    { id: 1, wallet_address: ADDR, team_name: 'Agent', elo_rating: 1200, best_xi_ovr: 31.4 },
    { id: 2, wallet_address: 'erd1qyu5wthldzr8wx5c9ucg8kjagg0jfs53s8nr3zpz3hypefsdd8ssycr6th', team_name: 'Rival', elo_rating: 1210, best_xi_ovr: 33.1 },
    { id: 3, wallet_address: 'erd1spm863ywflqdpu3kxjrndgze28gecqtfgx9nvtf5n33j0jr9fjeqdfayw4', team_name: 'Other', elo_rating: 1190 },
  ]
  const fox: Record<string, unknown> = {
    config: async () => snapshot().config, user: async (a: string) => (a === ADDR ? snapshot().profile : null), team: async () => snapshot().team, players: async () => [],
    tournaments: async () => [], leaderboard: async () => ({ users, total: 3, limit: 200, offset: 0 }), floorPrices: async () => [], listings: async () => [],
    shopStatus: async () => snapshot().auth!.shop, dailyAllowance: async () => snapshot().auth!.allowance, activeMatch: async () => null,
    myTournaments: async () => ({ active: [], completed: [] }), upcomingMatches: async () => ({ lead_minutes: 30, my_team_name: 'Agent', matches: [] }),
    challengesForMe: async () => [], matchHistory: async () => [], leagueInvitations: async () => [], bestXiOvr: async () => ({ best_xi_ovr: 31.4 }),
  }
  const chain = { account: async () => ({ balance: 0n, nonce: 1 }), esdts: async () => [], egldUsd: async () => 25, query: async () => { throw new Error('no pool in this test') } }
  const s = await takeSnapshot({ chain, fox } as never, { wallet: { ...dryWallet, address: ADDR } }, new Date())
  assert.deepEqual(s.leaderboardNeighbours.map(u => [u.id, u.bestXiOvr]), [[2, 33.1], [3, null]])
  assert.deepEqual(s.market.boardOvrs, { all: [33.1], takers: [] }, 'ours left out; a team without an OVR left out')
})

test('the import preview shows the best XI OVR (FoxLeague dropped team_overall)', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/service.ts', import.meta.url), 'utf8')
  assert.match(src, /overall: team\.best_xi_ovr \?\? team\.team_overall/)
})
