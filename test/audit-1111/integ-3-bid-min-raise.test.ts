// Audit 2026-11-11 (Fable 5.2 reviewers at extra-high effort): the proof of INTEG-3, failing before its fix.
// INTEG-3: the bid's minimum raise is a 5 hard-coded in the agent; the contract reads a setting FoxLeague serves.
// Players contract (next-foxleague origin/main contracts/foxleague-players/src/player_nft.rs:2586-2590):
//   let inc = self.get_auction_min_increment_percent_view();
//   let min_next = &prev_bid * (100u64 + inc) / 100u64;
//   require!(amount >= min_next, "Bid below minimum increment");
// set by the owner endpoint setAuctionMinIncrementPercent (:1005) and served by GET /api/config as
// auction_min_increment_percent (5 on 2026-11-11). The agent computes highestBid * 105 / 100 whatever the config says
// (src/executor/rules.ts:1441), so the day FoxLeague raises the step every second bid is signed, reverts on chain
// ("Bid below minimum increment") and loses its gas; a reverted bid is not counted by MAX_BIDS_PER_AUCTION, so the next
// plan signs it again.
import test from 'node:test'
import assert from 'node:assert/strict'
import { checkAction, type RulesContext } from '../../src/executor/rules.ts'
import { OTHER, STRANGER, TEST_SETTINGS, snapshot } from '../fixtures.ts'
import { renderDigest } from '../../src/snapshot/digest.ts'
import type { MarketListing } from '../../src/foxleague/types.ts'

test('INTEG-3: a bid under the raise FoxLeague serves (auction_min_increment_percent) is refused before it is signed', () => {
  const s = snapshot()
  ;(s.config as Record<string, unknown>).auction_min_increment_percent = 10 // the contract now asks top bid + 10 percent
  const ONE = 10n ** 18n
  const ctx: RulesContext = {
    settings: { ...TEST_SETTINGS, maxBidFoxsy: 5000, maxBidRareFoxsy: 5000 },
    auction: { seller: OTHER, minPrice: 500n * ONE, highestBid: 1000n * ONE, highestBidder: STRANGER, endsAt: new Date(Date.now() + 3600_000) },
    cardRarity: 'Rare', priorBids: 0, cardLock: { until: null }, now: new Date(),
  }
  // 1,050 is top bid + 5 percent: the contract's min_next is 1000 * 110 / 100 = 1,100, so this bid reverts.
  const v = checkAction({ type: 'bid', nonce: 9, foxsy: 1050 }, s, ctx)
  assert.equal(v.ok, false, 'the agent signs a bid of 1,050 FOXSY that the contract reverts (minimum 1,100 at a 10 percent step): gas lost, and signed again by the next plan')
  assert.match(String(v.refusal), /minimum 1100/)
  // The served step still lets the right bid through.
  assert.equal(checkAction({ type: 'bid', nonce: 9, foxsy: 1100 }, s, ctx).ok, true)
})

// Added with the fix: an answer without the setting keeps the contract's own default (5; player_nft.rs
// get_auction_min_increment_percent_view), a setting that is no whole number in the contract's 1 to 50 is unread and
// takes no raise, and the plan is told the raise in force.
const ONE = 10n ** 18n
const over = (cfgValue: unknown, foxsy: number, highestBid = 1000n * ONE) => {
  const s = snapshot()
  if (cfgValue === undefined) delete (s.config as Record<string, unknown>).auction_min_increment_percent
  else (s.config as Record<string, unknown>).auction_min_increment_percent = cfgValue
  const ctx: RulesContext = {
    settings: { ...TEST_SETTINGS, maxBidFoxsy: 5000, maxBidRareFoxsy: 5000 },
    auction: { seller: OTHER, minPrice: 500n * ONE, highestBid, highestBidder: highestBid ? STRANGER : null, endsAt: new Date(Date.now() + 3600_000) },
    cardRarity: 'Rare', priorBids: 0, cardLock: { until: null }, now: new Date(),
  }
  return checkAction({ type: 'bid', nonce: 9, foxsy }, s, ctx)
}

test('INTEG-3: no setting served is the contract\'s default of 5 percent; the refusal names the raise in force', () => {
  assert.equal(over(undefined, 1050).ok, true)
  assert.match(String(over(undefined, 1049).refusal), /below the minimum 1050 \(top bid 1000 \+ 5 percent\)/)
  assert.match(String(over(10, 1050).refusal), /below the minimum 1100 \(top bid 1000 \+ 10 percent\)/)
})

test('INTEG-3: a served raise that is no whole number from 1 to 50 is unread: no raise is signed on a guess, a first bid at the reserve still goes', () => {
  for (const bad of ['ten', 0, 51, 7.5, Number.NaN, null]) {
    const v = over(bad, 1050)
    assert.equal(v.ok, false, `raise ${String(bad)}`)
    assert.match(String(v.refusal), /minimum raise over a top bid could not be read: not bidding blind/)
    assert.equal(over(bad, 500, 0n).ok, true, 'the reserve needs no raise')
  }
})

test('INTEG-3: the plan is told the raise FoxLeague serves', () => {
  const s = snapshot()
  ;(s.config as Record<string, unknown>).auction_min_increment_percent = 10
  s.market.auctions = [{ nft_nonce: 9, owner_address: STRANGER, name: 'X', position: 'MID', rarity: 'Rare', level: 1, speed: 50, accuracy: 50, defense: 50, power: 50, control: 50, vision: 50, stamina: 50, condition: 100, is_auction: true, min_price: 500, highest_bid: null, ends_at: new Date(Date.now() + 3600_000).toISOString(), transferred_at: null, transfer_cooldown_hours: null } as MarketListing]
  assert.match(renderDigest(s), /A bid must reach the reserve, or the top bid plus 10 percent/)
  delete (s.config as Record<string, unknown>).auction_min_increment_percent
  assert.match(renderDigest(s), /A bid must reach the reserve, or the top bid plus 5 percent/)
  // A raise that is no number, or game settings that were not read at all: said to be unread, never given as 5.
  ;(s.config as Record<string, unknown>).auction_min_increment_percent = 'ten'
  assert.match(renderDigest(s), /the raise over a top bid could not be read, so no raise is placed/)
  s.config = null
  assert.match(renderDigest(s), /the raise over a top bid could not be read, so no raise is placed/)
  assert.doesNotMatch(renderDigest(s), /top bid plus 5 percent/)
})
