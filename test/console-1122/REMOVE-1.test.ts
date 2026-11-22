// REMOVE-1: the owner, 2026-11-22, testing the release candidate. Remove of a paused imported team answered "agent 2
// is busy; try again in a minute" again and again, and the page then switched to agent 1 as if it was gone. A plan
// marks its agent busy until its last action's moment, up to 80 percent of a tick later (48 minutes at Zeus's 60), and
// a pause only ends it at that moment; Remove also refused while any other agent ran an action. Remove now refuses as
// Retire does: while an action of this agent is still running or a payment waits. A plan that only waits ends at its
// next step, which reads the agent first (gone: it stops). The page stays on the agent when Remove is refused.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Mnemonic } from '@multiversx/sdk-core'
import type { Config } from '../../src/config.ts'
import { addressOfKey } from '../../src/wallet/imported.ts'

const WORDS = Mnemonic.generate().toString()
const TEAM = addressOfKey(Mnemonic.fromString(WORDS).deriveKey(0))

async function withImported() {
  const { Service } = await import('../../src/service.ts')
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-'))
  const svc = new Service({
    mnemonic: Mnemonic.generate().toString(), dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-haiku-5-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config)
  svc.ensureAgents()
  ;(svc as unknown as { schedule: unknown }).schedule = () => undefined
  Object.assign(svc.fox, { user: async () => ({ team_name: 'Red Foxes' }), team: async () => ({ name: 'Red Foxes', team_overall: 50, badge: null }) })
  Object.assign(svc.chain, { account: async () => ({ balance: 0n }), esdts: async () => [], guarded: async () => false })
  const p = await svc.previewImport({ kind: 'words', words: WORDS })
  const row = svc.importAgent(p.token, 'owner')
  const inner = svc as unknown as { busy: Set<number>; executor: { locks: Map<number, Promise<void>> } }
  return { svc, dir, index: row.index, busy: inner.busy, locks: inner.executor.locks }
}

test('REMOVE-1 a paused imported team whose plan only waits for its next action is removed', async () => {
  const { svc, dir, index, busy } = await withImported()
  assert.equal(svc.store.agent(index)!.paused, true, 'an import starts paused')
  busy.add(index) // its plan sleeps until the next action's moment
  assert.match(svc.removeAgent(index, 'owner'), /removed/)
  assert.equal(svc.store.agent(index), undefined, 'gone: the waiting plan stops at its next step')
  assert.equal(existsSync(join(dir, 'keys', `${TEAM}.pem`)), false, 'its key is deleted')
})

test('REMOVE-1 an action of this agent still running refuses it; another agent\'s action does not', async () => {
  const { svc, index, locks } = await withImported()
  locks.set(index, new Promise(() => undefined)) // an action of this agent signing or waiting for its outcome
  assert.throws(() => svc.removeAgent(index, 'owner'), /an action it started is still finishing/)
  locks.delete(index)
  locks.set(0, new Promise(() => undefined)) // agent 1 is acting
  assert.match(svc.removeAgent(index, 'owner'), /removed/)
})

test('REMOVE-1 the page stays on the agent when Remove is refused, as Retire and Delete do', () => {
  const html = readFileSync(join(import.meta.dirname, '..', '..', 'src/web/dashboard.html'), 'utf8')
  assert.match(html, /act\('Removed', \(\) => api\('POST', '\/api\/agents\/' \+ b\.index \+ '\/remove', \{ confirm: 'REMOVE', password: r\.password \}\)\)\.then\(\(\) => \{ if \(S && !S\.agents\.some\(x => x\.index === b\.index\) && S\.agents\[0\]\) select\(S\.agents\[0\]\.index\) \}\)/)
})
