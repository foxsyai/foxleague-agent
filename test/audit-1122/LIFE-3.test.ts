// LIFE-3 (pre-release audit 2026-11-22, LIFECYCLE): Service.pause() added its abort listener after the stop signal had
// fired, so it never woke: a stop (SIGTERM, a deploy) that began while a plan was being made still paid for the plan,
// and stop() then waited its full 150 s for the plan's first action. Each pause also left its listener on the signal
// when its timer fired. Now pause() returns at once once the stop began and removes its listener when its timer
// fires, and tick() returns after its snapshot, before the model is asked, when the service is stopping.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getEventListeners } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Mnemonic } from '@multiversx/sdk-core'
import type { Config } from '../../src/config.ts'
import { Service } from '../../src/service.ts'
import { snapshot } from '../fixtures.ts'

function svcOf() {
  const svc = new Service({
    mnemonic: Mnemonic.generate().toString(), dataDir: mkdtempSync(join(tmpdir(), 'foxagent-life3-')), gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: 'test-key', model: 'claude-haiku-5-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config)
  svc.ensureAgents()
  svc.store.updateSettings(0, { activeHoursUtc: [0, 24], tickMinutes: 60, tickJitterMinutes: 10 })
  return svc
}

const within = <T>(p: Promise<T>, ms: number): Promise<T | 'late'> => Promise.race([p, new Promise<'late'>(r => setTimeout(() => r('late'), ms))])

test('LIFE-3 a stop that begins while a plan is being made: the model is not asked and stop() ends at once', async () => {
  const svc = svcOf()
  let release: (v: unknown) => void = () => undefined
  let calls = 0
  Object.assign(svc as object, {
    schedule: () => undefined, notify: () => undefined, report: () => undefined, inActiveHours: () => true,
    waitingForFunds: () => null, retryPending: async () => undefined, noticeInvitations: async () => undefined,
    snapshot: () => new Promise(r => { release = r }),
  })
  ;(svc.strategist as unknown as { plan: unknown }).plan = async () => {
    calls++
    return { summary: 'train', actions: [{ action: { type: 'train', player_nonce: 1, attribute: 'speed' }, reason: '' }], rejected: [], usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0.1, servedBy: 'claude-haiku-5-5' }, stopReason: 'tool_use' }
  }
  const random = Math.random
  Math.random = () => 0.5
  try {
    const ticking = svc.tick(0, undefined, { scheduled: true })
    await new Promise(r => setTimeout(r, 30))
    assert.equal(svc.isBusy(0), true, 'the tick is reading its snapshot')
    const stopping = svc.stop()
    release(snapshot())
    assert.equal(await within(stopping.then(() => 'stopped'), 2000), 'stopped', 'stop() waited for the plan made after it began')
    assert.equal(calls, 0, 'the model was asked (and paid) after the stop began')
    await ticking
  } finally {
    Math.random = random
  }
})

test('LIFE-3 pause() returns at once once the stop began, and leaves no listener when its timer fires', async () => {
  const svc = svcOf()
  const inner = svc as unknown as { pause: (ms: number) => Promise<void>; stopSignal: AbortController }
  const before = getEventListeners(inner.stopSignal.signal, 'abort').length
  await Promise.all([inner.pause(5), inner.pause(10), inner.pause(15)])
  assert.equal(getEventListeners(inner.stopSignal.signal, 'abort').length, before, 'each pause left its listener on the stop signal')
  inner.stopSignal.abort()
  assert.equal(await within(inner.pause(60_000).then(() => 'woke'), 500), 'woke', 'a pause after the stop began slept its whole time')
})
