// Reads of the players contract used before a fusion or an auction action (views, any shard).

import { Address } from '@multiversx/sdk-core'
import { MAINNET } from '../config.ts'
import type { Chain } from './gateway.ts'
import { numberToHex } from '../util/encoding.ts'

export interface Auction {
  seller: string
  /** Reserve and top bid in atomic FOXSY; highestBid 0 means no bids yet (the contract's own sentinel). */
  minPrice: bigint
  highestBid: bigint
  highestBidder: string | null
  endsAt: Date
}

/** Decodes the nested Auction struct: address, BigUint, BigUint, address, u64 (player_nft.rs:163-170). */
export function decodeAuction(b64: string): Auction {
  const buf = Buffer.from(b64, 'base64')
  let at = 0
  const address = () => {
    const a = buf.subarray(at, at + 32)
    at += 32
    return a
  }
  const bigUint = () => {
    const len = buf.readUInt32BE(at)
    at += 4
    const v = len ? BigInt(`0x${buf.subarray(at, at + len).toString('hex')}`) : 0n
    at += len
    return v
  }
  const seller = address()
  const minPrice = bigUint()
  const highestBid = bigUint()
  const bidder = address()
  const end = buf.readBigUInt64BE(at)
  return {
    seller: new Address(seller).toBech32(),
    minPrice,
    highestBid,
    highestBidder: highestBid > 0n ? new Address(bidder).toBech32() : null,
    endsAt: new Date(Number(end) * 1000),
  }
}

/** The live auction of a card, or null when it is not auctioned (view getAuction, OptionalValue). */
export async function getAuction(chain: Chain, nonce: number): Promise<Auction | null> {
  const out = await chain.query(MAINNET.playersContract, 'getAuction', [numberToHex(nonce)])
  return out.length && out[0] ? decodeAuction(out[0]) : null
}

export const POSITION_INDEX = { GK: 0, DEF: 1, MID: 2, FWD: 3 } as const
export const RARITY_LEVEL = { Common: 0, Uncommon: 1, Rare: 2, Epic: 3, Legendary: 4 } as const

/** Days a fusion cooldown waiver would take off the card now, and its exact cost (view getFusionCooldownWaiverQuote, any shard). */
export async function fusionCooldownQuote(chain: Chain, nonce: number): Promise<{ days: number; costAtomic: bigint }> {
  const [days, cost] = await chain.query(MAINNET.playersContract, 'getFusionCooldownWaiverQuote', [numberToHex(nonce)])
  const big = (v: string | undefined) => BigInt(`0x${Buffer.from(v ?? '', 'base64').toString('hex') || '0'}`)
  return { days: Number(big(days)), costAtomic: big(cost) }
}

/** Cards left in the fusion pool for an output rarity level and position (view getFusionPoolCount). */
export async function fusionPoolCount(chain: Chain, outputLevel: number, position: keyof typeof POSITION_INDEX): Promise<number> {
  const [v] = await chain.query(MAINNET.playersContract, 'getFusionPoolCount', [numberToHex(outputLevel), numberToHex(POSITION_INDEX[position])])
  return v ? Number(BigInt(`0x${Buffer.from(v, 'base64').toString('hex') || '0'}`)) : 0
}
