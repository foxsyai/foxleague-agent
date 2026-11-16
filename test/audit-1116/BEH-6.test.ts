// BEH-6 and P7 (audit 2026-11-16): after every start of the service all agents plan within 5 to 25 seconds of each
// other (service.ts start(): schedule(index, 5_000 + Math.random() * 20_000)) and each of those calls writes the
// one-hour cache of the system prompt and manual again, at twice the input price: a write can be read only once its
// answer has begun, and nothing held the other calls back for it.
// Production, 9 to 16 Nov: seven bursts of 3 to 10 cold plans inside two minutes, 63 plans in all: 10 Nov 17:56 UTC
// ten Opus plans at $0.50 to $0.58 (a warm one costs $0.15), 11 Nov 15:12 ten Fable plans at $1.15 to $1.45. The 63
// plans cost $38.89; with one write per burst $15.48: $23.41 of the week's $191 of AI cost.
//
// The reviewer wrote the test at the strategist (concurrent calls); the fix staggers the first plans after a start
// instead, so the same assertion is made one level up: the first plans the start schedules, the calls they send and
// whether each finds the cache written. The timing taken against the fix is the slow side of what the week showed (a
// plan's snapshot up to a minute before its call, its answer beginning up to 40 seconds after it was sent).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Mnemonic } from '@multiversx/sdk-core'
import type { Config } from '../../src/config.ts'
import { Service } from '../../src/service.ts'
import { snapshot } from '../fixtures.ts'

const S = 1000
const MIN = 60 * S
/** Before its call a plan reads its snapshot: from no time at all to a minute (the week's slow side). */
const SNAPSHOT_MAX = 60 * S
/** A call's answer begins (and its cache write can be read) at most this long after it was sent. */
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
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-beh6-'))))
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

/**
 * Cache writes per model and effort, whatever each snapshot takes: a planning agent's call reads the cache only when
 * another call of its pair has surely begun its answer before this one can be sent (that one sent after its slowest
 * snapshot, this one after none). Every other call pays for a write.
 */
function writes(svc: Service, at: Map<number, number>, planning: number[]): Map<string, number> {
  const calls = planning.map(i => {
    const ai = svc.aiOf(svc.store.agent(i)!)
    return { pair: `${ai.model}:${ai.effort}`, at: at.get(i)! }
  })
  const out = new Map<string, number>()
  for (const c of calls) {
    const surelyReads = calls.some(o => o !== c && o.pair === c.pair && o.at + SNAPSHOT_MAX + BEGINS <= c.at)
    if (!surelyReads) out.set(c.pair, (out.get(c.pair) ?? 0) + 1)
  }
  return out
}

test('BEH-6: the plans right after a start pay for one cache write per model and effort, not one each', async () => {
  const h = new Date().getUTCHours()
  const { svc, at } = await firstPlans(svc => {
    for (let i = 1; i < 10; i++) svc.store.addAgent(i, svc.wallet(i).address)
    for (let i = 0; i < 10; i++) svc.store.updateSettings(i, { tickMinutes: 60, tickJitterMinutes: 10, activeHoursUtc: [h, (h + 2) % 24] })
    // Three agents play their own model, as since 13 Nov: two pairs.
    for (const i of [2, 5, 8]) svc.store.updateSettings(i, { aiModel: 'claude-haiku-5-5', aiEffort: 'high' })
  })
  assert.equal(at.size, 10, 'every agent gets its first plan')
  const all = [...at.keys()]
  const paid = writes(svc, at, all)
  assert.deepEqual([...paid.values()], [1, 1], `one cache write per model and effort; paid: ${JSON.stringify([...paid])}`)
  // Each first plan still comes within the agent's normal tick, and never before 5 seconds.
  for (const [i, ms] of at) assert.ok(ms >= 5 * S && ms <= 60 * MIN, `agent ${i + 1} plans first at ${(ms / MIN).toFixed(2)} min`)
})

test('BEH-6: an agent that will not plan now (paused, outside its hours) does not hold the others back as the first of its pair', async () => {
  const h = new Date().getUTCHours()
  const { svc, at } = await firstPlans(svc => {
    for (let i = 1; i < 4; i++) svc.store.addAgent(i, svc.wallet(i).address)
    for (let i = 0; i < 4; i++) svc.store.updateSettings(i, { tickMinutes: 60, tickJitterMinutes: 10, activeHoursUtc: [h, (h + 2) % 24] })
    svc.store.setPaused(0, true)
    svc.store.updateSettings(1, { activeHoursUtc: [(h + 3) % 24, (h + 4) % 24] })
  })
  const paid = writes(svc, at, [2, 3])
  assert.deepEqual([...paid.values()], [1], 'agents 3 and 4 plan: one of them writes, the other reads')
  assert.ok(Math.min(at.get(2)!, at.get(3)!) <= 25 * S, 'the first of them plans at once, as before the change')
})
