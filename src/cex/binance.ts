// Binance, for the EGLD top-ups the owner approves on Telegram. The key may only read and withdraw, from one IP
// (setup/keys.ts checks it). Reads EGLD's network and the spot balance, asks whether the Travel Rule applies,
// and withdraws to one agent wallet. Never trades and never moves funds inside Binance.

import { createHmac } from 'node:crypto'

const BASE = 'https://api.binance.com'

export interface BinanceKey {
  apiKey: string
  secret: string
}

/**
 * A refusal Binance answered (`answered`: it read the request and said no, so nothing was withdrawn), or a
 * call that got no clear answer (a timeout, a dropped connection, a 5xx): then a withdrawal may have gone out.
 */
export class BinanceError extends Error {
  readonly code: number | undefined
  readonly answered: boolean
  constructor(message: string, code: number | undefined, answered: boolean) {
    super(message)
    this.code = code
    this.answered = answered
  }
}

/** A signed (USER_DATA) call: the parameters, a timestamp and their HMAC-SHA256, in the query or the form body. */
async function signed<T>(k: BinanceKey, method: 'GET' | 'POST', path: string, params: Record<string, string> = {}): Promise<T> {
  const query = new URLSearchParams({ ...params, timestamp: String(Date.now()), recvWindow: '10000' }).toString()
  const payload = `${query}&signature=${createHmac('sha256', k.secret).update(query).digest('hex')}`
  let res: Response
  try {
    res = await fetch(method === 'GET' ? `${BASE}${path}?${payload}` : `${BASE}${path}`, {
      method,
      headers: { 'X-MBX-APIKEY': k.apiKey, ...(method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: method === 'POST' ? payload : undefined,
      signal: AbortSignal.timeout(20_000),
    })
  } catch (err) {
    throw new BinanceError(`Binance did not answer (${err instanceof Error ? err.message : String(err)})`, undefined, false)
  }
  let json: unknown
  try {
    json = await res.json()
  } catch {
    throw new BinanceError(`Binance answered HTTP ${res.status} without JSON`, undefined, res.status < 500)
  }
  const e = json as { code?: unknown; msg?: unknown }
  if (!res.ok || (typeof e.code === 'number' && e.code < 0)) {
    // A 4xx is Binance reading the request and refusing it; a 5xx may hide a request it went on to process.
    throw new BinanceError(typeof e.msg === 'string' ? e.msg : `HTTP ${res.status}`, typeof e.code === 'number' ? e.code : undefined, res.status < 500)
  }
  return json as T
}

/** EGLD on Binance: the spot balance and the MultiversX network's withdrawal terms, as numbers of EGLD. */
export interface EgldOnBinance {
  free: number
  network: string
  withdrawEnable: boolean
  fee: number
  min: number
  max: number
  /** Amounts are whole multiples of this. */
  multiple: number
}

interface CoinInfo {
  coin: string
  free: string
  networkList: { network: string; name: string; withdrawEnable: boolean; withdrawFee: string; withdrawMin: string; withdrawMax: string; withdrawIntegerMultiple: string }[]
}

/** GET /sapi/v1/capital/config/getall, narrowed to EGLD on the MultiversX network. */
export async function egldOnBinance(k: BinanceKey): Promise<EgldOnBinance> {
  const coins = await signed<CoinInfo[]>(k, 'GET', '/sapi/v1/capital/config/getall')
  const egld = Array.isArray(coins) ? coins.find(c => c.coin === 'EGLD') : undefined
  if (!egld) throw new BinanceError('Binance lists no EGLD for this account', undefined, true)
  const net = egld.networkList.find(n => n.network === 'EGLD') ?? egld.networkList.find(n => /multiversx|elrond/i.test(n.name))
  if (!net) throw new BinanceError('Binance has no MultiversX network for EGLD', undefined, true)
  const num = (s: string) => {
    const v = Number(s)
    if (!Number.isFinite(v) || v < 0) throw new BinanceError(`Binance answered an unreadable EGLD value (${s})`, undefined, true)
    return v
  }
  return { free: num(egld.free), network: net.network, withdrawEnable: net.withdrawEnable === true, fee: num(net.withdrawFee), min: num(net.withdrawMin), max: num(net.withdrawMax), multiple: num(net.withdrawIntegerMultiple) || 1e-8 }
}

/**
 * The country whose Travel Rule questionnaire Binance asks for this account's withdrawals, or 'NIL' when none.
 * An account that cannot answer is taken as NIL: a withdrawal that needs the questionnaire is refused by Binance,
 * so nothing moves.
 */
export async function travelRuleCountry(k: BinanceKey): Promise<string> {
  try {
    const r = await signed<{ questionnaireCountryCode?: string }>(k, 'GET', '/sapi/v1/localentity/questionnaire-requirements')
    return (r.questionnaireCountryCode ?? 'NIL').toUpperCase()
  } catch (err) {
    if (err instanceof BinanceError && err.answered) return 'NIL'
    throw err
  }
}

/** The EU countries, where Binance asks one questionnaire for every withdrawal. */
const EU = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'])

/**
 * The questionnaire for a withdrawal to the owner's own wallet: none outside the Travel Rule, the EU form (sent to
 * myself, to a private wallet, as an individual or a company) inside it. Any other country is not supported yet.
 */
export function questionnaireFor(country: string, accountType: 'individual' | 'corporate' | undefined): { questionnaire?: string } | { refusal: string } {
  if (country === 'NIL') return {}
  if (!EU.has(country)) return { refusal: `Binance asks the Travel Rule questionnaire of ${country} for withdrawals, which the agent does not fill in yet: top up by hand on Binance` }
  if (!accountType) return { refusal: 'Binance asks the EU Travel Rule questionnaire: set BINANCE_ACCOUNT_TYPE to individual or corporate (whose Binance account it is) in the env file, restart, then ask again with /topup N' }
  return { questionnaire: JSON.stringify({ isAddressOwner: 1, bnfType: accountType === 'corporate' ? 1 : 0, sendTo: 1, declaration: true }) }
}

/**
 * Withdraws EGLD from the spot wallet to one address on the MultiversX network. `orderId` is Binance's
 * withdrawOrderId, so the withdrawal can be found again (findWithdrawal) when the answer was lost.
 */
export async function withdrawEgld(k: BinanceKey, w: { address: string; amount: string; orderId: string; network: string; questionnaire?: string }): Promise<string> {
  const params = { coin: 'EGLD', network: w.network, address: w.address, amount: w.amount, withdrawOrderId: w.orderId, walletType: '0' }
  if (w.questionnaire) {
    const r = await signed<{ trId?: number | string; accepted?: boolean; info?: string }>(k, 'POST', '/sapi/v1/localentity/withdraw/apply', { ...params, questionnaire: w.questionnaire })
    if (r.accepted !== true) throw new BinanceError(`Binance did not accept the withdrawal: ${r.info ?? 'no reason given'}`, undefined, true)
    return String(r.trId ?? '')
  }
  const r = await signed<{ id?: string }>(k, 'POST', '/sapi/v1/capital/withdraw/apply', params)
  if (!r.id) throw new BinanceError('Binance answered the withdrawal without an id', undefined, false)
  return r.id
}

/** Whether an address is on the account's withdrawal whitelist for EGLD (GET /sapi/v1/capital/withdraw/address/list). */
export async function whitelisted(k: BinanceKey, address: string): Promise<boolean> {
  const rows = await signed<{ address: string; coin?: string; network?: string; whiteStatus?: boolean }[]>(k, 'GET', '/sapi/v1/capital/withdraw/address/list')
  return (Array.isArray(rows) ? rows : []).some(r => r.address === address && (r.coin === undefined || r.coin === 'EGLD') && r.whiteStatus === true)
}

/** A withdrawal of the last 7 days by its withdrawOrderId, or null when Binance has none. */
export async function findWithdrawal(k: BinanceKey, orderId: string): Promise<{ id: string; status: number; amount: string; txId?: string } | null> {
  const rows = await signed<{ id: string; status: number; amount: string; txId?: string; withdrawOrderId?: string }[]>(k, 'GET', '/sapi/v1/capital/withdraw/history', { coin: 'EGLD', withdrawOrderId: orderId })
  return (Array.isArray(rows) ? rows : []).find(r => r.withdrawOrderId === orderId) ?? null
}

/**
 * The amount to withdraw, in EGLD as Binance takes it: what the agent should receive plus the network fee, rounded
 * up to Binance's multiple, at least its minimum. Null when Binance would refuse it (over its maximum).
 */
export function withdrawalAmount(receiveEgld: number, net: Pick<EgldOnBinance, 'fee' | 'min' | 'max' | 'multiple'>): number | null {
  // A float near a whole number of steps is that number (0.28 / 1e-8 is 27999999.999999996, not 28000000 plus one).
  const q = (receiveEgld + net.fee) / net.multiple
  const steps = Math.abs(q - Math.round(q)) < 1e-6 ? Math.round(q) : Math.ceil(q)
  const amount = Math.max(net.min, Number((steps * net.multiple).toFixed(8)))
  return amount > net.max && net.max > 0 ? null : amount
}

/** An EGLD amount as Binance reads it: at most 8 decimals, no trailing zeros. */
export function egldText(v: number): string {
  return v.toFixed(8).replace(/\.?0+$/, '')
}
