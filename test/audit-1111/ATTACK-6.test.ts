// Audit 2026-11-11 (Fable 5.2 reviewers at extra-high effort): the proof of ATTACK-6, failing before its fix.
// Log out revoked the session only in the memory of the running process (Sessions.revoked, auth.ts). The session
// cookie itself stays valid for 12 hours (it is only an HMAC over a name and an expiry), so after any restart of
// the service (an update, a deploy, a crash, a reboot) a cookie the owner logged out of worked again. SS6 promised
// "logout revokes the session" so that a copied cookie dies with the logout.
// Safe behaviour: a session the owner logged out of stays dead after the service starts again.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '../../src/config.ts'
import { Service } from '../../src/service.ts'
import { Store } from '../../src/store/db.ts'
import { SESSION_TTL_S, Sessions, hashPassword } from '../../src/web/auth.ts'
import { startWeb } from '../../src/web/server.ts'

const TEST_WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

test('ATTACK-6 a session the owner logged out of does not come back to life when the service restarts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-a6-'))
  const password = 'correct-horse-battery'
  const creds = { username: 'admin', passwordHash: hashPassword(password), secretKey: 'k'.repeat(64) }
  const start = async () => {
    const svc = new Service({
      mnemonic: TEST_WORDS, dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
      gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined,
      isServer: false, defaultDryRun: true, maxAgents: 5,
    } as Config)
    svc.ensureAgents()
    ;(svc as unknown as { schedule: unknown }).schedule = () => undefined
    const server = startWeb(svc, creds, 0)
    if (!server.listening) await once(server, 'listening')
    return { svc, server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }
  }
  const stop = (s: Awaited<ReturnType<typeof start>>) => {
    s.server.closeAllConnections()
    s.server.close()
    s.svc.store.db.close()
  }
  const signIn = async (url: string) => {
    const res = await fetch(`${url}/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: url }, body: `username=admin&password=${password}` })
    assert.equal(res.status, 303)
    return /foxagent_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')![1]!
  }
  const state = (url: string, cookie: string) => fetch(`${url}/api/state`, { headers: { cookie: `foxagent_session=${cookie}` } })

  try {
    // The owner signs in for real, twice (the computer and the phone), and gets two cookies.
    const first = await start()
    const cookie = await signIn(first.url)
    const phone = await signIn(first.url)
    const sessions = new Sessions(creds.secretKey, creds.passwordHash)
    assert.equal((await state(first.url, cookie)).status, 200, 'signed in')
    // The owner logs out on the computer: that cookie (which someone may have copied) must be dead from now on.
    const out = await fetch(`${first.url}/logout`, { method: 'POST', headers: { cookie: `foxagent_session=${cookie}`, origin: first.url, 'x-csrf-token': sessions.csrfFor(decodeURIComponent(cookie)) } })
    assert.equal(out.status, 200)
    assert.equal((await state(first.url, cookie)).status, 401, 'dead right after the logout')
    // What the store keeps is a mark of the session, never the session itself (it would be a working cookie).
    const kept = first.svc.store.kvWithPrefix('').map(([k, v]) => `${k}=${v}`).join('\n')
    const raw = decodeURIComponent(cookie)
    assert.ok(!kept.includes(raw) && !kept.includes(raw.slice(raw.lastIndexOf('.') + 1)) && !kept.includes(raw.slice(0, raw.lastIndexOf('.'))), 'neither the session nor its signature is written to the database')
    stop(first)

    // The service restarts (an update, a deploy, a crash, a reboot): same data folder, same login.
    const second = await start()
    try {
      const again = await state(second.url, cookie)
      assert.equal(again.status, 401, `the logged-out cookie must stay dead after a restart; the dashboard answered ${again.status} and served the state again`)
      assert.equal((await state(second.url, phone)).status, 200, 'the session that was not logged out lives on')
    } finally {
      stop(second)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ATTACK-6b (unit) the kept list forgets a logout once the session would have expired, and an unreadable list starts empty', () => {
  const store = new Store('', ':memory:')
  const keep = { load: () => store.getKv('revoked_sessions'), save: (v: string) => store.setKv('revoked_sessions', v) }
  // From the real clock: loading the kept list drops entries by the real time (an expired logout is not kept).
  const t0 = Date.now()
  const a = new Sessions('k'.repeat(64), 'hash', keep)
  const early = a.issue('admin', t0)
  a.revoke(early, t0)
  const entries = () => Object.keys(JSON.parse(store.getKv('revoked_sessions') ?? '{}') as Record<string, number>).length
  assert.equal(entries(), 1)
  // A restart inside the 12 hours: still dead.
  assert.equal(new Sessions('k'.repeat(64), 'hash', keep).verify(early, t0 + 3600_000), null)
  // A later logout drops the entry whose session has expired anyway.
  const late = t0 + (SESSION_TTL_S + 60) * 1000
  const b = new Sessions('k'.repeat(64), 'hash', keep)
  const other = b.issue('admin', late)
  b.revoke(other, late)
  assert.equal(entries(), 1, 'only the fresh logout is kept')
  assert.equal(new Sessions('k'.repeat(64), 'hash', keep).verify(other, late + 1000), null)
  // A list that cannot be read is no reason to refuse every sign-in: it starts empty and the next logout rewrites it.
  for (const broken of ['not json', '[1,2]', '{"x":"y"}', 'null']) {
    store.setKv('revoked_sessions', broken)
    const c = new Sessions('k'.repeat(64), 'hash', keep)
    const fresh = c.issue('admin', late)
    assert.equal(c.verify(fresh, late), 'admin')
    c.revoke(fresh, late)
    assert.equal(new Sessions('k'.repeat(64), 'hash', keep).verify(fresh, late + 1000), null, `after "${broken}"`)
  }
  // Without a place to keep it (tests, tools) the logout still holds for the running process.
  const plain = new Sessions('k'.repeat(64), 'hash')
  const p = plain.issue('admin', t0)
  plain.revoke(p, t0)
  assert.equal(plain.verify(p, t0), null)
})
