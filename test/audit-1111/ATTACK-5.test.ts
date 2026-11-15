// Audit 2026-11-11 (Fable 5.2 reviewers at extra-high effort): the proof of ATTACK-5, failing before its fix.
// requestJson (src/util/http.ts) read an upstream answer with `await res.text()`, whatever its size. FoxLeague, the
// MultiversX gateway or the API (compromised, or a proxy in between) could answer one read with a body of hundreds
// of megabytes: the service buffered all of it (twice: the chunks, then the string) before it even tried to parse
// it. A snapshot makes a dozen reads in parallel, the dashboard's own request bodies are capped at 64 KB
// (server.ts readBody), the upstream's were not. On a small server that is an out-of-memory kill in the middle of
// whatever the agents were doing, and three of them in ten minutes end the unit (StartLimitBurst=3).
// Safe behaviour: an answer far larger than any real one is refused while it streams, not after.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { gzipSync } from 'node:zlib'
import { HttpError, RateLimiter, requestJson } from '../../src/util/http.ts'

const MB = 1024 * 1024

async function upstream(answer: (res: ServerResponse) => void) {
  const server = createServer((_req, res) => answer(res))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const close = () => {
    server.closeAllConnections()
    server.close()
  }
  return { close, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/leaderboard` }
}
const outcomeOf = async (url: string, opts: { method?: 'POST'; body?: unknown } = {}) => {
  try {
    await requestJson(new RateLimiter(50), url, { retries: 0, ...opts })
    return 'answered'
  } catch (err) {
    return `refused (${err instanceof Error ? err.message.slice(0, 120) : String(err)})`
  }
}

test('ATTACK-5 an upstream answer of 256 MB is cut off while it streams, not buffered whole', { timeout: 60_000 }, async () => {
  const TOTAL = 256 * MB
  const chunk = Buffer.alloc(MB, 0x20) // spaces: JSON whitespace, so even a streaming parser sees nothing wrong with it
  let sent = 0
  const up = await upstream(res => {
    res.writeHead(200, { 'content-type': 'application/json' })
    const pump = () => {
      while (sent < TOTAL && !res.destroyed) {
        sent += chunk.length
        if (!res.write(chunk)) return void res.once('drain', pump)
      }
      if (!res.destroyed) res.end('{"ok":true}')
    }
    pump()
  })
  const before = process.memoryUsage().rss
  const outcome = await outcomeOf(up.url)
  const grew = Math.round((process.memoryUsage().rss - before) / MB)
  up.close()
  assert.ok(sent <= 64 * MB, `the read took in ${Math.round(sent / MB)} MB of one answer before it was ${outcome} (process memory grew by about ${grew} MB); the largest real answer is a few hundred KB`)
  assert.match(outcome, /^refused \(.*too large/)
  assert.doesNotMatch(outcome, /leaderboard/, 'the refusal names the host, never the path (a base URL may carry a key)')
})

test('ATTACK-5b an answer that declares more than the cap in its content-length is refused before a byte of it is read', async () => {
  let wrote = 0
  const up = await upstream(res => {
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(9 * MB) })
    const piece = Buffer.alloc(64 * 1024, 0x20)
    const pump = () => {
      while (wrote < 9 * MB && !res.destroyed) {
        wrote += piece.length
        if (!res.write(piece)) return void res.once('drain', pump)
      }
    }
    pump()
  })
  const outcome = await outcomeOf(up.url)
  up.close()
  assert.match(outcome, /^refused \(.*too large/, outcome)
  assert.ok(wrote <= 4 * MB, `only what was already on the wire left the upstream (${Math.round(wrote / 1024)} KB)`)
})

test('ATTACK-5c a compressed answer is counted by what it unpacks to (a small gzip of 64 MB of spaces is refused)', async () => {
  const bomb = gzipSync(Buffer.alloc(64 * MB, 0x20))
  assert.ok(bomb.length < MB, 'it travels as a few KB')
  const up = await upstream(res => {
    res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': String(bomb.length) })
    res.end(bomb)
  })
  const before = process.memoryUsage().rss
  const outcome = await outcomeOf(up.url)
  const grew = Math.round((process.memoryUsage().rss - before) / MB)
  up.close()
  assert.match(outcome, /^refused \(.*too large/, `${outcome}; memory grew by about ${grew} MB`)
})

test('ATTACK-5d every caller still gets what it got: a large real answer whole, text cut across chunks, an empty body, a body that is no JSON, a write', async () => {
  // 3 MB of JSON sent in uneven pieces, with a two-byte and a four-byte character split between two pieces.
  const rows = Array.from({ length: 30_000 }, (_, i) => ({ id: i, name: `Tromsø Rovers ${i} 🦊`, note: 'x'.repeat(60) }))
  const whole = Buffer.from(JSON.stringify({ success: true, data: rows }))
  assert.ok(whole.length > 3 * MB && whole.length < 8 * MB)
  const cut = whole.indexOf(Buffer.from('ø')) + 1 // between the two bytes of ø
  const cut2 = whole.indexOf(Buffer.from('🦊'), cut) + 2 // inside the four bytes of the fox
  const big = await upstream(res => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.write(whole.subarray(0, cut))
    setTimeout(() => {
      res.write(whole.subarray(cut, cut2))
      setTimeout(() => res.end(whole.subarray(cut2)), 20)
    }, 20)
  })
  const got = await requestJson<{ success: boolean; data: typeof rows }>(new RateLimiter(50), big.url)
  big.close()
  assert.equal(got.status, 200)
  assert.deepEqual(got.json.data[0], rows[0])
  assert.deepEqual(got.json.data.at(-1), rows.at(-1))
  assert.equal(got.json.data.length, rows.length)

  // An empty body is null, with its status (a 204, a bare 404).
  const empty = await upstream(res => {
    res.writeHead(404)
    res.end()
  })
  assert.deepEqual(await requestJson(new RateLimiter(50), empty.url), { status: 404, json: null })
  empty.close()

  // A body that is no JSON is an HttpError with the status and the text (FoxLeague's plain-text 401, an error page).
  const plain = await upstream(res => {
    res.writeHead(401, { 'content-type': 'text/plain' })
    res.end('Missing bearer token')
  })
  await assert.rejects(requestJson(new RateLimiter(50), plain.url), (err: unknown) => err instanceof HttpError && err.status === 401 && err.body === 'Missing bearer token')
  plain.close()

  // A byte order mark in front of the JSON is dropped, as `res.text()` dropped it.
  const bom = await upstream(res => res.end(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"ok":true}')])))
  assert.deepEqual((await requestJson(new RateLimiter(50), bom.url)).json, { ok: true })
  bom.close()

  // A write gets its answer and its status as before.
  const write = await upstream(res => {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end('{"success":false,"error":"no"}')
  })
  assert.deepEqual(await requestJson(new RateLimiter(50), write.url, { method: 'POST', body: { a: 1 } }), { status: 400, json: { success: false, error: 'no' } })
  write.close()
})
