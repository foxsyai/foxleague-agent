// Proof tests for the second review round of 2026-10-13 (money and limits, chain and FoxLeague). Each test is named
// after its finding (R2A = the money reviewer, R2C = the fresh reviewer) and failed on main 733a8d5 before the fix;
// a "control" passed before and after.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '../src/config.ts'
import { ADDR, STRANGER, dryWallet, encodeAuction, liveWallet, setup, snapshot, withLive, withFixture } from './fixtures.ts'
import { ApiRefusal } from '../src/foxleague/api.ts'
import { retryPendingPayments } from '../src/executor/pending.ts'
import { creditRefunds } from '../src/executor/refunds.ts'
import { Store } from '../src/store/db.ts'
import { DEFAULT_SETTINGS, LEVEL_SETTINGS } from '../src/store/settings.ts'
import { wholeToAtomic } from '../src/util/encoding.ts'
import type { PlannedAction } from '../src/executor/actions.ts'

const TEST_WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const act = (action: unknown): PlannedAction[] => [{ action: action as PlannedAction['action'], reason: '' }]
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const serviceConfig = () => ({
  mnemonic: TEST_WORDS, dataDir: mkdtempSync(join(tmpdir(), 'foxagent-r2-')),
  gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9', gatewayRps: 5, apiRps: 1, foxleagueRps: 5,
  anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined, isServer: false, defaultDryRun: true, maxAgents: 5,
}) as Config

type Fox = { shopConfirm: (w: unknown, b: { tx_hash: string }) => Promise<{ purchase_id: number; message: string }>; joinTournament: (w: unknown, id: number, hash?: string) => Promise<{ participant_id: number }> }
const foxCounting = (confirms: string[]): Fox => ({
  shopConfirm: async (_w, b) => (confirms.push(b.tx_hash), { purchase_id: 1, message: 'XP booster activated' }),
  joinTournament: async (_w, _id, hash) => (confirms.push(hash ?? ''), { participant_id: 1 }),
})

// ---- R2A-1 + R2C-2: a payment whose confirm answered tx_pending is confirmed again in routine operation ----

test('R2A-1 a shop payment FoxLeague refunded is confirmed once at the next routine tick (any age) and its FOXSY stops counting', async () => {
  let answer: () => never = () => { throw new ApiRefusal('Could not verify the payment state right now. Please retry in a moment.', 'tx_pending') }
  let asked = 0
  const m = setup({ chain: { send: async () => 'hpack' }, fox: { user: async () => null, shopConfirm: async () => { asked++; return answer() } } })
  const live = () => m.store.spentUsd(0, { category: 'play', dryRun: false })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, snapshot(), act({ type: 'buy', product: 'common_pack' }))
    assert.equal(r!.status, 'unconfirmed', r!.summary)
    assert.ok(live() > 5.6, 'the 2,500 FOXSY pack is booked')
    // The next routine tick, tickMinutes later. FoxLeague's sweep refunded the unconfirmed payment meanwhile
    // (docs 12.1: 30 min) and answers so to any confirm of the hash.
    answer = () => { throw new ApiRefusal('This payment was already refunded and cannot be used for a purchase.') }
    const told: string[] = []
    await retryPendingPayments({ store: m.store, fox: m.exec['d'].fox, notify: t => void told.push(t), alert: t => void told.push(`ALERT ${t}`) }, 0, liveWallet, Date.now() + DEFAULT_SETTINGS.tickMinutes * 60_000)
    assert.equal(asked, 2, `the next tick must confirm the hash once before giving it up (FoxLeague's answer is final at any age); told: ${told.join(' | ')}`)
    assert.ok(live() < 0.01, `FoxLeague refunded the 2,500 FOXSY: they must stop counting (A9), got $${live().toFixed(2)}`)
    assert.equal(m.store.pending(0).length, 0)
  })
})

test('R2A-1 a paid seat still pending at the next routine tick is joined with its hash, not abandoned unasked', async () => {
  const store = new Store('', ':memory:')
  store.addAgent(0, ADDR)
  store.addPending('hj', 0, 'join', { tournamentId: 555 })
  const calls: unknown[] = []
  const fox = { joinTournament: async (_w: unknown, id: number, hash?: string) => (calls.push([id, hash]), { participant_id: 1 }), shopConfirm: async () => ({ message: 'ok' }) }
  const alerted: string[] = []
  await retryPendingPayments({ store, fox: fox as never, notify: () => undefined, alert: t => void alerted.push(t) }, 0, dryWallet, Date.now() + DEFAULT_SETTINGS.tickMinutes * 60_000)
  assert.deepEqual(calls, [[555, 'hj']], `the seat must be joined with its hash at the next tick; instead: ${alerted.join(' | ')}`)
  assert.equal(store.pending(0).length, 0)
})

test('R2C-2 at the default cycle the next routine tick comes long after the paid confirm: it still confirms the hash', async () => {
  const { Service } = await import('../src/service.ts')
  const svc = new Service(serviceConfig())
  svc.ensureAgents()
  assert.equal(DEFAULT_SETTINGS.tickMinutes, 120)
  assert.equal(LEVEL_SETTINGS.zeus!.tickMinutes, 60)
  const paidAt = Date.now()
  ;(svc as unknown as { scheduleNext: (i: number, now: number) => void }).scheduleNext(0, paidAt)
  const nextTickAt = (svc as unknown as { nextAt: Map<number, number> }).nextAt.get(0)!
  clearTimeout((svc as unknown as { timers: Map<number, NodeJS.Timeout> }).timers.get(0))
  const minutesLater = (nextTickAt - paidAt) / 60_000
  assert.ok(minutesLater >= 110 && minutesLater <= 130, `next tick in ${minutesLater} min`)
  svc.store.addPending('hashA', 0, 'shop', { tx_hash: 'hashA', product: 'xp_booster' })
  const confirms: string[] = []
  const alerts: string[] = []
  await retryPendingPayments({ store: svc.store, fox: foxCounting(confirms) as never, notify: () => undefined, alert: t => void alerts.push(t) }, 0, dryWallet, nextTickAt)
  await svc.stop()
  assert.deepEqual(confirms, ['hashA'], `the 2,000 FOXSY booster payment was never confirmed again; instead: ${alerts.join(' | ') || '(no alert)'}`)
})

/** A service started with no Telegram, no ticks and no network; the pending retry every `everyMs`. */
async function startedService(everyMs: number) {
  const { Service } = await import('../src/service.ts')
  const svc = new Service(serviceConfig())
  const s = svc as unknown as Record<string, unknown>
  s.startTelegram = () => undefined
  s.schedule = () => undefined
  s.snapshot = async () => snapshot()
  s.pendingRetryMs = everyMs
  return svc
}

async function withoutWebUi<T>(fn: () => Promise<T>): Promise<T> {
  const env = { ...process.env }
  delete process.env.WEB_UI_USER
  delete process.env.WEB_UI_PASSWORD_HASH
  try {
    return await fn()
  } finally {
    Object.assign(process.env, env)
  }
}

async function until(pred: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms
  while (!pred() && Date.now() < end) await sleep(10)
}

test('R2C-2 the service confirms pending payments on its own timer, also outside the active hours, paused, retired and under the kill switch', async () => {
  const svc = await startedService(20)
  svc.ensureAgents()
  const confirms: string[] = []
  ;(svc as unknown as { fox: Fox }).fox = foxCounting(confirms)
  const h = new Date().getUTCHours()
  // Agent 1: the active hours have just closed (the plan runner may pay until their last second), and it is paused.
  svc.store.updateSettings(0, { activeHoursUtc: [(h + 2) % 24, (h + 3) % 24] })
  svc.store.setPaused(0, true)
  // Agent 2: retired after its last payment.
  svc.store.addAgent(1, svc.wallet(1).address)
  svc.store.retireAgent(1, { at: new Date().toISOString(), by: 'test', team: null, egld: null, foxsy: null, usd: null })
  svc.store.setKillSwitch(true)
  svc.store.addPending('hashB', 0, 'shop', { tx_hash: 'hashB', product: 'common_pack' })
  svc.store.addPending('hashS', 1, 'join', { tournamentId: 77 })
  assert.equal(await svc.tick(0), 'kill switch is on', 'no tick runs: only the pending timer can confirm the payment')
  await withoutWebUi(async () => {
    await svc.start()
    await until(() => confirms.length >= 2)
    await svc.stop()
  })
  assert.deepEqual(confirms.sort(), ['hashB', 'hashS'], 'a confirm signs and pays nothing: the paid pack and the paid seat are confirmed whatever the agent may do')
  assert.equal(svc.store.pending(0).length + svc.store.pending(1).length, 0)
})

test('R2A-1 the pending retry never runs alongside an action of the same agent (it waits for the executor lock)', async () => {
  const svc = await startedService(60_000)
  svc.ensureAgents()
  const confirms: string[] = []
  ;(svc as unknown as { fox: Fox }).fox = foxCounting(confirms)
  svc.store.addPending('hashL', 0, 'shop', { tx_hash: 'hashL', product: 'xp_booster' })
  let release!: () => void
  const held = new Promise<void>(r => (release = r))
  const exclusive = (svc.executor as unknown as { exclusive?: (i: number, fn: () => Promise<void>) => Promise<void> }).exclusive
  assert.equal(typeof exclusive, 'function', 'the executor offers its per-agent lock')
  const action = exclusive!.call(svc.executor, 0, () => held) // an action of agent 1, mid-flight
  const retry = (svc as unknown as { retryAllPending: () => Promise<void> }).retryAllPending()
  await sleep(50)
  assert.deepEqual(confirms, [], 'the confirm waits while the agent\'s action holds the lock')
  release()
  await action
  await retry
  assert.deepEqual(confirms, ['hashL'])
  await svc.stop()
})

test('R2A-1 a confirm still not final past the window is given up with an alert that says what is known', async () => {
  const store = new Store('', ':memory:')
  store.addAgent(0, ADDR)
  store.addPending('hseat', 0, 'join', { tournamentId: 7 })
  store.addPending('hshop', 0, 'shop', { tx_hash: 'hshop', product: 'common_pack' })
  const asked: string[] = []
  const pending = () => { throw new ApiRefusal('Could not verify the payment state right now. Please retry in a moment.', 'tx_pending') }
  const fox = { joinTournament: async (_w: unknown, _id: number, hash?: string) => (asked.push(hash!), pending()), shopConfirm: async (_w: unknown, b: { tx_hash: string }) => (asked.push(b.tx_hash), pending()) }
  const alerted: string[] = []
  await retryPendingPayments({ store, fox: fox as never, notify: () => undefined, alert: t => void alerted.push(t) }, 0, dryWallet, Date.now() + 3 * 3600_000)
  assert.deepEqual(asked.sort(), ['hseat', 'hshop'], 'asked once more before giving up')
  assert.equal(store.pending(0).length, 0, 'given up after the window')
  const seat = alerted.find(t => t.includes('hseat'))!
  assert.match(seat, /tournament seat payment hseat was never confirmed/)
  assert.doesNotMatch(seat, /refunds it automatically/, 'FoxLeague\'s reconciler may have seated a paid wallet: no promise of a refund')
  assert.match(seat, /Could not verify the payment state/, 'the last answer is told')
  assert.match(alerted.find(t => t.includes('hshop'))!, /shop payment hshop was never confirmed/)
})

test('R2A-1 control: a tx_pending answer within the window keeps the payment pending for the next retry', async () => {
  const store = new Store('', ':memory:')
  store.addAgent(0, ADDR)
  store.addPending('hshop', 0, 'shop', { tx_hash: 'hshop', product: 'common_pack' })
  const fox = { shopConfirm: async () => { throw new ApiRefusal('Could not verify the payment state right now. Please retry in a moment.', 'tx_pending') } }
  const alerted: string[] = []
  await retryPendingPayments({ store, fox: fox as never, notify: () => undefined, alert: t => void alerted.push(t) }, 0, dryWallet, Date.now() + 5 * 60_000)
  assert.equal(store.pending(0).length, 1)
  assert.deepEqual(alerted, [])
})

// ---- R2A-2: a tx_pending answer is never read as final for its wording ----

// backend/src/routes/shop.rs on origin/main (code tx_pending, grace from the registry).
const SHOP_TIMEOUT = 'Transaction verification timed out. The payment is not lost: it is recognized when this same transaction is confirmed again within 30 minutes; after that it is refunded automatically.'
// backend/src/routes/tournaments.rs on origin/main, both answered with retry_same_tx (code tx_pending).
const JOIN_RETRY = "We couldn't confirm your entry escrow is backing your seat right now. Please retry in a moment. If it was refunded (e.g. you left this tournament), your FOXSY is already back in your wallet."
const JOIN_REFUND_IN_FLIGHT = 'A refund of your entry fee for this tournament was started and is not confirmed yet. Please retry in a moment and do not pay again meanwhile: once the refund is confirmed your FOXSY is back in your wallet and you can pay again to join; if it does not go through, your payment still stands and counts for your seat.'

test('R2A-2 a tx_pending timeout answer at the retry keeps the shop payment pending (the hash must be confirmed again)', async () => {
  let confirms = 0
  const m = setup({ chain: { send: async () => 'hpack' }, fox: { user: async () => null, shopConfirm: async () => { confirms++; throw new ApiRefusal(SHOP_TIMEOUT, 'tx_pending') } } })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, snapshot(), act({ type: 'buy', product: 'common_pack' }))
    assert.equal(r!.status, 'unconfirmed', r!.summary)
    assert.equal(m.store.pending(0).length, 1, 'pending after the first tx_pending answer')
    await retryPendingPayments({ store: m.store, fox: m.exec['d'].fox, notify: () => undefined }, 0, liveWallet, Date.now() + 5 * 60_000)
    assert.equal(confirms, 2)
    assert.equal(m.store.pending(0).length, 1, 'FoxLeague said tx_pending (the payment can still be confirmed within its grace): the hash must stay pending for the next retry, not be resolved as done')
  })
})

test('R2A-2 a tx_pending "please retry" answer of /join keeps the paid seat pending for the next retry (both texts)', async () => {
  for (const said of [JOIN_RETRY, JOIN_REFUND_IN_FLIGHT]) {
    const store = new Store('', ':memory:')
    store.addAgent(0, ADDR)
    store.addPending('hj', 0, 'join', { tournamentId: 555 })
    const fox = { joinTournament: async () => { throw new ApiRefusal(said, 'tx_pending') }, shopConfirm: async () => ({ message: 'ok' }) }
    await retryPendingPayments({ store, fox: fox as never, notify: () => undefined }, 0, dryWallet, Date.now() + 5 * 60_000)
    assert.equal(store.pending(0).length, 1, `FoxLeague asked for a retry of the same hash (tx_pending): the seat payment must stay pending, not be resolved as done: ${said}`)
  }
})

test('R2A-2 control: FoxLeague\'s final answers still resolve the payment (no tx_pending code)', async () => {
  for (const [kind, said] of [['shop', 'Transaction already processed'], ['join', 'You are already in this tournament'], ['join', 'Tournament is not open for registration (status: in_progress)']] as const) {
    const store = new Store('', ':memory:')
    store.addAgent(0, ADDR)
    store.addPending('h', 0, kind, kind === 'shop' ? { tx_hash: 'h', product: 'common_pack' } : { tournamentId: 5 })
    const refuse = async () => { throw new ApiRefusal(said) }
    await retryPendingPayments({ store, fox: { joinTournament: refuse, shopConfirm: refuse } as never, notify: () => undefined }, 0, dryWallet, Date.now() + 5 * 60_000)
    assert.equal(store.pending(0).length, 0, said)
  }
})

// ---- R2A-3: a lost bid whose winner fused (burned) the card is credited, not kept for the month ----

/** A bid placed yesterday on #4881; the auction is gone (settled) and the card is not in the wallet (esdts readable). */
function settledRig(player: () => Promise<unknown>) {
  const m = setup()
  m.store.recordSpend({ agentIndex: 0, at: new Date(Date.now() - 25 * 3600_000), gameDay: '2026-10-12', category: 'play', action: 'bid:4881', foxsyAtomic: wholeToAtomic(1100), egldAtomic: 0n, usd: 2.5, txHash: 'h1', dryRun: false })
  const chain = { query: async () => [], esdts: async () => [{ tokenIdentifier: 'FOXSY-5d5f3e', balance: 1n, nonce: 0 }] }
  const deps = { store: m.store, chain: chain as never, fox: { tournament: async () => assert.fail('no seat here'), player } as never }
  const bids = () => m.store.openSpend(0, 'bid:', false).map(r => r.action)
  const spent = () => m.store.spentUsd(0, { category: 'play', dryRun: false })
  return { m, deps, bids, spent }
}

// players.rs get_player_by_nonce: a card FoxLeague deleted (burned in a fusion, chain_indexer) answers this, HTTP 200.
const notFound = async () => { throw new ApiRefusal('Player not found') }

test('R2A-3 the winner fused the card after the first sighting: the lost bid is credited once the grace passed, not kept for the month', async () => {
  let owner = async (): Promise<unknown> => ({ nft_nonce: 4881, owner_address: STRANGER })
  const { m, deps, bids, spent } = settledRig(() => owner())
  const now = Date.now()
  assert.equal(await creditRefunds(deps, m.agent(), false, now), 0, 'first sighting: the grace starts')
  owner = notFound
  const credited = await creditRefunds(deps, m.agent(), false, now + 11 * 60_000) + (await creditRefunds(deps, m.agent(), false, now + 2 * 3600_000)) + (await creditRefunds(deps, m.agent(), false, now + 20 * 86_400_000))
  assert.equal(credited, 1, `the card is neither in the wallet nor known to FoxLeague any more (burned by its new owner): the 1,100 FOXSY came back and must stop counting; rows: ${bids().join(',')}, counted $${spent()}`)
})

test('R2A-3 the winner fused the card before the first sighting (the auction ended overnight): credited after the grace', async () => {
  const { m, deps, bids, spent } = settledRig(notFound)
  const now = Date.now()
  assert.equal(await creditRefunds(deps, m.agent(), false, now), 0, 'first sighting: the grace starts')
  assert.equal(await creditRefunds(deps, m.agent(), false, now + 5 * 60_000), 0, 'still within the grace')
  const credited = await creditRefunds(deps, m.agent(), false, now + 11 * 60_000) + (await creditRefunds(deps, m.agent(), false, now + 20 * 86_400_000))
  assert.equal(credited, 1, `burned card, not in the wallet: the bid must be credited after the grace; rows: ${bids().join(',')}, counted $${spent()}`)
})

test('R2A-3 control: a card the agent fused itself (it won the bid) keeps counting; a FoxLeague 5xx is unknown', async () => {
  const own = settledRig(notFound)
  own.m.store.log({ agentIndex: 0, kind: 'fuse', status: 'confirmed', summary: 'fuse #4881 #4882 #4883', detail: { action: { type: 'fuse', player_nonces: [4881, 4882, 4883], position_of: 0 } }, txHash: 'hf' })
  const now = Date.now()
  assert.equal(await creditRefunds(own.deps, own.m.agent(), false, now) + (await creditRefunds(own.deps, own.m.agent(), false, now + 20 * 60_000)), 0)
  assert.ok(own.spent() >= 2.5, 'the agent burned the card it won: the bid stays spent')
  const maybe = settledRig(notFound)
  maybe.m.store.log({ agentIndex: 0, kind: 'fuse', status: 'unconfirmed', summary: 'fuse #4881 #4882 #4883', detail: { action: { type: 'fuse', player_nonces: [4881, 4882, 4883], position_of: 0 }, sent: true }, txHash: 'hf' })
  assert.equal(await creditRefunds(maybe.deps, maybe.m.agent(), false, now) + (await creditRefunds(maybe.deps, maybe.m.agent(), false, now + 20 * 60_000)), 0)
  assert.deepEqual(maybe.bids(), ['bid:4881'], 'a fusion of the card the agent sent with an unknown outcome: it may have won and burned it, so it keeps counting')
  const down = settledRig(async () => { throw new ApiRefusal('unexpected answer from /players/nonce/4881 (HTTP 500)') })
  assert.equal(await creditRefunds(down.deps, down.m.agent(), false, now) + (await creditRefunds(down.deps, down.m.agent(), false, now + 20 * 60_000)), 0)
  assert.deepEqual(down.bids(), ['bid:4881'], 'an unreadable owner keeps counting')
})

// ---- R2A-4: a won card relisted before the won-close ran is not credited ----

test('R2A-4 a won card relisted by the agent before the won-close: the bid it paid is not credited', async () => {
  const m = setup()
  m.store.recordSpend({ agentIndex: 0, at: new Date(Date.now() - 3 * 86_400_000), gameDay: '2026-10-10', category: 'play', action: 'bid:9', foxsyAtomic: wholeToAtomic(2000), egldAtomic: 0n, usd: 4.5, txHash: 'hashbid', dryRun: false })
  // The agent's own auction of #9 (seller = the agent, no bid yet); the card sits in the auction contract.
  const chain = {
    query: async (_sc: string, fn: string) => (fn === 'getAuction' ? [encodeAuction({ seller: ADDR, min: wholeToAtomic(3000), top: 0n, bidder: null, endsInS: 3600 })] : []),
    esdts: async () => [],
  }
  const fox = { tournament: async () => assert.fail('no seat'), player: async () => ({ nft_nonce: 9, owner_address: ADDR }) }
  const n = await creditRefunds({ store: m.store, chain: chain as never, fox: fox as never }, m.agent(), false)
  assert.equal(n, 0, 'the agent is the seller of the live auction: it owns the card, so it won the bid; nothing came back')
  assert.ok(m.store.spentUsd(0, { category: 'play', dryRun: false }) >= 4.5, 'the 2,000 FOXSY paid for the card keep counting')
  assert.deepEqual(m.store.openSpend(0, 'bid:', false).map(r => r.action), ['bid:9:won'], 'closed as won for good')
})

// ---- R2A-5: the agent's own booster purchase holds the next one, whatever FoxLeague's status says ----

test('R2A-5 a booster this agent bought and confirmed an hour ago is not bought again while FoxLeague reports none active', async () => {
  const m = setup({ chain: { send: async () => 'hb2' }, fox: { user: async () => null, shopConfirm: async () => ({ message: 'XP booster activated' }) } })
  await withLive(m.store, async () => {
    const [first] = await m.exec.run(m.agent(), liveWallet, withFixture(snapshot()), act({ type: 'buy', product: 'xp_booster' }))
    assert.equal(first!.status, 'confirmed', first!.summary)
    // The next plan: FoxLeague's shop status lost its booster query and says "none active" (shop.rs, defaulting inactive).
    const s = withFixture(snapshot())
    s.auth!.shop!.xp_booster_active = false
    s.auth!.shop!.xp_booster_expires_at = null
    const [again] = await m.exec.run(m.agent(), liveWallet, s, act({ type: 'buy', product: 'xp_booster' }))
    assert.equal(again!.status, 'refused', `the ledger holds a confirmed booster purchase (24 h of hours left): ${again!.summary}`)
    assert.match(again!.summary, /an XP booster was bought \d+ h ago/)
  })
})

test('R2A-5 the same in dry run: a simulated booster holds the next simulated one', async () => {
  const m = setup()
  const [first] = await m.exec.run(m.agent(), dryWallet, withFixture(snapshot()), act({ type: 'buy', product: 'xp_booster' }))
  assert.equal(first!.status, 'dry_run', first!.summary)
  const [again] = await m.exec.run(m.agent(), dryWallet, withFixture(snapshot()), act({ type: 'buy', product: 'xp_booster' }))
  assert.equal(again!.status, 'refused', again!.summary)
})

/** FoxLeague's shop status after its own booster query failed: "none active". */
const noBoosterSeen = () => {
  const s = withFixture(snapshot())
  s.auth!.shop!.xp_booster_active = false
  s.auth!.shop!.xp_booster_expires_at = null
  return s
}

/** Moves the agent's activity rows of a kind back in time (the log has no setter: a test reaches the table). */
const ageActivity = (store: Store, kind: string, ms: number) =>
  (store as unknown as { db: { prepare: (q: string) => { run: (...a: unknown[]) => unknown } } }).db
    .prepare('UPDATE activity SET at = ? WHERE kind = ?')
    .run(new Date(Date.now() - ms).toISOString(), kind)

test('R2A-5 (review of #12) a booster whose first confirm answered tx_pending, confirmed later by the pending retry, holds the next one an hour later', async () => {
  let answer: () => { message: string } = () => { throw new ApiRefusal('Could not verify the payment state right now. Please retry in a moment.', 'tx_pending') }
  const m = setup({ chain: { send: async () => 'hb3' }, fox: { user: async () => null, shopConfirm: async () => answer() } })
  await withLive(m.store, async () => {
    const [first] = await m.exec.run(m.agent(), liveWallet, withFixture(snapshot()), act({ type: 'buy', product: 'xp_booster' }))
    assert.equal(first!.status, 'unconfirmed', first!.summary)
    // The pending timer confirms it a minute later: the booster runs, its log row stays "unconfirmed".
    answer = () => ({ message: 'XP booster activated' })
    await retryPendingPayments({ store: m.store, fox: m.exec['d'].fox, notify: () => undefined }, 0, liveWallet)
    assert.equal(m.store.pending(0).length, 0, 'confirmed by the retry')
    ageActivity(m.store, 'buy', 3600_000)
    const [again] = await m.exec.run(m.agent(), liveWallet, noBoosterSeen(), act({ type: 'buy', product: 'xp_booster' }))
    assert.equal(again!.status, 'refused', `an hour-old booster purchase that may have paid (logged unconfirmed) must hold the next one: ${again!.summary}`)
    assert.match(again!.summary, /an XP booster was bought 1 h ago/)
  })
})

test('R2A-5 (review of #12) a booster sent whose answer was lost holds the next one; a refused or reverted one does not', async () => {
  const booster = { action: { type: 'buy', product: 'xp_booster' } }
  const lost = setup({ chain: { send: async () => 'hb4' }, fox: { user: async () => null, shopConfirm: async () => ({ message: 'XP booster activated' }) } })
  lost.store.log({ agentIndex: 0, kind: 'buy', status: 'error', summary: 'buy xp_booster: answer lost', detail: { ...booster, sent: true } })
  await withLive(lost.store, async () => {
    const [r] = await lost.exec.run(lost.agent(), liveWallet, noBoosterSeen(), act({ type: 'buy', product: 'xp_booster' }))
    assert.equal(r!.status, 'refused', `a booster payment that was signed and sent may have landed: ${r!.summary}`)
  })
  const none = setup({ chain: { send: async () => 'hb5' }, fox: { user: async () => null, shopConfirm: async () => ({ message: 'XP booster activated' }) } })
  none.store.log({ agentIndex: 0, kind: 'buy', status: 'refused', summary: 'buy xp_booster: refused', detail: booster })
  none.store.log({ agentIndex: 0, kind: 'buy', status: 'failed', summary: 'buy xp_booster: payment reverted', detail: booster })
  none.store.log({ agentIndex: 0, kind: 'buy', status: 'error', summary: 'buy xp_booster: no signature', detail: booster })
  await withLive(none.store, async () => {
    const [r] = await none.exec.run(none.agent(), liveWallet, noBoosterSeen(), act({ type: 'buy', product: 'xp_booster' }))
    assert.equal(r!.status, 'confirmed', `nothing was paid by a refused, reverted or unsigned purchase: ${r!.summary}`)
  })
})
