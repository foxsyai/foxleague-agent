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
  /** Retries on 429, 502-504 and network errors (never on a POST that may have taken effect). */
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
    const text = await res.text()
    if ((res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) && attempt < retries) {
      const retryAfter = Number(res.headers.get('retry-after'))
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt))
      attempt++
      continue
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

function backoff(attempt: number): number {
  return Math.min(10_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250)
}
