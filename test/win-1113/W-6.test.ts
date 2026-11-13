// W-6 (Windows real-PC check of 2026-11-13, medium for a first use): "Open the dashboard in your browser now? (y/n)
// [y]: y" opened no browser on Windows, seen twice (the install and the line pasted again). install.sh started
// explorer.exe in the background and ended at once: WSL ends what a session started when the session ends, and the
// background explorer.exe went with it. Safe: on WSL explorer.exe runs in the foreground (it hands the address to
// Windows and returns at once, with status 1 even when it worked), so it is done before the installer ends. The test
// ends the installer's process group the moment the installer ends, as WSL does, and failed before the fix.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO, tmp } from '../update-fixtures.ts'

/** The installer's last lines, from the browser question to its end, as install.sh has them. */
function lastBlock(): string {
  const text = readFileSync(join(REPO, 'install.sh'), 'utf8')
  const from = text.indexOf('# On a machine with a desktop and the dashboard answering')
  assert.ok(from > 0, 'install.sh has the block that offers the browser')
  return text.slice(from)
}

/**
 * Runs that block with "yes" to the question and the given opener (a script that takes 0.4 s, then notes the address
 * it got and ends with `status`). When bash ends, its whole process group is killed, as WSL ends a session's
 * programs. Returns bash's status, how long it ran and the address the opener noted, if it got that far.
 */
async function offer(name: string, status: number): Promise<{ code: number | null; ms: number; opened: string | null }> {
  const dir = tmp('fox-open-')
  const mark = join(dir, 'opened')
  const opener = join(dir, name)
  writeFileSync(opener, `#!/usr/bin/env bash\nsleep 0.4\nprintf '%s\\n' "$1" > ${JSON.stringify(mark)}\nexit ${status}\n`)
  chmodSync(opener, 0o755)
  writeFileSync(join(dir, 'curl'), '#!/usr/bin/env bash\nexit 0\n') // the dashboard answers
  chmodSync(join(dir, 'curl'), 0o755)
  const script = ['set -euo pipefail', `browser_opener() { printf '%s' ${JSON.stringify(opener)}; }`, 'yes_no() { return 0; }', 'NO_SERVICE=0', 'LINKS=1', 'port=8870', lastBlock()].join('\n')
  const t0 = Date.now()
  const child = spawn('bash', ['-c', script], { env: { PATH: `${dir}:/usr/bin:/bin` }, stdio: 'ignore', detached: true })
  const code = await new Promise<number | null>(done => child.on('exit', c => done(c)))
  const ms = Date.now() - t0
  try {
    process.kill(-child.pid!, 'SIGKILL') // the session ends: what it left running goes with it
  } catch {
    // nothing was left
  }
  await new Promise(r => setTimeout(r, 800))
  return { code, ms, opened: existsSync(mark) ? readFileSync(mark, 'utf8').trim() : null }
}

test('W-6 on WSL the browser is opened before the installer ends (explorer.exe in the foreground), and its status 1 is not an error', async () => {
  const r = await offer('explorer.exe', 1)
  assert.equal(r.opened, 'http://localhost:8870', 'explorer.exe was ended with the session before it opened the address')
  assert.equal(r.code, 0, 'explorer.exe ends with 1 when it worked: the installer still ends with 0')
})

test('W-6 elsewhere xdg-open still goes to the background: the installer does not wait for a browser', async () => {
  const r = await offer('xdg-open', 0)
  assert.equal(r.code, 0)
  assert.ok(r.ms < 400, `the installer waited ${r.ms} ms for xdg-open`)
})
