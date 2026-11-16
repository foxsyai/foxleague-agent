// INS-A1: the pasted line over an install that RUNS. get.sh points versions/active at the new release (or swaps the
// folder of the same release for a fresh copy) BEFORE the installer has installed that release's dependencies, and
// removes versions/pending, so the launcher has no way back. When step 1 then fails or is cut (npm ci without a
// network, a full disk, Ctrl-C or a closed window while npm is silent), the agent that still runs in memory is fine
// until its next start; from then on run.sh starts a release without node_modules, the unit's five starts are used
// up and the agent stays down, without a word on Telegram or the dashboard.
// Safe: whatever happens to the pasted line, the release the launcher starts next has its dependencies.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildRelease, publish, serve } from '../update-fixtures.ts'
import { KEY, LOGIN_LINES, answers, realTree, running, sh, stubs, tmp } from '../audit-1111/install-helpers.ts'

/** npm as it behaves when the network drops (as test/audit-1111/install-1.test.ts has it): node_modules goes, then it fails. */
const NPM_DOWN = 'printf \'npm %s in %s\\n\' "$*" "$PWD" >> "$LOG"\nrm -rf node_modules\necho "npm error network request to https://registry.npmjs.org failed" >&2\nexit 1'

/** What the launcher would start now: the release folder, read from run.sh itself through a stand-in Node.js. */
function launcherStarts(root: string): string {
  const note = join(tmp('fox-note-'), 'started')
  const fake = join(tmp('fox-node-'), 'node')
  writeFileSync(fake, `#!/usr/bin/env bash\nfor a in "$@"; do case "$a" in */src/service.ts) printf '%s' "\${a%/src/service.ts}" > ${JSON.stringify(note)} ;; esac; done\n`, { mode: 0o755 })
  const kept = readFileSync(join(root, '.node-path'), 'utf8')
  writeFileSync(join(root, '.node-path'), fake + '\n')
  try {
    execFileSync('bash', [join(root, 'run.sh')], { encoding: 'utf8' })
  } finally {
    writeFileSync(join(root, '.node-path'), kept)
  }
  return readFileSync(note, 'utf8')
}

async function paste(version: string): Promise<{ root: string; get: string; installer: string }> {
  const s = stubs()
  const i = running(s) // 3.1.0 with its node_modules, a private Node.js, the launcher and a background service
  writeFileSync(join(i.root, '.env'), LOGIN_LINES, { mode: 0o600 })
  writeFileSync(join(i.root, '.node-path'), join(i.root, '.node', 'bin', 'node') + '\n')
  assert.ok(existsSync(join(launcherStarts(i.root), 'node_modules')), 'before the line is pasted the install starts')
  const out = tmp()
  buildRelease(out, realTree(tmp(), version), version, KEY.privatePem)
  const web = await serve(publish(tmp(), [{ dir: out, version }], version))
  // The release server is this test's own, on 127.0.0.1: the real curl may ask it.
  s.stub('curl', 'exec /usr/bin/curl "$@"')
  // From here on npm cannot reach its registry.
  s.stub('npm', NPM_DOWN)
  writeFileSync(join(i.root, '.node', 'bin', 'npm'), readFileSync(join(s.dir, 'npm')), { mode: 0o755 })
  const a = answers(['', '18997', 'n', 'n'])
  try {
    const env = { HOME: i.home, USER: 'tester', PATH: `${s.dir}:${process.env.PATH}`, FOXAGENT_RELEASES: web.base, FOXAGENT_TTY: a.tty }
    // The pasted line. Its last step hands over to the installer on /dev/tty, which a test has not: FOXAGENT_NO_RUN
    // stops it there and the installer it would start is run next, as get.sh starts it.
    const get = await sh(join(i.root, 'get.sh'), [], { ...env, FOXAGENT_NO_RUN: '1' })
    assert.match(get.out, /The download matches the release's checksum\./, get.out)
    // A get.sh that stopped by itself (one that prepares the release before it switches would stop at the failing
    // npm) starts no installer: the paste ended there.
    if (get.status !== 0) return { root: i.root, get: get.out, installer: '' }
    const active = readFileSync(join(i.root, 'versions', 'active'), 'utf8').trim()
    const installer = await sh(join(i.root, 'versions', active, 'install.sh'), [], { ...env, FOXAGENT_ROOT: i.root }, { cwd: i.root, timeoutMs: 60_000 })
    return { root: i.root, get: get.out, installer: installer.out }
  } finally {
    a.close()
    await web.close()
  }
}

test('INS-A1: the line pasted over a running install, with npm failing at step 1, leaves a release the launcher can start', { timeout: 240_000 }, async () => {
  const r = await paste('3.2.0')
  assert.match(r.get + r.installer, /npm error network request/, `the paste met the failing npm:\n${r.get}\n${r.installer}`)
  const code = launcherStarts(r.root)
  assert.ok(existsSync(join(code, 'node_modules')), `the launcher now starts ${code.split('/versions/')[1]}, which has no node_modules: the agent ends at its next start and nothing takes it back\n${r.get}\n${r.installer}`)
})

test('INS-A1: the line pasted again for the version that already runs keeps that version able to start when npm fails', { timeout: 240_000 }, async () => {
  const r = await paste('3.1.0')
  const code = launcherStarts(r.root)
  assert.equal(code.split('/versions/')[1], 'v3.1.0')
  assert.ok(existsSync(join(code, 'node_modules')), `the folder of the running release was swapped for a copy without node_modules and npm then failed\n${r.get}\n${r.installer}`)
})

test('INS-A1: ./install.sh run again while the agent runs keeps the running release able to start when npm is cut', { timeout: 240_000 }, async () => {
  // No new download at all: "Run the installer again at any time". deps() runs npm ci inside the release that runs,
  // and npm ci removes node_modules before it installs. Cut there (Ctrl-C while npm is silent, no network with an
  // empty cache, a full disk), the running release has no dependencies left.
  const s = stubs()
  const i = running(s)
  writeFileSync(join(i.root, '.env'), LOGIN_LINES, { mode: 0o600 })
  writeFileSync(join(i.root, '.node-path'), join(i.root, '.node', 'bin', 'node') + '\n')
  writeFileSync(join(i.root, '.node', 'bin', 'npm'), `#!/usr/bin/env bash\nLOG=/dev/null\n${NPM_DOWN}\n`, { mode: 0o755 })
  const a = answers(['', '18997', 'n', 'n'])
  try {
    const r = await sh(join(i.root, 'install.sh'), [], { HOME: i.home, USER: 'tester', PATH: `${s.dir}:${process.env.PATH}`, FOXAGENT_TTY: a.tty }, { cwd: i.root, timeoutMs: 60_000 })
    assert.match(r.out, /npm error network request/, r.out)
    assert.ok(existsSync(join(launcherStarts(i.root), 'node_modules')), `the release that runs lost its node_modules to an npm ci that did not finish\n${r.out}`)
  } finally {
    a.close()
  }
})

test('INS-A1: the line pasted where there is no terminal (ssh host "curl ... | bash", a scheduled job) leaves a release the launcher can start', { timeout: 240_000 }, async () => {
  // No stand-in fails here: npm would work. get.sh switches versions/active and then cannot open /dev/tty for the
  // installer, so the installer never runs and the release it switched to never gets its dependencies.
  const s = stubs()
  const i = running(s)
  writeFileSync(join(i.root, '.env'), LOGIN_LINES, { mode: 0o600 })
  writeFileSync(join(i.root, '.node-path'), join(i.root, '.node', 'bin', 'node') + '\n')
  const out = tmp()
  buildRelease(out, realTree(tmp(), '3.2.0'), '3.2.0', KEY.privatePem)
  const web = await serve(publish(tmp(), [{ dir: out, version: '3.2.0' }], '3.2.0'))
  s.stub('curl', 'exec /usr/bin/curl "$@"')
  try {
    // sh() starts bash in a session of its own: it has no controlling terminal, as under ssh without -t.
    const r = await sh(join(i.root, 'get.sh'), [], { HOME: i.home, USER: 'tester', PATH: `${s.dir}:${process.env.PATH}`, FOXAGENT_RELEASES: web.base }, { cwd: i.home, timeoutMs: 60_000 })
    assert.match(r.out, /The download matches the release's checksum\./, r.out)
    assert.doesNotMatch(r.out, /1\/7 Node\.js and dependencies/, `the installer did not run (no terminal):\n${r.out}`)
    const code = launcherStarts(i.root)
    assert.ok(existsSync(join(code, 'node_modules')), `the launcher now starts ${code.split('/versions/')[1]}, which has no node_modules, and the installer never ran:\n${r.out}`)
  } finally {
    await web.close()
  }
})
