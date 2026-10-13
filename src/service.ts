// The long-running service: every tick (randomised inside a window, within active hours) each
// active agent takes a snapshot, asks the strategist for a plan, and hands the actions to the
// executor spread over the next window, each re-checked against a fresh snapshot.

import { envFilePath, loadConfig, type Config } from './config.ts'
import { Chain } from './chain/gateway.ts'
import { FoxLeague } from './foxleague/api.ts'
import { takeSnapshot, type AgentSnapshot } from './snapshot/snapshot.ts'
import { renderDigest } from './snapshot/digest.ts'
import { Store, type AgentRow } from './store/db.ts'
import { MIN_TICK_MINUTES, STRATEGY_PRESETS, isZeus, validateSettingsPatch } from './store/settings.ts'
import { extensions, loadExtensions } from './extensions.ts'
import { randomBytes, randomInt } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { neverUsedOrWhy, removePemFile } from './delete-agent.ts'
import { ChangedWordsError, assertSameWords, walletFromSecretKey, deriveWallet, exportPem, type AgentWallet } from './wallet/wallet.ts'
import { addressOfKey, deleteImportedKey, loadImportedWallet, saveImportedKey, secretKeyFrom, type ImportInput } from './wallet/imported.ts'
import type { UserSecretKey } from '@multiversx/sdk-core'
import { MAINNET } from './config.ts'
import { atomicToFloat, formatAtomic } from './util/encoding.ts'
import { TOP_UP_REARM, fundsUsd, lowOnFunds, playableUsd } from './snapshot/funds.ts'
import { Executor, formatResult } from './executor/executor.ts'
import { describeAction, parseAction, type PlannedAction } from './executor/actions.ts'
import { budgetView } from './executor/budget.ts'
import { MODELS, Strategist, describeModelError, isModelAccountError, strategistChoice, type Effort, type Plan } from './strategist/strategist.ts'
import { Proposals, type Proposal } from './strategist/proposals.ts'
import { retryPendingPayments } from './executor/pending.ts'
import { creditRefunds } from './executor/refunds.ts'
import { ensureBadge } from './setup/badge.ts'
import { Telegram, type TextReply } from './telegram/telegram.ts'
import { KEY_FIELDS, keyFormatError, maskKey, readSecrets, secretsFile, writeSecrets, type KeyName, type KeyValues } from './store/secrets.ts'
import { checkKeys, pickOwnerChat, telegramMe, telegramRecentChats, type KeyCheck } from './setup/keys.ts'
import { TopUps } from './topup.ts'
import { dayBefore, nextSummaryAt, summaryText, validZone, zoneDate, zoneInstant, type AgentDay } from './summary.ts'
import { egldOnBinance, findWithdrawal, travelRuleCountry, whitelisted, withdrawEgld } from './cex/binance.ts'
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
  { command: 'topup', description: 'EGLD from Binance: /topup 2 asks, /topup code approves' },
  { command: 'summary', description: "Yesterday per agent (/summary today: so far today)" },
  { command: 'updates', description: 'Telegram: daily (summary only) or all (every update)' },
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
  /** An owner line whose answer is still being written; never saved (a restart drops it). */
  pending?: boolean
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
  /** EGLD top-ups from Binance that the owner approves with a one-time code on Telegram. */
  readonly topups: TopUps
  /** Both replaced at run time when the admin panel changes their key or token. */
  strategist: Strategist | null
  telegram: Telegram | null
  private readonly wallets = new Map<number, AgentWallet>()
  private readonly timers = new Map<number, NodeJS.Timeout>()
  /** When each agent's next tick is due (ms), for a settings save that shortens the cycle. */
  private readonly nextAt = new Map<number, number>()
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
  /** Raised by every Clear: an answer that arrives after a Clear is not written back into the new conversation. */
  private chatEpoch = 0
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
    this.executor = new Executor({ cfg, chain: this.chain, fox: this.fox, store: this.store, notify: (i, text, result) => (this.loud.has(i) || ((result?.txHash || result?.sent) && (result.status === 'error' || result.status === 'unconfirmed')) ? this.notify(text) : this.report(text)) })
    this.topups = new TopUps({
      store: this.store,
      key: () => {
        const apiKey = process.env.BINANCE_API_KEY?.trim()
        const secret = process.env.BINANCE_API_SECRET?.trim()
        return apiKey && secret ? { apiKey, secret } : null
      },
      accountType: () => {
        const t = process.env.BINANCE_ACCOUNT_TYPE?.trim().toLowerCase()
        return t === 'individual' || t === 'corporate' ? t : undefined
      },
      live: () => this.store.liveMode && this.executor.liveEnabled,
      binance: { egldOnBinance, travelRuleCountry, withdrawEgld, findWithdrawal, whitelisted },
      // The offer holds the code: straight to the owner's chat, never through notify (which also logs).
      send: text => this.telegram?.send(text),
    })
    try {
      const saved: unknown = JSON.parse(this.store.getKv('chat') ?? '[]')
      if (Array.isArray(saved)) this.chat = saved.filter((l): l is ChatLine => (l?.from === 'owner' || l?.from === 'manager') && typeof l.text === 'string' && typeof l.at === 'string' && !l.pending).slice(-CHAT_KEPT)
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

  /** A short fingerprint of what the box shows, so the web UI downloads the conversation only when it changed. */
  chatRevision(now = Date.now()): string {
    const last = this.chat.at(-1)
    return [this.chat.length, last?.at ?? '', this.chat.filter(l => l.pending).length, this.chat.filter(l => l.proposal && this.proposals.isOpen(l.proposal)).length, this.chat.length - this.chatContext(now).length].join(':')
  }

  private say(line: Omit<ChatLine, 'at'>): ChatLine {
    const said: ChatLine = { ...line, at: new Date().toISOString() }
    this.chat.push(said)
    // A proposal whose line leaves the box is dropped with it, so none stays open out of sight.
    for (const old of this.chat.splice(0, Math.max(0, this.chat.length - CHAT_KEPT))) if (old.proposal) this.proposals.take(old.proposal)
    this.saveChat()
    return said
  }

  private saveChat(): void {
    this.store.setKv('chat', JSON.stringify(this.chat.filter(l => !l.pending)))
  }

  notify(text: string): void {
    console.log(`[${new Date().toISOString()}] ${text}`)
    this.telegram?.send(text)
  }

  /**
   * A routine message (a plan, an action's result, low funds): on Telegram at once only with /updates all;
   * otherwise it waits for the daily summary (it is in the log and the activity either way).
   */
  report(text: string): void {
    if (this.updatesMode() === 'all') return this.notify(text)
    console.log(`[${new Date().toISOString()}] ${text}`)
  }

  /** Agents running a plan or an action the owner asked for on Telegram: its plan and results are told at once. */
  private readonly loud = new Set<number>()

  /** Plans failed in a row per agent (reset by a plan that works), and when each account problem was last said. */
  private readonly failStreak = new Map<number, number>()
  private readonly alertedAt = new Map<string, number>()

  /**
   * A plan that failed. Routine (it waits for the summary) unless it needs the owner: a problem with the AI account
   * (said at once, at most once an hour whatever number of agents hit it) or an agent failing 3 plans in a row.
   */
  private tickFailed(index: number, err: unknown, msg: string): void {
    const streak = (this.failStreak.get(index) ?? 0) + 1
    this.failStreak.set(index, streak)
    if (isModelAccountError(err)) {
      const last = this.alertedAt.get(msg) ?? 0
      if (Date.now() - last >= 3600_000) {
        this.alertedAt.set(msg, Date.now())
        return this.notify(`Plans are failing: ${msg}. Every agent waits until it is fixed (Keys in the dashboard, or the Anthropic console for credit and limits).`)
      }
      return this.report(`${agentName(index)} tick failed: ${msg}`)
    }
    if (streak === 3) {
      const key = `streak:${msg}`
      if (Date.now() - (this.alertedAt.get(key) ?? 0) >= 3600_000) {
        this.alertedAt.set(key, Date.now())
        return this.notify(`${agentName(index)}: its last 3 plans failed (${msg}). It keeps trying every cycle; other agents failing the same way within the hour are in the summary.`)
      }
    }
    this.report(`${agentName(index)} tick failed: ${msg}`)
  }

  /** daily (the default): routine messages wait for the summary; all: every update as it happens. */
  updatesMode(): 'daily' | 'all' {
    return this.store.getKv('telegram_updates') === 'all' ? 'all' : 'daily'
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
    // The context is the conversation before this message; the message shows in the box at once, marked as
    // waiting for its answer, so a reload or Telegram shows it too.
    const recent = this.chatContext()
    const epoch = this.chatEpoch
    const mine = this.say({ from: 'owner', text: message.slice(0, 4000), source, agents: targets, pending: true })
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
        recent: recent.map(l => ({
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
      // No answer: the message leaves the box again (the web UI gives the text back to retry).
      this.chat = this.chat.filter(l => l !== mine)
      this.saveChat()
      throw new Error(describeModelError(err))
    }
    this.addModelUsd(answer.usd)
    // Cleared while the answer was written: it does not come back into the new conversation, and makes no proposal.
    if (epoch !== this.chatEpoch) return { reply: answer.reply, proposal: null }
    delete mine.pending
    const proposal = answer.proposal ? this.proposals.add({ ...answer.proposal, source }) : null
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
    // Every open proposal goes, also one whose line already left the box or one Telegram still shows buttons for.
    this.proposals.clear()
    this.chatEpoch++
    const n = this.chat.length
    this.chat = []
    this.saveChat()
    if (n) this.store.log({ agentIndex: null, kind: 'control', status: 'info', summary: `conversation with the manager cleared (${by})` })
    return n ? 'conversation cleared: the manager starts fresh with your next message' : 'the conversation is already empty'
  }

  /**
   * Tells the owner when what an agent can play with (its wallet without the EGLD gas reserve) is worth less
   * than its top-up warning level: once when it falls under it, and again only after a top-up to well above it
   * (TOP_UP_REARM). Nothing is paused: the agent plays on with what it has.
   */
  private checkFunds(agent: AgentRow, snap: AgentSnapshot): void {
    const usd = playableUsd(snap, agent.settings.egldGasReserve)
    const level = agent.settings.topUpWarningUsd
    const key = `low_funds:${agent.index}`
    if (usd === null || level <= 0) return
    if (!lowOnFunds(usd, level)) {
      if (this.store.getKv(key) === '1' && usd >= level * TOP_UP_REARM) this.store.setKv(key, '0')
      return
    }
    if (this.store.getKv(key) === '1') return
    this.store.setKv(key, '1')
    const text = `${agentName(agent.index)} is low on funds: about $${usd.toFixed(2)} to play with, besides its ${agent.settings.egldGasReserve} EGLD gas reserve (wallet: ${formatAtomic(snap.chain!.egld, 4)} EGLD, ${snap.chain!.wegld > 0n ? `${formatAtomic(snap.chain!.wegld, 4)} WEGLD, ` : ''}${formatAtomic(snap.chain!.foxsy, 0)} FOXSY), under its top-up warning of $${level}. Send EGLD or WEGLD (it buys FOXSY by itself) or FOXSY to ${agent.address}`
    this.store.log({ agentIndex: agent.index, kind: 'control', status: 'info', summary: text })
    this.report(text)
    // With a Binance key and Telegram, the warning comes with a top-up the owner approves by code.
    if (this.telegram && process.env.BINANCE_API_KEY?.trim()) {
      void this.topups.offer(agent, usd, snap.prices?.egldUsd ?? 0, 'low').catch(err => this.store.log({ agentIndex: agent.index, kind: 'topup', status: 'error', summary: `no top-up offered: ${err instanceof Error ? err.message : String(err)}` }))
    }
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

  // ---- the daily summary ----

  private summaryTimer: NodeJS.Timeout | undefined
  /** The summary's time zone and hour: TELEGRAM_SUMMARY_TZ (default this computer's zone) and TELEGRAM_SUMMARY_HOUR (default 9). */
  private readonly summaryZone = validZone(process.env.TELEGRAM_SUMMARY_TZ)
  private readonly summaryHour = (() => {
    const raw = process.env.TELEGRAM_SUMMARY_HOUR?.trim()
    const h = raw ? Number(raw) : 9
    return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 9
  })()

  /** Kinds in the activity that are not actions (plans, ticks, controls, top-ups). */
  private static readonly NOT_ACTIONS = new Set(['plan', 'tick', 'control', 'topup', 'badge'])

  /**
   * The summary of one day (YYYY-MM-DD in the summary's zone), or of today so far. `scheduled`: the morning one,
   * which also notes each agent's ELO so the next one shows the change.
   */
  summary(day: string, o: { soFar?: boolean; scheduled?: boolean } = {}): string {
    const zone = this.summaryZone
    const from = new Date(zoneInstant(day, 0, zone))
    const to = o.soFar ? new Date() : new Date(zoneInstant(new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10) + 1)).toISOString().slice(0, 10), 0, zone))
    const live = this.store.liveMode && this.executor.liveEnabled
    const counts = this.store.activityCounts(from, to)
    const spent = this.store.spentBetween(from, to, !live)
    const days: AgentDay[] = this.store.agents().map(b => {
      const mine = counts.filter(c => c.agentIndex === b.index)
      const sum = (f: (c: (typeof mine)[number]) => boolean) => mine.filter(f).reduce((n, c) => n + c.n, 0)
      const action = (c: (typeof mine)[number]) => !Service.NOT_ACTIONS.has(c.kind)
      const snap = this.snapshots.get(b.index)
      const elo = snap?.profile?.elo_rating ?? null
      const prev = Number(this.store.getKv(`summary_elo:${b.index}`) ?? NaN)
      if (o.scheduled && elo !== null) this.store.setKv(`summary_elo:${b.index}`, String(elo))
      const playable = snap ? playableUsd(snap, b.settings.egldGasReserve) : null
      return {
        index: b.index,
        team: snap?.team?.name ?? snap?.registration.teamName ?? null,
        // Before its first snapshot after a start: what its last tick found.
        registered: snap ? snap.registration.registered : this.store.getKv(`waiting_funds:${b.index}`) !== '1',
        paused: b.paused,
        done: sum(c => action(c) && (c.status === 'confirmed' || c.status === 'dry_run')),
        refused: sum(c => action(c) && c.status === 'refused'),
        // An unconfirmed payment is confirmed later without a row of its own: not counted as failed.
        failed: sum(c => action(c) && (c.status === 'failed' || c.status === 'error')),
        plans: sum(c => c.kind === 'plan'),
        errors: sum(c => c.kind === 'tick' && c.status === 'error'),
        spentUsd: spent.get(b.index) ?? 0,
        elo,
        eloChange: elo !== null && Number.isFinite(prev) ? elo - prev : null,
        worthUsd: snap ? fundsUsd(snap) : null,
        low: playable !== null && lowOnFunds(playable, b.settings.topUpWarningUsd),
        topups: sum(c => c.kind === 'topup' && c.status === 'confirmed'),
      }
    })
    const label = o.soFar ? 'today so far' : new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(from.getTime() + 12 * 3600_000))
    return summaryText(label, days, { aiUsd: this.modelUsdByDay()[day] ?? null, live, killSwitch: this.store.killSwitch, waitingTopUps: this.topups.openCount() })
  }

  /** The morning summary of yesterday, once a day (a restart after the hour sends a missed one). */
  private sendDailySummary(): void {
    const today = zoneDate(Date.now(), this.summaryZone)
    if (this.store.getKv('summary_sent_day') === today || !this.telegram) return
    // Built before it is marked sent: a summary that fails to build comes at the next try, not never.
    const text = this.summary(dayBefore(today), { scheduled: true })
    this.telegram.send(text)
    this.store.setKv('summary_sent_day', today)
    console.log(`[${new Date().toISOString()}] daily summary of ${dayBefore(today)} sent`)
  }

  /**
   * The morning summary every day at its hour; a missed one (a start or a newly linked chat after the hour) two
   * minutes later, once the agents' first snapshots are in.
   */
  private armSummary(): void {
    clearTimeout(this.summaryTimer)
    if (!this.telegram || this.stopping) return
    if (Date.now() < zoneInstant(zoneDate(Date.now(), this.summaryZone), this.summaryHour, this.summaryZone)) return this.scheduleSummary()
    this.summaryTimer = setTimeout(() => {
      try {
        this.sendDailySummary()
      } catch (err) {
        console.error('daily summary failed:', err)
      }
      this.scheduleSummary()
    }, 120_000)
  }

  private scheduleSummary(): void {
    clearTimeout(this.summaryTimer)
    if (!this.telegram || this.stopping) return
    const at = nextSummaryAt(Date.now(), this.summaryHour, this.summaryZone)
    this.summaryTimer = setTimeout(() => {
      try {
        this.sendDailySummary()
      } catch (err) {
        console.error('daily summary failed:', err)
      }
      this.scheduleSummary()
    }, Math.max(1000, at - Date.now()))
  }

  /**
   * An agent with no team yet and too little to pay the registration: its plan could only say so, so it waits for
   * funds without an AI call (logged once, when it starts waiting).
   */
  private waitingForFunds(agent: AgentRow, snap: AgentSnapshot): string | null {
    const r = snap.registration
    const fee = snap.config?.registration_fee_foxsy
    // Only a fee known to be unpaid (null: the chain could not be read) and too little to pay it parks an agent.
    if (r.registered || r.feePaidOnChain !== false || !snap.prices || !fee) return null
    const feeAtomic = BigInt(snap.config?.registration_fee_wei ?? 0)
    if (snap.chain && feeAtomic > 0n && snap.chain.foxsy >= feeAtomic) return null
    const playable = playableUsd(snap, agent.settings.egldGasReserve)
    const needUsd = fee * snap.prices.foxsyUsd * 1.05
    if (playable === null || playable >= needUsd) return null
    return `${agentName(agent.index)} waits for funds: no team yet and about $${playable.toFixed(2)} to play with, the registration needs about $${needUsd.toFixed(2)} (${fee.toLocaleString('en-US')} FOXSY) besides the ${agent.settings.egldGasReserve} EGLD gas reserve. No AI call until EGLD arrives at ${agent.address}`
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
      // A chat linked after the start gets its morning summary too; no chat, no timer.
      this.armSummary()
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
      agentWallets: this.store.agents().map(b => ({ name: agentName(b.index), address: b.address })),
    })
  }

  /** Agents 1..AGENT_COUNT from the recovery words exist in the store (they follow the platform mode). */
  ensureAgents(): AgentRow[] {
    // A server reads its words from the env file systemd loads (AGENT_ENV_FILE points nowhere there).
    assertSameWords([...this.store.agents(), ...this.store.retiredAgents()], this.cfg.mnemonic!, this.cfg.isServer ? 'the env file' : envFilePath(), this.cfg.dataDir)
    const count = this.agentCount()
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
    const research = isZeus(this.store.agent(index)?.settings.strategy ?? '')
    const snap = await takeSnapshot({ chain: this.chain, fox: this.fox }, { wallet: this.wallet(index) }, new Date(), { research })
    this.noteTeams(index, snap)
    this.snapshots.set(index, snap)
    this.lastRefresh.set(index, Date.now())
    // Every fresh balance is checked, so a paused agent or one outside its active hours warns too.
    const agent = this.store.agent(index)
    if (agent) this.checkFunds(agent, snap)
    return snap
  }

  /**
   * What the snapshot alone cannot tell: how many matches each rival played in the last 3 days (from its record,
   * noted once a day), and this agent's own FoxLeague user id (so the code keeps its own teams out of a private
   * tournament's invites; the AI is never told which teams are the owner's).
   */
  private noteTeams(index: number, snap: AgentSnapshot): void {
    if (snap.profile?.id) this.store.setKv(`agent_user_id:${index}`, String(snap.profile.id))
    const day = new Date().toISOString().slice(0, 10)
    let hist: Record<string, [string, number][]> = {}
    try {
      hist = JSON.parse(this.store.getKv('rival_matches') ?? '{}') as Record<string, [string, number][]>
    } catch {
      hist = {}
    }
    for (const u of snap.leaderboardNeighbours) {
      if (typeof u.matches !== 'number') continue
      const rows = (hist[u.id] ?? []).filter(([d]) => d !== day)
      rows.push([day, u.matches])
      hist[u.id] = rows.slice(-8)
      // Against the row nearest 3 days back, within 2 to 4 days: "N matches in D days", or nothing when none fits.
      const daysBack = (d: string) => Math.round((Date.parse(day) - Date.parse(d)) / 86_400_000)
      const base = rows.filter(([d]) => daysBack(d) >= 2 && daysBack(d) <= 4).sort((x, y) => Math.abs(daysBack(x[0]) - 3) - Math.abs(daysBack(y[0]) - 3))[0]
      u.played = base ? { matches: Math.max(0, u.matches - base[1]), days: daysBack(base[0]) } : null
    }
    // A record of the teams noted in the last 8 days only.
    const cutoff = new Date(Date.now() - 8 * 86_400_000).toISOString().slice(0, 10)
    for (const k of Object.keys(hist)) if (!(hist[k] ?? []).some(([d]) => d >= cutoff)) delete hist[k]
    this.store.setKv('rival_matches', JSON.stringify(hist))
  }

  private async noteOwnUserIds(): Promise<void> {
    for (const b of [...this.store.agents(), ...this.store.retiredAgents()]) {
      if (this.store.getKv(`agent_user_id:${b.index}`)) continue
      const id = (await this.fox.user(b.address).catch(() => null))?.id
      if (id) this.store.setKv(`agent_user_id:${b.index}`, String(id))
    }
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

  /** AGENT_COUNT: the agents 1..N that exist at every start (at least one, within AGENT_MAX_AGENTS). */
  agentCount(): number {
    return Math.min(this.cfg.maxAgents, Math.max(1, Number(process.env.AGENT_COUNT ?? 1)))
  }

  /**
   * The number the next agent from the recovery words takes: the lowest free one, so the wallet of a deleted agent
   * comes back first (never a number an imported team holds or held).
   */
  nextIndex(): number {
    return this.store.freeIndex()
  }

  /**
   * Delete: for an agent whose wallet was never used (no transaction, nothing in it, no FoxLeague team, nothing ever
   * signed), checked again now from the chain and FoxLeague. Its row, history and stored values go and, on a local
   * install, its PEM file; on a server deploy/sync-pems.sh removes the file on the owner's computer. + Add agent
   * makes the same wallet again. Anything used is refused: retire it instead.
   */
  async deleteAgent(index: number, who: string): Promise<string> {
    if (this.stopping) throw new Error('the service is stopping; try again after the restart')
    const busy = () => this.busy.has(index) || !this.executor.idleFor(index)
    if (busy()) throw new Error(`${agentName(index)} is busy; try again in a minute`)
    const agent = await neverUsedOrWhy({ store: this.store, chain: this.chain, fox: this.fox, topups: this.topups, agentCount: this.agentCount() }, index)
    // No await from here to the delete: a plan that started while the wallet was read wins.
    if (busy()) throw new Error(`${agentName(index)} is busy; try again in a minute`)
    clearTimeout(this.timers.get(index))
    this.timers.delete(index)
    this.nextAt.delete(index)
    this.snapshots.delete(index)
    this.lastRefresh.delete(index)
    this.wallets.delete(index)
    this.store.deleteAgent(index, who)
    const pem = this.deleteLocalPem(index, agent.address)
    this.store.log({ agentIndex: null, kind: 'control', status: 'info', summary: `${agentName(index)} (${agent.address}) deleted by ${who}: its wallet was never used.${pem}` })
    this.notify(`${agentName(index)} deleted by ${who} (${agent.address}): its wallet was never used.${pem} + Add agent makes the same wallet again.`)
    return `${agentName(index)} deleted.${pem}`
  }

  /** A local install's PEM file of a deleted agent goes too, once its first line names that wallet. */
  private deleteLocalPem(index: number, address: string): string {
    if (this.cfg.isServer) return ' Run ./deploy/sync-pems.sh on your computer to remove its PEM file there.'
    const dir = process.env.AGENT_PEM_DIR?.trim()
    const done = dir ? removePemFile(dir, index, address) : 'none'
    return done === 'deleted' ? ` Its PEM file ${pemName(index)} was deleted.` : done === 'kept' ? ` ${pemName(index)} was kept: it is not this wallet's file.` : ''
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
    const same = [...this.store.agents(), ...this.store.retiredAgents()].find(b => b.address === address)
    if (same) throw new Error(`this wallet is already ${agentName(same.index)}${same.retired ? ' (retired: restore it instead)' : ''}`)
    // One of the install's own accounts (now or the next ones Add agent would take) is added with Add agent.
    for (let i = 0; i <= this.store.maxIndex() + this.cfg.maxAgents; i++) {
      if (!this.store.importedAt(i) && deriveWallet(this.cfg.mnemonic!, i).address === address) throw new Error("this wallet comes from this install's own recovery words: use + Add agent instead")
    }
    // The team's overall is answered to the team's own session only: the key just given signs that login.
    // The public profile first: a wallet without a team is refused before any login, so none is created for it.
    const profile = await this.fox.user(address)
    const team = profile?.team_name ? await this.fox.team(address, walletFromSecretKey(key, this.store.maxIndex() + 1)) : null
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
    // Retired agents too: their key file must never be overwritten or deleted by an import.
    const same = [...this.store.agents(), ...this.store.retiredAgents()].find(b => b.address === p.address)
    if (same) throw new Error(`this wallet is already ${agentName(same.index)}${same.retired ? ' (retired: restore it instead)' : ''}`)
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

  /**
   * Retire: parks an agent the owner no longer uses. It is paused at once (a plan under way stops before its
   * next step) and leaves the active agents: no plans, no snapshots, no warnings, no place in the agent limit.
   * Nothing is sold or moved. Refused, the agent left paused, while an action it started is still finishing or
   * a payment waits for FoxLeague's confirmation (only the agent's own ticks confirm one).
   */
  async retireAgent(index: number, who: string): Promise<string> {
    const agent = this.store.agent(index)
    if (!agent || agent.retired) throw new Error(`no active ${agentName(index)}`)
    // Paused before anything is awaited, so nothing new is signed while the wallet is read.
    if (!agent.paused) {
      this.store.setPaused(index, true)
      this.store.log({ agentIndex: index, kind: 'control', status: 'info', summary: `paused by ${who} to retire it` })
    }
    // What the wallet holds now, for the Retired list: a fresh read without the low-funds check.
    const snap = await takeSnapshot({ chain: this.chain, fox: this.fox }, { wallet: this.wallet(index) }).catch(() => this.snapshots.get(index))
    if (snap?.profile?.id) this.store.setKv(`agent_user_id:${index}`, String(snap.profile.id))
    // Checked after the read, with no wait before the retire itself: an action that was already signing has finished.
    if (!this.executor.idleFor(index)) throw new Error(`${agentName(index)} is paused; an action it started is still finishing: retire it in a minute`)
    if (this.store.pending(index).length) throw new Error(`${agentName(index)} is paused, but a payment waits for FoxLeague's confirmation: resume it until the payment is confirmed, then retire it`)
    const usd = fundsUsd(snap)
    this.store.retireAgent(index, {
      at: new Date().toISOString(),
      by: who,
      team: snap?.team?.name ?? snap?.registration.teamName ?? null,
      egld: snap?.chain ? formatAtomic(snap.chain.egld, 4) : null,
      foxsy: snap?.chain ? formatAtomic(snap.chain.foxsy, 0) : null,
      usd: usd === null ? null : Math.round(usd * 100) / 100,
    })
    clearTimeout(this.timers.get(index))
    this.timers.delete(index)
    this.snapshots.delete(index)
    this.lastRefresh.delete(index)
    this.store.log({ agentIndex: index, kind: 'control', status: 'info', summary: `retired by ${who}: paused and out of the active agents; restore it from Retired` })
    this.notify(`${agentName(index)} retired by ${who} (${agent.address}): paused and out of the list. Its wallet keeps its funds; restore it in the dashboard, Retired.`)
    return `${agentName(index)} retired: it is in Retired, ready to restore`
  }

  /**
   * After a settings save: a shorter cycle brings the next plan forward, to at most one new cycle from now. A plan
   * still running is left alone: when it ends, the next one is set from the saved settings anyway.
   */
  settingsSaved(index: number): void {
    const row = this.store.agent(index)
    const at = this.nextAt.get(index)
    if (!row || row.retired || at === undefined || this.busy.has(index)) return
    const cycle = Math.max(MIN_TICK_MINUTES, row.settings.tickMinutes) * 60_000
    if (at - Date.now() > cycle) this.schedule(index, cycle)
  }

  /** Restore: a retired agent rejoins the active agents, paused, within the agent limit. */
  restoreAgent(index: number, who: string): string {
    const agent = this.store.agent(index)
    if (!agent?.retired) throw new Error(`${agentName(index)} is not retired`)
    if (this.stopping) throw new Error('the service is stopping; try again after the restart')
    if (this.store.agents().length >= this.cfg.maxAgents) throw new Error(`this install allows ${this.cfg.maxAgents} active agents (AGENT_MAX_AGENTS): retire another one first`)
    this.store.restoreAgent(index)
    this.store.log({ agentIndex: index, kind: 'control', status: 'info', summary: `restored by ${who}; paused until resumed` })
    this.notify(`${agentName(index)} restored by ${who} (${agent.address}). It is paused: check its limits and strategy, then resume it.`)
    this.schedule(index, 20_000)
    void this.snapshot(index).catch(() => undefined)
    return `${agentName(index)} restored, paused: press Resume when it should play again`
  }

  async start(): Promise<void> {
    writeFileSync(join(this.cfg.dataDir, SERVICE_PID_FILE), String(process.pid), { mode: 0o600 })
    const agents = this.ensureAgents()
    const local = await loadExtensions().catch(err => [`local extension failed to load: ${err instanceof Error ? err.message : String(err)}`])
    if (local.length) console.log(`local: ${local.join(', ')}`)
    this.notify(
      (local.length ? `local: ${local.join(', ')}\n` : '') +
      `foxleague-agent ${VERSION} started: ${agents.length} agent(s), strategist ${this.strategist ? `${this.strategist.model} (${this.strategist.effort})` : 'OFF (no ANTHROPIC_API_KEY)'}, mode ${this.modeText()}${this.store.killSwitch ? ', KILL SWITCH ON' : ''}\n` +
        agents.map(b => `${agentName(b.index)} ${b.address}${b.paused ? ' paused' : ''}`).join('\n') +
        retiredLine(this.store.retiredAgents()),
    )
    this.startTelegram()
    this.armSummary()
    // Each agent's FoxLeague user id, for one that was never noted (retired or added before this version): a Zeus
    // private tournament never invites the owner's own teams.
    void this.noteOwnUserIds().catch(() => undefined)
    // A top-up whose outcome was not known when the last run ended (a restart while it was sent): ask Binance.
    if (this.telegram) void this.topups.settleUnclear().then(lines => { if (lines.length) this.telegram?.send(lines.join('\n')) }).catch(() => undefined)
    const creds = credentialsFromEnv()
    // 127.0.0.1 unless WEB_UI_HOST says otherwise: a container that publishes the port on the host's loopback only
    // binds 0.0.0.0 inside its own network namespace.
    if (creds) startWeb(this, creds, Number(process.env.WEB_UI_PORT ?? 8870), process.env.WEB_UI_HOST?.trim() || '127.0.0.1')
    else console.log('web UI off: set it up with `agentctl.sh set-web-password`')
    for (const b of agents) {
      this.schedule(b.index, 5_000 + Math.random() * 20_000)
      void this.snapshot(b.index).catch(() => undefined)
    }
  }

  private schedule(index: number, delayMs: number): void {
    clearTimeout(this.timers.get(index))
    if (this.stopping) return
    this.nextAt.set(index, Date.now() + delayMs)
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
    clearTimeout(this.summaryTimer)
    this.telegram?.stop()
    const until = Date.now() + 150_000
    // Plans (busy), single actions from Telegram /do or the web (the executor's per-agent locks) and a top-up
    // being sent to Binance, so its outcome is stored before the process ends.
    while ((this.busy.size || !this.executor.idle || !this.topups.idle) && Date.now() < until) await sleep(500)
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
    const row = this.store.agent(index)
    if (!row || row.retired) return
    const s = row.settings
    const jitter = (Math.random() * 2 - 1) * s.tickJitterMinutes
    let delay = Math.max(MIN_TICK_MINUTES, s.tickMinutes + jitter) * 60_000
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
      .filter(t => t > now + MIN_TICK_MINUTES * 60_000)[0]
    if (prep !== undefined && prep - now < delay) delay = prep - now
    this.schedule(index, delay)
  }

  private inActiveHours(agent: AgentRow, now = new Date()): boolean {
    const [from, to] = agent.settings.activeHoursUtc
    const h = now.getUTCHours()
    return from <= to ? h >= from && h < to : h >= from || h < to
  }

  /** One tick: snapshot, plan, run the actions spread over the window. */
  async tick(index: number, ownerRequest?: string, o: { loud?: boolean } = {}): Promise<string> {
    if (o.loud) {
      this.loud.add(index)
      try {
        return await this.tick(index, ownerRequest)
      } finally {
        this.loud.delete(index)
      }
    }
    const agent = this.store.agent(index)
    if (!agent) return `no ${agentName(index)}`
    if (this.stopping) return 'stopping'
    if (this.store.killSwitch) return 'kill switch is on'
    if (agent.retired) return `${agentName(index)} is retired`
    if (agent.paused) return `${agentName(index)} is paused`
    if (!ownerRequest && !this.inActiveHours(agent)) return `${agentName(index)}: outside active hours`
    if (this.busy.has(index)) return `${agentName(index)} is still running its previous plan`
    this.busy.add(index)
    try {
      await this.retryPending(agent)
      const n = await creditRefunds({ store: this.store, chain: this.chain, fox: this.fox, wallet: this.wallet(index) }, agent, agent.dryRun || !this.executor.liveEnabled).catch(() => 0)
      if (n) this.store.log({ agentIndex: index, kind: 'tick', status: 'info', summary: n === 1 ? '1 refunded bid or seat no longer counts against the budget' : `${n} refunded bids or seats no longer count against the budget` })
      const snap = await this.snapshot(index)
      // Onboarding: the free team badge, once (plain code, never paid for; a failure never stops the tick).
      await ensureBadge({ store: this.store, fox: this.fox, notify: t => this.report(t) }, index, this.wallet(index), snap.team, agent.dryRun || !this.executor.liveEnabled).catch(() => undefined)
      const waiting = this.waitingForFunds(agent, snap)
      if (waiting) {
        if (this.store.getKv(`waiting_funds:${index}`) !== '1') this.store.log({ agentIndex: index, kind: 'tick', status: 'info', summary: waiting })
        this.store.setKv(`waiting_funds:${index}`, '1')
        return waiting
      }
      this.store.setKv(`waiting_funds:${index}`, '0')
      if (!this.strategist) {
        this.store.log({ agentIndex: index, kind: 'tick', status: 'info', summary: 'snapshot taken; no strategist (ANTHROPIC_API_KEY not set)', detail: { warnings: snap.warnings } })
        return 'snapshot only (no strategist key)'
      }
      const plan = await this.makePlan(agent, snap, ownerRequest)
      this.failStreak.delete(index)
      await this.runPlan(agent, plan.actions, !ownerRequest)
      return plan.summary
    } catch (err) {
      const msg = describeModelError(err)
      this.store.log({ agentIndex: index, kind: 'tick', status: 'error', summary: msg })
      this.tickFailed(index, err, msg)
      return msg
    } finally {
      this.busy.delete(index)
    }
  }

  /**
   * What the AI cost per UTC day (plans, the manager chat and /ask), the last 14 days. The first time it is
   * rebuilt from the plans in the activity log; the chat was only counted in the total before.
   */
  modelUsdByDay(): Record<string, number> {
    const saved = this.store.getKv('model_usd_days')
    if (saved) {
      try {
        return JSON.parse(saved) as Record<string, number>
      } catch {
        // rebuilt below
      }
    }
    const days: Record<string, number> = {}
    for (const r of this.store.plansSince(new Date(Date.now() - 14 * 86_400_000))) {
      try {
        const usd = (JSON.parse(r.detail ?? '{}') as { plan?: { usage?: { usd?: number } } }).plan?.usage?.usd
        if (typeof usd === 'number' && Number.isFinite(usd)) days[r.at.slice(0, 10)] = (days[r.at.slice(0, 10)] ?? 0) + usd
      } catch {
        // an unreadable row counts nothing
      }
    }
    this.store.setKv('model_usd_days', JSON.stringify(days))
    return days
  }

  private addModelUsd(usd: number, now = new Date()): void {
    this.store.setKv('model_usd_total', String(Number(this.store.getKv('model_usd_total') ?? 0) + usd))
    const days = this.modelUsdByDay()
    const day = now.toISOString().slice(0, 10)
    days[day] = (days[day] ?? 0) + usd
    const kept = Object.keys(days).sort().slice(-14)
    this.store.setKv('model_usd_days', JSON.stringify(Object.fromEntries(kept.map(d => [d, days[d]]))))
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
    // Counted before the plan is logged: a first count per day rebuilds from the logged plans, never twice.
    this.addModelUsd(plan.usage.usd)
    this.store.log({ agentIndex: agent.index, kind: 'plan', status: 'info', summary: text.slice(0, 2000), detail: { plan, stop: plan.stopReason } })
    this.store.setKv(`last_plan_${agent.index}`, text)
    if (ownerRequest || this.loud.has(agent.index)) this.notify(text)
    else this.report(text)
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
    // A plan whose window the next lock cuts prepares a match: it runs unsplit, so nothing is pushed past the lock.
    const beforeLock = nextLock !== undefined && nextLock - Date.now() - LOCK_MARGIN_MS < windowMs
    if (nextLock !== undefined) windowMs = Math.max(0, Math.min(windowMs, nextLock - Date.now() - LOCK_MARGIN_MS))
    const gapMs = agent.settings.minGapSeconds * 1000
    const offsets = actions.map(() => Math.random() * windowMs).sort((a, b) => a - b)
    // Pieces an extension cuts from an action (see src/extensions.ts) queue right behind it, at the usual gap.
    const queue = actions.map((p, i) => ({ p, offset: offsets[i]! }))
    let last = -gapMs
    const start = Date.now()
    // The mode the plan was made in: a switch between dry run and live mid-plan ends the plan.
    const plannedDry = agent.dryRun
    while (queue.length) {
      const { offset } = queue[0]!
      let planned = queue.shift()!.p
      const at = Math.max(offset, last + gapMs)
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
      if (routine && !planned.piece && Math.random() > current.settings.actionProbability) {
        this.store.log({ agentIndex: agent.index, kind: planned.action.type, status: 'info', summary: `skipped by the action probability: ${describeAction(planned.action)}` })
        continue
      }
      const snap = await this.snapshot(agent.index)
      if (!planned.piece && extensions.splitAction && !beforeLock) {
        const pieces = extensions.splitAction(planned, snap, current.settings)
        if (pieces && pieces.length > 1) {
          queue.unshift(...pieces.slice(1).map(p => ({ p, offset: 0 })))
          planned = pieces[0]!
        }
      }
      const [result] = await this.executor.run(current, this.wallet(agent.index), snap, [planned])
      // A piece that did not go through: the rest of its group would only repeat the refusal.
      if (planned.piece && result && result.status !== 'confirmed' && result.status !== 'dry_run') {
        const group = planned.piece.group
        const before = queue.length
        for (let j = queue.length - 1; j >= 0; j--) if (queue[j]!.p.piece?.group === group) queue.splice(j, 1)
        const dropped = before - queue.length
        if (dropped) this.store.log({ agentIndex: agent.index, kind: planned.action.type, status: 'info', summary: `${dropped} more piece${dropped > 1 ? 's' : ''} of ${describeAction(planned.action)} dropped after piece ${planned.piece.index} of ${planned.piece.of}: ${result.status}` })
      }
    }
  }

  /** Payments sent but not confirmed with FoxLeague yet: confirmed again with the same hash, never paid twice. */
  private async retryPending(agent: AgentRow): Promise<void> {
    await retryPendingPayments({ store: this.store, fox: this.fox, notify: t => this.report(t), alert: t => this.notify(t) }, agent.index, this.wallet(agent.index))
  }

  // ---- Telegram commands ----

  private agentsArg(arg: string | undefined): number[] {
    if (!arg || arg === 'all') return this.store.agents().map(b => b.index)
    const n = numberToIndex(arg)
    if (n === undefined || !this.store.agent(n)) throw new Error(`no agent ${arg} (agents are numbered from 1)`)
    if (this.store.agent(n)!.retired) throw new Error(`${agentName(n)} is retired: restore it in the dashboard first`)
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
          '/strategy [N|all]  show the strategy; /strategy N|all steady|climber|hunter|predator|beast|zeus|<text>  replace it directly',
          '(any plain message)  talk to the manager: advice becomes a strategy proposal with Apply',
          '/clear  start a new conversation: the manager forgets the current one (it also does after an hour without a message)',
          '/kill on|off  pause every agent at once',
          '/log [N]  recent activity',
          '/keys [test]  which keys are set (masked); test checks them. Change keys in the web UI only',
          '/summary [today]  yesterday per agent (or today so far); it also comes by itself every morning',
          '/updates [daily|all]  daily: plans and action results wait for the morning summary; all: every update as it happens',
          '/topup [N | code [EGLD]]  EGLD from Binance: /topup N proposes a top-up for agent N, /topup <code> approves it (optionally fewer EGLD); alone, what waits',
        ].join('\n')
      case 'status': {
        const agents = this.store.agents()
        return [
          `mode ${this.modeText()}; kill switch ${this.store.killSwitch ? 'ON' : 'off'}; strategist ${this.strategist ? `${this.strategist.model} (${this.strategist.effort})` : 'off'}; model spend $${Number(this.store.getKv('model_usd_total') ?? 0).toFixed(2)}`,
          ...agents.map(b => `${agentName(b.index)}${b.paused ? ' PAUSED' : ''} ${b.address}`),
        ].join('\n') + retiredLine(this.store.retiredAgents())
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
            ...(worth === null ? [] : [`wallet worth about $${worth.toFixed(2)}${lowOnFunds(playableUsd(snap, b.settings.egldGasReserve), b.settings.topUpWarningUsd) ? ` (LOW: under the $${b.settings.topUpWarningUsd} top-up warning, gas reserve aside)` : ''}`]),
          )
        }
        return lines.join('\n')
      }
      case 'plan':
        return this.agentsArg(args[0]).map(i => this.store.getKv(`last_plan_${i}`) ?? `${agentName(i)}: no plan yet`).join('\n\n')
      case 'tick': {
        const [i] = this.agentsArg(args[0])
        void this.tick(i!, undefined, { loud: true })
        return `${agentName(i!)}: tick started; its plan and results follow here`
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
        const active = this.store.agents()
        if (!active.length) return 'every agent is retired: restore one in the dashboard first'
        // A number that names an agent picks it (a retired one is refused); otherwise the first active agent.
        const index = first !== undefined && this.store.agent(first) ? this.agentsArg(args[0])[0]! : active[0]!.index
        const question = first !== undefined ? raw.slice(args[0]!.length).trim() : raw
        if (!question) return 'usage: /ask [N] question'
        const snap = await takeSnapshot({ chain: this.chain, fox: this.fox }, { wallet: this.wallet(index) })
        const { answer, usd } = await this.strategist.ask(snap, question)
        this.addModelUsd(usd)
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
          // The answer is the result itself, in every Telegram mode: an owner who hears nothing might ask twice.
          const [r] = await this.executor.run(this.store.agent(i!)!, this.wallet(i!), snap, [planned])
          return r ? formatResult(i!, r) : 'nothing ran'
        }
        void this.tick(i!, request, { loud: true })
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
      case 'summary': {
        const today = zoneDate(Date.now(), this.summaryZone)
        return args[0] === 'today' ? this.summary(today, { soFar: true }) : this.summary(dayBefore(today))
      }
      case 'updates': {
        const to = args[0]?.toLowerCase()
        if (to !== 'daily' && to !== 'all') return `Telegram updates: ${this.updatesMode()} (${this.updatesMode() === 'daily' ? `plans and action results wait for the summary at ${String(this.summaryHour).padStart(2, '0')}:00 ${this.summaryZone}` : 'every update as it happens'}). Change with /updates daily or /updates all.`
        this.store.setKv('telegram_updates', to)
        this.store.log({ agentIndex: null, kind: 'control', status: 'info', summary: `Telegram updates set to ${to} (Telegram)` })
        return to === 'daily' ? `Done: plans and action results now wait for the summary at ${String(this.summaryHour).padStart(2, '0')}:00 ${this.summaryZone}. Urgent messages and top-up codes still come at once.` : 'Done: every plan and action result comes as it happens.'
      }
      case 'topup': {
        const [first, amount] = args
        if (!first) return this.topups.listText()
        if (/^\d{6}$/.test(first)) return this.topups.approve(first, amount)
        if (first === 'all') return 'one agent at a time: /topup N, then /topup <code> to approve'
        const [i] = this.agentsArg(first)
        const row = this.store.agent(i!)!
        // Read without the low-funds check: that check may offer a top-up of its own, and two codes would go out.
        const snap = await takeSnapshot({ chain: this.chain, fox: this.fox }, { wallet: this.wallet(i!) })
        const playable = playableUsd(snap, row.settings.egldGasReserve)
        if (playable === null) return `${agentName(i!)}'s wallet could not be read right now; try again in a minute`
        return this.topups.offer(row, playable, snap.prices?.egldUsd ?? 0, 'owner')
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

/** One line naming the retired agents for /status and the start message (empty without any). */
function retiredLine(retired: AgentRow[]): string {
  return retired.length ? `\n${retired.length} retired (${whichAgents(retired.map(b => b.index))}): restore them in the dashboard, Retired` : ''
}

if (import.meta.main) {
  const service = new Service(loadConfig())
  service.start().catch(err => {
    // Changed recovery words: what to do, without a stack trace around it.
    console.error(err instanceof ChangedWordsError ? err.message : err)
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

