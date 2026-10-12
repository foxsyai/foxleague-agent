// Fusion waivers: bought only when a fusion with that card can really happen, never the transfer waiver.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fusionWaiverTx } from '../src/executor/tx.ts'
import { numberToHex, wholeToAtomic } from '../src/util/encoding.ts'
import { parseAction, type PlannedAction } from '../src/executor/actions.ts'
import type { MatchWaiverQuote } from '../src/foxleague/types.ts'
import { ADDR, card, dryWallet, liveWallet, setup, snapshot, withLive } from './fixtures.ts'

const b64 = (n: bigint) => Buffer.from(numberToHex(n), 'hex').toString('base64')
const act = (action: unknown): PlannedAction[] => [{ action: action as PlannedAction['action'], reason: '' }]
const hex = (s: string) => Buffer.from(s).toString('hex')

/** 22 cards: the 18 Commons of the squad, a spare Common #101 in a fusion cooldown and three spare Uncommons, #102 at 8 played. */
function roomy() {
  return snapshot([
    card(101, 'MID', 'reserve', { fusionReadyAt: new Date(Date.now() + 14 * 86_400_000).toISOString() }),
    card(102, 'DEF', 'reserve', { rarity: 'Uncommon', competitiveMatches: 8 }),
    card(103, 'DEF', 'reserve', { rarity: 'Uncommon', competitiveMatches: 15 }),
    card(104, 'MID', 'reserve', { rarity: 'Uncommon', competitiveMatches: 15 }),
  ])
}

/** An Uncommon's quote as FoxLeague answers it since 2026-10-12 (gate 15, 5 played, 20 FOXSY a match). */
const uncommonQuote = (chain_played: number, credit = 0): MatchWaiverQuote => ({
  max_purchasable: Math.max(0, Math.min(15 - chain_played - credit, 10 - credit)), chain_played, credit, price_wei: wholeToAtomic(20).toString(),
  rarity: 'Uncommon', gate: 15, floor: 5, price_per_match: 20, meets_gate: chain_played >= 5 && chain_played + credit >= 15,
})

test('waiver payloads: exact FOXSY and the card to the players contract, back to the agent', () => {
  const cd = fusionWaiverTx(ADDR, 101, wholeToAtomic(825), 'payFusionCooldownWaiver')
  assert.equal(cd.receiver, ADDR)
  assert.match(cd.data, new RegExp(`^MultiESDTNFTTransfer@[0-9a-f]{64}@02@${hex('FOXSY-5d5f3e')}@00@${numberToHex(wholeToAtomic(825))}@${hex('FXLP-6f28e5')}@${numberToHex(101)}@01@${hex('payFusionCooldownWaiver')}@${numberToHex(101)}$`))
  const mw = fusionWaiverTx(ADDR, 101, wholeToAtomic(240), 'payFusionMatchWaiver', 12)
  assert.ok(mw.data.endsWith(`@${hex('payFusionMatchWaiver')}@${numberToHex(101)}@${numberToHex(12)}`))
  // Some of the days (2026-10-12): the days follow the nonce, as FoxLeague's app sends them.
  const part = fusionWaiverTx(ADDR, 101, wholeToAtomic(300), 'payFusionCooldownWaiver', 4)
  assert.ok(part.data.endsWith(`@${hex('payFusionCooldownWaiver')}@${numberToHex(101)}@${numberToHex(4)}`))
  assert.equal((parseAction({ type: 'fusion_cooldown_waiver', nonce: 101, days: 4 }) as { days?: number }).days, 4)
  assert.equal((parseAction({ type: 'fusion_cooldown_waiver', nonce: 101 }) as { days?: number }).days, undefined)
  assert.throws(() => parseAction({ type: 'fusion_cooldown_waiver', nonce: 101, days: 0 }))
  assert.equal((parseAction({ type: 'fusion_match_waiver', nonce: 101, matches: 270 }) as { matches: number }).matches, 270, "a Legendary's whole waivable part")
  assert.throws(() => parseAction({ type: 'fusion_match_waiver', nonce: 101, matches: 271 }))
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

test('match waiver: exactly the matches missing to the rarity gate, once its floor is played; a Common has none', async () => {
  let q = uncommonQuote(8)
  const m = setup({ fox: { user: async () => null, matchWaiverQuote: async () => q } })
  const buy = (matches: number, played = 8, nonce = 102) => {
    const snap = roomy()
    snap.players.find(p => p.nonce === 102)!.competitiveMatches = played
    return m.exec.run(m.agent(), dryWallet, snap, act({ type: 'fusion_match_waiver', nonce, matches }))
  }
  const [ok] = await buy(7)
  assert.equal(ok!.status, 'dry_run', ok!.summary)
  assert.match(ok!.summary, /140 FOXSY/)
  assert.match(ok!.summary, /reaches 15 competitive matches for fusion/)
  assert.match((await buy(5))[0]!.summary, /needs exactly 7 to reach 15/)
  q = uncommonQuote(3)
  assert.match((await buy(10, 3))[0]!.summary, /really played 3 competitive matches on chain; an Uncommon must play 5 before credit can be bought/)
  q = uncommonQuote(15)
  assert.match((await buy(1, 15))[0]!.summary, /already has the 15/)
  assert.match((await buy(1, 8, 101))[0]!.summary, /a Common has no match waiver: its 5 competitive matches must really be played/)
})

test('match waiver of a Rare: 100 FOXSY a match up to 30, held to the max shop payment', async () => {
  const q: MatchWaiverQuote = { max_purchasable: 25, chain_played: 20, credit: 0, price_wei: wholeToAtomic(100).toString(), rarity: 'Rare', gate: 45, floor: 15, price_per_match: 100, meets_gate: false }
  const m = setup({ fox: { user: async () => null, matchWaiverQuote: async () => q } })
  const rares = () => snapshot([301, 302, 303].map((n, i) => card(n, 'MID', 'reserve', { rarity: 'Rare', competitiveMatches: i ? 45 : 20 })))
  m.store.updateSettings(0, { maxShopPaymentFoxsy: 3000 })
  const [ok] = await m.exec.run(m.agent(), dryWallet, rares(), act({ type: 'fusion_match_waiver', nonce: 301, matches: 25 }))
  assert.equal(ok!.status, 'dry_run', ok!.summary)
  assert.match(ok!.summary, /2500 FOXSY|2,500 FOXSY/)
  m.store.updateSettings(0, { maxShopPaymentFoxsy: 2000 })
  assert.match((await m.exec.run(m.agent(), dryWallet, rares(), act({ type: 'fusion_match_waiver', nonce: 301, matches: 25 })))[0]!.summary, /2500 FOXSY exceeds the per-action maximum 2000/)
})

test('cooldown waiver: some of the days at the per-day price, the days named in the transaction; every day leaves them out', async () => {
  const sent: string[] = []
  const m = setup({
    chain: {
      query: async (_sc: string, fn: string) => (fn === 'getFusionCooldownWaiverQuote' ? [b64(11n), b64(wholeToAtomic(825))] : []),
      send: async (tx: { data: string }) => (sent.push(Buffer.from(tx.data, 'base64').toString()), `hash${sent.length}`),
    },
  })
  const [part] = await m.exec.run(m.agent(), dryWallet, roomy(), act({ type: 'fusion_cooldown_waiver', nonce: 101, days: 4 }))
  assert.equal(part!.status, 'dry_run', part!.summary)
  assert.match(part!.summary, /by 4 days/)
  assert.match(part!.summary, /4 of its 11 waivable days sooner/)
  assert.match(part!.summary, /300 FOXSY/)
  assert.match((await m.exec.run(m.agent(), dryWallet, roomy(), act({ type: 'fusion_cooldown_waiver', nonce: 101, days: 12 })))[0]!.summary, /11 days above the 3-day floor to waive, not 12/)
  await withLive(m.store, async () => {
    assert.equal((await m.exec.run(m.agent(), liveWallet, roomy(), act({ type: 'fusion_cooldown_waiver', nonce: 101, days: 4 })))[0]!.status, 'confirmed')
    assert.equal((await m.exec.run(m.agent(), liveWallet, roomy(), act({ type: 'fusion_cooldown_waiver', nonce: 101, days: 11 })))[0]!.status, 'confirmed')
  })
  assert.ok(sent[0]!.includes(`@${numberToHex(wholeToAtomic(300))}@`) && sent[0]!.endsWith(`@${hex('payFusionCooldownWaiver')}@${numberToHex(101)}@${numberToHex(4)}`), sent[0])
  assert.ok(sent[1]!.includes(`@${numberToHex(wholeToAtomic(825))}@`) && sent[1]!.endsWith(`@${hex('payFusionCooldownWaiver')}@${numberToHex(101)}`), 'every day: no days argument')
})

test('match waiver live: the exact cost is booked and sent to the agent itself', async () => {
  const sent: { receiver: string; data: string }[] = []
  const m = setup({
    chain: { send: async (tx: { receiver: string; data: string }) => (sent.push({ receiver: tx.receiver, data: Buffer.from(tx.data, 'base64').toString() }), 'hashw') },
    fox: { user: async () => null, matchWaiverQuote: async () => uncommonQuote(8) },
  })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, roomy(), act({ type: 'fusion_match_waiver', nonce: 102, matches: 7 }))
    assert.equal(r!.status, 'confirmed', r!.summary)
  })
  assert.equal(sent.length, 1)
  assert.equal(sent[0]!.receiver, ADDR)
  assert.ok(sent[0]!.data.includes(`@${numberToHex(wholeToAtomic(140))}@`))
  assert.ok(m.store.spentUsd(0, { category: 'play', dryRun: false }) > 0.3)
})

test('LR1 a match waiver waits for the sync: unsynced matches would be bought again', async () => {
  const m = setup({ fox: { user: async () => null, matchWaiverQuote: async () => uncommonQuote(5) } })
  const dirty = roomy()
  dirty.players.find(p => p.nonce === 102)!.dirty = true
  assert.match((await m.exec.run(m.agent(), dryWallet, dirty, act({ type: 'fusion_match_waiver', nonce: 102, matches: 10 })))[0]!.summary, /sync first/)
  const ahead = roomy()
  ahead.players.find(p => p.nonce === 102)!.competitiveMatches = 12 // 7 more than the chain knows
  assert.match((await m.exec.run(m.agent(), dryWallet, ahead, act({ type: 'fusion_match_waiver', nonce: 102, matches: 10 })))[0]!.summary, /7 competitive matches not on chain yet/)
})
