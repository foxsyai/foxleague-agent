// Audit 2026-11-04 (five Fable 5.1 reviewers at max effort, PRs #29 to #50): the proof of a finding, failing before its fix.
// INTEG-2: a paid join whose first /join answer is lost; FoxLeague's "You are already in this tournament" means SEATED,
// the agent reads it as "not seated" and tells the owner the entry will be refunded.
//
// FoxLeague (origin/main fcd79a74a), routes/tournaments.rs:
//  - 5595-5624 `join_seated_before_status`: a wallet that already holds a seat is answered
//    "You are already in this tournament" before any other gate ("the seat is the fact"); 6392-6397 the same words
//    from the pre-check. Neither carries a code; nothing is refunded (the seat backs the fee).
//  - the handler's own waits before it answers: `get_tx_status_final` up to `chain.tx_status_poll_timeout_ms`
//    (config_registry.rs:2647, 10 s by default), the LEG C proof re-poll 6 x 1.5 s (6901-6902), the escrow re-reads
//    (1603-1604) and the seat transaction: more than the agent's 20 s default request timeout (src/util/http.ts:76,
//    `joinTournament` sets none) under load, so the first answer can be lost after the seat was written.
//
// The agent (src/executor/executor.ts:1201-1214 payAndJoin): a transport error is retried with the same hash (good);
// the retry's "You are already in this tournament" matches neither "Do NOT pay again" nor
// /not confirmed on chain yet|retry/, so the action ends `error`: "paid <hash> but not seated: You are already in this
// tournament (FoxLeague refunds an unseated entry; ...)". The owner is told a seat that exists will be refunded; the
// activity row says the seat did not land. (src/executor/pending.ts:42 JOIN_FINAL already reads "already" as final.)
//
// Expected: the answer is read as the seat it is: `confirmed`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ApiRefusal } from '../../src/foxleague/api.ts'
import { setup, snapshot, tournament, liveWallet, withLive } from '../fixtures.ts'

test('INTEG-2: after a lost /join answer, FoxLeague\'s "You are already in this tournament" is the seat, not a failure', async () => {
  const joins: (string | undefined)[] = []
  const joinTournament = async (_w: unknown, _id: number, hash?: string) => {
    joins.push(hash)
    // The first answer never arrives (the handler's chain waits outran the request timeout); the seat was written.
    if (joins.length === 1) throw new Error('The operation was aborted due to timeout')
    // tournaments.rs:5619: the wallet holds the seat.
    throw new ApiRefusal('You are already in this tournament')
  }
  const m = setup({ fox: { tournament: async () => tournament(5), joinTournament }, chain: { send: async () => 'hashseat' } })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, snapshot(), [{ action: { type: 'join_tournament', tournament_id: 5 }, reason: '' }])
    assert.deepEqual(joins, ['hashseat', 'hashseat'], 'the same hash is sent again, never a second payment')
    assert.equal(r!.status, 'confirmed', `FoxLeague says the seat is there; got ${r!.status}: ${r!.summary}`)
    assert.doesNotMatch(r!.summary, /not seated|refunds an unseated entry/)
  })
  assert.equal(m.store.pending(0).filter(p => p.kind === 'join').length, 0, 'the seat is settled, nothing left to retry')
})
