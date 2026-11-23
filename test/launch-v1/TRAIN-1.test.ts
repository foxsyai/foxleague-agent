// TRAIN-1 (mainnet, 23 Nov 2026, agent 4): with 6 sessions used today (5 free and 1 paid), 9 paid slots banked and an
// XP booster running, every further session was refused "daily training exhausted (6 used, 9 paid slots banked)".
// trainingDayRefusal read FoxLeague's premium_used_today as a cap on paid sessions. FoxLeague counts there the
// training_slot purchases verified in the trailing 24 hours, for its shop card only: its training gate ignores it
// (shop.rs:130-152, :795-806). The gate is daily_free + premium_cap sessions a game day (training.rs:335, :469,
// daily_cap_reached) and past the free ones a banked slot each (try_consume_training_slot, training.rs:63-91, refused
// with none banked). After buying 10 slots within 24 hours the agent refused its own paid training until those
// purchases aged out. The booster's double XP went unused on those sessions. The executor's in-plan count and the
// scheduler's wait for the reset (RESET-1) bumped the purchase count on each paid session, so a plan that bought slots
// ran fewer sessions than it paid for.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkAction, trainingDayRefusal, type RulesContext, type TrainingQuota } from '../../src/executor/rules.ts'
import { newDayHolds } from '../../src/executor/new-day.ts'
import { parseAction, type PlannedAction } from '../../src/executor/actions.ts'
import { renderDigest } from '../../src/snapshot/digest.ts'
import { TEST_SETTINGS, dryWallet, setup, snapshot } from '../fixtures.ts'

const act = (raw: unknown): PlannedAction => ({ action: parseAction(raw), reason: '' })
const train = (n: number) => act({ type: 'train', player_nonce: n, attribute: 'speed' })
const buySlots = (quantity: number) => act({ type: 'buy', product: 'training_slot', quantity })
const level = (paidTrainingPerDay: number): RulesContext => ({ settings: { ...TEST_SETTINGS, paidTrainingPerDay }, now: new Date() })

/** The snapshot with this training status (FoxLeague's shop status fields, as served). */
function withTraining(t: Partial<Record<keyof TrainingQuota, unknown>>) {
  const s = snapshot()
  s.auth!.shop!.training = { daily_free: 5, premium_cap: 10, used_today: 0, premium_used_today: 0, slots_banked: 0, ...t } as TrainingQuota
  return s
}

const why = (raw: unknown, s: ReturnType<typeof snapshot>, ctx = level(10)) => {
  const v = checkAction(parseAction(raw), s, ctx)
  return v.ok ? '' : (v as { refusal: string }).refusal
}
const TRAIN = { type: 'train', player_nonce: 12, attribute: 'defense' }
// Agent 4 on the morning of 23 Nov: 5 free and 1 paid session used, 10 slots bought in the last 24 hours, 9 banked.
const MORNING = { used_today: 6, daily_free: 5, premium_cap: 10, premium_used_today: 10, slots_banked: 9 }

test('TRAIN-1 the morning of 23 Nov: 6 used, 10 slots bought in 24 h and 9 banked, the next paid session runs', async () => {
  const s = withTraining(MORNING)
  assert.equal(trainingDayRefusal(s.auth!.shop!.training!, 10), null)
  const v = checkAction(parseAction(TRAIN), s, level(10))
  assert.ok(v.ok, (v as { refusal?: string }).refusal)
  assert.equal(v.facts.usesPaidSlot, true, 'past the free sessions it uses a banked slot')
  // Through the executor, as the plan ran it.
  const m = setup()
  const [r] = await m.exec.run(m.agent(), dryWallet, s, [train(12)])
  assert.equal(r!.status, 'dry_run', r!.summary)
})

test('TRAIN-1 the scheduler does not hold the morning\'s paid session for the 14:00 reset', () => {
  const s = withTraining(MORNING)
  s.takenAt = '2026-11-23T09:40:00Z'
  assert.deepEqual(newDayHolds([train(12), train(13)], s, { paidTrainingPerDay: 10 }), [null, null])
})

test('TRAIN-1 control: 15 sessions used (5 free plus FoxLeague\'s 10 paid) is used up for the game day, slots banked or not', () => {
  const s = withTraining({ ...MORNING, used_today: 15 })
  assert.match(trainingDayRefusal(s.auth!.shop!.training!, 10) ?? '', /^daily training exhausted/)
  assert.match(why(TRAIN, s), /^daily training exhausted/)
  s.takenAt = '2026-11-23T09:40:00Z'
  const [hold] = newDayHolds([train(12)], s, { paidTrainingPerDay: 10 })
  assert.match(hold?.why ?? '', /training sessions are used up: 15 used/)
})

test('TRAIN-1 control: the free sessions used and no paid slot banked is used up for the game day', () => {
  const s = withTraining({ used_today: 5, premium_used_today: 0, slots_banked: 0 })
  assert.match(trainingDayRefusal(s.auth!.shop!.training!, 10) ?? '', /^daily training exhausted/)
  assert.match(why(TRAIN, s), /^daily training exhausted/)
  // The free ones are never held back by the paid slots.
  assert.equal(why(TRAIN, withTraining({ used_today: 4, slots_banked: 0 })), '')
})

test('TRAIN-1 control: unreadable paid slots banked on a paid session is refused as unknown, never allowed', () => {
  for (const banked of [undefined, Number.NaN, 'nine']) {
    const s = withTraining({ used_today: 6, premium_used_today: 0, slots_banked: banked })
    if (banked === undefined) delete (s.auth!.shop!.training as unknown as Record<string, unknown>).slots_banked
    assert.equal(trainingDayRefusal(s.auth!.shop!.training!, 10), null, `unknown is no "used up" (${String(banked)})`)
    assert.match(why(TRAIN, s), /^training quota unknown/, String(banked))
  }
})

test('TRAIN-1 an unreadable premium_cap on a paid session is refused as unknown, never allowed', () => {
  for (const cap of [undefined, Number.NaN, null, '10']) {
    const s = withTraining({ ...MORNING, premium_used_today: 0, premium_cap: cap })
    if (cap === undefined) delete (s.auth!.shop!.training as unknown as Record<string, unknown>).premium_cap
    assert.equal(trainingDayRefusal(s.auth!.shop!.training!, 10), null, `unknown is no "used up" (${String(cap)})`)
    assert.match(why(TRAIN, s), /^training quota unknown/, String(cap))
    assert.match(why({ type: 'buy', product: 'training_slot', quantity: 1 }, s), /^training quota unknown/, String(cap))
    // A free session does not reach FoxLeague's paid cap: it runs.
    assert.equal(why(TRAIN, withTraining({ used_today: 3, premium_cap: cap })), '', `a free session (${String(cap)})`)
  }
})

test('TRAIN-1 FoxLeague\'s cap of daily_free + premium_cap sessions binds even when the level allows more paid ones', () => {
  // FoxLeague lowers its paid cap to 6: 11 sessions a game day, whatever the bank and the level hold.
  const at = (used: number) => withTraining({ used_today: used, premium_cap: 6, premium_used_today: 0, slots_banked: 9 })
  assert.equal(why(TRAIN, at(10)), '', 'the 11th session of the day runs')
  assert.match(why(TRAIN, at(11)), /^daily training exhausted/, 'the 12th is over FoxLeague\'s cap')
  assert.ok(trainingDayRefusal(at(11).auth!.shop!.training!, 10))
})

test('TRAIN-1 premium_used_today, the purchases of the last 24 hours, decides nothing', () => {
  for (const bought of [0, 10, 25, undefined]) {
    const s = withTraining({ ...MORNING, premium_used_today: bought })
    if (bought === undefined) delete (s.auth!.shop!.training as unknown as Record<string, unknown>).premium_used_today
    assert.equal(trainingDayRefusal(s.auth!.shop!.training!, 10), null, String(bought))
    assert.equal(why(TRAIN, s), '', String(bought))
    // A slot purchase is held only to the level's count: 1 used today + 9 banked + 1 more is over 10, under 11.
    assert.match(why({ type: 'buy', product: 'training_slot', quantity: 1 }, s, level(10)), /10 paid training sessions a day at this level/, String(bought))
    assert.equal(why({ type: 'buy', product: 'training_slot', quantity: 1 }, s, level(11)), '', String(bought))
  }
})

test('TRAIN-1 the digest states the real limit: daily_free + premium_cap sessions a game day, not purchases in 24 hours', () => {
  const d = renderDigest(withTraining(MORNING))
  const line = d.split('\n').find(l => l.startsWith('Training today:')) ?? ''
  assert.match(line, /6 used/)
  assert.match(line, /at most 15 a game day/)
  assert.match(line, /paid sessions used today 1/)
  assert.match(line, /banked paid slots 9/)
  assert.doesNotMatch(line, /bought in 24 h|10\/10/, 'the purchase count is no limit')
  const blind = withTraining({ used_today: 6 })
  delete (blind.auth!.shop!.training as unknown as Record<string, unknown>).premium_cap
  const blindLine = renderDigest(blind).split('\n').find(l => l.startsWith('Training today:')) ?? ''
  assert.match(blindLine, /^Training today: 6 used/)
  assert.doesNotMatch(blindLine, /NaN|undefined/)
})

// The in-plan count: 5 slots bought in the last 24 hours (used on the game day before), the free sessions of today used,
// none banked. The plan buys 10 slots and trains 11 times. FoxLeague runs 10 paid sessions (15 a game day) and refuses
// the 11th; the agent's own count bumped the purchase count on each session and stopped after 5.
const PLAN_DAY = { used_today: 5, daily_free: 5, premium_cap: 10, premium_used_today: 5, slots_banked: 0 }
const PLAN = [buySlots(10), ...Array.from({ length: 11 }, (_, i) => train(i + 1))]

test('TRAIN-1 the executor\'s in-plan count: a plan that buys 10 slots runs 10 paid sessions and refuses the 11th', async () => {
  const m = setup()
  const results = await m.exec.run(m.agent(), dryWallet, withTraining(PLAN_DAY), PLAN)
  assert.deepEqual(results.map(r => r.status), ['dry_run', ...Array(10).fill('dry_run'), 'refused'], results.map(r => r.summary).join('\n'))
  assert.match(results[11]!.summary, /daily training exhausted/)
  // FoxLeague's cap below the level's count stops the plan with slots still banked: 8 of the 10 run.
  const low = setup()
  const capped = await low.exec.run(low.agent(), dryWallet, withTraining({ ...PLAN_DAY, premium_cap: 8 }), PLAN.slice(0, 10))
  assert.deepEqual(capped.map(r => r.status), ['dry_run', ...Array(8).fill('dry_run'), 'refused'], capped.map(r => r.summary).join('\n'))
  assert.match(capped[9]!.summary, /daily training exhausted \(13 used/)
})

test('TRAIN-1 the scheduler\'s in-plan count: the same plan holds only the 11th session for the reset', () => {
  const s = withTraining(PLAN_DAY)
  s.takenAt = '2026-11-23T09:40:00Z'
  const holds = newDayHolds(PLAN, s, { paidTrainingPerDay: 10 })
  assert.deepEqual(holds.map(h => (h ? 'held' : 'now')), [...Array(11).fill('now'), 'held'])
  const low = withTraining({ ...PLAN_DAY, premium_cap: 8 })
  low.takenAt = s.takenAt
  assert.deepEqual(newDayHolds(PLAN.slice(0, 10), low, { paidTrainingPerDay: 10 }).map(h => (h ? 'held' : 'now')), [...Array(9).fill('now'), 'held'])
})
