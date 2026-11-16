// P3b (the BEHAVIOUR reviewer's P3, second half, and the MAINNET reviewer's P-V2; the owner's word of 16 Nov): the
// "Teams to challenge" list put first the teams that took a 1v1 in 7 days they had not arranged, counting the
// non-creator side of every completed 1v1 not started within 2 minutes of a targeted creation (ARRANGED_MS). In the
// week to 16 Nov 109 of the agents' 158 targeted challenges went to five teams that answered none; user 12158 alone got
// 56 and read "took 6 1v1 in 7 days it had not arranged". User 380 read "took 10" from open challenges it took, six of
// them the owner's own agents', and answered none of the nine targeted ones it was sent.
// The rule now: a team counts as taking 1v1s it had not arranged only for a TARGETED 1v1 it accepted from a team it had
// not played a 1v1 against before (in FoxLeague's completed 1v1s read), still more than 2 minutes after it was sent.
// An open challenge a team chose to take is said apart. The line shows the rival's last such acceptances.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { takeSnapshot } from '../../src/snapshot/snapshot.ts'
import { renderDigest } from '../../src/snapshot/digest.ts'
import { dryWallet, tournament } from '../fixtures.ts'

const NOW = new Date('2026-11-16T12:00:00Z')
const ago = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString()
let next = 9000
/** A completed 1v1: `creator` sent it, `taker` took it `lagMin` minutes after its creation, `h` hours ago. */
const done = (creator: number, taker: number, h: number, lagMin: number, targeted: boolean) => ({
  ...(tournament(next++) as { tournament: object }).tournament,
  max_teams: 2, status: 'completed', creator_user_id: creator, winner_user_id: taker, runner_up_user_id: creator, targeted,
  created_at: ago(h + lagMin / 60 + 0.25), started_at: ago(h + 0.25), completed_at: ago(h),
})

function world() {
  const users = [
    { id: 1, wallet_address: dryWallet.address, team_name: 'Mine', elo_rating: 1200, league: 'Bronze' },
    { id: 60, wallet_address: 'erd1neon', team_name: 'Neon Dynamo', elo_rating: 1210, league: 'Bronze' },
    { id: 61, wallet_address: 'erd1friend', team_name: 'Slow Friend', elo_rating: 1190, league: 'Bronze' },
    { id: 62, wallet_address: 'erd1real', team_name: 'Real Taker', elo_rating: 1220, league: 'Bronze' },
    { id: 63, wallet_address: 'erd1pair', team_name: 'Pair Player', elo_rating: 1180, league: 'Bronze' },
  ]
  const rows = [
    // Neon Dynamo takes open challenges only: six from six teams.
    ...[11, 12, 13, 14, 15, 16].map((c, i) => done(c, 60, 10 + i * 5, 3, false)),
    // Slow Friend plays its friend (user 20) again and again, aimed at it and taken 10 minutes later; they met 8 days ago too.
    ...[20, 30, 50, 70, 90].map(h => done(20, 61, h, 10, true)),
    done(20, 61, 8 * 24, 10, true),
    // Real Taker accepted two targeted 1v1s from teams it had never played.
    done(21, 62, 6, 14, true),
    done(22, 62, 30, 41, true),
    // Pair Player met a team three times, each after 10 minutes: only the first was a stranger's challenge.
    ...[40, 60, 80].map(h => done(23, 63, h, 10, true)),
  ]
  const fox = {
    user: async () => ({ id: 1, wallet_address: dryWallet.address, team_name: 'Mine', elo_rating: 1200 }),
    team: async () => ({ id: 1, user_id: 1, name: 'Mine', coach_name: null, formation: '4-4-2', lineup: [], substitutes: [], team_overall: 0, badge: null }),
    players: async () => [],
    leaderboard: async () => ({ users }),
    tournaments: async (q: { status?: string; kind?: string }) => (q.status === 'completed' && q.kind === 'challenge' ? rows : []),
  } as never
  const chain = { account: async () => { throw new Error('off') }, esdts: async () => { throw new Error('off') }, egldUsd: async () => { throw new Error('off') }, query: async () => { throw new Error('off') } } as never
  return takeSnapshot({ chain, fox }, { wallet: dryWallet }, NOW)
}

test('P3b only a targeted 1v1 accepted from a team never played before counts as a 1v1 a team had not arranged', async () => {
  const s = await world()
  const took = Object.fromEntries(s.leaderboardNeighbours.map(u => [u.id, u.accepted7d]))
  assert.equal(took[60], 0, 'six open challenges taken are not a targeted challenge answered')
  assert.equal(took[61], 0, 'a pair that plays again and again arranged it, whatever the minutes')
  assert.equal(took[62], 2)
  assert.equal(took[63], 1, 'only the first meeting of a pair was a stranger\'s challenge')
  assert.deepEqual(s.leaderboardNeighbours.slice(0, 2).map(u => u.id).sort(), [62, 63], 'the teams that answer a stranger come first')
})

test('P3b the rival\'s line shows its last real acceptances, and the open challenges it took apart', async () => {
  const d = renderDigest(await world())
  assert.match(d, /Real Taker \(user 62\) 1220, took 2 1v1 in 7 days it had not arranged \(last ones: 2026-11-16 05:45 UTC, 14 min after it was sent; 2026-11-15 05:45 UTC, 41 min after it was sent\)/)
  assert.match(d, /Neon Dynamo \(user 60\) 1210, took no 1v1 in 7 days it had not arranged, took 6 open challenges/)
  assert.match(d, /Teams to challenge \(first the ones that take 1v1s they had not arranged: [^)]*targeted 1v1[^)]*not played/)
})
