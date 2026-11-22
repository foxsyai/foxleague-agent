// LIFE-5 (pre-release audit 2026-11-22, LIFECYCLE; older code, the CLI): `./cli.sh address N` derived account N-1 of the
// install's recovery words for every number, an imported team's too: an owner funding "agent 3" from that line sent to
// a wallet no agent uses. `snapshot N` (walletOf) did the same for a removed imported team's number and signed a
// FoxLeague login with the install's own account; `export-pem N` wrote that account's key. Now an imported team's
// number gives the store row's address (and the imported key), and a removed imported number is refused.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Mnemonic } from '@multiversx/sdk-core'
import { Store } from '../../src/store/db.ts'
import { addressOf } from '../../src/wallet/wallet.ts'
import { addressOfKey, saveImportedKey } from '../../src/wallet/imported.ts'

const REPO = resolve(import.meta.dirname, '..', '..')

function install() {
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-life5-'))
  const words = Mnemonic.generate().toString()
  const team = Mnemonic.generate().deriveKey(0)
  const store = new Store(dir)
  store.addAgent(0, addressOf(words, 0))
  const imported = store.addImportedAgent(addressOfKey(team))
  saveImportedKey(dir, team)
  const env = { PATH: process.env.PATH!, HOME: dir, AGENT_ENV_FILE: join(dir, 'no-such.env'), AGENT_DATA_DIR: dir, AGENT_MNEMONIC: words, MVX_GATEWAY_URL: 'http://127.0.0.1:9', MVX_API_URL: 'http://127.0.0.1:9', FOXLEAGUE_URL: 'http://127.0.0.1:9' }
  const cli = (...args: string[]) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(REPO, 'src/cli.ts'), ...args], { env, cwd: dir, encoding: 'utf8', timeout: 90_000 })
  return { dir, words, store, index: imported.index, team: addressOfKey(team), cli }
}

test('LIFE-5 cli address N of an imported team prints its own address, not account N of the recovery words', () => {
  const { words, index, team, cli } = install()
  assert.equal(index, 1)
  const r = cli('address', '2')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, new RegExp(`^agent 2: ${team} \\(shard \\d\\)`), `printed: ${r.stdout}`)
  assert.doesNotMatch(r.stdout, new RegExp(addressOf(words, 1)))
  // The install's own agents and a number nobody holds yet are account N of the words, as before.
  assert.match(cli('address', '1').stdout, new RegExp(`^agent 1: ${addressOf(words, 0)} `))
  assert.match(cli('address', '4').stdout, new RegExp(`^agent 4: ${addressOf(words, 3)} `))
})

test('LIFE-5 a removed imported team\'s number: address, snapshot and export-pem refuse, never the install\'s own account', () => {
  const { dir, words, store, index, cli } = install()
  store.removeImportedAgent(index)
  const own = addressOf(words, index)
  for (const args of [['address', '2'], ['snapshot', '2'], ['export-pem', '2', join(dir, 'out.pem')]]) {
    const r = cli(...args)
    assert.notEqual(r.status, 0, `${args[0]}: ${r.stdout}`)
    assert.match(r.stderr, /imported team and has been removed/, `${args[0]}: ${r.stderr}`)
    assert.doesNotMatch(r.stdout + r.stderr, new RegExp(own), `${args[0]} used the install's own account at that number`)
  }
  assert.equal(existsSync(join(dir, 'out.pem')), false, 'no key file written for the removed team\'s number')
})
