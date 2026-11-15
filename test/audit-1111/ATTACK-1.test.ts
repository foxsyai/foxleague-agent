// Audit 2026-11-11 (Fable 5.2 reviewers at extra-high effort): the proof of ATTACK-1, failing before its fix.
// The sign-in lockout and the scrypt queue's per-client bound were keyed on the full client address. Behind nginx
// (deploy/nginx-foxleague-agent.conf listens on [::] and passes X-Real-IP = $remote_addr) one IPv6 host owns a whole
// /64 (2^64 addresses): it sent every guess from a new address, so no address ever reached 5 failures, and the
// global lock (which holds back only addresses that already failed) never applied to it.
// Safe behaviour: failures from one IPv6 /64 are counted together; IPv4 stays per address.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '../../src/config.ts'
import { Service } from '../../src/service.ts'
import { LoginThrottle, hashPassword } from '../../src/web/auth.ts'
import { startWeb } from '../../src/web/server.ts'

const TEST_WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

test('ATTACK-1a (unit) five failed sign-ins from five addresses of one IPv6 /64 lock that network out', () => {
  const t = new LoginThrottle()
  const now = 1_000_000
  for (let i = 1; i <= 5; i++) t.recordFailure(`2001:db8:aa:bb::${i.toString(16)}`, now)
  const next = t.check('2001:db8:aa:bb::ffff', now + 1)
  assert.equal(next.ok, false, 'a sixth address of the same /64 (the same home line or server) is held back after five failures from that /64')
  // The same /64 written in full, with capitals and with a zone id is the same client.
  assert.equal(t.check('2001:0DB8:00aa:00bb:1234:5678:9abc:def0', now + 1).ok, false, 'the long spelling of the same /64')
  assert.equal(t.check('2001:db8:aa:bb::7%eth0', now + 1).ok, false, 'a zone id changes nothing')
  // Another network is not touched (SS2: strangers cannot lock the owner out from a clean address).
  assert.equal(t.check('2001:db8:cc:dd::1', now + 1).ok, true)
  assert.equal(t.check('2001:db8:aa:bc::1', now + 1).ok, true, 'the next /64 is another client')
  assert.equal(t.check('203.0.113.7', now + 1).ok, true)
  // The right password from any address of the /64 clears its count, as it does for one address.
  t.recordSuccess('2001:db8:aa:bb::9')
  assert.equal(t.check('2001:db8:aa:bb::ffff', now + 1).ok, true)
})

test('ATTACK-1c (unit) IPv4 stays per address, also when the socket reports it as an IPv4-mapped IPv6 address', () => {
  const t = new LoginThrottle()
  const now = 1_000_000
  for (let i = 0; i < 5; i++) t.recordFailure('203.0.113.7', now)
  assert.equal(t.check('203.0.113.7', now + 1).ok, false)
  assert.equal(t.check('203.0.113.8', now + 1).ok, true, 'the neighbouring IPv4 address is another client')
  // A dual-stack socket reports an IPv4 peer as ::ffff:a.b.c.d: its own address, never one /64 for all of IPv4.
  const m = new LoginThrottle()
  for (let i = 0; i < 5; i++) m.recordFailure('::ffff:203.0.113.7', now)
  assert.equal(m.check('::ffff:203.0.113.7', now + 1).ok, false)
  assert.equal(m.check('::ffff:203.0.113.8', now + 1).ok, true, 'IPv4-mapped addresses are not pooled')
  assert.equal(m.check('::ffff:198.51.100.1', now + 1).ok, true)
  assert.equal(m.check('203.0.113.7', now + 1).ok, false, 'the mapped and the plain spelling of one IPv4 address are one client')
  // Something that is no address at all is kept as it is.
  const g = new LoginThrottle()
  for (let i = 0; i < 5; i++) g.recordFailure('?', now)
  assert.equal(g.check('?', now + 1).ok, false)
  assert.equal(g.check('not:an:address', now + 1).ok, true)
})

async function proxiedDashboard() {
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-a1-'))
  const svc = new Service({
    mnemonic: TEST_WORDS, dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: true, defaultDryRun: true, maxAgents: 5,
  } as Config)
  svc.ensureAgents()
  ;(svc as unknown as { schedule: unknown }).schedule = () => undefined
  // The server install: nginx on the same machine passes the visitor's address in X-Real-IP (docs/SERVER.md).
  process.env.WEB_UI_TRUST_PROXY = '1'
  const creds = { username: 'admin', passwordHash: hashPassword('correct-horse-battery'), secretKey: 'k'.repeat(64) }
  const server = startWeb(svc, creds, 0)
  if (!server.listening) await once(server, 'listening')
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const guess = (ip: string, password: string) => fetch(`${url}/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: url, 'x-real-ip': ip },
    body: `username=admin&password=${password}`,
  })
  const close = () => {
    delete process.env.WEB_UI_TRUST_PROXY
    server.closeAllConnections()
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
  return { guess, close }
}

test('ATTACK-1b (through the dashboard behind its proxy) 40 wrong passwords from 40 addresses of one /64 are not all answered', async () => {
  const { guess, close } = await proxiedDashboard()
  try {
    const statuses: number[] = []
    for (let i = 1; i <= 40; i++) statuses.push((await guess(`2001:db8:aa:bb::${i.toString(16)}`, `guess-number-${i}`)).status)
    const checked = statuses.filter(s => s === 401).length
    assert.equal(checked, 5, `one IPv6 host had ${checked} of 40 password guesses checked (statuses: ${[...new Set(statuses)].join(',')}); the lockout allows 5 before the first pause`)
    // The owner on another network signs in meanwhile.
    assert.equal((await guess('2001:db8:1:2::1', 'correct-horse-battery')).status, 303)
  } finally {
    close()
  }
})

test('ATTACK-1d (through the dashboard behind its proxy) one /64 holds two places in the password queue, not two for each of its addresses', async () => {
  const { guess, close } = await proxiedDashboard()
  try {
    // Twelve guesses at the same moment, each from another address of one /64: the queue bound for one client is 2.
    const answers = await Promise.all(Array.from({ length: 12 }, async (_, i) => {
      const res = await guess(`2001:db8:aa:bb::${(i + 1).toString(16)}`, `guess-number-${i}`)
      return { status: res.status, busy: /Busy/.test(await res.text()) }
    }))
    const busy = answers.filter(a => a.status === 429 && a.busy).length
    assert.ok(busy >= 1, `a burst from one /64 is turned away at the queue; ${busy} of 12 were (statuses: ${answers.map(a => a.status).join(',')})`)
  } finally {
    close()
  }
})

test('ATTACK-1e the nginx template slows the sign-in page per address and still passes the visitor\'s address and the Host to the app', () => {
  const conf = readFileSync(new URL('../../deploy/nginx-foxleague-agent.conf', import.meta.url), 'utf8')
  assert.match(conf, /^limit_req_zone \$binary_remote_addr zone=(\w+):\d+m rate=\d+r\/m;$/m, 'the zone is declared outside the server block')
  const zone = /^limit_req_zone \S+ zone=(\w+):/m.exec(conf)![1]!
  assert.ok(conf.indexOf('limit_req_zone') < conf.indexOf('server {'))
  const login = /location = \/login \{([^}]*)\}/.exec(conf)?.[1] ?? ''
  assert.match(login, new RegExp(`limit_req zone=${zone} burst=\\d+ nodelay;`))
  // Without these two the app would count every visitor as 127.0.0.1 and refuse the form's Origin.
  assert.match(login, /proxy_set_header X-Real-IP\s+\$remote_addr;/)
  assert.match(login, /proxy_set_header Host\s+\$host;/)
  assert.match(login, /proxy_pass http:\/\/127\.0\.0\.1:8870;/)
})
