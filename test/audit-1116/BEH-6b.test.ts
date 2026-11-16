// BEH-6b (audit 2026-11-16, open after BEH-6): the stagger after a start (firstPlanDelays in src/service.ts) leads only
// by each agent's real model and effort. With shadow plans on, each plan also sends its request to every shadow model
// (src/strategist/shadow.ts), and that shadow call writes the shadow model's own one-hour cache. Two agents that play
// different models are each the first of their own pair and plan at once, so the shadow model they share is written
// twice, at twice the input price. Shadow plans are off on the owner's server; this is for other installs.
//
// The same measure as BEH-6, over every call a plan makes (its real plan and each shadow plan, sent after it): a call
// reads the cache only when another call of its pair has surely begun its answer before it can be sent.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Mnemonic } from '@multiversx/sdk-core'
import type { Config } from '../../src/config.ts'
import { Service } from '../../src/service.ts'
import { shadowChoices, shadowRuns } from '../../src/strategist/shadow.ts'
import { snapshot } from '../fixtures.ts'

const S = 1000
const MIN = 60 * S
/** Before its call a plan reads its snapshot: from no time at all to a minute (BEH-6). */
const SNAPSHOT_MAX = 60 * S
/** A call's answer begins (and its cache write can be read) at most this long after it was sent (BEH-6). */
const BEGINS = 40 * S

function testConfig(dir: string): Config {
  return {
    mnemonic: Mnemonic.generate().toString(), dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: 'test-key', model: 'claude-opus-5-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 12,
  } as Config
}

/** The first plan of each agent the start schedules, in ms after the start. */
async function firstPlans(prepare: (svc: Service) => void): Promise<{ svc: Service; at: Map<number, number> }> {
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-beh6b-'))))
  const at = new Map<number, number>()
  const s = svc as unknown as { startTelegram: unknown; schedule: unknown; snapshot: unknown }
  s.startTelegram = () => undefined
  s.schedule = (index: number, delayMs: number) => void at.set(index, delayMs)
  s.snapshot = async () => snapshot()
  svc.notify = () => undefined
  svc.ensureAgents()
  prepare(svc)
  const env = { ...process.env }
  delete process.env.WEB_UI_USER
  delete process.env.WEB_UI_PASSWORD_HASH
  try {
    await svc.start()
    await svc.stop()
  } finally {
    Object.assign(process.env, env)
  }
  return { svc, at }
}

/** Each pair an agent's plan writes or reads: its real plan's, then each shadow plan's (sent after it, so never sooner). */
function callsOf(svc: Service, i: number): string[] {
  const ai = svc.aiOf(svc.store.agent(i)!)
  return [`${ai.model}:${ai.effort}`, ...shadowRuns(shadowChoices(svc.store, { model: ai.model, effort: ai.effort }, i)).map(r => `${r.model}:${r.effort}`)]
}

/** Cache writes per model and effort, real and shadow calls alike, whatever each snapshot takes. */
function writes(svc: Service, at: Map<number, number>, planning: number[]): Map<string, number> {
  const calls = planning.flatMap(i => callsOf(svc, i).map(pair => ({ i, pair, at: at.get(i)! })))
  const out = new Map<string, number>()
  for (const c of calls) {
    const surelyReads = calls.some(o => o.i !== c.i && o.pair === c.pair && o.at + SNAPSHOT_MAX + BEGINS <= c.at)
    if (!surelyReads) out.set(c.pair, (out.get(c.pair) ?? 0) + 1)
  }
  return out
}

test('BEH-6b: with shadow plans on, two agents of different models that share a shadow model write its cache once, not once each', async () => {
  const h = new Date().getUTCHours()
  const { svc, at } = await firstPlans(svc => {
    for (let i = 1; i < 6; i++) svc.store.addAgent(i, svc.wallet(i).address)
    for (let i = 0; i < 6; i++) svc.store.updateSettings(i, { tickMinutes: 60, tickJitterMinutes: 10, activeHoursUtc: [h, (h + 2) % 24] })
    // Agents 1 to 3 play Opus, agents 4 to 6 Sonnet; every plan has a Haiku shadow plan (the all-agents list).
    for (const i of [0, 1, 2]) svc.store.updateSettings(i, { aiModel: 'claude-opus-5-5', aiEffort: 'high' })
    for (const i of [3, 4, 5]) svc.store.updateSettings(i, { aiModel: 'claude-sonnet-5-5', aiEffort: 'high' })
    svc.store.setKv('shadow_model', 'claude-haiku-5-5:high')
  })
  assert.equal(at.size, 6, 'every agent gets its first plan')
  assert.ok(callsOf(svc, 0).includes('claude-haiku-5-5:high') && callsOf(svc, 3).includes('claude-haiku-5-5:high'), 'the shadow plans are on')
  const paid = writes(svc, at, [...at.keys()])
  assert.deepEqual([...paid].sort(), [['claude-haiku-5-5:high', 1], ['claude-opus-5-5:high', 1], ['claude-sonnet-5-5:high', 1]], `one cache write per model and effort, the shadow one too; paid: ${JSON.stringify([...paid])}`)
  // The first plan still comes at once, and every first plan within the agent's tick.
  assert.ok(Math.min(...at.values()) <= 25 * S, 'the first of them plans at once')
  for (const [i, ms] of at) assert.ok(ms >= 5 * S && ms <= 60 * MIN, `agent ${i + 1} plans first at ${(ms / MIN).toFixed(2)} min`)
})

test('BEH-6b: with shadow plans off the stagger is as BEH-6 made it: the first of each pair at once, the others 3 to 6 minutes later', async () => {
  const h = new Date().getUTCHours()
  const { svc, at } = await firstPlans(svc => {
    for (let i = 1; i < 4; i++) svc.store.addAgent(i, svc.wallet(i).address)
    for (let i = 0; i < 4; i++) svc.store.updateSettings(i, { tickMinutes: 60, tickJitterMinutes: 10, activeHoursUtc: [h, (h + 2) % 24] })
    for (const i of [2, 3]) svc.store.updateSettings(i, { aiModel: 'claude-sonnet-5-5', aiEffort: 'high' })
    svc.store.setKv('shadow_model', 'off')
  })
  const times = [0, 1, 2, 3].map(i => at.get(i)!)
  assert.ok(times[0]! <= 25 * S && times[2]! <= 25 * S, `the first of each pair at once: ${times.map(t => (t / MIN).toFixed(2)).join(', ')}`)
  for (const i of [1, 3]) assert.ok(times[i]! >= 3 * MIN && times[i]! <= 6 * MIN, `agent ${i + 1} follows 3 to 6 minutes later: ${(times[i]! / MIN).toFixed(2)}`)
  assert.deepEqual([...writes(svc, at, [0, 1, 2, 3]).values()], [1, 1])
})
