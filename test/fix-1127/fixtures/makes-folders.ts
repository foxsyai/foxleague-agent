// Run by TMP-1 and R101A through scripts/run-tests.ts, never by the suite itself (its name does not end in .test.ts).
// It does what many tests do: makes a folder in os.tmpdir() and leaves it, here with a read-only folder inside.
// TMP1_PROBE: the file it writes os.tmpdir() and its process id into once its folders are made.
// TMP1_HANG=1: then waits a minute. TMP1_FAIL=1: then fails.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('makes folders in the temp folder and leaves them', async () => {
  const home = mkdtempSync(join(tmpdir(), 'fox-home-'))
  mkdirSync(join(home, 'locked'))
  writeFileSync(join(home, 'locked', 'file'), 'x')
  chmodSync(join(home, 'locked'), 0o500)
  writeFileSync(process.env.TMP1_PROBE!, `${tmpdir()}\n${process.pid}`)
  if (process.env.TMP1_HANG === '1') await new Promise((done) => setTimeout(done, 60_000))
  assert.notEqual(process.env.TMP1_FAIL, '1', 'asked to fail')
})
