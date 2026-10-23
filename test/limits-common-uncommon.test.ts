// Owner, 2026-10-24: a Common pack gives 5 cards for 2,500 FOXSY, so a Common bought above 500 is a bad trade, and an
// Uncommon should stay near its market price (1,133 over the last 30 days; building one costs 1,600 plus its 15
// matches). The limits per rarity gain Common 500 and Uncommon 1,500 by default, next to Rare 6,000, Epic 12,000 and
// Legendary 32,000, the same way: raising one asks for the password, the dashboard shows the market price under each
// and the plan sees all five limits and market prices.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkAction, type RulesContext } from '../src/executor/rules.ts'
import { DEFAULT_SETTINGS, validateSettingsPatch } from '../src/store/settings.ts'
import { raisesLimit } from '../src/web/server.ts'
import { Store } from '../src/store/db.ts'
import { renderDigest } from '../src/snapshot/digest.ts'
import { marketPrices } from '../src/snapshot/market.ts'
import { renderPlanRequest } from '../src/strategist/strategist.ts'
import { budgetView } from '../src/executor/budget.ts'
import { wholeToAtomic } from '../src/util/encoding.ts'
import { ADDR, MAINNET_GATE, OTHER, TEST_SETTINGS, setup, snapshot } from './fixtures.ts'

type Caps = { maxBidCommonFoxsy: number; maxBidUncommonFoxsy: number; maxBidRareFoxsy: number; maxBidEpicFoxsy: number; maxBidLegendaryFoxsy: number }
const html = readFileSync(new URL('../src/web/dashboard.html', import.meta.url), 'utf8')

test('the limits for a Common and an Uncommon default to 500 and 1,500, also for an agent made before them', () => {
  const d = DEFAULT_SETTINGS as unknown as Caps
  assert.deepEqual([d.maxBidCommonFoxsy, d.maxBidUncommonFoxsy, d.maxBidRareFoxsy, d.maxBidEpicFoxsy, d.maxBidLegendaryFoxsy], [500, 1500, 7000, 14_000, 38_000], 'Rare, Epic and Legendary since 2026-10-24: test/levels-bids-manual.test.ts')
  const store = new Store('', ':memory:')
  store.addAgent(0, ADDR)
  ;(store as unknown as { db: { prepare(q: string): { run(...a: unknown[]): void } } }).db.prepare('UPDATE agents SET settings = ? WHERE idx = 0').run(JSON.stringify({ strategy: 'x', maxBidFoxsy: 47000 }))
  const s = store.agent(0)!.settings as unknown as Caps
  assert.deepEqual([s.maxBidCommonFoxsy, s.maxBidUncommonFoxsy], [500, 1500])
})

test('a bid on a Common above 500 or an Uncommon above 1,500 is refused; a raised limit still meets the build cost', () => {
  const s = snapshot()
  s.chain!.foxsy = wholeToAtomic(200_000)
  // mainnet's gate rows and cooldown settings: a Common is worth 600 to build, an Uncommon 2,200 (test/bid-ceiling.test.ts)
  s.config = { ...s.config!, common_pack_price_foxsy: 2500, fusion_costs_foxsy: [100, 200, 400, 800], rarity_match_gate: MAINNET_GATE, fusion_card_cooldown_seconds: 1_209_600, fusion_cooldown_waiver_price_per_day: 75 } as typeof s.config
  const auction = { seller: OTHER, minPrice: wholeToAtomic(500), highestBid: 0n, highestBidder: null, endsAt: new Date(Date.now() + 3600_000) }
  const bid = (foxsy: number, rarity: string, more: Partial<Caps> = {}) =>
    checkAction({ type: 'bid', nonce: 9, foxsy }, s, { settings: { ...TEST_SETTINGS, ...DEFAULT_SETTINGS, maxBidFoxsy: 47_000, ...more }, now: new Date(), auction, cardRarity: rarity } as RulesContext)
  assert.equal(bid(500, 'Common').ok, true, bid(500, 'Common').refusal)
  assert.match(bid(501, 'Common').refusal!, /above your limit for a Common \(500 FOXSY\)/)
  assert.equal(bid(1500, 'Uncommon').ok, true, bid(1500, 'Uncommon').refusal)
  assert.match(bid(1501, 'Uncommon').refusal!, /above your limit for an Uncommon \(1500 FOXSY\)/)
  assert.equal(bid(2000, 'Uncommon', { maxBidUncommonFoxsy: 3000 }).ok, true, 'the owner raised it')
  assert.match(bid(2300, 'Uncommon', { maxBidUncommonFoxsy: 3000 }).refusal!, /above what an Uncommon costs to build yourself \(2200 FOXSY/, 'the build cost still holds above it')
  assert.match(bid(700, 'Common', { maxBidCommonFoxsy: 1000 }).refusal!, /costs to build yourself \(600 FOXSY/)
  assert.match(bid(0 + 600, 'Common', { maxBidCommonFoxsy: 0 }).refusal!, /above your limit for a Common \(0 FOXSY\)/, '0 turns bids on Commons off')
})

test('raising the limit for a Common or an Uncommon asks for the password, lowering it does not; each is validated', () => {
  const cur = DEFAULT_SETTINGS
  assert.equal(raisesLimit(cur, { maxBidCommonFoxsy: 600 } as never), true)
  assert.equal(raisesLimit(cur, { maxBidUncommonFoxsy: 2000 } as never), true)
  assert.equal(raisesLimit(cur, { maxBidUncommonFoxsy: 1000 } as never), false)
  assert.equal(raisesLimit(cur, { maxBidCommonFoxsy: 0 } as never), false)
  assert.deepEqual(validateSettingsPatch({ maxBidCommonFoxsy: 0, maxBidUncommonFoxsy: 2000 }), { maxBidCommonFoxsy: 0, maxBidUncommonFoxsy: 2000 })
  assert.throws(() => validateSettingsPatch({ maxBidCommonFoxsy: -1 }), /maxBidCommonFoxsy/)
  assert.throws(() => validateSettingsPatch({ maxBidUncommonFoxsy: 2_000_000 }), /maxBidUncommonFoxsy/)
})

test('the plan sees the five limits and the five market prices', () => {
  const s = snapshot()
  const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()
  const sales = [1, 2, 3, 4, 5].flatMap(n => [{ rarity: 'Common', price: 500, sold_at: day(n) }, { rarity: 'Uncommon', price: 1100, sold_at: day(n) }, { rarity: 'Rare', price: 6000, sold_at: day(n) }])
  s.market.prices = marketPrices(sales, new Date())
  assert.match(renderDigest(s), /Market prices \(median of the daily median sale prices; every trading day counts once\): Common 500 \(5 trading days in 30 days\), Uncommon 1,100 \(5 trading days in 30 days\), Rare 6,000 \(5 trading days in 30 days\), Epic unknown \(too few sales in 90 days\), Legendary unknown/)
  const store = setup().store
  const text = renderPlanRequest({ snapshot: s, settings: DEFAULT_SETTINGS, budget: budgetView(store, 0, DEFAULT_SETTINGS, true, new Date()), recent: [], dryRun: true })
  assert.match(text, /by rarity at most Common 500, Uncommon 1500, Rare 7000, Epic 14000, Legendary 38000 \(the owner's limits\)/)
})

test('the dashboard has the two new limits with their info bubbles and market lines, and the password guards them', () => {
  for (const [id, tip] of [['sBidCommon', 'bidCommon'], ['sBidUncommon', 'bidUncommon']] as const) {
    assert.match(html, new RegExp(`<label for="${id}">[^<]*<i class="info" data-tip="${tip}">i</i></label><input id="${id}" type="number" min="0" step="100"><div class="hint" id="h${id.slice(1)}"></div>`))
    assert.match(html, new RegExp(`\\n  ${tip}: \\[`), `the ${tip} info bubble`)
  }
  assert.match(html, /function renderLimitHints\(\) \{\n  for \(const r of \['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'\]\)/)
  assert.match(html, /\/\^sBid\(Common\|Uncommon\|Rare\|Epic\|Legendary\)\?\$\//)
  assert.match(html, /\$\('sBidCommon'\)\.value = st\.maxBidCommonFoxsy; \$\('sBidUncommon'\)\.value = st\.maxBidUncommonFoxsy/)
  assert.match(html, /maxBidCommonFoxsy: n\('sBidCommon'\), maxBidUncommonFoxsy: n\('sBidUncommon'\)/)
  assert.match(html, /const LIMITS = \[[^\]]*'maxBidCommonFoxsy', 'maxBidUncommonFoxsy', 'maxBidRareFoxsy'/)
  const page = readFileSync(new URL('../site/src/content/docs/use/settings.md', import.meta.url), 'utf8')
  assert.match(page, /\| Max bid for a Common \| 500 \|/)
  assert.match(page, /\| Max bid for an Uncommon \| 1,500 \|/)
})

// Agent review of PR #26 (low): the plan saw all five limits but the build cost of Rare, Epic and Legendary only, so
// with a raised Uncommon limit it could propose a bid the build-cost rule refuses.
test('the plan sees the build cost of all five rarities', () => {
  const s = snapshot()
  s.config = { ...s.config!, common_pack_price_foxsy: 2500, fusion_costs_foxsy: [100, 200, 400, 800], rarity_match_gate: MAINNET_GATE, fusion_card_cooldown_seconds: 1_209_600, fusion_cooldown_waiver_price_per_day: 75 } as typeof s.config
  const text = renderPlanRequest({ snapshot: s, settings: DEFAULT_SETTINGS, budget: budgetView(setup().store, 0, DEFAULT_SETTINGS, true, new Date()), recent: [], dryRun: true })
  assert.match(text, /never above what the card costs to build yourself and bring to its match gate \(Common 600, Uncommon 2200, Rare 14450, Epic 60400, Legendary 225650\)/)
})
