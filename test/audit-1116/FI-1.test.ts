// FI-1 (R2I-2 is fixed only where root made the database): R2I-2 lets run.sh and cli.sh go on as root on another
// user's folder "when data/agent.db is root's already", as the sign of an agent that already runs as root there (a
// container with the host's install mounted, a system unit without User=, root's crontab). Its test gives that sign
// with a stand-in stat that answers "root" for everything in data/.
// On a real install the sign is not there. The guided installer makes data/agent.db itself, as the user who installs
// (step 6, `cli export-pem 1` opens the Store, src/cli.ts:238; first_install() in install.sh counts on it), and a
// process that runs as root and writes into a file that exists never changes its owner (SQLite goes further: as root
// it gives its -wal and -shm files to the owner of the database). So on "a container that mounts your install"
// (INSTALL.md:531, help/troubleshooting.md:49: "still starts") and under a system unit without User= on an install
// the installer made, agent.db is the installing user's for ever, and the launcher that an update's confirm puts in
// place refuses at the next start: "this install belongs to ..., not to root", status 1. It is R2I-2 unchanged: the
// launcher is what undoes an update that does not start, and it is the launcher that refuses.
// Right: the launcher an update's confirm puts in place starts the agent wherever the launcher it replaces did. The
// test gives every sign that tells this start from a mistaken `sudo ./run.sh`: no SUDO_* variable, no terminal,
// FOXAGENT_SUPERVISED=1 (as the guides ask of such a setup), and what root really made there is root's (the files the
// agent writes anew as root: data/service.pid, and versions/active, versions/previous after its own update).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { refreshLauncher } from '../../src/update/install.ts'
import { TEST_PORT, LOGIN_LINES, freshInstall, guided, running, sh, stubs, tmp } from '../audit-1111/install-helpers.ts'

const TREE = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '')
const AS_ROOT = 'case "$*" in -u) echo 0 ;; -un) echo root ;; *) exec /usr/bin/id "$@" ;; esac'
// Root sees the real owners. Only what the agent made anew while it ran as root is root's: its pid file and the
// files its update wrote by rename. The folder, data/ and agent.db keep the owner the installer gave them.
const WHAT_ROOT_MADE = [
  'last="${@: -1}"',
  'case "$last" in */data/service.pid | */versions/active | */versions/previous | */versions/pending)',
  '  case " $* " in *" %u "*) echo 0; exit 0 ;; *" %U "* | *" %Su "*) echo root; exit 0 ;; esac ;;',
  'esac',
  'exec /usr/bin/stat "$@"',
].join('\n')

function countingNode(root: string): () => string[] {
  const ran = join(tmp('fox-ran-'), 'ran')
  const fake = join(tmp('fox-node-'), 'node')
  writeFileSync(fake, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(ran)}\nexit 0\n`, { mode: 0o755 })
  writeFileSync(join(root, '.node-path'), `${fake}\n`)
  return () => (existsSync(ran) ? readFileSync(ran, 'utf8').trim().split('\n') : [])
}

test('FI-1: an agent a service manager starts as root on an install the installer made still starts after an update\'s confirm', { timeout: 240_000 }, async () => {
  // The owner installs as themselves with the real guided installer (no service: a container or a unit of their own
  // starts the agent).
  const i = freshInstall()
  writeFileSync(join(i.root, '.env'), LOGIN_LINES, { mode: 0o600 })
  const made = await guided(i, ['yes', '', TEST_PORT, 'n', 'n'])
  assert.equal(made.status, 0, made.out.slice(-1500))
  const db = join(i.root, 'data', 'agent.db')
  assert.ok(existsSync(db), 'the guided installer made the database itself')
  assert.equal(statSync(db).uid, process.getuid!(), 'and it is the installing user\'s, not root\'s')

  // From here the agent is started as root: a container with this folder mounted in, or a system unit without User=.
  i.s.stub('id', AS_ROOT)
  i.s.stub('stat', WHAT_ROOT_MADE)
  writeFileSync(join(i.root, 'data', 'service.pid'), '1\n')
  const ran = countingNode(i.root)
  const env = { HOME: '/root', USER: 'root', PATH: `${i.s.dir}:${process.env.PATH}`, FOXAGENT_SUPERVISED: '1' }

  // The launcher of the version before this one (main 955664a, the project's own fixture) starts the agent there.
  writeFileSync(join(i.root, 'run.sh'), readFileSync(join(TREE, 'test', 'audit-1116', 'fixtures', 'run-955664a.sh'), 'utf8'), { mode: 0o755 })
  const before = await sh(join(i.root, 'run.sh'), [], env, { cwd: '/' })
  assert.equal(before.status, 0, before.out)
  assert.equal(ran().length, 1, 'the launcher before this release starts the agent')
  // Running as root wrote into the database and did not change whose it is.
  assert.equal(statSync(db).uid, process.getuid!())

  // The update to this release is confirmed: its launcher takes the place of the old one.
  assert.ok(refreshLauncher({ root: i.root, code: i.code, managed: true }).includes('run.sh'), 'the confirm replaces run.sh')
  const after = await sh(join(i.root, 'run.sh'), [], env, { cwd: '/' })
  assert.equal(ran().length, 2, `after the confirm the launcher no longer starts the agent, and it is the launcher that undoes an update:\n${after.out}`)
  assert.equal(after.status, 0, after.out)
})

// Added by the fix: each sign on its own, and what still stops a mistaken sudo. The launcher and the command line ask
// the same.
const ACTIVE_IS_ROOTS = ['last="${@: -1}"', 'case "$last" in */versions/active) case " $* " in *" %u "*) echo 0; exit 0 ;; *" %U "* | *" %Su "*) echo root; exit 0 ;; esac ;; esac', 'exec /usr/bin/stat "$@"'].join('\n')

/** An install of the test user's started as root (a stand-in id), with `stat` as given; what each script did. */
async function asRoot(o: { stat?: string; env?: Record<string, string>; dotEnv?: string; terminal?: boolean; activeLink?: boolean }) {
  const s = stubs()
  s.stub('id', AS_ROOT)
  if (o.stat) s.stub('stat', o.stat)
  const i = running(s)
  if (o.dotEnv !== undefined) writeFileSync(join(i.root, '.env'), o.dotEnv, { mode: 0o600 })
  if (o.activeLink) {
    writeFileSync(join(i.root, 'versions', 'active.real'), 'v3.1.0\n')
    const active = join(i.root, 'versions', 'active')
    rmSync(active)
    symlinkSync(join(i.root, 'versions', 'active.real'), active)
  }
  const ran = countingNode(i.root)
  const env = { HOME: '/root', USER: 'root', PATH: `${s.dir}:${process.env.PATH}`, ...o.env }
  const out: Record<string, { status: number | null; out: string }> = {}
  for (const script of ['run.sh', 'cli.sh']) {
    const args = script === 'cli.sh' ? ['address', '1'] : []
    // A terminal: `script` gives the start one on its input and output, as a shell typed into has.
    out[script] = o.terminal
      ? await sh('', ['-c', `script -qec ${JSON.stringify(`bash ${join(i.root, script)} ${args.join(' ')}`)} /dev/null`], env, { cwd: '/' })
      : await sh(join(i.root, script), args, env, { cwd: '/' })
  }
  return { ran: ran(), out }
}

test('FI-1: each sign alone lets a root start go on: FOXAGENT_SUPERVISED=1 in the environment or in .env (no sudo, no terminal), versions/active root\'s', { timeout: 120_000 }, async () => {
  for (const [what, o] of [
    ['FOXAGENT_SUPERVISED=1 in the environment', { env: { FOXAGENT_SUPERVISED: '1' } }],
    ['FOXAGENT_SUPERVISED=1 in .env, as the guides ask', { dotEnv: 'WEB_UI_PORT="18870"\nFOXAGENT_SUPERVISED="1"\n' }],
    ['versions/active root\'s (its own update wrote it)', { stat: ACTIVE_IS_ROOTS }],
  ] as const) {
    const r = await asRoot(o)
    assert.equal(r.ran.length, 2, `${what}: ${JSON.stringify(r.out)}`)
  }
})

/** Whether util-linux `script` is here and gives the command it starts a terminal. */
const TERMINAL = spawnSync('script', ['-qec', 'test -t 0 && test -t 1 && test -t 2 && echo terminal', '/dev/null'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).stdout?.includes('terminal') === true

test('FI-1: a mistaken sudo or a root terminal is still refused, whatever FOXAGENT_SUPERVISED says; a link named versions/active is no sign', { timeout: 120_000 }, async t => {
  if (!TERMINAL) t.diagnostic('util-linux script is not here: the root terminal is not tried')
  for (const [what, o] of [
    ['sudo with FOXAGENT_SUPERVISED=1', { env: { FOXAGENT_SUPERVISED: '1', SUDO_USER: 'ana', SUDO_UID: '1000', SUDO_COMMAND: '/bin/bash ./run.sh' } }],
    ['a root terminal with FOXAGENT_SUPERVISED=1', { env: { FOXAGENT_SUPERVISED: '1' }, terminal: true }],
    ['.env says 1 but the environment says 0', { env: { FOXAGENT_SUPERVISED: '0' }, dotEnv: 'FOXAGENT_SUPERVISED=1\n' }],
    ['a link named versions/active to a file of root\'s', { stat: ACTIVE_IS_ROOTS, activeLink: true }],
  ] as const) {
    if ('terminal' in o && !TERMINAL) continue
    const r = await asRoot(o)
    assert.deepEqual(r.ran, [], `${what}: ${JSON.stringify(r.out)}`)
    for (const script of ['run.sh', 'cli.sh']) assert.match(r.out[script]!.out, /belongs to \S+, not to root: run it as \S+, without sudo/, `${what} (${script}): ${r.out[script]!.out}`)
  }
})
