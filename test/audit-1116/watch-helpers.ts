// Shared by the tests of the stronger watch (audit 2026-11-16, MAINNET proposals P-W2 to P-W8): FoxLeague's MCP server
// serving a few manual pages, the agents' copy and its page record, and FoxLeague's game settings as mainnet served
// them on 16 Nov 2026 (trimmed to the blocks that matter here).
import { createHash } from 'node:crypto'
import { ManualWatch, type McpFetch } from '../../src/strategist/manual-watch.ts'

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const fingerprint = (body: string) => sha256(body.replace(/\s+/g, ' ').trim())
export const MANUAL = '# FoxLeague player manual\nsynced from the FoxLeague repository, main at 9ebcbc52d 2026-11-13.\n'
export const PAGES: Record<string, string> = { 'mechanics/matches': 'Ranked moves ELO.', 'mechanics/shop': 'A Common pack costs 2,500 FOXSY, at most 2 per wallet per rolling 7 days.' }
/** The page record sync-manual writes; with `config`, the key set of the settings it was built against (P-W8). */
export const record = (config?: string[]) => ({ synced: '9ebcbc52d 2026-11-13', manual: sha256(MANUAL), pages: Object.fromEntries(Object.entries(PAGES).map(([slug, body]) => [slug, fingerprint(body)])), ...(config ? { config } : {}) })

/** FoxLeague's MCP server serving `pages`; `down` makes every request fail. Counts the requests it got. */
export function mcp(pages: Record<string, string> = PAGES) {
  const state = { pages: { ...pages }, down: false, asked: 0 }
  const fetch: McpFetch = async (_url, init) => {
    state.asked++
    if (state.down) throw new TypeError('fetch failed')
    const { params } = JSON.parse(init.body) as { params: { name: string; arguments: { slug?: string } } }
    const answer = params.name === 'list_manual_pages'
      ? Object.keys(state.pages).map(slug => ({ slug, title: slug }))
      : { slug: params.arguments.slug, text: `# Title\n\n${state.pages[params.arguments.slug!]}\n\nSource: https://docs.foxleague.ai/${params.arguments.slug}/` }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(answer) }] } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return { state, fetch }
}

export function memoryKv() {
  const m = new Map<string, string>()
  return { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => void m.set(k, v), m }
}

/** A watch over that server and copy; `told` keeps what it tells the owner. */
export function watch(server: ReturnType<typeof mcp>, o: { kv?: ReturnType<typeof memoryKv>; record?: unknown } = {}) {
  const told: string[] = []
  const kv = o.kv ?? memoryKv()
  const w = new ManualWatch({ enabled: true, base: 'http://foxleague.test', zone: 'UTC', kv, tell: (t: string) => void told.push(t) } as ConstructorParameters<typeof ManualWatch>[0])
  w.fetch = server.fetch
  w.readManual = () => MANUAL
  w.readRecord = () => o.record ?? record()
  w.gapMs = 0
  return Object.assign(w, { told, kv })
}

export const AT_0700 = Date.parse('2026-11-16T07:00:00Z')
export const MIN = 60_000
export const HOUR = 3600_000

/** GET /api/config of mainnet at 11:50 UTC on 16 Nov 2026, trimmed. */
export function liveConfig(): Record<string, unknown> {
  return {
    registration_fee_foxsy: 5000.0,
    registration_fee_wei: '5000000000000000000000',
    fusion_costs_foxsy: [100, 200, 400, 800],
    common_pack_price_foxsy: 2500,
    common_pack_per_wallet_per_week: 2,
    common_pack_epoch_remaining: 495,
    common_pack_available: true,
    common_pack_unavailable_reason: null,
    relayer_v3_enabled: true,
    relayer_addresses: ['erd1jnc2mkcn0l3gnn5p3ft93re5sh3u8lgqpql3mssezls0e26mxrjqdyy6z7'],
    relays_remaining_today: 5000,
    shop_prices_foxsy: { condition: 100, xp_booster: 2000, training: 20 },
    rarity_next: { Common: 'Uncommon', Uncommon: 'Rare' },
    rarity_match_gate: {
      rows_live: true, rules_live: true, live_from: '2026-10-12T16:30:18Z', transfer_lock_hours_per_missing_match: 6,
      rarities: [{ rarity: 'Common', level: 0, gate: 5, floor: 5, price_per_match: 0, price_per_match_wei: '0', waiver_enabled: false, row_set: true }],
    },
    tournament_defaults: { match_stagger_minutes: 15, deadline_grace_minutes: 30, one_v_one_max_active_per_user: 1 },
    player_interest: { enabled: true, per_day: 5, repeat_days: 7, reset_hour_utc: 14 },
    competition_levels: { live: true, live_from: '2026-11-09T14:00:00Z', ranked_ticket_price_foxsy: 25, xp_factor_pct: { ranked: 25, bronze: 50, silver: 75, gold: 100 }, elo_k: { ranked: 5, bronze: 9, silver: 13, gold: 17 }, private_bronze_earns: true, competitive_daily_cap: 3 },
    card_bans: { live: true, live_from: '2026-11-13T14:00:00Z', yellow_cards_per_ban: 3, injury_chance_bp_full_condition: 100, injury_chance_bp_condition_floor: 300, injury_days_out: [3, 9, 27] },
    metastaking_discount: { live: false, live_from: null, foxsy_per_step: 10000, bp_per_step: 10, max_bp: 1000, quote_valid_seconds: 900 },
    elo_pair_cap: { live: false, live_from: '2026-11-20T14:00:00Z', per_day: 3, reset_hour_utc: 14 },
    fusion_mint: { live: false, live_from: '2026-11-20T14:00:00Z', paused: false },
    organizer_fees: { live: true, live_from: '2026-11-09T14:00:00Z', private_match_fee_foxsy: 0, calendar_deposit_per_match_foxsy: 25, calendar_deposit_min_foxsy: 0, calendar_deposit_grace_minutes: 60 },
    foxsy_token_id: 'FOXSY-5d5f3e',
  }
}

/** The same settings as the agents' copy of 13 Nov knew them: before FoxLeague added the ELO pair cap and the MetaStaking discount. */
export function configOf13Nov(): Record<string, unknown> {
  const c = liveConfig()
  delete c.elo_pair_cap
  delete c.metastaking_discount
  const interest = c.player_interest as Record<string, unknown>
  delete interest.reset_hour_utc
  return c
}
