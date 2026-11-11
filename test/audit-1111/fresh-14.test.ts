// FRESH-14 (the owner's own install on a real Ubuntu desktop, 2026-11-11): on a second run of the installer, Enter
// at "Enter keys now?" meant yes whenever no AI key was set, so an owner who had chosen to add the keys later was
// walked through all four key prompts again at every run. Safe: Enter means yes only on a first install without
// an AI key (the agents cannot play without one); on every later run it means no, and the keys stay one step away
// in the dashboard.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOGIN_LINES, freshInstall, guided } from './install-helpers.ts'

test('FRESH-14: Enter at the keys question means yes only on a first install without an AI key', { timeout: 180_000 }, async () => {
  const i = freshInstall()
  writeFileSync(join(i.root, '.env'), LOGIN_LINES, { mode: 0o600 })
  // The first run: the typed yes, the login kept, the port, then Enter at the keys and at the live question. The
  // questions themselves go to the terminal, not to this test's pipe, so each run is read by what the step did:
  // the key step, started here without a terminal to type on, says so.
  const first = await guided(i, ['yes', '', '', '', ''])
  assert.equal(first.status, 0, first.out)
  assert.match(first.out, /configure needs an interactive terminal/, 'a first install without an AI key goes into the keys step on Enter')
  assert.doesNotMatch(first.out, /Skipped\. Add them any time in the dashboard: Keys\./)
  // The same owner runs the installer again and presses Enter everywhere: the keys step is skipped.
  const again = await guided(i, ['', '', '', ''])
  assert.equal(again.status, 0, again.out)
  assert.match(again.out, /Skipped\. Add them any time in the dashboard: Keys\./, 'a later run skips the keys on Enter')
  assert.doesNotMatch(again.out, /configure needs an interactive terminal|The keys were not all saved/, 'no key prompt on a run where Enter was pressed')
  // A typed y still opens the keys step on a later run.
  const asked = await guided(i, ['', '', 'y', ''])
  assert.match(asked.out, /configure needs an interactive terminal/)
})
