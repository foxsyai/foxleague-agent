// Read-only snapshot of one agent's world: what a player sees by browsing FoxLeague plus the chain.
// Public routes and the agent's own authed routes only (README guardrail "public information only").

import { slotWindows, type SlotWindow } from '../executor/slots.ts'
import { MAINNET } from '../config.ts'
import type { Chain } from '../chain/gateway.ts'
import { poolState } from '../chain/xexchange.ts'
import { b64ToBigInt } from '../util/encoding.ts'
import { rivalStrength, type FoxLeague } from '../foxleague/api.ts'
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
  scouted?: { id: number; elo: number | null; strength: number | null }[]
  /** Platform-wide time slots a created tournament may not overlap (open and running standard tournaments). */
  slots: SlotWindow[]
  /** Open auctions, strongest cards first (public listings), and the reserve floor of each rarity. */
  auctions: MarketListing[]
  floors: FloorPrice[]
}

export interface AgentSnapshot {
  takenAt: string
  /** Set in watch mode: a public read of someone else's team, no authed routes. */
  watchOnly: boolean
  agent: { index: number | null; address: string; shard: number | null }
  gameDay: { resetHourUtc: number; nextResetAt: string; hoursToReset: number }
  chain: { egld: bigint; nonce: number; foxsy: bigint; wegld: bigint; nftCount: number } | null
  prices: { egldUsd: number; egldPerFoxsy: number; foxsyUsd: number } | null
  config: FoxConfig | null
  registration: {
    registered: boolean
    teamName: string | null
    feePaidOnChain: boolean | null
    whitelisted: boolean | null
    relayerEnabled: boolean | null
    relaysRemaining: number | null
    starterStock: number | null
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
  leaderboardNeighbours: Pick<UserProfile, 'id' | 'wallet_address' | 'team_name' | 'elo_rating' | 'league'>[]
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
export async function takeSnapshot(deps: SnapshotDeps, target: { wallet: AgentWallet } | { watch: string }, now = new Date()): Promise<AgentSnapshot> {
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

  const players = registered
    ? ((await attempt(warnings, 'players', () => fox.players(address))) ?? []).map(p => playerView(p, team, now))
    : []

  // Registration readiness only matters before the team exists.
  let feePaidOnChain: boolean | null = registered ? true : null
  let whitelisted: boolean | null = null
  let starterStock: number | null = null
  if (!registered) {
    const pubkeyHex = wallet?.pubkeyHex ?? null
    const [paid, wl, stock] = await Promise.all([
      pubkeyHex ? attempt(warnings, 'isRegistrationPaid', async () => b64ToBigInt((await chain.query(MAINNET.playersContract, 'isRegistrationPaid', [pubkeyHex]))[0]) === 1n) : Promise.resolve(null),
      attempt(warnings, 'whitelist', () => fox.isWhitelisted(address)),
      attempt(warnings, 'pool status', async () => (await fox.poolStatus()).available),
    ])
    feePaidOnChain = paid
    whitelisted = wl
    starterStock = stock
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

  const [openAll, completed, cancelled, board, listings, floors, active, pendingSc, simulating] = await Promise.all([
    attempt(warnings, 'open tournaments', () => fox.tournaments({ status: 'open' })),
    attempt(warnings, 'completed tournaments', () => fox.tournaments({ status: 'completed', kind: 'standard' })),
    attempt(warnings, 'cancelled tournaments', () => fox.tournaments({ status: 'cancelled', kind: 'standard' })),
    attempt(warnings, 'leaderboard', () => fox.leaderboard(100)),
    attempt(warnings, 'marketplace listings', () => fox.listings({ sort_by: 'overall_desc', limit: 50 })),
    attempt(warnings, 'marketplace floors', () => fox.floorPrices()),
    attempt(warnings, 'running tournaments', () => fox.tournaments({ status: 'active', kind: 'standard' })),
    attempt(warnings, 'pending tournaments', () => fox.tournaments({ status: 'pending_sc', kind: 'standard' })),
    attempt(warnings, 'simulating tournaments', () => fox.tournaments({ status: 'simulating', kind: 'standard' })),
  ])
  const recentStandard = [...(completed ?? []), ...(cancelled ?? [])]
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at))
    .slice(0, 20)
    .map(t => ({ id: t.id, tier: t.tier, format: t.format, max_teams: t.max_teams, seated: t.participant_count ?? 0, fee: t.entry_fee_foxsy, status: t.status, starts_at: t.starts_at }))

  // Scouting for the 1v1s the agent could take, so the plan does not propose ones the executor would refuse.
  const openAllChallenges = (openAll ?? []).filter(t => t.max_teams === 2)
  const scouted: { id: number; elo: number | null; strength: number | null }[] = []
  if (auth && profile && !auth.myTournaments?.active.some(t => t.max_teams === 2)) {
    const ids = [
      ...auth.challengesForMe.map(c => c.tournament_id),
      ...openAllChallenges.filter(t => t.creator_user_id !== profile.id && (t.target_user_id === null || t.target_user_id === profile.id)).map(t => t.id),
    ].filter((id, i, all) => all.indexOf(id) === i).slice(0, 4)
    for (const id of ids) {
      try {
        const d = await fox.tournament(id)
        const rival = d.participants.find(p => p.user_id !== profile.id && p.wallet_address)?.wallet_address
        if (!rival) continue
        const elo = (board?.users ?? []).find(u => u.wallet_address === rival)?.elo_rating ?? (await fox.user(rival))?.elo_rating ?? null
        scouted.push({ id, elo, strength: await rivalStrength(fox, rival).catch(() => null) })
      } catch {
        // unknown: the executor refuses a 1v1 against an unreadable rival anyway
      }
    }
  }

  const myElo = profile?.elo_rating ?? 1200
  const leaderboardNeighbours = (board?.users ?? [])
    .filter(u => u.wallet_address !== address && u.team_name)
    .sort((a, b) => Math.abs(a.elo_rating - myElo) - Math.abs(b.elo_rating - myElo))
    .slice(0, 10)
    .map(u => ({ id: u.id, wallet_address: u.wallet_address, team_name: u.team_name, elo_rating: u.elo_rating, league: u.league }))

  const egldPerFoxsy = pool?.spotEgldPerFoxsy ?? null
  return {
    takenAt: now.toISOString(),
    watchOnly: !wallet,
    agent: { index: wallet?.index ?? null, address, shard: wallet?.shard ?? null },
    gameDay: gameDay(now, auth?.allowance?.reset_hour_utc ?? 14),
    chain: account ? { egld: account.balance, nonce: account.nonce, foxsy: bal(MAINNET.foxsyToken), wegld: bal(MAINNET.wegldToken), nftCount } : null,
    prices: egldUsd && egldPerFoxsy ? { egldUsd, egldPerFoxsy, foxsyUsd: egldUsd * egldPerFoxsy } : null,
    config,
    registration: {
      registered,
      teamName: profile?.team_name ?? null,
      feePaidOnChain,
      whitelisted,
      relayerEnabled: config?.relayer_v3_enabled ?? null,
      relaysRemaining: config?.relays_remaining_today ?? null,
      starterStock,
    },
    profile,
    team,
    players,
    auth,
    market: {
      openStandard: (openAll ?? []).filter(t => t.max_teams > 2),
      openChallenges: (openAll ?? []).filter(t => t.max_teams === 2),
      recentStandard,
      scouted,
      slots: slotWindows([...(openAll ?? []), ...(active ?? []), ...(pendingSc ?? []), ...(simulating ?? [])]),
      auctions: (listings ?? []).filter(l => l.is_auction && l.owner_address !== address).slice(0, 15),
      floors: floors ?? [],
    },
    leaderboardNeighbours,
    warnings,
  }
}
