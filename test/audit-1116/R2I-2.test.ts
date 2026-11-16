// R2I-2 (INS-A8 stops an agent that already runs as root, and no undo catches it): run.sh now refuses whenever it is
// root and its folder is another user's. INS-A8 meant `sudo ./run.sh` typed by mistake on an install whose agent runs
// as its user. But an agent that a service manager starts as root on such a folder ran fine until now and its data is
// root's already:
//   - a container that restarts (the guides name it: .env.example:75, help/update.md "a container that restarts") with
//     the host's install mounted in: the process is root, the mounted folder keeps the host user's number;
//   - a system unit of the owner's own without User= (root is systemd's default) that starts /home/ana/.../run.sh;
//   - root's crontab (@reboot .../run.sh).
// There the update that brings this release goes through (--prepare is let through as root, the old launcher starts
// the new release, it stays up 45 s and is confirmed), and the confirm puts the new run.sh in the folder
// (refreshLauncher). The NEXT start (a reboot, the next update's exit 75, a crash) ends in "this install belongs to
// ..., not to root" with status 1. The launcher is what undoes an update that does not start, and it is the launcher
// that refuses: nothing goes back, the agent stays down with its paid seats unplayed until its owner reads the log.
// Right: the launcher an update's confirm puts in place starts the agent wherever the launcher it replaces did. The
// test gives every sign that tells this start from a mistaken `sudo ./run.sh`: no SUDO_* variable, no terminal,
// FOXAGENT_SUPERVISED=1 in the environment (as the guides ask of such a setup) and a database that is root's already.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { refreshLauncher } from '../../src/update/install.ts'
import { running, sh, stubs, tmp } from '../audit-1111/install-helpers.ts'

const AS_ROOT = 'case "$*" in -u) echo 0 ;; -un) echo root ;; *) exec /usr/bin/id "$@" ;; esac'
// The folder is the host user's (the real stat says so: the test user's own number, not 0). What the agent wrote as
// root (data/ and what is in it) is root's.
const ROOTS_DATA = ['last="${@: -1}"', 'case "$last" in */data | */data/*) case " $* " in *" %u "*) echo 0; exit 0 ;; *" %U "* | *" %Su "*) echo root; exit 0 ;; esac ;; esac', 'exec /usr/bin/stat "$@"'].join('\n')

function countingNode(root: string): () => string[] {
  const ran = join(tmp('fox-ran-'), 'ran')
  const fake = join(tmp('fox-node-'), 'node')
  writeFileSync(fake, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(ran)}\nexit 0\n`, { mode: 0o755 })
  writeFileSync(join(root, '.node-path'), `${fake}\n`)
  return () => (existsSync(ran) ? readFileSync(ran, 'utf8').trim().split('\n') : [])
}

test('R2I-2: an agent a service manager starts as root on a folder of another user still starts after an update\'s confirm', async () => {
  const s = stubs()
  s.stub('id', AS_ROOT)
  s.stub('stat', ROOTS_DATA)
  const i = running(s)
  mkdirSync(join(i.root, 'data'), { recursive: true })
  writeFileSync(join(i.root, 'data', 'agent.db'), 'the ledger, written by the agent as root')
  const ran = countingNode(i.root)
  // As the container or the unit starts it: root, no sudo, no terminal, and it says that it is started again.
  const env = { HOME: '/root', USER: 'root', PATH: `${s.dir}:${process.env.PATH}`, FOXAGENT_SUPERVISED: '1' }

  // The launcher of the version that runs on the owner's server today (main 955664a) starts the agent there. Kept as a
  // file beside this test (`git show 955664a:run.sh`): CI checks out one commit, without that history.
  writeFileSync(join(i.root, 'run.sh'), readFileSync(fileURLToPath(new URL('./fixtures/run-955664a.sh', import.meta.url)), 'utf8'), { mode: 0o755 })
  const before = await sh(join(i.root, 'run.sh'), [], env, { cwd: '/' })
  assert.equal(before.status, 0, before.out)
  assert.equal(ran().length, 1, 'the launcher before this release starts the agent')

  // The update to this release is confirmed: its launcher takes the place of the old one.
  assert.ok(refreshLauncher({ root: i.root, code: i.code, managed: true }).includes('run.sh'), 'the confirm replaces run.sh')
  const after = await sh(join(i.root, 'run.sh'), [], env, { cwd: '/' })
  assert.equal(ran().length, 2, `after the confirm the launcher no longer starts the agent, and it is the launcher that undoes an update:\n${after.out}`)
  assert.equal(after.status, 0, after.out)
})

// Added by the fix: a mistaken `sudo ./run.sh` on an agent that runs as its user is still refused, and an owner that
// GNU stat names UNKNOWN (no user of that number on this machine, as in a container) is named by number.
test('R2I-2: sudo ./run.sh on an install whose database is its user\'s is still refused; a link named agent.db does not pass', async () => {
  const s = stubs()
  s.stub('id', AS_ROOT)
  const i = running(s)
  mkdirSync(join(i.root, 'data'), { recursive: true })
  writeFileSync(join(i.root, 'data', 'agent.db'), 'the ledger, written by the agent as its user')
  const ran = countingNode(i.root)
  const r = await sh(join(i.root, 'run.sh'), [], { HOME: '/root', USER: 'root', PATH: `${s.dir}:${process.env.PATH}`, SUDO_USER: 'ana' }, { cwd: i.root })
  assert.notEqual(r.status, 0, r.out)
  assert.match(r.out, /belongs to \S+, not to root: run it as \S+, without sudo: cd \S+ && \.\/run\.sh/)
  assert.deepEqual(ran(), [])
  // A link named agent.db that a user made to a file of root's: stat would answer root (the stand-in says so of every
  // path in data/), the launcher does not ask it of a link.
  const l = stubs()
  l.stub('id', AS_ROOT)
  l.stub('stat', ROOTS_DATA)
  const j = running(l)
  mkdirSync(join(j.root, 'data'), { recursive: true })
  symlinkSync('/etc/hostname', join(j.root, 'data', 'agent.db'))
  const ranLink = countingNode(j.root)
  const linked = await sh(join(j.root, 'run.sh'), [], { HOME: '/root', USER: 'root', PATH: `${l.dir}:${process.env.PATH}` }, { cwd: j.root })
  assert.notEqual(linked.status, 0, linked.out)
  assert.deepEqual(ranLink(), [])
})

test('R2I-2: an owner GNU stat names UNKNOWN is named by number, never "run it as UNKNOWN"', async () => {
  const s = stubs()
  s.stub('id', AS_ROOT)
  s.stub('stat', ['last="${@: -1}"', 'case " $* " in *" %U "*) echo UNKNOWN; exit 0 ;; esac', 'case "$last" in */.) case " $* " in *" %u "*) echo 1000; exit 0 ;; esac ;; esac', 'exec /usr/bin/stat "$@"'].join('\n'))
  const i = running(s)
  const ran = countingNode(i.root)
  const env = { HOME: '/root', USER: 'root', PATH: `${s.dir}:${process.env.PATH}` }
  for (const script of ['run.sh', 'cli.sh']) {
    const r = await sh(join(i.root, script), [], env, { cwd: i.root })
    assert.notEqual(r.status, 0, r.out)
    assert.match(r.out, /this install belongs to the user with number 1000 \(no name on this machine\), not to root: run it as that user, without sudo/, r.out)
    assert.doesNotMatch(r.out, /UNKNOWN/)
  }
  assert.deepEqual(ran(), [])
})
