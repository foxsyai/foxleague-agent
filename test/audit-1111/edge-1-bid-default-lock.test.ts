// Audit 2026-11-11 (Fable 5.2 reviewers at extra-high effort): the proof of EDGE-1, failing before its fix.
// EDGE: the inherited transfer lock of a card at auction (A8) is read only when FoxLeague names its hours. A card moved
// wallet to wallet carries `transfer_cooldown_hours: null`, which is FoxLeague's live default of 504 hours
// (docs/FOXLEAGUE-INTEGRATION.md 3.3: "null = the live default, 504"; the agent's own playerView reads it so), and
// the bid check and the plan's auction line both read that null as "no lock".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STRANGER, dryWallet, encodeAuction, setup, snapshot } from '../fixtures.ts'
import { wholeToAtomic } from '../../src/util/encoding.ts'
import { renderDigest } from '../../src/snapshot/digest.ts'
import { playerView } from '../../src/snapshot/snapshot.ts'
import type { PlannedAction } from '../../src/executor/actions.ts'
import type { MarketListing, PlayerCard } from '../../src/foxleague/types.ts'

const act = (action: unknown): PlannedAction[] => [{ action: action as PlannedAction['action'], reason: '' }]
const anHourAgo = () => new Date(Date.now() - 3600_000).toISOString()

test('the agent itself reads a card moved an hour ago with no hours named as locked for 21 days', () => {
  const p = playerView({ nft_nonce: 9, name: 'X', position: 'MID', rarity: 'Rare', condition: 100, transferred_at: anHourAgo(), transfer_cooldown_hours: null, created_at: anHourAgo() } as unknown as PlayerCard, null, new Date())
  assert.ok(p.transferLockedUntil && Date.parse(p.transferLockedUntil) - Date.now() > 20 * 86_400_000, 'in the wallet the same card is locked about 21 days')
})

test('A8 holds for the default lock too: no bid on a card moved an hour ago whose hours FoxLeague leaves null (504 h)', async () => {
  const au = encodeAuction({ seller: STRANGER, min: wholeToAtomic(500), top: 0n, bidder: null, endsInS: 3600 })
  const query = async (_sc: string, fn: string) => (fn === 'getAuction' ? [au] : [])
  const m = setup({ chain: { query }, fox: { user: async () => null, player: async () => ({ rarity: 'Rare', transferred_at: anHourAgo(), transfer_cooldown_hours: null, injured_until: null, bans_pending: 0 }), listings: async () => [] } })
  const [r] = await m.exec.run(m.agent(), dryWallet, snapshot(), act({ type: 'bid', nonce: 9, foxsy: 500 }))
  assert.equal(r!.status, 'refused', `a card that cannot play for about 21 days took a bid: ${r!.summary}`)
  assert.match(r!.summary, /transfer lock/)
})

test('the plan is told of the default lock on the auction line', () => {
  const s = snapshot()
  s.market.auctions = [{ nft_nonce: 9, owner_address: STRANGER, name: 'X', position: 'MID', rarity: 'Rare', level: 1, speed: 50, accuracy: 50, defense: 50, power: 50, control: 50, vision: 50, stamina: 50, condition: 100, is_auction: true, min_price: 500, highest_bid: null, ends_at: new Date(Date.now() + 3600_000).toISOString(), transferred_at: anHourAgo(), transfer_cooldown_hours: null } as MarketListing]
  const line = renderDigest(s).split('\n').find(l => l.includes('#9 X MID Rare')) ?? ''
  assert.ok(line, 'the auction line is there')
  assert.match(line, /transfer lock until/, `the auction line says nothing of the lock: ${line}`)
})

// Added with the fix: the default is the one FoxLeague serves (models.rs effective_transfer_cooldown_hours: the card's
// hours, else the live key), and a move whose time cannot be read is no "never moved".
test('the default lock is the one /api/config serves: 48 h served, moved an hour ago, the line names a lock of two days', () => {
  const s = snapshot()
  s.config!.transfer_cooldown_hours = 48
  const moved = anHourAgo()
  s.market.auctions = [{ nft_nonce: 9, owner_address: STRANGER, name: 'X', position: 'MID', rarity: 'Rare', level: 1, speed: 50, accuracy: 50, defense: 50, power: 50, control: 50, vision: 50, stamina: 50, condition: 100, is_auction: true, min_price: 500, highest_bid: null, ends_at: new Date(Date.now() + 3600_000).toISOString(), transferred_at: moved, transfer_cooldown_hours: null } as MarketListing]
  const line = renderDigest(s).split('\n').find(l => l.includes('#9 X MID Rare')) ?? ''
  assert.ok(line.includes(`transfer lock until ${new Date(Date.parse(moved) + 48 * 3600_000).toISOString().slice(0, 16)}`), line)
  const p = playerView({ nft_nonce: 9, name: 'X', position: 'MID', rarity: 'Rare', condition: 100, transferred_at: moved, transfer_cooldown_hours: null, created_at: moved } as unknown as PlayerCard, null, new Date(), false, { transfer_cooldown_hours: 48 })
  assert.equal(p.transferLockedUntil, new Date(Date.parse(moved) + 48 * 3600_000).toISOString(), 'the wallet card reads the same served default')
})

test('a short served default lets the bid through and says the lock (48 h is within what a bid accepts)', async () => {
  const au = encodeAuction({ seller: STRANGER, min: wholeToAtomic(500), top: 0n, bidder: null, endsInS: 3600 })
  const query = async (_sc: string, fn: string) => (fn === 'getAuction' ? [au] : [])
  const m = setup({ chain: { query }, fox: { user: async () => null, player: async () => ({ rarity: 'Rare', transferred_at: anHourAgo(), transfer_cooldown_hours: null, injured_until: null, bans_pending: 0 }), listings: async () => [] } })
  const s = snapshot()
  s.config!.transfer_cooldown_hours = 48
  const [r] = await m.exec.run(m.agent(), dryWallet, s, act({ type: 'bid', nonce: 9, foxsy: 500 }))
  assert.equal(r!.status, 'dry_run', r!.summary)
  assert.match(r!.summary, /carries a transfer lock until/)
})

test('a card whose move carries a time that is no time is unread: no bid', async () => {
  const au = encodeAuction({ seller: STRANGER, min: wholeToAtomic(500), top: 0n, bidder: null, endsInS: 3600 })
  const query = async (_sc: string, fn: string) => (fn === 'getAuction' ? [au] : [])
  const m = setup({ chain: { query }, fox: { user: async () => null, player: async () => ({ rarity: 'Rare', transferred_at: 'soon', transfer_cooldown_hours: 504, injured_until: null, bans_pending: 0 }), listings: async () => [] } })
  const [r] = await m.exec.run(m.agent(), dryWallet, snapshot(), act({ type: 'bid', nonce: 9, foxsy: 500 }))
  assert.equal(r!.status, 'refused', r!.summary)
  assert.match(r!.summary, /could not be read: not bidding blind/)
})
