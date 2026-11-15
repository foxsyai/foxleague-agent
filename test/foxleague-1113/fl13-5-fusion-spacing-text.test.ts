// FoxLeague mainnet of 13 Nov 2026, FL13-5: the wallet's fusion spacing as FoxLeague writes it.
// GET /api/fusion/can-fuse answers the 20-hour wallet spacing left as text, `"cooldown_remaining": "0d 19h"`
// (next-foxleague origin/main backend/src/routes/marketplace.rs can_fuse: format!("{}d {}h", days, hours)). The agent typed
// it as seconds and divided it by 3,600: its refusal told the owner "wallet fusion cooldown, NaN h left". It decided
// nothing (can_fuse false refused either way); the words were wrong.
import test from 'node:test'
import assert from 'node:assert/strict'
import { checkAction, type RulesContext } from '../../src/executor/rules.ts'
import type { Action } from '../../src/executor/actions.ts'
import { TEST_SETTINGS, card, snapshot } from '../fixtures.ts'

const fuse: Action = { type: 'fuse', player_nonces: [101, 102, 103], position_of: 0 }
const refusal = (canFuse: RulesContext['canFuse']) => {
  const v = checkAction(fuse, snapshot([101, 102, 103].map(n => card(n, 'MID', 'reserve'))), { settings: { ...TEST_SETTINGS }, now: new Date(), canFuse, fusionPool: 4 })
  return v.ok ? '' : (v as { refusal: string }).refusal
}

test('FL13-5: the wallet spacing FoxLeague serves as "0d 19h" reads as such, never as NaN hours', () => {
  const text = refusal({ can_fuse: false, cooldown_remaining: '0d 19h', cooldown_end: '2026-11-16T09:00:00+00:00' })
  assert.match(text, /wallet fusion cooldown, 0d 19h left \(until 2026-11-16T09:00:00\+00:00\)/)
  assert.doesNotMatch(text, /NaN/)
})

test('FL13-5 (control): seconds still read as hours, and an unreadable value is left out', () => {
  assert.match(refusal({ can_fuse: false, cooldown_remaining: 7200 }), /wallet fusion cooldown, 2 h left/)
  assert.doesNotMatch(refusal({ can_fuse: false, cooldown_remaining: 'soon' as never }), /NaN|soon/)
})
