// Read-only snapshot of one agent's world: what a player sees by browsing FoxLeague plus the chain.
// Public routes and the agent's own authed routes only (README guardrail "public information only").

import { slotWindows, type SlotWindow } from '../executor/slots.ts'
import { MAINNET } from '../config.ts'
import type { Chain } from '../chain/gateway.ts'
import { PAIR_PAUSED, poolState } from '../chain/xexchange.ts'
import { b64ToBigInt } from '../util/encoding.ts'
import { rivalStrength, type FoxLeague } from '../foxleague/api.ts'
import { winChance } from './winchance.ts'
import { summariseFormations, type FormationMatch, type FormationRecord } from './formations.ts'

/** A rival's lineup strength, read at most every 20 minutes (a roster changes slowly; 25 agents share FoxLeague's rate). */
const rivalSeen = new Map<string, { at: number; strength: number | null }>()
async function rivalStrengthCached(fox: FoxLeague, wallet: string): Promise<number | null> {
  const hit = rivalSeen.get(wallet)
  if (hit && Date.now() - hit.at < 20 * 60_000) return hit.strength
  const strength = await rivalStrength(fox, wallet).catch(() => null)
  rivalSeen.set(wallet, { at: Date.now(), strength })
  if (rivalSeen.size > 500) rivalSeen.delete(rivalSeen.keys().next().value!)
  return strength
}
import {
  RARITY_CAP,
  STATS,
  type ActiveMatch,
  type ChallengeForMe,
  type DailyAllowance,
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
  /** Open auctions, strongest cards first (public listings), and the reserve floor of each rarity. */
  auctions: MarketListing[]
  floors: FloorPrice[]
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
  } | null
  market: MarketSummary
  /**
   * Teams to challenge: the ones that accept 1v1s first (`accepted7d`), then the nearest by ELO. `matches` is the
   * team's record so far (its activity is the change over days); a Zeus agent also reads each team's lineup
   * strength and its own win chance against it.
   */
  /** Planning snapshots only (absent otherwise); null when the match history could not be read. */
  formationRecord?: FormationRecord | null
  /** Planning snapshots only, added by the service: every team the install runs, matches between them left out. */
  formationPool?: FormationRecord
  /** For the next upcoming matches: the rival's formations in its last revealed matches, newest first; null when unknown. */
  rivalFormations?: { tournamentId: number; opponent: string; formations: string[] | null }[]
  leaderboardNeighbours: (Pick<UserProfile, 'id' | 'wallet_address' | 'team_name' | 'elo_rating' | 'league'> & { accepted7d: number; matches?: number; strength?: number | null; winChance?: number | null; played?: { matches: number; days: number } | null })[]
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

export function playerView(p: PlayerCard, team: Team | null, now: Date): PlayerView {
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
  if (p.transferred_at) {
    const until = new Date(new Date(p.transferred_at).getTime() + (p.transfer_cooldown_hours ?? 504) * 3600_000)
    if (until > now) transferLockedUntil = until.toISOString()
  }
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
  const f = await fox.matchFormations(m).catch(() => null)
  if (f) cache.put(key, f)
  return f
}

/** The agent's results by its formation against the rival's, over its last 50 revealed matches. */
async function formationRecord(fox: FoxLeague, cache: MatchFactsCache, address: string, userId: number): Promise<FormationRecord> {
  const budget = { left: OWN_READS_PER_TICK }
  const games: FormationMatch[] = []
  let unread = 0
  for (const m of await fox.matchHistory(address, 50)) {
    if (!revealed(m)) continue
    const home = m.home_user_id === userId
    if (!home && m.away_user_id !== userId) continue
    const f = await factsOf(fox, cache, budget, m)
    if (!f) {
      unread++
      continue
    }
    const [ms, ts] = home ? [f.homeStrength, f.awayStrength] : [f.awayStrength, f.homeStrength]
    games.push({
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
  return { ...summariseFormations(games, unread), games }
}

/** A rival's formations in its last revealed matches, newest first (only those read; an empty list is unknown). */
async function recentFormations(fox: FoxLeague, cache: MatchFactsCache, budget: { left: number }, wallet: string, userId: number): Promise<string[]> {
  const out: string[] = []
  const theirs = (await fox.matchHistory(wallet, 10)).filter(m => revealed(m) && (m.home_user_id === userId || m.away_user_id === userId)).slice(0, RIVAL_MATCHES)
  for (const m of theirs) {
    const f = await factsOf(fox, cache, budget, m)
    if (f) out.push(m.home_user_id === userId ? f.home : f.away)
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
 * `research`: a Zeus agent reads every team it could challenge (its lineup strength) to weigh its win chance.
 * `matchFacts`: a planning snapshot also reads the formation record and the formations of the next rivals.
 */
export async function takeSnapshot(deps: SnapshotDeps, target: { wallet: AgentWallet } | { watch: string }, now = new Date(), opts: { research?: boolean; matchFacts?: MatchFactsCache } = {}): Promise<AgentSnapshot> {
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

  const players = registered
    ? ((await attempt(warnings, 'players', () => fox.players(address, wallet ?? undefined))) ?? []).map(p => playerView(p, team, now))
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
    const [shop, allowance, activeMatch, myTournaments, upcoming, challengesForMe] = await Promise.all([
      attempt(warnings, 'shop status', () => fox.shopStatus(wallet)),
      attempt(warnings, 'daily allowance', () => fox.dailyAllowance(wallet)),
      attempt(warnings, 'active match', () => fox.activeMatch(wallet)),
      attempt(warnings, 'my tournaments', () => fox.myTournaments(wallet)),
      attempt(warnings, 'upcoming matches', () => fox.upcomingMatches(wallet)),
      attempt(warnings, 'challenges for me', () => fox.challengesForMe(wallet)),
    ])
    auth = { shop, allowance, activeMatch, myTournaments, upcoming, challengesForMe: challengesForMe ?? [] }
  }

  const [openAll, completed, cancelled, board, listings, floors, active, pendingSc, doneChallenges] = await Promise.all([
    attempt(warnings, 'open tournaments', () => fox.tournaments({ status: 'open' })),
    attempt(warnings, 'completed tournaments', () => fox.tournaments({ status: 'completed', kind: 'standard' })),
    attempt(warnings, 'cancelled tournaments', () => fox.tournaments({ status: 'cancelled', kind: 'standard' })),
    attempt(warnings, 'leaderboard', () => fox.leaderboard(200)),
    attempt(warnings, 'marketplace listings', () => fox.listings({ sort_by: 'overall_desc', limit: 50 })),
    attempt(warnings, 'marketplace floors', () => fox.floorPrices()),
    // FoxLeague answers only its public statuses (2026-10-07): a tournament being simulated reads active.
    attempt(warnings, 'running tournaments', () => fox.tournaments({ status: 'active', kind: 'standard' })),
    attempt(warnings, 'pending tournaments', () => fox.tournaments({ status: 'pending_sc', kind: 'standard' })),
    attempt(warnings, 'completed 1v1s', () => recentChallenges(fox, now)),
  ])
  const recentStandard = [...(completed ?? []), ...(cancelled ?? [])]
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at))
    .slice(0, 20)
    .map(t => ({ id: t.id, tier: t.tier, format: t.format, max_teams: t.max_teams, seated: t.participant_count ?? 0, fee: t.entry_fee_foxsy, status: t.status, starts_at: t.starts_at }))

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
      try {
        const rival = (await fox.tournament(m.tournament_id)).participants.find(p => p.user_id !== profile.id && p.team_name === m.opponent_name && p.wallet_address)
        if (rival) formations = await recentFormations(fox, facts, rivalBudget, rival.wallet_address!, rival.user_id)
      } catch {
        // unknown, said as such on the Upcoming line
      }
      rivalFormations.push({ tournamentId: m.tournament_id, opponent: m.opponent_name!, formations })
    }
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
  // challenge to a team that never accepts only locks the stake until the deadline.
  const weekAgo = now.getTime() - 7 * 86_400_000
  const accepted = new Map<number, number>()
  for (const t of doneChallenges ?? []) {
    if (t.max_teams !== 2 || !t.completed_at || new Date(t.completed_at).getTime() < weekAgo) continue
    const taker = [t.winner_user_id, t.runner_up_user_id].find(u => typeof u === 'number' && u !== t.creator_user_id)
    if (typeof taker === 'number') accepted.set(taker, (accepted.get(taker) ?? 0) + 1)
  }
  const myElo = profile?.elo_rating ?? 1200
  const gap = (u: { elo_rating: number }) => Math.abs(u.elo_rating - myElo)
  const others = (board?.users ?? []).filter(u => u.wallet_address !== address && u.team_name && u.id !== profile?.id)
  // Up to 6 teams that accept 1v1s and are not 100 or more ELO above (the executor refuses those), then the nearest.
  const takers = others.filter(u => (accepted.get(u.id) ?? 0) > 0 && u.elo_rating < myElo + 100).sort((a, b) => gap(a) - gap(b)).slice(0, 6)
  const nearest = others.filter(u => !takers.includes(u)).sort((a, b) => gap(a) - gap(b)).slice(0, 10 - takers.length)
  const leaderboardNeighbours: AgentSnapshot['leaderboardNeighbours'] = [...takers, ...nearest]
    .map(u => ({ id: u.id, wallet_address: u.wallet_address, team_name: u.team_name, elo_rating: u.elo_rating, league: u.league, accepted7d: accepted.get(u.id) ?? 0, matches: (u.matches_won ?? 0) + (u.matches_drawn ?? 0) + (u.matches_lost ?? 0) }))
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

  // Private tournaments: FoxLeague tells only a team's own session whether it is invited. The agent never
  // creates one; it may join one it is invited to, so only those are kept.
  const openStandard = (openAll ?? []).filter(t => t.max_teams > 2 && !t.is_private)
  if (wallet && registered) {
    const privates = (openAll ?? []).filter(t => t.max_teams > 2 && t.is_private).sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 8)
    const details = await Promise.all(privates.map(t => attempt(warnings, `private T${t.id}`, () => fox.tournament(t.id, wallet))))
    privates.forEach((t, i) => {
      if (details[i]?.user_can_join_private === true) openStandard.push({ ...t, invited: true })
    })
  }

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
      auctions: (listings ?? []).filter(l => l.is_auction && l.owner_address !== address).slice(0, 15),
      floors: floors ?? [],
    },
    ...(record !== undefined ? { formationRecord: record } : {}),
    ...(rivalFormations ? { rivalFormations } : {}),
    leaderboardNeighbours,
    warnings,
  }
}
