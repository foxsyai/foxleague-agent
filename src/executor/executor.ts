// The executor: the only code that builds, signs and sends. For each proposed action it checks
// the kill switch, the game rules, the per-action limits and the USD caps, builds the exact
// transaction the web app would, and then either simulates it (dry run: "would do X, cost Y") or
// signs, sends, waits for the real outcome and confirms with the backend (live).
//
// Live needs BOTH the platform in live mode (one switch for all agents) AND AGENT_LIVE_ENABLED=1 in the environment.

import { randomUUID } from 'node:crypto'
import { winChance } from '../snapshot/winchance.ts'
import { Address, Transaction, TransactionComputer } from '@multiversx/sdk-core'
import { MAINNET, type Config } from '../config.ts'
import { BroadcastRefused, type Chain, type PlainTx, type TxOutcome } from '../chain/gateway.ts'
import { quoteEgldForFoxsy } from '../chain/xexchange.ts'
import { ApiRefusal, rivalStrength, type FoxLeague } from '../foxleague/api.ts'
import type { Tournament, TournamentDetail } from '../foxleague/types.ts'
import { levelsLive, organizerFeesLive } from '../foxleague/levels.ts'
import type { AgentSnapshot } from '../snapshot/snapshot.ts'
import type { AgentRow, Store } from '../store/db.ts'
import { atomicToFloat, b64ToBigInt, decimalToAtomic, formatAtomic, u64Hex, wholeToAtomic } from '../util/encoding.ts'
import { sleep } from '../util/http.ts'
import { agentName } from '../names.ts'
import type { AgentWallet } from '../wallet/wallet.ts'
import { describeAction, type Action, type PlannedAction } from './actions.ts'
import { budgetView, capRefusal, costUsd, gameDayKey, type Prices } from './budget.ts'
import { SHOP_FINAL, SHOP_REFUNDED, creditShopPayment } from './pending.ts'
import { XP_BOOSTER_RENEW_HOURS, checkAction, lineupStrength, type RulesContext, type Verdict } from './rules.ts'
import { oneVOnesThisWeek, ownCreations } from './rivals.ts'
import { lastMatchStarts } from './match-starts.ts'
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
  /** The service is stopping (SIGTERM, a deploy): nothing more is signed; an action already sent finishes. */
  stopping?: () => boolean
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
  /** FoxLeague was asked to create or seat: a tournament, a 1v1 or a seat may exist from then on, whatever the answer. */
  reached?: boolean
  /** What a tournament's organizer pays apart from its seat: its own rows and its own transaction. */
  organizer?: Booking
}

/** The actions whose rows say `untouched` when they end in an error before FoxLeague was asked or anything was signed. */
const REACH_TRACKED = new Set<Action['type']>(['create_tournament', 'create_challenge', 'join_tournament'])

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
  runOne(agent: AgentRow, wallet: AgentWallet, snap: AgentSnapshot, planned: PlannedAction): Promise<ExecutionResult> {
    return this.exclusive(agent.index, () => this.runOneLocked(agent, wallet, snap, planned))
  }

  /**
   * Runs `fn` under the agent's lock, in turn with its actions: the pending-payment retry uses it, so a confirm of a
   * hash never runs while the action that sent it is still waiting for its outcome or confirming it.
   */
  async exclusive<T>(index: number, fn: () => Promise<T>): Promise<T> {
    const before = this.locks.get(index) ?? Promise.resolve()
    let release!: () => void
    const mine = new Promise<void>(r => (release = r))
    const tail = before.then(() => mine)
    this.locks.set(index, tail)
    await before
    try {
      return await fn()
    } finally {
      release()
      if (this.locks.get(index) === tail) this.locks.delete(index)
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
      // An error before FoxLeague was asked to create or seat and before any signature (the kill switch, a pause or a
      // stop before the signature, a booking that failed) left nothing on FoxLeague, as a refusal (audit A1, 2026-10-23).
      const untouched = status === 'error' && REACH_TRACKED.has(a.type) && !booking?.sent && !booking?.reached
      // The organizer's payment counts: it may have left the wallet whatever became of the seat.
      const sent = booking?.sent || booking?.organizer?.sent
      // `sent`: the payment was signed and handed to the network, so with an error it may have landed (the bid limit reads it).
      // `untouched`: the 1v1 checks after a restart know that this error left no challenge and no seat.
      store.log({ agentIndex: agent.index, kind: a.type, status, summary, detail: { action: a, reason: planned.reason, ...logExtra, ...((detail as object) ?? {}), ...(sent ? { sent: true } : {}), ...(untouched ? { untouched: true } : {}) }, costUsd: costUsdValue || null, txHash })
      const result: ExecutionResult = { action: a, reason: planned.reason, status, summary, costUsd: costUsdValue, ...(txHash ? { txHash } : {}), ...(sent ? { sent: true } : {}) }
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
      if (planned.byOwner) {
        ctx.byOwner = true
        // Kept with the row: a League + Knockout seat the owner took (Telegram /do) is the owner's to leave.
        logExtra.byOwner = true
      }
      if (ctx.opponent) {
        logExtra.opponentUserId = ctx.opponent.userId
        // The win chance this 1v1 was taken at, kept with its result to calibrate the estimate on real matches.
        logExtra.winChance = winChance({ myElo: snap.profile?.elo_rating ?? null, oppElo: ctx.opponent.elo, myStrength: lineupStrength(snap) || null, oppStrength: ctx.opponent.strength ?? null })
      }
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
      // A free action gets one too: it says when FoxLeague was asked (`reached`).
      booking ??= { ids: [], sent: false }
      if (planned.planPlatformFeePercent !== undefined) verdict.facts.planPlatformFeePercent = planned.planPlatformFeePercent
      return await this.live(agent, wallet, snap, a, verdict, built, usd, fees, desc, costText, finish, now, booking)
    } catch (err) {
      // Nothing was signed: the booking goes. Signed (maybe sent): it stays, the conservative side.
      if (booking && !booking.sent) this.unbook(booking)
      if (booking?.organizer && !booking.organizer.sent) this.unbook(booking.organizer)
      const msg = err instanceof ApiRefusal ? `refused by FoxLeague: ${err.message}` : err instanceof Error ? err.message : String(err)
      return finish('error', `${desc}: ${msg}`, 0, undefined, (err as { startUnknown?: boolean } | null)?.startUnknown ? { startUnknown: true } : undefined)
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
    // A frozen price (xExchange paused the pair) is no new observation: sampling it would let a price moved just
    // before the pause take over the median within a day (review of PR #3).
    if (!p.frozen && (!seen.length || now - Math.max(...seen.map(o => o.t)) >= 600_000)) {
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
    if (a.type === 'join_tournament' || a.type === 'leave_tournament' || a.type === 'claim_refund' || a.type === 'widen_range') {
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
        return JSON.parse(r.detail ?? '{}') as { opponentUserId?: number; sent?: boolean; untouched?: boolean; action?: { nonce?: number; target_user_id?: number | null; product?: string; deadline_minutes?: number } }
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
      // The count the plan request shows too (src/executor/rivals.ts): this agent's 1v1s against the rival this week.
      market.oneVOneWithOpponentThisWeek = oneVOnesThisWeek(store, agent.index, dry, now).get(opponentId)?.length ?? 0
    }
    // While an open challenge may still wait (its longest deadline is 4 hours), a change that tires or weakens the eleven
    // is checked against its range; when our tournaments cannot be read, the log says whether one may wait (R54A-3).
    if (a.type === 'play_match' || a.type === 'train' || a.type === 'set_lineup' || a.type === 'set_formation') {
      market.openChallengeRecent = store
        .activityOf(agent.index, ['create_challenge'], since(4 * 3_600_000))
        // On the safe side: a create that failed or errored may still have left a challenge on FoxLeague (an untouched one did not).
        .some(r => (counted(r.status) || r.status === 'failed' || (r.status === 'error' && !detailOf(r).untouched)) && (detailOf(r).action as { target_user_id?: number | null } | undefined)?.target_user_id === null)
    }
    if (a.type === 'join_tournament') market.pendingJoin = store.pending(agent.index).some(p => p.kind === 'join' && (p.payload as { tournamentId?: number }).tournamentId === a.tournament_id)
    if (a.type === 'play_match' && a.match_type === 'ranked' && levelsLive(snap.config, now)) {
      market.rankedTicket = await soft(() => fox.rankedTicket(wallet))
      market.pendingTicket = store.pending(agent.index).some(p => p.kind === 'ranked_ticket')
    }
    if (a.type === 'create_tournament') {
      const held = store.pending(agent.index).find(p => p.kind === 'organizer_fee')
      if (held) market.pendingOrganizer = { hash: held.hash, total: Number((held.payload as { total?: number }).total) }
    }
    if (a.type === 'create_tournament' && organizerFeesLive(snap.config, now)) {
      market.organizerQuote = await soft(() =>
        fox.organizerFeeQuote(wallet, { format: a.format, max_teams: a.max_teams, home_and_away: Boolean(a.home_and_away), has_third_place_match: a.format === 'knockout', private: Boolean(a.invite_user_ids?.length), developer_mode: false, starts_at: new Date(now.getTime() + a.starts_in_hours * 3600_000).toISOString() }),
      )
    }
    if (a.type === 'buy') market.pendingShop = new Set(store.pending(agent.index).filter(p => p.kind === 'shop').map(p => String((p.payload as { product?: string }).product)))
    if (a.type === 'buy' && a.product === 'xp_booster') {
      // The agent's own booster purchase that may have paid (simulated, in the dry-run ledger): FoxLeague's status
      // alone reads "none active" when its own booster query fails. As for the bid limit: confirmed, unconfirmed (the
      // pending retry may have confirmed it since; the log row keeps its first status) and sent with the answer lost.
      // A refused, reverted or unsigned purchase paid nothing, and one FoxLeague refunded (the pending retry heard
      // so and credited its ledger row; the log row keeps "unconfirmed") delivered nothing and the FOXSY came back.
      const refunded = store.refundedHashes(agent.index, 'shop:xp_booster')
      const last = store
        .activityOf(agent.index, ['buy'], since((24 - XP_BOOSTER_RENEW_HOURS) * 3600_000))
        .find(r => !(r.txHash && refunded.has(r.txHash)) && (counted(r.status) || r.status === 'sent' || (r.status === 'error' && detailOf(r).sent === true)) && detailOf(r).action?.product === 'xp_booster')
      market.lastBoosterAt = last ? new Date(last.at) : null
    }
    // The level's counts (owner, 2026-11-06): the agent's own purchases of the last 7 days, on the safe side as above.
    if (a.type === 'buy' && (a.product === 'xp_booster' || a.product === 'common_pack')) {
      const refunded = store.refundedHashes(agent.index, `shop:${a.product}`)
      const bought = store
        .activityOf(agent.index, ['buy'], since(7 * 86_400_000))
        .filter(r => !(r.txHash && refunded.has(r.txHash)) && (counted(r.status) || r.status === 'sent' || (r.status === 'error' && detailOf(r).sent === true)) && detailOf(r).action?.product === a.product).length
      if (a.product === 'xp_booster') market.boostersThisWeek = bought
      else market.packsThisWeek = bought
    }
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
      // On the safe side: a bid that errored after its signature (sent, the answer lost) may have landed. An error
      // before any signature (an unreadable auction, the kill switch, a refusal released) is no bid.
      market.priorBids = store.activityOf(agent.index, ['bid'], since(48 * 3600_000)).filter(r => (counted(r.status) || r.status === 'sent' || (r.status === 'error' && detailOf(r).sent === true)) && detailOf(r).action?.nonce === a.nonce).length
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
    // An OVR range: the best XI OVR read right now (null: unreadable, refused).
    const t1 = tournament?.tournament
    const createsRange = (a.type === 'create_tournament' || a.type === 'create_challenge') && (a.ovr_min !== undefined || a.ovr_max !== undefined)
    if (createsRange || (a.type === 'join_tournament' && t1 && ((t1.ovr_min ?? null) !== null || (t1.ovr_max ?? null) !== null))) {
      const best = await soft(() => fox.bestXiOvr(wallet))
      market.bestXiOvr = typeof best?.best_xi_ovr === 'number' && Number.isFinite(best.best_xi_ovr) ? best.best_xi_ovr : null
    }
    // Widening a range: only one this agent created itself (its own live create in its log), never the owner's.
    if (a.type === 'widen_range') market.ownCreation = ownCreations(store, agent.index, now).has(a.tournament_id)
    // Leaving a League + Knockout: when its seats lock, read right now (null: unreadable, refused).
    if (a.type === 'leave_tournament' && tournament?.tournament.format === 'league_knockout') {
      const view = await soft(() => fox.leagueInvitationsView(a.tournament_id, wallet))
      const lock = view?.seats_lock_at ? Date.parse(view.seats_lock_at) : Number.NaN
      market.seatsLockAt = Number.isFinite(lock) ? new Date(lock) : null
      // The agent's own join of it (a paid one whose answer was lost too): a seat the owner took, in FoxLeague or through
      // Telegram /do (byOwner, or an owner reason on a row from before it was kept), is the owner's to leave.
      market.ownSeat = store.activityOf(agent.index, ['join_tournament'], since(60 * 86_400_000)).some(r => {
        const d = detailOf(r) as { action?: { tournament_id?: number }; byOwner?: boolean; reason?: string; sent?: boolean }
        const paid = counted(r.status) || r.status === 'sent' || (r.status === 'error' && d.sent === true)
        return paid && d.action?.tournament_id === a.tournament_id && d.byOwner !== true && !/^owner\b/i.test(String(d.reason ?? ''))
      })
    }
    // A League + Knockout seat is paid only on an invitation read right now (null: unreadable, refused).
    if (a.type === 'join_tournament' && tournament?.tournament.format === 'league_knockout') {
      const pending = await soft(() => fox.leagueInvitations(wallet))
      market.invitation = pending === null ? null : (pending.find(i => i.tournament_id === a.tournament_id) ?? 'not invited')
    }
    // The field is read only for an entry the cheap checks would allow (open, before its deadline, a seat left).
    const t0 = tournament?.tournament
    const worthReading = t0 && t0.max_teams > 2 && t0.status === 'open' && new Date(t0.deadline) > now && tournament!.participants.length < t0.max_teams && !tournament!.participants.some(p => p.user_id === snap.profile?.id)
    // Every level's join reads the field (Zeus's rule until 2026-11-06): the podium, or the knockout of a League + Knockout.
    if (a.type === 'join_tournament' && tournament && worthReading && t0.format === 'league_knockout') {
      // Judged on the invited teams, not only the seated ones; their wallets and ELO from the leaderboard.
      const view = await soft(() => fox.leagueInvitationsView(t0.id, wallet))
      const board = view ? await soft(() => fox.leaderboard(200)) : null
      if (view && board) {
        // FoxLeague's four states (league_invitations.rs): invited and accepted are the field, declined and expired are
        // not; any other state is a team it cannot judge (unread). An empty field is unread too (agent review of PR #31).
        const rows = (Array.isArray(view.invitations) ? view.invitations : []).filter(i => i.user_id !== snap.profile?.id)
        const field = rows.filter(i => i.state !== 'declined' && i.state !== 'expired').slice(0, 35)
        if (field.length) {
          market.field = await Promise.all(field.map(async i => {
            if (i.state !== 'invited' && i.state !== 'accepted') return { userId: i.user_id, strength: null, elo: null }
            const u = board.users.find(x => x.id === i.user_id)
            const strength = u?.wallet_address ? await soft(() => rivalStrength(fox, u.wallet_address)) : null
            return { userId: i.user_id, strength, elo: u?.elo_rating ?? null }
          }))
        }
      }
    } else if (a.type === 'join_tournament' && tournament && worthReading) {
      // Every seated team, not the first 32: one left out is neither judged nor counted unread (grand audit 2026-11-06, MONEY-1).
      const seated = tournament.participants.filter(p => p.user_id !== snap.profile?.id)
      market.field = await Promise.all(seated.map(async p => {
        const known = snap.leaderboardNeighbours.find(u => u.id === p.user_id)
        const elo = known?.elo_rating ?? (p.wallet_address ? (await soft(() => fox.user(p.wallet_address!)))?.elo_rating ?? null : null)
        const strength = typeof known?.strength === 'number' ? known.strength : p.wallet_address ? await soft(() => rivalStrength(fox, p.wallet_address!)) : null
        return { userId: p.user_id, strength, elo }
      }))
    }
    const starts = lastMatchStarts(store, agent.index, now)
    return {
      settings: agent.settings,
      ...(tournament !== undefined ? { tournament } : {}),
      ...(entryAmount !== undefined ? { entryAmount } : {}),
      ...market,
      lastMatchStartAt: starts.match,
      lastRankedStartAt: starts.ranked,
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
        if (v.facts.free) return none
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
        return { ...none, txs: [fusionWaiverTx(wallet.address, a.nonce, v.facts.costAtomic as bigint, 'payFusionCooldownWaiver', v.facts.days as number | undefined)] }
      case 'fusion_match_waiver':
        return { ...none, txs: [fusionWaiverTx(wallet.address, a.nonce, v.facts.costAtomic as bigint, 'payFusionMatchWaiver', a.matches)] }
      case 'play_match':
        // Only once FoxLeague asks for a ticket (live, below); simulated in a dry run.
        return v.facts.ticket === 'buy' ? { ...none, txs: [shopPayTx(v.foxsy)] } : none
      case 'create_tournament':
      case 'create_challenge': {
        // The seat is paid after the create answers with the on-chain id; nothing to simulate before. What the
        // organizer owes goes first, its hash with the create.
        const organizer = wholeToAtomic(Number(v.facts.organizerFoxsy ?? 0))
        return { ...none, txs: organizer > 0n ? [shopPayTx(organizer)] : [], notes: ['seat payment (joinTournament) follows the create'] }
      }
      default:
        return none
    }
  }

  /**
   * Saves a formation with its eleven and bench in one call (FoxLeague rc.78). Only FoxLeague's own refusal says nothing
   * was saved; after any other failure the team read back decides, and a team that cannot be read back is no save. The
   * bench counts too, as a test may change only the bench: every card named must be on it (FoxLeague completes a bench
   * of fewer than 7 itself) (audit of PR #51, R52A-M1).
   */
  private async saveEleven(wallet: AgentWallet, formation: string, lineup: number[], substitutes: number[]): Promise<void> {
    try {
      await this.d.fox.setLineup(wallet, lineup, substitutes, formation)
    } catch (err) {
      if (err instanceof ApiRefusal && !/^unexpected answer/.test(err.message)) throw err
      const team = await this.d.fox.team(wallet.address, wallet).then(t => (t && !t.hidden ? t : null), () => null)
      if (!team || team.formation !== formation || team.lineup.join(',') !== lineup.join(',')) throw err
      if (!Array.isArray(team.substitutes) || substitutes.some(n => !team.substitutes.includes(n))) throw err
    }
  }

  /**
   * Puts the team's own formation, eleven and bench back after a casual test: tried twice, then read back. Null when it
   * is back; otherwise what the next plan must do (the test formation would play every match until then).
   */
  private async putBack(wallet: AgentWallet, back: { formation: string; lineup: number[]; substitutes: number[] }, test: string): Promise<string | null> {
    let why = ''
    for (let i = 0; i < 2; i++) {
      try {
        await this.saveEleven(wallet, back.formation, back.lineup, back.substitutes)
        return null
      } catch (err) {
        why = err instanceof Error ? err.message : String(err)
      }
    }
    return `the test formation ${test} may still be saved: ${back.formation} could not be put back (${why}); put back ${back.formation} with set_formation, lineup ${back.lineup.join(',')} | bench ${back.substitutes.join(',')}`
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
   * A bid's, an entry's or a shop payment's FOXSY gets its own row tagged bid:<nonce>, join:<tournament> or
   * shop:<product>, so the budget gets it back when it is refunded (outbid, left, cancelled, a shop payment
   * FoxLeague could not use); the gas stays in an untagged row.
   */
  private book(agent: AgentRow, v: Verdict, usd: number, fees: bigint, swapUsd: number | undefined, dryRun: boolean, now: Date, snap: AgentSnapshot, a?: Action, prices?: Prices | null): Booking {
    const booking: Booking = { ids: [], sent: false }
    const gameDay = gameDayKey(now, snap.gameDay.resetHourUtc)
    // Tagged so a refund can be credited later; a created tournament gets its id once the create answers.
    const tag =
      a?.type === 'bid' ? `bid:${a.nonce}`
      : a?.type === 'play_match' ? 'shop:ranked_ticket'
      : a?.type === 'join_tournament' ? `join:${a.tournament_id}`
      : a?.type === 'create_tournament' || a?.type === 'create_challenge' ? 'join:new'
      : a?.type === 'buy' ? `shop:${a.product}`
      : null
    // The organizer's payment has its own row: a refunded seat credits the entry, never the deposit.
    const organizer = a?.type === 'create_tournament' ? wholeToAtomic(Number(v.facts.organizerFoxsy ?? 0)) : 0n
    const organizerUsd = organizer > 0n && prices ? costUsd(organizer, 0n, prices) : 0
    // Its gas with it: a sent organizer payment keeps both, whatever becomes of the seat.
    const organizerGas = organizer > 0n ? maxFeeAtomic(shopPayTx(organizer)) : 0n
    const organizerGasUsd = organizer > 0n && prices ? costUsd(0n, organizerGas, prices) : 0
    try {
      if (organizer > 0n && prices) {
        booking.organizer = { ids: [this.d.store.recordSpend({ agentIndex: agent.index, at: now, gameDay, category: v.category, action: 'shop:organizer_fee', foxsyAtomic: organizer, egldAtomic: 0n, usd: organizerUsd, txHash: null, dryRun })], sent: false }
        booking.organizer.ids.push(this.d.store.recordSpend({ agentIndex: agent.index, at: now, gameDay, category: v.category, action: '', foxsyAtomic: 0n, egldAtomic: organizerGas, usd: organizerGasUsd, txHash: null, dryRun }))
      }
      const entry = v.foxsy - organizer
      if (tag && entry > 0n && prices) {
        const foxsyUsd = costUsd(entry, 0n, prices)
        booking.ids.push(this.d.store.recordSpend({ agentIndex: agent.index, at: now, gameDay, category: v.category, action: tag, foxsyAtomic: entry, egldAtomic: 0n, usd: foxsyUsd, txHash: null, dryRun }))
        const restUsd = usd - foxsyUsd - organizerUsd - organizerGasUsd
        if (restUsd > 0) booking.ids.push(this.d.store.recordSpend({ agentIndex: agent.index, at: now, gameDay, category: v.category, action: '', foxsyAtomic: 0n, egldAtomic: fees - organizerGas, usd: restUsd, txHash: null, dryRun }))
      } else if (usd > 0 || v.foxsy > 0n) booking.ids.push(this.d.store.recordSpend({ agentIndex: agent.index, at: now, gameDay, category: v.category, action: '', foxsyAtomic: v.foxsy, egldAtomic: fees, usd, txHash: null, dryRun }))
      if (swapUsd) booking.ids.push(this.d.store.recordSpend({ agentIndex: agent.index, at: now, gameDay, category: 'swap', action: '', foxsyAtomic: 0n, egldAtomic: 0n, usd: swapUsd, txHash: null, dryRun }))
    } catch (err) {
      this.unbook(booking)
      if (booking.organizer) this.unbook(booking.organizer)
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

  /** The kill switch, a pause or a graceful stop while an action was being prepared stops it before the signature. */
  /** Why nothing more may be signed or asked for this agent now (the kill switch, a pause, a stop), or null. */
  private stopReason(agentIndex: number): string | null {
    if (this.d.store.killSwitch) return 'the kill switch was turned on'
    if (this.d.store.agent(agentIndex)?.paused) return 'the agent was paused'
    if (this.d.stopping?.()) return 'the service is stopping (a restart or a deploy)'
    return null
  }

  private assertNotStopped(agentIndex: number): void {
    const why = this.stopReason(agentIndex)
    if (why) throw new Stopped(why)
  }

  /**
   * Signs and sends; from the signature on the payment counts as possibly sent. `keep` holds its hash as a pending payment
   * from the signature on, under the hash computed here: an answer lost on the way may still have landed, so the next plan
   * must find it and not pay again.
   */
  private async send(wallet: AgentWallet, spec: TxSpec, booking: Booking, keep?: { kind: string; payload: unknown }): Promise<string> {
    const account = await this.d.chain.account(wallet.address)
    const tx = buildTransaction(spec, wallet.address, account.nonce)
    this.assertNotStopped(wallet.index)
    wallet.signTransaction(tx)
    const sentBefore = booking.sent
    booking.sent = true
    const plain = toPlain(tx)
    const held = keep ? transactionHash(plain) : null
    if (keep && held) this.d.store.addPending(held, wallet.index, keep.kind, keep.payload)
    let hash: string
    try {
      hash = await this.d.chain.send(plain)
    } catch (err) {
      // No answer at all (or an unclear one) may still have reached the network: the payment stays booked.
      if (!(err instanceof BroadcastRefused)) throw err
      // The gateway's refusal releases the booking (in the caller's catch) only when it names the transaction itself
      // and the gateway does not know the signed transaction. A nonce or duplicate answer, an unknown one, a known
      // transaction or a failed look-up: it may have gone out after all (the gateway retries another observer), so
      // it stays booked under its own hash, where the refund check can still read what became of it.
      const local = transactionHash(plain)
      if (local && err.definite && (await this.lookup(local)) === 'not_found') {
        booking.sent = sentBefore
        if (held) this.d.store.resolvePending(held, 'failed')
        throw err
      }
      if (local) this.settle(booking, local)
      throw new Error(`${err.message}; it may have gone out all the same, so it stays counted${local ? ` (transaction ${local})` : ''}`)
    }
    this.settle(booking, hash)
    if (keep) {
      // The network's hash is the one FoxLeague knows.
      if (held && held !== hash) this.d.store.resolvePending(held, 'failed')
      if (held !== hash) this.d.store.addPending(hash, wallet.index, keep.kind, keep.payload)
    }
    return hash
  }

  /** The gateway's answer for a transaction hash, or null when the look-up failed. */
  private async lookup(hash: string): Promise<'known' | 'not_found' | null> {
    try {
      return await this.d.chain.lookupTransaction(hash)
    } catch {
      return null
    }
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
      case 'set_formation': {
        if (!a.lineup) {
          await fox.setFormation(wallet, a.formation)
          applyEffect(a, v, snap, built)
          return finish('confirmed', `${desc}: saved`)
        }
        // One save (FoxLeague rc.78): the formation and its eleven are written together or not at all.
        try {
          await fox.setLineup(wallet, a.lineup, a.substitutes ?? [], a.formation)
        } catch (err) {
          // Only FoxLeague's own refusal says nothing was saved. A timeout, a 502 or an answer that is not its envelope
          // may come after the save: the team read back says.
          if (err instanceof ApiRefusal && !/^unexpected answer/.test(err.message)) throw err
          const why = err instanceof Error ? err.message : String(err)
          const team = await fox.team(wallet.address, wallet).then(t => (t && !t.hidden ? t : null), () => null)
          if (!team) return finish('error', `${desc}: save unknown (${why}) and the team could not be read back: nothing is changed blind`)
          if (team.formation !== a.formation || team.lineup.join(',') !== a.lineup.join(',')) throw err
          applyEffect(a, v, snap, built)
          return finish('confirmed', `${desc}: saved (the call answered ${why}, the team read back shows it saved)`)
        }
        applyEffect(a, v, snap, built)
        return finish('confirmed', `${desc}: saved`)
      }
      case 'set_lineup':
        await fox.setLineup(wallet, a.lineup, a.substitutes)
        applyEffect(a, v, snap, built)
        return finish('confirmed', `${desc}: saved`)
      case 'play_match': {
        const start = async (): Promise<string> => {
          let matchId: number
          let readBack = ''
          let paid: boolean | undefined
          const pressed = Date.now()
          try {
            const r = await fox.playMatch(wallet, a.match_type)
            matchId = r.match_id
            paid = r.ranked_paid
          } catch (err) {
            // Only FoxLeague's own refusal says no match started. An answer lost on the way (a timeout after its wait
            // for a match slot, a 502) may come after the start: the active match read back says (audit C2).
            if (err instanceof ApiRefusal && !/^unexpected answer/.test(err.message)) throw err
            // A read-back that fails too leaves the start unknown, which counts as a start (audit 2026-11-04, MONEY-2).
            const active = await fox.activeMatch(wallet).catch(() => {
              throw Object.assign(err instanceof Error ? err : new Error(String(err)), { startUnknown: true })
            })
            if (typeof active?.match_id !== 'number') throw err
            // The previous match still airs is no start (FoxLeague's #638: the active match read returns it, 'finished',
            // for its whole broadcast; a start is refused until then). Ours was created after the press (a minute for the
            // two clocks), or without a readable time is still being played (R85-2).
            const created = Date.parse(active.created_at)
            if (Number.isFinite(created) ? created < pressed - 60_000 : active.status !== 'pending' && active.status !== 'simulating') throw err
            matchId = active.match_id
            readBack = ` (the answer was lost: ${err instanceof Error ? err.message : String(err)}; the active match read back shows it)`
          }
          applyEffect(a, v, snap, built)
          return `${desc}: match #${matchId} started (${a.match_type})${readBack}${paid === false ? '; the AI filled it: free, and the ticket stays for the next start' : ''}`
        }
        if (a.test && snap.team) {
          // The casual test bench (owner, 2026-11-04): FoxLeague plays a casual game with the formation and eleven saved
          // at its start, so the test is saved, the game started and the team's own put back at once.
          const t = a.test
          const back = { formation: snap.team.formation, lineup: [...snap.team.lineup], substitutes: [...snap.team.substitutes] }
          const same = (x: number[], y: number[]) => x.join(',') === y.join(',')
          if (back.formation === t.formation && same(back.lineup, t.lineup) && same(back.substitutes, t.substitutes)) return finish('confirmed', await start())
          try {
            await this.saveEleven(wallet, t.formation, t.lineup, t.substitutes)
          } catch (err) {
            // Only FoxLeague's own refusal says nothing was saved; after any other failure the team's own goes back, and a
            // put-back that fails too says what the next plan must do (agent review of PR #49).
            if (!(err instanceof ApiRefusal && !/^unexpected answer/.test(err.message))) {
              const restored = await this.putBack(wallet, back, t.formation)
              if (restored) throw new Error(`${err instanceof Error ? err.message : String(err)}; ${restored}`)
            }
            throw err
          }
          let text: string
          try {
            // The kill switch, a pause or a stop between the save and the start: no game, the team's own goes back (OPEN-2).
            if (store.killSwitch) throw new Error('the kill switch was turned on during the test: no game started')
            if (store.agent(agent.index)?.paused) throw new Error('the agent was paused during the test: no game started')
            if (this.d.stopping?.()) throw new Error('the service is stopping during the test: no game started')
            text = await start()
          } catch (err) {
            const restored = await this.putBack(wallet, back, t.formation)
            if (restored) throw Object.assign(new Error(`${err instanceof Error ? err.message : String(err)}; ${restored}`), { startUnknown: (err as { startUnknown?: boolean }).startUnknown })
            throw err
          }
          const restored = await this.putBack(wallet, back, t.formation)
          return restored ? finish('error', `${text}; ${restored}`) : finish('confirmed', `${text}; ${back.formation} put back`)
        }
        if (v.facts.ticket !== 'buy') return finish('confirmed', await start())
        // Pressed first, as FoxLeague's own app does: any other gate refuses with nothing paid, and only a real need for
        // a ticket reaches the payment. A refusal here goes to the caller's catch, which releases the booking.
        try {
          const text = await start()
          this.unbook(booking)
          return finish('confirmed', text)
        } catch (err) {
          if (!(err instanceof ApiRefusal && err.code === 'ranked_ticket_required')) throw err
        }
        // Pending from the signature on: a lost answer, a stop or a crash keeps the hash, and the retry confirms it.
        const hash = await this.send(wallet, built.txs[0]!, booking, { kind: 'ranked_ticket', payload: {} })
        const outcome = await this.outcome(hash)
        if (outcome.kind === 'failed') {
          store.resolvePending(hash, 'failed')
          return finish('failed', `${desc}: ticket payment reverted (${outcome.reason})`, this.revert(booking, agent, v, fees, hash, now, snap), hash)
        }
        if (outcome.kind === 'unconfirmed') return finish('unconfirmed', `${desc}: ticket paid, outcome not read yet (${outcome.reason}); the confirm is retried, the start waits for the next plan`, usd, hash)
        try {
          await fox.buyRankedTicket(wallet, hash)
          store.resolvePending(hash, 'done')
        } catch (err) {
          // tx_pending or no answer: the same hash is confirmed again later (pending.ts), never paid twice.
          return finish('unconfirmed', `${desc}: ticket paid, confirm pending (${err instanceof Error ? err.message : err}); will retry the same hash`, usd, hash)
        }
        try {
          return finish('confirmed', `${await start()}; ${costText}`, usd, hash)
        } catch (err) {
          // No answer and no read-back: the game may have started with the ticket, so it counts as a start (R51A-1).
          if ((err as { startUnknown?: boolean }).startUnknown) return finish('error', `${desc}: ticket bought; the start got no answer and the active match could not be read (${err instanceof Error ? err.message : err}): it may have started, so it counts as a start; ${costText}`, usd, hash, { startUnknown: true })
          return finish('error', `${desc}: ticket bought but the start was refused (${err instanceof Error ? err.message : err}); the ticket stays for the next start; ${costText}`, usd, hash)
        }
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
      case 'widen_range': {
        // Only the sides the plan named: a side left out keeps its bound at FoxLeague.
        const body = { ...(a.ovr_min !== undefined ? { ovr_min: a.ovr_min } : {}), ...(a.ovr_max !== undefined ? { ovr_max: a.ovr_max } : {}) }
        const r = await fox.widenOvrRange(wallet, a.tournament_id, body)
        // The range FoxLeague answers with; the one the rules checked when the answer leaves it out.
        const side = (k: 'ovr_min' | 'ovr_max', checked: unknown) => (typeof r === 'object' && r !== null && k in r ? r[k] : checked) ?? 'any'
        return finish('confirmed', `${desc}: OVR range of T${a.tournament_id} widened to ${side('ovr_min', v.facts.min)} to ${side('ovr_max', v.facts.max)}`)
      }
      case 'join_tournament': {
        if (!built.txs.length) {
          booking.reached = true
          await fox.joinTournament(wallet, a.tournament_id)
          return finish('confirmed', `${desc}: seated (free)`)
        }
        return this.payAndJoin(agent, wallet, snap, a.tournament_id, built.txs[0]!, v, usd, fees, desc, costText, finish, now, booking)
      }
      case 'buy': {
        // Pending from the signature on, as the ranked ticket and the organizer payment (R41-3; audit 2026-11-04,
        // MONEY-1): a broadcast that may have gone out is confirmed later with its hash, never paid again.
        const order = { product: a.product, ...(a.player_nonces ? { player_nonces: a.player_nonces } : {}), ...(a.quantity ? { quantity: a.quantity } : {}) }
        const hash = await this.send(wallet, built.txs[0]!, booking, { kind: 'shop', payload: order })
        const body = { tx_hash: hash, ...order }
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
                ...(a.ovr_min !== undefined ? { ovr_min: a.ovr_min } : {}),
                ...(a.ovr_max !== undefined ? { ovr_max: a.ovr_max } : {}),
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
                // A non-empty invite list makes it private (FoxLeague's whitelist_user_ids): the one the rules kept.
                ...(Array.isArray(v.facts.invites) && v.facts.invites.length ? { whitelist_user_ids: v.facts.invites } : {}),
                // The platform fee the plan was told, as FoxLeague's own page sends it: another percent is refused before anything is written.
                // An action no plan made (Telegram /do) states the one read just now; none served, none stated.
                ...(() => {
                  const served = snap.config?.private_tournament_prize_split?.platform_fee_percent
                  return Array.isArray(v.facts.invites) && v.facts.invites.length && a.entry_fee_foxsy > 0 && typeof served === 'number' ? { expected_platform_fee_percent: v.facts.planPlatformFeePercent ?? served } : {}
                })(),
                // An OVR range the rules checked against the team's best XI OVR (FoxLeague's ovr_min / ovr_max).
                ...(a.ovr_min !== undefined ? { ovr_min: a.ovr_min } : {}),
                ...(a.ovr_max !== undefined ? { ovr_max: a.ovr_max } : {}),
              }
        // One idempotency key for the whole action (audit 2026-11-04, INTEG-1): FoxLeague stores only a create that
        // succeeded and replays it for the same key (idempotency.rs), so the same key after a refusal or a tx_pending
        // runs the create again, and after an answer lost on the way returns the tournament it made.
        const key = `agent${agent.index}-${randomUUID()}`
        const newKey = () => key
        // An earlier organizer payment no create used goes with this one: never a second payment.
        let organizerHash = typeof v.facts.organizerHash === 'string' ? v.facts.organizerHash : undefined
        if (organizerHash) body.organizer_fee_tx_hash = organizerHash
        booking.reached = true // from here a tournament or a 1v1 may exist, whatever the answer
        let created: Tournament | undefined
        if (booking.organizer && built.txs.length) {
          // Pressed first, as the ranked ticket: FoxLeague runs its other checks (the time slot too) before it asks for the
          // payment, so a refusal here costs nothing. A refusal goes to the caller's catch, which releases the bookings.
          try {
            created = await fox.createTournament(wallet, body, newKey())
            this.unbook(booking.organizer)
          } catch (err) {
            if (!(err instanceof ApiRefusal && err.code === 'organizer_fee_required')) throw err
            // Kept from the signature on, as FoxLeague's own app does: a create that does not use it leaves it for the next one.
            const hash = await this.send(wallet, built.txs[0]!, booking.organizer, { kind: 'organizer_fee', payload: { total: v.facts.organizerFoxsy } })
            const outcome = await this.outcome(hash)
            if (outcome.kind === 'failed') {
              store.resolvePending(hash, 'failed')
              this.unbook(booking)
              return finish('failed', `${desc}: organizer payment reverted (${outcome.reason})`, this.revert(booking.organizer, agent, v, maxFeeAtomic(built.txs[0]!), hash, now, snap), hash)
            }
            if (outcome.kind === 'unconfirmed') {
              this.unbook(booking)
              return finish('unconfirmed', `${desc}: organizer payment sent, not final yet (${outcome.reason}); nothing was created, and the next create of this amount uses this payment`, 0, hash)
            }
            organizerHash = hash
            body.organizer_fee_tx_hash = hash
          }
        }
        let lost = 0
        for (let i = 0; !created; i++) {
          // After the organizer payment nothing more is asked under the kill switch, a pause or a stop: a payment no create
          // uses is refunded by FoxLeague, a tournament with no seat keeps the deposit when unfilled (audit of PR #51, R52A-M2b).
          const stop = organizerHash ? this.stopReason(agent.index) : null
          if (stop) {
            this.unbook(booking)
            return finish(
              'error',
              lost
                ? `${desc}: organizer payment ${organizerHash} made, and the create got no answer; it was not asked again (${stop}): FoxLeague may have created it all the same, so the next plan reads your tournaments; if it did not, the next create of this amount uses this payment, and FoxLeague refunds one that stays unused`
                : `${desc}: organizer payment ${organizerHash} made, nothing created (${stop}); the next create of this amount uses this payment, and FoxLeague refunds one that stays unused`,
              0,
              organizerHash,
            )
          }
          try {
            created = await fox.createTournament(wallet, body, newKey())
          } catch (err) {
            if (!organizerHash) throw err
            // FoxLeague cannot verify it yet: the same hash again, never a second payment.
            if (err instanceof ApiRefusal && err.isTxPending && i < 5) {
              await sleep(6000)
              continue
            }
            // No answer is no refusal (an answer that is not FoxLeague's envelope neither, R51A-2): FoxLeague may have
            // created it, so the same create (same key) is asked again.
            const noAnswer = !(err instanceof ApiRefusal) || /^unexpected answer/.test(err.message)
            if (noAnswer && lost < 3) {
              lost++
              await sleep(6000)
              continue
            }
            const why = err instanceof ApiRefusal && !noAnswer ? `refused by FoxLeague: ${err.message}` : err instanceof Error ? err.message : String(err)
            this.unbook(booking)
            // FoxLeague committed the tournament pending on chain with this payment on it ("could not be confirmed yet ...
            // stays pending", tournaments.rs), and its reconcile opens it later: the payment is used, not refunded (grand
            // audit 2026-11-06, INTEG-2). The plan is shown a tournament it created without a seat (OPEN-8).
            if (err instanceof ApiRefusal && /could not be confirmed yet|stays pending/i.test(err.message)) {
              store.resolvePending(organizerHash, 'done')
              return finish('error', `${desc}: organizer payment ${organizerHash} made, and FoxLeague may have created it: its creation is still pending on chain (${why}); the payment is on that tournament, not refunded, so the next plan reads your tournaments`, 0, organizerHash)
            }
            // An answer that settles the hash (used or refunded): it is forgotten, and a refunded one stops counting.
            if (err instanceof ApiRefusal && !err.isTxPending && SHOP_FINAL.test(err.message)) {
              store.resolvePending(organizerHash, 'done')
              if (SHOP_REFUNDED.test(err.message)) creditShopPayment(store, agent.index, organizerHash)
              return finish('error', `${desc}: organizer payment ${organizerHash} cannot be used: ${why}`, 0, organizerHash)
            }
            if (noAnswer) return finish('error', `${desc}: organizer payment ${organizerHash} made, and the create got no answer (${why}): FoxLeague may have created it all the same, so the next plan reads your tournaments; if it did not, the next create of this amount uses this payment, and FoxLeague refunds one that stays unused`, 0, organizerHash)
            return finish('error', `${desc}: organizer payment ${organizerHash} made, nothing created: ${why}; the next create of this amount uses this payment, and FoxLeague refunds one that stays unused`, 0, organizerHash)
          }
        }
        if (organizerHash) store.resolvePending(organizerHash, 'done')
        store.retagSpend(booking.ids, 'join:new', `join:${created.id}`)
        // Its row keeps the id it made, whatever comes after: what this agent created itself (ownCreations).
        const done: typeof finish = (st, summary, cost, hash, extra) => finish(st, summary, cost, hash, { ...((extra as object) ?? {}), createdTournamentId: created.id })
        try {
          let detail: TournamentDetail | undefined
          for (let i = 0; i < 20; i++) {
            detail = await fox.tournament(created.id, wallet)
            if (detail.tournament.status === 'open' && detail.tournament.sc_tournament_id !== null) break
            await sleep(3000)
          }
          if (!detail || detail.tournament.sc_tournament_id === null) {
            // Nothing was signed for the seat: it is not spent (it would otherwise stay counted until the tournament ends).
            if (!booking.sent) this.unbook(booking)
            return done('error', `${desc}: created T${created.id} but it is not on chain yet; seat not paid`)
          }
          const spec = joinTournamentTx(detail.tournament.sc_tournament_id, v.foxsy - wholeToAtomic(Number(v.facts.organizerFoxsy ?? 0)))
          return await this.payAndJoin(agent, wallet, snap, created.id, spec, v, usd, fees, `${desc} (T${created.id})`, costText, done, now, booking)
        } catch (err) {
          // Anything after the create (the kill switch, a pause or a stop before the seat's signature, a read that fails):
          // the row keeps the tournament it made and says it exists (audit of PR #51, R52A-M2a). The bookings as in the
          // caller's catch: a seat not signed is released, one signed stays counted.
          if (!booking.sent) this.unbook(booking)
          if (booking.organizer && !booking.organizer.sent) this.unbook(booking.organizer)
          const why = err instanceof Stopped ? `${err.reason} before the seat was signed` : err instanceof ApiRefusal ? `refused by FoxLeague: ${err.message}` : err instanceof Error ? err.message : String(err)
          const paid = organizerHash ? ` with organizer payment ${organizerHash}` : ''
          return done('error', booking.sent
            ? `${desc}: created T${created.id}${paid}; the seat payment: ${why}`
            : `${desc}: created T${created.id}${paid}, its seat not paid: ${why}; T${created.id} waits with no seat of yours${organizerHash ? ' (unfilled at its deadline it keeps the organizer\'s deposit)' : ''}`, 0, organizerHash)
        }
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
    // Pending from the signature on (R41-3; audit 2026-11-04, MONEY-1): a broadcast that may have gone out, a stop or a
    // crash in the outcome wait (up to 2 min) keeps the hash, so the pending retry (src/executor/pending.ts) confirms this
    // seat with it and the next plan does not pay it again.
    const hash = await this.send(wallet, spec, booking, { kind: 'join', payload: { tournamentId } })
    const outcome = await this.outcome(hash)
    if (outcome.kind === 'failed') {
      this.d.store.resolvePending(hash, 'failed')
      return finish('failed', `${desc}: seat payment reverted (${outcome.reason})`, this.revert(booking, agent, v, fees, hash, now, snap), hash)
    }
    let withHash = true
    for (let i = 0; i < 6; i++) {
      try {
        const r = await this.d.fox.joinTournament(wallet, tournamentId, withHash ? hash : undefined)
        this.d.store.resolvePending(hash, 'done')
        return finish('confirmed', `${desc}: seated${r.condition_warning ? ` (${r.condition_warning})` : ''}; ${costText}`, usd, hash)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // FoxLeague answers a wallet that holds the seat this way before any other gate (tournaments.rs
        // join_seated_before_status): after a lost answer the seat is the fact (audit 2026-11-04, INTEG-2).
        if (/already in this tournament/i.test(msg)) {
          this.d.store.resolvePending(hash, 'done')
          return finish('confirmed', `${desc}: seated (FoxLeague answers that the team is already in it, after an answer lost on the way); ${costText}`, usd, hash)
        }
        if (/Do NOT pay again/i.test(msg)) withHash = false
        else if (!retryable(err, /not confirmed on chain yet|retry/i)) return finish('error', `${desc}: paid ${hash} but not seated: ${msg} (FoxLeague refunds an unseated entry; the creator of a 1v1 is seated from it instead)`, usd, hash)
        await sleep(6000)
      }
    }
    return finish('unconfirmed', `${desc}: paid ${hash}, seat not confirmed yet; the join is retried with the same hash, never paid again`, usd, hash)
  }
}

/** The kill switch, a pause or a stop before a signature: nothing was sent. */
class Stopped extends Error {
  readonly reason: string
  constructor(reason: string) {
    super(`${reason} before signing: nothing sent`)
    this.reason = reason
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

const txComputer = new TransactionComputer()

/** The hash of the signed transaction a broadcast carried, computed locally as the network does; null when it cannot be. */
function transactionHash(plain: PlainTx): string | null {
  try {
    return txComputer.computeTransactionHash(Transaction.newFromPlainObject(plain))
  } catch {
    return null
  }
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
    case 'set_formation': return a.lineup ? `POST /api/teams/lineup {formation: ${a.formation}}` : `POST /api/teams/formation {formation: ${a.formation}}`
    case 'set_lineup': return 'POST /api/teams/lineup'
    case 'play_match': return a.test ? `POST /api/teams/lineup {formation: ${a.test.formation}}, POST /api/matches/play {match_type: casual}, POST /api/teams/lineup (the team's own back)` : `POST /api/matches/play {match_type: ${a.match_type}}`
    case 'join_tournament': return `POST /api/tournaments/${a.tournament_id}/join`
    case 'leave_tournament': return `POST /api/tournaments/${a.tournament_id}/leave (and /cancel for your own unaccepted 1v1)`
    case 'widen_range': return `POST /api/tournaments/${a.tournament_id}/ovr-range`
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
    case 'set_lineup':
      if (s.team && a.type === 'set_formation') s.team.formation = a.formation
      if (s.team && a.lineup) {
        const substitutes = a.substitutes ?? []
        s.team.lineup = [...a.lineup]
        s.team.substitutes = [...substitutes]
        for (const p of s.players) {
          const slot = a.lineup.indexOf(p.nonce)
          p.role = slot >= 0 ? 'starter' : substitutes.includes(p.nonce) ? 'bench' : 'reserve'
          if (slot >= 0) p.slot = slot
          else delete p.slot
        }
      }
      break
    case 'play_match':
      if (s.auth?.allowance) s.auth.allowance.today_count++
      // A casual test is played by its own eleven; the team's own is back afterwards.
      for (const n of a.test?.lineup ?? s.team?.lineup ?? []) {
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
      // As the contract sets it: earlier by the days bought, never inside the 3-day floor.
      const p = card(a.nonce)
      const floor = Date.now() + 3 * 86_400_000
      if (p) p.fusionReadyAt = new Date(a.days && p.fusionReadyAt ? Math.max(Date.parse(p.fusionReadyAt) - a.days * 86_400_000, floor) : floor).toISOString()
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
      if (a.product === 'xp_booster' && s.auth?.shop) {
        s.auth.shop.xp_booster_active = true
        s.auth.shop.xp_booster_expires_at = new Date(Date.now() + 86_400_000).toISOString()
      }
      break
    default:
      break
  }
}

export function formatResult(agentIndex: number, r: ExecutionResult): string {
  const icon = { dry_run: '[dry]', refused: '[refused]', confirmed: '[ok]', failed: '[FAILED]', unconfirmed: '[pending]', error: '[ERROR]' }[r.status]
  return `${agentName(agentIndex)} ${icon} ${r.summary}${r.txHash ? `\nhttps://explorer.multiversx.com/transactions/${r.txHash}` : ''}${r.reason ? `\nwhy: ${r.reason}` : ''}`
}
