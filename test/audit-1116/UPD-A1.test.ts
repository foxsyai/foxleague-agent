// UPD-A1: Update now ends the whole agent when the downloaded archive cannot be written.
//
// src/update/release.ts:209 opens the archive with createWriteStream and puts no 'error' listener on it. A stream
// that fails (the disk is full: ENOSPC; data/update may not be written to: EACCES; a quota, a read-only remount)
// emits 'error'; with no listener Node throws it as an uncaught exception and the process ends at once with
// status 1. The service has no handler for that (only unhandledRejection -> panic), so one click on Update now, or
// /upgrade on Telegram, ends the agent in the middle of whatever its agents were doing: no graceful stop, an action
// that is being signed is not waited for. The unit starts it again 30 seconds later, the notice still offers the
// update, and every further click ends it again (five in ten minutes reach the unit's start limit).
//
// The rule it breaks is UPD-15 / UPD-6..11: "An update that cannot be installed changes nothing and says why", "a
// failed download ... leaves the agent as it was". Right: the download is refused with a sentence, the agent stays up.
//
// Each case runs in a process of its own (UPD-A1-child.ts), as the service is one: an uncaught exception there
// must not end the test runner.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CHILD = join(dirname(fileURLToPath(import.meta.url)), 'UPD-A1-child.ts')
const run = (how: string) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', CHILD, how], { encoding: 'utf8', timeout: 60_000 })

test('UPD-A1: an update whose archive may not be written (data/update read-only) is refused with a sentence and the agent keeps running', { skip: process.getuid?.() === 0 ? 'root writes anywhere' : false }, () => {
  const r = run('readonly')
  assert.equal(r.status, 0, `the agent's process ended with status ${r.status}:\n${r.stderr.split('\n').slice(0, 6).join('\n')}`)
  assert.match(r.stdout, /^ALIVE$/m)
  assert.match(r.stdout, /^state: idle$/m)
  assert.match(r.stdout, /^last: failed$/m)
  assert.match(r.stdout, /^told: The update to 1\.2\.0 was not installed: .*You run 1\.1\.0 as before\.$/m)
  assert.match(r.stdout, /^active: v1\.1\.0$/m)
})

test('UPD-A1: an update downloaded onto a full disk (ENOSPC) does not end the agent', { skip: process.platform !== 'linux' ? 'needs /dev/full' : false }, () => {
  const r = run('full')
  assert.equal(r.status, 0, `the agent's process ended with status ${r.status}:\n${r.stderr.split('\n').slice(0, 6).join('\n')}`)
  assert.match(r.stdout, /^ALIVE$/m)
  assert.match(r.stdout, /^state: idle$/m)
  assert.match(r.stdout, /^active: v1\.1\.0$/m)
})
