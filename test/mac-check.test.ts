// The Mac install check of 2026-11-12 (the owner's MacBook Air, macOS 15.7.3 on arm64, with no Node.js before):
// four findings, each with its test here, named after it and failing before its fix. The record is the section
// "Mac install check (2026-11-12)" of docs/SECURITY-REVIEW.md.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UpdateView } from '../src/update/updater.ts'
import { LOGIN_LINES, freshInstall, guided, realTree, sh, stubs } from './audit-1111/install-helpers.ts'
import { REPO, tmp } from './update-fixtures.ts'

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
