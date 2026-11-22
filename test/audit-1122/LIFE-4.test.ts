// LIFE-4 (pre-release audit 2026-11-22, LIFECYCLE; older code): Telegram `/do N <words>` did not ask tickRefusal first:
// paused, under the kill switch or with a plan still running it answered "planning ..." and the refusal was dropped,
// so the owner waited for a plan that never came. And the loud wrapper of tick() removed the number from `loud` even
// when it had not added it: a /do while a /tick plan ran silenced that plan's results on Telegram.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Mnemonic } from '@multiversx/sdk-core'
import type { Config } from '../../src/config.ts'
import { Service } from '../../src/service.ts'
import { snapshot } from '../fixtures.ts'

function svcOf() {
  const svc = new Service({
    mnemonic: Mnemonic.generate().toString(), dataDir: mkdtempSync(join(tmpdir(), 'foxagent-life4-')), gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: 'test-key', model: 'claude-haiku-5-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config)
  svc.ensureAgents()
  svc.store.updateSettings(0, { activeHoursUtc: [0, 24], tickMinutes: 60, tickJitterMinutes: 10 })
  let calls = 0
  let wake: () => void = () => undefined
  Object.assign(svc as object, {
    schedule: () => undefined, notify: () => undefined, report: () => undefined, inActiveHours: () => true,
    waitingForFunds: () => null, retryPending: async () => undefined, noticeInvitations: async () => undefined,
    snapshot: async () => snapshot(), pause: () => new Promise<void>(r => { wake = r }),
  })
  ;(svc.strategist as unknown as { plan: unknown }).plan = async () => {
    calls++
    return { summary: 'train', actions: [{ action: { type: 'train', player_nonce: 1, attribute: 'speed' }, reason: '' }], rejected: [], usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0.1, servedBy: 'claude-haiku-5-5' }, stopReason: 'tool_use' }
  }
  return { svc, calls: () => calls, wake: () => wake(), loud: (svc as unknown as { loud: Set<number> }).loud }
}

const words = ['1', 'play', 'a', 'ranked', 'game']
const raw = '1 play a ranked game'

test('LIFE-4 /do N in words answers the refusal: paused, kill switch', async () => {
  const { svc, calls } = svcOf()
  svc.store.setPaused(0, true)
  assert.match(await svc.command('do', words, raw), /paused/)
  svc.store.setPaused(0, false)
  svc.store.setKillSwitch(true)
  assert.match(await svc.command('do', words, raw), /kill switch/)
  await new Promise(r => setTimeout(r, 30))
  assert.equal(calls(), 0)
})

test('LIFE-4 /do N in words while a /tick plan still runs: the owner is told, and the /tick plan stays loud', async () => {
  const { svc, calls, wake, loud } = svcOf()
  const random = Math.random
  Math.random = () => 0.5
  try {
    assert.match(await svc.command('tick', ['1'], '1'), /tick started/)
    await new Promise(r => setTimeout(r, 50))
    assert.equal(svc.isBusy(0), true, 'the /tick plan waits for its action')
    assert.equal(loud.has(0), true)
    assert.equal(calls(), 1)
    const answer = await svc.command('do', words, raw)
    assert.match(answer, /still running its previous plan/, answer)
    await new Promise(r => setTimeout(r, 50))
    assert.equal(calls(), 1, 'no second plan')
    assert.equal(loud.has(0), true, 'the /tick plan\'s results still follow on Telegram')
  } finally {
    Math.random = random
    wake()
  }
})

test('LIFE-4 a loud tick that is refused leaves the loud flag it did not set', async () => {
  const { svc, wake, loud } = svcOf()
  const random = Math.random
  Math.random = () => 0.5
  try {
    void svc.tick(0, undefined, { loud: true })
    await new Promise(r => setTimeout(r, 50))
    assert.equal(svc.isBusy(0), true)
    assert.match(await svc.tick(0, 'x', { loud: true }), /still running/)
    assert.equal(loud.has(0), true, 'the refused tick silenced the running plan')
  } finally {
    Math.random = random
    wake()
  }
})
