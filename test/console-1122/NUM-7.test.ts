// NUM-7: the owner, 2026-11-22, before the public release: every number in the text the code shows a person checked
// against the code (TEXT-3 holds the same text to the two text rules). One refusal said its number the wrong way round.
// While an open challenge of ours waits, a change that weakens the eleven is refused when a team at the top of the
// range would be more than 10 percent stronger than the eleven after it (top > eleven x MAX_1V1_STRENGTH_RATIO, 1.1).
// The refusal said the eleven would be "more than 10 percent below a fresh team at its top", which is eleven < top x 0.9:
// an eleven between those two bars (18.0 to 18.18 against a top of 20) was refused with a reason that was not true.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkAction, MAX_1V1_STRENGTH_RATIO, type RulesContext } from '../../src/executor/rules.ts'
import { TEST_SETTINGS, snapshot, tournament } from '../fixtures.ts'

const ctx = (): RulesContext => ({ settings: { ...TEST_SETTINGS }, now: new Date() })

test('NUM-7 the refusal of a change while an open challenge waits says the top of its range would be more than 10 percent stronger, as the rule counts', () => {
  assert.equal(MAX_1V1_STRENGTH_RATIO, 1.1, 'the margin the refusal names as 10 percent')
  // The fixture's eleven at condition 82 plays at OVR 18.2; training a starter takes 5 condition from it: 18.155.
  const s = snapshot()
  for (const n of s.team!.lineup) s.players.find(p => p.nonce === n)!.condition = 82
  s.auth!.myTournaments = { active: [{ ...(tournament(950, { max_teams: 2, min_teams: 2, creator_user_id: s.profile!.id, ovr_min: 18, ovr_max: 20, status: 'open' }) as { tournament: object }).tournament, participant_count: 1 }], completed: [] } as never
  const v = checkAction({ type: 'train', player_nonce: 2, attribute: 'defense' } as never, s, ctx())
  assert.equal(v.ok, false, 'refused: 20 is more than 10 percent above 18.155 (20 / 18.155 = 1.10)')
  const refusal = (v as { refusal: string }).refusal
  // 18.155 is 9.2 percent below 20, not more than 10: the old words named a bar the eleven had not crossed.
  assert.ok(18.155 > 20 * 0.9 && 20 > 18.155 * MAX_1V1_STRENGTH_RATIO)
  assert.doesNotMatch(refusal, /percent below a fresh team/)
  assert.match(refusal, /^your open challenge T950 waits for an opponent \(up to OVR 20\): after this training your eleven would play at OVR 18\.2 and a fresh team at its top would be more than 10 percent stronger; leave it first or wait until it is taken or expires$/)
})
