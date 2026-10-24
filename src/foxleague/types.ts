// Response shapes of the FoxLeague routes the agent reads (subset of the backend's ts-rs types,
// frontend/src/types/generated; checked against live mainnet answers on 2026-09-28).

export interface FoxConfig {
  registration_fee_foxsy: number
  registration_fee_wei: string
  registration_fee_foxsy_wei?: string
  relayer_v3_enabled: boolean
  relays_remaining_today: number
  relayer_max_gas_limit?: number
  relayer_addresses: string[]
  dex_swap_enabled: boolean
  dex_swap_slippage_bps?: number
  dex_swap_max_foxsy?: number
  shop_prices_foxsy: { condition: number; xp_booster: number; training: number }
  common_pack_price_foxsy: number
  common_pack_per_wallet_per_week?: number
  common_pack_available: boolean
  common_pack_unavailable_reason?: string | null
  common_pack_epoch_remaining?: number
  sync_cost_foxsy: number
  tournament_fee_bounds: { silver_min: number; silver_max: number; gold_min: number }
  tournament_prize_split: { winner_percent: number; runner_up_percent: number; third_percent: number; platform_fee_percent: number }
  one_v_one_prize_split: { winner_percent: number; platform_fee_percent: number }
  tournament_defaults: {
    match_stagger_minutes: number
    deadline_grace_minutes: number
    knockout_min_participants: number
    swiss_min_participants: number
    groups_knockout_group_size: number
    one_v_one_max_active_per_user: number
    one_v_one_prize_delivery_seconds: number
    /** FoxLeague's League + Knockout format (admin-created, by invitation) is on; it ships off. */
    league_knockout_enabled?: boolean
  }
  min_field_condition: number
  condition_regen_points_per_day: number
  condition_loss_per_match: number
  condition_loss_per_match_ranked: number
  fusion_costs_foxsy: number[]
  /** The single gate of before 2026-10-12 (still served, no longer what the contract applies once the rows are live). */
  fusion_min_matches?: number
  fusion_match_waiver_floor?: number
  fusion_match_waiver_price_per_match?: number
  /** One match gate per rarity for fusion inputs, listing and the match waiver (live on mainnet from 2026-10-12 16:30 UTC). */
  rarity_match_gate?: RarityMatchGate
  /** How long a fused card waits before it can be a fusion input again (1,209,600 s, 14 days, on mainnet). */
  fusion_card_cooldown_seconds?: number
  /** FOXSY per day of that wait bought off (75 on mainnet, down to a 3-day floor). */
  fusion_cooldown_waiver_price_per_day?: number
  auction_enabled: boolean
  marketplace_min_list_price_foxsy?: number
  transfer_cooldown_hours?: number
  league_thresholds?: Record<string, number>
  foxsy_token_id: string
  [key: string]: unknown
}

export interface UserProfile {
  id: number
  wallet_address: string
  username: string | null
  elo_rating: number
  league: string
  matches_won: number
  matches_lost: number
  matches_drawn: number
  team_name: string | null
  badge: string | null
  verified: boolean
  tournament_wins: number
  active_title: string | null
  player_count: number
}

export interface Team {
  id: number
  user_id: number
  name: string
  coach_name: string | null
  formation: string
  lineup: number[]
  substitutes: number[]
  team_overall: number
  badge: string | null
  badge_ipfs_uri?: string | null
  /**
   * True when FoxLeague answered its public view: the formation, the eleven, the bench and the overall go to
   * the team's own session only (since 2026-09-30), so for anyone else they are empty here.
   */
  hidden?: boolean
}

export const STATS = ['speed', 'accuracy', 'defense', 'power', 'control', 'vision', 'stamina'] as const
export type Stat = (typeof STATS)[number]

export type Rarity = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary'
export type Position = 'GK' | 'DEF' | 'MID' | 'FWD'

export const RARITY_CAP: Record<Rarity, number> = { Common: 30, Uncommon: 55, Rare: 75, Epic: 90, Legendary: 100 }

export interface PlayerCard {
  id: number
  nft_nonce: number
  owner_address: string
  name: string
  position: Position
  rarity: Rarity
  shirt_number: number
  level: number
  experience: number
  speed: number
  accuracy: number
  defense: number
  power: number
  control: number
  vision: number
  stamina: number
  speed_synced: number
  accuracy_synced: number
  defense_synced: number
  power_synced: number
  control_synced: number
  vision_synced: number
  stamina_synced: number
  speed_xp: number
  accuracy_xp: number
  defense_xp: number
  power_xp: number
  control_xp: number
  vision_xp: number
  stamina_xp: number
  condition: number
  condition_updated_at: string
  stats_dirty: boolean
  matches_played: number
  competitive_matches: number
  fusion_match_credit: number
  fusion_ready_at: string | null
  goals: number
  assists: number
  listed_for_sale: boolean
  sale_price: number | null
  transferred_at: string | null
  transfer_cooldown_hours: number | null
  minted_at: string | null
  created_at: string
}

export interface Tournament {
  id: number
  creator_user_id: number
  title: string
  description: string | null
  /** The four formats the agent creates and joins; league_knockout (since 2026-10-15) it joins by invitation only, others never. */
  format: 'knockout' | 'groups_knockout' | 'round_robin' | 'swiss' | (string & {})
  tier: 'bronze' | 'silver' | 'gold'
  featured: boolean
  max_teams: number
  min_teams: number
  entry_fee_foxsy: number
  status: string
  deadline: string
  starts_at: string
  round_interval_minutes: number | null
  has_third_place_match: boolean
  sc_tournament_id: number | null
  winner_user_id: number | null
  runner_up_user_id: number | null
  third_place_user_id: number | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  cancelled_at: string | null
  participant_count?: number
  /** Named only to the 1v1's creator and its target (their own session); null for everyone else, see `targeted`. */
  target_user_id: number | null
  /** A targeted 1v1, whoever asks (FoxLeague hides the target itself from other teams). */
  targeted?: boolean
  /** The 1v1 targets the caller's own team (only with its session). */
  targeted_to_you?: boolean
  challenge_deadline_minutes: number | null
  is_private: boolean
  /** Set by the agent: a private tournament its own team is invited to (FoxLeague tells this to the team's session only). */
  invited?: boolean
  home_and_away: boolean
  developer_mode: boolean
}

export interface TournamentDetail {
  tournament: Tournament
  participants: { user_id: number; team_name?: string; wallet_address?: string }[]
  user_is_participant?: boolean
  /** Only filled for the caller's own session: true when that team is invited to this private tournament. */
  user_can_join_private?: boolean | null
  /**
   * A 1v1 read with the caller's wallet: true when FoxLeague's join gate would refuse it because the team is busy with
   * a tournament (the same rows, matches.rs tournament_busy_exists_sql). FoxLeague answers false on its own failed read.
   */
  viewer_blocked_tournament_window?: boolean | null
  [key: string]: unknown
}

export interface LeaderboardPage {
  users: UserProfile[]
  total: number
  limit: number
  offset: number
}

export interface RarityMatchGate {
  rows_live: boolean
  rules_live: boolean
  live_from: string | null
  transfer_lock_hours_per_missing_match: number
  rarities: {
    rarity: string
    level: number
    /** Competitive matches (played plus waived credit) a card needs to be fused or listed. */
    gate: number
    /** Of those, the matches that must really be played. */
    floor: number
    price_per_match: number
    price_per_match_wei: string
    waiver_enabled: boolean
    row_set: boolean
  }[]
}

/** GET /api/players/nonce/{nonce}/match-waiver-quote (your own card). */
export interface MatchWaiverQuote {
  max_purchasable: number
  chain_played: number
  credit: number
  price_wei: string
  /** Since 2026-10-12: the gate the contract holds this card to. */
  rarity?: string
  gate?: number
  floor?: number
  price_per_match?: number
  meets_gate?: boolean
}

export interface ShopStatus {
  prices?: Record<string, number>
  training?: { daily_free: number; premium_cap: number; used_today: number; premium_used_today: number; slots_banked: number }
  /**
   * The XP booster, flat as FoxLeague serialises it (backend/src/routes/shop.rs ShopStatus, :810-816): active when a
   * booster was verified within the last 24 h, and then its expiry (verified_at + 24 h, RFC 3339). Optional only
   * because a missing field is unknown: the rules refuse a purchase unless `xp_booster_active` is a boolean.
   */
  xp_booster_active?: boolean
  xp_booster_expires_at?: string | null
  common_pack_available?: boolean
  common_pack_remaining_this_week?: number
  common_pack_epoch_remaining?: number
  [key: string]: unknown
}

export interface DailyAllowance {
  today_count: number
  daily_limit: number
  reset_hour_utc: number
}

export interface ActiveMatch {
  /** A ranked or casual match's id; null for a tournament or 1v1 match (FoxLeague 2026-10-07: see tournament_match_id). */
  match_id: number | null
  /** A tournament or 1v1 match's public id (random, not a sequence); null for a ranked or casual match. */
  tournament_match_id?: string | null
  kind: 'ranked' | 'challenge' | 'tournament'
  status: string
  tournament_id: number | null
  created_at: string
}

export interface MyTournaments {
  active: Tournament[]
  completed: Tournament[]
}

export interface UpcomingMatch {
  tournament_id: number
  tournament_title: string
  round_label: string | null
  /**
   * The group of a group-stage fixture ("A", "B", ...); null for a knockout one, "3rd Place" for the third place match.
   * Optional only because a missing field is unknown: the 1v1 busy rule then cannot tell a group fixture and refuses.
   */
  group_name?: string | null
  is_home: boolean
  opponent_name: string | null
  scheduled_at: string
  strategy_locks_at: string
  locked: boolean
  phase: 'upcoming' | 'locked' | 'live' | 'finished'
  /** The match's public id (random, not a sequence; replaced match_id on 2026-10-07). */
  tournament_match_id?: string | null
  home_score: number | null
  away_score: number | null
}

export interface UpcomingMatches {
  lead_minutes: number
  my_team_name: string | null
  matches: UpcomingMatch[]
}

/**
 * A row of GET /api/matches/history (public for any wallet, newest first, at most 50): revealed matches only, with
 * scores and ELO null until the reveal (backend/src/models.rs MatchHistoryView). A tournament or 1v1 match has its
 * public `tournament_match_id` and no `id`; a ranked or casual match has its `id`.
 */
export interface MatchHistoryRow {
  id: number | null
  tournament_match_id: string | null
  home_user_id: number | null
  away_user_id: number | null
  home_team_name: string
  away_team_name: string
  home_score: number | null
  away_score: number | null
  match_type: string
  status: string
  finished_at: string | null
  home_elo_at_match: number | null
  away_elo_at_match: number | null
  tournament_id: number | null
}

/**
 * What a match's public statistics tell after its reveal: both formations as played, and each eleven's strength as
 * the engine fielded it (the sum over the starters of their seven stats scaled by condition, the unit of "lineup
 * strength"); null when that side's eleven is not in the statistics.
 */
export interface MatchFormations {
  home: string
  away: string
  homeStrength: number | null
  awayStrength: number | null
  /**
   * When the statistics were read (kept with the facts since 2026-10-23). A ranked or casual match's statistics
   * rebuild both elevens at read time from the cards' current synced stats and condition (FoxLeague keeps no kickoff
   * copy for them, matches.rs launch_squad), so its strengths are the match's only when read soon after it.
   */
  readAt?: string
}

export interface ChallengeForMe {
  tournament_id: number
  title: string
  creator_user_id: number
  creator_team_name: string
  entry_fee_foxsy: number
  deadline: string
}

/** GET /api/fusion/can-fuse?nonces=a,b,c (auth, advisory; docs 13.2). */
export interface CanFuse {
  can_fuse: boolean
  reason?: string
  cooldown_remaining?: number
  cooldown_end?: string
  dirty_players?: number[]
  blocked_players?: number[]
  min_matches_required?: number
  match_floor_required?: number
}

/** GET /api/marketplace/can-list?nonce= (auth, advisory; docs 14.1). */
export interface CanList {
  can_list: boolean
  reason?: string
  can_relist_at?: string | null
  cooldown_remaining_seconds?: number
}

/** A row of GET /api/marketplace/listings (marketplace.rs:99-160); prices in whole FOXSY. */
export interface MarketListing {
  nft_nonce: number
  owner_address: string
  name: string
  position: Position
  rarity: Rarity
  level: number
  speed: number
  accuracy: number
  defense: number
  power: number
  control: number
  vision: number
  stamina: number
  condition: number
  is_auction: boolean
  min_price: number | null
  highest_bid: number | null
  ends_at: string | null
  transferred_at: string | null
  transfer_cooldown_hours: number | null
}

export interface FloorPrice {
  rarity: Rarity
  floor_price: number
  count: number
}

/** One pending League + Knockout invitation of the signed-in team (GET /api/tournaments/invitations, league_invitations.rs). */
export interface PendingLeagueInvitation {
  tournament_id: number
  title: string
  tier: string
  entry_fee_foxsy: number
  wave: number
  expires_at: string
  seats_lock_at: string
  can_accept: boolean
  refusal: string | null
  prize_atomic: string | null
}

/** GET /api/tournaments/{id}/invitations (league_invitations.rs LeagueInvitationsView): the parts the agent reads. */
export interface LeagueInvitationsView {
  invitations: { user_id: number; team_name?: string; state: string }[]
}
