// SYNC-2: FoxLeague's manual and rules of 19 Nov 2026. The running agent alerted at 09:03 UTC that FoxLeague's manual
// changed since the agents' copy (players, tactics, tournaments, match-day strategy): the busy-card rule of #748 ("a
// player plays one match at a time", from a date still to be announced, ships off). FoxLeague's release branch for
// mainnet holds more that its main (the source of the manual) has not taken yet: #752, a card in an auction takes no
// paid action ("Condition Recovery, Reduce Cooldown, Medicine and the Fusion Match Waiver are not sold for a card that
// is in an auction"; a payment confirmed for one anyway is refunded whole, the gas lost, and a bulk recovery that names
// one is refunded whole), and a new legal page, "Account Bans and Deletion" (#764).
//
// The agent's condition recovery named any card of the wallet: one in an auction was paid for (before #752 FoxLeague
// kept the payment and recovered a card the marketplace contract holds; from #752 it refunds the whole payment, so the
// other cards of the purchase are not recovered either and the gas is lost). Medicine and the two fusion waivers
// refused a listed card already, but read a card whose auction state the roster did not give as "in the wallet".

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkAction, type RulesContext } from '../../src/executor/rules.ts'
import { LEFT_OUT, undecidedPages } from '../../src/strategist/manual.ts'
import { MANUAL_FILE, RECORD_FILE } from '../../src/strategist/manual-watch.ts'
import { renderDigest } from '../../src/snapshot/digest.ts'
import type { MatchWaiverQuote } from '../../src/foxleague/types.ts'
import { wholeToAtomic } from '../../src/util/encoding.ts'
import { TEST_SETTINGS, card, liveWallet, setup, snapshot, withLive } from '../fixtures.ts'

const DAY = 86_400_000
const inDays = (d: number) => new Date(Date.now() + d * DAY).toISOString()
const ctx = (more: Partial<RulesContext> = {}): RulesContext => ({ settings: { ...TEST_SETTINGS }, now: new Date(), ...more })
const IN_AUCTION = /card #(\d+) is in an auction \(listed for sale\): FoxLeague sells no Condition Recovery, Reduce Cooldown, Medicine or Fusion Match Waiver for it until the auction ends/

/** The fixture's squad and two reserves at condition 60: #501 in an auction (or its state unread), #502 in the wallet. */
function withReserves(listed: boolean | 'unread' = true) {
  const s = snapshot([card(501, 'MID', 'reserve', { condition: 60, listed: (listed === 'unread' ? undefined : listed) as boolean }), card(502, 'MID', 'reserve', { condition: 60 })])
  return s
}

test('SYNC2-1 a condition recovery that names a card in an auction is refused before anything is booked or signed', async () => {
  const recover = (nonces: number[]) => ({ type: 'buy' as const, product: 'condition_recovery' as const, player_nonces: nonces })
  const s = withReserves()
  assert.match(checkAction(recover([501]), s, ctx()).refusal ?? '', IN_AUCTION)
  // A bulk recovery that names it: FoxLeague (from #752) refunds the whole payment, so none of them is recovered.
  const bulk = checkAction(recover([502, 501]), s, ctx())
  assert.equal(bulk.ok, false)
  assert.match(bulk.refusal!, IN_AUCTION)
  assert.equal(checkAction(recover([502]), s, ctx()).ok, true, 'a card in the wallet is recovered as before')
  // Through the executor, live: nothing signed, nothing booked.
  const sent: string[] = []
  const m = setup({ chain: { send: async () => (sent.push('x'), 'hash1') }, fox: { shopConfirm: async () => assert.fail('nothing to confirm') } })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, withReserves(), [{ action: recover([502, 501]), reason: '' }])
    assert.equal(r!.status, 'refused', r!.summary)
    assert.match(r!.summary, IN_AUCTION)
  })
  assert.deepEqual(sent, [])
  assert.equal(m.store.spentUsd(0, { category: 'play', dryRun: false }), 0)
})

test('SYNC2-2 a card whose auction state could not be read takes no card-targeted Shop item: recovery, medicine, both fusion waivers', () => {
  const unknown = /whether card #501 is in an auction could not be read/
  // The roster gave no listed_for_sale for #501 (unknown is not "in the wallet", AGENTS.md rule 4).
  const s = withReserves('unread')
  assert.match(checkAction({ type: 'buy', product: 'condition_recovery', player_nonces: [501] }, s, ctx()).refusal ?? '', unknown)
  const hurt = withReserves('unread')
  hurt.players.find(p => p.nonce === 501)!.injuredUntil = inDays(8)
  const quote = { player_nonce: 501, injured_until: inDays(8), served_until: inDays(2), price_per_day: 300, max_days: 6, days_paid: 2, cost_foxsy: 600 }
  assert.match(checkAction({ type: 'buy', product: 'medicine', player_nonces: [501], quantity: 2 }, hurt, ctx({ medicineDaysThisWeek: 0, medicineQuote: quote })).refusal ?? '', unknown)
  const legend = snapshot([card(501, 'FWD', 'reserve', { rarity: 'Legendary', cap: 100, competitiveMatches: 300, syncedTotal: 50, listed: undefined as unknown as boolean })])
  legend.chain!.foxsy = wholeToAtomic(20_000)
  const mq: MatchWaiverQuote = { max_purchasable: 105, chain_played: 300, credit: 0, price_wei: wholeToAtomic(100).toString(), rarity: 'Legendary', gate: 405, floor: 135, price_per_match: 100, meets_gate: false }
  assert.match(checkAction({ type: 'fusion_match_waiver', nonce: 501, matches: 105 }, legend, ctx({ settings: { ...TEST_SETTINGS, maxShopPaymentFoxsy: 11_000 }, matchQuote: mq })).refusal ?? '', unknown)
  const cooling = withReserves('unread')
  cooling.players.find(p => p.nonce === 501)!.fusionReadyAt = inDays(5)
  assert.match(checkAction({ type: 'fusion_cooldown_waiver', nonce: 501 }, cooling, ctx()).refusal ?? '', unknown)
  // The same items on a card in an auction: the one refusal.
  const listed = withReserves(true)
  listed.players.find(p => p.nonce === 501)!.injuredUntil = inDays(8)
  assert.match(checkAction({ type: 'buy', product: 'medicine', player_nonces: [501], quantity: 2 }, listed, ctx({ medicineDaysThisWeek: 0, medicineQuote: quote })).refusal ?? '', IN_AUCTION)
})

test('SYNC2-3 the plan is told which cards are in an auction and that they take no Shop item until it ends', () => {
  const d = renderDigest(withReserves())
  assert.match(d, /\nIn an auction \(LISTED\): #501: FoxLeague sells no Condition Recovery, Reduce Cooldown, Medicine or Fusion Match Waiver for a card in an auction and trains none until the auction ends; leave it out of every purchase\n/)
  assert.doesNotMatch(renderDigest(snapshot()), /In an auction \(LISTED\)/)
})

test('SYNC2-4 FoxLeague\'s new page "Account Bans and Deletion" is decided: left out, with its reason', () => {
  assert.deepEqual(undecidedPages(['legal/account-bans.md']), [])
  assert.match(LEFT_OUT['legal/account-bans.md'] ?? '', /administrator/)
})

test('SYNC2-5 the agents\' manual is FoxLeague\'s main of 19 Nov (1ab9de65d): the busy-card rule, still off', () => {
  const manual = readFileSync(MANUAL_FILE, 'utf8')
  assert.match(manual.split('\n', 3).join('\n'), / main at 1ab9de65d 2026-11-19\./)
  assert.match(manual, /^## A player still in another match$/m)
  assert.match(manual, /From a date still to be announced a player plays one match at a time/)
  const record = JSON.parse(readFileSync(RECORD_FILE, 'utf8')) as { synced: string; pages: Record<string, string> }
  assert.equal(record.synced, '1ab9de65d 2026-11-19')
  assert.equal(record.pages['legal/account-bans'], undefined)
})
