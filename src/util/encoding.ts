// Argument encoding for MultiversX transaction data fields, as the FoxLeague web app does it
// (frontend/src/lib/tournamentTxData.ts, xexchangeSwap.ts). Nothing that ends up in a signed
// transaction goes through a floating-point number.

export const ONE_TOKEN = 10n ** 18n

export function hexOfString(s: string): string {
  return Buffer.from(s, 'utf8').toString('hex')
}

/** Minimal big-endian hex of a non-negative integer, left-padded to an even length. 0 is "00". */
export function numberToHex(n: bigint | number): string {
  const v = BigInt(n)
  if (v < 0n) throw new Error(`cannot encode negative ${v}`)
  const h = v.toString(16)
  return h.length % 2 === 0 ? h : `0${h}`
}

/** A u64 as 16 hex characters (tournament ids, sync nonces). */
export function u64Hex(n: bigint | number): string {
  const v = BigInt(n)
  if (v < 0n || v >= 1n << 64n) throw new Error(`u64 out of range: ${v}`)
  return v.toString(16).padStart(16, '0')
}

/** Whole tokens (integer) to atomic units (18 decimals). */
export function wholeToAtomic(whole: bigint | number): bigint {
  if (typeof whole === 'number' && !Number.isSafeInteger(whole)) throw new Error(`not a whole amount: ${whole}`)
  return BigInt(whole) * ONE_TOKEN
}

/** Atomic units to a decimal string with `decimals` places, rounded down. */
export function formatAtomic(atomic: bigint, decimals = 4): string {
  const neg = atomic < 0n
  const abs = neg ? -atomic : atomic
  const scale = 10n ** BigInt(18 - decimals)
  const scaled = abs / scale
  const int = scaled / 10n ** BigInt(decimals)
  const frac = (scaled % 10n ** BigInt(decimals)).toString().padStart(decimals, '0')
  return `${neg ? '-' : ''}${int}${decimals > 0 ? `.${frac}` : ''}`
}

/** Atomic units to a float, for display and USD estimates only (never for signing). */
export function atomicToFloat(atomic: bigint): number {
  return Number(atomic) / 1e18
}

/** Decimal EGLD (for example "15.37") to atomic, exact. */
export function decimalToAtomic(s: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,18}))?$/.exec(s.trim())
  if (!m) throw new Error(`not a decimal amount: '${s}'`)
  return BigInt(m[1]!) * ONE_TOKEN + BigInt((m[2] ?? '').padEnd(18, '0') || '0')
}

/** A base64 vm-values return entry as an unsigned integer (empty = 0). */
export function b64ToBigInt(b64: string | null | undefined): bigint {
  if (!b64) return 0n
  const hex = Buffer.from(b64, 'base64').toString('hex')
  return hex ? BigInt(`0x${hex}`) : 0n
}

export function b64ToString(b64: string | null | undefined): string {
  return b64 ? Buffer.from(b64, 'base64').toString('utf8') : ''
}

/** Nested encoding: 4-byte big-endian length, then the bytes (hex in, hex out). */
export function nestedHex(hex: string): string {
  return (hex.length / 2).toString(16).padStart(8, '0') + hex
}
