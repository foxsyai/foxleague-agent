// Audit 2026-11-11 (Fable 5.2 reviewers at extra-high effort): the proof of ATTACK-2, failing before its fix.
// POST /login had no same-origin check (every other POST has one), and each failed attempt counts against the
// address it comes from. A page the owner merely visits can post wrong passwords to the dashboard from the owner's
// own browser (a plain cross-site form post needs no preflight and no cookie), so the owner's own address was
// locked out of the sign-in and of every password re-prompt (release the kill switch, Go LIVE, raise a limit, Keys).
// Safe behaviour: a POST /login that carries a foreign Origin is refused BEFORE it is counted.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '../../src/config.ts'
import { Service } from '../../src/service.ts'
import { Sessions, hashPassword } from '../../src/web/auth.ts'
import { startWeb } from '../../src/web/server.ts'

const TEST_WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

async function webService() {
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-a2-'))
  const svc = new Service({
    mnemonic: TEST_WORDS, dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config)
  svc.ensureAgents()
  ;(svc as unknown as { schedule: unknown }).schedule = () => undefined
  const password = 'correct-horse-battery'
  const creds = { username: 'admin', passwordHash: hashPassword(password), secretKey: 'k'.repeat(64) }
  const server = startWeb(svc, creds, 0)
  if (!server.listening) await once(server, 'listening')
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const sessions = new Sessions(creds.secretKey, creds.passwordHash)
  const cookie = sessions.issue('admin')
  const close = () => {
    server.closeAllConnections()
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
  return { svc, url, password, sessions, cookie, close }
}

const login = (url: string, headers: Record<string, string>, password: string) =>
  fetch(`${url}/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: `username=admin&password=${encodeURIComponent(password)}` })

test('ATTACK-2a wrong passwords posted to /login from another website (foreign Origin) do not lock the owner out of the sign-in', async () => {
  const { url, password, close } = await webService()
  try {
    // What evil.example's page does in the owner's browser: six blind cross-site posts.
    const answers: number[] = []
    for (let i = 0; i < 6; i++) answers.push((await login(url, { origin: 'https://evil.example' }, `guess-${i}`)).status)
    // A sandboxed frame or a no-referrer form sends the literal "null".
    answers.push((await login(url, { origin: 'null' }, 'guess-null')).status)
    // The owner now signs in on the dashboard's own page, with the right password.
    const mine = await login(url, { origin: url }, password)
    assert.equal(mine.status, 303, `the owner's own sign-in with the right password must go through; it answered ${mine.status} (${(await mine.text()).match(/Too many attempts[^<]*/)?.[0] ?? ''}) after cross-site answers ${answers.join(',')}`)
    assert.match(mine.headers.get('set-cookie') ?? '', /foxagent_session=/, 'and it gets its session')
    assert.ok(answers.every(s => s === 403), `a cross-site POST /login is refused like every other cross-origin POST (got ${answers.join(',')})`)
  } finally {
    close()
  }
})

test('ATTACK-2b the same cross-site posts do not block the password re-prompt of a signed-in owner (releasing the kill switch)', async () => {
  const { svc, url, password, sessions, cookie, close } = await webService()
  try {
    svc.store.setKillSwitch(true)
    for (let i = 0; i < 6; i++) await login(url, { origin: 'https://evil.example' }, `guess-${i}`)
    const res = await fetch(`${url}/api/kill`, {
      method: 'POST',
      headers: { cookie: `foxagent_session=${cookie}`, origin: url, 'x-csrf-token': sessions.csrfFor(cookie), 'content-type': 'application/json' },
      body: JSON.stringify({ on: false, password }),
    })
    assert.equal(res.status, 200, `the signed-in owner releases the kill switch with the right password; got ${res.status} ${await res.text()}`)
  } finally {
    close()
  }
})

test('ATTACK-2c the dashboard\'s own form keeps working behind nginx (Origin with the public name, Host passed on) and without an Origin; wrong passwords still count', async () => {
  const { url, password, close } = await webService()
  try {
    // nginx passes `Host $host`: the browser's Origin https://agent.example.com meets Host agent.example.com.
    // (fetch does not let a caller set Host, so this one request is written with node:http.)
    const body = `username=admin&password=${encodeURIComponent(password)}`
    const proxied = await new Promise<number>((resolve, reject) => {
      const req = request(`${url}/login`, { method: 'POST', headers: { host: 'agent.example.com', origin: 'https://agent.example.com', 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) } }, res => {
        res.resume()
        resolve(res.statusCode ?? 0)
      })
      req.on('error', reject)
      req.end(body)
    })
    assert.equal(proxied, 303, `the form behind the proxy signs in; got ${proxied}`)
    // The same public Origin against another Host is another website.
    assert.equal((await login(url, { origin: 'https://agent.example.com' }, password)).status, 403)
    // A client that sends no Origin (curl, an old browser) is judged by its password, as before.
    assert.equal((await login(url, {}, password)).status, 303)
    // The lock itself is untouched: the form's own wrong passwords are still counted against the address.
    const wrong: number[] = []
    for (let i = 0; i < 6; i++) wrong.push((await login(url, { origin: url }, `guess-${i}`)).status)
    assert.deepEqual(wrong, [401, 401, 401, 401, 401, 429])
  } finally {
    close()
  }
})
