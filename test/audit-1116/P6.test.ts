// P6 (audit 2026-11-16, behaviour review; the owner's "Yes, double the tick"): 392 of 923 plans of the week had no
// action, $59.23 of $190.81, and 264 of them fell between 06:00 and 14:00 UTC: the game day resets at 14:00 and its
// starts and free sessions are spent in the hours after it, so the morning plans find nothing left. After a plan with
// no action the next plan comes after twice the tick, with its jitter, until a plan acts or the 14:00 UTC reset; the
// first plan after the reset and any plan after an action keep the normal tick. It lowers spending: no password.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Mnemonic } from '@multiversx/sdk-core'
import type { Config } from '../../src/config.ts'
import { Service } from '../../src/service.ts'
import { snapshot } from '../fixtures.ts'

const MIN = 60_000

function testConfig(dir: string): Config {
  return {
    mnemonic: Mnemonic.generate().toString(), dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: 'test-key', model: 'claude-sonnet-5-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config
}

function service() {
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-p6-'))))
  svc.ensureAgents()
  svc.store.updateSettings(0, { tickMinutes: 60, tickJitterMinutes: 10 })
  const next: number[] = []
  const answer = { actions: [] as unknown[] }
  Object.assign(svc as object, {
    schedule: (_i: number, delayMs: number) => void next.push(delayMs),
    notify: () => undefined,
    report: () => undefined,
    inActiveHours: () => true,
    waitingForFunds: () => null,
    retryPending: async () => undefined,
    noticeInvitations: async () => undefined,
    snapshot: async () => snapshot(),
    pause: async () => undefined,
  })
  ;(svc.executor as unknown as { run: unknown }).run = async () => [{ status: 'dry_run', summary: 'DRY RUN ok' }]
  ;(svc.strategist as unknown as { plan: unknown }).plan = async () => ({ summary: 'x', actions: answer.actions, rejected: [], usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0.001, servedBy: 'claude-sonnet-5-5' }, stopReason: 'tool_use' })
  const scheduleNext = (svc as unknown as { scheduleNext: (i: number, now: number) => void }).scheduleNext.bind(svc)
  return { svc, next, answer, scheduleNext }
}

const at = (h: number, m = 0) => Date.UTC(2026, 10, 17, h, m)

test('P6: after a plan with no action the next plan comes after twice the tick, until a plan acts or the 14:00 UTC reset', async t => {
  const { svc, next, answer, scheduleNext } = service()
  t.mock.method(Math, 'random', () => 0.5) // no jitter, so the tick reads plainly
  // A morning plan with nothing to do at 07:00: the next one at 09:00, not 08:00.
  await svc.tick(0, undefined, { scheduled: true })
  scheduleNext(0, at(7))
  assert.equal(next.at(-1), 120 * MIN, 'twice the 60-minute tick')
  // Another empty plan at 09:00: twice again (not four times), 11:00.
  await svc.tick(0, undefined, { scheduled: true })
  scheduleNext(0, at(9))
  assert.equal(next.at(-1), 120 * MIN)
  // An empty plan at 13:00: twice would pass the 14:00 reset, so the first plan after the reset keeps the normal tick.
  await svc.tick(0, undefined, { scheduled: true })
  scheduleNext(0, at(13))
  assert.equal(next.at(-1), 60 * MIN)
  // A plan that acts: the normal tick, whatever came before it.
  await svc.tick(0, undefined, { scheduled: true })
  answer.actions = [{ action: { type: 'sync' }, reason: '' }]
  await svc.tick(0, undefined, { scheduled: true })
  scheduleNext(0, at(8))
  assert.equal(next.at(-1), 60 * MIN)
})

test('P6: the jitter still applies to the doubled tick; a tick that made no plan keeps the normal one', async t => {
  const { svc, next, scheduleNext } = service()
  let r = 1
  t.mock.method(Math, 'random', () => r)
  await svc.tick(0, undefined, { scheduled: true })
  scheduleNext(0, at(7))
  assert.equal(next.at(-1), 130 * MIN, 'twice the tick plus the full 10-minute jitter')
  r = 0
  scheduleNext(0, at(7))
  assert.equal(next.at(-1), 110 * MIN, 'twice the tick less the full jitter')
  // A tick outside the active hours makes no plan: the plan after it comes at the normal tick.
  ;(svc as unknown as { inActiveHours: () => boolean }).inActiveHours = () => false
  r = 0.5
  await svc.tick(0, undefined, { scheduled: true })
  scheduleNext(0, at(7))
  assert.equal(next.at(-1), 60 * MIN)
})
