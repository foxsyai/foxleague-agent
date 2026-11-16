// MNT-2b (second half of MNT-2, the owner's word of 16 Nov): the executor pays the wallet's own Shop price once
// FoxLeague's MetaStaking discount is live (MNT-2, CHN-1), but the plan weighed the list prices only: the snapshot
// showed no Shop price at all and the instructions name the list ones. While the switch is live the snapshot shows
// the wallet's prices and its rate next to the list prices; while it is off, the list prices only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderDigest } from '../../src/snapshot/digest.ts'
import { snapshot } from '../fixtures.ts'

const LIVE = { live: true, live_from: '2026-12-01T14:00:00Z', foxsy_per_step: 10_000, bp_per_step: 10, max_bp: 1000, quote_valid_seconds: 900 }
const OFF = { ...LIVE, live: false, live_from: null }
const LEVELS = { live: true, live_from: '2026-11-09T14:00:00Z', ranked_ticket_price_foxsy: 25, xp_factor_pct: { ranked: 25, bronze: 50, silver: 75, gold: 100 }, elo_k: { ranked: 5, bronze: 9, silver: 13, gold: 17 }, private_bronze_earns: true, competitive_daily_cap: 3 }

function withSwitch(block: unknown, rate?: number) {
  const s = snapshot()
  Object.assign(s.config as object, { metastaking_discount: block, competition_levels: LEVELS })
  if (rate !== undefined) Object.assign(s.auth!.shop as object, { metastaking_discount_bp: rate })
  return s
}
const shopLine = (text: string) => text.split('\n').find(l => /^Shop prices/.test(l)) ?? ''

test('MNT-2b while the discount is live the snapshot shows the wallet\'s own Shop prices and its rate next to the list prices', () => {
  const line = shopLine(renderDigest(withSwitch(LIVE, 500)))
  assert.ok(line, 'no Shop prices line: the plan weighs list prices while the executor pays the wallet\'s')
  assert.match(line, /500 basis points, 5 percent off/)
  assert.match(line, /XP booster 1900 \(list 2000\)/)
  assert.match(line, /Common pack 2375 \(list 2500\)/)
  assert.match(line, /training slot 19 for one \(list 20\)/)
  assert.match(line, /condition recovery 95 for a card's 100 points \(list 100\)/)
  assert.match(line, /ranked ticket 24 \(list 25\)/)
  assert.match(line, /medicine[^;]*5 percent off/)
})

test('MNT-2b while the discount is off the snapshot shows the list prices only', () => {
  for (const s of [withSwitch(OFF, 0), withSwitch(OFF, 500), withSwitch(undefined)]) {
    const line = shopLine(renderDigest(s))
    assert.match(line, /^Shop prices \(FOXSY\): XP booster 2000, Common pack 2500, training slot 20 each, condition recovery 100 for a card's 100 points$/)
    assert.doesNotMatch(line, /list|percent off|basis points/)
  }
})

test('MNT-2b while the discount is live and the wallet\'s rate is unread the snapshot says so, never a price', () => {
  const line = shopLine(renderDigest(withSwitch(LIVE)))
  assert.match(line, /unknown/)
  assert.match(line, /buys nothing in the Shop/)
  assert.match(line, /list prices: XP booster 2000/)
  assert.doesNotMatch(line, /1900/)
})
