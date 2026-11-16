// R76A-1 (low, GitHub agent review of PR #76; rule 4): R2M-3 reads GET /api/tournaments/upcoming-matches in pages of
// 200 up to FoxLeague's X-Total-Count, but when an answer carries no such header (or one that is no count) a page
// shorter than 200 is taken as the whole list (src/foxleague/api.ts upcomingMatches). Only the total tells a whole list
// from a part of one:
// - a server that pages lower than it was asked (50, say) and sends no total gives its first 50 rows as the whole list;
// - FoxLeague's own mainnet code (release/mainnet-1.0 729164194, backend/src/routes/tournaments.rs upcoming_matches)
//   answers its row read `.unwrap_or_default()` (an empty list when the read fails) and its count `.ok()`, and sends the
//   header only as `total.map(total_count_headers)`. When both reads fail the answer is an empty list with no header,
//   which the agent reads as "no fixtures".
// rules.ts no longer refuses a full page of 50 (R2M-3), so owed matches are counted short and a paid join the schedule
// rule refuses can pass. A missing or unreadable X-Total-Count must leave the list unread, as any list not read whole.
// FoxLeague sends the header on every answer whose count it read, an empty list included (X-Total-Count: 0), so a team
// with no fixtures still reads its list.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FoxLeague } from '../../src/foxleague/api.ts'
import type { UpcomingMatches } from '../../src/foxleague/types.ts'
import type { PlannedAction } from '../../src/executor/actions.ts'
import { dryWallet, liveWallet, setup, snapshot, tournament } from '../fixtures.ts'

const at = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()
const fixture = (i: number, tournamentId = 900) => ({
  tournament_id: tournamentId, tournament_title: `T${tournamentId}`, round_label: `Matchday ${i + 1}`, group_name: null, is_home: i % 2 === 0, opponent_name: `Team ${i}`,
  scheduled_at: at(1.5 + i * 0.5), strategy_locks_at: at(1 + i * 0.5), locked: false, phase: 'upcoming' as const, tournament_match_id: `m${i}`, home_score: null, away_score: null,
})

/** Reads the upcoming matches from a FoxLeague that answers each page with `serve`: its rows and, when given, X-Total-Count. */
async function read(serve: (limit: number, offset: number) => { rows: unknown[]; total?: string }) {
  const real = globalThis.fetch
  const asked: string[] = []
  globalThis.fetch = (async (url: string | URL) => {
    const u = new URL(String(url))
    const reply = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', ...headers } })
    if (u.pathname === '/api/auth/verify') return reply({ success: true, data: { token: 't1' } })
    if (u.pathname !== '/api/tournaments/upcoming-matches') return reply({ success: false, error: 'not in this test' })
    asked.push(u.search)
    const page = serve(Number(u.searchParams.get('limit') ?? 50), Number(u.searchParams.get('offset') ?? 0))
    return reply({ success: true, data: { lead_minutes: 30, my_team_name: 'Agent', my_team_badge: null, matches: page.rows } }, page.total === undefined ? {} : { 'x-total-count': page.total })
  }) as typeof fetch
  try {
    const fox = new FoxLeague('https://foxleague.test', 50)
    const got: UpcomingMatches | Error = await fox.upcomingMatches({ ...liveWallet, signMessage: (m: string) => `sig:${m}` }).catch((err: unknown) => (err instanceof Error ? err : new Error(String(err))))
    return { got, asked }
  } finally {
    globalThis.fetch = real
  }
}

test('R76A-1 a page with no X-Total-Count is not read as the whole list: a server that pages at 50 keeps 10 of 60 fixtures back', async () => {
  const all = Array.from({ length: 60 }, (_, i) => fixture(i))
  const { got, asked } = await read((limit, offset) => ({ rows: all.slice(offset, offset + Math.min(limit, 50)) }))
  assert.ok(got instanceof Error, `${got instanceof Error ? '' : got.matches.length} of 60 fixtures were read as the whole list (asked: ${asked.join(' | ')}); the last one read is ${got instanceof Error ? '' : got.matches.at(-1)?.round_label}`)
  assert.match(got.message, /not read whole/)
})

test('R76A-1 an X-Total-Count that is no count is no total either', async () => {
  const all = Array.from({ length: 60 }, (_, i) => fixture(i))
  for (const total of ['', 'many', '-1', '1e3', '12.5', '0x10']) {
    const { got } = await read((limit, offset) => ({ rows: all.slice(offset, offset + Math.min(limit, 50)), total }))
    assert.ok(got instanceof Error, `X-Total-Count "${total}": ${got instanceof Error ? '' : got.matches.length} of 60 fixtures were read as the whole list`)
  }
})

/** The agent sits in a round robin of 8 under way (started an hour ago) with 6 fixtures still to play; squad at 60 (as MON-1). */
function busySnapshot(upcoming: UpcomingMatches | null) {
  const s = snapshot()
  for (const p of s.players) p.condition = 60
  const running = { ...(tournament(60, { status: 'active', format: 'round_robin', max_teams: 8, min_teams: 4, starts_at: at(-1), deadline: at(-2), started_at: at(-1), round_interval_minutes: 30 }) as { tournament: object }).tournament }
  s.auth!.myTournaments!.active = [running] as never
  s.auth!.upcoming = upcoming
  // A read that throws leaves null with a warning (snapshot.ts attempt()).
  if (!upcoming) s.warnings.push('upcoming matches: not read whole')
  return s
}
const JOIN: PlannedAction = { action: { type: 'join_tournament', tournament_id: 70 }, reason: 'test' }
const mocks = () => setup({ fox: { tournament: async () => tournament(70, { starts_at: at(2), deadline: at(1), round_interval_minutes: 30 }, []), user: async () => ({ elo_rating: 1200 }) } })

test('R76A-1 an empty answer with no X-Total-Count (FoxLeague\'s row read and count both failed) is no "no fixtures": the paid entry stays refused', async () => {
  const six = Array.from({ length: 6 }, (_, i) => fixture(i, 60))
  // Control: the 6 fixtures read whole (FoxLeague's count with them) refuse the entry.
  const whole = await read((limit, offset) => ({ rows: six.slice(offset, offset + limit), total: '6' }))
  assert.ok(!(whole.got instanceof Error) && whole.got.matches.length === 6, String(whole.got instanceof Error ? whole.got.message : whole.got.matches.length))
  const control = mocks()
  const [c] = await control.exec.run(control.agent(), dryWallet, busySnapshot(whole.got), [JOIN])
  assert.equal(c!.status, 'refused', c!.summary)
  assert.match(c!.summary, /wear the squad down/)

  // The same team when FoxLeague's two reads failed: `matches: []` and no header.
  const failed = await read(() => ({ rows: [] }))
  const m = mocks()
  const [r] = await m.exec.run(m.agent(), dryWallet, busySnapshot(failed.got instanceof Error ? null : failed.got), [JOIN])
  assert.equal(r!.status, 'refused', `a list read without its total decided: ${r!.summary}`)
  assert.equal(m.store.spentUsd(0, { category: 'play', dryRun: true }), 0, 'nothing is booked for an entry judged on a list not read whole')
})

test('R76A-1 a team with no fixtures still reads its list: FoxLeague sends X-Total-Count 0 with an empty one', async () => {
  const none = await read(() => ({ rows: [], total: '0' }))
  assert.ok(!(none.got instanceof Error), none.got instanceof Error ? none.got.message : '')
  assert.equal(none.got.matches.length, 0)
  assert.equal(none.asked.length, 1, 'one request for an empty list')
  const twelve = Array.from({ length: 12 }, (_, i) => fixture(i))
  const few = await read((limit, offset) => ({ rows: twelve.slice(offset, offset + limit), total: '12' }))
  assert.ok(!(few.got instanceof Error) && few.got.matches.length === 12, few.got instanceof Error ? few.got.message : String(few.got.matches.length))
  assert.equal(few.asked.length, 1, 'one request for a short list with its total')
})
