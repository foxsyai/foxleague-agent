// What an agent's wallet holds for the game, in USD at the snapshot's prices: the EGLD, the WEGLD (a swap
// spends it before EGLD) and the FOXSY. `playable` leaves out the EGLD gas reserve, which is never swapped:
// a wallet holding only its reserve cannot play, whatever EGLD is worth, so the top-up warning uses it.

import { atomicToFloat, decimalToAtomic } from '../util/encoding.ts'
import type { AgentSnapshot } from './snapshot.ts'

/** Null while the balances or the prices are not known. */
export function fundsUsd(s: AgentSnapshot | undefined): number | null {
  if (!s?.chain || !s.prices) return null
  return (atomicToFloat(s.chain.egld) + atomicToFloat(s.chain.wegld)) * s.prices.egldUsd + atomicToFloat(s.chain.foxsy) * s.prices.foxsyUsd
}

/** The same without the EGLD gas reserve: what the agent can still pay for the game with. */
export function playableUsd(s: AgentSnapshot | undefined, egldGasReserve: string): number | null {
  if (!s?.chain || !s.prices) return null
  const reserve = decimalToAtomic(egldGasReserve)
  const egld = s.chain.egld > reserve ? s.chain.egld - reserve : 0n
  return (atomicToFloat(egld) + atomicToFloat(s.chain.wegld)) * s.prices.egldUsd + atomicToFloat(s.chain.foxsy) * s.prices.foxsyUsd
}

/** True when what the agent can play with is worth less than the owner's top-up warning level (0 = never). */
export function lowOnFunds(playable: number | null, topUpWarningUsd: number): boolean {
  return playable !== null && topUpWarningUsd > 0 && playable < topUpWarningUsd
}

/** The warning is sent again only after a top-up well above the level, so a value hovering around it stays quiet. */
export const TOP_UP_REARM = 1.2
