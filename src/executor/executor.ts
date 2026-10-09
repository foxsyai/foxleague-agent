// The executor: the only code that builds, signs and sends. For each proposed action it checks
// the kill switch, the game rules, the per-action limits and the USD caps, builds the exact
// transaction the web app would, and then either simulates it (dry run: "would do X, cost Y") or
// signs, sends, waits for the real outcome and confirms with the backend (live).
//
// Live needs BOTH the platform in live mode (one switch for all agents) AND AGENT_LIVE_ENABLED=1 in the environment.

import { randomUUID } from 'node:crypto'
import { Address } from '@multiversx/sdk-core'
import { MAINNET, type Config } from '../config.ts'
import type { Chain, TxOutcome } from '../chain/gateway.ts'
import { quoteEgldForFoxsy } from '../chain/xexchange.ts'
import { ApiRefusal, rivalStrength, type FoxLeague } from '../foxleague/api.ts'
import type { TournamentDetail } from '../foxleague/types.ts'
import type { AgentSnapshot } from '../snapshot/snapshot.ts'
import type { AgentRow, Store } from '../store/db.ts'
import { atomicToFloat, b64ToBigInt, decimalToAtomic, formatAtomic, u64Hex } from '../util/encoding.ts'
import { sleep } from '../util/http.ts'
import { agentName } from '../names.ts'
import type { AgentWallet } from '../wallet/wallet.ts'
import { describeAction, type Action, type PlannedAction } from './actions.ts'
import { budgetView, capRefusal, costUsd, gameDayKey, type Prices } from './budget.ts'
import { checkAction, type RulesContext, type Verdict } from './rules.ts'
import {
  buildTransaction,
  claimRefundTx,
  joinTournamentTx,
  maxFeeAtomic,
  registerAndPayTx,
  shardOfPubkeyLastByte,
  shopPayTx,
  swapEgldTx,
  swapWegldTx,
  syncTx,
  toPlain,
  fusionTx,
  auctionBidTx,
  auctionListTx,
  auctionCancelTx,
  fusionWaiverTx,
  type TxSpec,
} from './tx.ts'
import { fusionCooldownQuote, fusionPoolCount, getAuction, RARITY_LEVEL } from '../chain/players.ts'

export type ResultStatus = 'dry_run' | 'refused' | 'confirmed' | 'failed' | 'unconfirmed' | 'error'

export interface ExecutionResult {
  action: Action
  reason: string
  status: ResultStatus
  summary: string
  costUsd: number
  txHash?: string
  /** A payment was signed and handed to the network or the relay: with an error, its outcome is unclear. */
  sent?: boolean
}

export interface ExecutorDeps {
  cfg: Config
  chain: Chain
  fox: FoxLeague
  store: Store
  /** Every action's result as text; the result too, so a payment with an unclear outcome can be said at once. */
  notify?: (agentIndex: number, text: string, result?: ExecutionResult) => void
}

interface Built {
  txs: TxSpec[]
  /** EGLD (atomic) the transactions move as value (the swap). */
  egldValue: bigint
  /** WEGLD (atomic) a swap pays from the wallet's own WEGLD, at most. */
  wegldValue?: bigint
  /** Extra USD counted as spend beyond FOXSY and fees (the swap's pool fee). */
  extraUsd: number
  /** USD value of the EGLD or WEGLD a swap sends away, counted against the daily swap allowance. */
  swapUsd?: number
  notes: string[]
}

/** A live payment booked before it is signed: its spend rows, and whether it may have left the wallet. */
interface Booking {
  ids: number[]
  sent: boolean
}

/** The server's permission to sign at all: AGENT_LIVE_ENABLED=1 in its env. */
export function liveSigningAllowed(): boolean {
  const v = process.env.AGENT_LIVE_ENABLED?.trim().toLowerCase()
  return v === '1' || v === 'true'
}

export class Executor {
  private readonly d: ExecutorDeps
  /** One action at a time per agent, whatever started it (a plan, Telegram /do, the web UI). */
  private readonly locks = new Map<number, Promise<void>>()

  constructor(deps: ExecutorDeps) {
    this.d = deps
  }

  get liveEnabled(): boolean {
    return liveSigningAllowed()
  }

  /** No action running or queued for any agent (a graceful stop waits for this, whatever started the action). */
  get idle(): boolean {
    return this.locks.size === 0
  }

  /** No action running or queued for this agent. */
  idleFor(index: number): boolean {
    return !this.locks.has(index)
  }

  /** Runs a plan in order; each action sees the local effect of the ones before it. */
  async run(agent: AgentRow, wallet: AgentWallet, snapshot: AgentSnapshot, plan: PlannedAction[]): Promise<ExecutionResult[]> {
    const snap = structuredClone(snapshot)
    const results: ExecutionResult[] = []
    for (const p of plan) {
      const r = await this.runOne(agent, wallet, snap, p)
      results.push(r)
      if (r.action.type === 'register' && r.status !== 'refused') break // the squad is unknown until it lands
    }
    return results
  }

  /** Serialized per agent, so the cap check and the booking of one action never interleave with another's. */
  async runOne(agent: AgentRow, wallet: AgentWallet, snap: AgentSnapshot, planned: PlannedAction): Promise<ExecutionResult> {
    const before = this.locks.get(agent.index) ?? Promise.resolve()
    let release!: () => void
    const mine = new Promise<void>(r => (release = r))
    const tail = before.then(() => mine)
    this.locks.set(agent.index, tail)
    await before
    try {
      return await this.runOneLocked(agent, wallet, snap, planned)
    } finally {
      release()
      if (this.locks.get(agent.index) === tail) this.locks.delete(agent.index)
    }
  }

  private async runOneLocked(queued: AgentRow, wallet: AgentWallet, snap: AgentSnapshot, planned: PlannedAction): Promise<ExecutionResult> {
    const { store } = this.d
    const a = planned.action
    const desc = describeAction(a)
    // The row as it is now, after the lock: an action that waited behind another one uses the caps
    // the owner has set since, and stops if the mode changed while it waited.
    const fresh = store.agent(queued.index)
    const agent = fresh ?? queued
    const dry = agent.dryRun || !this.liveEnabled
    const logExtra: Record<string, unknown> = {}
    let booking: Booking | null = null
    const finish = (status: ResultStatus, summary: string, costUsdValue = 0, txHash?: string, detail?: unknown): ExecutionResult => {
      store.log({ agentIndex: agent.index, kind: a.type, status, summary, detail: { action: a, reason: planned.reason, ...logExtra, ...((detail as object) ?? {}) }, costUsd: costUsdValue || null, txHash })
      const result: ExecutionResult = { action: a, reason: planned.reason, status, summary, costUsd: costUsdValue, ...(txHash ? { txHash } : {}), ...(booking?.sent ? { sent: true } : {}) }
      // A piece that went through stays in the activity log; Telegram hears the last one of its group, and any failure.
      const quietPiece = planned.piece && planned.piece.index < planned.piece.of && (status === 'confirmed' || status === 'dry_run')
      if (!quietPiece) this.d.notify?.(agent.index, formatResult(agent.index, result), result)
      return result
    }

    try {
      if (store.killSwitch) return finish('refused', `${desc}: kill switch is on`)
      // Pause stops the agent's own actions; the owner may still take a seat or stake back (the kill switch stops everything).
      const ownerLeave = a.type === 'leave_tournament' && planned.byOwner === true
      if (!fresh || (fresh.paused && !ownerLeave)) return finish('refused', `${desc}: the agent is paused`)
      if (fresh.dryRun !== queued.dryRun) return finish('refused', `${desc}: the mode changed to ${fresh.dryRun ? 'dry run' : 'live'} while this action waited; the next plan starts fresh`)
      if (wallet.address !== agent.address) return finish('refused', `${desc}: wallet does not match ${agentName(agent.index)}`)

      const now = new Date()
      const ctx = await this.context(agent, wallet, snap, a, now, dry)
      if (planned.piece) ctx.piece = { index: planned.piece.index, of: planned.piece.of }
      if (ctx.opponent) logExtra.opponentUserId = ctx.opponent.userId
      const verdict = checkAction(a, snap, ctx)
      if (!verdict.ok) return finish('refused', `${desc}: ${verdict.refusal}`)
      // FoxLeague is asked about the name before the fee is paid: a taken name costs nothing.
      if (a.type === 'register') {
        const taken = await this.nameRefusal(wallet, a.team_name)
        if (taken) return finish('refused', `${desc}: ${taken}`)
      }

      const prices = this.valuationPrices(snap.prices)
      const built = await this.build(a, verdict, snap, wallet, prices)
      // A created tournament or 1v1 pays its seat after the create call: its gas is counted now.
      const seat = a.type === 'create_tournament' || a.type === 'create_challenge' ? [joinTournamentTx(1, verdict.foxsy)] : []
      const fees = [...built.txs, ...seat].reduce((s, t) => s + maxFeeAtomic(t), 0n)
      const moneyMoves = verdict.foxsy > 0n || built.txs.length > 0 || seat.length > 0
      if (moneyMoves && !prices) return finish('refused', `${desc}: prices unavailable, refusing to spend without a USD value`)
      const usd = prices ? costUsd(verdict.foxsy, fees, prices) + built.extraUsd : 0

      const view = budgetView(store, agent.index, agent.settings, dry, now, snap.gameDay.resetHourUtc)
      const cap = capRefusal(view, verdict.category, usd)
      if (cap) return finish('refused', `${desc}: ${cap}`)
      if (built.swapUsd) {
        // EGLD swapped away per game day is bounded like spending: the daily cap (the setup budget before registration).
        const swapped = store.spentUsd(agent.index, { gameDay: view.gameDay, category: 'swap', dryRun: dry })
        const allowance = snap.registration.registered ? agent.settings.dailyCapUsd : Math.max(agent.settings.dailyCapUsd, agent.settings.setupBudgetUsd)
        if (swapped + built.swapUsd > allowance + 1e-9) return finish('refused', `${desc}: daily swap allowance: $${(swapped + built.swapUsd).toFixed(2)} needed, $${swapped.toFixed(2)} of $${allowance.toFixed(2)} already swapped today`)
        // And per calendar month by the monthly budget (the owner's choice after review finding MM8).
        const swappedMonth = store.spentUsd(agent.index, { month: view.month, category: 'swap', dryRun: dry })
        const monthAllowance = snap.registration.registered ? agent.settings.monthlyBudgetUsd : Math.max(agent.settings.monthlyBudgetUsd, agent.settings.setupBudgetUsd)
        if (swappedMonth + built.swapUsd > monthAllowance + 1e-9) return finish('refused', `${desc}: monthly swap allowance: $${(swappedMonth + built.swapUsd).toFixed(2)} needed, $${swappedMonth.toFixed(2)} of $${monthAllowance.toFixed(2)} already swapped this month`)
      }

      if (built.txs.length || seat.length) {
        // The reserve is kept for gas: EGLD sent away (a swap) must leave it in the wallet, fees may draw on it.
        const reserve = decimalToAtomic(agent.settings.egldGasReserve)
        const egld = snap.chain?.egld ?? 0n
        if (built.egldValue > 0n && egld < fees + built.egldValue + reserve) {
          return finish('refused', `${desc}: needs ${formatAtomic(fees + built.egldValue + reserve, 4)} EGLD (fees + value + ${agent.settings.egldGasReserve} gas reserve), wallet has ${formatAtomic(egld, 4)}`)
        }
        if (egld < fees) return finish('refused', `${desc}: needs ${formatAtomic(fees, 4)} EGLD for gas, wallet has ${formatAtomic(egld, 4)}`)
      }

      const costText = `cost ~$${usd.toFixed(2)}${verdict.foxsy > 0n ? ` (${formatAtomic(verdict.foxsy, 0)} FOXSY + fees)` : ''}`
      const notes = [...verdict.notes, ...built.notes]

      if (dry) {
        const sims: string[] = []
        let simOk = true
        let nonce = snap.chain?.nonce ?? 0
        for (const spec of built.txs) {
          const tx = buildTransaction(spec, wallet.address, nonce++)
          const sim = await this.d.chain.simulate(toPlain(tx))
          sims.push(`${spec.label}: ${sim.ok ? `simulation ok (${sim.detail})` : `simulation FAILED (${sim.detail})`}`)
          if (!sim.ok) simOk = false
        }
        const api = apiCallsFor(a)
        const summary = [`would ${desc}, ${costText}`, ...sims, ...(api ? [`then ${api}`] : []), ...notes].join('; ')
        if (!simOk) return finish('failed', `DRY RUN ${summary}`, 0, undefined, { simulated: true })
        this.book(agent, verdict, usd, fees, built.swapUsd, true, now, snap, a, prices)
        applyEffect(a, verdict, snap, built)
        if (a.type === 'leave_tournament' || a.type === 'claim_refund') this.creditEntry(agent.index, a.tournament_id, true)
        return finish('dry_run', `DRY RUN ${summary}`, usd)
      }

      // Live: book the spend before anything is signed. A crash after the send can then never
      // under-count the caps, and when the booking itself fails nothing is signed or sent.
      if (!ownerLeave) this.assertNotStopped(agent.index) // a leave signs nothing; send() still checks before any signature
      if (built.txs.length || seat.length || verdict.foxsy > 0n) booking = this.book(agent, verdict, usd, fees, built.swapUsd, false, now, snap, a, prices)
      return await this.live(agent, wallet, snap, a, verdict, built, usd, fees, desc, costText, finish, now, booking ?? { ids: [], sent: false })
    } catch (err) {
      // Nothing was signed: the booking goes. Signed (maybe sent): it stays, the conservative side.
      if (booking && !booking.sent) this.unbook(booking)
      const msg = err instanceof ApiRefusal ? `refused by FoxLeague: ${err.message}` : err instanceof Error ? err.message : String(err)
      return finish('error', `${desc}: ${msg}`)
    }
  }

  /**
   * FOXSY valued at the higher of its spot price and the median of recent observations (kv
   * foxsy_usd_seen, one per 10 minutes, two days), so a dump on the pool cannot make FOXSY look cheap
   * to the caps. EGLD comes from the MultiversX API, sanity-checked in Chain.egldUsd.
   */
  private valuationPrices(p: AgentSnapshot['prices']): Prices | null {
    if (!p) return null
    const now = Date.now()
    let seen: { t: number; p: number }[] = []
    try {
      seen = (JSON.parse(this.d.store.getKv('foxsy_usd_seen') ?? '[]') as { t: number; p: number }[]).filter(o => now - o.t < 2 * 86_400_000 && o.p > 0)
    } catch {
      seen = []
    }
    if (!seen.length || now - Math.max(...seen.map(o => o.t)) >= 600_000) {
      seen = [...seen, { t: now, p: p.foxsyUsd }].slice(-288) // two days at one sample per 10 minutes
      this.d.store.setKv('foxsy_usd_seen', JSON.stringify(seen))
    }
    const sorted = seen.map(o => o.p).sort((x, y) => x - y)
    const median = sorted[Math.floor(sorted.length / 2)] ?? p.foxsyUsd
    return { egldUsd: p.egldUsd, foxsyUsd: Math.max(p.foxsyUsd, median) }
  }

  // ---- context and building ----

  private async context(agent: AgentRow, wallet: AgentWallet, snap: AgentSnapshot, a: Action, now: Date, dry: boolean): Promise<RulesContext> {
    const { store, fox } = this.d
    let tournament: TournamentDetail | null | undefined
    if (a.type === 'join_tournament' || a.type === 'leave_tournament' || a.type === 'claim_refund') {
      try {
        tournament = await fox.tournament(a.tournament_id, wallet)
      } catch (err) {
        if (!(err instanceof ApiRefusal)) throw err
        tournament = null
      }
    }
    let entryAmount: bigint | undefined
    if (a.type === 'claim_refund' && tournament) {
      const scId = tournament.tournament.sc_tournament_id ?? tournament.tournament.id
      const [amount] = await this.d.chain.query(MAINNET.tournamentsContract, 'getEntryAmount', [u64Hex(scId), Address.newFromBech32(agent.address).toHex()])
      entryAmount = b64ToBigInt(amount)
    }
    // Activity of the same ledger (dry run or live) this action is judged in.
    const counted = (st: string) => (dry ? st === 'dry_run' : st === 'confirmed' || st === 'unconfirmed')
    const since = (ms: number) => new Date(now.getTime() - ms)
    const detailOf = (r: { detail: string | null }) => {
      try {
        return JSON.parse(r.detail ?? '{}') as { opponentUserId?: number; action?: { nonce?: number; target_user_id?: number | null } }
      } catch {
        return {}
      }
    }
    const market: Partial<RulesContext> = {}
    /** A lookup whose failure only means "unknown" (the rules then refuse where it matters). */
    const soft = async <T>(fn: () => Promise<T>): Promise<T | null> => {
      try {
        return await fn()
      } catch {
        return null
      }
    }
    // 1v1: who is on the other side, how strong, how often already this week.
    let opponentId: number | null = null
    let opponentWallet: string | undefined
    if (a.type === 'join_tournament' && tournament?.tournament.max_teams === 2) {
      const creator = tournament.participants.find(p => p.user_id !== snap.profile?.id)
      opponentId = creator?.user_id ?? tournament.tournament.creator_user_id ?? null
      opponentWallet = creator?.wallet_address
    }
    if (a.type === 'create_challenge' && a.target_user_id !== null) opponentId = a.target_user_id
    if (opponentId !== null) {
      let elo: number | null = null
      if (opponentWallet) elo = (await soft(() => fox.user(opponentWallet!)))?.elo_rating ?? null
      const neighbour = snap.leaderboardNeighbours.find(u => u.id === opponentId)
      if (elo === null) elo = neighbour?.elo_rating ?? null
      opponentWallet ??= neighbour?.wallet_address
      if (elo === null || !opponentWallet) {
        const listed = (await soft(() => fox.leaderboard(200)))?.users.find(u => u.id === opponentId)
        elo ??= listed?.elo_rating ?? null
        opponentWallet ??= listed?.wallet_address
      }
      const strength = opponentWallet ? await soft(() => rivalStrength(fox, opponentWallet!)) : null
      market.opponent = { userId: opponentId, elo, strength }
      market.oneVOneWithOpponentThisWeek = store
        .activityOf(agent.index, ['join_tournament', 'create_challenge'], since(7 * 86_400_000))
        .filter(r => counted(r.status) && detailOf(r).opponentUserId === opponentId).length
    }
    if (a.type === 'create_challenge' && a.target_user_id === null) {
      market.openChallengesToday = store
        .activityOf(agent.index, ['create_challenge'], since(24 * 3_600_000))
        // On the safe side: a create that failed or errored may still have left a challenge on FoxLeague.
        .filter(r => (counted(r.status) || r.status === 'failed' || r.status === 'error') && (detailOf(r).action as { target_user_id?: number | null } | undefined)?.target_user_id === null).length
    }
    if (a.type === 'join_tournament') market.pendingJoin = store.pending(agent.index).some(p => p.kind === 'join' && (p.payload as { tournamentId?: number }).tournamentId === a.tournament_id)
    if (a.type === 'buy') market.pendingShop = new Set(store.pending(agent.index).filter(p => p.kind === 'shop').map(p => String((p.payload as { product?: string }).product)))
    if (a.type === 'fuse') {
      market.canFuse = await soft(() => fox.canFuse(wallet, a.player_nonces))
      const first = snap.players.find(p => p.nonce === a.player_nonces[0])
      const chosen = snap.players.find(p => p.nonce === a.player_nonces[a.position_of])
      if (first && chosen && first.rarity !== 'Legendary') market.fusionPool = await fusionPoolCount(this.d.chain, RARITY_LEVEL[first.rarity] + 1, chosen.position)
    }
    if (a.type === 'fusion_cooldown_waiver') market.cooldownQuote = await soft(() => fusionCooldownQuote(this.d.chain, a.nonce))
    if (a.type === 'fusion_match_waiver') market.matchQuote = await soft(() => fox.matchWaiverQuote(wallet, a.nonce))
    if (a.type === 'bid' || a.type === 'cancel_listing') market.auction = await getAuction(this.d.chain, a.nonce)
    if (a.type === 'bid') {
      market.priorBids = store.activityOf(agent.index, ['bid'], since(48 * 3600_000)).filter(r => (counted(r.status) || r.status === 'sent') && detailOf(r).action?.nonce === a.nonce).length
      try {
        const c = await fox.player(a.nonce)
        const hours = (c as { transfer_cooldown_hours?: number | null }).transfer_cooldown_hours
        const at = (c as { transferred_at?: string | null }).transferred_at
        market.cardLock = { until: at && hours ? new Date(new Date(at).getTime() + hours * 3600_000) : null }
        if (typeof c.rarity === 'string') market.cardRarity = c.rarity
      } catch {
        market.cardLock = null
      }
    }
    if (a.type === 'list_card') {
      market.canList = await soft(() => fox.canList(wallet, a.nonce))
      const rarity = snap.players.find(p => p.nonce === a.nonce)?.rarity
      const floors = await soft(() => fox.floorPrices())
      market.floorPrice = floors ? (floors.find(f => f.rarity === rarity)?.floor_price ?? 0) : null
    }
    const recent = store.activityOf(agent.index, ['play_match'], since(86_400_000)).filter(r => r.status === 'confirmed' || r.status === 'dry_run')
    const lastMatch = recent[0]
    const lastRanked = recent.find(r => r.summary.includes('ranked'))
    return {
      settings: agent.settings,
      ...(tournament !== undefined ? { tournament } : {}),
      ...(entryAmount !== undefined ? { entryAmount } : {}),
      ...market,
      lastMatchStartAt: lastMatch ? new Date(lastMatch.at) : null,
      lastRankedStartAt: lastRanked ? new Date(lastRanked.at) : null,
      now,
    }
  }

  private async build(a: Action, v: Verdict, snap: AgentSnapshot, wallet: AgentWallet, prices: Prices | null): Promise<Built> {
    const none: Built = { txs: [], egldValue: 0n, extraUsd: 0, notes: [] }
    switch (a.type) {
      case 'swap_egld_for_foxsy': {
        const q = await quoteEgldForFoxsy(this.d.chain, v.facts.foxsyOut as bigint, (v.facts.slippageBps as number | undefined) ?? 100)
        const poolFeeUsd = prices ? atomicToFloat(q.amountIn) * 0.003 * prices.egldUsd : 0
        const swapUsd = prices ? atomicToFloat(q.maxIn) * prices.egldUsd : 0
        // WEGLD in the wallet goes first, when it covers the whole swap: it pays no gas, so no reserve is kept
        // of it, and the pair returns what it does not use. The caps and swap allowances count it like EGLD.
        if ((snap.chain?.wegld ?? 0n) >= q.maxIn) {
          return {
            txs: [swapWegldTx(q.foxsyOut, q.maxIn)],
            egldValue: 0n,
            wegldValue: q.maxIn,
            extraUsd: poolFeeUsd,
            swapUsd,
            notes: [`quote ${formatAtomic(q.amountIn, 4)} WEGLD from the wallet, pays at most ${formatAtomic(q.maxIn, 4)} WEGLD (${q.slippageBps / 100}% slippage)`],
          }
        }
        return {
          txs: [swapEgldTx(q.foxsyOut, q.maxIn)],
          egldValue: q.maxIn,
          extraUsd: poolFeeUsd,
          swapUsd,
          notes: [`quote ${formatAtomic(q.amountIn, 4)} EGLD, pays at most ${formatAtomic(q.maxIn, 4)} EGLD (${q.slippageBps / 100}% slippage)`],
        }
      }
      case 'register': {
        if (v.facts.feePaid) return none
        const relayer = snap.config?.relayer_addresses.find(r => shardOfPubkeyLastByte(lastByte(r)) === shardOfPubkeyLastByte(lastByte(wallet.address)))
        if (!relayer) throw new Error(`no relayer served for shard ${wallet.shard}`)
        // Simulated in its relayed v3 form (the relayer pays the fee, the wallet pays the FOXSY).
        const spec = registerAndPayTx(v.facts.feeAtomic as bigint, relayer, snap.config?.relayer_max_gas_limit)
        return { txs: [spec], egldValue: 0n, extraUsd: 0, notes: [`relayed through ${relayer.slice(0, 12)}... (shard ${wallet.shard})`, `then name "${a.team_name}" via POST /api/register`] }
      }
      case 'sync': {
        const prep = await this.d.fox.syncPrepare(wallet, a.nonce)
        const { spec, foxsy } = this.checkedSync(wallet, prep, snap, v)
        return { txs: [spec], egldValue: 0n, extraUsd: 0, notes: [`${prep.nonces.length} cards, ${formatAtomic(foxsy, 0)} FOXSY`] }
      }
      case 'join_tournament':
        if (v.facts.tier === 'bronze') return none
        return { ...none, txs: [joinTournamentTx(v.facts.scId as number, v.foxsy)] }
      case 'buy':
        return { ...none, txs: [shopPayTx(v.foxsy)] }
      case 'claim_refund':
        return { ...none, txs: [claimRefundTx(v.facts.scId as number)] }
      case 'fuse':
        return { ...none, txs: [fusionTx(wallet.address, v.foxsy, v.facts.nonces as number[], v.facts.positionChoice as number)] }
      case 'bid':
        return { ...none, txs: [auctionBidTx(a.nonce, a.foxsy)] }
      case 'list_card':
        return { ...none, txs: [auctionListTx(wallet.address, a.nonce, a.reserve_foxsy)] }
      case 'cancel_listing':
        return { ...none, txs: [auctionCancelTx(a.nonce)] }
      case 'fusion_cooldown_waiver':
        return { ...none, txs: [fusionWaiverTx(wallet.address, a.nonce, v.facts.costAtomic as bigint, 'payFusionCooldownWaiver')] }
      case 'fusion_match_waiver':
        return { ...none, txs: [fusionWaiverTx(wallet.address, a.nonce, v.facts.costAtomic as bigint, 'payFusionMatchWaiver', a.matches)] }
      case 'create_tournament':
      case 'create_challenge':
        // The seat is paid after the create answers with the on-chain id; nothing to simulate before.
        return { ...none, notes: ['seat payment (joinTournament) follows the create'] }
      default:
        return none
    }
  }

  /** Why a team name cannot be registered (FoxLeague's check before the fee), or null when it is free. */
  private async nameRefusal(wallet: AgentWallet, name: string): Promise<string | null> {
    try {
      const r = await this.d.fox.nameAvailable(wallet, name)
      return r.available ? null : `FoxLeague does not confirm the name "${name}" is free; nothing paid, the next plan picks another`
    } catch (err) {
      if (err instanceof ApiRefusal) return /already taken/i.test(err.message) ? `the name "${name}" is taken (FoxLeague checked it before any payment); the next plan picks another` : `FoxLeague refuses the name "${name}": ${err.message}`
      // An unanswered check is never read as a free name in front of a payment.
      return `the name could not be checked (${err instanceof Error ? err.message : String(err)}); nothing paid, the next plan tries again`
    }
  }

  /** The sync payload as signed: exactly a sync (syncTx) and never more FOXSY than the caps allowed. */
  private checkedSync(wallet: AgentWallet, prep: Parameters<typeof syncTx>[1], snap: AgentSnapshot, v: Verdict) {
    const out = syncTx(wallet.address, prep, snap.config?.sync_cost_foxsy ?? 10)
    if (out.foxsy > v.foxsy) throw new Error(`sync would pay ${formatAtomic(out.foxsy, 0)} FOXSY, the check allowed ${formatAtomic(v.foxsy, 0)}: retry next tick`)
    return out
  }

  // ---- the spend ledger ----

  /**
   * Books the spend (and a swap's EGLD) in the ledger of the mode; returns the rows for a live payment.
   * A bid's or an entry's FOXSY gets its own row tagged bid:<nonce> or join:<tournament>, so the budget
   * gets it back when it is refunded (outbid, left, cancelled); the gas stays in an untagged row.
   */
  private book(agent: AgentRow, v: Verdict, usd: number, fees: bigint, swapUsd: number | undefined, dryRun: boolean, now: Date, snap: AgentSnapshot, a?: Action, prices?: Prices | null): Booking {
    const booking: Booking = { ids: [], sent: false }
    const gameDay = gameDayKey(now, snap.gameDay.resetHourUtc)
    // Tagged so a refund can be credited later; a created tournament gets its id once the create answers.
    const tag = a?.type === 'bid' ? `bid:${a.nonce}` : a?.type === 'join_tournament' ? `join:${a.tournament_id}` : a?.type === 'create_tournament' || a?.type === 'create_challenge' ? 'join:new' : null
    try {
      if (tag && v.foxsy > 0n && prices) {
        const foxsyUsd = costUsd(v.foxsy, 0n, prices)
        booking.ids.push(this.d.store.recordSpend({ agentIndex: agent.index, at: now, gameDay, category: v.category, action: tag, foxsyAtomic: v.foxsy, egldAtomic: 0n, usd: foxsyUsd, txHash: null, dryRun }))
        if (usd - foxsyUsd > 0) booking.ids.push(this.d.store.recordSpend({ agentIndex: agent.index, at: now, gameDay, category: v.category, action: '', foxsyAtomic: 0n, egldAtomic: fees, usd: usd - foxsyUsd, txHash: null, dryRun }))
      } else if (usd > 0 || v.foxsy > 0n) booking.ids.push(this.d.store.recordSpend({ agentIndex: agent.index, at: now, gameDay, category: v.category, action: '', foxsyAtomic: v.foxsy, egldAtomic: fees, usd, txHash: null, dryRun }))
      if (swapUsd) booking.ids.push(this.d.store.recordSpend({ agentIndex: agent.index, at: now, gameDay, category: 'swap', action: '', foxsyAtomic: 0n, egldAtomic: 0n, usd: swapUsd, txHash: null, dryRun }))
    } catch (err) {
      this.unbook(booking)
      throw new Error(`could not book the spend (${err instanceof Error ? err.message : err}); nothing signed`)
    }
    return booking
  }

  /** An entry that came back (left before the deadline, refund claimed): its FOXSY stops counting. */
  private creditEntry(agentIndex: number, tournamentId: number, dryRun: boolean): void {
    for (const r of this.d.store.openSpend(agentIndex, `join:${tournamentId}`, dryRun)) if (r.action === `join:${tournamentId}`) this.d.store.creditSpend(r.id)
  }

  private unbook(booking: Booking): void {
    for (const id of booking.ids) {
      try {
        this.d.store.deleteSpend(id)
      } catch {
        // conservative: a booking that cannot be removed only over-counts
      }
    }
    booking.ids = []
  }

  private settle(booking: Booking, hash: string): void {
    for (const id of booking.ids) this.d.store.setSpendHash(id, hash)
  }

  /** A reverted transaction: nothing left the wallet but the gas, which stays in the ledger. */
  private revert(booking: Booking, agent: AgentRow, v: Verdict, fees: bigint, hash: string, now: Date, snap: AgentSnapshot): number {
    this.unbook(booking)
    const prices = snap.prices
    const gasUsd = prices ? costUsd(0n, fees, prices) : 0
    if (gasUsd > 0) this.d.store.recordSpend({ agentIndex: agent.index, at: now, gameDay: gameDayKey(now, snap.gameDay.resetHourUtc), category: v.category, action: 'gas', foxsyAtomic: 0n, egldAtomic: fees, usd: gasUsd, txHash: hash, dryRun: false })
    return gasUsd
  }

  // ---- live ----

  /** The kill switch or a pause pressed while an action was being prepared stops it before the signature. */
  private assertNotStopped(agentIndex: number): void {
    if (this.d.store.killSwitch) throw new Error('the kill switch was turned on before signing: nothing sent')
    if (this.d.store.agent(agentIndex)?.paused) throw new Error('the agent was paused before signing: nothing sent')
  }

  /** Signs and sends; from the signature on the payment counts as possibly sent. */
  private async send(wallet: AgentWallet, spec: TxSpec, booking: Booking): Promise<string> {
    const account = await this.d.chain.account(wallet.address)
    const tx = buildTransaction(spec, wallet.address, account.nonce)
    this.assertNotStopped(wallet.index)
    wallet.signTransaction(tx)
    booking.sent = true
    const hash = await this.d.chain.send(toPlain(tx))
    this.settle(booking, hash)
    return hash
  }

  /** The outcome, or 'unconfirmed' when it cannot be read (the payment stays booked). */
  private async outcome(hash: string): Promise<TxOutcome> {
    try {
      return await this.d.chain.waitForOutcome(hash)
    } catch (err) {
      return { kind: 'unconfirmed', reason: `outcome unreadable: ${err instanceof Error ? err.message : err}` }
    }
  }

  private async sendAndWait(wallet: AgentWallet, spec: TxSpec, booking: Booking): Promise<{ hash: string; outcome: TxOutcome }> {
    const hash = await this.send(wallet, spec, booking)
    return { hash, outcome: await this.outcome(hash) }
  }

  private async live(
    agent: AgentRow,
    wallet: AgentWallet,
    snap: AgentSnapshot,
    a: Action,
    v: Verdict,
    built: Built,
    usd: number,
    fees: bigint,
    desc: string,
    costText: string,
    finish: (status: ResultStatus, summary: string, costUsd?: number, txHash?: string, detail?: unknown) => ExecutionResult,
    now: Date,
    booking: Booking,
  ): Promise<ExecutionResult> {
    const { fox, store, chain } = this.d
    const outcomeResult = (hash: string, o: TxOutcome, after?: () => Promise<string>): Promise<ExecutionResult> | ExecutionResult => {
      if (o.kind === 'failed') return finish('failed', `${desc}: reverted (${o.reason})`, this.revert(booking, agent, v, fees, hash, now, snap), hash)
      if (o.kind === 'unconfirmed') return finish('unconfirmed', `${desc}: sent, not final yet (${o.reason}); ${costText}`, usd, hash)
      if (!after) return finish('confirmed', `${desc}: done, ${costText}`, usd, hash)
      return after().then(
        msg => finish('confirmed', `${desc}: ${msg}, ${costText}`, usd, hash),
        err => finish('error', `${desc}: paid (${hash}) but the backend step failed: ${err instanceof Error ? err.message : err}`, usd, hash),
      )
    }

    switch (a.type) {
      case 'swap_egld_for_foxsy': {
        const { hash, outcome } = await this.sendAndWait(wallet, built.txs[0]!, booking)
        if (outcome.kind === 'success') applyEffect(a, v, snap, built) // a register later in the plan sees the FOXSY
        // The result says which coin paid: the owner's WEGLD, or EGLD above the reserve.
        return outcomeResult(hash, outcome, async () => `done, paid with ${built.wegldValue ? 'WEGLD from the wallet' : 'EGLD'} (at most ${formatAtomic(built.wegldValue ?? built.egldValue, 4)})`)
      }
      case 'register': {
        // The relayed fee's hash, kept for every answer after it: a fee paid without a team is not routine.
        let relayed: string | undefined
        if (built.txs.length) {
          const relayer = snap.config!.relayer_addresses.find(r => shardOfPubkeyLastByte(lastByte(r)) === shardOfPubkeyLastByte(lastByte(wallet.address)))!
          const spec = registerAndPayTx(v.facts.feeAtomic as bigint, relayer, snap.config?.relayer_max_gas_limit)
          const account = await chain.account(wallet.address)
          const tx = buildTransaction(spec, wallet.address, account.nonce)
          this.assertNotStopped(wallet.index)
          wallet.signTransaction(tx)
          booking.sent = true
          try {
            relayed = await fox.relay(wallet, tx.toPlainObject())
          } catch (err) {
            // An explicit refusal means the backend did not broadcast: nothing left the wallet.
            if (err instanceof ApiRefusal) this.unbook(booking)
            throw err
          }
          this.settle(booking, relayed)
          const outcome = await this.outcome(relayed)
          if (outcome.kind === 'failed') return finish('failed', `${desc}: registration payment reverted (${outcome.reason})`, this.revert(booking, agent, v, 0n, relayed, now, snap), relayed)
        }
        let lastErr = ''
        for (let i = 0; i < 6; i++) {
          try {
            const r = await fox.register(wallet, a.team_name)
            return finish('confirmed', `${desc}: team "${r.team_name}" created, ${r.nonces.length} cards; ${costText}`, usd)
          } catch (err) {
            lastErr = err instanceof Error ? err.message : String(err)
            if (/already taken/i.test(lastErr)) return finish('failed', `${desc}: name taken; the fee stays recorded on chain, retry with another name (no second payment)`, usd, relayed)
            if (!retryable(err, /not paid on-chain|Unable to verify|retry/i)) break
            await sleep(8000)
          }
        }
        return finish('error', `${desc}: ${lastErr}`, usd, relayed)
      }
      case 'sync': {
        const prep = await fox.syncPrepare(wallet, a.nonce)
        const { spec } = this.checkedSync(wallet, prep, snap, v)
        if (prep.wait_seconds > 0) {
          await sleep(Math.min(prep.wait_seconds, 30) * 1000)
          if (store.killSwitch || store.agent(agent.index)?.paused) throw new Error('stopped (kill switch or pause) while waiting to sync')
        }
        const { hash, outcome } = await this.sendAndWait(wallet, spec, booking)
        return outcomeResult(hash, outcome, async () => {
          const r = await fox.syncConfirm(wallet, hash, prep.nonces)
          return `${r.players_synced} cards synced`
        })
      }
      case 'train': {
        await fox.train(wallet, a.player_nonce, a.attribute)
        applyEffect(a, v, snap, built)
        return finish('confirmed', `${desc}: done`)
      }
      case 'set_formation':
        await fox.setFormation(wallet, a.formation)
        applyEffect(a, v, snap, built)
        return finish('confirmed', `${desc}: saved`)
      case 'set_lineup':
        await fox.setLineup(wallet, a.lineup, a.substitutes)
        applyEffect(a, v, snap, built)
        return finish('confirmed', `${desc}: saved`)
      case 'play_match': {
        const r = await fox.playMatch(wallet, a.match_type)
        applyEffect(a, v, snap, built)
        return finish('confirmed', `${desc}: match #${r.match_id} started (${a.match_type})`)
      }
      case 'leave_tournament': {
        const r = await fox.leaveTournament(wallet, a.tournament_id)
        this.creditEntry(agent.index, a.tournament_id, false)
        let closed = ''
        if (v.facts.cancel) {
          try {
            closed = `; challenge closed (${(await fox.cancelTournament(wallet, a.tournament_id)).message})`
          } catch (err) {
            // The stake is back either way; an open challenge without a seat simply expires at its deadline.
            closed = `; the challenge stays listed until its deadline (${err instanceof Error ? err.message : err})`
          }
        }
        return finish('confirmed', `${desc}: ${r.message}${r.refund_tx_hash ? ` refund ${r.refund_tx_hash}` : ''}${closed}`)
      }
      case 'join_tournament': {
        if (!built.txs.length) {
          await fox.joinTournament(wallet, a.tournament_id)
          return finish('confirmed', `${desc}: seated (free)`)
        }
        return this.payAndJoin(agent, wallet, snap, a.tournament_id, built.txs[0]!, v, usd, fees, desc, costText, finish, now, booking)
      }
      case 'buy': {
        const hash = await this.send(wallet, built.txs[0]!, booking)
        const body = { tx_hash: hash, product: a.product, ...(a.player_nonces ? { player_nonces: a.player_nonces } : {}), ...(a.quantity ? { quantity: a.quantity } : {}) }
        store.addPending(hash, agent.index, 'shop', body)
        const outcome = await this.outcome(hash)
        if (outcome.kind === 'failed') {
          store.resolvePending(hash, 'failed')
          return finish('failed', `${desc}: payment reverted (${outcome.reason})`, this.revert(booking, agent, v, fees, hash, now, snap), hash)
        }
        if (outcome.kind === 'unconfirmed') return finish('unconfirmed', `${desc}: paid, outcome not read yet (${outcome.reason}); the confirm is retried`, usd, hash)
        try {
          const r = await fox.shopConfirm(wallet, body)
          store.resolvePending(hash, 'done')
          applyEffect(a, v, snap, built)
          return finish('confirmed', `${desc}: ${r.message}; ${costText}`, usd, hash)
        } catch (err) {
          // tx_pending or a timeout: the payment is kept and confirmed again later (within 30 min).
          return finish('unconfirmed', `${desc}: paid, confirm pending (${err instanceof Error ? err.message : err}); will retry the same hash`, usd, hash)
        }
      }
      case 'claim_refund': {
        const { hash, outcome } = await this.sendAndWait(wallet, built.txs[0]!, booking)
        if (outcome.kind === 'success') this.creditEntry(agent.index, a.tournament_id, false)
        return outcomeResult(hash, outcome)
      }
      case 'fuse': {
        const { hash, outcome } = await this.sendAndWait(wallet, built.txs[0]!, booking)
        if (outcome.kind === 'failed' && /new NFT data on sender/i.test(outcome.reason)) {
          return finish('failed', `${desc}: a card was updated moments ago on another shard; nothing was burned, retry in a minute`, this.revert(booking, agent, v, fees, hash, now, snap), hash)
        }
        return outcomeResult(hash, outcome, async () => {
          applyEffect(a, v, snap, built)
          const r = await fox.fusionConfirm(wallet, hash, a.player_nonces).catch(err => ({ message: `fused; the indexer records it (${err instanceof Error ? err.message : err})` }))
          return r.message || 'fused'
        })
      }
      case 'bid':
      case 'list_card':
      case 'cancel_listing':
      case 'fusion_cooldown_waiver':
      case 'fusion_match_waiver': {
        const { hash, outcome } = await this.sendAndWait(wallet, built.txs[0]!, booking)
        if (outcome.kind === 'success') applyEffect(a, v, snap, built)
        return outcomeResult(hash, outcome)
      }
      case 'create_tournament':
      case 'create_challenge': {
        const nowMs = Date.now()
        const body: Record<string, unknown> =
          a.type === 'create_challenge'
            ? {
                title: `${a.tier === 'gold' ? 'Gold' : 'Silver'} 1v1 ${a.stake_foxsy}`,
                format: 'knockout',
                tier: a.tier,
                max_teams: 2,
                min_teams: 2,
                entry_fee_foxsy: a.stake_foxsy,
                target_user_id: a.target_user_id,
                challenge_deadline_minutes: a.deadline_minutes,
                deadline: new Date(nowMs + a.deadline_minutes * 60_000).toISOString(),
                starts_at: new Date(nowMs + (a.deadline_minutes + 5) * 60_000).toISOString(),
              }
            : {
                title: a.title,
                format: a.format,
                tier: a.tier,
                max_teams: a.max_teams,
                min_teams: a.min_teams,
                entry_fee_foxsy: a.entry_fee_foxsy,
                starts_at: new Date(nowMs + a.starts_in_hours * 3600_000).toISOString(),
                deadline: new Date(nowMs + a.starts_in_hours * 3600_000 - a.registration_closes_minutes_before * 60_000).toISOString(),
                round_interval_minutes: a.round_interval_minutes,
                has_third_place_match: a.format === 'knockout',
                ...(a.home_and_away ? { home_and_away: true } : {}),
              }
        const created = await fox.createTournament(wallet, body, `agent${agent.index}-${randomUUID()}`)
        store.retagSpend(booking.ids, 'join:new', `join:${created.id}`)
        let detail: TournamentDetail | undefined
        for (let i = 0; i < 20; i++) {
          detail = await fox.tournament(created.id, wallet)
          if (detail.tournament.status === 'open' && detail.tournament.sc_tournament_id !== null) break
          await sleep(3000)
        }
        if (!detail || detail.tournament.sc_tournament_id === null) return finish('error', `${desc}: created T${created.id} but it is not on chain yet; seat not paid`)
        const spec = joinTournamentTx(detail.tournament.sc_tournament_id, v.foxsy)
        return this.payAndJoin(agent, wallet, snap, created.id, spec, v, usd, fees, `${desc} (T${created.id})`, costText, finish, now, booking)
      }
    }
  }

  /** Pay the seat, then POST /join; "Do NOT pay again" means retry without a hash (paidJoin.ts). */
  private async payAndJoin(
    agent: AgentRow,
    wallet: AgentWallet,
    snap: AgentSnapshot,
    tournamentId: number,
    spec: TxSpec,
    v: Verdict,
    usd: number,
    fees: bigint,
    desc: string,
    costText: string,
    finish: (status: ResultStatus, summary: string, costUsd?: number, txHash?: string) => ExecutionResult,
    now: Date,
    booking: Booking,
  ): Promise<ExecutionResult> {
    const { hash, outcome } = await this.sendAndWait(wallet, spec, booking)
    if (outcome.kind === 'failed') return finish('failed', `${desc}: seat payment reverted (${outcome.reason})`, this.revert(booking, agent, v, fees, hash, now, snap), hash)
    this.d.store.addPending(hash, agent.index, 'join', { tournamentId })
    let withHash = true
    for (let i = 0; i < 6; i++) {
      try {
        const r = await this.d.fox.joinTournament(wallet, tournamentId, withHash ? hash : undefined)
        this.d.store.resolvePending(hash, 'done')
        return finish('confirmed', `${desc}: seated${r.condition_warning ? ` (${r.condition_warning})` : ''}; ${costText}`, usd, hash)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (/Do NOT pay again/i.test(msg)) withHash = false
        else if (!retryable(err, /not confirmed on chain yet|retry/i)) return finish('error', `${desc}: paid ${hash} but not seated: ${msg} (FoxLeague refunds an unseated entry; the creator of a 1v1 is seated from it instead)`, usd, hash)
        await sleep(6000)
      }
    }
    return finish('unconfirmed', `${desc}: paid ${hash}, seat not confirmed yet; the next tick retries the join without paying again`, usd, hash)
  }
}

/**
 * A confirm worth asking again with the same hash: FoxLeague's tx_pending code (its one signal that the payment
 * was not refused, only not verifiable yet; its wording changes), a transport failure (no answer is no refusal),
 * or the older wording.
 */
function retryable(err: unknown, wording: RegExp): boolean {
  if (err instanceof ApiRefusal) return err.isTxPending || wording.test(err.message)
  return true
}

/** Last byte of the public key, which the relayer shard rule reads. */
function lastByte(bech32: string): number {
  return parseInt(Address.newFromBech32(bech32).toHex().slice(-2), 16)
}

/** The API calls an action makes after (or instead of) its transaction, for the dry-run log. */
function apiCallsFor(a: Action): string | null {
  switch (a.type) {
    case 'register': return 'POST /api/onboarding/relay, POST /api/register'
    case 'sync': return 'POST /api/sync/confirm'
    case 'train': return `POST /api/training/train {player_nonce: ${a.player_nonce}, attribute: ${a.attribute}}`
    case 'set_formation': return `POST /api/teams/formation {formation: ${a.formation}}`
    case 'set_lineup': return 'POST /api/teams/lineup'
    case 'play_match': return `POST /api/matches/play {match_type: ${a.match_type}}`
    case 'join_tournament': return `POST /api/tournaments/${a.tournament_id}/join`
    case 'leave_tournament': return `POST /api/tournaments/${a.tournament_id}/leave (and /cancel for your own unaccepted 1v1)`
    case 'create_tournament':
    case 'create_challenge': return 'POST /api/tournaments/create, joinTournament, POST /join'
    case 'buy': return `POST /api/shop/confirm {product: ${a.product}}`
    default: return null
  }
}

/** Local effect of an action on the working snapshot, so later actions of the same plan validate against it. */
export function applyEffect(a: Action, v: Verdict, s: AgentSnapshot, built: { egldValue: bigint; wegldValue?: bigint }): void {
  if (s.chain) {
    s.chain.foxsy -= v.foxsy
    s.chain.egld -= built.egldValue
    s.chain.wegld -= built.wegldValue ?? 0n
    if (a.type === 'swap_egld_for_foxsy') s.chain.foxsy += v.facts.foxsyOut as bigint
  }
  const card = (n: number) => s.players.find(p => p.nonce === n)
  switch (a.type) {
    case 'sync':
      for (const p of s.players) if (!p.listed && (a.nonce === undefined || p.nonce === a.nonce)) { p.dirty = false; p.synced = { ...p.live } }
      break
    case 'train': {
      const p = card(a.player_nonce)
      if (p) p.condition = Math.max(0, p.condition - 5)
      const t = s.auth?.shop?.training
      if (t) {
        if (v.facts.usesPaidSlot) { t.premium_used_today++; t.slots_banked-- }
        t.used_today++
      }
      if (p) p.dirty = true
      break
    }
    case 'set_formation':
      if (s.team) s.team.formation = a.formation
      break
    case 'set_lineup':
      if (s.team) {
        s.team.lineup = [...a.lineup]
        s.team.substitutes = [...a.substitutes]
        for (const p of s.players) {
          const slot = a.lineup.indexOf(p.nonce)
          p.role = slot >= 0 ? 'starter' : a.substitutes.includes(p.nonce) ? 'bench' : 'reserve'
          if (slot >= 0) p.slot = slot
          else delete p.slot
        }
      }
      break
    case 'play_match':
      if (s.auth?.allowance) s.auth.allowance.today_count++
      for (const n of s.team?.lineup ?? []) {
        const p = card(n)
        if (p) { p.condition = Math.max(0, p.condition - 5); p.dirty = true }
      }
      break
    case 'fuse':
      s.players = s.players.filter(p => !a.player_nonces.includes(p.nonce))
      if (s.chain) s.chain.nftCount -= 3
      break
    case 'list_card':
    case 'cancel_listing': {
      const p = card(a.nonce)
      if (p) p.listed = a.type === 'list_card'
      break
    }
    case 'fusion_cooldown_waiver': {
      const p = card(a.nonce)
      if (p) p.fusionReadyAt = new Date(Date.now() + 3 * 86_400_000).toISOString()
      break
    }
    case 'fusion_match_waiver': {
      const p = card(a.nonce)
      if (p) p.fusionMatchCredit += a.matches
      break
    }
    case 'buy':
      if (a.product === 'condition_recovery') for (const n of a.player_nonces ?? []) { const p = card(n); if (p) p.condition = 100 }
      if (a.product === 'training_slot' && s.auth?.shop?.training) s.auth.shop.training.slots_banked += a.quantity ?? 1
      if (a.product === 'xp_booster' && s.auth?.shop) s.auth.shop.xp_booster = { active: true, expires_at: new Date(Date.now() + 86_400_000).toISOString() }
      break
    default:
      break
  }
}

export function formatResult(agentIndex: number, r: ExecutionResult): string {
  const icon = { dry_run: '[dry]', refused: '[refused]', confirmed: '[ok]', failed: '[FAILED]', unconfirmed: '[pending]', error: '[ERROR]' }[r.status]
  return `${agentName(agentIndex)} ${icon} ${r.summary}${r.txHash ? `\nhttps://explorer.multiversx.com/transactions/${r.txHash}` : ''}${r.reason ? `\nwhy: ${r.reason}` : ''}`
}
