// Owner, 2026-10-23: a bid should not pay more than the market. Sales since mainnet (1,217 by 23 October) put the
// typical Rare at about 6,100 FOXSY, the Epic at 11,800 and the Legendary at 31,200 (the median of the daily median
// sale prices of the last 30 days, so the sell-off of 13 October counts as one day). The owner set round limits per
// rarity from them, 6,000, 12,000 and 32,000, as defaults any owner may raise (with the password), and the plan sees
// the market price of each rarity to aim below it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkAction, type RulesContext } from '../src/executor/rules.ts'
import { DEFAULT_SETTINGS, validateSettingsPatch } from '../src/store/settings.ts'
import { raisesLimit } from '../src/web/server.ts'
import { Store } from '../src/store/db.ts'
import { takeSnapshot } from '../src/snapshot/snapshot.ts'
import { renderDigest } from '../src/snapshot/digest.ts'
import { renderPlanRequest } from '../src/strategist/strategist.ts'
import { SYSTEM_PROMPT } from '../src/strategist/prompt.ts'
import { budgetView } from '../src/executor/budget.ts'
import { wholeToAtomic } from '../src/util/encoding.ts'
import { ADDR, OTHER, TEST_SETTINGS, dryWallet, setup, snapshot } from './fixtures.ts'

type Caps = { maxBidRareFoxsy: number; maxBidEpicFoxsy: number; maxBidLegendaryFoxsy: number }

// Since 2026-10-24 about 20 percent over the market (7,000, 14,000 and 38,000): test/levels-bids-manual.test.ts.
test('the limits per rarity default to 5,500, 13,000 and 50,000 (BIDS-1, the owner 2026-11-22), also for an agent made before them', () => {
  const d = DEFAULT_SETTINGS as unknown as Caps
  assert.deepEqual([d.maxBidRareFoxsy, d.maxBidEpicFoxsy, d.maxBidLegendaryFoxsy], [5500, 13_000, 50_000])
  const store = new Store('', ':memory:')
  store.addAgent(0, ADDR)
  ;(store as unknown as { db: { prepare(q: string): { run(...a: unknown[]): void } } }).db.prepare("UPDATE agents SET settings = ? WHERE idx = 0").run(JSON.stringify({ strategy: 'x', maxBidFoxsy: 47000 }))
  const s = store.agent(0)!.settings as unknown as Caps
  assert.deepEqual([s.maxBidRareFoxsy, s.maxBidEpicFoxsy, s.maxBidLegendaryFoxsy], [5500, 13_000, 50_000])
})

test('a bid above the owner\'s limit for its rarity is refused; a raised limit is honoured within the max bid', () => {
  const s = snapshot()
  s.chain!.foxsy = wholeToAtomic(200_000)
  // mainnet's cooldown settings, so the build cost (Rare 14,450, Epic 60,400) sits above the limits tested here
  s.config = { ...s.config!, fusion_card_cooldown_seconds: 1_209_600, fusion_cooldown_waiver_price_per_day: 75 } as typeof s.config
  const auction = { seller: OTHER, minPrice: wholeToAtomic(500), highestBid: 0n, highestBidder: null, endsAt: new Date(Date.now() + 3600_000) }
  const bid = (foxsy: number, rarity: string, more: Partial<Caps> = {}) =>
    checkAction({ type: 'bid', nonce: 9, foxsy }, s, { settings: { ...TEST_SETTINGS, maxBidFoxsy: 47_000, ...more }, now: new Date(), auction, cardRarity: rarity } as RulesContext)
  assert.equal(bid(5500, 'Rare').ok, true, bid(5500, 'Rare').refusal)
  assert.match(bid(5501, 'Rare').refusal!, /above your limit for a Rare \(5500 FOXSY\)/)
  assert.match(bid(13_001, 'Epic').refusal!, /above your limit for an Epic \(13000 FOXSY\)/)
  assert.match(bid(47_000, 'Legendary', { maxBidLegendaryFoxsy: 45_000 }).refusal!, /above your limit for a Legendary \(45000 FOXSY\)/)
  assert.equal(bid(40_000, 'Legendary', { maxBidLegendaryFoxsy: 45_000 }).ok, true, 'the owner set it')
  assert.match(bid(46_000, 'Legendary', { maxBidLegendaryFoxsy: 60_000, maxBidFoxsy: 45_000 } as never).refusal!, /per-action maximum 45000/, 'the max bid still binds on top')
  assert.equal(bid(1000, 'Uncommon').ok, true, 'under the Uncommon limit (1,500 since 2026-10-24: test/limits-common-uncommon.test.ts)')
})

test('raising a limit per rarity asks for the password, lowering it does not; each is validated', () => {
  const cur = DEFAULT_SETTINGS
  assert.equal(raisesLimit(cur, { maxBidRareFoxsy: 8000 } as never), true)
  assert.equal(raisesLimit(cur, { maxBidLegendaryFoxsy: 55_000 } as never), true)
  assert.equal(raisesLimit(cur, { maxBidEpicFoxsy: 10_000 } as never), false)
  assert.deepEqual(validateSettingsPatch({ maxBidRareFoxsy: 7000, maxBidEpicFoxsy: 0, maxBidLegendaryFoxsy: 32000 }), { maxBidRareFoxsy: 7000, maxBidEpicFoxsy: 0, maxBidLegendaryFoxsy: 32000 })
  assert.throws(() => validateSettingsPatch({ maxBidRareFoxsy: -1 }), /maxBidRareFoxsy/)
})

// ---- the market price ----

const day = (daysAgo: number, h = 12) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10) + `T${String(h).padStart(2, '0')}:00:00Z`
let nextId = 1
const sale = (rarity: string, price: number, daysAgo: number) => ({ id: nextId++, rarity, price, sold_at: day(daysAgo), nft_nonce: 1, player_name: 'X', position: 'FWD', overall: 40, seller_address: OTHER, buyer_address: ADDR, tx_hash: 'h' })

test('the market price is the median of the daily median sale prices; a thin rarity looks further back, or has none', async () => {
  const { marketPrices } = await import('../src/snapshot/market.ts') as unknown as { marketPrices(s: unknown[], now: Date): Record<string, { price: number; tradingDays: number; windowDays: number } | null> }
  const sales = [
    // Rare: a sell-off day of 50 sales at 500 counts once next to 5 single days.
    ...Array.from({ length: 50 }, () => sale('Rare', 500, 3)),
    sale('Rare', 6000, 4), sale('Rare', 6500, 6), sale('Rare', 7000, 8), sale('Rare', 7500, 10), sale('Rare', 8000, 12),
    // Epic: 3 trading days in 30, 5 in 60.
    sale('Epic', 10_000, 2), sale('Epic', 12_000, 5), sale('Epic', 11_000, 9), sale('Epic', 9000, 40), sale('Epic', 13_000, 45),
    // Legendary: 2 trading days in 90.
    sale('Legendary', 30_000, 5), sale('Legendary', 35_000, 70),
  ]
  const p = marketPrices(sales, new Date())
  assert.deepEqual(p.Rare, { price: 6750, tradingDays: 6, windowDays: 30 })
  assert.deepEqual(p.Epic, { price: 11_000, tradingDays: 5, windowDays: 60 })
  assert.equal(p.Legendary, null, 'too few trading days: no market price')
})

test('the planning snapshot reads only the new sales and carries the market prices; the digest and the plan show them', async () => {
  // A full first page of 100 (20 sales on each of 5 days, newest first), so the reader asks for the next page.
  const fresh = [6000, 6200, 5800, 6400, 6100].flatMap((price, i) => Array.from({ length: 20 }, () => sale('Rare', price, i + 1)))
  const calls: number[] = []
  const fox = new Proxy({
    config: async () => snapshot().config, user: async () => snapshot().profile, team: async () => snapshot().team, players: async () => [],
    recentSales: async (_limit: number, offset: number) => { calls.push(offset); return offset === 0 ? fresh : [] },
  } as Record<string, unknown>, { get: (t, k: string) => t[k] ?? (async () => { throw new Error('not in this test') }) })
  const chain = { account: async () => ({ balance: 0n, nonce: 1 }), esdts: async () => [], egldUsd: async () => 25, query: async () => { throw new Error('no pool') } }
  const kept = new Map<number, unknown>()
  let complete = false
  const salesCache = { has: (id: number) => kept.has(id), put: (rows: { id: number }[]) => rows.forEach(r => kept.set(r.id, r)), since: () => [...kept.values()], complete: () => complete, markComplete: () => { complete = true }, markIncomplete: () => { complete = false } }
  const s1 = await takeSnapshot({ chain, fox } as never, { wallet: dryWallet }, new Date(), { marketSales: salesCache } as never)
  assert.deepEqual(calls, [0, 100], 'a full first page, then the next one')
  calls.length = 0
  await takeSnapshot({ chain, fox } as never, { wallet: dryWallet }, new Date(), { marketSales: salesCache } as never)
  assert.deepEqual(calls, [0], 'a page of known sales ends the read')
  assert.match(renderDigest(s1), /Market prices \(median of the daily median sale prices; every trading day counts once\): Common unknown \(too few sales in 90 days\), Uncommon unknown \(too few sales in 90 days\), Rare 6,100 \(5 trading days in 30 days\)/)
  const store = setup().store
  assert.match(renderPlanRequest({ snapshot: s1, settings: DEFAULT_SETTINGS, budget: budgetView(store, 0, DEFAULT_SETTINGS, true, new Date()), recent: [], dryRun: true }), /by rarity at most Common 500, Uncommon 1500, Rare 5500, Epic 13000, Legendary 50000 \(the owner's limits\)/)
})

// Agent review of PR #21 (medium): a card whose rarity is unknown skipped both its limit and the build cost.
test('a card whose rarity could not be read is not bid on', () => {
  const s = snapshot()
  s.chain!.foxsy = wholeToAtomic(200_000)
  const auction = { seller: OTHER, minPrice: wholeToAtomic(500), highestBid: 0n, highestBidder: null, endsAt: new Date(Date.now() + 3600_000) }
  for (const cardRarity of [undefined, 'Mythic', 'toString', '__proto__', 'constructor']) { // the last three: names every object inherits (re-review of PR #21)
    const v = checkAction({ type: 'bid', nonce: 9, foxsy: 40_000 }, s, { settings: { ...TEST_SETTINGS, maxBidFoxsy: 47_000 }, now: new Date(), auction, cardRarity } as RulesContext)
    assert.equal(v.ok, false)
    assert.match(v.refusal!, /rarity of #9 could not be read: not bidding blind/)
  }
})

// Agent review of PR #21 (medium): a first read cut short (a failed page) left the older sales unread for good.
test('a first read of the sales cut short is completed by the next plan; after it, a known oldest row ends the read', async () => {
  const page = (from: number) => Array.from({ length: 100 }, (_, i) => ({ ...sale('Legendary', 30_000, 1 + Math.floor((from + i) / 20)), id: 100_000 - from - i }))
  let failPage1 = true
  const calls: number[] = []
  const fox = new Proxy({
    config: async () => snapshot().config, user: async () => snapshot().profile, team: async () => snapshot().team, players: async () => [],
    recentSales: async (_l: number, offset: number) => {
      calls.push(offset)
      if (offset === 100 && failPage1) { failPage1 = false; throw new Error('HTTP 502') }
      return offset < 200 ? page(offset) : []
    },
  } as Record<string, unknown>, { get: (t, k: string) => t[k] ?? (async () => { throw new Error('not in this test') }) })
  const chain = { account: async () => ({ balance: 0n, nonce: 1 }), esdts: async () => [], egldUsd: async () => 25, query: async () => { throw new Error('no pool') } }
  const kept = new Map<number, unknown>()
  let complete = false
  const cache = { has: (id: number) => kept.has(id), put: (rows: { id: number }[]) => rows.forEach(r => kept.set(r.id, r)), since: () => [...kept.values()], complete: () => complete, markComplete: () => { complete = true }, markIncomplete: () => { complete = false } }
  await takeSnapshot({ chain, fox } as never, { wallet: dryWallet }, new Date(), { marketSales: cache } as never)
  assert.deepEqual([calls, kept.size, complete], [[0, 100], 100, false], 'page 1 failed: not complete')
  calls.length = 0
  await takeSnapshot({ chain, fox } as never, { wallet: dryWallet }, new Date(), { marketSales: cache } as never)
  assert.deepEqual([calls, kept.size, complete], [[0, 100, 200], 200, true], 'page 0 is all known, yet the read goes on until the end')
  calls.length = 0
  await takeSnapshot({ chain, fox } as never, { wallet: dryWallet }, new Date(), { marketSales: cache } as never)
  assert.deepEqual(calls, [0], 'complete: a page whose oldest row is known ends the read')
})

// Re-review of PR #21 (medium): past 2,000 sales in 120 days a first read never ended, so every plan read 20 pages.
// And an answer that is not a list is a failed read, not the end of the list (low).
test('a first read that fills its 20 pages is complete; an answer that is not a list is a failed read', async () => {
  const page = (from: number) => Array.from({ length: 100 }, (_, i) => ({ ...sale('Rare', 6000, 1 + Math.floor((from + i) / 100)), id: 500_000 - from - i }))
  const calls: number[] = []
  let broken = false
  const fox = new Proxy({
    config: async () => snapshot().config, user: async () => snapshot().profile, team: async () => snapshot().team, players: async () => [],
    recentSales: async (_l: number, offset: number) => { calls.push(offset); return broken ? { error: 'maintenance' } : page(offset) }, // 25 full pages and more
  } as Record<string, unknown>, { get: (t, k: string) => t[k] ?? (async () => { throw new Error('not in this test') }) })
  const chain = { account: async () => ({ balance: 0n, nonce: 1 }), esdts: async () => [], egldUsd: async () => 25, query: async () => { throw new Error('no pool') } }
  const kept = new Map<number, unknown>()
  let complete = false
  const cache = { has: (id: number) => kept.has(id), put: (rows: { id: number }[]) => rows.forEach(r => kept.set(r.id, r)), since: () => [...kept.values()], complete: () => complete, markComplete: () => { complete = true }, markIncomplete: () => { complete = false } }
  await takeSnapshot({ chain, fox } as never, { wallet: dryWallet }, new Date(), { marketSales: cache } as never)
  assert.deepEqual([calls.length, kept.size, complete], [20, 2000, true], '20 full pages read without an error: complete')
  calls.length = 0
  await takeSnapshot({ chain, fox } as never, { wallet: dryWallet }, new Date(), { marketSales: cache } as never)
  assert.deepEqual(calls, [0], 'then one page a plan')
  const fresh = new Map<number, unknown>()
  let done = false
  const cache2 = { has: (id: number) => fresh.has(id), put: (rows: { id: number }[]) => rows.forEach(r => fresh.set(r.id, r)), since: () => [...fresh.values()], complete: () => done, markComplete: () => { done = true }, markIncomplete: () => { done = false } }
  broken = true
  const s = await takeSnapshot({ chain, fox } as never, { wallet: dryWallet }, new Date(), { marketSales: cache2 } as never)
  assert.equal(done, false, 'not the end of the list')
  assert.ok(s.warnings.some(w => w.startsWith('marketplace sales:')), s.warnings.join('; '))
})

// Re-review of PR #21 (low): after the first read, a catch-up cut short (over 100 new sales, then a failed page)
// left a gap the next plan never filled, as page 0's oldest row was kept by then.
test('a catch-up read cut short by a failed page makes the next plan read on past the kept sales', async () => {
  const kept = new Map<number, unknown>()
  let complete = true // a first read was done before the downtime
  const cache = { has: (id: number) => kept.has(id), put: (rows: { id: number }[]) => rows.forEach(r => kept.set(r.id, r)), since: () => [...kept.values()], complete: () => complete, markComplete: () => { complete = true }, markIncomplete: () => { complete = false } }
  const page = (from: number) => Array.from({ length: 100 }, (_, i) => ({ ...sale('Epic', 12_000, 1), id: 900_000 - from - i }))
  let failPage1 = true
  const calls: number[] = []
  const fox = new Proxy({
    config: async () => snapshot().config, user: async () => snapshot().profile, team: async () => snapshot().team, players: async () => [],
    recentSales: async (_l: number, offset: number) => {
      calls.push(offset)
      if (offset === 100 && failPage1) { failPage1 = false; throw new Error('HTTP 502') }
      return offset < 200 ? page(offset) : []
    },
  } as Record<string, unknown>, { get: (t, k: string) => t[k] ?? (async () => { throw new Error('not in this test') }) })
  const chain = { account: async () => ({ balance: 0n, nonce: 1 }), esdts: async () => [], egldUsd: async () => 25, query: async () => { throw new Error('no pool') } }
  await takeSnapshot({ chain, fox } as never, { wallet: dryWallet }, new Date(), { marketSales: cache } as never)
  assert.deepEqual([calls, kept.size, complete], [[0, 100], 100, false], 'page 1 failed after new sales were kept: not complete again')
  calls.length = 0
  await takeSnapshot({ chain, fox } as never, { wallet: dryWallet }, new Date(), { marketSales: cache } as never)
  assert.deepEqual([calls, kept.size, complete], [[0, 100, 200], 200, true], 'the next plan reads on past page 0')
})

test('the prompt says to aim below the market price, the limits being the most, never the target', () => {
  assert.match(SYSTEM_PROMPT, /aim below the market price of its rarity/)
  assert.match(SYSTEM_PROMPT, /the limits per rarity and the build cost are the most you may pay, never the target/)
})

test('the dashboard has the three limits, each with its info bubble, and asks the password to raise them', () => {
  const html = readFileSync(new URL('../src/web/dashboard.html', import.meta.url), 'utf8')
  for (const [id, tip] of [['sBidRare', 'bidRare'], ['sBidEpic', 'bidEpic'], ['sBidLegendary', 'bidLegendary']]) {
    assert.match(html, new RegExp(`<label for="${id}">[^<]*<i class="info" data-tip="${tip}">i</i></label><input id="${id}"`))
    assert.match(html, new RegExp(`\\n  ${tip}: \\[`), `the ${tip} info bubble`)
  }
  assert.match(html, /const LIMITS = \[[^\]]*'maxBidRareFoxsy', 'maxBidEpicFoxsy', 'maxBidLegendaryFoxsy', 'paidTrainingPerDay', 'boostersPerWeek', 'packsPerWeek', 'medicineDaysPerWeek'\]/)
})
