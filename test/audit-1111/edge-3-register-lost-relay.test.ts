// Audit 2026-11-11 (Fable 5.2 reviewers at extra-high effort): the proof of EDGE-3, failing before its fix.
// EDGE: the registration fee is booked in the one-time setup budget before the relay is asked. When the relay gives no
// answer (the connection drops, a 502 page while FoxLeague restarts, a timeout) the booking stays, rightly: the fee
// may have gone out. But the setup budget never resets, and nothing ever looks at that booking again: when the chain
// itself says later that the fee is NOT paid, the next register is refused by the setup budget for good (the default
// budget of $20 holds one fee of 5,000 FOXSY, not two), until the owner raises it with the password.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ADDR, liveWallet, setup, snapshot, withLive } from '../fixtures.ts'
import { DEFAULT_SETTINGS } from '../../src/store/settings.ts'
import type { PlannedAction } from '../../src/executor/actions.ts'

const act = (action: unknown): PlannedAction[] => [{ action: action as PlannedAction['action'], reason: '' }]

function unregistered() {
  const s = snapshot()
  s.registration = { ...s.registration, registered: false, teamName: null, feePaidOnChain: false }
  s.profile = null
  s.team = null
  s.players = []
  s.auth = null
  s.config!.relayer_addresses = [ADDR] // a relayer in the wallet's shard
  return s
}

test('a relay that gave no answer does not block the registration for good once the chain says the fee is unpaid', async () => {
  let relays = 0
  const m = setup({
    fox: {
      user: async () => null,
      nameAvailable: async () => ({ available: true }),
      // The first relay never reaches FoxLeague (the connection drops); the second one goes through.
      relay: async () => { if (++relays === 1) throw new TypeError('fetch failed'); return 'feehash' },
      register: async () => ({ user_id: 1, team_name: 'Lyon Rovers', nonces: Array.from({ length: 18 }, (_, i) => i + 1) }),
    },
  })
  m.store.updateSettings(0, { setupBudgetUsd: DEFAULT_SETTINGS.setupBudgetUsd }) // a new install's own default: $20
  await withLive(m.store, async () => {
    const [first] = await m.exec.run(m.agent(), liveWallet, unregistered(), act({ type: 'register', team_name: 'Lyon Rovers' }))
    assert.equal(first!.status, 'error', first!.summary)
    assert.ok(m.store.spentUsd(0, { category: 'setup', dryRun: false }) > 0, 'the fee stays booked while its outcome is unknown')

    // The next plan, two hours later: a fresh snapshot whose chain read says the fee is not paid (feePaidOnChain: false).
    const [second] = await m.exec.run(m.agent(), liveWallet, unregistered(), act({ type: 'register', team_name: 'Lyon Rovers' }))
    assert.doesNotMatch(second!.summary, /setup budget/, `the chain says the fee was never paid, yet the first booking refuses the registration: ${second!.summary}`)
    assert.equal(second!.status, 'confirmed', second!.summary)
  })
  assert.equal(relays, 2)
  // Added with the fix: the fee is counted once, by the registration that stands.
  assert.ok(Math.abs(m.store.spentUsd(0, { category: 'setup', dryRun: false }) - 5000 * 0.00225) < 0.01, 'one booking stands for the one fee the contract takes')
})

// Added with the fix. The earlier booking is never let go before the new registration's own booking is kept: the
// first transaction may still execute after the snapshot said "not paid", so from the first signature on one booking
// always stands for the fee (over-counting is allowed, under-counting never).
const FEE_USD = 5000 * 0.00225

/** A first registration whose relay gave no answer (its fee stays booked), then a second one as `second` scripts it. */
async function lostThen(second: { relay: () => Promise<string>; outcome?: () => Promise<unknown>; snap?: (s: ReturnType<typeof unregistered>) => void; before?: (m: ReturnType<typeof setup>) => void }) {
  let relays = 0
  const m = setup({
    chain: { waitForOutcome: async () => (second.outcome ? second.outcome() : { kind: 'success' }) },
    fox: {
      user: async () => null,
      nameAvailable: async () => ({ available: true }),
      relay: async () => { if (++relays === 1) throw new TypeError('fetch failed'); return second.relay() },
      register: async () => ({ user_id: 1, team_name: 'Lyon Rovers', nonces: Array.from({ length: 18 }, (_, i) => i + 1) }),
    },
  })
  m.store.updateSettings(0, { setupBudgetUsd: DEFAULT_SETTINGS.setupBudgetUsd })
  return withLive(m.store, async () => {
    const [first] = await m.exec.run(m.agent(), liveWallet, unregistered(), act({ type: 'register', team_name: 'Lyon Rovers' }))
    assert.equal(first!.status, 'error', first!.summary)
    second.before?.(m)
    const s = unregistered()
    second.snap?.(s)
    const [r] = await m.exec.run(m.agent(), liveWallet, s, act({ type: 'register', team_name: 'Lyon Rovers' }))
    // The fees the setup budget counts, read from the ledger's own sum (the fee is all a registration books there).
    const setupUsd = m.store.spentUsd(0, { category: 'setup', dryRun: false })
    return { r: r!, relays, fees: Math.round(setupUsd / FEE_USD), setupUsd }
  })
}

test('the first payment landed after all: the second one reverts on chain and the first booking stays counted', async () => {
  const { r, fees, setupUsd } = await lostThen({ relay: async () => 'feehash2', outcome: async () => ({ kind: 'failed', reason: 'Already paid registration' }) })
  assert.equal(r.status, 'failed', `the second registration was not even tried: ${r.summary}`)
  assert.match(r.summary, /registration payment reverted/)
  assert.equal(fees, 1, 'the fee that was paid is still booked')
  assert.ok(Math.abs(setupUsd - FEE_USD) < 0.01, `setup spend $${setupUsd}`)
})

test('the relay turns the second one away with a guard (403, already paid): its booking goes, the first stays', async () => {
  const { ApiRefusal } = await import('../../src/foxleague/api.ts')
  const { r, relays, fees, setupUsd } = await lostThen({ relay: async () => { throw new ApiRefusal('This wallet has already paid the registration fee.', undefined, undefined, 403) } })
  assert.equal(relays, 2, `the second registration was not even tried: ${r.summary}`)
  assert.equal(r.status, 'error', r.summary)
  assert.equal(fees, 1)
  assert.ok(Math.abs(setupUsd - FEE_USD) < 0.01, `setup spend $${setupUsd}`)
})

test('the second relay gives no answer either: one fee is counted, not two', async () => {
  const { r, relays, fees, setupUsd } = await lostThen({ relay: async () => { throw new TypeError('fetch failed') } })
  assert.equal(relays, 2, `the second registration was not even tried: ${r.summary}`)
  assert.equal(r.status, 'error', r.summary)
  assert.equal(fees, 1, 'the newer booking stands for the fee, the earlier one is let go')
  assert.ok(Math.abs(setupUsd - FEE_USD) < 0.01, `setup spend $${setupUsd}`)
})

test('the second one is stopped before its signature (the kill switch): nothing new is booked and the first booking stays', async () => {
  const { r, relays, fees, setupUsd } = await lostThen({ relay: async () => 'never', before: m => m.store.setKillSwitch(true) })
  assert.equal(relays, 1)
  assert.equal(r.status, 'refused', r.summary)
  assert.equal(fees, 1)
  assert.ok(Math.abs(setupUsd - FEE_USD) < 0.01, `setup spend $${setupUsd}`)
})

test('only the chain\'s own "not paid" counts the fee once: a fee state that could not be read pays nothing and lets nothing go', async () => {
  const { r, relays, fees } = await lostThen({ relay: async () => 'never', snap: s => { s.registration.feePaidOnChain = null } })
  assert.equal(relays, 1)
  assert.equal(r.status, 'refused', r.summary)
  assert.match(r.summary, /could not be read/)
  assert.equal(fees, 1)
})

test('the setup budget still holds a registration: a budget under one fee refuses it, with or without an earlier booking', async () => {
  const { r, relays, fees } = await lostThen({ relay: async () => 'never', before: m => m.store.updateSettings(0, { setupBudgetUsd: 5 }) })
  assert.equal(relays, 1)
  assert.equal(r.status, 'refused', r.summary)
  assert.match(r.summary, /setup budget: \$11\.25 needed, \$5\.00 of \$5\.00 left/)
  assert.equal(fees, 1)
})

test('the plan is told what the executor allows: with no team, a fee still booked does not shrink the setup budget it reads', async () => {
  const { budgetView } = await import('../../src/executor/budget.ts')
  const m = setup({ fox: { user: async () => null, nameAvailable: async () => ({ available: true }), relay: async () => { throw new TypeError('fetch failed') } } })
  m.store.updateSettings(0, { setupBudgetUsd: DEFAULT_SETTINGS.setupBudgetUsd })
  await withLive(m.store, async () => {
    await m.exec.run(m.agent(), liveWallet, unregistered(), act({ type: 'register', team_name: 'Lyon Rovers' }))
  })
  const settings = m.agent().settings
  const forPlan = budgetView(m.store, 0, settings, false, new Date(), 14, false)
  assert.equal(forPlan.remainingSetupUsd, DEFAULT_SETTINGS.setupBudgetUsd, 'the plan of a team that does not exist reads the whole setup budget')
  const ledger = budgetView(m.store, 0, settings, false, new Date())
  assert.ok(Math.abs(ledger.spentSetupUsd - FEE_USD) < 0.01, 'the ledger itself (the dashboard, a registered team) still counts the booking')
})
