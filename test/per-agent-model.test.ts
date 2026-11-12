// Per-agent AI models and per-agent shadow plans with an effort per shadow (the owner, 2026-11-13). The owner runs his
// ten agents on three models (Opus 5.5, Sonnet 5.5, Haiku 5.5, all at high) and on three test agents lets the same
// model plan in the shadow at other efforts. Each test was seen failing on cb1537f (one model and effort for every
// agent, one shadow list for every agent with one effort) for the reason its name gives.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Config } from '../src/config.ts'
import type { PlannedAction } from '../src/executor/actions.ts'
import { Store } from '../src/store/db.ts'
import { DEFAULT_SETTINGS, validateSettingsPatch, type AgentSettings } from '../src/store/settings.ts'
import * as strategist from '../src/strategist/strategist.ts'
import type { Strategist } from '../src/strategist/strategist.ts'
import { Sessions, hashPassword } from '../src/web/auth.ts'
import * as web from '../src/web/server.ts'
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
async function service(o: { agents?: number; all?: string; own?: Record<number, { aiModel?: string; aiEffort?: string }>; answer?: Answer } = {}) {
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
      return (o.answer ?? planned)(p)
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

// ---- shadow plans per agent, each entry with its own effort ----

type Choices = { models: string[]; effort: string; leftOut: string[] }
type ShadowModule = {
  shadowChoices: (store: Store, playing: string | { model: string; effort: string }, agentIndex?: number | null) => Choices
  shadowModelsSet: (store: Store, agentIndex?: number | null) => string[]
  shadowRuns?: (choices: Choices) => { model: string; effort: string }[]
}

test('PAM-6 the setting: an entry may carry its effort (model:effort); each agent may have its own list (shadow_model_agent_N); an entry with an effort rests only at that model and effort, one without rests at its model as before', async () => {
  const shadow = (await import('../src/strategist/shadow.ts')) as unknown as ShadowModule
  assert.equal(typeof shadow.shadowRuns, 'function', 'shadow.ts exports shadowRuns')
  const prev = [process.env.AGENT_SHADOW_MODEL, process.env.AGENT_SHADOW_EFFORT]
  delete process.env.AGENT_SHADOW_MODEL
  delete process.env.AGENT_SHADOW_EFFORT
  try {
    const store = new Store('', ':memory:')
    const runs = (playing: { model: string; effort: string }, index: number | null = null) => shadow.shadowRuns!(shadow.shadowChoices(store, playing, index))
    const opusHigh = { model: OPUS, effort: 'high' }
    // The owner's test on agent 7 (index 6): Opus 5.5 at three other efforts next to Opus 5.5 at high.
    store.setKv('shadow_model_agent_7', `${OPUS}:low,${OPUS}:medium,${OPUS}:xhigh`)
    assert.deepEqual(shadow.shadowChoices(store, opusHigh, 6), { models: [`${OPUS}:low`, `${OPUS}:medium`, `${OPUS}:xhigh`], effort: 'medium', leftOut: [] })
    assert.deepEqual(runs(opusHigh, 6), [{ model: OPUS, effort: 'low' }, { model: OPUS, effort: 'medium' }, { model: OPUS, effort: 'xhigh' }])
    assert.deepEqual(shadow.shadowModelsSet(store, 6), [`${OPUS}:low`, `${OPUS}:medium`, `${OPUS}:xhigh`])
    // The entry at the very model and effort that play rests; the same model at another effort runs.
    const atMedium = shadow.shadowChoices(store, { model: OPUS, effort: 'medium' }, 6)
    assert.deepEqual(atMedium.models, [`${OPUS}:low`, `${OPUS}:xhigh`])
    assert.deepEqual(atMedium.leftOut, [`${OPUS}:medium is the model and effort that play, and a shadow plan needs another model or effort`])
    // The other agents follow the all-agents list: none is set.
    for (const i of [null, 0, 5, 7]) assert.deepEqual(shadow.shadowChoices(store, opusHigh, i), { models: [], effort: 'medium', leftOut: [] }, String(i))
    store.setKv('shadow_model', HAIKU)
    assert.deepEqual(runs(opusHigh, 0), [{ model: HAIKU, effort: 'medium' }], 'agent 1 follows the all-agents list')
    assert.deepEqual(runs(opusHigh, 6).map(r => r.effort), ['low', 'medium', 'xhigh'], 'agent 7 has its own list, the all-agents one does not add to it')
    // "off" for one agent: none for it, whatever the all-agents list says; blank: it follows the all-agents list.
    store.setKv('shadow_model_agent_1', 'off')
    assert.deepEqual(runs(opusHigh, 0), [])
    assert.deepEqual(shadow.shadowModelsSet(store, 0), [])
    for (const blank of ['', '   ']) {
      store.setKv('shadow_model_agent_1', blank)
      assert.deepEqual(runs(opusHigh, 0), [{ model: HAIKU, effort: 'medium' }], JSON.stringify(blank))
    }
    // An entry without an effort takes shadow_effort, as before; one with an effort keeps it.
    store.setKv('shadow_effort', 'low')
    store.setKv('shadow_model_agent_2', `${HAIKU}, ${SONNET}:max`)
    assert.deepEqual(runs(opusHigh, 1), [{ model: HAIKU, effort: 'low' }, { model: SONNET, effort: 'max' }])
    // An entry without an effort still rests at its model whatever the effort: the settings of before run as before.
    assert.deepEqual(shadow.shadowChoices(store, { model: HAIKU, effort: 'xhigh' }, 1).leftOut, [`${HAIKU} is the model that plays, and a shadow plan needs another one`])
    // An effort nobody knows: the entry is left out with its reason (never run at a guessed effort); the others run.
    store.setKv('shadow_model_agent_3', `${OPUS}:turbo, ${OPUS}:HIGH, ${OPUS}:, gpt-oss:low, ${HAIKU}:low`)
    const odd = shadow.shadowChoices(store, { model: SONNET, effort: 'high' }, 2)
    assert.deepEqual(odd.models, [`${HAIKU}:low`])
    assert.deepEqual(odd.leftOut, [
      `${OPUS}:turbo has an effort that is not one of low, medium, high, xhigh, max`,
      `${OPUS}:HIGH has an effort that is not one of low, medium, high, xhigh, max`,
      `${OPUS}: has an effort that is not one of low, medium, high, xhigh, max`,
      'gpt-oss:low is not a model on the list (claude-haiku-5-5, claude-sonnet-5-5, claude-opus-5-5, claude-fable-5-2)',
    ])
    assert.deepEqual(shadow.shadowModelsSet(store, 2), [`${HAIKU}:low`], 'the web rule reads the entries that can run')
    // A repeated pair counts once, said nowhere: written twice, or once with and once without the effort shadow_effort gives.
    store.setKv('shadow_model_agent_4', `${HAIKU}:low, ${HAIKU}:low ,${HAIKU},${OPUS}:high,${OPUS}:high`)
    assert.deepEqual(shadow.shadowChoices(store, { model: SONNET, effort: 'high' }, 3), { models: [`${HAIKU}:low`, `${OPUS}:high`], effort: 'low', leftOut: [] })
    // "off" anywhere in an agent's list switches all of it off; at most 16 entries are read.
    store.setKv('shadow_model_agent_5', `${HAIKU}:low, off`)
    assert.deepEqual(runs(opusHigh, 4), [])
    store.setKv('shadow_model_agent_6', [...Array.from({ length: 20 }, (_v, i) => `nope-${i}:low`), `${HAIKU}:low`].join(','))
    const many = shadow.shadowChoices(store, opusHigh, 5)
    assert.deepEqual(many.models, [])
    assert.equal(many.leftOut.at(-1), '5 more entries are not read (16 at most)')
    // The all-agents list takes efforts too.
    store.setKv('shadow_model', `${SONNET}:low, ${SONNET}`)
    store.setKv('shadow_effort', 'medium')
    assert.deepEqual(runs({ model: SONNET, effort: 'low' }, 9), [], 'Sonnet 5.5 at low plays: both entries rest')
    assert.deepEqual(runs({ model: OPUS, effort: 'low' }, 9), [{ model: SONNET, effort: 'low' }, { model: SONNET, effort: 'medium' }])
    // The settings of before read byte for byte as before, with the playing model given alone (no effort known).
    store.setKv('shadow_model', `${HAIKU}, ${OPUS}`)
    assert.deepEqual(shadow.shadowChoices(store, SONNET), { models: [HAIKU, OPUS], effort: 'medium', leftOut: [] })
    assert.deepEqual(shadow.shadowChoices(store, OPUS), { models: [HAIKU], effort: 'medium', leftOut: [`${OPUS} is the model that plays, and a shadow plan needs another one`] })
    assert.deepEqual(shadow.shadowModelsSet(store), [HAIKU, OPUS])
  } finally {
    for (const [i, k] of (['AGENT_SHADOW_MODEL', 'AGENT_SHADOW_EFFORT'] as const).entries()) {
      if (prev[i] === undefined) delete process.env[k]
      else process.env[k] = prev[i]
    }
  }
})

test('PAM-7 in the service: an agent with its own list asks the same model at three other efforts, each by itself with its own row and cost; the guard is per agent, model and effort; another agent asks nothing', async () => {
  const hang = new Set<string>()
  const m = await service({ agents: 3, own: { 0: { aiModel: OPUS, aiEffort: 'high' } }, answer: p => (hang.has(`${p.model}:${p.output_config.effort}`) ? new Promise(() => undefined) : planned(p)) })
  m.inner.shadowTimeoutMs = 60_000
  m.svc.store.setKv('shadow_model_agent_1', `${OPUS}:low,${OPUS}:medium,${OPUS}:xhigh`)
  try {
    await m.svc.tick(0)
    await m.settled()
    assert.deepEqual(m.requests.map(asked), [[OPUS, 'high', 32_000], [OPUS, 'low', 16_000], [OPUS, 'medium', 16_000], [OPUS, 'xhigh', 48_000]])
    // The real plan's words, word for word, to each.
    for (const r of m.requests.slice(1)) assert.deepEqual(r.messages, m.requests[0]!.messages)
    // One shadow strategist for the model, its own connection apart from the playing one; the effort goes per request.
    assert.equal(m.inner.shadowStrategistFor(OPUS, 'low'), m.inner.shadowStrategistFor(OPUS, 'xhigh'))
    assert.notEqual(m.inner.shadowStrategistFor(OPUS, 'low'), m.inner.strategistFor(OPUS))
    // Only the real plan's actions ran.
    assert.deepEqual(m.ran, [{ index: 0, types: ['sync'] }])
    // A row and a record per shadow plan, next to the real plan's model and effort.
    const kept = m.shadowRows()
    assert.deepEqual(kept.map(k => [k.agentIndex, k.realModel, k.realEffort, k.shadowModel, k.shadowEffort, k.outcome]).sort(), [
      [0, OPUS, 'high', OPUS, 'low', 'plan'], [0, OPUS, 'high', OPUS, 'medium', 'plan'], [0, OPUS, 'high', OPUS, 'xhigh', 'plan'],
    ])
    assert.deepEqual(m.svc.store.activity(0, 20).filter(r => r.kind === 'shadow').map(r => r.summary.match(/^shadow plan by [^,]+, \$[\d.]+/)?.[0]).sort(), ['shadow plan by Opus 5.5 (low), $0.0080', 'shadow plan by Opus 5.5 (medium), $0.0080', 'shadow plan by Opus 5.5 (xhigh), $0.0080'])
    // The bill: the real plan and each shadow plan at Opus 5.5's price.
    assert.ok(Math.abs(Number(m.svc.store.getKv('model_usd_total')) - 4 * 0.008) < 1e-12, m.svc.store.getKv('model_usd_total'))
    // Another agent follows the all-agents list, which is off: one request, no shadow.
    const before = m.requests.length
    await m.svc.tick(1)
    await m.settled()
    assert.deepEqual(m.requests.slice(before).map(asked), [[SONNET, 'medium', 16_000]])
    // The guard: Opus 5.5 at low still on its way holds back only its own next shadow plan, not medium or xhigh.
    hang.add(`${OPUS}:low`)
    await m.svc.tick(0)
    await new Promise(r => setTimeout(r, 30))
    const second = m.requests.length
    await m.svc.tick(0)
    await new Promise(r => setTimeout(r, 30))
    assert.deepEqual(m.requests.slice(second).map(asked), [[OPUS, 'high', 32_000], [OPUS, 'medium', 16_000], [OPUS, 'xhigh', 48_000]], 'low is still on its way: not asked again')
    // Nor another agent's same pair: agent 3 with its own list asks Opus 5.5 at low too... and hangs on it by itself.
    m.svc.store.setKv('shadow_model_agent_3', `${OPUS}:low`)
    const third = m.requests.length
    await m.svc.tick(2)
    await new Promise(r => setTimeout(r, 30))
    assert.deepEqual(m.requests.slice(third).map(asked), [[SONNET, 'medium', 16_000], [OPUS, 'low', 16_000]])
    // The cache rule counts the shadow pairs of an agent that is due, beside its real plan.
    const now = Date.now()
    for (const i of [0, 1, 2]) m.svc.store.updateSettings(i, { activeHoursUtc: [0, 24], tickMinutes: 120, tickJitterMinutes: 10 })
    m.inner.nextAt.set(0, now + 30 * 60_000)
    m.inner.nextAt.set(1, now + 120 * 60_000)
    m.inner.nextAt.set(2, now + 120 * 60_000)
    for (const effort of ['high', 'low', 'medium', 'xhigh']) assert.equal(m.inner.callExpectedWithinHour(now, { model: OPUS, effort }), true, effort)
    assert.equal(m.inner.callExpectedWithinHour(now, { model: OPUS, effort: 'max' }), false)
    assert.equal(m.inner.callExpectedWithinHour(now, { model: SONNET, effort: 'medium' }), false)
  } finally {
    await m.svc.stop()
  }
})

// ---- the password rule (AGENTS.md rule 7) per agent and per model and effort ----

type Pair = { model: string; effort: string }
const webRules = web as unknown as {
  wakesShadow: (shadows: readonly string[], current: string | Pair, next: string | Pair) => boolean
}

test('PAM-8 wakesShadow reads model and effort: an entry with an effort wakes when its pair stops playing, also on a lower effort; one without wakes only when its model stops playing', () => {
  const wakes = webRules.wakesShadow
  const at = (model: string, effort: string): Pair => ({ model, effort })
  assert.equal(wakes([`${OPUS}:high`], at(OPUS, 'high'), at(OPUS, 'medium')), true, 'less effort, but the Opus 5.5 high shadow starts')
  assert.equal(wakes([`${OPUS}:high`], at(OPUS, 'medium'), at(OPUS, 'high')), false, 'it goes to rest')
  assert.equal(wakes([`${OPUS}:high`], at(OPUS, 'high'), at(SONNET, 'high')), true, 'another model')
  assert.equal(wakes([`${OPUS}:low`, `${OPUS}:medium`], at(OPUS, 'high'), at(OPUS, 'xhigh')), false, 'both ran before and run after')
  assert.equal(wakes([OPUS], at(OPUS, 'high'), at(OPUS, 'low')), false, 'an entry without an effort: the effort alone never wakes it')
  assert.equal(wakes([OPUS], at(OPUS, 'high'), at(HAIKU, 'high')), true)
  assert.equal(wakes([], at(OPUS, 'high'), at(HAIKU, 'low')), false)
  assert.equal(wakes([`${OPUS}:low`], at('claude-opus-5', 'low'), at(HAIKU, 'low')), true, 'a playing model that left the list counts as its successor')
  // The form of before: models alone.
  assert.equal(wakes([FABLE], FABLE, HAIKU), true)
  assert.equal(wakes([FABLE], FABLE, FABLE), false)
})

/** A service with the web UI on a free port, timers off and a signed-in session. */
async function webService(o: { agents?: number; all?: string } = {}) {
  const { Service } = await import('../src/service.ts')
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-pam-web-')), o.all))
  svc.ensureAgents()
  for (let i = 1; i < (o.agents ?? 1); i++) svc.store.addAgent(i, (svc as unknown as Inner).wallet(i).address)
  ;(svc as unknown as { schedule: unknown }).schedule = () => undefined
  svc.notify = () => undefined
  const password = 'correct-horse-battery'
  const creds = { username: 'admin', passwordHash: hashPassword(password), secretKey: 'k'.repeat(64) }
  const server = web.startWeb(svc, creds, 0)
  if (!server.listening) await once(server, 'listening')
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const sessions = new Sessions(creds.secretKey, creds.passwordHash)
  const cookie = sessions.issue('admin')
  const post = (path: string, body: unknown) => fetch(`${url}${path}`, { method: 'POST', headers: { cookie: `foxagent_session=${cookie}`, origin: url, 'x-csrf-token': sessions.csrfFor(cookie), 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const state = async () => (await (await fetch(`${url}/api/state`, { headers: { cookie: `foxagent_session=${cookie}` } })).json()) as Record<string, unknown> & { instance: Record<string, unknown>; agents: (Record<string, unknown> & { index: number; settings: AgentSettings })[] }
  const own = (i: number) => [svc.store.agent(i)!.settings.aiModel, svc.store.agent(i)!.settings.aiEffort]
  return { svc, server, password, post, state, own }
}

test('PAM-9 an agent\'s own model or effort: dearer or higher needs the password, cheaper or lower is one click, back to "same as all agents" counts by the pair it lands on; a switch that starts this agent\'s shadow plans asks too', async () => {
  const { svc, server, password, post, own } = await webService({ agents: 2 })
  const set = (i: number, body: Record<string, unknown>) => post(`/api/agents/${i}/settings`, body)
  try {
    assert.deepEqual([svc.strategist!.model, svc.strategist!.effort], [SONNET, 'medium'])
    // Dearer than the all-agents Sonnet 5.5 it plays now: the password.
    let res = await set(0, { aiModel: OPUS })
    assert.equal(res.status, 403, 'Opus 5.5 for one agent was switched on with one click')
    assert.deepEqual(own(0), ['', ''])
    res = await set(0, { aiModel: OPUS, password: 'wrong' })
    assert.equal(res.status, 403)
    res = await set(0, { aiModel: OPUS, password })
    assert.equal(res.status, 200, await res.text())
    assert.deepEqual(own(0), [OPUS, ''])
    // Cheaper: one click. The same values again: nothing changes, no password.
    res = await set(0, { aiModel: HAIKU })
    assert.equal(res.status, 200, await res.text())
    res = await set(0, { aiModel: HAIKU, aiEffort: '' })
    assert.equal(res.status, 200, await res.text())
    // A higher effort than the one it plays: the password; a lower one: one click.
    res = await set(0, { aiEffort: 'high' })
    assert.equal(res.status, 403, 'a higher effort for one agent was switched on with one click')
    res = await set(0, { aiEffort: 'high', password })
    assert.equal(res.status, 200, await res.text())
    res = await set(0, { aiEffort: 'low' })
    assert.equal(res.status, 200, await res.text())
    assert.deepEqual(own(0), [HAIKU, 'low'])
    // Back to the all-agents model: from Haiku 5.5 it lands on Sonnet 5.5, dearer: the password.
    res = await set(0, { aiModel: '' })
    assert.equal(res.status, 403, 'back to "same as all agents" landed on a dearer model with one click')
    res = await set(0, { aiModel: '', password })
    assert.equal(res.status, 200, await res.text())
    // From Fable 5.2 it lands on the cheaper Sonnet 5.5: one click.
    assert.equal((await set(0, { aiModel: FABLE, password })).status, 200)
    res = await set(0, { aiModel: '' })
    assert.equal(res.status, 200, await res.text())
    // Effort back to the all-agents medium from low: higher, the password.
    res = await set(0, { aiEffort: '' })
    assert.equal(res.status, 403)
    // Never a model the list does not have, nor an effort nobody knows, with or without the password.
    for (const body of [{ aiModel: 'claude-sonnet-5' }, { aiModel: 'gpt-oss' }, { aiModel: 'constructor' }, { aiEffort: 'turbo' }, { aiModel: 'local' }]) {
      res = await set(0, { ...body, password })
      assert.equal(res.status, 400, JSON.stringify(body))
    }
    assert.deepEqual(own(0), ['', 'low'])
    // The shadow plans of this agent (its own list, set on the machine). Sonnet 5.5 at high rests while it plays it.
    svc.store.setKv('shadow_model_agent_2', `${SONNET}:high`)
    assert.equal((await set(1, { aiEffort: 'high', password })).status, 200)
    res = await set(1, { aiEffort: 'low' })
    assert.equal(res.status, 403, 'less effort, but every plan of agent 2 would also pay for a Sonnet 5.5 shadow plan at high')
    res = await set(1, { aiEffort: 'low', password })
    assert.equal(res.status, 200, await res.text())
    res = await set(1, { aiModel: HAIKU })
    assert.equal(res.status, 200, 'the shadow ran before and runs after, and Haiku 5.5 is cheaper: one click')
    // Another agent's list is not this agent's: agent 1 follows the all-agents list, which is off.
    res = await set(0, { aiModel: HAIKU })
    assert.equal(res.status, 200, await res.text())
    // The all-agents list counts for an agent that has none of its own: Fable 5.2 rests while agent 1 plays it.
    svc.store.setKv('shadow_model', FABLE)
    assert.equal((await set(0, { aiModel: FABLE, aiEffort: 'low', password })).status, 200)
    res = await set(0, { aiModel: OPUS })
    assert.equal(res.status, 403, 'cheaper than Fable 5.2, but it wakes the Fable 5.2 shadow')
    // Other settings saved at the same time are judged as before.
    res = await set(0, { aiModel: FABLE, aiEffort: 'low', dailyCapUsd: 1 })
    assert.equal(res.status, 200, await res.text())
  } finally {
    server.close()
  }
})

test('PAM-10 the all-agents switch looks at what it changes: agents with their own model or effort are not moved by it, so their shadow plans do not count; a dearer all-agents pair still asks as before', async () => {
  const { svc, server, password, post } = await webService({ agents: 2 })
  const switchTo = (model: string, effort: string, pw?: string) => post('/api/strategist', { model, effort, ...(pw ? { password: pw } : {}) })
  try {
    svc.store.setKv('shadow_model', FABLE)
    svc.setStrategist(FABLE, 'medium', 'test')
    // Every agent plays its own model: the Fable 5.2 shadow rests for none of them and runs before and after.
    for (const i of [0, 1]) svc.store.updateSettings(i, { aiModel: OPUS, aiEffort: 'high' })
    let res = await switchTo(HAIKU, 'medium')
    assert.equal(res.status, 200, `no agent follows the all-agents model, so nothing wakes: ${await res.text()}`)
    // One agent follows it again: the switch away from Fable 5.2 wakes the shadow for that agent.
    svc.setStrategist(FABLE, 'medium', 'test')
    svc.store.updateSettings(1, { aiModel: '', aiEffort: '' })
    res = await switchTo(HAIKU, 'medium')
    assert.equal(res.status, 403, 'agent 2 follows Fable 5.2 and its Fable 5.2 shadow would wake')
    // It follows the model only: its own effort does not keep it out of a model switch.
    svc.store.updateSettings(1, { aiEffort: 'low' })
    res = await switchTo(HAIKU, 'medium')
    assert.equal(res.status, 403)
    res = await switchTo(HAIKU, 'medium', password)
    assert.equal(res.status, 200, await res.text())
    // A dearer all-agents pair asks as before, even with every agent on its own model: it is also the chat's model.
    for (const i of [0, 1]) svc.store.updateSettings(i, { aiModel: OPUS, aiEffort: 'high' })
    res = await switchTo(FABLE, 'medium')
    assert.equal(res.status, 403)
    // An entry with an effort: less effort for every agent that follows, and the entry at high wakes.
    svc.store.setKv('shadow_model', `${SONNET}:high`)
    for (const i of [0, 1]) svc.store.updateSettings(i, { aiModel: '', aiEffort: '' })
    svc.setStrategist(SONNET, 'high', 'test')
    res = await switchTo(SONNET, 'medium')
    assert.equal(res.status, 403, 'less effort, but the Sonnet 5.5 shadow at high would start on every plan')
    res = await switchTo(SONNET, 'medium', password)
    assert.equal(res.status, 200, await res.text())
    // Every agent with its own effort: the all-agents effort moves nobody, one click.
    for (const i of [0, 1]) svc.store.updateSettings(i, { aiEffort: 'medium' })
    svc.setStrategist(SONNET, 'high', 'test')
    res = await switchTo(SONNET, 'low')
    assert.equal(res.status, 200, await res.text())
  } finally {
    server.close()
  }
})

test('PAM-11 /api/state: each agent\'s AI (the pair it plays, its own values, its shadow entries) and how many agents have their own; shadowModels keeps what an open older page reads', async () => {
  const { svc, server, state } = await webService({ agents: 3 })
  try {
    svc.store.updateSettings(0, { aiModel: HAIKU, aiEffort: 'high' })
    svc.store.updateSettings(2, { aiModel: 'gpt-oss', aiEffort: 'low' } as Partial<AgentSettings>)
    svc.store.setKv('shadow_model', `${OPUS}:low, ${FABLE}`)
    svc.store.setKv('shadow_model_agent_1', `${HAIKU}:low,${HAIKU}:xhigh`)
    const s = await state()
    const ai = s.agents.map(b => b.ai)
    assert.deepEqual(ai[0], { model: HAIKU, effort: 'high', own: { model: HAIKU, effort: 'high' }, ignored: [], shadows: [`${HAIKU}:low`, `${HAIKU}:xhigh`], ownShadows: true })
    assert.deepEqual(ai[1], { model: SONNET, effort: 'medium', own: { model: null, effort: null }, ignored: [], shadows: [`${OPUS}:low`, FABLE], ownShadows: false })
    const third = ai[2] as { model: string; effort: string; own: unknown; ignored: string[] }
    assert.deepEqual([third.model, third.effort, third.own], [SONNET, 'low', { model: null, effort: 'low' }], 'an own model nobody knows is not shown as its own')
    assert.match(third.ignored[0]!, /^its own model gpt-oss is not on the list/)
    assert.equal(s.instance.ownAi, 2, 'agents 1 and 3 have an own model or effort in use')
    // An open page of the version before reads shadowModels as model ids: the all-agents list's, each once.
    assert.deepEqual(s.instance.shadowModels, [OPUS, FABLE])
  } finally {
    server.close()
  }
})

// ---- shadow-report per model and effort ----

type Row = Parameters<Store['addShadowPlan']>[0]
const ok = (type: string) => ({ ok: true, type, action: { type }, reason: 'r' })
const row = (more: Partial<Row> = {}): Row => ({
  agentIndex: 6, realModel: OPUS, realEffort: 'high', shadowModel: OPUS, shadowEffort: 'low', outcome: 'plan',
  real: { summary: 'REAL sync and a casual game', actions: [ok('sync'), ok('play_match')], usd: 0.2, servedBy: OPUS },
  shadow: { summary: 'SHADOW sync', actions: [ok('sync')] },
  inputTokens: 90_000, outputTokens: 2_000, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0.01, ms: 10_000, ...more,
})

test('PAM-12 shadow-report: the numbers once per model and effort, labelled "Opus 5.5 (low)"; each real plan with its model and effort and its shadow plans at every effort below it; per agent', async () => {
  const { shadowReport } = await import('../src/strategist/shadow.ts')
  const store = new Store('', ':memory:')
  const add = (at: string, more: Partial<Row>) => {
    const id = store.addShadowPlan(row(more))
    store.db.prepare('UPDATE shadow_plans SET at = ? WHERE id = ?').run(`2026-11-13T${at}:07.000Z`, id)
  }
  // Agent 7 on Opus 5.5 at high, two plans, each with Opus 5.5 at xhigh, low and medium (recorded in the order they answered).
  for (const [at, real] of [['10:00', 'REAL sync and a casual game'], ['11:00', 'REAL nothing to do']] as const) {
    const r = { summary: real, actions: real.includes('sync') ? [ok('sync'), ok('play_match')] : [], usd: 0.2, servedBy: OPUS }
    add(at, { real: r, shadowEffort: 'xhigh', usd: 0.03, ms: 40_000, shadow: { summary: 'SHADOW xhigh bids', actions: [ok('bid'), ok('sync')] } })
    add(at, { real: r, shadowEffort: 'low', usd: 0.005, ms: 6_000 })
    add(at, { real: r, shadowEffort: 'medium', usd: 0.01, ms: 12_000, ...(at === '11:00' ? { outcome: 'timeout' as const, shadow: { summary: '', actions: [] }, usd: 0, ms: 600_000 } : {}) })
  }
  // Agent 1 on Sonnet 5.5 at high with Sonnet 5.5 at low, in the same report for all agents.
  add('11:30', { agentIndex: 0, realModel: SONNET, shadowModel: SONNET, shadowEffort: 'low', usd: 0.002 })
  const text = shadowReport(store.shadowPlans(6), { agentIndex: 6, last: 2 })
  assert.deepEqual(text.split('\n'), [
    'Shadow plans (agent 7): 6 by 3 shadow pairs (model and effort), from 2026-11-13 10:00 to 2026-11-13 11:00 UTC',
    '',
    'Opus 5.5 (low): 2 shadow plans',
    'Models: Opus 5.5 (low) next to Opus 5.5 (high)',
    'With a valid tool call: 2 of 2',
    'Actions proposed by the shadow: 2, of which 2 parsed',
    'Same action types as the real plan of the same tick: 0 of 2',
    'Average cost: $0.0050 a shadow plan ($0.01 in all); the real plans of the same ticks: $0.2000 each',
    'Average time: 6 s over the 2 that answered',
    '',
    'Opus 5.5 (medium): 2 shadow plans',
    'Models: Opus 5.5 (medium) next to Opus 5.5 (high)',
    'With a valid tool call: 1 of 2 (1 no answer in time)',
    'Actions proposed by the shadow: 1, of which 1 parsed',
    'Same action types as the real plan of the same tick: 0 of 1',
    'Average cost: $0.0050 a shadow plan ($0.01 in all); the real plans of the same ticks: $0.2000 each',
    'Average time: 12 s over the 1 that answered',
    '',
    'Opus 5.5 (xhigh): 2 shadow plans',
    'Models: Opus 5.5 (xhigh) next to Opus 5.5 (high)',
    'With a valid tool call: 2 of 2',
    'Actions proposed by the shadow: 4, of which 4 parsed',
    'Same action types as the real plan of the same tick: 0 of 2',
    'Average cost: $0.0300 a shadow plan ($0.06 in all); the real plans of the same ticks: $0.2000 each',
    'Average time: 40 s over the 2 that answered',
    '',
    'A shadow plan is judged by reading it: nothing here says which plan was the better one.',
    '',
    'The last 2:',
    '2026-11-13 11:00 agent 7',
    '  real   Opus 5.5 (high): no actions',
    '         REAL nothing to do',
    '  shadow Opus 5.5 (low), $0.0050, 6 s: sync',
    '         SHADOW sync',
    '  shadow Opus 5.5 (medium), $0.0000, 600 s: no answer in time',
    '         ',
    '  shadow Opus 5.5 (xhigh), $0.0300, 40 s: bid, sync',
    '         SHADOW xhigh bids',
    '2026-11-13 10:00 agent 7',
    '  real   Opus 5.5 (high): sync, play_match',
    '         REAL sync and a casual game',
    '  shadow Opus 5.5 (low), $0.0050, 6 s: sync',
    '         SHADOW sync',
    '  shadow Opus 5.5 (medium), $0.0100, 12 s: sync',
    '         SHADOW sync',
    '  shadow Opus 5.5 (xhigh), $0.0300, 40 s: bid, sync',
    '         SHADOW xhigh bids',
  ])
  // All agents: one block per model and effort, the models of the list first, the efforts from the least.
  const all = shadowReport(store.shadowPlans(null), { agentIndex: null }).split('\n')
  assert.equal(all[0], 'Shadow plans (all agents): 7 by 4 shadow pairs (model and effort), from 2026-11-13 10:00 to 2026-11-13 11:30 UTC')
  assert.deepEqual(all.filter(l => / shadow plans?$/.test(l)), ['Sonnet 5.5 (low): 1 shadow plan', 'Opus 5.5 (low): 2 shadow plans', 'Opus 5.5 (medium): 2 shadow plans', 'Opus 5.5 (xhigh): 2 shadow plans'])
  assert.ok(all.includes('  real   Sonnet 5.5 (high): sync, play_match'))
  // One model at one effort, as before: the report reads as it did.
  assert.match(shadowReport(store.shadowPlans(0), { agentIndex: 0 }), /^Shadow plans \(agent 1\): 1, from [^\n]+ UTC\nModels: Sonnet 5\.5 \(low\) next to Sonnet 5\.5 \(high\)\n/)
})

// ---- where the model is shown and set: the CLI, Telegram ----

const REPO = resolve(import.meta.dirname, '..')

test('PAM-13 cli model: shows each agent\'s AI and shadow entries, and sets an agent\'s own model and effort on the machine (no password, like every server-side setting); never a value the list does not have', () => {
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-pam-cli-'))
  const env = { PATH: process.env.PATH!, HOME: dir, AGENT_ENV_FILE: join(dir, 'no-such.env'), AGENT_DATA_DIR: dir, MVX_GATEWAY_URL: 'http://127.0.0.1:9', MVX_API_URL: 'http://127.0.0.1:9', FOXLEAGUE_URL: 'http://127.0.0.1:9' }
  const cli = (...args: string[]) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(REPO, 'src/cli.ts'), 'model', ...args], { env, cwd: dir, encoding: 'utf8', timeout: 90_000 })
  const store = new Store(dir) // the running service's connection
  for (const i of [0, 1, 2]) store.addAgent(i, `erd1agent${i}`)
  store.setKv('shadow_model_agent_3', `${SONNET}:low,${SONNET}:xhigh`)
  let r = cli('2', HAIKU, 'high')
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout.trim(), 'agent 2 plays Haiku 5.5 at high effort from its next plan (its own model and its own effort)')
  assert.deepEqual([store.agent(1)!.settings.aiModel, store.agent(1)!.settings.aiEffort], [HAIKU, 'high'])
  assert.match(store.activity(1, 5)[0]!.summary, /^AI model and effort Haiku 5\.5 at high effort \(CLI\)$/)
  r = cli('3', 'same', 'xhigh')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual([store.agent(2)!.settings.aiModel, store.agent(2)!.settings.aiEffort], ['', 'xhigh'])
  r = cli()
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.stdout.trim().split('\n'), [
    'all agents: Sonnet 5.5 at medium effort (the Strategist box)',
    'agent 1: Sonnet 5.5 at medium effort (same as all agents)',
    'agent 2: Haiku 5.5 at high effort (its own model and its own effort)',
    `agent 3: Sonnet 5.5 at xhigh effort (its own effort); shadow plans by ${SONNET}:low, ${SONNET}:xhigh (its own list)`,
  ])
  r = cli('2')
  assert.equal(r.stdout.trim(), 'agent 2: Haiku 5.5 at high effort (its own model and its own effort)')
  // Back to the all-agents pair.
  r = cli('2', 'same', 'same')
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout.trim(), 'agent 2 plays Sonnet 5.5 at medium effort from its next plan (same as all agents)')
  assert.deepEqual([store.agent(1)!.settings.aiModel, store.agent(1)!.settings.aiEffort], ['', ''])
  // Refused, and nothing written.
  for (const [args, why] of [[['2', 'gpt-oss', 'high'], /unknown model gpt-oss/], [['2', 'claude-sonnet-5', 'high'], /unknown model claude-sonnet-5/], [['2', HAIKU, 'turbo'], /unknown effort turbo/], [['2', HAIKU], /usage|model <N>/], [['9', HAIKU, 'high'], /no agent 9/]] as const) {
    r = cli(...args)
    assert.notEqual(r.status, 0, args.join(' '))
    assert.match(r.stderr + r.stdout, why, args.join(' '))
  }
  assert.deepEqual([store.agent(1)!.settings.aiModel, store.agent(1)!.settings.aiEffort], ['', ''])
  assert.equal(store.agent(8), undefined, 'no agent was added')
  const usage = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(REPO, 'src/cli.ts')], { env, cwd: dir, encoding: 'utf8', timeout: 90_000 })
  assert.match(usage.stdout, /model \[N\] \[<model>\|same <effort>\|same\]\s+each agent's AI model and effort/)
})

test('PAM-14 Telegram /status and the start message show an agent\'s model and effort where they are not the all-agents ones', async () => {
  const m = await service({ agents: 3, own: { 1: { aiModel: HAIKU, aiEffort: 'high' }, 2: { aiEffort: 'low' } } })
  const lines = (await m.svc.command('status', [], '')).split('\n')
  assert.match(lines[0]!, /strategist claude-sonnet-5-5 \(medium\)/)
  assert.match(lines[1]!, /^agent 1 erd1\w+$/, 'the all-agents pair: nothing added')
  assert.match(lines[2]!, /^agent 2 erd1\w+ · Haiku 5\.5 at high$/)
  assert.match(lines[3]!, /^agent 3 erd1\w+ · Sonnet 5\.5 at low$/)
  // The start message lists the agents with the same words.
  const src = readFileSync(join(REPO, 'src/service.ts'), 'utf8')
  const start = src.slice(src.indexOf('  async start(): Promise<void> {'), src.indexOf('  private schedule('))
  assert.match(start, /agents\.map\(b => `\$\{agentName\(b\.index\)\} \$\{b\.address\}\$\{b\.paused \? ' paused' : ''\}\$\{this\.aiNote\(b\)\}`\)/)
})

test('PAM-15 an agent deleted for good takes its own shadow list with it: a new agent with its number starts without one', () => {
  const store = new Store('', ':memory:')
  for (const i of [0, 1]) store.addAgent(i, `erd1agent${i}`)
  store.setKv('shadow_model_agent_2', `${OPUS}:low`)
  store.setKv('shadow_model_agent_1', `${HAIKU}:low`)
  store.deleteAgent(1, 'test')
  assert.equal(store.getKv('shadow_model_agent_2'), undefined)
  assert.equal(store.getKv('shadow_model_agent_1'), `${HAIKU}:low`, 'another agent keeps its own')
})

// ---- the dashboard ----

/** Several functions of the dashboard's script together (one may call another), the last one returned. */
function pageFunctions<T>(names: string[], S: unknown): T {
  const html = readFileSync(join(REPO, 'src/web/dashboard.html'), 'utf8')
  const src = names.map(name => {
    const found = html.match(new RegExp(`\\nfunction ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0]
    assert.ok(found, `the dashboard defines ${name}()`)
    return found
  })
  return new Function('S', `${src.join('\n')}; return ${names.at(-1)}`)(S) as T
}

test('PAM-16 the dashboard: an agent\'s own AI model and effort with "Same as all agents" first, the prices and a bubble each; the page asks for the password by the server\'s rules; the tab and the Strategist box say who plays what', () => {
  const html = readFileSync(join(REPO, 'src/web/dashboard.html'), 'utf8')
  const rules = web as unknown as {
    agentAiNeedsPassword: (current: Pair, next: Pair, shadows: readonly string[]) => boolean
    allAgentsAiNeedsPassword: (all: Pair, next: Pair, agents: { settings: { aiModel: string; aiEffort: string }; shadows: string[] }[]) => boolean
  }
  assert.equal(typeof rules.agentAiNeedsPassword, 'function')
  // The fields, each with its bubble, in the agent's settings; the form sends them.
  assert.match(html, /<label for="sAiModel">AI model<i class="info" data-tip="aiModel">i<\/i><\/label><select id="sAiModel"><\/select>/)
  assert.match(html, /<label for="sAiEffort">Effort<i class="info" data-tip="aiEffort">i<\/i><\/label><select id="sAiEffort"><\/select>/)
  const read = html.match(/function readForm\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.match(read, /aiModel: \$\('sAiModel'\)\.value, aiEffort: \$\('sAiEffort'\)\.value/)
  const save = html.match(/async function saveSettings\(password\) \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.match(save, /agentAiCostsMore\(b, form\)/, 'the save asks for the password when the AI gets dearer')
  for (const tip of ['aiModel', 'aiEffort']) {
    const text = html.match(new RegExp(`\\n  ${tip}: \\['[^']+', \`([^\`]*)\`\\]`))?.[1] ?? ''
    assert.ok(text.length > 100, `the bubble ${tip}`)
    assert.match(text, /Same as all agents/)
    assert.match(text, /password/)
    assert.doesNotMatch(text, /—|, and |, or |\bbot\b/i, tip)
  }

  const models = Object.keys(strategist.MODELS).map(id => ({ id, label: strategist.MODELS[id]!.label, price: strategist.MODELS[id]!.price, ...strategist.priceRange(id)! }))
  const efforts = [...strategist.EFFORTS]
  const ids = Object.keys(strategist.MODELS)
  // The choices: "Same as all agents (<the all-agents one>)" first, then the four models with their price, or the five efforts.
  const instance = { model: OPUS, effort: 'high', models, efforts, shadowModels: [] as string[], ownAi: 0 }
  assert.deepEqual(pageFunctions<() => string[][]>(['aiModelOptions'], { instance })(), [
    ['', 'Same as all agents (Opus 5.5)'], [HAIKU, 'Haiku 5.5 · $0.1 / $0.5 per M tokens'], [SONNET, 'Sonnet 5.5 · $2 / $10 per M tokens'], [OPUS, 'Opus 5.5 · $4 / $20 per M tokens'], [FABLE, 'Fable 5.2 · $8 / $40 per M tokens'],
  ])
  assert.deepEqual(pageFunctions<() => string[][]>(['aiEffortOptions'], { instance })(), [['', 'Same as all agents (high)'], ['low', 'low'], ['medium', 'medium'], ['high', 'high'], ['xhigh', 'xhigh'], ['max', 'max']])

  // The page's rule for one agent is the server's, over every pair it plays and every pair the form can give.
  const shadowSets: string[][] = [[], [`${OPUS}:low`, `${OPUS}:high`], [SONNET], [`${HAIKU}:xhigh`, FABLE]]
  let asked = 0, wokenOnly = 0
  for (const all of [{ model: SONNET, effort: 'medium' }, { model: OPUS, effort: 'high' }]) {
    for (const shadows of shadowSets) {
      for (const ownModel of ['', ...ids]) {
        for (const ownEffort of ['', 'low', 'high']) {
          const cur = strategist.agentChoice({ aiModel: ownModel, aiEffort: ownEffort }, all)
          const b = { ai: { model: cur.model, effort: cur.effort, own: strategist.ownAi({ aiModel: ownModel, aiEffort: ownEffort }), shadows } }
          const costsMore = pageFunctions<(b: unknown, form: unknown) => boolean>(['agentAiCostsMore'], { instance: { ...instance, ...all } })
          for (const aiModel of ['', ...ids]) {
            for (const aiEffort of ['', ...efforts]) {
              const next = strategist.agentChoice({ aiModel, aiEffort }, all)
              const server = rules.agentAiNeedsPassword(cur, next, shadows)
              assert.equal(costsMore(b, { aiModel, aiEffort }), server, `${JSON.stringify(all)} ${ownModel}/${ownEffort} to ${aiModel}/${aiEffort} with ${shadows.join('+')}`)
              if (server) asked++
              if (server && !web.raisesAiSpend(cur, next)) wokenOnly++
            }
          }
        }
      }
    }
  }
  assert.ok(asked > 0 && wokenOnly > 0, 'some saves ask only because they wake a shadow')
  // And the all-agents switch: the agents it moves, each with its shadow entries.
  const agents = [
    { settings: { aiModel: '', aiEffort: '' }, shadows: [FABLE] },
    { settings: { aiModel: OPUS, aiEffort: 'high' }, shadows: [`${OPUS}:low`] },
    { settings: { aiModel: '', aiEffort: 'low' }, shadows: [`${SONNET}:low`] },
  ]
  for (const subset of [[0], [1], [2], [0, 1, 2], []]) {
    const these = subset.map(k => agents[k]!)
    for (const all of [{ model: FABLE, effort: 'medium' }, { model: SONNET, effort: 'low' }, { model: SONNET, effort: 'high' }]) {
      const S = { instance: { ...instance, ...all, shadowModels: [] }, agents: these.map(a => ({ ai: { own: strategist.ownAi(a.settings), shadows: a.shadows } })) }
      const costsMore = pageFunctions<(model: string, effort: string) => boolean>(['wakesShadow', 'aiCostsMore'], S)
      for (const model of ids) for (const effort of efforts) assert.equal(costsMore(model, effort), rules.allAgentsAiNeedsPassword(all, { model, effort }, these), `${subset} ${JSON.stringify(all)} to ${model} ${effort}`)
    }
  }
  // The tab of an agent that plays another AI says which; the Strategist box counts the agents with their own.
  const tag = pageFunctions<(b: unknown) => string>(['aiTag'], { instance })
  assert.equal(tag({ ai: { model: OPUS, effort: 'high' } }), '')
  assert.equal(tag({ ai: { model: HAIKU, effort: 'high' } }), 'Haiku 5.5, high')
  assert.equal(tag({ ai: { model: OPUS, effort: 'low' } }), 'Opus 5.5, low')
  assert.match(html, /b\.source === 'imported' \? el\('span', \{ class: 'vmode imported'[\s\S]{0,400}aiTag\(b\)/, 'the tab shows it')
  const count = (n: number) => pageFunctions<() => string>(['ownAiText'], { instance: { ...instance, ownAi: n } })()
  assert.deepEqual([count(0), count(1), count(7)], ['', ' · 1 agent uses its own model or effort', ' · 7 agents use their own model or effort'])
  assert.match(html, /\+ ownAiText\(\)/)
  // The hint under the fields: what the agent plays, its shadow plans set on the server.
  const hint = pageFunctions<(b: unknown, form: unknown) => string>(['ownAiHint'], { instance })
  assert.equal(hint({ ai: { model: OPUS, effort: 'high', own: { model: null, effort: null }, ignored: [], shadows: [] } }, { aiModel: '', aiEffort: '' }), 'Plays Opus 5.5 at high effort, the same as all agents.')
  assert.equal(hint({ ai: { model: SONNET, effort: 'high', own: { model: SONNET, effort: 'high' }, ignored: [], shadows: [`${SONNET}:low`, `${SONNET}:medium`, `${SONNET}:xhigh`], ownShadows: true } }, { aiModel: SONNET, aiEffort: 'high' }),
    'Plays Sonnet 5.5 at high effort, its own. Shadow plans set on the server for this agent: Sonnet 5.5 (low), Sonnet 5.5 (medium) and Sonnet 5.5 (xhigh).')
  assert.equal(hint({ ai: { model: OPUS, effort: 'low', own: { model: null, effort: 'low' }, ignored: ['its own model gpt-oss is not on the list'], shadows: [HAIKU], ownShadows: false } }, { aiModel: '', aiEffort: 'low' }),
    'Plays Opus 5.5 at low effort, its own. Shadow plans set on the server for every agent: Haiku 5.5. A model saved on the server is not on the list, so the agent plays the all-agents one.')
  assert.equal(hint({ ai: { model: OPUS, effort: 'high', own: { model: null, effort: null }, ignored: [], shadows: [] } }, { aiModel: HAIKU, aiEffort: 'low' }), 'Plays Opus 5.5 at high effort, the same as all agents. After saving: Haiku 5.5 at low effort.')
  // The Strategist bubble says what it is now: the AI of every agent without its own.
  const strat = html.match(/k_strat: \['Strategist', `([^`]*)`/)?.[1] ?? ''
  assert.match(strat, /every agent without its own/)
  assert.doesNotMatch(strat, /—|, and |, or /)
})

// ---- the guides ----

test('PAM-17 the guides: the owner\'s setup as the server guide writes it works as written (each agent\'s own model, the all-agents shadow list off, three agents with the same model at three other efforts); README, site and review follow', async () => {
  const read = (f: string) => readFileSync(join(REPO, f), 'utf8')
  const guide = read('docs/SERVER.md')
  const shadow = (await import('../src/strategist/shadow.ts')) as unknown as ShadowModule
  // Each agent's own model and effort, as root on the server: the owner's ten agents on three models at high.
  const own = [...guide.matchAll(/^sudo \/opt\/foxleague-agent\/app\/deploy\/agentctl\.sh model (\d+) (\S+) (\S+)$/gm)].map(m => [Number(m[1]), m[2]!, m[3]!] as const)
  const want: Record<number, string> = { 7: OPUS, 6: OPUS, 10: OPUS, 1: SONNET, 5: SONNET, 4: SONNET, 9: HAIKU, 8: HAIKU, 2: HAIKU, 3: HAIKU }
  assert.deepEqual(Object.fromEntries(own.map(([n, model]) => [n, model])), want, 'one line per agent, the owner\'s models')
  assert.ok(own.every(([, , effort]) => effort === 'high'))
  // The lines run as written (the CLI is the one agentctl.sh runs), here against a database of this test.
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-pam-guide-'))
  const store = new Store(dir)
  for (let i = 0; i < 10; i++) store.addAgent(i, `erd1agent${i}`)
  const env = { PATH: process.env.PATH!, HOME: dir, AGENT_ENV_FILE: join(dir, 'no-such.env'), AGENT_DATA_DIR: dir, MVX_GATEWAY_URL: 'http://127.0.0.1:9', MVX_API_URL: 'http://127.0.0.1:9', FOXLEAGUE_URL: 'http://127.0.0.1:9' }
  for (const [n, model, effort] of own.filter(([n]) => [7, 1, 9].includes(n))) {
    const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(REPO, 'src/cli.ts'), 'model', String(n), model, effort], { env, cwd: dir, encoding: 'utf8', timeout: 90_000 })
    assert.equal(r.status, 0, r.stderr)
  }
  // The shadow lists, with the guide's own one-line script.
  const script = guide.match(/^SET='([^'\n]+)'$/m)?.[1]
  assert.ok(script)
  const from = guide.indexOf('### The same model at other efforts, on three agents')
  assert.ok(from > guide.indexOf('## Shadow plans: trying another model without letting it play'), 'the example is in the shadow section')
  const block = guide.slice(from, guide.indexOf('```\n', guide.indexOf('```', from) + 3))
  const sets = [...block.matchAll(/-e "\$SET" (shadow_model\S*) (\S+)\n/g)].map(m => [m[1]!, m[2]!] as [string, string])
  assert.deepEqual(sets, [
    ['shadow_model', 'off'],
    ['shadow_model_agent_7', `${OPUS}:low,${OPUS}:medium,${OPUS}:xhigh`],
    ['shadow_model_agent_1', `${SONNET}:low,${SONNET}:medium,${SONNET}:xhigh`],
    ['shadow_model_agent_9', `${HAIKU}:low,${HAIKU}:medium,${HAIKU}:xhigh`],
  ])
  store.setKv('shadow_model', `${HAIKU},${SONNET}`) // what ran before the test: the all-agents list
  const setScript = script.replace('/var/lib/foxleague-agent/agent.db', join(dir, 'agent.db'))
  for (const [key, value] of sets) {
    const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', setScript, key, value], { encoding: 'utf8', timeout: 60_000 })
    assert.equal(r.status, 0, r.stderr)
  }
  const prev = process.env.AGENT_SHADOW_MODEL
  delete process.env.AGENT_SHADOW_MODEL
  try {
    for (const [n, model] of [[7, OPUS], [1, SONNET], [9, HAIKU]] as const) {
      const playing = strategist.agentChoice(store.agent(n - 1)!.settings, { model: SONNET, effort: 'medium' })
      assert.deepEqual([playing.model, playing.effort], [model, 'high'], `agent ${n} plays its own`)
      assert.deepEqual(shadow.shadowRuns!(shadow.shadowChoices(store, playing, n - 1)), ['low', 'medium', 'xhigh'].map(effort => ({ model, effort })), `agent ${n}`)
    }
    for (const n of [2, 3, 4, 5, 6, 8, 10]) assert.deepEqual(shadow.shadowChoices(store, { model: OPUS, effort: 'high' }, n - 1).models, [], `agent ${n}: none`)
  } finally {
    if (prev !== undefined) process.env.AGENT_SHADOW_MODEL = prev
  }
  const flat = guide.replace(/\s+/g, ' ')
  for (const said of [
    /An entry may carry its own effort after a colon/,
    /An entry with an effort rests only while its model plays at that very effort; the same model at another effort runs/,
    /An entry without an effort rests while its model plays, at any effort, as before/,
    /`shadow_model_agent_N`/,
    /`off` there means none for that agent/,
    /agentctl\.sh shadow-report 7/,
    /This is a setting on the machine, so it asks for no password/,
  ]) assert.match(flat, said)
  assert.match(guide, /`agents`, `snapshot 1`, `log 1`, `mode dry`, `kill on`, `check-keys`, `shadow-report`, `model`/)
  assert.doesNotMatch(guide.slice(guide.indexOf('## Shadow plans')), /—|\bbot\b/i)
  // The README, the site.
  assert.match(read('README.md'), /npm run cli -- model \[N\] \[model effort\] {2}# each agent's AI; agent N's own model and effort \(same: the all-agents one\)/)
  assert.match(read('README.md').replace(/\s+/g, ' '), /the AI's model and effort for all agents or one agent/)
  const costs = read('site/src/content/docs/help/costs.md')
  const para = costs.slice(costs.indexOf('## Comparing a second model before you switch'), costs.indexOf('## To start')).replace(/\s+/g, ' ')
  assert.match(para, /The model that plays can also plan in the shadow at another effort, to see what more or less thinking would change\./)
  assert.match(para, /Shadow plans can be set for one agent only\./)
  assert.doesNotMatch(para, /\$|\d|Haiku|Sonnet|Opus|Fable|cheaper|better|—|, and |, or /)
  assert.match(costs.replace(/\s+/g, ' '), /each agent can also have its own model and effort/)
  assert.match(read('site/src/content/docs/use/dashboard.md').replace(/\s+/g, ' '), /every agent that has no model or effort of its own/)
  const settings = read('site/src/content/docs/use/settings.md')
  assert.match(settings, /\n## AI\n/)
  assert.match(settings.replace(/\s+/g, ' '), /\| AI model \| Same as all agents \|/)
  assert.match(settings.replace(/\s+/g, ' '), /\| Effort \| Same as all agents \|/)
  assert.match(read('site/src/content/docs/help/server.mdx').replace(/\s+/g, ' '), /an agent's own model and effort/)
  for (const f of ['site/src/content/docs/help/costs.md', 'site/src/content/docs/use/dashboard.md', 'site/src/content/docs/use/settings.md', 'site/src/content/docs/help/server.mdx']) assert.doesNotMatch(read(f), /—|\bbot\b/i, f)
  // The review: its own section, the last one, in the table format, with what stays open.
  const review = read('docs/SECURITY-REVIEW.md')
  const section = review.slice(review.lastIndexOf('\n## '))
  assert.match(section, /^\n## Per-agent models and shadow efforts \(2026-11-13\)\n/)
  assert.match(section, /\| Id \| Severity \| Finding \| Fix \|\n\|---\|---\|---\|---\|\n\| PAM-1 \|/)
  for (let k = 1; k <= 17; k++) assert.match(section, new RegExp(`\\n\\| PAM-${k} \\|`), `PAM-${k}`)
  for (const line of section.split('\n').filter(l => l.startsWith('| PAM-'))) assert.equal(line.split(' | ').length, 4, line.slice(0, 40))
  for (const risk of [/dearer model without the password/i, /unknown value/i, /a shadow that never rests/i, /cost booked on the wrong price/i]) assert.match(section.replace(/\s+/g, ' '), risk)
  assert.ok(section.includes('\nStays open:\n'))
  assert.doesNotMatch(section, /—|\bbot\b/i)
})

// ---- the agent review of pull request #65 ----

test('R65A-1 the all-agents switch weighs the retired agents too: one that follows the all-agents pair would start its shadow plans after Restore and Resume, one click each', async () => {
  const { svc, server, password, post, state } = await webService({ agents: 2 })
  try {
    svc.store.setKv('shadow_model', FABLE)
    svc.setStrategist(FABLE, 'medium', 'test')
    // Agent 1 plays its own model and effort; agent 2 follows Fable 5.2, under which its Fable 5.2 shadow rests. Agent 2 is retired.
    svc.store.updateSettings(0, { aiModel: OPUS, aiEffort: 'high' })
    svc.store.retireAgent(1, { at: new Date().toISOString(), by: 'test', team: null, egld: null, foxsy: null, usd: null })
    let res = await post('/api/strategist', { model: HAIKU, effort: 'medium' })
    assert.equal(res.status, 403, 'a retired agent that follows the all-agents pair would start the Fable 5.2 shadow once restored and resumed')
    // The page gets the retired agent's AI, as it gets the active agents', and asks by the same rule.
    const s = await state()
    const retired = (s as unknown as { retired: { index: number; ai?: unknown }[] }).retired
    assert.deepEqual(retired.map(r => [r.index, r.ai]), [[1, { model: FABLE, effort: 'medium', own: { model: null, effort: null }, ignored: [], shadows: [FABLE], ownShadows: false }]])
    const page = pageFunctions<(model: string, effort: string) => boolean>(['wakesShadow', 'aiCostsMore'], s)
    assert.equal(page(HAIKU, 'medium'), true, 'the page asks for the password')
    res = await post('/api/strategist', { model: HAIKU, effort: 'medium', password })
    assert.equal(res.status, 200, await res.text())
    // A retired agent with its own model and effort is not moved by the switch: one click, on the page too.
    svc.store.updateSettings(1, { aiModel: OPUS, aiEffort: 'high' })
    svc.setStrategist(FABLE, 'medium', 'test')
    assert.equal(pageFunctions<(model: string, effort: string) => boolean>(['wakesShadow', 'aiCostsMore'], await state())(HAIKU, 'medium'), false)
    res = await post('/api/strategist', { model: HAIKU, effort: 'medium' })
    assert.equal(res.status, 200, await res.text())
  } finally {
    server.close()
  }
})

test('R65A-2 the AI fields show the values the agent plays: an own model that left the list shows as its successor, so a save of any other setting writes back what it plays and asks no password', () => {
  const html = readFileSync(join(REPO, 'src/web/dashboard.html'), 'utf8')
  const fill = html.match(/function fillForm\(st\) \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.doesNotMatch(fill, /fillOptions\(\$\('sAiModel'\), aiModelOptions\(\), st\.aiModel\)/, 'the model field is filled from the saved id: an own model that left the list shows as "Same as all agents" and the next save writes an empty model')
  assert.match(fill, /const own = aiFormValues\(agent\(\), st\)/)
  assert.match(fill, /fillOptions\(\$\('sAiModel'\), aiModelOptions\(\), own\.aiModel\); fillOptions\(\$\('sAiEffort'\), aiEffortOptions\(\), own\.aiEffort\)/)
  const rules = web as unknown as { agentAiNeedsPassword: (current: Pair, next: Pair, shadows: readonly string[]) => boolean }
  const models = Object.keys(strategist.MODELS).map(id => ({ id, label: strategist.MODELS[id]!.label, price: strategist.MODELS[id]!.price, ...strategist.priceRange(id)! }))
  for (const all of [{ model: OPUS, effort: 'high' }, { model: HAIKU, effort: 'low' }]) {
    const S = { instance: { ...all, models, efforts: [...strategist.EFFORTS], shadowModels: [], ownAi: 0 } }
    const values = pageFunctions<(b: unknown, st: unknown) => { aiModel: string; aiEffort: string }>(['aiFormValues'], S)
    const costsMore = pageFunctions<(b: unknown, form: unknown) => boolean>(['agentAiCostsMore'], S)
    for (const aiModel of ['', HAIKU, SONNET, 'claude-sonnet-5', 'claude-opus-5', 'claude-fable-5-1', 'gpt-oss']) {
      for (const aiEffort of ['', 'low', 'xhigh', 'turbo']) {
        const settings = { ...DEFAULT_SETTINGS, aiModel, aiEffort }
        const before = strategist.agentChoice(settings, all)
        const b = { settings, ai: { model: before.model, effort: before.effort, own: strategist.ownAi(settings), ignored: before.ignored, shadows: [FABLE, `${SONNET}:xhigh`] } }
        const form = values(b, settings)
        const what = `${JSON.stringify(all)} saved ${aiModel}/${aiEffort} shows ${form.aiModel}/${form.aiEffort}`
        // What the fields show is a value the route takes: empty or a model of the list, empty or an effort.
        assert.deepEqual(validateSettingsPatch(form), form, what)
        assert.ok(form.aiModel === '' || strategist.isKnownModel(form.aiModel), what)
        // Saved back unchanged, the agent plays the same pair; neither the server nor the page asks for the password.
        const after = strategist.agentChoice({ ...settings, ...form }, all)
        assert.deepEqual([after.model, after.effort], [before.model, before.effort], what)
        assert.equal(rules.agentAiNeedsPassword(before, after, b.ai.shadows), false, what)
        assert.equal(costsMore(b, form), false, what)
      }
    }
    // The line under the fields says what became of a saved model that left the list: it plays the successor shown.
    const hint = pageFunctions<(b: unknown, form: unknown) => string>(['ownAiHint'], S)
    const moved = strategist.agentChoice({ aiModel: 'claude-sonnet-5', aiEffort: 'high' }, all)
    const b = { ai: { model: moved.model, effort: moved.effort, own: { model: SONNET, effort: 'high' }, ignored: moved.ignored, shadows: [] } }
    assert.equal(hint(b, { aiModel: SONNET, aiEffort: 'high' }), 'Plays Sonnet 5.5 at high effort, its own. The model saved on the server has left the list: the agent plays its successor, shown here.')
  }
})

test('R65A-3 a new Anthropic key from the dashboard reaches the strategist of every model an agent plays by its own choice', async t => {
  const prev = process.env.ANTHROPIC_API_KEY
  t.after(() => {
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = prev
  })
  const m = await service({ agents: 3, own: { 0: { aiModel: HAIKU }, 1: { aiModel: OPUS, aiEffort: 'high' } } })
  for (const i of [0, 1, 2]) await m.svc.tick(i)
  const own = [m.inner.strategistFor(HAIKU), m.inner.strategistFor(OPUS)]
  const clientOf = (s: Strategist) => (s as unknown as { client: { apiKey?: string } }).client
  for (const s of [...own, m.svc.strategist!]) assert.equal(clientOf(s), m.client)
  const key = `sk-ant-${'p'.repeat(40)}`
  m.svc.updateKeys({ ANTHROPIC_API_KEY: key }, 'test')
  for (const s of [...own, m.svc.strategist!]) {
    assert.notEqual(clientOf(s), m.client, `${s.model}: still the connection with the old key`)
    assert.equal(clientOf(s).apiKey, key, s.model)
  }
  // The same objects, each with its own model: the next plan of each agent goes out with the new key.
  assert.deepEqual([m.inner.strategistFor(HAIKU), m.inner.strategistFor(OPUS)], own)
  assert.deepEqual(own.map(s => s.model), [HAIKU, OPUS])
})
