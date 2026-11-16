// MON-1 (rule 4): the schedule rule counts what the squad still owes to a tournament that has started from the
// upcoming matches. When that read failed (auth.upcoming null, "upcoming matches: ..." in the warnings) the fixtures
// still to play are read as 1, so a paid entry the rule refuses with the fixtures read is allowed without them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setup, snapshot, tournament, dryWallet } from '../fixtures.ts'
import type { PlannedAction } from '../../src/executor/actions.ts'

const at = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()

/** The agent sits in a round robin of 8 under way (started an hour ago) with 6 fixtures still to play; squad at 60. */
function busySnapshot(upcomingRead: boolean) {
  const s = snapshot()
  for (const p of s.players) p.condition = 60
  const running = { ...(tournament(60, { status: 'active', format: 'round_robin', max_teams: 8, min_teams: 4, starts_at: at(-1), deadline: at(-2), started_at: at(-1), round_interval_minutes: 30 }) as { tournament: object }).tournament }
  s.auth!.myTournaments!.active = [running] as never
  const fixtures = Array.from({ length: 6 }, (_, i) => ({ tournament_id: 60, tournament_title: 'T60', round_label: `Round ${i + 2}`, group_name: null, is_home: true, opponent_name: 'Rival', scheduled_at: at(1.5 + i * 0.5), strategy_locks_at: at(1 + i * 0.5), locked: false, phase: 'upcoming', home_score: null, away_score: null }))
  // A failed read of GET /api/tournaments/upcoming-matches leaves null (snapshot.ts attempt()), with a warning.
  s.auth!.upcoming = (upcomingRead ? { lead_minutes: 30, my_team_name: 'Agent', matches: fixtures } : null) as never
  if (!upcomingRead) s.warnings.push('upcoming matches: HTTP 502')
  return s
}

const JOIN: PlannedAction = { action: { type: 'join_tournament', tournament_id: 70 }, reason: 'test' }
const mocks = () => setup({ fox: { tournament: async () => tournament(70, { starts_at: at(2), deadline: at(1), round_interval_minutes: 30 }, []), user: async () => ({ elo_rating: 1200 }) } })

test('control: with the 6 fixtures read, the paid entry is refused (the schedule would wear the squad down)', async () => {
  const m = mocks()
  const [r] = await m.exec.run(m.agent(), dryWallet, busySnapshot(true), [JOIN])
  assert.equal(r!.status, 'refused', r!.summary)
  assert.match(r!.summary, /wear the squad down/)
})

test('MON-1: upcoming matches unread is no "1 fixture left": the same paid entry is refused, never allowed', async () => {
  const m = mocks()
  const [r] = await m.exec.run(m.agent(), dryWallet, busySnapshot(false), [JOIN])
  assert.equal(r!.status, 'refused', `a failed read decided: ${r!.summary}`)
  assert.equal(m.store.spentUsd(0, { category: 'play', dryRun: true }), 0, 'nothing is booked for an entry judged on an unread calendar')
})

// The same rule judges a tournament the agent creates (entry plus, with organizer fees live, the calendar deposit).
import { parseAction } from '../../src/executor/actions.ts'

const CUP: PlannedAction = { action: parseAction({ type: 'create_tournament', title: 'Cup', format: 'knockout', tier: 'silver', max_teams: 8, min_teams: 8, entry_fee_foxsy: 1000, starts_in_hours: 3, registration_closes_minutes_before: 30, round_interval_minutes: 30 }), reason: 'test' }
function busyForCreate(upcomingRead: boolean) {
  const s = busySnapshot(upcomingRead)
  for (const p of s.players) p.condition = 55
  // The round robin plays one round an hour, so it still runs when the new tournament starts in 3 hours.
  ;(s.auth!.myTournaments!.active[0] as { round_interval_minutes: number }).round_interval_minutes = 60
  s.market.recentStandard = [{ id: 1, tier: 'silver', format: 'knockout', max_teams: 8, seated: 8, fee: 1000, status: 'completed', starts_at: at(-24) }] as never
  return s
}

test('control: with the 6 fixtures read, the create is refused (the schedule would wear the squad down)', async () => {
  const m = setup()
  const [r] = await m.exec.run(m.agent(), dryWallet, busyForCreate(true), [CUP])
  assert.equal(r!.status, 'refused', r!.summary)
  assert.match(r!.summary, /wear the squad down/)
})

test('MON-1: the same for a tournament the agent creates: upcoming matches unread refuses, never allows', async () => {
  const m = setup()
  const [r] = await m.exec.run(m.agent(), dryWallet, busyForCreate(false), [CUP])
  assert.equal(r!.status, 'refused', `a failed read decided: ${r!.summary}`)
})
