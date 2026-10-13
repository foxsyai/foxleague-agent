// Proof tests for the second review round of 2026-10-13 (web, Telegram, install, docs). Each test is named after its
// finding (R2B = the web reviewer, R2C = the fresh reviewer) and failed on main 733a8d5 before the fix; a "control"
// passed before and after.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Config } from '../src/config.ts'
import { setEnvValues } from '../src/setup/keys.ts'
import { Telegram, type Handlers } from '../src/telegram/telegram.ts'
import { checkAction } from '../src/executor/rules.ts'
import { wholeToAtomic } from '../src/util/encoding.ts'
import type { TournamentDetail } from '../src/foxleague/types.ts'
import { OTHER, TEST_SETTINGS, snapshot, tournament } from './fixtures.ts'

const TEST_WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const REPO = resolve(import.meta.dirname, '..')
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ---- R2B-1: a rewrite in place that cannot open the env file leaves no copy of the words behind ----

test('R2B-1 an env file that cannot be opened for writing leaves no backup behind, because nothing was written', () => {
  if (process.getuid?.() === 0) return // root ignores file modes
  const dir = mkdtempSync(join(tmpdir(), 'r2b-1-'))
  const data = mkdtempSync(join(tmpdir(), 'r2b-1-data-'))
  const file = join(dir, 'env')
  const backup = join(data, 'env.backup')
  const old = `AGENT_MNEMONIC="${TEST_WORDS}"\nWEB_UI_USER="old"\n`
  writeFileSync(file, old, { mode: 0o400 }) // readable, not writable by the service user
  chmodSync(dir, 0o500) // no new file next to it, as on a server built by deploy/bootstrap.sh
  try {
    assert.throws(() => setEnvValues(file, { WEB_UI_USER: 'admin' }, data), /EACCES/)
    assert.equal(readFileSync(file, 'utf8'), old, 'the env file was not touched')
    assert.equal(existsSync(backup), false, `nothing was written to ${file}, yet its content (the recovery words) now also sits in ${backup}, and the next rewrite is refused until the owner deletes it by hand`)
  } finally {
    chmodSync(dir, 0o700)
    chmodSync(file, 0o600)
  }
})

test('R2B-1 after the owner fixes the file mode, the rewrite works (no leftover backup blocks it)', () => {
  if (process.getuid?.() === 0) return
  const dir = mkdtempSync(join(tmpdir(), 'r2b-1-'))
  const data = mkdtempSync(join(tmpdir(), 'r2b-1-data-'))
  const file = join(dir, 'env')
  writeFileSync(file, `AGENT_MNEMONIC="${TEST_WORDS}"\nWEB_UI_USER="old"\n`, { mode: 0o400 })
  chmodSync(dir, 0o500)
  try {
    assert.throws(() => setEnvValues(file, { WEB_UI_USER: 'admin' }, data), /EACCES/)
    chmodSync(file, 0o600) // the owner gives the file back to the service user
    setEnvValues(file, { WEB_UI_USER: 'admin' }, data)
    assert.match(readFileSync(file, 'utf8'), /^WEB_UI_USER="admin"$/m)
  } finally {
    chmodSync(dir, 0o700)
    chmodSync(file, 0o600)
  }
})

test('R2B-1 the backup goes once the new content is synced, even when setting the mode fails afterwards', () => {
  if (process.getuid?.() === 0) return
  const dir = mkdtempSync(join(tmpdir(), 'r2b-1-'))
  const data = mkdtempSync(join(tmpdir(), 'r2b-1-data-'))
  const file = join(dir, 'env')
  const backup = join(data, 'env.backup')
  writeFileSync(file, `AGENT_MNEMONIC="${TEST_WORDS}"\nWEB_UI_USER="old"\n`, { mode: 0o600 })
  chmodSync(dir, 0o500)
  const notOwner = () => { throw Object.assign(new Error('EPERM: operation not permitted, chmod'), { code: 'EPERM' }) }
  try {
    assert.throws(() => setEnvValues(file, { WEB_UI_USER: 'admin' }, data, { chmod: notOwner }), (e: Error) => {
      assert.match(e.message, /saved/, `the error must say the new content is saved: ${e.message}`)
      return true
    })
    assert.match(readFileSync(file, 'utf8'), /^WEB_UI_USER="admin"$/m, 'the new content is on disk')
    assert.equal(existsSync(backup), false, 'the content was synced: the copy of the recovery words must not stay behind')
  } finally {
    chmodSync(dir, 0o700)
  }
})

