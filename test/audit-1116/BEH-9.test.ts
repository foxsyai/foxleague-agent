// BEH-9: a plan that closes its own unanswered 1v1 has decided the challenge is not worth playing, and every minute
// it stays open another team can take it. The leave is still given a random moment of the plan's window, held only to
// "5 minutes before the challenge's deadline" (deadlines.ts leave_tournament returns the deadline; service.ts
// scheduleActions), so it runs up to 0.8 of a tick later.
// Production: agent 7, plan 16355 of 12 Nov 09:06:59 UTC: "an open challenge against an unknown taker is roughly a coin
// flip ... on average we lose a little", so leave T5747 (open, stake 1,000, deadline 11:37). The leave ran at 09:32:49,
// 26 minutes later, and was refused: a team had taken the challenge meanwhile. The 1v1 was played at 09:44 and lost
// 1-2: 1,000 FOXSY. The deadline rule of PR #70 changes nothing here: the deadline was two hours away, so the leave
// keeps its random moment.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scheduleActions } from '../../src/service.ts'
import { actionDeadline } from '../../src/executor/deadlines.ts'
import { parseAction, type PlannedAction } from '../../src/executor/actions.ts'
import { snapshot, tournament } from '../fixtures.ts'

const MIN = 60_000

test('BEH-9: leaving the agent\'s own unanswered 1v1 runs at the start of the plan, not at a random moment before its deadline', () => {
  const now = Date.now()
  const s = snapshot()
  s.takenAt = new Date(now).toISOString()
  // T5747 as plan 16355 saw it: our own open Silver 1v1, nobody seated against us, two and a half hours to its deadline.
  const own = (tournament(5747, { max_teams: 2, min_teams: 2, creator_user_id: 100, target_user_id: null, entry_fee_foxsy: 1000, ovr_min: 20, ovr_max: 48, deadline: new Date(now + 150 * MIN).toISOString(), starts_at: new Date(now + 155 * MIN).toISOString(), participant_count: 1 }) as { tournament: never }).tournament
  s.auth!.myTournaments!.active = [own]
  s.market.openChallenges = [own]
  const plan: PlannedAction[] = [
    { action: parseAction({ type: 'leave_tournament', tournament_id: 5747 }), reason: 'an open challenge against an unknown taker is roughly a coin flip' },
    { action: parseAction({ type: 'create_challenge', tier: 'silver', stake_foxsy: 1500, target_user_id: 4495, deadline_minutes: 240 }), reason: '' },
  ]
  // As runPlan does: each action's deadline by the plan's snapshot, in ms after the plan's start.
  const deadlines = plan.map(p => {
    const d = actionDeadline(p.action, s)
    return typeof d === 'number' ? d - now : d
  })
  // The draws of 12 Nov: the leave fell 26 minutes into the 48-minute window.
  const draws = [26 / 48, 33 / 48]
  let n = 0
  const r = scheduleActions(plan, { windowMs: 48 * MIN, gapMs: 30_000, random: () => draws[n++]!, lastMatchMs: null, lastRankedMs: null, deadlines })
  const leave = r.kept.find(k => k.p.action.type === 'leave_tournament')!
  assert.ok(leave.offset <= 2 * MIN, `the leave runs ${(leave.offset / MIN).toFixed(1)} minutes into the plan: until then any team can take the 1v1 the plan decided not to play`)
})

test('BEH-9: the leave runs first even when the plan lists it last; a seat in another team\'s tournament keeps its deadline', () => {
  const now = Date.now()
  const s = snapshot()
  s.takenAt = new Date(now).toISOString()
  const own = (tournament(5747, { max_teams: 2, min_teams: 2, creator_user_id: 100, target_user_id: 4495, targeted: true, entry_fee_foxsy: 1000, deadline: new Date(now + 150 * MIN).toISOString(), starts_at: new Date(now + 155 * MIN).toISOString(), participant_count: 1 }) as { tournament: never }).tournament
  const cup = (tournament(6100, { max_teams: 8, creator_user_id: 900, deadline: new Date(now + 150 * MIN).toISOString() }) as { tournament: never }).tournament
  s.auth!.myTournaments!.active = [own, cup]
  const plan: PlannedAction[] = [
    { action: parseAction({ type: 'swap_egld_for_foxsy', foxsy: 2500 }), reason: '' },
    { action: parseAction({ type: 'train', player_nonce: 1, attribute: 'speed' }), reason: '' },
    { action: parseAction({ type: 'leave_tournament', tournament_id: 5747 }), reason: 'the rival has not answered' },
  ]
  const deadlines = plan.map(p => {
    const d = actionDeadline(p.action, s)
    return typeof d === 'number' ? d - now : d
  })
  const r = scheduleActions(plan, { windowMs: 48 * MIN, gapMs: 30_000, random: () => 0.9, lastMatchMs: null, lastRankedMs: null, deadlines })
  assert.deepEqual(r.kept.map(k => k.p.action.type), ['leave_tournament', 'swap_egld_for_foxsy', 'train'], 'the leave first, the rest in the plan\'s order')
  assert.equal(r.kept[0]!.offset, 0)
  // A seat in another team's tournament: nobody can take it from us, so only its deadline counts, as before.
  assert.equal(actionDeadline(parseAction({ type: 'leave_tournament', tournament_id: 6100 }), s), Date.parse(cup.deadline))
  // A 1v1 of ours another team has taken: no longer unanswered (FoxLeague refuses the leave anyway), its deadline as before.
  const taken = { ...own, participant_count: 2 }
  s.auth!.myTournaments!.active = [taken]
  assert.equal(actionDeadline(parseAction({ type: 'leave_tournament', tournament_id: 5747 }), s), Date.parse(own.deadline))
})
