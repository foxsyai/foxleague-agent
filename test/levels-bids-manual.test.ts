// Owner, 2026-10-24: a bid needs room above the market price to be outbid once and bid again (an agent bids at most
// twice on one auction, each time 5 percent over the top bid), and the room only works in the limits per rarity, since
// a bid stops at the lowest of Max bid, its rarity's limit and the build cost. The limits become Common 500, Uncommon
// 1,500, Rare 7,000, Epic 14,000 and Legendary 38,000 (about 20 percent over the market for the last three), and each
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

test('the limits per rarity leave room over the market price to be outbid once and bid again', () => {
  assert.deepEqual([D.maxBidCommonFoxsy, D.maxBidUncommonFoxsy, D.maxBidRareFoxsy, D.maxBidEpicFoxsy, D.maxBidLegendaryFoxsy], [500, 1500, 7000, 14_000, 38_000])
  assert.equal(MAX_BIDS_PER_AUCTION, 2, 'one bid and one more after being outbid')
  // The market prices the defaults were set from (the median of the daily medians over 30 days).
  const market = { Rare: 5650, Epic: 11_828, Legendary: 31_240 }
  for (const [r, limit] of [['Rare', D.maxBidRareFoxsy], ['Epic', D.maxBidEpicFoxsy], ['Legendary', D.maxBidLegendaryFoxsy]] as const) {
    const over = limit / market[r] - 1
    assert.ok(over >= 0.15 && over <= 0.25, `${r}: ${Math.round(over * 100)} percent over the market`)
    // A first bid at the market and one 5 percent raise over a rival's 5 percent raise both fit.
    assert.ok(market[r] * 1.05 * 1.05 <= limit, `${r}: room for a second bid`)
  }
  assert.equal(D.maxBidCommonFoxsy, 2500 / 5, 'a Common never above a pack card')
  assert.ok(D.maxBidUncommonFoxsy < 3 * 500 + 100, 'an Uncommon under its cost from packs and the fusion fee')
})

test('each level\'s max bid is the limit of the dearest rarity it buys, and fits its daily cap', () => {
  assert.deepEqual(LEVELS.map(l => LEVEL_SETTINGS[l]!.maxBidFoxsy), [0, 0, D.maxBidUncommonFoxsy, D.maxBidRareFoxsy, D.maxBidEpicFoxsy, D.maxBidLegendaryFoxsy])
  // The manual sizes the dollar limits for a FOXSY price of about $0.0027.
  for (const l of LEVELS) assert.ok(LEVEL_SETTINGS[l]!.maxBidFoxsy * 0.0027 < LEVEL_SETTINGS[l]!.dailyCapUsd, `${l}: a bid at the max fits the daily cap`)
})

test('the hunter, predator and beast texts name the rarities each buys; Zeus buys any at a good price', () => {
  assert.match(STRATEGY_PRESETS.hunter!, /Bid on Common and Uncommon players/)
  assert.match(STRATEGY_PRESETS.predator!, /Bid on Common, Uncommon and Rare players/)
  assert.match(STRATEGY_PRESETS.beast!, /Bid on Common, Uncommon, Rare and Epic players/)
  for (const k of ['hunter', 'predator', 'beast']) assert.doesNotMatch(STRATEGY_PRESETS[k]!, /never Common or Uncommon/)
  assert.match(STRATEGY_PRESETS.zeus!, /Buy a player only at a good price/)
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
  assert.deepEqual(row('Default max bid (FOXSY)'), L.map(l => (l.maxBidFoxsy ? n(l.maxBidFoxsy) : '')))
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

test('the strategy levels page says which rarities each level buys, as the texts do', () => {
  const page = read('site/src/content/docs/play/strategy-levels.md').replace(/\s+/g, ' ')
  assert.doesNotMatch(page, /never on Common or Uncommon ones/)
  assert.match(page, /\| Bids at auction \| \| \| Common, Uncommon \| up to Rare \| up to Epic \| any rarity, only at a good price, for a reason \|/)
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
  assert.equal(store.agent(0)!.settings.maxBidRareFoxsy, 7000, 'no saved limit: the new default')
  const record = read('docs/SECURITY-REVIEW.md').replace(/\s+/g, ' ')
  assert.doesNotMatch(record, /Agents on the defaults get them at once/)
  assert.match(record, /an agent that saved its limits keeps them/)
})

// Agent review of PR #27 (low): the dashboard's Strategy bubble still said a hunter bids on Rare, Epic and Legendary
// players, never Common or Uncommon.
test('no info bubble or manual page keeps the old bidding rule', () => {
  const html = read('src/web/dashboard.html').replace(/\s+/g, ' ')
  assert.doesNotMatch(html, /never Common or Uncommon/)
  assert.match(html, /<b>Hunter<\/b>: plus its own tournaments, the booster on strong match days and bids on Common and Uncommon players/)
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
