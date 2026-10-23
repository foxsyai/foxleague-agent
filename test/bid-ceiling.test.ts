// Owner, 2026-10-23: the bid ceiling counted only Common packs and fusion fees (a Rare 5,000 FOXSY) while Rares sold
// at 9,000 to 17,500, so no agent could buy the third forward its formation record asked for. Building a card also
// takes time: the matches every input must play to reach its gate and the days a fused card must wait. A card at
// auction has already played its gate (only such a card can be listed), so it is worth what building one and bringing
// it to its gate costs, with every match and every day of waiting at the price FoxLeague itself charges to skip one.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as rules from '../src/executor/rules.ts'
import { checkAction, type RulesContext } from '../src/executor/rules.ts'
import { renderPlanRequest } from '../src/strategist/strategist.ts'
import { budgetView } from '../src/executor/budget.ts'
import { DEFAULT_SETTINGS } from '../src/store/settings.ts'
import { wholeToAtomic } from '../src/util/encoding.ts'
import { MAINNET_GATE, OTHER, TEST_SETTINGS, setup, snapshot } from './fixtures.ts'

/** mainnet's /api/config of 2026-10-23, the parts the ceiling reads. */
const LIVE = { common_pack_price_foxsy: 2500, fusion_costs_foxsy: [100, 200, 400, 800], rarity_match_gate: MAINNET_GATE, fusion_card_cooldown_seconds: 1_209_600, fusion_cooldown_waiver_price_per_day: 75 }
const RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary']
const ceiling = (cfg: unknown, r: string) => (rules as unknown as { auctionCeiling(c: unknown, r: string): number | null }).auctionCeiling(cfg, r)

test('a card at auction is worth building it and bringing it to its gate, every match and day at FoxLeague\'s own price', () => {
  // Common: a pack card (500) and its 5 matches at 20 (a Common has no waiver price: the cheapest match price).
  // Uncommon: 3 such Commons + the 100 fee, then 15 matches at 20 and 14 days of fusion cooldown at 75.
  // Rare: 3 such Uncommons + 200, then 45 matches at 100 and 14 days at 75; Epic and Legendary the same way.
  assert.deepEqual(RARITIES.map(r => ceiling(LIVE, r)), [600, 3250, 15500, 61450, 226700])
})

test('without the gate rows or the cooldown settings the ceiling is the packs and fusion fees alone (stricter)', () => {
  const { rarity_match_gate: _g, ...noGate } = LIVE
  const { fusion_cooldown_waiver_price_per_day: _p, ...noDays } = LIVE
  assert.equal(ceiling(noGate, 'Rare'), 5000)
  assert.equal(ceiling(noDays, 'Rare'), 5000)
  assert.equal(ceiling({ common_pack_price_foxsy: 0, fusion_costs_foxsy: [] }, 'Rare'), null, 'unknown prices: no ceiling, as before')
})

test('the bid rule uses it: a Rare up to its built price, and the max bid still binds above', () => {
  const s = snapshot()
  s.chain!.foxsy = wholeToAtomic(100_000)
  s.config = { ...s.config!, ...LIVE } as typeof s.config
  const auction = { seller: OTHER, minPrice: wholeToAtomic(4000), highestBid: 0n, highestBidder: null, endsAt: new Date(Date.now() + 3600_000) }
  const ctx = (rarity: string): RulesContext => ({ settings: { ...TEST_SETTINGS, maxBidFoxsy: 47_000 }, now: new Date(), auction, cardRarity: rarity })
  const bid = (foxsy: number, rarity: string) => checkAction({ type: 'bid', nonce: 9, foxsy }, s, ctx(rarity))
  assert.equal(bid(15_500, 'Rare').ok, true, bid(15_500, 'Rare').refusal)
  assert.match(bid(15_600, 'Rare').refusal!, /above what a Rare costs to build yourself \(15500 FOXSY/)
  assert.equal(bid(47_000, 'Epic').ok, true, 'an Epic up to the max bid')
  assert.match(bid(47_001, 'Legendary').refusal!, /per-action maximum 47000/)
})

test('the plan sees the new ceilings', () => {
  const s = snapshot()
  s.config = { ...s.config!, ...LIVE } as typeof s.config
  const text = renderPlanRequest({ snapshot: s, settings: DEFAULT_SETTINGS, budget: budgetView(setup().store, 0, DEFAULT_SETTINGS, true, new Date()), recent: [], dryRun: true })
  assert.match(text, /never above what the card costs to build yourself and bring to its match gate \(Rare 15500, Epic 61450, Legendary 226700\)/)
})
