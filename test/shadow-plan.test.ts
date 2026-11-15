// Shadow plans (the owner, 2026-11-11): right after an agent's real plan the service sends the very same request to a
// second model and only records what that model would have done. These are the safety tests: a shadow plan is never
// executed, never shown to the playing model and never changes what the agents play by. Each was seen failing on
// f316c94 (the commit before the shadow code) for the reason its name gives.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Config } from '../src/config.ts'
import type { PlannedAction } from '../src/executor/actions.ts'
import type { Service } from '../src/service.ts'
import { MODELS, type Strategist } from '../src/strategist/strategist.ts'
import { Store } from '../src/store/db.ts'
import { snapshot } from './fixtures.ts'

const REPO = resolve(import.meta.dirname, '..')
const PLAYING = 'claude-sonnet-5-5'
const SHADOW = 'claude-haiku-5-5'
/** A second shadow model next to Haiku 5.5 (the owner, 2026-11-12: several shadow models at once). */
const THIRD = 'claude-opus-5-5'
const BOTH = `${SHADOW}, ${THIRD}`

function testConfig(dir: string): Config {
  return {
    mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: 'sk-ant-not-a-real-key-for-this-test-only', model: PLAYING, telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config
}

type Request = { model: string; system: { text: string; cache_control?: unknown }[]; messages: { role: string; content: string }[]; tools: unknown[]; tool_choice: unknown; thinking: unknown; output_config: unknown; max_tokens: number; fallbacks?: unknown }
type Answer = (p: Request, o: { signal?: AbortSignal }) => unknown

/** What Anthropic answers with a submit_plan call: 1,000 tokens in and 200 out. */
const planned = (model: string, summary: string, actions: unknown[]) => ({
  model, stop_reason: 'tool_use', usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  content: [{ type: 'tool_use', id: 't', name: 'submit_plan', input: { summary, actions: actions.map(action => ({ action, reason: 'because' })) } }],
})
const REAL_ACTIONS = [{ type: 'sync' }, { type: 'play_match', match_type: 'casual' }]
/** The shadow proposes what the real plan does not: a bid. */
const SHADOW_BID = { type: 'bid', nonce: 4242, foxsy: 777 }
const realAnswer = () => planned(PLAYING, 'REALMARKER sync, then a casual game.', REAL_ACTIONS)
const shadowAnswer = () => planned(SHADOW, 'SHADOWMARKER bid on the striker.', [SHADOW_BID, { type: 'sync' }, { type: 'fly_to_the_moon' }])

type Inner = {
  shadows: Map<unknown, Promise<void>>
  shadowTimeoutMs: number
  shadowStrategistFor(model: string, effort: string): Strategist
  busy: Set<number>
  nextAt: Map<number, number>
}

/**
 * A service whose two strategists talk to one fake Anthropic client (it answers by the model asked and keeps every
 * request), with the executor replaced by a recorder: what reaches `executor.run` is what would be checked, booked,
 * simulated or signed.
 */
async function service(o: { shadow?: string; effort?: string; real?: Answer; shadowAnswers?: Answer } = {}) {
  const { Service } = await import('../src/service.ts')
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-shadow-'))))
  svc.ensureAgents()
  if (o.shadow !== undefined) svc.store.setKv('shadow_model', o.shadow)
  if (o.effort !== undefined) svc.store.setKv('shadow_effort', o.effort)
  const inner = svc as unknown as Inner
  const requests: Request[] = []
  const signals: (AbortSignal | undefined)[] = []
  const client = {
    beta: { messages: { stream: (p: Request, opts: { signal?: AbortSignal }) => ({ finalMessage: async () => {
      requests.push(p)
      if (p.model !== PLAYING) signals.push(opts.signal)
      return p.model === PLAYING ? (o.real ?? realAnswer)(p, opts) : (o.shadowAnswers ?? shadowAnswer)(p, opts)
    } }) } },
  }
  ;(svc.strategist as unknown as { client: unknown }).client = client
  // The service makes its own strategist per shadow model; only their connections are replaced.
  const set = (o.shadow ?? '').split(',').map(id => id.trim()).filter(id => Object.hasOwn(MODELS, id) && id !== PLAYING)
  for (const id of set) (inner.shadowStrategistFor(id, o.effort ?? 'medium') as unknown as { client: unknown }).client = client
  const second = set.includes(SHADOW) ? inner.shadowStrategistFor(SHADOW, o.effort ?? 'medium') : null
  const ran: PlannedAction[][] = []
  const told: string[] = []
  Object.assign(svc as object, {
    schedule: () => undefined,
    notify: (t: string) => void told.push(t),
    inActiveHours: () => true,
    waitingForFunds: () => null,
    retryPending: async () => undefined,
    noticeInvitations: async () => undefined,
    snapshot: async () => snapshot(),
    pause: async () => undefined,
  })
  ;(svc.executor as unknown as { run: unknown }).run = async (_a: unknown, _w: unknown, _s: unknown, actions: PlannedAction[]) => {
    ran.push(actions)
    return actions.map(() => ({ status: 'dry_run', summary: 'DRY RUN ok' }))
  }
  /** Every shadow request that is still on its way has ended. */
  const settled = async () => { await Promise.all([...(inner.shadows?.values() ?? [])]) }
  const of = (model: string) => requests.filter(r => r.model === model)
  const rows = (kind?: string) => svc.store.activity(0, 200).filter(r => !kind || r.kind === kind)
  const shadowPlans = () => (svc.store as unknown as { shadowPlans(i: number | null): { outcome: string; usd: number; ms: number; agentIndex: number; realModel: string; shadowModel: string; shadowEffort: string; real: { summary: string; actions: { ok: boolean; type: string | null; action: unknown; error?: string }[] }; shadow: { summary: string; actions: { ok: boolean; type: string | null; action: unknown; error?: string }[] }; inputTokens: number | null; outputTokens: number | null }[] }).shadowPlans(null)
  return { svc, inner, requests, signals, ran, told, settled, of, rows, shadowPlans, second, client }
}

const ranTypes = (ran: PlannedAction[][]) => ran.flat().map(p => p.action.type)
const spendRows = (svc: Service) => Number((svc.store.db.prepare('SELECT COUNT(*) AS n FROM spend').get() as { n: number }).n)
/** What a tick leaves behind for the agents to play by, the shadow's own rows left out. */
const played = (m: Awaited<ReturnType<typeof service>>) => ({
  ran: m.ran.map(a => a.map(p => ({ action: p.action, reason: p.reason }))),
  rows: m.rows().filter(r => r.kind !== 'shadow').map(r => ({ kind: r.kind, status: r.status, summary: r.summary })).reverse(),
  lastPlan: m.svc.store.getKv('last_plan_0'),
  killSwitch: m.svc.store.killSwitch,
  spend: spendRows(m.svc),
  chat: m.svc.store.getKv('chat'),
})

test('SHADOW-1 (a) the executor gets exactly the real plan\'s actions: what the shadow proposes is never run, booked or simulated, only recorded', async () => {
  const m = await service({ shadow: SHADOW })
  assert.equal(await m.svc.tick(0), 'REALMARKER sync, then a casual game.')
  await m.settled()
  // Both models were asked, once each, and the executor saw only the playing model's plan.
  assert.deepEqual(m.requests.map(r => r.model).sort(), [SHADOW, PLAYING])
  assert.deepEqual(m.ran.map(a => a.map(p => p.action)), [[{ type: 'sync' }], [{ type: 'play_match', match_type: 'casual' }]], 'one action at a time, as the real plan gave them')
  assert.equal(ranTypes(m.ran).includes('bid'), false, 'the shadow\'s bid reached the executor')
  assert.equal(m.rows('bid').length, 0, 'no activity of the bid')
  assert.equal(spendRows(m.svc), 0, 'nothing booked')
  // The very same request: system text, the user's text and the tools; its own model, no server-side fallback.
  const [real] = m.of(PLAYING), [shadow] = m.of(SHADOW)
  assert.equal(shadow!.system[0]!.text, real!.system[0]!.text, 'the same system text')
  assert.deepEqual(shadow!.messages, real!.messages, 'the same user request')
  assert.deepEqual(shadow!.tools, real!.tools, 'the same tools')
  assert.deepEqual([shadow!.tool_choice, shadow!.thinking, shadow!.output_config, shadow!.max_tokens], [{ type: 'auto' }, { type: 'adaptive' }, { effort: 'medium' }, 16_000])
  assert.equal(shadow!.fallbacks, undefined)
  assert.match(real!.messages[0]!.content, /<<<SNAPSHOT[\s\S]*SNAPSHOT>>>\n\nCall submit_plan now\.$/)
  // A second strategist of its own: nothing of the playing one's state (fallback memory, cache decision) is shared.
  assert.notEqual(m.second, m.svc.strategist)
  assert.equal(m.svc.strategist!.model, PLAYING)
  assert.equal(m.second!.model, SHADOW)
  for (const field of ['noFallback', 'cachedAt']) assert.notEqual((m.second as unknown as Record<string, unknown>)[field], (m.svc.strategist as unknown as Record<string, unknown>)[field], field)
  // One activity row, clearly a shadow plan, with each action marked by what parseAction said.
  const row = m.rows('shadow')
  assert.equal(row.length, 1)
  assert.deepEqual([row[0]!.status, row[0]!.agentIndex, row[0]!.txHash, row[0]!.costUsd], ['info', 0, null, null])
  assert.match(row[0]!.summary, /^shadow plan by Haiku 5\.5 \(medium\), \$0\.0002, \d+ s: SHADOWMARKER bid on the striker\. \[\{"ok":true,"action":\{"type":"bid","nonce":4242,"foxsy":777\}\},\{"ok":true,"action":\{"type":"sync"\}\},\{"error":"[^"]*fly_to_the_moon[^"]*","action":\{"type":"fly_to_the_moon"\}\}\]$/)
  // The structured copy: both plans as parsed, the models, the tokens, the cost and the time.
  const [kept] = m.shadowPlans()
  assert.deepEqual([kept!.agentIndex, kept!.realModel, kept!.shadowModel, kept!.shadowEffort, kept!.outcome, kept!.inputTokens, kept!.outputTokens], [0, PLAYING, SHADOW, 'medium', 'plan', 1000, 200])
  assert.deepEqual(kept!.real.actions.map(a => [a.ok, a.type]), [[true, 'sync'], [true, 'play_match']])
  assert.deepEqual(kept!.shadow.actions.map(a => [a.ok, a.type]), [[true, 'bid'], [true, 'sync'], [false, 'fly_to_the_moon']])
  assert.match(kept!.real.summary, /^REALMARKER/)
  assert.match(kept!.shadow.summary, /^SHADOWMARKER/)
  assert.ok(Math.abs(kept!.usd - 0.0002) < 1e-12, 'Haiku 5.5: 1,000 tokens in and 200 out')
  // The bill the owner sees stays true: both requests are in the AI spend.
  assert.ok(Math.abs(Number(m.svc.store.getKv('model_usd_total')) - (0.004 + 0.0002)) < 1e-12, m.svc.store.getKv('model_usd_total'))
  assert.ok(Math.abs(Object.values(m.svc.modelUsdByDay()).reduce((a, b) => a + b, 0) - 0.0042) < 1e-12)
})

test('SHADOW-2 (b) a shadow that throws, hangs past its time or answers garbage changes nothing of the tick, the plan\'s run or the next tick', async t => {
  const unhandled: unknown[] = []
  const onUnhandled = (err: unknown) => void unhandled.push(err)
  process.on('unhandledRejection', onUnhandled)
  t.after(() => process.off('unhandledRejection', onUnhandled))
  const control = await service()
  const result = await control.svc.tick(0)
  const expected = played(control)
  assert.deepEqual(expected.ran.flat().map(p => p.action.type), ['sync', 'play_match'])

  const cases: [string, Answer, RegExp][] = [
    ['throws', () => { throw new Error('boom from the shadow') }, /^shadow plan by Haiku 5\.5 \(medium\), \$0\.0000, \d+ s: error: boom from the shadow$/],
    ['rejects like the API', async () => { throw Object.assign(new Error('overloaded'), { status: 529 }) }, /: error: overloaded$/],
    ['answers text, no tool call', () => ({ model: SHADOW, stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 200 }, content: [{ type: 'text', text: 'I would rather not.' }] }), /^shadow plan by Haiku 5\.5 \(medium\), \$0\.0002, \d+ s: no plan submitted: I would rather not\.$/],
    ['answers a tool call of garbage', () => ({ model: SHADOW, stop_reason: 'tool_use', usage: { input_tokens: 1000, output_tokens: 200 }, content: [{ type: 'tool_use', id: 't', name: 'submit_plan', input: { summary: { nested: true }, actions: [null, 7, { action: 'bid everything' }, { action: { type: 'bid', nonce: -1, foxsy: 1e99 } }] } }] }), /\[\{"error":"[^"]+","action":null\},\{"error"/],
    ['answers no message at all', () => ({ nothing: true }), /: error: /],
    ['is declined', () => ({ model: SHADOW, stop_reason: 'refusal', stop_details: { category: 'cyber' }, usage: { input_tokens: 1000, output_tokens: 0 }, content: [] }), /: model declined to plan \(cyber\)$/],
    ['is cut off', () => ({ model: SHADOW, stop_reason: 'max_tokens', usage: { input_tokens: 1000, output_tokens: 16000 }, content: [{ type: 'tool_use', id: 't', name: 'submit_plan', input: { summary: 'half', actions: [{ action: SHADOW_BID, reason: '' }] } }] }), /: plan truncated at max_tokens; nothing executed$/],
    ['hangs', () => new Promise(() => undefined), /^shadow plan by Haiku 5\.5 \(medium\), \$0\.0000, \d+ s: no answer within 1 s; given up$/],
  ]
  for (const [name, answer, line] of cases) {
    const m = await service({ shadow: SHADOW, shadowAnswers: answer })
    m.inner.shadowTimeoutMs = 1000
    const before = m.inner.nextAt.get(0)
    assert.equal(await m.svc.tick(0), result, `${name}: the tick's answer`)
    // The tick is over while the shadow may still be on its way: the agent is free for its next tick.
    assert.equal(m.inner.busy.has(0), false, `${name}: the agent is not held`)
    assert.equal(m.svc.tickRefusal(0), null, `${name}: the next tick would start`)
    assert.equal(m.inner.nextAt.get(0), before, `${name}: the schedule is as it was`)
    await m.settled()
    assert.deepEqual(played(m), expected, `${name}: the same actions ran and the same rows were written`)
    assert.equal(m.of(SHADOW).length, 1, `${name}: asked once, never again`)
    const [row] = m.rows('shadow')
    assert.match(row!.summary, line, `${name}: ${row!.summary}`)
    assert.equal(row!.status, 'info')
    assert.equal(m.shadowPlans().length, 1)
    assert.equal(m.rows('tick').filter(r => r.status === 'error').length, 0, `${name}: no failed tick`)
    assert.equal(m.told.some(x => /kill switch|internal error/.test(x)), false)
    // A second tick right away plans and runs as ever.
    assert.equal(await m.svc.tick(0), result, `${name}: the next tick`)
    await m.settled()
    assert.deepEqual(m.ran.flat().map(p => p.action.type), ['sync', 'play_match', 'sync', 'play_match'])
  }
  // A hung shadow is not asked again while it is still on its way: one request per agent at a time.
  const slow = await service({ shadow: SHADOW, shadowAnswers: () => new Promise(() => undefined) })
  slow.inner.shadowTimeoutMs = 60_000
  await slow.svc.tick(0)
  await slow.svc.tick(0)
  assert.equal(slow.of(PLAYING).length, 2)
  assert.equal(slow.of(SHADOW).length, 1)
  await slow.svc.stop()
  await new Promise(r => setTimeout(r, 20))
  assert.deepEqual(unhandled, [], 'a failed shadow request must never reach the service\'s panic handler (it turns the kill switch on)')
})

test('SHADOW-3 (c) nothing of a shadow plan is in the next real plan\'s request, in the saved last plan or in the chat', async () => {
  const m = await service({ shadow: SHADOW })
  await m.svc.tick(0)
  await m.settled()
  assert.equal(m.rows('shadow').length, 1)
  await m.svc.tick(0)
  await m.settled()
  const next = m.of(PLAYING)[1]!
  const text = `${next.system.map(s => s.text).join('\n')}\n${next.messages.map(x => x.content).join('\n')}`
  // The playing model reads its own previous plan in full and nothing of the shadow's.
  assert.match(text, /## Your previous plan \([^)]*in full\)[\s\S]*REALMARKER sync, then a casual game\./)
  assert.doesNotMatch(text, /SHADOWMARKER/)
  assert.doesNotMatch(next.messages[0]!.content, /shadow/i)
  assert.doesNotMatch(next.messages[0]!.content, /4242|fly_to_the_moon|Haiku/)
  // The second shadow request is again the second real request, word for word.
  assert.deepEqual(m.of(SHADOW)[1]!.messages, next.messages)
  assert.match(m.svc.store.getKv('last_plan_0')!, /^agent 1 plan: REALMARKER/)
  assert.doesNotMatch(m.svc.store.getKv('last_plan_0')!, /shadow|SHADOWMARKER/i)
  assert.equal(m.svc.store.getKv('chat'), undefined, 'the conversation with the owner is untouched')
  assert.equal(m.svc.chatLines().length, 0)
  assert.match(await m.svc.command('plan', ['1'], '1'), /^agent 1 plan: REALMARKER/)
  // Nothing an agent keeps per number was written for the shadow.
  assert.deepEqual(m.svc.store.kvWithPrefix('last_plan_').map(([k]) => k), ['last_plan_0'])
})

test('SHADOW-4 (d) with no shadow setting not one extra request is sent and nothing is written; an unknown model or the playing model means off, said once', async t => {
  const logged: string[] = []
  t.mock.method(console, 'log', (...a: unknown[]) => void logged.push(a.join(' ')))
  const off = await service()
  await off.svc.tick(0)
  await off.svc.tick(0)
  await off.settled()
  assert.deepEqual(off.requests.map(r => r.model), [PLAYING, PLAYING], 'one request per plan')
  assert.equal(off.rows('shadow').length, 0)
  assert.equal(off.shadowPlans().length, 0)
  assert.deepEqual(off.svc.store.kvWithPrefix('shadow'), [])
  assert.ok(Math.abs(Number(off.svc.store.getKv('model_usd_total')) - 0.008) < 1e-12)
  assert.equal(logged.some(l => /shadow/i.test(l)), false, 'nothing about shadow plans in the log')

  for (const [setting, why] of [[PLAYING, /shadow plans are off: claude-sonnet-5-5 is the model that plays/], ['claude-sonnet-5', /shadow plans are off: claude-sonnet-5 is not a model on the list/], ['gpt-oss', /shadow plans are off: gpt-oss is not a model on the list/], ['constructor', /shadow plans are off: constructor is not a model on the list/]] as const) {
    logged.length = 0
    const m = await service({ shadow: setting })
    await m.svc.tick(0)
    await m.svc.tick(0)
    await m.settled()
    assert.deepEqual(m.requests.map(r => r.model), [PLAYING, PLAYING], `${setting}: no shadow request`)
    assert.equal(m.rows('shadow').length, 0)
    assert.equal(logged.filter(l => why.test(l)).length, 1, `${setting}: said once, not at every plan: ${logged.join(' | ')}`)
  }

  // The environment is the fallback; the database's setting wins, and "off" there switches it off without a word.
  const prev = [process.env.AGENT_SHADOW_MODEL, process.env.AGENT_SHADOW_EFFORT]
  process.env.AGENT_SHADOW_MODEL = SHADOW
  process.env.AGENT_SHADOW_EFFORT = 'low'
  try {
    const env = await service()
    ;(env.inner.shadowStrategistFor(SHADOW, 'low') as unknown as { client: unknown }).client = (env.svc.strategist as unknown as { client: unknown }).client
    await env.svc.tick(0)
    await env.settled()
    assert.deepEqual(env.requests.map(r => r.model).sort(), [SHADOW, PLAYING])
    assert.deepEqual(env.of(SHADOW)[0]!.output_config, { effort: 'low' })
    assert.match(env.rows('shadow')[0]!.summary, /^shadow plan by Haiku 5\.5 \(low\)/)
    logged.length = 0
    env.svc.store.setKv('shadow_model', 'off')
    await env.svc.tick(0)
    await env.settled()
    assert.equal(env.of(SHADOW).length, 1, 'switched off in the database')
    assert.equal(logged.some(l => /shadow/i.test(l)), false)
    // An effort nobody knows falls back to medium, like the playing model's.
    env.svc.store.setKv('shadow_model', SHADOW)
    env.svc.store.setKv('shadow_effort', 'turbo')
    await env.svc.tick(0)
    await env.settled()
    assert.deepEqual(env.of(SHADOW)[1]!.output_config, { effort: 'medium' })
  } finally {
    for (const [i, k] of (['AGENT_SHADOW_MODEL', 'AGENT_SHADOW_EFFORT'] as const).entries()) {
      if (prev[i] === undefined) delete process.env[k]
      else process.env[k] = prev[i]
    }
  }
})

test('SHADOW-5 (e) a graceful stop does not wait for a shadow request, cancels it, and an answer that still arrives writes nothing', async () => {
  let release: (v: unknown) => void = () => undefined
  const m = await service({ shadow: SHADOW, shadowAnswers: () => new Promise(r => { release = r }) })
  m.inner.shadowTimeoutMs = 600_000
  await m.svc.tick(0)
  assert.equal(m.of(SHADOW).length, 1, 'the shadow request is on its way')
  assert.equal(m.signals[0]!.aborted, false)
  const before = { ...played(m), usd: m.svc.store.getKv('model_usd_total'), days: m.svc.store.getKv('model_usd_days') }
  const t0 = Date.now()
  await m.svc.stop()
  assert.ok(Date.now() - t0 < 1500, `the stop waited ${Date.now() - t0} ms`)
  assert.equal(m.signals[0]!.aborted, true, 'the request is cancelled with the stop')
  // The answer arrives after the stop (a client that ignores the cancel): a full plan with a bid.
  release(shadowAnswer())
  await m.settled()
  await new Promise(r => setTimeout(r, 20))
  assert.equal(m.rows('shadow').length, 0, 'no row after the stop')
  assert.equal(m.shadowPlans().length, 0)
  assert.deepEqual({ ...played(m), usd: m.svc.store.getKv('model_usd_total'), days: m.svc.store.getKv('model_usd_days') }, before, 'nothing was written after the stop')
  assert.equal(ranTypes(m.ran).includes('bid'), false)
  // And no shadow request starts once the service is stopping.
  assert.equal(await m.svc.tick(0), 'stopping')
  assert.equal(m.of(SHADOW).length, 1)
})

test('SHADOW-6 (f) rule 1: no path from a shadow plan\'s actions to the executor', async () => {
  const shadowSrc = readFileSync(join(REPO, 'src/strategist/shadow.ts'), 'utf8')
  // The module that reads a shadow plan knows nothing of the executor, the wallets or the chain.
  const imports = [...shadowSrc.matchAll(/^import [^\n]* from '([^']+)'/gm)].map(x => x[1]!)
  for (const from of imports) assert.doesNotMatch(from, /executor\/(executor|tx|rules|budget)|wallet|chain|service/, `shadow.ts imports ${from}`)
  assert.doesNotMatch(shadowSrc, /\bExecutor\b|runPlan|signTransaction|\.run\(/)
  // The service's shadow code: between its two functions and the end of the second one nothing names the executor,
  // a wallet, runPlan or a booking.
  const src = readFileSync(join(REPO, 'src/service.ts'), 'utf8')
  const from = src.indexOf('  private startShadow(')
  const to = src.indexOf('\n  /**', src.indexOf('  private async shadowPlan('))
  assert.ok(from > 0 && to > from, 'service.ts has startShadow and shadowPlan')
  const body = src.slice(from, to)
  assert.doesNotMatch(body, /executor|runPlan|wallet|recordSpend|PlannedAction|\.actions\b/, 'the shadow code touches the executor, a wallet, the ledger or a plan\'s actions')
  // What the service keeps of a shadow plan is a copy made of plain data, frozen, with no action object shared.
  const { recordPlan } = await import('../src/strategist/shadow.ts')
  const bid = { type: 'bid' as const, nonce: 4242, foxsy: 777 }
  const plan = { summary: 's', actions: [{ action: bid, reason: 'r' }], rejected: [{ raw: { type: 'x' }, error: 'unknown action type x' }], usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0, servedBy: SHADOW }, stopReason: 'tool_use' }
  const record = recordPlan(plan)
  assert.deepEqual(record.actions, [{ ok: true, type: 'bid', action: { type: 'bid', nonce: 4242, foxsy: 777 }, reason: 'r' }, { ok: false, type: 'x', action: { type: 'x' }, error: 'unknown action type x' }])
  assert.notEqual(record.actions[0]!.action, bid, 'the recorded action is a copy')
  assert.ok(Object.isFrozen(record) && Object.isFrozen(record.actions) && Object.isFrozen(record.actions[0]) && Object.isFrozen(record.actions[0]!.action))
  // @ts-expect-error a recorded action is not a planned action: the compiler refuses to hand one to the executor
  const refused: PlannedAction = record.actions[0]!
  void refused
  // In the tick, the shadow starts after the real plan's actions were handed to runPlan, and is never awaited.
  const tick = src.slice(src.indexOf('  async tick('), src.indexOf('  modelUsdByDay()'))
  assert.match(tick, /const running = this\.runPlan\(agent, plan\.actions, !ownerRequest, snap\)\n\s*(\/\/[^\n]*\n\s*)*this\.startShadow\(index, plan\)\n\s*await running\n/)
  assert.doesNotMatch(tick, /await this\.(startShadow|shadowPlan)/)
})

// Agent review of pull request #63 (low): the playing model and effort were read after the plan's answer came, so a
// switch made while the request was on its way put the new model's name on a plan the old one had made.
test('R63A-2 a model switch while the plan request is on its way: the record names the model that made the plan', async () => {
  let asked: () => void = () => undefined
  const onItsWay = new Promise<void>(r => { asked = r })
  let release: (v: unknown) => void = () => undefined
  const m = await service({ shadow: SHADOW, real: () => { asked(); return new Promise(r => { release = r }) } })
  const ticking = m.svc.tick(0)
  await onItsWay
  assert.equal(m.of(PLAYING).length, 1, 'the request went to Sonnet 5.5 at medium')
  assert.deepEqual(m.of(PLAYING)[0]!.output_config, { effort: 'medium' })
  // The owner switches the strategist in the dashboard before the answer is in.
  m.svc.setStrategist('claude-opus-5-5', 'high', 'test')
  release(realAnswer())
  await ticking
  await m.settled()
  const [kept] = m.shadowPlans() as unknown as { realModel: string; realEffort: string; shadowModel: string }[]
  assert.deepEqual([kept!.realModel, kept!.realEffort, kept!.shadowModel], [PLAYING, 'medium', SHADOW], 'the real plan was made by Sonnet 5.5 at medium')
  const { shadowReport } = await import('../src/strategist/shadow.ts')
  assert.match(shadowReport(m.svc.store.shadowPlans(null)), /^Models: Haiku 5\.5 \(medium\) next to Sonnet 5\.5 \(medium\)$/m)
  // Nor is the plan called a fallback because another model plays by now.
  assert.doesNotMatch(m.rows('plan')[0]!.summary, /fallback|served by/)
  // The switch holds from the next plan on, and its shadow plan is recorded next to Opus 5.5 at high.
  ;(m.svc.strategist as unknown as { client: unknown }).client = { beta: { messages: { stream: (p: Request) => ({ finalMessage: async () => (m.requests.push(p), p.model === 'claude-opus-5-5' ? planned('claude-opus-5-5', 'OPUS plan', REAL_ACTIONS) : shadowAnswer()) }) } } }
  await m.svc.tick(0)
  await m.settled()
  const [newest] = m.shadowPlans() as unknown as { realModel: string; realEffort: string }[]
  assert.deepEqual([newest!.realModel, newest!.realEffort], ['claude-opus-5-5', 'high'])
})

// ---- several shadow models at once (the owner, 2026-11-12) ----
// Each test below was seen failing on 858d007 (one shadow model only) for the reason its name gives.

const labelOf = (model: string) => MODELS[model]!.label
/** A shadow answer that names its own model, so each row can be told from the other. */
const answerBy = (p: Request) => planned(p.model, `SHADOWMARKER ${p.model} bids.`, [SHADOW_BID, { type: 'sync' }])
const rowBy = (m: Awaited<ReturnType<typeof service>>, model: string) => m.rows('shadow').filter(r => r.summary.startsWith(`shadow plan by ${labelOf(model)} (`))
/** Waits until `done` holds (a shadow request that answers while another one is still on its way). */
const until = async (done: () => boolean, what: string) => {
  for (let i = 0; i < 400 && !done(); i++) await new Promise(r => setTimeout(r, 5))
  assert.ok(done(), what)
}

test('SHADOWS-1 two shadow models: one real plan gets one shadow request per model, started together and not waited for, each with its own strategist, activity row, shadow_plans row and cost', async () => {
  const release: (() => void)[] = []
  const m = await service({ shadow: BOTH, shadowAnswers: p => new Promise(r => void release.push(() => r(answerBy(p)))) })
  assert.equal(await m.svc.tick(0), 'REALMARKER sync, then a casual game.')
  // The tick is over and both shadow requests are on their way: started together, neither waited for.
  assert.deepEqual(m.requests.map(r => r.model).sort(), [SHADOW, THIRD, PLAYING])
  assert.equal(m.inner.busy.has(0), false, 'the agent is not held')
  assert.equal(m.rows('shadow').length, 0)
  for (const go of release) go()
  await m.settled()
  // The executor saw the playing model's plan and nothing else.
  assert.deepEqual(m.ran.map(a => a.map(p => p.action)), [[{ type: 'sync' }], [{ type: 'play_match', match_type: 'casual' }]])
  assert.equal(ranTypes(m.ran).includes('bid'), false, 'a shadow\'s bid reached the executor')
  assert.equal(spendRows(m.svc), 0, 'nothing booked')
  // Each shadow model got the real plan's request word for word, at the one shadow effort.
  const [real] = m.of(PLAYING)
  for (const model of [SHADOW, THIRD]) {
    const asked = m.of(model)
    assert.equal(asked.length, 1, `${model}: asked once`)
    assert.equal(asked[0]!.system[0]!.text, real!.system[0]!.text, `${model}: the same system text`)
    assert.deepEqual(asked[0]!.messages, real!.messages, `${model}: the same user request`)
    assert.deepEqual(asked[0]!.tools, real!.tools, `${model}: the same tools`)
    assert.deepEqual(asked[0]!.output_config, { effort: 'medium' })
  }
  // A strategist object of its own per shadow model: nothing shared with the playing one or with each other, sent once.
  const a = m.inner.shadowStrategistFor(SHADOW, 'medium'), b = m.inner.shadowStrategistFor(THIRD, 'medium')
  assert.notEqual(a, b, 'one strategist object served both shadow models')
  assert.deepEqual([a.model, b.model, m.svc.strategist!.model], [SHADOW, THIRD, PLAYING])
  for (const s of [a, b]) {
    assert.notEqual(s, m.svc.strategist)
    assert.equal((s as unknown as { retries: number }).retries, 0)
  }
  for (const field of ['noFallback', 'cachedAt']) {
    const held = (s: unknown) => (s as Record<string, unknown>)[field]
    assert.equal(new Set([held(a), held(b), held(m.svc.strategist)]).size, 3, field)
  }
  // One activity row per shadow model, each clearly a shadow plan.
  assert.equal(m.rows('shadow').length, 2)
  for (const model of [SHADOW, THIRD]) {
    const [row, ...more] = rowBy(m, model)
    assert.equal(more.length, 0, `${model}: one row`)
    assert.deepEqual([row!.status, row!.agentIndex, row!.txHash, row!.costUsd], ['info', 0, null, null])
    assert.ok(row!.summary.includes(`SHADOWMARKER ${model} bids.`), row!.summary)
  }
  // One shadow_plans row per shadow model, next to the same recorded real plan.
  const kept = m.shadowPlans()
  assert.deepEqual(kept.map(k => k.shadowModel).sort(), [SHADOW, THIRD])
  assert.deepEqual(kept.map(k => [k.agentIndex, k.realModel, k.shadowEffort, k.outcome, k.inputTokens, k.outputTokens]), [[0, PLAYING, 'medium', 'plan', 1000, 200], [0, PLAYING, 'medium', 'plan', 1000, 200]])
  assert.deepEqual(kept[0]!.real, kept[1]!.real, 'the same real plan on both rows')
  assert.match(kept[0]!.real.summary, /^REALMARKER/)
  const usdOf = (model: string) => kept.find(k => k.shadowModel === model)!.usd
  assert.ok(Math.abs(usdOf(SHADOW) - 0.0002) < 1e-12, 'Haiku 5.5: 1,000 tokens in and 200 out')
  assert.ok(Math.abs(usdOf(THIRD) - 0.008) < 1e-12, 'Opus 5.5: 1,000 tokens in and 200 out')
  // The bill the owner sees stays true: the real plan and each shadow plan are in the AI spend.
  assert.ok(Math.abs(Number(m.svc.store.getKv('model_usd_total')) - (0.004 + 0.0002 + 0.008)) < 1e-12, m.svc.store.getKv('model_usd_total'))
  assert.ok(Math.abs(Object.values(m.svc.modelUsdByDay()).reduce((x, y) => x + y, 0) - 0.0122) < 1e-12)
})

test('SHADOWS-2 the setting: one id as before, several separated by commas; an unknown id is left out with its reason, the playing model rests, a repeated id counts once, one effort for all', async () => {
  const shadow = (await import('../src/strategist/shadow.ts')) as unknown as {
    shadowChoices?: (store: Store, playing: string) => { models: string[]; effort: string; leftOut: string[] }
    shadowModelsSet?: (store: Store) => string[]
  }
  assert.equal(typeof shadow.shadowChoices, 'function', 'shadow.ts exports shadowChoices')
  assert.equal(typeof shadow.shadowModelsSet, 'function', 'shadow.ts exports shadowModelsSet')
  assert.equal('shadowChoice' in shadow || 'shadowModelSet' in shadow, false, 'one way to read the setting, not two')
  const store = new Store('', ':memory:')
  const choices = (setting: string, playing = PLAYING) => {
    store.setKv('shadow_model', setting)
    return shadow.shadowChoices!(store, playing)
  }
  const LIST = '(claude-haiku-5-5, claude-sonnet-5-5, claude-opus-5-5, claude-fable-5-2)'
  const prev = [process.env.AGENT_SHADOW_MODEL, process.env.AGENT_SHADOW_EFFORT]
  delete process.env.AGENT_SHADOW_MODEL
  delete process.env.AGENT_SHADOW_EFFORT
  try {
    const none = { models: [], effort: 'medium', leftOut: [] }
    assert.deepEqual(shadow.shadowChoices!(store, PLAYING), none, 'nothing set')
    assert.deepEqual(shadow.shadowModelsSet!(store), [])
    // One id, as saved on a server that ran one shadow model: exactly as before.
    assert.deepEqual(choices(SHADOW), { models: [SHADOW], effort: 'medium', leftOut: [] })
    assert.deepEqual(shadow.shadowModelsSet!(store), [SHADOW])
    // Several, with or without spaces around the commas, in the order written.
    for (const setting of [`${SHADOW},${THIRD}`, BOTH, `  ${SHADOW} ,   ${THIRD}  `, `${SHADOW},,${THIRD},`, `\t${SHADOW}\n,${THIRD}`]) {
      assert.deepEqual(choices(setting), { models: [SHADOW, THIRD], effort: 'medium', leftOut: [] }, JSON.stringify(setting))
      assert.deepEqual(shadow.shadowModelsSet!(store), [SHADOW, THIRD], JSON.stringify(setting))
    }
    assert.deepEqual(choices(`${THIRD}, ${SHADOW}`).models, [THIRD, SHADOW])
    // An id the list does not have is left out with its reason; the others still run.
    const odd = choices(`gpt-oss, ${SHADOW}, claude-sonnet-5, ${THIRD}`)
    assert.deepEqual(odd.models, [SHADOW, THIRD])
    assert.deepEqual(odd.leftOut, [`gpt-oss is not a model on the list ${LIST}`, `claude-sonnet-5 is not a model on the list ${LIST}`])
    assert.deepEqual(shadow.shadowModelsSet!(store), [SHADOW, THIRD], 'the web rule reads the models of the list only')
    for (const proto of ['constructor', '__proto__', 'toString']) assert.deepEqual(choices(`${proto}, ${SHADOW}`).models, [SHADOW], proto)
    // The model that plays rests; the other runs. Under another playing model both run.
    const rests = choices(`${SHADOW}, ${PLAYING}`)
    assert.deepEqual(rests.models, [SHADOW])
    assert.deepEqual(rests.leftOut, ['claude-sonnet-5-5 is the model that plays, and a shadow plan needs another one'])
    assert.deepEqual(choices(`${SHADOW}, ${PLAYING}`, THIRD), { models: [SHADOW, PLAYING], effort: 'medium', leftOut: [] })
    assert.deepEqual(shadow.shadowModelsSet!(store), [SHADOW, PLAYING], 'what is set, whatever model plays')
    assert.deepEqual(choices(PLAYING), { models: [], effort: 'medium', leftOut: ['claude-sonnet-5-5 is the model that plays, and a shadow plan needs another one'] })
    // A repeated id counts once, said nowhere.
    assert.deepEqual(choices(`${SHADOW}, ${THIRD},${SHADOW} , ${SHADOW}`), { models: [SHADOW, THIRD], effort: 'medium', leftOut: [] })
    assert.deepEqual(shadow.shadowModelsSet!(store), [SHADOW, THIRD])
    assert.equal(choices('gpt-oss, gpt-oss').leftOut.length, 1)
    // Empty or "off" means none, without a word; "off" anywhere in a list switches all of it off.
    for (const setting of ['', '   ', 'off', 'OFF', ' Off ', ',', ' , ,', `${SHADOW}, off`, `off,${SHADOW},${THIRD}`]) {
      assert.deepEqual(choices(setting), none, JSON.stringify(setting))
      assert.deepEqual(shadow.shadowModelsSet!(store), [], JSON.stringify(setting))
    }
    // A setting typed by hand: only what a model id can hold reaches the log, and no more than 60 characters of it.
    const typed = choices(`${SHADOW}, bad\u001b[31mid <script> x, ${'z'.repeat(200)}, claude haiku`)
    assert.deepEqual(typed.models, [SHADOW])
    assert.equal(typed.leftOut.length, 3)
    assert.match(typed.leftOut[0]!, /^bad\?\?31mid\?\?script\?\?x is not a model on the list \(/)
    assert.match(typed.leftOut[1]!, /^z{60} is not a model on the list \(/)
    assert.match(typed.leftOut[2]!, /^claude\?haiku is not a model on the list \(/)
    for (const why of typed.leftOut) assert.match(why, /^[\w.:?-]+ is not a model on the list \([\w, .:-]+\)$/)
    // A long list of nonsense cannot fill the log: the first 16 entries are read.
    const many = choices(`${Array.from({ length: 500 }, (_v, i) => `nope-${i}`).join(',')},${SHADOW}`)
    assert.deepEqual(many.models, [], 'an entry after the sixteenth is not read')
    assert.equal(many.leftOut.length, 17)
    assert.equal(many.leftOut[16], '485 more entries are not read (16 at most)')
    assert.deepEqual(shadow.shadowModelsSet!(store), [], 'the web rule reads the same entries')
    // One effort for every shadow model; one nobody knows means medium.
    store.setKv('shadow_effort', 'low')
    assert.deepEqual(choices(BOTH), { models: [SHADOW, THIRD], effort: 'low', leftOut: [] })
    store.setKv('shadow_effort', 'turbo')
    assert.equal(choices(BOTH).effort, 'medium')
    store.setKv('shadow_effort', ' high ')
    assert.equal(choices(BOTH).effort, 'high')
    // The environment is the fallback, with the same reading; the database's setting wins.
    const envOnly = new Store('', ':memory:')
    process.env.AGENT_SHADOW_MODEL = ` ${THIRD} , ${SHADOW}, gpt-oss`
    process.env.AGENT_SHADOW_EFFORT = 'xhigh'
    assert.deepEqual(shadow.shadowChoices!(envOnly, PLAYING), { models: [THIRD, SHADOW], effort: 'xhigh', leftOut: [`gpt-oss is not a model on the list ${LIST}`] })
    assert.deepEqual(shadow.shadowModelsSet!(envOnly), [THIRD, SHADOW])
    envOnly.setKv('shadow_model', 'off')
    assert.deepEqual(shadow.shadowChoices!(envOnly, PLAYING).models, [])
    assert.deepEqual(shadow.shadowModelsSet!(envOnly), [])
  } finally {
    for (const [i, k] of (['AGENT_SHADOW_MODEL', 'AGENT_SHADOW_EFFORT'] as const).entries()) {
      if (prev[i] === undefined) delete process.env[k]
      else process.env[k] = prev[i]
    }
  }
})

test('SHADOWS-3 in the service: an unknown id in the list is left out and said once while the other runs; the playing model in the list rests and the other runs; a repeated id runs once', async t => {
  const logged: string[] = []
  t.mock.method(console, 'log', (...a: unknown[]) => void logged.push(a.join(' ')))
  const cases: [string, string[], RegExp | null][] = [
    [`gpt-oss, ${SHADOW}`, [SHADOW], /shadow plans run by claude-haiku-5-5 only: gpt-oss is not a model on the list \(claude-haiku-5-5, claude-sonnet-5-5, claude-opus-5-5, claude-fable-5-2\)$/],
    [`${PLAYING}, ${THIRD}`, [THIRD], /shadow plans run by claude-opus-5-5 only: claude-sonnet-5-5 is the model that plays, and a shadow plan needs another one$/],
    [`${SHADOW}, ${SHADOW},${SHADOW}`, [SHADOW], null],
    [`${SHADOW}, nope, ${THIRD}, ${PLAYING}`, [SHADOW, THIRD], /shadow plans run by claude-haiku-5-5, claude-opus-5-5 only: nope is not a model on the list \([^)]*\); claude-sonnet-5-5 is the model that plays, and a shadow plan needs another one$/],
    [`nope, ${PLAYING}`, [], /shadow plans are off: nope is not a model on the list \([^)]*\); claude-sonnet-5-5 is the model that plays, and a shadow plan needs another one$/],
  ]
  for (const [setting, run, said] of cases) {
    logged.length = 0
    const m = await service({ shadow: setting, shadowAnswers: answerBy })
    await m.svc.tick(0)
    await m.settled()
    await m.svc.tick(0)
    await m.settled()
    assert.deepEqual(m.requests.map(r => r.model).sort(), [...run, ...run, PLAYING, PLAYING].sort(), `${setting}: each running shadow model asked once per plan`)
    assert.equal(m.rows('shadow').length, 2 * run.length, setting)
    for (const model of run) assert.equal(rowBy(m, model).length, 2, `${setting}: ${model}`)
    assert.deepEqual(m.shadowPlans().map(k => k.shadowModel).sort(), [...run, ...run].sort())
    if (said) assert.equal(logged.filter(l => said.test(l)).length, 1, `${setting}: said once, not at every plan: ${logged.join(' | ')}`)
    else assert.equal(logged.some(l => /shadow/i.test(l)), false, `${setting}: nothing to say: ${logged.join(' | ')}`)
    // The setting is read before every plan: corrected on the machine, nothing more is said and both run.
    logged.length = 0
    m.svc.store.setKv('shadow_model', BOTH)
    ;(m.inner.shadowStrategistFor(SHADOW, 'medium') as unknown as { client: unknown }).client = m.client
    ;(m.inner.shadowStrategistFor(THIRD, 'medium') as unknown as { client: unknown }).client = m.client
    await m.svc.tick(0)
    await m.settled()
    assert.deepEqual([m.of(SHADOW).length, m.of(THIRD).length], [(run.includes(SHADOW) ? 2 : 0) + 1, (run.includes(THIRD) ? 2 : 0) + 1], `${setting}: then both`)
    assert.equal(logged.some(l => /shadow/i.test(l)), false)
  }
})

test('SHADOWS-4 one shadow model that throws or never answers does not stop the other, changes nothing of the tick and sets no kill switch', async t => {
  const unhandled: unknown[] = []
  const onUnhandled = (err: unknown) => void unhandled.push(err)
  process.on('unhandledRejection', onUnhandled)
  t.after(() => process.off('unhandledRejection', onUnhandled))
  const control = await service()
  const result = await control.svc.tick(0)
  const expected = played(control)
  const cases: [string, Answer, RegExp][] = [
    ['throws', () => { throw new Error('boom from the shadow') }, /^shadow plan by Haiku 5\.5 \(medium\), \$0\.0000, \d+ s: error: boom from the shadow$/],
    ['rejects like the API', async () => { throw Object.assign(new Error('overloaded'), { status: 529 }) }, /: error: overloaded$/],
    ['hangs', () => new Promise(() => undefined), /^shadow plan by Haiku 5\.5 \(medium\), \$0\.0000, \d+ s: no answer within 1 s; given up$/],
  ]
  for (const [name, fails, line] of cases) {
    // Whichever of the two is written first in the setting.
    for (const setting of [BOTH, `${THIRD},${SHADOW}`]) {
      const m = await service({ shadow: setting, shadowAnswers: (p, o) => (p.model === SHADOW ? fails(p, o) : answerBy(p)) })
      m.inner.shadowTimeoutMs = 1000
      assert.equal(await m.svc.tick(0), result, `${name}: the tick's answer`)
      assert.equal(m.inner.busy.has(0), false, `${name}: the agent is not held`)
      await m.settled()
      assert.deepEqual(played(m), expected, `${name}: the same actions ran and the same rows were written`)
      assert.deepEqual([m.of(SHADOW).length, m.of(THIRD).length], [1, 1], `${name}: each asked once, never again`)
      // The one that failed is recorded as such; the other one's plan is recorded in full.
      assert.match(rowBy(m, SHADOW)[0]!.summary, line, `${name}: ${rowBy(m, SHADOW)[0]!.summary}`)
      assert.ok(rowBy(m, THIRD)[0]!.summary.includes(`SHADOWMARKER ${THIRD} bids.`), `${name}: the other shadow plan is missing`)
      assert.deepEqual(m.shadowPlans().map(k => [k.shadowModel, k.outcome]).sort(), [[SHADOW, name === 'hangs' ? 'timeout' : 'error'], [THIRD, 'plan']])
      assert.equal(m.svc.store.killSwitch, false, `${name}: the kill switch`)
      assert.equal(m.rows('tick').filter(r => r.status === 'error').length, 0, `${name}: no failed tick`)
      assert.equal(m.told.some(x => /kill switch|internal error/.test(x)), false)
      // Only what answered is in the AI spend: the real plan and the Opus 5.5 shadow plan.
      assert.ok(Math.abs(Number(m.svc.store.getKv('model_usd_total')) - (0.004 + 0.008)) < 1e-12, `${name}: ${m.svc.store.getKv('model_usd_total')}`)
      // The next tick plans, runs and asks both again.
      assert.equal(await m.svc.tick(0), result, `${name}: the next tick`)
      await m.settled()
      assert.deepEqual(m.ran.flat().map(p => p.action.type), ['sync', 'play_match', 'sync', 'play_match'])
      assert.deepEqual([m.of(SHADOW).length, m.of(THIRD).length], [2, 2])
    }
  }
  await new Promise(r => setTimeout(r, 20))
  assert.deepEqual(unhandled, [], 'a failed shadow request must never reach the service\'s panic handler (it turns the kill switch on)')
})

test('SHADOWS-5 the guard is per agent and per shadow model: a model still on its way is not asked again, and it blocks neither another model nor another agent', async () => {
  const m = await service({ shadow: BOTH, shadowAnswers: p => (p.model === SHADOW ? new Promise(() => undefined) : answerBy(p)) })
  m.inner.shadowTimeoutMs = 60_000
  try {
    await m.svc.tick(0)
    await until(() => rowBy(m, THIRD).length === 1, 'the Opus 5.5 shadow plan of the first tick is recorded')
    // Haiku 5.5 has not answered. The next plan asks Opus 5.5 again and leaves Haiku 5.5 alone.
    await m.svc.tick(0)
    await until(() => rowBy(m, THIRD).length === 2, 'a slow shadow model blocked the other model\'s next shadow plan')
    assert.deepEqual([m.of(PLAYING).length, m.of(SHADOW).length, m.of(THIRD).length], [2, 1, 2])
    assert.equal(rowBy(m, SHADOW).length, 0)
    // Another agent's plan asks both: the first agent's slow request is its own.
    m.svc.store.addAgent(1, (m.svc as unknown as { wallet(i: number): { address: string } }).wallet(1).address)
    await m.svc.tick(1)
    await until(() => m.svc.store.activity(1, 50).filter(r => r.kind === 'shadow').length === 1, 'the second agent\'s Opus 5.5 shadow plan is recorded')
    assert.deepEqual([m.of(PLAYING).length, m.of(SHADOW).length, m.of(THIRD).length], [3, 2, 3])
  } finally {
    // Ends the requests that never answer, whatever failed above.
    await m.svc.stop()
  }
})

test('SHADOWS-6 a graceful stop waits for no shadow request, cancels each of them, and answers that still arrive write nothing', async () => {
  const release: (() => void)[] = []
  const m = await service({ shadow: BOTH, shadowAnswers: p => new Promise(r => void release.push(() => r(answerBy(p)))) })
  m.inner.shadowTimeoutMs = 600_000
  await m.svc.tick(0)
  assert.deepEqual([m.of(SHADOW).length, m.of(THIRD).length], [1, 1], 'both shadow requests are on their way')
  assert.deepEqual(m.signals.map(s => s!.aborted), [false, false])
  const before = { ...played(m), usd: m.svc.store.getKv('model_usd_total'), days: m.svc.store.getKv('model_usd_days') }
  const t0 = Date.now()
  await m.svc.stop()
  assert.ok(Date.now() - t0 < 1500, `the stop waited ${Date.now() - t0} ms`)
  assert.deepEqual(m.signals.map(s => s!.aborted), [true, true], 'each request is cancelled with the stop')
  for (const go of release) go()
  await m.settled()
  await new Promise(r => setTimeout(r, 20))
  assert.equal(m.rows('shadow').length, 0, 'no row after the stop')
  assert.equal(m.shadowPlans().length, 0)
  assert.deepEqual({ ...played(m), usd: m.svc.store.getKv('model_usd_total'), days: m.svc.store.getKv('model_usd_days') }, before, 'nothing was written after the stop')
  assert.equal(await m.svc.tick(0), 'stopping')
  assert.deepEqual([m.of(SHADOW).length, m.of(THIRD).length], [1, 1])
})

test('SHADOWS-7 nothing of either shadow plan is in the next real plan\'s request, and each shadow model is asked the next request word for word', async () => {
  const m = await service({ shadow: BOTH, shadowAnswers: answerBy })
  await m.svc.tick(0)
  await m.settled()
  assert.equal(m.rows('shadow').length, 2)
  await m.svc.tick(0)
  await m.settled()
  const next = m.of(PLAYING)[1]!
  const text = `${next.system.map(s => s.text).join('\n')}\n${next.messages.map(x => x.content).join('\n')}`
  assert.match(text, /## Your previous plan \([^)]*in full\)[\s\S]*REALMARKER sync, then a casual game\./)
  assert.doesNotMatch(text, /SHADOWMARKER/)
  assert.doesNotMatch(next.messages[0]!.content, /shadow/i)
  assert.doesNotMatch(next.messages[0]!.content, /4242|Haiku|Opus/)
  for (const model of [SHADOW, THIRD]) assert.deepEqual(m.of(model)[1]!.messages, next.messages, model)
  assert.match(m.svc.store.getKv('last_plan_0')!, /^agent 1 plan: REALMARKER/)
  assert.doesNotMatch(m.svc.store.getKv('last_plan_0')!, /shadow|SHADOWMARKER/i)
  assert.equal(m.svc.store.getKv('chat'), undefined, 'the conversation with the owner is untouched')
  assert.deepEqual(m.svc.store.kvWithPrefix('last_plan_').map(([k]) => k), ['last_plan_0'])
  // The agent's own history, as the next plan reads it, holds no shadow row; the owner still reads all four.
  assert.equal(m.svc.store.planHistory(0, 20).some(r => r.kind === 'shadow'), false)
  assert.equal(m.svc.store.activity(0, 50).filter(r => r.kind === 'shadow').length, 4)
})

test('SHADOWS-8 a new Anthropic key reaches the strategist of every shadow model', async t => {
  const prev = process.env.ANTHROPIC_API_KEY
  t.after(() => {
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = prev
  })
  const m = await service({ shadow: BOTH, shadowAnswers: answerBy })
  const strategists = [m.inner.shadowStrategistFor(SHADOW, 'medium'), m.inner.shadowStrategistFor(THIRD, 'medium')]
  const clientOf = (s: Strategist) => (s as unknown as { client: { apiKey?: string } }).client
  assert.notEqual(strategists[0], strategists[1], 'one strategist object served both shadow models')
  for (const s of strategists) assert.equal(clientOf(s), m.client)
  const key = `sk-ant-${'n'.repeat(40)}`
  m.svc.updateKeys({ ANTHROPIC_API_KEY: key }, 'test')
  for (const s of strategists) {
    assert.notEqual(clientOf(s), m.client, `${s.model}: still the connection with the old key`)
    assert.equal(clientOf(s).apiKey, key, s.model)
  }
  // Still the same objects, each with its own model.
  assert.deepEqual([m.inner.shadowStrategistFor(SHADOW, 'medium'), m.inner.shadowStrategistFor(THIRD, 'medium')], strategists)
  assert.deepEqual(strategists.map(s => s.model), [SHADOW, THIRD])
})
