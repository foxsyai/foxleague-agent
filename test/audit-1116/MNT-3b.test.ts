// MNT-3b: FoxLeague's ELO pair cap counts the meetings of two teams in a game day over ranked, 1v1s and tournaments
// together. The snapshot gave the meetings of the rivals the plan can challenge (MNT-3), but not of a tournament
// opponent: GET /api/tournaments/upcoming-matches names the opponent by its team only (shapes.rs UpcomingMatch:
// opponent_name, no user id). The tournament's public detail (GET /api/tournaments/{id}, tournament_models.rs
// ParticipantInfo) lists every seated team with its user_id and team_name, both read from FoxLeague's `teams` table,
// whose names are unique (migration 087 teams_name_normalized_unique): the opponent's user id is the seat of that name.
// Unread is unknown, never 0.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { takeSnapshot } from '../../src/snapshot/snapshot.ts'
import { renderDigest } from '../../src/snapshot/digest.ts'
import { dryWallet, snapshot } from '../fixtures.ts'

const NOW = new Date('2026-11-21T08:00:00Z')
const CAP = { live: true, live_from: '2026-11-20T14:00:00Z', per_day: 3, reset_hour_utc: 14 }

function world(o: { detailFails?: boolean } = {}) {
  const asked: number[] = []
  const config = { ...snapshot().config, elo_pair_cap: CAP }
  const match = (tournament_id: number, opponent_name: string | null, scheduled_at: string, phase = 'upcoming') => ({ tournament_id, tournament_title: `T${tournament_id}`, round_label: 'Round 2', group_name: null, is_home: true, opponent_name, scheduled_at, strategy_locks_at: scheduled_at, locked: false, phase, home_score: null, away_score: null })
  const fox = {
    config: async () => config,
    user: async () => ({ id: 100, wallet_address: dryWallet.address, team_name: 'Agent', elo_rating: 1200, league: 'Bronze', matches_won: 0, matches_lost: 0, matches_drawn: 0, player_count: 18 }),
    leaderboard: async () => ({ users: [{ id: 100, wallet_address: dryWallet.address, team_name: 'Agent', elo_rating: 1200 }], total: 1, limit: 200, offset: 0 }),
    tournaments: async () => [],
    upcomingMatches: async () => ({ lead_minutes: 30, my_team_name: 'Agent', matches: [match(70, 'Rival FC', '2026-11-21T09:00:00Z'), match(70, 'Other FC', '2026-11-21T20:00:00Z'), match(71, null, '2026-11-21T10:00:00Z')] }),
    tournament: async (id: number) => {
      if (o.detailFails) throw new Error('HTTP 502')
      return { tournament: { id }, participants: [{ id: 1, user_id: 100, wallet_address: dryWallet.address, team_name: 'Agent' }, { id: 2, user_id: 501, wallet_address: 'erd1rival', team_name: 'Rival FC' }, { id: 3, user_id: 502, wallet_address: 'erd1other', team_name: 'Other FC' }] }
    },
    eloPair: async (_w: unknown, id: number) => { asked.push(id); return { live: true, cap: 3, reset_hour_utc: 14, meetings: 2, no_elo: false, opponent_team: 'x', no_elo_until: null } },
  }
  const proxy = new Proxy(fox, { get: (t, k) => (k in t ? t[k as keyof typeof t] : async () => { throw new Error('not in this test') }) })
  const chain = new Proxy({}, { get: () => async () => { throw new Error('off') } })
  return { asked, take: () => takeSnapshot({ chain, fox: proxy } as never, { wallet: dryWallet }, NOW, { research: true }) }
}
const upcomingLine = (text: string, name: string) => text.split('\n').find(l => l.startsWith('Upcoming:') && l.includes(name)) ?? ''

test('MNT-3b a tournament opponent of this game day gets its ELO meetings, by its seat in the tournament', async () => {
  const w = world()
  const s = await w.take()
  assert.ok(w.asked.includes(501), `the opponent of T70 at 09:00 was not asked for (asked: ${w.asked.join(', ') || 'none'})`)
  assert.ok(!w.asked.includes(502), 'a match after the game day\'s reset at 14:00 counts on the next day')
  const line = upcomingLine(renderDigest(s), 'Rival FC')
  assert.match(line, /2 of 3 ELO meetings today/, line)
})

test('MNT-3b a tournament opponent whose seat could not be read is unknown, never 0', async () => {
  const w = world({ detailFails: true })
  const s = await w.take()
  assert.ok(!w.asked.includes(501))
  const line = upcomingLine(renderDigest(s), 'Rival FC')
  assert.match(line, /ELO meetings today: unknown/, line)
  assert.doesNotMatch(line, /0 of 3/)
})
