// MultiversX reads and writes, gateway first (docs/FOXLEAGUE-INTEGRATION.md 1.5, 1.6, 3.4, 17.3).
// The public API (2 requests/s per IP) is used only for the EGLD price.

import { requestJson, RateLimiter, sleep } from '../util/http.ts'
import { b64ToString } from '../util/encoding.ts'
import { cut } from '../util/text.ts'
import type { Config } from '../config.ts'

interface GatewayEnvelope<T> {
  data: T | null
  error: string
  code: string
}

export interface AccountState {
  address: string
  nonce: number
  balance: bigint
}

export interface EsdtHolding {
  tokenIdentifier: string
  balance: bigint
  nonce: number
}

export type TxOutcome =
  | { kind: 'success' }
  | { kind: 'failed'; reason: string }
  | { kind: 'unconfirmed'; reason: string }

/** The plain JSON shape the gateway takes for send and simulate. */
export interface PlainTx {
  nonce: number
  value: string
  receiver: string
  sender: string
  gasPrice: number
  gasLimit: number
  data?: string
  chainID: string
  version: number
  options?: number
  signature: string
  relayer?: string
  relayerSignature?: string
}

export interface SimulationResult {
  ok: boolean
  /** Human summary: fail reason, signalError topics, or "success". */
  detail: string
  raw: unknown
}

/**
 * A refusal that names the transaction itself (its funds, signature, gas, data, chain or version). A nonce or
 * duplicate answer is never one: the gateway retries another observer when the first one timed out or dropped the
 * connection after it had broadcast, and by then the transaction may have executed ("lower nonce") or sit in the pool
 * ("already exists"). A refusal of unknown meaning is not one either.
 */
export function definiteRefusal(detail: string): boolean {
  if (/nonce|duplicat|already|exist|known|in pool/i.test(detail)) return false
  return /insufficient (funds|balance)|signature|gas|data field|data too|chain ?id|transaction version|invalid version|invalid value|negative value/i.test(detail)
}

/**
 * The gateway answered a broadcast with its refusal. Not always "nothing was sent" (see definiteRefusal): the
 * executor releases a booking only for a definite refusal whose transaction the gateway does not know.
 */
export class BroadcastRefused extends Error {
  readonly detail: string
  /** The refusal names the transaction itself, not its nonce or a duplicate (definiteRefusal). */
  readonly definite: boolean
  constructor(detail: string) {
    super(`broadcast refused: ${detail}`)
    this.name = 'BroadcastRefused'
    this.detail = detail
    this.definite = definiteRefusal(detail)
  }
}

/** The metachain's id in the gateway's routes (GET /network/status/4294967295). */
export const METACHAIN = 4294967295

/**
 * How old the newest block of a shard may be before the agent signs nothing (the owner's rule after the MultiversX
 * mainnet halt of 17 Nov 2026, 09:01 to about 15:00 UTC). A round lasts 600 ms on mainnet, so a shard's newest block is
 * normally under a second old. 60 s is 100 rounds: far past a few missed rounds, an observer a little behind or a
 * computer clock a few seconds off, and a halt (minutes to hours) is seen within a minute of its start.
 */
export const BLOCK_STALE_MS = 60_000
/**
 * How long a shard's reading is kept. The age is measured against the clock at every use, so a kept reading only makes
 * the block look older, never fresher: at most BLOCK_CACHE_MS on top of its age, well under BLOCK_STALE_MS.
 */
export const BLOCK_CACHE_MS = 10_000
/** No block of MultiversX mainnet is older than this (its genesis is in 2020): a smaller time is not in milliseconds. */
const FIRST_BLOCK_MS = Date.UTC(2020, 0, 1)

/**
 * The newest block's time (ms) in an answer of GET /network/status/<shard>: `erd_block_timestamp_ms`, or
 * `erd_block_timestamp` (seconds) from a gateway that serves only those. Null for anything else, and for two that
 * disagree by a second or more (one of them is not what it says).
 */
export function blockTimeMs(status: unknown): number | null {
  if (!status || typeof status !== 'object') return null
  const s = status as Record<string, unknown>
  const whole = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0
  const ms = whole(s.erd_block_timestamp_ms) ? s.erd_block_timestamp_ms : null
  const sec = whole(s.erd_block_timestamp) ? s.erd_block_timestamp : null
  if (ms !== null && sec !== null && Math.abs(ms - sec * 1000) >= 1000) return null
  const at = ms ?? (sec !== null ? sec * 1000 : null)
  return at !== null && at >= FIRST_BLOCK_MS ? at : null
}

const shardName = (shard: number) => (shard === METACHAIN ? 'the metachain' : `shard ${shard}`)
const utc = (ms: number) => `${new Date(ms).toISOString().slice(0, 19).replace('T', ' ')} UTC`
/** A span as the owner reads it: `45 s`, `3 min`, `5 h 59 min`, `2 d 3 h`. */
function span(ms: number): string {
  const min = Math.floor(ms / 60_000)
  if (min < 1) return `${Math.floor(ms / 1000)} s`
  const h = Math.floor(min / 60)
  const d = Math.floor(h / 24)
  if (d >= 1) return `${d} d${h % 24 ? ` ${h % 24} h` : ''}`
  if (h >= 1) return `${h} h${min % 60 ? ` ${min % 60} min` : ''}`
  return `${min} min`
}

/**
 * Why nothing may be signed now, in our own words, or null while every shard of `shards` has a block at most
 * BLOCK_STALE_MS old. The shards are read at once. A shard whose block time cannot be read refuses (unknown is not
 * "producing blocks", AGENTS.md rules 4 and 5), and so does one dated ahead of this computer's clock by more than the
 * threshold: then the clock or the answer is wrong, and a halt cannot be told. The next plan tries again.
 */
export async function chainHalt(chain: Pick<Chain, 'newestBlockMs'>, shards: number[], now: () => number = Date.now): Promise<string | null> {
  const reads = await Promise.all(
    [...new Set(shards)].map(async shard => {
      try {
        const at = await chain.newestBlockMs(shard)
        if (typeof at !== 'number' || !Number.isFinite(at)) throw new Error('no block time')
        return { shard, at }
      } catch (err) {
        return { shard, err: cut(err instanceof Error ? err.message : String(err), 160) }
      }
    }),
  )
  const t = now()
  for (const r of reads) {
    if ('err' in r) return `whether the MultiversX network is producing blocks could not be read (${shardName(r.shard)}: ${r.err}): nothing is signed, the next plan tries again`
  }
  for (const r of reads as { shard: number; at: number }[]) {
    if (r.at - t > BLOCK_STALE_MS) return `the newest MultiversX block of ${shardName(r.shard)} is dated ${utc(r.at)}, ahead of this computer's clock (${utc(t)}) by more than ${BLOCK_STALE_MS / 1000} s: whether the network is producing blocks cannot be told, so nothing is signed (check the computer's clock); the next plan tries again`
    if (t - r.at > BLOCK_STALE_MS) return `the MultiversX network has produced no block since ${utc(r.at)} (${shardName(r.shard)}, ${span(t - r.at)} ago): nothing is signed, the next plan tries again`
  }
  return null
}

export interface ChainOptions {
  /** Before a refused transaction is looked up, so an observer that did take it has passed it on. */
  refusalLookupDelayMs?: number
}

export class Chain {
  private readonly gw: string
  private readonly api: string
  private readonly gwLimiter: RateLimiter
  private readonly apiLimiter: RateLimiter
  private readonly refusalLookupDelayMs: number
  private priceCache: { usd: number; at: number } | undefined
  private acceptedPrice: number | undefined
  private candidatePrice: { price: number; seen: number; since: number } | undefined
  /** The newest block per shard as last read (BLOCK_CACHE_MS). */
  private readonly blocks = new Map<number, { at: number; readAt: number }>()

  constructor(cfg: Pick<Config, 'gatewayUrl' | 'apiUrl' | 'gatewayRps' | 'apiRps'>, opts: ChainOptions = {}) {
    this.gw = cfg.gatewayUrl
    this.api = cfg.apiUrl
    this.gwLimiter = new RateLimiter(cfg.gatewayRps)
    this.apiLimiter = new RateLimiter(cfg.apiRps, 2)
    this.refusalLookupDelayMs = opts.refusalLookupDelayMs ?? 3000
  }

  private async gwGet<T>(path: string): Promise<T> {
    const { status, json } = await requestJson<GatewayEnvelope<T>>(this.gwLimiter, `${this.gw}${path}`)
    if (!json || json.data === null || json.data === undefined) {
      throw new Error(`gateway ${path}: HTTP ${status} ${json?.error ?? 'no data'}`)
    }
    return json.data
  }

  async account(address: string): Promise<AccountState> {
    const d = await this.gwGet<{ account: { nonce: number; balance: string } }>(`/address/${address}`)
    return { address, nonce: d.account.nonce, balance: BigInt(d.account.balance) }
  }

  /**
   * True while the wallet's Guardian is on: the network then wants the guardian's signature next to the
   * owner's on every transaction, and an agent holds only the owner's key. (A guardian that is set but not
   * switched on does not count.)
   */
  async guarded(address: string): Promise<boolean> {
    const d = await this.gwGet<{ guardianData?: { guarded?: boolean } }>(`/address/${address}/guardian-data`)
    return d.guardianData?.guarded === true
  }

  /**
   * The time (ms) of the newest block of a shard (METACHAIN for the metachain), from the gateway's GET
   * /network/status/<shard>; kept BLOCK_CACHE_MS. Throws when it cannot be read: a failed read is never kept. Asked once
   * more at most, within 10 s a try: a gateway that does not answer refuses the signature soon, it does not hold it.
   */
  async newestBlockMs(shard: number): Promise<number> {
    const kept = this.blocks.get(shard)
    if (kept && Date.now() - kept.readAt < BLOCK_CACHE_MS) return kept.at
    const path = `/network/status/${shard}`
    const { status, json } = await requestJson<GatewayEnvelope<{ status?: unknown }>>(this.gwLimiter, `${this.gw}${path}`, { retries: 1, timeoutMs: 10_000 })
    if (!json || !json.data) throw new Error(`gateway ${path}: HTTP ${status} ${json?.error || 'no data'}`)
    const at = blockTimeMs(json.data.status)
    if (at === null) throw new Error(`gateway ${path}: no block time in the answer`)
    this.blocks.set(shard, { at, readAt: Date.now() })
    return at
  }

  /** Every ESDT and NFT the wallet holds, in one call (keys like "FXLP-6f28e5-0177"). */
  async esdts(address: string): Promise<EsdtHolding[]> {
    const d = await this.gwGet<{ esdts: Record<string, { tokenIdentifier: string; balance: string; nonce?: number }> }>(
      `/address/${address}/esdt`,
    )
    return Object.entries(d.esdts ?? {}).map(([key, v]) => ({
      tokenIdentifier: v.tokenIdentifier ?? key,
      balance: BigInt(v.balance ?? '0'),
      nonce: v.nonce ?? 0,
    }))
  }

  /** Contract view. Throws unless returnCode is "ok"; returns the base64 entries. */
  async query(scAddress: string, funcName: string, argsHex: string[] = []): Promise<string[]> {
    const { json } = await requestJson<GatewayEnvelope<{ data: { returnCode: string; returnMessage?: string; returnData: (string | null)[] | null } }>>(
      this.gwLimiter,
      `${this.gw}/vm-values/query`,
      { method: 'POST', body: { scAddress, funcName, args: argsHex }, retries: 2 },
    )
    const d = json?.data?.data
    if (!d) throw new Error(`${funcName}: no vm-values answer (${json?.error ?? 'empty'})`)
    if (d.returnCode !== 'ok') throw new Error(`${funcName}: returnCode ${d.returnCode}${d.returnMessage ? ` (${d.returnMessage})` : ''}`)
    return (d.returnData ?? []).map(x => x ?? '')
  }

  /**
   * Simulates without a valid signature (`checkSignature=false`), so a dry run never produces a
   * signed transaction. Cross-shard calls come back with a result per shard; both must pass.
   */
  async simulate(tx: PlainTx): Promise<SimulationResult> {
    const { json } = await requestJson<GatewayEnvelope<unknown>>(this.gwLimiter, `${this.gw}/transaction/simulate?checkSignature=false`, {
      method: 'POST',
      body: tx,
      retries: 2,
    })
    if (!json?.data) return { ok: false, detail: json?.error || 'simulation returned no data', raw: json }
    return interpretSimulation(json.data)
  }

  /**
   * Broadcasts a signed transaction. The gateway's own refusal (a 4xx answer with its error envelope: nonce too low,
   * insufficient funds, a bad signature) throws BroadcastRefused; whether it went out after all is the executor's to
   * decide (definite refusal and lookupTransaction). Anything else without a hash (no answer, a 5xx, an unreadable
   * body) may have reached the network and throws a plain error.
   */
  async send(tx: PlainTx): Promise<string> {
    const { status, json } = await requestJson<GatewayEnvelope<{ txHash: string }>>(this.gwLimiter, `${this.gw}/transaction/send`, {
      method: 'POST',
      body: tx,
      retries: 0,
    })
    const hash = json?.data?.txHash
    if (hash) return hash
    const detail = json?.error || 'no hash'
    if (status >= 400 && status < 500 && json && typeof json === 'object') throw new BroadcastRefused(detail)
    throw new Error(`broadcast unclear (HTTP ${status}, no hash): ${detail}`)
  }

  /**
   * Whether the gateway knows a transaction (in the pool or executed) by its hash, after a short wait. 'not_found'
   * only on the gateway's own "not found" answer; any other answer without the transaction, or no answer, throws.
   */
  async lookupTransaction(hash: string): Promise<'known' | 'not_found'> {
    if (this.refusalLookupDelayMs > 0) await sleep(this.refusalLookupDelayMs)
    const { status, json } = await requestJson<GatewayEnvelope<{ transaction?: unknown }>>(this.gwLimiter, `${this.gw}/transaction/${hash}`)
    if (json?.data?.transaction) return 'known'
    if (json && typeof json === 'object' && !json.data && /not found/i.test(json.error ?? '')) return 'not_found'
    throw new Error(`transaction ${hash}: the look-up is unclear (HTTP ${status}, ${json?.error || 'no transaction'})`)
  }

  /**
   * The web app's success rule (txFinality.ts): the envelope status is not enough, a revert on the
   * contract's shard shows only in process-status or as a signalError event. A timeout is
   * "unconfirmed", never "failed".
   */
  async waitForOutcome(hash: string, timeoutMs = 120_000): Promise<TxOutcome> {
    const deadline = Date.now() + timeoutMs
    let delay = 1500
    while (Date.now() < deadline) {
      await sleep(delay)
      delay = Math.min(4000, delay + 500)
      let status: string | undefined
      try {
        status = (await this.gwGet<{ status: string }>(`/transaction/${hash}/process-status`)).status
      } catch {
        continue // unknown hash answers 500 "transaction not found" until it lands
      }
      if (status === 'fail' || status === 'invalid') {
        return { kind: 'failed', reason: (await this.revertReason(hash)) ?? status }
      }
      if (status === 'success') {
        const reason = await this.revertReason(hash)
        return reason ? { kind: 'failed', reason } : { kind: 'success' }
      }
    }
    return { kind: 'unconfirmed', reason: `no final status within ${Math.round(timeoutMs / 1000)} s` }
  }

  /** A signalError event's message (topics[1], base64) anywhere in the transaction's results. */
  async revertReason(hash: string): Promise<string | undefined> {
    try {
      const d = await this.gwGet<{ transaction: unknown }>(`/transaction/${hash}?withResults=true`)
      return findSignalError(d.transaction)
    } catch {
      return undefined
    }
  }

  /** EGLD price in USD from the MultiversX API (cached 5 minutes). */
  /**
   * EGLD in USD, the base of every cap. An implausible value (outside $1 to $10,000, or more than 50
   * percent away from the last accepted one) is refused, so a broken or manipulated feed stops spending
   * instead of shrinking every USD cap.
   */
  async egldUsd(): Promise<number> {
    if (this.priceCache && Date.now() - this.priceCache.at < 300_000) return this.priceCache.usd
    const { json } = await requestJson<{ price?: number }>(this.apiLimiter, `${this.api}/economics`)
    const price = json?.price
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 1 || price > 10_000) throw new Error(`EGLD price unavailable or implausible (${price})`)
    const last = this.acceptedPrice
    if (last && Math.abs(price / last - 1) > 0.5) {
      // A real move is accepted once readings agree within 5 percent for at least 10 minutes (3 or more readings).
      const c = this.candidatePrice
      this.candidatePrice = c && Math.abs(price / c.price - 1) <= 0.05 ? { price, seen: c.seen + 1, since: c.since } : { price, seen: 1, since: Date.now() }
      this.priceCache = undefined
      const settled = this.candidatePrice.seen >= 3 && Date.now() - this.candidatePrice.since >= 600_000
      if (!settled) throw new Error(`EGLD price moved from $${last} to $${price} since the last reading: refusing until it settles`)
    }
    this.candidatePrice = undefined
    this.acceptedPrice = price
    this.priceCache = { usd: price, at: Date.now() }
    return price
  }
}

function findSignalError(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const x of node) {
      const r = findSignalError(x)
      if (r) return r
    }
    return undefined
  }
  const o = node as Record<string, unknown>
  if (o.identifier === 'signalError' && Array.isArray(o.topics) && typeof o.topics[1] === 'string') {
    return b64ToString(o.topics[1]) || 'signalError'
  }
  for (const v of Object.values(o)) {
    const r = findSignalError(v)
    if (r) return r
  }
  return undefined
}

/**
 * Reads the gateway's simulate answer. Intra-shard: `result` holds one execution. Cross-shard:
 * `result.senderShard` and `result.receiverShard`; the receiver shard runs the contract as if the
 * tokens had arrived, so a payment the wallet cannot cover fails only on the sender shard. Both
 * must succeed, and a missing status counts as a failure (fail closed).
 */
export function interpretSimulation(data: unknown): SimulationResult {
  const d = (data ?? {}) as Record<string, unknown>
  const result = d.result as Record<string, unknown> | undefined
  const shards: [string, Record<string, unknown>][] = []
  if (result && (result.senderShard || result.receiverShard)) {
    for (const k of ['senderShard', 'receiverShard']) {
      const r = result[k]
      if (r && typeof r === 'object') shards.push([k, r as Record<string, unknown>])
    }
  } else if (result && typeof result === 'object') {
    shards.push(['result', result])
  }
  if (shards.length === 0) return { ok: false, detail: 'unrecognised simulation answer', raw: data }
  const signal = findSignalError(data)
  if (signal) return { ok: false, detail: `revert: ${signal}`, raw: data }
  for (const [where, r] of shards) {
    if (r.status !== 'success') {
      const reason = typeof r.failReason === 'string' && r.failReason ? r.failReason : r.status === undefined ? 'no status reported' : String(r.status)
      return { ok: false, detail: `${where === 'result' ? '' : `${where}: `}${reason}`, raw: data }
    }
  }
  return { ok: true, detail: shards.length > 1 ? 'success on both shards' : 'success', raw: data }
}
