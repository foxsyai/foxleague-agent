import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Mnemonic } from '@multiversx/sdk-core'
import type { Config } from '../src/config.ts'
import { dayBefore, nextSummaryAt, summaryText, validZone, zoneDate, zoneInstant, type AgentDay } from '../src/summary.ts'
import { snapshot } from './fixtures.ts'

test('summary time: 09:00 in Bucharest is 06:00 UTC in summer and 07:00 UTC after the clocks go back', () => {
  const z = 'Europe/Bucharest'
  assert.equal(new Date(zoneInstant('2026-10-09', 9, z)).toISOString(), '2026-10-09T06:00:00.000Z')
  assert.equal(new Date(zoneInstant('2026-10-26', 9, z)).toISOString(), '2026-10-26T07:00:00.000Z')
  assert.equal(new Date(zoneInstant('2026-10-25', 0, z)).toISOString(), '2026-10-24T21:00:00.000Z', 'midnight on the day the clocks change')
  assert.equal(zoneDate(Date.parse('2026-10-09T22:30:00Z'), z), '2026-10-10', 'already the next day in Bucharest')
  assert.equal(new Date(nextSummaryAt(Date.parse('2026-10-09T05:00:00Z'), 9, z)).toISOString(), '2026-10-09T06:00:00.000Z')
  assert.equal(new Date(nextSummaryAt(Date.parse('2026-10-09T06:00:01Z'), 9, z)).toISOString(), '2026-10-10T06:00:00.000Z')
  assert.equal(dayBefore('2026-11-01'), '2026-10-31')
  assert.equal(validZone('Mars/Olympus'), 'UTC')
  assert.equal(validZone('Europe/Bucharest'), 'Europe/Bucharest')
})

test('summary text: one line per playing agent, the agents waiting for funds in one line, totals and where to ask for more', () => {
  const day = (index: number, more: Partial<AgentDay> = {}): AgentDay => ({ index, team: null, registered: false, paused: false, done: 0, refused: 0, failed: 0, plans: 0, errors: 0, spentUsd: 0, elo: null, eloChange: null, worthUsd: null, low: false, topups: 0, ...more })
  const text = summaryText('Thursday 8 October', [
    day(0, { team: 'Fox Steady XI', registered: true, done: 12, refused: 2, spentUsd: 4.2, elo: 1203, eloChange: 8, worthUsd: 45 }),
    day(5, { team: 'Copper Lynx FC', registered: true, done: 3, refused: 0, failed: 1, elo: 1180, eloChange: -4, worthUsd: 6.5, low: true, topups: 1 }),
    ...Array.from({ length: 19 }, (_, i) => day(6 + i)),
  ], { aiUsd: 31.4, live: true, killSwitch: false, waitingTopUps: 1 })
  assert.match(text, /^Daily summary, Thursday 8 October \(LIVE\)/)
  assert.match(text, /agent 1 · Fox Steady XI: 12 done, 2 refused, \$4\.20 spent, ELO 1203 \(\+8\), worth \$45\.00/)
  assert.match(text, /agent 6 · Copper Lynx FC: 3 done, 0 refused, 1 failed, ELO 1180 \(-4\), worth \$6\.50 LOW, 1 top-up/)
  assert.match(text, /Agents 7 to 25: not registered yet, waiting for funds/)
  assert.match(text, /Spent in all: \$4\.20; AI \$31\.40\. 1 top-up waits for a code \(\/topup\)\./)
  assert.match(text, /Details any time: \/status, \/plan N, \/log N, \/budget N\. Every update as it happens: \/updates all\./)
})

function testConfig(dir: string): Config {
  return {
    mnemonic: Mnemonic.generate().toString(), dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config
}

test('quiet Telegram: routine messages wait for the summary unless /updates all; the summary counts what each agent did', async () => {
  const { Service } = await import('../src/service.ts')
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-'))))
  svc.ensureAgents()
  const told: string[] = []
  svc.notify = (text: string) => void told.push(text)
  assert.equal(svc.updatesMode(), 'daily', 'quiet by default')
  svc.report('agent 1 plan: train #6')
  assert.deepEqual(told, [])
  assert.match(await svc.command('updates', ['all'], 'all'), /every plan and action result comes as it happens/)
  svc.report('agent 1 plan: train #6')
  assert.deepEqual(told, ['agent 1 plan: train #6'])
  assert.match(await svc.command('updates', [], ''), /Telegram updates: all/)
  await svc.command('updates', ['daily'], 'daily')
  assert.equal(svc.updatesMode(), 'daily')

  for (const [kind, status] of [['train', 'dry_run'], ['train', 'dry_run'], ['sync', 'refused'], ['plan', 'info'], ['tick', 'error']] as const) svc.store.log({ agentIndex: 0, kind, status, summary: 'x' })
  svc.store.recordSpend({ agentIndex: 0, at: new Date(), gameDay: '2026-10-09', category: 'play', action: '', foxsyAtomic: 0n, egldAtomic: 0n, usd: 2.5, txHash: null, dryRun: true })
  svc.snapshots.set(0, snapshot())
  const text = await svc.command('summary', ['today'], 'today')
  assert.match(text, /^Daily summary, today so far \(dry run\)/)
  assert.match(text, /agent 1 · Agent: 2 done, 1 refused, \$2\.50 spent, ELO 1200, worth \$\d+\.\d\d, 1 plan error/)
})

test('an agent with no team and too little for the registration waits for funds without an AI call', async () => {
  const { Service } = await import('../src/service.ts')
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-'))))
  svc.ensureAgents()
  const waiting = (svc as unknown as { waitingForFunds: (a: unknown, s: unknown) => string | null }).waitingForFunds.bind(svc)
  const empty = snapshot()
  empty.registration = { ...empty.registration, registered: false, feePaidOnChain: false }
  empty.chain = { ...empty.chain!, egld: 0n, foxsy: 0n, wegld: 0n }
  assert.match(waiting(svc.store.agent(0)!, empty)!, /agent 1 waits for funds: no team yet and about \$0\.00 to play with, the registration needs about \$11\.81 \(5,000 FOXSY\)/)
  const funded = structuredClone(empty)
  funded.chain!.egld = 10n * 10n ** 18n // 9 EGLD to play with at $4.50
  assert.equal(waiting(svc.store.agent(0)!, funded), null, 'enough to swap for the fee: it plans')
  const paid = structuredClone(empty)
  paid.registration.feePaidOnChain = true
  assert.equal(waiting(svc.store.agent(0)!, paid), null, 'a paid fee only needs the free register call')
  assert.equal(waiting(svc.store.agent(0)!, snapshot()), null, 'a registered team always plans')
})
