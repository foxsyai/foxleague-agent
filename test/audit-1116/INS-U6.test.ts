// INS-U6 (unproven item U6 of the INSTALL review of 16 Nov 2026): an install from before releases had folders of their
// own ("flat": its code in the folder itself), pasted over. Its background service starts that code by its path:
// ExecStart=<node> <folder>/src/service.ts (the plist the same). get.sh removed that code (src/, node_modules/, ...)
// right after it put the new release in place, before the installer had written the new service at its step 7. Since
// INS-A1 a paste with no terminal and a cut while npm prepares change nothing at all. What is left: the installer is
// stopped at one of its questions before step 7 (Ctrl-C, a closed window, "Type yes" never typed). The old service then
// names code that is gone: the agent plays on from memory and, at its next start (a reboot, a login), Node.js finds no
// src/service.ts, the unit's five starts are used up and the agent stays down until the line is pasted again.
// Right: the old service's code stays until the installer has written the new service; then it goes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Mnemonic } from '@multiversx/sdk-core'
import { LOGIN_LINES, REPO, answers, pack, realTree, sh, stubs, tmp, type Stubs } from '../audit-1111/install-helpers.ts'

/** An install as the installers made them before 2026-11-11, with the user unit they wrote, and its owner's files. */
function flatInstall(s: Stubs): { home: string; dir: string; unit: string; env: Record<string, string> } {
  const home = tmp('fox-home-')
  const dir = join(home, 'foxleague-agent')
  for (const d of ['src', 'deploy', 'docs', 'data', 'pem', '.node/bin', 'node_modules/x']) mkdirSync(join(dir, d), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'foxleague-agent', version: '0.11.0' }, null, 2))
  writeFileSync(join(dir, 'src', 'service.ts'), '// the old code\n')
  writeFileSync(join(dir, 'install.sh'), '#!/usr/bin/env bash\necho "the old installer"\n', { mode: 0o755 })
  writeFileSync(join(dir, '.env'), `AGENT_MNEMONIC="${Mnemonic.generate().getWords().join(' ')}"\n${LOGIN_LINES}`, { mode: 0o600 })
  // Its private Node.js, which shows the words only to a terminal: here it says that it showed them (as freshInstall's).
  writeFileSync(
    join(dir, '.node', 'bin', 'node'),
    ['#!/usr/bin/env bash', 'for a in "$@"; do if [ "$a" = backup-words ]; then echo " 1. (the recovery words, shown by the stand-in)"; exit 0; fi; done', `exec ${JSON.stringify(process.execPath)} "$@"`, ''].join('\n'),
    { mode: 0o755 },
  )
  writeFileSync(join(dir, '.node', 'bin', 'npm'), readFileSync(join(s.dir, 'npm')), { mode: 0o755 })
  const unit = join(home, '.config', 'systemd', 'user', 'foxleague-agent.service')
  mkdirSync(join(home, '.config', 'systemd', 'user'), { recursive: true })
  writeFileSync(unit, `[Unit]\nDescription=foxleague-agent\n\n[Service]\nWorkingDirectory=${dir}\nExecStart="${join(dir, '.node', 'bin', 'node')}" --disable-warning=ExperimentalWarning "${join(dir, 'src', 'service.ts')}"\nRestart=on-failure\n`)
  return { home, dir, unit, env: { HOME: home, USER: 'tester', PATH: `${s.dir}:${process.env.PATH}` } }
}

/** The file the unit starts: its ExecStart's last argument. */
function started(unit: string): string {
  const exec = /^ExecStart=(.*)$/m.exec(readFileSync(unit, 'utf8'))![1]!
  return [...exec.matchAll(/"([^"]+)"|(\S+)/g)].map(m => m[1] ?? m[2]!).at(-1)!
}

async function paste(s: Stubs, f: ReturnType<typeof flatInstall>): Promise<string> {
  // The line itself stops where it hands over on /dev/tty (a test has none): FOXAGENT_NO_RUN, then the installer is
  // run as get.sh starts it.
  const get = await sh(join(REPO, 'get.sh'), [], { ...f.env, FOXAGENT_SOURCE: pack(realTree(tmp(), '3.2.0')), FOXAGENT_NO_RUN: '1' })
  assert.equal(get.status, 0, get.out)
  assert.equal(readFileSync(join(f.dir, 'versions', 'active'), 'utf8'), 'v3.2.0\n')
  return get.out
}

test('INS-U6: the installer stopped at a question after the line was pasted over an older install leaves the old service its code', { timeout: 240_000 }, async () => {
  const s = stubs()
  const f = flatInstall(s)
  assert.equal(started(f.unit), join(f.dir, 'src', 'service.ts'))
  const get = await paste(s, f)
  // The owner closes the window at "Type yes when the words are written down": no answer comes.
  const cut = await sh(join(f.dir, 'versions', 'v3.2.0', 'install.sh'), [], { ...f.env, FOXAGENT_ROOT: f.dir, FOXAGENT_TTY: '/dev/null' }, { cwd: f.dir, timeoutMs: 60_000 })
  assert.notEqual(cut.status, 0, cut.out)
  assert.doesNotMatch(cut.out, /7\/7/, 'the installer stopped before step 7')
  assert.equal(readFileSync(f.unit, 'utf8').includes('src/service.ts'), true, 'the old unit is still the one in place')
  assert.ok(existsSync(started(f.unit)), `the old service names ${started(f.unit)}, which is gone: the agent ends at its next start\n${get}`)
  assert.ok(existsSync(join(f.dir, 'node_modules')), 'and the old code keeps its dependencies')
})

test('INS-U6: once the installer has set up the new service, the old code goes and the owner\'s files stay', { timeout: 240_000 }, async () => {
  const s = stubs()
  s.stub('curl', 'case "$*" in *healthz*) exit 0 ;; esac\nexit 6') // the dashboard answers
  const f = flatInstall(s)
  await paste(s, f)
  const env = readFileSync(join(f.dir, '.env'), 'utf8')
  // The questions: the typed yes, "A login is already set. Change it?", the port, "Enter keys now?", the live permission.
  const a = answers(['yes', '', '18997', 'n', 'n'])
  try {
    const r = await sh(join(f.dir, 'versions', 'v3.2.0', 'install.sh'), [], { ...f.env, FOXAGENT_ROOT: f.dir, FOXAGENT_TTY: a.tty }, { cwd: f.dir, timeoutMs: 120_000 })
    assert.equal(r.status, 0, r.out.slice(-1200))
    assert.equal(started(f.unit), join(f.dir, 'run.sh'), 'the new unit starts the launcher')
    for (const gone of ['src', 'deploy', 'docs', 'node_modules', 'package.json']) assert.equal(existsSync(join(f.dir, gone)), false, `the old ${gone} is gone`)
    for (const kept of ['data', 'pem', '.node/bin/node', 'versions/v3.2.0/src/service.ts', 'run.sh', 'cli.sh', 'install.sh']) assert.ok(existsSync(join(f.dir, kept)), `${kept} is there`)
    assert.ok(readFileSync(join(f.dir, '.env'), 'utf8').startsWith(env.split('\n')[0]!), 'the words are kept')
  } finally {
    a.close()
  }
})
