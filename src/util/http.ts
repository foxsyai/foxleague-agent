// Rate-limited JSON over HTTP. One limiter per upstream host is shared by every agent in the
// process: FoxLeague's edge and the MultiversX public API limit per IP, not per wallet.

/** The host of a request, never its path or query: a configured base URL may carry a provider's key (audit 2026-11-04, ATTACK-1). */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return 'the server'
  }
}

/**
 * An error page without the request's own path: an upstream may echo it ("Cannot GET /path", "The requested URL /path
 * was not found"), and with it a key in the configured base URL (audit of PR #51, R52A-I2).
 */
function withoutPath(body: string, url: string): string {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return body
  }
  const paths = [u.pathname + u.search, u.pathname]
  try {
    paths.push(decodeURIComponent(u.pathname + u.search), decodeURIComponent(u.pathname))
  } catch {
    // a malformed escape: the path as sent is removed all the same
  }
  return paths.filter(p => p.length > 1).sort((a, b) => b.length - a.length).reduce((text, p) => text.split(p).join('[path]'), body)
}

export class HttpError extends Error {
  readonly status: number
  readonly body: string
  constructor(status: number, body: string, url: string) {
    super(`HTTP ${status} from ${hostOf(url)}: ${withoutPath(body, url).slice(0, 300)}`)
    this.status = status
    this.body = body
  }
}

/** Token bucket: at most `rps` requests per second, bursts up to `burst`. */
export class RateLimiter {
  private tokens: number
  private last = Date.now()
  private queue: Promise<void> = Promise.resolve()
  private readonly rps: number
  private readonly burst: number

  constructor(rps: number, burst = Math.max(1, Math.floor(rps))) {
    this.rps = rps
    this.burst = burst
    this.tokens = burst
  }

  take(): Promise<void> {
    const next = this.queue.then(async () => {
      for (;;) {
        const now = Date.now()
        this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rps)
        this.last = now
        if (this.tokens >= 1) {
          this.tokens -= 1
          return
        }
        await sleep(Math.ceil(((1 - this.tokens) / this.rps) * 1000))
      }
    })
    this.queue = next.catch(() => undefined)
    return next
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT'
  body?: unknown
  headers?: Record<string, string>
  timeoutMs?: number
  /**
   * Retries on 429, 502-504 and network errors (never on a POST that may have taken effect). An upstream that asks
   * for a pause of more than a minute (Retry-After) is not retried: its answer comes back at once.
   */
  retries?: number
}

export async function requestJson<T>(limiter: RateLimiter, url: string, opts: RequestOptions = {}): Promise<{ status: number; json: T }> {
  const method = opts.method ?? 'GET'
  const retries = opts.retries ?? (method === 'GET' ? 3 : 0)
  let attempt = 0
  for (;;) {
    await limiter.take()
    let res: Response
    try {
      res = await fetch(url, {
        method,
        headers: {
          accept: 'application/json',
          ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
          'user-agent': 'foxleague-agent (+self-hosted FoxLeague team manager)',
          ...opts.headers,
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
      })
    } catch (err) {
      if (attempt < retries) {
        await sleep(backoff(attempt++))
        continue
      }
      throw err
    }
    const text = await readCapped(res, url)
    if ((res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) && attempt < retries) {
      const wait = retryWaitMs(res.headers.get('retry-after'), attempt)
      if (wait !== null) {
        await sleep(wait)
        attempt++
        continue
      }
      // The upstream asked for more than a minute: not waited for and not asked again, the caller gets this answer.
    }
    let json: unknown
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      throw new HttpError(res.status, text, url)
    }
    return { status: res.status, json: json as T }
  }
}

/** The most one answer may hold: far above the largest real one (a few hundred KB), far below what fills the memory. */
export const MAX_ANSWER_BYTES = 8 * 1024 * 1024

/**
 * The body as text, read as it streams and refused past MAX_ANSWER_BYTES: `res.text()` buffers whatever the upstream
 * sends, hundreds of megabytes included (ATTACK-5). A declared content-length over the cap is refused unread; a
 * compressed answer is counted by what it unpacks to. The refusal is a plain error (a failed read, like a timeout),
 * with the host and never the path.
 */
async function readCapped(res: Response, url: string): Promise<string> {
  const tooLarge = () => new Error(`answer from ${hostOf(url)} is too large (over ${MAX_ANSWER_BYTES / (1024 * 1024)} MB): not read`)
  if (Number(res.headers.get('content-length')) > MAX_ANSWER_BYTES) {
    await res.body?.cancel().catch(() => undefined)
    throw tooLarge()
  }
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_ANSWER_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw tooLarge()
    }
    chunks.push(value)
  }
  // Decoded once, whole: a character cut between two chunks stays one character, a byte order mark is dropped.
  return new TextDecoder().decode(Buffer.concat(chunks))
}

/** The longest pause an upstream's Retry-After is given, like the Telegram sender's. */
export const MAX_RETRY_AFTER_S = 60

/**
 * The pause before asking again after a 429 or a 502 to 504, or null when this read ends here.
 * The upstream's Retry-After (seconds, or an HTTP date) is kept up to a minute and is never shorter than our own
 * back-off. One that asks for more ends the read with its answer, as when the retries are used up: a read sits in a
 * tick, under an agent's lock or behind the dashboard, and a day's sleep there parks the agent with no word to the
 * owner (ATTACK-4). A value that is no number and no date counts as none.
 */
export function retryWaitMs(retryAfter: string | null, attempt: number, now = Date.now()): number | null {
  const own = backoff(attempt)
  const header = retryAfter?.trim() ?? ''
  if (!header) return own
  const askedS = /^\d+(\.\d+)?$/.test(header) ? Number(header) : (Date.parse(header) - now) / 1000
  if (Number.isNaN(askedS)) return own
  if (askedS > MAX_RETRY_AFTER_S) return null
  return Math.max(own, Math.ceil(askedS * 1000))
}

function backoff(attempt: number): number {
  return Math.min(10_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250)
}
