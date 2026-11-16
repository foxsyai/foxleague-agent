// INS-U5 (unproven item U5 of the INSTALL review of 16 Nov 2026): every run of the installer wrote
// WEB_UI_INSECURE_COOKIE="1" into .env, whatever the owner had there. 1 is right for the dashboard on plain http on
// this computer, and a new install still gets it. An owner who put https of their own in front of a local install and
// set 0 (the dashboard's login cookie is then sent over https only) got the plain cookie back at every run of the
// installer, which the guides give as the remedy for many things, without a word.
// Right: a value the owner set is kept and said; only a .env without the line gets 1.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOGIN_LINES, freshInstall, guided } from '../audit-1111/install-helpers.ts'

const cookieLine = (env: string): string[] => readFileSync(env, 'utf8').split('\n').filter(l => l.startsWith('WEB_UI_INSECURE_COOKIE='))

test('INS-U5: the installer run again keeps WEB_UI_INSECURE_COOKIE as the owner set it and says so', { timeout: 240_000 }, async () => {
  const i = freshInstall()
  const env = join(i.root, '.env')
  writeFileSync(env, LOGIN_LINES, { mode: 0o600 })
  const first = await guided(i, ['yes', '', '18997', 'n', 'n'])
  assert.equal(first.status, 0, first.out.slice(-600))
  assert.deepEqual(cookieLine(env), ['WEB_UI_INSECURE_COOKIE="1"'], 'a new install gets the plain cookie for http on this computer')

  // The owner puts https of their own in front and sets 0.
  writeFileSync(env, readFileSync(env, 'utf8').replace('WEB_UI_INSECURE_COOKIE="1"', 'WEB_UI_INSECURE_COOKIE="0"'), { mode: 0o600 })
  const again = await guided(i, ['', '18997', 'n', ''])
  assert.equal(again.status, 0, again.out.slice(-600))
  assert.deepEqual(cookieLine(env), ['WEB_UI_INSECURE_COOKIE="0"'], 'the installer turned the owner\'s secure cookie back into a plain one')
  assert.match(again.out, /WEB_UI_INSECURE_COOKIE.*kept.*https/i, `the screen says what was kept and what it means:\n${again.out.slice(again.out.indexOf('3/7'), again.out.indexOf('4/7'))}`)
})
