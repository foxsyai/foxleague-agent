// The agent review of PR #24 (the audit of 2026-10-23): the projection of the squad's condition to a tournament's
// start capped it at 100 only after taking off the matches its other tournaments cost before then, so regeneration
// that would be wasted at the cap was counted against them and the forfeit guard judged too kindly.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conditionAtStart } from '../src/executor/rules.ts'
import { snapshot } from './fixtures.ts'

test('regeneration wasted at the cap before the earlier matches does not pay for them (R24A-1)', () => {
  const now = new Date('2026-10-24T00:00:00Z')
  const h = (n: number) => new Date(now.getTime() + n * 3600_000).toISOString()
  const s = snapshot()
  for (const p of s.players) p.condition = 90
  // Another tournament of ours: an 8-team round robin (7 matches) from +20 h, rounds every 30 min, so it ends at +23 h.
  s.auth!.myTournaments = { active: [{ id: 900, format: 'round_robin', max_teams: 8, starts_at: h(20), round_interval_minutes: 30, home_and_away: false, started_at: null, tier: 'silver', status: 'open' }], completed: [] } as never
  const at = conditionAtStart(s, { id: 901, starts_at: h(24) }, now)!.at(s.players[0]!)
  // 90 regenerates to the cap (100) by +23 h, the 7 matches take 7 x 11 x 10 / 18 = 42.8 off, then 1 h of rest adds 2.
  assert.equal(Math.round(at), 59, `projected ${at.toFixed(1)}; the old projection said about 95`)
})

// R24A-2: a match the scheduler drops from an owner's request (Telegram /do) was only an info row; the executor's
// refusal used to reach the owner. The owner hears of it again.
test('a match dropped from an owner request reaches the owner (R24A-2)', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { Mnemonic } = await import('@multiversx/sdk-core')
  const { Service } = await import('../src/service.ts')
  const svc = new Service({ mnemonic: Mnemonic.generate().toString(), dataDir: mkdtempSync(join(tmpdir(), 'foxagent-')), gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9', gatewayRps: 5, apiRps: 1, foxleagueRps: 5, isServer: false, defaultDryRun: true, maxAgents: 3 } as never)
  svc.ensureAgents()
  const s = svc as unknown as { schedule: unknown; notify(t: string): void; snapshot(): Promise<unknown>; runPlan(a: unknown, p: unknown[], routine: boolean): Promise<void>; executor: { run: unknown } }
  s.schedule = () => undefined
  const told: string[] = []
  s.notify = t => void told.push(t)
  s.snapshot = async () => snapshot()
  s.executor.run = async () => [{ status: 'dry_run', summary: 'ok' }]
  const ranked = { action: { type: 'play_match', match_type: 'ranked' }, reason: '' }
  await s.runPlan(svc.store.agent(0), [ranked, ranked], false)
  assert.ok(told.some(t => /dropped from this plan: play ranked match/.test(t)), told.join(' | '))
})

// R24A-3 (coverage): the `untouched` paths of a paid join. A broadcast the gateway definitely refused, for a
// transaction it does not know, left nothing on FoxLeague; an unclear send error may have left a seat.
test('a paid join whose broadcast was definitely refused is untouched; an unclear send error is not (R24A-3)', async () => {
  const { setup, liveWallet, withLive, tournament } = await import('./fixtures.ts')
  const { BroadcastRefused } = await import('../src/chain/gateway.ts')
  const detailOf = (m: ReturnType<typeof setup>) => JSON.parse(m.store.activity(0, 5).find(r => r.kind === 'join_tournament')?.detail ?? '{}') as { untouched?: boolean; sent?: boolean }
  const join = { action: { type: 'join_tournament' as const, tournament_id: 7 }, reason: '' }
  const run = async (send: () => Promise<string>, lookup: string) => {
    const m = setup({ chain: { send, lookupTransaction: async () => lookup }, fox: { tournament: async () => tournament(7) } })
    await withLive(m.store, async () => { await m.exec.run(m.agent(), liveWallet, snapshot(), [join]) })
    return detailOf(m)
  }
  const refused = await run(async () => { throw new BroadcastRefused('insufficient funds') }, 'not_found')
  assert.equal(refused.untouched, true, JSON.stringify(refused))
  const unclear = await run(async () => { throw new Error('socket hang up') }, 'not_found')
  assert.notEqual(unclear.untouched, true, JSON.stringify(unclear))
  assert.equal(unclear.sent, true, 'it may have gone out: it stays counted')
})

// Re-review of PR #24 (low): the other drop, a requested match whose gate is read again just before it starts and
// found later than planned (a match started meanwhile), was still only an info row. The owner hears of it too.
test('a requested match dropped when its gate is read again reaches the owner (R24A-2, second path)', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { Mnemonic } = await import('@multiversx/sdk-core')
  const { Service } = await import('../src/service.ts')
  const svc = new Service({ mnemonic: Mnemonic.generate().toString(), dataDir: mkdtempSync(join(tmpdir(), 'foxagent-')), gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9', gatewayRps: 5, apiRps: 1, foxleagueRps: 5, isServer: false, defaultDryRun: true, maxAgents: 3 } as never)
  svc.ensureAgents()
  const s = svc as unknown as { schedule: unknown; notify(t: string): void; snapshot(): Promise<unknown>; runPlan(a: unknown, p: unknown[], routine: boolean): Promise<void>; executor: { run: unknown } }
  s.schedule = () => undefined
  const told: string[] = []
  s.notify = t => void told.push(t)
  s.snapshot = async () => snapshot()
  // The first action runs while a match starts elsewhere (its row lands in the log), so the match after it must wait.
  s.executor.run = async () => {
    svc.store.log({ agentIndex: 0, kind: 'play_match', status: 'dry_run', summary: 'play casual match' })
    return [{ status: 'dry_run', summary: 'ok' }]
  }
  await s.runPlan(svc.store.agent(0), [{ action: { type: 'sync' }, reason: '' }, { action: { type: 'play_match', match_type: 'casual' }, reason: '' }], false)
  assert.ok(svc.store.activity(0, 10).some(r => /the last match started later than planned/.test(r.summary)), 'it took the second path')
  assert.ok(told.some(t => /dropped from this plan: play casual match/.test(t)), told.join(' | '))
})
