// V102-1 (the owner, launch day 23 Nov 2026): the FoxLeague Agent has its own logo, the fox head with the AI brain, and
// the site and the launch media already show it. The dashboard and the sign-in page still showed emoji foxes and the
// plain fox as their tab icon. Version 1.0.2 shows the brain fox (the header logo and the sign-in card: the transparent
// one; the "Signed in" pill: the round badge, which reads better small) and the round badge at 32 px as the tab icon.
// It also adds Report a problem to the dashboard's header: GitHub's public problem form with the running version
// filled in, with an info bubble that warns before anything is typed (the last open item of ISSUE-1).
//
// The drawing is the owner's file, byte for byte: its paths once per page, in a hidden sprite the logo and the avatar
// use (<symbol> and <use>), so the 32 KB of path data is never pasted twice. The tests pin the SHA-256 of the owner's
// drawing, its gradients and the tab icon: the logo files themselves live with the owner, not in this repository.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { Store } from '../../src/store/db.ts'
import { Sessions, hashPassword } from '../../src/web/auth.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const sha256 = (b: string | Buffer) => createHash('sha256').update(b).digest('hex')
const DASHBOARD = 'src/web/dashboard.html'
const LOGIN = 'src/web/login.html'

/** The owner's brain fox (brain.svg): everything it draws, between its </defs> and </svg>. */
const DRAWING_SHA256 = '3a44e0dc179e03136e1cb7f3d5b0b63c644cf578cfb829cf05a83215170ec5c7'
/** The start of its first path (the brain's lines, 31.5 KB of path data): it must be in a page exactly once. */
const BRAIN_PATH_START = '<path d="M151.67,343.89C151.44,343.85 150.66,343.63'
/** Its gradients, as the owner's files define them; the glow is the round badge's (brain-badge.svg). */
const GRADIENTS: Record<string, string> = {
  'flbrain-lines': 'b1160ac3ac47599e8b8cca9dfacb650f6edf288a7d1f2781649a66532cf93ab6',
  'flbrain-fox': 'f6c66b313ba3309d4d7d8f9f18ab842d8ab03547b44982a367c93adf003fe611',
  'flbrain-glow': 'd4cbd476ac31ed39b9912b827d48fb7c2030fbb280072c5d92c33c758611ec54',
}
/** The round badge is the same drawing on a dark disc with the glow (brain-badge.svg minus brain.svg). */
const BADGE_SYMBOL = '<symbol id="fl-brain-badge" viewBox="0 0 376 376"><circle cx="188" cy="188" r="188" fill="url(#flbrain-glow)"/><use href="#fl-brain"/></symbol>'
/** The owner's favicon-32.png: the round badge at 32 px. */
const FAVICON_SHA256 = '74d2c6e36609cb899db87032ad4b50a8c380438c7d69602924a9dfd86e6bd0c5'

const REPORT_FORM = 'https://github.com/foxsyai/foxleague-agent/issues/new?template=problem.yml'
const FOX_EMOJI = /\u{1F98A}|\\u\{1F98A\}|&#x1F98A;|&#129418;|\\ud83e\\udd8a/iu

/** The hidden sprite of a page: one <svg class="sprite"> that holds the gradients and the symbols. */
function sprite(page: string): string {
  const all = page.match(/<svg class="sprite"[^>]*>[\s\S]*?<\/svg>/g) ?? []
  assert.equal(all.length, 1, 'one sprite')
  return all[0]!
}

test('V102-1 no fox emoji is left in the dashboard or the sign-in page', () => {
  for (const p of [DASHBOARD, LOGIN]) assert.doesNotMatch(read(p), FOX_EMOJI, p)
})

test('V102-1 both pages hold the owner\'s brain fox once: its drawing and gradients byte for byte in one hidden sprite', () => {
  for (const p of [DASHBOARD, LOGIN]) {
    const page = read(p)
    assert.equal(page.split(BRAIN_PATH_START).length - 1, 1, `${p}: the brain's path data once, never pasted twice`)
    const s = sprite(page)
    const symbol = s.match(/<symbol id="fl-brain" viewBox="0 0 376 376">([\s\S]*?)<\/symbol>/)
    assert.ok(symbol, `${p}: the symbol fl-brain`)
    assert.equal(sha256(symbol[1]!), DRAWING_SHA256, `${p}: the drawing is the owner's`)
    for (const [id, hash] of Object.entries(GRADIENTS)) {
      if (id === 'flbrain-glow' && p === LOGIN) continue // the sign-in page shows no badge
      const g = s.match(new RegExp(`<(radialGradient|linearGradient) id="${id}"[\\s\\S]*?</\\1>`))
      assert.ok(g, `${p}: the gradient ${id}`)
      assert.equal(sha256(g[0]), hash, `${p}: the gradient ${id} is the owner's`)
    }
    // Hidden without display:none, which stops a referenced gradient from painting in Chrome and Firefox.
    assert.match(s, /^<svg class="sprite" aria-hidden="true" focusable="false">/)
    assert.match(page, /\.sprite\{position:absolute;width:0;height:0;overflow:hidden\}/, `${p}: the sprite takes no room`)
  }
  assert.ok(sprite(read(DASHBOARD)).includes(BADGE_SYMBOL), 'the dashboard: the round badge is the same drawing on the glow disc')
})

test('V102-1 the sprite carries nothing active: no script, no handler, no outside reference', () => {
  for (const p of [DASHBOARD, LOGIN]) {
    const s = sprite(read(p))
    assert.doesNotMatch(s, /<script|<foreignObject|<image|<style|<a[\s>]|javascript:|\son[a-z]+=|http/i, p)
    for (const m of s.matchAll(/(?:href="|url\()([^")]*)/g)) assert.match(m[1]!, /^#[\w-]+$/, `${p}: ${m[1]} points inside the page`)
  }
})

test('V102-1 the header logo and the sign-in card show the transparent brain fox; the Signed in pill shows the round badge', () => {
  const dash = read(DASHBOARD)
  assert.match(dash, /<span class="logo"><svg viewBox="0 0 376 376" aria-hidden="true" focusable="false"><use href="#fl-brain"\/><\/svg><\/span><h1>FoxLeague Agent<\/h1>/)
  assert.match(dash, /<span class="usercard"><span class="avatar"><svg viewBox="0 0 376 376" aria-hidden="true" focusable="false"><use href="#fl-brain-badge"\/><\/svg><\/span><span class="who">/)
  const login = read(LOGIN)
  assert.match(login, /<div class="logo"><svg viewBox="0 0 376 376" aria-hidden="true" focusable="false"><use href="#fl-brain"\/><\/svg><\/div>\s*<h1>FoxLeague Agent<\/h1>/)
})

test('V102-1 the tab icon of both pages is the owner\'s round badge at 32 px', () => {
  for (const p of [DASHBOARD, LOGIN]) {
    const icons = [...read(p).matchAll(/<link rel="icon" type="image\/png" href="data:image\/png;base64,([A-Za-z0-9+/=]+)">/g)]
    assert.equal(icons.length, 1, `${p}: one tab icon`)
    const png = Buffer.from(icons[0]![1]!, 'base64')
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${p}: a PNG`)
    assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR')
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [32, 32], `${p}: 32 by 32 pixels`)
    assert.equal(sha256(png), FAVICON_SHA256, `${p}: the owner's favicon-32.png`)
  }
})

test('V102-1 the brain fox costs a page at most 36.5 KB: one sprite that the logo and the avatar only point at', () => {
  for (const p of [DASHBOARD, LOGIN]) {
    const page = read(p)
    assert.ok(Buffer.byteLength(sprite(page)) < 36_500, `${p}: the sprite is the drawing with its gradients and no more`)
    // Every other picture of the fox is a pointer of under 120 bytes.
    const uses = [...page.matchAll(/<svg viewBox="0 0 376 376"[^>]*>[\s\S]*?<\/svg>/g)].map(m => m[0])
    assert.equal(uses.length, p === DASHBOARD ? 2 : 1, `${p}: the logo${p === DASHBOARD ? ' and the avatar' : ''}`)
    for (const u of uses) assert.ok(u.length < 120 && /^<svg[^>]*><use href="#fl-brain(?:-badge)?"\/><\/svg>$/.test(u), u.slice(0, 80))
  }
  assert.ok(Buffer.byteLength(read(LOGIN)) < 42_000, 'the sign-in page stays under 42 KB')
})

test('V102-1 the pages are served with the same strict Content-Security-Policy and show the brain fox (CSP part: control)', async () => {
  const { startWeb } = await import('../../src/web/server.ts')
  const creds = { username: 'admin', passwordHash: hashPassword('correct-horse-battery'), secretKey: 'k'.repeat(64) }
  const server = startWeb({ store: new Store('', ':memory:') } as never, creds, 0)
  if (!server.listening) await once(server, 'listening')
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    const cookie = `foxagent_session=${new Sessions(creds.secretKey, creds.passwordHash).issue('admin')}`
    for (const res of [await fetch(`${url}/login`), await fetch(`${url}/`, { headers: { cookie } })]) {
      assert.equal(res.status, 200)
      const csp = res.headers.get('content-security-policy') ?? ''
      const nonce = /script-src 'nonce-([A-Za-z0-9+/=]+)';/.exec(csp)?.[1]
      assert.ok(nonce, 'a nonce')
      assert.equal(csp, `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`)
      const html = await res.text()
      assert.ok(html.includes(BRAIN_PATH_START), 'the brain fox is served inline (no new route, no request)')
      assert.doesNotMatch(html, FOX_EMOJI)
    }
  } finally {
    server.close()
  }
})

/** The dashboard's own code for the link, run as the page runs it, on stand-in elements. */
function reportLink(instance: unknown): string {
  const html = read(DASHBOARD)
  const start = html.indexOf('\nconst REPORT_FORM = ')
  const end = html.indexOf('\n}\n', html.indexOf('\nfunction renderReport() {'))
  assert.ok(start > 0 && end > start, 'REPORT_FORM, reportUrl and renderReport are in the page')
  const els: Record<string, { href: string }> = {}
  const $ = (id: string) => (els[id] ??= { href: '' })
  new Function('S', '$', `${html.slice(start, end + 3)}\nrenderReport()`)({ instance }, $)
  return $('reportBtn').href
}

test('V102-1 Report a problem opens GitHub\'s problem form in a new tab without the dashboard\'s address', () => {
  const html = read(DASHBOARD)
  const actions = html.slice(html.indexOf('<div class="actions">'), html.indexOf('</div>', html.indexOf('<div class="actions">')))
  const a = actions.match(/<span class="act"><a id="reportBtn" ([^>]*)>Report a problem<\/a><i class="info" data-tip="report">i<\/i><\/span>/)
  assert.ok(a, 'in the header, next to the other help links, with its info bubble')
  assert.ok(actions.indexOf('id="guideBtn"') < actions.indexOf('id="reportBtn"') && actions.indexOf('id="reportBtn"') < actions.indexOf('id="adminBtn"'), 'after Getting started, before Keys')
  const attrs = Object.fromEntries([...a[1]!.matchAll(/([a-z]+)="([^"]*)"/g)].map(m => [m[1], m[2]]))
  assert.equal(attrs.href, REPORT_FORM, 'the form itself until the page knows the version')
  assert.equal(attrs.target, '_blank')
  assert.deepEqual(attrs.rel!.split(' ').sort(), ['noopener', 'noreferrer'])
  assert.match(html.slice(html.indexOf('function renderHeader() {'), html.indexOf('function renderHeader() {') + 200), /renderReport\(\)/, 'the header sets it')
})

test('V102-1 Report a problem fills in the version this agent runs, URL-encoded', () => {
  const href = reportLink({ update: { installed: '1.0.2' } })
  assert.equal(href, `${REPORT_FORM}&version=1.0.2`)
  const u = new URL(href)
  assert.equal(u.origin + u.pathname, 'https://github.com/foxsyai/foxleague-agent/issues/new')
  assert.deepEqual([...u.searchParams.keys()], ['template', 'version'])
  assert.equal(u.searchParams.get('template'), 'problem.yml')
  // A version with characters a query gives meaning to stays one value.
  const odd = '1.0.2-rc.1+build&labels=x#top ä'
  const encoded = new URL(reportLink({ update: { installed: odd } }))
  assert.deepEqual([...encoded.searchParams.keys()], ['template', 'version'], 'nothing added to the form')
  assert.equal(encoded.searchParams.get('version'), odd)
  assert.equal(encoded.hash, '')
  // Unknown is not a version: the field stays empty for the owner to fill in.
  for (const unknown of [{ update: { installed: '?' } }, { update: { installed: '' } }, { update: null }, {}]) {
    assert.equal(reportLink(unknown), REPORT_FORM, JSON.stringify(unknown))
  }
})

test('V102-1 the bubble of Report a problem says the form is public, names every secret never to paste and sends a security hole to SECURITY.md', () => {
  const html = read(DASHBOARD)
  const at = html.indexOf("\n  report: ['Report a problem', `")
  assert.ok(at > html.indexOf('\nconst TIPS = {'), 'the bubble is in TIPS')
  const bubble = html.slice(at, html.indexOf('`],', at)).replace(/\s+/g, ' ')
  for (const s of [/GitHub/, /public/i, /new tab/i, /version[^.]*filled in/i, /recovery words/i, /private key/i, /PEM/, /keystore/i, /\.env/, /API key/i, /password/i, /SECURITY\.md/, /privately/i]) {
    assert.match(bubble, s, `the bubble names ${s}`)
  }
  assert.doesNotMatch(bubble, /—|&mdash;|,(?:\s|<\/?[a-z][^>]*>)+(?:and|or)\b|\bbots?\b/i, 'the owner\'s text rules')
})

test('V102-1 the version is 1.0.2 or later, the same in package.json and both places of package-lock.json', () => {
  const version: string = JSON.parse(read('package.json')).version
  const [major, minor, patch] = version.split('.').map(Number) as [number, number, number]
  assert.ok(major > 1 || (major === 1 && (minor > 0 || patch >= 2)), `${version} is 1.0.2 or later`)
  const lock = JSON.parse(read('package-lock.json'))
  assert.equal(lock.version, version)
  assert.equal(lock.packages[''].version, version)
})

test('V102-1 the README and the site\'s dashboard page name Report a problem with the version filled in', () => {
  const site = read('site/src/content/docs/use/dashboard.md').replace(/\s+/g, ' ')
  const header = site.slice(site.indexOf('## The header'), site.indexOf('## The totals'))
  assert.match(header, /\*\*Report a problem\*\* opens GitHub's form/)
  assert.match(header, /version[^.]*filled in/i)
  assert.match(header, /never paste/i)
  const readme = read('README.md').replace(/\s+/g, ' ')
  const help = readme.slice(readme.indexOf('## Questions, problems and ideas'), readme.indexOf('## Contributing'))
  assert.match(help, /\*\*Report a problem\*\* in the dashboard/)
  assert.match(help, /version[^.]*filled in/i)
})
