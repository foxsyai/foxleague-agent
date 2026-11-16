// P-O1 (MAINNET audit of 16 Nov 2026, section 6; the owner's decision of 16 Nov: "14 days, own start each"). The agents
// created a tournament only up to 72 hours ahead, and FoxLeague's calendar was full that far except one gap: on 16 Nov
// four agents planned that one slot, one got it, three were refused. FoxLeague takes a start up to 90 days ahead and
// answers its own free starts, hidden holds of a tournament being created included, at GET /api/tournaments/availability
// (release/mainnet-1.0 729164194: routes/tournaments.rs `tournament_availability`, `AvailabilityQuery` format, teams,
// home_and_away, developer_mode, from, days 1 to 14; the answer is tournament_slots.rs `TournamentAvailability`: from, to,
// busy, free [{first, last}], from_refusal, conflict, next_free). The create horizon is 14 days now; the plan reads
// FoxLeague's free starts for a few shapes; a failed read is unknown, never free (AGENTS.md rule 4), and the executor's
// own clash check stays the last word. Each test failed on a7e5668 before the change.
//
// The owner moved the horizon from 14 to 30 days the same day (P-O1b, test/audit-1116/P-O1b.test.ts): the tests below
// pin the 30 days and the reads in windows of up to 14 days, with the same checks at the new bound.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { FoxLeague } from '../../src/foxleague/api.ts'
import { parseAction, type Action } from '../../src/executor/actions.ts'
import { ownCreations } from '../../src/executor/rivals.ts'
import { renderDigest } from '../../src/snapshot/digest.ts'
import { takeSnapshot, type AgentSnapshot } from '../../src/snapshot/snapshot.ts'
import { SYSTEM_PROMPT } from '../../src/strategist/prompt.ts'
import { ADDR, dryWallet, setup, snapshot } from '../fixtures.ts'

const H = 3600_000
const MIN = 60_000
const DAY = 86_400_000
const ceilMin = (ms: number) => Math.ceil(ms / MIN) * MIN
const minute = (ms: number) => `${new Date(ms).toISOString().slice(0, 16)}Z`
const iso = (ms: number) => new Date(ms).toISOString()

/** The public Silver round robin of 3 of the organizer line, at a start of the action's own. */
const trio = (start: Record<string, unknown>) => ({ type: 'create_tournament', title: 'Evening Trio', format: 'round_robin', tier: 'silver', max_teams: 3, min_teams: 3, entry_fee_foxsy: 1000, registration_closes_minutes_before: 60, round_interval_minutes: 30, ...start })

async function dry(action: Action, s = snapshot()) {
  const m = setup()
  const [r] = await m.exec.run(m.agent(), dryWallet, s, [{ action, reason: '' }])
  return r!
}

test('P-O1 a create up to 30 days ahead passes the parser and the rules; a start more than 30 days ahead is refused', async () => {
  const ten = await dry(parseAction(trio({ starts_at: minute(ceilMin(Date.now() + 10 * DAY)) })))
  assert.equal(ten.status, 'dry_run', `10 days ahead: ${ten.summary}`)
  assert.equal((parseAction(trio({ starts_in_hours: 240 })) as { starts_in_hours?: number }).starts_in_hours, 240, 'whole hours up to 30 days too')
  const edge = await dry(parseAction(trio({ starts_at: minute(Math.floor((Date.now() + 30 * DAY) / MIN) * MIN - 2 * MIN) })))
  assert.equal(edge.status, 'dry_run', `just inside 30 days: ${edge.summary}`)
  const far = await dry(parseAction(trio({ starts_at: minute(ceilMin(Date.now() + 30 * DAY) + MIN) })))
  assert.equal(far.status, 'refused', far.summary)
  assert.match(far.summary, /more than 30 days from now/)
  assert.throws(() => parseAction(trio({ starts_in_hours: 721 })), /starts_in_hours must be an integer in \[2, 720\]/)
})

test('P-O1 a calendar full for 5 days: a clash names the first free start after it, and the create there passes', async () => {
  const now = Date.now()
  const s = snapshot()
  s.market.slots = [{ id: 990, title: 'Full', start: now - H, end: now + 5 * DAY }]
  const r = await dry(parseAction(trio({ starts_at: minute(ceilMin(now + 2 * DAY)) })), s)
  assert.equal(r.status, 'refused', r.summary)
  const free = /the first free start for this format and size is starts_at (\S+)/.exec(r.summary)?.[1]
  assert.equal(free, minute(ceilMin(now + 5 * DAY + H)), `the end of the full stretch plus the hour before a kickoff: ${r.summary}`)
  const ok = await dry(parseAction(trio({ starts_at: free })), s)
  assert.equal(ok.status, 'dry_run', ok.summary)
  // Full for the whole 30 days: none, said with the new horizon.
  s.market.slots = [{ id: 991, title: 'Fuller', start: now - H, end: now + 40 * DAY }]
  const none = await dry(parseAction(trio({ starts_at: minute(ceilMin(now + 2 * DAY)) })), s)
  assert.match(none.summary, /no free start the next plan can still create in the next 30 days/)
})

test('P-O1 the client reads FoxLeague\'s free starts at GET /api/tournaments/availability, with no session, and returns its answer', async () => {
  const answer = {
    from: '2026-11-16T12:33:48Z', to: '2026-11-30T12:33:48Z',
    busy: [{ tournament_id: -1, title: 'A tournament being created', start: '2026-11-26T09:00:00Z', end: '2026-11-26T11:54:00Z' }],
    free: [{ first: '2026-11-26T12:54:00Z', last: '2026-11-26T14:21:00Z' }],
    from_refusal: 'too_soon', conflict: null, next_free: '2026-11-26T13:00:00Z',
  }
  const asked: { url: string; auth: string | undefined }[] = []
  const server = createServer((req, res) => {
    asked.push({ url: req.url ?? '', auth: req.headers.authorization })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ success: true, data: answer }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const fox = new FoxLeague(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 50) as unknown as { tournamentAvailability?: (q: { format: string; teams: number; days: number }) => Promise<unknown> }
    assert.equal(typeof fox.tournamentAvailability, 'function', 'the client has no read of FoxLeague\'s calendar')
    const got = await fox.tournamentAvailability!({ format: 'round_robin', teams: 3, days: 14 })
    assert.deepEqual(got, answer)
    assert.equal(asked.length, 1)
    assert.equal(asked[0]!.url, '/api/tournaments/availability?format=round_robin&teams=3&days=14')
    assert.equal(asked[0]!.auth, undefined, 'a public route: no session')
  } finally {
    server.close()
  }
})

/** A FoxLeague and a chain for takeSnapshot, every read answered; `availability` answers the calendar. */
function world(availability: (q: { format: string; teams: number; days?: number }) => Promise<unknown>) {
  const asked: { format: string; teams: number; days?: number }[] = []
  const base = snapshot()
  const fox: Record<string, unknown> = {
    config: async () => base.config, user: async (a: string) => (a === ADDR ? base.profile : null), team: async () => base.team, players: async () => [],
    tournaments: async () => [], leaderboard: async () => ({ users: [], total: 0, limit: 200, offset: 0 }), floorPrices: async () => [], listings: async () => [],
    shopStatus: async () => base.auth!.shop, dailyAllowance: async () => base.auth!.allowance, activeMatch: async () => null,
    myTournaments: async () => ({ active: [], completed: [] }), upcomingMatches: async () => ({ lead_minutes: 30, my_team_name: 'Agent', matches: [] }),
    challengesForMe: async () => [], matchHistory: async () => [], leagueInvitations: async () => [], recentSales: async () => [],
    tournamentAvailability: async (q: { format: string; teams: number; days?: number }) => (asked.push(q), availability(q)),
  }
  const chain = { account: async () => ({ balance: 0n, nonce: 1 }), esdts: async () => [], egldUsd: async () => 25, query: async () => { throw new Error('no pool in this test') } }
  return { deps: { chain, fox } as never, asked }
}
const facts = { get: () => undefined, put: () => undefined }
type Calendar = { format: string; teams: number; free: { first: number; last: number }[] | null }[]
const calendarOf = (s: AgentSnapshot) => (s.market as { calendar?: Calendar }).calendar

test('P-O1 a planning snapshot reads FoxLeague\'s free starts for its shapes over 30 days; a failed or malformed answer is unknown with a warning, never free', async () => {
  const day5 = Date.now() + 5 * DAY
  const { deps, asked } = world(async q => {
    if (q.format === 'groups_knockout') throw new Error('HTTP 502')
    if (q.teams === 8) return { free: 'soon' }
    return { from: iso(Date.now()), to: iso(Date.now() + 14 * DAY), busy: [], free: [{ first: iso(day5), last: iso(day5 + 3 * H) }], from_refusal: 'too_soon', conflict: null, next_free: iso(day5) }
  })
  const s = await takeSnapshot(deps, { wallet: { ...dryWallet, address: ADDR } }, new Date(), { matchFacts: facts })
  const cal = calendarOf(s)
  assert.ok(cal, 'the snapshot holds no calendar of free starts')
  // The round robin of 3 finds one start: its three windows (14, 14 and 2 days); the other two stop at their first.
  assert.deepEqual(asked.map(q => `${q.format}:${q.teams}:${q.days}`).sort(), ['groups_knockout:16:14', 'round_robin:3:14', 'round_robin:3:14', 'round_robin:3:2', 'round_robin:8:14'])
  assert.deepEqual(cal.find(c => c.format === 'round_robin' && c.teams === 3)?.free, [{ first: Date.parse(iso(day5)), last: Date.parse(iso(day5 + 3 * H)) }])
  assert.equal(cal.find(c => c.format === 'round_robin' && c.teams === 8)?.free, null, 'an answer that is not the calendar is unknown')
  assert.equal(cal.find(c => c.format === 'groups_knockout')?.free, null, 'a failed read is unknown')
  assert.ok(s.warnings.some(w => /free tournament starts \(groups_knockout of 16\): HTTP 502/.test(w)), s.warnings.join('; '))
  assert.ok(s.warnings.some(w => /free tournament starts \(round_robin of 8\)/.test(w)), s.warnings.join('; '))
  // The checks before each action read no calendar (only a plan is offered starts).
  const before = asked.length
  const fresh = await takeSnapshot(deps, { wallet: { ...dryWallet, address: ADDR } }, new Date())
  assert.equal(asked.length, before)
  assert.equal(calendarOf(fresh), undefined)
})

/** A snapshot whose calendar FoxLeague answered free from `first` to `last` for every shape. */
function withCalendar(free: { first: number; last: number }[] | null, more: Partial<Record<string, typeof free>> = {}) {
  const s = snapshot()
  ;(s.market as { calendar?: Calendar }).calendar = [
    { format: 'round_robin', teams: 3, free: more.rr3 === undefined ? free : more.rr3 },
    { format: 'round_robin', teams: 8, free: more.rr8 === undefined ? free : more.rr8 },
    { format: 'groups_knockout', teams: 16, free: more.gk16 === undefined ? free : more.gk16 },
  ]
  return s
}
const shapeLine = (d: string, shape: string) => d.split('\n').find(l => l.startsWith(`  ${shape} (`)) ?? ''

test('P-O1 the plan request gives a start of its own for each shape from FoxLeague\'s free starts, days ahead; an unread shape says so and offers none', () => {
  const day6 = ceilMin(Date.now() + 6 * DAY)
  const s = withCalendar([{ first: day6, last: day6 + 2 * H }], { gk16: null })
  // One tournament on the agent's own calendar, 8 days ahead: the free gap after it reaches the end of the 30 days.
  const day8 = ceilMin(Date.now() + 8 * DAY)
  s.market.slots = [{ id: 870, title: 'Later', start: day8, end: day8 + 3 * H }]
  const d = renderDigest(s)
  assert.match(d, /Your own starts for a new tournament \(FoxLeague's calendar of free starts, next 30 days/)
  assert.match(shapeLine(d, 'round_robin of 3'), new RegExp(`your start for this shape: starts_at ${minute(day6)}(;|$)`), d)
  assert.match(shapeLine(d, 'round_robin of 8'), new RegExp(`your start for this shape: starts_at ${minute(day6)}(;|$)`))
  const unread = shapeLine(d, 'groups_knockout of 16')
  assert.match(unread, /could not read the free starts/)
  assert.doesNotMatch(unread, /starts_at/, 'unknown is never free: no start offered')
  // The free gaps of the agent's own calendar cover the 30 days too: the one after T870 is listed.
  const gaps = d.split('\n').find(l => l.startsWith("Free for a new tournament's whole window")) ?? ''
  assert.match(gaps, /^Free for a new tournament's whole window \(next 30 days;/)
  assert.match(gaps, new RegExp(`; ${minute(day8 + 3 * H)} to `), gaps)
})

test('P-O1 a start is offered only between 2 hours after the plan\'s actions and 30 days ahead, and never one the agent\'s own calendar sees taken', () => {
  const now = Date.now()
  // Free from now to 40 days ahead by FoxLeague's answer; the agent sees T880 taken from 1 to 3 days ahead.
  const s = withCalendar([{ first: now + 70 * MIN, last: now + 40 * DAY }])
  s.market.slots = [{ id: 880, title: 'Taken', start: now + DAY, end: now + 3 * DAY }]
  const line = shapeLine(renderDigest(s, { tickMinutes: 30 }), 'round_robin of 3')
  const own = /your start for this shape: starts_at (\S+?)(;|$)/.exec(line)?.[1]
  assert.ok(own, line)
  // 2 hours plus the plan's lead (a 30-minute tick: 0.8 of it and 15 minutes for the call) after now, at the earliest.
  assert.ok(Date.parse(own) >= now + 2 * H + 39 * MIN, `too soon for the create to find it 2 hours ahead: ${line}`)
  const all = [own, ...(/the next free ones[^:]*: (.*)$/.exec(line)?.[1] ?? '').split(', ').filter(Boolean)].map(x => Date.parse(x))
  for (const t of all) {
    assert.ok(t <= now + 30 * DAY, `beyond 30 days: ${line}`)
    assert.ok(!(t - H < now + 3 * DAY && t + 69 * MIN > now + DAY), `inside T880's window: ${line}`)
  }
})

test('P-O1 the agent widens the range of a tournament it created 10 days before (its log is read back past the 30 days a start can be ahead)', () => {
  const m = setup()
  m.store.log({ agentIndex: 0, kind: 'create_tournament', status: 'confirmed', summary: 'create (T7001)', detail: { action: { type: 'create_tournament' }, reason: '', createdTournamentId: 7001 } })
  assert.ok(ownCreations(m.store, 0, new Date(Date.now() + 10 * DAY)).has(7001), 'a create of 10 days ago is no longer the agent\'s own')
  assert.ok(!ownCreations(m.store, 0, new Date(Date.now() + 32 * DAY)).has(7001), 'bounded: not for ever')
})

test('P-O1 the prompt\'s create line gives the 30-day horizon', () => {
  const line = SYSTEM_PROMPT.split('\n').find(l => l.startsWith('- {"type":"create_tournament"')) ?? ''
  assert.match(line, /a UTC minute 2 hours to 30 days after the action runs/)
  assert.doesNotMatch(line, /72 hours/)
})

test('P-O1 the docs and the site say 30 days and that each agent is offered its own start', () => {
  const read = (f: string) => readFileSync(join(import.meta.dirname, '..', '..', f), 'utf8').replace(/\s+/g, ' ')
  const economy = read('docs/ECONOMY-AND-RULES.md')
  assert.match(economy, /2 hours to 30 days ahead/)
  assert.match(economy, /GET \/api\/tournaments\/availability/)
  assert.match(economy, /its own start/)
  const notes = read('docs/FOXLEAGUE-INTEGRATION.md')
  assert.match(notes, /a whole UTC minute 2 hours to 30 days after the create runs/)
  assert.match(notes, /GET \/api\/tournaments\/availability\?format=\{format\}&teams=\{n\}&from=\{RFC 3339\}&days=\{1 to 14\}/)
  assert.match(notes, /its own start/)
  const site = read('site/src/content/docs/play/how-it-plays.md')
  assert.match(site, /It names the start to the minute, 2 hours to 30 days ahead/)
  assert.match(site, /a start of its own/)
  for (const [name, text] of [['economy', economy], ['notes', notes], ['site', site]] as const) assert.doesNotMatch(text, /2 to 72 hours/, name)
})
