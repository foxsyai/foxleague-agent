// FRESH-2 (fresh Ubuntu walk-through, 2026-11-11): on a machine where systemd does not run (WSL2 before systemd is
// turned on, a container) the installer found out at step 7 of 7. By then the newcomer had written down 24 words,
// chosen a login and typed keys; the error then named `./install.sh --no-service`, a file that is not in the
// folder the pasted line was typed in. Safe: the installer looks for the user's service manager before its first
// question; without one it stops there, asks nothing, makes no wallet and names a command that exists.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOGIN_LINES, freshInstall, guided, tmp, type Install } from './install-helpers.ts'

/** No user service manager answers: what `systemctl --user` and `loginctl` say where systemd is not running. */
function noUserSystemd(i: Install): void {
  i.s.stub('systemctl', `printf 'systemctl %s\\n' "$*" >> "$LOG"\necho "System has not been booted with systemd as init system (PID 1). Can't operate." >&2\nexit 1`)
  i.s.stub('loginctl', `printf 'loginctl %s\\n' "$*" >> "$LOG"\necho "Failed to connect to bus: No such file or directory" >&2\nexit 1`)
}

test('FRESH-2: where systemd does not run the installer stops before its first question', { timeout: 120_000 }, async () => {
  const i = freshInstall()
  noUserSystemd(i)
  // FOXAGENT_RUN: where the installer looks for /run/systemd/system and /run/user/<uid>. Here: a machine without systemd.
  const run = tmp('fox-run-')
  const r = await guided(i, ['yes', 'owner', '18997', 'n', 'n'], { args: [], env: { FOXAGENT_RUN: run } })
  assert.notEqual(r.status, 0, r.out)
  assert.equal(r.unread, 5, 'no question was asked')
  assert.doesNotMatch(r.out, /2\/7 Your wallet/, 'it stopped before the wallet step')
  assert.equal(i.wordsShown(), 0, 'no recovery words were shown')
  assert.equal(existsSync(join(i.root, '.env')), false, 'no wallet was made')
  assert.match(r.out, /Error: this machine does not run systemd/)
  assert.match(r.out, /\/etc\/wsl\.conf/, 'it says what to do on WSL2')
  // The command it names exists: the folder is spelled out and its install.sh is in place.
  assert.ok(r.out.includes(`cd ${i.root} && ./install.sh --no-service`), r.out)
  assert.ok(existsSync(join(i.root, 'install.sh')), 'install.sh is in the folder the message names')
  assert.deepEqual(readdirSync(i.root).filter(f => f === 'data' || f === 'pem'), [], 'no data, no keys')

  // That command goes through (a login is given: choosing one needs a real terminal).
  writeFileSync(join(i.root, '.env'), LOGIN_LINES, { mode: 0o600 })
  const without = await guided(i, ['yes', '', '18997', 'n', 'n'], { args: ['--no-service'], env: { FOXAGENT_RUN: run } })
  assert.equal(without.status, 0, without.out)
  assert.match(without.out, /7\/7 Background service: skipped/)
  assert.deepEqual(i.s.calls().filter(c => /restart|enable /.test(c)), [], 'no service was installed or started')
})

test('FRESH-2: where systemd runs but the user\'s services cannot be reached, the installer says to log in as that user', { timeout: 120_000 }, async () => {
  const i = freshInstall()
  noUserSystemd(i)
  const run = tmp('fox-run-')
  mkdirSync(join(run, 'systemd', 'system'), { recursive: true }) // systemd is the machine's init
  const r = await guided(i, ['yes', 'owner', '18997', 'n', 'n'], { args: [], env: { FOXAGENT_RUN: run } })
  assert.notEqual(r.status, 0, r.out)
  assert.equal(r.unread, 5, 'no question was asked')
  assert.equal(existsSync(join(i.root, '.env')), false, 'no wallet was made')
  assert.match(r.out, /Error: the background services of the user \S+ cannot be reached from this terminal/)
  assert.match(r.out, /opened with su or sudo/)
  assert.ok(r.out.includes(`cd ${i.root} && ./install.sh`), r.out)
  assert.doesNotMatch(r.out, /wsl\.conf/, 'not a WSL2 problem')
})
