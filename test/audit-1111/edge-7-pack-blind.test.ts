// Audit 2026-11-11 (Fable 5.2 reviewers at extra-high effort): the proof of EDGE-7, failing before its fix.
// EDGE (rule 4): FoxLeague sells 2 Common packs a wallet in 7 days and tells how many are left in the shop status. The
// rule refuses only when that number reads 0: with the shop status unread (the attempt answered null) or the field left
// out, "could not read" passes as "some left", and 2,500 FOXSY are paid for a pack FoxLeague then refuses (refunded,
// the gas lost, at most 10 refunds a wallet an hour). The booster, the training slots and the sessions refuse on the
// same unread status.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dryWallet, setup, snapshot } from '../fixtures.ts'
import type { PlannedAction } from '../../src/executor/actions.ts'

const act = (action: unknown): PlannedAction[] => [{ action: action as PlannedAction['action'], reason: '' }]

test('a Common pack is not paid for while the shop status (the packs left this week) could not be read', async () => {
  const m = setup()
  const s = snapshot()
  s.auth!.shop = null // GET /api/shop/status failed: the snapshot carries the warning and a null
  const [r] = await m.exec.run(m.agent(), dryWallet, s, act({ type: 'buy', product: 'common_pack' }))
  assert.equal(r!.status, 'refused', `paid blind: ${r!.summary}`)
})

test('nor while the status answers without the packs left this week', async () => {
  const m = setup()
  const s = snapshot()
  delete s.auth!.shop!.common_pack_remaining_this_week // an answer without the field (the shared fixture serves 2 since this fix)
  assert.equal(s.auth!.shop!.common_pack_remaining_this_week, undefined)
  const [r] = await m.exec.run(m.agent(), dryWallet, s, act({ type: 'buy', product: 'common_pack' }))
  assert.equal(r!.status, 'refused', `paid blind: ${r!.summary}`)
})
