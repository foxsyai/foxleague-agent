// A tournament start to the minute (2026-11-15). Seen live at 17:09 UTC: following the owner's organizer line, agents 7
// and 9 each planned a public Silver round robin in the only free gap of FoxLeague's calendar in the next 72 hours,
// 17 Nov 18:48 to 21:00 UTC. A tournament books 1 h before its start to 1 h after its estimate (3 minutes a match), so
// only a 3-team round robin fits, starting from 19:48 to 19:51. Both sent "starts_in_hours": 50.7 and parseAction
// refused it ("starts_in_hours must be an integer in [2, 72]"); whole hours from the moment the create runs (up to most
// of a tick after the plan) cannot land in a 3-minute window. One test per point, named after it; each failed on the
// branch at f9ca5f0 before the fix.
//
// FoxLeague (release/mainnet-1.0 fb820dd57, backend/src/tournament_slots.rs and routes/tournaments.rs
// create_tournament_inner): `starts_at` is any instant (RFC 3339), never rounded or aligned; create asks only that it is
// more than 1 hour from now (`far_enough`), at most 90 days ahead (`too_far`), more than 5 minutes after the deadline,
// and that its booking [start - 1 h, start + estimate + 1 h) overlaps no other (half-open: touching is free). Only the
// calendar's proposal (`next_free`) is on the quarter hour.

import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describeAction, parseAction, type Action } from '../src/executor/actions.ts'
import { budgetView } from '../src/executor/budget.ts'
import { actionDeadline } from '../src/executor/deadlines.ts'
import { renderDigest } from '../src/snapshot/digest.ts'
import { SYSTEM_PROMPT } from '../src/strategist/prompt.ts'
import { renderPlanRequest } from '../src/strategist/strategist.ts'
import { TEST_SETTINGS, dryWallet, liveWallet, setup, snapshot, tournament, withLive } from './fixtures.ts'

const H = 3600_000
const MIN = 60_000
/** Two days from now (UTC): 18:48 that day is 42 to 67 hours ahead, whatever the time the suite runs. */
const DAY = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)
const at = (hm: string) => Date.parse(`${DAY}T${hm}Z`)
/** A whole UTC minute in the form the action takes. */
const minute = (ms: number) => `${new Date(ms).toISOString().slice(0, 16)}Z`

const LIVE_FEES = { live: true, live_from: '2026-11-09T14:00:00Z', private_match_fee_foxsy: 0, calendar_deposit_per_match_foxsy: 25, calendar_deposit_min_foxsy: 0, calendar_deposit_grace_minutes: 60 }
const NOTHING_OWED = { owed: false, games: 0, private_fee_foxsy: 0, deposit_foxsy: 0, total_foxsy: 0, grace_minutes: 60, no_free_cancel: false }

/** FoxLeague's calendar of 15 Nov, two days ahead: taken until 18:48 and again from 21:00, nothing free in between. */
function busyCalendar(s = snapshot()) {
  s.market.slots = [
    { id: 901, title: 'Before', start: Date.now() - H, end: at('18:48') },
    { id: 902, title: 'After', start: at('21:00'), end: Date.now() + 100 * H },
  ]
  return s
}

/** The public Silver round robin of 3 agents 7 and 9 planned, at a start of the action's own. */
const trio = (start: Record<string, unknown>) => ({ type: 'create_tournament', title: 'Evening Trio', format: 'round_robin', tier: 'silver', max_teams: 3, min_teams: 3, entry_fee_foxsy: 1000, registration_closes_minutes_before: 60, round_interval_minutes: 30, ...start })

/** One dry run of one action, on an executor of its own (each create books its fee in the dry ledger). */
async function dry(action: Action, s = busyCalendar()) {
  const m = setup()
  const [r] = await m.exec.run(m.agent(), dryWallet, s, [{ action, reason: '' }])
  return r!
}

test('SM-1 the live case: a 3-team round robin in the only gap of 72 hours (18:48 to 21:00 UTC two days ahead) at 19:49 is parsed, passes the slot check and FoxLeague is sent 19:49', async () => {
  const action = parseAction(trio({ starts_at: `${DAY}T19:49Z` }))
  assert.equal((action as { starts_at?: string }).starts_at, `${DAY}T19:49:00.000Z`, 'kept as the UTC minute it names')
  assert.match(describeAction(action), new RegExp(`starts ${DAY} 19:49 UTC`))
  const quoted: unknown[] = []
  const created: Record<string, unknown>[] = []
  const m = setup({
    fox: {
      organizerFeeQuote: async (_w: unknown, body: Record<string, unknown>) => (quoted.push(body.starts_at), NOTHING_OWED),
      createTournament: async (_w: unknown, body: Record<string, unknown>) => (created.push({ ...body }), { id: 55 }),
      tournament: async () => tournament(55),
      joinTournament: async () => ({}),
    },
  })
  const s = busyCalendar()
  s.config!.organizer_fees = LIVE_FEES
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, s, [{ action, reason: '' }])
    assert.equal(r!.status, 'confirmed', r!.summary)
  })
  assert.deepEqual(quoted, [`${DAY}T19:49:00.000Z`], 'the organizer quote is asked for that start')
  assert.equal(created.length, 1)
  assert.equal(created[0]!.starts_at, `${DAY}T19:49:00.000Z`, 'FoxLeague is sent the minute the plan named, not a time counted from the run')
  assert.equal(created[0]!.deadline, `${DAY}T18:49:00.000Z`, 'registration closes 60 minutes before it')
})

test('SM-2 a start one minute too early (19:47) or too late (19:52) for the gap is refused by the slot check, with the first free start as starts_at, which lands in the gap', async () => {
  for (const [hm, by] of [['19:47', 901], ['19:52', 902]] as const) {
    const r = await dry(parseAction(trio({ starts_at: `${DAY}T${hm}Z` })))
    assert.equal(r.status, 'refused', `${hm}: ${r.summary}`)
    assert.match(r.summary, new RegExp(`time slot taken by T${by}`), hm)
    const free = /the first free start for this format and size is starts_at (\S+)/.exec(r.summary)?.[1]
    assert.equal(free, `${DAY}T19:48Z`, `${hm}: the first free minute, in the form the parser takes: ${r.summary}`)
    assert.doesNotMatch(r.summary, /starts_in_hours/, 'never whole hours: they are stale by the next plan and miss a gap like this one')
    const ok = await dry(parseAction(trio({ starts_at: free })))
    assert.equal(ok.status, 'dry_run', `the start it names fits: ${ok.summary}`)
  }
  // Both edges fit: a booking that ends where another starts does not overlap it (FoxLeague's half-open windows).
  for (const hm of ['19:48', '19:51']) {
    const r = await dry(parseAction(trio({ starts_at: `${DAY}T${hm}Z` })))
    assert.equal(r.status, 'dry_run', `${hm}: ${r.summary}`)
  }
})

test('SM-3 a start less than 2 hours or more than 72 hours after the create runs is refused', async () => {
  const empty = () => snapshot()
  const now = Date.now()
  const ceil = (ms: number) => Math.ceil(ms / MIN) * MIN
  const floor = (ms: number) => Math.floor(ms / MIN) * MIN
  const soon = await dry(parseAction(trio({ starts_at: minute(ceil(now) + 119 * MIN) })), empty())
  assert.equal(soon.status, 'refused', soon.summary)
  assert.match(soon.summary, /less than 2 hours/)
  const far = await dry(parseAction(trio({ starts_at: minute(ceil(now + 72 * H) + MIN) })), empty())
  assert.equal(far.status, 'refused', far.summary)
  assert.match(far.summary, /more than 72 hours/)
  // Inside the bounds, by a minute or two.
  assert.equal((await dry(parseAction(trio({ starts_at: minute(ceil(now + 2 * H) + 2 * MIN) })), empty())).status, 'dry_run')
  assert.equal((await dry(parseAction(trio({ starts_at: minute(floor(now + 72 * H) - 2 * MIN) })), empty())).status, 'dry_run')
  // The whole hours keep their own bounds at the parser.
  for (const h of [1, 73]) assert.throws(() => parseAction(trio({ starts_in_hours: h })), /starts_in_hours must be an integer in \[2, 72\]/)
})

test('SM-4 a start that cannot be read is refused: by the parser for a plan, by the rules for an action built another way', async () => {
  for (const bad of [
    `${DAY} 19:49`, // no T
    `${DAY}T19:49`, // no zone
    `${DAY}T19:49+02:00`, // not UTC
    `${DAY}T19:49:30Z`, // not a whole minute
    `${DAY}T19:49:00.5Z`,
    '2026-02-30T10:00Z', // no such day (Date.parse rolls it to 2 March)
    `${DAY}T24:00Z`, // Date.parse takes it as the next midnight
    `${DAY}T19:60Z`,
    'in 50.7 hours',
    '',
    at('19:49'), // a number of milliseconds
  ]) {
    assert.throws(() => parseAction(trio({ starts_at: bad })), /starts_at must be a UTC minute/, String(bad))
  }
  // Neither form, or both: refused, never a guess.
  assert.throws(() => parseAction(trio({})), /starts_at must be a UTC minute/)
  assert.throws(() => parseAction(trio({ starts_at: null })), /starts_at must be a UTC minute/)
  assert.throws(() => parseAction(trio({ starts_at: `${DAY}T19:49Z`, starts_in_hours: 50 })), /starts_at or starts_in_hours, not both/)
  // What agents 7 and 9 sent stays refused: a fraction of an hour is no minute.
  assert.throws(() => parseAction(trio({ starts_in_hours: 50.7 })), /starts_in_hours must be an integer in \[2, 72\]/)
  // An action built another way (not through the parser): refused before anything is asked or paid.
  const base = parseAction(trio({ starts_at: `${DAY}T19:49Z` })) as Record<string, unknown>
  for (const start of [{ starts_at: 'tomorrow' }, { starts_at: undefined }, { starts_at: `${DAY}T19:49:00.000Z`, starts_in_hours: 50 }]) {
    const r = await dry({ ...base, ...start } as unknown as Action)
    assert.equal(r.status, 'refused', `${JSON.stringify(start)}: ${r.summary}`)
    assert.match(r.summary, /the start could not be read/)
  }
})

test('SM-5 the whole hours still work: parsed as before, created that many hours after the run, and a clash names the first free start as starts_at', async () => {
  const old = parseAction(trio({ starts_in_hours: 24 }))
  assert.equal((old as { starts_in_hours?: number }).starts_in_hours, 24)
  assert.equal('starts_at' in old, false)
  const created: Record<string, unknown>[] = []
  const m = setup({ fox: { createTournament: async (_w: unknown, body: Record<string, unknown>) => (created.push({ ...body }), { id: 55 }), tournament: async () => tournament(55), joinTournament: async () => ({}) } })
  const before = Date.now()
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, snapshot(), [{ action: old, reason: '' }])
    assert.equal(r!.status, 'confirmed', r!.summary)
  })
  const start = Date.parse(String(created[0]!.starts_at))
  assert.ok(start >= before + 24 * H && start <= Date.now() + 24 * H, `24 hours after the run: ${created[0]!.starts_at}`)
  assert.equal(Date.parse(String(created[0]!.deadline)), start - 60 * MIN)
  // In the busy calendar: the first free start in the form that lands in the gap. 24 hours always falls inside T901
  // (it runs to 18:48 on DAY, at least 42 hours ahead); 50 hours landed in the gap when run from 17:48 to 17:51 UTC.
  const r = await dry(parseAction(trio({ starts_in_hours: 24 })))
  assert.equal(r.status, 'refused', r.summary)
  assert.match(r.summary, new RegExp(`the first free start for this format and size is starts_at ${DAY}T19:48Z`))
})

test('SM-6 a create at a fixed minute runs before it is too late: its deadline is its start less 2 hours, or less its registration close and 30 minutes', () => {
  assert.equal(actionDeadline(parseAction(trio({ starts_at: `${DAY}T19:49Z` })), snapshot()), at('19:49') - 2 * H)
  assert.equal(actionDeadline(parseAction(trio({ starts_at: `${DAY}T19:49Z`, registration_closes_minutes_before: 120 })), snapshot()), at('19:49') - 150 * MIN)
  // Without a snapshot too: the start is in the action itself.
  assert.equal(actionDeadline(parseAction(trio({ starts_at: `${DAY}T19:49Z` })), null), at('19:49') - 2 * H)
  // Whole hours count from the run: no time limit, as before.
  assert.equal(actionDeadline(parseAction(trio({ starts_in_hours: 24 })), snapshot()), null)
})

test('SM-7 the free-slot hint gives each gap to the minute, rounded inward, with the first starts_at that fits; a taken window ends rounded up', async () => {
  const s = snapshot()
  // Windows that end and start on seconds, as FoxLeague's do when a tournament was created at "now + N hours".
  s.market.slots = [
    { id: 901, title: 'Before', start: Date.now() - H, end: Date.parse(`${DAY}T18:47:30Z`) },
    { id: 902, title: 'After', start: Date.parse(`${DAY}T21:00:20Z`), end: Date.now() + 100 * H },
  ]
  const d = renderDigest(s)
  const md = DAY.slice(5)
  assert.match(d, new RegExp(`T901 "Before" [^\\n]* to ${md} 18:48\\n`), 'the taken window up to its end, never a minute short')
  const line = d.split('\n').find(l => l.startsWith("Free for a new tournament's whole window")) ?? ''
  assert.match(line, new RegExp(`${DAY}T18:48Z to ${DAY}T21:00Z \\(starts_at from ${DAY}T19:48Z to ${DAY}T20:00Z less the estimate\\)`), line)
  // The start it gives fits; the minute before it does not (its window would begin at 18:47, inside T901's).
  assert.equal((await dry(parseAction(trio({ starts_at: `${DAY}T19:48Z` })), s)).status, 'dry_run')
  assert.equal((await dry(parseAction(trio({ starts_at: `${DAY}T19:47Z` })), s)).status, 'refused')
})

test('SM-8 the prompt shows the create with starts_at, a UTC minute', () => {
  const line = SYSTEM_PROMPT.split('\n').find(l => l.startsWith('- {"type":"create_tournament"')) ?? ''
  assert.match(line, /"starts_at":"YYYY-MM-DDTHH:MMZ"/)
  assert.doesNotMatch(line, /starts_in_hours/)
  assert.match(line, /2 to 72 hours after the action runs/)
})

test('SM-9 whole hours: FoxLeague is sent the start the slot check used, counted from the moment the rules ran, not from a later clock', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.now() })
  try {
    const t0 = Date.now()
    const created: Record<string, unknown>[] = []
    const m = setup({
      fox: {
        // The reads before the create take time (here 90 seconds) after the executor took its moment.
        organizerFeeQuote: async () => (mock.timers.tick(90_000), NOTHING_OWED),
        createTournament: async (_w: unknown, body: Record<string, unknown>) => (created.push({ ...body }), { id: 55 }),
        tournament: async () => tournament(55),
        joinTournament: async () => ({}),
      },
    })
    const s = snapshot()
    s.config!.organizer_fees = LIVE_FEES
    await withLive(m.store, async () => {
      const [r] = await m.exec.run(m.agent(), liveWallet, s, [{ action: parseAction(trio({ starts_in_hours: 24 })), reason: '' }])
      assert.equal(r!.status, 'confirmed', r!.summary)
    })
    assert.equal(created[0]!.starts_at, new Date(t0 + 24 * H).toISOString())
  } finally {
    mock.timers.reset()
  }
})

test('SM-10 the record has its section before the last one, a row for each point and what stays open; the integration notes say what FoxLeague takes', () => {
  const read = (f: string) => readFileSync(join(import.meta.dirname, '..', f), 'utf8')
  const review = read('docs/SECURITY-REVIEW.md')
  const start = review.indexOf('\n## A tournament start to the minute (2026-11-15)\n')
  assert.ok(start > review.indexOf('\n## GitHub review of PR #71 (2026-11-15)\n'), 'after the review of PR #71')
  // Another section may come between it and the last one (test/chat-send.test.ts pins the last).
  const next = review.indexOf('\n## ', start + 1)
  assert.ok(next > start && next <= review.indexOf('\n## One manager message at a time (2026-11-13)\n'), 'before the last section')
  const section = review.slice(start, next)
  assert.match(section, /\| Id \| Severity \| Finding \| Fix \|\n\|---\|---\|---\|---\|\n\| SM-1 \| /)
  for (let i = 1; i <= 9; i++) {
    const row = section.split('\n').find(l => l.startsWith(`| SM-${i} |`))
    assert.ok(row, `SM-${i} has its row`)
    assert.equal(row.split(' | ').length, 4, `SM-${i}: four cells`)
  }
  assert.ok(section.includes('\nStays open:\n'))
  assert.match(section, /prompt cache/)
  assert.doesNotMatch(section, /—|, and |, or |\bbots?\b/i)
  const notes = read('docs/FOXLEAGUE-INTEGRATION.md').replace(/\s+/g, ' ')
  assert.match(notes, /`starts_at` is any instant: create neither rounds it nor asks for a step/)
  assert.match(notes, /The windows are half-open/)
  assert.match(read('site/src/content/docs/play/how-it-plays.md').replace(/\s+/g, ' '), /It names the start to the minute, 2 to 72 hours ahead/)
})

// R74A-1 and R74A-2 (the GitHub review of PR #74): both starts the agent suggests (the first free start a clash names
// and the first start the snapshot gives for a gap) were the 2-hour floor itself, counted from the moment they were
// made. The create that takes one runs later: a refusal is read by the next plan, the snapshot's start by an action of
// its own plan. Each test failed on bf2f0c1 and passes now. The delays are the agent's own, at the test settings (a
// 30-minute tick, 10 minutes of jitter): a plan's actions run over 0.8 of a tick (runPlan), the next plan is timed a
// tick and its jitter after the last of them (scheduleNext), a plan call at high effort is given up after 11 min 40 s
// (deadlineMs) and an action reads a fresh snapshot first: 13 minutes for the two.
const TICK = TEST_SETTINGS.tickMinutes * MIN
const JITTER = TEST_SETTINGS.tickJitterMinutes * MIN
const WINDOW = 0.8 * TICK
const CALL = 13 * MIN
const ceilMin = (ms: number) => Math.ceil(ms / MIN) * MIN
const floorMin = (ms: number) => Math.floor(ms / MIN) * MIN
const FIRST_FREE = /the first free start for this format and size is starts_at (\S+)/

/** A dry run of the 3-team create at `start`, with the mocked clock set to `at`. */
async function createAt(start: string, s: ReturnType<typeof snapshot>, at: number) {
  mock.timers.setTime(at)
  return dry(parseAction(trio({ starts_at: start })), s)
}

/** The line of the plan request that gives the free gaps, made with the test settings at the mocked clock. */
function freeLine(s: ReturnType<typeof snapshot>): string {
  const store = setup().store
  const text = renderPlanRequest({ snapshot: s, settings: TEST_SETTINGS, budget: budgetView(store, 0, TEST_SETTINGS, true, new Date()), recent: [], dryRun: true })
  return text.split('\n').find(l => l.startsWith("Free for a new tournament's whole window")) ?? ''
}

test('R74A-1 a calendar free now: the first free start a clash names is still 2 hours ahead when the next plan creates it, one tick later or at the latest', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.now() })
  try {
    const now = Date.now()
    const s = snapshot()
    s.market.slots = [{ id: 950, title: 'Later', start: now + 30 * H, end: now + 40 * H }]
    const r = await dry(parseAction(trio({ starts_at: minute(ceilMin(now + 35 * H)) })), s)
    assert.equal(r.status, 'refused', r.summary)
    assert.match(r.summary, /time slot taken by T950/)
    const free = FIRST_FREE.exec(r.summary)?.[1] ?? ''
    assert.ok(Date.parse(free) < now + 30 * H, `a start in the calendar free now, before T950: ${r.summary}`)
    // One tick later (the next plan and its call), and at the latest: the rest of this plan's window, the tick and its
    // jitter, the next plan's call and its own window.
    for (const later of [TICK + CALL, WINDOW + TICK + JITTER + CALL + WINDOW]) {
      const ok = await createAt(free, s, now + later)
      assert.equal(ok.status, 'dry_run', `${later / MIN} minutes later, ${free}: ${ok.summary}`)
    }
  } finally {
    mock.timers.reset()
  }
})

test('R74A-1 a stretch free now that is too short for that room is not named: the first free start after it is', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.now() })
  try {
    const now = Date.now()
    const s = snapshot()
    // Free until 4 hours ahead: a 3-team round robin fits from 2 h to 2 h 51 min ahead, too soon for the next plan.
    s.market.slots = [{ id: 951, title: 'Soon', start: now + 4 * H, end: now + 30 * H }]
    const r = await dry(parseAction(trio({ starts_at: minute(ceilMin(now + 10 * H)) })), s)
    assert.equal(r.status, 'refused', r.summary)
    assert.match(r.summary, /time slot taken by T951/)
    assert.equal(FIRST_FREE.exec(r.summary)?.[1], minute(ceilMin(now + 31 * H)), `T951's end plus the hour before a kickoff: ${r.summary}`)
    const ok = await createAt(minute(ceilMin(now + 31 * H)), s, now + WINDOW + TICK + JITTER + CALL + WINDOW)
    assert.equal(ok.status, 'dry_run', ok.summary)
  } finally {
    mock.timers.reset()
  }
})

test("R74A-2 a gap open now: the first start the plan request gives is still 2 hours ahead when the create runs, up to the end of its plan's window", async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.now() })
  try {
    const now = Date.now()
    const s = snapshot()
    s.market.slots = [{ id: 960, title: 'Later', start: now + 20 * H, end: now + 30 * H }]
    const line = freeLine(s)
    // The gap itself stays as it is: from the first minute an hour from now to T960's start.
    const gap = new RegExp(`${minute(ceilMin(now + H))} to ${minute(floorMin(now + 20 * H))} \\(starts_at from (\\S+) to `).exec(line)
    assert.ok(gap, `the gap open now is offered: ${line}`)
    for (const later of [0, CALL, CALL + WINDOW]) {
      const ok = await createAt(gap[1]!, s, now + later)
      assert.equal(ok.status, 'dry_run', `${later / MIN} minutes later, ${gap[1]}: ${ok.summary}`)
    }
  } finally {
    mock.timers.reset()
  }
})

test('R74A-2 a gap open now that is too short once that room is added is not offered; a later gap keeps its first start', () => {
  mock.timers.enable({ apis: ['Date'], now: Date.now() })
  try {
    const now = Date.now()
    const s = snapshot()
    // Free until 3 h 30 min ahead (a 3-team round robin fits from 2 h to 2 h 21 min ahead, before this plan's create can
    // run), then from 30 to 33 hours ahead.
    s.market.slots = [
      { id: 970, title: 'Soon', start: now + 3.5 * H, end: now + 30 * H },
      { id: 971, title: 'After', start: now + 33 * H, end: now + 100 * H },
    ]
    const line = freeLine(s)
    assert.doesNotMatch(line, new RegExp(`${minute(ceilMin(now + H))} to `), `the gap open now is left out: ${line}`)
    assert.match(line, new RegExp(`${minute(ceilMin(now + 30 * H))} to ${minute(floorMin(now + 33 * H))} \\(starts_at from ${minute(ceilMin(now + 30 * H) + H)} to `), line)
  } finally {
    mock.timers.reset()
  }
})

// R74A-4 (the GitHub re-review of PR #74): the next plan reads a refusal only as a line of its activity log, cut to
// 300 characters (txt in renderPlanRequest). The first free start stood at the end of the clash refusal, after the
// action's description and the taken window, so a long title cut the minute ("starts_at 2026-11-…"). Seen through the
// plan request itself, not the summary: it failed on 016bc07 and passes now.
const LONG_TITLE = 'Evening Cup of the Northern Valley Clubs for Steady Managers'

test('R74A-4 a title of 60 characters: the next plan still reads the whole first free start a clash names, on a public create with an OVR range and on a private groups_knockout', async () => {
  assert.equal(LONG_TITLE.length, 60, 'the longest title parseAction takes')
  const eight = { type: 'create_tournament', title: LONG_TITLE, format: 'groups_knockout', tier: 'silver', max_teams: 8, min_teams: 6, entry_fee_foxsy: 1000, registration_closes_minutes_before: 60, round_interval_minutes: 30 }
  const cases = [
    // The busy calendar: a 3-team round robin fits from 19:48 to 19:51; 19:47 clashes with T901.
    { name: 'public round robin of 3 with an OVR range', action: trio({ title: LONG_TITLE, starts_at: `${DAY}T19:47Z`, ovr_min: 60, ovr_max: 80 }), s: busyCalendar() },
    // Taken until 18:48 and free after it: 8 teams in groups fit from 19:48; 19:47 clashes with T901.
    { name: 'private groups_knockout of 8', action: { ...eight, starts_at: `${DAY}T19:47Z`, invite_user_ids: [901, 902, 903, 904, 905, 906, 907] }, s: (() => { const s = snapshot(); s.market.slots = [{ id: 901, title: 'Before', start: Date.now() - H, end: at('18:48') }]; return s })() },
  ]
  const read: Record<string, string | undefined> = {}
  const lines: string[] = []
  for (const c of cases) {
    const m = setup({ fox: { bestXiOvr: async () => ({ best_xi_ovr: 70 }) } })
    const [r] = await m.exec.run(m.agent(), dryWallet, c.s, [{ action: parseAction(c.action), reason: '' }])
    assert.equal(r!.status, 'refused', `${c.name}: ${r!.summary}`)
    assert.match(r!.summary, /time slot taken by T901/, c.name)
    const text = renderPlanRequest({ snapshot: c.s, settings: TEST_SETTINGS, budget: budgetView(m.store, 0, TEST_SETTINGS, true, new Date()), recent: m.store.planHistory(0, 20), dryRun: true })
    const line = text.split('\n').find(l => l.startsWith('- ') && l.includes('[refused]') && l.includes('time slot taken by T901')) ?? ''
    assert.ok(line, `${c.name}: the refusal is in the recent activity`)
    read[c.name] = FIRST_FREE.exec(line)?.[1]
    lines.push(line)
  }
  // The whole minute, in the form the parser takes, in both.
  assert.deepEqual(read, Object.fromEntries(cases.map(c => [c.name, `${DAY}T19:48Z`])), lines.join('\n'))
})

test('R74A record: the rows of the GitHub review of PR #74 and of its re-review, in its section', () => {
  const review = readFileSync(join(import.meta.dirname, '..', 'docs/SECURITY-REVIEW.md'), 'utf8')
  const start = review.indexOf('\n## A tournament start to the minute (2026-11-15)\n')
  const section = review.slice(start, review.indexOf('\n## ', start + 1))
  for (const [id, by] of [['R74A-1', 'review'], ['R74A-2', 'review'], ['R74A-4', 're-review']]) {
    const row = section.split('\n').find(l => l.startsWith(`| ${id} |`))
    assert.ok(row, `${id} has its row`)
    assert.equal(row.split(' | ').length, 4, `${id}: four cells`)
    assert.match(row, new RegExp(`^\\| ${id} \\| low \\(GitHub ${by} of PR #74; `))
  }
  assert.doesNotMatch(section, /—|, and |, or |\bbots?\b/i)
})
