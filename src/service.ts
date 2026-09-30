// The long-running service: every tick (randomised inside a window, within active hours) each
// active agent takes a snapshot, asks the strategist for a plan, and hands the actions to the
// executor spread over the next window, each re-checked against a fresh snapshot.

import { loadConfig, type Config } from './config.ts'
import { Chain } from './chain/gateway.ts'
import { FoxLeague } from './foxleague/api.ts'
import { takeSnapshot, type AgentSnapshot } from './snapshot/snapshot.ts'
import { renderDigest } from './snapshot/digest.ts'
import { Store, type AgentRow } from './store/db.ts'
import { STRATEGY_PRESETS, validateSettingsPatch } from './store/settings.ts'
import { randomBytes, randomInt } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { walletFromSecretKey, deriveWallet, exportPem, type AgentWallet } from './wallet/wallet.ts'
import { addressOfKey, deleteImportedKey, loadImportedWallet, saveImportedKey, secretKeyFrom, type ImportInput } from './wallet/imported.ts'
import type { UserSecretKey } from '@multiversx/sdk-core'
import { MAINNET } from './config.ts'
import { atomicToFloat, formatAtomic } from './util/encoding.ts'
import { fundsUsd, lowOnFunds } from './snapshot/funds.ts'
import { Executor } from './executor/executor.ts'
import { describeAction, parseAction, type PlannedAction } from './executor/actions.ts'
import { budgetView } from './executor/budget.ts'
import { MODELS, Strategist, describeModelError, strategistChoice, type Effort, type Plan } from './strategist/strategist.ts'
import { Proposals, type Proposal } from './strategist/proposals.ts'
import { retryPendingPayments } from './executor/pending.ts'
import { creditRefunds } from './executor/refunds.ts'
import { ensureBadge } from './setup/badge.ts'
import { Telegram, type TextReply } from './telegram/telegram.ts'
import { KEY_FIELDS, keyFormatError, maskKey, readSecrets, secretsFile, writeSecrets, type KeyName, type KeyValues } from './store/secrets.ts'
import { checkKeys, pickOwnerChat, telegramMe, telegramRecentChats, type KeyCheck } from './setup/keys.ts'
import { credentialsFromEnv } from './web/auth.ts'
import { startWeb } from './web/server.ts'
import { sleep } from './util/http.ts'
import { numberToIndex, agentName, pemName, whichAgents } from './names.ts'

/** The installed version (package.json), shown when the service starts. */
export const VERSION = (() => {
  try {
    return (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string }).version ?? '?'
  } catch {
    return '?'
  }
})()

const SERVICE_PID_FILE = 'service.pid'
/** How long before a strategy lock the preparation tick runs (its actions are spread over the next ~24 minutes). */
const PREP_BEFORE_LOCK_MS = 60 * 60_000
/** Locks closer than this to the previous one belong to the same match session (one preparation tick). */
const SESSION_GAP_MS = 2 * 3600_000
/** A plan's actions finish at least this long before the agent's next strategy lock. */
const LOCK_MARGIN_MS = 10 * 60_000

/** The pid of the running service on this data folder, or null. A second process must not run plans next to it. */
export function serviceRunning(dataDir: string): number | null {
  let pid: number
  try {
    pid = Number(readFileSync(join(dataDir, SERVICE_PID_FILE), 'utf8').trim())
  } catch {
    return null
  }
  if (!Number.isInteger(pid) || pid <= 0) return null
  try {
    process.kill(pid, 0)
    return pid
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM' ? pid : null // EPERM: alive, another user's process
  }
}

/** Telegram's "/" menu (agents are numbered from 1); /help lists the same commands with their arguments. */
const TELEGRAM_MENU = [
  { command: 'status', description: 'This install and its agents' },
  { command: 'agents', description: "Balances and today's spend" },
  { command: 'plan', description: 'The last plan (/plan 2 for agent 2)' },
  { command: 'tick', description: 'Plan and run now: /tick 1' },
  { command: 'pause', description: 'Pause one agent or all: /pause 2' },
  { command: 'resume', description: 'Resume one agent or all: /resume 2' },
  { command: 'mode', description: 'Dry run or live, one mode for all agents' },
  { command: 'budget', description: 'Spend against the limits' },
  { command: 'ask', description: 'A question about a team: /ask 1 question' },
  { command: 'do', description: 'One action now: /do 1 request' },
  { command: 'strategy', description: 'Show or replace a strategy' },
  { command: 'clear', description: 'Start a new conversation with the manager' },
  { command: 'log', description: 'Recent activity' },
  { command: 'keys', description: 'Which keys are set (masked)' },
  { command: 'kill', description: 'Stop every agent at once: /kill on' },
  { command: 'help', description: 'Every command with its options' },
]

/** One line of the conversation with the owner. */
export interface ChatLine {
  from: 'owner' | 'manager'
  text: string
  at: string
  /** Where the owner wrote it: Telegram or the web UI. */
  source?: string
  /** The agents an owner line was about; on a manager line, the agents its strategy proposal is for. */
  agents?: number[]
  /** A manager line that came with a strategy proposal: its id, text and summary of changes. */
  proposal?: string
  strategy?: string
  changes?: string
}
/**
 * The box keeps and shows the last CHAT_KEPT messages. The manager reads the current conversation only: the
 * messages since the last pause of CHAT_PAUSE_MS (or since Clear), at most CHAT_CONTEXT of them (half of what
 * is kept: about 25 questions with their answers), whole, because everything it reads is paid for with each message.
 */
const CHAT_KEPT = 100
const CHAT_CONTEXT = 50
const CHAT_PAUSE_MS = 3600_000

export class Service {
  readonly cfg: Config
  readonly store: Store
  readonly chain: Chain
  readonly fox: FoxLeague
  readonly executor: Executor
  /** Both replaced at run time when the admin panel changes their key or token. */
  strategist: Strategist | null
  telegram: Telegram | null
  private readonly wallets = new Map<number, AgentWallet>()
  private readonly timers = new Map<number, NodeJS.Timeout>()
  private readonly busy = new Set<number>()
  /** Last snapshot per agent, for the web UI (refreshed at every tick and every action). */
  readonly snapshots = new Map<number, AgentSnapshot>()
  readonly proposals = new Proposals()
  /**
   * The conversation with the owner, from Telegram and the web UI's box alike: the last CHAT_KEPT lines, saved
   * (kv chat) so a restart keeps them. The manager reads the current conversation (chatContext), so a follow-up
   * has context.
   */
  private chat: ChatLine[] = []
  private readonly lastRefresh = new Map<number, number>()
  /** Import team, step 1 checked the key and the team; step 2 (with the password) takes it by this token. */
  private readonly pendingImports = new Map<string, { key: UserSecretKey; address: string; team: string; expires: number }>()
  private stopping = false
  private readonly stopSignal = new AbortController()

  constructor(cfg: Config) {
    if (!cfg.mnemonic) throw new Error('AGENT_MNEMONIC is not set: run `npm run cli -- setup` first')
    this.cfg = cfg
    this.store = new Store(cfg.dataDir)
    this.chain = new Chain(cfg)
    this.fox = new FoxLeague(cfg.foxleagueUrl, cfg.foxleagueRps)
    this.telegram = cfg.telegramToken && cfg.telegramChatId ? new Telegram(cfg.telegramToken, cfg.telegramChatId) : null
    const choice = strategistChoice(this.store, cfg)
    this.strategist = cfg.anthropicApiKey ? new Strategist(cfg.anthropicApiKey, choice.model, choice.effort) : null
    this.executor = new Executor({ cfg, chain: this.chain, fox: this.fox, store: this.store, notify: (_i, text) => this.notify(text) })
    try {
      const saved: unknown = JSON.parse(this.store.getKv('chat') ?? '[]')
      if (Array.isArray(saved)) this.chat = saved.filter((l): l is ChatLine => (l?.from === 'owner' || l?.from === 'manager') && typeof l.text === 'string' && typeof l.at === 'string').slice(-CHAT_KEPT)
    } catch {
      // A saved conversation that cannot be read starts empty.
    }
  }

  /**
   * The lines the manager reads with the next message: back from the newest one for as long as no pause
   * between two lines (or since the newest) is longer than CHAT_PAUSE_MS, at most CHAT_CONTEXT lines.
   */
  private chatContext(now = Date.now()): ChatLine[] {
    const out: ChatLine[] = []
    let next = now
    for (let i = this.chat.length - 1; i >= 0 && out.length < CHAT_CONTEXT; i--) {
      const at = Date.parse(this.chat[i]!.at)
      if (next - at > CHAT_PAUSE_MS) break
      out.unshift(this.chat[i]!)
      next = at
    }
    return out
  }

  /** The conversation for the web UI: `read` marks the lines the manager still reads; an open proposal travels with its line. */
  chatLines(now = Date.now()): (Omit<ChatLine, 'proposal' | 'strategy' | 'changes'> & { read: boolean; proposed: boolean; open?: { id: string; strategy: string; changes: string } })[] {
    const firstRead = this.chat.length - this.chatContext(now).length
    return this.chat.map(({ proposal, strategy, changes, ...line }, i) => ({
      ...line,
      read: i >= firstRead,
      proposed: strategy !== undefined,
      ...(proposal && strategy !== undefined && this.proposals.isOpen(proposal) ? { open: { id: proposal, strategy, changes: changes ?? '' } } : {}),
    }))
  }

  private say(line: Omit<ChatLine, 'at'>): void {
    this.chat.push({ ...line, at: new Date().toISOString() })
    this.chat.splice(0, Math.max(0, this.chat.length - CHAT_KEPT))
    this.store.setKv('chat', JSON.stringify(this.chat))
  }

  notify(text: string): void {
    console.log(`[${new Date().toISOString()}] ${text}`)
    this.telegram?.send(text)
  }

  /** An agent's wallet: from the recovery words (account = index) or an imported team's own key. */
  wallet(index: number): AgentWallet {
    let w = this.wallets.get(index)
    if (!w) {
      const row = this.store.agent(index)
      w = row?.source === 'imported' ? loadImportedWallet(this.cfg.dataDir, row.address, index) : deriveWallet(this.cfg.mnemonic!, index)
      this.wallets.set(index, w)
    }
    return w
  }

  modeText(): string {
    if (!this.store.liveMode) return 'dry run'
    return this.executor.liveEnabled ? 'LIVE' : 'live requested, still simulated (AGENT_LIVE_ENABLED is not set on the server)'
  }

  /** One mode for all agents. Going live needs the server's permission, AGENT_LIVE_ENABLED=1 in its env. */
  setMode(live: boolean, by: string): string {
    if (live && !this.executor.liveEnabled) throw new Error('live signing is not allowed on this server: set AGENT_LIVE_ENABLED=1 in its env file and restart')
    this.store.setLiveMode(live)
    const text = `mode ${live ? 'LIVE: every agent that is not paused signs and sends real transactions within its caps' : 'dry run: every action is simulated'} (${by})`
    this.store.log({ agentIndex: null, kind: 'control', status: 'info', summary: text })
    this.notify(text)
    return text
  }

  /** The strategist's model and effort for every agent, from the next cycle on (same API key). */
  setStrategist(model: string, effort: Effort, by: string): string {
    if (!this.strategist) throw new Error('the strategist is off (no ANTHROPIC_API_KEY)')
    if (!MODELS[model]) throw new Error(`unknown model ${model}`)
    this.store.setKv('strategist_model', model)
    this.store.setKv('strategist_effort', effort)
    this.strategist.configure(model, effort)
    const text = `strategist ${MODELS[model].label}, effort ${effort}, from the next cycle (${by})`
    this.store.log({ agentIndex: null, kind: 'control', status: 'info', summary: text })
    this.notify(text)
    return text
  }

  /**
   * The owner's advice or question, from Telegram or an agent's page in the web UI. Advice comes back
   * as a strategy proposal that changes nothing until the owner applies it; caps, mode and model
   * are out of the chat's reach.
   */
  async discuss(message: string, source: string, defaultAgents?: number[]): Promise<{ reply: string; proposal: Proposal | null }> {
    if (!this.strategist) throw new Error('the strategist is off (no ANTHROPIC_API_KEY)')
    const agents = this.store.agents()
    const targets = defaultAgents?.length ? defaultAgents : agents.map(b => b.index)
    let answer
    try {
      answer = await this.strategist.discuss({
        message: message.slice(0, 4000),
        source,
        defaultAgents: targets,
        agents: agents.map(b => {
          const s = this.snapshots.get(b.index)
          return { index: b.index, team: s?.team?.name ?? s?.registration.teamName ?? null, strategy: b.settings.strategy, paused: b.paused }
        }),
        // Whole messages. An owner message that was about some of the agents only says which, so a follow-up
        // about another agent is not mixed up with it.
        recent: this.chatContext().map(l => ({
          from: l.from,
          text: l.from === 'owner'
            ? `${l.agents?.length && l.agents.length < agents.length ? `(about ${whichAgents(l.agents)}) ` : ''}${l.text}`
            : `${l.text}${l.strategy !== undefined ? ` [proposed strategy for ${whichAgents(l.agents ?? [])}: ${l.strategy}]` : ''}`,
        })),
        digests: targets.slice(0, 3).flatMap(i => {
          const s = this.snapshots.get(i)
          return s ? [{ index: i, digest: renderDigest(s) }] : []
        }),
      })
    } catch (err) {
      throw new Error(describeModelError(err))
    }
    this.store.setKv('model_usd_total', String(Number(this.store.getKv('model_usd_total') ?? 0) + answer.usd))
    const proposal = answer.proposal ? this.proposals.add({ ...answer.proposal, source }) : null
    this.say({ from: 'owner', text: message.slice(0, 4000), source, agents: targets })
    this.say({ from: 'manager', text: answer.reply.slice(0, 4000), ...(proposal ? { agents: proposal.agents, proposal: proposal.id, strategy: proposal.strategy, changes: proposal.changes } : {}) })
    return { reply: answer.reply, proposal }
  }

  applyProposal(id: string, by: string): string {
    const p = this.proposals.take(id)
    if (!p) throw new Error('this proposal expired or was already applied or cancelled')
    const patch = validateSettingsPatch({ strategy: p.strategy })
    for (const i of p.agents) {
      if (!this.store.agent(i)) continue
      this.store.updateSettings(i, patch)
      this.store.log({ agentIndex: i, kind: 'control', status: 'info', summary: `strategy updated (${by})${p.changes ? `: ${p.changes}` : ''}` })
    }
    this.say({ from: 'owner', text: `(applied the proposed strategy for ${whichAgents(p.agents)})`, source: by })
    const text = `strategy updated for ${whichAgents(p.agents)} (${by})`
    this.notify(text)
    return text
  }

  /**
   * Empties the conversation: the manager starts fresh with the next message (a smaller context costs less).
   * Proposals made in it are dropped with it, so none stays open out of sight. Strategies and settings stay.
   */
  clearChat(by: string): string {
    for (const l of this.chat) if (l.proposal) this.proposals.take(l.proposal)
    const n = this.chat.length
    this.chat = []
    this.store.setKv('chat', '[]')
    if (n) this.store.log({ agentIndex: null, kind: 'control', status: 'info', summary: `conversation with the manager cleared (${by})` })
    return n ? 'conversation cleared: the manager starts fresh with your next message' : 'the conversation is already empty'
  }

  /**
   * Tells the owner when an agent's wallet is worth less than its top-up warning level: once when it falls
   * under it, and again only after it was topped up above it. Nothing is paused: the agent plays on with what
   * it has.
   */
  private checkFunds(agent: AgentRow, snap: AgentSnapshot): void {
    const usd = fundsUsd(snap)
    const level = agent.settings.topUpWarningUsd
    const key = `low_funds:${agent.index}`
    if (usd === null || level <= 0) return
    if (!lowOnFunds(usd, level)) {
      if (this.store.getKv(key) === '1') this.store.setKv(key, '0')
      return
    }
    if (this.store.getKv(key) === '1') return
    this.store.setKv(key, '1')
    const text = `${agentName(agent.index)} is low on funds: about $${usd.toFixed(2)} in its wallet (${formatAtomic(snap.chain!.egld, 4)} EGLD, ${snap.chain!.wegld > 0n ? `${formatAtomic(snap.chain!.wegld, 4)} WEGLD, ` : ''}${formatAtomic(snap.chain!.foxsy, 0)} FOXSY), under its top-up warning of $${level}. Send EGLD or WEGLD (it buys FOXSY by itself) or FOXSY to ${agent.address}`
    this.store.log({ agentIndex: agent.index, kind: 'control', status: 'info', summary: text })
    this.notify(text)
  }

  cancelProposal(id: string): string {
    const p = this.proposals.take(id)
    if (!p) return 'this proposal was already applied, cancelled or expired'
    this.say({ from: 'owner', text: `(dropped the proposed strategy for ${whichAgents(p.agents)})` })
    return 'proposal dropped; nothing changed'
  }

  private async chatFromTelegram(text: string): Promise<TextReply> {
    const { reply, proposal } = await this.discuss(text, 'Telegram')
    if (!proposal) return { text: reply || '(no answer)' }
    return {
      text: `${reply ? `${reply}\n\n` : ''}Proposed strategy for ${whichAgents(proposal.agents)}:\n${proposal.strategy}${proposal.changes ? `\n\nChanges: ${proposal.changes}` : ''}`,
      buttons: [
        { label: 'Apply', data: `apply:${proposal.id}` },
        { label: 'Cancel', data: `cancel:${proposal.id}` },
      ],
    }
  }

  /** A Telegram inline button. Apply already announces itself through notify. */
  private async button(data: string): Promise<string> {
    const [verb, id] = data.split(':')
    if (verb === 'apply' && id) {
      this.applyProposal(id, 'Telegram')
      return ''
    }
    if (verb === 'cancel' && id) return this.cancelProposal(id)
    return 'unknown button'
  }

  private startTelegram(): void {
    this.telegram?.startPolling({ command: (c, a, r) => this.command(c, a, r), text: t => this.chatFromTelegram(t), button: d => this.button(d) })
    this.telegram?.setCommands(TELEGRAM_MENU)
  }

  /** The admin panel's view of the keys: masked, and where each value comes from. */
  keyStatus(): { key: KeyName; label: string; secret: boolean; masked: string; source: 'admin panel' | 'env file' | null }[] {
    const panel = readSecrets(secretsFile(this.cfg.dataDir))
    return KEY_FIELDS.map(f => {
      const v = process.env[f.key]?.trim() || undefined
      return { key: f.key, label: f.label, secret: f.secret, masked: maskKey(v, f.secret), source: v ? (panel[f.key] ? 'admin panel' : 'env file') : null }
    })
  }

  /**
   * New keys from the admin panel: checked for shape, saved in the data dir (they override the env
   * file) and used at once: a new Anthropic client, Telegram polling restarted with the new token.
   */
  updateKeys(values: KeyValues, by: string): string {
    const changed = Object.entries(values).filter(([, v]) => v) as [KeyName, string][]
    if (!changed.length) throw new Error('nothing to save')
    for (const [k, v] of changed) {
      const bad = keyFormatError(k, v)
      if (bad) throw new Error(`${KEY_FIELDS.find(f => f.key === k)!.label}: ${bad}`)
    }
    writeSecrets(secretsFile(this.cfg.dataDir), Object.fromEntries(changed))
    for (const [k, v] of changed) process.env[k] = v
    const names = changed.map(([k]) => k)
    if (names.includes('ANTHROPIC_API_KEY')) {
      this.cfg.anthropicApiKey = values.ANTHROPIC_API_KEY
      if (this.strategist) this.strategist.setApiKey(values.ANTHROPIC_API_KEY!)
      else {
        const choice = strategistChoice(this.store, this.cfg)
        this.strategist = new Strategist(values.ANTHROPIC_API_KEY!, choice.model, choice.effort)
      }
    }
    const labels = changed.map(([k]) => KEY_FIELDS.find(f => f.key === k)!.label).join(', ')
    if (names.includes('TELEGRAM_BOT_TOKEN') || names.includes('TELEGRAM_CHAT_ID')) {
      // Tell the chat being replaced first, so a silent re-pointing of Telegram cannot go unnoticed.
      this.telegram?.send(`keys updated: ${labels} (${by}). Notifications move to ${names.includes('TELEGRAM_CHAT_ID') ? `chat ${values.TELEGRAM_CHAT_ID}` : 'the new bot token'}; this chat stops receiving them.`)
      this.cfg.telegramToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || undefined
      this.cfg.telegramChatId = process.env.TELEGRAM_CHAT_ID?.trim() || undefined
      this.telegram?.stop()
      this.telegram = this.cfg.telegramToken && this.cfg.telegramChatId ? new Telegram(this.cfg.telegramToken, this.cfg.telegramChatId) : null
      this.startTelegram()
    }
    const text = `keys updated: ${labels} (${by}); in use now`
    this.store.log({ agentIndex: null, kind: 'control', status: 'info', summary: text })
    this.notify(text)
    return text
  }

  /** A pending "Link my Telegram" from the dashboard: the owner sends this code to their Telegram bot from their own account. */
  private telegramLink: { code: string; until: number } | null = null

  /** Starts linking the owner's Telegram chat: needs the bot token saved and no chat linked yet. */
  async startTelegramLink(): Promise<{ code: string; username: string }> {
    const token = this.cfg.telegramToken
    if (!token) throw new Error('save the Telegram bot token first')
    if (this.cfg.telegramChatId) throw new Error('a chat is already linked; to link another one, clear the Telegram chat id in Keys first')
    const username = await telegramMe(token)
    const code = String(randomInt(100_000, 1_000_000))
    this.telegramLink = { code, until: Date.now() + 10 * 60_000 }
    return { code, username }
  }

  /** Finds the chat that sent the code (exactly one private chat) and saves it: from then on the Telegram bot answers only it. */
  async finishTelegramLink(by: string): Promise<string> {
    const link = this.telegramLink
    const token = this.cfg.telegramToken
    if (!link || link.until < Date.now() || !token) throw new Error('the code expired: press Link my Telegram again')
    const id = pickOwnerChat(await telegramRecentChats(token), link.code)
    if (!id) throw new Error('the code was not found yet: send exactly those 6 digits to your Telegram bot from your own Telegram account, then press I sent it again')
    this.telegramLink = null
    return this.updateKeys({ TELEGRAM_CHAT_ID: id }, by)
  }

  /** One key in clear, for the admin panel's eye button (the caller re-checks the password). Always announced. */
  revealKey(key: KeyName, by: string): string {
    const v = process.env[key]?.trim()
    if (!v) throw new Error('not set')
    const label = KEY_FIELDS.find(f => f.key === key)!.label
    const text = `${label} shown in the web UI (${by})`
    this.store.log({ agentIndex: null, kind: 'control', status: 'info', summary: text })
    this.notify(text)
    return v
  }

  testKeys(): Promise<KeyCheck[]> {
    return checkKeys({
      anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim(),
      model: this.strategist?.model ?? this.cfg.model,
      telegramToken: process.env.TELEGRAM_BOT_TOKEN?.trim(),
      telegramChatId: process.env.TELEGRAM_CHAT_ID?.trim(),
      binanceKey: process.env.BINANCE_API_KEY?.trim(),
      binanceSecret: process.env.BINANCE_API_SECRET?.trim(),
    })
  }

  /** Agents 1..AGENT_COUNT from the recovery words exist in the store (they follow the platform mode). */
  ensureAgents(): AgentRow[] {
    const count = Math.min(this.cfg.maxAgents, Math.max(1, Number(process.env.AGENT_COUNT ?? 1)))
    for (let i = 0; i < count; i++) if (!this.store.importedAt(i)) this.store.addAgent(i, this.wallet(i).address)
    const agents = this.store.agents()
    for (const b of agents) this.exportLocalPem(b.index)
    return agents
  }

  /**
   * On a local install (install.sh sets AGENT_PEM_DIR) every agent's PEM lands in pem/ (agent1.pem for the
   * first), so the owner can log into FoxLeague as that agent's team and watch it. Never on a server; an
   * existing file is left alone.
   */
  private exportLocalPem(index: number): void {
    const dir = process.env.AGENT_PEM_DIR?.trim()
    // An imported team's key is the owner's own file already.
    if (!dir || this.cfg.isServer || !this.cfg.mnemonic || this.store.agent(index)?.source === 'imported') return
    const out = join(dir, pemName(index))
    if (existsSync(out)) return
    try {
      exportPem(this.cfg.mnemonic, index, out, { isServer: false, repoRoot: resolve(import.meta.dirname, '..') })
    } catch (err) {
      console.error(`PEM file for ${agentName(index)} skipped: ${err instanceof Error ? err.message : err}`)
    }
  }

  isBusy(index: number): boolean {
    return this.busy.has(index)
  }

  private async snapshot(index: number): Promise<AgentSnapshot> {
    const snap = await takeSnapshot({ chain: this.chain, fox: this.fox }, { wallet: this.wallet(index) })
    this.snapshots.set(index, snap)
    this.lastRefresh.set(index, Date.now())
    return snap
  }

  /** A fresh snapshot for the web UI, at most one per agent every 15 s. */
  /** The owner leaves a tournament or 1v1 from the web UI: the same executor, checks and log as a plan. */
  async leave(index: number, tournamentId: number, who: string): Promise<string> {
    if (this.stopping) return 'the service is stopping; try again after the restart'
    const agent = this.store.agent(index)
    if (!agent) return `no ${agentName(index)}`
    const snap = await this.snapshot(index)
    const [r] = await this.executor.run(agent, this.wallet(index), snap, [{ action: { type: 'leave_tournament', tournament_id: tournamentId }, reason: `owner (${who})`, byOwner: true }])
    void this.snapshot(index).catch(() => undefined)
    return r ? r.summary : 'nothing ran'
  }

  async refreshSnapshot(index: number): Promise<void> {
    if (Date.now() - (this.lastRefresh.get(index) ?? 0) < 15_000) return
    await this.snapshot(index)
  }

  /** Adds the next wallet index as a new agent (dry run), within AGENT_MAX_AGENTS, and schedules it. */
  addNextAgent(): AgentRow {
    const agents = this.store.agents()
    if (agents.length >= this.cfg.maxAgents) throw new Error(`this install allows ${this.cfg.maxAgents} agents (AGENT_MAX_AGENTS)`)
    const index = this.nextIndex()
    const row = this.store.addAgent(index, this.wallet(index).address)
    this.exportLocalPem(index)
    this.schedule(index, 20_000)
    return row
  }

  /** The number the next agent from the recovery words takes (never one an imported team held). */
  nextIndex(): number {
    return this.store.maxIndex() + 1
  }

  /**
   * Import team, step 1: reads the key (PEM file, keystore or recovery words plus an account number), then
   * checks the wallet: not an agent already, not from this install's own recovery words, with a FoxLeague team.
   * Nothing is stored yet; the key waits 10 minutes in memory for step 2.
   */
  async previewImport(input: ImportInput): Promise<{ token: string; address: string; team: { name: string; overall: number; badge: boolean }; egld: string; foxsy: string }> {
    if (this.stopping) throw new Error('the service is stopping; try again after the restart')
    if (this.store.agents().length >= this.cfg.maxAgents) throw new Error(`this install allows ${this.cfg.maxAgents} agents (AGENT_MAX_AGENTS)`)
    const key = secretKeyFrom(input)
    const address = addressOfKey(key)
    const same = this.store.agents().find(b => b.address === address)
    if (same) throw new Error(`this wallet is already ${agentName(same.index)}`)
    // One of the install's own accounts (now or the next ones Add agent would take) is added with Add agent.
    for (let i = 0; i <= this.store.maxIndex() + this.cfg.maxAgents; i++) {
      if (!this.store.importedAt(i) && deriveWallet(this.cfg.mnemonic!, i).address === address) throw new Error("this wallet comes from this install's own recovery words: use + Add agent instead")
    }
    // The team's overall is answered to the team's own session only: the key just given signs that login.
    const team = await this.fox.team(address, walletFromSecretKey(key, this.store.maxIndex() + 1))
    if (!team) throw new Error('this wallet has no FoxLeague team. Register the team in the FoxLeague app first or use + Add agent for a new one')
    const [account, esdts, guarded] = await Promise.all([this.chain.account(address), this.chain.esdts(address), this.chain.guarded(address)])
    // Nothing an agent signs would go through: say so now, not after the import at the first transaction.
    if (guarded) throw new Error('this wallet has a Guardian, so an agent cannot sign for it. Turn the Guardian off in your wallet first, or better, play with a wallet made only for FoxLeague')
    const foxsy = esdts.find(e => e.tokenIdentifier === MAINNET.foxsyToken)
    const now = Date.now()
    for (const [t, p] of this.pendingImports) if (p.expires < now) this.pendingImports.delete(t)
    while (this.pendingImports.size >= 3) this.pendingImports.delete(this.pendingImports.keys().next().value!)
    const token = randomBytes(18).toString('base64url')
    this.pendingImports.set(token, { key, address, team: team.name, expires: now + 10 * 60_000 })
    return {
      token,
      address,
      team: { name: team.name, overall: team.team_overall, badge: Boolean(team.badge) },
      egld: atomicToFloat(account.balance).toFixed(4),
      foxsy: foxsy ? atomicToFloat(foxsy.balance).toFixed(0) : '0',
    }
  }

  /** Import team, step 2 (after the password): stores the key, adds the agent paused, schedules it. */
  importAgent(token: string, who: string): AgentRow {
    const p = this.pendingImports.get(token)
    this.pendingImports.delete(token)
    if (!p || p.expires < Date.now()) throw new Error('this import has expired: check the key again')
    if (this.stopping) throw new Error('the service is stopping; try again after the restart')
    if (this.store.agents().length >= this.cfg.maxAgents) throw new Error(`this install allows ${this.cfg.maxAgents} agents (AGENT_MAX_AGENTS)`)
    const same = this.store.agents().find(b => b.address === p.address)
    if (same) throw new Error(`this wallet is already ${agentName(same.index)}`)
    saveImportedKey(this.cfg.dataDir, p.key)
    let row: AgentRow
    try {
      row = this.store.addImportedAgent(p.address)
    } catch (err) {
      deleteImportedKey(this.cfg.dataDir, p.address)
      throw err
    }
    this.wallets.delete(row.index)
    this.store.log({ agentIndex: row.index, kind: 'control', status: 'info', summary: `team "${p.team}" imported from the web UI by ${who}; paused until resumed` })
    this.notify(`${agentName(row.index)}: team "${p.team}" imported by ${who} (${p.address}). It is paused: set its limits and strategy, then resume it.`)
    this.schedule(row.index, 20_000)
    void this.snapshot(row.index).catch(() => undefined)
    return row
  }

  /**
   * Removes an imported team: it must be paused, idle and without a payment waiting for confirmation. The
   * stored key is deleted (the owner keeps their own copy); the history stays.
   */
  removeAgent(index: number, who: string): string {
    const agent = this.store.agent(index)
    if (!agent) throw new Error(`no ${agentName(index)}`)
    if (agent.source !== 'imported') throw new Error(`${agentName(index)} comes from this install's recovery words and cannot be removed; pause it instead`)
    if (!agent.paused) throw new Error(`pause ${agentName(index)} first`)
    if (this.busy.has(index) || !this.executor.idle) throw new Error(`${agentName(index)} is busy; try again in a minute`)
    if (this.store.pending(index).length) throw new Error(`${agentName(index)} has a payment waiting for FoxLeague's confirmation; try again later`)
    clearTimeout(this.timers.get(index))
    this.timers.delete(index)
    this.store.removeImportedAgent(index)
    deleteImportedKey(this.cfg.dataDir, agent.address)
    this.wallets.delete(index)
    this.snapshots.delete(index)
    this.store.log({ agentIndex: index, kind: 'control', status: 'info', summary: `imported team removed from the web UI by ${who}; its key was deleted from this install` })
    this.notify(`${agentName(index)} (imported team, ${agent.address}) removed by ${who}; its key was deleted from this install.`)
    return `${agentName(index)} removed; its key was deleted from this install`
  }

  async start(): Promise<void> {
    writeFileSync(join(this.cfg.dataDir, SERVICE_PID_FILE), String(process.pid), { mode: 0o600 })
    const agents = this.ensureAgents()
    this.notify(
      `foxleague-agent ${VERSION} started: ${agents.length} agent(s), strategist ${this.strategist ? `${this.strategist.model} (${this.strategist.effort})` : 'OFF (no ANTHROPIC_API_KEY)'}, mode ${this.modeText()}${this.store.killSwitch ? ', KILL SWITCH ON' : ''}\n` +
        agents.map(b => `${agentName(b.index)} ${b.address}${b.paused ? ' paused' : ''}`).join('\n'),
    )
    this.startTelegram()
    const creds = credentialsFromEnv()
    if (creds) startWeb(this, creds, Number(process.env.WEB_UI_PORT ?? 8870))
    else console.log('web UI off: set it up with `agentctl.sh set-web-password`')
    for (const b of agents) {
      this.schedule(b.index, 5_000 + Math.random() * 20_000)
      void this.snapshot(b.index).catch(() => undefined)
    }
  }

  private schedule(index: number, delayMs: number): void {
    clearTimeout(this.timers.get(index))
    if (this.stopping) return
    this.timers.set(index, setTimeout(() => void this.tick(index).catch(err => this.panic(err)).finally(() => this.scheduleNext(index)), delayMs))
  }

  /** Sleeps like setTimeout but wakes at once when the service stops. */
  private pause(ms: number): Promise<void> {
    return new Promise(resolve => {
      const t = setTimeout(resolve, ms)
      this.stopSignal.signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true })
    })
  }

  /**
   * Graceful stop (SIGTERM, a deploy): no new tick and no new action; an action already signing or
   * waiting for its outcome finishes (up to 150 s, the unit allows 180) so it is booked, then exit.
   */
  async stop(): Promise<void> {
    if (this.stopping) return
    this.stopping = true
    this.stopSignal.abort()
    for (const t of this.timers.values()) clearTimeout(t)
    this.telegram?.stop()
    const until = Date.now() + 150_000
    // Plans (busy) and single actions from Telegram /do or the web (the executor's per-agent locks).
    while ((this.busy.size || !this.executor.idle) && Date.now() < until) await sleep(500)
    const pidFile = join(this.cfg.dataDir, SERVICE_PID_FILE)
    if (serviceRunning(this.cfg.dataDir) === process.pid) rmSync(pidFile, { force: true })
  }

  /** An error nothing caught: stop every agent (kill switch) rather than crash and re-plan after a restart. */
  panic(err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('unhandled error:', err)
    if (this.stopping) return
    try {
      this.store.setKillSwitch(true)
    } catch {
      // the database itself failed: the next start refuses to act on it anyway
    }
    this.notify(`internal error, kill switch ON until you release it (dashboard or /kill off): ${msg}`)
  }

  private scheduleNext(index: number, now = Date.now()): void {
    const s = this.store.agent(index)?.settings
    if (!s) return
    const jitter = (Math.random() * 2 - 1) * s.tickJitterMinutes
    let delay = Math.max(5, s.tickMinutes + jitter) * 60_000
    // A planning tick about an hour before the first lock of each match session of our own (no lock of
    // ours in the 2 hours before it), so the plan can sync, set the lineup and recover condition in time.
    // Matches close together are covered by the normal ticks. The tick itself still keeps to active hours.
    const locks = (this.snapshots.get(index)?.auth?.upcoming?.matches ?? [])
      .map(m => ({ at: new Date(m.strategy_locks_at).getTime(), upcoming: m.phase === 'upcoming' }))
      .filter(l => Number.isFinite(l.at))
      .sort((x, y) => x.at - y.at)
    const prep = locks
      .filter((l, i) => l.upcoming && (i === 0 || l.at - locks[i - 1]!.at > SESSION_GAP_MS))
      .map(l => l.at - PREP_BEFORE_LOCK_MS)
      .filter(t => t > now + 5 * 60_000)[0]
    if (prep !== undefined && prep - now < delay) delay = prep - now
    this.schedule(index, delay)
  }

  private inActiveHours(agent: AgentRow, now = new Date()): boolean {
    const [from, to] = agent.settings.activeHoursUtc
    const h = now.getUTCHours()
    return from <= to ? h >= from && h < to : h >= from || h < to
  }

  /** One tick: snapshot, plan, run the actions spread over the window. */
  async tick(index: number, ownerRequest?: string): Promise<string> {
    const agent = this.store.agent(index)
    if (!agent) return `no ${agentName(index)}`
    if (this.stopping) return 'stopping'
    if (this.store.killSwitch) return 'kill switch is on'
    if (agent.paused) return `${agentName(index)} is paused`
    if (!ownerRequest && !this.inActiveHours(agent)) return `${agentName(index)}: outside active hours`
    if (this.busy.has(index)) return `${agentName(index)} is still running its previous plan`
    this.busy.add(index)
    try {
      await this.retryPending(agent)
      const n = await creditRefunds({ store: this.store, chain: this.chain, fox: this.fox }, agent, agent.dryRun || !this.executor.liveEnabled).catch(() => 0)
      if (n) this.store.log({ agentIndex: index, kind: 'tick', status: 'info', summary: n === 1 ? '1 refunded bid or seat no longer counts against the budget' : `${n} refunded bids or seats no longer count against the budget` })
      const snap = await this.snapshot(index)
      this.checkFunds(agent, snap)
      // Onboarding: the free team badge, once (plain code, never paid for; a failure never stops the tick).
      await ensureBadge({ store: this.store, fox: this.fox, notify: t => this.notify(t) }, index, this.wallet(index), snap.team, agent.dryRun || !this.executor.liveEnabled).catch(() => undefined)
      if (!this.strategist) {
        this.store.log({ agentIndex: index, kind: 'tick', status: 'info', summary: 'snapshot taken; no strategist (ANTHROPIC_API_KEY not set)', detail: { warnings: snap.warnings } })
        return 'snapshot only (no strategist key)'
      }
      const plan = await this.makePlan(agent, snap, ownerRequest)
      await this.runPlan(agent, plan.actions, !ownerRequest)
      return plan.summary
    } catch (err) {
      const msg = describeModelError(err)
      this.store.log({ agentIndex: index, kind: 'tick', status: 'error', summary: msg })
      this.notify(`${agentName(index)} tick failed: ${msg}`)
      return msg
    } finally {
      this.busy.delete(index)
    }
  }

  private async makePlan(agent: AgentRow, snap: AgentSnapshot, ownerRequest?: string): Promise<Plan> {
    const dry = agent.dryRun || !this.executor.liveEnabled
    const budget = budgetView(this.store, agent.index, agent.settings, dry, new Date(), snap.gameDay.resetHourUtc)
    const plan = await this.strategist!.plan({ snapshot: snap, settings: agent.settings, budget, recent: this.store.activity(agent.index, 20), dryRun: dry, ...(ownerRequest ? { ownerRequest } : {}) })
    const text =
      `${agentName(agent.index)} plan${ownerRequest ? ' (owner request)' : ''}: ${plan.summary}\n` +
      (plan.actions.length ? plan.actions.map((a, i) => `${i + 1}. ${describeAction(a.action)} (${a.reason})`).join('\n') : '(no actions)') +
      (plan.rejected.length ? `\nrejected proposals: ${plan.rejected.map(r => r.error).join('; ')}` : '') +
      `\nmodel cost $${plan.usage.usd.toFixed(4)} (cache read ${plan.usage.cacheReadTokens} tokens)${plan.usage.servedBy !== this.strategist!.model ? `, served by ${plan.usage.servedBy} (fallback)` : ''}`
    this.store.log({ agentIndex: agent.index, kind: 'plan', status: 'info', summary: text.slice(0, 2000), detail: { plan, stop: plan.stopReason } })
    this.store.setKv(`last_plan_${agent.index}`, text)
    this.store.setKv('model_usd_total', String(Number(this.store.getKv('model_usd_total') ?? 0) + plan.usage.usd))
    this.notify(text)
    return plan
  }

  /**
   * Runs the actions at random moments across the next window (at least minGapSeconds apart), each
   * against a fresh snapshot. Routine actions pass the per-action probability; owner requests always run.
   */
  private async runPlan(agent: AgentRow, actions: PlannedAction[], routine: boolean): Promise<void> {
    if (!actions.length) return
    let windowMs = routine ? agent.settings.tickMinutes * 60_000 * 0.8 : 0
    // Never spread past our next strategy lock: a sync or a recovery meant for that match must land before it.
    const nextLock = (this.snapshots.get(agent.index)?.auth?.upcoming?.matches ?? [])
      .filter(m => m.phase === 'upcoming')
      .map(m => new Date(m.strategy_locks_at).getTime())
      .filter(t => Number.isFinite(t) && t > Date.now())
      .sort((x, y) => x - y)[0]
    if (nextLock !== undefined) windowMs = Math.max(0, Math.min(windowMs, nextLock - Date.now() - LOCK_MARGIN_MS))
    const gapMs = agent.settings.minGapSeconds * 1000
    const offsets = actions.map(() => Math.random() * windowMs).sort((a, b) => a - b)
    let last = -gapMs
    const start = Date.now()
    // The mode the plan was made in: a switch between dry run and live mid-plan ends the plan.
    const plannedDry = agent.dryRun
    for (let i = 0; i < actions.length; i++) {
      const at = Math.max(offsets[i]!, last + gapMs)
      last = at
      const wait = start + at - Date.now()
      if (wait > 0) await this.pause(wait)
      if (this.stopping) return
      const current = this.store.agent(agent.index)
      if (!current || current.paused || this.store.killSwitch) return
      if (current.dryRun !== plannedDry) {
        this.store.log({ agentIndex: agent.index, kind: 'tick', status: 'info', summary: `plan ended: it was made in ${plannedDry ? 'dry run' : 'live'} and the mode changed; the next plan starts fresh` })
        return
      }
      if (routine && !this.inActiveHours(current)) {
        this.store.log({ agentIndex: agent.index, kind: 'tick', status: 'info', summary: `plan ended: active hours are over (until ${String(current.settings.activeHoursUtc[1]).padStart(2, '0')}:00 UTC); the rest waits for tomorrow's plans` })
        return
      }
      if (routine && Math.random() > current.settings.actionProbability) {
        this.store.log({ agentIndex: agent.index, kind: actions[i]!.action.type, status: 'info', summary: `skipped by the action probability: ${describeAction(actions[i]!.action)}` })
        continue
      }
      const snap = await this.snapshot(agent.index)
      await this.executor.run(current, this.wallet(agent.index), snap, [actions[i]!])
    }
  }

  /** Payments sent but not confirmed with FoxLeague yet: confirmed again with the same hash, never paid twice. */
  private async retryPending(agent: AgentRow): Promise<void> {
    await retryPendingPayments({ store: this.store, fox: this.fox, notify: t => this.notify(t) }, agent.index, this.wallet(agent.index))
  }

  // ---- Telegram commands ----

  private agentsArg(arg: string | undefined): number[] {
    if (!arg || arg === 'all') return this.store.agents().map(b => b.index)
    const n = numberToIndex(arg)
    if (n === undefined || !this.store.agent(n)) throw new Error(`no agent ${arg} (agents are numbered from 1)`)
    return [n]
  }

  async command(cmd: string, args: string[], raw: string): Promise<string> {
    switch (cmd) {
      case 'start':
      case 'help':
        return [
          '/status  this install and its agents',
          '/agents  balances and today\'s spend',
          '/plan [N]  the last plan',
          '/tick N  plan and run now',
          '/pause [N|all]  /resume [N|all]',
          '/mode [dry|live confirm]  one mode for all agents',
          '/budget [N]',
          '/ask [N] question',
          '/do N request  one-off action (same executor and caps)',
          '/strategy [N|all] [steady|climber|hunter|<text>]  show or replace directly',
          '(any plain message)  talk to the manager: advice becomes a strategy proposal with Apply',
          '/clear  start a new conversation: the manager forgets the current one (it also does after an hour without a message)',
          '/kill on|off  pause every agent at once',
          '/log [N]  recent activity',
          '/keys [test]  which keys are set (masked); test checks them. Change keys in the web UI only',
        ].join('\n')
      case 'status': {
        const agents = this.store.agents()
        return [
          `mode ${this.modeText()}; kill switch ${this.store.killSwitch ? 'ON' : 'off'}; strategist ${this.strategist ? `${this.strategist.model} (${this.strategist.effort})` : 'off'}; model spend $${Number(this.store.getKv('model_usd_total') ?? 0).toFixed(2)}`,
          ...agents.map(b => `${agentName(b.index)}${b.paused ? ' PAUSED' : ''} ${b.address}`),
        ].join('\n')
      }
      case 'agents': {
        const lines: string[] = []
        for (const b of this.store.agents()) {
          const snap = await takeSnapshot({ chain: this.chain, fox: this.fox }, { wallet: this.wallet(b.index) })
          const v = budgetView(this.store, b.index, b.settings, b.dryRun || !this.executor.liveEnabled, new Date())
          const worth = fundsUsd(snap)
          lines.push(
            renderDigest(snap).split('\n').slice(0, 5).join('\n'),
            `spent today $${v.spentTodayUsd.toFixed(2)}/${v.dailyCapUsd}, month $${v.spentMonthUsd.toFixed(2)}/${v.monthlyBudgetUsd}`,
            ...(worth === null ? [] : [`wallet worth about $${worth.toFixed(2)}${lowOnFunds(worth, b.settings.topUpWarningUsd) ? ` (LOW: under the $${b.settings.topUpWarningUsd} top-up warning)` : ''}`]),
          )
        }
        return lines.join('\n')
      }
      case 'plan':
        return this.agentsArg(args[0]).map(i => this.store.getKv(`last_plan_${i}`) ?? `${agentName(i)}: no plan yet`).join('\n\n')
      case 'tick': {
        const [i] = this.agentsArg(args[0])
        void this.tick(i!)
        return `${agentName(i!)}: tick started`
      }
      case 'pause':
      case 'resume':
        const targets = this.agentsArg(args[0])
        for (const i of targets) this.store.setPaused(i, cmd === 'pause')
        return `${cmd}d ${args[0] && args[0] !== 'all' ? whichAgents(targets) : 'all agents'}`
      case 'mode': {
        const to = args[0]?.toLowerCase()
        if (to === undefined) return `mode ${this.modeText()}`
        if (to !== 'dry' && to !== 'live') return 'usage: /mode [dry|live confirm]'
        if (to === 'live' && args[1]?.toLowerCase() !== 'confirm') return 'Going live signs real transactions for every agent that is not paused. Send /mode live confirm to go ahead.'
        return this.setMode(to === 'live', 'Telegram')
      }
      case 'budget':
        return this.agentsArg(args[0])
          .map(i => {
            const b = this.store.agent(i)!
            const v = budgetView(this.store, i, b.settings, b.dryRun || !this.executor.liveEnabled, new Date())
            return `${agentName(i)} (${v.dryRun ? 'dry-run ledger' : 'live'}): today $${v.spentTodayUsd.toFixed(2)}/${v.dailyCapUsd} (game day ${v.gameDay}), month $${v.spentMonthUsd.toFixed(2)}/${v.monthlyBudgetUsd}, setup $${v.spentSetupUsd.toFixed(2)}/${v.setupBudgetUsd}`
          })
          .join('\n')
      case 'ask': {
        if (!this.strategist) return 'no strategist (ANTHROPIC_API_KEY not set)'
        const first = numberToIndex(args[0])
        const index = first !== undefined && this.store.agent(first) ? first : 0
        const question = first !== undefined ? raw.slice(args[0]!.length).trim() : raw
        if (!question) return 'usage: /ask [N] question'
        const snap = await takeSnapshot({ chain: this.chain, fox: this.fox }, { wallet: this.wallet(index) })
        const { answer } = await this.strategist.ask(snap, question)
        return `${agentName(index)}: ${answer}`
      }
      case 'do': {
        const [i] = this.agentsArg(args[0])
        const request = raw.slice(args[0]?.length ?? 0).trim()
        if (!request) return 'usage: /do N <request or action JSON>'
        if (this.stopping) return 'the service is stopping; try again after the restart'
        if (request.startsWith('{')) {
          const planned: PlannedAction = { action: parseAction(JSON.parse(request)), reason: 'owner (Telegram /do)', byOwner: true }
          const snap = await takeSnapshot({ chain: this.chain, fox: this.fox }, { wallet: this.wallet(i!) })
          const [r] = await this.executor.run(this.store.agent(i!)!, this.wallet(i!), snap, [planned])
          return r ? '' : 'nothing ran' // the executor already notified the result
        }
        void this.tick(i!, request)
        return `${agentName(i!)}: planning "${request}"`
      }
      case 'strategy': {
        const targets = this.agentsArg(args[0])
        const text = raw.slice(args[0]?.length ?? 0).trim()
        if (!text) return targets.map(i => `${agentName(i)}: ${this.store.agent(i)!.settings.strategy}`).join('\n\n')
        const patch = validateSettingsPatch({ strategy: STRATEGY_PRESETS[text] ?? text })
        for (const i of targets) {
          this.store.updateSettings(i, patch)
          this.store.log({ agentIndex: i, kind: 'control', status: 'info', summary: 'strategy replaced (Telegram /strategy)' })
        }
        return `strategy set for ${whichAgents(targets)}`
      }
      case 'keys': {
        if (args[0] === 'test') return (await this.testKeys()).map(c => `${c.ok ? 'OK' : 'FAIL'}  ${c.text}`).join('\n')
        return [
          ...this.keyStatus().map(k => `${k.label}: ${k.masked || 'not set'}${k.source ? ` (${k.source})` : ''}`),
          'Change keys in the web UI admin panel, never in a chat.',
        ].join('\n')
      }
      case 'kill': {
        const on = args[0]?.toLowerCase()
        if (on !== 'on' && on !== 'off') return 'usage: /kill on|off'
        this.store.setKillSwitch(on === 'on')
        return `kill switch ${on}`
      }
      case 'clear':
        return this.clearChat('Telegram')
      case 'log':
        return this.store
          .activity(args[0] ? this.agentsArg(args[0])[0]! : null, 12)
          .map(r => `${r.at.slice(5, 16)} ${r.agentIndex === null ? '-' : `a${r.agentIndex + 1}`} [${r.status}] ${r.summary.slice(0, 200)}`)
          .join('\n') || 'no activity yet'
      default:
        return `unknown command /${cmd} (see /help)`
    }
  }
}


if (import.meta.main) {
  const service = new Service(loadConfig())
  service.start().catch(err => {
    console.error(err)
    process.exit(1)
  })
  let exiting = false
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      if (exiting) return
      exiting = true
      service.notify('foxleague-agent stopping')
      void service.stop().finally(() => setTimeout(() => process.exit(0), 1500))
    })
  }
  process.on('unhandledRejection', err => service.panic(err))
}

