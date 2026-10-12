import type { FoxConfig } from './types.ts'

/**
 * The match gate of one rarity (FoxLeague, live on mainnet from 2026-10-12 16:30 UTC): the competitive matches a
 * card needs, played plus waived credit, to be fused or listed, the part that must really be played, and the price
 * of a waived match. Mainnet: Common 5 / 5 / no waiver, Uncommon 15 / 5 / 20, Rare 45 / 15 / 100, Epic 135 / 45 /
 * 100, Legendary 405 / 135 / 100 FOXSY.
 */
export interface MatchGate {
  gate: number
  floor: number
  pricePerMatch: number
  /** A match waiver exists for the rarity (a price above 0 and something above the floor to waive). */
  waiver: boolean
}

/**
 * The gate of `rarity` as /api/config serves it. Each row holds what the contract applies (its own row, or the
 * single gate when no row is set), so a row is used whenever the block is there. Without the block (an older
 * FoxLeague) the single gate of before: 20 matches, 5 really played, 20 FOXSY a waived match.
 */
export function matchGate(cfg: FoxConfig, rarity: string): MatchGate {
  const row = cfg.rarity_match_gate?.rarities?.find(r => r.rarity.toLowerCase() === rarity.toLowerCase())
  if (row) {
    const floor = Math.min(row.floor, row.gate)
    return { gate: row.gate, floor, pricePerMatch: row.price_per_match, waiver: row.waiver_enabled && row.price_per_match > 0 && row.gate > floor }
  }
  const gate = cfg.fusion_min_matches ?? 20
  const floor = Math.min(cfg.fusion_match_waiver_floor ?? 5, gate)
  const pricePerMatch = cfg.fusion_match_waiver_price_per_match ?? 20
  return { gate, floor, pricePerMatch, waiver: pricePerMatch > 0 && gate > floor }
}

/** One line for the plan request: every rarity's gate, so the AI plans fusions and listings by the real numbers. */
export function gateLine(cfg: FoxConfig): string {
  return ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary']
    .map(r => {
      const g = matchGate(cfg, r)
      return `${r} ${g.gate} (${g.floor} played${g.waiver ? `, the rest waivable at ${g.pricePerMatch} FOXSY a match` : ', no waiver'})`
    })
    .join('; ')
}

/** "a Rare", "an Uncommon", "an Epic": for refusals people read. */
export function aRarity(rarity: string): string {
  return `${/^[AEIOU]/i.test(rarity) ? 'an' : 'a'} ${rarity}`
}
