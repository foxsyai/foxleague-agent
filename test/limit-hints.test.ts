// Owner, 2026-10-23: the limits per rarity stay fixed by default, so one look at the dashboard should tell an owner
// whether each still fits the market: the market price under the field, green when the limit is in range, amber when
// it is under the market (the agent may miss most sales), red when it is far above (it may pay too much), with a
// button that fills in the market price, rounded the way the defaults were.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const html = readFileSync(new URL('../src/web/dashboard.html', import.meta.url), 'utf8')

function limitState(): (limit: number, market: number | null, maxBid?: number) => { tone: string; text: string; suggest?: number } {
  const src = html.match(/function limitState\(limit, market, maxBid = Infinity\) \{[\s\S]*?\n\}/)?.[0]
  assert.ok(src, 'the dashboard defines limitState(limit, market, maxBid)')
  return new Function(`${src}; return limitState`)()
}

test('a limit within 90 to 150 percent of the market price is green, under it amber, over it red, with a rounded suggestion', () => {
  const state = limitState()
  assert.deepEqual(state(6000, 6100), { tone: 'ok', text: 'Market today: 6,100 FOXSY. Your limit covers it.' })
  assert.deepEqual(state(5000, 6100), { tone: 'low', text: 'Market today: 6,100 FOXSY. Below the market: the agent may miss most sales.', suggest: 6000 })
  assert.deepEqual(state(10_000, 6100), { tone: 'high', text: 'Market today: 6,100 FOXSY. Well above the market: the agent aims lower, but may pay up to this.', suggest: 6000 })
  assert.equal(state(0, 6100).tone, 'low')
  assert.match(state(0, 6100).text, /Bids on this rarity are off/)
  assert.equal(state(12_000, 11_828).tone, 'ok')
  assert.equal(state(9000, 11_828).suggest, 12_000, 'rounded to 1,000 from 10,000 up')
  assert.equal(state(20_000, 31_240).suggest, 31_000)
  assert.equal(state(1200, 1300).tone, 'ok', '92 percent of the market is in range')
  assert.equal(state(500, 1300).suggest, 1500, 'rounded to 500 under 10,000')
  assert.deepEqual(state(6000, null), { tone: 'none', text: 'Market today: too few sales to tell' })
})

// Agent review of PR #22 (medium): the bid rule checks Max bid first, so the line must judge whichever binds.
test('the line judges the limit that binds: Max bid when it is lower than the limit for the rarity', () => {
  const state = limitState()
  assert.deepEqual(state(6000, 6100, 0), { tone: 'low', text: 'Market today: 6,100 FOXSY. Bids are off: Max bid is 0.' })
  assert.deepEqual(state(6000, 6100, 4000), { tone: 'low', text: 'Market today: 6,100 FOXSY. Below the market: the agent may miss most sales. Max bid (4,000) is the limit here.' }, 'no button: the field for the rarity would not help')
  assert.equal(state(32_000, 31_240, 15_000).tone, 'low')
  assert.deepEqual(state(20_000, 6100, 12_000), { tone: 'high', text: 'Market today: 6,100 FOXSY. Well above the market: the agent aims lower, but may pay up to this. Max bid (12,000) is the limit here.', suggest: 6000 }, 'lowering the limit for the rarity does help')
  assert.equal(state(6000, 6100, 47_000).tone, 'ok')
})

test('the hints are drawn on load and again as a limit is typed, each tone with its colour', () => {
  assert.match(html, /renderLimitHints\(\)/)
  assert.match(html, /\$\('settingsForm'\)\.addEventListener\('input', e => \{ if \(\/\^sBid\(Rare\|Epic\|Legendary\)\?\$\/\.test\(e\.target\.id\)\) renderLimitHints\(\) \}\)/, 'Max bid too')
  assert.match(html, /limitState\(Number\(\$\('sBid' \+ r\)\.value\), p \? p\.price : null, Number\(\$\('sBid'\)\.value\)\)/)
  assert.match(html, /form\.settings \.hint\.mk\.ok\{color:var\(--up\)\}/)
  assert.match(html, /form\.settings \.hint\.mk\.low\{color:var\(--acc\)\}/)
  assert.match(html, /form\.settings \.hint\.mk\.high\{color:var\(--down\)\}/)
})

// Left open by the review of PR #21 (low): an auction whose rarity is a name every object inherits (toString,
// constructor) looked up the market prices through the prototype chain and threw, which stopped the digest.
test('an auction of an odd rarity has no market price and the digest still renders', async () => {
  const { renderDigest } = await import('../src/snapshot/digest.ts')
  const { snapshot } = await import('./fixtures.ts')
  const { marketPrices } = await import('../src/snapshot/market.ts')
  const s = snapshot()
  s.market.prices = marketPrices([], new Date())
  for (const rarity of ['toString', 'constructor', '__proto__']) {
    s.market.auctions = [{ nft_nonce: 7, name: 'Odd', position: 'FWD', rarity, level: 1, speed: 40, accuracy: 40, defense: 40, power: 40, control: 40, vision: 40, stamina: 40, condition: 100, is_auction: true, min_price: 500, highest_bid: null, ends_at: new Date(Date.now() + 3600_000).toISOString() } as never]
    assert.match(renderDigest(s), /#7 Odd FWD .* reserve 500 \| ends/, rarity)
  }
})

// Review of PR #22 (low): applying a level sets Max bid from code, which fires no input event, so the lines kept
// the old Max bid until a field was edited.
test('applying a level draws the market lines again', () => {
  const fill = html.match(/function fillLevel\(l\) \{[\s\S]*?\n\}/)?.[0]
  assert.ok(fill, 'the dashboard defines fillLevel(l)')
  assert.match(fill, /\$\('sBid'\)\.value = l\.maxBidFoxsy[\s\S]*renderLimitHints\(\)\n\}$/)
})

// Review of PR #22 (low, docs): the settings page did not say what a Max bid of 0 or under the limit shows.
test('the settings page says what the line shows when Max bid is 0 or binds', () => {
  const page = readFileSync(new URL('../site/src/content/docs/use/settings.md', import.meta.url), 'utf8')
  assert.match(page, /Bids are off: Max bid is 0/)
  assert.match(page, /Max bid \(4,000\) is the limit here/)
})
