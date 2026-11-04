// Local state: agents and their settings, the activity log, the spend ledger, pending transactions
// and instance flags (kill switch). node:sqlite, one file in the data directory.

import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { agentName } from '../names.ts'
import { DEFAULT_SETTINGS, type AgentSettings } from './settings.ts'
import type { MatchFormations } from '../foxleague/types.ts'
import { CASUAL_DAYS, LEAGUE_DAYS, leagueTable, summariseFormations, type FormationMatch, type FormationRecord, type LeagueCache, type LeagueMatch, type LeagueTable } from '../snapshot/formations.ts'
import type { MarketSale } from '../snapshot/market.ts'

export interface AgentRow {
  index: number
  address: string
  /** 'derived': a wallet from the install's recovery words (account = index); 'imported': a team the owner brought, with its own key. */
  source: 'derived' | 'imported'
  /** The platform mode, one switch for all agents (kv live_mode); the CLI forces it on for its simulations. */
  dryRun: boolean
  paused: boolean
  settings: AgentSettings
  createdAt: string
  /** Set while the agent is parked with Retire (out of the tabs, always paused); null for an active agent. */
  retired: RetiredInfo | null
}

/** When and by whom an agent was retired, and what its wallet held then (shown in Retired, to restore it). */
/** An agent deleted for good because its wallet was never used (newest last, at most 200 kept). */
export interface DeletedAgent {
  index: number
  address: string
  at: string
  by: string
}

/** Set once formation_results was emptied for the read-time rule of ranked strengths (B-P1, audit 2026-10-23). */
const FORMATION_RESULTS_REBUILT = 'formation_results_rebuilt_2026_10_23'

/** The stored values that belong to one agent, keyed by its number (deleteAgent clears them). */
const PER_AGENT_KV = ['agent_user_id:', 'summary_elo:', 'waiting_funds:', 'last_plan_', 'bid_gone:']

export interface RetiredInfo {
  at: string
  by: string
  team: string | null
  egld: string | null
  foxsy: string | null
  usd: number | null
}

export type ActivityStatus = 'dry_run' | 'sent' | 'confirmed' | 'failed' | 'refused' | 'unconfirmed' | 'info' | 'error'

export interface ActivityRow {
  id: number
  agentIndex: number | null
  at: string
  kind: string
  status: ActivityStatus
  summary: string
  detail: string | null
  costUsd: number | null
  txHash: string | null
}

/** play and setup count toward the caps; swap tracks EGLD swapped per game day (its own allowance). */
export type SpendCategory = 'play' | 'setup' | 'swap'

export interface SpendEntry {
  agentIndex: number
  at: Date
  gameDay: string
  category: SpendCategory
  action: string
  foxsyAtomic: bigint
  egldAtomic: bigint
  usd: number
  txHash: string | null
  dryRun: boolean
}

function rowToActivity(r: Record<string, unknown>): ActivityRow {
  return {
    id: Number(r.id),
    agentIndex: r.agent_idx === null ? null : Number(r.agent_idx),
    at: String(r.at),
    kind: String(r.kind),
    status: r.status as ActivityStatus,
    summary: String(r.summary),
    detail: (r.detail as string | null) ?? null,
    costUsd: r.cost_usd === null ? null : Number(r.cost_usd),
    txHash: (r.tx_hash as string | null) ?? null,
  }
}

export class Store {
  readonly db: DatabaseSync

  constructor(dataDir: string, file = 'agent.db') {
    if (file !== ':memory:') {
      mkdirSync(dataDir, { recursive: true, mode: 0o700 })
      // Never start empty next to another database: that data belongs to a version this one does not read,
      // and a fresh file beside it would hide the agents, their caps and the spend ledger.
      const other = existsSync(join(dataDir, file)) ? undefined : readdirSync(dataDir).find(f => f.endsWith('.db'))
      if (other) throw new Error(`${dataDir} holds ${other} but no ${file}: that data is from another version, nothing was created`)
    }
    // A writer waits up to 5 s for another one (the CLI next to the service) instead of failing at once.
    this.db = new DatabaseSync(file === ':memory:' ? file : join(dataDir, file), { timeout: 5000 })
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS agents (
        idx INTEGER PRIMARY KEY,
        address TEXT NOT NULL UNIQUE,
        dry_run INTEGER NOT NULL DEFAULT 1, -- unused: the mode is platform-wide (kv live_mode)
        paused INTEGER NOT NULL DEFAULT 0,
        settings TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_idx INTEGER,
        at TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        detail TEXT,
        cost_usd REAL,
        tx_hash TEXT
      );
      CREATE INDEX IF NOT EXISTS activity_agent_at ON activity (agent_idx, at);
      CREATE TABLE IF NOT EXISTS spend (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_idx INTEGER NOT NULL,
        at TEXT NOT NULL,
        game_day TEXT NOT NULL,
        month TEXT NOT NULL,
        category TEXT NOT NULL,
        action TEXT NOT NULL,
        foxsy_atomic TEXT NOT NULL,
        egld_atomic TEXT NOT NULL,
        usd REAL NOT NULL,
        tx_hash TEXT,
        dry_run INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS spend_agent_day ON spend (agent_idx, dry_run, game_day);
      CREATE TABLE IF NOT EXISTS pending_tx (
        hash TEXT PRIMARY KEY,
        agent_idx INTEGER NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending'
      );
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS match_facts (key TEXT PRIMARY KEY, facts TEXT NOT NULL, read_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS market_sales (id INTEGER PRIMARY KEY, rarity TEXT NOT NULL, price REAL NOT NULL, sold_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS formation_results (
        agent_idx INTEGER NOT NULL,
        match_key TEXT NOT NULL,
        at TEXT NOT NULL,
        own_user_id INTEGER NOT NULL,
        rival_user_id INTEGER,
        mine TEXT NOT NULL,
        theirs TEXT NOT NULL,
        gf INTEGER NOT NULL,
        ga INTEGER NOT NULL,
        edge REAL,
        PRIMARY KEY (agent_idx, match_key)
      );
      CREATE TABLE IF NOT EXISTS casual_results (
        agent_idx INTEGER NOT NULL,
        match_key TEXT NOT NULL,
        at TEXT NOT NULL,
        mine TEXT NOT NULL,
        ai TEXT NOT NULL,
        gf INTEGER NOT NULL,
        ga INTEGER NOT NULL,
        edge REAL,
        PRIMARY KEY (agent_idx, match_key)
      );
      CREATE TABLE IF NOT EXISTS league_matches (
        key TEXT PRIMARY KEY,
        at TEXT NOT NULL,
        kind TEXT NOT NULL,
        home_user_id INTEGER NOT NULL,
        away_user_id INTEGER NOT NULL,
        home TEXT NOT NULL,
        away TEXT NOT NULL,
        home_score INTEGER NOT NULL,
        away_score INTEGER NOT NULL,
        home_strength REAL,
        away_strength REAL,
        home_elo INTEGER,
        away_elo INTEGER
      );
    `)
    // Added with Import team: where the key comes from and when a team was removed (the row stays for the history).
    const cols = new Set((this.db.prepare('PRAGMA table_info(agents)').all() as { name: string }[]).map(c => c.name))
    if (!cols.has('source')) this.db.exec("ALTER TABLE agents ADD COLUMN source TEXT NOT NULL DEFAULT 'derived'")
    if (!cols.has('removed_at')) this.db.exec('ALTER TABLE agents ADD COLUMN removed_at TEXT')
    // Added with Retire: a RetiredInfo JSON while the agent is parked, NULL while it is active.
    if (!cols.has('retired')) this.db.exec('ALTER TABLE agents ADD COLUMN retired TEXT')
    // Once (B-P1, audit 2026-10-23): the rows kept before a ranked match's strength edge needed a read within 6 hours
    // of its end go, and each agent's next plan stores its last 50 matches again under the rule.
    if (this.getKv(FORMATION_RESULTS_REBUILT) !== '1') {
      this.db.exec('DELETE FROM formation_results')
      this.setKv(FORMATION_RESULTS_REBUILT, '1')
    }
  }

  // ---- agents ----

  /** An agent from the install's recovery words (account = index). */
  addAgent(index: number, address: string): AgentRow {
    if (this.importedAt(index)) throw new Error(`${agentName(index)} is an imported team: its number is taken`)
    this.db
      .prepare('INSERT OR IGNORE INTO agents (idx, address, paused, settings, created_at) VALUES (?, ?, 0, ?, ?)')
      .run(index, address, JSON.stringify(DEFAULT_SETTINGS), new Date().toISOString())
    const row = this.agent(index)
    if (!row || row.address !== address) throw new Error(`${agentName(index)} is registered with another address (${row?.address}); wrong recovery words?`)
    return row
  }

  /**
   * An imported team, paused until the owner resumes it. A team removed earlier comes back with its number
   * and history; a wallet that is already an agent is refused.
   */
  addImportedAgent(address: string): AgentRow {
    const old = this.db.prepare('SELECT idx, source, removed_at, retired FROM agents WHERE address = ?').get(address) as { idx: number; source: string; removed_at: string | null; retired: string | null } | undefined
    if (old && old.removed_at === null) throw new Error(`this wallet is already ${agentName(old.idx)}${old.retired ? ' (retired: restore it instead)' : ''}`)
    if (old && old.source !== 'imported') throw new Error(`this wallet is ${agentName(old.idx)} of this install`)
    if (old) {
      this.db.prepare('UPDATE agents SET removed_at = NULL, paused = 1 WHERE idx = ?').run(old.idx)
      return this.agent(old.idx)!
    }
    const index = this.maxIndex() + 1
    this.db
      .prepare("INSERT INTO agents (idx, address, paused, settings, created_at, source) VALUES (?, ?, 1, ?, ?, 'imported')")
      .run(index, address, JSON.stringify(DEFAULT_SETTINGS), new Date().toISOString())
    return this.agent(index)!
  }

  /** Removes an imported team from the agents (its activity and spend stay in the history). */
  removeImportedAgent(index: number): void {
    const r = this.db.prepare("UPDATE agents SET removed_at = ? WHERE idx = ? AND source = 'imported' AND removed_at IS NULL").run(new Date().toISOString(), index)
    if (r.changes !== 1) throw new Error(`${agentName(index)} is not an imported team`)
  }

  /** True when an imported team holds (or held) this number, so the recovery words never take it. */
  importedAt(index: number): boolean {
    return this.db.prepare("SELECT 1 FROM agents WHERE idx = ? AND source = 'imported'").get(index) !== undefined
  }

  /** The highest number ever used, removed teams included (-1 with none). */
  maxIndex(): number {
    const r = this.db.prepare('SELECT MAX(idx) AS m FROM agents').get() as { m: number | null }
    return r.m ?? -1
  }

  /** One agent by number, a retired one included (it stays paused); removed teams are gone. */
  agent(index: number): AgentRow | undefined {
    const r = this.db.prepare('SELECT * FROM agents WHERE idx = ? AND removed_at IS NULL').get(index) as Record<string, unknown> | undefined
    return r ? toAgentRow(r, this.liveMode) : undefined
  }

  /** The active agents: the ones that plan, show in the tabs and count toward the agent limit. */
  agents(): AgentRow[] {
    const live = this.liveMode
    return (this.db.prepare('SELECT * FROM agents WHERE removed_at IS NULL AND retired IS NULL ORDER BY idx').all() as Record<string, unknown>[]).map(r => toAgentRow(r, live))
  }

  /** The agents parked with Retire, until they are restored. */
  retiredAgents(): AgentRow[] {
    const live = this.liveMode
    return (this.db.prepare('SELECT * FROM agents WHERE removed_at IS NULL AND retired IS NOT NULL ORDER BY idx').all() as Record<string, unknown>[]).map(r => toAgentRow(r, live))
  }

  /** Parks an agent: paused and out of the active agents. Its row, settings and history stay. */
  retireAgent(index: number, info: RetiredInfo): void {
    const r = this.db.prepare('UPDATE agents SET retired = ?, paused = 1 WHERE idx = ? AND removed_at IS NULL AND retired IS NULL').run(JSON.stringify(info), index)
    if (r.changes !== 1) throw new Error(`${agentName(index)} is not an active agent`)
  }

  /** True once the agent signed anything live: a live ledger row or an activity row with a transaction hash. */
  everUsed(index: number): boolean {
    return (
      this.db.prepare('SELECT 1 FROM spend WHERE agent_idx = ? AND dry_run = 0 LIMIT 1').get(index) !== undefined ||
      this.db.prepare('SELECT 1 FROM activity WHERE agent_idx = ? AND tx_hash IS NOT NULL LIMIT 1').get(index) !== undefined
    )
  }

  /**
   * Deletes an agent from the recovery words for good: its row, history, ledger, waiting payments and stored values,
   * so its number is free and + Add agent can take it again (the same wallet). Only for a wallet that was never used:
   * the caller checks it (neverUsedOrWhy). An imported team is removed with removeImportedAgent instead.
   */
  deleteAgent(index: number, by: string): DeletedAgent {
    const row = this.db.prepare('SELECT address, source FROM agents WHERE idx = ?').get(index) as { address: string; source: string } | undefined
    if (!row) throw new Error(`no ${agentName(index)}`)
    if (row.source === 'imported') throw new Error(`${agentName(index)} is an imported team: remove it instead`)
    const gone: DeletedAgent = { index, address: row.address, at: new Date().toISOString(), by }
    this.db.exec('BEGIN')
    try {
      for (const table of ['activity', 'spend', 'pending_tx']) this.db.prepare(`DELETE FROM ${table} WHERE agent_idx = ?`).run(index)
      const keys = PER_AGENT_KV.map(p => `${p}${index}`)
      this.db.prepare(`DELETE FROM kv WHERE key IN (${keys.map(() => '?').join(', ')})`).run(...keys)
      this.db.prepare('DELETE FROM agents WHERE idx = ?').run(index)
      this.setKv('deleted_agents', JSON.stringify([...this.deletedAgents(), gone].slice(-200)))
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
    return gone
  }

  /** The agents deleted so far (deploy/sync-pems.sh removes their PEM files on the owner's computer). */
  deletedAgents(): DeletedAgent[] {
    try {
      const v: unknown = JSON.parse(this.getKv('deleted_agents') ?? '[]')
      return Array.isArray(v) ? (v as DeletedAgent[]) : []
    } catch {
      return []
    }
  }

  /** The lowest number no agent holds (an imported team, removed or not, keeps its number): where + Add agent goes. */
  freeIndex(): number {
    const used = new Set((this.db.prepare('SELECT idx FROM agents').all() as { idx: number }[]).map(r => r.idx))
    let i = 0
    while (used.has(i)) i++
    return i
  }

  /** Brings a retired agent back among the active ones, still paused: the owner resumes it. */
  restoreAgent(index: number): void {
    const r = this.db.prepare('UPDATE agents SET retired = NULL, paused = 1 WHERE idx = ? AND removed_at IS NULL AND retired IS NOT NULL').run(index)
    if (r.changes !== 1) throw new Error(`${agentName(index)} is not retired`)
  }

  setPaused(index: number, paused: boolean): void {
    // A retired agent stays paused until it is restored, whoever asks (web UI, Telegram, CLI).
    if (!paused && this.agent(index)?.retired) throw new Error(`${agentName(index)} is retired: restore it first`)
    this.db.prepare('UPDATE agents SET paused = ? WHERE idx = ?').run(paused ? 1 : 0, index)
  }

  updateSettings(index: number, patch: Partial<AgentSettings>): AgentSettings {
    const row = this.agent(index)
    if (!row) throw new Error(`no ${agentName(index)}`)
    const next = { ...row.settings, ...patch }
    this.db.prepare('UPDATE agents SET settings = ? WHERE idx = ?').run(JSON.stringify(next), index)
    return next
  }

  // ---- kill switch and flags ----

  get killSwitch(): boolean {
    return this.getKv('kill_switch') === '1'
  }

  setKillSwitch(on: boolean): void {
    this.setKv('kill_switch', on ? '1' : '0')
  }

  /** One mode for all agents: dry run (default) or live. Live signing also needs AGENT_LIVE_ENABLED=1 on the server. */
  get liveMode(): boolean {
    return this.getKv('live_mode') === '1'
  }

  setLiveMode(on: boolean): void {
    this.setKv('live_mode', on ? '1' : '0')
  }

  /** Every kv row whose key starts with this prefix. */
  kvWithPrefix(prefix: string): [string, string][] {
    return (this.db.prepare("SELECT key, value FROM kv WHERE key LIKE ? ESCAPE '\\'").all(prefix.replace(/[\\%_]/g, c => `\\${c}`) + '%') as { key: string; value: string }[]).map(r => [r.key, r.value])
  }

  getKv(key: string): string | undefined {
    return (this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined)?.value
  }

  setKv(key: string, value: string): void {
    this.db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
  }

  // ---- public match facts ----

  /** Both formations of a revealed match and the strength of each eleven, as read once from its public statistics. */
  matchFacts(key: string): MatchFormations | undefined {
    const r = this.db.prepare('SELECT facts FROM match_facts WHERE key = ?').get(key) as { facts: string } | undefined
    return r ? (JSON.parse(r.facts) as MatchFormations) : undefined
  }

  /** Kept 90 days: the formation record reads a team's last 50 matches, about a week of play. */
  putMatchFacts(key: string, facts: MatchFormations): void {
    const now = new Date()
    this.db.prepare('INSERT INTO match_facts (key, facts, read_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET facts = excluded.facts, read_at = excluded.read_at').run(key, JSON.stringify(facts), now.toISOString())
    this.db.prepare('DELETE FROM match_facts WHERE read_at < ?').run(new Date(now.getTime() - 90 * 86_400_000).toISOString())
  }

  // ---- marketplace sales (the market price of each rarity) ----

  hasSale(id: number): boolean {
    return this.db.prepare('SELECT 1 FROM market_sales WHERE id = ?').get(id) !== undefined
  }

  /** Public sales as read; kept 120 days (the market price looks back at most 90). */
  putSales(rows: Pick<MarketSale, 'id' | 'rarity' | 'price' | 'sold_at'>[]): void {
    const put = this.db.prepare('INSERT INTO market_sales (id, rarity, price, sold_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
    for (const r of rows) if (Number.isSafeInteger(r.id) && typeof r.rarity === 'string' && r.price > 0 && typeof r.sold_at === 'string') put.run(r.id, r.rarity, r.price, r.sold_at)
    this.db.prepare('DELETE FROM market_sales WHERE sold_at < ?').run(new Date(Date.now() - 120 * 86_400_000).toISOString())
  }

  get salesComplete(): boolean {
    return this.getKv('market_sales_complete') === '1'
  }

  markSalesComplete(): void {
    this.setKv('market_sales_complete', '1')
  }

  markSalesIncomplete(): void {
    this.setKv('market_sales_complete', '0')
  }

  salesSince(iso: string): Pick<MarketSale, 'rarity' | 'price' | 'sold_at'>[] {
    return this.db.prepare('SELECT rarity, price, sold_at FROM market_sales WHERE sold_at >= ?').all(iso) as Pick<MarketSale, 'rarity' | 'price' | 'sold_at'>[]
  }

  /** An agent's counted matches (its formation record), kept for the pooled record; read again each plan, stored once. */
  putFormationResults(index: number, ownUserId: number, games: FormationMatch[]): void {
    const put = this.db.prepare(
      'INSERT INTO formation_results (agent_idx, match_key, at, own_user_id, rival_user_id, mine, theirs, gf, ga, edge) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(agent_idx, match_key) DO NOTHING',
    )
    for (const g of games) put.run(index, g.key, g.at, ownUserId, g.rivalUserId, g.mine, g.theirs, g.gf, g.ga, g.edge)
    this.db.prepare('DELETE FROM formation_results WHERE at < ?').run(new Date(Date.now() - 30 * 86_400_000).toISOString())
  }

  /**
   * The pooled formation record: the last 14 days of every team this install runs (its matches against a team of its
   * own left out, they say nothing about the field). It names no team. The install's own teams are the ones with rows
   * here and every one whose FoxLeague user id the store keeps (agent_user_id:N, retired and removed teams too): a team
   * that never planned or whose rows were pruned is still the owner's (audit B1, 2026-10-23).
   */
  formationPool(): FormationRecord {
    const own = new Set(this.kvWithPrefix('agent_user_id:').map(([, v]) => Number(v)).filter(n => Number.isSafeInteger(n) && n > 0))
    const rows = (this.db
      .prepare(
        `SELECT match_key, at, mine, theirs, gf, ga, edge, rival_user_id FROM formation_results
         WHERE at >= ? AND (rival_user_id IS NULL OR rival_user_id NOT IN (SELECT DISTINCT own_user_id FROM formation_results))`,
      )
      .all(new Date(Date.now() - 14 * 86_400_000).toISOString()) as { match_key: string; at: string; mine: string; theirs: string; gf: number; ga: number; edge: number | null; rival_user_id: number | null }[])
      .filter(r => r.rival_user_id === null || !own.has(Number(r.rival_user_id)))
    return summariseFormations(rows.map(r => ({ key: r.match_key, at: r.at, mine: r.mine, theirs: r.theirs, gf: r.gf, ga: r.ga, edge: r.edge, rivalUserId: r.rival_user_id })))
  }

  /** An agent's casual games (against FoxLeague's AI), kept for the casual test bench; read again each plan, stored once, kept 60 days. */
  putCasualResults(index: number, games: FormationMatch[]): void {
    const put = this.db.prepare('INSERT INTO casual_results (agent_idx, match_key, at, mine, ai, gf, ga, edge) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(agent_idx, match_key) DO NOTHING')
    for (const g of games) put.run(index, g.key, g.at, g.mine, g.theirs, g.gf, g.ga, g.edge)
    this.db.prepare('DELETE FROM casual_results WHERE at < ?').run(new Date(Date.now() - 60 * 86_400_000).toISOString())
  }

  /** The casual test bench: the casual games of every team the install runs in the last 40 days, by formation against the AI. */
  casualBench(): FormationRecord {
    const rows = this.db
      .prepare('SELECT match_key, at, mine, gf, ga, edge FROM casual_results WHERE at >= ?')
      .all(new Date(Date.now() - CASUAL_DAYS * 86_400_000).toISOString()) as { match_key: string; at: string; mine: string; gf: number; ga: number; edge: number | null }[]
    return summariseFormations(rows.map(r => ({ key: r.match_key, at: r.at, mine: r.mine, theirs: 'AI', gf: r.gf, ga: r.ga, edge: r.edge, rivalUserId: null })))
  }

  /** The FoxLeague user ids of the install's own teams: every one the store keeps (agent_user_id:N) and every one with rows in the pooled record. */
  ownUserIds(): Set<number> {
    const kept = this.kvWithPrefix('agent_user_id:').map(([, v]) => Number(v))
    const pooled = (this.db.prepare('SELECT DISTINCT own_user_id FROM formation_results').all() as { own_user_id: number }[]).map(r => Number(r.own_user_id))
    return new Set([...kept, ...pooled].filter(n => Number.isSafeInteger(n) && n > 0))
  }

  // ---- the league formation table (owner, 2026-11-04) ----

  hasLeagueMatch(key: string): boolean {
    return this.db.prepare('SELECT 1 FROM league_matches WHERE key = ?').get(key) !== undefined
  }

  /** A public match of two other teams, kept once and for 30 days (the table counts the last 14). */
  putLeagueMatch(m: LeagueMatch): void {
    this.db
      .prepare('INSERT INTO league_matches (key, at, kind, home_user_id, away_user_id, home, away, home_score, away_score, home_strength, away_strength, home_elo, away_elo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO NOTHING')
      .run(m.key, m.at, m.kind, m.homeUserId, m.awayUserId, m.home, m.away, m.homeScore, m.awayScore, m.homeStrength, m.awayStrength, m.homeElo, m.awayElo)
    this.db.prepare('DELETE FROM league_matches WHERE at < ?').run(new Date(Date.now() - 30 * 86_400_000).toISOString())
  }

  /** The next team of the leaderboard's top to read (a position, wrapped by the reader). */
  get leagueCursor(): number {
    const n = Number(this.getKv('league_cursor'))
    return Number.isSafeInteger(n) && n >= 0 ? n : 0
  }

  setLeagueCursor(n: number): void {
    this.setKv('league_cursor', String(n))
  }

  /** What a planning snapshot reads and writes the league matches through. */
  leagueCache(): LeagueCache {
    return { has: k => this.hasLeagueMatch(k), put: m => this.putLeagueMatch(m), cursor: () => this.leagueCursor, setCursor: n => this.setLeagueCursor(n), own: () => this.ownUserIds() }
  }

  /** The league formation table of the last 14 days, the owner's teams left out (also one learned after its matches were kept). */
  leagueFormations(): LeagueTable {
    const rows = this.db
      .prepare('SELECT key, at, kind, home_user_id, away_user_id, home, away, home_score, away_score, home_strength, away_strength, home_elo, away_elo FROM league_matches WHERE at >= ?')
      .all(new Date(Date.now() - LEAGUE_DAYS * 86_400_000).toISOString()) as Record<string, unknown>[]
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
    return leagueTable(
      rows.map(r => ({ key: String(r.key), at: String(r.at), kind: String(r.kind), homeUserId: Number(r.home_user_id), awayUserId: Number(r.away_user_id), home: String(r.home), away: String(r.away), homeScore: Number(r.home_score), awayScore: Number(r.away_score), homeStrength: num(r.home_strength), awayStrength: num(r.away_strength), homeElo: num(r.home_elo), awayElo: num(r.away_elo) })),
      this.ownUserIds(),
    )
  }

  // ---- activity ----

  log(e: { agentIndex: number | null; kind: string; status: ActivityStatus; summary: string; detail?: unknown; costUsd?: number | null; txHash?: string | null }): number {
    const detail = e.detail === undefined ? null : typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
    const r = this.db
      .prepare('INSERT INTO activity (agent_idx, at, kind, status, summary, detail, cost_usd, tx_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(e.agentIndex, new Date().toISOString(), e.kind, e.status, e.summary, detail, e.costUsd ?? null, e.txHash ?? null)
    return Number(r.lastInsertRowid)
  }

  activity(agentIndex: number | null, limit = 50): ActivityRow[] {
    const rows = (agentIndex === null
      ? this.db.prepare('SELECT * FROM activity ORDER BY id DESC LIMIT ?').all(limit)
      : this.db.prepare('SELECT * FROM activity WHERE agent_idx = ? ORDER BY id DESC LIMIT ?').all(agentIndex, limit)) as Record<string, unknown>[]
    return rows.map(rowToActivity)
  }

  /** Every row of these kinds since a moment, newest first: limits over days never depend on how busy the log is. */
  /** Every agent's plans since a moment, oldest first (for the AI's cost per day). */
  plansSince(since: Date): { at: string; detail: string | null }[] {
    return this.db.prepare("SELECT at, detail FROM activity WHERE kind = 'plan' AND at >= ? ORDER BY id").all(since.toISOString()) as { at: string; detail: string | null }[]
  }

  activityOf(agentIndex: number, kinds: string[], since: Date): ActivityRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM activity WHERE agent_idx = ? AND at >= ? AND kind IN (${kinds.map(() => '?').join(', ')}) ORDER BY id DESC`)
      .all(agentIndex, since.toISOString(), ...kinds) as Record<string, unknown>[]
    return rows.map(rowToActivity)
  }


  /** Activity rows counted per agent, kind and status between two moments (the daily summary). */
  activityCounts(from: Date, to: Date): { agentIndex: number | null; kind: string; status: ActivityStatus; n: number }[] {
    return (this.db
      .prepare('SELECT agent_idx AS a, kind, status, COUNT(*) AS n FROM activity WHERE at >= ? AND at < ? GROUP BY agent_idx, kind, status')
      .all(from.toISOString(), to.toISOString()) as { a: number | null; kind: string; status: ActivityStatus; n: number }[])
      .map(r => ({ agentIndex: r.a === null ? null : Number(r.a), kind: r.kind, status: r.status, n: Number(r.n) }))
  }

  // ---- spend ledger ----

  /** Returns the row id, so a live payment booked before signing can be confirmed or released. */
  recordSpend(s: SpendEntry): number {
    const r = this.db
      .prepare('INSERT INTO spend (agent_idx, at, game_day, month, category, action, foxsy_atomic, egld_atomic, usd, tx_hash, dry_run) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(s.agentIndex, s.at.toISOString(), s.gameDay, s.at.toISOString().slice(0, 7), s.category, s.action, s.foxsyAtomic.toString(), s.egldAtomic.toString(), s.usd, s.txHash, s.dryRun ? 1 : 0)
    return Number(r.lastInsertRowid)
  }

  setSpendHash(id: number, txHash: string): void {
    this.db.prepare('UPDATE spend SET tx_hash = ? WHERE id = ?').run(txHash, id)
  }

  /** Rows still counting whose action tag starts with a prefix (bid:<nonce>, join:<tournament>), oldest first. */
  openSpend(agentIndex: number, prefix: string, dryRun: boolean): { id: number; action: string; at: string; usd: number; txHash: string | null }[] {
    return (this.db
      .prepare("SELECT id, action, at, usd, tx_hash FROM spend WHERE agent_idx = ? AND dry_run = ? AND usd > 0 AND action LIKE ? || '%' ORDER BY id")
      .all(agentIndex, dryRun ? 1 : 0, prefix) as Record<string, unknown>[]).map(r => ({
      id: Number(r.id),
      action: String(r.action),
      at: String(r.at),
      usd: Number(r.usd),
      txHash: (r.tx_hash as string | null) ?? null,
    }))
  }

  /** Renames the tag of some booked rows (a created tournament's seat, once its id is known). */
  retagSpend(ids: number[], from: string, to: string): void {
    const q = this.db.prepare('UPDATE spend SET action = ? WHERE id = ? AND action = ?')
    for (const id of ids) q.run(to, id, from)
  }

  /** A payment that is final (a won bid): tagged so no refund check ever looks at it again; it keeps counting. */
  closeSpend(id: number, outcome: string): void {
    this.db.prepare("UPDATE spend SET action = action || ':' || ? WHERE id = ?").run(outcome, id)
  }

  /** Money that came back (an outbid bid, a refunded entry): the row stays for the record, counting 0. */
  creditSpend(id: number): void {
    this.db.prepare("UPDATE spend SET usd = 0, foxsy_atomic = '0', action = action || ':refunded' WHERE id = ?").run(id)
  }

  /** The hashes of this agent's seats and stakes (join:<tournament>) whose money came back: cancelled, left or never seated. */
  refundedSeatHashes(agentIndex: number): Set<string> {
    return new Set((this.db
      .prepare("SELECT tx_hash FROM spend WHERE agent_idx = ? AND action LIKE 'join:%:refunded' AND tx_hash IS NOT NULL")
      .all(agentIndex) as { tx_hash: string }[]).map(r => String(r.tx_hash)))
  }

  /** The hashes of this agent's payments tagged so (shop:xp_booster) whose money came back (creditSpend). */
  refundedHashes(agentIndex: number, tag: string): Set<string> {
    return new Set((this.db
      .prepare('SELECT tx_hash FROM spend WHERE agent_idx = ? AND action = ? AND tx_hash IS NOT NULL')
      .all(agentIndex, `${tag}:refunded`) as { tx_hash: string }[]).map(r => String(r.tx_hash)))
  }

  /** A booked payment that never left the wallet (refused before sending, or reverted). */
  deleteSpend(id: number): void {
    this.db.prepare('DELETE FROM spend WHERE id = ?').run(id)
  }

  /** USD spent in one game day / month / ever, in the ledger of the given mode (dry-run or live). */
  /** What each agent spent (play and setup, not swaps) between two moments, in one mode's ledger. */
  spentBetween(from: Date, to: Date, dryRun: boolean): Map<number, number> {
    const rows = this.db
      .prepare("SELECT agent_idx AS a, COALESCE(SUM(usd), 0) AS s FROM spend WHERE at >= ? AND at < ? AND dry_run = ? AND category IN ('play', 'setup') GROUP BY agent_idx")
      .all(from.toISOString(), to.toISOString(), dryRun ? 1 : 0) as { a: number; s: number }[]
    return new Map(rows.map(r => [Number(r.a), Number(r.s)]))
  }

  spentUsd(agentIndex: number, q: { gameDay?: string; month?: string; category: SpendCategory; dryRun: boolean }): number {
    let sql = 'SELECT COALESCE(SUM(usd), 0) AS s FROM spend WHERE agent_idx = ? AND category = ? AND dry_run = ?'
    const args: (string | number)[] = [agentIndex, q.category, q.dryRun ? 1 : 0]
    if (q.gameDay) {
      sql += ' AND game_day = ?'
      args.push(q.gameDay)
    }
    if (q.month) {
      sql += ' AND month = ?'
      args.push(q.month)
    }
    return Number((this.db.prepare(sql).get(...args) as { s: number }).s)
  }

  // ---- pending transactions (tx_pending recovery) ----

  addPending(hash: string, agentIndex: number, kind: string, payload: unknown): void {
    this.db.prepare('INSERT OR REPLACE INTO pending_tx (hash, agent_idx, kind, payload, sent_at, state) VALUES (?, ?, ?, ?, ?, ?)').run(hash, agentIndex, kind, JSON.stringify(payload), new Date().toISOString(), 'pending')
  }

  pending(agentIndex: number): { hash: string; kind: string; payload: unknown; sentAt: string }[] {
    return (this.db.prepare("SELECT * FROM pending_tx WHERE agent_idx = ? AND state = 'pending' ORDER BY sent_at").all(agentIndex) as Record<string, unknown>[]).map(r => ({
      hash: String(r.hash),
      kind: String(r.kind),
      payload: JSON.parse(String(r.payload)),
      sentAt: String(r.sent_at),
    }))
  }

  /** The agents with a payment still pending (retired ones included). */
  pendingAgents(): number[] {
    return (this.db.prepare("SELECT DISTINCT agent_idx FROM pending_tx WHERE state = 'pending' ORDER BY agent_idx").all() as { agent_idx: number }[]).map(r => Number(r.agent_idx))
  }

  resolvePending(hash: string, state: 'done' | 'failed' | 'abandoned'): void {
    this.db.prepare('UPDATE pending_tx SET state = ? WHERE hash = ?').run(state, hash)
  }
}

function toAgentRow(r: Record<string, unknown>, live: boolean): AgentRow {
  return {
    index: Number(r.idx),
    address: String(r.address),
    source: r.source === 'imported' ? 'imported' : 'derived',
    dryRun: !live,
    paused: Number(r.paused) === 1,
    // Settings added after an agent was created fall back to the defaults.
    settings: { ...DEFAULT_SETTINGS, ...(JSON.parse(String(r.settings)) as Partial<AgentSettings>) },
    createdAt: String(r.created_at),
    retired: r.retired ? (JSON.parse(String(r.retired)) as RetiredInfo) : null,
  }
}
