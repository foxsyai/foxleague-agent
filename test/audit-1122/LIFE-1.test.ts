// LIFE-1 (pre-release audit 2026-11-22, LIFECYCLE): every PermissionDeniedError (403) counted as an account stop for
// the whole install (service.ts tickFailed, accountWait, P10). With a model per agent, a 403 for one agent's own model
// (a key that may not use it) made that agent the prober: it renewed the stop at each of its ticks, so the agents on
// other models, which work, never planned again, and the alert pointed to Keys or credit. Now the stop keeps the
// prober's model and holds back only agents whose real plan uses that model; the alert names it. A 401 (key rejected)
// or a billing, credit or limit error stays an account stop for every agent.
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

const FABLE = 'claude-fable-5-2'
const denied = () => Anthropic.APIError.generate(403, { type: 'error', error: { type: 'permission_error', message: 'Your API key does not have permission to use the specified resource.' } }, undefined, new Headers())
const rejected = () => Anthropic.APIError.generate(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, undefined, new Headers())
const credit = () => Anthropic.APIError.generate(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } }, undefined, new Headers())

function service(fails: (model: string) => Error | null) {
  const svc = new Service({
    mnemonic: Mnemonic.generate().toString(), dataDir: mkdtempSync(join(tmpdir(), 'foxagent-life1-')), gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: 'test-key', model: 'claude-haiku-5-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config)
  svc.ensureAgents()
  for (let i = 1; i < 4; i++) svc.store.addAgent(i, svc.wallet(i).address)
  for (let i = 0; i < 4; i++) svc.store.updateSettings(i, { tickMinutes: 60, tickJitterMinutes: 10 })
  // Agent 1 plays a model of its own; agents 2 and 3 play the all-agents model (Haiku 5.5).
  svc.store.updateSettings(0, { aiModel: FABLE })
  const said: string[] = []
  const asked: { index: number; model: string }[] = []
  let current = -1
  const ok = { summary: 'nothing to do', actions: [], rejected: [], usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0.001, servedBy: 'claude-haiku-5-5' }, stopReason: 'tool_use' }
  Object.assign(svc as object, {
    schedule: () => undefined, notify: (t: string) => void said.push(t), report: () => undefined, inActiveHours: () => true,
    waitingForFunds: () => null, retryPending: async () => undefined, noticeInvitations: async () => undefined,
    snapshot: async () => snapshot(), pause: async () => undefined,
    strategistFor: (model: string) => ({
      plan: async () => {
        asked.push({ index: current, model })
        const e = fails(model)
        if (e) throw e
        return { ...ok, usage: { ...ok.usage, servedBy: model } }
      },
    }),
  })
  const tick = async (i: number, scheduled = true) => {
    current = i
    return svc.tick(i, undefined, scheduled ? { scheduled: true } : {})
  }
  return { svc, said, asked, tick }
}

test('LIFE-1 a 403 for one agent\'s own model holds back only the agents on that model; the alert names it', async () => {
  const { svc, said, asked, tick } = service(model => (model === FABLE ? denied() : null))
  await tick(0)
  assert.deepEqual(asked, [{ index: 0, model: FABLE }])
  // Agents 2 and 3 play Haiku 5.5, which works: they plan at their ticks, round after round.
  for (let round = 0; round < 2; round++) {
    await tick(1)
    await tick(2)
    await tick(0)
  }
  assert.equal(asked.filter(a => a.index === 1).length, 2, `agent 2 must plan on Haiku 5.5: ${JSON.stringify(asked)}`)
  assert.equal(asked.filter(a => a.index === 2).length, 2, `agent 3 must plan on Haiku 5.5: ${JSON.stringify(asked)}`)
  const alerts = said.filter(t => /failing/i.test(t))
  assert.equal(alerts.length, 1, said.join(' | '))
  assert.match(alerts[0]!, /Fable 5\.2/, `the alert names the model: ${alerts[0]}`)
  assert.doesNotMatch(said.join(' | '), /work again/, 'a plan on another model says nothing of the stop')
  // An agent on the same model waits for the prober (no snapshot, no call).
  svc.store.updateSettings(3, { aiModel: FABLE })
  const before = asked.length
  const waits = await tick(3)
  assert.equal(asked.length, before, 'agent 4 plays Fable 5.2 too and waits')
  assert.match(waits, /agent 1/i, waits)
})

test('LIFE-1 a 403 after a key error (the key works again, the model does not) frees the agents on other models', async () => {
  let keyBad = true
  const { asked, tick } = service(model => (keyBad ? rejected() : model === FABLE ? denied() : null))
  await tick(0)
  await tick(1)
  assert.equal(asked.length, 1, 'the key is rejected: agent 2 waits for agent 1')
  keyBad = false
  await tick(0)
  assert.equal(asked.length, 2, 'agent 1 asks again: its model is refused now, not the key')
  await tick(1)
  await tick(2)
  assert.equal(asked.length, 4, `agents 2 and 3 play Haiku 5.5 and plan: ${JSON.stringify(asked)}`)
})

test('LIFE-1 a 401 or a billing error stays an account stop for every agent (coverage: right before the fix too)', async () => {
  for (const err of [rejected, credit]) {
    const { asked, said, tick } = service(model => (model === FABLE ? err() : null))
    await tick(0)
    await tick(1)
    await tick(2)
    assert.equal(asked.length, 1, `${err.name}: agents 2 and 3 wait (${JSON.stringify(asked)})`)
    assert.match(said.find(t => /failing/i.test(t)) ?? '', /^Plans are failing: .*Every agent waits/)
  }
})

// R85A-3 (agent review of PR #85, on fd70bb2): the stop had one slot. With two models both refused with a 403, each refusal took
// the slot from the other, so every agent on either model read a snapshot and asked at every tick, and the second
// alert said that agents on other models plan as usual. Now each refused model keeps its own stop and its own prober.
test('R85A-3 two models both refused with a 403: each keeps its own stop; the agents on either model wait', async () => {
  const SONNET = 'claude-sonnet-5-5'
  const { svc, said, asked, tick } = service(model => (model === FABLE || model === SONNET ? denied() : null))
  let snaps = 0
  Object.assign(svc as object, { snapshot: async () => (snaps++, snapshot()) })
  // Agents 1 and 3 play Fable 5.2, agents 2 and 4 Sonnet 5.5.
  svc.store.updateSettings(1, { aiModel: SONNET })
  svc.store.updateSettings(2, { aiModel: FABLE })
  svc.store.updateSettings(3, { aiModel: SONNET })
  await tick(0)
  await tick(1)
  assert.deepEqual(asked, [{ index: 0, model: FABLE }, { index: 1, model: SONNET }])
  const before = snaps
  const fableWaits = await tick(2)
  const sonnetWaits = await tick(3)
  assert.equal(asked.length, 2, `agents 3 and 4 wait for the agent that asks for their model: ${JSON.stringify(asked)}`)
  assert.equal(snaps, before, 'and read no snapshot')
  assert.match(fableWaits, /agent 1/i, fableWaits)
  assert.match(sonnetWaits, /agent 2/i, sonnetWaits)
  // Each prober asks again at its own tick, and only it.
  await tick(0)
  await tick(1)
  await tick(2)
  await tick(3)
  assert.equal(asked.length, 4, JSON.stringify(asked))
  const alerts = said.filter(t => /failing/i.test(t))
  assert.equal(alerts.length, 2, said.join(' | '))
  assert.doesNotMatch(alerts[1]!, /Agents on other models plan as usual/, `Fable 5.2 is refused too: ${alerts[1]}`)
  assert.match(alerts[1]!, /Fable 5\.2/, alerts[1])
})

test('R85A-3 a plan that works ends only its own model\'s stop', async () => {
  const SONNET = 'claude-sonnet-5-5'
  let fableBad = true
  const { svc, said, asked, tick } = service(model => ((model === FABLE && fableBad) || model === SONNET ? denied() : null))
  svc.store.updateSettings(1, { aiModel: SONNET })
  svc.store.updateSettings(2, { aiModel: FABLE })
  svc.store.updateSettings(3, { aiModel: SONNET })
  await tick(0)
  await tick(1)
  fableBad = false
  await tick(0)
  assert.equal(said.filter(t => /work again/.test(t)).length, 1, said.join(' | '))
  assert.match(said.find(t => /work again/.test(t))!, /Fable 5\.2/)
  await tick(2)
  assert.equal(asked.filter(a => a.index === 2).length, 1, 'agent 3 plays Fable 5.2 and plans again')
  await tick(3)
  assert.equal(asked.filter(a => a.index === 3).length, 0, 'agent 4 plays Sonnet 5.5, still refused: it waits for agent 2')
})
