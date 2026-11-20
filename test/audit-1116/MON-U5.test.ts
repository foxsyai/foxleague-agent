// MON-U5 (the MONEY reviewer's unproven item 5): with FoxLeague's organizer fees live the rules allow a create for its
// entry plus the quoted organizer payment (1000 + 150). The create is pressed first; when FoxLeague creates it without
// asking for the payment, the organizer booking is released and nothing is paid for it, but the result told the owner
// "cost ~$... (1150 FOXSY + fees)". The ledger is right; the words were not. What the owner reads names what was paid.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAction } from '../../src/executor/actions.ts'
import { setup, snapshot, tournament, liveWallet, withLive } from '../fixtures.ts'

const LIVE_FEES = { live: true, live_from: '2026-11-09T14:00:00Z', private_match_fee_foxsy: 0, calendar_deposit_per_match_foxsy: 25, calendar_deposit_min_foxsy: 0, calendar_deposit_grace_minutes: 60 }
const OWED = { owed: true, games: 6, private_fee_foxsy: 0, deposit_foxsy: 150, total_foxsy: 150, grace_minutes: 60, no_free_cancel: false }
const CUP = parseAction({ type: 'create_tournament', title: 'Autumn Cup', format: 'round_robin', tier: 'silver', max_teams: 4, min_teams: 3, entry_fee_foxsy: 1000, starts_in_hours: 96, registration_closes_minutes_before: 60, round_interval_minutes: 30 })

test('MON-U5 a create FoxLeague makes without an organizer payment reports the seat it paid, not the payment it did not ask for', async () => {
  const sent: string[] = []
  const m = setup({
    fox: {
      organizerFeeQuote: async () => OWED,
      createTournament: async () => ({ id: 55 }), // created at once: no organizer_fee_required
      tournament: async () => tournament(55, { sc_tournament_id: 55, status: 'open' }),
      joinTournament: async () => ({}),
    },
    chain: { send: async () => { sent.push('tx'); return `hash${sent.length}` } },
  })
  const s = snapshot()
  s.config!.organizer_fees = LIVE_FEES
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, s, [{ action: CUP, reason: '' }])
    assert.equal(r!.status, 'confirmed', r!.summary)
    assert.equal(sent.length, 1, 'only the seat was paid')
    assert.equal(m.store.openSpend(0, 'shop:organizer_fee', false).length, 0, 'no organizer payment is booked (correct)')
    assert.doesNotMatch(r!.summary, /1150 FOXSY/, `the owner is told 1150 FOXSY left when 1000 did: ${r!.summary}`)
    assert.match(r!.summary, /1000 FOXSY/)
  })
})
