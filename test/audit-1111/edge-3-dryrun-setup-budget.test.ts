// Audit 2026-11-11 (Fable 5.2 reviewers at extra-high effort): the proof of EDGE-3, failing before its fix.
// EDGE: a new install starts in dry run (rule 8) with one unregistered agent. Its first plan simulates the registration
// and books the fee in the dry-run ledger's one-time setup budget. The team does not exist afterwards (nothing was
// sent), so the next plan simulates it again, and from then on every dry-run registration is refused: "setup budget:
// $11.25 needed, $8.75 of $20.00 left". The setup budget never resets, so a dry run of a new wallet shows one
// simulated registration and then a budget refusal for as long as it runs, whatever the owner funds.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ADDR, dryWallet, setup, snapshot } from '../fixtures.ts'
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
  s.config!.relayer_addresses = [ADDR]
  return s
}

test('dry run: the second simulated registration of a wallet that still has no team is not refused by the first one\'s simulated fee', async () => {
  const m = setup({ fox: { user: async () => null, nameAvailable: async () => ({ available: true }) } })
  m.store.updateSettings(0, { setupBudgetUsd: DEFAULT_SETTINGS.setupBudgetUsd })
  const [first] = await m.exec.run(m.agent(), dryWallet, unregistered(), act({ type: 'register', team_name: 'Lyon Rovers' }))
  assert.equal(first!.status, 'dry_run', first!.summary)
  // Two hours later: the chain still says no fee was paid and no team exists (the dry run sent nothing).
  const [second] = await m.exec.run(m.agent(), dryWallet, unregistered(), act({ type: 'register', team_name: 'Lyon Rovers' }))
  assert.equal(second!.status, 'dry_run', `the dry run now reports a budget problem that does not exist: ${second!.summary}`)
  // Added with the fix: however often the dry run simulates it, the dry-run ledger counts the one fee once, and the
  // live ledger knows nothing of it.
  const [third] = await m.exec.run(m.agent(), dryWallet, unregistered(), act({ type: 'register', team_name: 'Lyon Rovers' }))
  assert.equal(third!.status, 'dry_run', third!.summary)
  assert.ok(Math.abs(m.store.spentUsd(0, { category: 'setup', dryRun: true }) - 5000 * 0.00225) < 0.01, 'one simulated fee in the dry-run ledger')
  assert.equal(m.store.spentUsd(0, { category: 'setup', dryRun: false }), 0)
})

// Added with the fix: the dry-run ledger and the live one stay apart. A fee the dry run simulated never makes room in
// the live setup budget, and a registration that goes live is not held back by it either.
test('a simulated fee in the dry-run ledger is nothing to the live one: the live registration books its own fee', async () => {
  const m = setup({ fox: { user: async () => null, nameAvailable: async () => ({ available: true }), relay: async () => 'feehash', register: async () => ({ user_id: 1, team_name: 'Lyon Rovers', nonces: [1] }) } })
  m.store.updateSettings(0, { setupBudgetUsd: DEFAULT_SETTINGS.setupBudgetUsd })
  await m.exec.run(m.agent(), dryWallet, unregistered(), act({ type: 'register', team_name: 'Lyon Rovers' }))
  const { liveWallet, withLive } = await import('../fixtures.ts')
  await withLive(m.store, async () => {
    const [live] = await m.exec.run(m.agent(), liveWallet, unregistered(), act({ type: 'register', team_name: 'Lyon Rovers' }))
    assert.equal(live!.status, 'confirmed', live!.summary)
  })
  assert.ok(Math.abs(m.store.spentUsd(0, { category: 'setup', dryRun: false }) - 5000 * 0.00225) < 0.01)
  assert.ok(Math.abs(m.store.spentUsd(0, { category: 'setup', dryRun: true }) - 5000 * 0.00225) < 0.01, 'the dry-run row is untouched by the live registration')
})
