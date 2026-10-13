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
  assert.match(text, /Spent in all: \$4\.20; AI \$31\.40 \(UTC day\)\. 1 top-up waits for a code \(\/topup\)\./)
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

test('urgent stays urgent: an AI account problem once an hour, 3 failed plans in a row, a payment with an unclear outcome, a seat payment given up on', async () => {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const { isModelAccountError } = await import('../src/strategist/strategist.ts')
  const { Service } = await import('../src/service.ts')
  const { retryPendingPayments, ABANDON_AFTER_MIN } = await import('../src/executor/pending.ts')
  const err = (status: number, message: string) => Anthropic.APIError.generate(status, { error: { message } }, message, new Headers())
  assert.equal(isModelAccountError(err(401, 'invalid x-api-key')), true)
  assert.equal(isModelAccountError(err(403, 'permission denied')), true)
  assert.equal(isModelAccountError(err(400, 'Your credit balance is too low to access the Anthropic API')), true)
  assert.equal(isModelAccountError(err(429, 'rate limited')), false)
  assert.equal(isModelAccountError(new Error('fetch failed')), false)

  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-'))))
  svc.ensureAgents()
  const urgent: string[] = []
  const routine: string[] = []
  svc.notify = (t: string) => void urgent.push(t)
  svc.report = (t: string) => void routine.push(t)
  const failed = (svc as unknown as { tickFailed: (i: number, e: unknown, m: string) => void }).tickFailed.bind(svc)
  const key = err(401, 'invalid x-api-key')
  failed(0, key, 'Anthropic API key rejected')
  failed(1, key, 'Anthropic API key rejected')
  assert.equal(urgent.length, 1, 'once for all agents')
  assert.match(urgent[0]!, /^Plans are failing: Anthropic API key rejected/)
  urgent.length = 0
  failed(2, new Error('FoxLeague timeout'), 'FoxLeague timeout')
  failed(2, new Error('FoxLeague timeout'), 'FoxLeague timeout')
  assert.deepEqual(urgent, [], 'one or two failures wait for the summary')
  failed(2, new Error('FoxLeague timeout'), 'FoxLeague timeout')
  assert.match(urgent[0]!, /^agent 3: its last 3 plans failed \(FoxLeague timeout\)/)
  failed(2, new Error('FoxLeague timeout'), 'FoxLeague timeout')
  assert.equal(urgent.length, 1, 'said once per streak')

  urgent.length = 0
  const d = (svc.executor as unknown as { d: { notify: (i: number, t: string, r?: unknown) => void } }).d
  d.notify(0, 'agent 1 [ok] train', { status: 'confirmed' })
  d.notify(0, 'agent 1 [error] join: paid 0xabc but not seated', { status: 'error', txHash: '0xabc' })
  d.notify(0, 'agent 1 [error] train: FoxLeague timeout', { status: 'error' })
  assert.deepEqual(urgent, ['agent 1 [error] join: paid 0xabc but not seated'], 'only money with an unclear outcome is urgent')

  const told: string[] = []
  const alerted: string[] = []
  svc.store.addPending('0xold', 0, 'join', { tournamentId: 7 })
  await retryPendingPayments({ store: svc.store, fox: {} as never, notify: t => void told.push(t), alert: t => void alerted.push(t) }, 0, svc.wallet(0), Date.now() + (ABANDON_AFTER_MIN + 1) * 60_000)
  assert.match(alerted[0]!, /tournament seat payment 0xold was never confirmed/)
  assert.deepEqual(told, [])
})

test('review R12: an unclear payment without a hash is urgent, owner requests answer at once, the fee on hand is enough, nothing hides in the waiting line', async () => {
  const { Service } = await import('../src/service.ts')
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-'))))
  svc.ensureAgents()
  const urgent: string[] = []
  svc.notify = (t: string) => void urgent.push(t)
  svc.report = () => undefined
  const d = (svc.executor as unknown as { d: { notify: (i: number, t: string, r?: unknown) => void } }).d
  // R12-1: signed and handed to the network, then the send timed out: no hash, outcome unclear.
  d.notify(0, 'agent 1 [error] bid: The operation was aborted due to timeout', { status: 'error', sent: true })
  assert.deepEqual(urgent, ['agent 1 [error] bid: The operation was aborted due to timeout'])
  // R12-2: while the owner's own request runs, every result is told at once.
  urgent.length = 0
  ;(svc as unknown as { loud: Set<number> }).loud.add(0)
  d.notify(0, 'agent 1 [refused] buy condition: over the cap', { status: 'refused' })
  assert.equal(urgent.length, 1)

  // R12-4: 5,000 FOXSY on hand pays the fee (no swap, no margin); an unknown fee state never parks an agent.
  const waiting = (svc as unknown as { waitingForFunds: (a: unknown, s: unknown) => string | null }).waitingForFunds.bind(svc)
  const holds = snapshot()
  holds.registration = { ...holds.registration, registered: false, feePaidOnChain: false }
  holds.chain = { ...holds.chain!, egld: 10n ** 18n, foxsy: 5000n * 10n ** 18n, wegld: 0n }
  assert.equal(waiting(svc.store.agent(0)!, holds), null)
  const unknownFee = structuredClone(holds)
  unknownFee.chain!.foxsy = 0n
  unknownFee.registration.feePaidOnChain = null
  assert.equal(waiting(svc.store.agent(0)!, unknownFee), null)

  // R12-5: an unregistered agent with plan errors, plans or a pause gets its own line.
  const day = (index: number, more: Partial<AgentDay> = {}): AgentDay => ({ index, team: null, registered: false, paused: false, done: 0, refused: 0, failed: 0, plans: 0, errors: 0, spentUsd: 0, elo: null, eloChange: null, worthUsd: null, low: false, topups: 0, ...more })
  const text = summaryText('x', [day(6, { errors: 7 }), day(7, { plans: 9 }), day(8, { paused: true }), day(9)], { aiUsd: null, live: true, killSwitch: false, waitingTopUps: 0 })
  assert.match(text, /agent 7: no actions, 7 plan errors/)
  assert.match(text, /agent 8: no actions/)
  assert.match(text, /agent 9 \(paused\): no actions/)
  assert.match(text, /Agent 10: not registered yet, waiting for funds/)

  // R12-7: one shared cause, one 3-in-a-row alert an hour, whatever number of agents it hits.
  urgent.length = 0
  ;(svc as unknown as { loud: Set<number> }).loud.clear()
  const failed = (svc as unknown as { tickFailed: (i: number, e: unknown, m: string) => void }).tickFailed.bind(svc)
  for (const i of [0, 1, 2]) for (let n = 0; n < 3; n++) failed(i, new Error('gateway down'), 'gateway down')
  assert.equal(urgent.length, 1)
})
