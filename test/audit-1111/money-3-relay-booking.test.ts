// Audit 2026-11-11 (Fable 5.2 reviewers at extra-high effort): the proof of MONEY-3, failing before its fix.
// MONEY-3 (final audit 2026-11-11): the registration fee is booked, the relayed transaction is SIGNED and handed to
// the relay of FoxLeague, and then ANY ApiRefusal releases the booking ("an explicit refusal means the backend did not
// broadcast", src/executor/executor.ts:868-869). Two ApiRefusals do not mean that:
//  - the relay's own HTTP 500 "gateway broadcast failed: {e}" (docs/FOXLEAGUE-INTEGRATION.md, the relay table): the
//    relayer has signed and tried the broadcast; with a timeout as {e} the transaction may be on the network, which is
//    exactly what the agent's own send() keeps booked;
//  - "unexpected answer from ... (HTTP 5xx)": what the client throws for an empty or foreign body, which everywhere else
//    in the executor counts as no answer (R51A-2).
// Only the guards the relay runs before the broadcast (G2 to G13, the stock, the caps) prove that nothing left.
import test from 'node:test'
import assert from 'node:assert/strict'

import { setup, snapshot, liveWallet, withLive, ADDR } from '../fixtures.ts'
import { ApiRefusal } from '../../src/foxleague/api.ts'

function unregistered() {
  const s = snapshot()
  s.registration = { registered: false, teamName: null, feePaidOnChain: false, whitelisted: true, relayerEnabled: true, relaysRemaining: 10, profileUnreadable: false }
  s.profile = null
  s.team = null
  s.players = []
  s.auth = null
  s.config!.relayer_addresses = [ADDR] // a relayer on the same shard as the wallet
  return s
}

async function register(relayError: Error) {
  let signed = 0
  const m = setup({ fox: { nameAvailable: async () => ({ available: true }), relay: async () => { throw relayError } } })
  m.store.updateSettings(0, { setupBudgetUsd: 20 })
  const wallet = { ...liveWallet, signTransaction: () => { signed++ } }
  const r = await withLive(m.store, async () => (await m.exec.run(m.agent(), wallet, unregistered(), [{ action: { type: 'register', team_name: 'Tartu Rovers' }, reason: 'proof' }]))[0]!)
  return { r, signed, setupUsd: m.store.spentUsd(0, { category: 'setup', dryRun: false }) }
}

// Adapted with the fix: the guard is known by the HTTP status FoxLeague's relay gives it in its envelope (503 for
// the daily cap, onboarding.rs), which the client now carries on the refusal; the reviewer's control built the
// refusal without one.
test('MONEY-3 (control): a guard the relay runs before the broadcast releases the fee booking', async () => {
  for (const status of [403, 429, 503]) {
    const { signed, setupUsd } = await register(new ApiRefusal('G10: relayer daily cap 5000 reached', undefined, undefined, status))
    assert.equal(signed, 1)
    assert.equal(setupUsd, 0, `HTTP ${status}`)
  }
})

// Added with the fix: the status decides, never the words. A guard's words under the relay's 500, or with no status
// at all (an answer that is not FoxLeague's envelope), prove nothing.
test('MONEY-3: the words of a guard under HTTP 500, 502 or no status keep the signed fee counted', async () => {
  for (const status of [500, 502, 400, undefined]) {
    const { r, setupUsd } = await register(new ApiRefusal('G10: relayer daily cap 5000 reached', undefined, undefined, status))
    assert.ok(setupUsd > 0, `HTTP ${status}: ${r.summary}`)
    assert.match(r.summary, /it may have gone out all the same, so the fee stays counted/)
  }
})

test('MONEY-3: "gateway broadcast failed" from the relay keeps the signed fee counted (the broadcast may have gone out)', async () => {
  const { r, signed, setupUsd } = await register(new ApiRefusal('gateway broadcast failed: operation timed out'))
  assert.equal(signed, 1, 'the fee transaction was signed and sent to the relay')
  assert.ok(setupUsd > 0, 'the signed 5,000 FOXSY fee is no longer in the ledger (setup spend USD ' + setupUsd + ') after: ' + r.summary)
})

test('MONEY-3: an answer that is not the envelope of FoxLeague keeps the signed fee counted', async () => {
  const { r, signed, setupUsd } = await register(new ApiRefusal('unexpected answer from /onboarding/relay (HTTP 502)'))
  assert.equal(signed, 1, 'the fee transaction was signed and sent to the relay')
  assert.ok(setupUsd > 0, 'the signed 5,000 FOXSY fee is no longer in the ledger (setup spend USD ' + setupUsd + ') after: ' + r.summary)
})
