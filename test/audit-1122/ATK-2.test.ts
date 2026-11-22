// ATK-2 (pre-release audit 2026-11-22, ATTACK): the nginx template's 443 block sent no Strict-Transport-Security, and
// the app sends none either. An owner who types the dashboard's name without https:// on a network someone else
// controls asks port 80 in clear: the attacker answers instead of nginx's 301, with a copy of the sign-in page, and
// gets the password (the one gate of rule 7). With HSTS a browser that opened the dashboard once never sends that
// clear request again.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const conf = readFileSync(new URL('../../deploy/nginx-foxleague-agent.conf', import.meta.url), 'utf8')
const server = readFileSync(new URL('../../docs/SERVER.md', import.meta.url), 'utf8')

test('ATK-2 the 443 block of the nginx template sends Strict-Transport-Security, for a year at least', () => {
  const tls = conf.slice(conf.indexOf('listen 443'))
  assert.ok(conf.indexOf('listen 443') > 0)
  assert.match(tls, /add_header\s+Strict-Transport-Security\s+"max-age=(\d{8,})[^"]*"\s+always;/)
  const age = Number(/max-age=(\d+)/.exec(tls)![1])
  assert.ok(age >= 31_536_000, `max-age ${age}`)
  // Never on port 80: a browser ignores it over http, and it belongs with the certificate.
  assert.doesNotMatch(conf.slice(0, conf.indexOf('listen 443')), /Strict-Transport-Security/)
})

test('ATK-2 docs/SERVER.md tells the owner of a server set up from the older template to add it', () => {
  assert.match(server, /Strict-Transport-Security/)
})
