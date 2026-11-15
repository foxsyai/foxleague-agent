// Audit 2026-11-11 (Fable 5.2 reviewers at extra-high effort): the proof of INTEG-6, failing before its fix.
// INTEG-6: a Common pack is paid while the wallet's weekly pack quota could not be read (unknown read as "quota left").
// FoxLeague refuses the confirm of a pack once the wallet's verified packs of the rolling 7 days reach the cap, after
// the shopPay has settled (next-foxleague origin/main backend/src/routes/shop.rs:3843-3885 common_pack_precheck:
//   if weekly_cap_reached(bought, cap) { return Err(refuse("common_pack_cap_reached", common_pack_cap_message(cap)).await) }
// "A settled shopPay that a refused pre-check finds is returned by the strand refund", shop.rs:2896-2901), and serves
// the wallet's own count in GET /api/shop/status (shop.rs:94-97: common_pack_bought_this_week,
// common_pack_remaining_this_week). The agent refuses only when that field reads exactly 0
// (src/executor/rules.ts:1375: s.auth?.shop?.common_pack_remaining_this_week === 0): a shop status that failed this
// tick (auth.shop null) or an answer without the field reads as "packs left", where every other shop product refuses
// an unread status (rules.ts:1313, :1337). The agent's own 7-day count does not know packs the owner bought in the
// app, nor those of a team imported or restored into a new install.
import test from 'node:test'
import assert from 'node:assert/strict'
import { checkAction, type RulesContext } from '../../src/executor/rules.ts'
import { TEST_SETTINGS, snapshot } from '../fixtures.ts'
import { renderDigest } from '../../src/snapshot/digest.ts'

const ctx = (): RulesContext => ({ settings: TEST_SETTINGS, packsThisWeek: 0, pendingShop: new Set(), now: new Date() })

test('INTEG-6: no Common pack is paid when the shop status (the wallet\'s weekly pack quota) could not be read', () => {
  const s = snapshot()
  s.auth!.shop = null // GET /api/shop/status failed this tick: the quota FoxLeague holds for this wallet is unknown
  const v = checkAction({ type: 'buy', product: 'common_pack' }, s, ctx())
  assert.equal(v.ok, false, `the agent pays ${v.foxsy / 10n ** 18n} FOXSY for a pack without knowing the wallet's weekly quota: with the quota used (packs bought in the app, an imported team) FoxLeague refuses the confirm and the payment waits for its refund`)
  assert.match(String(v.refusal), /quota|shop status/i)
})

test('INTEG-6: nor when the answer leaves the quota out; a quota that reads above 0 still buys', () => {
  const s = snapshot()
  delete s.auth!.shop!.common_pack_remaining_this_week // an answer without the field (the shared fixture serves 2 since this fix)
  assert.equal(checkAction({ type: 'buy', product: 'common_pack' }, s, ctx()).ok, false, 'a shop status without common_pack_remaining_this_week is read as packs left')
  const known = snapshot()
  known.auth!.shop!.common_pack_remaining_this_week = 2
  assert.equal(checkAction({ type: 'buy', product: 'common_pack' }, known, ctx()).ok, true)
})

// Added with the fix: a quota that is no number is unread too, and a used one says so.
test('INTEG-6: a quota that is no finite number is unread; 0 is a used quota', () => {
  for (const bad of ['2', Number.NaN, null, true]) {
    const s = snapshot()
    ;(s.auth!.shop as unknown as Record<string, unknown>).common_pack_remaining_this_week = bad
    const v = checkAction({ type: 'buy', product: 'common_pack' }, s, ctx())
    assert.equal(v.ok, false, `quota ${String(bad)}`)
    assert.match(String(v.refusal), /could not be read \(the shop status or its weekly quota\): not buying blind/)
  }
  const used = snapshot()
  used.auth!.shop!.common_pack_remaining_this_week = 0
  assert.match(String(checkAction({ type: 'buy', product: 'common_pack' }, used, ctx()).refusal), /weekly Common pack quota used/)
})

test('INTEG-6: the plan is told the packs left this week, or that they are unknown', () => {
  const s = snapshot()
  assert.match(renderDigest(s), /Common packs left this week \(FoxLeague's count for this wallet\): 2/)
  s.auth!.shop = null
  assert.match(renderDigest(s), /Common packs left this week: unknown \(the shop status could not be read; no pack is bought until it is\)/)
})
