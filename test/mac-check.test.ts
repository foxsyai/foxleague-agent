// The Mac install check of 2026-11-12 (the owner's MacBook Air, macOS 15.7.3 on arm64, with no Node.js before):
// four findings and MAC-5, the item it left open (done on the owner's go of 2026-11-13), each with its test here,
// named after it and failing before its fix (MAC-5's route test is in test/update-service.test.ts). The record is
// the section "Mac install check (2026-11-12)" of docs/SECURITY-REVIEW.md.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as updater from '../src/update/updater.ts'
import { Updater, type UpdateView, type UpdaterDeps } from '../src/update/updater.ts'
import { detectLayout } from '../src/update/install.ts'
import { LOGIN_LINES, freshInstall, guided, realTree, sh, stubs } from './audit-1111/install-helpers.ts'
import { REPO, buildRelease, codeTree, managedInstall, publish, serve, testKey, tmp } from './update-fixtures.ts'

const read = (f: string): string => readFileSync(join(REPO, f), 'utf8')
const flat = (f: string): string => read(f).replace(/\s+/g, ' ')

/** A stand-in npm that notes where npm would keep its cache and its logs: npm_config_cache, or ~/.npm without it. */
function cacheNotingNpm(log: string): string {
  return [
    '#!/usr/bin/env bash',
    'printf \'%s\\n\' "${npm_config_cache:-$HOME/.npm}" >> ' + JSON.stringify(log),
    '[ -e node_modules ] || ln -s ' + JSON.stringify(join(REPO, 'node_modules')) + ' node_modules',
    '',
  ].join('\n')
}

test('MAC-1: npm keeps its cache and its logs in the install folder, so deleting the folder leaves nothing of npm behind', { timeout: 240_000 }, async () => {
  // The guided install (as on the Mac): its private Node.js and npm, a throwaway HOME.
  const i = freshInstall()
  writeFileSync(join(i.root, '.env'), LOGIN_LINES, { mode: 0o600 })
  const installLog = join(tmp('fox-npm-'), 'cache.log')
  writeFileSync(join(i.root, '.node', 'bin', 'npm'), cacheNotingNpm(installLog), { mode: 0o755 })
  const r = await guided(i, ['yes', '', '18997', 'n', 'n'])
  assert.equal(r.status, 0, r.out)
  assert.deepEqual(readFileSync(installLog, 'utf8').trim().split('\n'), [join(i.root, '.npm-cache')], 'the install runs npm with its cache in the install folder, not in ~/.npm')

  // An update prepares the new release with the same npm: its cache goes to the install folder too.
  const s = stubs()
  const prepareLog = join(tmp('fox-npm-'), 'cache.log')
  writeFileSync(join(s.dir, 'npm'), cacheNotingNpm(prepareLog), { mode: 0o755 })
  const root = tmp('fox-root-')
  const staged = realTree(join(root, 'versions', '.staging-v3.2.0'), '3.2.0')
  writeFileSync(join(root, 'versions', 'active'), 'v3.1.0\n')
  const p = await sh(join(staged, 'install.sh'), ['--prepare'], { HOME: tmp('fox-home-'), PATH: `${s.dir}:${process.env.PATH}`, FOXAGENT_ROOT: root })
  assert.equal(p.status, 0, p.out)
  assert.deepEqual(readFileSync(prepareLog, 'utf8').trim().split('\n'), [join(root, '.npm-cache')], 'the update\'s prepare keeps npm\'s cache in the install folder')

  // In a git checkout the checkout is the install folder: the cache stays out of git.
  assert.match(read('.gitignore'), /^\.npm-cache\/$/m)
  // deps() is the one place that runs npm; the other scripts of an install run none.
  const runs = (f: string): string[] => read(f).split('\n').filter(l => !/^\s*#/.test(l) && /\bnpm(\.cmd)?\s+(ci|install|i|exec|run|cache)\b/.test(l))
  assert.equal(runs('install.sh').length, 1, runs('install.sh').join('\n'))
  assert.match(runs('install.sh')[0]!, /^deps\(\) \{/)
  for (const f of ['get.sh', 'run.sh', 'cli.sh', 'get.ps1']) assert.deepEqual(runs(f), [], f)
  // And no page still says that npm's cache stays in ~/.npm after the folder is gone.
  for (const f of ['INSTALL.md', 'README.md', 'site/src/content/docs/help/update.md']) assert.doesNotMatch(read(f), /~\/\.npm\b/, f)
})

/** Every file under a folder of the repository, as paths from the repository's root. */
function filesUnder(dir: string): string[] {
  return readdirSync(join(REPO, dir), { recursive: true, withFileTypes: true })
    .filter(e => e.isFile() && !e.parentPath.includes('node_modules'))
    .map(e => join(e.parentPath, e.name).slice(REPO.length + 1))
}

test('MAC-2: the folder size is the one measured on the Mac, said the same way in INSTALL.md and on the Update page, and nowhere 190 MB', () => {
  // Measured: Node.js (.node) 189 MB, each release folder 42 MB, npm's cache about 6 MB (in the folder since MAC-1).
  const size = /about (\d+) MB, and about (\d+) MB once an update has kept the release before it/
  const said = (f: string): number[] | undefined => size.exec(flat(f))?.slice(1, 3).map(Number)
  assert.deepEqual(said('INSTALL.md'), [240, 280], 'INSTALL.md')
  assert.deepEqual(said('site/src/content/docs/help/update.md'), said('INSTALL.md'), 'the Update page says what INSTALL.md says')
  // Every other place that could state a size (the record of this check names the old figure, so it is left out).
  const places = ['README.md', 'INSTALL.md', 'install.sh', 'get.sh', 'get.ps1', 'src/web/dashboard.html', ...filesUnder('site/src'), ...filesUnder('docs').filter(f => f !== join('docs', 'SECURITY-REVIEW.md'))]
  assert.ok(places.length > 25, `${places.length} files`)
  for (const f of places) assert.doesNotMatch(flat(f), /\b190 ?MB\b/, f)
})

type Element = { hidden: boolean; textContent: string; className: string }
/** The dashboard's elements of the update notice, as the page starts them (the button reads Update now). */
function noticeElements(): Record<string, Element> {
  return { upBtn: { hidden: true, textContent: 'Update now', className: 'btn sm go' } }
}
/** The dashboard's own renderUpdate, run on stand-in elements: what the notice says and what its button reads. */
function notice(update: Partial<UpdateView>, els = noticeElements()): { text: string; button: boolean; label: string; tone: string } {
  const html = read('src/web/dashboard.html')
  const fn = html.slice(html.indexOf('function renderUpdate() {'), html.indexOf('async function startUpdate() {'))
  assert.ok(fn.startsWith('function renderUpdate()'), 'renderUpdate was not found in the dashboard')
  const $ = (id: string): Element => (els[id] ??= { hidden: false, textContent: '', className: '' })
  const view: UpdateView = { installed: '1.0.2', available: null, checkedAt: null, checkError: null, canInstall: true, how: null, state: 'idle', last: null, enabled: true, restarts: true, waiting: null, ...update }
  new Function('S', '$', 'toast', 'updating', `${fn}\nrenderUpdate()`)({ instance: { update: view } }, $, () => undefined, null)
  return { text: $('upText').textContent, button: !$('upBtn').hidden, label: $('upBtn').textContent, tone: $('upBanner').className }
}

test('MAC-3: after an update that was undone, the notice says that nothing has to be done and offers the same version as Try again', () => {
  // The updater's own message, as the Mac showed it (src/update/updater.ts, unchanged: Telegram sends it too).
  const message = 'The update to 1.0.3 did not start and was undone: you run 1.0.2 as before. Your wallet, settings and history are untouched. It is safe to try again later.'
  const undone = { kind: 'undone' as const, version: '1.0.3', at: new Date().toISOString(), message }
  const v103 = { version: '1.0.3', notes: 'Medicine for injured cards.', published: '2026-11-12T20:00:00Z' }
  const els = noticeElements()
  const same = notice({ available: v103, last: undone }, els)
  assert.ok(same.text.startsWith(message), same.text)
  assert.match(same.text, /Nothing has to be done: the agent keeps running 1\.0\.2\./)
  assert.doesNotMatch(same.text, /Version 1\.0\.3 is out/, 'the line the owner read as "press Update now to get 1.0.2 back"')
  assert.equal(same.button, true)
  assert.equal(same.label, 'Try again')
  // Where the button cannot install, the notice still says that nothing has to be done, and what would try again.
  const byHand = notice({ available: v103, last: undone, canInstall: false, how: 'this install is a git checkout: update it in a terminal with ./install.sh --update' })
  assert.equal(byHand.button, false)
  assert.match(byHand.text, /Nothing has to be done: the agent keeps running 1\.0\.2\. To try 1\.0\.3 again: this install is a git checkout/)

  // A newer release than the one that was undone is a new offer: the usual words and Update now, on the same page.
  const newer = notice({ available: { ...v103, version: '1.0.4' }, last: undone }, els)
  assert.match(newer.text, /Version 1\.0\.4 is out\. You run 1\.0\.2\.$/)
  assert.doesNotMatch(newer.text, /Nothing has to be done/)
  assert.equal(newer.label, 'Update now')
  // Without an undo, nothing changes.
  const plain = notice({ available: v103 })
  assert.equal(plain.text, 'Version 1.0.3 is out. You run 1.0.2.')
  assert.equal(plain.label, 'Update now')
  // An undo of a day ago is no longer shown: the offer is the usual one.
  const old = notice({ available: v103, last: { ...undone, at: new Date(Date.now() - 2 * 86_400_000).toISOString() } })
  assert.equal(old.text, 'Version 1.0.3 is out. You run 1.0.2.')
  assert.equal(old.label, 'Update now')

  // The info bubble and the pages tell the same.
  const html = flat('src/web/dashboard.html')
  const bubble = html.slice(html.indexOf("update: ['Version and updates'"), html.indexOf("how: ['How it works'"))
  assert.match(bubble, /says that nothing has to be done/)
  assert.match(bubble, /<b>Try again<\/b>/)
  for (const f of ['site/src/content/docs/help/update.md', 'site/src/content/docs/use/dashboard.md', 'site/src/content/docs/help/troubleshooting.md']) {
    assert.match(flat(f), /\*\*Try again\*\*/, f)
    assert.match(flat(f), /nothing has to be done/i, f)
  }
})

test('MAC-4: the uninstall does not state that the wallets hold funds, which it never checked, and names the recovery words', async () => {
  // A git checkout's own folder (the uninstall reads no .env and no database); systemctl and loginctl are stand-ins.
  const s = stubs()
  const dir = tmp('fox-checkout-')
  writeFileSync(join(dir, 'install.sh'), read('install.sh'), { mode: 0o755 })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'foxleague-agent', version: '3.1.0' }, null, 2) + '\n')
  const r = await sh(join(dir, 'install.sh'), ['--uninstall'], { HOME: tmp('fox-home-'), USER: 'tester', PATH: `${s.dir}:${process.env.PATH}` })
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /The agent wallets may still hold funds\. Keep the recovery words; delete the folder only when the wallets are empty\./)
  assert.doesNotMatch(r.out, /still hold their funds|backup words/)
  // The Windows uninstall and the pages that tell the uninstall say it the same way.
  for (const f of ['install.sh', 'get.ps1', 'INSTALL.md', 'README.md', 'site/src/content/docs/help/update.md']) assert.doesNotMatch(flat(f), /wallets (still hold their|keep their|hold their) funds/, f)
  assert.match(flat('get.ps1'), /The agent wallets may still hold funds\./)
  assert.match(flat('site/src/content/docs/help/update.md'), /The agent wallets may still hold funds\./)
})

const KEY = testKey()
const V103 = { version: '1.0.3', notes: 'Medicine for injured cards.', published: '2026-11-12T20:00:00Z' }
/** What the dashboard holds for an install that runs 1.0.2, checks for updates and has nothing on offer. */
const IDLE: UpdateView = { installed: '1.0.2', available: null, checkedAt: null, checkError: null, canInstall: true, how: null, state: 'idle', last: null, enabled: true, restarts: true, waiting: null }

/** A release server on this machine with 1.0.3 on it. */
async function releaseServer(): Promise<Awaited<ReturnType<typeof serve>>> {
  const out = tmp()
  buildRelease(out, codeTree(tmp(), '1.0.3'), '1.0.3', KEY.privatePem, { notes: V103.notes })
  return serve(publish(tmp(), [{ dir: out, version: '1.0.3' }], '1.0.3'))
}
/** The updater of an install made by the one-line installer that runs 1.0.2. */
function updaterOf(source: string, over: Partial<UpdaterDeps> = {}): Updater {
  const inst = managedInstall('1.0.2')
  const kv = new Map<string, string>()
  return new Updater({
    layout: detectLayout(inst.code), installed: '1.0.2', keys: [KEY.publicPem], source, isServer: false, enabled: true,
    dataDir: join(inst.root, 'data'), kv: { get: k => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
    notify: () => undefined, restart: async () => undefined, ...over,
  })
}

test('MAC-5: the release server is asked at most once in MIN_CHECK_GAP_MS: a check inside the gap or while another runs gets the last answer, and the check every 10 minutes is unchanged', async () => {
  const web = await releaseServer()
  const asked = (): number => web.hits.get('/latest/download/release.json') ?? 0
  try {
    const up = updaterOf(web.base)
    const first = await up.check()
    assert.equal(first.available?.version, '1.0.3')
    assert.equal(asked(), 1)
    const second = await up.check()
    assert.equal(asked(), 1, 'a second check right after the first asks nothing')
    assert.deepEqual(second, first, 'it answers with the last view')
    // Two at once, as a stuck double click sends them: one request, one answer.
    const twin = updaterOf(web.base)
    const [a, b] = await Promise.all([twin.check(), twin.check()])
    assert.equal(asked(), 2, 'two checks at once ask once')
    assert.deepEqual(a, b)
    // After the gap the release server is asked again (a gap of 40 ms here, the same rule).
    const quick = updaterOf(web.base, { checkGapMs: 40 })
    await quick.check()
    await quick.check()
    assert.equal(asked(), 3)
    await new Promise(r => setTimeout(r, 120))
    await quick.check()
    assert.equal(asked(), 4, 'after the gap the next check asks again')
  } finally {
    await web.close()
  }
  // A check that failed counts as well: a server that does not answer is not asked again at once, and the reason stays.
  let tries = 0
  const down = updaterOf('http://127.0.0.1:9', { fetch: async () => { tries++; throw new Error('offline') } })
  const failed = await down.check()
  assert.equal(failed.checkError, 'the release server did not answer')
  assert.deepEqual(await down.check(), failed)
  assert.equal(tries, 1, 'one request for two quick checks of a server that is down')
  // The gap is 15 seconds and has its name; the check 30 to 90 seconds after a start and then every 10 to 11 minutes
  // stays as it was.
  assert.equal(updater.MIN_CHECK_GAP_MS, 15_000)
  assert.equal(updater.CHECK_EVERY_MS, 10 * 60_000)
  assert.match(read('src/update/updater.ts'), /again\(CHECK_EVERY_MS \+ Math\.random\(\) \* 60_000\)[^\n]*\n[^\n]*\n[^\n]*\n\s*again\(30_000 \+ Math\.random\(\) \* 60_000\)/)
})

type Control = Element & { disabled: boolean }
type Api = (method: string, path: string) => Promise<unknown>
/**
 * The dashboard's update code from renderUpdate up to startUpdate (Check for updates sits between them), run on
 * stand-in elements with a stand-in api (the page's own carries the CSRF token) and toast.
 */
function updateCode(update: Partial<UpdateView>, o: { updating?: { to: string; since: number }; api?: Api } = {}): { S: { instance: { update: UpdateView } }; $: (id: string) => Control; toasts: [string, boolean][]; click: () => Promise<void> } {
  const html = read('src/web/dashboard.html')
  const code = html.slice(html.indexOf('function renderUpdate() {'), html.indexOf('async function startUpdate() {'))
  assert.ok(code.startsWith('function renderUpdate()'), 'renderUpdate was not found in the dashboard')
  assert.ok(code.includes('async function checkUpdate() {'), 'Check for updates (checkUpdate) was not found next to renderUpdate')
  const els: Record<string, Control> = {}
  const $ = (id: string): Control => (els[id] ??= { hidden: false, textContent: '', className: '', disabled: false })
  const S = { instance: { update: { ...IDLE, ...update } } }
  const toasts: [string, boolean][] = []
  const api: Api = o.api ?? (() => Promise.reject(new Error('no request was expected')))
  const page = new Function('S', '$', 'toast', 'updating', 'api', `${code}\nrenderUpdate()\nreturn { checkUpdate }`)(S, $, (m: string, bad?: boolean) => void toasts.push([m, Boolean(bad)]), o.updating ?? null, api) as { checkUpdate: () => Promise<void> }
  return { S, $, toasts, click: () => page.checkUpdate() }
}

test('MAC-5: Check for updates next to the version asks now, shows the answer at once and says it in a toast; it is off while it asks or an update installs, and hidden where the agent does not check', async () => {
  const html = flat('src/web/dashboard.html')
  assert.match(html, /<span id="verPill" class="pill mute" hidden><\/span><i class="info" data-tip="update">i<\/i> ?<span id="upCheckWrap" class="upcheck" hidden><button id="upCheck" class="linkbtn" type="button">Check for updates<\/button><i class="info" data-tip="upcheck">i<\/i><\/span>/, 'the control and its info bubble next to the version')
  assert.match(html, /\$\('upCheck'\)\.onclick = checkUpdate\b/)

  // Shown where the agent checks for updates, hidden where it does not (AGENT_UPDATE_CHECK=0, a service the CLI built).
  assert.equal(updateCode({}).$('upCheckWrap').hidden, false)
  assert.equal(updateCode({ enabled: false }).$('upCheckWrap').hidden, true)
  // Off while an update installs: by the agent's own state, and from the click on Update now.
  assert.equal(updateCode({}).$('upCheck').disabled, false)
  assert.equal(updateCode({ available: V103, state: 'downloading' }).$('upCheck').disabled, true)
  assert.equal(updateCode({ available: V103 }, { updating: { to: '1.0.3', since: Date.now() } }).$('upCheck').disabled, true)

  // The click: one request through the page's api, the control off while it runs.
  const calls: string[] = []
  let answer: (body: unknown) => void = () => undefined
  const p = updateCode({}, { api: (method, path) => { calls.push(`${method} ${path}`); return new Promise(r => { answer = r }) } })
  const running = p.click()
  assert.equal(p.$('upCheck').disabled, true, 'off while it asks')
  await p.click()
  assert.deepEqual(calls, ['POST /api/update/check'], 'a second click while it asks sends nothing')
  answer({ ok: true, update: { ...IDLE, available: V103, checkedAt: new Date().toISOString() } })
  await running
  assert.equal(p.$('upCheck').disabled, false, 'on again once it answered')
  assert.equal(p.S.instance.update.available?.version, '1.0.3', 'the answer is the page\'s state')
  assert.equal(p.$('upBanner').hidden, false, 'the notice shows at once')
  assert.equal(p.$('upText').textContent, 'Version 1.0.3 is out. You run 1.0.2.')
  assert.equal(p.$('upBtn').hidden, false)
  assert.deepEqual(p.toasts, [['Version 1.0.3 is out.', false]])

  const answered = async (body: unknown): Promise<ReturnType<typeof updateCode>> => {
    const q = updateCode({}, { api: async () => body })
    await q.click()
    return q
  }
  const newest = await answered({ ok: true, update: { ...IDLE, checkedAt: new Date().toISOString() } })
  assert.deepEqual(newest.toasts, [['You run 1.0.2, the newest version.', false]])
  assert.equal(newest.$('upBanner').hidden, true)
  const failed = await answered({ ok: true, update: { ...IDLE, checkedAt: new Date().toISOString(), checkError: 'the release server did not answer' } })
  assert.deepEqual(failed.toasts, [['The check failed: the release server did not answer. The agent tries again by itself in a few minutes.', true]])
  const refused = updateCode({}, { api: async () => { throw new Error('missing or wrong CSRF token') } })
  await refused.click()
  assert.deepEqual(refused.toasts, [['The check failed: missing or wrong CSRF token. The agent tries again by itself in a few minutes.', true]])
  assert.equal(refused.$('upCheck').disabled, false, 'on again after a failure')
  // A page whose session ended goes to the sign-in page (the page's api does that) and says nothing more.
  const out = updateCode({}, { api: async () => { throw new Error('signed out') } })
  await out.click()
  assert.deepEqual(out.toasts, [])
  // The release on offer is the one that was just undone here (MAC-3): the message does not read as "install it".
  const undone = { kind: 'undone' as const, version: '1.0.3', at: new Date().toISOString(), message: 'The update to 1.0.3 did not start and was undone: you run 1.0.2 as before. Your wallet, settings and history are untouched. It is safe to try again later.' }
  const again = await answered({ ok: true, update: { ...IDLE, available: V103, last: undone, checkedAt: new Date().toISOString() } })
  assert.deepEqual(again.toasts, [['Version 1.0.3 is still the newest. Nothing has to be done: the agent keeps running 1.0.2.', false]])
  assert.equal(again.$('upBtn').textContent, 'Try again')

  // Its info bubble: the agent checks by itself about every 10 minutes, this asks now, and only a signed newer
  // release is ever offered. The bubble of the version names it too.
  const tip = /upcheck: \['Check for updates', `([^`]*)`\]/.exec(html)?.[1] ?? ''
  for (const said of [/checks by itself about every 10 minutes/, /This asks now/, /Only a release that is signed by the foxleague-agent maintainers and newer than the one you run is ever offered/, /installs nothing/]) assert.match(tip, said)
  const version = html.slice(html.indexOf("update: ['Version and updates'"), html.indexOf("upcheck: ['Check for updates'"))
  assert.ok(version.length > 100, 'the bubble of the version comes before the one of the link')
  assert.match(version, /<b>Check for updates<\/b> next to the version asks at once/)
  for (const text of [tip, version]) assert.doesNotMatch(text, /—|\bbot\b/i)

  // The pages that say how often the agent checks, or how to ask at once, name the link.
  const pages = ['site/src/content/docs/help/update.md', 'site/src/content/docs/use/dashboard.md', 'site/src/content/docs/help/troubleshooting.md', 'site/src/content/docs/help/faq.md', 'site/src/content/docs/play/safety.md', 'INSTALL.md', 'README.md', 'docs/SERVER.md']
  for (const f of pages) assert.match(flat(f), /\*\*Check for updates\*\*/, f)
  const update = flat('site/src/content/docs/help/update.md')
  for (const said of [/Two checks less than 15 seconds apart ask GitHub once/, /`\.\/cli\.sh update-check`/, /nothing is installed until you press \*\*Update now\*\*/, /Where the check is switched off the link is not shown/]) assert.match(update, said)
  assert.match(flat('site/src/content/docs/play/safety.md'), /about every 10 minutes and when you press \*\*Check for updates\*\* \(at most once in 15 seconds\)/)
})

test('the record: the check has its section in docs/SECURITY-REVIEW.md, found by its heading, with the five findings, what passed and that nothing of it stays open', () => {
  const review = read('docs/SECURITY-REVIEW.md')
  const heading = '\n## Mac install check (2026-11-12)\n'
  const start = review.indexOf(heading)
  assert.ok(start >= 0, 'the section is in the record')
  assert.equal(review.split(heading).length, 2, 'once')
  // The final audit before the public launch stays the last section (test/audit-1111/docs-record.test.ts).
  assert.ok(start < review.indexOf('\n## Final audit before the public launch (2026-11-11)'), 'before the final audit')
  const next = review.indexOf('\n## ', start + heading.length)
  const section = review.slice(start, next < 0 ? undefined : next)
  assert.match(section, /\| Id \| Severity \| Finding \| Fix \|\n\|---\|---\|---\|---\|\n\| MAC-1 \| low \|/)
  for (const id of ['MAC-1', 'MAC-2', 'MAC-3', 'MAC-4', 'MAC-5']) {
    const rows = section.split('\n').filter(l => l.startsWith(`| ${id} |`))
    assert.equal(rows.length, 1, id)
    assert.equal(rows[0]!.split(' | ').length, 4, `${id} has its four cells`)
    assert.match(rows[0]!, new RegExp(`^\\| ${id} \\| low \\|`), id)
  }
  const text = section.replace(/\s+/g, ' ')
  for (const passed of [/macOS 15\.7\.3 on arm64/, /bash 3\.2/, /without Xcode's command line tools/, /launchd/, /after the Mac had slept/, /oldest release folder removed/, /undone in about 20 seconds/, /no service, no process and no port/]) assert.match(text, passed)
  assert.match(text, /Five findings, all low, none about money, keys or signing/)
  // The one item the check left open (the owner's call) is the row MAC-5 since the owner's go: what it was, what
  // changed, and nothing of the check stays open.
  const mac5 = section.split('\n').find(l => l.startsWith('| MAC-5 |')) ?? ''
  for (const item of [/no "check for updates now"/, /`\/api\/update\/check` existed, but the page never called it/, /30 to 90 seconds after a start, then every 10 to 11 minutes/, /`\.\/cli\.sh update-check`/, /the owner's call/, /the owner's go on 2026-11-13/]) assert.match(mac5.split(' | ')[2] ?? '', item, 'the finding')
  for (const item of [/\*\*Check for updates\*\*/, /`POST \/api\/update\/check`/, /session and CSRF token/, /`MIN_CHECK_GAP_MS`/, /at most once in 15 seconds/, /The check every 10 to 11 minutes is unchanged/]) assert.match(mac5.split(' | ')[3] ?? '', item, 'the fix')
  assert.ok(section.includes('\nStays open: nothing of this check. The item it left open is MAC-5 above.\n'), 'nothing of the check stays open')
  assert.doesNotMatch(section, /The dashboard has no "check for updates now"/)
  assert.doesNotMatch(section, /—|\bbot\b/i)
})
