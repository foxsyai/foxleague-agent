// INT-2 (pre-release audit 2026-11-22, INTEGRATION): the planning snapshot took the ELO pair meetings from
// GET /api/matches/elo-pair/{user_id} without reading the answer's `live`. FoxLeague's pair_status (elo_pair_cap.rs)
// answers live:false with meetings 0 when its own read of the switch fails ("a failed read shows the cap off and the
// default numbers"): it did not count. The digest then printed "0 of 3 ELO meetings today" for a count never made.
// Information only (FoxLeague refuses no game); unknown is not zero (AGENTS.md rule 4).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { takeSnapshot } from '../../src/snapshot/snapshot.ts'
import { renderDigest } from '../../src/snapshot/digest.ts'
import { dryWallet, snapshot } from '../fixtures.ts'

async function snapWith(answer: Record<string, unknown>) {
  const config = { ...snapshot().config, elo_pair_cap: { live: true, live_from: '2026-11-20T14:00:00Z', per_day: 3, reset_hour_utc: 14 } }
  const fox = {
    config: async () => config,
    user: async () => ({ id: 100, wallet_address: dryWallet.address, team_name: 'Agent', elo_rating: 1200, league: 'Bronze', matches_won: 0, matches_lost: 0, matches_drawn: 0, player_count: 18 }),
    leaderboard: async () => ({ users: [{ id: 100, wallet_address: dryWallet.address, team_name: 'Agent', elo_rating: 1200 }, { id: 901, wallet_address: 'erd1a', team_name: 'Rival', elo_rating: 1210 }], total: 2, limit: 200, offset: 0 }),
    eloPair: async () => answer,
    tournaments: async () => [],
  }
  const proxy = new Proxy(fox, { get: (t, k) => (k in t ? t[k as keyof typeof t] : async () => { throw new Error('not in this test') }) })
  const chain = new Proxy({}, { get: () => async () => { throw new Error('off') } })
  return takeSnapshot({ chain, fox: proxy } as never, { wallet: dryWallet }, new Date(), { research: true })
}

test('INT-2 an elo-pair answer that says the cap is off, while /api/config says it is live, is no count of 0', async () => {
  const s = await snapWith({ live: false, cap: 3, reset_hour_utc: 14, meetings: 0, no_elo: false, opponent_team: 'Rival', no_elo_until: null })
  assert.equal(s.eloPairs?.[0]?.userId, 901)
  assert.equal(s.eloPairs?.[0]?.meetings, null, 'FoxLeague did not count (its answer says the cap is off): the meetings are unknown, not 0')
  assert.doesNotMatch(renderDigest(s), /0 of 3 ELO meetings today/)
})

test('INT-2 control: an answer with live true keeps its count', async () => {
  const s = await snapWith({ live: true, cap: 3, reset_hour_utc: 14, meetings: 2, no_elo: false, opponent_team: 'Rival', no_elo_until: null })
  assert.equal(s.eloPairs?.[0]?.meetings, 2)
})
