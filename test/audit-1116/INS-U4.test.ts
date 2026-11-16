// INS-U4 (unproven item U4 of the INSTALL review of 16 Nov 2026): a variable of the shell that runs the installer wins
// over .env. Node.js's process.loadEnvFile never replaces a variable that is already set. With AGENT_MNEMONIC exported
// in that shell (a maintainer's or a developer's habit), `cli setup` writes NEW words into .env and says so, but the
// installer's later calls (backup-words, export-pem 1, address 1, check-words) read the shell's words: the recovery
// words shown, pem/agent1.pem and the "Agent 1" address on the last screen belong to another wallet than the one the
// background service will use (systemd starts it without that variable, from .env).
// Right: everything the installer shows and writes about the wallet belongs to the words in .env.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Mnemonic } from '@multiversx/sdk-core'
import { deriveWallet } from '../../src/wallet/wallet.ts'
import { LOGIN_LINES, freshInstall, guided } from '../audit-1111/install-helpers.ts'

/** The recovery words an env file holds (its last AGENT_MNEMONIC line, the one Node.js reads). */
function wordsIn(file: string): string {
  let words = ''
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^AGENT_MNEMONIC="(.*)"$/.exec(line.trim())
    if (m) words = m[1]!
  }
  return words
}

test('INS-U4: an AGENT_MNEMONIC exported in the installing shell does not change the wallet the installer shows and writes', { timeout: 240_000 }, async () => {
  const i = freshInstall()
  writeFileSync(join(i.root, '.env'), LOGIN_LINES, { mode: 0o600 })
  const shells = Mnemonic.generate().getWords().join(' ')
  const r = await guided(i, ['yes', '', '18997', 'n', 'n'], { env: { AGENT_MNEMONIC: shells } })
  assert.equal(r.status, 0, r.out.slice(-800))
  assert.match(r.out, /New recovery words written/, 'the install made new words in .env')
  const words = wordsIn(join(i.root, '.env'))
  assert.equal(words.split(' ').length, 24, 'the words of .env')
  assert.notEqual(words, shells)
  const service = deriveWallet(words, 0).address
  const shown = /Agent 1\s+(erd1[0-9a-z]+)/.exec(r.out)?.[1]
  assert.equal(shown, service, `the last screen names the wallet of the shell's words, not the one the service uses:\n${r.out.slice(r.out.indexOf('Done'))}`)
  const pem = readFileSync(join(i.root, 'pem', 'agent1.pem'), 'utf8')
  assert.ok(pem.includes(service), `pem/agent1.pem is the key of another wallet:\n${pem.split('\n')[0]}`)
})
