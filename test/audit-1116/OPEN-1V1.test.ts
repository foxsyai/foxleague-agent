// OPEN-1V1 (the owner, 16 Nov 2026: "they can have open 1v1 when really needed and they can create with OVR range also
// these ones"). The week of 9 to 16 Nov: 26 open challenges played, 11 won, 13 lost, 2 drawn, about minus 4,200 FOXSY,
// most taken by the stronger teams of their range. An open challenge is posted only when the squad needs competitive
// matches it cannot get from a targeted challenge, a tournament or ranked, never as the default 1v1 (the prompt: what
// "needed" means is the plan's judgement), and it always carries an OVR range around the team's best XI OVR, both ends
// (the code: it names the values that work, the same default as the snapshot's, about 10 percent under).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAction } from '../../src/executor/actions.ts'
import { checkAction, type RulesContext } from '../../src/executor/rules.ts'
import { SYSTEM_PROMPT } from '../../src/strategist/prompt.ts'
import { TEST_SETTINGS, snapshot } from '../fixtures.ts'

const open = (more: Record<string, unknown> = {}) => parseAction({ type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: null, deadline_minutes: 120, ...more })
const ctx = (bestXiOvr: number | null | undefined): RulesContext => ({ settings: TEST_SETTINGS, now: new Date(), bestXiOvr } as RulesContext)

test('OPEN-1V1: an open challenge without both ends of its OVR range is refused, naming the values that work', () => {
  const s = snapshot()
  // Only a top: refused, with the bottom the snapshot would suggest (about 10 percent under OVR 19.6: 17) and the top.
  const topOnly = checkAction(open({ ovr_max: 20 }), s, ctx(19.6))
  assert.equal(topOnly.ok, false)
  assert.match(topOnly.refusal!, /an open challenge needs an OVR range up to your best XI OVR 19\.6, with both ends: ovr_max 20 and ovr_min 17 \(about 10 percent under; any ovr_min up to 19 holds your own OVR\)/)
  // No range at all: the same values, read from the action's own snapshot when the executor read none.
  s.auth!.bestXiOvr = 19.6
  assert.match(checkAction(open(), s, ctx(undefined)).refusal!, /ovr_max 20 and ovr_min 17/)
  // Only a bottom: the same.
  assert.match(checkAction(open({ ovr_min: 17 }), s, ctx(19.6)).refusal!, /ovr_max 20 and ovr_min 17/)
  // Both ends around the team's OVR: allowed.
  const both = checkAction(open({ ovr_min: 17, ovr_max: 20 }), s, ctx(19.6))
  assert.equal(both.ok, true, both.refusal)
  // A targeted challenge still takes none.
  assert.match(checkAction(parseAction({ type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: 50, deadline_minutes: 120 }), s, ctx(19.6)).refusal ?? '', /^(?!.*both ends)/)
})

test('OPEN-1V1: the prompt posts an open challenge only when really needed, never as the default 1v1, with a range around the OVR', () => {
  const para = SYSTEM_PROMPT.split('\n').find(l => l.startsWith('1v1 challenges:')) ?? ''
  assert.match(para, /never your default 1v1/)
  assert.match(para, /only when the squad needs competitive matches it cannot get from a targeted challenge, a tournament or ranked/)
  assert.match(para, /ovr_min about 10 percent under/)
})
