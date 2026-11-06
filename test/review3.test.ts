// Proof tests for the third review round of 2026-10-13. Each test is named after its finding (R3-1, R3-T) and
// failed on main d8ea6f5 before the fix.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '../src/config.ts'
import { liveWallet, setup, snapshot, withLive, withFixture } from './fixtures.ts'
import { ApiRefusal } from '../src/foxleague/api.ts'
import { retryPendingPayments } from '../src/executor/pending.ts'
import type { Store } from '../src/store/db.ts'
import type { PlannedAction } from '../src/executor/actions.ts'

const TEST_WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const act = (action: unknown): PlannedAction[] => [{ action: action as PlannedAction['action'], reason: '' }]
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Moves the agent's activity rows of a kind back in time (the log has no setter: a test reaches the table). */
const ageActivity = (store: Store, kind: string, ms: number) =>
  (store as unknown as { db: { prepare: (q: string) => { run: (...a: unknown[]) => unknown } } }).db
    .prepare('UPDATE activity SET at = ? WHERE kind = ?')
    .run(new Date(Date.now() - ms).toISOString(), kind)

// ---- R3-1: a booster payment FoxLeague refunded does not hold the next booster ----

test('R3-1 a booster payment FoxLeague refunded (nothing delivered, the FOXSY back) does not hold the next booster', async () => {
  // FoxLeague cannot verify the payment for its whole 30-minute grace (its chain read is down): tx_pending each time.
  let answer: () => { message: string } = () => { throw new ApiRefusal('Could not verify the payment state right now. Please retry in a moment.', 'tx_pending') }
  const m = setup({ chain: { send: async () => 'hb9' }, fox: { user: async () => null, shopConfirm: async () => answer() } })
  const live = () => m.store.spentUsd(0, { category: 'play', dryRun: false })
  await withLive(m.store, async () => {
    const [first] = await m.exec.run(m.agent(), liveWallet, withFixture(snapshot()), act({ type: 'buy', product: 'xp_booster' }))
    assert.equal(first!.status, 'unconfirmed', first!.summary)
    // The grace passed: FoxLeague's sweep refunded the 2,000 FOXSY and says so to the next confirm (12.1).
    answer = () => { throw new ApiRefusal('This payment was already refunded and cannot be used for a purchase.') }
    await retryPendingPayments({ store: m.store, fox: m.exec['d'].fox, notify: () => undefined }, 0, liveWallet, Date.now() + 35 * 60_000)
    assert.equal(m.store.pending(0).length, 0, 'resolved')
    assert.ok(live() < 0.01, `the refund was credited: $${live().toFixed(2)} counted`)
    // An hour later: no booster runs (FoxLeague delivered none and its status says so), the FOXSY is back.
    ageActivity(m.store, 'buy', 3600_000)
    answer = () => ({ message: 'XP booster activated' })
    const s = withFixture(snapshot())
    s.auth!.shop!.xp_booster_active = false
    s.auth!.shop!.xp_booster_expires_at = null
    const [again] = await m.exec.run(m.agent(), liveWallet, s, act({ type: 'buy', product: 'xp_booster' }))
    assert.equal(again!.status, 'confirmed', `no booster was delivered and the payment came back, yet the next booster is refused: ${again!.summary}`)
  })
})

// ---- R3-T: a store error inside a pass of the pending-retry timer never trips the kill switch ----

const serviceConfig = () => ({
  mnemonic: TEST_WORDS, dataDir: mkdtempSync(join(tmpdir(), 'foxagent-r3-')),
  gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9', gatewayRps: 5, apiRps: 1, foxleagueRps: 5,
  anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined, isServer: false, defaultDryRun: true, maxAgents: 5,
}) as Config

test('R3-T a store error inside a pass of the pending-retry timer (SQLITE_BUSY) is logged, never an unhandled rejection or the kill switch; the next pass runs', async () => {
  const { Service } = await import('../src/service.ts')
  const svc = new Service(serviceConfig())
  const s = svc as unknown as Record<string, unknown>
  s.startTelegram = () => undefined
  s.schedule = () => undefined
  s.snapshot = async () => snapshot()
  s.pendingRetryMs = 20
  svc.ensureAgents()
  const confirms: string[] = []
  s.fox = {
    shopConfirm: async (_w: unknown, b: { tx_hash: string }) => (confirms.push(b.tx_hash), { purchase_id: 1, message: 'XP booster activated' }),
    joinTournament: async () => ({ participant_id: 1 }),
  }
  svc.store.addPending('ht', 0, 'shop', { tx_hash: 'ht', product: 'xp_booster' })
  // A CLI command writes the same database: the first pass's read waits out its 5 s and fails; the next one reads.
  const pendingAgents = svc.store.pendingAgents.bind(svc.store)
  let busy = 1
  svc.store.pendingAgents = () => {
    if (busy-- > 0) throw new Error('SQLITE_BUSY: database is locked')
    return pendingAgents()
  }
  const logged: string[] = []
  const consoleError = console.error
  console.error = (...a: unknown[]) => void logged.push(a.map(x => (x instanceof Error ? x.message : String(x))).join(' '))
  const escaped: unknown[] = []
  // What the service's main() does with an error nothing caught: svc.panic, the kill switch for every agent.
  const onUnhandled = (err: unknown) => {
    escaped.push(err)
    svc.panic(err)
  }
  process.on('unhandledRejection', onUnhandled)
  try {
    ;(svc as unknown as { armPendingRetry: () => void }).armPendingRetry()
    for (let i = 0; i < 100 && svc.store.pending(0).length; i++) await sleep(20)
    await sleep(50)
  } finally {
    process.off('unhandledRejection', onUnhandled)
    console.error = consoleError
    await svc.stop()
  }
  assert.equal(escaped.length, 0, `${escaped.length} unhandled rejection(s) escaped the pending-retry timer: ${escaped.map(e => (e as Error).message).join(' | ')}`)
  assert.equal(svc.store.killSwitch, false, 'a failed pass must not turn the kill switch on')
  assert.ok(logged.some(l => /SQLITE_BUSY/.test(l)), `the failed pass is logged: ${logged.join(' | ')}`)
  assert.deepEqual(confirms, ['ht'], 'the next pass ran and confirmed the payment once')
  assert.equal(svc.store.pending(0).length, 0)
})
