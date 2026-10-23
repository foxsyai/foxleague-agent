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
