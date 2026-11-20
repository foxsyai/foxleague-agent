// Step 1 of 2: the browser screens of the videos, as screenshots of the real pages.
//
//   node src/capture.mjs            (all three systems)
//   node src/capture.mjs mac        (one)
//
// - The install pages: the site as built in the repository (site/dist), served here read-only. The "Coming soon"
//   banner and frame are taken off in the browser only (not in any file), so the page looks as it will after the
//   public release: the line with its copy button.
// - The dashboard: the repository's own Service and web server (src/service.ts, src/web/server.ts), started like
//   site/scripts/screenshots.ts does: a throwaway wallet in a temporary folder, every network address pointed at
//   127.0.0.1:9 (nothing leaves this machine), no AI key, no Telegram. The pages are the real login.html and
//   dashboard.html. Two agents' states: right after the install (the "fresh" one) and a few days later (the
//   "later" one, with the site's demo team). The updater is a stand-in whose answers are the real updater's texts.
// - Every agent address on the page is replaced by the made-up one of values.mjs and tagged "example".
//
// Nothing in the repository is written. The repository is the one this script sits in (site/scripts/videos/src); its
// packages are its own node_modules (npm ci at the root), found the way Node finds them; the built site is its
// site/dist (cd site && npm run build), or another build named with FOXAGENT_SITE_DIST.
// Output: build/shots/<system>/<name>.jpg and build/shots/<system>/boxes.json (where the buttons are).

import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, normalize, resolve } from 'node:path'
import { once } from 'node:events'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'
import { FONTS, PAGE, SYSTEMS, VALUES } from './values.mjs'

const HERE = import.meta.dirname
const ROOT = resolve(HERE, '..') // site/scripts/videos
const REPO = resolve(ROOT, '..', '..', '..')
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome'
const OUT = join(ROOT, 'build', 'shots')
const only = process.argv.slice(2).filter(a => SYSTEMS.includes(a))
const systems = only.length ? only : SYSTEMS
if (!existsSync(join(REPO, 'src', 'service.ts'))) throw new Error(`${REPO} is not the foxleague-agent repository`)
// The built site. FOXAGENT_SITE_DIST names another build of it.
const SITE_DIST = resolve(process.env.FOXAGENT_SITE_DIST ?? join(REPO, 'site', 'dist'))
if (!existsSync(join(SITE_DIST, 'start', 'install-windows', 'index.html'))) throw new Error(`${SITE_DIST} has no install pages: build the site first (cd site && npm run build) or set FOXAGENT_SITE_DIST`)

const repoImport = p => import(pathToFileURL(join(REPO, p)).href)
const repoRequire = createRequire(join(REPO, 'package.json'))
const iso = ms => new Date(ms).toISOString()

// ---------------------------------------------------------------------------------------------------------------
// The site, read-only, and the fonts the pages are shown in.
// ---------------------------------------------------------------------------------------------------------------
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.ico': 'image/x-icon', '.xml': 'application/xml', '.txt': 'text/plain' }
const FONT_FILES = {
  'inter-400.woff2': join(ROOT, 'node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2'),
  'inter-500.woff2': join(ROOT, 'node_modules/@fontsource/inter/files/inter-latin-500-normal.woff2'),
  'inter-600.woff2': join(ROOT, 'node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2'),
  'inter-700.woff2': join(ROOT, 'node_modules/@fontsource/inter/files/inter-latin-700-normal.woff2'),
}
const siteRoot = SITE_DIST
const site = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  let file
  if (url.pathname.startsWith('/__fonts/')) file = FONT_FILES[url.pathname.slice(9)]
  else {
    file = normalize(join(siteRoot, decodeURIComponent(url.pathname)))
    if (!file.startsWith(siteRoot)) file = undefined
    else if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
  }
  if (!file || !existsSync(file)) { res.writeHead(404); return res.end('not found') }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'access-control-allow-origin': '*' })
  res.end(readFileSync(file))
})
site.listen(0, '127.0.0.1')
await once(site, 'listening')
const SITE = `http://127.0.0.1:${site.address().port}`

// The page fonts: each system's own stands in (see values.mjs). Injected into the page, never written to a file.
const fontCss = os => {
  const ui = FONTS[os].ui
  const faces = ui === 'Inter' ? [400, 500, 600, 700].map(w => `@font-face{font-family:'Inter';font-weight:${w};src:url(${SITE}/__fonts/inter-${w}.woff2) format('woff2')}`).join('') : ''
  return `${faces}:root{--sl-font:'${ui}',sans-serif!important}html,body,button,input,select,textarea{font-family:'${ui}',sans-serif!important}`
}

// ---------------------------------------------------------------------------------------------------------------
// The dashboard: the repository's own service, twice (right after the install, and a few days later).
// ---------------------------------------------------------------------------------------------------------------
process.env.WEB_UI_INSECURE_COOKIE = '1'
process.env.AGENT_LIVE_ENABLED = '1' // the install's answer at 5/7 was Enter, which is yes on a first install
for (const k of ['ANTHROPIC_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'BINANCE_API_KEY', 'BINANCE_API_SECRET']) delete process.env[k]
const { Mnemonic } = repoRequire('@multiversx/sdk-core')
const { Service } = await repoImport('src/service.ts')
const { startWeb } = await repoImport('src/web/server.ts')
const { Sessions, hashPassword } = await repoImport('src/web/auth.ts')
const { wholeToAtomic } = await repoImport('src/util/encoding.ts')
const { snapshot } = await repoImport('test/fixtures.ts')

/** A stand-in for the updater: the dashboard's notice is driven by its view; the texts are the real updater's. */
function fakeUpdater() {
  const st = { installed: VALUES.version, available: null, checkedAt: iso(Date.now() - 60_000), checkError: null, canInstall: true, how: null, state: 'idle', last: null, enabled: true, restarts: true, waiting: null }
  return {
    st,
    view: () => structuredClone(st),
    check: async () => structuredClone(st),
    // src/update/updater.ts, begin(): the message of a service that restarts the agent.
    begin: async () => { st.state = 'downloading'; return `Installing ${st.available.version}. This takes a minute or two; the agent then restarts and tells you when it is back.` },
    start() {}, stop() {},
  }
}

async function dashboard({ later }) {
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-video-'))
  if (later) process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-EXAMPLEexampleEXAMPLEexampleEXAMPLE-0000'
  else delete process.env.ANTHROPIC_API_KEY
  const cfg = {
    mnemonic: Mnemonic.generate().toString(), dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: process.env.ANTHROPIC_API_KEY, model: 'claude-haiku-5-5', // src/config.ts: the default when AGENT_MODEL is not set (DEFAULT_AI)
    telegramToken: undefined, telegramChatId: undefined, isServer: false, defaultDryRun: true, maxAgents: 5,
  }
  const svc = new Service(cfg)
  svc.schedule = () => undefined
  svc.ensureAgents()
  svc.updater = fakeUpdater()
  const store = svc.store
  if (later) {
    // The site's demo team (site/scripts/screenshots.ts), a few days into the agent's life.
    store.setKv('welcome_hidden', '1')
    store.setKv('model_usd_total', '1.84')
    const now = Date.now()
    const snap = snapshot()
    snap.chain = { egld: wholeToAtomic(3) + wholeToAtomic(1) / 5n, nonce: 42, foxsy: wholeToAtomic(4250), wegld: 0n, nftCount: 18 }
    snap.profile = { ...snap.profile, team_name: VALUES.teamName, elo_rating: 1215, matches_won: 6, matches_drawn: 1, matches_lost: 3, tournament_wins: 1 }
    snap.team = { ...snap.team, name: VALUES.teamName }
    snap.auth.allowance = { today_count: 3, daily_limit: 5, reset_hour_utc: 14 }
    snap.auth.myTournaments = {
      active: [{ id: 204, title: 'Fox Demo Cup', status: 'open', tier: 'silver', format: 'knockout', max_teams: 8, min_teams: 8, participant_count: 5, entry_fee_foxsy: 1000, deadline: iso(now + 20 * 3600_000), starts_at: iso(now + 21 * 3600_000), creator_user_id: 100, target_user_id: null }],
      completed: [],
    }
    snap.market.openStandard = Array.from({ length: 6 }, () => ({}))
    snap.market.openChallenges = Array.from({ length: 2 }, () => ({}))
    svc.snapshots.set(0, snap)
    const plan = `agent 1 plan: Squad is fit (condition 72 to 100) and today's free training is still open. The own knockout T204 has 5 of 8 teams, so no new entries: train the starters who gain most and sync before tomorrow's first lock.
1. train #6034 speed (Legendary starter, speed lowest at 40 with cap 100)
2. train #977 power (Epic defender, power 42, far from its cap of 90)
3. play ranked match (one of today's free matches; similar ELO opponents available)
4. sync (5 starters gained live points; worth it before tomorrow's lock)`
    store.setKv('last_plan_0', plan)
    store.log({ agentIndex: 0, kind: 'plan', status: 'info', summary: plan })
    for (const [kind, status, summary] of [
      ['train', 'dry_run', 'DRY RUN would train #6034 speed, cost ~$0.00; then POST /api/training/train'],
      ['train', 'dry_run', 'DRY RUN would train #977 power, cost ~$0.00; then POST /api/training/train'],
      ['play_match', 'dry_run', 'DRY RUN would play a ranked match, cost ~$0.00; then POST /api/matches/play'],
      ['sync', 'dry_run', 'DRY RUN would sync dirty cards to chain, cost ~$0.25 (50 FOXSY + fees); syncMyStats: simulation ok (success)'],
    ]) store.log({ agentIndex: 0, kind, status, summary })
    svc.updater.st.available = { version: VALUES.nextVersion, notes: VALUES.releaseNotes, published: iso(now - 2 * 3600_000) }
  }
  const creds = { username: VALUES.user, passwordHash: hashPassword(VALUES.dashPassword), secretKey: (later ? 'b' : 'a').repeat(64) }
  const server = startWeb(svc, creds, 0)
  if (!server.listening) await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  const cookie = new Sessions(creds.secretKey, creds.passwordHash).issue(VALUES.user)
  // The addresses this throwaway wallet derives: replaced on the page by the made-up ones.
  const real = [svc.wallet(0).address, svc.wallet(1).address]
  return { svc, server, base, cookie, real }
}

const fresh = await dashboard({ later: false })
const later = await dashboard({ later: true })

// ---------------------------------------------------------------------------------------------------------------
// The screenshots.
// ---------------------------------------------------------------------------------------------------------------
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--hide-scrollbars', '--font-render-hinting=none'] })
const sleep = ms => new Promise(r => setTimeout(r, ms))

// The tabs' icons: the site's own and the dashboard's own (the data address in src/web/login.html).
mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'fav-site.png'), readFileSync(join(siteRoot, 'brand', 'favicon-32.png')))
const dashIcon = /href="data:image\/png;base64,([^"]+)"/.exec(readFileSync(join(REPO, 'src', 'web', 'login.html'), 'utf8'))
if (!dashIcon) throw new Error('src/web/login.html has no icon')
writeFileSync(join(OUT, 'fav-dash.png'), Buffer.from(dashIcon[1], 'base64'))

for (const os of systems) {
  const dir = join(OUT, os)
  mkdirSync(dir, { recursive: true })
  const boxes = {}
  const context = await browser.newContext({ viewport: { width: PAGE.width, height: PAGE.height }, deviceScaleFactor: PAGE.scale, colorScheme: 'dark', reducedMotion: 'reduce' })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: SITE })
  await context.addInitScript(css => {
    document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = css; document.head.append(s) })
  }, fontCss(os))
  // Every derived address becomes the made-up one, in every answer of the agent.
  for (const d of [fresh, later]) {
    await context.route(`${d.base}/api/**`, async route => {
      const r = await route.fetch()
      let body = await r.text()
      body = body.replaceAll(d.real[0], VALUES.address).replaceAll(d.real[1], VALUES.nextAddress)
      await route.fulfill({ response: r, body })
    })
  }
  const page = await context.newPage()
  // The owner's rule (test/no-word-bot.test.ts): that word is never shown. Every shot's rendered text (what is laid
  // out, hidden parts left out) is checked; BotFather, a name, is allowed. A hit is listed in boxes.json and printed.
  const wordHits = []
  const shot = async name => {
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: join(dir, `${name}.jpg`), type: 'jpeg', quality: 92 })
    const seen = await page.evaluate(() => {
      const out = []
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!/\bbots?\b/i.test(n.textContent)) continue
        const el = n.parentElement
        const r = el.getBoundingClientRect(), st = getComputedStyle(el)
        const shown = r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && el.offsetParent !== null && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth
        if (shown) out.push(n.textContent.trim().slice(0, 120))
      }
      return out
    })
    for (const t of seen) { wordHits.push({ shot: name, text: t }); console.log(`WORD CHECK ${os}/${name}: ${t}`) }
    console.log(`${os}/${name}`)
  }
  const box = async (name, selector) => {
    const b = await page.locator(selector).first().boundingBox()
    if (!b) throw new Error(`${os}: no ${selector} on the page for ${name}`)
    boxes[name] = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
  }
  // The "example" tag after the made-up address, wherever the page shows it.
  const tagExample = () => page.evaluate(addr => {
    for (const n of document.querySelectorAll('body *')) {
      if (n.children.length || n.textContent.trim() !== addr || n.dataset.exampleTagged) continue
      n.dataset.exampleTagged = '1'
      const t = document.createElement('span')
      t.textContent = 'example'
      t.style.cssText = 'display:inline-block;margin-left:8px;padding:1px 7px;border-radius:999px;background:#f5c518;color:#1a1300;font:600 11px/16px sans-serif;letter-spacing:.04em;text-transform:uppercase;vertical-align:middle'
      n.after(t)
    }
  }, VALUES.address)

  // ---- the install page ----
  await page.goto(`${SITE}/start/install-${os}/`)
  await page.evaluate(() => {
    // As after the public release: no banner, and the line without the "Coming soon" frame around it.
    document.querySelector('.sl-banner')?.remove()
    for (const cs of document.querySelectorAll('.coming-soon')) {
      const body = cs.querySelector('.cs-body')
      if (body) cs.replaceWith(...body.childNodes)
      else cs.remove()
    }
    const h = [...document.querySelectorAll('h2')].find(e => e.textContent.trim() === 'The line to paste')
    window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 150)
  })
  await sleep(300)
  await shot('site')
  const code = page.locator('.expressive-code').first()
  await box('siteCode', '.expressive-code')
  await code.hover()
  await sleep(400)
  await box('siteCopy', '.expressive-code .copy button')
  await shot('site-hover')
  await page.locator('.expressive-code .copy button').first().click()
  await sleep(250)
  await shot('site-copied')
  boxes.siteTitle = await page.title()

  // ---- the login page and the dashboard right after the install ----
  await page.goto(`${fresh.base}/login`)
  await sleep(300)
  await page.locator('#u').blur()
  await page.evaluate(() => document.activeElement && document.activeElement.blur())
  await box('loginUser', '#u'); await box('loginPass', '#p'); await box('loginSubmit', 'button[type=submit]')
  await shot('login')
  await page.locator('#u').click()
  await shot('login-u0')
  for (let i = 1; i <= VALUES.user.length; i++) { await page.keyboard.type(VALUES.user[i - 1]); await shot(`login-u${i}`) }
  await page.locator('#p').click()
  await shot('login-p0')
  const pw = VALUES.dashPassword
  for (let i = 1; i <= pw.length; i++) { await page.keyboard.type(pw[i - 1]); if (i % 3 === 0 || i === pw.length) await shot(`login-p${i}`) }
  boxes.passwordLength = pw.length
  await page.locator('button[type=submit]').click()
  await page.waitForURL(`${fresh.base}/`)
  await page.waitForFunction(() => document.getElementById('guidewrap')?.classList.contains('on'))
  await sleep(1200)
  await tagExample()
  await box('guideClose', '#guideClose')
  await shot('dash-guide')
  await page.locator('#guideClose').click()
  await sleep(500)
  await tagExample()
  await shot('dash-fresh')

  // ---- a few days later: the update ----
  later.svc.updater.st.installed = VALUES.version
  later.svc.updater.st.available = { version: VALUES.nextVersion, notes: VALUES.releaseNotes, published: iso(Date.now() - 2 * 3600_000) }
  later.svc.updater.st.state = 'idle'
  later.svc.updater.st.last = null
  await context.addCookies([{ name: 'foxagent_session', value: later.cookie, url: later.base, httpOnly: true }])
  await page.goto(`${later.base}/`)
  await page.waitForFunction(() => !document.getElementById('upBanner').hidden)
  await sleep(1500)
  await tagExample()
  await box('upBtn', '#upBtn'); await box('upBanner', '#upBanner'); await box('verPill', '#verPill')
  await shot('dash-update')
  await page.locator('#upBtn').hover()
  await sleep(200)
  await shot('dash-update-hover')
  await page.locator('#upBtn').click()
  await page.waitForFunction(() => document.getElementById('upText').textContent.startsWith('Installing'))
  await sleep(300)
  await page.mouse.move(10, PAGE.height - 10)
  await shot('dash-installing')
  // The agent restarted into the new version (src/update/updater.ts, start(): "Updated from X to Y.").
  Object.assign(later.svc.updater.st, { installed: VALUES.nextVersion, available: null, state: 'idle', last: { kind: 'updated', version: VALUES.nextVersion, at: iso(Date.now()), message: `Updated from ${VALUES.version} to ${VALUES.nextVersion}.` } })
  await page.waitForFunction(() => document.getElementById('upText').textContent.startsWith('Updated from'), null, { timeout: 15_000 })
  await sleep(250)
  await tagExample()
  await shot('dash-updated')
  boxes.wordHits = wordHits
  writeFileSync(join(dir, 'boxes.json'), JSON.stringify(boxes, null, 2))
  await context.close()
}

await browser.close()
for (const d of [fresh, later]) { d.server.close(); await d.svc.stop?.() }
site.close()
process.exit(0)
