// Delete: only an agent whose wallet was never used goes for good, with its history and its PEM file; its number is
// free again for + Add agent.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../src/store/db.ts'
import { neverUsedOrWhy, removePemFile, type DeleteDeps } from '../src/delete-agent.ts'
import { looksUnused } from '../src/web/server.ts'
import { snapshot } from './fixtures.ts'

const A = (n: number) => `erd1${String(n).padStart(58, 'q')}`

function store(count = 4): Store {
  const s = new Store('', ':memory:')
  for (let i = 0; i < count; i++) s.addAgent(i, A(i))
  return s
}

const deps = (s: Store, more: Partial<DeleteDeps> = {}): DeleteDeps => ({
  store: s,
  chain: { account: async (address: string) => ({ address, nonce: 0, balance: 0n }), esdts: async () => [] },
  fox: { user: async () => null },
  agentCount: 1,
  ...more,
})

const why = async (p: Promise<unknown>) => {
  try {
    await p
    return ''
  } catch (err) {
    return (err as Error).message
  }
}

test('a never-used wallet passes; every sign of use or an unreadable wallet keeps the agent', async () => {
  const s = store()
  assert.equal((await neverUsedOrWhy(deps(s), 3)).address, A(3))
  const chain = (nonce: number, balance: bigint, esdts: unknown[] = []) => ({ account: async (address: string) => ({ address, nonce, balance }), esdts: async () => esdts as never })
  assert.match(await why(neverUsedOrWhy(deps(s, { chain: chain(1, 0n) }), 3)), /agent 4's wallet has sent 1 transaction: retire it instead/)
  assert.match(await why(neverUsedOrWhy(deps(s, { chain: chain(0, 10n ** 17n) }), 3)), /holds 0\.1000 EGLD/)
  assert.match(await why(neverUsedOrWhy(deps(s, { chain: chain(0, 0n, [{ tokenIdentifier: 'FOXSY-5d5f3e', balance: 1n }]) }), 3)), /holds tokens or cards \(1\)/)
  assert.match(await why(neverUsedOrWhy(deps(s, { fox: { user: async () => ({ team_name: 'Varna Rovers' }) as never } }), 3)), /has the FoxLeague team "Varna Rovers"/)
  const down = { account: async () => { throw new Error('HTTP 502') }, esdts: async () => [] }
  assert.match(await why(neverUsedOrWhy(deps(s, { chain: down as never }), 3)), /could not be read \(HTTP 502\), so nothing was deleted/)
  assert.match(await why(neverUsedOrWhy(deps(s, { topups: { waitingFor: i => i === 3 } }), 3)), /Binance top-up waiting/)
  assert.match(await why(neverUsedOrWhy(deps(s), 0)), /one of the first 1 \(AGENT_COUNT\)/)
  assert.match(await why(neverUsedOrWhy(deps(s), 9)), /no agent 10/)
  s.recordSpend({ agentIndex: 2, at: new Date(), gameDay: '2026-10-13', category: 'play', action: 'join', foxsyAtomic: 0n, egldAtomic: 0n, usd: 1, txHash: 'h', dryRun: false })
  assert.match(await why(neverUsedOrWhy(deps(s), 2)), /has signed transactions before: retire it instead/)
  s.log({ agentIndex: 1, kind: 'sync', status: 'confirmed', summary: 'sync', txHash: 'abc' })
  assert.equal(s.everUsed(1), true, 'a transaction hash in the history counts too')
  const imp = s.addImportedAgent(A(50))
  assert.match(await why(neverUsedOrWhy(deps(s), imp.index)), /imported team: use Remove/)
})

test('the delete takes the row, history, ledger and stored values, keeps a record, and frees the number', () => {
  const s = store(5)
  s.log({ agentIndex: 3, kind: 'plan', status: 'info', summary: 'agent 4 plan' })
  s.recordSpend({ agentIndex: 3, at: new Date(), gameDay: '2026-10-13', category: 'play', action: 'x', foxsyAtomic: 0n, egldAtomic: 0n, usd: 0.1, txHash: null, dryRun: true })
  s.setKv('last_plan_3', 'agent 4 plan')
  s.setKv('waiting_funds:3', '1')
  s.setKv('last_plan_4', 'agent 5 plan')
  const gone = s.deleteAgent(3, 'owner')
  assert.equal(gone.address, A(3))
  assert.equal(s.agent(3), undefined)
  assert.equal(s.activity(3, 10).length, 0)
  assert.equal(s.spentUsd(3, { category: 'play', dryRun: true }), 0)
  assert.equal(s.getKv('last_plan_3'), undefined)
  assert.equal(s.getKv('waiting_funds:3'), undefined)
  assert.equal(s.getKv('last_plan_4'), 'agent 5 plan', 'another agent keeps its values')
  assert.deepEqual(s.deletedAgents().map(d => [d.index, d.address, d.by]), [[3, A(3), 'owner']])
  assert.equal(s.freeIndex(), 3, '+ Add agent takes the freed number first')
  s.addAgent(3, A(3))
  assert.equal(s.freeIndex(), 5)
  assert.throws(() => s.deleteAgent(42, 'owner'), /no agent 43/)
  const imp = s.addImportedAgent(A(60))
  assert.throws(() => s.deleteAgent(imp.index, 'owner'), /imported team/)
})

test('a PEM file goes only when its first line names the deleted wallet', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pem-'))
  writeFileSync(join(dir, 'agent4.pem'), `-----BEGIN PRIVATE KEY for ${A(3)}-----\nabc\n`)
  writeFileSync(join(dir, 'agent5.pem'), `-----BEGIN PRIVATE KEY for ${A(99)}-----\nabc\n`)
  assert.equal(removePemFile(dir, 3, A(3)), 'deleted')
  assert.equal(existsSync(join(dir, 'agent4.pem')), false)
  assert.equal(removePemFile(dir, 4, A(4)), 'kept', 'another wallet\'s file stays')
  assert.equal(existsSync(join(dir, 'agent5.pem')), true)
  assert.equal(removePemFile(dir, 7, A(7)), 'none')
})

test('the Delete button shows only for a reading of an untouched wallet', () => {
  const s = snapshot()
  s.chain = { egld: 0n, nonce: 0, foxsy: 0n, wegld: 0n, nftCount: 0 }
  s.registration = { ...s.registration, registered: false }
  assert.equal(looksUnused(s), true)
  assert.equal(looksUnused({ ...s, chain: { ...s.chain, nonce: 2 } }), false)
  assert.equal(looksUnused({ ...s, chain: { ...s.chain, egld: 1n } }), false)
  assert.equal(looksUnused({ ...s, chain: { ...s.chain, nftCount: 18 } }), false)
  assert.equal(looksUnused({ ...s, chain: null }), false, 'an unread wallet is not empty')
  assert.equal(looksUnused({ ...s, registration: { ...s.registration, registered: true } }), false)
  assert.equal(looksUnused({ ...s, registration: { ...s.registration, profileUnreadable: true } }), false)
  assert.equal(looksUnused(undefined), false)
})
