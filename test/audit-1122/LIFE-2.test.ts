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

// R85A-4 (agent review of PR #85, on 25d8af9): runPlan read the generation at its own start, after the plan was made,
// and Retire does not wait for a plan being made (Remove does). A Retire while the model was still answering raised
// the generation before runPlan read it, so after Restore and Resume that plan ran its actions. Now the tick reads
// the generation before its first wait and hands it to runPlan.
async function planHeldOpen() {
  const { Service } = await import('../../src/service.ts')
  const svc = new Service({
    mnemonic: Mnemonic.generate().toString(), dataDir: mkdtempSync(join(tmpdir(), 'foxagent-r85a4-')), gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: 'test-key', model: 'claude-haiku-5-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config)
  svc.ensureAgents()
  svc.store.setPaused(0, false)
  svc.store.updateSettings(0, { activeHoursUtc: [0, 24], actionProbability: 1 })
  Object.assign(svc.fox, { user: async () => ({ team_name: 'Red Foxes' }), team: async () => ({ name: 'Red Foxes', team_overall: 50, badge: null }) })
  Object.assign(svc.chain, { account: async () => ({ balance: 0n }), esdts: async () => [], guarded: async () => false })
  let answer: () => void = () => undefined
  const answered = new Promise<void>(r => { answer = r })
  let asking: () => void = () => undefined
  const asked = new Promise<void>(r => { asking = r })
  let wake: () => void = () => undefined
  let waiting: () => void = () => undefined
  const atWait = new Promise<void>(r => { waiting = r })
  const ran: string[] = []
  const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0.001, servedBy: 'claude-haiku-5-5' }
  Object.assign(svc as object, {
    schedule: () => undefined, notify: () => undefined, report: () => undefined, inActiveHours: () => true,
    waitingForFunds: () => null, retryPending: async () => undefined, noticeInvitations: async () => undefined,
    snapshot: async () => snapshot(),
    pause: () => new Promise<void>(r => { wake = r; waiting() }),
    strategistFor: () => ({
      plan: async () => {
        asking()
        await answered
        return { summary: 'train', actions: [{ action: { type: 'train', player_nonce: 1, attribute: 'speed' }, reason: 'planned before' }], rejected: [], usage, stopReason: 'tool_use' }
      },
    }),
  })
  Object.assign((svc as unknown as { executor: object }).executor, {
    runOne: async (_a: unknown, _w: unknown, _s: unknown, p: { action: { type: string } }) => {
      ran.push(p.action.type)
      return { action: p.action, reason: '', status: 'dry_run', summary: 'ran', costUsd: 0 }
    },
  })
  return { svc, ran, asked, answer: () => answer(), atWait, wake: () => wake() }
}

test('R85A-4 a Retire while the plan is being made ends that plan, also after Restore and Resume', async () => {
  const { svc, ran, asked, answer, atWait, wake } = await planHeldOpen()
  const random = Math.random
  Math.random = () => 0.5
  try {
    const tick = svc.tick(0, undefined, { scheduled: true })
    await asked
    assert.match(await svc.retireAgent(0, 'owner'), /retired/)
    answer()
    await atWait
    svc.restoreAgent(0, 'owner')
    svc.store.setPaused(0, false)
    wake()
    await tick
  } finally {
    Math.random = random
  }
  assert.deepEqual(ran, [], 'the plan made before the Retire ran after Restore and Resume')
})

test('R85A-4 control: the same plan with no Retire runs its action', async () => {
  const { svc, ran, asked, answer, atWait, wake } = await planHeldOpen()
  const random = Math.random
  Math.random = () => 0.5
  try {
    const tick = svc.tick(0, undefined, { scheduled: true })
    await asked
    answer()
    await atWait
    wake()
    await tick
  } finally {
    Math.random = random
  }
  assert.deepEqual(ran, ['train'])
})
