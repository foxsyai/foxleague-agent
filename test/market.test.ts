import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Address } from '@multiversx/sdk-core'
import { MAINNET } from '../src/config.ts'
import { auctionBidTx, auctionCancelTx, auctionListTx, fusionTx } from '../src/executor/tx.ts'
import { decodeAuction, type Auction } from '../src/chain/players.ts'
import { checkAction, type RulesContext } from '../src/executor/rules.ts'
import { parseAction } from '../src/executor/actions.ts'
import { TEST_SETTINGS } from './fixtures.ts'
import type { AgentSnapshot, PlayerView } from '../src/snapshot/snapshot.ts'
import { wholeToAtomic } from '../src/util/encoding.ts'

const ME = 'erd1fdp7wx5sspwft8jqhp44wlgjyqgjyj229yzfukdpas3g7gkhh32qcr4rpl'
const OTHER = 'erd1qyu5wthldzr8wx5c9ucg8kjagg0jfs53s8nr3zpz3hypefsdd8ssycr6th'
const PLAYERS_HEX = Address.newFromBech32(MAINNET.playersContract).toHex()

test('fusion and auction transactions match the web app byte for byte', () => {
  const f = fusionTx(ME, wholeToAtomic(100), [40, 41, 300], 0)
  assert.equal(f.receiver, ME) // custody shape: the agent sends to itself
  assert.equal(
    f.data,
    `MultiESDTNFTTransfer@${PLAYERS_HEX}@04@464f5853592d356435663365@00@056bc75e2d63100000@46584c502d366632386535@28@01@46584c502d366632386535@29@01@46584c502d366632386535@012c@01@667573696f6e@00@00`,
  )
  assert.equal(f.gasLimit, 21_000_000n)
  assert.throws(() => fusionTx(ME, 1n, [1, 2], 0))
  const b = auctionBidTx(300, 1000)
  assert.equal(b.receiver, MAINNET.playersContract)
  assert.equal(b.data, 'ESDTTransfer@464f5853592d356435663365@3635c9adc5dea00000@61756374696f6e426964@012c')
  const l = auctionListTx(ME, 300, 500)
  assert.equal(l.receiver, ME)
  assert.equal(l.data, `ESDTNFTTransfer@46584c502d366632386535@012c@01@${PLAYERS_HEX}@61756374696f6e4c697374@1b1ae4d6e2ef500000`)
  assert.equal(auctionCancelTx(300).data, 'auctionCancel@012c')
})

test('a live auction decodes from the view', () => {
  const addr = (a: string) => Buffer.from(Address.newFromBech32(a).toHex(), 'hex')
  const big = (v: bigint) => { const hex = v.toString(16); const b = Buffer.from(hex.length % 2 ? `0${hex}` : hex, 'hex'); const len = Buffer.alloc(4); len.writeUInt32BE(v ? b.length : 0); return Buffer.concat([len, v ? b : Buffer.alloc(0)]) }
  const end = Buffer.alloc(8); end.writeBigUInt64BE(1790700000n)
  const raw = Buffer.concat([addr(OTHER), big(wholeToAtomic(500)), big(wholeToAtomic(800)), addr(ME), end]).toString('base64')
  const a = decodeAuction(raw)
  assert.deepEqual({ ...a, endsAt: a.endsAt.getTime() }, { seller: OTHER, minPrice: wholeToAtomic(500), highestBid: wholeToAtomic(800), highestBidder: ME, endsAt: 1790700000_000 })
  const none = Buffer.concat([addr(OTHER), big(wholeToAtomic(500)), big(0n), Buffer.alloc(32), end]).toString('base64')
  assert.equal(decodeAuction(none).highestBidder, null)
})

test('the new actions parse and reject bad shapes', () => {
  assert.deepEqual(parseAction({ type: 'fuse', player_nonces: [1, 2, 3], position_of: 2 }), { type: 'fuse', player_nonces: [1, 2, 3], position_of: 2 })
  assert.throws(() => parseAction({ type: 'fuse', player_nonces: [1, 2], position_of: 0 }))
  assert.throws(() => parseAction({ type: 'fuse', player_nonces: [1, 1, 2], position_of: 0 }))
  assert.throws(() => parseAction({ type: 'fuse', player_nonces: [1, 2, 3], position_of: 3 }))
  assert.deepEqual(parseAction({ type: 'bid', nonce: 9, foxsy: 700 }), { type: 'bid', nonce: 9, foxsy: 700 })
  assert.throws(() => parseAction({ type: 'bid', nonce: 9, foxsy: 700.5 }))
  assert.deepEqual(parseAction({ type: 'list_card', nonce: 9, reserve_foxsy: 900 }), { type: 'list_card', nonce: 9, reserve_foxsy: 900 })
  assert.deepEqual(parseAction({ type: 'cancel_listing', nonce: 9 }), { type: 'cancel_listing', nonce: 9 })
})

function card(nonce: number, position: PlayerView['position'], rarity: PlayerView['rarity'], role: PlayerView['role'], comp = 0): PlayerView {
  const st = { speed: 20, accuracy: 20, defense: 20, power: 20, control: 20, vision: 20, stamina: 20 }
  return { nonce, name: `P${nonce}`, position, rarity, cap: 30, role, condition: 100, ageYears: 18, synced: { ...st }, live: { ...st }, xp: {}, dirty: false, competitiveMatches: comp, fusionMatchCredit: 0, fusionReadyAt: null, listed: false, transferLockedUntil: null, syncedTotal: 140 }
}

function snap(extra: PlayerView[] = []): AgentSnapshot {
  const pos: PlayerView['position'][] = ['GK', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'FWD', 'FWD', 'GK', 'DEF', 'DEF', 'MID', 'MID', 'FWD', 'FWD']
  const players = pos.map((p, i) => card(i + 1, p, 'Common', i < 11 ? 'starter' : 'bench', 20))
  return {
    takenAt: new Date().toISOString(), watchOnly: false, agent: { index: 0, address: ME, shard: 0 },
    gameDay: { resetHourUtc: 14, nextResetAt: '', hoursToReset: 5 },
    chain: { egld: wholeToAtomic(2), nonce: 3, foxsy: wholeToAtomic(3000), wegld: 0n, nftCount: 18 + extra.length },
    prices: { egldUsd: 4.5, egldPerFoxsy: 0.0005, foxsyUsd: 0.00225 },
    config: { fusion_costs_foxsy: [100, 200, 400, 800], auction_enabled: true, marketplace_min_list_price_foxsy: 500 } as AgentSnapshot['config'],
    registration: { registered: true, teamName: 'Agent', feePaidOnChain: true, whitelisted: true, relayerEnabled: true, relaysRemaining: 1 },
    profile: null,
    team: { id: 1, user_id: 1, name: 'Agent', coach_name: null, formation: '4-4-2', lineup: players.slice(0, 11).map(p => p.nonce), substitutes: players.slice(11).map(p => p.nonce), team_overall: 20, badge: null },
    players: [...players, ...extra], auth: null,
    market: { openStandard: [], openChallenges: [], recentStandard: [], slots: [], auctions: [], floors: [] },
    leaderboardNeighbours: [], warnings: [],
  }
}

const ctx = (more: Partial<RulesContext> = {}): RulesContext => ({ settings: { ...TEST_SETTINGS }, now: new Date(), ...more })
const spares = () => [card(40, 'DEF', 'Common', 'reserve', 20), card(41, 'MID', 'Common', 'reserve', 20), card(42, 'FWD', 'Common', 'reserve', 20)]

test('fusion: same rarity, 20 competitive matches, synced, outside the squad, 18 cards left', () => {
  const fuse = (nonces: number[], s = snap(spares()), c = ctx({ canFuse: { can_fuse: true }, fusionPool: 4 })) => checkAction({ type: 'fuse', player_nonces: nonces, position_of: 0 }, s, c)
  const ok = fuse([40, 41, 42])
  assert.equal(ok.ok, true, ok.refusal)
  assert.equal(ok.foxsy, wholeToAtomic(100))
  assert.match(fuse([40, 41, 2]).refusal!, /lineup or on the bench/)
  const few = snap(spares())
  few.players = few.players.filter(p => p.nonce !== 17 && p.nonce !== 18) // 19 cards: a fusion would leave 17
  assert.match(fuse([40, 41, 42], few).refusal!, /leave 17 cards; a match needs 18/)
  const mixed = snap([...spares().slice(0, 2), card(43, 'FWD', 'Rare', 'reserve', 20)])
  assert.match(fuse([40, 41, 43], mixed).refusal!, /same rarity/)
  const dirty = snap(spares()); dirty.players.find(p => p.nonce === 41)!.dirty = true
  assert.match(fuse([40, 41, 42], dirty).refusal!, /sync first/)
  const young = snap([...spares().slice(0, 2), card(42, 'FWD', 'Common', 'reserve', 12)])
  assert.match(fuse([40, 41, 42], young).refusal!, /12 of the 20/)
  assert.match(fuse([40, 41, 42], snap(spares()), ctx({ canFuse: { can_fuse: false, cooldown_remaining: 7200 } })).refusal!, /wallet fusion cooldown, 2 h/)
  assert.match(fuse([40, 41, 42], snap(spares()), ctx({ canFuse: { can_fuse: true }, fusionPool: 0 })).refusal!, /no Uncommon DEF left/)
})

const auction = (more: Partial<Auction> = {}): Auction => ({ seller: OTHER, minPrice: wholeToAtomic(500), highestBid: 0n, highestBidder: null, endsAt: new Date(Date.now() + 3600_000), ...more })

test('bids: reserve or top + 5 percent, within the max bid, never with or against own agents', () => {
  // A known rarity is a precondition of every bid (agent review of PR #21); an Uncommon at these amounts meets every limit.
  const bid = (foxsy: number, au: Auction | null = auction(), c: Partial<RulesContext> = {}) => checkAction({ type: 'bid', nonce: 9, foxsy }, snap(), ctx({ auction: au, cardRarity: 'Uncommon', ...c }))
  assert.equal(bid(500).ok, true)
  assert.match(bid(499).refusal!, /below the minimum 500/)
  assert.match(bid(1049, auction({ highestBid: wholeToAtomic(1000), highestBidder: OTHER })).refusal!, /minimum 1050/)
  assert.equal(bid(1050, auction({ highestBid: wholeToAtomic(1000), highestBidder: OTHER })).ok, true)
  assert.match(bid(2600).refusal!, /per-action maximum 2500/)
  assert.match(bid(600, auction({ highestBid: wholeToAtomic(550), highestBidder: ME })).refusal!, /already the top bidder/)
  // Owner, 2026-09-30: agents do not know each other, so a card another agent of the install sells or leads on is
  // bid on like any other (the rules do not even know those addresses any more).
  assert.equal(bid(600, auction({ seller: OTHER })).ok, true)
  assert.match(bid(600, auction({ endsAt: new Date(Date.now() - 1000) })).refusal!, /has ended/)
  assert.match(bid(600, null).refusal!, /not at auction/)
})

test('listing: spare card only, 20 matches, never under the floor; cancel only without bids', () => {
  const list = (nonce: number, reserve: number, s = snap(spares()), c = ctx({ canList: { can_list: true }, floorPrice: 700 })) => checkAction({ type: 'list_card', nonce, reserve_foxsy: reserve }, s, c)
  assert.equal(list(40, 800).ok, true)
  assert.match(list(3, 800).refusal!, /lineup or on the bench/)
  assert.match(list(40, 600).refusal!, /under the Common floor of 700/)
  assert.match(list(40, 400, snap(spares()), ctx()).refusal!, /platform minimum of 500/)
  assert.match(list(40, 800, snap([card(40, 'DEF', 'Common', 'reserve', 3)])).refusal!, /needs 20 competitive matches/)
  assert.match(list(40, 800, snap([])).refusal!, /not in the wallet/)
  const cancel = (au: Auction | null) => checkAction({ type: 'cancel_listing', nonce: 40 }, snap(spares()), ctx({ auction: au }))
  assert.equal(cancel(auction({ seller: ME })).ok, true)
  assert.match(cancel(auction({ seller: ME, highestBid: wholeToAtomic(500), highestBidder: OTHER })).refusal!, /has bids/)
  assert.match(cancel(auction()).refusal!, /not this agent's auction/)
})

test('a bid never pays more than the card would cost from Common packs and fusion fees', async () => {
  const { packAndFusionCost } = await import('../src/executor/rules.ts')
  const cfg = { common_pack_price_foxsy: 2500, fusion_costs_foxsy: [100, 200, 400, 800] }
  assert.deepEqual(['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'].map(r => packAndFusionCost(cfg, r)), [500, 1600, 5000, 15400, 47000])
  assert.equal(packAndFusionCost({ common_pack_price_foxsy: 0, fusion_costs_foxsy: [] }, 'Rare'), null, 'unknown prices: no ceiling')
  const s = snap()
  s.chain!.foxsy = wholeToAtomic(100_000)
  s.config = { ...s.config!, common_pack_price_foxsy: 2500 }
  // The owner's limits per rarity raised out of the way: this tests the build cost alone.
  const rich = { ...TEST_SETTINGS, maxBidFoxsy: 40_000, maxBidRareFoxsy: 1e6, maxBidEpicFoxsy: 1e6, maxBidLegendaryFoxsy: 1e6 }
  const bid = (foxsy: number, rarity: string) => checkAction({ type: 'bid', nonce: 9, foxsy }, s, ctx({ settings: rich, auction: auction({ minPrice: wholeToAtomic(500) }), cardRarity: rarity }))
  assert.equal(bid(15_400, 'Epic').ok, true)
  // No cooldown settings in this config: the ceiling is the packs and fusion fees alone (test/bid-ceiling.test.ts has the full one).
  assert.match(bid(16_000, 'Epic').refusal!, /above what an Epic costs to build yourself \(15400 FOXSY/)
  assert.equal(bid(40_000, 'Legendary').ok, true)
  assert.match(bid(5_500, 'Rare').refusal!, /\(5000 FOXSY: .*\): building it is cheaper/)
})
