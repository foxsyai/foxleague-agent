// DEF-1 (the owner's decision of 2026-11-20): Claude Haiku 5.5 at high effort is the AI of a new install. Before it a
// new install played Sonnet 5.5 at medium (AGENT_MODEL's default and the effort strategistChoice falls back to) and
// every level recommended Opus 5.5 at high. Sonnet 5.5, Opus 5.5 and Fable 5.2 stay choices.
//
// The effort nobody chose is high only with the model nobody chose: an install that named a model (AGENT_MODEL, or
// the dashboard's Strategist box) without an effort keeps medium, what earlier versions played it at, so the update
// raises no one's effort. The password rule is unchanged: from the default a dearer model or a higher effort asks.
// Each test failed on main 62f06c0 before the change.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Config } from '../../src/config.ts'
import { Store } from '../../src/store/db.ts'
import { DEFAULT_AI, LEVEL_AI } from '../../src/store/settings.ts'
import { EFFORTS, MODELS, SUCCESSORS, strategistChoice, type Effort } from '../../src/strategist/strategist.ts'
import { Sessions, hashPassword } from '../../src/web/auth.ts'
import * as web from '../../src/web/server.ts'

const REPO = resolve(import.meta.dirname, '../..')
const read = (f: string) => readFileSync(join(REPO, f), 'utf8')
const flat = (f: string) => read(f).replace(/\s+/g, ' ')
const HAIKU = 'claude-haiku-5-5'
const SONNET = 'claude-sonnet-5-5'
const OPUS = 'claude-opus-5-5'
const FABLE = 'claude-fable-5-2'

/**
 * The model and effort a fresh install plays: its own process, with no env file, no database choice and only the
 * variables given, as the service reads them (loadConfig, then strategistChoice on an empty database).
 */
function fresh(more: Record<string, string> = {}): { model: string; effort: string } {
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-def1-'))
  const env = { PATH: process.env.PATH!, HOME: dir, AGENT_ENV_FILE: join(dir, 'no-such.env'), AGENT_DATA_DIR: dir, ...more }
  const code = [
    `const { loadConfig } = await import(${JSON.stringify(join(REPO, 'src/config.ts'))})`,
    `const { Store } = await import(${JSON.stringify(join(REPO, 'src/store/db.ts'))})`,
    `const { strategistChoice } = await import(${JSON.stringify(join(REPO, 'src/strategist/strategist.ts'))})`,
    `console.log(JSON.stringify(strategistChoice(new Store('', ':memory:'), loadConfig(), () => undefined)))`,
  ].join('\n')
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', code], { env, cwd: dir, encoding: 'utf8', timeout: 60_000 })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout.trim()) as { model: string; effort: string }
}

test('DEF-1 a new install plays Haiku 5.5 at high effort when nothing names a model or an effort', () => {
  assert.deepEqual(fresh(), { model: HAIKU, effort: 'high' }, 'no AGENT_MODEL, no AGENT_MODEL_EFFORT, nothing picked in the dashboard')
  // An effort named in the env file wins, as before.
  assert.deepEqual(fresh({ AGENT_MODEL_EFFORT: 'low' }), { model: HAIKU, effort: 'low' })
  assert.deepEqual(fresh({ AGENT_MODEL: OPUS, AGENT_MODEL_EFFORT: 'xhigh' }), { model: OPUS, effort: 'xhigh' })
  // A model named without an effort keeps medium, what it played at before this version: the update raises no effort.
  for (const model of [HAIKU, SONNET, OPUS, FABLE]) assert.deepEqual(fresh({ AGENT_MODEL: model }), { model, effort: 'medium' }, `AGENT_MODEL=${model} alone`)
  // The settings template names the same pair.
  const example = read('.env.example')
  assert.match(example, /^AGENT_MODEL=claude-haiku-5-5$/m)
  assert.match(example, /^AGENT_MODEL_EFFORT=high$/m)
})

test('DEF-1 a model saved in the dashboard without an effort keeps medium: the update raises no effort of a model picked there', () => {
  // The low of the re-review of PR #82: a model saved in the database names the model too (the first clause of
  // modelNamed in strategistChoice). Only that clause holds here: no AGENT_MODEL, cfg.model the default.
  const saved = { model: process.env.AGENT_MODEL, effort: process.env.AGENT_MODEL_EFFORT }
  delete process.env.AGENT_MODEL
  delete process.env.AGENT_MODEL_EFFORT
  try {
    const cfg = { model: DEFAULT_AI.model } as Config
    const choose = (kept: string) => {
      const store = new Store('', ':memory:')
      store.setKv('strategist_model', kept)
      return strategistChoice(store, cfg, () => undefined)
    }
    // Every model of the list, the default one too: medium, what it played before this version.
    for (const model of Object.keys(MODELS)) assert.deepEqual(choose(model), { model, effort: 'medium' }, `${model} saved, no effort saved`)
    // A model that left the list runs its successor, still a model that was picked.
    for (const [old, next] of Object.entries(SUCCESSORS)) assert.deepEqual(choose(old), { model: next, effort: 'medium' }, `${old} saved, no effort saved`)
    // A saved id nobody knows is never used: the install plays the default pair, as one that picked nothing.
    assert.deepEqual(choose('claude-mystery-9'), { model: HAIKU, effort: 'high' })
  } finally {
    for (const [k, v] of [['AGENT_MODEL', saved.model], ['AGENT_MODEL_EFFORT', saved.effort]] as const) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
})

test('DEF-1 every level recommends Haiku 5.5 at high effort, the pair a new install starts on', () => {
  for (const [level, ai] of Object.entries(LEVEL_AI)) assert.deepEqual(ai, { model: HAIKU, effort: 'high' }, level)
  // The line next to the level picker on a fresh install (no AI key yet): the recommendation and the pair the agents
  // start on are the same, so it says so instead of naming two pairs.
  const html = read('src/web/dashboard.html')
  const found = html.match(/\nfunction renderAiHint\([^)]*\) \{[\s\S]*?\n\}/)?.[0]
  assert.ok(found, 'the dashboard defines renderAiHint()')
  const said: string[] = []
  const box = { hidden: false, replaceChildren: () => undefined, append: (...a: unknown[]) => void said.push(...a.map(String)) }
  const models = Object.entries(MODELS).map(([id, m]) => ({ id, label: m.label }))
  const S = { instance: { model: null, effort: null, aiAll: fresh(), models, levelAi: LEVEL_AI } }
  const render = new Function('S', '$', 'agent', 'el', `${found}; return renderAiHint`)(S, () => box, () => null, () => null) as (k: string) => void
  render('zeus')
  assert.equal(said.join(''), 'Recommended AI for this level: Haiku 5.5 at high effort. The agents play it once the AI key is set.')
  // The levels page gives the same row (its own test ties the row to LEVEL_AI).
  const row = read('site/src/content/docs/play/strategy-levels.md').split('\n').find(l => l.startsWith('| Recommended AI |'))
  assert.equal(row, `| Recommended AI |${' Haiku 5.5, high |'.repeat(6)}`)
})

function testConfig(dir: string, model: string): Config {
  return {
    mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: 'sk-ant-not-a-real-key-for-this-test-only', model, telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config
}

test('DEF-1 the password rule around the default: Sonnet, Opus and Fable from it ask, the default itself never asks', async () => {
  const def = fresh()
  const pair = (model: string, effort: string) => ({ model, effort: effort as Effort })
  const follower = [{ settings: { aiModel: '', aiEffort: '' }, shadows: [] as string[] }]
  // From the default to a dearer model asks at every effort, for all agents and for one agent.
  for (const model of [SONNET, OPUS, FABLE]) {
    for (const effort of EFFORTS) {
      assert.equal(web.raisesAiSpend(def, pair(model, effort)), true, `${def.model} at ${def.effort} to ${model} at ${effort}`)
      assert.equal(web.allAgentsAiNeedsPassword(def, pair(model, effort), follower), true, `all agents: ${model} at ${effort}`)
      assert.equal(web.agentAiNeedsPassword(def, pair(model, effort), []), true, `one agent: ${model} at ${effort}`)
    }
  }
  // A higher effort on the default model asks; a lower one is one click.
  for (const effort of EFFORTS) assert.equal(web.raisesAiSpend(def, pair(def.model, effort)), EFFORTS.indexOf(effort) > EFFORTS.indexOf(def.effort as Effort), `${def.model} at ${effort}`)
  // The default itself never asks: picked again, or from any model of the list at its effort or above.
  assert.equal(web.allAgentsAiNeedsPassword(def, def, follower), false)
  assert.equal(web.agentAiNeedsPassword(def, def, []), false)
  for (const model of Object.keys(MODELS)) {
    for (const effort of EFFORTS.slice(EFFORTS.indexOf(def.effort as Effort))) {
      assert.equal(web.raisesAiSpend(pair(model, effort), pair(def.model, def.effort)), false, `${model} at ${effort} to the default`)
    }
  }

  // The route the Strategist box calls, with the strategist on the default pair as a new install starts it.
  const saved = { model: process.env.AGENT_MODEL, effort: process.env.AGENT_MODEL_EFFORT }
  delete process.env.AGENT_MODEL
  delete process.env.AGENT_MODEL_EFFORT
  const { Service } = await import('../../src/service.ts')
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-def1-web-'))
  const svc = new Service(testConfig(dir, def.model))
  svc.ensureAgents()
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
    assert.deepEqual({ model: svc.strategist?.model, effort: svc.strategist?.effort }, def, 'the strategist starts on the default pair')
    let res = await post(def)
    assert.equal(res.status, 200, `the default itself without the password: ${await res.text()}`)
    for (const model of [SONNET, OPUS]) {
      res = await post({ model, effort: def.effort })
      assert.equal(res.status, 403, `${model} from the default without the password`)
      assert.equal(svc.strategist?.model, def.model, 'nothing changed')
    }
    res = await post({ model: SONNET, effort: def.effort, password })
    assert.equal(res.status, 200, await res.text())
    assert.equal(svc.strategist?.model, SONNET)
    // Back to the default is one click.
    res = await post(def)
    assert.equal(res.status, 200, await res.text())
    assert.equal(svc.strategist?.model, def.model)
  } finally {
    server.close()
    for (const [k, v] of [['AGENT_MODEL', saved.model], ['AGENT_MODEL_EFFORT', saved.effort]] as const) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
})

test('DEF-1 every page that names the default or the recommended AI says Haiku 5.5 at high, and when to pick a dearer model', () => {
  const DOCS = 'site/src/content/docs'
  // The cost of a day at the defaults names the default pair.
  for (const f of ['README.md', 'INSTALL.md', `${DOCS}/help/costs.md`, `${DOCS}/start/keys.mdx`, 'src/web/dashboard.html']) {
    assert.match(flat(f), /for a single agent with the default model, effort and tick \(Haiku 5\.5 at high, a plan every 2 hours/, f)
    assert.match(flat(f), /Sonnet, Opus, Fable and a higher effort cost more for the same plan/, f)
  }
  // The pages that say which model to pick: the default, and one sentence on when a dearer one fits.
  const bubble = read('src/web/dashboard.html').match(/k_strat: \['Strategist', `([^`]*)`/)?.[1]?.replace(/<\/?b>/g, '').replace(/\s+/g, ' ') ?? ''
  for (const [f, text] of [[`${DOCS}/help/faq.md`, flat(`${DOCS}/help/faq.md`)], [`${DOCS}/use/dashboard.md`, flat(`${DOCS}/use/dashboard.md`)], ['the Strategist bubble', bubble]] as const) {
    assert.match(text, /Haiku 5\.5 at high effort is the default and plays well at the lowest cost\./, f)
    assert.match(text, /Sonnet 5\.5 plans more carefully and acts less; Opus 5\.5 is the most active and costs the most of the three\./, f)
    assert.match(text, /Fable 5\.2, the most capable, costs more still\./, f)
    assert.doesNotMatch(text, /Sonnet 5\.5 is the default|for trying things out|has not been measured/, f)
    const said = text.slice(text.indexOf('Haiku 5.5 at high effort is the default'), text.indexOf('costs more still.'))
    assert.doesNotMatch(said, /—|, and |, or /, `${f}: no em dash, no Oxford comma`)
  }
  assert.match(flat(`${DOCS}/use/dashboard.md`), /the model and effort the agents start on once the key is set \(Haiku 5\.5 at high on a new install\)/)
  // The server guide names the old default once, as what an install that chose nothing moves from.
  assert.match(flat('docs/SERVER.md'), /`AGENT_MODEL` and `AGENT_MODEL_EFFORT`: the AI the agents play until a model is picked in the dashboard's Strategist box\. Without them Haiku 5\.5 at high effort, the default of a new install; an install that set neither and picked nothing in the dashboard moves to it from Sonnet 5\.5 at medium with this version, which lowers what it spends\. A model named here without an effort plays at medium, as before, so an update raises no effort\./)
  // No page keeps the old default.
  for (const f of ['README.md', 'INSTALL.md', '.env.example', 'docs/ECONOMY-AND-RULES.md', 'src/web/dashboard.html', 'src/config.ts', `${DOCS}/help/costs.md`, `${DOCS}/help/faq.md`, `${DOCS}/start/keys.mdx`, `${DOCS}/use/dashboard.md`, `${DOCS}/play/strategy-levels.md`, 'site/scripts/screenshots.ts', 'site/scripts/videos/src/capture.mjs']) {
    assert.doesNotMatch(flat(f), /Sonnet 5\.5 at medium|Sonnet 5\.5 is the default|Opus 5\.5, high|'claude-sonnet-5-5'/, f)
  }
})
