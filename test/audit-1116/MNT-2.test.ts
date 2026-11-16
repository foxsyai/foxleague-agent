// MNT-2: the MetaStaking Shop discount (FoxLeague #744 + #765, on mainnet since 16 Nov, switch
// shop.metastaking_discount_live_from = Tue 1 Dec 2026 14:00 UTC). From the switch a wallet with 10,000 FOXSY or more
// of 30-day MetaStaking average pays LESS in the Shop, and FoxLeague's confirm takes ONLY that wallet's price: "any
// other amount is refused and refunded whole, the full price of a discounted wallet included" (routes/shop.rs,
// metastaking/shop_discount.rs). The wallet's price is served: GET /api/shop/status `metastaking_discount_bp`,
// `discounted_prices` and `common_pack_discounted_price_foxsy`; GET /api/shop/ranked-ticket `discounted_price_foxsy`;
// the medicine quote's `cost_foxsy` (to pay) next to `full_cost_foxsy`. The agent pays the list price everywhere.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkAction, type RulesContext } from '../../src/executor/rules.ts'
import { wholeToAtomic } from '../../src/util/encoding.ts'
import { TEST_SETTINGS, card, snapshot, withFixture } from '../fixtures.ts'

const ctx = (more: Partial<RulesContext> = {}): RulesContext => ({ settings: { ...TEST_SETTINGS }, now: new Date(), boostersThisWeek: 0, packsThisWeek: 0, medicineDaysThisWeek: 0, ...more })

/** An imported team's wallet with 500,000 FOXSY of MetaStaking average: 5 percent (500 bp), as FoxLeague's shop status serves it. */
function discounted() {
  const s = withFixture(snapshot())
  Object.assign(s.auth!.shop as object, {
    prices: { condition_recovery: 100, xp_booster: 2000, training_slot: 20 },
    metastaking_discount_bp: 500,
    discounted_prices: { condition_recovery: 95, xp_booster: 1900, training_slot: 19 },
    common_pack_price_foxsy: 2500,
    common_pack_discounted_price_foxsy: 2375,
  })
  return s
}

test('MNT-2 the XP booster is paid at the wallet\'s own price (FoxLeague refuses and refunds the list price of a discounted wallet)', () => {
  const v = checkAction({ type: 'buy', product: 'xp_booster' }, discounted(), ctx())
  assert.equal(v.ok, true, v.refusal)
  assert.equal(v.foxsy, wholeToAtomic(1900), `pays ${v.foxsy / 10n ** 18n} FOXSY; FoxLeague takes 1900 from this wallet and nothing else`)
})

test('MNT-2 the Common pack is paid at the wallet\'s own price', () => {
  const v = checkAction({ type: 'buy', product: 'common_pack' }, discounted(), ctx())
  assert.equal(v.ok, true, v.refusal)
  assert.equal(v.foxsy, wholeToAtomic(2375), `pays ${v.foxsy / 10n ** 18n} FOXSY; FoxLeague takes 2375 from this wallet`)
})

test('MNT-2 the ranked ticket is paid at discounted_price_foxsy', () => {
  const s = discounted()
  s.auth!.upcoming!.matches = []
  s.auth!.myTournaments!.active = []
  s.config!.competition_levels = { live: true, live_from: '2026-11-09T14:00:00Z', ranked_ticket_price_foxsy: 25, xp_factor_pct: { ranked: 25, bronze: 50, silver: 75, gold: 100 }, elo_k: { ranked: 5, bronze: 9, silver: 13, gold: 17 }, private_bronze_earns: true, competitive_daily_cap: 3 }
  // GET /api/shop/ranked-ticket for this wallet: 25 less floor(25 x 5 / 100) = 24.
  const ticket = { live: true, live_from: '2026-11-09T14:00:00Z', price_foxsy: 25, tickets: 0, discount_bp: 500, discounted_price_foxsy: 24 }
  const v = checkAction({ type: 'play_match', match_type: 'ranked' }, s, ctx({ rankedTicket: ticket as never }))
  assert.equal(v.ok, true, v.refusal)
  assert.equal(v.foxsy, wholeToAtomic(24), `pays ${v.foxsy / 10n ** 18n} FOXSY for the ticket; FoxLeague takes 24 from this wallet`)
})

test('MNT-2 medicine is bought at the quote\'s cost_foxsy, the price after the discount', () => {
  const s = discounted()
  const hurt = card(40, 'MID', 'reserve', { injuredUntil: new Date(Date.now() + 8 * 86_400_000).toISOString() })
  s.players.push(hurt)
  // FoxLeague's quote for 3 days of a Common's injury at 100 a day: 300 in full, 285 for this wallet.
  const quote = { player_nonce: 40, injured_until: hurt.injuredUntil, served_until: hurt.injuredUntil, price_per_day: 100, max_days: 6, days_paid: 3, cost_foxsy: 285, full_cost_foxsy: 300, discount_bp: 500 }
  const v = checkAction({ type: 'buy', product: 'medicine', player_nonces: [40], quantity: 3 }, s, ctx({ medicineQuote: quote as never }))
  assert.equal(v.ok, true, `a discounted wallet can never buy medicine: ${v.refusal}`)
  assert.equal(v.foxsy, wholeToAtomic(285))
})

// The switch (FoxLeague's /api/config metastaking_discount): with it live, or its time passed, a rate that could not be
// read is unknown, never 0, and nothing is paid; with it off or not set, every wallet pays the list price as before.
const plain = (switchBlock: unknown) => {
  const s = withFixture(snapshot())
  if (switchBlock !== undefined) (s.config as Record<string, unknown>).metastaking_discount = switchBlock
  return s // the shop status carries no rate (an older answer, or a field left out)
}
const booster = (s: ReturnType<typeof plain>) => checkAction({ type: 'buy', product: 'xp_booster' }, s, ctx())

test('MNT-2 with the discount live and the wallet\'s rate unread, no Shop payment is made', () => {
  const live = { live: true, live_from: '2026-12-01T14:00:00Z', foxsy_per_step: 10_000, bp_per_step: 10, max_bp: 1000, quote_valid_seconds: 900 }
  const v = booster(plain(live))
  assert.equal(v.ok, false, 'paid the list price blind while FoxLeague takes only the wallet\'s own price')
  assert.match(v.refusal ?? '', /Shop price could not be read/)
  // A config read just before the switch still says live: false; the moment it names counts too.
  const passed = { live: false, live_from: new Date(Date.now() - 60_000).toISOString() }
  assert.equal(booster(plain(passed)).ok, false, 'the switch time has passed')
  // A block that cannot be read is no "off".
  assert.equal(booster(plain({ live: 'soon' })).ok, false, 'an unreadable switch')
})

test('MNT-2 with the discount live, a ranked ticket and medicine without the wallet\'s rate are not paid', () => {
  const s = plain({ live: true, live_from: '2026-12-01T14:00:00Z' })
  s.auth!.upcoming!.matches = []
  s.auth!.myTournaments!.active = []
  s.config!.competition_levels = { live: true, live_from: '2026-11-09T14:00:00Z', ranked_ticket_price_foxsy: 25, xp_factor_pct: { ranked: 25, bronze: 50, silver: 75, gold: 100 }, elo_k: { ranked: 5, bronze: 9, silver: 13, gold: 17 }, private_bronze_earns: true, competitive_daily_cap: 3 }
  const ticket = { live: true, live_from: '2026-11-09T14:00:00Z', price_foxsy: 25, tickets: 0 }
  assert.match(checkAction({ type: 'play_match', match_type: 'ranked' }, s, ctx({ rankedTicket: ticket as never })).refusal ?? '', /Shop price could not be read/)
  const hurt = card(40, 'MID', 'reserve', { injuredUntil: new Date(Date.now() + 8 * 86_400_000).toISOString() })
  s.players.push(hurt)
  const quote = { player_nonce: 40, injured_until: hurt.injuredUntil, served_until: hurt.injuredUntil, price_per_day: 100, max_days: 6, days_paid: 3, cost_foxsy: 300 }
  assert.match(checkAction({ type: 'buy', product: 'medicine', player_nonces: [40], quantity: 3 }, s, ctx({ medicineQuote: quote as never })).refusal ?? '', /Shop price could not be read/)
})

test('MNT-2 with the discount off or not set, a wallet pays the list price as before', () => {
  for (const block of [undefined, { live: false, live_from: null }, { live: false, live_from: '2099-12-01T14:00:00Z' }]) {
    const v = booster(plain(block))
    assert.equal(v.ok, true, v.refusal)
    assert.equal(v.foxsy, wholeToAtomic(2000))
  }
})

test('MNT-2 a price FoxLeague serves that is not the list price less the wallet\'s rate is not paid', () => {
  const s = discounted()
  ;(s.auth!.shop as Record<string, unknown>).discounted_prices = { condition_recovery: 95, xp_booster: 1950, training_slot: 19 }
  assert.match(checkAction({ type: 'buy', product: 'xp_booster' }, s, ctx()).refusal ?? '', /not the list price less its MetaStaking discount/)
})

test('MNT-2 a condition recovery is paid at the wallet\'s price, the discount once on its total', () => {
  const s = discounted()
  for (const p of s.players.slice(0, 2)) p.condition = 50
  // 2 cards x 50 points at 100 FOXSY for a full recovery: 100 in full, 95 for this wallet.
  const v = checkAction({ type: 'buy', product: 'condition_recovery', player_nonces: [1, 2] }, s, ctx())
  assert.equal(v.ok, true, v.refusal)
  assert.equal(v.foxsy, wholeToAtomic(95))
})
