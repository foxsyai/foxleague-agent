// R75A-1 (GitHub agent review of PR #75, low): `shopRateBp` (src/executor/rules.ts) took a MetaStaking rate above 0
// that FoxLeague served even while its switch (/api/config `metastaking_discount`) was readable and off. Before the
// switch FoxLeague's confirm takes the full price only (backend/src/metastaking/shop_discount.rs `current`: off, the
// rate is 0 and every price is the full one), so a rate served then without a discounted price would have the agent
// pay less than the confirm wants: refused, refunded, the gas lost.
// The reviewer's rule: read the switch first. Readable and off: the list price, whatever rate is served. Live: the
// served rate, as before. Unreadable: as before (an unread rate is refused once live or past its time).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkAction, type RulesContext } from '../../src/executor/rules.ts'
import { wholeToAtomic } from '../../src/util/encoding.ts'
import { TEST_SETTINGS, card, snapshot, withFixture } from '../fixtures.ts'

const ctx = (more: Partial<RulesContext> = {}): RulesContext => ({ settings: { ...TEST_SETTINGS }, now: new Date(), boostersThisWeek: 0, packsThisWeek: 0, medicineDaysThisWeek: 0, ...more })

const OFF = { live: false, live_from: null, foxsy_per_step: 10_000, bp_per_step: 10, max_bp: 1000, quote_valid_seconds: 900 }
const LIVE = { ...OFF, live: true, live_from: '2026-12-01T14:00:00Z' }

/** A wallet whose shop status carries a rate of 500 bp and no discounted price, with the switch as given. */
function served(block: unknown) {
  const s = withFixture(snapshot())
  ;(s.config as Record<string, unknown>).metastaking_discount = block
  Object.assign(s.auth!.shop as object, { metastaking_discount_bp: 500 })
  return s
}

test('R75A-1 switch off, rate 500 served: the XP booster is paid at its list price', () => {
  const v = checkAction({ type: 'buy', product: 'xp_booster' }, served(OFF), ctx())
  assert.equal(v.ok, true, v.refusal)
  assert.equal(v.foxsy, wholeToAtomic(2000), `pays ${v.foxsy / 10n ** 18n} FOXSY; FoxLeague's confirm takes the full price before the switch`)
})

test('R75A-1 switch off with a time still ahead, rate 500 served: the Common pack, slots and a ranked ticket at the list price', () => {
  const ahead = { ...OFF, live_from: '2099-12-01T14:00:00Z' }
  const pack = checkAction({ type: 'buy', product: 'common_pack' }, served(ahead), ctx())
  assert.equal(pack.ok, true, pack.refusal)
  assert.equal(pack.foxsy, wholeToAtomic(2500))
  const slots = checkAction({ type: 'buy', product: 'training_slot', quantity: 2 }, served(ahead), ctx({ settings: { ...TEST_SETTINGS, paidTrainingPerDay: 5 } }))
  assert.equal(slots.ok, true, slots.refusal)
  assert.equal(slots.foxsy, wholeToAtomic(40))
  const s = served(ahead)
  s.auth!.upcoming!.matches = []
  s.auth!.myTournaments!.active = []
  s.config!.competition_levels = { live: true, live_from: '2026-11-09T14:00:00Z', ranked_ticket_price_foxsy: 25, xp_factor_pct: { ranked: 25, bronze: 50, silver: 75, gold: 100 }, elo_k: { ranked: 5, bronze: 9, silver: 13, gold: 17 }, private_bronze_earns: true, competitive_daily_cap: 3 }
  const ticket = { live: true, live_from: '2026-11-09T14:00:00Z', price_foxsy: 25, tickets: 0, discount_bp: 500 }
  const t = checkAction({ type: 'play_match', match_type: 'ranked' }, s, ctx({ rankedTicket: ticket as never }))
  assert.equal(t.ok, true, t.refusal)
  assert.equal(t.foxsy, wholeToAtomic(25))
})

test('R75A-1 switch off: a medicine quote that carries a rate is not paid below its full cost', () => {
  const s = served(OFF)
  const hurt = card(40, 'MID', 'reserve', { injuredUntil: new Date(Date.now() + 8 * 86_400_000).toISOString() })
  s.players.push(hurt)
  const quote = { player_nonce: 40, injured_until: hurt.injuredUntil, served_until: hurt.injuredUntil, price_per_day: 100, max_days: 6, days_paid: 3, cost_foxsy: 285, full_cost_foxsy: 300, discount_bp: 500 }
  const v = checkAction({ type: 'buy', product: 'medicine', player_nonces: [40], quantity: 3 }, s, ctx({ medicineQuote: quote as never }))
  assert.equal(v.ok, false, 'a quote below the full cost before the switch is not what the confirm takes')
})

test('R75A-1 control: with the switch live the served rate is paid, as before', () => {
  const v = checkAction({ type: 'buy', product: 'xp_booster' }, served(LIVE), ctx())
  assert.equal(v.ok, true, v.refusal)
  assert.equal(v.foxsy, wholeToAtomic(1900))
})

test('R75A-1 control: an unreadable switch still refuses an unread rate', () => {
  const s = served({ live: 'soon' })
  delete (s.auth!.shop as Record<string, unknown>).metastaking_discount_bp
  assert.match(checkAction({ type: 'buy', product: 'xp_booster' }, s, ctx()).refusal ?? '', /Shop price could not be read/)
})
