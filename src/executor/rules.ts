// Game gates checked locally before anything is built or sent, from the snapshot (the server stays
// the final judge; these keep the agent from sending what the interface would refuse, and from
// paying for something that cannot work). Every number is read live where a public source exists.

import { blockingWindow, ceilMinute, clash, firstFreeStart, nextPlanLeadMs } from './slots.ts'
import { percent, winChance } from '../snapshot/winchance.ts'
import type { Action } from './actions.ts'
import { CREATE_START_MAX_MS, CREATE_START_MIN_MS, FORMATION_SLOTS, createStartMs, rangeWords } from './actions.ts'
import type { AgentSnapshot, PlayerView } from '../snapshot/snapshot.ts'
import type { CanFuse, CanList, FoxConfig, FusionPrepared, MatchWaiverQuote, MedicineQuote, OrganizerFeeQuote, PendingLeagueInvitation, RankedTicketView, Tournament, TournamentDetail, UpcomingMatch } from '../foxleague/types.ts'
import { aRarity, matchGate } from '../foxleague/gate.ts'
import { RARITY_LEVEL, type Auction } from '../chain/players.ts'
import type { AgentSettings } from '../store/settings.ts'
import { wholeToAtomic } from '../util/encoding.ts'
import { fusionMode, leaveLockLive, levelsLive, organizerFeesLive, paidBronzeEarns } from '../foxleague/levels.ts'
import { fusionMintTx } from './tx.ts'
import { STATS } from '../foxleague/types.ts'
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
  /** Fusion pre-check (GET /api/fusion/can-fuse) and the pool stock of the output, fetched for the old fuse. */
  canFuse?: CanFuse | null
  fusionPool?: number
  /**
   * From FoxLeague's fusion switch: its prepared fusionMint (POST /api/fusion/prepare), its refusal in its own words, or
   * null when it gave no answer. FUSION_UNASKED while the executor has not asked it yet (R73A-2): every other check runs
   * and the verdict carries no transaction to sign.
   */
  fusionPrepared?: FusionPrepared | { refusal: string } | typeof FUSION_UNASKED | null
  /** The card's live auction (view getAuction), fetched for bid and cancel_listing. */
  auction?: Auction | null
  /** Listing pre-check and the current floor of the card's rarity (0 when none is listed), fetched for list_card; null = unavailable. */
  canList?: CanList | null
  floorPrice?: number | null
  /** The other side of a 1v1 (joined or created): its ELO and lineup strength at full condition, null when unreadable. */
  opponent?: { userId: number; elo: number | null; strength?: number | null }
  /**
   * For joining a League + Knockout: the team's pending invitation to it, read again right before the payment;
   * 'not invited' when there is none, null when the invitations could not be read (refused).
   */
  invitation?: PendingLeagueInvitation | 'not invited' | null
  /** The owner asked for this action (dashboard or Telegram), not the plan. */
  byOwner?: boolean
  /** For joining a tournament or 1v1 with an OVR range: the team's best XI OVR read right before paying, null when unreadable. */
  bestXiOvr?: number | null
  /** For leaving a League + Knockout: when its seats lock (FoxLeague's invitations view), null when unreadable. */
  seatsLockAt?: Date | null
  /** For leaving a League + Knockout: this agent paid the seat itself (its own join in its log), not the owner. */
  ownSeat?: boolean
  /** For widening an OVR range: this agent created the tournament or 1v1 itself (its own create in its log), not the owner. */
  ownCreation?: boolean
  /** For a join of a standard tournament: each seated team's lineup strength and ELO, null when unread. */
  field?: { userId: number; strength: number | null; elo: number | null }[]
  /** 1v1s this agent already played or entered against that opponent in the last 7 days. */
  oneVOneWithOpponentThisWeek?: number
  /** XP boosters and Common packs this agent bought in the last 7 days (its own log), for the level's counts. */
  boostersThisWeek?: number
  packsThisWeek?: number
  /** Days of medicine this agent bought in the last 7 days (its own log), for the level's count. */
  medicineDaysThisWeek?: number
  /** An open challenge this agent created in the last 4 hours (its longest deadline) may still wait (R54A-3). */
  openChallengeRecent?: boolean
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
  /** A ranked start once the levels are live: the tickets held and their price, null when unread. */
  rankedTicket?: RankedTicketView | null
  /** A ticket payment still waits for FoxLeague's confirmation. */
  pendingTicket?: boolean
  /** A tournament create once the organizer fees are live: what it owes, null when unread. */
  organizerQuote?: OrganizerFeeQuote | null
  /** An organizer payment no create has used yet: the next create sends this hash, never a second payment. */
  pendingOrganizer?: { hash: string; total: number }
  /** When this agent last bought an XP booster within 24 h less the renewal margin (its own log), null for none. */
  lastBoosterAt?: Date | null
  /** A seat in this tournament is paid and waiting for FoxLeague's confirmation (retried with the same hash). */
  pendingJoin?: boolean
  /** Fusion waiver quotes, fetched for the waiver actions; null = unreadable. */
  cooldownQuote?: { days: number; costAtomic: bigint } | null
  matchQuote?: MatchWaiverQuote | null
  /** FoxLeague's medicine quote for the card and the days asked, fetched for buy medicine; null = unreadable. */
  medicineQuote?: MedicineQuote | null
  /**
   * A transfer lock the card at auction carries (inherited by the buyer), and its injury, which a sale keeps too
   * (injuryUnread: once the bans are live, FoxLeague's answer left it out); null = its details could not be read.
   */
  cardLock?: { until: Date | null; injuredUntil?: Date | null; injuryUnread?: boolean } | null
  now: Date
}

/**
 * In `fusionPrepared`: FoxLeague's prepare not asked yet (GitHub review of PR #73, R73A-2). The prepare is a write on
 * FoxLeague (it signs a new card for 10 minutes, at most one every 2 seconds a wallet, up to 45 s), so the executor asks
 * it only once every check of the agent's own passed, and never in a dry run. With it a fusion that passes every other
 * check is allowed `unprepared`: the executor then asks the prepare and checks again with its answer, live, or counts
 * the fusion without simulating it, in a dry run. Only a prepared fusion is ever built to be signed. A symbol, so no
 * answer read from FoxLeague can ever be taken for it.
 */
export const FUSION_UNASKED: unique symbol = Symbol('fusion prepare not asked yet')

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

/**
 * Unrevealed tournament or 1v1 match of ours within the next hour (the casual and ranked lockout of play_match). The
 * upcoming matches unreadable is no "none": the reason then says so and the caller refuses. FoxLeague's play gate
 * reads the same rows as its 1v1 gate (see oneVOneBusy), unchanged on 2026-10-15; a casual or ranked start pays
 * nothing, so this window stays as it was and the 1v1 gate, where a stake is paid first, reads the full rule.
 */
function tournamentMatchWithinHour(s: AgentSnapshot, now: Date): string | null {
  const upcoming = s.auth?.upcoming
  if (!upcoming) return 'your upcoming matches could not be read'
  for (const m of upcoming.matches) {
    if (m.phase === 'finished') continue
    const at = new Date(m.scheduled_at).getTime()
    if (at - now.getTime() <= 3600_000 && at + 15 * 60_000 > now.getTime()) return `T${m.tournament_id} match at ${m.scheduled_at}`
  }
  return null
}

/** FoxLeague's statuses of a running tournament, the only ones its busy rows read (matches.rs tournament_busy_rows_sql). */
const RUNNING_STATUSES = new Set(['active', 'simulating', 'simulation_delayed'])
/** Before the start: no fixtures yet; FoxLeague creates them when the tournament goes active. */
const NOT_STARTED_STATUSES = new Set(['open', 'pending_sc'])
/** FoxLeague's TOURNAMENT_BUSY_LEAD_HOURS (matches.rs): a team is busy from this long before a kickoff. */
const BUSY_LEAD_MS = 3600_000
/** Rows of GET /api/tournaments/upcoming-matches without `limit` (tournaments.rs UPCOMING_DEFAULT_LIMIT). */
const UPCOMING_PAGE = 50

/**
 * Why FoxLeague would call this team busy with a tournament right now and refuse a 1v1 create or join, or null
 * (#512, 2026-10-15: the 1v1 gates read the play gate's rows, matches.rs tournament_busy_rows_sql). Busy: from an
 * hour before one of your own fixtures kicks off until its broadcast ends, however late that is; in groups_knockout
 * every team of a group from an hour before the group's last kickoff until every match of the group has ended; in
 * Swiss every team of a round from an hour before its own kickoff in it until every match of the round has ended.
 * The agent sees only its own fixtures (GET /api/tournaments/upcoming-matches), so it stays busy wherever it cannot
 * tell that a group or a round has ended: an own knockout fixture is listed only once the whole group has ended, the
 * next Swiss round only once the round before it has. Unknown is busy: a format or status the agent does not know,
 * fixtures missing from the list, a tournament about to start whose fixtures are not out yet.
 */
function oneVOneBusy(s: AgentSnapshot, now: Date): string | null {
  const upcoming = s.auth?.upcoming
  const mine = s.auth?.myTournaments
  if (!upcoming) return 'your upcoming matches could not be read'
  if (!mine) return 'your current tournaments could not be read'
  const t0 = now.getTime()
  // A stake signed now settles and reaches FoxLeague's gate a minute or two later: busy that much earlier (R58A-1).
  const lead = BUSY_LEAD_MS + BUSY_OPENS_MARGIN_S * 1000
  const at = (m: UpcomingMatch) => new Date(m.scheduled_at).getTime()
  for (const m of upcoming.matches) {
    if (m.phase !== 'finished' && at(m) - t0 <= lead) return `T${m.tournament_id} match at ${m.scheduled_at} (busy from an hour before kickoff until its broadcast ends)`
  }
  // The route is read without a limit: FoxLeague's page of 50, soonest first, the last day's finished games first.
  if (upcoming.matches.length >= UPCOMING_PAGE) return `your upcoming matches fill FoxLeague's page of ${UPCOMING_PAGE}: a match within the hour may be cut from it`
  for (const t of mine.active) {
    // A 1v1's only match is a row above; another active 1v1 is refused before this check (one at a time).
    if (t.max_teams === 2 || t.status === 'completed' || t.status === 'cancelled') continue
    if (NOT_STARTED_STATUSES.has(t.status)) {
      // It can go active, with its fixtures, at any moment once the start is near.
      if (new Date(t.starts_at).getTime() - t0 <= lead) return `T${t.id} starts at ${t.starts_at} and its fixtures are not out yet`
      continue
    }
    if (!RUNNING_STATUSES.has(t.status)) return `T${t.id} has the status ${t.status}, which the agent does not know: whether it keeps you busy is unknown`
    const own = upcoming.matches.filter(m => m.tournament_id === t.id).sort((x, y) => at(x) - at(y))
    switch (t.format) {
      case 'knockout':
      case 'round_robin':
      // FoxLeague counts a League + Knockout as busy only through the team's own fixtures (matches.rs busy rows).
      case 'league_knockout':
        continue // only the own fixtures, read above
      case 'groups_knockout': {
        if (own.some(m => m.group_name === undefined)) return `T${t.id}: FoxLeague did not say which of your fixtures are group matches: whether your group has ended is unknown`
        const group = own.filter(m => m.group_name !== null && m.group_name !== '3rd Place')
        if (own.length > group.length) continue // an own knockout fixture is listed: the whole group has ended
        if (!group.length) return `T${t.id}: none of your group fixtures is in the list: whether your group has ended is unknown`
        // The group's last kickoff is no earlier than your own last group match: busy from an hour before that.
        if (at(group[group.length - 1]!) - t0 <= lead) return `T${t.id}: your group has not ended for every team yet (no knockout fixture of yours is listed)`
        continue
      }
      case 'swiss': {
        if (!own.length) return `T${t.id}: none of your Swiss fixtures is in the list: whether your round has ended is unknown`
        if (own[own.length - 1]!.phase === 'finished') return `T${t.id}: your Swiss round has not ended for every team yet (the next round is not out)`
        continue // the next round is listed, so every round before it has ended; its own match is read above
      }
      default:
        return `T${t.id} is a ${t.format} tournament, a format the agent does not know: whether it keeps you busy is unknown`
    }
  }
  return null
}

/** Effective tier bounds (Silver top is min(silver_max, gold_min - 1), docs 10.1). */
export function tierBounds(s: AgentSnapshot, tier: 'bronze' | 'silver' | 'gold'): [number, number] | null {
  const b = s.config?.tournament_fee_bounds
  if (!b) return null
  if (tier === 'bronze') return typeof b.bronze_min === 'number' && typeof b.bronze_max === 'number' ? [b.bronze_min, Math.min(b.bronze_max, b.silver_min - 1)] : null
  return tier === 'silver' ? [b.silver_min, Math.min(b.silver_max, b.gold_min - 1)] : [b.gold_min, Number.MAX_SAFE_INTEGER]
}

/** FoxLeague's GROUPS_KNOCKOUT_MIN_TEAMS, GROUP_MIN_TEAMS and GROUP_MAX_TEAMS (tournament_engine.rs). */
const GROUPS_MIN_TEAMS = 6
const GROUP_MIN_TEAMS = 3
const GROUP_MAX_TEAMS = 6

const VALID_SIZES: Record<string, (n: number) => boolean> = {
  knockout: n => [4, 8, 16, 32].includes(n),
  groups_knockout: n => [8, 16, 32, 64].includes(n),
  round_robin: n => n >= 3 && n <= 20,
  swiss: n => n >= 3 && n <= 32,
}

/**
 * The formats the agent knows (their sizes, matches and windows above). Any other one, such as FoxLeague's
 * admin-only league_knockout of 2026-10-15 (a 36-team league and a two-legged knockout), is neither joined nor
 * created: its matches, schedule and busy rows are unknown, and an estimate is no reason to pay a seat. A League +
 * Knockout is the exception for joining: by invitation, with its own checks (join_tournament).
 */
function unsupportedFormat(format: string, doing: 'joining' | 'creating'): string | null {
  // A League + Knockout is joined by invitation (its own checks in join_tournament) and created only by FoxLeague's admin.
  if (format === 'league_knockout') return doing === 'joining' ? null : 'a League + Knockout is created by FoxLeague only'
  return Object.hasOwn(VALID_SIZES, format) ? null : `format ${format} is not supported yet: not ${doing} blind`
}

/** One of the four formats the agent knows how to join and create. */
export function supportedFormat(format: string): boolean {
  return Object.hasOwn(VALID_SIZES, format)
}

/** Largest size worth creating: what recently filled plus a margin (README: 16-20 is the norm, not 64). */
export function sizeCeiling(s: AgentSnapshot): number {
  // A League + Knockout fills by invitation: its 36 seats say nothing about what an open tournament fills.
  const seated = s.market.recentStandard.filter(t => t.status === 'completed' && t.format !== 'league_knockout').map(t => t.seated)
  const best = seated.length ? Math.max(...seated) : 0
  return Math.max(8, Math.ceil(best * 1.25))
}

// Hard limits from the adversarial review (test/audit.test.ts), independent of what the model proposes.
/** A 1v1 is refused against a team this many ELO points (or more) above the agent. */
export const MAX_1V1_ELO_GAP = 100
/**
 * A 1v1 stake is not signed when the team's busy hour opens this soon, by FoxLeague's own count for a join or by the
 * agent's fixtures for a create and a join: the payment settles and reaches the join gate after it (its own app holds 60 s).
 */
export const BUSY_OPENS_MARGIN_S = 120
/** A 1v1 is refused when the rival's lineup (at full condition) is more than this much stronger than ours today. */
export const MAX_1V1_STRENGTH_RATIO = 1.1
export const MAX_1V1_PER_OPPONENT_WEEK = 2
export const MAX_BIDS_PER_AUCTION = 2

/**
 * The percent a bid must stand over the top bid, as the players contract asks it (player_nft.rs: amount >= top bid x
 * (100 + percent) / 100; the owner sets it from 1 to 50, 5 when unset) and /api/config serves it
 * (auction_min_increment_percent). An answer without it is the contract's own default; one that is no whole number
 * from 1 to 50 is unread (null): a raise under the real step reverts and loses its gas (audit 2026-11-11, INTEG-3).
 */
export function auctionMinRaisePercent(cfg: Pick<FoxConfig, 'auction_min_increment_percent'> | null | undefined): number | null {
  const served = cfg?.auction_min_increment_percent
  if (served === undefined) return 5
  return typeof served === 'number' && Number.isInteger(served) && served >= 1 && served <= 50 ? served : null
}

/**
 * What a card of a rarity costs from Common packs and fusion fees alone, at FoxLeague's live prices: 3^n Commons
 * at a fifth of a pack each plus every fusion fee on the way up (Rare 5,000, Epic 15,400, Legendary 47,000 in
 * October 2026). A bid above it pays more than building the card; null when the prices are unknown.
 */
export function packAndFusionCost(cfg: { common_pack_price_foxsy?: number; fusion_costs_foxsy?: number[] } | null | undefined, rarity: string): number | null {
  // Own keys only: a name every object inherits (toString, __proto__) is no rarity.
  const level = Object.hasOwn(RARITY_LEVEL, rarity) ? (RARITY_LEVEL as Record<string, number>)[rarity] : undefined
  const pack = cfg?.common_pack_price_foxsy
  const fees = cfg?.fusion_costs_foxsy
  if (level === undefined || !pack || pack <= 0 || !Array.isArray(fees) || fees.length < level) return null
  let cost = pack / 5
  for (let i = 0; i < level; i++) cost = 3 * cost + fees[i]!
  return Math.round(cost)
}
/**
 * The most a bid may pay for a card (owner, 2026-10-23): what building one yourself costs and bringing it to its match
 * gate, since only a card at its gate can be listed. Building is the Common packs and the fusion fees, plus the time
 * it takes, priced the way FoxLeague prices time: every competitive match an input or the card needs to reach its gate
 * at the rarity's price for a bought match (a Common has none: the cheapest match price), and every day of a fused
 * input's cooldown at the price of a day bought off, all of them, whether or not that wait can be bought. On mainnet
 * that is Common 600, Uncommon 2,200, Rare 14,450, Epic 60,400, Legendary 225,650 FOXSY. Without the gate rows or
 * the cooldown settings, the packs and fees alone (lower, so stricter); without those, no ceiling, as before.
 */
export function auctionCeiling(cfg: Pick<FoxConfig, 'common_pack_price_foxsy' | 'fusion_costs_foxsy' | 'rarity_match_gate' | 'fusion_card_cooldown_seconds' | 'fusion_cooldown_waiver_price_per_day'> | null | undefined, rarity: string): number | null {
  const base = packAndFusionCost(cfg, rarity)
  if (base === null) return null
  const level = (RARITY_LEVEL as Record<string, number>)[rarity]!
  const rows = cfg?.rarity_match_gate?.rarities
  const perDay = cfg?.fusion_cooldown_waiver_price_per_day
  const cooldown = cfg?.fusion_card_cooldown_seconds
  if (!Array.isArray(rows) || !(typeof perDay === 'number' && perDay > 0) || !(typeof cooldown === 'number' && cooldown > 0)) return base
  const cheapest = Math.min(...rows.map(r => r.price_per_match).filter(p => typeof p === 'number' && p > 0))
  if (!Number.isFinite(cheapest)) return base
  const order = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary']
  // A card of `level` played to its gate; a fused input also through its cooldown, before it can be fused again. The
  // card bought is not charged its own cooldown: a card may be listed inside it (agent review of PR #20).
  const toGate = (l: number, input: boolean): number | null => {
    const row = rows.find(r => r.rarity === order[l])
    if (!row || !(row.gate >= 0)) return null
    return row.gate * (row.price_per_match > 0 ? row.price_per_match : cheapest) + (input && l > 0 ? (cooldown / 86_400) * perDay : 0)
  }
  let made = cfg!.common_pack_price_foxsy / 5
  for (let l = 0; l < level; l++) {
    const wait = toGate(l, true)
    if (wait === null) return base
    made = 3 * (made + wait) + cfg!.fusion_costs_foxsy[l]!
  }
  const own = toGate(level, false)
  return own === null ? base : Math.round(made + own)
}

/** The owner's limit for a bid on a card of this rarity; null for a rarity the game does not have. */
export function rarityBidLimit(settings: Pick<AgentSettings, 'maxBidCommonFoxsy' | 'maxBidUncommonFoxsy' | 'maxBidRareFoxsy' | 'maxBidEpicFoxsy' | 'maxBidLegendaryFoxsy'>, rarity: string | null | undefined): number | null {
  if (rarity === 'Common') return settings.maxBidCommonFoxsy
  if (rarity === 'Uncommon') return settings.maxBidUncommonFoxsy
  if (rarity === 'Rare') return settings.maxBidRareFoxsy
  if (rarity === 'Epic') return settings.maxBidEpicFoxsy
  if (rarity === 'Legendary') return settings.maxBidLegendaryFoxsy
  return null
}

/** FoxLeague's 30 seconds between match starts and 15 minutes after a ranked start, each with a margin (play_match). */
export const MATCH_COOLDOWN_MS = 35_000
export const RANKED_COOLDOWN_MS = 15.5 * 60_000
/**
 * A casual or ranked match holds its team until its broadcast has aired, and another start before then is refused
 * ("already in match"): the simulation (about 1.5 minutes, up to 5), the recording (600 s plus stoppage time, 615 s
 * seen) and 30 s (matches.rs live_match_predicate, broadcast_holds_its_team_sql). 11 minutes was too short (FoxLeague's
 * release of 2026-11-05, R85-1); a slower simulation is caught by the active match read before each start.
 */
export const MATCH_RUNS_MS = 13 * 60_000

/** Hours of transfer lock a card bought at auction may still carry. */
export const MAX_INHERITED_LOCK_HOURS = 72
/** Lowest reserve per rarity, whatever the floor says (one junk listing can drag the floor to 500). */
export const MIN_RESERVE_FOXSY: Record<string, number> = { Common: 500, Uncommon: 1500, Rare: 4000, Epic: 10000, Legendary: 25000 }
/** The strongest cards (by synced total) are the squad's core and never sold. */
export const CORE_CARDS = 18
/** An XP booster may be bought again only when the running one has at most this many hours left (no stacking). */
export const XP_BOOSTER_RENEW_HOURS = 2

const NEXT_RARITY = ['Uncommon', 'Rare', 'Epic', 'Legendary'] as const

/**
 * FoxLeague's League + Knockout ("Champions FoxLeague", next-foxleague tournament_engine.rs, read 2026-10-24): 36 teams,
 * 8 league matches each, then places 1 to 24 play the knockout (play-off, round of 16, quarter-finals and semi-finals
 * over two legs, then the final or the third place match): at most 9 more. Its matches are played one at a time for
 * the whole tournament, 4 a team in the league (144 for 36) then 46 knockout matches, one per round interval.
 */
export const LK_LEAGUE_MATCHES = 8
export const LK_KNOCKOUT_MATCHES = 9
const LK_KNOCKOUT_SLOTS = 46
/** A League + Knockout is accepted with a real chance of the knockout: places 1 to 24 (owner, 2026-10-24). */
export const LK_KNOCKOUT_PLACES = 24
/**
 * An invitation this close to its expiry is not paid into (FoxLeague closes it when the next wave runs), and a League +
 * Knockout seat this close to its seats lock is not left.
 */
export const INVITATION_MARGIN_MS = 30 * 60_000

/**
 * Minutes from a tournament's first match to its last, at its round interval: one round per interval, except a League
 * + Knockout, whose matches are all played one after another (its league slots, then its 46 knockout matches).
 */
export function scheduleSpanMinutes(format: string, maxTeams: number, homeAndAway: boolean, interval: number, groupSize = 4): number {
  if (format === 'league_knockout') return (maxTeams * (LK_LEAGUE_MATCHES / 2) + LK_KNOCKOUT_SLOTS - 1) * interval
  return (matchesAtMost(format, maxTeams, homeAndAway, groupSize) - 1) * interval
}

/**
 * An OVR range on a create (FoxLeague, 2026-10-24): the agent always takes its own seat, and FoxLeague refuses a creator
 * outside their own range, so the range must hold the team's best XI OVR, read right before the create (unreadable: none).
 */
function createRangeRefusal(a: { ovr_min?: number; ovr_max?: number; target_user_id?: number | null; invite_user_ids?: number[] }, ctx: RulesContext): string | null {
  if (a.ovr_min === undefined && a.ovr_max === undefined) return null
  // Only the chosen team can accept a targeted challenge, and only the invited teams join a private tournament: a range
  // could only lock them out, unread (agent review of PR #35).
  if (typeof a.target_user_id === 'number') return 'no OVR range on a targeted challenge: only the chosen team can accept it'
  if (a.invite_user_ids?.length) return 'no OVR range on a private tournament: it could lock out the teams you invite'
  const ovr = ctx.bestXiOvr
  if (typeof ovr !== 'number' || !Number.isFinite(ovr)) return 'your best XI OVR could not be read: no OVR range without it'
  if ((a.ovr_min !== undefined && ovr < a.ovr_min) || (a.ovr_max !== undefined && ovr > a.ovr_max)) return `your best XI OVR is ${ovr}, outside the OVR range you set (${rangeWords(a.ovr_min, a.ovr_max)}): FoxLeague refuses a creator outside their own range`
  return null
}

/** Our League + Knockout that has started and is not over: no other standard tournament meanwhile (FoxLeague's option C). */
function runningLeagueKnockout(s: AgentSnapshot): Tournament | undefined {
  return s.auth?.myTournaments?.active.find(t => t.format === 'league_knockout' && t.started_at && t.status !== 'completed' && t.status !== 'cancelled')
}

/** Matches one team may play in a tournament at most (it goes all the way), by format and size. */
/**
 * FoxLeague's flexible Groups + Knockout (tournament_engine.rs flexible_group_count, groups_knockout_most_matches): from 6
 * teams, as many groups as give each at least 3 teams, a power of 2, never more than a full one has; the top 2 advance.
 * The most one team can play over every field from `minTeams` up: the largest group and a run to the final.
 */
function groupsKnockoutMostMatches(maxTeams: number, groupSize: number, minTeams: number): number {
  const full = Math.max(2, 2 ** Math.ceil(Math.log2(Math.ceil(maxTeams / Math.max(1, groupSize)))))
  let most = 0
  for (let teams = Math.max(GROUPS_MIN_TEAMS, minTeams); teams <= maxTeams; teams++) {
    let groups = full
    while (groups > 2 && GROUP_MIN_TEAMS * groups > teams) groups /= 2
    const largest = Math.ceil(teams / groups)
    if (GROUP_MIN_TEAMS * groups > teams || largest > Math.max(GROUP_MAX_TEAMS, groupSize)) continue
    most = Math.max(most, largest - 1 + Math.log2(groups * 2))
  }
  return most
}

export function matchesAtMost(format: string, maxTeams: number, homeAndAway: boolean, groupSize = 4, minTeams = GROUPS_MIN_TEAMS): number {
  const rounds = (n: number) => Math.ceil(Math.log2(Math.max(2, n)))
  switch (format) {
    case 'knockout':
      return rounds(maxTeams)
    case 'groups_knockout':
      return groupsKnockoutMostMatches(maxTeams, groupSize, minTeams) || groupSize - 1 + rounds((maxTeams / groupSize) * 2)
    case 'round_robin':
      return (maxTeams - 1) * (homeAndAway ? 2 : 1)
    case 'swiss':
      return rounds(maxTeams) + 1
    case 'league_knockout':
      return LK_LEAGUE_MATCHES + LK_KNOCKOUT_MATCHES
    default:
      // Never joined or created (unsupportedFormat); only a tournament already held could have one: counted as a league.
      return maxTeams - 1
  }
}

/** The most condition a card can have. */
const MAX_CONDITION = 100

/** Condition points a card regenerates per hour of rest: FoxLeague's daily rate, half of it after age 30. */
function regenPerHour(p: PlayerView, cfg: FoxConfig): number {
  const rate = (cfg.condition_regen_points_per_day ?? 48) / 24
  return p.ageYears > 30 ? rate / 2 : rate
}

/** The condition an appearance costs a card: FoxLeague's base until age 30, rising evenly to 3 times it at 39 (Player Aging). */
export function appearanceCost(p: PlayerView, base: number): number {
  return base * (1 + 2 * Math.min(1, Math.max(0, (p.ageYears - 30) / 9)))
}

/**
 * Why a casual game now would cost the next match that counts some condition, or null when it is free (owner,
 * 2026-11-04): every card of `squad` (the eleven and bench that would play) must be back to full condition before the
 * next strategy lock of a tournament or 1v1 match of ours, so the game takes nothing from that match. A 1v1 of ours that
 * waits for an opponent can be accepted, and played minutes later, at any time; a tournament under way whose next match
 * is not listed may play at any time; a calendar that cannot be read is no free time.
 */
export function casualCostRefusal(s: AgentSnapshot, squad: number[], now: Date): string | null {
  const cfg = s.config
  const upcoming = s.auth?.upcoming
  const mine = s.auth?.myTournaments
  if (!cfg || !upcoming || !mine) return 'your calendar could not be read: no casual game blind'
  const waiting = mine.active.find(t => t.max_teams === 2 && NOT_STARTED_STATUSES.has(t.status))
  if (waiting) return `your 1v1 T${waiting.id} waits for an opponent: it can be accepted at any time and played minutes later, so a casual game now could cost it condition`
  const lead = (upcoming.lead_minutes ?? 30) * 60_000
  const locks: { at: number; what: string }[] = []
  for (const m of upcoming.matches) {
    if (m.phase !== 'upcoming') continue
    const lock = Date.parse(m.strategy_locks_at)
    if (!Number.isFinite(lock)) return `the lock of your T${m.tournament_id} match could not be read`
    locks.push({ at: lock, what: `your T${m.tournament_id} match locks at ${m.strategy_locks_at}` })
  }
  for (const t of mine.active) {
    if (t.max_teams === 2) continue
    if (NOT_STARTED_STATUSES.has(t.status)) {
      const startsAt = Date.parse(t.starts_at)
      if (!Number.isFinite(startsAt)) return `the start of your T${t.id} could not be read`
      locks.push({ at: startsAt - lead, what: `your T${t.id} starts at ${t.starts_at}` })
    } else if (!upcoming.matches.some(m => m.tournament_id === t.id && m.phase === 'upcoming')) {
      return `your T${t.id} is under way and its next match is not listed yet: it may play at any time`
    }
  }
  const next = locks.filter(l => l.at > now.getTime()).sort((x, y) => x.at - y.at)[0]
  if (!next) return null
  const hours = (next.at - now.getTime()) / 3600_000
  // Unknown is not a value (OPEN-1): with a match that counts ahead, a cost or a regeneration that cannot be read is no free game.
  const base = cfg.condition_loss_per_match_ranked
  const regen = cfg.condition_regen_points_per_day
  if (typeof base !== 'number' || !(base > 0) || !Number.isFinite(base)) return 'the condition a casual game costs could not be read: no casual game blind'
  if (typeof regen !== 'number' || !(regen > 0) || !Number.isFinite(regen)) return 'the condition a card regains could not be read: no casual game blind'
  for (const n of squad) {
    const p = card(s, n)
    // A card that could not be read is no free card (audit 2026-11-04, INPUT-3).
    if (!p) return `#${n} could not be read: no casual game blind`
    const back = p.condition - appearanceCost(p, base) + regenPerHour(p, cfg) * hours
    if (!Number.isFinite(back) || back < MAX_CONDITION) return `#${n} would not be back to full condition before ${next.what} (${Math.floor(back)} of ${MAX_CONDITION}): a casual game now would cost that match condition`
  }
  return null
}

/** Hours from `now` to an ISO time, 0 when it is past or unreadable. */
export function hoursUntil(iso: string, now: Date): number {
  const h = (new Date(iso).getTime() - now.getTime()) / 3600_000
  return Number.isFinite(h) && h > 0 ? h : 0
}

/** The squad a schedule wears down: the eleven and the bench. */
function matchSquad(s: AgentSnapshot): PlayerView[] {
  return s.team ? [...s.team.lineup, ...s.team.substitutes].map(n => card(s, n)).filter((p): p is PlayerView => Boolean(p)) : []
}

/**
 * What the squad's other tournaments (1v1s apart) still bring around a tournament that plays from `start` to `end`:
 * the matches before its start and those whose play overlaps it. Started: the fixtures still to play; not started:
 * the most its format can bring. One over by now and before the start (as its schedule says) brings nothing. Null: unreadable.
 */
function otherMatches(s: AgentSnapshot, cfg: FoxConfig, id: number | undefined, now: Date, start: number, end: number): { before: number; during: number; beforeEnd: number } | null {
  const mine = s.auth?.myTournaments
  if (!mine) return null
  const groupSize = cfg.tournament_defaults?.groups_knockout_group_size ?? 4
  let before = 0
  let during = 0
  // When the last of the matches before the start ends: the squad rests up to it, then pays for them.
  let beforeEnd = now.getTime()
  for (const x of mine.active) {
    if (x.id === id || x.max_teams === 2) continue
    // What a tournament under way still owes is read from the upcoming matches: unread is unknown, never 1 (MON-1).
    if (x.started_at && !s.auth?.upcoming) return null
    const total = matchesAtMost(x.format, x.max_teams, Boolean(x.home_and_away), groupSize, x.min_teams)
    const xStart = new Date(x.starts_at).getTime()
    const xEnd = xStart + scheduleSpanMinutes(x.format, x.max_teams, Boolean(x.home_and_away), x.round_interval_minutes ?? 30, groupSize) * 60_000
    if (xStart > end || (xEnd < start && xEnd < now.getTime())) continue
    const left = (s.auth?.upcoming?.matches ?? []).filter(m => m.tournament_id === x.id && m.phase !== 'finished').length
    const n = x.started_at ? Math.max(1, left) : total
    // An unreadable start overlaps everything (as before the projection): nothing is moved out of the schedule's count.
    if (xEnd >= start || !Number.isFinite(start)) during += n
    else {
      before += n
      beforeEnd = Math.max(beforeEnd, xEnd)
    }
  }
  return { before, during, beforeEnd }
}

/**
 * Each card's condition at a tournament's start: today's plus what it regenerates up to the end of its other
 * tournaments' matches before then (at most 100), less an even share of what those matches cost, plus what it
 * regenerates from then to the start (at most 100). Resting is capped before the matches are paid for, so
 * regeneration that would be wasted at 100 never pays for them (agent review of PR #24). A start that is past or
 * unreadable is today's condition (a projection never guesses upward). Null: the agent's tournaments are unreadable.
 */
export function conditionAtStart(s: AgentSnapshot, t: { id?: number; starts_at: string; end?: number }, now: Date): { hours: number; during: number; at: (p: PlayerView) => number } | null {
  const cfg = s.config
  if (!cfg) return { hours: 0, during: 0, at: p => p.condition }
  const start = new Date(t.starts_at).getTime()
  const owed = otherMatches(s, cfg, t.id, now, start, t.end ?? start)
  if (!owed) return null
  const hours = hoursUntil(t.starts_at, now)
  const squad = matchSquad(s)
  const spent = hours > 0 && squad.length ? (owed.before * 11 * (cfg.condition_loss_per_match ?? 10)) / squad.length : 0
  const restBefore = owed.before ? Math.min(hours, Math.max(0, (owed.beforeEnd - now.getTime()) / 3600_000)) : 0
  const cap = (c: number) => Math.max(0, Math.min(MAX_CONDITION, c))
  return { hours, during: owed.during, at: p => (hours > 0 ? cap(cap(p.condition + regenPerHour(p, cfg) * restBefore) - spent + regenPerHour(p, cfg) * (hours - restBefore)) : p.condition) }
}

/**
 * Refuses a tournament whose schedule would wear the squad below the playable condition: every
 * appearance costs 11 starters the match loss, against the squad's condition above the floor at the
 * start (conditionAtStart: today's plus what it regenerates until then, less what its other tournaments
 * cost before then, at most 100) plus what it regenerates between rounds (half the rate after age 30).
 * Matches the squad already owes to tournaments it sits in, when their play overlaps, count too: two
 * tournaments at the same hour each look fine alone. Needs the snapshot's team and the agent's
 * tournaments (unreadable = refused).
 */
function scheduleRefusal(
  s: AgentSnapshot,
  t: { id?: number; format: string; max_teams: number; min_teams?: number; home_and_away?: boolean; round_interval_minutes?: number | null; starts_at: string },
  now: Date,
): string | null {
  const cfg = s.config
  if (!cfg || !s.team) return null
  const groupSize = cfg.tournament_defaults?.groups_knockout_group_size ?? 4
  const own = matchesAtMost(t.format, t.max_teams, Boolean(t.home_and_away), groupSize, t.min_teams)
  const interval = t.round_interval_minutes ?? 30
  const start = new Date(t.starts_at).getTime()
  const span = scheduleSpanMinutes(t.format, t.max_teams, Boolean(t.home_and_away), interval, groupSize)
  const end = start + span * 60_000
  const atStart = conditionAtStart(s, { id: t.id, starts_at: t.starts_at, end }, now)
  if (!atStart) return 'your current tournaments could not be read: not taking on another schedule blind'
  const owed = atStart.during
  const matches = own + owed
  if (matches <= 1) return null
  const hours = span / 60
  const floor = cfg.min_field_condition ?? 30
  const loss = cfg.condition_loss_per_match ?? 10
  // A card injured past the schedule's end plays none of it: it adds no condition (one out for a part still counts whole).
  const squad = matchSquad(s).filter(p => !outInjured(p, new Date(end)))
  const available = squad.reduce((sum, p) => sum + Math.max(0, atStart.at(p) - floor) + regenPerHour(p, cfg) * hours, 0)
  const needed = matches * 11 * loss
  if (t.format === 'league_knockout' && needed <= available) {
    // The binding stretch is the knockout: up to 9 matches within its 46 slots, from the squad as the league phase
    // leaves it (rested over its slots at most to 100, less an even share of its 8 matches; Fable review of PR #31).
    const leagueHours = (span - (LK_KNOCKOUT_SLOTS - 1) * interval) / 60
    const leagueCost = squad.length ? (LK_LEAGUE_MATCHES * 11 * loss) / squad.length : 0
    const atKnockout = (p: PlayerView) => Math.max(0, Math.min(MAX_CONDITION, atStart.at(p) + regenPerHour(p, cfg) * leagueHours) - leagueCost)
    const burstHours = ((LK_KNOCKOUT_SLOTS - 1) * interval) / 60
    const burst = squad.reduce((sum, p) => sum + Math.max(0, atKnockout(p) - floor) + regenPerHour(p, cfg) * burstHours, 0)
    const burstNeeded = LK_KNOCKOUT_MATCHES * 11 * loss
    return burstNeeded <= burst ? null : `the knockout would wear the squad down: up to ${LK_KNOCKOUT_MATCHES} matches in about ${Math.round(burstHours)} h need ~${burstNeeded} condition, the squad has ~${Math.round(burst)} above ${floor} with recovery`
  }
  if (needed <= available) return null
  const also = owed ? ` (${own} here plus ${owed} still owed to your other tournaments at the same time)` : ''
  const when = atStart.hours > 0 ? ` at its start in ${Math.round(atStart.hours)} h` : ''
  return `the schedule would wear the squad down: up to ${matches} matches${also} about every ${interval} min need ~${needed} condition, the squad has ~${Math.round(available)} above ${floor}${when} with recovery`
}

/**
 * Lineup strength as the match engine sees it: synced stats scaled by condition, stat x (50 +
 * condition/2) / 100, summed over the starting eleven. A rival's squad is taken at full condition
 * (it can rest or buy recovery before the match). Ours at today's condition, or at the one `condition`
 * gives (a tournament's start, conditionAtStart).
 */
export function lineupStrength(s: AgentSnapshot, condition: (p: PlayerView) => number = p => p.condition): number {
  return (s.team?.lineup ?? []).reduce((sum, n) => {
    const p = card(s, n)
    return sum + (p ? (p.syncedTotal * (50 + condition(p) / 2)) / 100 : 0)
  }, 0)
}

/**
 * Our eleven's OVR today, in the unit of FoxLeague's OVR range: each starter's card OVR (its 7 synced stats averaged,
 * rounded down, as FoxLeague's `models::card_ovr`) scaled by its condition, over the eleven (a slot without a card
 * counts 0). `lineup` and `condition` give another eleven or the condition after a change. Null when the team, the
 * roster or a starter's stats or condition could not be read (R54A-2).
 */
export function elevenOvrToday(s: AgentSnapshot, lineup: number[] | undefined = s.team?.lineup, condition: (p: PlayerView) => number = p => p.condition): number | null {
  if (!s.team || !s.players.length || !lineup?.length) return null
  let sum = 0
  for (const n of lineup) {
    const p = card(s, n)
    if (!p) continue
    const c = condition(p)
    if (!Number.isFinite(p.syncedTotal) || !Number.isFinite(c)) return null
    sum += (Math.floor(p.syncedTotal / 7) * (50 + Math.max(0, c) / 2)) / 100
  }
  return sum / 11
}

/**
 * The paid training sessions of this game day: the sessions past the free ones, both counted from the 14:00 UTC reset.
 * FoxLeague's premium_used_today counts training_slot purchases in the last 24 hours (shop.rs), not sessions (INTEG-1).
 */
export function paidSessionsToday(t: { used_today: number; daily_free: number }): number {
  return Math.max(0, t.used_today - t.daily_free)
}

/** The condition a training session costs a card (FoxLeague's `training_condition_loss`, not public), before age. */
export const TRAINING_CONDITION_LOSS = 5

/**
 * An open 1v1 of ours waiting for an opponent was created while a team at the top of its range was at most 10 percent
 * stronger than our eleven (R54A-1); a change while it waits keeps it so (agent review of PR #54, R54A-3): a ranked
 * start, training a starter, another eleven. `lineup` and `condition` describe the eleven after the change. Our
 * tournaments unread: refused only while an open challenge of ours may still wait (`ctx.openChallengeRecent`).
 */
function waitingOpenRefusal(s: AgentSnapshot, ctx: RulesContext, what: string, lineup: number[] | undefined, condition: (p: PlayerView) => number = p => p.condition): string | null {
  const mine = s.auth?.myTournaments
  if (!mine) return ctx.openChallengeRecent ? `your current tournaments could not be read and an open challenge of yours may still wait: no ${what} blind` : null
  // A target the answer leaves out is no target: checked as open (R54A-6).
  const waiting = mine.active.filter(t => t.max_teams === 2 && NOT_STARTED_STATUSES.has(t.status) && t.creator_user_id === s.profile?.id && !t.targeted && typeof t.target_user_id !== 'number')
  for (const t of waiting) {
    // An eleven already below the bar (a tournament match during the wait) may still be made stronger (R54A-4), whatever
    // the range says (R54A-7).
    const after = elevenOvrToday(s, lineup, condition)
    const now = elevenOvrToday(s)
    if (after !== null && now !== null && after >= now) continue
    const top = t.ovr_max
    if (typeof top !== 'number' || !Number.isFinite(top)) return `the range of your open challenge T${t.id} could not be read: no ${what} while it waits`
    if (after === null) return `your open challenge T${t.id} waits and your eleven after this ${what} could not be read: no ${what} blind`
    if (top > after * MAX_1V1_STRENGTH_RATIO) return `your open challenge T${t.id} waits for an opponent (up to OVR ${top}): after this ${what} your eleven would play at OVR ${after.toFixed(1)}, more than 10 percent below a fresh team at its top; wait until it is taken or expires, or leave it first`
  }
  return null
}

/**
 * A 1v1 against a known team needs at least this win chance (Zeus's floor, every level's since 2026-11-06: a 1v1 pays
 * on average from about 56 percent); a seated team is clearly stronger with both margins below.
 */
export const MIN_1V1_CHANCE = 0.55
export const STRONGER_SQUAD = 1.05
export const STRONGER_ELO = 50
/** What "clearly stronger" counts, for a refusal: the same margins judgeField uses. */
const STRONGER_WORDS = `a lineup more than ${Math.round((MAX_1V1_STRENGTH_RATIO - 1) * 100)} percent above yours, or more than ${Math.round((STRONGER_SQUAD - 1) * 100)} percent with an ELO more than ${STRONGER_ELO} above yours`
/** No entry into a field with this many clearly stronger teams, or this many unread (every level since 2026-11-06). */
export const FIELD_LIMIT = 3

/** One seated team of a tournament: its lineup strength at full condition and its ELO, null when unread. */
export interface FieldSeat {
  userId: number
  strength: number | null
  elo: number | null
}

/**
 * How a seated field compares with us, the one test the join rule and the plan's field line both use. Clearly
 * stronger: a lineup that was read and is more than 10 percent above ours (MAX_1V1_STRENGTH_RATIO, the margin a 1v1
 * is refused at), whatever its ELO; or a lineup more than 5 percent above ours with an ELO more than 50 above ours; a
 * lineup that could not be read counts when its ELO alone is clearly higher. ELO is the one number a rival controls
 * downward (a new team starts at 1200, a team can lose on purpose), so it may add to what the lineups say and never
 * take away from it: a field of elevens far stronger than ours at a low ELO is no even field (audit 2026-11-11,
 * MONEY-1). Clearly weaker: both margins the other way, both known. Unread: neither known. The rest is even (or known
 * only in part).
 */
export function judgeField(field: FieldSeat[], ours: number, myElo: number): { stronger: number; weaker: number; even: number; unread: number; strongestElo: number | null; strongestLineup: number | null } {
  const isStronger = (f: FieldSeat) =>
    (f.strength !== null && f.strength > ours * MAX_1V1_STRENGTH_RATIO) || (f.elo !== null && f.elo > myElo + STRONGER_ELO && (f.strength === null || f.strength > ours * STRONGER_SQUAD))
  const stronger = field.filter(isStronger).length
  const weaker = field.filter(f => f.elo !== null && f.elo < myElo - STRONGER_ELO && f.strength !== null && f.strength * STRONGER_SQUAD < ours).length
  // A seat known only in part (its ELO or its lineup unread) and not already clearly stronger is unread, never even
  // (grand audit 2026-11-06, EDGE-2).
  const unread = field.filter(f => !isStronger(f) && (f.strength === null || f.elo === null)).length
  const elos = field.map(f => f.elo).filter((e): e is number => e !== null)
  const lineups = field.map(f => f.strength).filter((x): x is number => x !== null)
  return { stronger, weaker, unread, even: field.length - stronger - weaker - unread, strongestElo: elos.length ? Math.max(...elos) : null, strongestLineup: lineups.length ? Math.max(...lineups) : null }
}

/** The 1v1 gates both join and create share: a known, not stronger opponent, not farmed every day. */
function oneVOneOpponentRefusal(s: AgentSnapshot, ctx: RulesContext): string | null {
  const opp = ctx.opponent
  if (!opp || opp.elo === null) return "the opponent's strength could not be read"
  const mine = s.profile?.elo_rating
  // An ELO that cannot be read is no 1200 (EDGE-1).
  if (typeof mine !== 'number' || !Number.isFinite(mine)) return 'your own ELO could not be read: no 1v1 blind'
  if (opp.elo - mine >= MAX_1V1_ELO_GAP) return `the opponent is far stronger (ELO ${opp.elo} vs ${mine})`
  // ELO alone is the one number a rival controls (new teams start at 1200): compare the squads too.
  if (opp.strength === null || opp.strength === undefined) return "the opponent's squad could not be read"
  const ours = lineupStrength(s)
  if (opp.strength > ours * MAX_1V1_STRENGTH_RATIO) return `the opponent's squad is stronger (lineup strength ${Math.round(opp.strength)} vs ours ${Math.round(ours)} at today's condition)`
  if ((ctx.oneVOneWithOpponentThisWeek ?? 0) >= MAX_1V1_PER_OPPONENT_WEEK) return `already ${MAX_1V1_PER_OPPONENT_WEEK} 1v1s against user ${opp.userId} in the last 7 days`
  const p = winChance({ myElo: mine, oppElo: opp.elo, myStrength: ours || null, oppStrength: opp.strength })
  if (p !== null && p < MIN_1V1_CHANCE) return `the win chance against user ${opp.userId} is about ${percent(p)}; a 1v1 against a known team is played from ${percent(MIN_1V1_CHANCE)}`
  return null
}

/**
 * The 1v1 gates FoxLeague applies after the stake is paid (one active 1v1 at a time, not busy with a tournament),
 * checked from the agent's own state. Either route unreadable is no "none": the stake is not paid blind.
 */
function oneVOneStateRefusal(s: AgentSnapshot, now: Date): string | null {
  const mine = s.auth?.myTournaments
  if (!mine) return 'your current tournaments could not be read (an active 1v1 is unknown): not paying a stake blind'
  if (mine.active.some(x => x.max_teams === 2)) return 'already in an active 1v1'
  if (!s.auth?.upcoming) return 'your upcoming matches could not be read (whether a tournament keeps you busy is unknown): not paying a stake blind'
  const busy = oneVOneBusy(s, now)
  if (busy) return `busy with a tournament, FoxLeague refuses a 1v1 now: ${busy}`
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

/** Fixture phases a booster bought now still doubles: FoxLeague awards a match's XP when its result is applied. */
const BOOSTER_PHASES = new Set(['upcoming', 'locked', 'live'])

/**
 * Why the XP booster would have nothing of its own to double, or null (every level since 2026-11-06): it needs a Silver or Gold tournament
 * or 1v1 match of its own listed, not over, kicking off within the booster's 24 hours, or a paid Bronze one once the
 * competition levels are live (casual and free Bronze matches earn no XP; a ranked game is no fixture to count on). FoxLeague reads the booster when a match's result is applied (at the reveal of a tournament or
 * 1v1 match; matches.rs apply_match_results, a purchase verified within the last 24 h), so buying it once the fixture
 * is drawn loses nothing, while a seat in an open tournament can still come back (audit D9, 2026-10-23). Either list
 * unreadable is no "none".
 */
function noBoosterFixture(s: AgentSnapshot, now: Date): string | null {
  const upcoming = s.auth?.upcoming
  const mine = s.auth?.myTournaments
  if (!upcoming || !mine) return 'your fixtures could not be read: the XP booster is bought only for competitive matches of your own'
  const sure = upcoming.matches.some(m => {
    const at = Date.parse(m.scheduled_at)
    const t = mine.active.find(x => x.id === m.tournament_id)
    const earns = t?.tier === 'silver' || t?.tier === 'gold' || (t?.tier === 'bronze' && t.entry_fee_foxsy > 0 && paidBronzeEarns(s.config, now, t.is_private))
    return BOOSTER_PHASES.has(m.phase) && Number.isFinite(at) && at - now.getTime() <= 24 * 3600_000 && earns
  })
  return sure ? null : 'no competitive match of yours is scheduled in the next 24 hours (a seat in an open tournament can still come back): the XP booster is bought once your fixtures are drawn'
}

/**
 * Why the agent would not list this card (the squad checks of list_card), or null: outside the lineup and bench, at
 * least 18 cards left after it and not among the CORE_CARDS strongest. A Legendary's match waiver is bought only then.
 */
function listingBlocked(s: AgentSnapshot, c: PlayerView): string | null {
  if (inSquad(s, c.nonce)) return `#${c.nonce} is in the lineup or on the bench`
  const unlisted = s.players.filter(p => !p.listed)
  if (unlisted.length - 1 < 18) return 'listing it would leave fewer than 18 cards; a match needs 18'
  const rank = [...unlisted].sort((x, y) => y.syncedTotal - x.syncedTotal).findIndex(p => p.nonce === c.nonce)
  if (rank >= 0 && rank < CORE_CARDS) return `#${c.nonce} is among the ${CORE_CARDS} strongest cards: the agent sells only spares`
  return null
}

/**
 * The agent's own team could not be read (FoxLeague answered without its lineup, or not at all). Nothing that
 * depends on who plays may run blind: no lineup or formation change, no match, and no card leaves the squad.
 */
const TEAM_UNREADABLE = 'the team could not be read (lineup and bench unknown): not acting blind'

function inSquad(s: AgentSnapshot, nonce: number): boolean {
  return Boolean(s.team && (s.team.lineup.includes(nonce) || s.team.substitutes.includes(nonce)))
}

function canFuseReason(c: CanFuse): string {
  // FoxLeague serves the spacing left as text ("0d 19h"); a number is seconds (an older answer).
  const left = typeof c.cooldown_remaining === 'number' && Number.isFinite(c.cooldown_remaining) ? `${Math.ceil(c.cooldown_remaining / 3600)} h` : typeof c.cooldown_remaining === 'string' && /^\d+d \d+h$/.test(c.cooldown_remaining) ? c.cooldown_remaining : null
  if (c.cooldown_remaining) return `wallet fusion cooldown${left ? `, ${left} left` : ''}${c.cooldown_end ? ` (until ${c.cooldown_end})` : ''}`
  const who = (c.dirty_players ?? c.blocked_players ?? []).map(n => `#${n}`).join(', ')
  return `${c.reason ?? 'not fusable'}${who ? ` (${who})` : ''}`
}

/**
 * The fusion that mints its result, from FoxLeague's switch on (the agent's own card checks passed before): FoxLeague's
 * prepare checked the cards on chain, the wallet spacing, the injuries and the bans before it signed the new card. The agent
 * signs its answer only when it is exactly the fusion planned (fusionMintTx) and pays exactly the fee of the rarity,
 * within the max shop payment (the FOXSY in the wallet is checked by the caller). An unanswered prepare is no "yes";
 * FoxLeague's refusal is its word. Not asked yet (FUSION_UNASKED), the fusion is allowed `unprepared`, with nothing to
 * sign: the executor asks the prepare only then and checks again with its answer.
 */
function mintFusion(a: Extract<Action, { type: 'fuse' }>, s: AgentSnapshot, ctx: RulesContext, inputs: PlayerView[]): Verdict {
  const rarity = inputs[0]!.rarity
  if (rarity === 'Legendary') return refuse('a Legendary cannot be fused')
  const fee = s.config?.fusion_costs_foxsy?.[RARITY_LEVEL[rarity]]
  if (!fee) return refuse(`fusion cost for ${rarity} unknown`)
  if (fee > ctx.settings.maxShopPaymentFoxsy) return refuse(`a fusion fee of ${fee} FOXSY exceeds the per-action maximum ${ctx.settings.maxShopPaymentFoxsy} (Max shop payment)`)
  const output = `${NEXT_RARITY[RARITY_LEVEL[rarity]]} ${inputs[a.position_of]!.position}`
  const p = ctx.fusionPrepared
  if (p === FUSION_UNASKED) return allow(fee, { fee, nonces: a.player_nonces, positionChoice: a.position_of, unprepared: true }, 'play', [`2 cards fewer, a new ${output} in their place (minted now, level 1, condition 100)`])
  if (p === null || p === undefined) return refuse("the fusion could not be prepared (FoxLeague's /fusion/prepare gave no answer): not fusing blind")
  if ('refusal' in p) return refuse(`FoxLeague says not now: ${p.refusal}`)
  try {
    fusionMintTx(s.agent.address, p, { feeAtomic: wholeToAtomic(fee), nonces: a.player_nonces, positionChoice: a.position_of, now: ctx.now })
  } catch (err) {
    return refuse(err instanceof Error ? err.message : String(err))
  }
  return allow(fee, { fee, nonces: a.player_nonces, positionChoice: a.position_of, prepared: p }, 'play', [`2 cards fewer, ${mintedText(p) ?? `a new ${output}`} in their place (minted now, level 1, condition 100)`])
}

/** What FoxLeague's preview says the fusion mints, from numbers and known words only, or null when it is not readable. */
function mintedText(p: FusionPrepared): string | null {
  const v = p.preview
  const rarities = ['Uncommon', 'Rare', 'Epic', 'Legendary']
  if (!v || !rarities.includes(v.rarity) || !['GK', 'DEF', 'MID', 'FWD'].includes(v.position) || !Number.isInteger(v.ovr) || !Array.isArray(v.stats)) return null
  const stats = v.stats.filter(x => (STATS as readonly string[]).includes(x?.stat) && Number.isInteger(x.value)).map(x => `${x.stat} ${x.value}`)
  return `a new ${v.rarity} ${v.position}, OVR ${v.ovr}${stats.length === 7 ? ` (${stats.join(', ')})` : ''}`
}

/**
 * Out of every match at `at` (FoxLeague, card_injuries.rs: injured_until past the kickoff), or its injury unread
 * once the bans are live: unknown is not healthy.
 */
export function outInjured(p: PlayerView, at: Date): boolean {
  return p.disciplineUnread === true || (p.injuredUntil !== null && Date.parse(p.injuredUntil) > at.getTime())
}

/**
 * How many of the eleven shirts FoxLeague's 1v1 gate fills with a match-fit card (squad_would_forfeit, which runs the
 * lock's own auto_substitute; fewer than 11 is a forfeit, refused after the stake is paid). Fit: condition, no transfer
 * cooldown, not injured. It is no count of fit cards among the 18: a shirt whose starter is not fit is filled from the
 * bench by FoxLeague's line rule (tournament_simulator.rs line_distance, find_best_sub, last_resort_keeper): an
 * outfield shirt only by a fit outfield bench card, never the bench keeper; the keeper's shirt by a fit bench keeper,
 * else by a fit outfield bench card as the last resort. An injured bench card is off the bench (held out). The saved
 * eleven fits its formation (squadLegal), so a starter's position is his shirt's line (audit 2026-11-11, INTEG-1).
 */
function matchFit(s: AgentSnapshot, minCondition: number, at: Date): number {
  const fit = (p: PlayerView | undefined): boolean => Boolean(p && p.condition >= minCondition && !p.transferLockedUntil && !outInjured(p, at))
  const bench = s.team!.substitutes.map(n => card(s, n)).filter(fit)
  let keepers = bench.filter(p => p?.position === 'GK').length
  let outfield = bench.length - keepers
  let filled = 0
  for (const n of s.team!.lineup) {
    const p = card(s, n)
    if (fit(p)) filled++
    else if (p?.position === 'GK' && keepers > 0) { keepers--; filled++ }
    else if (outfield > 0) { outfield--; filled++ }
  }
  return filled
}

/** The words of the 1v1 gate's refusal: what counts as match-fit, and who may take a tired starter's shirt. */
const matchFitRefusal = (fit: number, minCondition: number): string =>
  `only ${fit} match-fit players for the eleven shirts (condition >= ${minCondition}, no transfer cooldown, not injured; a tired outfield starter is relieved only by a fit outfield bench card, never the bench keeper)`

/**
 * `at`: when the match is played (now for a game, a 1v1 or a casual test; a tournament's start for an entry). A
 * starter injured then is refused: every strength the rules compare is the saved eleven's, and FoxLeague would put a
 * bench card of its own choice in the shirt. `what` names the moment in the reason.
 */
function squadLegal(s: AgentSnapshot, at: Date, what = ''): string | null {
  if (!s.team) return 'no team'
  if (s.team.lineup.length !== 11) return 'lineup does not have 11 players'
  if (s.team.substitutes.length !== 7) return `bench has ${s.team.substitutes.length}/7 substitutes`
  for (const n of [...s.team.lineup, ...s.team.substitutes]) {
    const p = card(s, n)
    if (!p) return `#${n} in the squad is not in the wallet`
    if (p.listed) return `#${n} is listed for sale`
    if (p.transferLockedUntil) return `#${n} is in a transfer cooldown until ${p.transferLockedUntil}`
    // Stats or condition FoxLeague's answer left out make the squad's strength NaN, which no "stronger than" test
    // catches (grand audit 2026-11-06, EDGE-1): no match, entry or 1v1 on a squad that cannot be read.
    if (!Number.isFinite(p.syncedTotal) || !Number.isFinite(p.condition)) return `#${n}'s stats or condition could not be read: not acting blind`
  }
  for (const n of s.team.lineup) {
    const p = card(s, n)!
    if (p.disciplineUnread) return `#${n}'s injury could not be read: not acting blind`
    if (outInjured(p, at)) return `starter #${n} is injured until ${p.injuredUntil}${what}: save an eleven without it first (set_lineup, or set_formation with a lineup when its line is short)`
  }
  const fit = lineupPositionsOk(s, s.team.formation, s.team.lineup)
  if (fit) return `the saved lineup does not fit the formation ${s.team.formation} (${fit}): save one that fits first (set_formation with lineup and substitutes, or set_lineup)`
  return null
}

/** An eleven and bench for `formation`: cards in the wallet, free to play, each starter in a slot of its position. */
function lineupVerdict(s: AgentSnapshot, formation: string, lineup: number[], substitutes: number[], minCondition: number, now: Date): Verdict {
  const all = [...lineup, ...substitutes]
  if (new Set(all).size !== all.length) return refuse('a card appears twice')
  for (const n of all) {
    const p = card(s, n)
    if (!p) return refuse(`#${n} is not in the wallet`)
    if (p.listed) return refuse(`#${n} is listed for sale`)
    if (p.transferLockedUntil) return refuse(`#${n} is in a transfer cooldown`)
  }
  const bad = lineupPositionsOk(s, formation, lineup)
  if (bad) return refuse(bad)
  const notes: string[] = []
  if (substitutes.length < 7) notes.push('fewer than 7 substitutes: the server fills the bench')
  const tired = lineup.filter(n => (card(s, n)?.condition ?? 0) < minCondition)
  if (tired.length) notes.push(`starters under condition ${minCondition}: ${tired.map(n => `#${n}`).join(',')}`)
  // Saving is free and the next match may fall after the injury; no match starts while one is in the eleven (squadLegal).
  for (const n of lineup) {
    const p = card(s, n)!
    if (outInjured(p, now)) notes.push(p.injuredUntil ? `starter #${n} is injured until ${p.injuredUntil}: no match starts with it in the eleven` : `starter #${n}'s injury could not be read`)
  }
  return allow(0, {}, 'play', notes)
}

/** Why `lineup` does not fit `formation` (slot order GK, DEF, MID, FWD; FoxLeague refuses such a save since rc.78), or null. */
export function lineupPositionsOk(s: AgentSnapshot, formation: string, lineup: number[]): string | null {
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
      // Whether the team exists decides the swap's allowance (setup budget or daily cap): unknown is not "unregistered".
      if (s.registration.profileUnreadable) return refuse('team registration state could not be read (profile route failed): no swap this tick, the next plan tries again')
      if (!cfg.dex_swap_enabled) return refuse('the FoxLeague swap is switched off (dex_swap_enabled false)')
      const max = Math.min(ctx.settings.maxSwapFoxsy, typeof cfg.dex_swap_max_foxsy === 'number' ? cfg.dex_swap_max_foxsy : 50_000)
      if (a.foxsy > max) return refuse(`swap of ${a.foxsy} FOXSY exceeds the per-swap limit ${max}`)
      return allow(0, { foxsyOut: wholeToAtomic(a.foxsy), slippageBps: cfg.dex_swap_slippage_bps }, registered ? 'play' : 'setup')
    }

    case 'register': {
      const r = s.registration
      if (r.profileUnreadable) return refuse('team registration state could not be read (profile route failed): nothing paid, the next plan tries again', 'setup')
      if (r.registered) return refuse('already registered', 'setup')
      if (r.whitelisted === false) return refuse('wallet not whitelisted (registration.whitelist_required is on)', 'setup')
      if (!r.relayerEnabled) return refuse('registration relayer is off', 'setup')
      if ((r.relaysRemaining ?? 0) <= 0) return refuse('relayer daily cap reached', 'setup')
      if (r.feePaidOnChain) return allow(0, { feePaid: true }, 'setup', ['fee already paid on chain: only POST /api/register'])
      // Unknown is not unpaid: a failed profile read also looks like an unregistered team, and the fee path below
      // would pay 5,000 FOXSY again. Nothing is paid; the next plan tries again.
      if (r.feePaidOnChain === null) return refuse('registration fee state could not be read (isRegistrationPaid failed): nothing paid, the next plan tries again', 'setup')
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
      // Whether this session is paid, and how many paid ones the game day has had: the sessions past the free ones
      // (FoxLeague's premium_used_today counts purchases in 24 hours, not sessions: grand audit 2026-11-06, INTEG-1).
      // Numbers it cannot read are no count (EDGE-3, R55A-3).
      if (!Number.isFinite(t.used_today) || !Number.isFinite(t.daily_free)) return refuse('training quota unknown (the sessions used today or the free ones could not be read)')
      const paid = t.used_today >= t.daily_free
      if (paid && (t.premium_used_today >= t.premium_cap || t.slots_banked <= 0)) return refuse(`daily training exhausted (${t.used_today} used, ${t.slots_banked} paid slots banked)`)
      if (paid && (!Number.isFinite(t.premium_used_today) || !Number.isFinite(t.slots_banked))) return refuse('training quota unknown (the paid sessions used or banked could not be read)')
      const paidToday = paidSessionsToday(t)
      if (paid && paidToday >= ctx.settings.paidTrainingPerDay) return refuse(`${ctx.settings.paidTrainingPerDay} paid training sessions a day at this level, ${paidToday} used today`)
      // The team unread: the card may be a starter (R54A-5).
      if (!s.team || s.team.lineup.includes(p.nonce)) {
        const waits = waitingOpenRefusal(s, ctx, 'training', s.team?.lineup, q => (q.nonce === p.nonce ? q.condition - appearanceCost(q, TRAINING_CONDITION_LOSS) : q.condition))
        if (waits) return refuse(waits)
      }
      return allow(0, { usesPaidSlot: paid })
    }

    case 'set_formation': {
      if (!registered) return refuse('not registered')
      if (!s.team) return refuse(TEAM_UNREADABLE)
      if (s.team.formation === a.formation) return refuse(`formation is already ${a.formation}${a.lineup ? ' (a new eleven alone is set_lineup)' : ''}`)
      // With a lineup both go in one save; alone, FoxLeague refuses a shape the saved eleven does not fit.
      if (a.lineup) {
        const waits = waitingOpenRefusal(s, ctx, 'lineup', a.lineup)
        if (waits) return refuse(waits)
        return lineupVerdict(s, a.formation, a.lineup, a.substitutes ?? [], cfg.min_field_condition, ctx.now)
      }
      const mismatch = lineupPositionsOk(s, a.formation, s.team.lineup)
      if (mismatch) return refuse(`${a.formation} needs a lineup that fits it (${mismatch}): send set_formation with lineup and substitutes in its slot order`)
      return allow(0, {}, 'play')
    }

    case 'set_lineup': {
      if (!registered) return refuse('not registered')
      if (!s.team) return refuse(TEAM_UNREADABLE)
      const waits = waitingOpenRefusal(s, ctx, 'lineup', a.lineup)
      if (waits) return refuse(waits)
      return lineupVerdict(s, s.team.formation, a.lineup, a.substitutes, cfg.min_field_condition, ctx.now)
    }

    case 'play_match': {
      if (!registered) return refuse('not registered')
      if (!s.team) return refuse(TEAM_UNREADABLE)
      const al = s.auth?.allowance
      if (!al) return refuse('daily allowance unknown')
      if (al.today_count >= al.daily_limit) return refuse(`daily match limit reached (${al.today_count}/${al.daily_limit})`)
      if (s.auth?.activeMatch) return refuse(`already in match #${s.auth.activeMatch.match_id ?? s.auth.activeMatch.tournament_match_id ?? '?'}`)
      const busy = tournamentMatchWithinHour(s, ctx.now)
      if (busy) return refuse(s.auth?.upcoming ? `pre-match lockout: ${busy}` : `${busy} (the pre-match lockout is unknown): no match started blind`)
      const legal = squadLegal(s, ctx.now)
      if (legal) return refuse(legal)
      // A casual test is played by its own eleven (agent review of PR #49).
      const exhausted = (a.match_type === 'casual' && a.test ? a.test.lineup : s.team.lineup).filter(n => (card(s, n)?.condition ?? 0) <= 0)
      if (exhausted.length) return refuse(`starters at condition 0: ${exhausted.map(n => `#${n}`).join(',')}`)
      if (a.match_type === 'casual') {
        // The casual test bench (owner, 2026-11-04): an eleven that fits its formation, and only when the condition it
        // costs is back before the next match that counts. No count of its own: casual and ranked share FoxLeague's
        // daily starts (owner, 2026-11-06, OP-7).
        if (a.test) {
          const fit = lineupVerdict(s, a.test.formation, a.test.lineup, a.test.substitutes, cfg.min_field_condition, ctx.now)
          if (!fit.ok) return fit
          // FoxLeague would start the game with a bench card in an injured starter's shirt: not the eleven under test.
          const hurt = a.test.lineup.map(n => card(s, n)!).find(p => outInjured(p, ctx.now))
          if (hurt) return refuse(hurt.injuredUntil ? `#${hurt.nonce} is injured until ${hurt.injuredUntil}: a test eleven plays without it` : `#${hurt.nonce}'s injury could not be read: not testing blind`)
        }
        const cost = casualCostRefusal(s, a.test ? [...a.test.lineup, ...a.test.substitutes] : [...s.team.lineup, ...s.team.substitutes], ctx.now)
        if (cost) return refuse(cost)
      }
      if (ctx.lastMatchStartAt && ctx.now.getTime() - ctx.lastMatchStartAt.getTime() < MATCH_COOLDOWN_MS) return refuse('match cooldown (30 s)')
      if (a.match_type === 'ranked' && ctx.lastRankedStartAt && ctx.now.getTime() - ctx.lastRankedStartAt.getTime() < RANKED_COOLDOWN_MS) return refuse('ranked cooldown (15 min)')
      if (a.match_type === 'ranked') {
        const waits = waitingOpenRefusal(s, ctx, 'ranked game', s.team.lineup, p => p.condition - appearanceCost(p, cfg.condition_loss_per_match_ranked))
        if (waits) return refuse(waits)
      }
      if (a.match_type === 'ranked' && levelsLive(cfg, ctx.now)) {
        // One ticket per game, paid before the draw. Tickets that cannot be read are no "none": it could pay for nothing.
        if (ctx.pendingTicket) return refuse("a ranked ticket payment is still waiting for FoxLeague's confirmation: not paying twice")
        const ticket = ctx.rankedTicket
        if (!ticket) return refuse('your ranked tickets could not be read: no ranked start blind')
        if (ticket.tickets > 0) return allow(0, { ticket: 'held' })
        const price = ticket.price_foxsy
        if (!Number.isSafeInteger(price) || price <= 0) return refuse('the ranked ticket price could not be read: not paying blind')
        if (price > ctx.settings.maxShopPaymentFoxsy) return refuse(`a ranked ticket of ${price} FOXSY exceeds the per-action maximum ${ctx.settings.maxShopPaymentFoxsy}`)
        return needFoxsy(price, allow(price, { ticket: 'buy' }, 'play', [`a ranked ticket of ${price} FOXSY, once FoxLeague asks for one`]))
      }
      return allow(0)
    }

    case 'join_tournament': {
      if (!registered || !s.profile) return refuse('not registered')
      const d = ctx.tournament
      if (!d) return refuse(`tournament T${a.tournament_id} not found`)
      const t: Tournament = d.tournament
      if (t.status !== 'open') return refuse(`T${t.id} is ${t.status}`)
      // A deadline that is no time is unread, never "still ahead".
      const deadline = Date.parse(t.deadline)
      if (!Number.isFinite(deadline)) return refuse(`T${t.id}'s registration deadline could not be read: not joining blind`)
      if (deadline <= ctx.now.getTime()) return refuse(`T${t.id} registration deadline passed`)
      // FoxLeague checks the deadline when POST /join arrives, not when the payment landed (tournaments.rs: "Registration
      // deadline has passed", the entry refunded and the gas lost). A payment signed now settles and reaches that gate a
      // minute or two later, the margin the 1v1 busy hour has (audit 2026-11-11, INTEG-5). A free seat signs nothing.
      const paidEntry = !(t.tier === 'bronze' && !(t.entry_fee_foxsy > 0))
      if (paidEntry && deadline - ctx.now.getTime() <= BUSY_OPENS_MARGIN_S * 1000) return refuse(`T${t.id}'s registration deadline is in ${Math.max(0, Math.round((deadline - ctx.now.getTime()) / 1000))} s: a payment signed now reaches FoxLeague's join after it (the entry refunded, the gas lost)`)
      if (t.is_private && d.user_can_join_private !== true) return refuse(`T${t.id} is private and this team is not invited`)
      if (t.developer_mode) return refuse(`T${t.id} is a developer tournament`)
      const unknownJoin = unsupportedFormat(t.format, 'joining')
      if (unknownJoin) return refuse(unknownJoin)
      // A tier that is none of FoxLeague's three is unread, as an unknown format is: every tier rule below would pass it
      // by. Its label is not repeated (audit 2026-11-11, MONEY-4).
      if (t.tier !== 'bronze' && t.tier !== 'silver' && t.tier !== 'gold') return refuse(`T${t.id} is of a tier the agent does not know: not joining blind`)
      if (!ctx.settings.entryFeesGold.length) {
        if (t.tier === 'gold') return refuse(`Gold is off for this agent: no Gold amounts in its settings`)
        // Gold off holds by the amount too, whatever the label says: an entry from FoxLeague's Gold bound up is a Gold
        // amount. A bound that cannot be read is no bound far away.
        if (t.entry_fee_foxsy > 0) {
          const goldMin: unknown = cfg.tournament_fee_bounds?.gold_min
          if (typeof goldMin !== 'number' || !Number.isFinite(goldMin)) return refuse('Gold is off for this agent and the Gold fee bound could not be read: not joining blind')
          if (t.entry_fee_foxsy >= goldMin) return refuse(`Gold is off for this agent: an entry of ${t.entry_fee_foxsy} FOXSY is a Gold amount (from ${goldMin}), whatever the tournament is labelled`)
        }
      }
      const lk = t.format === 'league_knockout'
      if (lk) {
        // By invitation only, read again right before the payment: the contract admits only invited wallets (paying
        // without being listed loses the gas). FoxLeague's own refusal can quote a title others wrote: not repeated here.
        const inv = ctx.invitation
        if (inv === null || inv === undefined) return refuse('the invitations could not be read: not paying blind')
        if (inv === 'not invited' || inv.tournament_id !== t.id) return refuse(`T${t.id} is a League + Knockout, by invitation only, and this team has no pending invitation to it`)
        if (!inv.can_accept) return refuse('FoxLeague says this invitation cannot be accepted now (one League + Knockout at a time, or the wallet is not on its on-chain list yet): not paying')
        if (!(Date.parse(inv.expires_at) - ctx.now.getTime() > INVITATION_MARGIN_MS)) return refuse('the invitation expires within 30 minutes: not paying at its edge')
      }
      // An OVR range (FoxLeague, 2026-10-24) is checked once at the join against the best XI OVR; outside it the paid
      // entry is refunded and the gas lost, so the agent joins only inside it, never blind.
      // FoxLeague compares the best XI OVR to one decimal (held in tenths, ovr_range.rs), the value its route answers.
      const lo = t.ovr_min ?? null
      const hi = t.ovr_max ?? null
      if (lo !== null || hi !== null) {
        const known = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v))
        if (!known(lo) || !known(hi)) return refuse(`T${t.id} carries an OVR range the agent cannot read: not paying blind`)
        const ovr = ctx.bestXiOvr
        if (typeof ovr !== 'number' || !Number.isFinite(ovr)) return refuse('your best XI OVR could not be read: not paying into an OVR range blind')
        if (lo !== null && ovr < lo) return refuse(`T${t.id} takes teams with a best XI OVR from ${lo}; yours is ${ovr}`)
        if (hi !== null && ovr > hi) return refuse(`T${t.id} takes teams with a best XI OVR up to ${hi}; yours is ${ovr}`)
      }
      const running = runningLeagueKnockout(s)
      if (t.max_teams > 2 && running && running.id !== t.id) return refuse(`your team is in T${running.id}, a League + Knockout that has started: no other tournament until it is over (1v1s and ranked stay open)`)
      const myId = s.profile.id
      if (d.participants.some(p => p.user_id === myId)) return refuse(`already in T${t.id}`)
      if (ctx.pendingJoin) return refuse(`a seat in T${t.id} is already paid and waiting for FoxLeague's confirmation: not paying twice`)
      if (d.participants.length >= t.max_teams) return refuse(`T${t.id} is full`)
      const oneVOne = t.max_teams === 2
      // A 1v1 locks minutes after the join; a tournament's first lineup locks at its start (a start that cannot be
      // read is judged as now, the stricter of the two).
      const startsAt = Date.parse(t.starts_at)
      const legal = oneVOne || !(startsAt > ctx.now.getTime()) ? squadLegal(s, ctx.now) : squadLegal(s, new Date(startsAt), `, past the start of T${t.id}`)
      if (legal) return refuse(legal)
      if (oneVOne) {
        if ((t.targeted || t.target_user_id !== null) && t.target_user_id !== s.profile.id && !t.targeted_to_you) return refuse('1v1 is locked to another opponent')
        if (d.participants.length < 1) return refuse('1v1 creator has not paid yet')
        const opp = oneVOneOpponentRefusal(s, ctx)
        if (opp) return refuse(opp)
        // FoxLeague's own answer by the rows of its join gate (it answers false on its own failed read: the rules below still decide).
        if (d.viewer_blocked_tournament_window === true) return refuse('FoxLeague says this team is busy with a tournament (viewer_blocked_tournament_window): it would refuse the join after the stake is paid')
        // The seconds until that gate turns on (FoxLeague, 2026-11-03): a stake signed now reaches the join after it.
        const opens = d.viewer_tournament_window_opens_in_secs
        if (typeof opens === 'number' && opens <= BUSY_OPENS_MARGIN_S) return refuse(`FoxLeague says this team is busy with a tournament in ${Math.max(0, Math.round(opens))} s (viewer_tournament_window_opens_in_secs): it would refuse the join after the stake is paid`)
        const blind = oneVOneStateRefusal(s, ctx.now)
        if (blind) return refuse(blind)
        const fit = matchFit(s, cfg.min_field_condition, ctx.now)
        if (fit < 11) return refuse(matchFitRefusal(fit, cfg.min_field_condition))
      }
      if (!oneVOne) {
        const worn = scheduleRefusal(s, t, ctx.now)
        if (worn) return refuse(worn)
        // Every level (Zeus's rule until 2026-11-06) enters only with a chance of the top three: not when three seated
        // teams are clearly stronger. A League + Knockout is judged on its invited teams, with a chance of the knockout
        // (places 1 to 24, owner 2026-10-24).
        if (lk) {
          if (!ctx.field) return refuse('the invited teams could not be read: no field is accepted blind')
          const atStart = conditionAtStart(s, t, ctx.now)
          if (!atStart) return refuse('your current tournaments could not be read: no field is judged blind')
          if (!Number.isFinite(s.profile.elo_rating)) return refuse('your own ELO could not be read: no field is judged blind')
          const field = judgeField(ctx.field, lineupStrength(s, atStart.at), s.profile.elo_rating)
          if (field.stronger >= LK_KNOCKOUT_PLACES) return refuse(`${field.stronger} of the invited teams are clearly stronger (${STRONGER_WORDS}): no real chance of the knockout`)
          if (field.stronger + field.unread >= LK_KNOCKOUT_PLACES) return refuse(`${field.unread} invited teams could not be read: no field is accepted blind`)
        } else {
          // Never blind: a field that could not be read is no field to pay into.
          if (!ctx.field) return refuse('the seated teams could not be read: no field is entered blind')
          // Our eleven as it will be at the start (the rivals are taken at full condition): rested, less what our other tournaments cost before it.
          const atStart = conditionAtStart(s, t, ctx.now)
          if (!atStart) return refuse('your current tournaments could not be read: no field is judged blind')
          if (!Number.isFinite(s.profile.elo_rating)) return refuse('your own ELO could not be read: no field is judged blind')
          const field = judgeField(ctx.field, lineupStrength(s, atStart.at), s.profile.elo_rating)
          if (field.unread >= FIELD_LIMIT) return refuse(`${field.unread} seated teams could not be read: no field is entered blind`)
          if (field.stronger >= FIELD_LIMIT) return refuse(`${field.stronger} seated teams are clearly stronger (${STRONGER_WORDS}): no real chance of the top three`)
        }
      }
      // A free Bronze (one FoxLeague's own team creates; the players' free ones were cancelled at the levels' switch) seats without a payment and earns nothing; a paid one goes on chain like Silver.
      if (t.tier === 'bronze' && !(t.entry_fee_foxsy > 0)) return allow(0, { free: true, tier: 'bronze', scId: t.sc_tournament_id ?? t.id, fee: 0 })
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
      // The leave lock: a tournament that reached its minimum is played, so the seat stays until more teams join.
      if (leaveLockLive(cfg) && d.participants.length === d.tournament.min_teams) return refuse(`T${a.tournament_id} is at its minimum of ${d.tournament.min_teams} teams: its seats are locked until more teams join`)
      // A League + Knockout (owner, 2026-10-24): the agent may leave one it sees no chance of the top 24 in, but only while
      // leaving returns the whole entry, before its seats lock (FoxLeague refuses any leave after it). Leaving closes the
      // invitation for good, so an unreadable lock time is no leave. The owner may leave as before.
      if (d.tournament.format === 'league_knockout' && !ctx.byOwner) {
        // Only a seat it paid itself: one the owner took in FoxLeague is the owner's decision (agent review of PR #32).
        if (!ctx.ownSeat) return refuse('a seat this agent did not pay itself (the owner\'s): only the owner leaves it')
        const lock = ctx.seatsLockAt
        if (!lock || !Number.isFinite(lock.getTime())) return refuse('when its seats lock could not be read: not leaving blind (leaving closes the invitation for good)')
        const when = lock.toISOString().slice(0, 16).replace('T', ' ')
        if (lock.getTime() <= ctx.now.getTime()) return refuse(`its seats locked at ${when} UTC: nobody can leave now`)
        if (lock.getTime() - ctx.now.getTime() <= INVITATION_MARGIN_MS) return refuse(`its seats lock at ${when} UTC: too close to leave (after that FoxLeague refuses and the entry stays)`)
        return allow(0, { cancel: false }, 'play', ['the whole entry comes back; the invitation closes for good'])
      }
      // Our own 1v1 nobody accepted: leaving refunds the stake, cancelling closes it and frees the 1v1 slot.
      const ownChallenge = d.tournament.max_teams === 2 && d.tournament.creator_user_id === s.profile.id && d.participants.length === 1
      return allow(0, { cancel: ownChallenge }, 'play', ownChallenge ? ['your own 1v1: the stake comes back and the challenge is closed'] : [])
    }

    case 'widen_range': {
      // FoxLeague's widen_refusal (ovr_range.rs, #542): the creator, while open for joining, wider only, no new bound.
      if (!registered || !s.profile) return refuse('not registered')
      const d = ctx.tournament
      if (!d) return refuse(`tournament T${a.tournament_id} not found`)
      const t = d.tournament
      if (t.format === 'league_knockout') return refuse('no OVR range on a League + Knockout')
      if (t.developer_mode) return refuse('no OVR range on a developer tournament')
      if (t.creator_user_id !== s.profile.id) return refuse(`only the creator of T${t.id} can change its OVR range`)
      // A range the owner set by hand (same team) is the owner's decision, as a seat they took (R32A-1); the owner may widen as before.
      if (!ctx.ownCreation && !ctx.byOwner) return refuse('a tournament or challenge this agent did not create (the owner\'s): only the owner widens its range')
      if (t.status !== 'open' || !(new Date(t.deadline) > ctx.now)) return refuse(`the range can change only while T${t.id} is open for joining`)
      const cur = { min: t.ovr_min ?? null, max: t.ovr_max ?? null }
      const readable = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v))
      if (!readable(cur.min) || !readable(cur.max)) return refuse(`T${t.id} carries an OVR range the agent cannot read`)
      if (cur.min === null && cur.max === null) return refuse(`T${t.id} has no OVR range: it already takes teams of any OVR`)
      const next = { min: a.ovr_min === undefined ? cur.min : a.ovr_min, max: a.ovr_max === undefined ? cur.max : a.ovr_max }
      if (next.min === cur.min && next.max === cur.max) return refuse(`the range is already ${rangeWords(cur.min ?? undefined, cur.max ?? undefined)}: nothing to change`)
      if ((cur.min === null && next.min !== null) || (cur.max === null && next.max !== null)) return refuse('never a new bound where there was none: widening only lowers a minimum or raises a maximum')
      if ((cur.min !== null && next.min !== null && next.min > cur.min) || (cur.max !== null && next.max !== null && next.max < cur.max)) return refuse('wider only: a lower minimum or a higher maximum')
      // The top of a 1v1's range is what keeps a stronger team out of an open challenge (OP-4): never raised or removed (OP-5).
      if (t.max_teams === 2 && next.max !== cur.max) return refuse(`the top of a 1v1's range stays at ${cur.max ?? 'none'}: a higher one lets a stronger team take it; lower the minimum, or let it expire and create another`)
      return allow(0, { min: next.min, max: next.max }, 'play', ['more teams can join; nobody seated is measured again'])
    }

    case 'create_tournament': {
      if (!registered || !s.profile) return refuse('not registered')
      if (a.tier === 'bronze' && !levelsLive(cfg, ctx.now)) return refuse('a Bronze tournament earns nothing until the competition levels are live: none is created before them')
      const invites = a.invite_user_ids ?? []
      // Private at every level (owner, 2026-11-06, OP-6).
      if (a.invite_user_ids?.length) {
        if (a.tier === 'bronze' && !paidBronzeEarns(cfg, ctx.now, true)) return refuse('a private Bronze earns nothing while FoxLeague keeps private_bronze_earns off: create it public or at Silver')
        if (invites.includes(s.profile.id)) return refuse('cannot invite yourself')
        if (invites.length > a.max_teams - 1) return refuse(`at most ${a.max_teams - 1} invited teams for ${a.max_teams} seats`)
        if (invites.length + 1 < a.min_teams) return refuse(`a private tournament fills only with its invited teams and you: ${invites.length + 1} cannot reach the minimum of ${a.min_teams}; invite more active teams`)
      }
      if (a.tier === 'gold' && !ctx.settings.entryFeesGold.length) return refuse('Gold is off for this agent: no Gold amounts in its settings')
      const tournamentRange = createRangeRefusal(a, ctx)
      if (tournamentRange) return refuse(tournamentRange)
      const list = a.tier === 'bronze' ? ctx.settings.entryFeesBronze : a.tier === 'silver' ? ctx.settings.entryFeesSilver : ctx.settings.entryFeesGold
      if (!list.includes(a.entry_fee_foxsy)) return refuse(`entry fee ${a.entry_fee_foxsy} is not one of the configured amounts ${list.join('/') || '(none set)'}`)
      const bounds = tierBounds(s, a.tier)
      if (!bounds || a.entry_fee_foxsy < bounds[0] || a.entry_fee_foxsy > bounds[1]) return refuse(`fee outside the ${a.tier} bounds`)
      if (a.entry_fee_foxsy > ctx.settings.maxEntryFeeFoxsy) return refuse(`entry fee exceeds the per-action maximum ${ctx.settings.maxEntryFeeFoxsy}`)
      // parseAction lets only the known formats through; the rules hold even for an action built another way.
      const unknownCreate = unsupportedFormat(a.format, 'creating')
      if (unknownCreate) return refuse(unknownCreate)
      if (!VALID_SIZES[a.format]!(a.max_teams)) return refuse(`${a.max_teams} teams is not a valid ${a.format} size`)
      if (a.format === 'knockout' && a.min_teams !== a.max_teams) return refuse('knockout needs min_teams = max_teams')
      if (a.format === 'groups_knockout' && a.min_teams < GROUPS_MIN_TEAMS) return refuse(`groups_knockout needs min_teams of ${GROUPS_MIN_TEAMS} or more`)
      if (a.min_teams > a.max_teams || a.min_teams < 3) return refuse('min_teams must be 3..max_teams')
      const ceiling = sizeCeiling(s)
      if (a.max_teams > ceiling) return refuse(`${a.max_teams} teams is larger than recent tournaments fill (ceiling ${ceiling})`)
      // The start, counted from now, when the create runs: a minute the plan named, or whole hours from this moment. Every
      // check below and the start FoxLeague is sent (facts.startsAt) are this one instant (2026-11-15).
      const startsAt = createStartMs(a, ctx.now.getTime())
      if (startsAt === null) return refuse('the start could not be read: starts_at, a UTC minute such as 2026-11-17T19:49Z')
      const startIso = new Date(startsAt).toISOString()
      const ahead = startsAt - ctx.now.getTime()
      if (!(ahead >= CREATE_START_MIN_MS)) return refuse(`starts ${startIso.slice(0, 16)} UTC, less than 2 hours from now: pick a later free start`)
      if (ahead > CREATE_START_MAX_MS) return refuse(`starts ${startIso.slice(0, 16)} UTC, more than 72 hours from now`)
      if (a.registration_closes_minutes_before >= ahead / 60_000 - 30) return refuse('registration would close within 30 minutes of now')
      const mine = s.auth?.myTournaments?.active.filter(t => t.creator_user_id === s.profile!.id && t.max_teams > 2) ?? []
      if (mine.length) return refuse(`already running T${mine[0]!.id}: one created tournament at a time`)
      const runningLk = runningLeagueKnockout(s)
      if (runningLk) return refuse(`your team is in T${runningLk.id}, a League + Knockout that has started: no other tournament until it is over (1v1s and ranked stay open)`)
      // FoxLeague refuses a create whose blocking window overlaps any live tournament's: check it first. The first free
      // start is named as the minute itself: whole hours from now would be stale by the next plan and miss a narrow gap.
      // The next plan reads it, so it is searched from 2 hours after the latest moment that plan's create can run
      // (R74A-1): the 2-hour floor of this moment would be about an hour ahead by then. The next plan reads the refusal
      // cut to 300 characters after the action's description (a title of up to 60): the start comes first, then the
      // taken window, so a cut takes the window and never the minute (R74A-4).
      const taken = clash(s.market.slots ?? [], blockingWindow(a.format, a.max_teams, Boolean(a.home_and_away), startsAt))
      if (taken) {
        const free = firstFreeStart(s.market.slots ?? [], a.format, a.max_teams, Boolean(a.home_and_away), ctx.now.getTime(), CREATE_START_MIN_MS + nextPlanLeadMs(ctx.settings), CREATE_START_MAX_MS)
        const iso = (t: number) => new Date(t).toISOString().slice(0, 16)
        const takenWindow = `the taken window is ${iso(taken.start)} to ${iso(ceilMinute(taken.end))} UTC`
        return refuse(`time slot taken by T${taken.id}; ${free !== null ? `the first free start for this format and size is starts_at ${iso(free)}Z (late enough for the next plan to create it; ${takenWindow})` : `no free start the next plan can still create in the next 72 hours (${takenWindow})`}`)
      }
      const worn = scheduleRefusal(s, { format: a.format, max_teams: a.max_teams, min_teams: a.min_teams, home_and_away: a.home_and_away, round_interval_minutes: a.round_interval_minutes, starts_at: startIso }, ctx.now)
      if (worn) return refuse(worn)
      const legal = squadLegal(s, new Date(startsAt), ', past the start of your tournament')
      if (legal) return refuse(legal)
      // What the organizer owes: one payment, once FoxLeague asks for it at the create; nothing on a tournament it exempts.
      let organizerFoxsy = 0
      let organizerHash: string | undefined
      const organizerNotes: string[] = []
      if (organizerFeesLive(cfg, ctx.now)) {
        const q = ctx.organizerQuote
        if (!q) return refuse('what this tournament owes its organizer could not be read: not creating blind')
        if (q.owed) {
          if (!Number.isSafeInteger(q.total_foxsy) || q.total_foxsy <= 0) return refuse('the organizer payment could not be read: not paying blind')
          if (q.total_foxsy > ctx.settings.maxShopPaymentFoxsy) return refuse(`an organizer payment of ${q.total_foxsy} FOXSY exceeds the per-action maximum ${ctx.settings.maxShopPaymentFoxsy}: a smaller tournament owes less`)
          const held = ctx.pendingOrganizer
          if (held && held.total !== q.total_foxsy) return refuse(`an organizer payment of ${held.total} FOXSY waits to be used or returned, and this tournament owes ${q.total_foxsy}: not paying a second one; a tournament that owes ${held.total} can use it`)
          if (held) organizerHash = held.hash
          else organizerFoxsy = q.total_foxsy
          organizerNotes.push(`organizer payment ${q.total_foxsy} FOXSY (deposit ${q.deposit_foxsy}${q.private_fee_foxsy > 0 ? `, private fee ${q.private_fee_foxsy}` : ''}, ${q.games} games): the deposit is kept if too few teams join by the deadline`)
          if (q.no_free_cancel) organizerNotes.push('this time slot has no free cancel')
        }
      }
      const total = a.entry_fee_foxsy + organizerFoxsy
      return needFoxsy(total, allow(total, { fee: a.entry_fee_foxsy, organizerFoxsy, startsAt: startIso, ...(organizerHash ? { organizerHash } : {}), ...(a.invite_user_ids?.length ? { invites } : {}) }, 'play', organizerNotes))
    }

    case 'create_challenge': {
      if (!registered || !s.profile) return refuse('not registered')
      if (a.tier === 'gold' && !ctx.settings.entryFeesGold.length) return refuse('Gold is off for this agent: no Gold amounts in its settings')
      const challengeRange = createRangeRefusal(a, ctx)
      if (challengeRange) return refuse(challengeRange)
      if (a.target_user_id === null) {
        // Open, at every level and any configured stake (owner, 2026-11-06, OP-2/OP-3): whoever takes it cannot be read
        // before, so FoxLeague's own range check keeps every stronger team out: its top is the team's best XI OVR,
        // rounded up so the creator fits its own range (OP-4; the farming guard of A2 for a rival nobody chose).
        // createRangeRefusal above has read that OVR and checked the range holds it.
        if (a.ovr_max === undefined) return refuse('an open challenge needs an OVR range up to your best XI OVR (ovr_max, the snapshot gives it): FoxLeague then keeps every stronger team out')
        const top = Math.ceil(ctx.bestXiOvr!)
        if (a.ovr_max > top) return refuse(`an open challenge takes ovr_max ${top} at most (your best XI OVR ${ctx.bestXiOvr}, rounded up): a higher top lets a stronger team take it`)
        // The best XI OVR ignores condition: the strongest team that may take it plays at the range's top at full
        // condition, ours at today's, held to A2's ratio (agent review of PR #54, R54A-1).
        const today = elevenOvrToday(s)
        if (today === null) return refuse('your eleven could not be read: no open challenge blind')
        if (a.ovr_max > today * MAX_1V1_STRENGTH_RATIO) return refuse(`a team at the top of the range (OVR ${a.ovr_max}) at full condition would be more than 10 percent stronger than your eleven today (OVR ${today.toFixed(1)} at today's condition): let the starters recover first`)
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
      const blind = oneVOneStateRefusal(s, ctx.now)
      if (blind) return refuse(blind)
      const legal = squadLegal(s, ctx.now)
      if (legal) return refuse(legal)
      // The creator's own seat goes through FoxLeague's join gate after the stake is paid (tournaments.rs: the create
      // leaves the match-fit gate to the creator's later join): the same count as a join.
      const fit = matchFit(s, cfg.min_field_condition, ctx.now)
      if (fit < 11) return refuse(matchFitRefusal(fit, cfg.min_field_condition))
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
          // Buying again restarts FoxLeague's 24 h from the new purchase: the hours left are lost. Only a booster
          // about to end may be renewed. An unreadable shop status or expiry is unknown, never "no booster".
          const shop = s.auth?.shop
          if (!shop || typeof shop.xp_booster_active !== 'boolean') return refuse('XP booster status unknown (shop status unavailable)')
          if (shop.xp_booster_active) {
            const until = typeof shop.xp_booster_expires_at === 'string' ? Date.parse(shop.xp_booster_expires_at) : NaN
            if (!Number.isFinite(until)) return refuse('XP booster active, expiry unknown')
            if (until - ctx.now.getTime() > XP_BOOSTER_RENEW_HOURS * 3600_000) return refuse(`XP booster active until ${new Date(until).toISOString()}: another one now would throw away the hours left`)
          }
          // FoxLeague also reads "none active" when its own booster query fails: the agent's own purchase still runs.
          if (ctx.lastBoosterAt) {
            const hours = (ctx.now.getTime() - ctx.lastBoosterAt.getTime()) / 3600_000
            if (hours < 24 - XP_BOOSTER_RENEW_HOURS) return refuse(`an XP booster was bought ${Math.max(0, Math.floor(hours))} h ago: another one now would throw away the hours left`)
          }
          const none = noBoosterFixture(s, ctx.now)
          if (none) return refuse(none)
          // The level's count (owner, 2026-11-06), from the agent's own purchases of the last 7 days.
          const perWeek = ctx.settings.boostersPerWeek
          if (perWeek <= 0) return refuse('no XP booster at this level (Boosters a week is 0)')
          if (typeof ctx.boostersThisWeek !== 'number') return refuse('the XP boosters bought this week could not be counted: not buying blind')
          if (ctx.boostersThisWeek >= perWeek) return refuse(`${perWeek} XP booster${perWeek === 1 ? '' : 's'} a week at this level, ${ctx.boostersThisWeek} bought in the last 7 days`)
          amount = prices.xp_booster
          break
        }
        case 'training_slot': {
          // The level's count of paid sessions a day (owner, 2026-11-06): those used today and those still banked count.
          const t = s.auth?.shop?.training
          if (!t) return refuse('training quota unknown (shop status unavailable)')
          if (!Number.isFinite(t.premium_used_today) || !Number.isFinite(t.slots_banked) || !Number.isFinite(t.used_today) || !Number.isFinite(t.daily_free)) return refuse('training quota unknown (the paid sessions used or banked could not be read)')
          const more = a.quantity ?? 1
          const limit = ctx.settings.paidTrainingPerDay
          const paidToday = paidSessionsToday(t)
          if (paidToday + t.slots_banked + more > limit) return refuse(`${limit} paid training sessions a day at this level: ${paidToday} used today and ${t.slots_banked} banked leave room for ${Math.max(0, limit - paidToday - t.slots_banked)}`)
          amount = prices.training * more
          facts.quantity = a.quantity
          break
        }
        case 'medicine': {
          // One injured card of the wallet, whole days, at FoxLeague's own quote for exactly those days (its confirm
          // quotes again and takes that amount only; anything else comes back whole and costs the gas).
          const n = a.player_nonces?.[0]
          const days = a.quantity
          const p = typeof n === 'number' ? card(s, n) : undefined
          if (!p || typeof days !== 'number') return refuse(`#${n} is not in the wallet`)
          if (p.listed) return refuse(`#${n} is listed for sale: only a card in the wallet takes medicine`)
          if (!p.injuredUntil) return refuse(`#${n} is not injured`)
          // The level's count (owner, 2026-11-10), in days over all cards, from the agent's own purchases of the last 7 days.
          const perWeek = ctx.settings.medicineDaysPerWeek
          if (!(perWeek > 0)) return refuse('no medicine at this level (Medicine days a week is 0)')
          if (typeof ctx.medicineDaysThisWeek !== 'number' || !Number.isFinite(ctx.medicineDaysThisWeek)) return refuse('the medicine bought this week could not be counted: not buying blind')
          if (ctx.medicineDaysThisWeek + days > perWeek) return refuse(`${perWeek} medicine day${perWeek === 1 ? '' : 's'} a week at this level: ${ctx.medicineDaysThisWeek} bought in the last 7 days leave room for ${Math.max(0, perWeek - ctx.medicineDaysThisWeek)}`)
          const q = ctx.medicineQuote
          if (!q) return refuse(`the medicine quote for #${n} could not be read: not paying blind`)
          const whole = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
          if (!whole(q.max_days) || !whole(q.price_per_day) || !whole(q.cost_foxsy) || !whole(q.days_paid)) return refuse(`the medicine quote for #${n} could not be read: not paying blind`)
          if (q.max_days < 1) return refuse(`no day of #${n}'s injury is left to save: a third of every injury is always served`)
          if (days > q.max_days) return refuse(`medicine saves #${n} ${q.max_days} day${q.max_days === 1 ? '' : 's'} at most (a third of every injury is always served)`)
          if (q.player_nonce !== n || q.days_paid !== days || q.price_per_day <= 0 || q.cost_foxsy !== q.price_per_day * days) return refuse(`the medicine quote does not match ${days} day${days === 1 ? '' : 's'} at ${q.price_per_day} FOXSY: not paying blind`)
          amount = q.cost_foxsy
          facts.player_nonces = [n]
          facts.quantity = days
          break
        }
        case 'common_pack': {
          if (!cfg.common_pack_available) return refuse(`Common pack unavailable${cfg.common_pack_unavailable_reason ? `: ${cfg.common_pack_unavailable_reason}` : ''}`)
          // FoxLeague's own count for the wallet (GET /api/shop/status; it refuses the confirm of a pack over the quota
          // after the payment settled). A status that failed or an answer without the number is unread, never "some
          // left": the agent's own 7-day count below knows nothing of packs bought in the app (audit 2026-11-11, INTEG-6).
          const left = s.auth?.shop?.common_pack_remaining_this_week
          if (typeof left !== 'number' || !Number.isFinite(left)) return refuse('the Common packs left this week could not be read (the shop status or its weekly quota): not buying blind')
          if (left <= 0) return refuse('weekly Common pack quota used')
          // The level's count (owner, 2026-11-06), from the agent's own purchases of the last 7 days.
          const perWeek = ctx.settings.packsPerWeek
          if (perWeek <= 0) return refuse('no Common packs at this level (Packs a week is 0)')
          if (typeof ctx.packsThisWeek !== 'number') return refuse('the Common packs bought this week could not be counted: not buying blind')
          if (ctx.packsThisWeek >= perWeek) return refuse(`${perWeek} Common pack${perWeek === 1 ? '' : 's'} a week at this level, ${ctx.packsThisWeek} bought in the last 7 days`)
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
      // FoxLeague's fusion switch (fusion_mint): the old fusion until it, the fusion that mints its result from it; none
      // while FoxLeague updates fusion, in the minutes before the switch or when the switch cannot be read.
      const mode = fusionMode(cfg, ctx.now)
      if (mode.mode === 'closed') return refuse(mode.why)
      const mint = mode.mode === 'mint'
      // FoxLeague's match gate of the rarity (2026-10-12): Common 5, Uncommon 15, Rare 45, Epic 135, part really played.
      // From the switch FoxLeague signs the competitive matches the card shows, synced or not.
      const g = matchGate(cfg, rarity)
      for (const c of inputs) {
        if (c.listed) return refuse(`#${c.nonce} is listed for sale`)
        if (c.transferLockedUntil) return refuse(`#${c.nonce} is in a transfer cooldown until ${c.transferLockedUntil}`)
        if (c.fusionReadyAt) return refuse(`#${c.nonce} is in its fusion cooldown until ${c.fusionReadyAt}`)
        // FoxLeague's Fusion tab refuses both; its contract sees neither, and the new card would only inherit them.
        if (c.disciplineUnread) return refuse(`#${c.nonce}'s injury could not be read: not fusing blind`)
        if (c.injuredUntil) return refuse(`#${c.nonce} is injured until ${c.injuredUntil}: an injured card cannot be fused`)
        if (c.suspended) return refuse(`#${c.nonce} is suspended (a yellow card ban to serve): a suspended card cannot be fused`)
        if (inSquad(s, c.nonce)) return refuse(`#${c.nonce} is in the lineup or on the bench: set a squad without it first`)
        if (c.dirty && !mint) return refuse(`#${c.nonce} has unsynced stats: sync first (the contract reads the on-chain match count)`)
        if (c.competitiveMatches < g.floor) return refuse(`#${c.nonce} has played ${c.competitiveMatches} competitive matches; ${aRarity(rarity)} must really play ${g.floor} of its ${g.gate}`)
        if (c.competitiveMatches + c.fusionMatchCredit < g.gate) return refuse(`#${c.nonce} has ${c.competitiveMatches + c.fusionMatchCredit} of the ${g.gate} competitive matches ${aRarity(rarity)} needs for fusion`)
      }
      const left = s.players.filter(p => !p.listed).length - 2
      if (left < 18) return refuse(`fusion would leave ${left} cards; a match needs 18`)
      if (mint) {
        const v = mintFusion(a, s, ctx, inputs)
        return v.ok ? needFoxsy(Number(v.facts.fee), v) : v
      }
      // The wallet fusion cooldown and the dirty-card check live in the pre-check: unreadable is no "yes".
      if (ctx.canFuse === null) return refuse('the fusion pre-check is unavailable: not fusing blind')
      if (ctx.canFuse && !ctx.canFuse.can_fuse) return refuse(`FoxLeague says not now: ${canFuseReason(ctx.canFuse)}`)
      const output = `${NEXT_RARITY[RARITY_LEVEL[rarity]]} ${inputs[a.position_of]!.position}`
      if (ctx.fusionPool === 0) return refuse(`no ${output} left in the fusion pool; try later`)
      const fee = cfg.fusion_costs_foxsy?.[RARITY_LEVEL[rarity]]
      if (!fee) return refuse(`fusion cost for ${rarity} unknown`)
      // The level's largest single shop payment holds the fee too (owner's level table, 2026-11-06: Steady's 500 reaches
      // the fees up to 400; grand audit DOCS-1).
      if (fee > ctx.settings.maxShopPaymentFoxsy) return refuse(`a fusion fee of ${fee} FOXSY exceeds the per-action maximum ${ctx.settings.maxShopPaymentFoxsy} (Max shop payment)`)
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
      // The raise over a top bid is the contract's setting, served by FoxLeague: never a number of the agent's own.
      const raise = auctionMinRaisePercent(cfg)
      if (au.highestBid !== 0n && raise === null) return refuse('the minimum raise over a top bid could not be read: not bidding blind')
      const minAtomic = au.highestBid === 0n ? au.minPrice : [(au.highestBid * BigInt(100 + raise!) + 99n) / 100n, au.highestBid + 1n].reduce((x, y) => (x > y ? x : y))
      const min = ceilWhole(minAtomic)
      if (a.foxsy < min) return refuse(`bid ${a.foxsy} FOXSY is below the minimum ${min} (${top ? `top bid ${top} + ${raise} percent` : 'the reserve'})`)
      if (a.foxsy > ctx.settings.maxBidFoxsy) return refuse(`bid ${a.foxsy} FOXSY exceeds the per-action maximum ${ctx.settings.maxBidFoxsy}`)
      // Its limit and the build cost both hang on the rarity: unknown, no bid (agent review of PR #21).
      if (!ctx.cardRarity || !Object.hasOwn(RARITY_LEVEL, ctx.cardRarity)) return refuse(`the rarity of #${a.nonce} could not be read: not bidding blind`)
      const limit = rarityBidLimit(ctx.settings, ctx.cardRarity)
      if (limit !== null && a.foxsy > limit) return refuse(`bid ${a.foxsy} FOXSY is above your limit for ${aRarity(ctx.cardRarity!)} (${limit} FOXSY)`)
      const ceiling = ctx.cardRarity ? auctionCeiling(cfg, ctx.cardRarity) : null
      if (ceiling !== null && a.foxsy > ceiling) return refuse(`bid ${a.foxsy} FOXSY is above what ${aRarity(ctx.cardRarity)} costs to build yourself (${ceiling} FOXSY: Common packs, fusion fees and the matches and days it takes, at FoxLeague's own prices): building it is cheaper`)
      if ((ctx.priorBids ?? 0) >= MAX_BIDS_PER_AUCTION) return refuse(`already ${MAX_BIDS_PER_AUCTION} bids on #${a.nonce}: no bidding war`)
      if (ctx.cardLock === null) return refuse(`the details of #${a.nonce} could not be read: not bidding blind`)
      const lock = ctx.cardLock?.until
      if (lock && lock.getTime() - ctx.now.getTime() > MAX_INHERITED_LOCK_HOURS * 3600_000) return refuse(`#${a.nonce} carries a transfer lock until ${lock.toISOString()}: it could not play for weeks`)
      // A sale keeps the card's injury. Whether an injured card is worth its price is the plan's call (owner,
      // 2026-11-10), however long it is out; one whose injury cannot be read is not: unknown is not healthy.
      if (ctx.cardLock?.injuryUnread) return refuse(`the injury of #${a.nonce} could not be read: not bidding blind`)
      const hurt = ctx.cardLock?.injuredUntil
      const notes = ['refunded at once if outbid; the card arrives when the auction is settled']
      if (lock && lock > ctx.now) notes.push(`the card carries a transfer lock until ${lock.toISOString()}`)
      if (hurt && hurt > ctx.now) notes.push(`the card is injured until ${hurt.toISOString()}: it plays no match before`)
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
      const gate = matchGate(cfg, c.rarity)
      if (c.competitiveMatches < gate.floor || c.competitiveMatches + c.fusionMatchCredit < gate.gate) {
        return refuse(`#${a.nonce} needs ${gate.gate} competitive matches, ${gate.floor} of them played, to be listed (${aRarity(c.rarity)}); it has ${c.competitiveMatches} played${c.fusionMatchCredit ? ` + ${c.fusionMatchCredit} waived` : ''}`)
      }
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
      // Only for a fusion that can really happen: otherwise the FOXSY buys nothing. A Legendary is never fused, but
      // FoxLeague sells its match waiver for the listing gate (405, 135 played): bought only for a card the agent
      // would list (audit C1, 2026-10-23). Its cooldown waiver still buys nothing.
      const forListing = a.type === 'fusion_match_waiver' && c.rarity === 'Legendary'
      const blocked = forListing ? listingBlocked(s, c) : fusionBlocked(s, c)
      if (blocked) return refuse(forListing ? `#${a.nonce} is not a card the agent would list (${blocked}): a waiver would be wasted` : `no fusion is possible with #${a.nonce} yet (${blocked}): a waiver would be wasted`)
      const purpose = forListing ? 'listing' : 'fusion'
      let costAtomic: bigint
      const notes: string[] = []
      const extra: Record<string, unknown> = {}
      if (a.type === 'fusion_cooldown_waiver') {
        if (!c.fusionReadyAt) return refuse(`#${a.nonce} has no fusion cooldown running`)
        const q = ctx.cooldownQuote
        if (!q) return refuse(`the cooldown waiver quote for #${a.nonce} could not be read`)
        if (q.days <= 0 || q.costAtomic <= 0n) return refuse(`nothing to waive on #${a.nonce}: its cooldown is at the 3-day floor already`)
        // Since 2026-10-12 some of the days can be bought: the ready time moves that many days earlier.
        if (a.days !== undefined && a.days > q.days) return refuse(`#${a.nonce} has ${q.days} day${q.days > 1 ? 's' : ''} above the 3-day floor to waive, not ${a.days}`)
        const days = a.days ?? q.days
        costAtomic = (q.costAtomic / BigInt(q.days)) * BigInt(days)
        if (days < q.days) extra.days = days
        notes.push(days === q.days ? `#${a.nonce} ready for fusion ${q.days} day${q.days > 1 ? 's' : ''} sooner (3 days left)` : `#${a.nonce} ready for fusion ${days} of its ${q.days} waivable days sooner`)
      } else {
        const g = matchGate(cfg, c.rarity)
        if (!g.waiver) return refuse(`${aRarity(c.rarity)} has no match waiver: its ${g.gate} competitive matches must really be played`)
        // The quote counts the matches on chain: unsynced ones would be bought again. Sync first.
        if (c.dirty) return refuse(`#${a.nonce} has unsynced stats: sync first, its unsynced matches may already cover part of the ${g.gate}`)
        const q = ctx.matchQuote
        if (!q) return refuse(`the match waiver quote for #${a.nonce} could not be read`)
        if (c.competitiveMatches > q.chain_played) return refuse(`#${a.nonce} has ${c.competitiveMatches - q.chain_played} competitive matches not on chain yet: sync first`)
        // The quote names the gate the contract holds this card to; the config's row is the fallback.
        const minMatches = q.gate ?? g.gate
        const floor = q.floor ?? g.floor
        if (q.chain_played < floor) return refuse(`#${a.nonce} has really played ${q.chain_played} competitive matches on chain; ${aRarity(c.rarity)} must play ${floor} before credit can be bought`)
        const needed = minMatches - q.chain_played - q.credit
        if (needed <= 0) return refuse(`#${a.nonce} already has the ${minMatches} matches ${purpose} needs`)
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
        extra.matches = a.matches
        notes.push(a.matches === needed ? `#${a.nonce} reaches ${minMatches} competitive matches for ${purpose}` : `#${a.nonce} +${a.matches} toward the ${minMatches} matches for ${purpose} (${needed - a.matches} to go)`)
      }
      const whole = Number(costAtomic / 10n ** 18n)
      // The first piece of a split waiver answers for the whole group, as the unsplit action would.
      const groupWhole = ctx.piece?.index === 1 ? whole * ctx.piece.of : whole
      if (groupWhole > ctx.settings.maxShopPaymentFoxsy) return refuse(`${groupWhole} FOXSY exceeds the per-action maximum ${ctx.settings.maxShopPaymentFoxsy} (Max shop payment)`)
      return needFoxsy(whole, allow(costAtomic, { costAtomic, nonce: a.nonce, ...extra }, 'play', notes))
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
