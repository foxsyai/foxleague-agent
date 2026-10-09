// Top-ups the owner approves: when an agent runs low on funds (or on /topup N), Telegram shows what it has, its
// warning level, the EGLD proposed from Binance (enough to bring it to its monthly budget) and a one-time code.
// /topup <code> [EGLD] withdraws it from Binance to that agent's own wallet. Nothing moves without the code.

import { createHash, randomInt, randomBytes } from 'node:crypto'
import type { AgentRow, Store } from './store/db.ts'
import { agentName } from './names.ts'
import { BinanceError, egldText, questionnaireFor, withdrawalAmount, type BinanceKey, type EgldOnBinance } from './cex/binance.ts'

/** A code works for this long. */
export const TOPUP_CODE_MINUTES = 60
/** An agent that stays low is offered a top-up again after this long (an owner's /topup N asks at once). */
const REOFFER_HOURS = 24
const KEPT = 50

export interface TopUpRequest {
  /** Also Binance's withdrawOrderId, to find the withdrawal again. */
  id: string
  agentIndex: number
  address: string
  codeHash: string
  /** EGLD Binance withdraws (its network fee included) and about what arrives. */
  withdrawEgld: number
  receiveEgld: number
  feeEgld: number
  playableUsd: number
  warningUsd: number
  targetUsd: number
  egldUsd: number
  createdAt: string
  expiresAt: string
  status: 'open' | 'sending' | 'sent' | 'failed' | 'expired' | 'unknown'
  binanceId?: string
  note?: string
}

export interface TopUpDeps {
  store: Store
  key: () => BinanceKey | null
  accountType: () => 'individual' | 'corporate' | undefined
  /** Platform live and this server allowed to sign: top-ups follow the one mode. */
  live: () => boolean
  binance: {
    egldOnBinance: (k: BinanceKey) => Promise<EgldOnBinance>
    travelRuleCountry: (k: BinanceKey) => Promise<string>
    withdrawEgld: (k: BinanceKey, w: { address: string; amount: string; orderId: string; network: string; questionnaire?: string }) => Promise<string>
    findWithdrawal: (k: BinanceKey, orderId: string) => Promise<{ id: string; status: number } | null>
    /** Whether the address is on the account's withdrawal whitelist (MultiversX network). */
    whitelisted: (k: BinanceKey, address: string) => Promise<boolean>
  }
  /** Straight to the owner's Telegram chat: the code never goes to the log. */
  send: (text: string) => void
  now?: () => number
  /** Before asking Binance again about a withdrawal that got no answer. */
  wait?: (ms: number) => Promise<void>
}

const hash = (id: string, code: string) => createHash('sha256').update(`${id}:${code}`).digest('hex')
const usd = (v: number) => `$${v.toFixed(2)}`
const egld = (v: number) => `${egldText(v)} EGLD`

export class TopUps {
  private readonly d: TopUpDeps
  constructor(deps: TopUpDeps) {
    this.d = deps
  }

  private now(): number {
    return this.d.now?.() ?? Date.now()
  }

  private all(): TopUpRequest[] {
    try {
      const v: unknown = JSON.parse(this.d.store.getKv('topups') ?? '[]')
      return Array.isArray(v) ? (v as TopUpRequest[]) : []
    } catch {
      return []
    }
  }

  private save(list: TopUpRequest[]): void {
    this.d.store.setKv('topups', JSON.stringify(list.slice(-KEPT)))
  }

  private update(id: string, patch: Partial<TopUpRequest>): TopUpRequest {
    const list = this.all()
    const r = list.find(x => x.id === id)
    if (!r) throw new Error('this top-up request is gone')
    Object.assign(r, patch)
    this.save(list)
    return r
  }

  /** Open requests past their time become expired. */
  private expire(): TopUpRequest[] {
    const list = this.all()
    let changed = false
    for (const r of list) if (r.status === 'open' && new Date(r.expiresAt).getTime() <= this.now()) (r.status = 'expired'), (changed = true)
    if (changed) this.save(list)
    return list
  }

  /** Why no top-up can be offered or approved now, or null. */
  private blocked(): string | null {
    if (!this.d.key()) return 'no Binance key is set (Keys in the dashboard)'
    if (!this.d.live()) return 'top-ups happen only in LIVE mode'
    if (this.d.store.killSwitch) return 'the kill switch is on'
    return null
  }

  /** No approval is talking to Binance right now (a graceful stop waits for this). */
  get idle(): boolean {
    return this.inflight === 0
  }
  private inflight = 0

  /**
   * Requests whose withdrawal outcome is not known yet ('sending' after a restart, 'unknown' after a lost answer):
   * looked up on Binance by their order id. Found: sent, or failed when Binance cancelled, rejected or failed it.
   * Not found 30 minutes on: it never went out. Answers one line per request settled.
   */
  async settleUnclear(agentIndex?: number): Promise<string[]> {
    const k = this.d.key()
    if (!k) return []
    const out: string[] = []
    for (const r of this.all().filter(x => (x.status === 'sending' || x.status === 'unknown') && (agentIndex === undefined || x.agentIndex === agentIndex))) {
      // One being sent right now is the approval's own business.
      if (this.claimed.has(r.id)) continue
      const found = await this.d.binance.findWithdrawal(k, r.id).catch(() => undefined)
      if (found === undefined) continue
      if (found && [0, 2, 4, 6].includes(found.status)) {
        this.update(r.id, { status: 'sent', binanceId: found.id })
        this.d.store.log({ agentIndex: r.agentIndex, kind: 'topup', status: 'confirmed', summary: `top-up order ${r.id} found on Binance (status ${found.status}): sent` })
        out.push(`${agentName(r.agentIndex)}: the top-up of order ${r.id} did go out (Binance id ${found.id}).`)
      } else if (found) {
        this.update(r.id, { status: 'failed', binanceId: found.id, note: `Binance status ${found.status}` })
        this.d.store.log({ agentIndex: r.agentIndex, kind: 'topup', status: 'failed', summary: `top-up order ${r.id}: Binance ${found.status === 1 ? 'cancelled' : found.status === 3 ? 'rejected' : 'failed'} it` })
        out.push(`${agentName(r.agentIndex)}: Binance ${found.status === 1 ? 'cancelled' : found.status === 3 ? 'rejected' : 'failed'} the top-up of order ${r.id}; nothing arrives. Ask again with /topup ${r.agentIndex + 1}.`)
      } else if (this.now() - new Date(r.createdAt).getTime() > 30 * 60_000) {
        this.update(r.id, { status: 'failed', note: 'Binance has no withdrawal with this order id' })
        this.d.store.log({ agentIndex: r.agentIndex, kind: 'topup', status: 'failed', summary: `top-up order ${r.id}: Binance has no such withdrawal, so it never went out` })
        out.push(`${agentName(r.agentIndex)}: Binance has no withdrawal for order ${r.id}, so it never went out. Ask again with /topup ${r.agentIndex + 1}.`)
      }
    }
    return out
  }
  /** Requests an approval in this process is sending now. */
  private readonly claimed = new Set<string>()

  /** How many requests wait for their code now. */
  openCount(): number {
    return this.expire().filter(r => r.status === 'open').length
  }

  /** /topup alone: the requests still waiting for a code, after settling the unclear ones. */
  async listText(): Promise<string> {
    const settled = await this.settleUnclear()
    const list = this.expire()
    const open = list.filter(r => r.status === 'open')
    const unclear = list.filter(r => r.status === 'sending' || r.status === 'unknown')
    const lines = [
      ...settled,
      ...open.map(r => `${agentName(r.agentIndex)}: ${egld(r.withdrawEgld)} from Binance, waiting for its code until ${r.expiresAt.slice(11, 16)} UTC`),
      ...unclear.map(r => `${agentName(r.agentIndex)}: the top-up of order ${r.id} has no known outcome yet; check Binance's withdrawal history`),
    ]
    return lines.length ? lines.join('\n') : 'No top-up is waiting for approval. Ask for one with /topup N (the agent number).'
  }

  /**
   * Offers a top-up for an agent: the amount that brings what it can play with to its monthly budget. `reason`
   * low: from the low-funds warning, at most once a day per agent; owner: /topup N, at once, and a new code
   * replaces one still open (its message may have been lost).
   */
  async offer(agent: AgentRow, playableUsd: number, egldUsd: number, reason: 'low' | 'owner'): Promise<string> {
    const stop = this.blocked()
    if (stop) return `No top-up for ${agentName(agent.index)}: ${stop}.`
    if (agent.retired) return `${agentName(agent.index)} is retired: restore it first.`
    if (!(egldUsd > 0)) return `No top-up for ${agentName(agent.index)}: the EGLD price is unknown right now.`
    const settled = await this.settleUnclear(agent.index)
    if (settled.length && reason === 'owner') return settled.join('\n')
    const mine = this.expire().filter(r => r.agentIndex === agent.index)
    const unclear = mine.find(r => r.status === 'sending' || r.status === 'unknown')
    if (unclear) return `${agentName(agent.index)} has a top-up whose outcome is not known yet (order ${unclear.id}): check Binance's withdrawal history; /topup shows it again once Binance answers.`
    const open = mine.find(r => r.status === 'open')
    if (open && reason === 'low') return ''
    const last = mine.at(-1)
    if (reason === 'low' && last && this.now() - new Date(last.createdAt).getTime() < REOFFER_HOURS * 3600_000) return ''
    const target = agent.settings.monthlyBudgetUsd
    if (playableUsd >= target) return `${agentName(agent.index)} already has about ${usd(playableUsd)} to play with, at or above its monthly budget of ${usd(target)}: no top-up needed.`
    const k = this.d.key()!
    const [net, listed] = await Promise.all([this.d.binance.egldOnBinance(k), this.d.binance.whitelisted(k, agent.address).catch(() => null)])
    if (!net.withdrawEnable) return `No top-up for ${agentName(agent.index)}: Binance has EGLD withdrawals on MultiversX paused right now.`
    const receive = (target - playableUsd) / egldUsd
    const amount = withdrawalAmount(receive, net)
    if (amount === null) return `No top-up for ${agentName(agent.index)}: ${egld(receive)} is over Binance's maximum per withdrawal (${egld(net.max)}).`
    // Read again after the wait (another offer may have been made meanwhile); an owner's ask replaces an open one.
    const fresh = this.expire()
    if (fresh.some(x => x.agentIndex === agent.index && (x.status === 'sending' || x.status === 'unknown' || (x.status === 'open' && reason === 'low')))) return `${agentName(agent.index)} already has a top-up waiting for its code.`
    for (const x of fresh) if (x.agentIndex === agent.index && x.status === 'open') x.status = 'expired'
    const id = `fla${agent.index + 1}-${randomBytes(6).toString('hex')}`
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const at = new Date(this.now())
    const r: TopUpRequest = {
      id, agentIndex: agent.index, address: agent.address, codeHash: hash(id, code),
      withdrawEgld: amount, receiveEgld: Math.max(0, amount - net.fee), feeEgld: net.fee,
      playableUsd, warningUsd: agent.settings.topUpWarningUsd, targetUsd: target, egldUsd,
      createdAt: at.toISOString(), expiresAt: new Date(at.getTime() + TOPUP_CODE_MINUTES * 60_000).toISOString(), status: 'open',
    }
    this.save([...fresh, r])
    const short = amount + net.fee > net.free
    const text = [
      `${agentName(agent.index)} ${reason === 'low' ? 'needs a top-up' : 'top-up, as you asked'}.`,
      `It has about ${usd(playableUsd)} to play with (its warning is at ${usd(r.warningUsd)}), besides its ${agent.settings.egldGasReserve} EGLD gas reserve.`,
      `Proposed: ${egld(amount)} from Binance (about ${usd(amount * egldUsd)}), so it has about ${usd(target)} to play with, its monthly budget.`,
      `It arrives as about ${egld(r.receiveEgld)} after Binance's fee of ${egld(net.fee)}, at ${agent.address}.`,
      short ? `Binance holds only ${egld(net.free)} on spot right now: top it up there or approve a smaller amount.` : `Binance holds ${egld(net.free)} on spot.`,
      ...(listed === false ? ["This wallet is not on your Binance withdrawal whitelist yet: add it in Address Management (MultiversX network) before you approve."] : []),
      `To approve, send: /topup ${code}`,
      `For less, add the EGLD to withdraw: /topup ${code} 10`,
      `The code works once, for ${TOPUP_CODE_MINUTES} minutes.`,
    ].join('\n')
    this.d.store.log({ agentIndex: agent.index, kind: 'topup', status: 'info', summary: `top-up of ${egld(amount)} from Binance offered (${reason === 'low' ? 'low on funds' : "owner's request"}), waiting for the owner's code until ${r.expiresAt.slice(11, 16)} UTC` })
    // The answer to /topup N is the offer itself; a low-funds offer goes to the chat on its own.
    if (reason === 'owner') return text
    this.d.send(text)
    return `top-up offered for ${agentName(agent.index)}`
  }

  /** /topup <code> [EGLD]: the owner's approval. The request is claimed before anything is awaited, so a code works once. */
  async approve(code: string, amountArg?: string): Promise<string> {
    const list = this.expire()
    const r = list.find(x => x.status === 'open' && x.codeHash === hash(x.id, code))
    if (!r) return 'No open top-up has this code. It may have expired: ask again with /topup N (the agent number).'
    // A mistyped amount leaves the request open: the same code works with a right one.
    let amount = r.withdrawEgld
    if (amountArg !== undefined) {
      const v = Number(amountArg)
      if (!Number.isFinite(v) || v <= 0) return `"${amountArg}" is not an EGLD amount. The code still works: /topup ${code} or /topup ${code} 10`
      if (v > r.withdrawEgld) return `${egld(v)} is more than the ${egld(r.withdrawEgld)} proposed. The code still works for that much or less.`
      amount = v
    }
    this.update(r.id, { status: 'sending' })
    this.claimed.add(r.id)
    this.inflight++
    try {
      return await this.send(r, amount, amountArg !== undefined)
    } finally {
      this.inflight--
      this.claimed.delete(r.id)
    }
  }

  private async send(r: TopUpRequest, wanted: number, typed: boolean): Promise<string> {
    const fail = (why: string) => {
      this.update(r.id, { status: 'failed', note: why })
      this.d.store.log({ agentIndex: r.agentIndex, kind: 'topup', status: 'refused', summary: `top-up of ${egld(r.withdrawEgld)} not sent: ${why}` })
      return `Top-up for ${agentName(r.agentIndex)} not sent: ${why}. Nothing left Binance.`
    }
    // Something the owner can fix within the hour (Binance's minimum, its balance, the whitelist): the code stays.
    const reopen = (why: string) => {
      if (new Date(r.expiresAt).getTime() <= this.now()) return fail(why)
      this.update(r.id, { status: 'open' })
      return `Top-up for ${agentName(r.agentIndex)} not sent: ${why}. Nothing left Binance; the code still works until ${r.expiresAt.slice(11, 16)} UTC.`
    }
    const stop = this.blocked()
    if (stop) return fail(stop)
    const agent = this.d.store.agent(r.agentIndex)
    if (!agent || agent.retired || agent.address !== r.address) return fail(`${agentName(r.agentIndex)} is no longer an active agent with that wallet`)
    const k = this.d.key()!
    let questionnaire: string | undefined
    let net: EgldOnBinance
    let amount = wanted
    try {
      net = await this.d.binance.egldOnBinance(k)
      if (!net.withdrawEnable) return fail('Binance has EGLD withdrawals on MultiversX paused right now')
      if (typed && wanted < net.min) return reopen(`${egld(wanted)} is under Binance's minimum withdrawal of ${egld(net.min)}`)
      const rounded = withdrawalAmount(Math.max(0, wanted - net.fee), net)
      if (rounded === null) return fail(`over Binance's maximum per withdrawal (${egld(net.max)})`)
      amount = Math.min(rounded, r.withdrawEgld)
      if (amount < net.min) return fail(`under Binance's minimum withdrawal of ${egld(net.min)}`)
      if (amount + net.fee > net.free) return reopen(`Binance holds only ${egld(net.free)} on spot, ${egld(amount)} plus its fee needed`)
      if ((await this.d.binance.whitelisted(k, r.address)) !== true) return reopen(`${agentName(r.agentIndex)}'s wallet is not on your Binance withdrawal whitelist: add it in Address Management (MultiversX network) and switch the whitelist on`)
      const q = questionnaireFor(await this.d.binance.travelRuleCountry(k), this.d.accountType())
      if ('refusal' in q) return fail(q.refusal)
      questionnaire = q.questionnaire
    } catch (err) {
      return fail(`Binance could not be read (${err instanceof Error ? err.message : String(err)})`)
    }
    try {
      const id = await this.d.binance.withdrawEgld(k, { address: r.address, amount: egldText(amount), orderId: r.id, network: net.network, questionnaire })
      return this.sent(r, amount, id)
    } catch (err) {
      if (err instanceof BinanceError && err.answered) return fail(`Binance refused it: ${err.message}`)
      // No clear answer: the withdrawal may have gone out. Look it up by its order id; never send it again.
      await (this.d.wait ?? (ms => new Promise(res => setTimeout(res, ms))))(5000)
      const found = await this.d.binance.findWithdrawal(k, r.id).catch(() => null)
      if (found && [0, 2, 4, 6].includes(found.status)) return this.sent(r, amount, found.id)
      if (found) return fail(`Binance ${found.status === 1 ? 'cancelled' : found.status === 3 ? 'rejected' : 'failed'} it (status ${found.status})`)
      this.update(r.id, { status: 'unknown', note: err instanceof Error ? err.message : String(err) })
      this.d.store.log({ agentIndex: r.agentIndex, kind: 'topup', status: 'error', summary: `top-up of ${egld(amount)}: Binance gave no clear answer; check its withdrawal history for order ${r.id}` })
      return `Binance gave no clear answer for the top-up of ${agentName(r.agentIndex)}: the withdrawal may have gone out. Check Binance's withdrawal history for order ${r.id}; /topup tells you once Binance shows it. It is not sent again by itself.`
    }
  }

  private sent(r: TopUpRequest, amount: number, binanceId: string): string {
    this.update(r.id, { status: 'sent', binanceId, withdrawEgld: amount })
    const text = `top-up of ${egld(amount)} sent from Binance to ${agentName(r.agentIndex)} (${r.address}), Binance id ${binanceId}; it arrives in a few minutes`
    this.d.store.log({ agentIndex: r.agentIndex, kind: 'topup', status: 'confirmed', summary: text })
    return `Done: ${text}.`
  }
}
