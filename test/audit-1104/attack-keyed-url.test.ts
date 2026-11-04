// Audit 2026-11-04 (five Fable 5.1 reviewers at max effort, PRs #29 to #50): the proof of a finding, failing before its fix.
// ATTACK candidate: a credential embedded in a configured base URL (MVX_GATEWAY_URL, MVX_API_URL, FOXLEAGUE_URL) is
// copied into the snapshot's warnings by HttpError, and from there into the dashboard JSON, the activity log and the
// plan prompt (the digest's WARNING lines go to Anthropic).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

const W = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const { Chain } = await import(`${W}/src/chain/gateway.ts`)
const { takeSnapshot } = await import(`${W}/src/snapshot/snapshot.ts`)
const { renderDigest } = await import(`${W}/src/snapshot/digest.ts`)
const { Sessions, hashPassword } = await import(`${W}/src/web/auth.ts`)
const { ADDR } = await import(`${W}/test/fixtures.ts`)

const KEY = 'sk-provider-9f3a7c2e1b'
// A provider that answers 500 on every route (a bad day), at a base URL that carries the owner's project key in its path.
async function upstream500() {
  const server = createServer((_req, res) => { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('upstream error') })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/${KEY}` }
}

test('ATTACK-1: a key in the gateway URL lands in the snapshot warnings and the digest (the prompt)', async () => {
  const { server, base } = await upstream500()
  try {
    const chain = new Chain({ gatewayUrl: base, apiUrl: base, gatewayRps: 50, apiRps: 50 })
    const fox = new Proxy({}, { get: () => () => { throw new Error('fox down') } }) as never
    const snap = await takeSnapshot({ chain, fox }, { watch: ADDR } as never)
    const warnings = snap.warnings.join('\n')
    assert.ok(warnings.length > 0, 'the failed reads leave warnings')
    assert.ok(!warnings.includes(KEY), `the configured URL's key is in a warning: ${warnings.split('\n').find((w: string) => w.includes(KEY))}`)
    assert.ok(!renderDigest(snap).includes(KEY), 'the digest (sent to the model) carries the key')
  } finally {
    server.close()
  }
})

test('ATTACK-1: the same warning is served by /api/state to the dashboard (FoxLeague URL too)', async () => {
  const { Service } = await import(`${W}/src/service.ts`)
  const { startWeb } = await import(`${W}/src/web/server.ts`)
  const { server: up, base } = await upstream500()
  const svc = new Service({
    mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', dataDir: mkdtempSync(join(tmpdir(), 'foxagent-')),
    gatewayUrl: base, apiUrl: base, foxleagueUrl: base, gatewayRps: 50, apiRps: 50, foxleagueRps: 50,
    anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined, isServer: false, defaultDryRun: true, maxAgents: 5,
  } as never)
  svc.ensureAgents()
  ;(svc as unknown as { schedule: unknown }).schedule = () => undefined
  const creds = { username: 'admin', passwordHash: hashPassword('pw'), secretKey: 'k'.repeat(64) }
  const server = startWeb(svc, creds, 0)
  if (!server.listening) await once(server, 'listening')
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const cookie = new Sessions(creds.secretKey, creds.passwordHash).issue('admin')
  try {
    await svc.refreshSnapshot(0)
    const body = await (await fetch(`${url}/api/state`, { headers: { cookie: `foxagent_session=${cookie}` } })).text()
    const at = body.indexOf(KEY)
    assert.equal(at, -1, `/api/state carries the key from the configured URL: ...${body.slice(Math.max(0, at - 100), at + KEY.length + 10)}...`)
  } finally {
    server.close()
    up.close()
  }
})
