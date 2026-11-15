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

// What a real browser sends was measured with Chrome on a local stand-in of the sign-in page (2026-11-11). The
// dashboard serves its pages with `Referrer-Policy: no-referrer`, and under that policy a form sends `Origin: null`,
// the dashboard's own form included. So "null" alone says nothing about where a sign-in comes from:
//   the own form, https or loopback:      Origin null, Sec-Fetch-Site same-origin, the sign-in page's cookie
//   the own form, plain http on a name:   Origin null, no Sec-Fetch-Site,          the sign-in page's cookie
//   another site's form:                  Origin its own or null, Sec-Fetch-Site cross-site (none on plain http), no cookie
test('ATTACK-2d the dashboard\'s own form as a browser really sends it (Origin "null" under the no-referrer policy) signs in; another site\'s "null" does not', async () => {
  const { url, password, close } = await webService()
  try {
    // The sign-in page hands the browser a mark that only travels with requests from the dashboard's own site.
    const page = await fetch(`${url}/login`)
    const mark = /^(foxagent_login=[^;]+);(.*)$/.exec(page.headers.get('set-cookie') ?? '')
    assert.ok(mark, `the sign-in page sets its mark (got: ${page.headers.get('set-cookie')})`)
    assert.match(mark[2]!, /SameSite=Strict/i, 'a browser never sends it from another site')
    assert.match(mark[2]!, /HttpOnly/i)
    const cookie = mark[1]!

    // Another website, in a browser that says where a request comes from (every current one, over https or loopback).
    const foreign: number[] = []
    for (let i = 0; i < 6; i++) foreign.push((await login(url, { origin: 'null', 'sec-fetch-site': 'cross-site' }, `guess-${i}`)).status)
    // Even with the mark (it cannot have it): what the browser says wins.
    foreign.push((await login(url, { origin: 'null', 'sec-fetch-site': 'cross-site', cookie }, 'guess')).status)
    foreign.push((await login(url, { origin: url, 'sec-fetch-site': 'same-site', cookie }, 'guess')).status)
    // Another website, plain http to a name (the browser sends no Sec-Fetch-Site there): "null" and no mark.
    for (let i = 0; i < 6; i++) foreign.push((await login(url, { origin: 'null' }, `guess-${i}`)).status)
    assert.ok(foreign.every(s => s === 403), `every one is refused uncounted (got ${foreign.join(',')})`)

    // The owner's own form, https or loopback.
    const modern = await login(url, { origin: 'null', 'sec-fetch-site': 'same-origin', cookie }, password)
    assert.equal(modern.status, 303, `the dashboard's own form signs in (Origin null, Sec-Fetch-Site same-origin); it answered ${modern.status}`)
    // The same without the mark (cookies cleared while the page was open): what the browser says is enough.
    assert.equal((await login(url, { origin: 'null', 'sec-fetch-site': 'same-origin' }, password)).status, 303)
    // The owner's own form over plain http on a LAN name: no Sec-Fetch-Site, "null", the mark.
    const plain = await login(url, { origin: 'null', cookie }, password)
    assert.equal(plain.status, 303, `the dashboard's own form over plain http signs in (Origin null, the page's mark); it answered ${plain.status}`)
    // A refusal shows the sign-in page again with a fresh mark, so trying again on it works.
    const refused = await login(url, { origin: 'null' }, password)
    assert.equal(refused.status, 403)
    assert.match(refused.headers.get('set-cookie') ?? '', /^foxagent_login=/)
    assert.doesNotMatch(await refused.text(), /—|\bbot\b/)
    // Wrong passwords from the own form still count, as before.
    const wrong: number[] = []
    for (let i = 0; i < 6; i++) wrong.push((await login(url, { origin: 'null', 'sec-fetch-site': 'same-origin', cookie }, `guess-${i}`)).status)
    assert.deepEqual(wrong, [401, 401, 401, 401, 401, 429])
  } finally {
    close()
  }
})
