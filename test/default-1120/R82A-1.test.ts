// R82A-1 (high, rule 7; the GitHub review of PR #82): DEF-1 made the effort nobody chose high with the default model
// nobody chose (Haiku 5.5), and agentChoice gave that effort to every agent without an effort of its own, also one with
// a model of its own. On an install with nothing picked in the Strategist box and no AGENT_MODEL* (the installer writes
// neither), an agent saved as Opus 5.5 with Effort "Same as all agents" played Opus 5.5 at medium before the update and
// Opus 5.5 at high after it, with no password: the step the dashboard asks the password for.
//
// Now an agent whose model is its own inherits the effort picked for all agents (the Strategist box, else
// AGENT_MODEL_EFFORT), else medium, what it played before; the high of the default pair goes only to the agents that
// play the default model. Applying an effort in the Strategist box that would raise what such an agent inherits asks
// for the password, on the server and on the page. Each test failed on 9914141 before the fix.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Config } from '../../src/config.ts'
import { DEFAULT_AI } from '../../src/store/settings.ts'
import { Store } from '../../src/store/db.ts'
import * as strategist from '../../src/strategist/strategist.ts'
import { Sessions, hashPassword } from '../../src/web/auth.ts'
import * as web from '../../src/web/server.ts'

const REPO = resolve(import.meta.dirname, '../..')
const HAIKU = 'claude-haiku-5-5'
const SONNET = 'claude-sonnet-5-5'
const OPUS = 'claude-opus-5-5'
const FABLE = 'claude-fable-5-2'
type Pair = { model: string; effort: string }

/** Runs `body` with AGENT_MODEL and AGENT_MODEL_EFFORT unset, as the installer leaves the env file, then puts them back. */
async function withoutEnvChoice<T>(body: () => Promise<T> | T): Promise<T> {
  const saved = { model: process.env.AGENT_MODEL, effort: process.env.AGENT_MODEL_EFFORT }
  delete process.env.AGENT_MODEL
  delete process.env.AGENT_MODEL_EFFORT
  try {
    return await body()
  } finally {
    for (const [k, v] of [['AGENT_MODEL', saved.model], ['AGENT_MODEL_EFFORT', saved.effort]] as const) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

function testConfig(dir: string): Config {
  return {
    mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: 'sk-ant-not-a-real-key-for-this-test-only', model: DEFAULT_AI.model, telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config
}

/** A service as a new install starts it after the update: nothing picked in the dashboard, its agents saved as given. */
async function service(own: Record<number, { aiModel: string; aiEffort: string }>, before: (store: Store) => void = () => undefined) {
  const { Service } = await import('../../src/service.ts')
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-r82a1-'))
  const first = new Store(dir)
  before(first)
  first.db.close()
  const svc = new Service(testConfig(dir))
  svc.ensureAgents()
  for (const i of Object.keys(own).map(Number)) {
    if (!svc.store.agent(i)) svc.store.addAgent(i, svc.wallet(i).address)
    svc.store.updateSettings(i, own[i]!)
  }
  return svc
}

test('R82A-1 an agent with its own model and the all-agents effort keeps medium after the update: the high of the default pair is never inherited', async () => {
  await withoutEnvChoice(async () => {
    // The service: what each agent plays and what its plan is asked at.
    const svc = await service({ 1: { aiModel: OPUS, aiEffort: '' }, 2: { aiModel: SONNET, aiEffort: '' }, 3: { aiModel: FABLE, aiEffort: '' }, 4: { aiModel: HAIKU, aiEffort: '' } })
    const want: Record<number, Pair> = { 0: { model: HAIKU, effort: 'high' }, 1: { model: OPUS, effort: 'medium' }, 2: { model: SONNET, effort: 'medium' }, 3: { model: FABLE, effort: 'medium' }, 4: { model: HAIKU, effort: 'medium' } }
    for (const i of [0, 1, 2, 3, 4]) {
      const ai = svc.aiOf(svc.store.agent(i)!)
      assert.deepEqual({ model: ai.model, effort: ai.effort }, want[i], `agent ${i + 1} on the dashboard`)
    }
    const asked: Pair[] = []
    Object.assign(svc as object, {
      schedule: () => undefined, notify: () => undefined, report: () => undefined, inActiveHours: () => true, waitingForFunds: () => null,
      retryPending: async () => undefined, noticeInvitations: async () => undefined, pause: async () => undefined,
      snapshot: async () => (await import('../fixtures.ts')).snapshot(),
      strategistFor: (model: string) => ({
        plan: async (_input: unknown, _request: string, effort: string) => {
          asked.push({ model, effort })
          return { summary: 'nothing to do', actions: [], rejected: [], usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0.001, servedBy: model }, stopReason: 'tool_use' }
        },
      }),
    })
    for (const i of [0, 1, 2, 3, 4]) await svc.tick(i)
    assert.deepEqual(asked, [0, 1, 2, 3, 4].map(i => want[i]), 'each plan is asked at the pair the agent plays')

    // The rule by itself: the all-agents pair of a new install, and an agent of each kind.
    const store = new Store('', ':memory:')
    const cfg = { model: DEFAULT_AI.model } as Config
    const all = { ...strategist.strategistChoice(store, cfg, () => undefined), ownModelEffort: strategist.inheritedEffort(store) }
    assert.deepEqual([all.model, all.effort], [HAIKU, 'high'], 'the default pair')
    const plays = (aiModel: string, aiEffort = '') => { const c = strategist.agentChoice({ aiModel, aiEffort }, all); return [c.model, c.effort] }
    assert.deepEqual(plays(''), [HAIKU, 'high'], 'an agent that follows both plays the default pair')
    for (const model of [OPUS, SONNET, FABLE, HAIKU]) assert.deepEqual(plays(model), [model, 'medium'], `its own ${model}, effort the same as all agents: medium, what it played before`)
    assert.deepEqual(plays(OPUS, 'xhigh'), [OPUS, 'xhigh'], 'its own effort wins')
    assert.deepEqual(plays('', 'low'), [HAIKU, 'low'])
    // An effort picked for all agents is inherited as before: in the dashboard, or in the env file.
    store.setKv('strategist_effort', 'xhigh')
    assert.equal(strategist.agentChoice({ aiModel: OPUS, aiEffort: '' }, { ...all, effort: 'xhigh', ownModelEffort: strategist.inheritedEffort(store) }).effort, 'xhigh')
    process.env.AGENT_MODEL_EFFORT = 'low'
    assert.equal(strategist.inheritedEffort(new Store('', ':memory:')), 'low')
    delete process.env.AGENT_MODEL_EFFORT
    assert.equal(strategist.inheritedEffort(new Store('', ':memory:')), 'medium', 'nothing picked: medium')
  })

  // The command line, as the review found it: `model 2 claude-opus-5-5 same` on an install with nothing picked.
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-r82a1-cli-'))
  const env = { PATH: process.env.PATH!, HOME: dir, AGENT_ENV_FILE: join(dir, 'no-such.env'), AGENT_DATA_DIR: dir, MVX_GATEWAY_URL: 'http://127.0.0.1:9', MVX_API_URL: 'http://127.0.0.1:9', FOXLEAGUE_URL: 'http://127.0.0.1:9' }
  const cli = (...args: string[]) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(REPO, 'src/cli.ts'), 'model', ...args], { env, cwd: dir, encoding: 'utf8', timeout: 90_000 })
  const store = new Store(dir)
  for (const i of [0, 1]) store.addAgent(i, `erd1agent${i}`)
  const r = cli('2', OPUS, 'same')
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout.trim(), 'agent 2 plays Opus 5.5 at medium effort from its next plan (its own model)')
  assert.deepEqual(cli().stdout.trim().split('\n').slice(0, 3), ['all agents: Haiku 5.5 at high effort (the Strategist box)', 'agent 1: Haiku 5.5 at high effort (same as all agents)', 'agent 2: Opus 5.5 at medium effort (its own model)'])
})

test('R82A-1 the Strategist box asks for the password when it would raise the effort an agent with its own model inherits', async () => {
  const all = { model: HAIKU, effort: 'high', ownModelEffort: 'medium' }
  const ownOpus = [{ settings: { aiModel: OPUS, aiEffort: '' }, shadows: [] as string[] }]
  const followers = [{ settings: { aiModel: '', aiEffort: '' }, shadows: [] as string[] }, { settings: { aiModel: OPUS, aiEffort: 'low' }, shadows: [] as string[] }]
  // Picking Haiku 5.5 at high saves that effort for all agents: the Opus agent goes from medium to high.
  assert.equal(web.allAgentsAiNeedsPassword(all, { model: HAIKU, effort: 'high' }, ownOpus), true, 'Opus 5.5 at medium to Opus 5.5 at high')
  assert.equal(web.allAgentsAiNeedsPassword(all, { model: HAIKU, effort: 'medium' }, ownOpus), false, 'medium keeps it where it is')
  assert.equal(web.allAgentsAiNeedsPassword(all, { model: HAIKU, effort: 'low' }, ownOpus), false, 'a lower effort is one click')
  assert.equal(web.allAgentsAiNeedsPassword(all, { model: HAIKU, effort: 'high' }, followers), false, 'nobody inherits more')

  // The route, with an agent saved as Opus 5.5 and Effort "Same as all agents".
  await withoutEnvChoice(async () => {
    const svc = await service({ 1: { aiModel: OPUS, aiEffort: '' } })
    ;(svc as unknown as { schedule: unknown }).schedule = () => undefined
    svc.notify = () => undefined
    const password = 'correct-horse-battery'
    const creds = { username: 'admin', passwordHash: hashPassword(password), secretKey: 'k'.repeat(64) }
    const server = web.startWeb(svc, creds, 0)
    try {
      if (!server.listening) await once(server, 'listening')
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      const sessions = new Sessions(creds.secretKey, creds.passwordHash)
      const cookie = sessions.issue('admin')
      const post = (body: unknown) => fetch(`${url}/api/strategist`, { method: 'POST', headers: { cookie: `foxagent_session=${cookie}`, origin: url, 'x-csrf-token': sessions.csrfFor(cookie), 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const state = async () => (await (await fetch(`${url}/api/state`, { headers: { cookie: `foxagent_session=${cookie}` } })).json()) as { instance: { aiAll: Pair & { ownModelEffort?: string } } }
      assert.deepEqual((await state()).instance.aiAll, all, 'the page gets what an agent with its own model inherits')
      let res = await post({ model: HAIKU, effort: 'high' })
      assert.equal(res.status, 403, 'Haiku 5.5 at high picked in the box would raise agent 2 to Opus 5.5 at high')
      assert.equal(svc.aiOf(svc.store.agent(1)!).effort, 'medium', 'nothing changed')
      res = await post({ model: HAIKU, effort: 'medium' })
      assert.equal(res.status, 200, await res.text())
      assert.equal(svc.aiOf(svc.store.agent(1)!).effort, 'medium')
      res = await post({ model: HAIKU, effort: 'high', password })
      assert.equal(res.status, 200, await res.text())
      assert.equal(svc.aiOf(svc.store.agent(1)!).effort, 'high', 'with the password it inherits the effort picked')
    } finally {
      server.close()
    }
  })
})

test('R82A-1 the dashboard asks by the same rule and says what an agent with its own model plays', () => {
  const html = readFileSync(join(REPO, 'src/web/dashboard.html'), 'utf8')
  const fn = (names: string[], S: unknown) => {
    const src = names.map(name => {
      const found = html.match(new RegExp(`\\nfunction ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0]
      assert.ok(found, `the dashboard defines ${name}()`)
      return found
    })
    return new Function('S', `${src.join('\n')}; return ${names.at(-1)}`)(S)
  }
  const models = Object.keys(strategist.MODELS).map(id => ({ id, label: strategist.MODELS[id]!.label, price: strategist.MODELS[id]!.price, ...strategist.priceRange(id)! }))
  const efforts = [...strategist.EFFORTS]
  const all = { model: HAIKU, effort: 'high', ownModelEffort: 'medium' }
  const instance = { model: HAIKU, effort: 'high', aiAll: all, models, efforts, shadowModels: [], shadowEntries: [] }
  const ownOpus = { ai: { model: OPUS, effort: 'medium', own: { model: OPUS, effort: null }, ignored: [], shadows: [] } }
  const S = { instance, agents: [ownOpus], retired: [] }
  // "Same as all agents" says what it means for a model of its own.
  assert.deepEqual((fn(['aiEffortOptions'], S) as () => string[][])()[0], ['', 'Same as all agents (high; medium with a model of its own)'])
  // The agent form: the page and the server agree on every choice.
  const costsMore = fn(['agentAiCostsMore'], S) as (b: unknown, form: unknown) => boolean
  const hint = fn(['ownAiHint'], S) as (b: unknown, form: unknown) => string
  assert.equal(hint(ownOpus, { aiModel: OPUS, aiEffort: '' }), 'Plays Opus 5.5 at medium effort, its own.')
  assert.equal(costsMore(ownOpus, { aiModel: OPUS, aiEffort: '' }), false, 'an unchanged save')
  const ids = Object.keys(strategist.MODELS)
  for (const ownModel of ['', ...ids]) {
    for (const ownEffort of ['', 'low', 'high']) {
      const cur = strategist.agentChoice({ aiModel: ownModel, aiEffort: ownEffort }, all)
      const b = { ai: { model: cur.model, effort: cur.effort, own: strategist.ownAi({ aiModel: ownModel, aiEffort: ownEffort }), ignored: [], shadows: [] } }
      for (const aiModel of ['', ...ids]) {
        for (const aiEffort of ['', ...efforts]) {
          const next = strategist.agentChoice({ aiModel, aiEffort }, all)
          assert.equal(costsMore(b, { aiModel, aiEffort }), web.agentAiNeedsPassword(cur, next, []), `${ownModel}/${ownEffort} to ${aiModel}/${aiEffort}`)
        }
      }
    }
  }
  // The Strategist box: Haiku 5.5 at high would raise the Opus agent, so the page asks and says why.
  const boxCostsMore = fn(['wakesShadow', 'aiCostsMore'], S) as (model: string, effort: string) => boolean
  assert.equal(boxCostsMore(HAIKU, 'high'), true)
  assert.equal(boxCostsMore(HAIKU, 'medium'), false)
  assert.equal(boxCostsMore(HAIKU, 'low'), false)
  assert.equal((fn(['wakesShadow', 'aiCostsMore'], { ...S, agents: [] }) as (m: string, e: string) => boolean)(HAIKU, 'high'), false, 'no agent with its own model')
  const why = (fn(['wakesShadow', 'aiRaiseText'], S) as (model: string, effort: string) => string)(HAIKU, 'high')
  assert.equal(why, 'An agent with a model of its own and no effort of its own plays at medium until an effort is picked here. With this switch it plays at high, which costs more on each of its plans. Your password confirms it.')
})
