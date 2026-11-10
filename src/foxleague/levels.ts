// FoxLeague's switches of the competition levels, the organizer fees, the leave lock and the yellow card bans with
// the injuries, as /api/config serves them.
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
