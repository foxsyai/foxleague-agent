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
import type { Strategist } from '../src/strategist/strategist.ts'
import { snapshot } from './fixtures.ts'

const REPO = resolve(import.meta.dirname, '..')
const PLAYING = 'claude-sonnet-5-5'
const SHADOW = 'claude-haiku-5-5'

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
  shadows: Map<number, Promise<void>>
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
  // The service makes its own second strategist; only its connection is replaced.
  const second = typeof inner.shadowStrategistFor === 'function' && o.shadow === SHADOW ? inner.shadowStrategistFor(SHADOW, o.effort ?? 'medium') : null
  if (second) (second as unknown as { client: unknown }).client = client
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
  return { svc, inner, requests, signals, ran, told, settled, of, rows, shadowPlans, second }
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
  assert.match(tick, /const running = this\.runPlan\(agent, plan\.actions, !ownerRequest\)\n\s*(\/\/[^\n]*\n\s*)*this\.startShadow\(index, plan\)\n\s*await running\n/)
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
