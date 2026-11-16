// P10 (audit 2026-11-16, behaviour review): while Anthropic refuses every plan for an account reason (the workspace
// usage limit on 11 Nov 16:19 to 18:51 UTC and 15 Nov 08:35 to 10:27 UTC), every agent kept taking a full snapshot and
// asking the model at its own tick: 45 failed plans. Now one agent asks again at its own tick and the others skip the
// snapshot and the call; the owner hears once when plans work again.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Mnemonic } from '@multiversx/sdk-core'
import Anthropic from '@anthropic-ai/sdk'
import type { Config } from '../../src/config.ts'
import { Service } from '../../src/service.ts'
import { snapshot } from '../fixtures.ts'

function testConfig(dir: string): Config {
  return {
    mnemonic: Mnemonic.generate().toString(), dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: 'test-key', model: 'claude-sonnet-5-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config
}

const usageLimit = (n: number) =>
  Anthropic.APIError.generate(400, { type: 'error', error: { type: 'invalid_request_error', message: 'You have reached your specified workspace API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.' }, request_id: `req_011Ch4QaLMWaWPxjkoYYa${n}` }, undefined, new Headers())

function service() {
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-p10-'))))
  svc.ensureAgents()
  for (let i = 1; i < 3; i++) svc.store.addAgent(i, svc.wallet(i).address)
  for (let i = 0; i < 3; i++) svc.store.updateSettings(i, { tickMinutes: 60, tickJitterMinutes: 10 })
  const said: string[] = []
  const snaps: number[] = []
  const calls: number[] = []
  const state = { down: true as boolean | 'other', n: 0 }
  Object.assign(svc as object, {
    schedule: () => undefined,
    notify: (t: string) => void said.push(t),
    report: () => undefined,
    inActiveHours: () => true,
    waitingForFunds: () => null,
    retryPending: async () => undefined,
    noticeInvitations: async () => undefined,
    snapshot: async (i: number) => (snaps.push(i), snapshot()),
    pause: async () => undefined,
  })
  ;(svc.strategist as unknown as { plan: unknown }).plan = async (input: { snapshot: unknown }) => {
    void input
    calls.push(state.n)
    if (state.down === 'other') throw new Error('FoxLeague answered 502')
    if (state.down) throw usageLimit(state.n++)
    return { summary: 'nothing to do', actions: [], rejected: [], usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0.001, servedBy: 'claude-sonnet-5-5' }, stopReason: 'tool_use' }
  }
  // A tick the scheduler starts; svc.tick(i) alone is one the owner starts (Plan now, /tick).
  const tick = (i: number) => svc.tick(i, undefined, { scheduled: true })
  return { svc, said, snaps, calls, state, tick }
}

test('P10: while the AI account refuses, one agent asks again at its tick and the others skip the snapshot and the call', async () => {
  const { svc, said, snaps, calls, state, tick } = service()
  await tick(0)
  assert.equal(calls.length, 1)
  assert.equal(said.filter(t => /^Plans are failing/.test(t)).length, 1, 'the owner is told at once')
  const before = snaps.length
  // Agents 2 and 3 tick during the stop: no snapshot, no call.
  const skipped = await tick(1)
  await tick(2)
  assert.equal(calls.length, 1, 'agents 2 and 3 did not ask the model')
  assert.equal(snaps.length, before, 'nor read a snapshot')
  assert.match(skipped, /agent 1/, skipped)
  // Agent 1 asks again at its own tick; still refused, still one alert in the hour.
  await tick(0)
  assert.equal(calls.length, 2)
  await tick(1)
  assert.equal(calls.length, 2)
  // A tick the owner starts always asks: Plan now, and a request on Telegram.
  await svc.tick(2)
  assert.equal(calls.length, 3)
  await svc.tick(1, 'play a ranked game')
  assert.equal(calls.length, 4)
  assert.equal(said.filter(t => /^Plans are failing/.test(t)).length, 1)
  // Plans work again: one message, and every agent plans at its next tick.
  state.down = false
  await svc.tick(2)
  assert.equal(said.filter(t => /work again/.test(t)).length, 1, said.join(' | '))
  await tick(0)
  await tick(1)
  assert.equal(calls.length, 7, 'all three plan again')
  assert.equal(said.filter(t => /work again/.test(t)).length, 1, 'said once')
})

test('P10: a probing agent that stops asking hands over; one that fails for another reason frees the others', async t => {
  const { svc, calls, state, tick } = service()
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  await tick(0)
  await tick(1)
  assert.equal(calls.length, 1, 'agent 2 waits for agent 1')
  // Agent 1 is paused and asks nothing more: after its tick, its random window and 5 minutes, agent 2 asks instead.
  svc.store.setPaused(0, true)
  t.mock.timers.tick(76 * 60_000)
  await tick(1)
  assert.equal(calls.length, 2, 'agent 2 asks once agent 1 has not for longer than its tick')
  await tick(2)
  assert.equal(calls.length, 2, 'agent 3 waits for agent 2')
  // The probing agent fails for a reason of its own (not the account): the others are no longer held back.
  state.down = 'other'
  await tick(1)
  assert.equal(calls.length, 3)
  await tick(2)
  assert.equal(calls.length, 4, 'agent 3 asks at its own tick again')
})
