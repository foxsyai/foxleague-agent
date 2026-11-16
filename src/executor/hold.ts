// The owner's pause of the actions whose rules FoxLeague changed (audit 2026-11-16, P-W7; the owner's choice of
// 16 Nov). On the dashboard the owner picks what happens when FoxLeague changes its rules: tell only (the default), or
// also pause the actions of the changed manual pages until the agents are synced. With the pause on, while the agents'
// copy of the manual is behind on one of these pages, the executor refuses the agents' own actions of that page. The
// owner's own actions, pending payments, refunds, leaves and every action of another page keep running.

import type { Action } from './actions.ts'

/** Each manual page and the agents' own actions that follow its rules. */
export const HOLD_PAGES = {
  'mechanics/shop': ['buy'],
  'mechanics/marketplace': ['bid', 'list_card'],
  'mechanics/one-v-one': ['create_challenge', 'join_tournament (a 1v1)'],
  'mechanics/tournaments': ['create_tournament', 'join_tournament (a tournament)'],
  'mechanics/fusion': ['fuse', 'fusion_cooldown_waiver', 'fusion_match_waiver'],
} as const satisfies Record<string, readonly string[]>

export type HoldPage = keyof typeof HOLD_PAGES

/**
 * The pages whose rules `a` follows. A join follows the 1v1 page when its tournament is a 1v1 (`oneVOne` true), the
 * tournaments page when it is not (false), and both while that is not known (undefined: its tournament was not read).
 */
export function pagesOf(a: Action, oneVOne?: boolean): HoldPage[] {
  switch (a.type) {
    case 'buy':
      return ['mechanics/shop']
    case 'bid':
    case 'list_card':
      return ['mechanics/marketplace']
    case 'create_challenge':
      return ['mechanics/one-v-one']
    case 'create_tournament':
      return ['mechanics/tournaments']
    case 'join_tournament':
      return oneVOne === true ? ['mechanics/one-v-one'] : oneVOne === false ? ['mechanics/tournaments'] : ['mechanics/one-v-one', 'mechanics/tournaments']
    case 'fuse':
    case 'fusion_cooldown_waiver':
    case 'fusion_match_waiver':
      return ['mechanics/fusion']
    default:
      return []
  }
}

/**
 * Why the owner's pause refuses `a` now, or null. `held`: the changed pages held now (empty with the pause off, or
 * while the copy is current); a page is named as the watch names it (`mechanics/shop`, `mechanics/shop (new)`).
 */
export function holdRefusal(a: Action, held: readonly string[], oneVOne?: boolean): string | null {
  if (!held.length) return null
  const changed = new Set(held.map(p => String(p).replace(/ \((?:new|gone)\)$/, '')))
  const hit = pagesOf(a, oneVOne).filter(p => changed.has(p))
  if (!hit.length) return null
  return `paused by the owner's choice: FoxLeague changed its manual page ${hit.join(' and ')} since the agents' copy, and the owner pauses the actions of a changed page until the agents are synced (a new version of the agent brings the new copy)`
}

/** The actions held now, as the dashboard and the plan name them: `buy`, `join_tournament (a 1v1)`. */
export function heldActions(held: readonly string[]): string[] {
  const changed = new Set(held.map(p => String(p).replace(/ \((?:new|gone)\)$/, '')))
  return (Object.keys(HOLD_PAGES) as HoldPage[]).filter(p => changed.has(p)).flatMap(p => [...HOLD_PAGES[p]])
}
