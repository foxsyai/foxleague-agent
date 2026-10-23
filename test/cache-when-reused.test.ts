// Owner, 2026-10-24 (option 1 of the cost review, PR #28): the game manual is cached for an hour, and a cache write
// costs twice the input. A single agent at the 2-hour tick found the cache expired at every plan and paid the write
// each time (about $2 a day on Sonnet 5). Now the manual is cached only when the cache is still warm from a call in the
// last hour, or when another call is due within the hour; otherwise it goes uncached, at the normal input price.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Mnemonic } from '@multiversx/sdk-core'
import type { Config } from '../src/config.ts'
import { Strategist } from '../src/strategist/strategist.ts'
import { snapshot } from './fixtures.ts'

/** A strategist whose client records each request's system block and answers with the given cache counts. */
function recording(expectsCallSoon: () => boolean, usage: { read?: number; write?: number } = { write: 60_000 }) {
  const s = new Strategist('test-key', 'claude-sonnet-5', 'medium', expectsCallSoon)
  const systems: { cache_control?: unknown }[][] = []
  ;(s as unknown as { client: unknown }).client = {
    beta: { messages: { stream: (p: { system: { cache_control?: unknown }[] }) => ({ finalMessage: async () => {
      systems.push(p.system)
      return { model: 'claude-sonnet-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: usage.read ?? 0, cache_creation_input_tokens: usage.write ?? 0 } }
    } }) } },
  }
  return { s, systems, marked: () => systems.map(sys => sys[0]?.cache_control !== undefined) }
}

test('a cold cache is written only when another call is due within the hour; otherwise the manual goes uncached', async () => {
  const lone = recording(() => false, { write: 0 })
  await lone.s.ask(snapshot(), 'how are we doing?')
  assert.deepEqual(lone.marked(), [false], 'no other call within the hour: no cache write')
  assert.match(String((lone.systems[0]![0] as { text?: string }).text), /./, 'the manual is still sent')

  const busy = recording(() => true)
  await busy.s.ask(snapshot(), 'how are we doing?')
  assert.deepEqual(busy.marked(), [true], 'another call is due: written for the hour')
  assert.deepEqual(busy.systems[0]![0]!.cache_control, { type: 'ephemeral', ttl: '1h' })
})

test('a warm cache is always read, whatever comes next; it counts as warm for 55 minutes after a cached call', async (t) => {
  let soon = true
  const r = recording(() => soon)
  await r.s.ask(snapshot(), 'one')
  soon = false
  await r.s.ask(snapshot(), 'two')
  assert.deepEqual(r.marked(), [true, true], 'warm from the first call: read at a tenth of the price, and renewed')
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 56 * 60_000 })
  await r.s.ask(snapshot(), 'three')
  assert.deepEqual(r.marked(), [true, true, false], 'cold again after 55 minutes and nothing due: uncached')
})

test('a cached call the API did not serve from or into the cache does not count as warm', async () => {
  let soon = true
  const r = recording(() => soon, { read: 0, write: 0 })
  await r.s.ask(snapshot(), 'one')
  soon = false
  await r.s.ask(snapshot(), 'two')
  assert.deepEqual(r.marked(), [true, false])
})

test('the CLI and older callers keep caching (no schedule known)', async () => {
  const s = new Strategist('test-key', 'claude-sonnet-5', 'medium')
  const systems: { cache_control?: unknown }[][] = []
  ;(s as unknown as { client: unknown }).client = { beta: { messages: { stream: (p: { system: { cache_control?: unknown }[] }) => ({ finalMessage: async () => { systems.push(p.system); return { model: 'x', stop_reason: 'end_turn', content: [], usage: { input_tokens: 1, output_tokens: 1 } } } }) } } }
  await s.ask(snapshot(), 'q')
  assert.ok(systems[0]![0]!.cache_control)
})

function testConfig(dir: string): Config {
  return {
    mnemonic: Mnemonic.generate().toString(), dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config
}

test('the service expects another call within the hour from its schedule: an active agent due in 55 minutes inside its hours, or a short cycle', async () => {
  const { Service } = await import('../src/service.ts')
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-'))))
  svc.ensureAgents()
  svc.store.addAgent(1, 'erd1qyu5wthldzr8wx5c9ucg8kjagg0jfs53s8nr3zpz3hypefsdd8ssycr6th')
  const inner = svc as unknown as { nextAt: Map<number, number>; callExpectedWithinHour: (now?: number) => boolean }
  const now = Date.now()
  for (const i of [0, 1]) svc.store.updateSettings(i, { activeHoursUtc: [0, 24], tickMinutes: 120, tickJitterMinutes: 10 })
  // Agent 1 is planning now (its entry is the moment it fired); agent 2 is due in 2 hours.
  inner.nextAt.set(0, now - 1000)
  inner.nextAt.set(1, now + 120 * 60_000)
  assert.equal(inner.callExpectedWithinHour(now), false, 'a lone cycle of 2 hours: nothing within the hour')
  inner.nextAt.set(1, now + 30 * 60_000)
  assert.equal(inner.callExpectedWithinHour(now), true, 'agent 2 plans in 30 minutes')
  svc.store.setPaused(1, true)
  assert.equal(inner.callExpectedWithinHour(now), false, 'a paused agent does not plan')
  svc.store.setPaused(1, false)
  svc.store.updateSettings(1, { activeHoursUtc: [(new Date(now + 30 * 60_000).getUTCHours() + 2) % 24, (new Date(now + 30 * 60_000).getUTCHours() + 3) % 24] })
  assert.equal(inner.callExpectedWithinHour(now), false, 'its next tick falls outside its active hours: no plan')
  // Agent review of PR #29 (low): an agent's next plan is set only after its plan's actions ran (up to 0.8 of its
  // tick), so a lone Zeus agent at 60 minutes plans again after about 90 minutes, not 50.
  svc.store.updateSettings(0, { tickMinutes: 60, tickJitterMinutes: 10 })
  assert.equal(inner.callExpectedWithinHour(now), false, 'a lone Zeus agent: its plan window comes first')
  svc.store.updateSettings(0, { tickMinutes: 25, tickJitterMinutes: 5 })
  assert.equal(inner.callExpectedWithinHour(now), true, 'the planning agent\'s own cycle and window are under the hour')
  svc.store.setKillSwitch(true)
  assert.equal(inner.callExpectedWithinHour(now), false, 'the kill switch stops every plan')
})

// Agent review of PR #29 (low): the cache is written or renewed when the request is processed, at its start, so a
// long answer must not move the warm window past the cache's real expiry.
test('the warm window counts from when the request was sent, not from the end of a long answer', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  let soon = true
  const s = new Strategist('test-key', 'claude-sonnet-5', 'high', () => soon)
  const marked: boolean[] = []
  ;(s as unknown as { client: unknown }).client = {
    beta: { messages: { stream: (p: { system: { cache_control?: unknown }[] }) => ({ finalMessage: async () => {
      marked.push(p.system[0]?.cache_control !== undefined)
      t.mock.timers.tick(8 * 60_000) // an 8-minute answer
      return { model: 'claude-sonnet-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 60_000 } }
    } }) } },
  }
  await s.ask(snapshot(), 'one') // sent at T, written at T, answered at T+8
  soon = false
  t.mock.timers.tick(48 * 60_000) // T+56: the cache written at T is past its 55-minute window
  await s.ask(snapshot(), 'two')
  assert.deepEqual(marked, [true, false])
})
