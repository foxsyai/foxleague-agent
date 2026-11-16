// FC-2 (low; R2M-3 and R76A-1 leave a part read as the whole): upcomingMatches (src/foxleague/api.ts:302-322) takes the
// list as whole as soon as it holds as many ROWS as the total of the page read last. It never checks that the rows are
// the list's rows: not that each is there once, and not that the total stayed the one of the first page. Its comment
// says "rows gone between two pages ... throw"; only an EMPTY later page throws.
//
// FoxLeague's list is live (release/mainnet-1.0 729164194, backend/src/routes/tournaments.rs upcoming_matches): the rows
// are `ORDER BY tm.scheduled_at ASC, tm.id ASC LIMIT $2 OFFSET $3`, the total is a second query (`SELECT COUNT(*)`, no
// transaction around the two), the last day's finished games stand at the FRONT and leave it as they age out, and
// fixtures are added in the middle (a tournament going active writes all its fixtures; a knockout's next round is
// listed when the match before it ends). So:
//   (a) a team with 6 fixtures; a tournament of its own goes active between FoxLeague's row read and its count: the
//       page holds the 6 old rows, the total says 9. The agent asks offset 6 and gets the 3 rows that sort last NOW:
//       fixtures it already holds. 9 rows, total 9: read as whole, 3 fixtures twice, the 3 new ones (the soonest) missing.
//   (b) a list longer than a page; between the two pages a finished game leaves the front: every row moves up by one,
//       the row that was the 201st is on no page read, the total drops by one and the row count matches it.
// Either way a fixture is cut from a list every rule reads as whole: the 1v1 busy gate (rules.ts oneVOneBusy), the
// casual and ranked lockout (tournamentMatchWithinHour), the matches a tournament under way still owes (the schedule
// rule of paid joins). The "page of 50" refusal that used to stand in for this was removed by R2M-3.
//
// Right: a list that moved while it was read (a total that changed between two pages, a fixture twice) is not read
// whole: it throws, the snapshot keeps it unread and the rules refuse; the next snapshot reads it again.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FoxLeague } from '../../src/foxleague/api.ts'
import type { Tournament, UpcomingMatch, UpcomingMatches } from '../../src/foxleague/types.ts'
import { dryWallet, liveWallet, setup, snapshot, tournament } from '../fixtures.ts'

const NOW = Date.now()
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString()
const fixture = (id: string, kickoffMinutes: number, tournamentId = 900, phase: UpcomingMatch['phase'] = 'upcoming') => ({
  tournament_id: tournamentId, tournament_title: `T${tournamentId}`, round_label: id, group_name: null, is_home: true, opponent_name: `Rival of ${id}`,
  scheduled_at: at(kickoffMinutes), strategy_locks_at: at(kickoffMinutes - 30), locked: false, phase, tournament_match_id: id, home_score: null, away_score: null,
})
type Row = ReturnType<typeof fixture>
const sorted = (rows: Row[]) => [...rows].sort((x, y) => Date.parse(x.scheduled_at) - Date.parse(y.scheduled_at))

/** Reads the upcoming matches from a FoxLeague whose list is `list(request number)`: the rows and the total are read apart, as FoxLeague does. */
async function read(serve: (request: number, limit: number, offset: number) => { rows: Row[]; total: number }) {
  const real = globalThis.fetch
  let request = 0
  globalThis.fetch = (async (url: string | URL) => {
    const u = new URL(String(url))
    const reply = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', ...headers } })
    if (u.pathname === '/api/auth/verify') return reply({ success: true, data: { token: 't1' } })
    if (u.pathname !== '/api/tournaments/upcoming-matches') return reply({ success: false, error: 'not in this test' })
    const limit = Math.min(200, Math.max(1, Number(u.searchParams.get('limit') ?? 50)))
    const page = serve(request++, limit, Math.max(0, Number(u.searchParams.get('offset') ?? 0)))
    return reply({ success: true, data: { lead_minutes: 30, my_team_name: 'Agent', my_team_badge: null, matches: page.rows } }, { 'x-total-count': String(page.total) })
  }) as typeof fetch
  try {
    const fox = new FoxLeague('https://foxleague.test', 50)
    const got: UpcomingMatches | Error = await fox.upcomingMatches({ ...liveWallet, signMessage: (m: string) => `sig:${m}` }).catch((err: unknown) => (err instanceof Error ? err : new Error(String(err))))
    return { got, requests: request }
  } finally {
    globalThis.fetch = real
  }
}

/** The list is whole when it holds every fixture of `list` exactly once; anything else must have thrown. */
function wholeOrUnread(got: UpcomingMatches | Error, list: Row[], what: string) {
  if (got instanceof Error) {
    assert.match(got.message, /not read whole/)
    return
  }
  const ids = got.matches.map(m => m.tournament_match_id)
  const missing = list.map(r => r.tournament_match_id).filter(id => !ids.includes(id))
  const twice = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))]
  assert.ok(!missing.length && !twice.length, `${what}: ${got.matches.length} rows were read as the whole list of ${list.length}; missing: ${missing.join(', ') || 'none'}; read twice: ${twice.join(', ') || 'none'}`)
}

/** The team of case (a): six fixtures of a round robin from 5 hours on, and a second round robin that has just gone active. */
const OLD = Array.from({ length: 6 }, (_, i) => fixture(`old${i}`, 300 + i * 60))
const ADDED = [fixture('new0', 40, 901), fixture('new1', 70, 901), fixture('new2', 100, 901)]
const GROWN = sorted([...OLD, ...ADDED])
/** FoxLeague's row read saw the six, its count a moment later the nine; the next request sees the nine. */
const readGrown = () => read((request, limit, offset) => (request === 0 ? { rows: sorted(OLD).slice(offset, offset + limit), total: GROWN.length } : { rows: GROWN.slice(offset, offset + limit), total: GROWN.length }))

test('FC-2 (a) fixtures added between FoxLeague\'s row read and its count are not hidden behind rows read twice', async () => {
  const { got, requests } = await readGrown()
  assert.equal(requests, 2, 'the agent asked for the rest of the list')
  wholeOrUnread(got, GROWN, 'a list that grew while it was read')
})

test('FC-2 (a) what it costs: a 1v1 stake is not paid with a kickoff 40 minutes away that the list read lost', async () => {
  const running = (id: number, startedMinutesAgo: number) => (tournament(id, { status: 'active', format: 'round_robin', max_teams: 8, min_teams: 4, starts_at: at(-startedMinutesAgo), started_at: at(-startedMinutesAgo), round_interval_minutes: 30 }) as { tournament: Tournament }).tournament
  const challenge = async (upcoming: UpcomingMatches | null) => {
    const s = snapshot()
    s.auth!.myTournaments = { active: [running(900, 120), running(901, 1)], completed: [] }
    s.auth!.upcoming = upcoming
    if (!upcoming) s.warnings.push('upcoming matches: not read whole')
    const m = setup({ fox: { bestXiOvr: async () => ({ best_xi_ovr: 19.6 }) } })
    const [r] = await m.exec.run(m.agent(), dryWallet, s, [{ action: { type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: null, deadline_minutes: 60, ovr_min: 18, ovr_max: 20 }, reason: '' }])
    return r!
  }
  // Control: the list as it is refuses the stake (FoxLeague calls the team busy from an hour before a kickoff), and
  // the same team without the new tournament's fixtures would be free to pay it.
  const whole = await challenge({ lead_minutes: 30, my_team_name: 'Agent', matches: GROWN as never })
  assert.equal(whole.status, 'refused', whole.summary)
  assert.match(whole.summary, /T901 match at .*busy from an hour before kickoff/)
  // The list as the agent read it.
  const { got } = await readGrown()
  const r = await challenge(got instanceof Error ? null : got)
  assert.equal(r.status, 'refused', `the 1,000 FOXSY stake passed the busy gate on a list that lost the kickoff in 40 minutes: ${r.summary}`)
})

test('FC-2 (b) a finished game that leaves the front between two pages does not cut the fixture at the page\'s edge', async () => {
  // 250 rows: one finished game from 23 h 59 min ago at the front, then 249 fixtures.
  const before = sorted([fixture('finished', -24 * 60 + 1, 900, 'finished'), ...Array.from({ length: 249 }, (_, i) => fixture(`m${i}`, 90 + i * 30))])
  // By the second page the finished game is older than FoxLeague's 24 hours: gone from the list and from the count.
  const after = before.slice(1)
  const { got, requests } = await read((request, limit, offset) => {
    const list = request === 0 ? before : after
    return { rows: list.slice(offset, offset + limit), total: list.length }
  })
  assert.equal(requests, 2)
  wholeOrUnread(got, after, 'a list that lost its first row between two pages')
})

test('FC-2 (c) a fixture added before the page\'s edge between two pages is not hidden behind a row read twice', async () => {
  const before = sorted(Array.from({ length: 250 }, (_, i) => fixture(`m${i}`, 90 + i * 30)))
  // The next round of a knockout is listed: its kickoff in 2 hours, the second row of the list.
  const after = sorted([...before, fixture('next-round', 105, 901)])
  const { got } = await read((request, limit, offset) => {
    const list = request === 0 ? before : after
    return { rows: list.slice(offset, offset + limit), total: list.length }
  })
  wholeOrUnread(got, after, 'a list that grew before the page\'s edge between two pages')
})

test('FC-2 control: a list that stands still is read whole, one page or two', async () => {
  for (const n of [0, 6, 200, 250]) {
    const list = sorted(Array.from({ length: n }, (_, i) => fixture(`m${i}`, 90 + i * 30)))
    const { got } = await read((_request, limit, offset) => ({ rows: list.slice(offset, offset + limit), total: list.length }))
    assert.ok(!(got instanceof Error), got instanceof Error ? got.message : '')
    assert.deepEqual(got.matches.map(m => m.tournament_match_id), list.map(r => r.tournament_match_id))
  }
})

// Added by the fix: the other ways a list can move while it is read, or be read without a way to tell.
test('FC-2 (d) a page holding more rows than FoxLeague\'s count of them is not read whole', async () => {
  // FoxLeague read six rows, then two finished games aged out and a new fixture was listed before it counted: five.
  const six = sorted(Array.from({ length: 6 }, (_, i) => fixture(`m${i}`, 90 + i * 30)))
  const { got, requests } = await read(() => ({ rows: six, total: 5 }))
  assert.equal(requests, 1)
  assert.ok(got instanceof Error && /not read whole/.test(got.message), got instanceof Error ? got.message : `${got.matches.length} rows read as the whole list of 5`)
})

test('FC-2 (e) a list of more than one page whose rows carry no id cannot be told whole, one page can', async () => {
  const unnamed = (n: number) => sorted(Array.from({ length: n }, (_, i) => ({ ...fixture(`m${i}`, 90 + i * 30), tournament_match_id: null as unknown as string })))
  const many = unnamed(250)
  const two = await read((_request, limit, offset) => ({ rows: many.slice(offset, offset + limit), total: many.length }))
  assert.ok(two.got instanceof Error && /not read whole/.test(two.got.message), two.got instanceof Error ? two.got.message : `${two.got.matches.length} rows without an id read as whole over two pages`)
  const few = unnamed(6)
  const one = await read((_request, limit, offset) => ({ rows: few.slice(offset, offset + limit), total: few.length }))
  assert.ok(!(one.got instanceof Error) && one.got.matches.length === 6, one.got instanceof Error ? one.got.message : String(one.got.matches.length))
})
