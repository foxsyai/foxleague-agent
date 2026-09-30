// EGLD -> FOXSY on the xExchange FOXSY/WEGLD pair, the same trade the FoxLeague onboarding and
// Dashboard swap sign. Encoders and amount maths are ported from the web app's pure module
// (next-foxleague frontend/src/lib/xexchangeSwap.ts, pinned there against mainnet transactions).

import { MAINNET } from '../config.ts'
import { b64ToBigInt, b64ToString, hexOfString, nestedHex, numberToHex } from '../util/encoding.ts'
import type { Chain } from './gateway.ts'

export const DEX_SLIPPAGE_BPS_DEFAULT = 100
const PAIR_FEE_BASE = 100_000n
const PAIR_FEE = 300n
/** Refuse a quote more than 5 percent over the pool's spot price. */
const PRICE_IMPACT_LIMIT_PERCENT = 105n
/** EGLD kept back on the EGLD path for network fees (web app: 0.01 EGLD). */
export const EGLD_GAS_RESERVE_WEI = 10_000_000_000_000_000n

const TASK_WRAP_EGLD = 0
const TASK_SWAP = 2

export function clampSlippageBps(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return DEX_SLIPPAGE_BPS_DEFAULT
  return Math.min(300, Math.max(10, raw))
}

export function applySlippage(amountIn: bigint, bps: number): bigint {
  return (amountIn * BigInt(10_000 + clampSlippageBps(bps))) / 10_000n
}

export function priceImpactOk(p: { amountIn: bigint; out: bigint; reserveFoxsy: bigint; reserveWegld: bigint }): boolean {
  if (p.reserveFoxsy <= 0n || p.reserveWegld <= 0n || p.out <= 0n || p.amountIn <= 0n) return false
  return p.amountIn * p.reserveFoxsy * 100n <= p.reserveWegld * p.out * PRICE_IMPACT_LIMIT_PERCENT
}

function topEncodeU8(n: number): string {
  return n === 0 ? '' : n.toString(16).padStart(2, '0')
}

/**
 * `composeTasks` data for the EGLD path (fixed input, min out = `foxsyOut`); the transaction value
 * is the EGLD paid. Wrap and swap happen inside the Composable Tasks contract.
 */
export function composeTasksEgldToFoxsyData(foxsyOut: bigint): string {
  if (foxsyOut <= 0n) throw new Error('swap output must be positive')
  const token = hexOfString(MAINNET.foxsyToken)
  const amount = numberToHex(foxsyOut)
  const minExpected = nestedHex(token) + '0'.repeat(16) + nestedHex(amount)
  const swapArgs = nestedHex(hexOfString('swapTokensFixedInput')) + nestedHex(token) + nestedHex(amount)
  return `composeTasks@${minExpected}@${topEncodeU8(TASK_WRAP_EGLD)}@@${topEncodeU8(TASK_SWAP)}@${swapArgs}`
}

export interface SwapQuote {
  foxsyOut: bigint
  /** EGLD the pair wants for exactly `foxsyOut`. */
  amountIn: bigint
  /** What the transaction pays: amountIn plus slippage, rounded down. */
  maxIn: bigint
  slippageBps: number
  reserveFoxsy: bigint
  reserveWegld: bigint
  /** EGLD per FOXSY at spot, for USD valuation. */
  spotEgldPerFoxsy: number
}

/** Reads the pool state; throws when the pair is not the FOXSY/WEGLD pool or not active. */
export async function poolState(chain: Chain): Promise<{ reserveFoxsy: bigint; reserveWegld: bigint; spotEgldPerFoxsy: number }> {
  const pair = MAINNET.foxsyWegldPair
  const [state] = await chain.query(pair, 'getState')
  if (b64ToBigInt(state) !== 1n) throw new Error('xExchange FOXSY/WEGLD pair is not active')
  const [first] = await chain.query(pair, 'getFirstTokenId')
  const [second] = await chain.query(pair, 'getSecondTokenId')
  if (b64ToString(first) !== MAINNET.foxsyToken || b64ToString(second) !== MAINNET.wegldToken) {
    throw new Error(`unexpected pair tokens ${b64ToString(first)}/${b64ToString(second)}`)
  }
  const [rf, rw] = await chain.query(pair, 'getReservesAndTotalSupply')
  const reserveFoxsy = b64ToBigInt(rf)
  const reserveWegld = b64ToBigInt(rw)
  if (reserveFoxsy <= 0n || reserveWegld <= 0n) throw new Error('empty pool')
  return { reserveFoxsy, reserveWegld, spotEgldPerFoxsy: Number(reserveWegld) / Number(reserveFoxsy) }
}

export async function quoteEgldForFoxsy(chain: Chain, foxsyOut: bigint, slippageBps: number): Promise<SwapQuote> {
  const pool = await poolState(chain)
  const [amountInB64] = await chain.query(MAINNET.foxsyWegldPair, 'getAmountIn', [hexOfString(MAINNET.foxsyToken), numberToHex(foxsyOut)])
  const amountIn = b64ToBigInt(amountInB64)
  if (amountIn <= 0n) throw new Error('pair returned no quote')
  if (!priceImpactOk({ amountIn, out: foxsyOut, reserveFoxsy: pool.reserveFoxsy, reserveWegld: pool.reserveWegld })) {
    throw new Error('quote more than 5% over spot: pool drained or moving, refusing')
  }
  return { foxsyOut, amountIn, maxIn: applySlippage(amountIn, slippageBps), slippageBps: clampSlippageBps(slippageBps), ...pool }
}

/** Mirror of the pair's getAmountOut (estimates only). */
export function pairAmountOut(p: { reserveIn: bigint; reserveOut: bigint; amountIn: bigint }): bigint {
  const inWithFee = p.amountIn * (PAIR_FEE_BASE - PAIR_FEE)
  const denominator = p.reserveIn * PAIR_FEE_BASE + inWithFee
  return denominator === 0n ? 0n : (inWithFee * p.reserveOut) / denominator
}
