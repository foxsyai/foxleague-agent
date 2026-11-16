// FoxLeague's switches of the competition levels, the organizer fees, the leave lock, the yellow card bans with
// the injuries and the fusion that mints its result, as /api/config serves them.
// No block (an older backend) is the rules of before: FoxLeague itself refuses what it no longer takes, before anything
// is paid. A config read just before a switch says `live: false`, so the moment it names counts too.

import type { FoxConfig } from './types.ts'

const passed = (from: string | null | undefined, now: Date): boolean => {
  const at = from ? Date.parse(from) : NaN
  return Number.isFinite(at) && at <= now.getTime()
}

/** Ranked costs a ticket, paid Bronze earns, XP and ELO go by level. */
export function levelsLive(cfg: FoxConfig | null | undefined, now: Date): boolean {
  const c = cfg?.competition_levels
  return Boolean(c) && (c!.live === true || passed(c!.live_from, now))
}

/**
 * A paid Bronze earns XP, ELO and a competitive match once the levels are live; a private one (an invite list) only
 * while FoxLeague serves `private_bronze_earns: true` (competition_levels.rs level_of). An unread flag, or a
 * tournament whose privacy was not read, is no.
 */
export function paidBronzeEarns(cfg: FoxConfig | null | undefined, now: Date, isPrivate: boolean | undefined): boolean {
  return levelsLive(cfg, now) && (isPrivate === false || cfg?.competition_levels?.private_bronze_earns === true)
}

/** A tournament's organizer pays a calendar deposit and, on an invite list, a private fee. */
export function organizerFeesLive(cfg: FoxConfig | null | undefined, now: Date): boolean {
  const c = cfg?.organizer_fees
  return Boolean(c) && (c!.live === true || passed(c!.live_from, now))
}

/** A team may leave only if the tournament keeps its minimum. */
export function leaveLockLive(cfg: FoxConfig | null | undefined): boolean {
  return cfg?.tournament_defaults?.leave_lock_live === true
}

/**
 * Yellow card bans and injuries count (FoxLeague's `card_bans`, one switch for both). From then every card's answer
 * carries its injury and its ban: one left out is unknown, never healthy.
 */
export function cardBansLive(cfg: FoxConfig | null | undefined, now: Date): boolean {
  const c = cfg?.card_bans
  return Boolean(c) && (c!.live === true || passed(c!.live_from, now))
}

/**
 * The MetaStaking Shop discount (FoxLeague's `metastaking_discount`): from its switch a wallet with FOXSY in MetaStaking
 * pays less in the Shop and FoxLeague's confirm takes only that wallet's price, so the rate must be read before paying.
 * No block (an older backend), or one switched off with no time set: every wallet pays the list price. A block that
 * cannot be read is no "off": unknown is not false.
 */
export function shopDiscountLive(cfg: FoxConfig | null | undefined, now: Date): boolean {
  const c = cfg?.metastaking_discount as { live?: unknown; live_from?: unknown } | null | undefined
  if (c === undefined || c === null) return false
  if (typeof c !== 'object' || typeof c.live !== 'boolean') return true
  if (c.live) return true
  if (c.live_from === null || c.live_from === undefined) return false
  return typeof c.live_from !== 'string' || !Number.isFinite(Date.parse(c.live_from)) || passed(c.live_from, now)
}

/** The ELO pair cap governs (FoxLeague's `elo_pair_cap`): a meeting past its number a game day moves no ELO. */
export function eloPairCapLive(cfg: FoxConfig | null | undefined, now: Date): boolean {
  const c = cfg?.elo_pair_cap
  return Boolean(c) && (c!.live === true || passed(c!.live_from, now))
}

/** How near FoxLeague's fusion switch the old fusion stops: one sent then could reach the chain after it. */
export const FUSION_SWITCH_MARGIN_MS = 10 * 60_000

/**
 * Which fusion FoxLeague runs now (its `fusion_mint` switch): `pool`, the old fusion, a card drawn from the contract's
 * pool (`liveFrom`: when that ends, null when no switch is set); `mint`, the fusion that mints its result, prepared by
 * FoxLeague (from `live_from` the contract refuses the old one); `closed`, no fusion now (`why`): FoxLeague says fusion
 * is being updated, the switch is less than FUSION_SWITCH_MARGIN_MS away or the block cannot be read. Unknown is not
 * the old fusion: FoxLeague serves the block on mainnet since 2026-11-13, and one that is not exactly it closes fusion.
 */
export type FusionMode = { mode: 'pool'; liveFrom: string | null } | { mode: 'mint'; liveFrom: string | null } | { mode: 'closed'; why: string }

export function fusionMode(cfg: FoxConfig | null | undefined, now: Date): FusionMode {
  const f = cfg?.fusion_mint as { live?: unknown; live_from?: unknown; paused?: unknown } | null | undefined
  const unread: FusionMode = { mode: 'closed', why: "whether FoxLeague's fusion draws from the pool or mints a new card could not be read (its fusion_mint setting): not fusing blind" }
  if (!f || typeof f !== 'object' || typeof f.live !== 'boolean' || typeof f.paused !== 'boolean') return unread
  if (f.live_from !== null && f.live_from !== undefined && (typeof f.live_from !== 'string' || !Number.isFinite(Date.parse(f.live_from)))) return unread
  const liveFrom = (f.live_from as string | null | undefined) ?? null
  if (f.paused) return { mode: 'closed', why: 'FoxLeague says fusion is being updated: no fusion can be made right now' }
  if (f.live || passed(liveFrom, now)) return { mode: 'mint', liveFrom }
  if (liveFrom && Date.parse(liveFrom) - now.getTime() < FUSION_SWITCH_MARGIN_MS) {
    return { mode: 'closed', why: `FoxLeague's fusion changes at ${liveFrom}: no fusion in the last ${FUSION_SWITCH_MARGIN_MS / 60_000} minutes before it (an old fusion sent now could reach the chain after the switch and be refused there)` }
  }
  return { mode: 'pool', liveFrom }
}
