// R2I-9 (INS-U6, the --no-service way through step 7): the old code of an install from before releases had folders of
// their own "goes once the service of step 7 is written" (install.sh, remove_old_code). With --no-service step 7
// writes no service, and remove_old_code runs all the same (install.sh:810). The old background service of that
// install is neither rewritten nor removed nor named on the screen: it still starts <folder>/src/service.ts, which is
// gone now. The agent it runs plays on from memory and at its next start (a reboot, a login) Node.js finds no code:
// the very state INS-U6 was fixed for, reached by `./install.sh --no-service` after the line was pasted over such an
// install (for example after the pasted installer was stopped at a question, which since INS-U6 leaves the old service
// running). The screen says only "Start the agent yourself with: <folder>/run.sh", so a second agent on the same
// wallets is started beside the old service's one.
// Right: the code a background service of this user still starts stays until that service is rewritten or removed
// (or the installer stops and says to remove it first: ./install.sh --uninstall).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Mnemonic } from '@multiversx/sdk-core'
import { LOGIN_LINES, REPO, answers, pack, realTree, sh, stubs, tmp } from '../audit-1111/install-helpers.ts'

/** The file a unit starts: its ExecStart's last argument. */
function started(unit: string): string {
  const exec = /^ExecStart=(.*)$/m.exec(readFileSync(unit, 'utf8'))![1]!
  return [...exec.matchAll(/"([^"]+)"|(\S+)/g)].map(m => m[1] ?? m[2]!).at(-1)!
}

test('R2I-9: ./install.sh --no-service over an older install leaves its background service code to start', { timeout: 240_000 }, async () => {
  const s = stubs()
  // An install as the installers made them before 2026-11-11, with the user unit they wrote (as INS-U6's own test).
  const home = tmp('fox-home-')
  const dir = join(home, 'foxleague-agent')
  for (const d of ['src', 'deploy', 'docs', 'data', 'pem', '.node/bin', 'node_modules/x']) mkdirSync(join(dir, d), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'foxleague-agent', version: '0.11.0' }, null, 2))
  writeFileSync(join(dir, 'src', 'service.ts'), '// the old code\n')
  writeFileSync(join(dir, '.env'), `AGENT_MNEMONIC="${Mnemonic.generate().getWords().join(' ')}"\n${LOGIN_LINES}`, { mode: 0o600 })
  writeFileSync(join(dir, '.node', 'bin', 'node'), ['#!/usr/bin/env bash', 'for a in "$@"; do if [ "$a" = backup-words ]; then echo " 1. (the recovery words, shown by the stand-in)"; exit 0; fi; done', `exec ${JSON.stringify(process.execPath)} "$@"`, ''].join('\n'), { mode: 0o755 })
  writeFileSync(join(dir, '.node', 'bin', 'npm'), readFileSync(join(s.dir, 'npm')), { mode: 0o755 })
  const unit = join(home, '.config', 'systemd', 'user', 'foxleague-agent.service')
  mkdirSync(join(home, '.config', 'systemd', 'user'), { recursive: true })
  writeFileSync(unit, `[Unit]\nDescription=foxleague-agent\n\n[Service]\nWorkingDirectory=${dir}\nExecStart="${join(dir, '.node', 'bin', 'node')}" --disable-warning=ExperimentalWarning "${join(dir, 'src', 'service.ts')}"\nRestart=on-failure\n`)
  const env = { HOME: home, USER: 'tester', PATH: `${s.dir}:${process.env.PATH}` }

  const get = await sh(join(REPO, 'get.sh'), [], { ...env, FOXAGENT_SOURCE: pack(realTree(tmp(), '3.2.0')), FOXAGENT_NO_RUN: '1' })
  assert.equal(get.status, 0, get.out)
  const a = answers(['yes', '', '18997', 'n', 'n'])
  try {
    const r = await sh(join(dir, 'versions', 'v3.2.0', 'install.sh'), ['--no-service'], { ...env, FOXAGENT_ROOT: dir, FOXAGENT_TTY: a.tty }, { cwd: dir, timeoutMs: 120_000 })
    // Whatever the installer does with --no-service here (keeps the old code, rewrites or removes the old service, or
    // stops and says to uninstall it first): a background service of this user that is still there has code to start.
    if (existsSync(unit)) {
      assert.ok(existsSync(started(unit)), `the background service of this user still starts ${started(unit)}, which the installer removed:\n${r.out.slice(r.out.indexOf('7/7'), r.out.indexOf('Done'))}`)
    }
    // Added by the fix: the screen says why the old code stays and what to do before ./run.sh.
    assert.match(r.out.replace(/\s+/g, ' '), /The background service of the older install in this folder still starts its own code \(\S+\/src\/service\.ts\), so that code stays\. .*\.\/install\.sh --uninstall/)
  } finally {
    a.close()
  }
})

test('R2I-9 control: ./install.sh --no-service over an older install without its service removes the old code', { timeout: 240_000 }, async () => {
  const s = stubs()
  const home = tmp('fox-home-')
  const dir = join(home, 'foxleague-agent')
  for (const d of ['src', 'deploy', 'docs', 'data', 'pem', '.node/bin', 'node_modules/x']) mkdirSync(join(dir, d), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'foxleague-agent', version: '0.11.0' }, null, 2))
  writeFileSync(join(dir, 'src', 'service.ts'), '// the old code\n')
  writeFileSync(join(dir, '.env'), `AGENT_MNEMONIC="${Mnemonic.generate().getWords().join(' ')}"\n${LOGIN_LINES}`, { mode: 0o600 })
  writeFileSync(join(dir, '.node', 'bin', 'node'), ['#!/usr/bin/env bash', 'for a in "$@"; do if [ "$a" = backup-words ]; then echo " 1. (the recovery words, shown by the stand-in)"; exit 0; fi; done', `exec ${JSON.stringify(process.execPath)} "$@"`, ''].join('\n'), { mode: 0o755 })
  writeFileSync(join(dir, '.node', 'bin', 'npm'), readFileSync(join(s.dir, 'npm')), { mode: 0o755 })
  const env = { HOME: home, USER: 'tester', PATH: `${s.dir}:${process.env.PATH}` }
  const get = await sh(join(REPO, 'get.sh'), [], { ...env, FOXAGENT_SOURCE: pack(realTree(tmp(), '3.2.0')), FOXAGENT_NO_RUN: '1' })
  assert.equal(get.status, 0, get.out)
  const a = answers(['yes', '', '18997', 'n', 'n'])
  try {
    const r = await sh(join(dir, 'versions', 'v3.2.0', 'install.sh'), ['--no-service'], { ...env, FOXAGENT_ROOT: dir, FOXAGENT_TTY: a.tty }, { cwd: dir, timeoutMs: 120_000 })
    assert.equal(r.status, 0, r.out.slice(-600))
    assert.equal(existsSync(join(dir, 'src', 'service.ts')), false, 'no service starts the old code: it goes')
    assert.match(r.out, /Start the agent yourself with: \S+\/run\.sh/)
  } finally {
    a.close()
  }
})
