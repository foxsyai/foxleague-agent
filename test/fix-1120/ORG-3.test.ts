// ORG-3 (production, 19 Nov 2026; the owner's rule that day): agent 3 created a public Silver round robin, T6303, at
// 19:27 UTC, taking the first free start the snapshot offered: 05:26 UTC the next morning, its deadline 04:56. Nobody
// joined overnight; it was cancelled and the 150 FOXSY calendar deposit was lost. Every organizer tournament of the
// agents that filled to 3 or 4 teams was booked 6 to 15 days ahead. The owner: "the snapshot offers organizer starts at
// least 3 days ahead, so we still are within the 30 days, so we have time to fill". The offer and the executor's rule
// read one constant; a 1v1 and a create the owner asks for (Telegram /do, byOwner) are not affected.

import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { ORGANIZER_START_MIN_MS, parseAction, type Action } from '../../src/executor/actions.ts'
import { checkAction, type RulesContext } from '../../src/executor/rules.ts'
import { renderDigest } from '../../src/snapshot/digest.ts'
import { TEST_SETTINGS, dryWallet, setup, snapshot } from '../fixtures.ts'

const MIN = 60_000
const H = 3600_000
const DAY = 86_400_000
const at = (iso: string) => Date.parse(iso)
const minute = (t: number) => `${new Date(t).toISOString().slice(0, 16)}Z`
type Calendar = { format: string; teams: number; free: { first: number; last: number }[] | null }[]

const cup = (start: Record<string, unknown>, more: Record<string, unknown> = {}) =>
  parseAction({ type: 'create_tournament', title: 'Evening Cup', format: 'round_robin', tier: 'silver', max_teams: 4, min_teams: 3, entry_fee_foxsy: 1000, registration_closes_minutes_before: 30, round_interval_minutes: 30, ...start, ...more })
const ctx = (now: number, more: Partial<RulesContext> = {}): RulesContext => ({ settings: { ...TEST_SETTINGS }, now: new Date(now), ...more })

test('ORG-3 the constant is 3 days', () => {
  assert.equal(ORGANIZER_START_MIN_MS, 3 * DAY)
})

test('ORG-3 19 Nov: a plan at 19:10 UTC is offered no start before 3 days later, and the line says why', () => {
  const now = at('2026-11-19T19:10:00Z')
  mock.timers.enable({ apis: ['Date'], now })
  let d: string
  try {
    const s = snapshot()
    // FoxLeague's calendar free from 05:26 the next morning to the end of the 30 days, for every shape.
    const free = [{ first: at('2026-11-20T05:26:00Z'), last: now + 40 * DAY }]
    ;(s.market as { calendar?: Calendar }).calendar = [
      { format: 'round_robin', teams: 3, free },
      { format: 'round_robin', teams: 8, free },
      { format: 'groups_knockout', teams: 16, free },
    ]
    // One tournament on the agent's own calendar, so the gaps line is written too.
    s.market.slots = [{ id: 870, title: 'Later', start: now + 8 * DAY, end: now + 8 * DAY + 3 * H }]
    d = renderDigest(s, { tickMinutes: 60 })
  } finally {
    mock.timers.reset()
  }
  const offered = [...d.matchAll(/starts_at (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z)/g)].map(m => Date.parse(m[1]!))
  assert.ok(offered.length >= 3, d)
  for (const t of offered) assert.ok(t >= now + 3 * DAY, `a start offered sooner than 3 days ahead: ${minute(t)}`)
  const gaps = d.split('\n').find(l => l.startsWith("Free for a new tournament's whole window")) ?? ''
  for (const m of gaps.matchAll(/starts_at from (\S+) to/g)) assert.ok(Date.parse(m[1]!) >= now + 3 * DAY, gaps)
  // None before 3 days from now plus the plan's lead (a 60-minute tick: 48 minutes and 15 for the call), and why.
  const own = d.split('\n').find(l => l.startsWith('Your own starts for a new tournament')) ?? ''
  assert.match(own, /none before 2026-11-22T20:13Z: a public tournament needs days to fill/, own)
})

test('ORG-3 19 Nov: a create at 05:26 the next day is refused with the earliest allowed start named', () => {
  const now = at('2026-11-19T19:27:00Z')
  const r = checkAction(cup({ starts_at: '2026-11-20T05:26Z' }), snapshot(), ctx(now))
  assert.equal(r.ok, false)
  assert.match(r.refusal!, /starts 2026-11-20T05:26 UTC, less than 3 days from now: a tournament this agent creates needs days to fill; the earliest start allowed is starts_at 2026-11-22T19:27Z/)
  // Through the executor too (the agent's own plan).
  return (async () => {
    mock.timers.enable({ apis: ['Date'], now })
    try {
      const m = setup()
      const [res] = await m.exec.run(m.agent(), dryWallet, snapshot(), [{ action: cup({ starts_at: '2026-11-20T05:26Z' }), reason: '' }])
      assert.equal(res!.status, 'refused', res!.summary)
      assert.match(res!.summary, /less than 3 days from now/)
    } finally {
      mock.timers.reset()
    }
  })()
})

test('ORG-3 a start 3 days and a minute ahead passes; whole hours from the run are held to the same rule', () => {
  const now = at('2026-11-19T19:27:00Z')
  const ok = checkAction(cup({ starts_at: minute(now + 3 * DAY + MIN) }), snapshot(), ctx(now))
  assert.equal(ok.ok, true, ok.refusal)
  assert.equal(checkAction(cup({ starts_in_hours: 73 }), snapshot(), ctx(now)).ok, true)
  assert.match(checkAction(cup({ starts_in_hours: 71 }), snapshot(), ctx(now)).refusal!, /less than 3 days from now/)
})

test('ORG-3 a private tournament is held to it too: its invited teams need the same days to join', () => {
  const now = at('2026-11-19T19:27:00Z')
  const priv = (start: Record<string, unknown>) => cup(start, { invite_user_ids: [201, 202, 203] })
  assert.match(checkAction(priv({ starts_at: '2026-11-20T05:26Z' }), snapshot(), ctx(now)).refusal!, /less than 3 days from now/)
  const ok = checkAction(priv({ starts_at: minute(now + 3 * DAY + MIN) }), snapshot(), ctx(now))
  assert.equal(ok.ok, true, ok.refusal)
})

test('ORG-3 a 1v1 and a create the owner asked for are not affected', () => {
  const now = at('2026-11-19T19:27:00Z')
  // The owner's own (Telegram /do, byOwner): FoxLeague's 2 hours are the floor, as before.
  const owner = checkAction(cup({ starts_at: '2026-11-20T05:26Z' }), snapshot(), ctx(now, { byOwner: true }))
  assert.equal(owner.ok, true, owner.refusal)
  assert.match(checkAction(cup({ starts_at: '2026-11-19T21:00Z' }), snapshot(), ctx(now, { byOwner: true })).refusal!, /less than 2 hours from now/)
  // A 1v1 has no start of its own: its deadline is minutes from now, as before.
  const oneVOne: Action = parseAction({ type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: null, deadline_minutes: 60 })
  const r = checkAction(oneVOne, snapshot(), ctx(now))
  assert.doesNotMatch(r.refusal ?? '', /3 days/)
})
