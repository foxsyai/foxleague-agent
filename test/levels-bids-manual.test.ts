// Owner, 2026-10-24: a bid needs room above the market price to be outbid once and bid again (an agent bids at most
// twice on one auction, each time 5 percent over the top bid), and the room only works in the limits per rarity, since
// a bid stops at the lowest of Max bid, its rarity's limit and the build cost. The limits become Common 500, Uncommon
// 1,500, Rare 7,000, Epic 14,000 and Legendary 38,000 (about 20 percent over the market for the last three; set again on
// 2026-11-22 by the owner's rule, BIDS-1: three of the rarity below plus 5 percent, Uncommon 1,650, Rare 5,200, Epic
// 16,400, Legendary 51,700); each
// level's Max bid is the limit of the dearest rarity it buys: hunter Uncommon, predator Rare, beast Epic, Zeus all. The
// manual tells the rules in general, with examples, never the dated prices and events of our testing.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, LEVEL_AI, LEVEL_SETTINGS, STRATEGY_PRESETS } from '../src/store/settings.ts'
import { MAX_BIDS_PER_AUCTION } from '../src/executor/rules.ts'

const REPO = new URL('..', import.meta.url).pathname
const read = (f: string) => readFileSync(join(REPO, f), 'utf8')
const D = DEFAULT_SETTINGS as typeof DEFAULT_SETTINGS & { maxBidCommonFoxsy: number; maxBidUncommonFoxsy: number }
const LEVELS = ['steady', 'climber', 'hunter', 'predator', 'beast', 'zeus'] as const
const n = (v: number) => v.toLocaleString('en-US')

test('the limits per rarity follow the owner\'s rule: three cards of the rarity below plus 5 percent (BIDS-1)', () => {
  // The owner, 2026-11-22: a card is three of the rarity below fused, so each limit is three times the one below plus
  // 5 percent, from a Common at 525, rounded; the Common itself stays at a pack card's price.
  assert.deepEqual([D.maxBidCommonFoxsy, D.maxBidUncommonFoxsy, D.maxBidRareFoxsy, D.maxBidEpicFoxsy, D.maxBidLegendaryFoxsy], [500, 1650, 5200, 16_400, 51_700])
  let chain = 500 * 1.05
  for (const limit of [D.maxBidUncommonFoxsy, D.maxBidRareFoxsy, D.maxBidEpicFoxsy, D.maxBidLegendaryFoxsy]) {
    chain *= 3 * 1.05
    assert.ok(Math.abs(limit - chain) / chain < 0.01, `${limit} is the rule's ${Math.round(chain)}, rounded`)
  }
  assert.equal(D.maxBidCommonFoxsy, 2500 / 5, 'a Common never above a pack card')
  assert.equal(MAX_BIDS_PER_AUCTION, 2, 'one bid and one more after being outbid')
  // Against the dashboard's market prices of that day (Rare 4,800, Epic 11,700, Legendary 46,000): a bid at the market
  // and one 5 percent raise always fit; a second round (a raise over a rival's raise) fits an Epic and a Legendary.
  const market = { Rare: 4800, Epic: 11_700, Legendary: 46_000 }
  const limits = { Rare: D.maxBidRareFoxsy, Epic: D.maxBidEpicFoxsy, Legendary: D.maxBidLegendaryFoxsy }
  for (const r of ['Rare', 'Epic', 'Legendary'] as const) assert.ok(market[r] * 1.05 <= limits[r], `${r}: room for a raise`)
  for (const r of ['Epic', 'Legendary'] as const) assert.ok(market[r] * 1.05 * 1.05 <= limits[r], `${r}: room for a second bid`)
  // The Uncommon's 1,650 is above three pack Commons and the fusion fee (1,600) but under the build ceiling, which also
  // counts its 15 matches (2,200 on mainnet's settings of that day): a bid never goes above building one.
  assert.ok(D.maxBidUncommonFoxsy < 2200, 'an Uncommon under its build ceiling')
})

test('each level\'s max bid is the limit of the dearest rarity it buys, and fits its daily cap', () => {
  // Every level bids since 2026-11-06, on any rarity within its max bid and the limit per rarity.
  assert.deepEqual(LEVELS.map(l => LEVEL_SETTINGS[l]!.maxBidFoxsy), [D.maxBidCommonFoxsy, D.maxBidUncommonFoxsy, D.maxBidRareFoxsy, D.maxBidEpicFoxsy, D.maxBidEpicFoxsy, D.maxBidLegendaryFoxsy])
  // The manual sizes the dollar limits for a FOXSY price of about $0.0027.
  for (const l of LEVELS) assert.ok(LEVEL_SETTINGS[l]!.maxBidFoxsy * 0.0027 < LEVEL_SETTINGS[l]!.dailyCapUsd, `${l}: a bid at the max fits the daily cap`)
})

test('every level buys a player of any rarity at a good price; the max bid and the limit per rarity decide what is in reach', () => {
  for (const [level, text] of Object.entries(STRATEGY_PRESETS)) {
    assert.match(text, /Buy a player of any rarity only at a good price/, level)
    assert.doesNotMatch(text, /Bid on Common|never Common or Uncommon/, level)
  }
})

test('the manual\'s tables of the levels show the code\'s defaults', () => {
  const page = read('site/src/content/docs/play/strategy-levels.md')
  const row = (label: string) => page.split('\n').find(l => l.startsWith(`| ${label} |`))?.split('|').slice(2, 8).map(c => c.trim())
  const L = LEVELS.map(l => LEVEL_SETTINGS[l]!)
  const money = (k: 'dailyCapUsd' | 'monthlyBudgetUsd' | 'topUpWarningUsd') => L.map(l => `$${n(l[k])}`)
  assert.deepEqual(row('Daily cap'), money('dailyCapUsd'))
  assert.deepEqual(row('Monthly budget'), money('monthlyBudgetUsd'))
  assert.deepEqual(row('Top-up warning'), money('topUpWarningUsd'))
  assert.deepEqual(row('Max entry fee or stake (FOXSY)'), L.map(l => n(l.maxEntryFeeFoxsy)))
  assert.deepEqual(row('Max shop payment (FOXSY)'), L.map(l => n(l.maxShopPaymentFoxsy)))
  assert.deepEqual(row('Max swap (FOXSY)'), L.map(l => n(l.maxSwapFoxsy)))
  assert.deepEqual(row('Max bid (FOXSY)'), L.map(l => (l.maxBidFoxsy ? n(l.maxBidFoxsy) : '0 (off)')))
  // The level counts (2026-11-06).
  assert.deepEqual(row('Paid training a day'), L.map(l => String(l.paidTrainingPerDay)))
  assert.deepEqual(row('Boosters a week'), L.map(l => String(l.boostersPerWeek)))
  assert.deepEqual(row('Packs a week'), L.map(l => String(l.packsPerWeek)))
  assert.deepEqual(row('Tick'), L.map(l => `${l.tickMinutes} min`))
  const ai = (m: string) => m.replace('claude-', '').replace(/^(\w)/, c => c.toUpperCase()).replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/-(\d+)$/, ' $1')
  assert.deepEqual(row('Recommended AI'), LEVELS.map(l => `${ai(LEVEL_AI[l]!.model)}, ${LEVEL_AI[l]!.effort}`))
  const settings = read('site/src/content/docs/use/settings.md')
  for (const [label, v] of [['a Common', D.maxBidCommonFoxsy], ['an Uncommon', D.maxBidUncommonFoxsy], ['a Rare', D.maxBidRareFoxsy], ['an Epic', D.maxBidEpicFoxsy], ['a Legendary', D.maxBidLegendaryFoxsy]] as const) {
    assert.match(settings, new RegExp(`\\| Max bid for ${label} \\| ${n(v)} \\|`), `the settings page gives the default for ${label}`)
  }
})

function pages(dir: string): string[] {
  return readdirSync(join(REPO, dir)).flatMap(f => {
    const p = join(dir, f)
    return statSync(join(REPO, p)).isDirectory() ? pages(p) : /\.mdx?$/.test(f) ? [p] : []
  })
}

test('the manual, README, INSTALL.md and the dashboard\'s info bubbles tell no dated prices or events of our testing', () => {
  const html = read('src/web/dashboard.html')
  const tips = html.slice(html.indexOf('\nconst TIPS = {'), html.indexOf('\n}\n', html.indexOf('\nconst TIPS = {')))
  assert.ok(tips.length > 1000, 'the info bubbles were found')
  const texts: [string, string][] = [...pages('site/src/content/docs').map(p => [p, read(p)] as [string, string]), ['README.md', read('README.md')], ['INSTALL.md', read('INSTALL.md')], ['dashboard info bubbles', tips]]
  for (const [name, text] of texts) {
    const flat = text.replace(/\s+/g, ' ')
    for (const bad of [/\b(January|February|March|April|May|June|July|August|September|October|November|December) 20\d\d\b/, /\b\d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December)\b/, /xExchange pause/, /sell-off/, /what agents spent/]) {
      assert.doesNotMatch(flat, bad, `${name} tells a dated price or event of our testing`)
    }
  }
})

test('the strategy levels page says every level bids on any rarity within its max bid, as the texts do', () => {
  const page = read('site/src/content/docs/play/strategy-levels.md').replace(/\s+/g, ' ')
  assert.doesNotMatch(page, /never on Common or Uncommon ones/)
  assert.match(page, /\| Bids at auction \| any rarity, up to 500 \| up to 1,650 \| up to 5,200 \| up to 16,400 \| up to 16,400 \| up to 51,700 \|/)
  assert.match(page, /So a Steady agent can take a Legendary listed at 500 FOXSY; Zeus can buy a Common, never above 500 for it\./)
})

// Agent review of PR #27 (medium): an agent saves its whole settings (at creation since PR #21, or on any save), and a
// saved limit wins over a new default. So only an agent that never saved its limits gets the new ones; one that did
// keeps the lower limits it saved (raising them asks for the password). The record said every agent on the defaults
// got them at once.
test('an agent that saved its limits keeps them; one that never did gets the new defaults; the record says so', async () => {
  const { Store } = await import('../src/store/db.ts')
  const { ADDR } = await import('./fixtures.ts')
  const store = new Store('', ':memory:')
  store.addAgent(0, ADDR)
  ;(store as unknown as { db: { prepare(q: string): { run(...a: unknown[]): void } } }).db.prepare('UPDATE agents SET settings = ? WHERE idx = 0').run(JSON.stringify({ ...DEFAULT_SETTINGS, maxBidRareFoxsy: 6000, maxBidEpicFoxsy: 12_000, maxBidLegendaryFoxsy: 32_000 }))
  assert.deepEqual([store.agent(0)!.settings.maxBidRareFoxsy, store.agent(0)!.settings.maxBidEpicFoxsy, store.agent(0)!.settings.maxBidLegendaryFoxsy], [6000, 12_000, 32_000], 'saved limits win')
  ;(store as unknown as { db: { prepare(q: string): { run(...a: unknown[]): void } } }).db.prepare('UPDATE agents SET settings = ? WHERE idx = 0').run(JSON.stringify({ strategy: 'x' }))
  assert.equal(store.agent(0)!.settings.maxBidRareFoxsy, 5200, 'no saved limit: the new default')
  const record = read('docs/SECURITY-REVIEW.md').replace(/\s+/g, ' ')
  assert.doesNotMatch(record, /Agents on the defaults get them at once/)
  assert.match(record, /an agent that saved its limits keeps them/)
})

// Agent review of PR #27 (low): the dashboard's Strategy bubble still said a hunter bids on Rare, Epic and Legendary
// players, never Common or Uncommon.
test('no info bubble or manual page keeps the old bidding rule', () => {
  const html = read('src/web/dashboard.html').replace(/\s+/g, ' ')
  assert.doesNotMatch(html, /never Common or Uncommon/)
  assert.match(html, /the largest entry, shop payment and bid \(any rarity, within its limit\)/, 'every level bids on any rarity (2026-11-06)')
  for (const p of pages('site/src/content/docs')) assert.doesNotMatch(read(p).replace(/\s+/g, ' '), /never (on )?Common or Uncommon/, p)
})

// Re-review of PR #27 (medium): the plan saw only the 15 strongest open auctions, and stats are capped per rarity, so
// with 15 stronger cards listed a hunter (Commons and Uncommons) had nothing to bid on. The snapshot keeps the 10
// strongest and adds the 3 cheapest auctions of each rarity, from one more read sorted by price.
test('the plan sees the cheapest auctions of each rarity next to the strongest', async () => {
  const { takeSnapshot } = await import('../src/snapshot/snapshot.ts')
  const { renderDigest } = await import('../src/snapshot/digest.ts')
  const { ADDR, OTHER, dryWallet, snapshot } = await import('./fixtures.ts')
  const card = (nonce: number, rarity: string, stat: number, price: number) => ({ nft_nonce: nonce, owner_address: OTHER, name: `Card ${nonce}`, position: 'FWD', rarity, level: 1, speed: stat, accuracy: stat, defense: stat, power: stat, control: stat, vision: stat, stamina: stat, condition: 100, is_auction: true, min_price: price, highest_bid: null, ends_at: new Date(Date.now() + 3600_000).toISOString(), transferred_at: null, transfer_cooldown_hours: null })
  const strongest = Array.from({ length: 20 }, (_, i) => card(100 + i, i < 10 ? 'Epic' : 'Rare', 60 - i, 9000 - i * 100))
  const cheapest = [card(1, 'Common', 12, 500), card(2, 'Common', 11, 500), card(3, 'Common', 10, 520), card(4, 'Common', 9, 550), card(5, 'Uncommon', 25, 900), card(6, 'Uncommon', 24, 1000), card(7, 'Uncommon', 26, 1100), card(8, 'Uncommon', 27, 1400), card(119, 'Rare', 41, 7100), card(9, 'Common', 9, 400)]
  cheapest[cheapest.length - 1]!.owner_address = ADDR // our own listing never shows
  const sorts: string[] = []
  const fox: Record<string, unknown> = {
    config: async () => snapshot().config, user: async (a: string) => (a === ADDR ? snapshot().profile : null), team: async () => snapshot().team, players: async () => [],
    tournaments: async () => [], leaderboard: async () => ({ users: [], total: 0, limit: 200, offset: 0 }), floorPrices: async () => [],
    listings: async (q: { sort_by?: string }) => { sorts.push(String(q.sort_by)); return q.sort_by === 'price_asc' ? cheapest : strongest },
    shopStatus: async () => snapshot().auth!.shop, dailyAllowance: async () => snapshot().auth!.allowance, activeMatch: async () => null,
    myTournaments: async () => ({ active: [], completed: [] }), upcomingMatches: async () => ({ lead_minutes: 30, my_team_name: 'Agent', matches: [] }),
    challengesForMe: async () => [], matchHistory: async () => [],
  }
  const chain = { account: async () => ({ balance: 0n, nonce: 1 }), esdts: async () => [], egldUsd: async () => 25, query: async () => { throw new Error('no pool in this test') } }
  const s = await takeSnapshot({ chain, fox } as never, { wallet: { ...dryWallet, address: ADDR } }, new Date())
  assert.deepEqual(sorts.sort(), ['overall_desc', 'price_asc'])
  const nonces = s.market.auctions.map(a => a.nft_nonce)
  assert.deepEqual(nonces.slice(0, 10), strongest.slice(0, 10).map(c => c.nft_nonce), 'the 10 strongest first')
  for (const n of [1, 2, 3, 5, 6, 7]) assert.ok(nonces.includes(n), `#${n}, among the 3 cheapest of its rarity, is shown`)
  for (const n of [4, 8, 9]) assert.ok(!nonces.includes(n), `#${n} is not shown (the 4th cheapest of its rarity, or our own)`)
  assert.equal(new Set(nonces).size, nonces.length, 'each auction once')
  assert.match(renderDigest(s), /Open auctions: the 10 strongest, then the 3 cheapest of each rarity \(nonce, card, OVR, price now, ends\):/)
})

// Re-review of PR #27 (low, coverage): a failed read (null) of either list leaves the other one.
test('a failed read of either auction list leaves the other one', async () => {
  const { auctionsShown } = await import('../src/snapshot/snapshot.ts')
  const row = (nonce: number, rarity: string) => ({ nft_nonce: nonce, owner_address: 'erd1someone', rarity, is_auction: true }) as never
  assert.deepEqual(auctionsShown([row(1, 'Rare'), row(2, 'Epic')], null, 'erd1me').map(l => (l as { nft_nonce: number }).nft_nonce), [1, 2], 'the strongest without the cheapest')
  assert.deepEqual(auctionsShown(null, [row(3, 'Common'), row(4, 'Uncommon')], 'erd1me').map(l => (l as { nft_nonce: number }).nft_nonce), [3, 4], 'the cheapest without the strongest')
  assert.deepEqual(auctionsShown(null, null, 'erd1me'), [])
})

// Agent review of PR #40: the Zeus strategy still priced ranked at K 24; mainnet runs 9 / 13 / 17 since 2026-10-30.
test('R78-2: no strategy prices ranked as the largest ELO swing', () => {
  for (const [level, text] of Object.entries(STRATEGY_PRESETS)) {
    assert.doesNotMatch(text, /K 24|ELO the most/, level)
  }
  assert.match(STRATEGY_PRESETS.zeus!, /Ranked matches move ELO less than a Silver or Gold match/)
})
