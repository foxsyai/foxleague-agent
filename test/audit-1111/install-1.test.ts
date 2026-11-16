// INSTALL-1 and INSTALL-2 (regressions on the new scripts; the audit's proofs were written against the flat
// install of ac8833f and fail there, they cannot fail first on this branch: the new layout closed both).
// INSTALL-1: `./install.sh --update` ran get.sh from the install folder, and get.sh copied the new release over
//   that folder, get.sh included, while bash was still reading it: the first release that changed get.sh made
//   every update run a fragment of text as a command. Safe: an update whose release changes get.sh and
//   install.sh completes; the new release is prepared by its own installer.
// INSTALL-2: the update replaced the code first and ran `npm ci` afterwards, with no way back: a failed
//   dependency install left new code without dependencies. Safe: after an update that failed, the release that
//   was running still loads and is the one the launcher starts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectLayout, refreshLauncher } from '../../src/update/install.ts'
import { buildRelease, publish, serve } from '../update-fixtures.ts'
import { KEY, NPM_CI, realTree, running, sh, snapshotOf, stubs, tmp } from './install-helpers.ts'

test('INSTALL-1: an update to a release whose get.sh and install.sh changed completes, prepared by the new installer', { timeout: 240_000 }, async () => {
  const s = stubs()
  const i = running(s)
  // The next release: get.sh gained lines near its top (what broke the old update), install.sh notes which
  // installer ran and gained lines too.
  const next = realTree(tmp(), '3.2.0')
  const lines = (f: string): string[] => readFileSync(join(next, f), 'utf8').split('\n')
  const get = lines('get.sh')
  get.splice(9, 0, '#   FOXAGENT_KEEP=1           a new option, documented in the next release', '#   and a second line, so every later byte of the script moved')
  writeFileSync(join(next, 'get.sh'), get.join('\n'))
  const ins = lines('install.sh')
  ins.splice(ins.indexOf('set -euo pipefail') + 1, 0, '# a line the next release added', 'printf "the installer of 3.2.0: %s\\n" "$*" >> "${FOXAGENT_ROOT:-/nonexistent}/which-installer.log"')
  writeFileSync(join(next, 'install.sh'), ins.join('\n'))
  const out = tmp()
  buildRelease(out, next, '3.2.0', KEY.privatePem)
  const web = await serve(publish(tmp(), [{ dir: out, version: '3.2.0' }], '3.2.0'))
  const oldGet = readFileSync(join(i.root, 'get.sh'), 'utf8')
  try {
    // From the install folder, the way the owner types it.
    const r = await sh(join(i.root, 'install.sh'), ['--update'], i.env(web.base), { cwd: i.root })
    assert.equal(r.status, 0, r.out)
    assert.doesNotMatch(r.out, /command not found|syntax error/)
    assert.match(r.out, /Version 3\.2\.0 is in place\./)
    assert.equal(readFileSync(join(i.root, 'versions', 'active'), 'utf8'), 'v3.2.0\n')
    assert.equal(readFileSync(join(i.root, 'which-installer.log'), 'utf8'), 'the installer of 3.2.0: --prepare\n', 'the new release was prepared by its own install.sh')
    assert.ok(s.calls().includes(`${NPM_CI} in ${join(i.root, 'versions', '.staging-v3.2.0')}`), 'its dependencies were installed before the switch')
    // The owner's restart: the user's service manager is looked for, asked whether the service runs (a stopped one stays
    // stopped since UPD-U5 of 2026-11-16), the unit's start counter is cleared (FRESH-1), then the restart.
    assert.deepEqual(s.calls().filter(c => c.startsWith('systemctl')), ['systemctl --user show-environment', 'systemctl --user is-active foxleague-agent', 'systemctl --user reset-failed foxleague-agent', 'systemctl --user restart foxleague-agent'])
    assert.equal(readFileSync(join(i.root, 'get.sh'), 'utf8'), oldGet, 'no script in the install folder was written over while the update ran')
    assert.equal(readFileSync(join(i.root, 'versions', 'v3.1.0', 'get.sh'), 'utf8'), oldGet, 'and the release that was running is as it was')
    // Once the new release has started and stayed up, its scripts take the place of the old ones, by rename.
    const changed = refreshLauncher(detectLayout(join(i.root, 'versions', 'v3.2.0')))
    assert.ok(changed.includes('get.sh'))
    assert.equal(readFileSync(join(i.root, 'get.sh'), 'utf8'), get.join('\n'))
    // And the next update is run by the new installer, through the same entry.
    const again = await sh(join(i.root, 'install.sh'), ['--update'], i.env(web.base), { cwd: i.root })
    assert.equal(again.status, 0, again.out)
    assert.match(again.out, /You run 3\.2\.0, the newest version\./)
    assert.match(readFileSync(join(i.root, 'which-installer.log'), 'utf8'), /^the installer of 3\.2\.0: --update$/m)
  } finally {
    await web.close()
  }
})

test('INSTALL-2: a dependency install that fails during an update leaves the running release loading and running', { timeout: 240_000 }, async () => {
  const s = stubs()
  const i = running(s)
  writeFileSync(join(i.root, '.env'), 'AGENT_MNEMONIC="abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"\n', { mode: 0o600 })
  // npm ci as it behaves when the network drops: it removes node_modules first, then fails.
  writeFileSync(join(i.root, '.node', 'bin', 'npm'), `#!/usr/bin/env bash\nprintf 'npm %s in %s\\n' "$*" "$PWD" >> ${JSON.stringify(join(s.dir, 'calls.log'))}\nrm -rf node_modules\necho "npm error code ENOTFOUND" >&2\nexit 1\n`)
  chmodSync(join(i.root, '.node', 'bin', 'npm'), 0o755)
  const out = tmp()
  buildRelease(out, realTree(tmp(), '3.2.0'), '3.2.0', KEY.privatePem)
  const web = await serve(publish(tmp(), [{ dir: out, version: '3.2.0' }], '3.2.0'))
  const loads = (): Promise<{ status: number; out: string }> => sh(join(i.root, 'cli.sh'), ['address', '1'], { HOME: i.home, PATH: process.env.PATH ?? '' })
  const before = snapshotOf(join(i.root, 'versions', 'v3.1.0', 'src'))
  try {
    assert.equal((await loads()).status, 0, 'before the update the install loads')
    const r = await sh(join(i.root, 'install.sh'), ['--update'], i.env(web.base), { cwd: i.root })
    assert.notEqual(r.status, 0)
    assert.match(r.out, /No update: the new version could not be prepared, nothing was changed/)
    assert.match(r.out, /npm error code ENOTFOUND/, 'with what npm said')
    assert.match(r.out, /The update was not installed\. The agent runs as before\./)
    assert.ok(s.calls().some(c => c === `${NPM_CI} in ${join(i.root, 'versions', '.staging-v3.2.0')}`), 'the failed install ran in the new release\'s own folder')
    assert.deepEqual(s.calls().filter(c => c.startsWith('systemctl')), [], 'no restart')
    assert.equal(readFileSync(join(i.root, 'versions', 'active'), 'utf8'), 'v3.1.0\n')
    assert.deepEqual(readdirSync(join(i.root, 'versions')).sort(), ['active', 'v3.1.0'], 'no half-made release, no undo note, no lock')
    assert.deepEqual(snapshotOf(join(i.root, 'versions', 'v3.1.0', 'src')), before, 'the running release is byte for byte as it was')
    assert.ok(existsSync(join(i.root, 'versions', 'v3.1.0', 'node_modules', '@multiversx', 'sdk-core')), 'with its dependencies')
    const after = await loads()
    assert.equal(after.status, 0, after.out)
    assert.match(after.out, /^agent 1: erd1/m, 'after the failed update the install still loads')
    // What the launcher would start: the release that was running.
    const fake = join(i.root, 'fake-node')
    writeFileSync(fake, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" > ${JSON.stringify(join(i.root, 'started'))}\n`)
    chmodSync(fake, 0o755)
    writeFileSync(join(i.root, '.node-path'), `${fake}\n`)
    assert.equal((await sh(join(i.root, 'run.sh'), [], { HOME: i.home, PATH: process.env.PATH ?? '' })).status, 0)
    assert.ok(readFileSync(join(i.root, 'started'), 'utf8').trim().endsWith(join(i.root, 'versions', 'v3.1.0', 'src', 'service.ts')))
  } finally {
    await web.close()
  }
})
