// The Mac install check of 2026-11-12 (the owner's MacBook Air, macOS 15.7.3 on arm64, with no Node.js before):
// four findings, each with its test here, named after it and failing before its fix. The record is the section
// "Mac install check (2026-11-12)" of docs/SECURITY-REVIEW.md.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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
