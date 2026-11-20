// Audit 2026-11-16 (MAINNET): the proof of MNT-3, failing before its fix.
// The ELO pair cap (FoxLeague #746 + #751, on mainnet since 16 Nov; /api/config serves
// elo_pair_cap { live: false, live_from: "2026-11-20T14:00:00Z", per_day: 3, reset_hour_utc: 14 }). From Fri 20 Nov
// 14:00 UTC the same two teams move ELO in at most 3 games a game day, ranked, 1v1 and tournaments together; a later
// game pays its fee and stake as always and moves no ELO. FoxLeague serves the count per rival
// (GET /api/matches/elo-pair/{user_id}: meetings, no_elo, no_elo_until). The agent's plan was told nothing of it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderDigest } from '../../src/snapshot/digest.ts'
import { snapshot } from '../fixtures.ts'

/**
 * The block this finding is about, as GET /api/config served it on 16 Nov 2026 11:50 UTC, with its start moved to a date
 * that stays ahead: the real one (2026-11-20T14:00:00Z) passed, and a start in the past is no longer "when it starts".
 */
const live = { elo_pair_cap: { live: false, live_from: '2099-11-20T14:00:00Z', per_day: 3, reset_hour_utc: 14 } }

test('MNT-3 the snapshot tells the plan the ELO pair cap FoxLeague serves: its number, its day and when it starts', () => {
  const s = snapshot()
  Object.assign(s.config as object, { elo_pair_cap: live.elo_pair_cap })
  const text = renderDigest(s)
  assert.match(text, /pair cap/i, 'no line names the ELO pair cap')
  assert.match(text, /2099-11-20T14:00/, 'the plan is not told when it starts')
})

test('MNT-3 once live, the snapshot says so', () => {
  const s = snapshot()
  Object.assign(s.config as object, { elo_pair_cap: { live: true, live_from: '2026-11-20T14:00:00Z', per_day: 3, reset_hour_utc: 14 } })
  assert.match(renderDigest(s), /pair cap[^\n]*LIVE[^\n]*3/i)
})

// The reviewer's test asked this of the system prompt. The brief keeps the prompt to its stale lines and wants a plan
// fact: what a game past the cap costs and brings is told on the snapshot's line, where the plan reads it every time.
test('MNT-3 the plan is told what a game past the cap costs and brings', () => {
  const s = snapshot()
  Object.assign(s.config as object, { elo_pair_cap: live.elo_pair_cap })
  const line = renderDigest(s).split('\n').find(l => /pair cap/i.test(l)) ?? ''
  assert.match(line, /no ELO/i, `the line must say a meeting past the cap moves no ELO: ${line}`)
  assert.match(line, /XP/, `the line must say a meeting past the cap still earns XP: ${line}`)
})

test('MNT-3 once live, each rival the plan can challenge shows its ELO meetings of the game day', () => {
  const s = snapshot()
  Object.assign(s.config as object, { elo_pair_cap: { live: true, live_from: '2026-11-20T14:00:00Z', per_day: 3, reset_hour_utc: 14 } })
  s.leaderboardNeighbours = [
    { id: 901, wallet_address: 'erd1a', team_name: 'Met Thrice', elo_rating: 1200, league: 'Bronze', accepted7d: 1 },
    { id: 902, wallet_address: 'erd1b', team_name: 'Met Once', elo_rating: 1210, league: 'Bronze', accepted7d: 1 },
    { id: 903, wallet_address: 'erd1c', team_name: 'Unread', elo_rating: 1220, league: 'Bronze', accepted7d: 1 },
  ] as never
  // GET /api/matches/elo-pair/{user_id} for each, read by the planning snapshot: the third read failed.
  s.eloPairs = [{ userId: 901, meetings: 3, noEloUntil: '2026-11-21T14:00:00.000Z' }, { userId: 902, meetings: 1, noEloUntil: null }, { userId: 903, meetings: null, noEloUntil: null }]
  const text = renderDigest(s)
  assert.match(text, /Met Thrice \(user 901\)[^;]*3 of 3 ELO meetings today: a game against it moves no ELO until 2026-11-21T14:00/)
  assert.match(text, /Met Once \(user 902\)[^;]*1 of 3 ELO meetings today/)
  assert.match(text, /Unread \(user 903\)[^;]*ELO meetings today: unknown/)
})

test('MNT-3 the planning snapshot reads the pair count of each rival it lists only while the cap is live', async () => {
  const { takeSnapshot } = await import('../../src/snapshot/snapshot.ts')
  const { dryWallet } = await import('../fixtures.ts')
  const asked: number[] = []
  const config = { ...snapshot().config, elo_pair_cap: { live: true, live_from: '2026-11-20T14:00:00Z', per_day: 3, reset_hour_utc: 14 } }
  const fox = {
    config: async () => config,
    user: async () => ({ id: 100, wallet_address: dryWallet.address, team_name: 'Agent', elo_rating: 1200, league: 'Bronze', matches_won: 0, matches_lost: 0, matches_drawn: 0, player_count: 18 }),
    leaderboard: async () => ({ users: [{ id: 100, wallet_address: dryWallet.address, team_name: 'Agent', elo_rating: 1200 }, { id: 901, wallet_address: 'erd1a', team_name: 'Rival', elo_rating: 1210 }], total: 2, limit: 200, offset: 0 }),
    eloPair: async (_w: unknown, id: number) => { asked.push(id); return { live: true, cap: 3, reset_hour_utc: 14, meetings: 2, no_elo: false, opponent_team: 'Rival', no_elo_until: null } },
    // An open challenge of user 950, whose line the plan reads too.
    tournaments: async (q: { status?: string }) => (q.status === 'open' ? [{ id: 77, max_teams: 2, min_teams: 2, creator_user_id: 950, target_user_id: null, targeted: false, status: 'open', format: 'knockout', deadline: new Date(Date.now() + 3600_000).toISOString(), starts_at: new Date(Date.now() + 3600_000).toISOString() }] : []),
  }
  // Every other route answers nothing: the snapshot keeps its warnings.
  const proxy = new Proxy(fox, { get: (t, k) => (k in t ? t[k as keyof typeof t] : async () => { throw new Error('not in this test') }) })
  const chain = new Proxy({}, { get: () => async () => { throw new Error('off') } })
  const s = await takeSnapshot({ chain, fox: proxy } as never, { wallet: dryWallet }, new Date(), { research: true })
  assert.deepEqual(asked, [950, 901])
  assert.deepEqual(s.eloPairs, [{ userId: 950, meetings: 2, noEloUntil: null }, { userId: 901, meetings: 2, noEloUntil: null }])
  // Before the switch nothing is asked.
  asked.length = 0
  config.elo_pair_cap = { live: false, live_from: '2099-11-20T14:00:00Z', per_day: 3, reset_hour_utc: 14 }
  const before = await takeSnapshot({ chain, fox: proxy } as never, { wallet: dryWallet }, new Date(), { research: true })
  assert.deepEqual(asked, [])
  assert.equal(before.eloPairs, undefined)
})
