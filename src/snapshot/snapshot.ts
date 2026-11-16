// Read-only snapshot of one agent's world: what a player sees by browsing FoxLeague plus the chain.
// Public routes and the agent's own authed routes only (README guardrail "public information only").

import { slotWindows, type SlotWindow } from '../executor/slots.ts'
import { supportedFormat, type FieldSeat } from '../executor/rules.ts'
import { MAINNET } from '../config.ts'
import type { Chain } from '../chain/gateway.ts'
import { PAIR_PAUSED, poolState } from '../chain/xexchange.ts'
import { b64ToBigInt } from '../util/encoding.ts'
import { rivalStrength, type FoxLeague } from '../foxleague/api.ts'
import { cardBansLive } from '../foxleague/levels.ts'
import { winChance } from './winchance.ts'
import { LEAGUE_DAYS, LEAGUE_READS_PER_TICK, LEAGUE_TEAMS, LEAGUE_TEAMS_PER_TICK, summariseFormations, type FormationMatch, type FormationRecord, type LeagueCache, type LeagueTable } from './formations.ts'
import { marketPrices, MARKET_WINDOWS, type MarketPrice, type MarketSalesCache } from './market.ts'
import { readCalendar, type ShapeCalendar } from './calendar.ts'

/** A rival's lineup strength, read at most every 20 minutes (a roster changes slowly; 25 agents share FoxLeague's rate). */
const rivalSeen = new Map<string, { at: number; strength: number | null }>()
export async function rivalStrengthCached(fox: Pick<FoxLeague, 'players'>, wallet: string): Promise<number | null> {
  const hit = rivalSeen.get(wallet)
  if (hit && Date.now() - hit.at < 20 * 60_000) return hit.strength
  const strength = await rivalStrength(fox, wallet).catch(() => undefined)
  // A failed read is not kept: the next plan asks again, as for the ELO below (OPEN-4).
  if (strength === undefined) return null
  rivalSeen.set(wallet, { at: Date.now(), strength })
  if (rivalSeen.size > 500) rivalSeen.delete(rivalSeen.keys().next().value!)
  return strength
}
/** A seated team's ELO when the leaderboard does not list it, read at most every 20 minutes like its lineup. */
const eloSeen = new Map<string, { at: number; elo: number | null }>()
async function rivalEloCached(fox: FoxLeague, wallet: string): Promise<number | null> {
  const hit = eloSeen.get(wallet)
  if (hit && Date.now() - hit.at < 20 * 60_000) return hit.elo
  const read = await fox.user(wallet).catch(() => undefined)
  const elo = typeof read?.elo_rating === 'number' ? read.elo_rating : null
  // A failed read is not kept: the next plan asks again.
  if (read !== undefined) eloSeen.set(wallet, { at: Date.now(), elo })
  if (eloSeen.size > 500) eloSeen.delete(eloSeen.keys().next().value!)
  return elo
}
import {
  RARITY_CAP,
  STATS,
  type ActiveMatch,
  type ChallengeForMe,
  type DailyAllowance,
  type PendingLeagueInvitation,
  type FoxConfig,
  type MyTournaments,
  type PlayerCard,
  type ShopStatus,
  type Team,
  type Tournament,
  type UpcomingMatches,
  type UserProfile,
  type MarketListing,
  type FloorPrice,
  type MatchFormations,
  type MatchHistoryRow,
} from '../foxleague/types.ts'
import type { AgentWallet } from '../wallet/wallet.ts'

export interface PlayerView {
  nonce: number
  name: string
  position: PlayerCard['position']
  rarity: PlayerCard['rarity']
  cap: number
  role: 'starter' | 'bench' | 'reserve'
  /** Lineup slot (0 = GK) for starters. */
  slot?: number
  condition: number
  ageYears: number
  /** Stats the match engine uses (on chain). */
  synced: Record<string, number>
  /** Live stats (training and match XP), effective in matches only after a sync. */
  live: Record<string, number>
  /** XP in each stat's pool toward the next point (2,000 per point). */
  xp: Record<string, number>
  dirty: boolean
  competitiveMatches: number
  /** Competitive matches bought with the fusion match waiver (count toward the 20, not the 5 played). */
  fusionMatchCredit: number
  /** A fused card's own fusion cooldown, while it runs. */
  fusionReadyAt: string | null
  listed: boolean
  transferLockedUntil: string | null
  /** While the card is injured (FoxLeague's injured_until, still ahead): out of every match until then. */
  injuredUntil: string | null
  /** A yellow card ban to serve (bans_pending above 0): out of the team's next tournament match of more than 2 teams. */
  suspended: boolean
  /** Yellow cards toward the next ban. */
  banYellows: number
  /** Once the bans are live: FoxLeague's answer left the card's injury or ban out, so neither is known. */
  disciplineUnread?: boolean
  /** Synced total over the 7 stats, as a quick strength figure. */
  syncedTotal: number
}

export interface MarketSummary {
  openStandard: Tournament[]
  openChallenges: Tournament[]
  /** Recently finished standard tournaments, to size new ones from what really fills. */
  recentStandard: { id: number; tier: string; format: string; max_teams: number; seated: number; fee: number; status: string; starts_at: string }[]
  /** The rival behind each 1v1 the agent could take (at most 4, only while it has no 1v1 of its own): ELO and lineup strength at full condition. */
  scouted?: { id: number; elo: number | null; strength: number | null; formations?: string[] | null }[]
  /** Platform-wide time slots a created tournament may not overlap (open and running standard tournaments). */
  slots: SlotWindow[]
  /**
   * Planning snapshots only: FoxLeague's own free starts for a new tournament of a few shapes, over the 14 days a create
   * may be ahead (src/snapshot/calendar.ts); a shape whose read failed is null (unknown, never free).
   */
  calendar?: ShapeCalendar[]
  /** Open auctions, never our own: the 10 strongest, then the 3 cheapest of each rarity (auctionsShown); and the reserve floor of each rarity. */
  auctions: MarketListing[]
  /** The best XI OVR of the leaderboard teams read (ours left out), and of those that took a 1v1 in 7 days they had not arranged: how many a range lets in. */
  boardOvrs?: { all: number[]; takers: number[] }
  floors: FloorPrice[]
  /** Planning snapshots only: the market price of each rarity from the public sales (null: too few to tell). */
  prices?: Record<string, MarketPrice | null>
  /**
   * Planning snapshots only: the seated teams of the open Silver and Gold tournaments the agent could join (soonest
   * deadline first, at most 4, 16 seats each), read as the join rule reads them; seats null = unreadable.
   */
  fields?: { id: number; seated: number; seats: FieldSeat[] | null }[]
}

/** Public facts of revealed matches, kept across ticks (the store's match_facts), so each match is read once. */
export interface MatchFactsCache {
  get(key: string): MatchFormations | undefined
  put(key: string, facts: MatchFormations): void
}

export interface AgentSnapshot {
  takenAt: string
  /** Set in watch mode: a public read of someone else's team, no authed routes. */
  watchOnly: boolean
  agent: { index: number | null; address: string; shard: number | null }
  gameDay: { resetHourUtc: number; nextResetAt: string; hoursToReset: number }
  chain: { egld: bigint; nonce: number; foxsy: bigint; wegld: bigint; nftCount: number } | null
  /** frozen: xExchange has paused the pair, so the FOXSY price is its last trade (not a new observation). */
  prices: { egldUsd: number; egldPerFoxsy: number; foxsyUsd: number; frozen?: boolean } | null
  config: FoxConfig | null
  registration: {
    registered: boolean
    teamName: string | null
    feePaidOnChain: boolean | null
    whitelisted: boolean | null
    relayerEnabled: boolean | null
    relaysRemaining: number | null
    /** The profile route failed (not "not found"): whether the team exists is unknown, which is not "unregistered". */
    profileUnreadable?: boolean
  }
  profile: UserProfile | null
  team: Team | null
  players: PlayerView[]
  auth: {
    shop: ShopStatus | null
    allowance: DailyAllowance | null
    activeMatch: ActiveMatch | null
    myTournaments: MyTournaments | null
    upcoming: UpcomingMatches | null
    challengesForMe: ChallengeForMe[]
    /**
     * Pending League + Knockout invitations, each with its tournament (start, interval) when it could be read; null
     * when the invitations could not be read. Their titles are written by others: the digest passes them through txt().
     */
    invitations?: (PendingLeagueInvitation & { tournament: Tournament | null })[] | null
    /** The team's best XI OVR (what OVR ranges are checked against); null when unreadable. */
    bestXiOvr?: number | null
    /** The team's League + Knockout seats not started yet: when their seats lock (leaving refunds the entry until then). */
    leagueSeats?: { tournamentId: number; seatsLockAt: string | null; accepted: number | null }[]
    /** Open tournaments this team created and holds no seat in (read from their seats; OPEN-8). */
    unseatedCreated?: number[]
  } | null
  market: MarketSummary
  /**
   * Teams to challenge: the ones that take 1v1s they had not arranged first (`accepted7d`), then the nearest by ELO. `matches` is the
   * team's record so far (its activity is the change over days); every agent also reads each team's lineup
   * strength and its own win chance against it.
   */
  /** Planning snapshots only (absent otherwise); null when the match history could not be read. */
  formationRecord?: FormationRecord | null
  /** Planning snapshots only, added by the service: every team the install runs, matches between them left out. */
  formationPool?: FormationRecord
  /** Planning snapshots only, added by the service: the public matches of the top teams by ELO, the owner's teams left out. */
  leagueFormations?: LeagueTable
  /** Planning snapshots only, added by the service: the casual games of every team the install runs, by formation against the AI. */
  casualBench?: FormationRecord
  /** Planning snapshots only, added by the service: the casual games this agent started in the current game day. */
  casualToday?: number
  /** For the next upcoming matches: the rival's formations in its last revealed matches, newest first; null when unknown. */
  rivalFormations?: { tournamentId: number; opponent: string; formations: string[] | null; strength?: number | null }[]
  leaderboardNeighbours: (Pick<UserProfile, 'id' | 'wallet_address' | 'team_name' | 'elo_rating' | 'league'> & { accepted7d: number; matches?: number; strength?: number | null; winChance?: number | null; played?: { matches: number; days: number } | null; bestXiOvr?: number | null })[]
  /**
   * Planning only, added by the service from the activity log with the executor's own helpers (src/executor/rivals.ts):
   * per rival, the 1v1s this agent played or entered in the last 7 days and, at the weekly limit, when it is free
   * again.
   */
  oneVOnes?: { week: { userId: number; count: number; freeAt: string | null }[] }
  /** The tournaments and 1v1s this agent created itself (its log, added by the service): the ones it may widen. */
  ownCreations?: number[]
  warnings: string[]
}

export interface SnapshotDeps {
  chain: Chain
  fox: FoxLeague
}

/** Next daily reset (FoxLeague allowances reset at a fixed hour UTC, 14:00 on mainnet). */
export function gameDay(now: Date, resetHourUtc = 14): AgentSnapshot['gameDay'] {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), resetHourUtc))
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1)
  return { resetHourUtc, nextResetAt: next.toISOString(), hoursToReset: Math.round(((next.getTime() - now.getTime()) / 3600_000) * 10) / 10 }
}

/**
 * A card's injury and ban as FoxLeague's card record carries them (its own cards, a rival's, one at auction: a sale
 * keeps both). `bansLive`: the yellow card bans and injuries count (cardBansLive). From then a card without a readable
 * injury and ban is unknown (disciplineUnread), never healthy; before, an older answer is the rules of before.
 */
export function disciplineOf(p: Pick<PlayerCard, 'injured_until' | 'bans_pending' | 'ban_yellow_cards'>, now: Date, bansLive: boolean): Pick<PlayerView, 'injuredUntil' | 'suspended' | 'banYellows' | 'disciplineUnread'> {
  // null or a past time: not injured (card_injuries.rs). Anything else that is no time is unread.
  const until = p.injured_until === null || p.injured_until === undefined ? null : Date.parse(String(p.injured_until))
  const injuryRead = p.injured_until === null || (typeof p.injured_until === 'string' && Number.isFinite(until))
  const bansRead = typeof p.bans_pending === 'number' && Number.isFinite(p.bans_pending)
  return {
    injuredUntil: typeof until === 'number' && Number.isFinite(until) && until > now.getTime() ? new Date(until).toISOString() : null,
    suspended: bansRead && (p.bans_pending as number) > 0,
    banYellows: typeof p.ban_yellow_cards === 'number' && Number.isFinite(p.ban_yellow_cards) ? p.ban_yellow_cards : 0,
    ...(bansLive && !(injuryRead && bansRead) ? { disciplineUnread: true } : {}),
  }
}

/** FoxLeague's default lock of a moved card, in hours (its key match.transfer_cooldown_hours), when /api/config was not read. */
export const DEFAULT_TRANSFER_LOCK_HOURS = 504

/**
 * When a moved card may play again, as FoxLeague reads it (models.rs, effective_transfer_cooldown_hours): the hours
 * stamped on the card, and for a card that carries none (null) the live default /api/config serves, 504 when that was
 * not read. Null: the card was never moved. Hours left out are the default lock, never "no lock" (audit 2026-11-11,
 * EDGE-1). A time that cannot be parsed gives an invalid Date: the caller decides what unread means for it.
 */
export function transferLockEnd(transferredAt: string | null | undefined, cardHours: number | null | undefined, config?: Pick<FoxConfig, 'transfer_cooldown_hours'> | null): Date | null {
  if (!transferredAt) return null
  const served = config?.transfer_cooldown_hours
  const byDefault = typeof served === 'number' && Number.isFinite(served) && served >= 0 ? served : DEFAULT_TRANSFER_LOCK_HOURS
  const hours = typeof cardHours === 'number' && Number.isFinite(cardHours) ? cardHours : byDefault
  return new Date(new Date(transferredAt).getTime() + hours * 3600_000)
}

export function playerView(p: PlayerCard, team: Team | null, now: Date, bansLive = false, config: Pick<FoxConfig, 'transfer_cooldown_hours'> | null = null): PlayerView {
  const slot = team?.lineup.indexOf(p.nft_nonce) ?? -1
  const role: PlayerView['role'] = slot >= 0 ? 'starter' : team?.substitutes.includes(p.nft_nonce) ? 'bench' : 'reserve'
  const minted = new Date(p.minted_at ?? p.created_at)
  const synced: Record<string, number> = {}
  const live: Record<string, number> = {}
  const xp: Record<string, number> = {}
  for (const s of STATS) {
    synced[s] = p[`${s}_synced`]
    live[s] = p[s]
    xp[s] = p[`${s}_xp`]
  }
  let transferLockedUntil: string | null = null
  const until = transferLockEnd(p.transferred_at, p.transfer_cooldown_hours, config)
  if (until && until > now) transferLockedUntil = until.toISOString()
  return {
    nonce: p.nft_nonce,
    name: p.name,
    position: p.position,
    rarity: p.rarity,
    cap: RARITY_CAP[p.rarity] ?? 30,
    role,
    ...(slot >= 0 ? { slot } : {}),
    condition: p.condition,
    ageYears: Math.round((18 + (now.getTime() - minted.getTime()) / 86_400_000 / 52) * 10) / 10,
    synced,
    live,
    xp,
    dirty: p.stats_dirty,
    competitiveMatches: p.competitive_matches,
    fusionMatchCredit: p.fusion_match_credit ?? 0,
    fusionReadyAt: p.fusion_ready_at && new Date(p.fusion_ready_at) > now ? p.fusion_ready_at : null,
    listed: p.listed_for_sale,
    transferLockedUntil,
    ...disciplineOf(p, now, bansLive),
    syncedTotal: Object.values(synced).reduce((a, b) => a + b, 0),
  }
}

/**
 * The 1v1s completed in the last 7 days. FoxLeague pages the list, newest first, 500 rows a page (about four days
 * on 2026-10-05): read on until the oldest row is a week old, at most 5 pages.
 */
export async function recentChallenges(fox: FoxLeague, now: Date): Promise<Tournament[]> {
  const page = 500
  const weekAgo = now.getTime() - 7 * 86_400_000
  const rows: Tournament[] = []
  for (let offset = 0; offset < page * 5; offset += page) {
    const part = await fox.tournaments({ status: 'completed', kind: 'challenge', limit: page, offset })
    rows.push(...part)
    const oldest = part.at(-1)?.completed_at
    if (part.length < page || (oldest && new Date(oldest).getTime() < weekAgo)) break
  }
  return rows
}

/** New match statistics read per planning snapshot (about 120 KB each): the agent's own matches, then its rivals'. */
const OWN_READS_PER_TICK = 10
const RIVAL_READS_PER_TICK = 6
/** A rival's formations: those of its last revealed matches. */
const RIVAL_MATCHES = 3

const revealed = (m: MatchHistoryRow) => m.status === 'finished' && typeof m.home_score === 'number' && typeof m.away_score === 'number'

/** Both formations of a revealed match: kept ones first, else one read within this tick's budget. A failed read is null, never a guess. */
async function factsOf(fox: FoxLeague, cache: MatchFactsCache, budget: { left: number }, m: MatchHistoryRow): Promise<MatchFormations | null> {
  const key = m.tournament_match_id ? `t:${m.tournament_match_id}` : typeof m.id === 'number' ? `m:${m.id}` : null
  if (!key) return null
  const kept = cache.get(key)
  if (kept) return kept
  if (budget.left <= 0) return null
  budget.left--
  const read = await fox.matchFormations(m).catch(() => null)
  // Kept with the moment it was read: a ranked or casual match's strengths depend on it (see strengthAtKickoff).
  const f = read ? { ...read, readAt: new Date().toISOString() } : null
  if (f) cache.put(key, f)
  return f
}

/** A ranked or casual match's strengths count only from statistics read within this long of its end. */
const RANKED_STRENGTH_READ_MS = 6 * 3600_000

/**
 * Whether the strengths in a match's statistics are those both elevens played with. A tournament or 1v1 match keeps
 * its kickoff snapshot. A ranked or casual one is rebuilt at read time from the cards' current synced stats and
 * condition (FoxLeague, matches.rs launch_squad): only a read within 6 hours of its end is close to the match, and
 * facts kept without a read time are unknown (B-P1, audit 2026-10-23).
 */
function strengthAtKickoff(m: MatchHistoryRow, f: MatchFormations): boolean {
  if (m.tournament_match_id) return true
  const read = Date.parse(f.readAt ?? '')
  const end = Date.parse(m.finished_at ?? '')
  return Number.isFinite(read) && Number.isFinite(end) && read - end <= RANKED_STRENGTH_READ_MS
}

/**
 * The agent's results by its formation against the rival's, over its last 50 revealed matches. A casual game (against
 * FoxLeague's AI) goes to the casual test bench instead; a ranked game the AI filled counts in neither (owner, 2026-11-04).
 */
async function formationRecord(fox: FoxLeague, cache: MatchFactsCache, address: string, userId: number): Promise<FormationRecord> {
  const budget = { left: OWN_READS_PER_TICK }
  const games: FormationMatch[] = []
  const casual: FormationMatch[] = []
  let unread = 0
  for (const m of await fox.matchHistory(address, 50)) {
    if (!revealed(m)) continue
    const home = m.home_user_id === userId
    if (!home && m.away_user_id !== userId) continue
    const isCasual = m.match_type === 'casual'
    if (!isCasual && typeof (home ? m.away_user_id : m.home_user_id) !== 'number') continue
    const f = await factsOf(fox, cache, budget, m)
    if (!f) {
      if (!isCasual) unread++
      continue
    }
    const [ms, ts] = !strengthAtKickoff(m, f) ? [null, null] : home ? [f.homeStrength, f.awayStrength] : [f.awayStrength, f.homeStrength]
    ;(isCasual ? casual : games).push({
      key: m.tournament_match_id ? `t:${m.tournament_match_id}` : `m:${m.id}`,
      at: m.finished_at ?? new Date(0).toISOString(),
      mine: home ? f.home : f.away,
      theirs: home ? f.away : f.home,
      gf: home ? m.home_score! : m.away_score!,
      ga: home ? m.away_score! : m.home_score!,
      edge: typeof ms === 'number' && typeof ts === 'number' && ts > 0 ? ((ms - ts) / ts) * 100 : null,
      rivalUserId: home ? m.away_user_id : m.home_user_id,
    })
  }
  return { ...summariseFormations(games, unread), games, casual }
}

/**
 * The league formation table (owner, 2026-11-04): the next few teams of the leaderboard's top, in turn from plan to
 * plan, and their new public matches, newest first within this plan's reads, each kept once. Only matches between two
 * real teams count (no AI side, no casual game, a ranked or tournament match only), never one of the owner's teams.
 * A failed read is skipped and read again when its team comes round, never kept as anything. When this plan's reads run
 * out inside a team, the turn stays on that team and no further history is read (agent review of PR #48); a match
 * whose statistics did not answer waits 6 hours before it is tried again, so it never holds the turn.
 */
async function collectLeague(fox: FoxLeague, cache: MatchFactsCache, league: LeagueCache, users: UserProfile[], selfId: number, now: Date): Promise<void> {
  const own = league.own()
  own.add(selfId)
  const teams = users.slice(0, LEAGUE_TEAMS).filter(u => Number.isSafeInteger(u.id) && !own.has(u.id) && typeof u.wallet_address === 'string' && u.wallet_address)
  if (!teams.length) return
  const start = league.cursor() % teams.length
  const count = Math.min(LEAGUE_TEAMS_PER_TICK, teams.length)
  const budget = { left: LEAGUE_READS_PER_TICK }
  const since = now.getTime() - LEAGUE_DAYS * 86_400_000
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  let next = (start + count) % teams.length
  teams: for (let i = 0; i < count; i++) {
    const at0 = (start + i) % teams.length
    if (budget.left <= 0) {
      next = at0
      break
    }
    const rows = await fox.matchHistory(teams[at0]!.wallet_address, 20).catch(() => [] as MatchHistoryRow[])
    for (const m of rows) {
      if (!revealed(m) || (m.match_type !== 'ranked' && m.match_type !== 'tournament')) continue
      const home = m.home_user_id
      const away = m.away_user_id
      if (typeof home !== 'number' || typeof away !== 'number' || own.has(home) || own.has(away)) continue
      const at = Date.parse(m.finished_at ?? '')
      if (!Number.isFinite(at) || at < since) continue
      const key = m.tournament_match_id ? `t:${m.tournament_match_id}` : typeof m.id === 'number' ? `m:${m.id}` : null
      if (!key || league.has(key)) continue
      const tried = leagueTried.get(key)
      if (tried !== undefined && now.getTime() - tried < LEAGUE_RETRY_MS) continue
      if (!cache.get(key) && budget.left <= 0) {
        next = at0
        break teams
      }
      const f = await factsOf(fox, cache, budget, m)
      if (!f) {
        leagueTried.set(key, now.getTime())
        if (leagueTried.size > 2000) leagueTried.delete(leagueTried.keys().next().value!)
        continue
      }
      const kickoff = strengthAtKickoff(m, f)
      league.put({
        key, at: new Date(at).toISOString(), kind: m.match_type, homeUserId: home, awayUserId: away, home: f.home, away: f.away,
        homeScore: m.home_score!, awayScore: m.away_score!, homeStrength: kickoff ? f.homeStrength : null, awayStrength: kickoff ? f.awayStrength : null,
        homeElo: num(m.home_elo_at_match), awayElo: num(m.away_elo_at_match),
      })
    }
  }
  league.setCursor(next)
}

/** League matches whose statistics did not answer, with when they were tried (within the process; a restart tries them again). */
const leagueTried = new Map<string, number>()
const LEAGUE_RETRY_MS = 6 * 3600_000

/** How long a plan waits for its turn at the league reads before it skips them this time (the table is information only). */
const LEAGUE_TURN_WAIT_MS = 60_000
let leagueTurn: Promise<void> = Promise.resolve()

/**
 * One league collection at a time within the process (R48A-2): plans that run at once, as every agent does right after
 * a restart, take turns, so each reads on from the turn and the matches the one before left. A plan that waits longer
 * than `waitMs` gives up its turn and never runs later; true when `fn` ran.
 */
export async function takeLeagueTurn(fn: () => Promise<void>, waitMs = LEAGUE_TURN_WAIT_MS): Promise<boolean> {
  const before = leagueTurn
  let release!: () => void
  const mine = new Promise<void>(r => { release = r })
  leagueTurn = before.then(() => mine)
  let timer: ReturnType<typeof setTimeout> | undefined
  const got = await Promise.race([before.then(() => true), new Promise<boolean>(r => { timer = setTimeout(() => r(false), waitMs) })])
  clearTimeout(timer)
  if (!got) {
    // The turns behind this one wait only for the one before it.
    void before.then(release)
    return false
  }
  try {
    await fn()
    return true
  } finally {
    release()
  }
}

/** A rival's formations in its last revealed matches, newest first (only those read; an empty list is unknown). */
async function recentFormations(fox: FoxLeague, cache: MatchFactsCache, budget: { left: number }, wallet: string, userId: number): Promise<string[]> {
  const out: string[] = []
  // A casual game is a test against the AI, not a formation the rival plays for real (audit 2026-11-04, INPUT-4).
  const theirs = (await fox.matchHistory(wallet, 10)).filter(m => revealed(m) && m.match_type !== 'casual' && (m.home_user_id === userId || m.away_user_id === userId)).slice(0, RIVAL_MATCHES)
  for (const m of theirs) {
    const f = await factsOf(fox, cache, budget, m)
    if (f) out.push(m.home_user_id === userId ? f.home : f.away)
  }
  return out
}

/**
 * New sales since the last plan, newest first. Until a first read has gone back to the end of the list (or 120 days),
 * every plan reads it all, so a failed page or offsets shifted by new sales leave nothing unread for good (agent
 * review of PR #21); after it, a page whose oldest sale is already kept ends the read. At most 20 pages a plan.
 */
async function readNewSales(fox: FoxLeague, cache: MarketSalesCache, now: Date): Promise<void> {
  const oldest = new Date(now.getTime() - 120 * 86_400_000).toISOString()
  for (let page = 0; page < 20; page++) {
    let rows: Awaited<ReturnType<FoxLeague['recentSales']>>
    try {
      rows = await fox.recentSales(100, page * 100)
    } catch (err) {
      // Newer pages are kept by now: a plan that stopped at their oldest row would leave this gap for good.
      if (page > 0) cache.markIncomplete()
      throw err
    }
    // Not a list: a failed read (the attempt warns), never the end of the list.
    if (!Array.isArray(rows)) {
      if (page > 0) cache.markIncomplete()
      throw new Error('the sales list answered something else than a list')
    }
    if (!rows.length) return cache.markComplete()
    const oldestKnown = cache.has(rows.at(-1)!.id)
    cache.put(rows.filter(r => !cache.has(r.id)))
    if (rows.length < 100 || (rows.at(-1)!.sold_at ?? '') < oldest) return cache.markComplete()
    if (oldestKnown && cache.complete()) return
  }
  // 20 full pages without an error hold the newest 2,000 sales (over a month at October 2026's pace): enough for the
  // market price, so the first read is done and later plans read only the new pages (re-review of PR #21).
  cache.markComplete()
}

/** Field reads per planning snapshot: tournaments and seats per tournament (the rivals' lineups are cached 20 minutes). */
export const FIELD_TOURNAMENTS = 4
export const FIELD_SEATS = 16

/**
 * The seated teams of the open Silver and Gold tournaments the agent could join (a supported format, before the
 * deadline, a seat free, someone seated, not in it already): each team's ELO (the leaderboard, else its profile) and
 * lineup strength at full condition, as the executor reads them for the join rule. A failed read is unknown.
 */
async function readFields(fox: FoxLeague, wallet: AgentWallet, open: Tournament[], myId: number, board: UserProfile[], now: Date): Promise<NonNullable<MarketSummary['fields']>> {
  const joinable = open
    .filter(t => (t.tier === 'silver' || t.tier === 'gold' || (t.tier === 'bronze' && t.entry_fee_foxsy > 0)) && t.status === 'open' && supportedFormat(t.format) && Date.parse(t.deadline) > now.getTime() && (t.participant_count ?? 0) > 0 && (t.participant_count ?? 0) < t.max_teams)
    .sort((a, b) => a.deadline.localeCompare(b.deadline))
    .slice(0, FIELD_TOURNAMENTS)
  const out: NonNullable<MarketSummary['fields']> = []
  for (const t of joinable) {
    let detail: Awaited<ReturnType<FoxLeague['tournament']>>
    try {
      detail = await fox.tournament(t.id, t.is_private ? wallet : undefined)
    } catch {
      out.push({ id: t.id, seated: t.participant_count ?? 0, seats: null })
      continue
    }
    if (!Array.isArray(detail?.participants)) {
      out.push({ id: t.id, seated: t.participant_count ?? 0, seats: null })
      continue
    }
    if (detail.participants.some(p => p.user_id === myId)) continue
    const seated = detail.participants
    const seats = await Promise.all(seated.slice(0, FIELD_SEATS).map(async (p): Promise<FieldSeat> => {
      const listed = board.find(u => u.id === p.user_id)
      const elo = listed?.elo_rating ?? (p.wallet_address ? await rivalEloCached(fox, p.wallet_address) : null)
      const strength = p.wallet_address ? await rivalStrengthCached(fox, p.wallet_address) : null
      return { userId: p.user_id, elo: typeof elo === 'number' ? elo : null, strength }
    }))
    out.push({ id: t.id, seated: seated.length, seats })
  }
  return out
}

async function attempt<T>(warnings: string[], what: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (err) {
    warnings.push(`${what}: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

/**
 * Builds the snapshot for an agent (`wallet`), or a public-only view of any address (`watch`).
 * Every section is independent: a failing route leaves a warning, not a failed tick.
 */
/**
 * `research`: the agent reads every team it could challenge (its lineup strength) to weigh its win chance (every level since 2026-11-06).
 * `matchFacts`: a planning snapshot also reads the formation record and the formations of the next rivals.
 */
/**
 * The open auctions the plan sees, never our own: the 10 strongest, then the 3 cheapest of each rarity not among them.
 * Stats are capped per rarity, so the strongest are Rares and up, and a hunter (Commons and Uncommons) would see
 * nothing to bid on (re-review of PR #27). Either read may be missing (a failed read): the other still shows.
 */
export function auctionsShown(strongest: MarketListing[] | null, cheapest: MarketListing[] | null, own: string): MarketListing[] {
  const open = (l: MarketListing) => l.is_auction && l.owner_address !== own
  const out = (strongest ?? []).filter(open).slice(0, 10)
  const seen = new Set(out.map(l => l.nft_nonce))
  const perRarity = new Map<string, number>()
  for (const l of (cheapest ?? []).filter(open)) {
    const n = perRarity.get(l.rarity) ?? 0
    if (seen.has(l.nft_nonce) || n >= 3) continue
    perRarity.set(l.rarity, n + 1)
    seen.add(l.nft_nonce)
    out.push(l)
  }
  return out
}

/** A targeted 1v1 played this soon after its creation was arranged between the two teams (OP-1). */
export const ARRANGED_MS = 2 * 60_000

/** Whether a completed 1v1 was arranged: targeted and started within ARRANGED_MS of its creation. Unknown times: not arranged. */
export function arranged(t: Pick<Tournament, 'targeted' | 'target_user_id' | 'created_at' | 'started_at'>): boolean {
  if (!t.targeted && typeof t.target_user_id !== 'number') return false
  const lag = Date.parse(t.started_at ?? '') - Date.parse(t.created_at)
  return Number.isFinite(lag) && lag < ARRANGED_MS
}

export async function takeSnapshot(deps: SnapshotDeps, target: { wallet: AgentWallet } | { watch: string }, now = new Date(), opts: { research?: boolean; matchFacts?: MatchFactsCache; marketSales?: MarketSalesCache; league?: LeagueCache } = {}): Promise<AgentSnapshot> {
  const { chain, fox } = deps
  const warnings: string[] = []
  const wallet = 'wallet' in target ? target.wallet : null
  const address = wallet ? wallet.address : (target as { watch: string }).watch

  const [config, account, esdts, profile, teamRead, egldUsd, pool] = await Promise.all([
    attempt(warnings, 'config', () => fox.config()),
    attempt(warnings, 'account', () => chain.account(address)),
    attempt(warnings, 'esdts', () => chain.esdts(address)),
    attempt(warnings, 'profile', () => fox.user(address)),
    attempt(warnings, 'team', () => fox.team(address, wallet ?? undefined)),
    attempt(warnings, 'egld price', () => chain.egldUsd()),
    attempt(warnings, 'xExchange pool', () => poolState(chain)),
  ])

  // The agent's own team must come with its lineup (its session is sent). A public view here means FoxLeague
  // did not recognise the session: the team counts as unreadable, so nothing is planned on an empty lineup.
  if (wallet && teamRead?.hidden) warnings.push('team: FoxLeague answered without the lineup (the session was not recognised)')
  const team = wallet && teamRead?.hidden ? null : teamRead
  const bal = (id: string) => esdts?.find(e => e.tokenIdentifier === id && e.nonce === 0)?.balance ?? 0n
  const nftCount = esdts?.filter(e => e.tokenIdentifier.startsWith(`${MAINNET.playerCollection}-`)).length ?? 0
  const registered = Boolean(profile?.team_name)
  // fox.user() answers null for "not found" and the attempt wrapper answers null for a failure: only the latter leaves a warning.
  const profileUnreadable = warnings.some(w => w.startsWith('profile: '))

  const bansLive = cardBansLive(config, now)
  const players = registered
    ? ((await attempt(warnings, 'players', () => fox.players(address, wallet ?? undefined))) ?? []).map(p => playerView(p, team, now, bansLive, config))
    : []

  // Registration readiness only matters before the team exists.
  let feePaidOnChain: boolean | null = registered ? true : null
  let whitelisted: boolean | null = null
  if (!registered) {
    const pubkeyHex = wallet?.pubkeyHex ?? null
    // The starter stock is no longer public (FoxLeague removed GET /api/register/pool-status on 2026-10-12):
    // registration itself answers when no squad is left, as it does for FoxLeague's own app.
    const [paid, wl] = await Promise.all([
      pubkeyHex ? attempt(warnings, 'isRegistrationPaid', async () => b64ToBigInt((await chain.query(MAINNET.playersContract, 'isRegistrationPaid', [pubkeyHex]))[0]) === 1n) : Promise.resolve(null),
      attempt(warnings, 'whitelist', () => fox.isWhitelisted(address)),
    ])
    feePaidOnChain = paid
    whitelisted = wl
  }

  // The agent's own authed state (never in watch mode: that would need someone else's key).
  let auth: AgentSnapshot['auth'] = null
  if (wallet && registered) {
    const [shop, allowance, activeMatch, myTournaments, upcoming, challengesForMe, invitations, bestXi] = await Promise.all([
      attempt(warnings, 'shop status', () => fox.shopStatus(wallet)),
      attempt(warnings, 'daily allowance', () => fox.dailyAllowance(wallet)),
      attempt(warnings, 'active match', () => fox.activeMatch(wallet)),
      attempt(warnings, 'my tournaments', () => fox.myTournaments(wallet)),
      attempt(warnings, 'upcoming matches', () => fox.upcomingMatches(wallet)),
      attempt(warnings, 'challenges for me', () => fox.challengesForMe(wallet)),
      // Whatever FoxLeague's create switch says: it gates only creating one, invitations keep coming.
      attempt(warnings, 'league invitations', () => fox.leagueInvitations(wallet)),
      // Information only (the rule reads its own right before paying) and not live on mainnet yet: a failed read is quiet.
      Promise.resolve().then(() => fox.bestXiOvr(wallet)).catch(() => null),
    ])
    auth = { shop, allowance, activeMatch, myTournaments, upcoming, challengesForMe: challengesForMe ?? [], invitations: invitations ? invitations.map(i => ({ ...i, tournament: null })) : null, bestXiOvr: typeof bestXi?.best_xi_ovr === 'number' ? bestXi.best_xi_ovr : null }
  }

  const [openAll, completed, cancelled, board, listings, cheapListings, floors, active, pendingSc, doneChallenges] = await Promise.all([
    attempt(warnings, 'open tournaments', () => fox.tournaments({ status: 'open' })),
    attempt(warnings, 'completed tournaments', () => fox.tournaments({ status: 'completed', kind: 'standard' })),
    attempt(warnings, 'cancelled tournaments', () => fox.tournaments({ status: 'cancelled', kind: 'standard' })),
    attempt(warnings, 'leaderboard', () => fox.leaderboard(200)),
    attempt(warnings, 'marketplace listings', () => fox.listings({ sort_by: 'overall_desc', limit: 50 })),
    attempt(warnings, 'cheapest marketplace listings', () => fox.listings({ sort_by: 'price_asc', limit: 200 })),
    attempt(warnings, 'marketplace floors', () => fox.floorPrices()),
    // FoxLeague answers only its public statuses (2026-10-07): a tournament being simulated reads active.
    attempt(warnings, 'running tournaments', () => fox.tournaments({ status: 'active', kind: 'standard' })),
    attempt(warnings, 'pending tournaments', () => fox.tournaments({ status: 'pending_sc', kind: 'standard' })),
    attempt(warnings, 'completed 1v1s', () => recentChallenges(fox, now)),
  ])
  // Our League + Knockout seats before their start: when the seats lock (until then the agent may leave for the entry back).
  const seats = (auth?.myTournaments?.active ?? []).filter(t => t.format === 'league_knockout' && t.status === 'open')
  if (auth && seats.length) {
    auth.leagueSeats = await Promise.all(seats.map(async t => {
      const view = await attempt(warnings, `league seats T${t.id}`, () => fox.leagueInvitationsView(t.id, wallet!))
      const lock = view?.seats_lock_at && Number.isFinite(Date.parse(view.seats_lock_at)) ? new Date(Date.parse(view.seats_lock_at)).toISOString() : null
      return { tournamentId: t.id, seatsLockAt: lock, accepted: view && Array.isArray(view.invitations) ? view.invitations.filter(i => i.state === 'accepted').length : null }
    }))
  }
  // A tournament this team created and holds no seat in, as a create whose answer was lost can leave (audit 2026-11-04,
  // OPEN-8): the plan takes its seat, or an unfilled one keeps the organizer's deposit. A seat list that cannot be read
  // flags nothing. A 1v1 (no deposit, refunded in full at its deadline) and a tournament with no seat left are not
  // flagged: the join would be refused (audit of PR #51, R52A-I3).
  if (auth && profile && wallet) {
    const unseated: number[] = []
    for (const t of (auth.myTournaments?.active ?? []).filter(x => x.creator_user_id === profile.id && x.status === 'open' && x.max_teams !== 2).slice(0, 2)) {
      const d = await attempt(warnings, `created T${t.id}`, () => fox.tournament(t.id, wallet))
      if (d && Array.isArray(d.participants) && d.participants.length < t.max_teams && !d.participants.some(p => p.user_id === profile.id)) unseated.push(t.id)
    }
    if (unseated.length) auth.unseatedCreated = unseated
  }
  // Each invitation's tournament (its start and interval): from the open list, or read by its id.
  if (auth?.invitations?.length) {
    auth.invitations = await Promise.all(auth.invitations.map(async i => {
      const listed = (openAll ?? []).find(t => t.id === i.tournament_id)
      if (listed) return { ...i, tournament: listed }
      const read = await attempt(warnings, `league invitation T${i.tournament_id}`, () => fox.tournament(i.tournament_id, wallet!))
      return { ...i, tournament: read?.tournament ?? null }
    }))
  }
  const recentStandard = [...(completed ?? []), ...(cancelled ?? [])]
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at))
    .slice(0, 20)
    .map(t => ({ id: t.id, tier: t.tier, format: t.format, max_teams: t.max_teams, seated: t.participant_count ?? 0, fee: t.entry_fee_foxsy, status: t.status, starts_at: t.starts_at }))

  // What cards sell for: a failed read leaves the kept sales (a warning says so); none kept means no market price.
  let prices: Record<string, MarketPrice | null> | undefined
  if (opts.marketSales) {
    const sales = opts.marketSales
    await attempt(warnings, 'marketplace sales', () => readNewSales(fox, sales, now))
    prices = marketPrices(sales.since(new Date(now.getTime() - MARKET_WINDOWS.at(-1)! * 86_400_000).toISOString()), now)
  }

  // What formation wins against which: the agent's own record, then what its next rivals play.
  const facts = opts.matchFacts
  const rivalBudget = { left: RIVAL_READS_PER_TICK }
  let record: FormationRecord | null | undefined
  let rivalFormations: AgentSnapshot['rivalFormations']
  if (facts && registered && profile) {
    record = await attempt(warnings, 'match history', () => formationRecord(fox, facts, address, profile.id))
    rivalFormations = []
    for (const m of (auth?.upcoming?.matches ?? []).filter(x => x.phase === 'upcoming' && x.opponent_name).slice(0, 2)) {
      let formations: string[] | null = null
      let strength: number | null = null
      try {
        const rival = (await fox.tournament(m.tournament_id)).participants.find(p => p.user_id !== profile.id && p.team_name === m.opponent_name && p.wallet_address)
        if (rival) {
          formations = await recentFormations(fox, facts, rivalBudget, rival.wallet_address!, rival.user_id)
          strength = await rivalStrengthCached(fox, rival.wallet_address!)
        }
      } catch {
        // unknown, said as such on the Upcoming line
      }
      rivalFormations.push({ tournamentId: m.tournament_id, opponent: m.opponent_name!, formations, strength })
    }
    // The league formation table: a few more public matches of the top teams each plan, kept for the service's table.
    const league = opts.league
    if (league && board) await attempt(warnings, 'league matches', () => takeLeagueTurn(() => collectLeague(fox, facts, league, board.users, profile.id, now)))
  }

  // Scouting for the 1v1s the agent could take, so the plan does not propose ones the executor would refuse.
  const openAllChallenges = (openAll ?? []).filter(t => t.max_teams === 2)
  const scouted: { id: number; elo: number | null; strength: number | null }[] = []
  if (auth && profile && !auth.myTournaments?.active.some(t => t.max_teams === 2)) {
    const ids = [
      ...auth.challengesForMe.map(c => c.tournament_id),
      // A targeted 1v1 names its target only to the two teams: the ones for this team come in challengesForMe.
      ...openAllChallenges.filter(t => t.creator_user_id !== profile.id && !t.targeted && t.target_user_id === null).map(t => t.id),
    ].filter((id, i, all) => all.indexOf(id) === i).slice(0, 4)
    for (const id of ids) {
      try {
        const d = await fox.tournament(id)
        const seat = d.participants.find(p => p.user_id !== profile.id && p.wallet_address)
        const rival = seat?.wallet_address
        if (!seat || !rival) continue
        const elo = (board?.users ?? []).find(u => u.wallet_address === rival)?.elo_rating ?? (await fox.user(rival))?.elo_rating ?? null
        const formations = facts ? await recentFormations(fox, facts, rivalBudget, rival, seat.user_id).catch(() => null) : undefined
        scouted.push({ id, elo, strength: await rivalStrength(fox, rival).catch(() => null), ...(formations !== undefined ? { formations } : {}) })
      } catch {
        // unknown: the executor refuses a 1v1 against an unreadable rival anyway
      }
    }
  }

  // Who accepts 1v1s: the side of a 1v1 completed in the last 7 days that did not create it. A targeted
  // challenge to a team that never accepts only locks the stake until the deadline. A targeted 1v1 played within
  // ARRANGED_MS of its creation was arranged between the two teams first, and says nothing of whether that team takes
  // a stranger's challenge (owner, 2026-11-06, OP-1: 281 of 294 targeted 1v1s accepted, half within 36 seconds, against
  // 2 of the agents' 233).
  const weekAgo = now.getTime() - 7 * 86_400_000
  const accepted = new Map<number, number>()
  for (const t of doneChallenges ?? []) {
    if (t.max_teams !== 2 || !t.completed_at || new Date(t.completed_at).getTime() < weekAgo) continue
    if (arranged(t)) continue
    const taker = [t.winner_user_id, t.runner_up_user_id].find(u => typeof u === 'number' && u !== t.creator_user_id)
    if (typeof taker === 'number') accepted.set(taker, (accepted.get(taker) ?? 0) + 1)
  }
  const myElo = profile?.elo_rating ?? 1200
  const gap = (u: { elo_rating: number }) => Math.abs(u.elo_rating - myElo)
  const others = (board?.users ?? []).filter(u => u.wallet_address !== address && u.team_name && u.id !== profile?.id)
  const ovrOf = (u: UserProfile) => (typeof u.best_xi_ovr === 'number' && Number.isFinite(u.best_xi_ovr) ? u.best_xi_ovr : null)
  const boardOvrs = board ? { all: others.map(ovrOf).filter((v): v is number => v !== null), takers: others.filter(u => (accepted.get(u.id) ?? 0) > 0).map(ovrOf).filter((v): v is number => v !== null) } : undefined
  // Up to 6 teams that accept 1v1s and are not 100 or more ELO above (the executor refuses those), then the nearest.
  const takers = others.filter(u => (accepted.get(u.id) ?? 0) > 0 && u.elo_rating < myElo + 100).sort((a, b) => gap(a) - gap(b)).slice(0, 6)
  const nearest = others.filter(u => !takers.includes(u)).sort((a, b) => gap(a) - gap(b)).slice(0, 10 - takers.length)
  const leaderboardNeighbours: AgentSnapshot['leaderboardNeighbours'] = [...takers, ...nearest]
    .map(u => ({ id: u.id, wallet_address: u.wallet_address, team_name: u.team_name, elo_rating: u.elo_rating, league: u.league, accepted7d: accepted.get(u.id) ?? 0, matches: (u.matches_won ?? 0) + (u.matches_drawn ?? 0) + (u.matches_lost ?? 0), bestXiOvr: typeof u.best_xi_ovr === 'number' && Number.isFinite(u.best_xi_ovr) ? u.best_xi_ovr : null }))
  if (opts.research && registered) {
    // Our eleven as the engine sees it today (synced stats scaled by condition), against each rival at full condition.
    const mine = (team?.lineup ?? []).reduce((sum, n) => {
      const p = players.find(x => x.nonce === n)
      return sum + (p ? (p.syncedTotal * (50 + p.condition / 2)) / 100 : 0)
    }, 0)
    for (const u of leaderboardNeighbours) {
      u.strength = await rivalStrengthCached(fox, u.wallet_address)
      u.winChance = winChance({ myElo: profile?.elo_rating ?? null, oppElo: u.elo_rating, myStrength: mine || null, oppStrength: u.strength })
    }
  }

  // Private tournaments: FoxLeague tells only a team's own session whether it is invited. The agent may join one it
  // is invited to, so only those are kept, with the split their own platform fee pays.
  // A League + Knockout is by invitation only: it shows among the invitations, never as an open tournament.
  const openStandard = (openAll ?? []).filter(t => t.max_teams > 2 && !t.is_private && t.format !== 'league_knockout')
  if (wallet && registered) {
    const privates = (openAll ?? []).filter(t => t.max_teams > 2 && t.is_private).sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 8)
    const details = await Promise.all(privates.map(t => attempt(warnings, `private T${t.id}`, () => fox.tournament(t.id, wallet))))
    privates.forEach((t, i) => {
      if (details[i]?.user_can_join_private === true) openStandard.push({ ...t, invited: true, prize_split: details[i]?.prize_split ?? null })
    })
  }

  // A field the plan can judge before paying (planning snapshots only), with the test the join rule applies.
  const fields = facts && wallet && registered && profile ? await readFields(fox, wallet, openStandard, profile.id, board?.users ?? [], now) : undefined
  // FoxLeague's own free starts for a create (planning snapshots only, P-O1): a failed read is unknown, never free.
  const calendar = facts && wallet && registered ? await readCalendar(fox, warnings) : undefined

  const egldPerFoxsy = pool?.spotEgldPerFoxsy ?? null
  // The plan is told, so it does not plan a swap that would only be refused.
  if (pool && !pool.active) warnings.push(`xExchange pool: ${PAIR_PAUSED}`)
  return {
    takenAt: now.toISOString(),
    watchOnly: !wallet,
    agent: { index: wallet?.index ?? null, address, shard: wallet?.shard ?? null },
    gameDay: gameDay(now, auth?.allowance?.reset_hour_utc ?? 14),
    // Balances unreadable are unknown, never "0 FOXSY": with either route failed the whole section is unknown, so the
    // rules refuse blind (and no swap is planned for FOXSY the wallet already holds).
    chain: account && esdts ? { egld: account.balance, nonce: account.nonce, foxsy: bal(MAINNET.foxsyToken), wegld: bal(MAINNET.wegldToken), nftCount } : null,
    prices: egldUsd && egldPerFoxsy ? { egldUsd, egldPerFoxsy, foxsyUsd: egldUsd * egldPerFoxsy, ...(pool && !pool.active ? { frozen: true } : {}) } : null,
    config,
    registration: {
      registered,
      teamName: profile?.team_name ?? null,
      feePaidOnChain,
      whitelisted,
      relayerEnabled: config?.relayer_v3_enabled ?? null,
      relaysRemaining: config?.relays_remaining_today ?? null,
      profileUnreadable,
    },
    profile,
    team,
    players,
    auth,
    market: {
      openStandard,
      openChallenges: (openAll ?? []).filter(t => t.max_teams === 2),
      recentStandard,
      scouted,
      slots: slotWindows([...(openAll ?? []), ...(active ?? []), ...(pendingSc ?? [])]),
      auctions: auctionsShown(listings, cheapListings, address),
      ...(boardOvrs ? { boardOvrs } : {}),
      floors: floors ?? [],
      ...(prices ? { prices } : {}),
      ...(fields ? { fields } : {}),
      ...(calendar ? { calendar } : {}),
    },
    ...(record !== undefined ? { formationRecord: record } : {}),
    ...(rivalFormations ? { rivalFormations } : {}),
    leaderboardNeighbours,
    warnings,
  }
}
