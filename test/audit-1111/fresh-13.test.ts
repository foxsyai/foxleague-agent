// FRESH-13 (the owner's own install on a real Ubuntu desktop, 2026-11-11): the last screen showed the dashboard's
// address as plain text among the other lines, with nothing to tell that it is the next thing to open. Safe: the
// address is a link the terminal can open (underlined, a real hyperlink where the terminal knows them),
// the screen says how, and on a machine with a desktop the installer offers to open it in the browser itself.
// Where the output is no terminal (a log, a pipe) the address stays plain text with no control bytes.
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOGIN_LINES, REPO, freshInstall, guided, sh, shellFunction, tmp } from './install-helpers.ts'

const ESC = '\u001b'

test('FRESH-13: the dashboard address is a link on a terminal and plain text everywhere else', () => {
  // Read with spawnSync: the shared `sh` helper strips colour codes from what it returns, and they are the point here.
  const fn = shellFunction(join(REPO, 'install.sh'), 'link')
  const run = (links: string): string => spawnSync('bash', ['-c', `LINKS=${links}\n${fn}\nlink http://localhost:8870`], { encoding: 'utf8' }).stdout
  // (Bold and underlined in the terminal's own colour since W-5 of 2026-11-14: blue did not show on PowerShell's blue.)
  assert.equal(run('1'), `${ESC}]8;;http://localhost:8870${ESC}\\${ESC}[1;4mhttp://localhost:8870${ESC}[0m${ESC}]8;;${ESC}\\`, 'a hyperlink, bold and underlined, closed again')
  assert.equal(run('0'), 'http://localhost:8870', 'no control bytes when the output is no terminal')
})

test('FRESH-13: the last screen says how to open the dashboard, and a piped run keeps the address plain', { timeout: 120_000 }, async () => {
  const i = freshInstall()
  writeFileSync(join(i.root, '.env'), LOGIN_LINES, { mode: 0o600 })
  const r = await guided(i, ['yes', '', '18997', 'n', 'n'])
  assert.equal(r.status, 0, r.out)
  const last = r.out.slice(r.out.indexOf('\n  Dashboard'))
  assert.match(last, /^ {2}Dashboard {5}http:\/\/localhost:18997 {3}\(user: owner\)$/m)
  assert.match(last, /Open that address in your browser \(in most terminals: hold Ctrl and click it; on a Mac, Cmd\)\./)
  assert.ok(!last.includes(`${ESC}]8`), 'this run is piped: no hyperlink bytes')
  assert.doesNotMatch(r.out, /Open the dashboard in your browser now\?/, 'no desktop here, so the question is not asked')
})

test('FRESH-13: the browser is offered only where one can be opened, and it gets the dashboard address', async () => {
  const fn = shellFunction(join(REPO, 'install.sh'), 'browser_opener')
  const bin = tmp('fox-open-')
  const log = join(bin, 'opened.log')
  writeFileSync(join(bin, 'xdg-open'), `#!/usr/bin/env bash\nprintf '%s\\n' "$1" >> ${JSON.stringify(log)}\n`)
  chmodSync(join(bin, 'xdg-open'), 0o755)
  const run = (env: Record<string, string>) => sh('', ['-c', `set -euo pipefail\nPLATFORM=linux\n${fn}\no=$(browser_opener)\n[ -n "$o" ] && "$o" http://localhost:8870\nprintf 'opener=%s\\n' "$o"`], { PATH: `${bin}:/usr/bin:/bin`, ...env })
  const desktop = await run({ DISPLAY: ':0' })
  assert.match(desktop.out, new RegExp(`opener=${bin}/xdg-open`))
  assert.equal(readFileSync(log, 'utf8'), 'http://localhost:8870\n')
  const wayland = await run({ WAYLAND_DISPLAY: 'wayland-0' })
  assert.match(wayland.out, /opener=.*xdg-open/)
  // A server reached over SSH, or a terminal with no desktop: nothing to open with, and the installer does not ask.
  const headless = await run({})
  assert.match(headless.out, /^opener=$/m)
  assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 2, 'not opened a third time')
  assert.ok(existsSync(join(REPO, 'install.sh')))
})
