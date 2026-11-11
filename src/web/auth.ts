// Web UI authentication:
// scrypt password hashes in the "scrypt$salt$hash" format, HMAC-signed session cookies with
// an expiry, constant-time comparisons, per-IP exponential lockout plus a global burst limiter.
// Standard library only.

import { createHmac, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto'
import { isIPv6 } from 'node:net'

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 2 ** 15 * 8 * 2 }
export const SESSION_TTL_S = 12 * 3600
export const COOKIE_NAME = 'foxagent_session'

export function hashPassword(password: string, salt: Buffer = randomBytes(16)): string {
  const dk = scryptSync(password, salt, 32, SCRYPT)
  return `scrypt$${salt.toString('base64')}$${dk.toString('base64')}`
}

/**
 * The same check as verifyPassword, off the event loop (the login route: a flood of attempts must not stall the
 * executor, the kill switch or Telegram). Same format rules, same answers.
 */
export function verifyPasswordAsync(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return Promise.resolve(false)
  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(parts[1]!, 'base64')
    expected = Buffer.from(parts[2]!, 'base64')
  } catch {
    return Promise.resolve(false)
  }
  if (!salt.length || !expected.length) return Promise.resolve(false)
  return new Promise(resolve => {
    try {
      scrypt(password, salt, expected.length, SCRYPT, (err, dk) => resolve(!err && dk.length === expected.length && timingSafeEqual(dk, expected)))
    } catch {
      resolve(false)
    }
  })
}

/**
 * Runs jobs one at a time (a login verification holds about 32 MiB while it runs; jobs waiting hold nothing).
 * Two bounds, null = turned away (answer 429): `maxPerKey` for one client (`clientKey`), so a single source cannot take the
 * queue, and `maxInSystem` overall, large enough that a flood adds seconds of latency rather than locking the owner
 * out, small enough that the wait stays short. The login throttle still counts every failed attempt per address.
 */
export class BoundedQueue {
  private inSystem = 0
  private tail: Promise<unknown> = Promise.resolve()
  private readonly perKey = new Map<string, number>()
  private readonly maxInSystem: number
  private readonly maxPerKey: number
  constructor(maxInSystem = 32, maxPerKey = 2) {
    this.maxInSystem = maxInSystem
    this.maxPerKey = maxPerKey
  }

  run<T>(job: () => Promise<T>, key = ''): Promise<T | null> {
    if (this.inSystem >= this.maxInSystem || (this.perKey.get(key) ?? 0) >= this.maxPerKey) return Promise.resolve(null)
    this.inSystem++
    this.perKey.set(key, (this.perKey.get(key) ?? 0) + 1)
    const p = this.tail.then(job)
    this.tail = p.then(() => undefined, () => undefined)
    return p.finally(() => {
      this.inSystem--
      const left = (this.perKey.get(key) ?? 1) - 1
      if (left > 0) this.perKey.set(key, left)
      else this.perKey.delete(key)
    })
  }
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  try {
    const salt = Buffer.from(parts[1]!, 'base64')
    const expected = Buffer.from(parts[2]!, 'base64')
    if (!salt.length || !expected.length) return false
    const dk = scryptSync(password, salt, expected.length, SCRYPT)
    return timingSafeEqual(dk, expected)
  } catch {
    return false
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export interface Credentials {
  username: string
  passwordHash: string
  secretKey: string
}

export function credentialsFromEnv(): Credentials | null {
  const username = process.env.WEB_UI_USER?.trim()
  const passwordHash = process.env.WEB_UI_PASSWORD_HASH?.trim()
  const secretKey = process.env.WEB_UI_SECRET?.trim()
  return username && passwordHash && secretKey && secretKey.length >= 32 ? { username, passwordHash, secretKey } : null
}

/** Where the marks of logged-out sessions are kept between two runs of the service (the store's kv). */
export interface RevokedKeep {
  load(): string | undefined
  save(value: string): void
}

export class Sessions {
  private readonly key: Buffer
  private readonly keep: RevokedKeep | undefined
  /**
   * Logged-out sessions until they would have expired anyway (a copied cookie dies with the logout), each as a
   * keyed hash with its expiry: the session itself is a working cookie and is never kept. With `keep` the list is
   * written at every logout and read back here, so a logout outlives a restart (ATTACK-6).
   */
  private readonly revoked = new Map<string, number>()

  /** Keyed by the secret and the password hash: a new password ends every session issued before it. */
  constructor(secretKey: string, passwordHash = '', keep?: RevokedKeep) {
    this.key = passwordHash ? createHmac('sha256', secretKey).update(`sessions:${passwordHash}`).digest() : Buffer.from(secretKey)
    this.keep = keep
    if (!keep) return
    let saved: unknown = null
    try {
      saved = JSON.parse(keep.load() ?? '{}')
    } catch {
      saved = null // an unreadable list starts empty; the next logout writes a good one
    }
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return
    const now = Date.now() / 1000
    for (const [mark, exp] of Object.entries(saved)) if (typeof exp === 'number' && exp > now) this.revoked.set(mark, exp)
  }

  private sign(body: string): string {
    return createHmac('sha256', this.key).update(body).digest('hex').slice(0, 32)
  }

  /** What stands for a logged-out session in the list: nothing that could be turned back into the cookie. */
  private mark(token: string): string {
    return createHmac('sha256', this.key).update(`revoked:${token}`).digest('hex')
  }

  issue(username: string, now = Date.now()): string {
    const payload = JSON.stringify({ u: username, exp: Math.floor(now / 1000) + SESSION_TTL_S, n: randomBytes(8).toString('hex') })
    const body = Buffer.from(payload).toString('base64url')
    return `${body}.${this.sign(body)}`
  }

  revoke(token: string | undefined, now = Date.now()): void {
    if (!token || this.verify(token, now) === null) return
    for (const [t, exp] of this.revoked) if (exp < now / 1000) this.revoked.delete(t)
    this.revoked.set(this.mark(token), now / 1000 + SESSION_TTL_S)
    this.keep?.save(JSON.stringify(Object.fromEntries(this.revoked)))
  }

  /** The username of a valid, unexpired, not logged-out session, else null. */
  verify(token: string | undefined, now = Date.now()): string | null {
    if (!token || !token.includes('.') || this.revoked.has(this.mark(token))) return null
    const cut = token.lastIndexOf('.')
    const body = token.slice(0, cut)
    const sig = token.slice(cut + 1)
    if (!safeEqual(sig, this.sign(body))) return null
    let d: unknown
    try {
      d = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    } catch {
      return null
    }
    if (!d || typeof d !== 'object' || Array.isArray(d)) return null
    const o = d as { u?: unknown; exp?: unknown }
    if (typeof o.exp !== 'number' || o.exp < now / 1000) return null
    return typeof o.u === 'string' ? o.u : null
  }

  /** CSRF token bound to the session: every state-changing request must carry it. */
  csrfFor(session: string): string {
    return createHmac('sha256', this.key).update(`csrf:${session}`).digest('hex').slice(0, 32)
  }

  checkCsrf(session: string | undefined, sent: string | undefined): boolean {
    return Boolean(session && sent && safeEqual(sent, this.csrfFor(session)))
  }
}

const MAX_TRACKED_IPS = 4096
const GLOBAL_WINDOW_S = 600
const GLOBAL_MAX_FAILURES = 60
const GLOBAL_LOCKOUT_S = 60

/**
 * One client for the sign-in lockout and the password queue. An IPv4 address is its own client (also when a
 * dual-stack socket reports it as ::ffff:a.b.c.d). An IPv6 address counts as its /64: one host or one home line
 * owns all 2^64 addresses of it, so a count per address would never reach the lock (ATTACK-1). Anything that is
 * no IPv6 address is returned as it came.
 */
export function clientKey(ip: string): string {
  let s = ip.trim().toLowerCase().replace(/%.*$/, '') // a zone id (fe80::1%eth0) names the interface, not the client
  if (!isIPv6(s)) return ip
  // A dotted tail (::ffff:203.0.113.7) is the last two groups.
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s)
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number) as [number, number, number, number]
    s = `${s.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const gap = s.indexOf('::')
  const list = (part: string) => (part ? part.split(':') : [])
  const head = list(gap < 0 ? s : s.slice(0, gap))
  const tail = list(gap < 0 ? '' : s.slice(gap + 2))
  const groups = [...head, ...Array<string>(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail].map(g => parseInt(g, 16))
  if (groups.length !== 8 || groups.some(g => !Number.isInteger(g))) return ip
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [number, number, number, number, number, number, number, number]
  if (!g0 && !g1 && !g2 && !g3 && !g4 && g5 === 0xffff) return `${g6 >> 8}.${g6 & 255}.${g7 >> 8}.${g7 & 255}`
  return `${[g0, g1, g2, g3].map(g => g.toString(16)).join(':')}::/64`
}

/**
 * Exponential lockout per client (5 free attempts, then 30 s doubling up to 1 h), plus a global burst limit
 * that holds back only addresses that already failed: a dozen attackers cannot lock the owner out from
 * a clean address, and the password re-check behind a session skips it. A client is `clientKey` of its address:
 * an IPv4 address, or the /64 of an IPv6 address.
 */
export class LoginThrottle {
  private readonly fails = new Map<string, { count: number; until: number; seen: number }>()
  private recent: number[] = []
  private globalUntil = 0
  private readonly maxAttempts: number
  private readonly baseLockoutS: number

  constructor(maxAttempts = 5, baseLockoutS = 30) {
    this.maxAttempts = maxAttempts
    this.baseLockoutS = baseLockoutS
  }

  check(address: string, now = Date.now() / 1000, opts: { global?: boolean } = {}): { ok: boolean; waitS: number } {
    const f = this.fails.get(clientKey(address))
    if (opts.global !== false && f && this.globalUntil > now) return { ok: false, waitS: Math.ceil(this.globalUntil - now) }
    if (f && f.until > now) return { ok: false, waitS: Math.ceil(f.until - now) }
    return { ok: true, waitS: 0 }
  }

  recordFailure(address: string, now = Date.now() / 1000): void {
    const ip = clientKey(address)
    const count = (this.fails.get(ip)?.count ?? 0) + 1
    const until = count >= this.maxAttempts ? now + Math.min(this.baseLockoutS * 2 ** (count - this.maxAttempts), 3600) : 0
    this.fails.set(ip, { count, until, seen: now })
    this.recent = this.recent.filter(t => t > now - GLOBAL_WINDOW_S)
    this.recent.push(now)
    if (this.recent.length >= GLOBAL_MAX_FAILURES) {
      this.globalUntil = now + GLOBAL_LOCKOUT_S
      this.recent = [] // spent on this lock, so a few addresses cannot keep everyone out for good
    }
    if (this.fails.size > MAX_TRACKED_IPS) {
      // Only expired entries are dropped, oldest first: flooding cannot clear someone's lockout.
      const expired = [...this.fails.entries()].filter(([, v]) => v.until <= now).sort((a, b) => a[1].seen - b[1].seen)
      for (const [k] of expired.slice(0, this.fails.size - MAX_TRACKED_IPS / 2)) this.fails.delete(k)
    }
  }

  recordSuccess(address: string): void {
    this.fails.delete(clientKey(address))
  }
}
