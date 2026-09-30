// Fusion waivers: bought only when a fusion with that card can really happen, never the transfer waiver.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fusionWaiverTx } from '../src/executor/tx.ts'
import { numberToHex, wholeToAtomic } from '../src/util/encoding.ts'
import type { PlannedAction } from '../src/executor/actions.ts'
import { ADDR, card, dryWallet, liveWallet, setup, snapshot, withLive } from './fixtures.ts'

const b64 = (n: bigint) => Buffer.from(numberToHex(n), 'hex').toString('base64')
const act = (action: unknown): PlannedAction[] => [{ action: action as PlannedAction['action'], reason: '' }]
const hex = (s: string) => Buffer.from(s).toString('hex')

/** 20 cards: the 18 of the squad plus two spare Commons, #101 in a fusion cooldown. */
function roomy() {
  return snapshot([card(101, 'MID', 'reserve', { fusionReadyAt: new Date(Date.now() + 14 * 86_400_000).toISOString() }), card(102, 'DEF', 'reserve', { competitiveMatches: 8 })])
}

test('waiver payloads: exact FOXSY and the card to the players contract, back to the agent', () => {
  const cd = fusionWaiverTx(ADDR, 101, wholeToAtomic(825), 'payFusionCooldownWaiver')
  assert.equal(cd.receiver, ADDR)
  assert.match(cd.data, new RegExp(`^MultiESDTNFTTransfer@[0-9a-f]{64}@02@${hex('FOXSY-5d5f3e')}@00@${numberToHex(wholeToAtomic(825))}@${hex('FXLP-6f28e5')}@${numberToHex(101)}@01@${hex('payFusionCooldownWaiver')}@${numberToHex(101)}$`))
  const mw = fusionWaiverTx(ADDR, 101, wholeToAtomic(240), 'payFusionMatchWaiver', 12)
  assert.ok(mw.data.endsWith(`@${hex('payFusionMatchWaiver')}@${numberToHex(101)}@${numberToHex(12)}`))
})

test('cooldown waiver: only with a fusion in reach, within the max shop payment, never at the floor', async () => {
  let quote = { days: 11n, cost: wholeToAtomic(825) }
  const m = setup({ chain: { query: async (_sc: string, fn: string) => (fn === 'getFusionCooldownWaiverQuote' ? [b64(quote.days), b64(quote.cost)] : []) } })
  const waive = act({ type: 'fusion_cooldown_waiver', nonce: 101 })
  // 18 cards: a fusion would leave 16, so nothing to speed up.
  const tight = snapshot([card(101, 'MID', 'reserve', { fusionReadyAt: new Date(Date.now() + 86_400_000 * 14).toISOString() })])
  tight.players = tight.players.filter(p => p.nonce !== 18)
  const [r0] = await m.exec.run(m.agent(), dryWallet, tight, waive)
  assert.equal(r0!.status, 'refused')
  assert.match(r0!.summary, /no fusion is possible/)
  const [ok] = await m.exec.run(m.agent(), dryWallet, roomy(), waive)
  assert.equal(ok!.status, 'dry_run', ok!.summary)
  assert.match(ok!.summary, /11 days sooner/)
  m.store.updateSettings(0, { maxShopPaymentFoxsy: 500 })
  assert.match((await m.exec.run(m.agent(), dryWallet, roomy(), waive))[0]!.summary, /exceeds the per-action maximum 500/)
  m.store.updateSettings(0, { maxShopPaymentFoxsy: 2500 })
  quote = { days: 0n, cost: 0n }
  assert.match((await m.exec.run(m.agent(), dryWallet, roomy(), waive))[0]!.summary, /3-day floor/)
  assert.match((await m.exec.run(m.agent(), dryWallet, roomy(), act({ type: 'fusion_cooldown_waiver', nonce: 102 })))[0]!.summary, /no fusion cooldown/)
})

test('match waiver: exactly the matches missing to 20, and only after 5 really played', async () => {
  let q = { max_purchasable: 12, chain_played: 8, credit: 0, price_wei: wholeToAtomic(20).toString() }
  const m = setup({ fox: { user: async () => null, matchWaiverQuote: async () => q } })
  const buy = (matches: number, played = 8) => {
    const snap = roomy()
    snap.players.find(p => p.nonce === 102)!.competitiveMatches = played
    return m.exec.run(m.agent(), dryWallet, snap, act({ type: 'fusion_match_waiver', nonce: 102, matches }))
  }
  const [ok] = await buy(12)
  assert.equal(ok!.status, 'dry_run', ok!.summary)
  assert.match(ok!.summary, /240 FOXSY/)
  assert.match((await buy(5))[0]!.summary, /needs exactly 12/)
  q = { ...q, chain_played: 3, max_purchasable: 15 }
  assert.match((await buy(15, 3))[0]!.summary, /5 must be played/)
  q = { ...q, chain_played: 20, max_purchasable: 0 }
  assert.match((await buy(1))[0]!.summary, /already has the 20/)
})

test('match waiver live: the exact cost is booked and sent to the agent itself', async () => {
  const sent: { receiver: string; data: string }[] = []
  const m = setup({
    chain: { send: async (tx: { receiver: string; data: string }) => (sent.push({ receiver: tx.receiver, data: Buffer.from(tx.data, 'base64').toString() }), 'hashw') },
    fox: { user: async () => null, matchWaiverQuote: async () => ({ max_purchasable: 12, chain_played: 8, credit: 0, price_wei: wholeToAtomic(20).toString() }) },
  })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, roomy(), act({ type: 'fusion_match_waiver', nonce: 102, matches: 12 }))
    assert.equal(r!.status, 'confirmed', r!.summary)
  })
  assert.equal(sent.length, 1)
  assert.equal(sent[0]!.receiver, ADDR)
  assert.ok(sent[0]!.data.includes(`@${numberToHex(wholeToAtomic(240))}@`))
  assert.ok(m.store.spentUsd(0, { category: 'play', dryRun: false }) > 0.5)
})

test('LR1 a match waiver waits for the sync: unsynced matches would be bought again', async () => {
  const m = setup({ fox: { user: async () => null, matchWaiverQuote: async () => ({ max_purchasable: 15, chain_played: 5, credit: 0, price_wei: wholeToAtomic(20).toString() }) } })
  const dirty = roomy()
  dirty.players.find(p => p.nonce === 102)!.dirty = true
  assert.match((await m.exec.run(m.agent(), dryWallet, dirty, act({ type: 'fusion_match_waiver', nonce: 102, matches: 15 })))[0]!.summary, /sync first/)
  const ahead = roomy()
  ahead.players.find(p => p.nonce === 102)!.competitiveMatches = 12 // 7 more than the chain knows
  assert.match((await m.exec.run(m.agent(), dryWallet, ahead, act({ type: 'fusion_match_waiver', nonce: 102, matches: 15 })))[0]!.summary, /7 competitive matches not on chain yet/)
})
