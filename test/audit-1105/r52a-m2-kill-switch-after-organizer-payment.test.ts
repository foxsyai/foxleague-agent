// Audit 2 of PR #51 (money paths), R52A-M2. INTEG-1 / R51A-2 area: the create after the organizer payment.
// After the organizer payment is made, the create and its lost-answer retries (same idempotency key, 3 tries 6 s
// apart) never look at the kill switch, a pause or a stop; the seat payment that follows does (send() ->
// assertNotStopped). So with the kill switch pressed in that window:
//   (a) the tournament is created and the seat is never paid; the action ends with "the kill switch was turned on
//       before signing: nothing sent", which is false twice (the organizer payment went out, a tournament exists),
//       and the row carries no createdTournamentId (the `done` wrapper is only used on the happy path). Under the
//       kill switch no plan runs, so OPEN-8's line is not read either: the owner is told nothing was sent while a
//       tournament of theirs waits with the calendar deposit at stake (kept when too few teams join by the deadline,
//       docs/FOXLEAGUE-INTEGRATION.md 1889).
//   (b) the lost-answer retry still asks FoxLeague to create while the switch is on. An organizer payment no create
//       settles is refunded by FoxLeague's unconfirmed-payment net (same line of the notes); a tournament created
//       without a seat keeps the deposit if unfilled. Under the kill switch the retry can only make things worse.
// Expected: after the organizer payment, a create or a retry is not asked while the kill switch, a pause or a stop
// is on, and an error after the create names the created tournament (and keeps createdTournamentId on the row).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAction } from '../../src/executor/actions.ts'
import { ApiRefusal } from '../../src/foxleague/api.ts'
import { setup, snapshot, tournament, liveWallet, withLive } from '../fixtures.ts'

const LIVE_FEES = { live: true, live_from: '2026-11-09T14:00:00Z', private_match_fee_foxsy: 0, calendar_deposit_per_match_foxsy: 25, calendar_deposit_min_foxsy: 0, calendar_deposit_grace_minutes: 60 }
const OWED = { owed: true, games: 6, private_fee_foxsy: 0, deposit_foxsy: 150, total_foxsy: 150, grace_minutes: 60, no_free_cancel: false }
const SILVER_CUP = parseAction({ type: 'create_tournament', title: 'Autumn Cup', format: 'round_robin', tier: 'silver', max_teams: 4, min_teams: 3, entry_fee_foxsy: 1000, starts_in_hours: 96, registration_closes_minutes_before: 60, round_interval_minutes: 30 })
const FEE_REQUIRED = () => new ApiRefusal('This tournament needs a payment of 150 FOXSY from its organizer before it is created.', 'organizer_fee_required')

function liveSnapshot() {
  const s = snapshot()
  s.config!.organizer_fees = LIVE_FEES
  return s
}

test('R52A-M2a: the kill switch pressed while the create answers: the tournament exists, the organizer payment went out, the owner hears "nothing sent" and the row has no created id', async () => {
  let store: ReturnType<typeof setup>['store'] | undefined
  const createTournament = async (_w: unknown, body: Record<string, unknown>) => {
    if (!body.organizer_fee_tx_hash) throw FEE_REQUIRED()
    store!.setKillSwitch(true) // the owner presses it while FoxLeague creates
    return { id: 55 }
  }
  const m = setup({
    fox: { organizerFeeQuote: async () => OWED, createTournament, tournament: async () => tournament(55), joinTournament: async () => assert.fail('the seat is never asked for: the kill switch stops its payment') },
    chain: { send: async () => 'hashO' },
  })
  store = m.store
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, liveSnapshot(), [{ action: SILVER_CUP, reason: '' }])
    assert.equal(r!.status, 'error', r!.summary)
    assert.equal(r!.sent, true, 'the organizer payment went out (correct)')
    assert.equal(m.store.pending(0).filter(p => p.kind === 'organizer_fee').length, 0, 'the payment was used by the create (correct)')
    assert.equal(m.store.openSpend(0, 'shop:organizer_fee', false).length, 1, 'the deposit stays counted (correct)')
    // The defect: what the owner is told, and what the log keeps.
    assert.doesNotMatch(r!.summary, /nothing sent/, `the organizer payment was sent and T55 created; got: ${r!.summary}`)
    assert.match(r!.summary, /T55/, 'the owner must hear that the tournament exists with no seat of theirs (its deposit is kept if it stays unfilled)')
    const [row] = m.store.activity(0, 1)
    assert.equal((JSON.parse(row!.detail ?? '{}') as { createdTournamentId?: number }).createdTournamentId, 55, 'ownCreations reads the created id from the row')
  })
})

test('R52A-M2b: the kill switch pressed during the lost-answer wait: the create is asked again all the same', async () => {
  let store: ReturnType<typeof setup>['store'] | undefined
  const withHash: string[] = []
  const createTournament = async (_w: unknown, body: Record<string, unknown>, key: string) => {
    if (!body.organizer_fee_tx_hash) throw FEE_REQUIRED()
    withHash.push(key)
    if (withHash.length === 1) {
      store!.setKillSwitch(true) // pressed while the answer is on its way (and lost)
      throw new Error('fetch failed: socket hang up')
    }
    return { id: 55 }
  }
  const m = setup({
    fox: { organizerFeeQuote: async () => OWED, createTournament, tournament: async () => tournament(55), joinTournament: async () => assert.fail('the seat is never asked for') },
    chain: { send: async () => 'hashO' },
  })
  store = m.store
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, liveSnapshot(), [{ action: SILVER_CUP, reason: '' }])
    assert.equal(r!.status, 'error', r!.summary)
    // The defect: with the kill switch on, FoxLeague is still asked to create (the same key, 6 s later), and the seat
    // is then refused by the switch: a tournament without a seat (deposit at risk) instead of an unused payment
    // FoxLeague refunds.
    assert.equal(withHash.length, 1, `no create is asked while the kill switch is on; FoxLeague was asked ${withHash.length} times`)
    assert.match(r!.summary, /kill switch/)
  })
})

test('R52A-M2b: a pause pressed while the organizer payment confirms: no create is asked with it, the payment is left for the next create or the refund', async () => {
  let store: ReturnType<typeof setup>['store'] | undefined
  const withHash: string[] = []
  const createTournament = async (_w: unknown, body: Record<string, unknown>, key: string) => {
    if (!body.organizer_fee_tx_hash) throw FEE_REQUIRED()
    withHash.push(key)
    return { id: 55 }
  }
  const m = setup({
    fox: { organizerFeeQuote: async () => OWED, createTournament, tournament: async () => tournament(55), joinTournament: async () => assert.fail('the seat is never asked for') },
    chain: {
      send: async () => {
        store!.setPaused(0, true) // the owner pauses the agent while the payment is on its way
        return 'hashO'
      },
    },
  })
  store = m.store
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, liveSnapshot(), [{ action: SILVER_CUP, reason: '' }])
    assert.equal(r!.status, 'error', r!.summary)
    assert.equal(withHash.length, 0, 'no create is asked with the payment while the agent is paused')
    assert.match(r!.summary, /organizer payment hashO made, nothing created \(the agent was paused\)/)
    assert.equal(m.store.pending(0).filter(p => p.kind === 'organizer_fee').length, 1, 'the payment stays pending for the next create of this amount')
    assert.equal(m.store.openSpend(0, 'shop:organizer_fee', false).length, 1, 'the deposit sent stays counted')
    assert.equal(m.store.openSpend(0, 'join:', false).length, 0, 'the seat, never signed, is not counted')
  })
})

test('R52A-M2a: a seat payment signed after the create whose broadcast got no answer stays counted and pending, and the row keeps the created id', async () => {
  let sends = 0
  const createTournament = async (_w: unknown, body: Record<string, unknown>) => {
    if (!body.organizer_fee_tx_hash) throw FEE_REQUIRED()
    return { id: 55 }
  }
  const m = setup({
    fox: { organizerFeeQuote: async () => OWED, createTournament, tournament: async () => tournament(55), joinTournament: async () => assert.fail('no join without a known seat payment') },
    chain: {
      send: async () => {
        sends++
        if (sends === 1) return 'hashO'
        throw new Error('fetch failed: socket hang up') // the seat's broadcast: no answer, it may have gone out
      },
    },
  })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, liveSnapshot(), [{ action: SILVER_CUP, reason: '' }])
    assert.equal(r!.status, 'error', r!.summary)
    assert.equal(r!.sent, true)
    assert.match(r!.summary, /created T55 with organizer payment hashO; the seat payment: fetch failed/)
    assert.doesNotMatch(r!.summary, /seat not paid|nothing sent/)
    assert.equal(m.store.openSpend(0, 'join:55', false).length, 1, 'the seat that may have gone out stays counted')
    assert.equal(m.store.openSpend(0, 'shop:organizer_fee', false).length, 1, 'the deposit stays counted')
    assert.equal(m.store.pending(0).filter(p => p.kind === 'join').length, 1, 'the seat is held as pending, so the next plan does not pay it again')
    const [row] = m.store.activity(0, 1)
    assert.equal((JSON.parse(row!.detail ?? '{}') as { createdTournamentId?: number }).createdTournamentId, 55)
  })
})
