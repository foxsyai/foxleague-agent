// Audit 2026-11-11 (Fable 5.2 reviewers at extra-high effort): the proof of ATTACK-4, failing before its fix.
// requestJson (src/util/http.ts) slept for whatever a 429/502/503/504 answer said in its Retry-After header, with
// no upper bound. One such answer from FoxLeague, the MultiversX gateway or the API (compromised, misconfigured, or
// just a CDN ban page) parked the caller for hours or days (up to 24.8 days: 2^31 ms). The caller is a snapshot
// read inside a tick (the agent stays "busy" and never plans again), an executor read under the per-agent lock, or
// the web refresh; nothing timed it out and nothing told the owner.
// Safe behaviour: a pause of up to 60 s is kept; an upstream that asks for more is not waited for, the read ends
// with its answer (as when the retries are used up); a tiny or unreadable value is never a retry without a pause.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { RateLimiter, requestJson } from '../../src/util/http.ts'

/** An upstream on 127.0.0.1 whose first answer is `status` with this Retry-After, every later one a 200. */
async function upstream(status: number, retryAfter: string) {
  const hits: number[] = []
  const server = createServer((_req, res) => {
    hits.push(Date.now())
    if (hits.length === 1) {
      res.writeHead(status, { 'retry-after': retryAfter, 'content-type': 'application/json' })
      return res.end('{"error":"slow down"}')
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"ok":true}')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const close = () => {
    server.closeAllConnections()
    server.close()
  }
  return { hits, close, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/config` }
}

/**
 * Every pause of more than 2 seconds that src/util/http.ts asks for is noted and cut to 5 ms, so the test sees how
 * long the code meant to wait without waiting for it. The timers of Node's own fetch are left alone.
 */
async function withShortTimers<T>(run: (asked: number[]) => Promise<T>): Promise<T> {
  const real = globalThis.setTimeout
  const asked: number[] = []
  globalThis.setTimeout = ((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    if (typeof ms === 'number' && ms > 2_000 && (new Error().stack ?? '').includes('/src/util/http.ts')) {
      asked.push(ms)
      return real(fn, 5, ...args)
    }
    return real(fn, ms, ...args)
  }) as typeof setTimeout
  try {
    return await run(asked)
  } finally {
    globalThis.setTimeout = real
  }
}

test('ATTACK-4 a Retry-After of one day on a 429 does not park the read for a day: the read ends at once with that answer', async () => {
  for (const [status, header] of [[429, '86400'], [503, '86400'], [429, '61'], [502, new Date(Date.now() + 86_400_000).toUTCString()]] as const) {
    const up = await upstream(status, header)
    try {
      await withShortTimers(async asked => {
        const { status: got, json } = await requestJson<unknown>(new RateLimiter(50), up.url)
        const longest = Math.max(0, ...asked)
        assert.ok(longest <= 60_000, `Retry-After "${header}": the read meant to sleep ${Math.round(longest / 3600_000)} h (${longest} ms) before asking again; a tick, an action under the agent's lock or the dashboard's refresh would hang that long`)
        assert.equal(got, status, `Retry-After "${header}": the caller gets the upstream's own answer, as when the retries are used up`)
        assert.deepEqual(json, { error: 'slow down' })
        assert.equal(up.hits.length, 1, `Retry-After "${header}": an upstream that asked for more than a minute is not asked again in this read`)
      })
    } finally {
      up.close()
    }
  }
})

test('ATTACK-4b a pause of up to a minute is kept as asked', async () => {
  for (const [header, ms] of [['30', 30_000], ['60', 60_000], [new Date(Date.now() + 40_000).toUTCString(), 38_000]] as const) {
    const up = await upstream(429, header)
    try {
      await withShortTimers(async asked => {
        const { status, json } = await requestJson<unknown>(new RateLimiter(50), up.url)
        assert.equal(status, 200)
        assert.deepEqual(json, { ok: true })
        assert.equal(up.hits.length, 2, 'asked again after the pause')
        assert.equal(asked.length, 1)
        assert.ok(asked[0]! >= ms && asked[0]! <= 60_000, `Retry-After "${header}": waited ${asked[0]} ms`)
      })
    } finally {
      up.close()
    }
  }
})

test('ATTACK-4c a tiny, zero, negative or unreadable Retry-After is never a retry without a pause: the usual back-off holds', async () => {
  for (const header of ['0.001', '-5', 'soon', '1e99', new Date(Date.now() - 3600_000).toUTCString()]) {
    const up = await upstream(503, header)
    try {
      const { status } = await requestJson<unknown>(new RateLimiter(50), up.url)
      assert.equal(status, 200, `Retry-After "${header}"`)
      assert.equal(up.hits.length, 2)
      const gap = up.hits[1]! - up.hits[0]!
      assert.ok(gap >= 450 && gap < 5_000, `Retry-After "${header}": asked again after ${gap} ms; the first back-off is half a second`)
    } finally {
      up.close()
    }
  }
})

test('ATTACK-4d a write is still never sent twice, whatever the upstream asks', async () => {
  const up = await upstream(503, '1')
  try {
    const { status } = await requestJson<unknown>(new RateLimiter(50), up.url, { method: 'POST', body: { a: 1 } })
    assert.equal(status, 503)
    assert.equal(up.hits.length, 1)
  } finally {
    up.close()
  }
})
