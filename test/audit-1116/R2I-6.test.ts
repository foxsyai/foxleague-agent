// R2I-6 (INS-U4, what the fix left): with AGENT_MNEMONIC exported in the terminal, the installer now shows and writes
// the wallet of .env (its own `cli` runs without the shell's words). Its last screen then sends the owner, in that same
// terminal, to the install's command line and launcher: "./cli.sh backup-words shows the recovery words", "To see them
// again later: cd <folder> && ./cli.sh backup-words", and after --no-service "Start the agent yourself with:
// <folder>/run.sh". cli.sh and run.sh still pass the shell's words on, and Node.js never lets .env replace a variable
// that is set. So in that terminal `./cli.sh address 1` names another wallet than the "Agent 1" of the screen above
// it, `./cli.sh export-pem` writes another wallet's key, `./cli.sh backup-words` shows other words than the ones the
// background service signs with, and an agent started there with ./run.sh on a new install is made with the shell's
// wallet while the screen told the owner to fund the one of .env (src/config.ts:102-105, src/service.ts:507).
// cli.sh's own header says "It uses this folder's .env and data/".
// Right: the command line of an install answers for the wallet in that install's .env, as its installer now does.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Mnemonic } from '@multiversx/sdk-core'
import { deriveWallet } from '../../src/wallet/wallet.ts'
import { LOGIN_LINES, freshInstall, guided, running, sh, stubs, tmp } from '../audit-1111/install-helpers.ts'

test('R2I-6: with AGENT_MNEMONIC exported in the terminal, ./cli.sh answers for the wallet of .env, as the installer\'s last screen does', { timeout: 240_000 }, async () => {
  const i = freshInstall()
  writeFileSync(join(i.root, '.env'), LOGIN_LINES, { mode: 0o600 })
  const shells = Mnemonic.generate().getWords().join(' ')
  const r = await guided(i, ['yes', '', '18997', 'n', 'n'], { env: { AGENT_MNEMONIC: shells } })
  assert.equal(r.status, 0, r.out.slice(-800))
  const words = /^AGENT_MNEMONIC="(.*)"$/m.exec(readFileSync(join(i.root, '.env'), 'utf8'))![1]!
  const service = deriveWallet(words, 0).address
  // Since INS-U4 the last screen names the wallet of .env, and sends the owner to ./cli.sh.
  assert.equal(/Agent 1\s+(erd1[0-9a-z]+)/.exec(r.out)?.[1], service)
  assert.match(r.out, /\.\/cli\.sh backup-words shows the recovery words/)

  // The owner types it in the same terminal.
  const env = { ...i.env, AGENT_MNEMONIC: shells }
  const address = await sh(join(i.root, 'cli.sh'), ['address', '1'], env, { cwd: i.root })
  assert.equal(address.status, 0, address.out)
  assert.equal(/agent 1: (erd1[0-9a-z]+)/.exec(address.out)?.[1], service, `./cli.sh address 1 names the wallet of the shell's words (${deriveWallet(shells, 0).address}), not the one the screen above it showed and the service uses`)
  const pem = join(i.home, 'again.pem')
  const exported = await sh(join(i.root, 'cli.sh'), ['export-pem', '1', pem], env, { cwd: i.root })
  assert.equal(exported.status, 0, exported.out)
  assert.ok(readFileSync(pem, 'utf8').includes(service), './cli.sh export-pem wrote the key of another wallet')
})

// Added by the fix: ./run.sh started in such a terminal refuses when the words differ, and says only that they differ.

/** An install whose Node.js runs `-e` checks for real and only records a start of the agent. */
function launcher(words: string | null) {
  const s = stubs()
  const i = running(s)
  const ran = join(tmp('fox-ran-'), 'ran')
  const node = join(tmp('fox-node-'), 'node')
  writeFileSync(node, `#!/usr/bin/env bash\nif [ "\${1:-}" = -e ]; then exec ${JSON.stringify(process.execPath)} "$@"; fi\nprintf '%s\\n' "$*" >> ${JSON.stringify(ran)}\n`, { mode: 0o755 })
  writeFileSync(join(i.root, '.node-path'), `${node}\n`)
  writeFileSync(join(i.root, '.env'), `${LOGIN_LINES}${words === null ? '' : `AGENT_MNEMONIC="${words}"\n`}`, { mode: 0o600 })
  return { i, env: i.env('http://127.0.0.1:9'), started: () => existsSync(ran) }
}

test('R2I-6: ./run.sh with other recovery words exported in the terminal does not start, says why and prints no word', async () => {
  const file = Mnemonic.generate().getWords().join(' ')
  const shells = Mnemonic.generate().getWords().join(' ')
  const l = launcher(file)
  const r = await sh(join(l.i.root, 'run.sh'), [], { ...l.env, AGENT_MNEMONIC: shells }, { cwd: l.i.root })
  assert.notEqual(r.status, 0, r.out)
  assert.equal(l.started(), false, 'the agent started with the wallet of the shell\'s words')
  assert.match(r.out, /AGENT_MNEMONIC is set in this terminal and its recovery words are not the ones in \S+\.env: .*unset AGENT_MNEMONIC/)
  // No part of either phrase (two words in a row; a single word such as "again" is also plain English) and one line only.
  for (const phrase of [file, shells]) {
    const w = phrase.split(' ')
    for (let k = 0; k + 1 < w.length; k++) assert.ok(!r.out.includes(`${w[k]} ${w[k + 1]}`), `recovery words on the screen:\n${r.out}`)
  }
  assert.equal(r.out.trim().split('\n').length, 1, r.out)
})

test('R2I-6: ./run.sh starts with the same words in the terminal (spacing aside), and with words given to a .env that has none', async () => {
  const file = Mnemonic.generate().getWords().join(' ')
  const same = launcher(file)
  const r = await sh(join(same.i.root, 'run.sh'), [], { ...same.env, AGENT_MNEMONIC: `  ${file.replace(/ /g, '  ')} ` }, { cwd: same.i.root })
  assert.equal(r.status, 0, r.out)
  assert.equal(same.started(), true)
  const none = launcher(null)
  const given = await sh(join(none.i.root, 'run.sh'), [], { ...none.env, AGENT_MNEMONIC: file }, { cwd: none.i.root })
  assert.equal(given.status, 0, given.out)
  assert.equal(none.started(), true, 'a container that passes the words in, with a .env of none')
})
