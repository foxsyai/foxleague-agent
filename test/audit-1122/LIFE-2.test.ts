// LIFE-2 (pre-release audit 2026-11-22, LIFECYCLE): a plan that waited through Remove (or Retire) could run its
// remaining actions after the team was imported again (or restored) and resumed: the same row number, and runPlan's step
// reads only whether the row is there and not paused. Each step is checked again by the executor on a fresh snapshot,
// so nothing broke a cap, but the actions were planned for a team the owner had removed. Now a per-agent generation
// raised by Remove and Retire ends such a plan quietly at its next step.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Mnemonic } from '@multiversx/sdk-core'
import type { Config } from '../../src/config.ts'
import { snapshot } from '../fixtures.ts'

const WORDS = Mnemonic.generate().toString()

async function withImported() {
  const { Service } = await import('../../src/service.ts')
  const svc = new Service({
    mnemonic: Mnemonic.generate().toString(), dataDir: mkdtempSync(join(tmpdir(), 'foxagent-life2-')), gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-haiku-5-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config)
  svc.ensureAgents()
  ;(svc as unknown as { schedule: unknown }).schedule = () => undefined
  Object.assign(svc.fox, { user: async () => ({ team_name: 'Red Foxes' }), team: async () => ({ name: 'Red Foxes', team_overall: 50, badge: null }) })
  Object.assign(svc.chain, { account: async () => ({ balance: 0n }), esdts: async () => [], guarded: async () => false })
  const imp = async () => svc.importAgent((await svc.previewImport({ kind: 'words', words: WORDS })).token, 'owner')
  const row = await imp()
  svc.store.setPaused(row.index, false)
  svc.store.updateSettings(row.index, { activeHoursUtc: [0, 24] })
  const inner = svc as unknown as { pause: (ms: number) => Promise<void>; snapshot: () => Promise<unknown>; runPlan: (a: unknown, p: unknown[], routine: boolean) => Promise<void>; executor: { runOne: (...a: unknown[]) => Promise<unknown> }; busy: Set<number> }
  let wake: () => void = () => undefined
  inner.pause = () => new Promise(r => { wake = r })
  inner.snapshot = async () => snapshot()
  const ran: string[] = []
  inner.executor.runOne = async (_a, _w, _s, p) => {
    ran.push((p as { action: { type: string } }).action.type)
    return { action: (p as { action: unknown }).action, reason: '', status: 'dry_run', summary: 'ran', costUsd: 0 }
  }
  // A plan made before the Remove: its action waits for its moment inside the window.
  const random = Math.random
  Math.random = () => 0.5
  inner.busy.add(row.index)
  const running = inner.runPlan(svc.store.agent(row.index)!, [{ action: { type: 'train', player_nonce: 1, attribute: 'speed' }, reason: 'planned before' }], true).finally(() => inner.busy.delete(row.index))
  Math.random = random
  await new Promise(r => setTimeout(r, 20))
  return { svc, index: row.index, imp, ran, running, wake: () => wake() }
}

test('LIFE-2 a plan that waited through Remove does not run after the team is imported again and resumed', async () => {
  const { svc, index, imp, ran, running, wake } = await withImported()
  svc.store.setPaused(index, true)
  assert.match(svc.removeAgent(index, 'owner'), /removed/)
  // The owner imports the team again (the same number) and resumes it before the old plan's moment.
  const back = await imp()
  assert.equal(back.index, index)
  svc.store.setPaused(back.index, false)
  wake()
  await running
  assert.deepEqual(ran, [], 'the action planned for the removed team ran for the team imported again')
})

test('LIFE-2 a plan that waited through Retire does not run after Restore and Resume', async () => {
  const { svc, index, ran, running, wake } = await withImported()
  assert.match(await svc.retireAgent(index, 'owner'), /retired/)
  svc.restoreAgent(index, 'owner')
  svc.store.setPaused(index, false)
  wake()
  await running
  assert.deepEqual(ran, [], 'the action planned before Retire ran after Restore')
})

test('LIFE-2 control: a plan with no Remove or Retire runs its action', async () => {
  const { ran, running, wake } = await withImported()
  wake()
  await running
  assert.deepEqual(ran, ['train'])
})
