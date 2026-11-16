// P-O1b (the owner's decision of 16 Nov 2026, after P-O1): the organizer horizon goes from 14 to 30 days. FoxLeague
// takes a start up to 90 days ahead, but GET /api/tournaments/availability answers at most 14 days a read (`days` 1 to
// 14 from `from`; tournament_slots.rs MAX_DAYS, release/mainnet-1.0 729164194). The 30 days are read in up to three
// windows a shape (0 to 14, 14 to 28, 28 to 30 days), the next one only while fewer than 10 free starts of that shape
// were found, so a calendar with room costs one read a shape. Any failed or malformed window makes the shape unknown,
// never a partial list presented as complete. Each test failed on d855800 (the 14-day head) before the change.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseAction, type Action } from '../../src/executor/actions.ts'
import { ownCreations } from '../../src/executor/rivals.ts'
import { blockingWindow } from '../../src/executor/slots.ts'
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

const trio = (start: Record<string, unknown>) => ({ type: 'create_tournament', title: 'Evening Trio', format: 'round_robin', tier: 'silver', max_teams: 3, min_teams: 3, entry_fee_foxsy: 1000, registration_closes_minutes_before: 60, round_interval_minutes: 30, ...start })

async function dry(action: Action, s = snapshot()) {
  const m = setup()
  const [r] = await m.exec.run(m.agent(), dryWallet, s, [{ action, reason: '' }])
  return r!
}

test('P-O1b a create up to 30 days ahead passes the parser and the rules; more than 30 days is refused', async () => {
  const twenty = await dry(parseAction(trio({ starts_at: minute(ceilMin(Date.now() + 20 * DAY)) })))
  assert.equal(twenty.status, 'dry_run', `20 days ahead: ${twenty.summary}`)
  const edge = await dry(parseAction(trio({ starts_at: minute(Math.floor((Date.now() + 30 * DAY) / MIN) * MIN - 2 * MIN) })))
  assert.equal(edge.status, 'dry_run', `just inside 30 days: ${edge.summary}`)
  const far = await dry(parseAction(trio({ starts_at: minute(ceilMin(Date.now() + 30 * DAY) + MIN) })))
  assert.equal(far.status, 'refused', far.summary)
  assert.match(far.summary, /more than 30 days from now/)
  assert.equal((parseAction(trio({ starts_in_hours: 720 })) as { starts_in_hours?: number }).starts_in_hours, 720)
  assert.throws(() => parseAction(trio({ starts_in_hours: 721 })), /starts_in_hours must be an integer in \[2, 720\]/)
})

test('P-O1b a calendar full for 20 days: a clash names the first free start after it; full for 40 days: none in the next 30 days', async () => {
  const now = Date.now()
  const s = snapshot()
  s.market.slots = [{ id: 992, title: 'Full', start: now - H, end: now + 20 * DAY }]
  const r = await dry(parseAction(trio({ starts_at: minute(ceilMin(now + 2 * DAY)) })), s)
  assert.equal(/the first free start for this format and size is starts_at (\S+)/.exec(r.summary)?.[1], minute(ceilMin(now + 20 * DAY + H)), r.summary)
  s.market.slots = [{ id: 993, title: 'Fuller', start: now - H, end: now + 40 * DAY }]
  const none = await dry(parseAction(trio({ starts_at: minute(ceilMin(now + 2 * DAY)) })), s)
  assert.match(none.summary, /no free start the next plan can still create in the next 30 days/)
})

test('P-O1b the agent widens the range of a tournament it created 25 days before; not one of 32 days', () => {
  const m = setup()
  m.store.log({ agentIndex: 0, kind: 'create_tournament', status: 'confirmed', summary: 'create (T7002)', detail: { action: { type: 'create_tournament' }, reason: '', createdTournamentId: 7002 } })
  assert.ok(ownCreations(m.store, 0, new Date(Date.now() + 25 * DAY)).has(7002), 'a create of 25 days ago is no longer the agent\'s own')
  assert.ok(!ownCreations(m.store, 0, new Date(Date.now() + 32 * DAY)).has(7002), 'bounded: not for ever')
})

/** A FoxLeague and a chain for takeSnapshot, every read answered; `availability` answers the calendar. */
type Query = { format: string; teams: number; days?: number; from?: string }
function world(availability: (q: Query) => Promise<unknown>) {
  const asked: Query[] = []
  const base = snapshot()
  const fox: Record<string, unknown> = {
    config: async () => base.config, user: async (a: string) => (a === ADDR ? base.profile : null), team: async () => base.team, players: async () => [],
    tournaments: async () => [], leaderboard: async () => ({ users: [], total: 0, limit: 200, offset: 0 }), floorPrices: async () => [], listings: async () => [],
    shopStatus: async () => base.auth!.shop, dailyAllowance: async () => base.auth!.allowance, activeMatch: async () => null,
    myTournaments: async () => ({ active: [], completed: [] }), upcomingMatches: async () => ({ lead_minutes: 30, my_team_name: 'Agent', matches: [] }),
    challengesForMe: async () => [], matchHistory: async () => [], leagueInvitations: async () => [], recentSales: async () => [],
    tournamentAvailability: async (q: Query) => (asked.push(q), availability(q)),
  }
  const chain = { account: async () => ({ balance: 0n, nonce: 1 }), esdts: async () => [], egldUsd: async () => 25, query: async () => { throw new Error('no pool in this test') } }
  return { deps: { chain, fox } as never, asked }
}
const facts = { get: () => undefined, put: () => undefined }
type Calendar = { format: string; teams: number; free: { first: number; last: number }[] | null }[]
const calendarOf = (s: AgentSnapshot) => (s.market as { calendar?: Calendar }).calendar
const plan = (deps: never, now: Date) => takeSnapshot(deps, { wallet: { ...dryWallet, address: ADDR } }, now, { matchFacts: facts })

/** FoxLeague's answer for a window, free only where `open` overlaps it (clipped to the window, as free_starts does). */
function answer(q: Query, now: number, open: { first: number; last: number }[]) {
  const from = Math.max(Date.parse(q.from ?? iso(now)), now)
  const to = from + (q.days ?? 7) * DAY
  const lo = Math.max(from, now + 70 * MIN)
  const free = open.filter(r => r.last >= lo && r.first <= to).map(r => ({ first: iso(Math.max(r.first, lo)), last: iso(Math.min(r.last, to)) }))
  return { from: iso(from), to: iso(to), busy: [], free, from_refusal: 'too_soon', conflict: null, next_free: free[0]?.first ?? null }
}

test('P-O1b a calendar with room costs one read a shape; a full one is read in three windows up to 30 days, and a start found after 14 days is offered', async () => {
  const now = Date.now()
  // Room: free over the whole 30 days for every shape.
  const roomy = world(async q => answer(q, now, [{ first: now, last: now + 40 * DAY }]))
  await plan(roomy.deps, new Date(now))
  assert.equal(roomy.asked.length, 3, `one read a shape: ${JSON.stringify(roomy.asked)}`)
  assert.ok(roomy.asked.every(q => q.days === 14 && Date.parse(q.from!) === now), JSON.stringify(roomy.asked))
  // Full but for one gap 20 days ahead and one 29 days ahead: three windows a shape, 0 to 14, 14 to 28, 28 to 30 days.
  const g20 = ceilMin(now + 20 * DAY)
  const g29 = ceilMin(now + 29 * DAY)
  const full = world(async q => answer(q, now, [{ first: g20, last: g20 + H }, { first: g29, last: g29 + H }]))
  const s = await plan(full.deps, new Date(now))
  const rr3 = full.asked.filter(q => q.format === 'round_robin' && q.teams === 3).map(q => [Date.parse(q.from!) - now, q.days])
  assert.deepEqual(rr3, [[0, 14], [14 * DAY, 14], [28 * DAY, 2]])
  assert.equal(full.asked.length, 9)
  const line = renderDigest(s).split('\n').find(l => l.startsWith('  round_robin of 3 (')) ?? ''
  assert.match(line, new RegExp(`your start for this shape: starts_at ${minute(g20)}; the next free ones \\(only if yours is refused\\): ${minute(g29)}$`), line)
})

test('P-O1b the next window is read only while fewer than 10 starts of the shape were found', async () => {
  const now = Date.now()
  // The first window holds 4 starts, the second 8 more: the third is not read.
  const open = [{ first: now + 5 * DAY, last: now + 5 * DAY + 11 * H }, { first: now + 16 * DAY, last: now + 16 * DAY + 26 * H }]
  const w = world(async q => answer(q, now, open))
  const s = await plan(w.deps, new Date(now))
  const rr3 = w.asked.filter(q => q.format === 'round_robin' && q.teams === 3).map(q => Date.parse(q.from!) - now)
  assert.deepEqual(rr3, [0, 14 * DAY], 'two windows, not three')
  const line = renderDigest(s).split('\n').find(l => l.startsWith('  round_robin of 3 (')) ?? ''
  assert.match(line, /your start for this shape: starts_at \S+; the next free ones/, line)
})

test('P-O1b a failed or malformed later window makes the shape unknown, never a partial list', async () => {
  const now = Date.now()
  const g5 = ceilMin(now + 5 * DAY)
  for (const bad of [async () => { throw new Error('HTTP 502') }, async () => ({ free: [{ first: 'soon', last: 'later' }] })]) {
    const w = world(async q => (Date.parse(q.from ?? iso(now)) - now >= 14 * DAY ? bad() : answer(q, now, [{ first: g5, last: g5 + H }])))
    const s = await plan(w.deps, new Date(now))
    for (const c of calendarOf(s) ?? []) assert.equal(c.free, null, `${c.format} of ${c.teams}: the first window alone was presented: ${JSON.stringify(c.free)}`)
    const line = renderDigest(s).split('\n').find(l => l.startsWith('  round_robin of 3 (')) ?? ''
    assert.match(line, /could not read the free starts \(unknown, not free\)/, line)
    assert.ok(s.warnings.some(w2 => /free tournament starts \(round_robin of 3\)/.test(w2)), s.warnings.join('; '))
  }
})

test('P-O1b a free stretch across two windows is one: the starts listed stay a booking apart at the seam', async () => {
  const now = Date.now()
  // Free from 13 to 16 days ahead: the first window ends at 14 days, the second begins there.
  const w = world(async q => answer(q, now, [{ first: now + 13 * DAY, last: now + 16 * DAY }]))
  const s = await plan(w.deps, new Date(now))
  const starts: number[] = []
  for (let i = 0; i < 10; i++) {
    const t = { ...s, agent: { ...s.agent, index: i } }
    const line = renderDigest(t).split('\n').find(l => l.startsWith('  groups_knockout of 16 (')) ?? ''
    const own = /your start for this shape: starts_at (\S+?);/.exec(line)?.[1]
    if (own) starts.push(Date.parse(own))
  }
  const sorted = [...new Set(starts)].sort((a, b) => a - b)
  assert.ok(sorted.length >= 10, `starts: ${sorted.map(minute).join(', ')}`)
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(blockingWindow('groups_knockout', 16, false, sorted[i - 1]!).end <= blockingWindow('groups_knockout', 16, false, sorted[i]!).start, `${minute(sorted[i - 1]!)} and ${minute(sorted[i]!)} overlap at the seam`)
  }
})

test('P-O1b the plan request, the prompt, the docs and the site say 30 days', () => {
  const now = Date.now()
  const s = snapshot()
  const day20 = ceilMin(now + 20 * DAY)
  s.market.slots = [{ id: 871, title: 'Later', start: day20, end: day20 + 3 * H }]
  ;(s.market as { calendar?: Calendar }).calendar = [{ format: 'round_robin', teams: 3, free: [{ first: day20 + 5 * H, last: day20 + 6 * H }] }]
  const d = renderDigest(s)
  const gaps = d.split('\n').find(l => l.startsWith("Free for a new tournament's whole window")) ?? ''
  assert.match(gaps, /^Free for a new tournament's whole window \(next 30 days;/)
  assert.match(gaps, new RegExp(`; ${minute(day20 + 3 * H)} to `), 'the gap after 20 days is listed')
  assert.match(d, /Your own starts for a new tournament \(FoxLeague's calendar of free starts, next 30 days/)
  const line = SYSTEM_PROMPT.split('\n').find(l => l.startsWith('- {"type":"create_tournament"')) ?? ''
  assert.match(line, /a UTC minute 2 hours to 30 days after the action runs/)
  const read = (f: string) => readFileSync(join(import.meta.dirname, '..', '..', f), 'utf8').replace(/\s+/g, ' ')
  assert.match(read('docs/ECONOMY-AND-RULES.md'), /2 hours to 30 days ahead/)
  assert.match(read('docs/FOXLEAGUE-INTEGRATION.md'), /a whole UTC minute 2 hours to 30 days after the create runs/)
  assert.match(read('docs/FOXLEAGUE-INTEGRATION.md'), /up to three reads/)
  assert.match(read('site/src/content/docs/play/how-it-plays.md'), /It names the start to the minute, 2 hours to 30 days ahead/)
  for (const f of ['docs/ECONOMY-AND-RULES.md', 'docs/FOXLEAGUE-INTEGRATION.md', 'site/src/content/docs/play/how-it-plays.md']) assert.doesNotMatch(read(f), /2 hours to 14 days/, f)
})
