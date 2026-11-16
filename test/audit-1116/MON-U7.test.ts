// MON-U7 (the MONEY reviewer's unproven item 7): after an organizer payment, a create refusal that matches SHOP_FINAL
// (/already processed|refunded|cannot be used/) or SHOP_REFUNDED is taken as FoxLeague's word that the payment was used
// or refunded: the held hash is forgotten (the next create pays again) and, for "already refunded" or "being refunded
// automatically", its FOXSY is credited back to the caps. FoxLeague's own words about a payment start its answer
// (shop.rs record_organizer_payment_locked: "Transaction already processed", "This payment was already refunded ...",
// "This payment is being refunded ...", "Our support team is handling this payment ...", "Organizer payments are not in
// force ..."). But a create can also be refused for a time slot, and that refusal quotes ANOTHER player's title
// (tournament_slots.rs conflict_refusal: "Time slot conflicts with tournament #83 '<title>'. Choose a different time.").
// A rival who titles a tournament "Fee being refunded automatically" in the slot the agent picked makes the agent drop
// a payment FoxLeague still holds for it and book its FOXSY as back in the wallet. Rule 6: rival text is data.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAction } from '../../src/executor/actions.ts'
import { ApiRefusal } from '../../src/foxleague/api.ts'
import { setup, snapshot, tournament, liveWallet, withLive } from '../fixtures.ts'

const LIVE_FEES = { live: true, live_from: '2026-11-09T14:00:00Z', private_match_fee_foxsy: 0, calendar_deposit_per_match_foxsy: 25, calendar_deposit_min_foxsy: 0, calendar_deposit_grace_minutes: 60 }
const OWED = { owed: true, games: 6, private_fee_foxsy: 0, deposit_foxsy: 150, total_foxsy: 150, grace_minutes: 60, no_free_cancel: false }
const CUP = parseAction({ type: 'create_tournament', title: 'Autumn Cup', format: 'round_robin', tier: 'silver', max_teams: 4, min_teams: 3, entry_fee_foxsy: 1000, starts_in_hours: 6, registration_closes_minutes_before: 60, round_interval_minutes: 30 })
const FEE_REQUIRED = () => new ApiRefusal('This tournament needs a payment of 150 FOXSY from its organizer before it is created.', 'organizer_fee_required')

async function createRefusedWith(refusal: string) {
  const createTournament = async (_w: unknown, body: Record<string, unknown>) => {
    if (!body.organizer_fee_tx_hash) throw FEE_REQUIRED()
    throw new ApiRefusal(refusal, undefined, undefined, 400)
  }
  const m = setup({
    fox: { organizerFeeQuote: async () => OWED, createTournament, tournament: async () => tournament(55), joinTournament: async () => assert.fail('nothing is created, no seat is paid') },
    chain: { send: async () => 'hashO' },
  })
  const s = snapshot()
  s.config!.organizer_fees = LIVE_FEES
  let result: Awaited<ReturnType<typeof m.exec.run>>[number] | undefined
  await withLive(m.store, async () => {
    ;[result] = await m.exec.run(m.agent(), liveWallet, s, [{ action: CUP, reason: '' }])
  })
  return { m, r: result! }
}

test('MON-U7 a slot refusal that quotes a rival title with "refunded" keeps the organizer payment for the next create and counted', async () => {
  const { m, r } = await createRefusedWith("Time slot conflicts with tournament #83 'Fee being refunded automatically'. Choose a different time.")
  assert.equal(r.status, 'error', r.summary)
  assert.equal(m.store.pending(0).filter(p => p.kind === 'organizer_fee').length, 1, 'the payment FoxLeague still holds for this wallet was forgotten: the next create pays again')
  assert.equal(m.store.openSpend(0, 'shop:organizer_fee', false).length, 1, 'a payment still out was booked as refunded on a rival\'s title')
})

test('MON-U7 the same for a rival title that reads like FoxLeague\'s "creation still pending" answer', async () => {
  const { m, r } = await createRefusedWith("Time slot conflicts with tournament #84 'Final stays pending'. Choose a different time.")
  assert.equal(r.status, 'error', r.summary)
  assert.equal(m.store.pending(0).filter(p => p.kind === 'organizer_fee').length, 1, 'the payment was taken as used by a tournament still pending on chain: the next create pays again')
})

test('MON-U7 control: FoxLeague\'s own words about the payment still settle it', async () => {
  const used = await createRefusedWith('Transaction already processed')
  assert.equal(used.m.store.pending(0).filter(p => p.kind === 'organizer_fee').length, 0)
  assert.equal(used.m.store.openSpend(0, 'shop:organizer_fee', false).length, 1, 'a used payment keeps counting')
  const back = await createRefusedWith('This payment was already refunded and cannot be used for a tournament.')
  assert.equal(back.m.store.pending(0).filter(p => p.kind === 'organizer_fee').length, 0)
  assert.equal(back.m.store.openSpend(0, 'shop:organizer_fee', false).length, 0, 'a refunded payment stops counting')
})
