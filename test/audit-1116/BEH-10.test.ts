// BEH-10: an open 1v1 another team posted goes to the first team that takes it ("often within minutes", the prompt
// says), but the plan's join gets a random moment of its window like any other action: its only time limit is the
// challenge's own deadline (deadlines.ts join_tournament), usually hours away.
// Production, 9 to 16 Nov: six joins of another team's open 1v1 were planned. One ran 3 minutes after its plan and was
// seated (T5891, agent 3, won 5-0). Four ran 16 to 41 minutes after their plans and found the challenge taken: T5891
// by agents 7, 5 and 6 (agent 7 planned it 13 minutes before agent 3 did), and T5908 by agent 6 on 14 Nov (planned
// 12:03 UTC against "a much weaker team (ELO 1197, lineup 2330)", run 12:44: "T5908 is completed"). One was outside
// the challenge's OVR range.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scheduleActions } from '../../src/service.ts'
import { actionDeadline } from '../../src/executor/deadlines.ts'
import { parseAction, type PlannedAction } from '../../src/executor/actions.ts'
import { snapshot, tournament } from '../fixtures.ts'

const MIN = 60_000

test('BEH-10: taking another team\'s open 1v1 runs at the start of the plan: it goes to whoever takes it first', () => {
  const now = Date.now()
  const s = snapshot()
  s.takenAt = new Date(now).toISOString()
  // T5908 as agent 6 saw it on 14 Nov 12:03 UTC: an open Silver 1v1 of another team, its deadline hours away.
  const theirs = (tournament(5908, { max_teams: 2, min_teams: 2, creator_user_id: 900, target_user_id: null, entry_fee_foxsy: 1000, deadline: new Date(now + 180 * MIN).toISOString(), starts_at: new Date(now + 185 * MIN).toISOString(), participant_count: 1 }) as { tournament: never }).tournament
  s.market.openChallenges = [theirs]
  const plan: PlannedAction[] = [
    { action: parseAction({ type: 'join_tournament', tournament_id: 5908 }), reason: 'Take the open Silver 1v1 against a much weaker team' },
    { action: parseAction({ type: 'train', player_nonce: 1, attribute: 'speed' }), reason: '' },
  ]
  const deadlines = plan.map(p => {
    const d = actionDeadline(p.action, s)
    return typeof d === 'number' ? d - now : d
  })
  // The draw of 14 Nov: the join fell 41 minutes into the 48-minute window.
  const draws = [41 / 48, 45 / 48]
  let n = 0
  const r = scheduleActions(plan, { windowMs: 48 * MIN, gapMs: 30_000, random: () => draws[n++]!, lastMatchMs: null, lastRankedMs: null, deadlines })
  const join = r.kept.find(k => k.p.action.type === 'join_tournament')!
  assert.ok(join.offset <= 2 * MIN, `the join runs ${(join.offset / MIN).toFixed(1)} minutes into the plan; on 14 Nov another team had taken and played T5908 by then`)
})

test('BEH-10: the swap that funds the join still runs before it, both at the start; a 1v1 aimed at us keeps its deadline', () => {
  const now = Date.now()
  const s = snapshot()
  s.takenAt = new Date(now).toISOString()
  const theirs = (tournament(5908, { max_teams: 2, min_teams: 2, creator_user_id: 900, target_user_id: null, entry_fee_foxsy: 1000, deadline: new Date(now + 180 * MIN).toISOString(), starts_at: new Date(now + 185 * MIN).toISOString(), participant_count: 1 }) as { tournament: never }).tournament
  s.market.openChallenges = [theirs]
  const plan: PlannedAction[] = [
    { action: parseAction({ type: 'train', player_nonce: 1, attribute: 'speed' }), reason: '' },
    { action: parseAction({ type: 'swap_egld_for_foxsy', foxsy: 1000 }), reason: 'funds the stake' },
    { action: parseAction({ type: 'join_tournament', tournament_id: 5908 }), reason: '' },
    { action: parseAction({ type: 'sync' }), reason: '' },
  ]
  const deadlines = plan.map(p => {
    const d = actionDeadline(p.action, s)
    return typeof d === 'number' ? d - now : d
  })
  assert.equal(deadlines[2], 'now')
  const r = scheduleActions(plan, { windowMs: 48 * MIN, gapMs: 30_000, random: () => 0.9, lastMatchMs: null, lastRankedMs: null, deadlines })
  assert.deepEqual(r.kept.map(k => k.p.action.type), ['train', 'swap_egld_for_foxsy', 'join_tournament', 'sync'], 'the plan\'s order')
  const join = r.kept.find(k => k.p.action.type === 'join_tournament')!
  assert.ok(join.offset <= 2 * MIN, `the join runs ${(join.offset / MIN).toFixed(1)} minutes into the plan`)
  assert.ok(r.kept[3]!.offset > 40 * MIN, 'the action after it keeps its random moment')
  // A 1v1 aimed at this team: only this team can take it, so its deadline as before.
  const aimed = { ...theirs, id: 5909, target_user_id: null, targeted: true, targeted_to_you: true }
  s.market.openChallenges = [aimed]
  assert.equal(typeof actionDeadline(parseAction({ type: 'join_tournament', tournament_id: 5909 }), s), 'number')
})
