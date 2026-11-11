// The owner's model list of 2026-11-11: four models to choose from (Haiku 5.5, Sonnet 5.5, Opus 5.5, Fable 5.2), a
// price for every model a request can be served by, the models that left the list moved to their successors, and
// Claude Haiku 5.5 with its two rate cards. Each test was seen failing on 7f5d434 before the code changed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import type Anthropic from '@anthropic-ai/sdk'
import type { Config } from '../src/config.ts'
import { Store } from '../src/store/db.ts'
import { Sessions, hashPassword } from '../src/web/auth.ts'
import { DEFAULT_SETTINGS } from '../src/store/settings.ts'
import { budgetView } from '../src/executor/budget.ts'
import * as strategist from '../src/strategist/strategist.ts'
import * as web from '../src/web/server.ts'
import { setup, snapshot } from './fixtures.ts'

const REPO = resolve(import.meta.dirname, '..')
const html = readFileSync(join(REPO, 'src/web/dashboard.html'), 'utf8')
const { MODELS, Strategist, usd, strategistChoice, isKnownModel } = strategist
type Price = [number, number, number]
type Rates = { price: Price; long?: { over: number; price: Price } }
const PRICES = (strategist as unknown as { PRICES: Record<string, Rates> }).PRICES
const tokens = (input: number, output = 0, read = 0, write = 0) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: read, cache_creation_input_tokens: write, cache_creation: null })
const usage = (u: object, iterations: object[] | null = null) => ({ ...u, iterations }) as unknown as Anthropic.Beta.BetaUsage
/** `usd` with the lines it writes to the log collected instead of printed. */
const priced = (model: string, u: Anthropic.Beta.BetaUsage) => {
  const said: string[] = []
  const value = (usd as unknown as (m: string, u: Anthropic.Beta.BetaUsage, say: (t: string) => void) => number)(model, u, t => void said.push(t))
  return { value, said }
}

test('LIST-1 the owner chooses among four models, from the least to the most capable', () => {
  assert.deepEqual(Object.keys(MODELS), ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-2'])
  assert.deepEqual(Object.values(MODELS).map(m => m.label), ['Haiku 5.5', 'Sonnet 5.5', 'Opus 5.5', 'Fable 5.2'])
  for (const gone of ['claude-sonnet-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-opus-4-8', 'local', 'constructor', '']) assert.equal(isKnownModel(gone), false, gone)
})

test('LIST-2 every model a request can be served by keeps its price: the four, and the fallback targets Sonnet 5, Opus 5, Opus 4.8 and Fable 5.1', () => {
  assert.ok(PRICES, 'strategist.ts exports PRICES')
  // The numbers of 7f5d434, one by one (input, output and cache read per million tokens), and Opus 4.8's list price.
  const before: Record<string, Price> = {
    'claude-sonnet-5': [2, 10, 0.2], 'claude-sonnet-5-5': [2, 10, 0.1], 'claude-opus-5': [5, 25, 0.5],
    'claude-opus-5-5': [4, 20, 0.2], 'claude-fable-5-1': [10, 50, 0.25], 'claude-fable-5-2': [8, 40, 0.2],
  }
  for (const [id, price] of Object.entries({ ...before, 'claude-opus-4-8': [5, 25, 0.5] as Price })) {
    assert.deepEqual(PRICES[id], { price }, `${id}: one rate card, unchanged`)
    // 1M in, 1M out, 1M read from the cache and 1M written to the one-hour cache (twice the input price).
    assert.equal(priced(id, usage(tokens(1e6, 1e6, 1e6, 1e6))).value, price[0] + price[1] + price[2] + 2 * price[0], `${id}: what a request costs`)
  }
  for (const id of Object.keys(MODELS)) assert.deepEqual({ price: MODELS[id]!.price, ...((MODELS[id] as Rates).long ? { long: (MODELS[id] as Rates).long } : {}) }, PRICES[id], `${id}: the list shows the price that is booked`)
  assert.deepEqual(Object.keys(PRICES).sort(), ['claude-fable-5-1', 'claude-fable-5-2', 'claude-haiku-5-5', 'claude-opus-4-8', 'claude-opus-5', 'claude-opus-5-5', 'claude-sonnet-5', 'claude-sonnet-5-5'])
})

test('LIST-3 a fallback is booked at the price of the model that served it, also one that is not on the list', () => {
  const attempt = tokens(1_000_000)
  const rescuedBy = (model: string) => usage(attempt, [{ ...attempt, type: 'message', model: null }, { ...attempt, type: 'fallback_message', model }])
  // Fable's and Opus's fallback targets are Opus 4.8 and Opus 5; Sonnet 5.5's is Sonnet 5.
  assert.deepEqual(priced('claude-fable-5-2', rescuedBy('claude-opus-4-8')), { value: 8 + 5, said: [] })
  assert.deepEqual(priced('claude-opus-5-5', rescuedBy('claude-opus-5')), { value: 4 + 5, said: [] })
  assert.deepEqual(priced('claude-sonnet-5-5', rescuedBy('claude-sonnet-5')), { value: 2 + 2, said: [] })
})

test('LIST-4 a model without a price is booked at the price of the model that was asked for, and the log says so: never free, never an error', () => {
  const attempt = tokens(1_000_000)
  const odd = priced('claude-fable-5-2', usage(attempt, [{ ...attempt, type: 'message', model: null }, { ...attempt, type: 'fallback_message', model: 'claude-mystery-9' }]))
  assert.equal(odd.value, 8 + 8, 'the unknown model at the price of Fable 5.2, the model asked for')
  assert.equal(odd.said.length, 1)
  assert.match(odd.said[0]!, /no price is known for the model claude-mystery-9: its tokens are booked at the price of claude-fable-5-2, the model that was asked for/)
  // Neither is known (AGENT_MODEL names a model this version has never heard of): the dearest price on the table.
  const neither = priced('claude-mystery-9', usage(attempt))
  assert.equal(neither.value, 10, 'the dearest input price known (Fable 5.1)')
  assert.match(neither.said[0]!, /no price is known for the model claude-mystery-9: its tokens are booked at the dearest price known/)
  for (const bad of ['constructor', '__proto__', 'toString']) assert.equal(priced(bad, usage(attempt)).value, 10, `${bad} is not a model`)
})

test('HAIKU-1 Claude Haiku 5.5: two rate cards chosen by the length of the prompt, each attempt on its own card', () => {
  assert.deepEqual(MODELS['claude-haiku-5-5'], { label: 'Haiku 5.5', price: [0.1, 0.5, 0.01], long: { over: 100_000, price: [0.5, 2.5, 0.05] } })
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`)
  // The prompt is every input token of the request: uncached input, cache reads and cache writes. 100,000 is still short.
  const short = tokens(20_000, 1_000_000, 70_000, 10_000)
  near(priced('claude-haiku-5-5', usage(short)).value, (20_000 * 0.1 + 70_000 * 0.01 + 10_000 * 0.2 + 1_000_000 * 0.5) / 1e6)
  // One token more: every price of the request moves to the long card, the cache read (0.1x) and write (2x) too.
  const long = tokens(20_001, 1_000_000, 70_000, 10_000)
  near(priced('claude-haiku-5-5', usage(long)).value, (20_001 * 0.5 + 70_000 * 0.05 + 10_000 * 1 + 1_000_000 * 2.5) / 1e6)
  // The output never counts toward the length of the prompt.
  near(priced('claude-haiku-5-5', usage(tokens(100_000, 5_000_000))).value, (100_000 * 0.1 + 5_000_000 * 0.5) / 1e6)
  // Per attempt: a short and a long one in the same response.
  near(priced('claude-haiku-5-5', usage(long, [{ ...short, type: 'message', model: 'claude-haiku-5-5' }, { ...long, type: 'message', model: 'claude-haiku-5-5' }])).value,
    (20_000 * 0.1 + 70_000 * 0.01 + 10_000 * 0.2 + 1_000_000 * 0.5 + 20_001 * 0.5 + 70_000 * 0.05 + 10_000 * 1 + 1_000_000 * 2.5) / 1e6)
})

test('HAIKU-1 Haiku 5.5 takes the strategist\'s usual request, without a server-side fallback, and a refusal is read before the content', async () => {
  const s = new Strategist('test-key', 'claude-haiku-5-5', 'medium')
  const sent: Record<string, unknown>[] = []
  let answer: Record<string, unknown> = {}
  // The answer's own properties are copied as they are, so a getter stays a getter until the strategist reads it.
  const respond = () => Object.defineProperties({ model: 'claude-haiku-5-5', usage: { input_tokens: 10, output_tokens: 20 } }, Object.getOwnPropertyDescriptors(answer))
  ;(s as unknown as { client: unknown }).client = { beta: { messages: { stream: (p: Record<string, unknown>) => ({ finalMessage: async () => (sent.push(p), respond()) }) } } }
  const input = { snapshot: snapshot(), settings: DEFAULT_SETTINGS, budget: budgetView(setup().store, 0, DEFAULT_SETTINGS, true, new Date(), 14), recent: [], dryRun: true }
  answer = { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'submit_plan', input: { summary: 'sync', actions: [{ action: { type: 'sync' }, reason: 'dirty cards' }] } }] }
  assert.equal((await s.plan(input)).actions.length, 1)
  const p = sent[0]!
  assert.equal(p.model, 'claude-haiku-5-5')
  assert.equal(p.fallbacks, undefined, 'Haiku 5.5 has no server-side fallback')
  assert.equal(p.betas, undefined)
  assert.deepEqual([p.thinking, p.tool_choice, p.output_config], [{ type: 'adaptive' }, { type: 'auto' }, { effort: 'medium' }], 'adaptive thinking, the model chooses the tool, the effort said')
  assert.equal(sent.length, 1)
  // A declined request: the content is never read (a tool call cut off mid-input must not become a plan).
  answer = { stop_reason: 'refusal', stop_details: { category: 'cyber' }, get content(): never { throw new Error('the content of a refusal was read') } }
  const declined = await s.plan(input)
  assert.equal(declined.summary, 'model declined to plan (cyber)')
  assert.deepEqual(declined.actions, [])
})

test('LIST-5 a saved model that left the list moves to its successor, once, with one line in the log; never dearer on any price', () => {
  const successors = { 'claude-sonnet-5': 'claude-sonnet-5-5', 'claude-opus-5': 'claude-opus-5-5', 'claude-fable-5-1': 'claude-fable-5-2' }
  const choose = strategistChoice as unknown as (store: Store, cfg: Config, say: (t: string) => void) => { model: string; effort: string }
  for (const [old, next] of Object.entries(successors)) {
    PRICES[next]!.price.forEach((p, i) => assert.ok(p <= PRICES[old]!.price[i]!, `${next} costs no more than ${old} on price ${i}`))
    assert.equal(PRICES[next]!.long, undefined)
    // Saved by the dashboard of an earlier version.
    const store = new Store('', ':memory:')
    store.setKv('strategist_model', old)
    const said: string[] = []
    assert.equal(choose(store, { model: 'claude-haiku-5-5' } as Config, t => void said.push(t)).model, next, `${old} saved in the database`)
    assert.equal(store.getKv('strategist_model'), next, 'the successor is saved, so it happens once')
    assert.equal(said.length, 1)
    assert.match(said[0]!, new RegExp(`${old} is no longer on the list: the strategist now runs its successor ${next}`))
    assert.equal(choose(store, { model: 'claude-haiku-5-5' } as Config, t => void said.push(t)).model, next)
    assert.equal(said.length, 1, 'nothing more to say the second time')
    // AGENT_MODEL in the env file of an earlier install.
    const fresh = new Store('', ':memory:')
    const fromEnv: string[] = []
    assert.equal(choose(fresh, { model: old } as Config, t => void fromEnv.push(t)).model, next, `AGENT_MODEL=${old}`)
    assert.match(fromEnv[0]!, new RegExp(`${old} is no longer on the list: the strategist now runs its successor ${next} \\(AGENT_MODEL in the env file still names ${old}\\)`))
    assert.equal(fresh.getKv('strategist_model'), undefined, 'the choice from the env is not written into the database')
  }
})

test('LIST-6 a new install plays on Sonnet 5.5: the default when AGENT_MODEL is not set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-model-'))
  const env = { PATH: process.env.PATH!, HOME: dir, AGENT_ENV_FILE: join(dir, 'no-such.env'), AGENT_DATA_DIR: dir }
  const run = (more: Record<string, string> = {}) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', `const { loadConfig } = await import(${JSON.stringify(join(REPO, 'src/config.ts'))}); console.log(loadConfig().model)`], { env: { ...env, ...more }, cwd: dir, encoding: 'utf8', timeout: 60_000 })
  assert.equal(run().stdout.trim(), 'claude-sonnet-5-5')
  assert.equal(run({ AGENT_MODEL: 'claude-opus-5-5' }).stdout.trim(), 'claude-opus-5-5', 'the owner\'s choice in the env file still wins')
  assert.match(readFileSync(join(REPO, '.env.example'), 'utf8'), /^AGENT_MODEL=claude-sonnet-5-5$/m)
})

test('LIST-7 the password rule over the list: a switch that can raise any price asks, a retired model counts as its successor', () => {
  const raises = (from: string, to: string, effort: [string, string] = ['medium', 'medium']) => web.raisesAiSpend({ model: from, effort: effort[0] }, { model: to, effort: effort[1] as 'medium' })
  const order = Object.keys(MODELS)
  for (const [i, from] of order.entries()) {
    for (const [j, to] of order.entries()) assert.equal(raises(from, to), j > i, `${from} to ${to}: ${j > i ? 'dearer, the password' : 'one click'}`)
  }
  // Haiku 5.5 has two cards. Towards it, its dearer card counts: under Sonnet 5.5 on every price, so one click.
  assert.equal(raises('claude-sonnet-5-5', 'claude-haiku-5-5'), false)
  assert.equal(raises('claude-haiku-5-5', 'claude-sonnet-5-5'), true, 'away from it, its cheaper card counts')
  // The same model keeps its prices whatever its cards: only the effort decides.
  assert.equal(raises('claude-haiku-5-5', 'claude-haiku-5-5', ['high', 'low']), false)
  assert.equal(raises('claude-haiku-5-5', 'claude-haiku-5-5', ['low', 'high']), true)
  assert.equal(raises('claude-fable-5-2', 'claude-haiku-5-5', ['low', 'high']), true, 'a cheaper model at a higher effort still asks')
  // A model that left the list counts as its successor; one nobody knows counts as dearer.
  assert.equal(raises('claude-sonnet-5', 'claude-sonnet-5-5'), false)
  assert.equal(raises('claude-opus-5', 'claude-opus-5-5'), false)
  assert.equal(raises('claude-fable-5-1', 'claude-fable-5-2'), false)
  assert.equal(raises('claude-sonnet-5', 'claude-opus-5-5'), true)
  assert.equal(raises('claude-fable-5-1', 'claude-opus-5-5'), false)
  assert.equal(raises('claude-mystery-9', 'claude-haiku-5-5'), true)
})

function testConfig(dir: string, anthropicApiKey?: string): Config {
  return {
    mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey, model: 'claude-sonnet-5-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config
}

/** A service with the web UI on a free port, timers off, and a signed-in session; `before` writes into its database first. */
async function webService(before: (store: Store) => void = () => undefined) {
  const { Service } = await import('../src/service.ts')
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-model-'))
  const first = new Store(dir)
  before(first)
  first.db.close()
  const svc = new Service(testConfig(dir, 'sk-ant-not-a-real-key-for-this-test-only'))
  svc.ensureAgents()
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
  const state = async () => (await (await fetch(`${url}/api/state`, { headers: { cookie: `foxagent_session=${cookie}` } })).json()) as { instance: { model: string; models: { id: string; label: string; price: Price; cheapest: Price; dearest: Price; long?: Rates['long'] }[] } }
  return { svc, server, password, post, state }
}

test('LIST-8 /api/strategist accepts only the four: a model that left the list, the local model and any other id are refused', async () => {
  const { svc, server, password, post } = await webService()
  try {
    for (const model of ['claude-sonnet-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-opus-4-8', 'local', 'Local model (free, coming soon)', '', 'constructor', '__proto__']) {
      const res = await post('/api/strategist', { model, effort: 'low', password })
      assert.equal(res.status, 400, `${model || '(empty)'} was accepted`)
      assert.match(await res.text(), /unknown model/)
      assert.equal(svc.strategist?.model, 'claude-sonnet-5-5', 'the strategist is unchanged')
    }
    // Haiku 5.5 from Sonnet 5.5 is cheaper on every price of both its cards: one click. Back needs the password.
    let res = await post('/api/strategist', { model: 'claude-haiku-5-5', effort: 'low' })
    assert.equal(res.status, 200, await res.text())
    assert.equal(svc.strategist?.model, 'claude-haiku-5-5')
    res = await post('/api/strategist', { model: 'claude-sonnet-5-5', effort: 'low' })
    assert.equal(res.status, 403, 'Haiku 5.5 to Sonnet 5.5 without the password')
    res = await post('/api/strategist', { model: 'claude-sonnet-5-5', effort: 'low', password })
    assert.equal(res.status, 200, await res.text())
  } finally {
    server.close()
  }
})

test('LIST-9 the dashboard gets the four with their cards, and an install that saved Opus 5 shows and runs Opus 5.5', async () => {
  const { svc, server, state } = await webService(store => store.setKv('strategist_model', 'claude-opus-5'))
  try {
    assert.equal(svc.strategist?.model, 'claude-opus-5-5')
    assert.equal(svc.store.getKv('strategist_model'), 'claude-opus-5-5')
    assert.ok(svc.store.activity(null, 10).some(r => r.kind === 'control' && /claude-opus-5 is no longer on the list: the strategist now runs its successor claude-opus-5-5/.test(r.summary)), 'the move is in the activity')
    const { instance } = await state()
    assert.equal(instance.model, 'claude-opus-5-5')
    assert.deepEqual(instance.models.map(m => m.id), ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-2'])
    assert.deepEqual(instance.models[0], { id: 'claude-haiku-5-5', label: 'Haiku 5.5', price: [0.1, 0.5, 0.01], long: { over: 100_000, price: [0.5, 2.5, 0.05] }, cheapest: [0.1, 0.5, 0.01], dearest: [0.5, 2.5, 0.05] })
    assert.deepEqual(instance.models[1], { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', price: [2, 10, 0.1], cheapest: [2, 10, 0.1], dearest: [2, 10, 0.1] })
  } finally {
    server.close()
  }
})

/** A function of the dashboard's script, by name, with the page's `S` given. */
function pageFunction<T>(name: string, S: unknown): T {
  const src = html.match(new RegExp(`\\nfunction ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0]
  assert.ok(src, `the dashboard defines ${name}()`)
  return new Function('S', `${src}; return ${name}`)(S) as T
}

test('LIST-10 the dashboard asks for the password by the server\'s rule, two cards included', () => {
  const models = Object.entries(MODELS).map(([id, m]) => {
    const cards = [m.price, ...((m as Rates).long ? [(m as Rates).long!.price] : [])]
    return { id, label: m.label, price: m.price, cheapest: [0, 1, 2].map(i => Math.min(...cards.map(c => c[i]!))), dearest: [0, 1, 2].map(i => Math.max(...cards.map(c => c[i]!))) }
  })
  const efforts = ['low', 'medium', 'high', 'xhigh', 'max']
  for (const cur of [...Object.keys(MODELS), 'claude-mystery-9']) {
    for (const effort of ['low', 'high']) {
      const costsMore = pageFunction<(model: string, effort: string) => boolean>('aiCostsMore', { instance: { model: cur, effort, models, efforts } })
      for (const pick of Object.keys(MODELS)) {
        for (const to of ['low', 'high']) assert.equal(costsMore(pick, to), web.raisesAiSpend({ model: cur, effort }, { model: pick, effort: to as 'low' }), `${cur} ${effort} to ${pick} ${to}`)
      }
    }
  }
  // A model whose dearer card is above the current model's price asks, although its first card is cheaper.
  const two = [{ id: 'a', label: 'A', price: [1, 5, 0.1], cheapest: [1, 5, 0.1], dearest: [3, 15, 0.3] }, { id: 'b', label: 'B', price: [2, 10, 0.2], cheapest: [2, 10, 0.2], dearest: [2, 10, 0.2] }]
  const from = (model: string) => pageFunction<(model: string, effort: string) => boolean>('aiCostsMore', { instance: { model, effort: 'low', models: two, efforts } })
  assert.equal(from('b')('a', 'low'), true, 'the long prompt of A costs more than B')
  assert.equal(from('a')('b', 'low'), true, 'B costs more than the short prompt of A')
  assert.equal(from('a')('a', 'low'), false, 'the same model at the same effort raises nothing')
})

test('LOCAL-1 the model list opens with "Local model (free, coming soon)": greyed out, never selectable, never sent', () => {
  const fill = html.slice(html.indexOf('if (!sm.options.length) {'), html.indexOf('if (!stratDirty)'))
  assert.match(fill, /sm\.append\(el\('option', \{ value: '', disabled: true, text: 'Local model \(free, coming soon\)' \}\)\)\s*\n\s*for \(const m of i\.models\)/, 'the first entry of the list, disabled, with no model id')
  // Apply sends a model only when it is one of the server's list.
  const apply = html.slice(html.indexOf("$('stratApply').onclick"), html.indexOf("$('stratApply').onclick") + 700)
  assert.match(apply, /if \(!S\.instance\.models\.some\(m => m\.id === body\.model\)\) \{ toast\('Pick a model from the list', true\); return false \}/)
  assert.ok(apply.indexOf('S.instance.models.some') < apply.indexOf("api('POST', '/api/strategist'"), 'checked before anything is sent')
  const tip = html.match(/k_strat: \['Strategist', `([^`]*)`/)?.[1] ?? ''
  assert.match(tip, /A free model that runs on your own computer is being tested\. It is not ready, so it cannot be picked yet\./)
  assert.match(tip, /<b>Haiku 5\.5<\/b> is the cheapest, for trying things out: how well it plays this game has not been measured yet\./)
  assert.match(tip, /<b>Sonnet 5\.5<\/b> is the default and handles this game well/)
  assert.doesNotMatch(tip, /Sonnet 5<|Opus 5<|Fable 5\.1/, 'the bubble names no model that left the list')
  assert.doesNotMatch(tip, /—|, and |, or /)
})

test('LIST-11 every page that names the default or the list follows: Sonnet 5.5 the default, Haiku 5.5 the cheapest with nothing promised', () => {
  const read = (f: string) => readFileSync(join(REPO, f), 'utf8')
  const DOCS = 'site/src/content/docs'
  for (const f of ['README.md', 'INSTALL.md', `${DOCS}/help/costs.md`, `${DOCS}/start/keys.mdx`, 'src/web/dashboard.html']) {
    assert.match(read(f), /with the default model, effort and tick \(Sonnet 5\.5 at medium, a plan every 2 hours/, f)
    assert.doesNotMatch(read(f), /Sonnet 5 at medium/, f)
  }
  for (const f of [`${DOCS}/use/dashboard.md`, `${DOCS}/help/faq.md`]) {
    const text = read(f).replace(/\s+/g, ' ')
    assert.match(text, /Sonnet 5\.5 is the default and plays well/, f)
    assert.match(text, /Haiku 5\.5 is the cheapest, for trying things out: how well it plays this game has not been measured yet/, f)
    assert.doesNotMatch(text, /Sonnet 5 is the default/, f)
  }
  assert.match(read(`${DOCS}/use/dashboard.md`).replace(/\s+/g, ' '), /The entry "Local model \(free, coming soon\)" at the top of the list cannot be picked: a free model that runs on your own computer is being tested and is not ready\./)
})
