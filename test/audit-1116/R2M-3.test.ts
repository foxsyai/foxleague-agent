// R2M-3 (low; older code, new evidence from FoxLeague's mainnet source, feeds the counts of MON-3, MNT-1c and MNT-3b):
// GET /api/tournaments/upcoming-matches is PAGED. release/mainnet-1.0 729164194, backend/src/routes/tournaments.rs:
//   UPCOMING_DEFAULT_LIMIT = 50, UPCOMING_MAX_LIMIT = 200, `ORDER BY tm.scheduled_at ASC ... LIMIT $2 OFFSET $3`,
//   the total in the header `X-Total-Count`; its own comment (2026-10-04): "the recently played rows come first, so on a
//   busy day the NEXT match could be the one cut".
// The agent asks it once, with no limit and no offset (src/foxleague/api.ts upcomingMatches), and reads the 50 rows it
// gets as the whole list: the schedule rule's count of what a round robin under way still owes (rules.ts otherMatches:
// "a round robin lists every fixture from its start", undrawn = 0), the knockout exit of MNT-1c, the opponents of
// MNT-3b, the casual and 1v1 lockouts. A team with more than 50 rows (the finished matches of the last 24 h and every
// fixture not played yet: a home-and-away round robin of 18 alone is 34) loses the LATEST fixtures without a word, so
// a join or a create whose span holds them is judged against too few matches (rule 4: a partial read taken as whole).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FoxLeague } from '../../src/foxleague/api.ts'
import { liveWallet } from '../fixtures.ts'

const TOTAL = 60
const at = (i: number) => new Date(Date.UTC(2026, 10, 17, 0, 0, 0) + i * 30 * 60_000).toISOString()
const ROWS = Array.from({ length: TOTAL }, (_, i) => ({
  tournament_id: 900, tournament_title: 'Long round robin', round_label: `Matchday ${i + 1}`, group_name: null, is_home: i % 2 === 0, opponent_name: `Team ${i}`,
  scheduled_at: at(i), strategy_locks_at: at(i - 1), locked: false, phase: 'upcoming', tournament_match_id: `m${i}`, home_score: null, away_score: null,
}))

test('R2M-3 the upcoming matches are read whole (or not at all): FoxLeague pages them at 50', async () => {
  const real = globalThis.fetch
  const asked: string[] = []
  globalThis.fetch = (async (url: string | URL) => {
    const u = new URL(String(url))
    const reply = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', ...headers } })
    if (u.pathname === '/api/auth/verify') return reply({ success: true, data: { token: 't1' } })
    if (u.pathname === '/api/tournaments/upcoming-matches') {
      asked.push(u.search)
      // FoxLeague's PageWindow: limit 50 when absent, at most 200; offset 0 when absent.
      const limit = Math.min(200, Math.max(1, Number(u.searchParams.get('limit') ?? 50)))
      const offset = Math.max(0, Number(u.searchParams.get('offset') ?? 0))
      return reply({ success: true, data: { lead_minutes: 30, my_team_name: 'Agent', my_team_badge: null, matches: ROWS.slice(offset, offset + limit) } }, { 'x-total-count': String(TOTAL) })
    }
    return reply({ success: false, error: 'not in this test' })
  }) as typeof fetch
  try {
    const fox = new FoxLeague('https://foxleague.test', 50)
    const wallet = { ...liveWallet, signMessage: (m: string) => `sig:${m}` }
    let got: Awaited<ReturnType<typeof fox.upcomingMatches>> | null = null
    try {
      got = await fox.upcomingMatches(wallet)
    } catch {
      got = null // refused as partial: unknown, which every rule refuses on
    }
    assert.ok(got === null || got.matches.length === TOTAL, `${got?.matches.length} of ${TOTAL} fixtures were read as the whole list (asked: ${asked.join(' | ') || 'no limit, no offset'}); the last one read is ${got?.matches.at(-1)?.round_label}, the 10 latest are gone`)
  } finally {
    globalThis.fetch = real
  }
})

// Added by the fix: the pages as FoxLeague may serve them, and the 1v1 gate on a list read whole.
import { FoxLeague as Fox } from '../../src/foxleague/api.ts'
import { dryWallet, setup, snapshot, tournament } from '../fixtures.ts'
import type { Tournament } from '../../src/foxleague/types.ts'

async function readWith(serve: (limit: number, offset: number) => { rows: unknown[]; total?: number }) {
  const real = globalThis.fetch
  const asked: string[] = []
  globalThis.fetch = (async (url: string | URL) => {
    const u = new URL(String(url))
    const reply = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', ...headers } })
    if (u.pathname === '/api/auth/verify') return reply({ success: true, data: { token: 't1' } })
    asked.push(u.search)
    const page = serve(Number(u.searchParams.get('limit') ?? 50), Number(u.searchParams.get('offset') ?? 0))
    return reply({ success: true, data: { lead_minutes: 30, my_team_name: 'Agent', matches: page.rows } }, page.total === undefined ? {} : { 'x-total-count': String(page.total) })
  }) as typeof fetch
  try {
    const fox = new Fox('https://foxleague.test', 50)
    const got = await fox.upcomingMatches({ ...liveWallet, signMessage: (m: string) => `sig:${m}` }).catch((err: unknown) => (err instanceof Error ? err : new Error(String(err))))
    return { got, asked }
  } finally {
    globalThis.fetch = real
  }
}
const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ...ROWS[0], tournament_match_id: `r${i}`, round_label: `Matchday ${i + 1}` }))

test('R2M-3 a server that pages at less than 200 is read on by its total; without a total a short page is not read whole', async () => {
  const all = many(250)
  const capped = await readWith((limit, offset) => ({ rows: all.slice(offset, offset + Math.min(limit, 100)), total: all.length }))
  assert.ok(!(capped.got instanceof Error) && capped.got.matches.length === 250, String(capped.got instanceof Error ? capped.got.message : capped.got.matches.length))
  assert.deepEqual(capped.asked, ['?limit=200&offset=0', '?limit=200&offset=100', '?limit=200&offset=200'])
  // R76A-1: a short page without FoxLeague's total may be a part (a server that pages lower) or a failed read.
  const few = await readWith((limit, offset) => ({ rows: all.slice(offset, offset + Math.min(limit, 12)).slice(0, 12 - offset) }))
  assert.ok(few.got instanceof Error && /not read whole/.test(few.got.message), few.got instanceof Error ? few.got.message : `${few.got.matches.length} rows read as the whole list without a total`)
  assert.equal(few.asked.length, 1, 'one request for a short list')
})

test('R2M-3 rows gone between two pages, or more than five pages, are not read as the whole list', async () => {
  const gone = await readWith((limit, offset) => ({ rows: offset === 0 ? many(200) : [], total: 230 }))
  assert.ok(gone.got instanceof Error, 'rows gone between two pages')
  // With its total (R76A-1: without one the first page is refused already), so the five-page bound is what stops it.
  const huge = await readWith((limit, offset) => ({ rows: many(limit).map((r, i) => ({ ...r, tournament_match_id: `h${offset + i}` })), total: 5000 }))
  assert.ok(huge.got instanceof Error && /more than 1000 rows/.test(huge.got.message))
})

test('R2M-3 the 1v1 gate reads a list of 60 fixtures read whole as it is: none within the hour is no refusal for its size', async () => {
  // A round robin of the agent's running, its 60 fixtures listed whole, the next one 33 hours away (R14A-1's control).
  const iso = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString()
  const fixtures = Array.from({ length: 60 }, (_, i) => ({
    tournament_id: 203, tournament_title: 'T203', round_label: null, group_name: null, is_home: true, opponent_name: 'Rival',
    scheduled_at: iso((33 + i) * 60), strategy_locks_at: iso((33 + i) * 60 - 30), locked: false, phase: 'upcoming' as const, tournament_match_id: `m${i}`, home_score: null, away_score: null,
  }))
  const s = snapshot()
  s.auth!.myTournaments = { active: [(tournament(203, { status: 'active', format: 'round_robin', max_teams: 8, min_teams: 8, starts_at: iso(-120), started_at: iso(-120), round_interval_minutes: 30 }) as { tournament: Tournament }).tournament], completed: [] }
  s.auth!.upcoming = { lead_minutes: 30, my_team_name: 'Agent', matches: fixtures }
  const m = setup({ fox: { bestXiOvr: async () => ({ best_xi_ovr: 19.6 }) } })
  const [r] = await m.exec.run(m.agent(), dryWallet, s, [{ action: { type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: null, deadline_minutes: 60, ovr_min: 18, ovr_max: 20 }, reason: '' }])
  assert.equal(r!.status, 'dry_run', r!.summary)
})
