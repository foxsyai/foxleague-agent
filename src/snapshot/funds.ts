// What an agent's wallet holds for the game, in USD: the EGLD (its gas reserve included) and the FOXSY, at the
// snapshot's prices. WEGLD is left out: the agent swaps EGLD only, so WEGLD in the wallet is never used.

import { atomicToFloat } from '../util/encoding.ts'
import type { AgentSnapshot } from './snapshot.ts'

/** Null while the balances or the prices are not known. */
export function fundsUsd(s: AgentSnapshot | undefined): number | null {
  if (!s?.chain || !s.prices) return null
  return atomicToFloat(s.chain.egld) * s.prices.egldUsd + atomicToFloat(s.chain.foxsy) * s.prices.foxsyUsd
}

/** True when the wallet is worth less than the owner's top-up warning level (0 = never). */
export function lowOnFunds(usd: number | null, topUpWarningUsd: number): boolean {
  return usd !== null && topUpWarningUsd > 0 && usd < topUpWarningUsd
}
