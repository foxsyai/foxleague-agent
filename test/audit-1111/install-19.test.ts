// INSTALL-19: deploy/nginx-foxleague-agent.conf, the template docs/SERVER.md tells the owner to install, had one
// server block: it listened on port 80 and proxied everything to the dashboard, and the certificate came after
// it. From the reload until certbot had run (and for good where that was forgotten or failed) the sign-in page of
// a dashboard that can go LIVE answered on plain http, and a password typed there travelled in clear. Safe: the
// port 80 block only answers the ACME challenge and redirects to https; the proxy is in the 443 block.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO } from './install-helpers.ts'

/** The server blocks of an nginx file: the text between each top-level `server {` and its closing brace. */
function serverBlocks(conf: string): string[] {
  const text = conf.replace(/#[^\n]*/g, '')
  const blocks: string[] = []
  const start = /(^|\n)\s*server\s*\{/g
  for (let m = start.exec(text); m; m = start.exec(text)) {
    let depth = 1
    let i = start.lastIndex
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') depth--
    }
    blocks.push(text.slice(start.lastIndex, i - 1))
    start.lastIndex = i
  }
  return blocks
}

test('INSTALL-19: no server block of the nginx template both listens on port 80 and proxies to the dashboard', () => {
  const blocks = serverBlocks(readFileSync(join(REPO, 'deploy', 'nginx-foxleague-agent.conf'), 'utf8'))
  const plain = blocks.filter(b => /\blisten\s+(\[::\]:)?80\b/.test(b))
  const tls = blocks.filter(b => /\blisten\s+(\[::\]:)?443\s+ssl\b/.test(b))
  assert.equal(plain.length, 1, 'one block for port 80')
  assert.equal(tls.length, 1, 'one block for port 443')
  assert.notEqual(plain[0], tls[0])
  // Port 80: the challenge and the redirect, nothing else.
  assert.doesNotMatch(plain[0]!, /proxy_pass/, 'port 80 never reaches the dashboard')
  assert.match(plain[0]!, /location\s+\/\.well-known\/acme-challenge\/\s*\{[^}]*\broot\s+\S+;/)
  assert.match(plain[0]!, /location\s+\/\s*\{\s*return\s+301\s+https:\/\/\$host\$request_uri;\s*\}/)
  assert.doesNotMatch(plain[0]!, /\blisten\s[^;]*\b443\b/)
  // Port 443: the certificate and the proxy to this machine only.
  assert.doesNotMatch(tls[0]!, /\blisten\s+(\[::\]:)?80\b/)
  assert.match(tls[0]!, /ssl_certificate\s+\/etc\/letsencrypt\/live\/agent\.example\.com\/fullchain\.pem;/)
  assert.match(tls[0]!, /ssl_certificate_key\s+\/etc\/letsencrypt\/live\/agent\.example\.com\/privkey\.pem;/)
  assert.match(tls[0]!, /proxy_pass\s+http:\/\/127\.0\.0\.1:8870;/)
  assert.match(tls[0]!, /proxy_set_header\s+X-Forwarded-Proto\s+\$scheme;/)
  for (const b of blocks) assert.match(b, /server_name\s+agent\.example\.com;/)
})

test('INSTALL-19: the server guide gets the certificate before the template is switched on', () => {
  const guide = readFileSync(join(REPO, 'docs', 'SERVER.md'), 'utf8')
  const section = guide.slice(guide.indexOf('## Dashboard behind nginx'), guide.indexOf('## Everyday'))
  const cert = section.indexOf('certbot certonly')
  const enable = section.indexOf('sites-enabled')
  assert.ok(cert > 0 && enable > cert, 'first the certificate, then the template is enabled')
  assert.doesNotMatch(section, /certbot --nginx`? and reload/, 'not the old order: the template first, on plain http')
  assert.match(section, /port 80 .*only answers the certificate challenge and sends everything else to https/i)
})
