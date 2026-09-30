import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UserPem, UserPublicKey, Message, MessageComputer, Address } from '@multiversx/sdk-core'
import { deriveWallet, exportPem, generateMnemonicInto } from '../src/wallet/wallet.ts'

// The public MultiversX SDK test mnemonic: indexes 0, 1, 2 are the well-known alice, bob, carol.
const TEST_MNEMONIC =
  'moral volcano peasant pass circle pen over picture flat shop clap goat never lyrics gather prepare woman film husband gravity behind test tiger improve'

test('derivation follows m/44\'/508\'/0\'/0\'/N\'', () => {
  assert.equal(deriveWallet(TEST_MNEMONIC, 0).address, 'erd1qyu5wthldzr8wx5c9ucg8kjagg0jfs53s8nr3zpz3hypefsdd8ssycr6th')
  assert.equal(deriveWallet(TEST_MNEMONIC, 1).address, 'erd1spyavw0956vq68xj8y4tenjpq2wd5a9p2c6j8gsz7ztyrnpxrruqzu66jx')
  assert.equal(deriveWallet(TEST_MNEMONIC, 2).address, 'erd1k2s324ww2g0yj38qn2ch2jwctdy8mnfxep94q9arncc6xecg3xaq6mjse8')
  assert.equal(deriveWallet(TEST_MNEMONIC, 0).shard, 1)
})

test('signed message verifies as FoxLeague expects (v1 prefix)', async () => {
  const w = deriveWallet(TEST_MNEMONIC, 0)
  const text = 'foxleague:chain=1:auth-1700000000'
  const sigHex = w.signMessage(text)
  assert.equal(sigHex.length, 128)
  const msg = new Message({ data: Buffer.from(text), address: Address.newFromBech32(w.address) })
  const bytes = new MessageComputer().computeBytesForVerifying(msg)
  const pk = new UserPublicKey(Buffer.from(w.pubkeyHex, 'hex'))
  assert.equal(await pk.verify(bytes, Buffer.from(sigHex, 'hex')), true)
})

test('PEM export round-trips and refuses unsafe targets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-'))
  const out = join(dir, 'agent0.pem')
  exportPem(TEST_MNEMONIC, 0, out, { isServer: false, repoRoot: process.cwd() })
  assert.equal(statSync(out).mode & 0o777, 0o600)
  assert.equal(UserPem.fromFile(out).publicKey.toAddress('erd').toBech32(), deriveWallet(TEST_MNEMONIC, 0).address)
  assert.throws(() => exportPem(TEST_MNEMONIC, 0, out, { isServer: false, repoRoot: process.cwd() }), /exists/)
  assert.throws(() => exportPem(TEST_MNEMONIC, 0, join(dir, 'x.pem'), { isServer: true, repoRoot: process.cwd() }), /local-only/)
  assert.throws(() => exportPem(TEST_MNEMONIC, 0, join(process.cwd(), 'data', 'x.pem'), { isServer: false, repoRoot: process.cwd() }), /inside the repository/)
  assert.throws(() => exportPem(TEST_MNEMONIC, 0, join(process.cwd(), 'src', 'pem', 'x.pem'), { isServer: false, repoRoot: process.cwd() }), /inside the repository/)
  // The repo's pem/ folder is allowed (git-ignored, never deployed): here a temp repo root.
  const inPem = exportPem(TEST_MNEMONIC, 1, join(dir, 'pem', 'agent1.pem'), { isServer: false, repoRoot: dir })
  assert.match(readFileSync(inPem, 'utf8'), /BEGIN PRIVATE KEY for erd1/)
  assert.equal(statSync(join(dir, 'pem')).mode & 0o777, 0o700)
})

test('mnemonic generation never replaces an existing one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-'))
  const env = join(dir, 'env')
  writeFileSync(env, 'OTHER=1')
  assert.equal(generateMnemonicInto(env).created, true)
  const first = readFileSync(env, 'utf8')
  assert.match(first, /^OTHER=1\nAGENT_MNEMONIC="(\w+ ){23}\w+"\n$/)
  assert.equal(statSync(env).mode & 0o777, 0o600)
  assert.equal(generateMnemonicInto(env).created, false)
  assert.equal(readFileSync(env, 'utf8'), first)
})
