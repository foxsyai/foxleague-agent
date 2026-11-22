// The owner's model list of 2026-11-11: four models to choose from (Haiku 5.5, Sonnet 5.5, Opus 5.5, Fable 5.2), a
// price for every model a request can be served by, the models that left the list moved to their successors, and
// Claude Haiku 5.5 with its two rate cards. Each test was seen failing on 7f5d434 before the code changed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
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
  assert.deepEqual(MODELS['claude-haiku-5-5'], { label: 'Haiku 5.5', maxOutput: 128_000, price: [0.1, 0.5, 0.01], long: { over: 100_000, price: [0.5, 2.5, 0.05] } })
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

test('LIST-6 a new install plays on Haiku 5.5 (Sonnet 5.5 until DEF-1 of 2026-11-20): the default when AGENT_MODEL is not set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-model-'))
  const env = { PATH: process.env.PATH!, HOME: dir, AGENT_ENV_FILE: join(dir, 'no-such.env'), AGENT_DATA_DIR: dir }
  const run = (more: Record<string, string> = {}) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', `const { loadConfig } = await import(${JSON.stringify(join(REPO, 'src/config.ts'))}); console.log(loadConfig().model)`], { env: { ...env, ...more }, cwd: dir, encoding: 'utf8', timeout: 60_000 })
  assert.equal(run().stdout.trim(), 'claude-haiku-5-5')
  assert.equal(run({ AGENT_MODEL: 'claude-opus-5-5' }).stdout.trim(), 'claude-opus-5-5', 'the owner\'s choice in the env file still wins')
  assert.match(readFileSync(join(REPO, '.env.example'), 'utf8'), /^AGENT_MODEL=claude-haiku-5-5$/m)
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
    for (const model of ['claude-sonnet-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-opus-4-8', 'local', 'Local model (coming soon)', '', 'constructor', '__proto__']) {
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

test('LIST-10 the dashboard asks for the password by the server\'s rule, two cards included', () => {
  const models = Object.entries(MODELS).map(([id, m]) => {
    const cards = [m.price, ...((m as Rates).long ? [(m as Rates).long!.price] : [])]
    return { id, label: m.label, price: m.price, cheapest: [0, 1, 2].map(i => Math.min(...cards.map(c => c[i]!))), dearest: [0, 1, 2].map(i => Math.max(...cards.map(c => c[i]!))) }
  })
  const efforts = ['low', 'medium', 'high', 'xhigh', 'max']
  for (const cur of [...Object.keys(MODELS), 'claude-mystery-9']) {
    for (const effort of ['low', 'high']) {
      const costsMore = pageFunctions<(model: string, effort: string) => boolean>(['wakesShadow', 'aiCostsMore'], { instance: { model: cur, effort, models, efforts } })
      for (const pick of Object.keys(MODELS)) {
        for (const to of ['low', 'high']) assert.equal(costsMore(pick, to), web.raisesAiSpend({ model: cur, effort }, { model: pick, effort: to as 'low' }), `${cur} ${effort} to ${pick} ${to}`)
      }
    }
  }
  // A model whose dearer card is above the current model's price asks, although its first card is cheaper.
  const two = [{ id: 'a', label: 'A', price: [1, 5, 0.1], cheapest: [1, 5, 0.1], dearest: [3, 15, 0.3] }, { id: 'b', label: 'B', price: [2, 10, 0.2], cheapest: [2, 10, 0.2], dearest: [2, 10, 0.2] }]
  const from = (model: string) => pageFunctions<(model: string, effort: string) => boolean>(['wakesShadow', 'aiCostsMore'], { instance: { model, effort: 'low', models: two, efforts } })
  assert.equal(from('b')('a', 'low'), true, 'the long prompt of A costs more than B')
  assert.equal(from('a')('b', 'low'), true, 'B costs more than the short prompt of A')
  assert.equal(from('a')('a', 'low'), false, 'the same model at the same effort raises nothing')
})

test('LOCAL-1 the model list opens with "Local model (coming soon)": greyed out, never selectable, never sent (no "free": the owner, 2026-11-22)', () => {
  const fill = html.slice(html.indexOf('if (!sm.options.length) {'), html.indexOf('if (!stratDirty)'))
  assert.match(fill, /sm\.append\(el\('option', \{ value: '', disabled: true, text: 'Local model \(coming soon\)' \}\)\)\s*\n\s*for \(const m of i\.models\)/, 'the first entry of the list, disabled, with no model id')
  // Apply sends a model only when it is one of the server's list.
  const apply = html.slice(html.indexOf("$('stratApply').onclick"), html.indexOf("$('stratApply').onclick") + 1000)
  assert.match(apply, /if \(!S\.instance\.models\.some\(m => m\.id === body\.model\)\) \{ toast\('Pick a model from the list', true\); return false \}/)
  assert.ok(apply.indexOf('S.instance.models.some') < apply.indexOf("api('POST', '/api/strategist'"), 'checked before anything is sent')
  const tip = html.match(/k_strat: \['Strategist', `([^`]*)`/)?.[1] ?? ''
  assert.match(tip, /The first entry, Local model, is greyed out\. A model that runs on your own computer is being tested\. It is not ready, so it cannot be picked yet\./)
  // Nothing that is not shipped is promised as free (the owner, 2026-11-22).
  assert.doesNotMatch(fill + tip.match(/<p>The first entry[^<]*<\/p>/)![0], /\bfree\b/i)
  assert.match(tip, /<b>Haiku 5\.5<\/b> at high effort is the default and plays well at the lowest cost\./)
  assert.match(tip, /<b>Sonnet 5\.5<\/b> plans more carefully and acts less/)
  assert.doesNotMatch(tip, /Sonnet 5<|Opus 5<|Fable 5\.1/, 'the bubble names no model that left the list')
  assert.doesNotMatch(tip, /—|, and |, or /)
})

test('LIST-11 every page that names the default or the list follows: Haiku 5.5 at high the default since DEF-1 (Sonnet 5.5 before)', () => {
  const read = (f: string) => readFileSync(join(REPO, f), 'utf8')
  const DOCS = 'site/src/content/docs'
  for (const f of ['README.md', 'INSTALL.md', `${DOCS}/help/costs.md`, `${DOCS}/start/keys.mdx`, 'src/web/dashboard.html']) {
    assert.match(read(f), /with the default model, effort and tick \(Haiku 5\.5 at high, a plan every 2 hours/, f)
    assert.doesNotMatch(read(f), /Sonnet 5 at medium/, f)
  }
  for (const f of [`${DOCS}/use/dashboard.md`, `${DOCS}/help/faq.md`]) {
    const text = read(f).replace(/\s+/g, ' ')
    assert.match(text, /Haiku 5\.5 at high effort is the default and plays well at the lowest cost/, f)
    assert.doesNotMatch(text, /Sonnet 5 is the default/, f)
  }
  assert.match(read(`${DOCS}/use/dashboard.md`).replace(/\s+/g, ' '), /The entry "Local model \(coming soon\)" at the top of the list cannot be picked: a model that runs on your own computer is being tested and is not ready\./)
})

// ---- the agent review of pull request #63 ----

/** Several functions of the dashboard's script together (one may call another), the last one returned. */
function pageFunctions<T>(names: string[], S: unknown): T {
  const src = names.map(name => {
    const found = html.match(new RegExp(`\\nfunction ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0]
    assert.ok(found, `the dashboard defines ${name}()`)
    return found
  })
  return new Function('S', `${src.join('\n')}; return ${names.at(-1)}`)(S) as T
}

test('R63A-1 a switch that wakes a resting shadow model asks for the password: on the server', async () => {
  const wakes = (web as unknown as { wakesShadow?: (shadows: readonly string[], current: string, next: string) => boolean }).wakesShadow
  assert.equal(typeof wakes, 'function', 'server.ts exports wakesShadow')
  // The shadow model rests only while it is the model that plays; a switch to any other model starts it.
  assert.equal(wakes!(['claude-fable-5-2'], 'claude-fable-5-2', 'claude-haiku-5-5'), true)
  assert.equal(wakes!(['claude-fable-5-2'], 'claude-fable-5-2', 'claude-fable-5-2'), false, 'the effort alone never wakes it')
  assert.equal(wakes!(['claude-fable-5-2'], 'claude-sonnet-5-5', 'claude-haiku-5-5'), false, 'it runs already and keeps running')
  assert.equal(wakes!(['claude-fable-5-2'], 'claude-sonnet-5-5', 'claude-fable-5-2'), false, 'this switch turns it off')
  assert.equal(wakes!([], 'claude-fable-5-2', 'claude-haiku-5-5'), false, 'no shadow model is set')
  assert.equal(wakes!(['claude-opus-5-5'], 'claude-opus-5', 'claude-haiku-5-5'), true, 'a current model that left the list counts as its successor')

  const { svc, server, password, post, state } = await webService(store => store.setKv('shadow_model', 'claude-fable-5-2'))
  const playing = () => [svc.strategist?.model, svc.strategist?.effort]
  const shadowModels = async () => ((await state()).instance as unknown as { shadowModels?: string[]; shadowModel?: unknown })
  try {
    // The owner moved the playing model to Fable 5.2 with the password: the shadow, set to the same model, rests.
    svc.setStrategist('claude-fable-5-2', 'medium', 'test')
    assert.deepEqual((await shadowModels()).shadowModels, ['claude-fable-5-2'], 'the page is told which shadow models are set')
    assert.equal('shadowModel' in (await shadowModels()), false, 'one field, the list')
    // Each of these is cheaper on every price, and from then on every plan would also pay a Fable 5.2 shadow plan.
    for (const model of ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']) {
      const res = await post('/api/strategist', { model, effort: 'low' })
      assert.equal(res.status, 403, `${model} was switched on with one click and woke the Fable 5.2 shadow`)
      assert.deepEqual(playing(), ['claude-fable-5-2', 'medium'])
    }
    // The effort alone never wakes it: less effort on the same model stays one click.
    let res = await post('/api/strategist', { model: 'claude-fable-5-2', effort: 'low' })
    assert.equal(res.status, 200, await res.text())
    res = await post('/api/strategist', { model: 'claude-haiku-5-5', effort: 'low', password: 'wrong' })
    assert.equal(res.status, 403)
    res = await post('/api/strategist', { model: 'claude-haiku-5-5', effort: 'low', password })
    assert.equal(res.status, 200, await res.text())
    // The shadow runs now and keeps running: the rule is the prices and the effort, as before.
    res = await post('/api/strategist', { model: 'claude-sonnet-5-5', effort: 'low' })
    assert.equal(res.status, 403, 'dearer than Haiku 5.5')
    res = await post('/api/strategist', { model: 'claude-sonnet-5-5', effort: 'low', password })
    assert.equal(res.status, 200, await res.text())
    res = await post('/api/strategist', { model: 'claude-haiku-5-5', effort: 'low' })
    assert.equal(res.status, 200, 'cheaper, and the shadow ran before and runs after: one click')
    // A switch to the shadow's own model turns the shadow off: judged by the playing model's prices, here dearer.
    res = await post('/api/strategist', { model: 'claude-fable-5-2', effort: 'low' })
    assert.equal(res.status, 403)
    // A cheap shadow model: the switch to it turns the shadow off and is cheaper, one click. Away from it wakes it.
    svc.store.setKv('shadow_model', 'claude-haiku-5-5')
    svc.setStrategist('claude-sonnet-5-5', 'low', 'test')
    res = await post('/api/strategist', { model: 'claude-haiku-5-5', effort: 'low' })
    assert.equal(res.status, 200, await res.text())
    // No shadow model set (or "off", or one the list does not have): nothing to wake.
    for (const setting of ['off', '', 'gpt-oss']) {
      svc.store.setKv('shadow_model', setting)
      svc.setStrategist('claude-fable-5-2', 'low', 'test')
      assert.deepEqual((await shadowModels()).shadowModels, [], `shadow_model "${setting}"`)
      res = await post('/api/strategist', { model: 'claude-opus-5-5', effort: 'low' })
      assert.equal(res.status, 200, `shadow_model "${setting}": ${await res.text()}`)
    }
    // The environment's shadow model counts like the database's.
    svc.store.db.prepare("DELETE FROM kv WHERE key = 'shadow_model'").run()
    const prev = process.env.AGENT_SHADOW_MODEL
    process.env.AGENT_SHADOW_MODEL = 'claude-fable-5-2'
    try {
      svc.setStrategist('claude-fable-5-2', 'low', 'test')
      res = await post('/api/strategist', { model: 'claude-opus-5-5', effort: 'low' })
      assert.equal(res.status, 403, 'AGENT_SHADOW_MODEL rests and would wake')
    } finally {
      if (prev === undefined) delete process.env.AGENT_SHADOW_MODEL
      else process.env.AGENT_SHADOW_MODEL = prev
    }
  } finally {
    server.close()
  }
})

// The owner, 2026-11-12: several shadow models at once. Rule 7 with a list: the switch needs the password when it
// makes a shadow model run that rested before it.
test('SHADOWS-9 several shadow models: a switch that wakes the one that rested asks for the password, also a switch to another model of the list', async () => {
  const wakes = (web as unknown as { wakesShadow: (shadows: readonly string[], current: string, next: string) => boolean }).wakesShadow
  const [haiku, sonnet, opus, fable] = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-2'] as const
  assert.equal(wakes([haiku, fable], fable, sonnet), true, 'the second entry rested and wakes')
  assert.equal(wakes([fable, haiku], fable, sonnet), true, 'whatever the order')
  assert.equal(wakes([haiku, fable], fable, haiku), true, 'to another model of the list: that one goes to rest, but Fable 5.2 wakes')
  assert.equal(wakes([haiku, fable], haiku, fable), true, 'and the other way')
  assert.equal(wakes([haiku, fable], sonnet, opus), false, 'both ran before and run after')
  assert.equal(wakes([haiku, fable], sonnet, haiku), false, 'one goes to rest and none wakes')
  assert.equal(wakes([haiku, fable], fable, fable), false, 'the effort alone never wakes one')
  assert.equal(wakes([haiku, opus], 'claude-opus-5', sonnet), true, 'a current model that left the list counts as its successor')
  assert.equal(wakes([haiku, sonnet, opus, fable], opus, sonnet), true, 'every model of the list set: any switch wakes the one that played')

  const { svc, server, password, post, state } = await webService(store => store.setKv('shadow_model', `${haiku}, ${fable}`))
  const playing = () => [svc.strategist?.model, svc.strategist?.effort]
  const told = async () => ((await state()).instance as unknown as { shadowModels?: string[] }).shadowModels
  try {
    // Fable 5.2 plays: of the two shadow models only Haiku 5.5 runs, Fable 5.2 rests.
    svc.setStrategist(fable, 'medium', 'test')
    assert.deepEqual(await told(), [haiku, fable], 'the page is told the list')
    // Each of these is cheaper on every price. Each would wake the Fable 5.2 shadow, Haiku 5.5 too although it is
    // a shadow model itself and goes to rest with the switch.
    for (const model of [sonnet, opus, haiku]) {
      const refused = await post('/api/strategist', { model, effort: 'low' })
      assert.equal(refused.status, 403, `${model} was switched on with one click and woke the Fable 5.2 shadow`)
      assert.deepEqual(playing(), [fable, 'medium'])
    }
    let res = await post('/api/strategist', { model: haiku, effort: 'low', password: 'wrong' })
    assert.equal(res.status, 403)
    res = await post('/api/strategist', { model: fable, effort: 'low' })
    assert.equal(res.status, 200, `less effort on the same model stays one click: ${await res.text()}`)
    res = await post('/api/strategist', { model: opus, effort: 'low', password })
    assert.equal(res.status, 200, await res.text())
    // Opus 5.5 plays and both shadow models run. To Sonnet 5.5 both keep running: cheaper, one click.
    res = await post('/api/strategist', { model: sonnet, effort: 'low' })
    assert.equal(res.status, 200, `both ran before and run after: ${await res.text()}`)
    // To Haiku 5.5: it goes to rest and nothing wakes. Cheaper, one click.
    res = await post('/api/strategist', { model: haiku, effort: 'low' })
    assert.equal(res.status, 200, await res.text())
    assert.deepEqual(playing(), [haiku, 'low'])
    // The setting written the other way round, with an id the list does not have and a repeated one: the same rule.
    svc.store.setKv('shadow_model', `gpt-oss,${opus} , ${haiku},${opus}`)
    svc.setStrategist(opus, 'low', 'test')
    assert.deepEqual(await told(), [opus, haiku])
    res = await post('/api/strategist', { model: sonnet, effort: 'low' })
    assert.equal(res.status, 403, 'Sonnet 5.5 is cheaper than Opus 5.5, and the Opus 5.5 shadow would wake')
    res = await post('/api/strategist', { model: haiku, effort: 'low' })
    assert.equal(res.status, 403, 'Haiku 5.5 is cheaper and goes to rest, and the Opus 5.5 shadow would wake')
    assert.deepEqual(playing(), [opus, 'low'])
    // "off" anywhere in the setting: no shadow model is set, nothing to wake.
    svc.store.setKv('shadow_model', `${opus}, off`)
    assert.deepEqual(await told(), [])
    res = await post('/api/strategist', { model: sonnet, effort: 'low' })
    assert.equal(res.status, 200, await res.text())
    // The environment's list counts like the database's.
    svc.store.db.prepare("DELETE FROM kv WHERE key = 'shadow_model'").run()
    const prev = process.env.AGENT_SHADOW_MODEL
    process.env.AGENT_SHADOW_MODEL = `${haiku},${sonnet}`
    try {
      assert.deepEqual(await told(), [haiku, sonnet])
      res = await post('/api/strategist', { model: haiku, effort: 'low' })
      assert.equal(res.status, 403, 'AGENT_SHADOW_MODEL: the Sonnet 5.5 shadow rests and would wake')
    } finally {
      if (prev === undefined) delete process.env.AGENT_SHADOW_MODEL
      else process.env.AGENT_SHADOW_MODEL = prev
    }
    // No route sets the shadow models or their effort: not the strategist's, not the keys', not an agent's settings.
    res = await post('/api/strategist', { model: sonnet, effort: 'low', shadow_model: fable, shadowModels: [fable], shadow_effort: 'max', password })
    assert.equal(res.status, 200, await res.text())
    assert.deepEqual(svc.store.kvWithPrefix('shadow'), [], 'a web request wrote a shadow setting')
  } finally {
    server.close()
  }
  // Nor does any code of the agent: the two settings are written on the machine only (docs/SERVER.md).
  const files = (readdirSync(join(REPO, 'src'), { recursive: true }) as string[]).filter(f => /\.(ts|html)$/.test(f))
  assert.ok(files.includes(join('web', 'server.ts')) && files.includes('service.ts') && files.includes(join('telegram', 'telegram.ts')), 'the sources were read')
  for (const f of files) assert.doesNotMatch(readFileSync(join(REPO, 'src', f), 'utf8'), /setKv\(\s*['"`]shadow_(model|effort)/, `src/${f} writes a shadow setting`)
})

test('R63A-1 the dashboard asks for the password in the same cases, so the owner never meets a bare refusal', () => {
  const wakes = (web as unknown as { wakesShadow: (shadows: readonly string[], current: string, next: string) => boolean }).wakesShadow
  const models = Object.keys(MODELS).map(id => ({ id, label: MODELS[id]!.label, price: MODELS[id]!.price, ...strategist.priceRange(id)! }))
  const efforts = ['low', 'medium', 'high', 'xhigh', 'max']
  const ids = Object.keys(MODELS)
  // No shadow model, each one alone, and several at once: two, three and all four.
  const sets: string[][] = [[], ...ids.map(id => [id]), [ids[0]!, ids[3]!], [ids[3]!, ids[0]!], [ids[0]!, ids[1]!], [ids[1]!, ids[2]!, ids[3]!], [...ids]]
  let woken = 0, wokenByAList = 0
  for (const shadowModels of sets) {
    for (const cur of ids) {
      for (const effort of ['low', 'high']) {
        const costsMore = pageFunctions<(model: string, effort: string) => boolean>(['wakesShadow', 'aiCostsMore'], { instance: { model: cur, effort, models, efforts, shadowModels } })
        for (const pick of ids) {
          for (const to of ['low', 'high']) {
            const raises = web.raisesAiSpend({ model: cur, effort }, { model: pick, effort: to as 'low' })
            assert.equal(costsMore(pick, to), raises || wakes(shadowModels, cur, pick), `shadow ${shadowModels.join('+') || 'none'}, ${cur} ${effort} to ${pick} ${to}`)
            if (wakes(shadowModels, cur, pick) && !raises) {
              woken++
              if (shadowModels.length > 1) wokenByAList++
            }
          }
        }
      }
    }
  }
  assert.ok(woken > 0, 'some switches ask for the password only because they wake the shadow')
  assert.ok(wokenByAList > 0, 'also with several shadow models set')
  // The password dialog says why, and the bubble names the case.
  const text = pageFunctions<(model: string) => string>(['wakesShadow', 'aiRaiseText'], { instance: { model: 'claude-fable-5-2', effort: 'low', models, efforts, shadowModels: ['claude-fable-5-2'] } })
  assert.equal(text('claude-haiku-5-5'), 'Shadow plans are set to Fable 5.2 on this computer. They rest while Fable 5.2 plays. With another model playing, every plan of every agent also pays for a shadow plan by Fable 5.2. Your password confirms it.')
  assert.match(text('claude-fable-5-2'), /^A model with a higher price or a higher effort costs more on every plan of every agent\./)
  // With several set, the dialog names them all and says which one wakes.
  const two = pageFunctions<(model: string) => string>(['wakesShadow', 'aiRaiseText'], { instance: { model: 'claude-fable-5-2', effort: 'low', models, efforts, shadowModels: ['claude-haiku-5-5', 'claude-fable-5-2'] } })
  assert.equal(two('claude-sonnet-5-5'), 'Shadow plans are set to Haiku 5.5 and Fable 5.2 on this computer. Those by Fable 5.2 rest while Fable 5.2 plays. With another model playing, every plan of every agent also pays for a shadow plan by Fable 5.2. Your password confirms it.')
  assert.equal(two('claude-haiku-5-5'), two('claude-sonnet-5-5'), 'the same when the pick is itself a shadow model')
  const three = pageFunctions<(model: string) => string>(['wakesShadow', 'aiRaiseText'], { instance: { model: 'claude-opus-5-5', effort: 'low', models, efforts, shadowModels: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'] } })
  assert.match(three('claude-sonnet-5-5'), /^Shadow plans are set to Haiku 5\.5, Sonnet 5\.5 and Opus 5\.5 on this computer\. Those by Opus 5\.5 rest while Opus 5\.5 plays\./)
  for (const said of [two('claude-sonnet-5-5'), three('claude-sonnet-5-5')]) assert.doesNotMatch(said, /—|, and |, or /)
  // A page that got no list (an older server's answer still in the tab) asks by the prices alone and does not break.
  const none = pageFunctions<(model: string, effort: string) => boolean>(['wakesShadow', 'aiCostsMore'], { instance: { model: 'claude-fable-5-2', effort: 'low', models, efforts } })
  assert.equal(none('claude-haiku-5-5', 'low'), false)
  const apply = html.slice(html.indexOf("$('stratApply').onclick"), html.indexOf("$('stratApply').onclick") + 900)
  // Since the agent review of PR #65 (R65A-6) the effort goes with the model: a lower effort can start an entry with one.
  assert.match(apply, /askPassword\(wakesShadow\(body\.model, body\.effort\) \? 'Start shadow plans' : 'Switch to a dearer AI', aiRaiseText\(body\.model, body\.effort\)\)/)
  const tip = html.match(/k_strat: \['Strategist', `([^`]*)`/)?.[1] ?? ''
  // The sentence joins the bubble only while shadow plans are set on this install (TEXT-1).
  assert.match(html, /k_strat: '<p>A switch that starts shadow plans asks for your password too: a shadow model set on the server rests while it is the model that plays\.<\/p>'/)
  assert.doesNotMatch(tip, /—|, and |, or /)
})
