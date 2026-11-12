// Per-agent AI models and per-agent shadow plans with an effort per shadow (the owner, 2026-11-13). The owner runs his
// ten agents on three models (Opus 5.5, Sonnet 5.5, Haiku 5.5, all at high) and on three test agents lets the same
// model plan in the shadow at other efforts. Each test was seen failing on cb1537f (one model and effort for every
// agent, one shadow list for every agent with one effort) for the reason its name gives.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '../src/config.ts'
import type { PlannedAction } from '../src/executor/actions.ts'
import { Store } from '../src/store/db.ts'
import { DEFAULT_SETTINGS, validateSettingsPatch, type AgentSettings } from '../src/store/settings.ts'
import * as strategist from '../src/strategist/strategist.ts'
import type { Strategist } from '../src/strategist/strategist.ts'
import { snapshot } from './fixtures.ts'

const OPUS = 'claude-opus-5-5'
const SONNET = 'claude-sonnet-5-5'
const HAIKU = 'claude-haiku-5-5'
const FABLE = 'claude-fable-5-2'

type Choice = { model: string; effort: string; ignored: string[] }
const agentChoice = (strategist as unknown as { agentChoice?: (own: Partial<AgentSettings>, all: { model: string; effort: string }) => Choice }).agentChoice

test('PAM-1 an agent\'s own model and effort are settings of the agent: empty (same as all agents) by default and for an agent saved before they existed; only a model id or an effort of the list is taken', () => {
  const settings = DEFAULT_SETTINGS as unknown as Record<string, unknown>
  assert.equal(settings.aiModel, '', 'a new agent follows the all-agents model')
  assert.equal(settings.aiEffort, '', 'a new agent follows the all-agents effort')
  // An agent saved before the fields existed reads them empty: it plays exactly as before.
  const store = new Store('', ':memory:')
  store.addAgent(0, 'erd1x')
  const saved = { ...DEFAULT_SETTINGS } as Record<string, unknown>
  delete saved.aiModel
  delete saved.aiEffort
  store.db.prepare('UPDATE agents SET settings = ? WHERE idx = 0').run(JSON.stringify(saved))
  const read = store.agent(0)!.settings as unknown as Record<string, unknown>
  assert.deepEqual([read.aiModel, read.aiEffort], ['', ''])
  // The web UI's patch: empty, a model id or one of the five efforts; anything else is refused.
  assert.deepEqual(validateSettingsPatch({ aiModel: HAIKU, aiEffort: 'high' }), { aiModel: HAIKU, aiEffort: 'high' })
  assert.deepEqual(validateSettingsPatch({ aiModel: '', aiEffort: '' }), { aiModel: '', aiEffort: '' })
  for (const effort of strategist.EFFORTS) assert.deepEqual(validateSettingsPatch({ aiEffort: effort }), { aiEffort: effort })
  for (const bad of [{ aiModel: 7 }, { aiModel: null }, { aiModel: 'claude opus' }, { aiModel: 'x'.repeat(61) }, { aiModel: '<script>' }, { aiEffort: 'turbo' }, { aiEffort: 'HIGH' }, { aiEffort: 3 }, { aiEffort: null }]) {
    assert.throws(() => validateSettingsPatch(bad), /aiModel|aiEffort/, JSON.stringify(bad))
  }
})

test('PAM-2 the effective pair: its own model and effort where it has them, else the all-agents ones; an own value nobody knows is never used and says why; a model that left the list runs its successor, never a dearer one', () => {
  assert.equal(typeof agentChoice, 'function', 'strategist.ts exports agentChoice')
  const all = { model: OPUS, effort: 'high' }
  const choose = (own: Partial<AgentSettings>) => agentChoice!(own, all)
  // Absent: exactly the all-agents pair, as today.
  assert.deepEqual(choose({}), { model: OPUS, effort: 'high', ignored: [] })
  assert.deepEqual(choose({ aiModel: '', aiEffort: '' }), { model: OPUS, effort: 'high', ignored: [] })
  // Each field by itself.
  assert.deepEqual(choose({ aiModel: HAIKU, aiEffort: '' }), { model: HAIKU, effort: 'high', ignored: [] })
  assert.deepEqual(choose({ aiModel: '', aiEffort: 'low' }), { model: OPUS, effort: 'low', ignored: [] })
  assert.deepEqual(choose({ aiModel: SONNET, aiEffort: 'xhigh' }), { model: SONNET, effort: 'xhigh', ignored: [] })
  // Written by hand on the server: an id the list does not have, a name every object has, an effort nobody knows.
  for (const odd of ['gpt-oss', 'constructor', '__proto__', 'toString', 'claude-mystery-9']) {
    const c = choose({ aiModel: odd, aiEffort: 'low' })
    assert.deepEqual([c.model, c.effort], [OPUS, 'low'], `${odd}: the all-agents model, the own effort still holds`)
    assert.equal(c.ignored.length, 1)
    assert.match(c.ignored[0]!, new RegExp(`^its own model ${odd} is not on the list \\(claude-haiku-5-5, claude-sonnet-5-5, claude-opus-5-5, claude-fable-5-2\\): it plays the all-agents model ${OPUS}$`))
  }
  const turbo = choose({ aiModel: HAIKU, aiEffort: 'turbo' })
  assert.deepEqual([turbo.model, turbo.effort], [HAIKU, 'high'], 'Haiku 5.5 at the all-agents effort: never the all-agents model because of the effort')
  assert.deepEqual(turbo.ignored, ['its own effort turbo is not one of low, medium, high, xhigh, max: it plays the all-agents effort high'])
  // A typed value reaches the log only as what an id can hold.
  assert.match(choose({ aiModel: `bad\u001b[31m <x> ${'z'.repeat(100)}` }).ignored[0]!, /^its own model bad\?\?31m\?\?x\?\?z{47} is not on the list/)
  assert.deepEqual(choose({ aiModel: 42 as unknown as string }).model, OPUS)
  // A model that left the list runs its successor (the same tier, never dearer on any price), said once in the log.
  for (const [old, next] of Object.entries(strategist.SUCCESSORS)) {
    const c = choose({ aiModel: old })
    assert.equal(c.model, next, old)
    assert.deepEqual(c.ignored, [`its own model ${old} is no longer on the list: it plays its successor ${next}`])
  }
  // Never dearer than the all-agents fallback would be: under a Fable 5.2 all-agents pair an unknown effort keeps Haiku.
  assert.equal(agentChoice!({ aiModel: HAIKU, aiEffort: 'ultra' }, { model: FABLE, effort: 'max' }).model, HAIKU)
})

// ---- the service: one strategist per model, the effort per request ----

function testConfig(dir: string, model = SONNET): Config {
  return {
    mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: 'sk-ant-not-a-real-key-for-this-test-only', model, telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 12,
  } as Config
}

type Request = { model: string; system: { text: string; cache_control?: unknown }[]; messages: { role: string; content: string }[]; output_config: { effort: string }; max_tokens: number }
type Answer = (p: Request) => unknown
/** What Anthropic answers with a submit_plan call: 1,000 tokens in and 200 out, from the model asked. */
const planned = (p: Request, summary = `PLAN by ${p.model} at ${p.output_config.effort}`, actions: unknown[] = [{ type: 'sync' }]) => ({
  model: p.model, stop_reason: 'tool_use', usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  content: [{ type: 'tool_use', id: 't', name: 'submit_plan', input: { summary, actions: actions.map(action => ({ action, reason: 'because' })) } }],
})

type Inner = {
  shadows: Map<unknown, Promise<void>>
  shadowTimeoutMs: number
  shadowStrategistFor(model: string, effort: string): Strategist
  strategistFor(model: string): Strategist
  nextAt: Map<number, number>
  callExpectedWithinHour(now?: number, pair?: { model: string; effort: string }): boolean
  wallet(i: number): { address: string }
}

/**
 * A service with `agents` agents whose strategists, playing and shadow, all talk to one fake Anthropic client that
 * keeps every request; the executor is replaced by a recorder. `own` gives agents their own model and effort.
 */
async function service(o: { agents?: number; all?: string; own?: Record<number, { aiModel?: string; aiEffort?: string }>; answer?: Answer; shadowAnswer?: Answer } = {}) {
  const { Service } = await import('../src/service.ts')
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-pam-')), o.all))
  svc.ensureAgents()
  const inner = svc as unknown as Inner
  for (let i = 1; i < (o.agents ?? 1); i++) svc.store.addAgent(i, inner.wallet(i).address)
  for (const [i, own] of Object.entries(o.own ?? {})) svc.store.updateSettings(Number(i), own as Partial<AgentSettings>)
  const requests: Request[] = []
  const client = {
    beta: { messages: { stream: (p: Request) => ({ finalMessage: async () => {
      requests.push(p)
      const shadow = p.messages[0]!.content.includes('SHADOWTEST') // never: every request is a real plan's words
      return (shadow ? o.shadowAnswer : undefined)?.(p) ?? (o.answer ?? planned)(p)
    } }) } },
  }
  ;(svc.strategist as unknown as { client: unknown }).client = client
  // The service makes its strategists itself; only their connections are replaced.
  const connect = (s: Strategist) => ((s as unknown as { client: unknown }).client = client)
  for (const model of Object.keys(strategist.MODELS)) {
    if (typeof inner.strategistFor === 'function') connect(inner.strategistFor(model))
    connect(inner.shadowStrategistFor(model, 'medium'))
  }
  const ran: { index: number; types: string[] }[] = []
  Object.assign(svc as object, {
    schedule: () => undefined,
    notify: () => undefined,
    inActiveHours: () => true,
    waitingForFunds: () => null,
    retryPending: async () => undefined,
    noticeInvitations: async () => undefined,
    snapshot: async () => snapshot(),
    pause: async () => undefined,
  })
  ;(svc.executor as unknown as { run: unknown }).run = async (a: { index: number }, _w: unknown, _s: unknown, actions: PlannedAction[]) => {
    ran.push({ index: a.index, types: actions.map(p => p.action.type) })
    return actions.map(() => ({ status: 'dry_run', summary: 'DRY RUN ok' }))
  }
  const settled = async () => { await Promise.all([...(inner.shadows?.values() ?? [])]) }
  const shadowRows = () => svc.store.shadowPlans(null)
  return { svc, inner, requests, ran, settled, client, shadowRows }
}
const asked = (r: Request) => [r.model, r.output_config.effort, r.max_tokens]

test('PAM-3 each agent plans with its own model and effort, the others with the all-agents pair; one strategist per model, the effort per request; the spend is booked at the price of the model that answered', async () => {
  const m = await service({ agents: 4, own: { 0: { aiModel: HAIKU, aiEffort: 'high' }, 2: { aiEffort: 'low' }, 3: { aiModel: HAIKU, aiEffort: 'high' } } })
  assert.equal(typeof m.inner.strategistFor, 'function', 'the service picks a strategist per model')
  for (const i of [0, 1, 2, 3]) await m.svc.tick(i)
  assert.deepEqual(m.requests.map(asked), [[HAIKU, 'high', 32_000], [SONNET, 'medium', 16_000], [SONNET, 'low', 16_000], [HAIKU, 'high', 32_000]])
  // One object per model: both Haiku 5.5 agents share it, the all-agents model is the strategist the chat uses.
  assert.equal(m.inner.strategistFor(HAIKU), m.inner.strategistFor(HAIKU))
  assert.notEqual(m.inner.strategistFor(HAIKU), m.svc.strategist)
  assert.equal(m.inner.strategistFor(SONNET), m.svc.strategist)
  assert.deepEqual([m.svc.strategist!.model, m.svc.strategist!.effort], [SONNET, 'medium'], 'the all-agents pair is unchanged')
  // The bill: Haiku 5.5 twice (1,000 in and 200 out at $0.10 and $0.50), Sonnet 5.5 twice ($2 and $10).
  assert.ok(Math.abs(Number(m.svc.store.getKv('model_usd_total')) - (2 * 0.0002 + 2 * 0.004)) < 1e-12, m.svc.store.getKv('model_usd_total'))
  // Every agent ran its own plan.
  assert.deepEqual(m.ran.map(r => r.index), [0, 1, 2, 3])
  // The plan's cost line names the AI where it is not the all-agents one; the next request never reads that line.
  assert.match(m.svc.store.getKv('last_plan_0')!, /\nmodel cost \$0\.0002, Haiku 5\.5 at high effort \(cache read 0 tokens\)$/)
  assert.match(m.svc.store.getKv('last_plan_2')!, /\nmodel cost \$0\.0040, Sonnet 5\.5 at low effort \(cache read 0 tokens\)$/)
  assert.match(m.svc.store.getKv('last_plan_1')!, /\nmodel cost \$0\.0040 \(cache read 0 tokens\)$/, 'the all-agents pair: the line as before')
  await m.svc.tick(0)
  assert.doesNotMatch(m.requests.at(-1)!.messages[0]!.content, /Haiku|model cost/)
  // The all-agents switch moves the agents that follow it, and none with a model of its own.
  m.svc.setStrategist(OPUS, 'xhigh', 'test')
  for (const i of [0, 1, 2]) await m.svc.tick(i)
  assert.deepEqual(m.requests.slice(-3).map(asked), [[HAIKU, 'high', 32_000], [OPUS, 'xhigh', 48_000], [OPUS, 'low', 16_000]])
})

test('PAM-4 an own value the list does not know, written by hand on the server: the agent plays the all-agents one for it and the log says why once', async t => {
  const logged: string[] = []
  t.mock.method(console, 'log', (...a: unknown[]) => void logged.push(a.join(' ')))
  const m = await service({ agents: 2 })
  // Written past the web route's checks, as a hand-made database change would be.
  m.svc.store.updateSettings(0, { aiModel: 'gpt-oss', aiEffort: 'turbo' } as Partial<AgentSettings>)
  m.svc.store.updateSettings(1, { aiModel: HAIKU, aiEffort: 'ultra' } as Partial<AgentSettings>)
  for (let k = 0; k < 2; k++) for (const i of [0, 1]) await m.svc.tick(i)
  assert.deepEqual(m.requests.map(asked), [[SONNET, 'medium', 16_000], [HAIKU, 'medium', 16_000], [SONNET, 'medium', 16_000], [HAIKU, 'medium', 16_000]], 'never an unknown model, never a dearer one than its own')
  const said = (re: RegExp) => logged.filter(l => re.test(l)).length
  assert.equal(said(/agent 1: its own model gpt-oss is not on the list \([^)]*\): it plays the all-agents model claude-sonnet-5-5; its own effort turbo is not one of low, medium, high, xhigh, max: it plays the all-agents effort medium$/), 1, logged.join(' | '))
  assert.equal(said(/agent 2: its own effort ultra is not one of low, medium, high, xhigh, max: it plays the all-agents effort medium$/), 1, logged.join(' | '))
  // Corrected on the machine: it plays its own, and nothing more is said.
  logged.length = 0
  m.svc.store.updateSettings(0, { aiModel: HAIKU, aiEffort: 'low' })
  await m.svc.tick(0)
  assert.deepEqual(asked(m.requests.at(-1)!), [HAIKU, 'low', 16_000])
  assert.equal(said(/its own/), 0)
})

test('PAM-5 the game manual\'s cache belongs to one model and effort: warmth and "another call due within the hour" are counted for that pair only', async t => {
  // The strategist: the effort of each request, and the cache decision asked for that model and effort.
  const asks: string[][] = []
  let soon = true
  const s = new strategist.Strategist('test-key', OPUS, 'high', ((model: string, effort: string) => (asks.push([model, effort]), soon)) as () => boolean)
  const sent: Request[] = []
  ;(s as unknown as { client: unknown }).client = { beta: { messages: { stream: (p: Request) => ({ finalMessage: async () => (sent.push(p), { ...planned(p), usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 60_000 } }) }) } } }
  const plan = (s as unknown as { planFromRequest(r: string, c?: AbortSignal, effort?: string): Promise<unknown> }).planFromRequest.bind(s)
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  await plan('one', undefined, 'high')
  soon = false
  await plan('two', undefined, 'low')
  await plan('three', undefined, 'high')
  assert.deepEqual(sent.map(p => [p.output_config.effort, p.max_tokens, p.system[0]!.cache_control !== undefined]), [['high', 32_000, true], ['low', 16_000, false], ['high', 32_000, true]], 'warm at high, cold at low: another effort may not read that cache')
  assert.deepEqual(asks, [[OPUS, 'high'], [OPUS, 'low']], 'the schedule is asked for the pair of the request (a warm cache asks nothing)')
  assert.equal(s.effort, 'high', 'the strategist\'s own effort is untouched by a request at another one')

  // The service: from its schedule, for one pair at a time.
  const m = await service({ agents: 3, own: { 0: { aiModel: HAIKU, aiEffort: 'high' }, 1: { aiModel: HAIKU, aiEffort: 'low' } } })
  const now = Date.now()
  for (const i of [0, 1, 2]) m.svc.store.updateSettings(i, { activeHoursUtc: [0, 24], tickMinutes: 120, tickJitterMinutes: 10 })
  m.inner.nextAt.set(0, now + 30 * 60_000)
  m.inner.nextAt.set(1, now + 120 * 60_000)
  m.inner.nextAt.set(2, now + 120 * 60_000)
  const due = (model?: string, effort?: string) => m.inner.callExpectedWithinHour(now, model ? { model, effort: effort! } : undefined)
  assert.equal(due(), true, 'without a pair: any call, as before')
  assert.equal(due(HAIKU, 'high'), true, 'agent 1 plans on Haiku 5.5 at high in 30 minutes')
  assert.equal(due(HAIKU, 'low'), false, 'agent 2 plans on Haiku 5.5 at low only in 2 hours')
  assert.equal(due(SONNET, 'medium'), false, 'agent 3 follows the all-agents pair and plans in 2 hours')
  m.inner.nextAt.set(2, now + 20 * 60_000)
  assert.equal(due(SONNET, 'medium'), true)
  assert.equal(due(SONNET, 'high'), false)
  // Each strategist of the service asks for its own model and the effort of the request.
  const ask = (x: Strategist, model: string, effort: string) => (x as unknown as { expectsCallSoon(m: string, e: string): boolean }).expectsCallSoon(model, effort)
  assert.equal(ask(m.inner.strategistFor(HAIKU), HAIKU, 'high'), true)
  assert.equal(ask(m.inner.strategistFor(HAIKU), HAIKU, 'low'), false)
  assert.equal(ask(m.svc.strategist!, SONNET, 'medium'), true)
  m.inner.nextAt.set(0, now + 120 * 60_000)
  assert.equal(ask(m.inner.strategistFor(HAIKU), HAIKU, 'high'), false)
})
