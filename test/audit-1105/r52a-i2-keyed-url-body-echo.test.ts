// R52A-I2 (audit of PR #51, outside surfaces): ATTACK-1 made HttpError name the host only, but it still appends the
// first 300 characters of the answer's body. An upstream that echoes the request path in its error page (Express's
// default 404 handler answers `<pre>Cannot GET /path</pre>`; Apache's default 404 says `The requested URL /path was
// not found`) puts the key of a configured base URL back into the message, and from there into the snapshot
// warnings, the digest (the prompt), the dashboard's state and the activity log, as before the fix.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'

import { Chain } from '../../src/chain/gateway.ts'
import { takeSnapshot } from '../../src/snapshot/snapshot.ts'
import { renderDigest } from '../../src/snapshot/digest.ts'
import { HttpError } from '../../src/util/http.ts'
import { ADDR } from '../fixtures.ts'

const KEY = 'sk-provider-9f3a7c2e1b'
// A provider whose base URL carries the project key in its path and whose router answers a route it does not know
// the way Express does by default (finalhandler): the request path echoed in an HTML body.
async function expressLike404() {
  const server = createServer((req, res) => {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
    res.end(`<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n</head>\n<body>\n<pre>Cannot GET ${req.url}</pre>\n</body>\n</html>\n`)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/${KEY}` }
}

test('R52A-I2: an upstream that echoes the request path in its error body puts the key back into the warnings and the digest', async () => {
  const { server, base } = await expressLike404()
  try {
    const chain = new Chain({ gatewayUrl: base, apiUrl: base, gatewayRps: 50, apiRps: 50 })
    const fox = new Proxy({}, { get: () => () => { throw new Error('fox down') } }) as never
    const snap = await takeSnapshot({ chain, fox }, { watch: ADDR } as never)
    const warnings = snap.warnings.join('\n')
    assert.ok(warnings.length > 0, 'the failed reads leave warnings')
    assert.ok(!warnings.includes(KEY), `the configured URL's key is in a warning through the echoed body: ${warnings.split('\n').find((w: string) => w.includes(KEY))}`)
    assert.ok(!renderDigest(snap).includes(KEY), 'the digest (sent to the model) carries the key')
  } finally {
    server.close()
  }
})

test('R52A-I2 control: the error keeps the status, the host and the rest of the answer', () => {
  const e = new HttpError(404, `The requested URL /v1/${KEY}/address/erd1x was not found on this server.`, `https://api.example.org/v1/${KEY}/address/erd1x`)
  assert.equal(e.message, 'HTTP 404 from api.example.org: The requested URL [path] was not found on this server.')
  assert.equal(new HttpError(502, 'Bad Gateway', 'https://api.example.org/').message, 'HTTP 502 from api.example.org: Bad Gateway')
})
