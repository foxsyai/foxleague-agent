// Audit 2026-11-04 (five Fable 5.1 reviewers at max effort, PRs #29 to #50): the proof of a finding, failing before its fix.
// INTEG-1: a create whose HTTP answer is lost AFTER FoxLeague committed it, with the organizer's payment already made.
//
// FoxLeague (origin/main fcd79a74a):
//  - routes/tournaments.rs:3102-3200 `create_tournament`: the `idempotency-key` header; a key whose create succeeded
//    replays the stored answer for 24 h (idempotency.rs:48-75 get_cached_response); only a semantic success is stored
//    (tournaments.rs:3175 "Only cache on semantic success"), so the same key after a refusal re-runs the handler.
//  - organizer_fees.rs:170-176 `refund_of`: `Outcome::Unfilled` (the deadline passes with too few teams, line 651
//    `CancelBy::Deadline`) returns only the private fee: the calendar deposit is KEPT by FoxLeague.
//  - shop.rs:5060-5102 `record_organizer_payment_locked`: the hash is recorded as a purchase in the create's own
//    transaction, so a second create with it answers "Transaction already processed" (line 5077).
//
// The agent (src/executor/executor.ts:1134-1153): every create attempt sends a NEW idempotency key (`newKey()`), and a
// transport failure (a timeout, a socket error, a 502) after the organizer payment is answered at once as
// "organizer payment ... made, nothing created" with no retry. When the backend did commit the create, the tournament
// exists with the agent as its organizer and no seat of its own; the agent believes nothing was created, abandons the
// payment after 60 minutes (pending.ts) and never pays its seat, so the tournament stays unfilled and the deposit is kept.
//
// Expected: the same create is asked again with the SAME idempotency key (FoxLeague replays the created tournament),
// and the action goes on to pay the seat.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAction } from '../../src/executor/actions.ts'
import { ApiRefusal } from '../../src/foxleague/api.ts'
import { setup, snapshot, tournament, liveWallet, withLive } from '../fixtures.ts'

const LIVE_FEES = { live: true, live_from: '2026-11-09T14:00:00Z', private_match_fee_foxsy: 0, calendar_deposit_per_match_foxsy: 25, calendar_deposit_min_foxsy: 0, calendar_deposit_grace_minutes: 60 }
const OWED = { owed: true, games: 6, private_fee_foxsy: 0, deposit_foxsy: 150, total_foxsy: 150, grace_minutes: 60, no_free_cancel: false }
const SILVER_CUP = parseAction({ type: 'create_tournament', title: 'Autumn Cup', format: 'round_robin', tier: 'silver', max_teams: 4, min_teams: 3, entry_fee_foxsy: 1000, starts_in_hours: 96, registration_closes_minutes_before: 60, round_interval_minutes: 30 })

function liveSnapshot() {
  const s = snapshot()
  s.config!.organizer_fees = LIVE_FEES
  return s
}

test('INTEG-1: a create answered by a transport failure after the organizer payment is asked again with the same idempotency key, never declared "nothing created"', async () => {
  const calls: { body: Record<string, unknown>; key: string }[] = []
  const createTournament = async (_w: unknown, body: Record<string, unknown>, key: string) => {
    calls.push({ body: { ...body }, key })
    // organizer_fees.rs:239: no hash yet, the create asks for the payment (nothing created).
    if (!body.organizer_fee_tx_hash) throw new ApiRefusal('This tournament needs a payment of 150 FOXSY from its organizer before it is created.', 'organizer_fee_required')
    const withHash = calls.filter(c => c.body.organizer_fee_tx_hash)
    // The first create with the hash: FoxLeague committed it (the row, the booking, the purchase row of the hash),
    // the answer never reached the agent.
    if (withHash.length === 1) throw new Error('fetch failed: socket hang up')
    // idempotency.rs get_cached_response: the same key replays the stored success.
    if (key === withHash[0]!.key) return { id: 55 }
    // Another key is another create: the hash is already a recorded purchase (shop.rs:5077).
    throw new ApiRefusal('Transaction already processed')
  }
  const m = setup({
    fox: { organizerFeeQuote: async () => OWED, createTournament, tournament: async () => tournament(55), joinTournament: async () => ({}) },
    chain: { send: async () => `hash${calls.length}` },
  })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, liveSnapshot(), [{ action: SILVER_CUP, reason: '' }])
    assert.equal(r!.status, 'confirmed', `the create was replayed and the seat paid; got ${r!.status}: ${r!.summary}`)
    assert.doesNotMatch(r!.summary, /nothing created/)
  })
  const withHash = calls.filter(c => c.body.organizer_fee_tx_hash)
  assert.ok(withHash.length >= 2, 'the create was asked again after the lost answer')
  assert.equal(withHash[1]!.key, withHash[0]!.key, 'the retry carries the same idempotency key, so FoxLeague replays the created tournament instead of running a second create')
})
