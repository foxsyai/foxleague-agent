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
  const inner = svc as unknown as { busy: Set<number>; planning: Set<number>; executor: { locks: Map<number, Promise<void>> } }
  return { svc, dir, index: row.index, busy: inner.busy, planning: inner.planning, locks: inner.executor.locks }
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

// The eleventh GitHub review of PR #89 (medium, R89A-12): Remove while the tick was still making its plan (the snapshot,
// the AI) let the tick go on for a number with no row; wallet() then fell back to the install's own recovery-words
// wallet at that number: read, stored as its snapshot, the plan paid for (nothing signed: the executor refuses a row
// that is gone). Remove now waits for the plan to be made; a removed imported team's number never yields a wallet.
test('R89A-12 Remove waits while the plan is still being made; it goes once the plan only waits', async () => {
  const { svc, index, busy, planning } = await withImported()
  busy.add(index); planning.add(index) // the tick reads the wallet or asks the AI
  assert.throws(() => svc.removeAgent(index, 'owner'), /the plan it started is still being made: remove it in a minute/)
  planning.delete(index) // the plan is made; its actions wait for their moments
  assert.match(svc.removeAgent(index, 'owner'), /removed/)
})

test('R89A-12 a real tick: Remove is refused until the plan is made', async () => {
  const { svc, index } = await withImported()
  svc.store.setPaused(index, false)
  // Every hour of the day, so the tick never ends at once as "outside active hours" (R89A-13: 22:00 to 06:00 UTC).
  svc.store.updateSettings(index, { activeHoursUtc: [0, 24] })
  let release: (v: unknown) => void = () => undefined
  const inner = svc as unknown as { snapshot: (i: number, fresh?: boolean) => Promise<unknown> }
  const { snapshot } = await import('../fixtures.ts')
  inner.snapshot = () => new Promise(r => { release = r })
  const ticking = svc.tick(index)
  await new Promise(r => setTimeout(r, 30))
  assert.equal(svc.isBusy(index), true, 'the tick runs: it was not refused')
  svc.store.setPaused(index, true)
  assert.throws(() => svc.removeAgent(index, 'owner'), /still being made/)
  release(snapshot())
  await ticking
  assert.match(svc.removeAgent(index, 'owner'), /removed/, 'once the tick is over')
})

test('R89A-12 a plan that waited through Remove stops at its next step: no snapshot, no action', async () => {
  const { svc, index } = await withImported()
  const inner = svc as unknown as { pause: (ms: number) => Promise<void>; snapshot: () => Promise<unknown>; runPlan: (a: unknown, p: unknown[], routine: boolean) => Promise<void>; executor: { runOne: () => Promise<unknown> } }
  let wake: () => void = () => undefined
  inner.pause = () => new Promise(r => { wake = r })
  inner.snapshot = async () => assert.fail('no snapshot for a removed team')
  inner.executor.runOne = async () => assert.fail('no action for a removed team')
  const agent = svc.store.agent(index)!
  const random = Math.random
  Math.random = () => 0.5 // the action sits inside the window, so the plan waits for it
  const running = inner.runPlan({ ...agent, paused: false }, [{ action: { type: 'train', player_nonce: 1, attribute: 'speed' }, reason: '' }], true)
  Math.random = random
  await new Promise(r => setTimeout(r, 10))
  assert.match(svc.removeAgent(index, 'owner'), /removed/, 'the plan only waits: Remove goes')
  wake()
  await running
})

test('R89A-12 a removed imported team\'s number never yields a wallet, never the install\'s own one', async () => {
  const { svc, index } = await withImported()
  assert.equal(svc.wallet(index).address, TEAM)
  svc.removeAgent(index, 'owner')
  assert.throws(() => svc.wallet(index), /was an imported team and has been removed/)
})

// The twelfth review (low, R89A-14): Pause and Remove while one step of a waiting plan read its snapshot (tens of seconds,
// no lock held). The plan went on: the reading was stored under the removed number; wallet() then threw; the tick
// logged an error and told Telegram "tick failed" for a team that is gone. Nothing was signed.
test('R89A-14 a Remove during a step\'s snapshot ends the plan there: no action, no error, the reading not kept', async () => {
  const { svc, index } = await withImported()
  svc.store.setPaused(index, false)
  svc.store.updateSettings(index, { activeHoursUtc: [0, 24] })
  const inner = svc as unknown as { pause: () => Promise<void>; runPlan: (a: unknown, p: unknown[], routine: boolean) => Promise<void>; snapshots: Map<number, unknown>; executor: { runOne: () => Promise<unknown> } }
  inner.pause = async () => undefined
  inner.executor.runOne = async () => assert.fail('no action for a removed team')
  // The step's snapshot is the real one, its FoxLeague read held until the team is removed.
  let release: () => void = () => undefined
  const held = new Promise<void>(r => { release = r })
  Object.assign(svc.fox, { user: async () => (await held, { team_name: 'Red Foxes' }) })
  inner.snapshots.delete(index)
  const running = inner.runPlan(svc.store.agent(index)!, [{ action: { type: 'train', player_nonce: 1, attribute: 'speed' }, reason: '' }], false)
  await new Promise(r => setTimeout(r, 30))
  svc.store.setPaused(index, true)
  assert.match(svc.removeAgent(index, 'owner'), /removed/)
  release()
  await running // resolves: no wallet() error for the removed number
  assert.equal(inner.snapshots.has(index), false, 'the reading of a removed team is not kept')
})
