import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { Mnemonic } from '@multiversx/sdk-core'
import type { Config } from '../src/config.ts'
import { Store } from '../src/store/db.ts'
import { Sessions, hashPassword } from '../src/web/auth.ts'
import { ADDR, OTHER } from './fixtures.ts'

function testConfig(dir: string, maxAgents: number): Config {
  return {
    mnemonic: Mnemonic.generate().toString(), dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents,
  } as Config
}

/** Every chain and FoxLeague call fails at once (no network, no retries), except the ones a test gives. */
function offline(svc: { chain: object; fox: object }, over: { chain?: Record<string, unknown>; fox?: Record<string, unknown> } = {}): void {
  const fail = async () => { throw new Error('offline') }
  for (const [client, given] of [[svc.chain, over.chain ?? {}], [svc.fox, over.fox ?? {}]] as const) {
    const c = client as Record<string, unknown>
    for (const k of Object.getOwnPropertyNames(Object.getPrototypeOf(client))) if (k !== 'constructor' && typeof c[k] === 'function') c[k] = given[k] ?? fail
  }
}

const INFO = { at: '2026-10-06T12:00:00.000Z', by: 'owner', team: 'Kestrel Forge', egld: '1.5000', foxsy: '3400', usd: 12.4 }

test('retire: the store parks an agent paused and out of the active ones, and only restore brings it back (paused)', () => {
  const store = new Store('', ':memory:')
  store.addAgent(0, ADDR)
  store.addAgent(1, OTHER)
  store.retireAgent(1, INFO)
  assert.deepEqual(store.agents().map(b => b.index), [0])
  assert.deepEqual(store.retiredAgents().map(b => [b.index, b.paused, b.retired?.team]), [[1, true, 'Kestrel Forge']])
  assert.equal(store.agent(1)?.retired?.by, 'owner', 'a retired agent is still found by its number (its wallet, its pause checks)')
  assert.equal(store.maxIndex(), 1, 'its number is never given to a new agent')
  assert.throws(() => store.setPaused(1, false), /agent 2 is retired: restore it first/)
  assert.throws(() => store.retireAgent(1, INFO), /not an active agent/)
  assert.throws(() => store.restoreAgent(0), /not retired/)
  assert.throws(() => store.addAgent(1, ADDR), /registered with another address/)
  assert.equal(store.addAgent(1, OTHER).retired?.team, 'Kestrel Forge', 'the start does not bring a retired agent back')
  store.restoreAgent(1)
  assert.deepEqual(store.agents().map(b => [b.index, b.paused, b.retired]), [[0, false, null], [1, true, null]])
})

test('retire: the service parks an agent (it frees its place in the limit), refuses with a payment waiting, and restores it paused within the limit', async () => {
  const { Service } = await import('../src/service.ts')
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-')), 2))
  svc.ensureAgents()
  ;(svc as unknown as { schedule: unknown }).schedule = () => undefined
  offline(svc, {
    chain: {
      account: async () => ({ nonce: 1, balance: 3n * 10n ** 18n / 2n }),
      esdts: async () => [{ tokenIdentifier: 'FOXSY-5d5f3e', balance: 3400n * 10n ** 18n, nonce: 0 }],
    },
  })
  svc.addNextAgent()
  assert.throws(() => svc.addNextAgent(), /allows 2 agents/)

  svc.store.addPending('0xabc', 1, 'join', {})
  await assert.rejects(svc.retireAgent(1, 'owner'), /agent 2 is paused, but a payment waits for FoxLeague's confirmation/)
  svc.store.resolvePending('0xabc', 'done')
  assert.match(await svc.retireAgent(1, 'owner'), /agent 2 retired/)
  const parked = svc.store.agent(1)!
  assert.deepEqual([parked.paused, parked.retired?.by, parked.retired?.egld, parked.retired?.foxsy], [true, 'owner', '1.5000', '3400'])
  await assert.rejects(svc.retireAgent(1, 'owner'), /no active agent 2/)
  assert.equal(await svc.tick(1), 'agent 2 is retired')

  // Retired agents do not count toward the limit: a new agent takes the next number.
  assert.equal(svc.addNextAgent().index, 2)
  assert.throws(() => svc.restoreAgent(1, 'owner'), /allows 2 active agents/)
  assert.throws(() => svc.restoreAgent(0, 'owner'), /agent 1 is not retired/)

  // Telegram: the status names it, commands for it point to Restore.
  assert.match(await svc.command('status', [], '/status'), /1 retired \(agent 2\): restore them in the dashboard, Retired/)
  await assert.rejects(svc.command('resume', ['2'], '/resume 2'), /agent 2 is retired: restore it in the dashboard first/)
  assert.match(await svc.command('resume', ['all'], '/resume all'), /resumed all agents/)
  assert.equal(svc.store.agent(1)!.paused, true, '/resume all leaves a retired agent paused')

  await svc.retireAgent(2, 'owner')
  assert.match(svc.restoreAgent(1, 'owner'), /agent 2 restored, paused/)
  assert.deepEqual(svc.store.agents().map(b => [b.index, b.paused, b.retired]), [[0, false, null], [1, true, null]])
  assert.deepEqual(svc.store.retiredAgents().map(b => b.index), [2])
})

test('retire: over the web a retired agent leaves the tabs for Retired, answers only Restore, and comes back paused', async () => {
  const { Service } = await import('../src/service.ts')
  const { startWeb } = await import('../src/web/server.ts')
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-')), 5))
  svc.ensureAgents()
  ;(svc as unknown as { schedule: unknown }).schedule = () => undefined
  offline(svc)
  svc.addNextAgent()
  const creds = { username: 'admin', passwordHash: hashPassword('correct-horse-battery'), secretKey: 'k'.repeat(64) }
  const server = startWeb(svc, creds, 0)
  if (!server.listening) await once(server, 'listening')
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const sessions = new Sessions(creds.secretKey, creds.passwordHash)
  const cookie = sessions.issue('admin')
  const post = (path: string) =>
    fetch(`${url}${path}`, { method: 'POST', headers: { cookie: `foxagent_session=${cookie}`, origin: url, 'x-csrf-token': sessions.csrfFor(cookie), 'content-type': 'application/json' }, body: '{}' })
  const state = async () => (await (await fetch(`${url}/api/state`, { headers: { cookie: `foxagent_session=${cookie}` } })).json()) as {
    agents: { index: number; paused: boolean }[]
    retired: { index: number; by: string; egld: string | null }[]
    instance: { next: { index: number } | null }
  }
  try {
    assert.equal((await post('/api/agents/1/retire')).status, 200)
    let s = await state()
    assert.deepEqual(s.agents.map(b => b.index), [0])
    assert.deepEqual(s.retired.map(r => [r.index, r.by, r.egld]), [[1, 'admin', null]])
    assert.equal(s.instance.next?.index, 2, 'Add agent takes the next number')
    assert.equal((await post('/api/agents/1/resume')).status, 409)
    assert.equal((await post('/api/agents/1/tick')).status, 409)
    assert.equal((await post('/api/agents/0/restore')).status, 400)
    assert.equal((await post('/api/agents/1/restore')).status, 200)
    s = await state()
    assert.deepEqual(s.agents.map(b => [b.index, b.paused]), [[0, false], [1, true]])
    assert.deepEqual(s.retired, [])
  } finally {
    server.close()
  }
})

test('retire: the agent is paused before the wallet is read; a payment or an action that lands meanwhile stops the retire and leaves it paused', async () => {
  const { Service } = await import('../src/service.ts')
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-')), 2))
  svc.ensureAgents()
  ;(svc as unknown as { schedule: unknown }).schedule = () => undefined
  let pausedDuringRead: boolean | undefined
  let land: () => void = () => undefined
  offline(svc, { chain: { account: async () => { pausedDuringRead = svc.store.agent(0)!.paused; land(); return { nonce: 1, balance: 10n ** 18n } }, esdts: async () => [] } })

  // A seat payment from an action that was already signing lands while the wallet is read.
  land = () => svc.store.addPending('0xseat', 0, 'join', {})
  await assert.rejects(svc.retireAgent(0, 'owner'), /agent 1 is paused, but a payment waits for FoxLeague's confirmation/)
  assert.equal(pausedDuringRead, true, 'paused before anything was awaited')
  assert.deepEqual([svc.store.agent(0)!.paused, svc.store.agent(0)!.retired], [true, null], 'left paused, not retired')
  svc.store.resolvePending('0xseat', 'done')

  // An action of this agent still running or queued in the executor stops it too.
  const locks = (svc.executor as unknown as { locks: Map<number, Promise<void>> }).locks
  land = () => void locks.set(0, Promise.resolve())
  await assert.rejects(svc.retireAgent(0, 'owner'), /an action it started is still finishing: retire it in a minute/)
  locks.delete(0)
  land = () => undefined
  assert.match(await svc.retireAgent(0, 'owner'), /agent 1 retired/)
  ;(svc as unknown as { strategist: unknown }).strategist = { ask: async () => assert.fail('no model call for a retired agent') }
  assert.equal(await svc.command('ask', ['what', 'now'], 'what now'), 'every agent is retired: restore one in the dashboard first')
})

test('retire: a stale Import team confirmation for a retired agent\'s wallet leaves its key alone; the CLI sees retired agents', async () => {
  const { Service } = await import('../src/service.ts')
  const { saveImportedKey } = await import('../src/wallet/imported.ts')
  const { assertSameWords } = await import('../src/wallet/wallet.ts')
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-'))
  const svc = new Service(testConfig(dir, 5))
  svc.ensureAgents()
  ;(svc as unknown as { schedule: unknown }).schedule = () => undefined
  offline(svc)
  const key = Mnemonic.generate().deriveKey(0)
  const address = saveImportedKey(dir, key)
  const row = svc.store.addImportedAgent(address)
  await svc.retireAgent(row.index, 'owner')
  // The token a second Check left behind, confirmed after the import and the retire.
  ;(svc as unknown as { pendingImports: Map<string, unknown> }).pendingImports.set('stale', { key, address, team: 'X', expires: Date.now() + 60_000 })
  assert.throws(() => svc.importAgent('stale', 'owner'), /already agent 2 \(retired: restore it instead\)/)
  assert.equal(svc.wallet(row.index).address, address, 'the retired team keeps its key file')

  // The CLI's words check and its agent list (for the PEM files) include retired agents.
  svc.store.addAgent(2, svc.wallet(2).address)
  await svc.retireAgent(2, 'owner')
  const other = Mnemonic.generate().toString()
  assert.throws(() => assertSameWords([...svc.store.agents(), ...svc.store.retiredAgents()], other, '.env', dir), /agent 1 is/)
  assert.throws(() => assertSameWords(svc.store.retiredAgents(), other, '.env', dir), /agent 3 is/, 'a retired agent from the words is checked too')
})
