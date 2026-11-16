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

/** `medicine` (FoxLeague, with the injuries): whole days off one injured card's time out; paid like the others, confirmed on its own route. */
export const SHOP_PRODUCTS = ['condition_recovery', 'xp_booster', 'training_slot', 'common_pack', 'medicine'] as const
export type ShopProduct = (typeof SHOP_PRODUCTS)[number]

export type Action =
  | { type: 'swap_egld_for_foxsy'; foxsy: number }
  | { type: 'register'; team_name: string }
  | { type: 'sync'; nonce?: number }
  | { type: 'train'; player_nonce: number; attribute: Stat }
  /** With `lineup` and `substitutes` (in the new formation's slot order) the eleven is saved right after the formation. */
  | { type: 'set_formation'; formation: string; lineup?: number[]; substitutes?: number[] }
  | { type: 'set_lineup'; lineup: number[]; substitutes: number[] }
  /**
   * With `test` (casual only, owner 2026-11-04): the formation, eleven and bench of a test, saved for the start and the
   * team's own put back right after it (FoxLeague plays a casual game with what was saved at its start).
   */
  | { type: 'play_match'; match_type: 'casual' | 'ranked'; test?: { formation: string; lineup: number[]; substitutes: number[] } }
  | { type: 'join_tournament'; tournament_id: number }
  | { type: 'leave_tournament'; tournament_id: number }
  /** Widen the OVR range of the agent's own open tournament or challenge (null removes a bound); nothing is paid. */
  | { type: 'widen_range'; tournament_id: number; ovr_min?: number | null; ovr_max?: number | null }
  | {
      type: 'create_tournament'
      title: string
      format: 'knockout' | 'round_robin' | 'swiss' | 'groups_knockout'
      tier: 'bronze' | 'silver' | 'gold'
      max_teams: number
      min_teams: number
      entry_fee_foxsy: number
      /**
       * The start, one of two forms (createStartMs): `starts_at`, a whole UTC minute in ISO form (2026-11-15, so a narrow
       * gap of FoxLeague's calendar can be used), or `starts_in_hours`, whole hours from when the create runs (the first form).
       */
      starts_at?: string
      starts_in_hours?: number
      registration_closes_minutes_before: number
      round_interval_minutes: number
      home_and_away?: boolean
      /** Teams invited (their user ids): a non-empty list makes it private (every level since 2026-11-06). */
      invite_user_ids?: number[]
      /** An optional OVR range (FoxLeague, 2026-10-24): only teams whose best XI OVR is inside may join. */
      ovr_min?: number
      ovr_max?: number
    }
  | { type: 'create_challenge'; tier: 'silver' | 'gold'; stake_foxsy: number; target_user_id: number | null; deadline_minutes: 30 | 60 | 120 | 240; ovr_min?: number; ovr_max?: number }
  | { type: 'buy'; product: ShopProduct; player_nonces?: number[]; quantity?: number }
  | { type: 'claim_refund'; tournament_id: number }
  /** Three cards of one rarity into one of the next; the output takes the position of player_nonces[position_of]. */
  | { type: 'fuse'; player_nonces: number[]; position_of: 0 | 1 | 2 }
  /** max_foxsy: a ceiling; when the minimum has moved past `foxsy` since the plan, the executor bids the fresh minimum up to it (P2). */
  | { type: 'bid'; nonce: number; foxsy: number; max_foxsy?: number }
  | { type: 'list_card'; nonce: number; reserve_foxsy: number }
  | { type: 'cancel_listing'; nonce: number }
  /**
   * Shortens a fused card's 14-day fusion cooldown (75 FOXSY per waived day): to the 3-day floor, or by `days` of
   * the waivable days only (since 2026-10-12).
   */
  | { type: 'fusion_cooldown_waiver'; nonce: number; days?: number }
  /**
   * Buys competitive-match credit toward the match gate of the card's rarity (since 2026-10-12: Uncommon 20 FOXSY a
   * match, Rare to Legendary 100; a Common has no waiver; the floor of each gate must really be played).
   */
  | { type: 'fusion_match_waiver'; nonce: number; matches: number }

export type ActionType = Action['type']

export interface PlannedAction {
  action: Action
  /** The strategist's one-line reason, kept in the activity log. */
  reason: string
  /** Set only by the service for the owner's own requests (web UI Leave, Telegram /do JSON); never from a plan. */
  byOwner?: true
  /** One of several smaller actions an extension made from one (see src/extensions.ts); never from a plan. */
  piece?: { group: number; index: number; of: number }
  /** The private platform fee the plan's own snapshot showed. Set only by the service after the plan; never from a plan. */
  planPlatformFeePercent?: number
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

function userIds(o: Record<string, unknown>, k: string, min: number, max: number): number[] {
  const v = o[k]
  if (!Array.isArray(v) || v.length < min || v.length > max) throw new ParseError(`${k} must be a list of ${min}..${max} user ids`)
  for (const n of v) if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) throw new ParseError(`${k} holds a bad user id`)
  if (new Set(v).size !== v.length) throw new ParseError(`${k} holds a user id twice`)
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
      // One card (10 FOXSY) instead of every dirty card; validated like every other card nonce.
      return { type: o.type, ...(o.nonce === undefined || o.nonce === null ? {} : { nonce: int(o, 'nonce', 1, 2 ** 40) }) }
    case 'train':
      return { type: o.type, player_nonce: int(o, 'player_nonce', 1, 2 ** 40), attribute: oneOf(o, 'attribute', STATS) }
    case 'set_formation': {
      const formation = oneOf(o, 'formation', Object.keys(FORMATION_SLOTS).filter(f => !FORMATIONS_COMING_SOON.has(f)))
      if (o.lineup === undefined && o.substitutes === undefined) return { type: o.type, formation }
      // The eleven a new shape needs travels with it: both or neither.
      return { type: o.type, formation, lineup: nonces(o, 'lineup', 11, 11), substitutes: nonces(o, 'substitutes', 0, 7) }
    }
    case 'set_lineup':
      return { type: o.type, lineup: nonces(o, 'lineup', 11, 11), substitutes: nonces(o, 'substitutes', 0, 7) }
    case 'play_match': {
      const match_type = oneOf(o, 'match_type', ['casual', 'ranked'] as const)
      if (o.test === undefined) return { type: o.type, match_type }
      if (match_type !== 'casual') throw new ParseError('test: only a casual game carries a test formation')
      if (typeof o.test !== 'object' || o.test === null || Array.isArray(o.test)) throw new ParseError('test must be an object with formation, lineup and substitutes')
      const t = o.test as Record<string, unknown>
      const formation = oneOf(t, 'formation', Object.keys(FORMATION_SLOTS).filter(f => !FORMATIONS_COMING_SOON.has(f)))
      return { type: o.type, match_type, test: { formation, lineup: nonces(t, 'lineup', 11, 11), substitutes: nonces(t, 'substitutes', 0, 7) } }
    }
    case 'join_tournament':
    case 'leave_tournament':
    case 'claim_refund':
      return { type: o.type, tournament_id: int(o, 'tournament_id', 1, 2 ** 40) }
    case 'widen_range': {
      // A side left out keeps its bound, null removes it (FoxLeague's body); at least one side.
      if (!('ovr_min' in o) && !('ovr_max' in o)) throw new ParseError('widen_range needs ovr_min or ovr_max')
      const side = (k: 'ovr_min' | 'ovr_max') => (!(k in o) ? {} : o[k] === null ? { [k]: null } : { [k]: int(o, k, 1, 100) })
      return { type: o.type, tournament_id: int(o, 'tournament_id', 1, 2 ** 40), ...side('ovr_min'), ...side('ovr_max') }
    }
    case 'create_tournament': {
      const format = oneOf(o, 'format', ['knockout', 'round_robin', 'swiss', 'groups_knockout'] as const)
      const title = str(o, 'title', /^[\p{L}\p{N} .,!?'&()-]{3,60}$/u, '3-60 plain characters')
      // Fair Play, as for a team name: every player reads the title under the owner's team (ATTACK-7).
      if (IMPERSONATION.test(title)) throw new ParseError('title must not imitate FoxLeague, FOXSY or its staff')
      return {
        type: o.type,
        title,
        format,
        tier: oneOf(o, 'tier', ['bronze', 'silver', 'gold'] as const),
        max_teams: int(o, 'max_teams', 3, 64),
        min_teams: int(o, 'min_teams', 2, 64),
        entry_fee_foxsy: int(o, 'entry_fee_foxsy', 1, 1_000_000),
        ...createStart(o),
        registration_closes_minutes_before: int(o, 'registration_closes_minutes_before', 10, 24 * 60),
        round_interval_minutes: int(o, 'round_interval_minutes', 30, 1440),
        ...(o.home_and_away === true && format === 'round_robin' ? { home_and_away: true } : {}),
        ...(Array.isArray(o.invite_user_ids) && o.invite_user_ids.length ? { invite_user_ids: userIds(o, 'invite_user_ids', 1, 63) } : {}),
        ...ovrRange(o),
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
        ...ovrRange(o),
      }
    }
    case 'buy': {
      const product = oneOf(o, 'product', SHOP_PRODUCTS)
      if (product === 'condition_recovery') return { type: o.type, product, player_nonces: nonces(o, 'player_nonces', 1, 18) }
      if (product === 'training_slot') return { type: o.type, product, quantity: int(o, 'quantity', 1, 25) }
      // One card, 1 to 18 days: two thirds of the longest injury (27 days) is the most FoxLeague sells.
      if (product === 'medicine') return { type: o.type, product, player_nonces: nonces(o, 'player_nonces', 1, 1), quantity: int(o, 'quantity', 1, 18) }
      return { type: o.type, product }
    }
    case 'fuse':
      return { type: o.type, player_nonces: nonces(o, 'player_nonces', 3, 3), position_of: oneOf(o, 'position_of', [0, 1, 2] as const) }
    case 'bid': {
      const foxsy = int(o, 'foxsy', 1, 1_000_000)
      if (o.max_foxsy === undefined || o.max_foxsy === null) return { type: o.type, nonce: int(o, 'nonce', 1, 2 ** 40), foxsy }
      return { type: o.type, nonce: int(o, 'nonce', 1, 2 ** 40), foxsy, max_foxsy: int(o, 'max_foxsy', foxsy, 1_000_000) }
    }
    case 'list_card':
      return { type: o.type, nonce: int(o, 'nonce', 1, 2 ** 40), reserve_foxsy: int(o, 'reserve_foxsy', 1, 1_000_000) }
    case 'cancel_listing':
      return { type: o.type, nonce: int(o, 'nonce', 1, 2 ** 40) }
    case 'fusion_cooldown_waiver':
      return { type: o.type, nonce: int(o, 'nonce', 1, 2 ** 40), ...(o.days === undefined || o.days === null ? {} : { days: int(o, 'days', 1, 60) }) }
    case 'fusion_match_waiver':
      // The largest waivable part of a gate: a Legendary's 405 minus the 135 it must really play.
      return { type: o.type, nonce: int(o, 'nonce', 1, 2 ** 40), matches: int(o, 'matches', 1, 270) }
    default:
      throw new ParseError(`unknown action type '${String(o.type)}'`)
  }
}

/** An optional OVR range on a create: whole numbers 1 to 100, the minimum not above the maximum (FoxLeague's rule). */
function ovrRange(o: Record<string, unknown>): { ovr_min?: number; ovr_max?: number } {
  const lo = o.ovr_min === undefined || o.ovr_min === null ? undefined : int(o, 'ovr_min', 1, 100)
  const hi = o.ovr_max === undefined || o.ovr_max === null ? undefined : int(o, 'ovr_max', 1, 100)
  if (lo !== undefined && hi !== undefined && lo > hi) throw new ParseError('the minimum OVR cannot be above the maximum')
  return { ...(lo !== undefined ? { ovr_min: lo } : {}), ...(hi !== undefined ? { ovr_max: hi } : {}) }
}

/**
 * A create's start is at least 2 hours and at most 14 days after the create runs (the rules check it then). FoxLeague
 * takes a start up to 90 days ahead; 14 days is the owner's choice (16 Nov 2026, P-O1), the most its calendar of free
 * starts answers in one read.
 */
export const CREATE_START_MIN_MS = 2 * 3600_000
export const CREATE_START_MAX_MS = 14 * 86_400_000
const CREATE_START_MAX_HOURS = CREATE_START_MAX_MS / 3600_000

/** A whole UTC minute: `2026-11-17T19:49Z`, with `:00` or `:00.000` seconds allowed; no other zone, no other second. */
const UTC_MINUTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::00(?:\.0{1,3})?)?Z$/
const START_FORM = `starts_at must be a UTC minute such as 2026-11-17T19:49Z (or starts_in_hours, whole hours 2 to ${CREATE_START_MAX_HOURS})`

/** The ms of a UTC minute in that form, or null: a day or an hour Date.parse would roll over (30 February, 24:00) is none. */
function utcMinuteMs(v: unknown): number | null {
  if (typeof v !== 'string' || !UTC_MINUTE.test(v)) return null
  const ms = Date.parse(v)
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 16) === v.slice(0, 16) ? ms : null
}

/**
 * A create's start, in one of its two forms (A tournament start to the minute, 2026-11-15). `starts_at` names the minute
 * itself, so the start FoxLeague is sent does not move with the moment the action runs (up to most of a tick after the
 * plan); FoxLeague takes any instant and rounds nothing. Whether it is 2 hours to 14 days ahead depends on when the
 * create runs: the rules check it then. A day or hour Date.parse would roll over (30 February, 24:00) is refused, as is
 * any second but :00. `starts_in_hours` keeps its bounds here, the same 2 hours to 14 days.
 */
function createStart(o: Record<string, unknown>): { starts_at: string } | { starts_in_hours: number } {
  const hours = o.starts_in_hours !== undefined && o.starts_in_hours !== null
  const at = o.starts_at !== undefined && o.starts_at !== null
  if (hours && at) throw new ParseError('starts_at or starts_in_hours, not both')
  if (hours) return { starts_in_hours: int(o, 'starts_in_hours', 2, CREATE_START_MAX_HOURS) }
  const ms = utcMinuteMs(o.starts_at)
  if (ms === null) throw new ParseError(START_FORM)
  return { starts_at: new Date(ms).toISOString() }
}

/**
 * When a create's tournament starts, in ms: its `starts_at`, or `now` (the moment the rules check it) plus its whole
 * hours. Null when it cannot be read: neither form, both, or a time that is none (an action not built by parseAction);
 * the rules then refuse it.
 */
export function createStartMs(a: { starts_at?: unknown; starts_in_hours?: unknown }, now: number): number | null {
  const at = a.starts_at !== undefined && a.starts_at !== null
  const hours = a.starts_in_hours !== undefined && a.starts_in_hours !== null
  if (at === hours) return null
  if (at) return utcMinuteMs(a.starts_at)
  return typeof a.starts_in_hours === 'number' && Number.isFinite(a.starts_in_hours) ? now + a.starts_in_hours * 3600_000 : null
}

/** The range in FoxLeague's words: "30 to 40", "at most 35", "at least 30". */
export function rangeWords(lo: number | undefined, hi: number | undefined): string {
  return lo !== undefined && hi !== undefined ? (lo === hi ? `exactly ${lo}` : `${lo} to ${hi}`) : hi !== undefined ? `at most ${hi}` : lo !== undefined ? `at least ${lo}` : 'any'
}

export function describeAction(a: Action): string {
  switch (a.type) {
    case 'swap_egld_for_foxsy': return `swap EGLD for ${a.foxsy} FOXSY`
    case 'register': return `register team "${a.team_name}"`
    case 'sync': return a.nonce === undefined ? 'sync dirty cards to chain' : `sync #${a.nonce} to chain`
    case 'train': return `train #${a.player_nonce} ${a.attribute}`
    case 'set_formation': return `formation ${a.formation}${a.lineup ? ` with lineup ${a.lineup.join(',')} | bench ${(a.substitutes ?? []).join(',')}` : ''}`
    case 'set_lineup': return `lineup ${a.lineup.join(',')} | bench ${a.substitutes.join(',')}`
    case 'play_match': return `play ${a.match_type} match${a.test ? ` (test ${a.test.formation}: lineup ${a.test.lineup.join(',')} | bench ${a.test.substitutes.join(',')})` : ''}`
    case 'join_tournament': return `join tournament T${a.tournament_id}`
    case 'leave_tournament': return `leave tournament T${a.tournament_id}`
    case 'widen_range': return `widen the OVR range of T${a.tournament_id}${a.ovr_min !== undefined ? `, minimum ${a.ovr_min ?? 'none'}` : ''}${a.ovr_max !== undefined ? `, maximum ${a.ovr_max ?? 'none'}` : ''}`
    case 'create_tournament': return `create ${a.invite_user_ids?.length ? `private (${a.invite_user_ids.length} invited) ` : ''}${a.tier} ${a.format} "${a.title}" ${a.min_teams}-${a.max_teams} teams, fee ${a.entry_fee_foxsy}, ${a.starts_at !== undefined ? `starts ${String(a.starts_at).slice(0, 16).replace('T', ' ')} UTC` : `starts in ${a.starts_in_hours} h`}${a.ovr_min !== undefined || a.ovr_max !== undefined ? `, OVR ${rangeWords(a.ovr_min, a.ovr_max)}` : ''}`
    case 'create_challenge': return `create ${a.tier} 1v1, stake ${a.stake_foxsy}${a.target_user_id ? ` vs user ${a.target_user_id}` : ' (open)'}${a.ovr_min !== undefined || a.ovr_max !== undefined ? `, OVR ${rangeWords(a.ovr_min, a.ovr_max)}` : ''}`
    case 'buy': return `buy ${a.product}${a.quantity ? ` x${a.quantity}` : ''}${a.player_nonces ? ` for ${a.player_nonces.map(n => `#${n}`).join(',')}` : ''}`
    case 'claim_refund': return `claim refund T${a.tournament_id}`
    case 'fuse': return `fuse ${a.player_nonces.map(n => `#${n}`).join(',')} (position of #${a.player_nonces[a.position_of]})`
    case 'bid': return `bid ${a.foxsy} FOXSY${a.max_foxsy !== undefined ? ` (up to ${a.max_foxsy})` : ''} on #${a.nonce}`
    case 'list_card': return `list #${a.nonce} at auction, reserve ${a.reserve_foxsy} FOXSY`
    case 'cancel_listing': return `cancel the auction of #${a.nonce}`
    case 'fusion_cooldown_waiver': return a.days ? `shorten the fusion cooldown of #${a.nonce} by ${a.days} day${a.days > 1 ? 's' : ''}` : `shorten the fusion cooldown of #${a.nonce} to the 3-day floor`
    case 'fusion_match_waiver': return `buy ${a.matches} fusion match credit${a.matches > 1 ? 's' : ''} for #${a.nonce}`
  }
}
