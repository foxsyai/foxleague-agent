// FRESH-4 (fresh Ubuntu walk-through, 2026-11-11): at step 3 the newcomer chooses the dashboard password. One that
// is shorter than 12 characters, or typed differently the second time, ended the whole installer with one bare line
// ("password too short: use at least 12 characters") and status 1: no "try again", no word on what to do next,
// with the wallet already made. Safe: the installer asks again until a login is saved (a few times at most); only
// Ctrl-C or a terminal that cannot be typed into ends it, and then it says how to run it again.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOGIN_LINES, REPO, freshInstall, guided, tmp, type Install } from './install-helpers.ts'

/**
 * The install's Node.js with a stand-in for `set-web-password` (the real one reads a terminal, a test has none):
 * it fails with the given statuses, one per call, then saves a login. `calls()` counts how often it was asked.
 */
function passwordStandIn(i: Install, failures: number[]): { calls: () => number } {
  const count = join(i.home, 'password-calls')
  writeFileSync(
    join(i.root, '.node', 'bin', 'node'),
    [
      '#!/usr/bin/env bash',
      'for a in "$@"; do',
      `  if [ "$a" = backup-words ]; then echo shown >> ${JSON.stringify(i.shownLog)}; echo " 1. (the recovery words, shown by the stand-in)"; exit 0; fi`,
      '  if [ "$a" = set-web-password ]; then',
      `    n=$(cat ${JSON.stringify(count)} 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > ${JSON.stringify(count)}`,
      `    set -- ${failures.join(' ')}`,
      '    if [ "$n" -le "$#" ]; then eval "rc=\\${$n}"; echo "password too short: use at least 12 characters" >&2; exit "$rc"; fi',
      `    printf '%s' ${JSON.stringify(LOGIN_LINES)} >> "$AGENT_ENV_FILE"`,
      '    echo "Saved the web UI login."; exit 0',
      '  fi',
      'done',
      `exec ${JSON.stringify(process.execPath)} "$@"`,
      '',
    ].join('\n'),
  )
  chmodSync(join(i.root, '.node', 'bin', 'node'), 0o755)
  return { calls: () => (existsSync(count) ? Number(readFileSync(count, 'utf8')) : 0) }
}

test('FRESH-4: a password that was not accepted is asked for again, the installer goes on', { timeout: 120_000 }, async () => {
  const i = freshInstall()
  const p = passwordStandIn(i, [1, 1])
  // The typed yes, then (no login yet, so no "Change it?") the port, the keys and the live permission.
  const r = await guided(i, ['yes', '18997', 'n', 'n'])
  assert.equal(r.status, 0, r.out)
  assert.equal(p.calls(), 3, 'asked until a login was saved')
  assert.equal((r.out.match(/Nothing was saved\. Try again/g) ?? []).length, 2, r.out)
  assert.match(r.out, /4\/7 Keys/)
  assert.match(r.out, /Done/)
  assert.equal(r.unread, 0)
})

test('FRESH-4: it does not ask forever, and says how to run the installer again', { timeout: 120_000 }, async () => {
  const i = freshInstall()
  const p = passwordStandIn(i, [1, 1, 1, 1, 1, 1, 1, 1])
  const r = await guided(i, ['yes', '18997', 'n', 'n'])
  assert.notEqual(r.status, 0, r.out)
  assert.equal(p.calls(), 5)
  assert.match(r.out, /Error: no dashboard login was saved\./)
  assert.ok(r.out.includes(`cd ${i.root} && ./install.sh`), r.out)
  assert.doesNotMatch(r.out, /4\/7 Keys/)
})

test('FRESH-4: Ctrl-C at the password and a terminal that cannot be typed into end the installer at once', { timeout: 120_000 }, async () => {
  for (const status of [130, 2]) {
    const i = freshInstall()
    const p = passwordStandIn(i, [status, 1])
    const r = await guided(i, ['yes', '18997', 'n', 'n'])
    assert.notEqual(r.status, 0, r.out)
    assert.equal(p.calls(), 1, `status ${status}: not asked again`)
    assert.doesNotMatch(r.out, /Try again/)
    assert.doesNotMatch(r.out, /4\/7 Keys/)
  }
})

test('FRESH-4: set-web-password without a terminal ends with status 2, which the installer does not retry', () => {
  const home = tmp('fox-home-')
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(REPO, 'src', 'cli.ts'), 'set-web-password'], {
    env: { PATH: process.env.PATH ?? '', HOME: home, AGENT_ENV_FILE: join(home, '.env'), AGENT_DATA_DIR: join(home, 'data') },
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    cwd: home,
  })
  assert.equal(r.status, 2, r.stdout + r.stderr)
  assert.match(r.stderr, /set-web-password needs an interactive terminal/)
  assert.equal(existsSync(join(home, '.env')), false)
})
