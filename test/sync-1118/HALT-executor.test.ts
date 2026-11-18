// HALT (the owner's rule after the MultiversX mainnet halt of 17 Nov 2026, 09:01 to about 15:00 UTC; FoxLeague names it
// in ef2d402a3 / #778): before the agent signs any transaction it checks that MultiversX is producing blocks. The agents
// sent nothing into that halt only because the EGLD price read failed at the same time ("prices unavailable"): with a
// price still readable they would have signed payments into a chain that confirmed nothing. A shard whose newest block
// is too old, or whose block time cannot be read, refuses (AGENTS.md rules 4 and 5): before anything is booked, and once
// more right before the signature, where a refusal releases the booking (rule 3). The next plan tries again.
//
// These tests use the executor only: the gateway's read and its threshold have their own tests (HALT-gateway).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Transaction } from '@multiversx/sdk-core'
import { ADDR, liveWallet, setup, snapshot, withFixture, withLive } from '../fixtures.ts'
import type { AgentWallet } from '../../src/wallet/wallet.ts'
import type { Store } from '../../src/store/db.ts'

/** The metachain's id in the gateway's routes. */
const META = 4294967295
const HOURS = 3600_000

/** The newest block per shard (ms), or an error for a shard whose status cannot be read; every other shard is fresh. */
function blocks(times: Partial<Record<number, number | Error>> = {}) {
  const asked: number[] = []
  let halted = false
  return {
    asked,
    /** From now on the metachain stops: what a halt between the first check and the signature looks like. */
    halt: () => { halted = true },
    newestBlockMs: async (shard: number) => {
      asked.push(shard)
      if (halted && shard === META) return Date.now() - 6 * HOURS
      const t = times[shard]
      if (t instanceof Error) throw t
      return t ?? Date.now() - 400
    },
  }
}

/** A live wallet that records what it signs. */
function signer(): AgentWallet & { signed: Transaction[] } {
  const signed: Transaction[] = []
  return { ...liveWallet, signed, signTransaction: (tx: Transaction) => void signed.push(tx) }
}

const spendRows = (store: Store) => (store.db.prepare('SELECT COUNT(*) AS n FROM spend').get() as { n: number }).n
const slot = { action: { type: 'buy', product: 'training_slot', quantity: 1 }, reason: '' } as const
const STALE = /the MultiversX network has produced no block since \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC \(the metachain, 6 h ago\): nothing is signed, the next plan tries again/

test('HALT-3 a live payment into a halted chain is refused before anything is booked or signed', async () => {
  const b = blocks({ [META]: Date.now() - 6 * HOURS })
  const calls: string[] = []
  const { exec, agent, store } = setup({ chain: { newestBlockMs: b.newestBlockMs, account: async () => (calls.push('account'), { nonce: 1, balance: 10n ** 19n }), send: async () => (calls.push('send'), 'hash1') } })
  const wallet = signer()
  await withLive(store, async () => {
    const [r] = await exec.run(agent(), wallet, withFixture(snapshot()), [slot])
    assert.equal(r!.status, 'refused', r!.summary)
    assert.match(r!.summary, STALE)
  })
  assert.equal(wallet.signed.length, 0, 'nothing is signed')
  assert.deepEqual(calls, [], 'the nonce is not even read: the refusal comes first')
  assert.equal(spendRows(store), 0, 'nothing is booked')
})

test('HALT-4 a halt seen right before the signature releases the booking and signs nothing', async () => {
  const b = blocks()
  const sent: string[] = []
  // The first check passes; the chain stops while the nonce is read, just before the signature.
  const { exec, agent, store } = setup({ chain: { newestBlockMs: b.newestBlockMs, account: async () => (b.halt(), { nonce: 1, balance: 10n ** 19n }), send: async () => (sent.push('send'), 'hash1') } })
  const wallet = signer()
  await withLive(store, async () => {
    const [r] = await exec.run(agent(), wallet, withFixture(snapshot()), [slot])
    assert.notEqual(r!.status, 'confirmed', r!.summary)
    assert.match(r!.summary, STALE)
    assert.notEqual(r!.sent, true, 'nothing was handed to the network')
  })
  assert.equal(wallet.signed.length, 0, 'nothing is signed')
  assert.deepEqual(sent, [])
  assert.equal(spendRows(store), 0, 'the booking made before the last check is released')
  assert.deepEqual(store.pending(0), [], "no payment is held as pending: none was signed")
})

test('HALT-5 a network status that cannot be read refuses: unknown is not "producing blocks"', async () => {
  for (const shard of [META, 0, 1]) {
    const b = blocks({ [shard]: new Error('gateway /network/status: HTTP 502 no data') })
    const { exec, agent, store } = setup({ chain: { newestBlockMs: b.newestBlockMs } })
    const wallet = signer()
    await withLive(store, async () => {
      const [r] = await exec.run(agent(), wallet, withFixture(snapshot()), [slot])
      assert.equal(r!.status, 'refused', r!.summary)
      assert.match(r!.summary, /whether the MultiversX network is producing blocks could not be read \((the metachain|shard [01]): gateway \/network\/status: HTTP 502 no data\): nothing is signed, the next plan tries again/)
    })
    assert.equal(wallet.signed.length, 0)
    assert.equal(spendRows(store), 0)
  }
  // A chain client without the read at all (an older or a broken one) is no exception.
  const { exec, agent, store } = setup()
  ;(exec as unknown as { d: { chain: Record<string, unknown> } }).d.chain.newestBlockMs = undefined
  const wallet = signer()
  await withLive(store, async () => {
    const [r] = await exec.run(agent(), wallet, withFixture(snapshot()), [slot])
    assert.equal(r!.status, 'refused', r!.summary)
    assert.match(r!.summary, /could not be read/)
  })
  assert.equal(wallet.signed.length, 0)
})

test('HALT-6 a fresh block on the metachain, the wallet\'s shard and the contracts\' shard lets the payment through', async () => {
  const b = blocks({ [META]: Date.now() - 900, 0: Date.now() - 300, 1: Date.now() - 10_000 })
  const { exec, agent, store } = setup({ chain: { newestBlockMs: b.newestBlockMs }, fox: { shopConfirm: async () => ({ message: 'training slot added' }) } })
  const wallet = signer()
  await withLive(store, async () => {
    const [r] = await exec.run(agent(), wallet, withFixture(snapshot()), [slot])
    assert.equal(r!.status, 'confirmed', r!.summary)
  })
  assert.equal(wallet.signed.length, 1)
  // The metachain, the signing wallet's shard (0) and shard 1, where FoxLeague's and xExchange's contracts are.
  assert.deepEqual([...new Set(b.asked)].sort(), [0, 1, META])
})

test('HALT-7 the registration relay is held to the same last check: a halt before its signature releases the fee', async () => {
  const b = blocks()
  const relayed: unknown[] = []
  const { exec, agent, store } = setup({
    chain: { newestBlockMs: b.newestBlockMs, account: async () => (b.halt(), { nonce: 1, balance: 10n ** 19n }) },
    fox: { nameAvailable: async () => ({ available: true }), relay: async (_w: unknown, tx: unknown) => (relayed.push(tx), 'hash-relay'), register: async () => assert.fail('no team is named without its fee') },
  })
  const s = snapshot()
  s.registration = { ...s.registration, registered: false, feePaidOnChain: false }
  s.config!.relayer_addresses = [ADDR]
  const wallet = signer()
  await withLive(store, async () => {
    const [r] = await exec.run(agent(), wallet, s, [{ action: { type: 'register', team_name: 'Lyon Rovers' }, reason: '' }])
    assert.notEqual(r!.status, 'confirmed', r!.summary)
    assert.match(r!.summary, STALE)
    assert.notEqual(r!.sent, true)
  })
  assert.equal(wallet.signed.length, 0)
  assert.deepEqual(relayed, [], 'nothing is handed to the relay')
  assert.equal(spendRows(store), 0, 'the registration fee booked before the last check is released')
})

test('HALT-8 the owner\'s own action (Telegram /do, the dashboard) goes through the same check', async () => {
  const b = blocks({ [META]: Date.now() - 6 * HOURS })
  const { exec, agent, store } = setup({ chain: { newestBlockMs: b.newestBlockMs } })
  const wallet = signer()
  await withLive(store, async () => {
    const [r] = await exec.run(agent(), wallet, withFixture(snapshot()), [{ ...slot, reason: 'owner (Telegram /do)', byOwner: true }])
    assert.equal(r!.status, 'refused', r!.summary)
    assert.match(r!.summary, STALE)
  })
  assert.equal(wallet.signed.length, 0)
  assert.equal(spendRows(store), 0)
})

test('HALT-9 a dry run on a halted chain refuses as live would, and books nothing', async () => {
  const b = blocks({ [META]: Date.now() - 6 * HOURS })
  let simulated = 0
  const { exec, agent, store } = setup({ chain: { newestBlockMs: b.newestBlockMs, simulate: async () => (simulated++, { ok: true, detail: 'success', raw: {} }) } })
  const [r] = await exec.run(agent(), { ...liveWallet, signTransaction: () => assert.fail('must not sign in dry run') }, withFixture(snapshot()), [slot])
  assert.equal(r!.status, 'refused', r!.summary)
  assert.match(r!.summary, STALE)
  assert.equal(simulated, 0)
  assert.equal(spendRows(store), 0)
})

test('HALT-10 (control) an action that signs nothing does not wait on the chain (lineups, training, casual games)', async () => {
  const b = blocks({ [META]: Date.now() - 6 * HOURS })
  const { exec, agent, store } = setup({ chain: { newestBlockMs: b.newestBlockMs }, fox: { train: async () => ({}) } })
  await withLive(store, async () => {
    const [r] = await exec.run(agent(), signer(), snapshot(), [{ action: { type: 'train', player_nonce: 2, attribute: 'defense' }, reason: '' }])
    assert.equal(r!.status, 'confirmed', r!.summary)
  })
  assert.deepEqual(b.asked, [], 'no network status is read for an action without a signature')
})
