// Owner, 2026-10-23: agents 3 and 4 planned the same bid (1,456 FOXSY on #6226) in the same minute. The second bid
// would have to beat the first, so the owner would pay more for one card by bidding against their own bid. One team per card,
// as one challenger per rival (test/challenges-and-funds.test.ts): a card another of the owner's teams bids on, leads
// or sells is not bid on by a second one, and the plan is told it is not available (no reason, no team named).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Mnemonic } from '@multiversx/sdk-core'
import type { Config } from '../src/config.ts'
import { Service } from '../src/service.ts'
import { Executor } from '../src/executor/executor.ts'
import { renderPlanRequest, type PlanInput } from '../src/strategist/strategist.ts'
import type { Store } from '../src/store/db.ts'
import { wholeToAtomic } from '../src/util/encoding.ts'
import { OTHER, STRANGER, TEST_SETTINGS, dryWallet, encodeAuction, liveWallet, setup, snapshot, withLive } from './fixtures.ts'

const FOX = { user: async () => null, player: async () => ({ rarity: 'Rare', transferred_at: null, transfer_cooldown_hours: null, owner_address: STRANGER }) }
const auction = (o: { seller?: string; bidder?: string | null; top?: bigint } = {}) => ({
  query: async (_sc: string, fn: string) => (fn === 'getAuction' ? [encodeAuction({ seller: o.seller ?? STRANGER, min: wholeToAtomic(500), top: o.top ?? 0n, bidder: o.bidder ?? null, endsInS: 3600 })] : []),
})
const bid = (nonce = 20, foxsy = 700) => [{ action: { type: 'bid' as const, nonce, foxsy }, reason: '' }]
const SIBLING_WALLET = { ...dryWallet, index: 1, address: OTHER }
const TAKEN = /another of your owner's teams is bidding on #20 \(one team per card: pick another card\)/

/** Agent 2 of the same install (index 1) with a bid on `nonce` logged some minutes ago. */
function siblingBid(store: Store, o: { nonce: number; minutesAgo: number; status?: string; sent?: boolean }) {
  if (!store.agent(1)) store.addAgent(1, OTHER)
  const id = store.log({ agentIndex: 1, kind: 'bid', status: (o.status ?? 'dry_run') as never, summary: `bid 700 FOXSY on #${o.nonce}`, detail: { action: { type: 'bid', nonce: o.nonce, foxsy: 700 }, reason: '', ...(o.sent ? { sent: true } : {}) } })
  ;(store as unknown as { db: { prepare(q: string): { run(...a: unknown[]): void } } }).db.prepare('UPDATE activity SET at = ? WHERE id = ?').run(new Date(Date.now() - o.minutesAgo * 60_000).toISOString(), id)
}

test('a card another of the owner\'s agents has bid on is not bid on by a second one', async () => {
  const m = setup({ chain: auction(), fox: FOX })
  siblingBid(m.store, { nonce: 20, minutesAgo: 10 })
  const [r] = await m.exec.run(m.agent(), dryWallet, snapshot(), bid(20))
  assert.equal(r!.status, 'refused', r!.summary)
  assert.match(r!.summary, TAKEN)
  // A bid of that agent on another card does not stop this one.
  const [ok] = await m.exec.run(m.agent(), dryWallet, snapshot(), bid(21))
  assert.equal(ok!.status, 'dry_run', ok!.summary)
})

test('a bid that errored after its signature still counts (it may have landed); a refused, reverted, unsigned or old one does not', async () => {
  const run = async (o: { status: string; sent?: boolean; minutesAgo?: number }) => {
    const m = setup({ chain: auction(), fox: FOX })
    siblingBid(m.store, { nonce: 20, minutesAgo: o.minutesAgo ?? 10, status: o.status, sent: o.sent })
    return (await m.exec.run(m.agent(), dryWallet, snapshot(), bid(20)))[0]!
  }
  assert.match((await run({ status: 'error', sent: true })).summary, TAKEN)
  assert.match((await run({ status: 'sent' })).summary, TAKEN)
  for (const o of [{ status: 'refused' }, { status: 'failed' }, { status: 'error' }, { status: 'dry_run', minutesAgo: 49 * 60 }]) {
    const r = await run(o)
    assert.equal(r.status, 'dry_run', `${JSON.stringify(o)}: ${r.summary}`)
  }
})

test('a card another of the owner\'s teams leads on chain is refused, with no log row of it', async () => {
  const m = setup({ chain: auction({ bidder: OTHER, top: wholeToAtomic(600) }), fox: FOX })
  m.store.addAgent(1, OTHER)
  const [r] = await m.exec.run(m.agent(), dryWallet, snapshot(), bid(20))
  assert.equal(r!.status, 'refused', r!.summary)
  assert.match(r!.summary, TAKEN)
})

test('a card another of the owner\'s teams sells is not bought: it would only move between the owner\'s wallets for the fee', async () => {
  const m = setup({ chain: auction({ seller: OTHER }), fox: FOX })
  m.store.addAgent(1, OTHER)
  m.store.retireAgent(1, { at: new Date().toISOString(), by: 'test' } as never)
  const [r] = await m.exec.run(m.agent(), dryWallet, snapshot(), bid(20))
  assert.equal(r!.status, 'refused', r!.summary)
  assert.match(r!.summary, /#20 is listed by another of your owner's teams: buying it would only move it between the owner's wallets and pay the 10 percent fee/)
})

// As for 1v1s (agent review of PR #19): agents plan at the same time and a bid is logged only after it is sent and
// settled, so the card is claimed in the shared executor in the same synchronous step as the check.
test('two agents checking at once cannot both bid on the same card', async () => {
  let release: () => void = () => undefined
  const held = new Promise<void>(r => { release = r })
  const m = setup({ chain: { ...auction(), simulate: async () => { await held; return { ok: true, detail: 'success', raw: {} } } }, fox: FOX })
  m.store.addAgent(1, OTHER)
  m.store.updateSettings(1, TEST_SETTINGS)
  const first = m.exec.run(m.agent(), dryWallet, snapshot(), bid(20))
  await new Promise(r => setTimeout(r, 30))
  const second = m.exec.run(m.store.agent(1)!, SIBLING_WALLET, snapshot(), bid(20))
  await new Promise(r => setTimeout(r, 30))
  release()
  const [[a], [b]] = await Promise.all([first, second])
  assert.equal(a!.status, 'dry_run', a!.summary)
  assert.equal(b!.status, 'refused', b!.summary)
  assert.match(b!.summary, TAKEN)
})

test('a refusal after the check releases the card, and a dry-run claim does not hold a live agent off it', async () => {
  const m = setup({ chain: auction(), fox: FOX })
  m.store.addAgent(1, OTHER)
  m.store.updateSettings(1, TEST_SETTINGS)
  const broke = snapshot()
  broke.chain!.egld = 0n // no EGLD for the gas: refused after the rules allowed it
  const [r] = await m.exec.run(m.agent(), dryWallet, broke, bid(20))
  assert.equal(r!.status, 'refused', r!.summary)
  assert.doesNotMatch(r!.summary, /another of your owner's teams/)
  const [ok] = await m.exec.run(m.store.agent(1)!, SIBLING_WALLET, snapshot(), bid(20))
  assert.equal(ok!.status, 'dry_run', ok!.summary)

  const n = setup({ chain: auction(), fox: FOX })
  n.store.addAgent(1, OTHER)
  n.store.updateSettings(1, TEST_SETTINGS)
  const [dry] = await n.exec.run(n.agent(), dryWallet, snapshot(), bid(20))
  assert.equal(dry!.status, 'dry_run', dry!.summary)
  await withLive(n.store, async () => {
    const [live] = await n.exec.run(n.store.agent(1)!, { ...liveWallet, index: 1, address: OTHER }, snapshot(), bid(20))
    assert.doesNotMatch(live!.summary, /another of your owner's teams/, live!.summary)
  })
})

function testConfig(dir: string): Config {
  return {
    mnemonic: Mnemonic.generate().toString(), dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as unknown as Config
}

test('the plan request marks the cards another of the owner\'s teams bids on, has just claimed or sells, and names no team', async () => {
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-bids-'))))
  svc.ensureAgents()
  siblingBid(svc.store, { nonce: 20, minutesAgo: 10 })
  ;(svc.executor as unknown as { bidClaims: Map<number, unknown> }).bidClaims.set(23, { agent: 1, until: Date.now() + 3_600_000, dry: true })
  const s = snapshot()
  const listing = (nonce: number, owner = STRANGER) => ({ nft_nonce: nonce, owner_address: owner, name: `Card ${nonce}`, position: 'FWD', rarity: 'Rare', level: 1, speed: 40, accuracy: 40, defense: 40, power: 40, control: 40, vision: 40, stamina: 40, condition: 100, is_auction: true, min_price: 500, highest_bid: null, ends_at: new Date(Date.now() + 3600_000).toISOString(), transferred_at: null, transfer_cooldown_hours: null })
  s.market.auctions = [listing(20), listing(21, OTHER), listing(22), listing(23)] as never
  let text = ''
  svc.strategist = {
    model: 'claude-opus-5-5',
    plan: async (input: PlanInput) => {
      text = renderPlanRequest(input)
      return { summary: 'x', actions: [], rejected: [], usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0, servedBy: 'claude-opus-5-5' }, stopReason: 'end_turn' }
    },
  } as never
  await (svc as unknown as { makePlan: (a: unknown, s: unknown) => Promise<unknown> }).makePlan(svc.store.agent(0), s)
  const line = (nonce: number) => text.split('\n').find(l => l.trim().startsWith(`#${nonce} `)) ?? ''
  for (const n of [20, 21, 23]) assert.match(line(n), /not available now/, `#${n}: ${line(n)}`)
  assert.ok(line(22), 'the free card is listed')
  assert.doesNotMatch(line(22), /not available/)
  assert.doesNotMatch(text, /agent 2|another of your owner/, 'no reason given, no team named')
  // What the plan is told is what the executor refuses (an executor on the same store).
  const exec = new Executor({ cfg: {} as Config, chain: auction() as never, fox: FOX as never, store: svc.store })
  const [r] = await exec.run(svc.store.agent(0)!, { ...dryWallet, address: svc.store.agent(0)!.address }, snapshot(), bid(20))
  assert.match(r!.summary, TAKEN)
})

// Review of PR #25 (low, docs): INSTALL.md and the update page still said two agents may bid on the same card.
test('no owner-facing page says two agents may bid on the same card', async () => {
  const { readFileSync } = await import('node:fs')
  for (const f of ['README.md', 'INSTALL.md', 'site/src/content/docs/help/update.md', 'site/src/content/docs/help/faq.md', 'site/src/content/docs/play/safety.md']) {
    const page = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\s+/g, ' ')
    assert.doesNotMatch(page, /bid on the same card/, f)
    assert.doesNotMatch(page, /knows nothing of the others, so/, `${f} names what the agents share`)
  }
})
