// The fixed list of actions the strategist may propose, with typed arguments. The model never
// builds a transaction: it picks one of these, and parseAction rejects anything else before the
// executor looks at it (README guardrail "the model never holds keys").

import { STATS, type Stat } from '../foxleague/types.ts'

export const FORMATION_SLOTS: Record<string, { DEF: number; MID: number; FWD: number }> = {
  '4-4-2': { DEF: 4, MID: 4, FWD: 2 },
  '4-4-2a': { DEF: 4, MID: 4, FWD: 2 },
  '4-4-2o': { DEF: 4, MID: 4, FWD: 2 },
  '4-3-3': { DEF: 4, MID: 3, FWD: 3 },
  '4-3-3w': { DEF: 4, MID: 3, FWD: 3 },
  '4-3-3b': { DEF: 4, MID: 3, FWD: 3 },
  '5-3-2': { DEF: 5, MID: 3, FWD: 2 },
  '4-2-3-1': { DEF: 4, MID: 5, FWD: 1 },
  '5-2-3': { DEF: 5, MID: 2, FWD: 3 },
}
/**
 * Formations FoxLeague lists as coming soon: its match engine cannot play them yet and set_formation refuses
 * them. A team that saved one earlier keeps it (it plays as 4-4-2), so its slots stay in the table above.
 */
export const FORMATIONS_COMING_SOON = new Set(['4-4-2a'])

export const SHOP_PRODUCTS = ['condition_recovery', 'xp_booster', 'training_slot', 'common_pack'] as const
export type ShopProduct = (typeof SHOP_PRODUCTS)[number]

export type Action =
  | { type: 'swap_egld_for_foxsy'; foxsy: number }
  | { type: 'register'; team_name: string }
  | { type: 'sync' }
  | { type: 'train'; player_nonce: number; attribute: Stat }
  | { type: 'set_formation'; formation: string }
  | { type: 'set_lineup'; lineup: number[]; substitutes: number[] }
  | { type: 'play_match'; match_type: 'casual' | 'ranked' }
  | { type: 'join_tournament'; tournament_id: number }
  | { type: 'leave_tournament'; tournament_id: number }
  | {
      type: 'create_tournament'
      title: string
      format: 'knockout' | 'round_robin' | 'swiss' | 'groups_knockout'
      tier: 'silver' | 'gold'
      max_teams: number
      min_teams: number
      entry_fee_foxsy: number
      starts_in_hours: number
      registration_closes_minutes_before: number
      round_interval_minutes: number
      home_and_away?: boolean
    }
  | { type: 'create_challenge'; tier: 'silver' | 'gold'; stake_foxsy: number; target_user_id: number | null; deadline_minutes: 30 | 60 | 120 | 240 }
  | { type: 'buy'; product: ShopProduct; player_nonces?: number[]; quantity?: number }
  | { type: 'claim_refund'; tournament_id: number }
  /** Three cards of one rarity into one of the next; the output takes the position of player_nonces[position_of]. */
  | { type: 'fuse'; player_nonces: number[]; position_of: 0 | 1 | 2 }
  | { type: 'bid'; nonce: number; foxsy: number }
  | { type: 'list_card'; nonce: number; reserve_foxsy: number }
  | { type: 'cancel_listing'; nonce: number }
  /** Shortens a fused card's 14-day fusion cooldown to the 3-day floor (75 FOXSY per waived day). */
  | { type: 'fusion_cooldown_waiver'; nonce: number }
  /** Buys competitive-match credit toward the 20 fusion needs (20 FOXSY per match, 5 must really be played). */
  | { type: 'fusion_match_waiver'; nonce: number; matches: number }

export type ActionType = Action['type']

export interface PlannedAction {
  action: Action
  /** The strategist's one-line reason, kept in the activity log. */
  reason: string
  /** Set only by the service for the owner's own requests (web UI Leave, Telegram /do JSON); never from a plan. */
  byOwner?: true
}

class ParseError extends Error {}

const IMPERSONATION = /fox\s*-?\s*league|foxsy|admin|official|support|moderator|\bmods?\b|\bstaff\b|\bteam\s*fox\b/i

function int(o: Record<string, unknown>, k: string, min: number, max: number): number {
  const v = o[k]
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new ParseError(`${k} must be an integer in [${min}, ${max}]`)
  return v
}

function str(o: Record<string, unknown>, k: string, re: RegExp, what: string): string {
  const v = o[k]
  if (typeof v !== 'string' || !re.test(v)) throw new ParseError(`${k}: ${what}`)
  return v
}

function oneOf<T extends string | number>(o: Record<string, unknown>, k: string, allowed: readonly T[]): T {
  const v = o[k] as T
  if (!allowed.includes(v)) throw new ParseError(`${k} must be one of ${allowed.join(', ')}`)
  return v
}

function nonces(o: Record<string, unknown>, k: string, min: number, max: number): number[] {
  const v = o[k]
  if (!Array.isArray(v) || v.length < min || v.length > max) throw new ParseError(`${k} must be a list of ${min}..${max} card nonces`)
  for (const n of v) if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) throw new ParseError(`${k} holds a bad nonce`)
  if (new Set(v).size !== v.length) throw new ParseError(`${k} holds a duplicate nonce`)
  return v as number[]
}

/** Validates the model's proposal into a typed action; throws with a short reason otherwise. */
export function parseAction(raw: unknown): Action {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ParseError('an action is an object')
  const o = raw as Record<string, unknown>
  switch (o.type) {
    case 'swap_egld_for_foxsy':
      return { type: o.type, foxsy: int(o, 'foxsy', 100, 1_000_000) }
    case 'register': {
      // Server rule: 3-15 bytes of letters, digits, space, hyphen; ASCII is the safe subset.
      const team_name = str(o, 'team_name', /^(?=.{3,15}$)[A-Za-z0-9](?:[A-Za-z0-9 -]*[A-Za-z0-9])?$/, '3-15 ASCII letters, digits, spaces or hyphens')
      // Fair Play: no name that impersonates the platform or its staff.
      if (IMPERSONATION.test(team_name)) throw new ParseError('team_name must not imitate FoxLeague, FOXSY or its staff')
      return { type: o.type, team_name }
    }
    case 'sync':
      return { type: o.type }
    case 'train':
      return { type: o.type, player_nonce: int(o, 'player_nonce', 1, 2 ** 40), attribute: oneOf(o, 'attribute', STATS) }
    case 'set_formation':
      return { type: o.type, formation: oneOf(o, 'formation', Object.keys(FORMATION_SLOTS).filter(f => !FORMATIONS_COMING_SOON.has(f))) }
    case 'set_lineup':
      return { type: o.type, lineup: nonces(o, 'lineup', 11, 11), substitutes: nonces(o, 'substitutes', 0, 7) }
    case 'play_match':
      return { type: o.type, match_type: oneOf(o, 'match_type', ['casual', 'ranked'] as const) }
    case 'join_tournament':
    case 'leave_tournament':
    case 'claim_refund':
      return { type: o.type, tournament_id: int(o, 'tournament_id', 1, 2 ** 40) }
    case 'create_tournament': {
      const format = oneOf(o, 'format', ['knockout', 'round_robin', 'swiss', 'groups_knockout'] as const)
      return {
        type: o.type,
        title: str(o, 'title', /^[\p{L}\p{N} .,!?'&()-]{3,60}$/u, '3-60 plain characters'),
        format,
        tier: oneOf(o, 'tier', ['silver', 'gold'] as const),
        max_teams: int(o, 'max_teams', 3, 64),
        min_teams: int(o, 'min_teams', 2, 64),
        entry_fee_foxsy: int(o, 'entry_fee_foxsy', 1, 1_000_000),
        starts_in_hours: int(o, 'starts_in_hours', 2, 72),
        registration_closes_minutes_before: int(o, 'registration_closes_minutes_before', 10, 24 * 60),
        round_interval_minutes: int(o, 'round_interval_minutes', 30, 1440),
        ...(o.home_and_away === true && format === 'round_robin' ? { home_and_away: true } : {}),
      }
    }
    case 'create_challenge': {
      const target = o.target_user_id
      if (target !== null && target !== undefined && (typeof target !== 'number' || !Number.isInteger(target) || target <= 0)) throw new ParseError('target_user_id must be a user id or null')
      return {
        type: o.type,
        tier: oneOf(o, 'tier', ['silver', 'gold'] as const),
        stake_foxsy: int(o, 'stake_foxsy', 1, 1_000_000),
        target_user_id: (target as number | null | undefined) ?? null,
        deadline_minutes: oneOf(o, 'deadline_minutes', [30, 60, 120, 240] as const),
      }
    }
    case 'buy': {
      const product = oneOf(o, 'product', SHOP_PRODUCTS)
      if (product === 'condition_recovery') return { type: o.type, product, player_nonces: nonces(o, 'player_nonces', 1, 18) }
      if (product === 'training_slot') return { type: o.type, product, quantity: int(o, 'quantity', 1, 25) }
      return { type: o.type, product }
    }
    case 'fuse':
      return { type: o.type, player_nonces: nonces(o, 'player_nonces', 3, 3), position_of: oneOf(o, 'position_of', [0, 1, 2] as const) }
    case 'bid':
      return { type: o.type, nonce: int(o, 'nonce', 1, 2 ** 40), foxsy: int(o, 'foxsy', 1, 1_000_000) }
    case 'list_card':
      return { type: o.type, nonce: int(o, 'nonce', 1, 2 ** 40), reserve_foxsy: int(o, 'reserve_foxsy', 1, 1_000_000) }
    case 'cancel_listing':
      return { type: o.type, nonce: int(o, 'nonce', 1, 2 ** 40) }
    case 'fusion_cooldown_waiver':
      return { type: o.type, nonce: int(o, 'nonce', 1, 2 ** 40) }
    case 'fusion_match_waiver':
      return { type: o.type, nonce: int(o, 'nonce', 1, 2 ** 40), matches: int(o, 'matches', 1, 15) }
    default:
      throw new ParseError(`unknown action type '${String(o.type)}'`)
  }
}

export function describeAction(a: Action): string {
  switch (a.type) {
    case 'swap_egld_for_foxsy': return `swap EGLD for ${a.foxsy} FOXSY`
    case 'register': return `register team "${a.team_name}"`
    case 'sync': return 'sync dirty cards to chain'
    case 'train': return `train #${a.player_nonce} ${a.attribute}`
    case 'set_formation': return `formation ${a.formation}`
    case 'set_lineup': return `lineup ${a.lineup.join(',')} | bench ${a.substitutes.join(',')}`
    case 'play_match': return `play ${a.match_type} match`
    case 'join_tournament': return `join tournament T${a.tournament_id}`
    case 'leave_tournament': return `leave tournament T${a.tournament_id}`
    case 'create_tournament': return `create ${a.tier} ${a.format} "${a.title}" ${a.min_teams}-${a.max_teams} teams, fee ${a.entry_fee_foxsy}, starts in ${a.starts_in_hours} h`
    case 'create_challenge': return `create ${a.tier} 1v1, stake ${a.stake_foxsy}${a.target_user_id ? ` vs user ${a.target_user_id}` : ' (open)'}`
    case 'buy': return `buy ${a.product}${a.quantity ? ` x${a.quantity}` : ''}${a.player_nonces ? ` for ${a.player_nonces.map(n => `#${n}`).join(',')}` : ''}`
    case 'claim_refund': return `claim refund T${a.tournament_id}`
    case 'fuse': return `fuse ${a.player_nonces.map(n => `#${n}`).join(',')} (position of #${a.player_nonces[a.position_of]})`
    case 'bid': return `bid ${a.foxsy} FOXSY on #${a.nonce}`
    case 'list_card': return `list #${a.nonce} at auction, reserve ${a.reserve_foxsy} FOXSY`
    case 'cancel_listing': return `cancel the auction of #${a.nonce}`
    case 'fusion_cooldown_waiver': return `shorten the fusion cooldown of #${a.nonce}`
    case 'fusion_match_waiver': return `buy ${a.matches} fusion match credit${a.matches > 1 ? 's' : ''} for #${a.nonce}`
  }
}
