// Shared test fixture: a registered agent with an 18-card squad and mocked chain and FoxLeague clients.

import assert from 'node:assert/strict'
import { Address } from '@multiversx/sdk-core'
import { Store } from '../src/store/db.ts'
import { Executor } from '../src/executor/executor.ts'
import type { AgentSnapshot, PlayerView } from '../src/snapshot/snapshot.ts'
import type { Chain } from '../src/chain/gateway.ts'
import type { FoxLeague } from '../src/foxleague/api.ts'
import type { Config } from '../src/config.ts'
import type { AgentWallet } from '../src/wallet/wallet.ts'
import { wholeToAtomic } from '../src/util/encoding.ts'
import { DEFAULT_SETTINGS, type AgentSettings } from '../src/store/settings.ts'

/**
 * The limits the tests were written against (the defaults before the per-level ones of 2026-10-05): generous
 * enough that a test checks a rule, not a default. A test that wants another value sets it.
 */
export const TEST_SETTINGS: AgentSettings = {
  ...DEFAULT_SETTINGS,
  dailyCapUsd: 10, monthlyBudgetUsd: 300, maxEntryFeeFoxsy: 5000, maxShopPaymentFoxsy: 2500, maxSwapFoxsy: 10_000, maxBidFoxsy: 2500,
  entryFeesSilver: [1000, 1500, 2000, 2500, 3000], entryFeesGold: [5000], tickMinutes: 30, tickJitterMinutes: 10, activeHoursUtc: [5, 21], minGapSeconds: 90,
  // FoxLeague's own maximum: the counts of a level (2026-11-06) stay out of the way of tests about other rules.
  paidTrainingPerDay: 10, boostersPerWeek: 7, packsPerWeek: 2, medicineDaysPerWeek: 18,
}

export const ADDR = 'erd1fdp7wx5sspwft8jqhp44wlgjyqgjyj229yzfukdpas3g7gkhh32qcr4rpl'
export const OTHER = 'erd1qyu5wthldzr8wx5c9ucg8kjagg0jfs53s8nr3zpz3hypefsdd8ssycr6th'
export const STRANGER = 'erd1spm863ywflqdpu3kxjrndgze28gecqtfgx9nvtf5n33j0jr9fjeqdfayw4'

export const dryWallet: AgentWallet = {
  index: 0,
  address: ADDR,
  pubkeyHex: '00',
  shard: 0,
  signTransaction: () => assert.fail('must not sign in dry run'),
  signMessage: () => assert.fail('must not sign'),
}
export const liveWallet: AgentWallet = { ...dryWallet, signTransaction: () => undefined }

/** FoxLeague's match gate per rarity as mainnet's /api/config serves it since 2026-10-12. */
const row = (rarity: string, level: number, gate: number, floor: number, price: number) =>
  ({ rarity, level, gate, floor, price_per_match: price, price_per_match_wei: wholeToAtomic(price).toString(), waiver_enabled: price > 0, row_set: true })
export const MAINNET_GATE = {
  rows_live: true, rules_live: true, live_from: '2026-10-12T16:30:18Z', transfer_lock_hours_per_missing_match: 6,
  rarities: [row('Common', 0, 5, 5, 0), row('Uncommon', 1, 15, 5, 20), row('Rare', 2, 45, 15, 100), row('Epic', 3, 135, 45, 100), row('Legendary', 4, 405, 135, 100)],
}

export function card(nonce: number, position: PlayerView['position'], role: PlayerView['role'], more: Partial<PlayerView> = {}): PlayerView {
  const stats = { speed: 20, accuracy: 20, defense: 20, power: 20, control: 20, vision: 20, stamina: 20 }
  return {
    nonce, name: `P${nonce}`, position, rarity: 'Common', cap: 30, role, condition: 100, ageYears: 18,
    synced: { ...stats }, live: { ...stats }, xp: {}, dirty: false, competitiveMatches: 20, fusionMatchCredit: 0,
    fusionReadyAt: null, listed: false, transferLockedUntil: null, injuredUntil: null, suspended: false, banYellows: 0, syncedTotal: 140, ...more,
  }
}

export function snapshot(extra: PlayerView[] = []): AgentSnapshot {
  const positions: PlayerView['position'][] = ['GK', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'FWD', 'FWD', 'GK', 'DEF', 'DEF', 'MID', 'MID', 'FWD', 'FWD']
  const players = positions.map((p, i) => card(i + 1, p, i < 11 ? 'starter' : 'bench', i < 11 ? { slot: i } : {}))
  return {
    takenAt: new Date().toISOString(),
    watchOnly: false,
    agent: { index: 0, address: ADDR, shard: 0 },
    gameDay: { resetHourUtc: 14, nextResetAt: '', hoursToReset: 5 },
    chain: { egld: wholeToAtomic(10), nonce: 1, foxsy: wholeToAtomic(10_000), wegld: 0n, nftCount: 18 + extra.length },
    prices: { egldUsd: 4.5, egldPerFoxsy: 0.0005, foxsyUsd: 0.00225 },
    config: {
      registration_fee_foxsy: 5000, registration_fee_wei: wholeToAtomic(5000).toString(), relayer_v3_enabled: true, relays_remaining_today: 5000, relayer_addresses: [],
      dex_swap_enabled: true, shop_prices_foxsy: { condition: 100, xp_booster: 2000, training: 20 }, common_pack_price_foxsy: 2500, common_pack_available: true, sync_cost_foxsy: 10,
      tournament_fee_bounds: { silver_min: 1000, silver_max: 5000, gold_min: 5000 }, tournament_prize_split: { winner_percent: 45, runner_up_percent: 30, third_percent: 15, platform_fee_percent: 10 },
      one_v_one_prize_split: { winner_percent: 90, platform_fee_percent: 10 },
      tournament_defaults: { match_stagger_minutes: 15, deadline_grace_minutes: 30, knockout_min_participants: 2, swiss_min_participants: 3, groups_knockout_group_size: 4, one_v_one_max_active_per_user: 1, one_v_one_prize_delivery_seconds: 180 },
      min_field_condition: 30, condition_regen_points_per_day: 48, condition_loss_per_match: 10, condition_loss_per_match_ranked: 5, fusion_costs_foxsy: [100, 200, 400, 800], auction_enabled: true,
      marketplace_min_list_price_foxsy: 500, foxsy_token_id: 'FOXSY-5d5f3e', rarity_match_gate: MAINNET_GATE,
      // FoxLeague's fusion switch as it serves it (2026-11-13): no switch set here, so the old fusion runs.
      fusion_mint: { live: false, live_from: null, paused: false },
    } as AgentSnapshot['config'],
    registration: { registered: true, teamName: 'Agent', feePaidOnChain: true, whitelisted: true, relayerEnabled: true, relaysRemaining: 5000 },
    profile: { id: 100, wallet_address: ADDR, username: null, elo_rating: 1200, league: 'Bronze', matches_won: 0, matches_lost: 0, matches_drawn: 0, team_name: 'Agent', badge: null, verified: false, tournament_wins: 0, active_title: null, player_count: 18 },
    team: { id: 1, user_id: 100, name: 'Agent', coach_name: null, formation: '4-4-2', lineup: players.slice(0, 11).map(p => p.nonce), substitutes: players.slice(11).map(p => p.nonce), team_overall: 20, badge: null },
    players: [...players, ...extra],
    auth: {
      // The packs left this week as FoxLeague's shop status always serves them (2 a wallet in 7 days).
      shop: { xp_booster_active: false, xp_booster_expires_at: null, common_pack_remaining_this_week: 2, training: { daily_free: 5, premium_cap: 10, used_today: 0, premium_used_today: 0, slots_banked: 0 } },
      allowance: { today_count: 0, daily_limit: 5, reset_hour_utc: 14 },
      activeMatch: null,
      myTournaments: { active: [], completed: [] },
      upcoming: { lead_minutes: 30, my_team_name: 'Agent', matches: [] },
      challengesForMe: [],
    } as unknown as AgentSnapshot['auth'],
    market: { openStandard: [], openChallenges: [], recentStandard: [], slots: [], auctions: [], floors: [] },
    leaderboardNeighbours: [],
    warnings: [],
  }
}

/** A tournament detail in the shape GET /api/tournaments/{id} answers. */
export function tournament(id: number, more: Record<string, unknown> = {}, participants: { user_id: number; wallet_address?: string }[] = []): unknown {
  return {
    tournament: {
      id, title: `T${id}`, status: 'open', tier: 'silver', format: 'knockout', max_teams: 8, min_teams: 8, entry_fee_foxsy: 1000,
      deadline: new Date(Date.now() + 6 * 3600_000).toISOString(), starts_at: new Date(Date.now() + 7 * 3600_000).toISOString(),
      sc_tournament_id: id, creator_user_id: 900, target_user_id: null, is_private: false, developer_mode: false, participant_count: participants.length, ...more,
    },
    participants,
  }
}

export interface Mocks {
  chain: Record<string, unknown>
  fox: Record<string, unknown>
}

/** Store with agent 0, an executor over mocks; override any mock method per test. */
export function setup(over: Partial<Mocks> = {}) {
  const store = new Store('', ':memory:')
  store.addAgent(0, ADDR)
  store.updateSettings(0, TEST_SETTINGS)
  const chain = {
    simulate: async () => ({ ok: true, detail: 'success', raw: {} }),
    query: async () => [],
    account: async () => ({ nonce: 1, balance: wholeToAtomic(10) }),
    send: async () => 'hash1',
    waitForOutcome: async () => ({ kind: 'success' }),
    ...over.chain,
  }
  const fox = {
    user: async () => null,
    tournament: async () => { throw new Error('no tournament in this test') },
    // 10 percent weaker than ours (18 against 20): a rival every level may play since 2026-11-06 (55 percent and up).
    ...rivalSquad(18),
    ...over.fox,
  }
  const exec = new Executor({ cfg: {} as Config, chain: chain as unknown as Chain, fox: fox as unknown as FoxLeague, store })
  return { store, exec, agent: () => store.agent(0)! }
}

/**
 * A Silver tournament of ours under way with a match in 2 hours: the XP booster has a fixture of its own to double
 * (every level since 2026-11-06, Zeus's rule before).
 */
export function withFixture<S extends ReturnType<typeof snapshot>>(s: S): S {
  const at = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()
  s.auth!.myTournaments!.active = [...s.auth!.myTournaments!.active, { ...(tournament(60, { status: 'active' }) as { tournament: object }).tournament }] as never
  s.auth!.upcoming!.matches = [...s.auth!.upcoming!.matches, { tournament_id: 60, tournament_title: 'T60', round_label: 'Round 1', group_name: null, is_home: true, opponent_name: 'Rival', scheduled_at: at(2), strategy_locks_at: at(1.5), locked: false, phase: 'upcoming', home_score: null, away_score: null }] as never
  return s
}

/** A rival's public team and roster: eleven starters with every synced stat at `stat` (ours are 20 at full condition). */
export function rivalSquad(stat: number) {
  const lineup = Array.from({ length: 11 }, (_, i) => 9001 + i)
  const synced = Object.fromEntries(['speed', 'accuracy', 'defense', 'power', 'control', 'vision', 'stamina'].map(k => [`${k}_synced`, stat]))
  return {
    team: async () => ({ id: 2, user_id: 900, name: 'Rival', lineup, substitutes: [], formation: '4-4-2', team_overall: stat, badge: null }),
    players: async () => lineup.map(n => ({ nft_nonce: n, ...synced })),
  }
}

/** The nested Auction struct the view getAuction returns, base64. */
export function encodeAuction(a: { seller: string; min: bigint; top: bigint; bidder: string | null; endsInS: number }): string {
  const addr = (x: string | null) => (x ? Buffer.from(Address.newFromBech32(x).toHex(), 'hex') : Buffer.alloc(32))
  const big = (v: bigint) => {
    const hex = v.toString(16)
    const b = v ? Buffer.from(hex.length % 2 ? `0${hex}` : hex, 'hex') : Buffer.alloc(0)
    const len = Buffer.alloc(4)
    len.writeUInt32BE(b.length)
    return Buffer.concat([len, b])
  }
  const end = Buffer.alloc(8)
  end.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000) + a.endsInS))
  return Buffer.concat([addr(a.seller), big(a.min), big(a.top), addr(a.bidder), end]).toString('base64')
}

export async function withLive<T>(store: Store, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.AGENT_LIVE_ENABLED
  process.env.AGENT_LIVE_ENABLED = '1'
  store.setLiveMode(true)
  try {
    return await fn()
  } finally {
    store.setLiveMode(false)
    if (prev === undefined) delete process.env.AGENT_LIVE_ENABLED
    else process.env.AGENT_LIVE_ENABLED = prev
  }
}
