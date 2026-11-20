// R2M-1 (regression of MON-U7, low): since MON-U7 an organizer payment is settled only by a create refusal that OPENS with
// one of five phrases (pending.ts ORGANIZER_HASH_ANSWER). FoxLeague has two more answers of its own about that very
// payment, both final, both written by its server with numbers only (no player text), that open differently
// (release/mainnet-1.0 729164194, backend/src/routes/shop.rs verify_organizer_payment):
//   "Transaction paid {paid} FOXSY but this tournament needs {amount} FOXSY. Your payment is being refunded automatically."
//   "Payment ({paid} FOXSY) is less than required ({expected} FOXSY) Your payment is being refunded automatically."
// (the amount FoxLeague's create computes is not the one its quote gave a moment before: its organizer fee setting was
// saved between the two). On 955664a both settled the payment and credited it (SHOP_FINAL + SHOP_REFUNDED). On 8e2dad8
// neither does: the hash FoxLeague is refunding stays "held" for 60 minutes, every create that owes another amount is
// refused meanwhile ("an organizer payment of 150 FOXSY waits to be used or returned"), and after 60 minutes it is
// abandoned still counted against the caps, although FoxLeague said it was coming back.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAction } from '../../src/executor/actions.ts'
import { ApiRefusal } from '../../src/foxleague/api.ts'
import { setup, snapshot, tournament, liveWallet, withLive } from '../fixtures.ts'

const LIVE_FEES = { live: true, live_from: '2026-11-09T14:00:00Z', private_match_fee_foxsy: 0, calendar_deposit_per_match_foxsy: 25, calendar_deposit_min_foxsy: 0, calendar_deposit_grace_minutes: 60 }
const OWED = { owed: true, games: 6, private_fee_foxsy: 0, deposit_foxsy: 150, total_foxsy: 150, grace_minutes: 60, no_free_cancel: false }
const CUP = parseAction({ type: 'create_tournament', title: 'Autumn Cup', format: 'round_robin', tier: 'silver', max_teams: 4, min_teams: 3, entry_fee_foxsy: 1000, starts_in_hours: 96, registration_closes_minutes_before: 60, round_interval_minutes: 30 })
const FEE_REQUIRED = () => new ApiRefusal('This tournament needs a payment of 150 FOXSY from its organizer before it is created.', 'organizer_fee_required')

async function createRefusedWith(refusal: string) {
  let quote = OWED
  const createTournament = async (_w: unknown, body: Record<string, unknown>) => {
    if (!body.organizer_fee_tx_hash) throw FEE_REQUIRED()
    throw new ApiRefusal(refusal, undefined, undefined, 400)
  }
  const m = setup({
    fox: { organizerFeeQuote: async () => quote, createTournament, tournament: async () => tournament(55), joinTournament: async () => assert.fail('nothing is created, no seat is paid') },
    chain: { send: async () => 'hashO' },
  })
  const s = snapshot()
  s.config!.organizer_fees = LIVE_FEES
  let result: Awaited<ReturnType<typeof m.exec.run>>[number] | undefined
  await withLive(m.store, async () => {
    ;[result] = await m.exec.run(m.agent(), liveWallet, s, [{ action: CUP, reason: '' }])
  })
  // The next plan's create: FoxLeague's quote now says what its create wanted.
  const again = async (total: number) => {
    quote = { ...OWED, deposit_foxsy: total, total_foxsy: total }
    let r: Awaited<ReturnType<typeof m.exec.run>>[number] | undefined
    const s2 = snapshot()
    s2.config!.organizer_fees = LIVE_FEES
    await withLive(m.store, async () => {
      ;[r] = await m.exec.run(m.agent(), liveWallet, s2, [{ action: CUP, reason: '' }])
    })
    return r!
  }
  return { m, r: result!, again }
}

test("R2M-1 FoxLeague's own \"Transaction paid ... is being refunded automatically\" settles the organizer payment and stops counting it", async () => {
  const { m, r } = await createRefusedWith('Transaction paid 150 FOXSY but this tournament needs 125 FOXSY. Your payment is being refunded automatically.')
  assert.equal(r.status, 'error', r.summary)
  assert.equal(m.store.pending(0).filter(p => p.kind === 'organizer_fee').length, 0, `a payment FoxLeague is refunding is still held for "the next create of this amount": ${r.summary}`)
  assert.equal(m.store.openSpend(0, 'shop:organizer_fee', false).length, 0, 'a payment FoxLeague said it is refunding still counts against the caps')
})

test("R2M-1 the same for FoxLeague's \"Payment (...) is less than required (...)\" with its refund", async () => {
  const { m, r } = await createRefusedWith('Payment (150 FOXSY) is less than required (175 FOXSY) Your payment is being refunded automatically.')
  assert.equal(r.status, 'error', r.summary)
  assert.equal(m.store.pending(0).filter(p => p.kind === 'organizer_fee').length, 0, `a payment FoxLeague is refunding is still held: ${r.summary}`)
  assert.equal(m.store.openSpend(0, 'shop:organizer_fee', false).length, 0, 'a payment FoxLeague said it is refunding still counts against the caps')
})

test('R2M-1 the next create, which owes what FoxLeague asked for, is not blocked by the refunded payment', async () => {
  const { again } = await createRefusedWith('Transaction paid 150 FOXSY but this tournament needs 125 FOXSY. Your payment is being refunded automatically.')
  const next = await again(125)
  assert.doesNotMatch(next.summary, /waits to be used or returned/, `the create of the amount FoxLeague wants is refused for a payment FoxLeague already sent back: ${next.summary}`)
})

test('R2M-1 control: a rival title in a slot refusal still settles nothing (MON-U7 holds)', async () => {
  const { m } = await createRefusedWith("Time slot conflicts with tournament #83 'Transaction paid, being refunded automatically'. Choose a different time.")
  assert.equal(m.store.pending(0).filter(p => p.kind === 'organizer_fee').length, 1)
  assert.equal(m.store.openSpend(0, 'shop:organizer_fee', false).length, 1)
})
