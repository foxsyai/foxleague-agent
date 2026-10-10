// Game gates checked locally before anything is built or sent, from the snapshot (the server stays
// the final judge; these keep the agent from sending what the interface would refuse, and from
// paying for something that cannot work). Every number is read live where a public source exists.

import { blockingWindow, clash, firstFreeStartHours } from './slots.ts'
import { percent, winChance } from '../snapshot/winchance.ts'
import type { Action } from './actions.ts'
import { FORMATION_SLOTS } from './actions.ts'
import type { AgentSnapshot, PlayerView } from '../snapshot/snapshot.ts'
import type { CanFuse, CanList, Tournament, TournamentDetail } from '../foxleague/types.ts'
import { RARITY_LEVEL, type Auction } from '../chain/players.ts'
import type { AgentSettings } from '../store/settings.ts'
import { wholeToAtomic } from '../util/encoding.ts'
import type { SpendCategory } from '../store/db.ts'

export interface Verdict {
  ok: boolean
  refusal?: string
  /** FOXSY (atomic) this action pays out of the wallet. */
  foxsy: bigint
  category: SpendCategory
  /** Facts the executor needs to build the call (fee, sc id, product price...). */
  facts: Record<string, unknown>
  notes: string[]
}

export interface RulesContext {
  settings: AgentSettings
  /** Fresh tournament detail, fetched by the executor for join and refund checks. */
  tournament?: TournamentDetail | null
  /** Last match starts recorded by this agent (the cooldowns are not public). */
  lastMatchStartAt?: Date | null
  lastRankedStartAt?: Date | null
  /** Escrow the tournaments contract holds for this wallet (view getEntryAmount), for refund claims. */
  entryAmount?: bigint
  /** Fusion pre-check (GET /api/fusion/can-fuse) and the pool stock of the output, fetched for fuse. */
  canFuse?: CanFuse | null
  fusionPool?: number
  /** The card's live auction (view getAuction), fetched for bid and cancel_listing. */
  auction?: Auction | null
  /** Listing pre-check and the current floor of the card's rarity (0 when none is listed), fetched for list_card; null = unavailable. */
  canList?: CanList | null
  floorPrice?: number | null
  /** The other side of a 1v1 (joined or created): its ELO and lineup strength at full condition, null when unreadable. */
  opponent?: { userId: number; elo: number | null; strength?: number | null }
  /** The agent plays at the Zeus level: a 1v1 needs a good win chance, a tournament a chance of the top three. */
  zeus?: boolean
  /** FoxLeague user ids of the owner's other agents: never invited to a private tournament (the AI is not told). */
  ownUserIds?: number[]
  /** For a Zeus join of a standard tournament: each seated team's lineup strength and ELO, null when unread. */
  field?: { userId: number; strength: number | null; elo: number | null }[]
  /** 1v1s this agent already played or entered against that opponent in the last 7 days. */
  oneVOneWithOpponentThisWeek?: number
  /** Open 1v1 challenges this agent created in the last 24 hours. */
  openChallengesToday?: number
  /**
   * The action is one piece of a larger one (see src/extensions.ts). A match waiver piece may buy part of what is
   * missing; the first piece checks the whole group (exactly the missing matches, within the max shop payment).
   */
  piece?: { index: number; of: number }
  /** The rarity of the card at auction (its FoxLeague player record). */
  cardRarity?: string
  /** Bids this agent already placed on the same auction in the last 48 hours. */
  priorBids?: number
  /** Shop products whose payment is still waiting for FoxLeague's confirmation. */
  pendingShop?: Set<string>
  /** A seat in this tournament is paid and waiting for FoxLeague's confirmation (retried with the same hash). */
  pendingJoin?: boolean
  /** Fusion waiver quotes, fetched for the waiver actions; null = unreadable. */
  cooldownQuote?: { days: number; costAtomic: bigint } | null
  matchQuote?: { max_purchasable: number; chain_played: number; credit: number; price_wei: string } | null
  /** A transfer lock the card at auction carries (inherited by the buyer); null = its details could not be read. */
  cardLock?: { until: Date | null } | null
  now: Date
}

const refuse = (refusal: string, category: SpendCategory = 'play'): Verdict => ({ ok: false, refusal, foxsy: 0n, category, facts: {}, notes: [] })
const allow = (foxsyWhole: number | bigint, facts: Record<string, unknown> = {}, category: SpendCategory = 'play', notes: string[] = []): Verdict => ({
  ok: true,
  foxsy: typeof foxsyWhole === 'bigint' ? foxsyWhole : wholeToAtomic(foxsyWhole),
  category,
  facts,
  notes,
})

function card(s: AgentSnapshot, nonce: number): PlayerView | undefined {
  return s.players.find(p => p.nonce === nonce)
}

/** Unrevealed tournament or 1v1 match of ours within the next hour (casual/ranked lockout, 1v1 accept gate). */
function tournamentMatchWithinHour(s: AgentSnapshot, now: Date): string | null {
  for (const m of s.auth?.upcoming?.matches ?? []) {
    if (m.phase === 'finished') continue
    const at = new Date(m.scheduled_at).getTime()
    if (at - now.getTime() <= 3600_000 && at + 15 * 60_000 > now.getTime()) return `T${m.tournament_id} match at ${m.scheduled_at}`
  }
  return null
}

/** Effective tier bounds (Silver top is min(silver_max, gold_min - 1), docs 10.1). */
export function tierBounds(s: AgentSnapshot, tier: 'silver' | 'gold'): [number, number] | null {
  const b = s.config?.tournament_fee_bounds
  if (!b) return null
  return tier === 'silver' ? [b.silver_min, Math.min(b.silver_max, b.gold_min - 1)] : [b.gold_min, Number.MAX_SAFE_INTEGER]
}

const VALID_SIZES: Record<string, (n: number) => boolean> = {
  knockout: n => [4, 8, 16, 32].includes(n),
  groups_knockout: n => [8, 16, 32, 64].includes(n),
  round_robin: n => n >= 3 && n <= 20,
  swiss: n => n >= 3 && n <= 32,
}

/** Largest size worth creating: what recently filled plus a margin (README: 16-20 is the norm, not 64). */
export function sizeCeiling(s: AgentSnapshot): number {
  const seated = s.market.recentStandard.filter(t => t.status === 'completed').map(t => t.seated)
  const best = seated.length ? Math.max(...seated) : 0
  return Math.max(8, Math.ceil(best * 1.25))
}

// Hard limits from the adversarial review (test/audit.test.ts), independent of what the model proposes.
/** A 1v1 is refused against a team this many ELO points (or more) above the agent. */
export const MAX_1V1_ELO_GAP = 100
/** A 1v1 is refused when the rival's lineup (at full condition) is more than this much stronger than ours today. */
export const MAX_1V1_STRENGTH_RATIO = 1.1
export const MAX_1V1_PER_OPPONENT_WEEK = 2
/**
 * Open 1v1 challenges (anyone may take them, a stronger team too): Silver only, at the owner's lowest Silver
 * amount, at most this many in 24 hours. They get games played when no targeted opponent answers.
 */
export const MAX_OPEN_1V1_PER_DAY = 1
export const MAX_BIDS_PER_AUCTION = 2

/**
 * What a card of a rarity costs from Common packs and fusion fees alone, at FoxLeague's live prices: 3^n Commons
 * at a fifth of a pack each plus every fusion fee on the way up (Rare 5,000, Epic 15,400, Legendary 47,000 in
 * October 2026). A bid above it pays more than building the card; null when the prices are unknown.
 */
export function packAndFusionCost(cfg: { common_pack_price_foxsy?: number; fusion_costs_foxsy?: number[] } | null | undefined, rarity: string): number | null {
  const level = (RARITY_LEVEL as Record<string, number>)[rarity]
  const pack = cfg?.common_pack_price_foxsy
  const fees = cfg?.fusion_costs_foxsy
  if (level === undefined || !pack || pack <= 0 || !Array.isArray(fees) || fees.length < level) return null
  let cost = pack / 5
  for (let i = 0; i < level; i++) cost = 3 * cost + fees[i]!
  return Math.round(cost)
}
/** Hours of transfer lock a card bought at auction may still carry. */
export const MAX_INHERITED_LOCK_HOURS = 72
/** Lowest reserve per rarity, whatever the floor says (one junk listing can drag the floor to 500). */
export const MIN_RESERVE_FOXSY: Record<string, number> = { Common: 500, Uncommon: 1500, Rare: 4000, Epic: 10000, Legendary: 25000 }
/** The strongest cards (by synced total) are the squad's core and never sold. */
export const CORE_CARDS = 18

const NEXT_RARITY = ['Uncommon', 'Rare', 'Epic', 'Legendary'] as const

/** Matches one team may play in a tournament at most (it goes all the way), by format and size. */
export function matchesAtMost(format: string, maxTeams: number, homeAndAway: boolean, groupSize = 4): number {
  const rounds = (n: number) => Math.ceil(Math.log2(Math.max(2, n)))
  switch (format) {
    case 'knockout':
      return rounds(maxTeams)
    case 'groups_knockout':
      return groupSize - 1 + rounds((maxTeams / groupSize) * 2) // groups of 4, the top 2 of each advance
    case 'round_robin':
      return (maxTeams - 1) * (homeAndAway ? 2 : 1)
    case 'swiss':
      return rounds(maxTeams) + 1
    default:
      return maxTeams - 1
  }
}

/**
 * Refuses a tournament whose schedule would wear the squad below the playable condition: every
 * appearance costs 11 starters the match loss, against the squad's condition above the floor plus
 * what it regenerates between rounds (half the rate after age 30). Matches the squad already owes to
 * tournaments it sits in, when their play overlaps, count too: two tournaments at the same hour each
 * look fine alone. Needs the snapshot's team and the agent's tournaments (unreadable = refused).
 */
function scheduleRefusal(
  s: AgentSnapshot,
  t: { id?: number; format: string; max_teams: number; home_and_away?: boolean; round_interval_minutes?: number | null; starts_at: string },
): string | null {
  const cfg = s.config
  if (!cfg || !s.team) return null
  const groupSize = cfg.tournament_defaults?.groups_knockout_group_size ?? 4
  const own = matchesAtMost(t.format, t.max_teams, Boolean(t.home_and_away), groupSize)
  const interval = t.round_interval_minutes ?? 30
  const start = new Date(t.starts_at).getTime()
  const end = start + (own - 1) * interval * 60_000
  const mine = s.auth?.myTournaments
  if (!mine) return 'your current tournaments could not be read: not taking on another schedule blind'
  let owed = 0
  for (const x of mine.active) {
    if (x.id === t.id || x.max_teams === 2) continue
    const total = matchesAtMost(x.format, x.max_teams, Boolean(x.home_and_away), groupSize)
    const xStart = new Date(x.starts_at).getTime()
    const xEnd = xStart + (total - 1) * (x.round_interval_minutes ?? 30) * 60_000
    if (xEnd < start || xStart > end) continue
    // Started: the fixtures still to play are known; not started: the most its format can bring.
    const left = (s.auth?.upcoming?.matches ?? []).filter(m => m.tournament_id === x.id && m.phase !== 'finished').length
    owed += x.started_at ? Math.max(1, left) : total
  }
  const matches = own + owed
  if (matches <= 1) return null
  const hours = ((own - 1) * interval) / 60
  const floor = cfg.min_field_condition ?? 30
  const loss = cfg.condition_loss_per_match ?? 10
  const regenPerHour = (cfg.condition_regen_points_per_day ?? 48) / 24
  const squad = [...s.team.lineup, ...s.team.substitutes].map(n => card(s, n)).filter((p): p is PlayerView => Boolean(p))
  const available = squad.reduce((sum, p) => sum + Math.max(0, p.condition - floor) + (p.ageYears > 30 ? regenPerHour / 2 : regenPerHour) * hours, 0)
  const needed = matches * 11 * loss
  if (needed <= available) return null
  const also = owed ? ` (${own} here plus ${owed} still owed to your other tournaments at the same time)` : ''
  return `the schedule would wear the squad down: up to ${matches} matches${also} about every ${interval} min need ~${needed} condition, the squad has ~${Math.round(available)} above ${floor} with recovery`
}

/**
 * Lineup strength as the match engine sees it: synced stats scaled by condition, stat x (50 +
 * condition/2) / 100, summed over the starting eleven. A rival's squad is taken at full condition
 * (it can rest or buy recovery before the match).
 */
export function lineupStrength(s: AgentSnapshot): number {
  return (s.team?.lineup ?? []).reduce((sum, n) => {
    const p = card(s, n)
    return sum + (p ? (p.syncedTotal * (50 + p.condition / 2)) / 100 : 0)
  }, 0)
}

/** A Zeus 1v1 needs at least this win chance; a seated team is clearly stronger with both margins below. */
export const ZEUS_MIN_1V1_CHANCE = 0.55
const ZEUS_STRONGER_SQUAD = 1.05
const ZEUS_STRONGER_ELO = 50

/** The 1v1 gates both join and create share: a known, not stronger opponent, not farmed every day. */
function oneVOneOpponentRefusal(s: AgentSnapshot, ctx: RulesContext): string | null {
  const opp = ctx.opponent
  if (!opp || opp.elo === null) return "the opponent's strength could not be read"
  const mine = s.profile?.elo_rating ?? 1200
  if (opp.elo - mine >= MAX_1V1_ELO_GAP) return `the opponent is far stronger (ELO ${opp.elo} vs ${mine})`
  // ELO alone is the one number a rival controls (new teams start at 1200): compare the squads too.
  if (opp.strength === null || opp.strength === undefined) return "the opponent's squad could not be read"
  const ours = lineupStrength(s)
  if (opp.strength > ours * MAX_1V1_STRENGTH_RATIO) return `the opponent's squad is stronger (lineup strength ${Math.round(opp.strength)} vs ours ${Math.round(ours)} at today's condition)`
  if ((ctx.oneVOneWithOpponentThisWeek ?? 0) >= MAX_1V1_PER_OPPONENT_WEEK) return `already ${MAX_1V1_PER_OPPONENT_WEEK} 1v1s against user ${opp.userId} in the last 7 days`
  if (ctx.zeus) {
    const p = winChance({ myElo: mine, oppElo: opp.elo, myStrength: ours || null, oppStrength: opp.strength })
    if (p !== null && p < ZEUS_MIN_1V1_CHANCE) return `the win chance against user ${opp.userId} is about ${percent(p)}; Zeus plays a 1v1 from ${percent(ZEUS_MIN_1V1_CHANCE)}`
  }
  return null
}
/**
 * Why no fusion with this card could happen soon, or null: three cards of its rarity (not Legendary, not
 * listed, not in a transfer lock) and at least 18 cards left after it. Waivers are bought only then.
 */
function fusionBlocked(s: AgentSnapshot, c: PlayerView): string | null {
  if (c.rarity === 'Legendary') return 'a Legendary cannot be fused'
  const peers = s.players.filter(p => p.rarity === c.rarity && !p.listed && !p.transferLockedUntil)
  if (peers.length < 3) return `only ${peers.length} ${c.rarity} card${peers.length === 1 ? '' : 's'} free for fusion, 3 are needed`
  const left = s.players.filter(p => !p.listed).length - 2
  if (left < 18) return `a fusion would leave ${left} cards and a match needs 18: get spare cards first`
  return null
}

/** Contract floor: 5 competitive matches must really be played per fusion input or listed card. */
const PLAYED_FLOOR = 5

/**
 * The agent's own team could not be read (FoxLeague answered without its lineup, or not at all). Nothing that
 * depends on who plays may run blind: no lineup or formation change, no match, and no card leaves the squad.
 */
const TEAM_UNREADABLE = 'the team could not be read (lineup and bench unknown): not acting blind'

function inSquad(s: AgentSnapshot, nonce: number): boolean {
  return Boolean(s.team && (s.team.lineup.includes(nonce) || s.team.substitutes.includes(nonce)))
}

function canFuseReason(c: CanFuse): string {
  if (c.cooldown_remaining) return `wallet fusion cooldown, ${Math.ceil(c.cooldown_remaining / 3600)} h left${c.cooldown_end ? ` (until ${c.cooldown_end})` : ''}`
  const who = (c.dirty_players ?? c.blocked_players ?? []).map(n => `#${n}`).join(', ')
  return `${c.reason ?? 'not fusable'}${who ? ` (${who})` : ''}`
}

function squadLegal(s: AgentSnapshot): string | null {
  if (!s.team) return 'no team'
  if (s.team.lineup.length !== 11) return 'lineup does not have 11 players'
  if (s.team.substitutes.length !== 7) return `bench has ${s.team.substitutes.length}/7 substitutes`
  for (const n of [...s.team.lineup, ...s.team.substitutes]) {
    const p = card(s, n)
    if (!p) return `#${n} in the squad is not in the wallet`
    if (p.listed) return `#${n} is listed for sale`
    if (p.transferLockedUntil) return `#${n} is in a transfer cooldown until ${p.transferLockedUntil}`
  }
  return null
}

function lineupPositionsOk(s: AgentSnapshot, formation: string, lineup: number[]): string | null {
  const slots = FORMATION_SLOTS[formation]
  if (!slots) return `unknown formation ${formation}`
  const expected = ['GK', ...Array(slots.DEF).fill('DEF'), ...Array(slots.MID).fill('MID'), ...Array(slots.FWD).fill('FWD')]
  for (let i = 0; i < 11; i++) {
    const p = card(s, lineup[i]!)
    if (!p) return `#${lineup[i]} is not in the wallet`
    if (p.position !== expected[i]) return `slot ${i} of ${formation} wants a ${expected[i]}, #${p.nonce} is a ${p.position}`
  }
  return null
}

export function checkAction(a: Action, s: AgentSnapshot, ctx: RulesContext): Verdict {
  const cfg = s.config
  const registered = s.registration.registered
  const foxsyBal = s.chain?.foxsy ?? 0n
  if (!cfg) return refuse('live config unavailable (GET /api/config failed): refusing to act blind')

  const needFoxsy = (whole: number, v: Verdict): Verdict =>
    v.ok && foxsyBal < wholeToAtomic(whole) ? { ...v, ok: false, refusal: `needs ${whole} FOXSY, wallet holds less (swap first)` } : v

  switch (a.type) {
    case 'swap_egld_for_foxsy': {
      if (!cfg.dex_swap_enabled) return refuse('the FoxLeague swap is switched off (dex_swap_enabled false)')
      const max = Math.min(ctx.settings.maxSwapFoxsy, typeof cfg.dex_swap_max_foxsy === 'number' ? cfg.dex_swap_max_foxsy : 50_000)
      if (a.foxsy > max) return refuse(`swap of ${a.foxsy} FOXSY exceeds the per-swap limit ${max}`)
      return allow(0, { foxsyOut: wholeToAtomic(a.foxsy), slippageBps: cfg.dex_swap_slippage_bps }, registered ? 'play' : 'setup')
    }

    case 'register': {
      const r = s.registration
      if (r.registered) return refuse('already registered', 'setup')
      if (r.whitelisted === false) return refuse('wallet not whitelisted (registration.whitelist_required is on)', 'setup')
      if (!r.relayerEnabled) return refuse('registration relayer is off', 'setup')
      if ((r.relaysRemaining ?? 0) <= 0) return refuse('relayer daily cap reached', 'setup')
      if ((r.starterStock ?? 0) < 18) return refuse('starter squads out of stock', 'setup')
      if (r.feePaidOnChain) return allow(0, { feePaid: true }, 'setup', ['fee already paid on chain: only POST /api/register'])
      const fee = BigInt(cfg.registration_fee_wei)
      if (cfg.registration_fee_foxsy_wei && BigInt(cfg.registration_fee_foxsy_wei) !== fee) return refuse('registration fee misconfigured (contract and relay disagree)', 'setup')
      if (foxsyBal < fee) return refuse(`needs ${cfg.registration_fee_foxsy} FOXSY for the fee (swap first)`, 'setup')
      return allow(fee, { feeAtomic: fee }, 'setup')
    }

    case 'sync': {
      if (!registered) return refuse('not registered')
      const dirty = s.players.filter(p => p.dirty && !p.listed && (a.nonce === undefined || p.nonce === a.nonce))
      if (!dirty.length) return refuse(a.nonce === undefined ? 'no dirty cards to sync' : `#${a.nonce} has nothing to sync`)
      const changed = dirty.filter(p => Object.keys(p.live).some(k => p.live[k] !== p.synced[k]))
      const cost = cfg.sync_cost_foxsy * dirty.length
      return needFoxsy(cost, allow(cost, { cards: dirty.length }, 'play', [`${changed.length} of ${dirty.length} dirty cards have stat changes`]))
    }

    case 'train': {
      if (!registered) return refuse('not registered')
      const p = card(s, a.player_nonce)
      if (!p) return refuse(`#${a.player_nonce} is not in the wallet`)
      if (p.listed) return refuse(`#${p.nonce} is listed for sale`)
      if (p.condition < cfg.min_field_condition) return refuse(`#${p.nonce} condition ${p.condition} is below ${cfg.min_field_condition}`)
      if ((p.live[a.attribute] ?? 0) >= p.cap) return refuse(`#${p.nonce} ${a.attribute} is at its ${p.rarity} cap ${p.cap}: XP would be lost`)
      const t = s.auth?.shop?.training
      if (!t) return refuse('training quota unknown (shop status unavailable)')
      const paid = t.used_today >= t.daily_free
      if (paid && (t.premium_used_today >= t.premium_cap || t.slots_banked <= 0)) return refuse(`daily training exhausted (${t.used_today} used, ${t.slots_banked} paid slots banked)`)
      return allow(0, { usesPaidSlot: paid })
    }

    case 'set_formation': {
      if (!registered) return refuse('not registered')
      if (!s.team) return refuse(TEAM_UNREADABLE)
      if (s.team.formation === a.formation) return refuse(`formation is already ${a.formation}`)
      const mismatch = lineupPositionsOk(s, a.formation, s.team.lineup)
      return allow(0, {}, 'play', mismatch ? [`current lineup does not fit ${a.formation} (${mismatch}): set a new lineup next`] : [])
    }

    case 'set_lineup': {
      if (!registered) return refuse('not registered')
      if (!s.team) return refuse(TEAM_UNREADABLE)
      const all = [...a.lineup, ...a.substitutes]
      if (new Set(all).size !== all.length) return refuse('a card appears twice')
      for (const n of all) {
        const p = card(s, n)
        if (!p) return refuse(`#${n} is not in the wallet`)
        if (p.listed) return refuse(`#${n} is listed for sale`)
        if (p.transferLockedUntil) return refuse(`#${n} is in a transfer cooldown`)
      }
      const bad = lineupPositionsOk(s, s.team.formation, a.lineup)
      if (bad) return refuse(bad)
      const notes: string[] = []
      if (a.substitutes.length < 7) notes.push('fewer than 7 substitutes: the server fills the bench')
      const tired = a.lineup.filter(n => (card(s, n)?.condition ?? 0) < cfg.min_field_condition)
      if (tired.length) notes.push(`starters under condition ${cfg.min_field_condition}: ${tired.map(n => `#${n}`).join(',')}`)
      return allow(0, {}, 'play', notes)
    }

    case 'play_match': {
      if (!registered) return refuse('not registered')
      if (!s.team) return refuse(TEAM_UNREADABLE)
      const al = s.auth?.allowance
      if (!al) return refuse('daily allowance unknown')
      if (al.today_count >= al.daily_limit) return refuse(`daily match limit reached (${al.today_count}/${al.daily_limit})`)
      if (s.auth?.activeMatch) return refuse(`already in match #${s.auth.activeMatch.match_id ?? s.auth.activeMatch.tournament_match_id ?? '?'}`)
      const busy = tournamentMatchWithinHour(s, ctx.now)
      if (busy) return refuse(`pre-match lockout: ${busy}`)
      const legal = squadLegal(s)
      if (legal) return refuse(legal)
      const exhausted = s.team.lineup.filter(n => (card(s, n)?.condition ?? 0) <= 0)
      if (exhausted.length) return refuse(`starters at condition 0: ${exhausted.map(n => `#${n}`).join(',')}`)
      if (ctx.lastMatchStartAt && ctx.now.getTime() - ctx.lastMatchStartAt.getTime() < 35_000) return refuse('match cooldown (30 s)')
      if (a.match_type === 'ranked' && ctx.lastRankedStartAt && ctx.now.getTime() - ctx.lastRankedStartAt.getTime() < 15.5 * 60_000) return refuse('ranked cooldown (15 min)')
      return allow(0)
    }

    case 'join_tournament': {
      if (!registered || !s.profile) return refuse('not registered')
      const d = ctx.tournament
      if (!d) return refuse(`tournament T${a.tournament_id} not found`)
      const t: Tournament = d.tournament
      if (t.status !== 'open') return refuse(`T${t.id} is ${t.status}`)
      if (new Date(t.deadline) <= ctx.now) return refuse(`T${t.id} registration deadline passed`)
      if (t.is_private && d.user_can_join_private !== true) return refuse(`T${t.id} is private and this team is not invited`)
      if (t.developer_mode) return refuse(`T${t.id} is a developer tournament`)
      if (t.tier === 'gold' && !ctx.settings.entryFeesGold.length) return refuse(`Gold is off for this agent: no Gold amounts in its settings`)
      const myId = s.profile.id
      if (d.participants.some(p => p.user_id === myId)) return refuse(`already in T${t.id}`)
      if (ctx.pendingJoin) return refuse(`a seat in T${t.id} is already paid and waiting for FoxLeague's confirmation: not paying twice`)
      if (d.participants.length >= t.max_teams) return refuse(`T${t.id} is full`)
      const legal = squadLegal(s)
      if (legal) return refuse(legal)
      const oneVOne = t.max_teams === 2
      if (oneVOne) {
        if ((t.targeted || t.target_user_id !== null) && t.target_user_id !== s.profile.id && !t.targeted_to_you) return refuse('1v1 is locked to another opponent')
        if (d.participants.length < 1) return refuse('1v1 creator has not paid yet')
        const opp = oneVOneOpponentRefusal(s, ctx)
        if (opp) return refuse(opp)
        if (s.auth?.myTournaments?.active.some(x => x.max_teams === 2)) return refuse('already in an active 1v1')
        const busy = tournamentMatchWithinHour(s, ctx.now)
        if (busy) return refuse(`tournament match within the hour: ${busy}`)
        const fit = s.team!.lineup.concat(s.team!.substitutes).filter(n => {
          const p = card(s, n)
          return p && p.condition >= cfg.min_field_condition && !p.transferLockedUntil
        })
        if (fit.length < 11) return refuse(`only ${fit.length} match-fit players (condition >= ${cfg.min_field_condition})`)
      }
      if (!oneVOne) {
        const worn = scheduleRefusal(s, t)
        if (worn) return refuse(worn)
        // Zeus enters only with a chance of the top three: not when three seated teams are clearly stronger.
        if (ctx.zeus) {
          // Never blind: a field that could not be read is no field to pay into.
          if (!ctx.field) return refuse('the seated teams could not be read: Zeus does not enter a field it cannot judge')
          const ours = lineupStrength(s)
          const myElo = s.profile.elo_rating
          const unread = ctx.field.filter(f => f.strength === null && f.elo === null).length
          if (unread >= 3) return refuse(`${unread} seated teams could not be read: Zeus does not enter a field it cannot judge`)
          // A team whose squad could not be read counts as stronger when its ELO alone is clearly higher.
          const stronger = ctx.field.filter(f => f.elo !== null && f.elo > myElo + ZEUS_STRONGER_ELO && (f.strength === null || f.strength > ours * ZEUS_STRONGER_SQUAD))
          if (stronger.length >= 3) return refuse(`${stronger.length} seated teams are clearly stronger (lineup and ELO): no real chance of the top three`)
        }
      }
      if (t.tier === 'bronze') return allow(0, { tier: 'bronze', scId: t.sc_tournament_id ?? t.id, fee: 0 })
      if (t.entry_fee_foxsy <= 0) return refuse('paid tier without a fee cannot take entries')
      if (t.entry_fee_foxsy > ctx.settings.maxEntryFeeFoxsy) return refuse(`entry fee ${t.entry_fee_foxsy} exceeds the per-action maximum ${ctx.settings.maxEntryFeeFoxsy}`)
      if (t.sc_tournament_id === null) return refuse(`T${t.id} is not on chain yet (pending_sc)`)
      return needFoxsy(t.entry_fee_foxsy, allow(t.entry_fee_foxsy, { tier: t.tier, scId: t.sc_tournament_id, fee: t.entry_fee_foxsy, oneVOne }))
    }

    case 'leave_tournament': {
      const d = ctx.tournament
      if (!d || !s.profile) return refuse(`tournament T${a.tournament_id} not found`)
      if (!d.participants.some(p => p.user_id === s.profile!.id)) return refuse(`not in T${a.tournament_id}`)
      if (d.tournament.status !== 'open' || new Date(d.tournament.deadline) <= ctx.now) return refuse('can only leave an open tournament before its deadline')
      // Our own 1v1 nobody accepted: leaving refunds the stake, cancelling closes it and frees the 1v1 slot.
      const ownChallenge = d.tournament.max_teams === 2 && d.tournament.creator_user_id === s.profile.id && d.participants.length === 1
      return allow(0, { cancel: ownChallenge }, 'play', ownChallenge ? ['your own 1v1: the stake comes back and the challenge is closed'] : [])
    }

    case 'create_tournament': {
      if (!registered || !s.profile) return refuse('not registered')
      // The owner's own teams are left out of the invites without a word, so no agent learns which they are.
      const invites = (a.invite_user_ids ?? []).filter(id => !(ctx.ownUserIds ?? []).includes(id))
      if (a.invite_user_ids?.length) {
        if (!ctx.zeus) return refuse('only the Zeus level creates private tournaments')
        if (invites.includes(s.profile.id)) return refuse('cannot invite yourself')
        if (invites.length > a.max_teams - 1) return refuse(`at most ${a.max_teams - 1} invited teams for ${a.max_teams} seats`)
        if (invites.length + 1 < a.min_teams) return refuse(`a private tournament fills only with its invited teams and you: ${invites.length + 1} cannot reach the minimum of ${a.min_teams}; invite more active teams`)
      }
      if (a.tier === 'gold' && !ctx.settings.entryFeesGold.length) return refuse('Gold is off for this agent: no Gold amounts in its settings')
      const list = a.tier === 'silver' ? ctx.settings.entryFeesSilver : ctx.settings.entryFeesGold
      if (!list.includes(a.entry_fee_foxsy)) return refuse(`entry fee ${a.entry_fee_foxsy} is not one of the configured amounts ${list.join('/')}`)
      const bounds = tierBounds(s, a.tier)
      if (!bounds || a.entry_fee_foxsy < bounds[0] || a.entry_fee_foxsy > bounds[1]) return refuse(`fee outside the ${a.tier} bounds`)
      if (a.entry_fee_foxsy > ctx.settings.maxEntryFeeFoxsy) return refuse(`entry fee exceeds the per-action maximum ${ctx.settings.maxEntryFeeFoxsy}`)
      if (!VALID_SIZES[a.format]!(a.max_teams)) return refuse(`${a.max_teams} teams is not a valid ${a.format} size`)
      if ((a.format === 'knockout' || a.format === 'groups_knockout') && a.min_teams !== a.max_teams) return refuse(`${a.format} needs min_teams = max_teams`)
      if (a.min_teams > a.max_teams || a.min_teams < 3) return refuse('min_teams must be 3..max_teams')
      const ceiling = sizeCeiling(s)
      if (a.max_teams > ceiling) return refuse(`${a.max_teams} teams is larger than recent tournaments fill (ceiling ${ceiling})`)
      if (a.registration_closes_minutes_before >= a.starts_in_hours * 60 - 30) return refuse('registration would close within 30 minutes of now')
      const mine = s.auth?.myTournaments?.active.filter(t => t.creator_user_id === s.profile!.id && t.max_teams > 2) ?? []
      if (mine.length) return refuse(`already running T${mine[0]!.id}: one created tournament at a time`)
      // FoxLeague refuses a create whose blocking window overlaps any live tournament's: check it first.
      const startsAt = ctx.now.getTime() + a.starts_in_hours * 3600_000
      const taken = clash(s.market.slots ?? [], blockingWindow(a.format, a.max_teams, Boolean(a.home_and_away), startsAt))
      if (taken) {
        const free = firstFreeStartHours(s.market.slots ?? [], a.format, a.max_teams, Boolean(a.home_and_away), ctx.now.getTime())
        const iso = (t: number) => new Date(t).toISOString().slice(0, 16)
        return refuse(`time slot taken by T${taken.id} (its window ${iso(taken.start)} to ${iso(taken.end)} UTC); ${free !== null ? `the first free start for this format and size is starts_in_hours ${free}` : 'no free start in the next 72 hours'}`)
      }
      const worn = scheduleRefusal(s, { format: a.format, max_teams: a.max_teams, home_and_away: a.home_and_away, round_interval_minutes: a.round_interval_minutes, starts_at: new Date(ctx.now.getTime() + a.starts_in_hours * 3600_000).toISOString() })
      if (worn) return refuse(worn)
      const legal = squadLegal(s)
      if (legal) return refuse(legal)
      return needFoxsy(a.entry_fee_foxsy, allow(a.entry_fee_foxsy, { fee: a.entry_fee_foxsy, ...(a.invite_user_ids?.length ? { invites } : {}) }))
    }

    case 'create_challenge': {
      if (!registered || !s.profile) return refuse('not registered')
      if (a.tier === 'gold' && !ctx.settings.entryFeesGold.length) return refuse('Gold is off for this agent: no Gold amounts in its settings')
      if (a.target_user_id === null) {
        if (ctx.zeus) return refuse('Zeus plays a 1v1 only against a named team with a known win chance: challenge one of the teams listed')
        // Open: the strength of whoever takes it cannot be checked, so the stake is the smallest the owner allows.
        const lowest = Math.min(...ctx.settings.entryFeesSilver)
        if (a.tier !== 'silver' || a.stake_foxsy !== lowest) return refuse(`an open challenge is Silver at your lowest amount (${lowest} FOXSY): anyone may take it, a stronger team too`)
        if ((ctx.openChallengesToday ?? 0) >= MAX_OPEN_1V1_PER_DAY) return refuse(`already ${MAX_OPEN_1V1_PER_DAY} open challenge in the last 24 hours`)
      } else {
        if (a.target_user_id === s.profile.id) return refuse('cannot challenge yourself')
        const opp = oneVOneOpponentRefusal(s, ctx)
        if (opp) return refuse(opp)
      }
      const list = a.tier === 'silver' ? ctx.settings.entryFeesSilver : ctx.settings.entryFeesGold
      if (!list.includes(a.stake_foxsy)) return refuse(`stake ${a.stake_foxsy} is not one of the configured amounts ${list.join('/')}`)
      const bounds = tierBounds(s, a.tier)
      if (!bounds || a.stake_foxsy < bounds[0] || a.stake_foxsy > bounds[1]) return refuse(`stake outside the ${a.tier} bounds`)
      if (a.stake_foxsy > ctx.settings.maxEntryFeeFoxsy) return refuse(`stake exceeds the per-action maximum ${ctx.settings.maxEntryFeeFoxsy}`)
      if (s.auth?.myTournaments?.active.some(t => t.max_teams === 2)) return refuse('already in an active 1v1')
      const busy = tournamentMatchWithinHour(s, ctx.now)
      if (busy) return refuse(`tournament match within the hour: ${busy}`)
      const legal = squadLegal(s)
      if (legal) return refuse(legal)
      return needFoxsy(a.stake_foxsy, allow(a.stake_foxsy, { fee: a.stake_foxsy }))
    }

    case 'buy': {
      if (!registered) return refuse('not registered')
      if (a.product === 'condition_recovery' && !s.team) return refuse(TEAM_UNREADABLE)
      if (ctx.pendingShop?.has(a.product)) return refuse(`a ${a.product} payment is still waiting for FoxLeague's confirmation`)
      const prices = cfg.shop_prices_foxsy
      let amount: number
      const facts: Record<string, unknown> = { product: a.product }
      switch (a.product) {
        case 'condition_recovery': {
          let total = 0
          for (const n of a.player_nonces ?? []) {
            const p = card(s, n)
            if (!p) return refuse(`#${n} is not in the wallet`)
            total += Math.ceil((prices.condition * (100 - p.condition)) / 100)
          }
          if (total <= 0) return refuse('selected cards are already at full condition')
          amount = total
          facts.player_nonces = a.player_nonces
          break
        }
        case 'xp_booster': {
          const b = s.auth?.shop?.xp_booster
          if (b && b.active && b.expires_at && new Date(b.expires_at).getTime() - ctx.now.getTime() > 2 * 3600_000) return refuse(`XP booster active until ${b.expires_at}`)
          amount = prices.xp_booster
          break
        }
        case 'training_slot':
          amount = prices.training * (a.quantity ?? 1)
          facts.quantity = a.quantity
          break
        case 'common_pack': {
          if (!cfg.common_pack_available) return refuse(`Common pack unavailable${cfg.common_pack_unavailable_reason ? `: ${cfg.common_pack_unavailable_reason}` : ''}`)
          if (s.auth?.shop?.common_pack_remaining_this_week === 0) return refuse('weekly Common pack quota used')
          amount = cfg.common_pack_price_foxsy
          break
        }
      }
      if (amount > ctx.settings.maxShopPaymentFoxsy) return refuse(`payment ${amount} FOXSY exceeds the per-action maximum ${ctx.settings.maxShopPaymentFoxsy}`)
      return needFoxsy(amount, allow(amount, { ...facts, amount }))
    }

    case 'fuse': {
      if (!registered) return refuse('not registered')
      if (!s.team) return refuse(TEAM_UNREADABLE)
      const cards = a.player_nonces.map(n => card(s, n))
      const missing = a.player_nonces.filter((_n, i) => !cards[i])
      if (missing.length) return refuse(`${missing.map(n => `#${n}`).join(', ')} not in the wallet`)
      const inputs = cards as PlayerView[]
      const rarity = inputs[0]!.rarity
      if (inputs.some(c => c.rarity !== rarity)) return refuse('all three cards must be the same rarity')
      if (rarity === 'Legendary') return refuse('a Legendary cannot be fused')
      const minMatches = cfg.fusion_min_matches ?? 20
      for (const c of inputs) {
        if (c.listed) return refuse(`#${c.nonce} is listed for sale`)
        if (c.transferLockedUntil) return refuse(`#${c.nonce} is in a transfer cooldown until ${c.transferLockedUntil}`)
        if (c.fusionReadyAt) return refuse(`#${c.nonce} is in its fusion cooldown until ${c.fusionReadyAt}`)
        if (inSquad(s, c.nonce)) return refuse(`#${c.nonce} is in the lineup or on the bench: set a squad without it first`)
        if (c.dirty) return refuse(`#${c.nonce} has unsynced stats: sync first (the contract reads the on-chain match count)`)
        if (c.competitiveMatches < PLAYED_FLOOR) return refuse(`#${c.nonce} has played ${c.competitiveMatches} competitive matches; ${PLAYED_FLOOR} must really be played`)
        if (c.competitiveMatches + c.fusionMatchCredit < minMatches) return refuse(`#${c.nonce} has ${c.competitiveMatches + c.fusionMatchCredit} of the ${minMatches} competitive matches fusion needs`)
      }
      const left = s.players.filter(p => !p.listed).length - 2
      if (left < 18) return refuse(`fusion would leave ${left} cards; a match needs 18`)
      if (ctx.canFuse && !ctx.canFuse.can_fuse) return refuse(`FoxLeague says not now: ${canFuseReason(ctx.canFuse)}`)
      const output = `${NEXT_RARITY[RARITY_LEVEL[rarity]]} ${inputs[a.position_of]!.position}`
      if (ctx.fusionPool === 0) return refuse(`no ${output} left in the fusion pool; try later`)
      const fee = cfg.fusion_costs_foxsy?.[RARITY_LEVEL[rarity]]
      if (!fee) return refuse(`fusion cost for ${rarity} unknown`)
      return needFoxsy(fee, allow(fee, { fee, nonces: a.player_nonces, positionChoice: a.position_of }, 'play', [`2 cards fewer, one ${output} in their place`]))
    }

    case 'bid': {
      if (!registered) return refuse('not registered')
      if (!cfg.auction_enabled) return refuse('auctions are switched off')
      const au = ctx.auction
      if (!au) return refuse(`#${a.nonce} is not at auction`)
      if (au.endsAt <= ctx.now) return refuse(`the auction of #${a.nonce} has ended`)
      if (au.seller === s.agent.address) return refuse('a seller cannot bid on its own auction')
      if (au.highestBidder === s.agent.address) return refuse('already the top bidder')
      // In atomic units, rounded up to whole FOXSY: a rival's fractional bid or reserve (600.999) never
      // leaves the agent a whole-FOXSY bid just under the contract's minimum.
      const ceilWhole = (x: bigint) => Number((x + 10n ** 18n - 1n) / 10n ** 18n)
      const top = Number(au.highestBid / 10n ** 18n)
      const minAtomic = au.highestBid === 0n ? au.minPrice : [(au.highestBid * 105n + 99n) / 100n, au.highestBid + 1n].reduce((x, y) => (x > y ? x : y))
      const min = ceilWhole(minAtomic)
      if (a.foxsy < min) return refuse(`bid ${a.foxsy} FOXSY is below the minimum ${min} (${top ? `top bid ${top} + 5 percent` : 'the reserve'})`)
      if (a.foxsy > ctx.settings.maxBidFoxsy) return refuse(`bid ${a.foxsy} FOXSY exceeds the per-action maximum ${ctx.settings.maxBidFoxsy}`)
      const ceiling = ctx.cardRarity ? packAndFusionCost(cfg, ctx.cardRarity) : null
      if (ceiling !== null && a.foxsy > ceiling) return refuse(`bid ${a.foxsy} FOXSY is above what a ${ctx.cardRarity} costs from Common packs and fusion fees (${ceiling} FOXSY): building it is cheaper`)
      if ((ctx.priorBids ?? 0) >= MAX_BIDS_PER_AUCTION) return refuse(`already ${MAX_BIDS_PER_AUCTION} bids on #${a.nonce}: no bidding war`)
      if (ctx.cardLock === null) return refuse(`the details of #${a.nonce} could not be read: not bidding blind`)
      const lock = ctx.cardLock?.until
      if (lock && lock.getTime() - ctx.now.getTime() > MAX_INHERITED_LOCK_HOURS * 3600_000) return refuse(`#${a.nonce} carries a transfer lock until ${lock.toISOString()}: it could not play for weeks`)
      const notes = ['refunded at once if outbid; the card arrives when the auction is settled']
      if (lock && lock > ctx.now) notes.push(`the card carries a transfer lock until ${lock.toISOString()}`)
      return needFoxsy(a.foxsy, allow(a.foxsy, { nonce: a.nonce, bid: a.foxsy }, 'play', notes))
    }

    case 'list_card': {
      if (!registered) return refuse('not registered')
      if (!s.team) return refuse(TEAM_UNREADABLE)
      if (!cfg.auction_enabled) return refuse('auctions are switched off')
      const c = card(s, a.nonce)
      if (!c) return refuse(`#${a.nonce} is not in the wallet`)
      if (c.listed) return refuse(`#${a.nonce} is already listed`)
      if (inSquad(s, a.nonce)) return refuse(`#${a.nonce} is in the lineup or on the bench: set a squad without it first`)
      if (s.players.filter(p => !p.listed).length - 1 < 18) return refuse('listing would leave fewer than 18 cards; a match needs 18')
      if (c.dirty) return refuse(`#${a.nonce} has unsynced stats: sync first (the contract reads the on-chain match count)`)
      if (c.competitiveMatches < PLAYED_FLOOR || c.competitiveMatches + c.fusionMatchCredit < 20) return refuse(`#${a.nonce} needs 20 competitive matches, ${PLAYED_FLOOR} of them played, to be listed`)
      const platformMin = cfg.marketplace_min_list_price_foxsy ?? 500
      if (a.reserve_foxsy < platformMin) return refuse(`reserve below the platform minimum of ${platformMin} FOXSY`)
      const rarityMin = MIN_RESERVE_FOXSY[c.rarity] ?? platformMin
      if (a.reserve_foxsy < rarityMin) return refuse(`reserve ${a.reserve_foxsy} is under the ${c.rarity} minimum of ${rarityMin} FOXSY`)
      const rank = s.players.filter(p => !p.listed).sort((x, y) => y.syncedTotal - x.syncedTotal).findIndex(p => p.nonce === a.nonce)
      if (rank >= 0 && rank < CORE_CARDS) return refuse(`#${a.nonce} is among the ${CORE_CARDS} strongest cards: the agent sells only spares`)
      if (ctx.floorPrice === null) return refuse('the marketplace floor is unavailable: not listing blind')
      if (ctx.floorPrice && a.reserve_foxsy < ctx.floorPrice) return refuse(`reserve ${a.reserve_foxsy} is under the ${c.rarity} floor of ${ctx.floorPrice}: the agent does not sell below the market`)
      if (ctx.canList === null) return refuse('the listing pre-check is unavailable: not listing blind')
      if (ctx.canList && !ctx.canList.can_list) return refuse(`FoxLeague says not now: ${ctx.canList.reason ?? (ctx.canList.can_relist_at ? `relist cooldown until ${ctx.canList.can_relist_at}` : 'not listable')}`)
      return allow(0, { nonce: a.nonce, reserve: a.reserve_foxsy }, 'play', ['a 24-hour auction; the seller pays 10 percent of the winning bid; unsold, the card comes back'])
    }

    case 'fusion_cooldown_waiver':
    case 'fusion_match_waiver': {
      if (!registered) return refuse('not registered')
      if (!s.team) return refuse(TEAM_UNREADABLE)
      const c = card(s, a.nonce)
      if (!c) return refuse(`#${a.nonce} is not in the wallet`)
      if (c.listed) return refuse(`#${a.nonce} is listed for sale: a listed card cannot be waived`)
      // Only for a fusion that can really happen: otherwise the FOXSY buys nothing.
      const blocked = fusionBlocked(s, c)
      if (blocked) return refuse(`no fusion is possible with #${a.nonce} yet (${blocked}): a waiver would be wasted`)
      let costAtomic: bigint
      const notes: string[] = []
      if (a.type === 'fusion_cooldown_waiver') {
        if (!c.fusionReadyAt) return refuse(`#${a.nonce} has no fusion cooldown running`)
        const q = ctx.cooldownQuote
        if (!q) return refuse(`the cooldown waiver quote for #${a.nonce} could not be read`)
        if (q.days <= 0 || q.costAtomic <= 0n) return refuse(`nothing to waive on #${a.nonce}: its cooldown is at the 3-day floor already`)
        costAtomic = q.costAtomic
        notes.push(`#${a.nonce} ready for fusion ${q.days} day${q.days > 1 ? 's' : ''} sooner (3 days left)`)
      } else {
        // The quote counts the matches on chain: unsynced ones would be bought again. Sync first.
        if (c.dirty) return refuse(`#${a.nonce} has unsynced stats: sync first, its unsynced matches may already cover part of the 20`)
        const q = ctx.matchQuote
        if (!q) return refuse(`the match waiver quote for #${a.nonce} could not be read`)
        if (c.competitiveMatches > q.chain_played) return refuse(`#${a.nonce} has ${c.competitiveMatches - q.chain_played} competitive matches not on chain yet: sync first`)
        const minMatches = cfg.fusion_min_matches ?? 20
        if (q.chain_played < PLAYED_FLOOR) return refuse(`#${a.nonce} has really played ${q.chain_played} competitive matches on chain; ${PLAYED_FLOOR} must be played before credit can be bought`)
        const needed = minMatches - q.chain_played - q.credit
        if (needed <= 0) return refuse(`#${a.nonce} already has the ${minMatches} matches fusion needs`)
        if (ctx.piece) {
          const target = Math.min(needed, q.max_purchasable)
          if (ctx.piece.index === 1 && ctx.piece.of * a.matches !== target) return refuse(`#${a.nonce} needs exactly ${target} to reach ${minMatches}: the pieces would buy ${ctx.piece.of * a.matches}`)
          if (a.matches < 1 || a.matches > target) return refuse(`#${a.nonce} can take 1 to ${target} more matches, not ${a.matches}`)
        } else if (a.matches !== Math.min(needed, q.max_purchasable)) {
          return refuse(needed > q.max_purchasable
            ? `#${a.nonce} needs ${needed} more but only ${q.max_purchasable} can be bought: play more matches first`
            : `#${a.nonce} needs exactly ${needed} to reach ${minMatches}: buy that many, not ${a.matches}`)
        }
        if (needed > q.max_purchasable) return refuse(`#${a.nonce} needs ${needed} more but only ${q.max_purchasable} can be bought: play more matches first`)
        costAtomic = BigInt(q.price_wei) * BigInt(a.matches)
        notes.push(a.matches === needed ? `#${a.nonce} reaches ${minMatches} competitive matches for fusion` : `#${a.nonce} +${a.matches} toward the ${minMatches} matches for fusion (${needed - a.matches} to go)`)
      }
      const whole = Number(costAtomic / 10n ** 18n)
      // The first piece of a split waiver answers for the whole group, as the unsplit action would.
      const groupWhole = ctx.piece?.index === 1 ? whole * ctx.piece.of : whole
      if (groupWhole > ctx.settings.maxShopPaymentFoxsy) return refuse(`${groupWhole} FOXSY exceeds the per-action maximum ${ctx.settings.maxShopPaymentFoxsy} (Max shop payment)`)
      return needFoxsy(whole, allow(costAtomic, { costAtomic, nonce: a.nonce, ...(a.type === 'fusion_match_waiver' ? { matches: a.matches } : {}) }, 'play', notes))
    }

    case 'cancel_listing': {
      const au = ctx.auction
      if (!au) return refuse(`#${a.nonce} is not at auction`)
      if (au.seller !== s.agent.address) return refuse(`#${a.nonce} is not this agent's auction`)
      if (au.highestBid > 0n) return refuse('the auction has bids and cannot be cancelled')
      return allow(0, { nonce: a.nonce })
    }

    case 'claim_refund': {
      const d = ctx.tournament
      if (!d) return refuse(`tournament T${a.tournament_id} not found`)
      if (d.tournament.status !== 'cancelled' && d.tournament.status !== 'completed') return refuse(`T${a.tournament_id} is ${d.tournament.status}: refunds open only when cancelled or completed`)
      if (ctx.entryAmount === 0n) return refuse(`no escrow of ours left in T${a.tournament_id} (getEntryAmount = 0)`)
      return allow(0, { scId: d.tournament.sc_tournament_id ?? d.tournament.id })
    }
  }
}
