// Local state: agents and their settings, the activity log, the spend ledger, pending transactions
// and instance flags (kill switch). node:sqlite, one file in the data directory.

import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { agentName } from '../names.ts'
import { DEFAULT_SETTINGS, type AgentSettings } from './settings.ts'

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
    `)
    // Added with Import team: where the key comes from and when a team was removed (the row stays for the history).
    const cols = new Set((this.db.prepare('PRAGMA table_info(agents)').all() as { name: string }[]).map(c => c.name))
    if (!cols.has('source')) this.db.exec("ALTER TABLE agents ADD COLUMN source TEXT NOT NULL DEFAULT 'derived'")
    if (!cols.has('removed_at')) this.db.exec('ALTER TABLE agents ADD COLUMN removed_at TEXT')
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
    const old = this.db.prepare('SELECT idx, source, removed_at FROM agents WHERE address = ?').get(address) as { idx: number; source: string; removed_at: string | null } | undefined
    if (old && old.removed_at === null) throw new Error(`this wallet is already ${agentName(old.idx)}`)
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

  agent(index: number): AgentRow | undefined {
    const r = this.db.prepare('SELECT * FROM agents WHERE idx = ? AND removed_at IS NULL').get(index) as Record<string, unknown> | undefined
    return r ? toAgentRow(r, this.liveMode) : undefined
  }

  agents(): AgentRow[] {
    const live = this.liveMode
    return (this.db.prepare('SELECT * FROM agents WHERE removed_at IS NULL ORDER BY idx').all() as Record<string, unknown>[]).map(r => toAgentRow(r, live))
  }


  setPaused(index: number, paused: boolean): void {
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

  getKv(key: string): string | undefined {
    return (this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined)?.value
  }

  setKv(key: string, value: string): void {
    this.db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
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

  /** A booked payment that never left the wallet (refused before sending, or reverted). */
  deleteSpend(id: number): void {
    this.db.prepare('DELETE FROM spend WHERE id = ?').run(id)
  }

  /** USD spent in one game day / month / ever, in the ledger of the given mode (dry-run or live). */
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
  }
}
