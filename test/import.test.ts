import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { Mnemonic, UserPem, UserWallet } from '@multiversx/sdk-core'
import type { Config } from '../src/config.ts'
import { Store } from '../src/store/db.ts'
import { addressOfKey, deleteImportedKey, loadImportedWallet, saveImportedKey, secretKeyFrom } from '../src/wallet/imported.ts'
import { deriveWallet } from '../src/wallet/wallet.ts'
import { Sessions, hashPassword } from '../src/web/auth.ts'

const TEAM_WORDS = Mnemonic.generate().toString()
const teamKey = (account = 0) => Mnemonic.fromString(TEAM_WORDS).deriveKey(account)
const teamAddress = (account = 0) => addressOfKey(teamKey(account))
const pemOf = (account = 0) => new UserPem(teamAddress(account), teamKey(account)).toText()

function testConfig(dir: string, mnemonic = Mnemonic.generate().toString()): Config {
  return {
    mnemonic, dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config
}

test('import: a PEM file, a keystore (with a key or with words) and recovery words all give the one account key', () => {
  assert.equal(addressOfKey(secretKeyFrom({ kind: 'pem', pem: pemOf() })), teamAddress())
  const two = pemOf(0) + '\n' + pemOf(1)
  assert.throws(() => secretKeyFrom({ kind: 'pem', pem: two }), /holds 2 keys/)
  assert.throws(() => secretKeyFrom({ kind: 'pem', pem: 'hello' }), /not a MultiversX PEM file/)

  const ks = JSON.stringify(UserWallet.fromSecretKey({ secretKey: teamKey(), password: 'pass word 1' }).toJSON())
  assert.equal(addressOfKey(secretKeyFrom({ kind: 'keystore', keystore: ks, password: 'pass word 1' })), teamAddress())
  assert.throws(() => secretKeyFrom({ kind: 'keystore', keystore: ks, password: 'wrong' }), /password is wrong/)
  const wordsKs = JSON.stringify(UserWallet.fromMnemonic({ mnemonic: TEAM_WORDS, password: 'pw' }).toJSON())
  assert.equal(addressOfKey(secretKeyFrom({ kind: 'keystore', keystore: wordsKs, password: 'pw', account: 2 })), teamAddress(2))
  // A keystore whose key derivation would freeze the service or take gigabytes is refused before any work.
  for (const params of [{ n: 2 ** 24 }, { n: 2 ** 18, r: 16, p: 4 }, { n: 4096, r: 8, p: 3 }, { dklen: 2 ** 30 }, { dklen: 64 }, { r: 0.5 }]) {
    const heavy = JSON.parse(ks)
    Object.assign(heavy.crypto.kdfparams, params)
    const started = Date.now()
    assert.throws(() => secretKeyFrom({ kind: 'keystore', keystore: JSON.stringify(heavy), password: 'pass word 1' }), /not a MultiversX keystore/, JSON.stringify(params))
    assert.ok(Date.now() - started < 50, `${JSON.stringify(params)} refused before deriving`)
  }

  assert.equal(addressOfKey(secretKeyFrom({ kind: 'words', words: `  ${TEAM_WORDS.toUpperCase()}\n` })), teamAddress())
  assert.equal(addressOfKey(secretKeyFrom({ kind: 'words', words: TEAM_WORDS, account: '3' as unknown as number })), teamAddress(3))
  assert.throws(() => secretKeyFrom({ kind: 'words', words: TEAM_WORDS, account: -1 }), /account number/)
  const bad = TEAM_WORDS.split(' ').reverse().join(' ')
  const err = (() => { try { secretKeyFrom({ kind: 'words', words: bad }) } catch (e) { return (e as Error).message } })()
  if (err) assert.doesNotMatch(err, new RegExp(bad.split(' ')[0]!), 'an error never repeats the words')
})

test('import: only the one key is stored, mode 600 in a 700 folder; a wrong or missing file is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-'))
  const address = saveImportedKey(dir, teamKey())
  assert.equal(address, teamAddress())
  const file = join(dir, 'keys', `${address}.pem`)
  assert.equal(statSync(file).mode & 0o777, 0o600)
  assert.equal(statSync(join(dir, 'keys')).mode & 0o777, 0o700)
  assert.doesNotMatch(readFileSync(file, 'utf8'), new RegExp(TEAM_WORDS.split(' ')[0]!), 'no recovery words on disk')
  const w = loadImportedWallet(dir, address, 3)
  assert.equal(w.address, address)
  assert.equal(w.index, 3)
  // A file that holds another address's key is refused, never used.
  writeFileSync(file, pemOf(1))
  assert.throws(() => loadImportedWallet(dir, address, 3), /another address/)
  deleteImportedKey(dir, address)
  assert.equal(existsSync(file), false)
  assert.throws(() => loadImportedWallet(dir, address, 3), /missing/)
  assert.throws(() => loadImportedWallet(dir, '../../etc/passwd', 3), /not a MultiversX address/)
})

test('import: the store adds an imported team paused with the next number, which the recovery words never take', () => {
  const store = new Store('', ':memory:')
  const own = deriveWallet(Mnemonic.generate().toString(), 0)
  store.addAgent(0, own.address)
  const row = store.addImportedAgent(teamAddress())
  assert.deepEqual([row.index, row.source, row.paused], [1, 'imported', true])
  assert.throws(() => store.addImportedAgent(teamAddress()), /already agent 2/)
  assert.throws(() => store.addImportedAgent(own.address), /already agent 1/)
  assert.throws(() => store.addAgent(1, own.address), /imported team: its number is taken/)
  assert.throws(() => store.removeImportedAgent(0), /not an imported team/)
  store.removeImportedAgent(1)
  assert.deepEqual(store.agents().map(b => b.index), [0])
  assert.equal(store.maxIndex(), 1, 'a removed team keeps its number')
  assert.equal(store.importedAt(1), true)
  // The same team imported again comes back with its number and history, paused.
  store.setPaused(1, false)
  assert.equal(store.addImportedAgent(teamAddress()).index, 1)
  assert.equal(store.agent(1)!.paused, true)
})

test('import: the service checks the wallet (not an agent, not its own words, a FoxLeague team), then imports it paused and signs with its key', async () => {
  const { Service } = await import('../src/service.ts')
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-'))
  const svc = new Service(testConfig(dir))
  svc.ensureAgents()
  ;(svc as unknown as { schedule: unknown }).schedule = () => undefined
  const teams: Record<string, { name: string; team_overall: number; badge: string | null } | null> = { [teamAddress()]: { name: 'Community XI', team_overall: 61, badge: 'x' } }
  Object.assign(svc.fox, { team: async (a: string) => teams[a] ?? null, user: async (a: string) => (teams[a] ? { team_name: teams[a]!.name } : null) })
  let guardian = true
  Object.assign(svc.chain, { account: async () => ({ balance: 2n * 10n ** 18n }), esdts: async () => [{ tokenIdentifier: 'FOXSY-5d5f3e', balance: 1500n * 10n ** 18n, nonce: 0 }], guarded: async () => guardian })

  await assert.rejects(svc.previewImport({ kind: 'pem', pem: pemOf(1) }), /no FoxLeague team/)
  const own = deriveWallet(svc.cfg.mnemonic!, 1)
  await assert.rejects(svc.previewImport({ kind: 'words', words: svc.cfg.mnemonic!, account: 1 }), /this install's own recovery words/, own.address)
  await assert.rejects(svc.previewImport({ kind: 'words', words: svc.cfg.mnemonic!, account: 0 }), /already agent 1/)

  // A wallet with its Guardian on is refused at the check: nothing an agent signs for it would go through.
  await assert.rejects(svc.previewImport({ kind: 'pem', pem: pemOf() }), /has a Guardian, so an agent cannot sign for it/)
  guardian = false
  const p = await svc.previewImport({ kind: 'pem', pem: pemOf() })
  assert.deepEqual([p.address, p.team.name, p.egld, p.foxsy], [teamAddress(), 'Community XI', '2.0000', '1500'])
  assert.doesNotMatch(JSON.stringify(p), /PRIVATE KEY/, 'the answer holds no secret')
  assert.throws(() => svc.importAgent('not-a-token', 'owner'), /expired/)
  const row = svc.importAgent(p.token, 'owner')
  assert.throws(() => svc.importAgent(p.token, 'owner'), /expired/, 'a token works once')
  assert.deepEqual([row.index, row.source, row.paused], [1, 'imported', true])
  assert.equal(svc.wallet(1).address, teamAddress(), 'the agent signs with the imported key')
  assert.equal(svc.nextIndex(), 2, 'Add agent takes the next number')
  assert.equal(svc.addNextAgent().address, deriveWallet(svc.cfg.mnemonic!, 2).address)

  assert.throws(() => svc.removeAgent(0, 'owner'), /cannot be removed/)
  svc.store.setPaused(1, false)
  assert.throws(() => svc.removeAgent(1, 'owner'), /pause agent 2 first/)
  svc.store.setPaused(1, true)
  assert.match(svc.removeAgent(1, 'owner'), /agent 2 removed/)
  assert.equal(existsSync(join(dir, 'keys', `${teamAddress()}.pem`)), false, 'the stored key is deleted')
  assert.deepEqual(svc.store.agents().map(b => b.index), [0, 2])
})

test('import: over the web the check answers without secrets, the import needs the password, removal needs REMOVE and the password', async () => {
  const { Service } = await import('../src/service.ts')
  const { startWeb } = await import('../src/web/server.ts')
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-'))))
  svc.ensureAgents()
  ;(svc as unknown as { schedule: unknown }).schedule = () => undefined
  Object.assign(svc.fox, { team: async () => ({ name: 'Community XI', team_overall: 61, badge: null }), user: async () => ({ team_name: 'Community XI' }) })
  Object.assign(svc.chain, { account: async () => ({ balance: 0n }), esdts: async () => [], guarded: async () => false })
  const pw = 'correct-horse-battery'
  const creds = { username: 'admin', passwordHash: hashPassword(pw), secretKey: 'k'.repeat(64) }
  const server = startWeb(svc, creds, 0)
  if (!server.listening) await once(server, 'listening')
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const sessions = new Sessions(creds.secretKey, creds.passwordHash)
  const cookie = sessions.issue('admin')
  const post = (path: string, body: unknown) =>
    fetch(`${url}${path}`, { method: 'POST', headers: { cookie: `foxagent_session=${cookie}`, origin: url, 'x-csrf-token': sessions.csrfFor(cookie), 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try {
    const bad = await post('/api/agents/import/check', { kind: 'pem', pem: 'nope' })
    assert.equal(bad.status, 400)
    const check = await post('/api/agents/import/check', { kind: 'pem', pem: pemOf() })
    assert.equal(check.status, 200)
    const text = await check.text()
    assert.doesNotMatch(text, /PRIVATE KEY/)
    const { token } = JSON.parse(text) as { token: string }
    assert.equal((await post('/api/agents/import', { token })).status, 403, 'no password')
    assert.equal((await post('/api/agents/import', { token, password: 'wrong-password' })).status, 403)
    const done = await post('/api/agents/import', { token, password: pw })
    assert.equal(done.status, 200)
    assert.match(((await done.json()) as { message: string }).message, /^Agent 2 added: your team, paused/)
    const state = (await (await fetch(`${url}/api/state`, { headers: { cookie: `foxagent_session=${cookie}` } })).json()) as { agents: { index: number; source: string }[] }
    assert.deepEqual(state.agents.map(b => [b.index, b.source]), [[0, 'derived'], [1, 'imported']])
    assert.equal((await post('/api/agents/1/remove', { password: pw })).status, 400, 'REMOVE not typed')
    assert.equal((await post('/api/agents/1/remove', { confirm: 'REMOVE' })).status, 403, 'no password')
    assert.equal((await post('/api/agents/1/remove', { confirm: 'REMOVE', password: pw })).status, 200)
  } finally {
    server.close()
  }
})
