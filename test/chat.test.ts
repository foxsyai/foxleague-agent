import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Mnemonic } from '@multiversx/sdk-core'
import { Service } from '../src/service.ts'
import type { Config } from '../src/config.ts'
import type { ChatAnswer, ChatInput } from '../src/strategist/strategist.ts'

function testConfig(dir: string): Config {
  return {
    mnemonic: Mnemonic.generate().toString(), dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config
}

test('the conversation with the manager is kept: saved across a restart, read back as context, an open proposal with its line', async () => {
  const cfg = testConfig(mkdtempSync(join(tmpdir(), 'foxagent-')))
  const svc = new Service(cfg)
  svc.ensureAgents()
  const seen: ChatInput[] = []
  let answer: ChatAnswer = { reply: 'All fine.', proposal: null, usd: 0.01 }
  svc.strategist = { discuss: async (i: ChatInput) => (seen.push(i), answer) } as never

  await svc.discuss('How is agent 1?', 'Telegram')
  answer = { reply: 'Silver only it is.', proposal: { agents: [0], strategy: 'Silver tournaments only', changes: 'Silver focus' }, usd: 0 }
  const asked = await svc.discuss('this week Silver only', 'web UI, demo', [0])

  // The second message went out with the first exchange as context.
  assert.deepEqual(seen[1]!.recent, [{ from: 'owner', text: 'How is agent 1?' }, { from: 'manager', text: 'All fine.' }])
  let lines = svc.chatLines()
  assert.deepEqual(lines.map(l => [l.from, l.text, l.source, l.proposed]), [
    ['owner', 'How is agent 1?', 'Telegram', false],
    ['manager', 'All fine.', undefined, false],
    ['owner', 'this week Silver only', 'web UI, demo', false],
    ['manager', 'Silver only it is.', undefined, true],
  ])
  assert.ok(lines.every(l => !Number.isNaN(Date.parse(l.at))), 'every line has its time')
  assert.deepEqual(lines[3]!.open, { id: asked.proposal!.id, strategy: 'Silver tournaments only', changes: 'Silver focus' })
  assert.deepEqual([lines[2]!.agents, lines[3]!.agents], [[0], [0]])

  // A restart keeps the lines; a proposal lives in memory only, so it is no longer open there.
  const restarted = new Service(cfg).chatLines()
  assert.deepEqual(restarted.map(l => l.text), lines.map(l => l.text))
  assert.deepEqual([restarted[3]!.proposed, restarted[3]!.open], [true, undefined])

  // Applying closes it and leaves a line the manager reads next time.
  svc.applyProposal(asked.proposal!.id, 'web UI, demo')
  lines = svc.chatLines()
  assert.equal(lines[3]!.open, undefined)
  assert.equal(lines[4]!.text, '(applied the proposed strategy for agent 1)')
  assert.equal(svc.store.agent(0)!.settings.strategy, 'Silver tournaments only')
  answer = { reply: 'ok', proposal: null, usd: 0 }
  await svc.discuss('and now?', 'Telegram')
  assert.equal(seen[2]!.recent[3]!.text, 'Silver only it is. [proposed strategy for agent 1: Silver tournaments only]')
  assert.equal(seen[2]!.recent[4]!.text, '(applied the proposed strategy for agent 1)')

  // A dropped proposal says so too; an unknown one changes nothing.
  answer = { reply: 'Gold then.', proposal: { agents: [0], strategy: 'Gold only', changes: '' }, usd: 0 }
  const second = await svc.discuss('go for Gold', 'Telegram')
  assert.equal(svc.cancelProposal(second.proposal!.id), 'proposal dropped; nothing changed')
  assert.equal(svc.chatLines().at(-1)!.text, '(dropped the proposed strategy for agent 1)')
  const count = svc.chatLines().length
  assert.match(svc.cancelProposal('deadbeef'), /already applied, cancelled or expired/)
  assert.equal(svc.chatLines().length, count)

  // The box keeps the last 100 lines, the manager reads 40 at most, and a long message is shortened for it.
  answer = { reply: 'r'.repeat(3000), proposal: null, usd: 0 }
  for (let i = 0; i < 60; i++) await svc.discuss(`${'m'.repeat(1000)} ${i}`, 'Telegram')
  assert.equal(svc.chatLines().length, 100)
  assert.equal(new Service(cfg).chatLines().length, 100)
  assert.equal(svc.chatLines().at(-2)!.text.length, 1003, 'the box shows the whole message')
  assert.equal(svc.chatLines().filter(l => l.read).length, 40)
  const context = seen.at(-1)!.recent
  assert.equal(context.length, 40)
  assert.deepEqual([context[0]!.text.length, context[1]!.text.length], [600, 1200])
})

test('the manager reads the current conversation only: an hour without a message or Clear starts a new one', async () => {
  const cfg = testConfig(mkdtempSync(join(tmpdir(), 'foxagent-')))
  const seen: ChatInput[] = []
  let answer: ChatAnswer = { reply: 'a', proposal: null, usd: 0 }
  const manager = { discuss: async (i: ChatInput) => (seen.push(i), answer) } as never
  const svc = new Service(cfg)
  svc.ensureAgents()
  svc.strategist = manager
  for (let i = 0; i < 3; i++) await svc.discuss(`q${i}`, 'Telegram')
  assert.ok(svc.chatLines().every(l => l.read), 'a running conversation is read whole')
  assert.ok(svc.chatLines(Date.now() + 61 * 60_000).every(l => !l.read), 'an hour after the last message none of it is read')

  // The first two exchanges are from two hours ago: a pause of more than an hour lies before the third.
  const saved = JSON.parse(svc.store.getKv('chat')!) as { at: string }[]
  for (const l of saved.slice(0, 4)) l.at = new Date(Date.now() - 2 * 3600_000).toISOString()
  svc.store.setKv('chat', JSON.stringify(saved))
  const later = new Service(cfg)
  later.strategist = manager
  assert.deepEqual(later.chatLines().map(l => l.read), [false, false, false, false, true, true])
  await later.discuss('follow-up', 'web UI, demo', [0])
  assert.deepEqual(seen.at(-1)!.recent.map(r => r.text), ['q2', 'a'], 'only the current conversation goes to the manager')
  assert.equal(later.chatLines().length, 8, 'the box still shows the earlier lines')

  // Clear empties it for both sides and drops a proposal still waiting in it.
  answer = { reply: 'Gold then.', proposal: { agents: [0], strategy: 'Gold only', changes: '' }, usd: 0 }
  const asked = await later.discuss('go for Gold', 'Telegram')
  assert.ok(later.chatLines().at(-1)!.open)
  assert.match(later.clearChat('web UI, demo'), /conversation cleared/)
  assert.deepEqual(later.chatLines(), [])
  assert.deepEqual(new Service(cfg).chatLines(), [], 'it stays empty after a restart')
  assert.throws(() => later.applyProposal(asked.proposal!.id, 'Telegram'), /expired or was already applied or cancelled/)
  assert.match(later.store.activity(null, 5)[0]!.summary, /conversation with the manager cleared \(web UI, demo\)/)
  assert.match(later.clearChat('web UI, demo'), /already empty/)
  answer = { reply: 'fresh', proposal: null, usd: 0 }
  await later.discuss('hello again', 'Telegram')
  assert.deepEqual(seen.at(-1)!.recent, [], 'the next message starts with no context')
  assert.match(await later.command('clear', [], ''), /conversation cleared/)
  assert.deepEqual(later.chatLines(), [])
})
