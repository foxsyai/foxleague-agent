import { test } from 'node:test'
import assert from 'node:assert/strict'
import Anthropic from '@anthropic-ai/sdk'
import { Store } from '../src/store/db.ts'
import { EFFORTS, Strategist, deadlineMs, renderPlanRequest, roomFor, strategistChoice, usd, type ChatInput } from '../src/strategist/strategist.ts'
import { Proposals } from '../src/strategist/proposals.ts'
import { cleanPage } from '../src/strategist/manual.ts'
import type { Config } from '../src/config.ts'
import { DEFAULT_SETTINGS } from '../src/store/settings.ts'
import { budgetView } from '../src/executor/budget.ts'
import { setup, snapshot } from './fixtures.ts'

test('strategist choice: the web UI pick wins over the env, unknown effort falls back to medium', () => {
  const store = new Store('', ':memory:')
  const cfg = { model: 'claude-sonnet-5' } as Config
  const prev = process.env.AGENT_MODEL_EFFORT
  try {
    process.env.AGENT_MODEL_EFFORT = 'high'
    assert.deepEqual(strategistChoice(store, cfg), { model: 'claude-sonnet-5', effort: 'high' })
    store.setKv('strategist_model', 'claude-opus-5-5')
    store.setKv('strategist_effort', 'xhigh')
    assert.deepEqual(strategistChoice(store, cfg), { model: 'claude-opus-5-5', effort: 'xhigh' })
    store.setKv('strategist_effort', 'turbo')
    assert.equal(strategistChoice(store, cfg).effort, 'medium')
  } finally {
    if (prev === undefined) delete process.env.AGENT_MODEL_EFFORT
    else process.env.AGENT_MODEL_EFFORT = prev
  }
})

test('model cost: each attempt at its own model price when a fallback ran', () => {
  const tokens = { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null }
  const plain = { ...tokens, iterations: null } as unknown as Anthropic.Beta.BetaUsage
  assert.equal(usd('claude-opus-5-5', plain), 4)
  const rescued = {
    ...tokens,
    iterations: [
      { ...tokens, type: 'message', model: null }, // the requested model declined
      { ...tokens, type: 'fallback_message', model: 'claude-opus-5' },
    ],
  } as unknown as Anthropic.Beta.BetaUsage
  assert.equal(usd('claude-fable-5-1', rescued), 10 + 5)
})

test('server-side fallback only for classifier models, dropped for good if the API refuses it', async () => {
  const calls: Record<string, unknown>[] = []
  let refuseFallbacks = false
  const s = new Strategist('test-key', 'claude-sonnet-5', 'medium')
  ;(s as unknown as { client: unknown }).client = {
    beta: {
      messages: {
        stream: (p: Record<string, unknown>) => ({
          finalMessage: async () => {
            calls.push(p)
            if (refuseFallbacks && p.fallbacks) throw new Anthropic.BadRequestError(400, { error: { message: 'fallbacks is not supported' } }, 'fallbacks is not supported', new Headers())
            return { model: p.model }
          },
        }),
      },
    },
  }
  const create = (s as unknown as { create: (p: object) => Promise<unknown> }).create.bind(s)
  await create({ max_tokens: 10, messages: [] })
  assert.equal(calls.at(-1)!.fallbacks, undefined) // Sonnet 5: plain request

  s.configure('claude-opus-5-5', 'high')
  await create({ max_tokens: 10, messages: [] })
  assert.equal(calls.at(-1)!.fallbacks, 'default')
  assert.deepEqual(calls.at(-1)!.betas, ['server-side-fallback-2026-07-01'])

  s.configure('claude-fable-5-1', 'high')
  refuseFallbacks = true
  const n = calls.length
  await create({ max_tokens: 10, messages: [] })
  assert.equal(calls.length, n + 2) // refused with fallbacks, retried without
  assert.equal(calls.at(-1)!.fallbacks, undefined)
  await create({ max_tokens: 10, messages: [] })
  assert.equal(calls.length, n + 3) // remembered: no second refused attempt
})

test('proposals: applied or dropped once, from either channel; expire after a day', () => {
  const p = new Proposals()
  const a = p.add({ agents: [0], strategy: 'Silver only', changes: 'focus', source: 'Telegram' }, 1_000)
  assert.match(a.id, /^[0-9a-f]{8}$/)
  assert.equal(p.take(a.id, 2_000)?.strategy, 'Silver only')
  assert.equal(p.take(a.id, 2_000), undefined) // second tap (other channel) finds nothing
  const b = p.add({ agents: [0], strategy: 'x', changes: '', source: 'web UI' }, 0)
  assert.equal(p.take(b.id, 24 * 3600_000 + 1), undefined)
})

test('manager chat: questions get an answer, advice a proposal for known agents only, numbered from 1', async () => {
  const s = new Strategist('test-key', 'claude-sonnet-5', 'medium')
  let content: unknown[] = []
  const requests: { messages: { content: string }[]; tools: { name: string }[] }[] = []
  ;(s as unknown as { client: unknown }).client = {
    beta: { messages: { stream: (p: never) => ({ finalMessage: async () => (requests.push(p), { model: 'claude-sonnet-5', stop_reason: 'end_turn', content, usage: { input_tokens: 0, output_tokens: 0, iterations: null } }) }) } },
  }
  const input: ChatInput = {
    message: 'this week Silver tournaments only',
    source: 'Telegram',
    defaultAgents: [0, 1],
    agents: [
      { index: 0, team: 'Fox Test XI', strategy: 'Steady XP builder', paused: false },
      { index: 1, team: null, strategy: 'Aggressive climber', paused: true },
    ],
    recent: [],
    digests: [],
  }
  content = [{ type: 'text', text: 'Two agents, both in dry run.' }]
  assert.deepEqual(await s.discuss(input), { reply: 'Two agents, both in dry run.', proposal: null, usd: 0 })
  // Same tools as the planning tick (one shared cache); a submit_plan call from the chat is never run.
  assert.deepEqual(requests[0]!.tools.map(t => t.name), ['submit_plan', 'propose_strategy'])
  assert.match(requests[0]!.messages[0]!.content, /it is for agents 1, 2/)
  assert.match(requests[0]!.messages[0]!.content, /in the language the owner's message below is written in \(English if that is unclear\)/)
  assert.match(requests[0]!.messages[0]!.content, /agent 2 \(no team yet\) PAUSED: Aggressive climber/)

  content = [{ type: 'tool_use', id: 't', name: 'propose_strategy', input: { agents: [2, 8, 0], strategy: '  Silver only this week. ', changes: 'Silver focus' } }]
  const named = await s.discuss(input)
  // The model names agents as the owner does: agent 2 is index 1; agents 8 and 0 do not exist.
  assert.deepEqual(named.proposal, { agents: [1], strategy: 'Silver only this week.', changes: 'Silver focus' })

  content = [{ type: 'tool_use', id: 't', name: 'propose_strategy', input: { agents: [], strategy: 'Silver only', changes: '' } }]
  assert.deepEqual((await s.discuss(input)).proposal?.agents, [0, 1]) // nobody named: the default targets

  content = [{ type: 'tool_use', id: 't', name: 'submit_plan', input: { summary: 's', actions: [{ action: { type: 'play_match', match_type: 'casual' }, reason: 'r' }] } }]
  assert.equal((await s.discuss(input)).proposal, null)
  const system = (requests[0] as unknown as { system: { text: string }[] }).system[0]!.text
  assert.match(system, /# FoxLeague player manual/) // the manual rides in the cached system prompt
  assert.match(system, /# Economy map/)
})

test('manual pages: title heading, no imports or source comments, callouts as quotes', () => {
  const src = [
    '---',
    'title: "Match Types"',
    'description: x',
    '---',
    "import { Aside } from '@astrojs/starlight/components';",
    '',
    '## Casual {/* matches.rs:12 */}',
    '{/* a comment',
    'over two lines with a * star */}',
    '<Aside type="tip" title="Cooldown">',
    'Wait 30 s.',
    '',
    'Then play.',
    '</Aside>',
    '<!-- html comment -->',
    '',
    '',
    '',
    '| a | b |',
  ].join('\n')
  assert.equal(
    cleanPage(src, 'mechanics/matches.mdx'),
    '# Match Types\n(docs.foxleague.ai/mechanics/matches/)\n\n## Casual\n\n> **Cooldown**\n> Wait 30 s.\n>\n> Then play.\n\n| a | b |\n',
  )
})

test('room grows with the effort: a plan streams with 16,000 to 64,000 tokens, and a cut-off one runs nothing', async () => {
  const s = new Strategist('test-key', 'claude-sonnet-5', 'xhigh')
  const sent: { max_tokens: number; output_config: { effort: string }; stream?: unknown }[] = []
  let answer: Record<string, unknown> = {}
  ;(s as unknown as { client: unknown }).client = {
    beta: {
      messages: {
        create: async () => { throw new Error('a plan must not use a plain request') },
        stream: (p: never, options: { signal?: AbortSignal }) => {
          sent.push(p)
          assert.ok(options.signal instanceof AbortSignal, 'the whole answer has a deadline')
          return { finalMessage: async () => ({ model: 'claude-sonnet-5', usage: { input_tokens: 10, output_tokens: 20 }, ...answer }) }
        },
      },
    },
  }
  const input = { snapshot: snapshot(), settings: DEFAULT_SETTINGS, budget: budgetView(setup().store, 0, DEFAULT_SETTINGS, true, new Date(), 14), recent: [], dryRun: true }

  answer = { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'submit_plan', input: { summary: 'train', actions: [{ action: { type: 'sync' }, reason: 'dirty cards' }] } }] }
  const plan = await s.plan(input)
  assert.equal(sent[0]!.max_tokens, 48_000)
  assert.equal(sent[0]!.output_config.effort, 'xhigh')
  const rooms: number[] = []
  for (const effort of EFFORTS) {
    s.configure('claude-fable-5-1', effort)
    await s.plan(input)
    rooms.push(sent.at(-1)!.max_tokens)
  }
  assert.deepEqual(rooms, [16_000, 16_000, 32_000, 48_000, 64_000], 'low, medium, high, xhigh, max')
  assert.deepEqual([roomFor('max', 8_000), roomFor('max', 4_000), roomFor('medium', 8_000)], [32_000, 16_000, 8_000], 'chat and questions grow the same way')
  assert.ok(64_000 <= 128_000, 'under the 128,000 tokens a model can write')
  assert.deepEqual([deadlineMs(16_000), deadlineMs(64_000)], [380_000, 1_340_000], 'a minute to begin plus 50 tokens a second')
  assert.equal(plan.summary, 'train')
  assert.equal(plan.actions.length, 1)

  answer = { stop_reason: 'max_tokens', content: [{ type: 'tool_use', id: 't', name: 'submit_plan', input: { summary: 'half a pl', actions: [{ action: { type: 'sync' }, reason: '' }] } }] }
  const cut = await s.plan(input)
  assert.match(cut.summary, /truncated at max_tokens; nothing executed/)
  assert.equal(cut.actions.length, 0)
})

test('while the history still cites the removed rule about the owner\'s other agents, the plan is told it no longer holds', () => {
  const store = new Store('', ':memory:')
  store.addAgent(0, 'erd1x')
  const base = { snapshot: snapshot(), settings: DEFAULT_SETTINGS, budget: budgetView(store, 0, DEFAULT_SETTINGS, true, new Date()), dryRun: true }
  const row = (summary: string) => ({ id: 1, at: new Date().toISOString(), agentIndex: 0, kind: 'join_tournament', status: 'refused', summary, detail: null, costUsd: null, txHash: null })
  const old = renderPlanRequest({ ...base, recent: [row('join tournament T104: another agent of this install is in or runs this tournament (Fair Play: no coordinated teams)')] as never })
  assert.match(old, /## Earlier entries\nSome recent entries below cite a rule[^\n]*The owner removed that rule on 2026-09-30/)
  assert.doesNotMatch(renderPlanRequest({ ...base, recent: [row('play ranked match: match #870 started')] as never }), /removed that rule/)
})

test('presets run from careful to all-in, and the AI is told the owner sets how hard to spend on growth', async () => {
  const { STRATEGY_PRESETS, validateSettingsPatch } = await import('../src/store/settings.ts')
  const { SYSTEM_PROMPT } = await import('../src/strategist/prompt.ts')
  assert.deepEqual(Object.keys(STRATEGY_PRESETS), ['steady', 'climber', 'hunter', 'predator', 'whale'])
  for (const text of Object.values(STRATEGY_PRESETS)) assert.equal(validateSettingsPatch({ strategy: text }).strategy, text)
  assert.match(STRATEGY_PRESETS.whale!, /XP booster running every day/)
  assert.match(STRATEGY_PRESETS.whale!, /Never move cards between wallets/)
  assert.match(SYSTEM_PROMPT, /How hard to spend on growth is the owner's call/)
})
