// Audit 2026-11-11 (Fable 5.2 reviewers at extra-high effort): the proof of EDGE-4, failing before its fix.
// EDGE: a payment whose broadcast got no answer (a timeout, a 5xx, an unreadable body) stays booked, rightly, but its
// ledger rows keep no transaction hash, although the executor computed it before the broadcast. Every refund check
// reads a row by its hash: a bid row without one is skipped for good (refunds.ts), and a shop refund heard by the
// pending retry finds no row to credit (creditShopPayment). The FOXSY came back and still counts until the month ends.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ADDR, STRANGER, encodeAuction, liveWallet, setup, snapshot, withLive } from '../fixtures.ts'
import { wholeToAtomic } from '../../src/util/encoding.ts'
import { creditRefunds } from '../../src/executor/refunds.ts'
import { retryPendingPayments } from '../../src/executor/pending.ts'
import { ApiRefusal } from '../../src/foxleague/api.ts'
import type { PlannedAction } from '../../src/executor/actions.ts'

const act = (action: unknown): PlannedAction[] => [{ action: action as PlannedAction['action'], reason: '' }]

test('a bid whose broadcast got no answer, then outbid on chain, is credited by the refund check', async () => {
  // While the agent bids: no bid yet. Afterwards: a rival holds the top bid (the contract refunded ours at once).
  let phase: 'open' | 'outbid' = 'open'
  const open = encodeAuction({ seller: STRANGER, min: wholeToAtomic(500), top: 0n, bidder: null, endsInS: 3600 })
  const outbid = encodeAuction({ seller: STRANGER, min: wholeToAtomic(500), top: wholeToAtomic(600), bidder: STRANGER, endsInS: 3000 })
  const query = async (_sc: string, fn: string) => (fn === 'getAuction' ? [phase === 'open' ? open : outbid] : [])
  const m = setup({
    chain: { query, send: async () => { throw new Error('broadcast unclear (HTTP 502, no hash)') }, esdts: async () => [] },
    fox: { user: async () => null, player: async () => ({ rarity: 'Common', transferred_at: null, transfer_cooldown_hours: null, injured_until: null, bans_pending: 0, owner_address: STRANGER }), listings: async () => [] },
  })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, snapshot(), act({ type: 'bid', nonce: 9, foxsy: 500 }))
    assert.equal(r!.status, 'error', r!.summary)
    assert.equal(r!.sent, true, 'the bid may have landed')
    const rows = m.store.openSpend(0, 'bid:', false)
    assert.equal(rows.length, 1, 'the bid stays booked: it may have landed')
    // It did land and a rival outbid it: the contract sent the FOXSY back.
    phase = 'outbid'
    const credited = await creditRefunds({ store: m.store, chain: { query, esdts: async () => [] } as never, fox: { player: async () => ({ owner_address: STRANGER }) } as never }, m.agent(), false, Date.now() + 11 * 60_000)
    assert.equal(credited, 1, `an outbid bid is credited whatever the gateway answered at its broadcast (its row holds tx hash ${rows[0]!.txHash})`)
  })
})

test('a shop payment whose broadcast got no answer, later refunded by FoxLeague, stops counting', async () => {
  const s = snapshot()
  s.auth!.shop!.common_pack_remaining_this_week = 2 // read, and packs are left: nothing else refuses this purchase
  const m = setup({ chain: { send: async () => { throw new Error('broadcast unclear (HTTP 504, no hash)') } } })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, s, act({ type: 'buy', product: 'common_pack' }))
    assert.equal(r!.status, 'error', r!.summary)
    const held = m.store.pending(0)
    assert.deepEqual(held.map(p => p.kind), ['shop'], 'kept from the signature on: the retry confirms it with its hash')
    const before = m.store.openSpend(0, 'shop:', false)
    assert.equal(before.length, 1)
    // The payment did land; FoxLeague cannot use it (the weekly pack quota) and refunds it.
    const said: string[] = []
    await retryPendingPayments({ store: m.store, fox: { shopConfirm: async () => { throw new ApiRefusal('You already bought 2 Common packs in the last 7 days. Your payment is being refunded automatically.') }, joinTournament: async () => ({ participant_id: 1 }) } as never, notify: t => said.push(t) }, 0, liveWallet)
    assert.equal(m.store.pending(0).length, 0, 'the answer is final')
    assert.equal(m.store.openSpend(0, 'shop:', false).length, 0, `FoxLeague returned the 2,500 FOXSY, so they stop counting (the row holds tx hash ${before[0]!.txHash}, the pending row ${held[0]!.hash})`)
  })
})

// Added with the fix. Over-counting must never turn into under-counting: a row is credited only on the chain's or
// FoxLeague's own word about its hash, once, and a payment nobody has spoken about keeps counting.
test('the error row and the ledger rows carry the one hash of what was signed; a bid still standing or still young is not credited', async () => {
  let phase: 'open' | 'ours' | 'outbid' = 'open'
  const auction = (top: bigint, bidder: string | null) => encodeAuction({ seller: STRANGER, min: wholeToAtomic(500), top, bidder, endsInS: 3600 })
  const query = async (_sc: string, fn: string) => (fn === 'getAuction' ? [phase === 'open' ? auction(0n, null) : phase === 'ours' ? auction(wholeToAtomic(500), ADDR) : auction(wholeToAtomic(600), STRANGER)] : [])
  const m = setup({
    chain: { query, send: async () => { throw new Error('broadcast unclear (HTTP 502, no hash)') }, esdts: async () => [] },
    fox: { user: async () => null, player: async () => ({ rarity: 'Common', transferred_at: null, transfer_cooldown_hours: null, injured_until: null, bans_pending: 0, owner_address: STRANGER }), listings: async () => [] },
  })
  const refunds = (inMinutes: number) => creditRefunds({ store: m.store, chain: { query, esdts: async () => [] } as never, fox: { player: async () => ({ owner_address: STRANGER }) } as never }, m.agent(), false, Date.now() + inMinutes * 60_000)
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, snapshot(), act({ type: 'bid', nonce: 9, foxsy: 500 }))
    const [row] = m.store.openSpend(0, 'bid:', false)
    assert.match(String(row!.txHash), /^[0-9a-f]{64}$/, 'the bid row carries the hash of the signed transaction')
    assert.equal(r!.txHash, row!.txHash, 'the error row of the action carries the same hash')
    const before = m.store.spentUsd(0, { category: 'play', dryRun: false })
    assert.ok(before > 0)
    // Young (it may still be in flight): left alone, whatever the auction shows.
    phase = 'outbid'
    assert.equal(await refunds(5), 0, 'a bid under ten minutes old is never credited')
    // It landed and stands as the top bid: it keeps counting.
    phase = 'ours'
    assert.equal(await refunds(11), 0, 'a standing bid is not credited')
    assert.equal(m.store.spentUsd(0, { category: 'play', dryRun: false }), before)
    // Outbid: credited, and only once.
    phase = 'outbid'
    assert.equal(await refunds(12), 1)
    assert.equal(await refunds(30), 0, 'a credited bid is never credited again')
    assert.ok(m.store.spentUsd(0, { category: 'play', dryRun: false }) < before, 'the FOXSY stopped counting; the gas row stays')
    assert.ok(m.store.spentUsd(0, { category: 'play', dryRun: false }) >= 0)
  })
})

test('a shop payment nobody has spoken about keeps counting, and a refund heard twice is credited once', async () => {
  const s = snapshot()
  const m = setup({ chain: { send: async () => { throw new Error('broadcast unclear (HTTP 504, no hash)') } } })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, s, act({ type: 'buy', product: 'common_pack' }))
    const [row] = m.store.openSpend(0, 'shop:', false)
    const [held] = m.store.pending(0)
    assert.match(String(row!.txHash), /^[0-9a-f]{64}$/)
    assert.equal(row!.txHash, held!.hash, 'the ledger row and the pending payment are under the same hash')
    assert.equal(r!.txHash, held!.hash, 'and so is the activity row')
    const before = m.store.spentUsd(0, { category: 'play', dryRun: false })
    // FoxLeague cannot verify it yet (tx_pending), then gives no answer: nothing is credited.
    const pendingAnswer = { shopConfirm: async () => { throw new ApiRefusal('not verifiable yet', 'tx_pending') }, joinTournament: async () => ({ participant_id: 1 }) }
    await retryPendingPayments({ store: m.store, fox: pendingAnswer as never, notify: () => undefined }, 0, liveWallet)
    const noAnswer = { shopConfirm: async () => { throw new TypeError('fetch failed') }, joinTournament: async () => ({ participant_id: 1 }) }
    await retryPendingPayments({ store: m.store, fox: noAnswer as never, notify: () => undefined }, 0, liveWallet)
    assert.equal(m.store.spentUsd(0, { category: 'play', dryRun: false }), before, 'still counted')
    assert.equal(m.store.pending(0).length, 1)
    const { creditShopPayment } = await import('../../src/executor/pending.ts')
    // FoxLeague's word that it came back: credited once, however often it is heard.
    assert.equal(creditShopPayment(m.store, 0, held!.hash), true)
    assert.equal(creditShopPayment(m.store, 0, held!.hash), false, 'a refund heard again credits nothing more')
    const after = m.store.spentUsd(0, { category: 'play', dryRun: false })
    assert.ok(after < before && after >= 0, `the FOXSY stopped counting once (before $${before}, after $${after}); the gas row stays`)
    // Another payment's hash credits nothing of this agent's rows.
    assert.equal(creditShopPayment(m.store, 0, 'ff'.repeat(32)), false)
  })
})
