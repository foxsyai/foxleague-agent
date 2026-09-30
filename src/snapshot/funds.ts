// What an agent's wallet holds for the game, in USD at the snapshot's prices: the EGLD (its gas reserve
// included), the WEGLD (a swap spends it before EGLD) and the FOXSY.

import { atomicToFloat } from '../util/encoding.ts'
import type { AgentSnapshot } from './snapshot.ts'

/** Null while the balances or the prices are not known. */
export function fundsUsd(s: AgentSnapshot | undefined): number | null {
  if (!s?.chain || !s.prices) return null
  return (atomicToFloat(s.chain.egld) + atomicToFloat(s.chain.wegld)) * s.prices.egldUsd + atomicToFloat(s.chain.foxsy) * s.prices.foxsyUsd
}

/** True when the wallet is worth less than the owner's top-up warning level (0 = never). */
export function lowOnFunds(usd: number | null, topUpWarningUsd: number): boolean {
  return usd !== null && topUpWarningUsd > 0 && usd < topUpWarningUsd
}
