// FoxLeague public HTTP API, as the web app calls it (frontend/src/lib/api.ts). A refusal is HTTP
// 200 with success:false (docs/FOXLEAGUE-INTEGRATION.md 1.3); the auth extractor answers 401 in
// plain text, and the client signs a fresh login once and replays, like the web app.

import { HttpError, RateLimiter, requestJson, sleep } from '../util/http.ts'
import type { AgentWallet } from '../wallet/wallet.ts'
import type {
  DailyAllowance,
  FoxConfig,
  PlayerCard,
  MatchWaiverQuote,
  ShopStatus,
  Team,
  Tournament,
  TournamentDetail,
  UpcomingMatches,
  UserProfile,
  ChallengeForMe,
  ActiveMatch,
  MyTournaments,
  LeaderboardPage,
  CanFuse,
  CanList,
  FloorPrice,
  MarketListing,
  MatchFormations,
  MatchHistoryRow,
} from './types.ts'
import { STATS } from './types.ts'
import type { MarketSale } from '../snapshot/market.ts'

export class ApiRefusal extends Error {
  readonly code: string | undefined
  readonly data: unknown
  constructor(message: string, code?: string, data?: unknown) {
    super(message)
    this.code = code
    this.data = data
  }
  /** The payment was not refused, only not verifiable yet: keep the hash, confirm it again later. */
  get isTxPending(): boolean {
    return this.code === 'tx_pending'
  }
}

interface Envelope<T> {
  success: boolean
  data?: T
  error?: string
  code?: string
}

export class FoxLeague {
  private readonly base: string
  private readonly limiter: RateLimiter
  private readonly sessions = new Map<string, { token: string; at: number }>()

  constructor(baseUrl: string, rps: number) {
    this.base = `${baseUrl}/api`
    this.limiter = new RateLimiter(rps, Math.max(2, Math.floor(rps)))
  }

  // ---- plumbing ----

  private async call<T>(path: string, opts: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown; wallet?: AgentWallet; timeoutMs?: number; raw?: boolean; headers?: Record<string, string> } = {}): Promise<T> {
    const doCall = async (): Promise<{ status: number; json: unknown }> => {
      const headers: Record<string, string> = { ...opts.headers }
      if (opts.wallet) headers.authorization = `Bearer ${await this.token(opts.wallet)}`
      try {
        return await requestJson<unknown>(this.limiter, `${this.base}${path}`, {
          method: opts.method,
          body: opts.body,
          headers,
          timeoutMs: opts.timeoutMs,
        })
      } catch (err) {
        // The auth extractor's 401 has a plain-text body, which requestJson reports as HttpError.
        if (err instanceof HttpError && err.status === 401) return { status: 401, json: null }
        throw err
      }
    }
    let res = await doCall()
    if (res.status === 401 && opts.wallet) {
      this.sessions.delete(opts.wallet.address)
      res = await doCall()
    }
    if (res.status === 401) throw new ApiRefusal('session rejected (401)')
    if (opts.raw) return res.json as T
    const env = res.json as Envelope<T> | null
    if (!env || typeof env !== 'object' || !('success' in env)) {
      throw new ApiRefusal(`unexpected answer from ${path} (HTTP ${res.status})`)
    }
    if (!env.success) throw new ApiRefusal(env.error ?? 'refused', env.code, env.data)
    return env.data as T
  }

  /** Session token for an agent: sign `foxleague:chain=1:auth-{ts}` (section 2). */
  /** Logins in flight: calls made together share one, since a signature is single-use and the message only changes each second. */
  private readonly logins = new Map<string, Promise<string>>()

  private token(wallet: AgentWallet): Promise<string> {
    const cached = this.sessions.get(wallet.address)
    // Sessions last 24 h by default; re-sign well before.
    if (cached && Date.now() - cached.at < 12 * 3600_000) return Promise.resolve(cached.token)
    let login = this.logins.get(wallet.address)
    if (!login) {
      login = this.login(wallet).finally(() => this.logins.delete(wallet.address))
      this.logins.set(wallet.address, login)
    }
    return login
  }

  /** The second each wallet last signed in: a signature logs in once, so the next login waits for a newer second. */
  private readonly lastLoginSecond = new Map<string, number>()

  private async login(wallet: AgentWallet): Promise<string> {
    let timestamp = Math.floor(Date.now() / 1000)
    const last = this.lastLoginSecond.get(wallet.address) ?? 0
    if (timestamp <= last) {
      await sleep((last + 1) * 1000 - Date.now() + 10)
      timestamp = last + 1
    }
    this.lastLoginSecond.set(wallet.address, timestamp)
    const signature = wallet.signMessage(`foxleague:chain=1:auth-${timestamp}`)
    const { json } = await requestJson<Envelope<{ token: string }>>(this.limiter, `${this.base}/auth/verify`, {
      method: 'POST',
      body: { address: wallet.address, timestamp, signature },
    })
    if (!json?.success || !json.data?.token) throw new ApiRefusal(`login failed: ${json?.error ?? 'no token'}`)
    this.sessions.set(wallet.address, { token: json.data.token, at: Date.now() })
    return json.data.token
  }

  // ---- public reads ----

  config(): Promise<FoxConfig> {
    return this.call<FoxConfig>('/config', { raw: true })
  }

  /** Marketplace sales, newest first (public; at most 100 a page). */
  recentSales(limit = 100, offset = 0): Promise<MarketSale[]> {
    return this.call<MarketSale[]>(`/marketplace/recent-sales?limit=${limit}&offset=${offset}`)
  }

  /** A team's revealed matches, newest first (public for any wallet). */
  matchHistory(address: string, limit = 50): Promise<MatchHistoryRow[]> {
    return this.call<MatchHistoryRow[]>(`/matches/history?wallet_address=${encodeURIComponent(address)}&limit=${limit}`)
  }

  /**
   * Both formations of a revealed match and each eleven's strength, from its public statistics (about 120 KB:
   * GET /api/public/tournament-match/{id}/stats for a tournament or 1v1 match, /api/matches/{id}/stats for ranked
   * and casual). null while FoxLeague still hides them (before the reveal) or the match has no such id.
   */
  async matchFormations(m: Pick<MatchHistoryRow, 'id' | 'tournament_match_id'>): Promise<MatchFormations | null> {
    const path = typeof m.tournament_match_id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(m.tournament_match_id)
      ? `/public/tournament-match/${m.tournament_match_id}/stats`
      : Number.isSafeInteger(m.id) && (m.id as number) > 0 ? `/matches/${m.id}/stats` : null
    if (!path) return null
    const s = await this.call<{ gated?: boolean; home_formation?: unknown; away_formation?: unknown; home_lineup?: unknown; away_lineup?: unknown } | null>(path)
    if (!s || s.gated || typeof s.home_formation !== 'string' || typeof s.away_formation !== 'string') return null
    return { home: s.home_formation, away: s.away_formation, homeStrength: elevenStrength(s.home_lineup), awayStrength: elevenStrength(s.away_lineup) }
  }

  /** null when the wallet never logged in (`User not found`). */
  async user(address: string): Promise<UserProfile | null> {
    try {
      return await this.call<UserProfile>(`/users/${address}`)
    } catch (err) {
      if (err instanceof ApiRefusal && /not found/i.test(err.message)) return null
      throw err
    }
  }

  /**
   * A team. Its formation, eleven, bench and overall are answered to the team's own session only: pass the
   * agent's `wallet` for its own team. Anyone else's team comes back `hidden`, with those fields empty.
   */
  async team(address: string, wallet?: AgentWallet): Promise<Team | null> {
    try {
      const t = await this.call<Partial<Team> & Pick<Team, 'id' | 'user_id' | 'name'>>(`/teams/${address}`, wallet && wallet.address === address ? { wallet } : {})
      const hidden = !Array.isArray(t.lineup)
      return { ...t, coach_name: t.coach_name ?? null, badge: t.badge ?? null, formation: t.formation ?? '', lineup: t.lineup ?? [], substitutes: t.substitutes ?? [], team_overall: t.team_overall ?? 0, ...(hidden ? { hidden } : {}) }
    } catch (err) {
      if (err instanceof ApiRefusal && /not found/i.test(err.message)) return null
      throw err
    }
  }

  /**
   * Roster (30 s server cache, never invalidated): read single cards with player() after a change. Asked with the
   * wallet's own session, FoxLeague reads the cards from the chain; anyone else gets its own records (2026-10-07).
   * Listed cards are left out either way.
   */
  players(address: string, wallet?: AgentWallet): Promise<PlayerCard[]> {
    return this.call<PlayerCard[]>(`/players/${address}`, wallet ? { wallet } : {})
  }

  player(nonce: number): Promise<PlayerCard> {
    return this.call<PlayerCard>(`/players/nonce/${nonce}`)
  }

  /** A page of tournaments, newest first (FoxLeague pages its lists: at most 500 rows a page, `offset` for more). */
  tournaments(q: { status?: string; kind?: 'standard' | 'challenge'; tier?: string; format?: string; limit?: number; offset?: number } = {}): Promise<Tournament[]> {
    const params = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]): [string, string] => [k, String(v)]))
    return this.call<Tournament[]>(`/tournaments${params.size ? `?${params}` : ''}`)
  }

  /**
   * A tournament's detail. With the agent's wallet its session goes along: FoxLeague answers the caller's own
   * fields (for a private tournament, whether this team is invited) only to that session.
   */
  tournament(id: number, wallet?: AgentWallet): Promise<TournamentDetail> {
    return this.call<TournamentDetail>(`/tournaments/${id}${wallet ? `?wallet_address=${wallet.address}` : ''}`, wallet ? { wallet } : {})
  }

  leaderboard(limit = 50, offset = 0): Promise<LeaderboardPage> {
    return this.call<LeaderboardPage>(`/leaderboard?limit=${limit}&offset=${offset}`)
  }

  async isWhitelisted(address: string): Promise<boolean> {
    return (await this.call<{ is_whitelisted: boolean }>(`/whitelist/check?wallet_address=${address}`)).is_whitelisted
  }

  // ---- authed reads (the agent's own wallet) ----

  shopStatus(w: AgentWallet): Promise<ShopStatus> {
    return this.call<ShopStatus>(`/shop/status?wallet_address=${w.address}`, { wallet: w })
  }

  dailyAllowance(w: AgentWallet): Promise<DailyAllowance> {
    return this.call<DailyAllowance>(`/matches/daily-allowance?wallet_address=${w.address}`, { wallet: w })
  }

  activeMatch(w: AgentWallet): Promise<ActiveMatch | null> {
    return this.call<ActiveMatch | null>(`/matches/active?wallet_address=${w.address}`, { wallet: w })
  }

  myTournaments(w: AgentWallet): Promise<MyTournaments> {
    return this.call<MyTournaments>('/tournaments/my', { wallet: w })
  }

  upcomingMatches(w: AgentWallet): Promise<UpcomingMatches> {
    return this.call<UpcomingMatches>('/tournaments/upcoming-matches', { wallet: w })
  }

  challengesForMe(w: AgentWallet): Promise<ChallengeForMe[]> {
    return this.call<ChallengeForMe[]>('/notifications/challenges-for-me', { wallet: w })
  }

  // ---- actions (called only by the executor, never in dry run) ----

  train(w: AgentWallet, playerNonce: number, attribute: string): Promise<unknown> {
    return this.call('/training/train', { method: 'POST', wallet: w, body: { player_nonce: playerNonce, attribute } })
  }

  setFormation(w: AgentWallet, formation: string): Promise<Team> {
    return this.call<Team>('/teams/formation', { method: 'POST', wallet: w, body: { wallet_address: w.address, formation } })
  }

  setLineup(w: AgentWallet, lineup: number[], substitutes: number[]): Promise<Team> {
    return this.call<Team>('/teams/lineup', { method: 'POST', wallet: w, body: { wallet_address: w.address, lineup, substitutes } })
  }

  playMatch(w: AgentWallet, matchType: 'casual' | 'ranked'): Promise<{ match_id: number }> {
    return this.call('/matches/play', { method: 'POST', wallet: w, body: { wallet_address: w.address, match_type: matchType } })
  }

  joinTournament(w: AgentWallet, id: number, txHash?: string): Promise<{ participant_id: number; condition_warning?: string }> {
    return this.call(`/tournaments/${id}/join`, { method: 'POST', wallet: w, body: txHash ? { tx_hash: txHash } : {} })
  }

  /** Creator only, while open and with no seat taken (leave first): closes a challenge on chain. */
  cancelTournament(w: AgentWallet, id: number): Promise<{ message: string }> {
    return this.call(`/tournaments/${id}/cancel`, { method: 'POST', wallet: w })
  }

  leaveTournament(w: AgentWallet, id: number): Promise<{ message: string; refund_tx_hash?: string }> {
    return this.call(`/tournaments/${id}/leave`, { method: 'POST', wallet: w })
  }

  createTournament(w: AgentWallet, body: Record<string, unknown>, idempotencyKey: string): Promise<Tournament> {
    return this.call<Tournament>('/tournaments/create', { method: 'POST', wallet: w, body, timeoutMs: 60_000, headers: { 'idempotency-key': idempotencyKey } })
  }

  shopConfirm(w: AgentWallet, body: { tx_hash: string; product: string; player_nonce?: number; player_nonces?: number[]; quantity?: number }): Promise<{ purchase_id: number; message: string }> {
    return this.call('/shop/confirm', { method: 'POST', wallet: w, body: { wallet_address: w.address, ...body }, timeoutMs: 60_000 })
  }

  /** The sync of every dirty card, or of one card (`nonce`), as FoxLeague's player profile offers it. */
  syncPrepare(w: AgentWallet, nonce?: number): Promise<{ sc_call_data: string; receiver: string; gas_limit: number; foxsy_cost: string; nonces: number[]; player_count: number; wait_seconds: number }> {
    return this.call(`/sync/prepare?wallet_address=${w.address}${nonce === undefined ? '' : `&nonce=${nonce}`}`, { wallet: w })
  }

  syncConfirm(w: AgentWallet, txHash: string, nonces: number[]): Promise<{ confirmed: boolean; players_synced: number }> {
    return this.call('/sync/confirm', { method: 'POST', wallet: w, body: { wallet_address: w.address, tx_hash: txHash, nonces }, timeoutMs: 60_000 })
  }

  /** Relayed registration: the backend adds the relayer signature and broadcasts (real 4xx/5xx codes). */
  async relay(w: AgentWallet, signedTx: unknown): Promise<string> {
    const r = await this.call<{ tx_hash: string }>('/onboarding/relay', { method: 'POST', wallet: w, body: { signed_tx: signedTx }, timeoutMs: 45_000 })
    return r.tx_hash
  }

  // ---- fusion and the marketplace (docs 13 and 14) ----

  /** How many fusion match credits the card can still take and their price (your own card; the view is shard-bound). */
  matchWaiverQuote(w: AgentWallet, nonce: number): Promise<MatchWaiverQuote> {
    return this.call(`/players/nonce/${nonce}/match-waiver-quote`, { wallet: w })
  }

  canFuse(w: AgentWallet, nonces: number[]): Promise<CanFuse> {
    return this.call(`/fusion/can-fuse?nonces=${nonces.join(',')}`, { wallet: w })
  }

  /** Best effort: the chain indexer records the fusion on its own either way. */
  fusionConfirm(w: AgentWallet, txHash: string, burned: number[]): Promise<{ confirmed: boolean; indexed: boolean; message: string }> {
    return this.call('/fusion/confirm', { method: 'POST', wallet: w, body: { tx_hash: txHash, burned_nonces: burned }, timeoutMs: 45_000 })
  }

  canList(w: AgentWallet, nonce: number): Promise<CanList> {
    return this.call(`/marketplace/can-list?nonce=${nonce}`, { wallet: w })
  }

  listings(q: { sort_by?: 'price_asc' | 'price_desc' | 'overall_desc'; rarity?: string; limit?: number } = {}): Promise<MarketListing[]> {
    const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]): [string, string] => [k, String(v)]))
    return this.call(`/marketplace/listings${qs.size ? `?${qs}` : ''}`)
  }

  floorPrices(): Promise<FloorPrice[]> {
    return this.call('/marketplace/floor-prices')
  }

  /** An AI badge pinned on FoxLeague's IPFS node. Free before registration and for the first 3 after it;
   *  then the answer is a refusal with data.payment_required (the agent never pays for one). */
  generateBadge(w: AgentWallet, teamName: string): Promise<{ badge_ipfs_uri: string; team_name: string; regenerations_used: number; regenerations_max: number }> {
    return this.call('/onboarding/generate-badge', { method: 'POST', wallet: w, body: { team_name: teamName }, timeoutMs: 120_000 })
  }

  saveBadge(w: AgentWallet, badgeIpfsUri: string): Promise<unknown> {
    return this.call('/teams/badge', { method: 'POST', wallet: w, body: { badge_ipfs_uri: badgeIpfsUri } })
  }

  /**
   * Whether a team name can still be taken, by POST /api/register's own rule (3-15 characters, unique ignoring case,
   * spaces and hyphens). A taken or malformed name is an ApiRefusal with FoxLeague's text; it reserves nothing.
   */
  nameAvailable(w: AgentWallet, teamName: string): Promise<{ available: boolean }> {
    return this.call(`/register/name-available?name=${encodeURIComponent(teamName)}`, { wallet: w })
  }

  register(w: AgentWallet, teamName: string): Promise<{ user_id: number; team_name: string; nonces: number[] }> {
    return this.call('/register', { method: 'POST', wallet: w, body: { team_name: teamName, wallet_address: w.address }, timeoutMs: 45_000 })
  }
}

/**
 * The strongest eleven a rival can field, at full condition (synced stats; the roster is public). A rival's
 * own eleven is no longer public, and this is never less than it, so a check against it is at least as
 * strict as one against the real lineup. null when the rival holds fewer than eleven cards.
 */
/**
 * One side's eleven as a match fielded it (a lineup of its public statistics), in the unit of lineup strength: the
 * sum over the 11 starters of their seven stats scaled by condition (stat x (50 + condition / 2) / 100). null
 * unless exactly 11 starters with every stat and their condition are there.
 */
export function elevenStrength(side: unknown): number | null {
  const players = (side as { players?: unknown } | null)?.players
  if (!Array.isArray(players)) return null
  const xi = players.filter(p => (p as { is_starter?: unknown })?.is_starter === true) as Record<string, unknown>[]
  if (xi.length !== 11) return null
  let sum = 0
  for (const p of xi) {
    const stats = STATS.map(k => p[k])
    if (!stats.every(v => typeof v === 'number' && Number.isFinite(v)) || typeof p.condition !== 'number' || !Number.isFinite(p.condition)) return null
    sum += ((stats as number[]).reduce((a, b) => a + b, 0) * (50 + (p.condition as number) / 2)) / 100
  }
  return Math.round(sum)
}

export async function rivalStrength(fox: Pick<FoxLeague, 'players'>, wallet: string): Promise<number | null> {
  const cards = await fox.players(wallet)
  if (cards.length < 11) return null
  const totals = cards.map(c => c.speed_synced + c.accuracy_synced + c.defense_synced + c.power_synced + c.control_synced + c.vision_synced + c.stamina_synced)
  if (totals.some(t => !Number.isFinite(t))) return null
  return totals.sort((a, b) => b - a).slice(0, 11).reduce((sum, t) => sum + t, 0)
}
