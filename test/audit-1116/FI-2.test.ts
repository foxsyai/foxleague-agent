// FI-2 (R2I-8 is fixed for one of the two programs that prepare a release next to the running one): R2I-8 made
// confirmStart leave `.staging-*` alone while versions/update.lock is fresh. stage() (the dashboard's Update now and
// ./install.sh --update) holds that lock. The pasted install line does not: get.sh unpacks into
// versions/.staging-get and runs the new release's own `install.sh --prepare` there (Node.js, then npm ci: a minute
// or more on a home line), with no lock. confirmStart runs at EVERY start of the agent (updater.ts start(): at once
// when no update is waiting for its confirm, after 45 s when one is) and removes every folder whose name starts with
// ".staging-". So a start of the agent while the pasted line prepares (the restart of a crash, a login on a Mac,
// Ubuntu started by the Windows line itself, `systemctl --user restart`, the confirm 45 s after Update now) removes the
// folder npm is working in. The line ends with "version ... could not be prepared ... Check the connection" or with a
// bare `mv: cannot stat`, and the owner cannot tell why: the words R2I-8 was fixed for.
// Right: a start of the running agent leaves alone the folder the pasted line is still preparing in; the line ends
// well and its release is in place.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectLayout } from '../../src/update/install.ts'
import { Updater } from '../../src/update/updater.ts'
import { testKey, tmp } from '../update-fixtures.ts'
import { ownedInstall, pack, sh, smallTree, snapshotOf } from '../audit-1111/install-helpers.ts'

const GET = fileURLToPath(new URL('../../get.sh', import.meta.url))
const KEY = testKey()

test('FI-2: a start of the running agent leaves alone the folder the pasted install line is still preparing in', { timeout: 120_000 }, async () => {
  // An install at 1.1.0 whose agent is about to start (again); the owner pastes the line for 1.2.0.
  const i = ownedInstall('1.1.0')
  const versions = join(i.dir, 'versions')
  const marks = tmp('fox-marks-')
  // The new release's own --prepare (the stand-in for Node.js and npm ci): it says that it runs, takes its time, and
  // then needs its own folder, as npm does. With the folder gone it fails the way npm fails there.
  const prepare = [
    '#!/usr/bin/env bash',
    'case "${1:-}" in',
    '  --prepare)',
    '    here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)',
    `    : > ${JSON.stringify(join(marks, 'preparing'))}`,
    `    for _ in $(seq 1 400); do [ -e ${JSON.stringify(join(marks, 'go'))} ] && break; sleep 0.05; done`,
    '    [ -f "$here/package.json" ] || { echo "npm error enoent: the folder npm works in is gone" >&2; exit 1; }',
    '    : > "$here/.prepared"',
    '    exit 0 ;;',
    'esac',
    '',
  ].join('\n')
  const archive = pack(smallTree(tmp(), '1.2.0', { 'install.sh': prepare }))
  const staging = join(versions, '.staging-get')

  const said: string[] = []
  const kv = new Map<string, string>()
  const up = new Updater({
    layout: detectLayout(join(versions, 'v1.1.0')), installed: '1.1.0', keys: [KEY.publicPem], source: 'http://127.0.0.1:9', isServer: false, enabled: false,
    dataDir: join(i.dir, 'data'), kv: { get: k => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
    notify: t => void said.push(t), restart: async () => undefined, supervised: true,
  })
  let stagingAfterStart: boolean | null = null
  const line = sh(GET, [], { HOME: i.home, FOXAGENT_NO_RUN: '1', FOXAGENT_SOURCE: archive })
  try {
    // The line is preparing: the release is unpacked in its staging folder and --prepare runs.
    const end = Date.now() + 30_000
    while (!existsSync(join(marks, 'preparing')) && Date.now() < end) await new Promise(r => setTimeout(r, 25))
    assert.ok(existsSync(join(marks, 'preparing')), 'the pasted line reached --prepare')
    assert.ok(existsSync(join(staging, 'package.json')), 'the release is unpacked in versions/.staging-get')
    // The agent of 1.1.0 starts (any start: a crash's restart, a login, a restart typed by the owner).
    up.start()
    stagingAfterStart = existsSync(join(staging, 'package.json'))
  } finally {
    writeFileSync(join(marks, 'go'), '')
    up.stop()
  }
  const r = await line
  assert.equal(stagingAfterStart, true, 'the start of the running agent removed the folder the pasted line was preparing in')
  assert.equal(r.status, 0, r.out)
  assert.equal(readFileSync(join(versions, 'active'), 'utf8'), 'v1.2.0\n')
  assert.ok(existsSync(join(versions, 'v1.2.0', '.prepared')), 'the release in place is the one that was prepared')
  i.untouched()
})

// Added by the fix: the line holds the lock as stage() does, so it also waits its turn behind another update, and the
// lock goes on every way out.
test('FI-2: a fresh update.lock of another update stops the pasted line before it changes anything; one left by a kill is taken over', { timeout: 120_000 }, async () => {
  const i = ownedInstall('1.1.0')
  const lock = join(i.dir, 'versions', 'update.lock')
  // Another update is preparing a release: its lock is a minute old. That update may be another pasted line, whose
  // folder is versions/.staging-get, the one this line would use (R79A-1): it is not this line's to remove.
  writeFileSync(lock, '')
  utimesSync(lock, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000))
  mkdirSync(join(i.dir, 'versions', '.staging-get'), { recursive: true })
  writeFileSync(join(i.dir, 'versions', '.staging-get', 'package.json'), '{ "name": "foxleague-agent", "version": "1.3.0" }\n')
  const before = snapshotOf(i.dir)
  const archive = pack(smallTree(tmp(), '1.2.0'))
  const busy = await sh(GET, [], { HOME: i.home, FOXAGENT_NO_RUN: '1', FOXAGENT_SOURCE: archive })
  assert.notEqual(busy.status, 0, busy.out)
  assert.match(busy.out, /another update is being installed right now/, busy.out)
  assert.deepEqual(snapshotOf(i.dir), before, 'nothing was changed, the other update\'s lock and the other pasted line\'s staging folder included')
  rmSync(join(i.dir, 'versions', '.staging-get'), { recursive: true, force: true })
  // A lock an hour old was left by an update that was killed: the line takes it over and removes it at the end.
  utimesSync(lock, new Date(Date.now() - 3600_000), new Date(Date.now() - 3600_000))
  const taken = await sh(GET, [], { HOME: i.home, FOXAGENT_NO_RUN: '1', FOXAGENT_SOURCE: archive })
  assert.equal(taken.status, 0, taken.out)
  assert.equal(readFileSync(join(i.dir, 'versions', 'active'), 'utf8'), 'v1.2.0\n')
  assert.equal(existsSync(lock), false, 'the lock goes once versions/active names the new release')
  i.untouched()
})

test('FI-2: the lock goes when the preparing fails, and a folder whose versions/ holds only a killed run\'s lock is still empty to the line', { timeout: 120_000 }, async () => {
  const i = ownedInstall('1.1.0')
  const lock = join(i.dir, 'versions', 'update.lock')
  const failing = ['#!/usr/bin/env bash', 'case "${1:-}" in --prepare) echo "npm error: no network" >&2; exit 1 ;; esac', ''].join('\n')
  const r = await sh(GET, [], { HOME: i.home, FOXAGENT_NO_RUN: '1', FOXAGENT_SOURCE: pack(smallTree(tmp(), '1.2.0', { 'install.sh': failing })) })
  assert.notEqual(r.status, 0, r.out)
  assert.match(r.out, /could not be prepared/)
  assert.equal(existsSync(lock), false, 'the lock goes on a way out before the release is in place')
  assert.equal(readFileSync(join(i.dir, 'versions', 'active'), 'utf8'), 'v1.1.0\n')
  // A first install that was killed left only its leftovers: versions/ with a lock and a staging folder.
  const home = tmp('fox-home-')
  const dir = join(home, 'foxleague-agent')
  mkdirSync(join(dir, 'versions', '.staging-get'), { recursive: true })
  writeFileSync(join(dir, 'versions', 'update.lock'), '')
  const fresh = await sh(GET, [], { HOME: home, FOXAGENT_NO_RUN: '1', FOXAGENT_SOURCE: pack(smallTree(tmp(), '1.2.0')) })
  assert.equal(fresh.status, 0, fresh.out)
  assert.equal(readFileSync(join(dir, 'versions', 'active'), 'utf8'), 'v1.2.0\n')
  assert.equal(existsSync(join(dir, 'versions', 'update.lock')), false)
})
