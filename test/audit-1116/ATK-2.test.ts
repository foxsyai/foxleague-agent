// Audit 2026-11-16, ATTACK reviewer. ATK-2: an open item raised again with new evidence. The record says "DNS
// rebinding reaches only /healthz and /login (there is no list of allowed Host names)". What it reaches at /login is
// the lockout that ATTACK-2 closed for a plain cross-site form: a page the owner visits at http://evil.example:8870,
// whose name is then pointed at 127.0.0.1, is "the same origin" as the dashboard for the browser. Its script posts
// wrong passwords to /login with an Origin that equals the Host (over plain http to a name a browser sends no
// Sec-Fetch-Site; where it sends one, it says same-origin), so foreignLogin() lets them through and each one is counted against the address they come from. On a local install that address is
// 127.0.0.1, the owner's own: after five of them the owner is refused at the sign-in and at every password re-prompt
// (release the kill switch, Go LIVE, raise a limit, Keys), 30 s doubling up to an hour, for as long as the page stays
// open. A local process that posts to 127.0.0.1:8870 does the same without a browser.
// Right behaviour: a POST /login for a Host the dashboard is not served at is refused before it is counted.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { raw, webService } from './web-helpers.ts'

const form = (password: string) => `username=admin&password=${encodeURIComponent(password)}`

/** What the rebound page's script sends: for the browser it is the page's own origin, because its name now points here. */
const rebound = (port: number, password: string) =>
  raw(port, {
    method: 'POST', path: '/login', body: form(password),
    headers: { host: `evil.example:${port}`, origin: `http://evil.example:${port}`, 'content-type': 'application/x-www-form-urlencoded' },
  })

test('ATK-2a wrong passwords posted to /login under another Host name (DNS rebinding) do not lock the owner out of the sign-in', async () => {
  const { port, url, password, close } = await webService()
  try {
    const answers: number[] = []
    for (let i = 0; i < 6; i++) answers.push((await rebound(port, `guess-${i}`)).status)
    // The owner signs in on the dashboard's own page (http://127.0.0.1:port), with the right password.
    const mine = await raw(port, { method: 'POST', path: '/login', body: form(password), headers: { host: `127.0.0.1:${port}`, origin: url, 'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded' } })
    assert.equal(mine.status, 303, `the owner's own sign-in with the right password must go through; it answered ${mine.status} (${mine.body.match(/Too many attempts[^<]*/)?.[0] ?? ''}) after the rebound page's posts were answered ${answers.join(',')}`)
  } finally {
    close()
  }
})

test('ATK-2b the same posts do not block the password re-prompt of a signed-in owner (releasing the kill switch)', async () => {
  const { svc, port, url, password, sessions, cookie, close } = await webService()
  try {
    svc.store.setKillSwitch(true)
    for (let i = 0; i < 6; i++) await rebound(port, `guess-${i}`)
    const res = await fetch(`${url}/api/kill`, {
      method: 'POST',
      headers: { cookie: `foxagent_session=${cookie}`, origin: url, 'x-csrf-token': sessions.csrfFor(cookie), 'content-type': 'application/json' },
      body: JSON.stringify({ on: false, password }),
    })
    assert.equal(res.status, 200, `the signed-in owner releases the kill switch with the right password; got ${res.status} ${await res.text()}`)
    assert.equal(svc.store.killSwitch, false)
  } finally {
    close()
  }
})

// Added by the fix: the names the dashboard is served at keep working, and the refusal says what to do.
test('ATK-2c the dashboard answers at this machine\'s names, at numeric addresses and at WEB_UI_HOSTNAMES; another name is refused before anything is read', async () => {
  const { port, close } = await webService()
  try {
    const get = (host: string, path = '/login') => raw(port, { method: 'GET', path, headers: { host } })
    for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, `192.168.1.20:${port}`, `agent.localhost:${port}`]) assert.equal((await get(host)).status, 200, host)
    const refused = await get(`evil.example:${port}`)
    assert.equal(refused.status, 421)
    assert.match(refused.body, /not served at that address\. Open it at http:\/\/localhost:\d+, or add the name to WEB_UI_HOSTNAMES\./)
    assert.doesNotMatch(refused.body, /—|\bbots?\b/)
    assert.equal((await get('bad host name')).status, 421, 'a Host that is no name')
    // The health check answers whatever the name: it tells nothing and changes nothing.
    assert.equal((await get(`evil.example:${port}`, '/healthz')).status, 200)
    process.env.WEB_UI_HOSTNAMES = 'my-box.lan, Other.Example'
    try {
      assert.equal((await get(`my-box.lan:${port}`)).status, 200)
      assert.equal((await get(`other.example:${port}`)).status, 200)
      assert.equal((await get(`evil.example:${port}`)).status, 421)
    } finally {
      delete process.env.WEB_UI_HOSTNAMES
    }
  } finally {
    close()
  }
})
