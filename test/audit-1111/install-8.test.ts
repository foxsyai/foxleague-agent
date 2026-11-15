// INSTALL-8: the installer showed the recovery words once and waited for a typed "yes". What decided whether to
// show them was "was AGENT_MNEMONIC empty before setup", not "did the owner confirm". A run that ended between the
// two (the terminal closed, a dropped SSH session) left the words in .env, and every later run said "Your
// existing wallet is kept." and never showed them or asked. Safe: until the owner has typed yes once, every run
// of the installer shows the words and asks; the yes is noted in the data folder.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOGIN_LINES, REPO, freshInstall, guided, mode } from './install-helpers.ts'

test('INSTALL-8: an owner who never typed yes is shown the recovery words and asked again on the next run', { timeout: 180_000 }, async () => {
  const i = freshInstall()
  const env = join(i.root, '.env')
  const marker = join(i.root, 'data', 'words-confirmed')
  writeFileSync(env, LOGIN_LINES, { mode: 0o600 })
  // Run 1: the words are on screen, the installer waits for the yes, the terminal closes.
  const first = await guided(i, [], { stopWhen: () => i.wordsShown() === 1 })
  assert.notEqual(first.status, 0)
  assert.match(first.out, /A new wallet was created\./)
  const words = /^AGENT_MNEMONIC=.+$/m.exec(readFileSync(env, 'utf8'))?.[0]
  assert.ok(words, 'the words are in .env')
  assert.equal(existsSync(marker), false, 'no yes was typed, so nothing says the words were written down')

  // Run 2: the same wallet, shown again; anything but yes asks again.
  const second = await guided(i, ['no', 'y', 'yes', '', '18997', 'n', 'n'])
  assert.equal(second.status, 0, second.out)
  assert.equal(second.unread, 0, 'the installer asked for the yes until it came')
  assert.equal(i.wordsShown(), 2, 'the words were shown again')
  assert.match(second.out, /You have not confirmed yet that the recovery words of this wallet are written down\./)
  assert.doesNotMatch(second.out, /A new wallet was created\./, 'and it does not call the wallet new')
  assert.equal(/^AGENT_MNEMONIC=.+$/m.exec(readFileSync(env, 'utf8'))?.[0], words, 'the wallet is the same')
  assert.ok(existsSync(marker), 'the typed yes is noted in the data folder')
  assert.equal(mode(marker), '600')

  // Run 3: confirmed, so the words stay off the screen.
  const third = await guided(i, ['', '', 'n', ''])
  assert.equal(third.status, 0, third.out)
  assert.equal(i.wordsShown(), 2, 'not shown a third time')
  assert.match(third.out, /Your existing wallet is kept\./)
})

test('INSTALL-8: the guide names the command that shows the recovery words again', () => {
  const guide = readFileSync(join(REPO, 'INSTALL.md'), 'utf8')
  const section = guide.slice(guide.indexOf('## Your recovery words and PEM files'), guide.indexOf('## Keys, step by step'))
  assert.match(section, /`\.\/cli\.sh backup-words`/)
})
