// CHN-1: FoxLeague's MetaStaking Shop discount (mainnet-1.0 at 729164194, #744 + #765; switch
// `shop.metastaking_discount_live_from`, announced for Tue 1 Dec 2026 14:00 UTC, off on 16 Nov).
//
// From the switch a wallet with a MetaStaking rate above 0 pays its OWN price in the Shop, and that is the only amount
// a confirm takes: backend/src/metastaking/shop_discount.rs `accepted` + `Accepted::matching` (the wallet's rate at the
// payment's chain time and the rates it was quoted in the 15 minutes before; the full price is among them only for a
// wallet at 0). FoxLeague's own test pins it: backend/src/routes/shop/metastaking_discount_tests.rs:581-630
// `a_payment_that_is_not_the_wallets_price_is_refused_and_refunded_whole` ("the full price", 100 FOXSY for a wallet at
// 9%: refused, `product_amount_mismatch`, refunded whole; a booster at 249 for a wallet whose price is 227 too).
//
// What FoxLeague serves the wallet (the amounts to send with shopPay):
// - GET /api/shop/ranked-ticket: `price_foxsy` stays the full price, `discounted_price_foxsy` is "the only amount the
//   sale accepts" (backend/src/models.rs RankedTicketView, :1273-1289);
// - GET /api/shop/status: `metastaking_discount_bp`, `discounted_prices`, `common_pack_discounted_price_foxsy`
//   (backend/src/routes/shop.rs ShopStatus, :84-93 and :113-115);
// - GET /api/shop/medicine/quote: `cost_foxsy` is now the DISCOUNTED cost, next to `full_cost_foxsy` and `discount_bp`
//   (backend/src/routes/shop.rs medicine_quote_view).
// The price rule: full - floor(full x bp / 10000), once on the payment's total (shop_discount.rs discounted_price).
//
// The agent pays the full price of /api/config for a booster, a pack and training slots and `price_foxsy` for a ticket,
// and refuses a medicine quote whose cost is not price_per_day x days. So for a wallet with a rate (an imported team
// whose owner stakes FOXSY; 10,000 FOXSY of 30-day average is enough for a booster or a pack) every such payment is
// refused and refunded by FoxLeague after it settled (the gas is lost, nothing is bought, the next plan pays again), and
// no medicine is ever bought.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkAction, type RulesContext } from '../../src/executor/rules.ts'
import { ApiRefusal } from '../../src/foxleague/api.ts'
import { numberToHex, wholeToAtomic } from '../../src/util/encoding.ts'
import { TEST_SETTINGS, liveWallet, setup, snapshot, withFixture, withLive } from '../fixtures.ts'

/** FoxLeague's price rule (shop_discount.rs discounted_price). */
const discounted = (full: number, bp: number) => full - Math.floor((full * bp) / 10_000)
const ctx = (more: Partial<RulesContext> = {}): RulesContext => ({ settings: { ...TEST_SETTINGS }, now: new Date(), ...more })
const LEVELS = {
  live: true, live_from: '2026-11-09T14:00:00Z', ranked_ticket_price_foxsy: 25,
  xp_factor_pct: { ranked: 25, bronze: 50, silver: 75, gold: 100 }, elo_k: { ranked: 5, bronze: 9, silver: 13, gold: 17 },
  private_bronze_earns: true, competitive_daily_cap: 3,
}
/** The fixture's snapshot of a wallet at `bp` basis points, with the Shop status FoxLeague serves it from the switch. */
function staked(bp: number) {
  const s = withFixture(snapshot())
  s.config!.competition_levels = LEVELS
  ;(s.config as Record<string, unknown>).metastaking_discount = { live: true, live_from: '2026-12-01T14:00:00Z', foxsy_per_step: 10_000, bp_per_step: 10, max_bp: 1000, quote_valid_seconds: 900 }
  Object.assign(s.auth!.shop!, {
    prices: { condition_recovery: 100, xp_booster: 2000, training_slot: 20 },
    metastaking_discount_bp: bp,
    discounted_prices: { condition_recovery: discounted(100, bp), xp_booster: discounted(2000, bp), training_slot: discounted(20, bp) },
    common_pack_price_foxsy: 2500,
    common_pack_discounted_price_foxsy: discounted(2500, bp),
  })
  return s
}

test('CHN-1a: a ranked ticket is paid at the price FoxLeague serves this wallet (discounted_price_foxsy), the only amount its sale accepts', async () => {
  const sent: string[] = []
  let pressed = 0
  // A wallet at 10% (1,000 bp): a 25 FOXSY ticket costs it 23.
  const view = { live: true, live_from: '2026-11-09T14:00:00Z', price_foxsy: 25, tickets: 0, discount_bp: 1000, discounted_price_foxsy: discounted(25, 1000) }
  assert.equal(view.discounted_price_foxsy, 23)
  const m = setup({
    fox: {
      rankedTicket: async () => view,
      playMatch: async () => { if (pressed++ === 0) throw new ApiRefusal('A ranked game costs 23 FOXSY: pay for a ticket first.', 'ranked_ticket_required'); return { match_id: 11, ranked_paid: true } },
      // FoxLeague's confirm (shop.rs buy_ranked_ticket): any amount but the wallet's price is refused and refunded whole.
      buyRankedTicket: async () => {
        const paid = sent[0]!.split('@')[2]
        if (paid !== numberToHex(wholeToAtomic(23))) throw new ApiRefusal('Transaction paid 25 FOXSY but a ranked ticket costs 23 FOXSY. Your payment is being refunded automatically.')
        return { ...view, tickets: 1 }
      },
    },
    chain: { send: async (tx: { data?: string }) => { sent.push(Buffer.from(tx.data ?? '', 'base64').toString()); return 'hash1' } },
  })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, staked(1000), [{ action: { type: 'play_match', match_type: 'ranked' }, reason: '' }])
    assert.equal(sent.length, 1, r!.summary)
    assert.equal(sent[0]!.split('@')[2], numberToHex(wholeToAtomic(23)), `the shopPay carries the wallet's price of 23 FOXSY, not the full 25: ${sent[0]}`)
    assert.equal(r!.status, 'confirmed', r!.summary)
  })
})

test('CHN-1b: a booster, a Common pack and training slots are paid at the wallet\'s price of the Shop status (full - floor(full x bp / 10000), once on the total)', () => {
  // A wallet at 5% (500 bp).
  const s = staked(500)
  const price = (a: unknown, more: Partial<RulesContext> = {}) => {
    const v = checkAction(a as never, s, ctx(more))
    assert.equal(v.ok, true, v.ok ? '' : (v as { refusal: string }).refusal)
    return v.foxsy
  }
  assert.equal(price({ type: 'buy', product: 'xp_booster' }, { boostersThisWeek: 0, lastBoosterAt: null }), wholeToAtomic(1900), 'a 2,000 FOXSY booster costs this wallet 1,900')
  assert.equal(price({ type: 'buy', product: 'common_pack' }, { packsThisWeek: 0 }), wholeToAtomic(2375), 'a 2,500 FOXSY pack costs this wallet 2,375')
  assert.equal(price({ type: 'buy', product: 'training_slot', quantity: 10 }), wholeToAtomic(190), '10 slots at 20 cost this wallet 190 (the discount once, on the total of 200)')
})

test('CHN-1c: FoxLeague\'s medicine quote of a wallet with a rate (cost_foxsy = the discounted cost) is paid, not refused as a mismatch', () => {
  const until = new Date(Date.now() + 8 * 86_400_000).toISOString()
  const s = staked(500)
  s.config!.card_bans = { live: true, live_from: '2026-11-13T14:00:00Z', yellow_cards_per_ban: 3 }
  Object.assign(s.players.find(p => p.nonce === 3)!, { injuredUntil: until })
  // shop.rs medicine_quote_view: 2 days at 300 = 600 in full, 570 for this wallet.
  const medicineQuote = { player_nonce: 3, injured_until: until, served_until: new Date(Date.now() + 2 * 86_400_000).toISOString(), price_per_day: 300, max_days: 6, days_paid: 2, cost_foxsy: discounted(600, 500), full_cost_foxsy: 600, discount_bp: 500 }
  const v = checkAction({ type: 'buy', product: 'medicine', player_nonces: [3], quantity: 2 } as never, s, ctx({ medicineDaysThisWeek: 0, medicineQuote: medicineQuote as never }))
  assert.equal(v.ok, true, v.ok ? '' : (v as { refusal: string }).refusal)
  assert.equal(v.foxsy, wholeToAtomic(570), 'the amount FoxLeague quoted this wallet, the only one its confirm takes')
})

test('CHN-1 control: a wallet with no rate (0 bp) pays what it pays today', () => {
  const s = staked(0)
  const v = checkAction({ type: 'buy', product: 'xp_booster' } as never, s, ctx({ boostersThisWeek: 0, lastBoosterAt: null }))
  assert.equal(v.ok, true, v.ok ? '' : (v as { refusal: string }).refusal)
  assert.equal(v.foxsy, wholeToAtomic(2000))
})
