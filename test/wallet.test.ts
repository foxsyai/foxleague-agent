import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UserPem, UserPublicKey, Message, MessageComputer, Address } from '@multiversx/sdk-core'
import { ChangedWordsError, assertSameWords, deriveWallet, exportPem, generateMnemonicInto } from '../src/wallet/wallet.ts'

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

test('changed recovery words stop the start and say what to do; imported teams are skipped', () => {
  const other = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art'
  const agents = [
    { index: 0, address: deriveWallet(TEST_MNEMONIC, 0).address, source: 'derived' },
    { index: 1, address: 'erd1qqqqqqqqqqqqqpgqd77fnev2sthnczp2lnfx0y5jdycynjfhzzgq6p3rax', source: 'imported' },
    { index: 2, address: deriveWallet(TEST_MNEMONIC, 2).address, source: 'derived' },
  ]
  assert.doesNotThrow(() => assertSameWords(agents, TEST_MNEMONIC, '/x/.env', '/x/data'))
  assert.doesNotThrow(() => assertSameWords([], other, '/x/.env', '/x/data'))
  assert.throws(() => assertSameWords(agents, other, '/x/.env', '/x/data'), (err: Error) => {
    assert.ok(err instanceof ChangedWordsError)
    assert.match(err.message, new RegExp(`agent 1 is ${deriveWallet(TEST_MNEMONIC, 0).address}, the words give ${deriveWallet(other, 0).address}`))
    assert.match(err.message, /original words back in \/x\/\.env/)
    assert.match(err.message, /Import team/)
    assert.match(err.message, /agent\.db-wal and agent\.db-shm from \/x\/data/)
    return true
  })
})
