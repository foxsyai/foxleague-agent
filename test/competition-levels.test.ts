// FoxLeague's rule change of 9 November 2026, 14:00 UTC (its branch feat/competition-levels, feat/organizer-fees,
// feat/leave-lock, feat/flexible-groups): a paid ranked ticket, paid Bronze, XP and ELO by level, a leave lock, a calendar
// deposit and a private fee. Everything follows the switches in /api/config, so nothing changes before them.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAction } from '../src/executor/actions.ts'
import { ApiRefusal } from '../src/foxleague/api.ts'
import { BroadcastRefused } from '../src/chain/gateway.ts'
import { levelsLive, organizerFeesLive, leaveLockLive } from '../src/foxleague/levels.ts'
import { matchesAtMost } from '../src/executor/rules.ts'
import { retryPendingPayments } from '../src/executor/pending.ts'
import { renderDigest } from '../src/snapshot/digest.ts'
import { validateSettingsPatch } from '../src/store/settings.ts'
import { wholeToAtomic } from '../src/util/encoding.ts'
import { STRATEGY_PRESETS } from '../src/store/settings.ts'
import type { Store } from '../src/store/db.ts'
import { dryWallet, liveWallet, setup, snapshot, tournament, withLive } from './fixtures.ts'

const LIVE_LEVELS = {
  live: true, live_from: '2026-11-09T14:00:00Z', ranked_ticket_price_foxsy: 100,
  xp_factor_pct: { ranked: 50, bronze: 25, silver: 75, gold: 100 }, elo_k: { ranked: 9, bronze: 5, silver: 13, gold: 17 },
  private_bronze_earns: true, competitive_daily_cap: 3,
}
const LIVE_FEES = { live: true, live_from: '2026-11-09T14:00:00Z', private_match_fee_foxsy: 15, calendar_deposit_per_match_foxsy: 25, calendar_deposit_min_foxsy: 100, calendar_deposit_grace_minutes: 60 }

/** The fixture's snapshot with the switches on. */
function liveSnapshot() {
  const s = snapshot()
  const c = s.config!
  c.competition_levels = LIVE_LEVELS
  c.organizer_fees = LIVE_FEES
  c.tournament_fee_bounds = { ...c.tournament_fee_bounds, bronze_min: 100, bronze_max: 999 }
  c.tournament_defaults = { ...c.tournament_defaults, leave_lock_live: true }
  return s
}

const RANKED = { type: 'play_match' as const, match_type: 'ranked' as const }
/** The live ledger's rows with this prefix, as [action, FOXSY atomic]. */
const rowsOf = (m: { store: Store }, prefix: string) =>
  (m.store.db.prepare("SELECT action, foxsy_atomic FROM spend WHERE agent_idx = 0 AND dry_run = 0 AND foxsy_atomic <> '0' AND action LIKE ? ORDER BY id").all(`${prefix}%`) as { action: string; foxsy_atomic: string }[]).map(r => [r.action, r.foxsy_atomic])
const spendOf = rowsOf
const required = () => new ApiRefusal('A ranked game costs 100 FOXSY: pay for a ticket first.', 'ranked_ticket_required')

// ---- the switches ----

test('CL0: the switches read only what FoxLeague serves; no block or off is the old rules', () => {
  const now = new Date('2026-11-09T14:00:01Z')
  assert.equal(levelsLive(undefined, now), false)
  assert.equal(levelsLive(snapshot().config!, now), false, 'an older backend has no block')
  assert.equal(levelsLive(liveSnapshot().config!, now), true)
  const off = snapshot().config!
  off.competition_levels = { ...LIVE_LEVELS, live: false, live_from: null }
  assert.equal(levelsLive(off, now), false)
  // A config read just before the switch said false: the moment it names still counts.
  off.competition_levels = { ...LIVE_LEVELS, live: false }
  assert.equal(levelsLive(off, now), true)
  assert.equal(levelsLive(off, new Date('2026-11-09T13:59:59Z')), false)
  off.organizer_fees = { ...LIVE_FEES, live: false }
  assert.equal(organizerFeesLive(off, now), true)
  assert.equal(organizerFeesLive(off, new Date('2026-11-09T13:59:59Z')), false)
  assert.equal(leaveLockLive(snapshot().config!), false)
  assert.equal(leaveLockLive(liveSnapshot().config!), true)
})

// ---- the ranked ticket ----

test('CL1: before the switch a ranked start reads no ticket and pays nothing', async () => {
  const calls: string[] = []
  const m = setup({ fox: { rankedTicket: async () => { calls.push('read'); return { live: false, price_foxsy: 100, tickets: 0 } }, playMatch: async () => { calls.push('play'); return { match_id: 7 } } }, chain: { send: async () => assert.fail('nothing is paid') } })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, snapshot(), [{ action: RANKED, reason: '' }])
    assert.equal(r!.status, 'confirmed', r!.summary)
  })
  assert.deepEqual(calls, ['play'])
})

test('CL2: live, no ticket: the start is pressed first, so any other gate refuses with nothing paid and nothing counted', async () => {
  const m = setup({ fox: { rankedTicket: async () => ({ live: true, price_foxsy: 100, tickets: 0 }), playMatch: async () => { throw new ApiRefusal('Ranked cooldown: your squad needs to rest. Wait 2m (97s) before the next ranked match.') } }, chain: { send: async () => assert.fail('nothing is paid') } })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, liveSnapshot(), [{ action: RANKED, reason: '' }])
    assert.equal(r!.status, 'error', r!.summary)
    assert.match(r!.summary, /Ranked cooldown/)
  })
  assert.deepEqual(rowsOf(m, ''), [], 'the booking is released')
})

test('CL3: live, no ticket: FoxLeague asks, one shopPay of the price, the ticket recorded, the start pressed again', async () => {
  const calls: string[] = []
  let pressed = 0
  const m = setup({
    fox: {
      rankedTicket: async () => ({ live: true, price_foxsy: 100, tickets: 0 }),
      playMatch: async () => { calls.push('play'); if (pressed++ === 0) throw required(); return { match_id: 11, ranked_paid: true } },
      buyRankedTicket: async (_w: unknown, hash: string) => { calls.push(`ticket ${hash}`); return { live: true, price_foxsy: 100, tickets: 1 } },
    },
    chain: { send: async (tx: { data?: string }) => { calls.push(`send ${Buffer.from(tx.data ?? '', 'base64').toString().split('@').slice(0, 3).join('@')}`); return 'hash1' } },
  })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, liveSnapshot(), [{ action: RANKED, reason: '' }])
    assert.equal(r!.status, 'confirmed', r!.summary)
    assert.match(r!.summary, /match #11 started \(ranked\)/)
    assert.match(r!.summary, /100 FOXSY/)
    assert.equal(r!.txHash, 'hash1')
  })
  assert.equal(calls[0], 'play')
  assert.match(calls[1]!, /^send ESDTTransfer@[0-9a-f]+@056bc75e2d63100000$/, 'exactly 100 FOXSY')
  assert.deepEqual(calls.slice(2), ['ticket hash1', 'play'])
  assert.deepEqual(spendOf(m, 'shop:'), [['shop:ranked_ticket', wholeToAtomic(100).toString()]], 'booked once')
  assert.equal(m.store.pending(0).length, 0)
})

test('CL4: a ticket already held pays nothing', async () => {
  const calls: string[] = []
  const m = setup({ fox: { rankedTicket: async () => ({ live: true, price_foxsy: 100, tickets: 1 }), playMatch: async () => { calls.push('play'); return { match_id: 12, ranked_paid: true } } }, chain: { send: async () => assert.fail('nothing is paid') } })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, liveSnapshot(), [{ action: RANKED, reason: '' }])
    assert.equal(r!.status, 'confirmed', r!.summary)
  })
  assert.deepEqual(calls, ['play'])
})

test('CL5: tickets that cannot be read are no "none": no start, nothing paid', async () => {
  const calls: string[] = []
  const m = setup({ fox: { rankedTicket: async () => { throw new Error('HTTP 502') }, playMatch: async () => { calls.push('play'); return { match_id: 1 } } }, chain: { send: async () => assert.fail('nothing is paid') } })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, liveSnapshot(), [{ action: RANKED, reason: '' }])
    assert.equal(r!.status, 'refused', r!.summary)
    assert.match(r!.summary, /ticket/)
  })
  assert.deepEqual(calls, [])
})

test('CL6: a ticket payment still waiting is never paid again, and its retry confirms with the same hash', async () => {
  const m = setup({ fox: { rankedTicket: async () => ({ live: true, price_foxsy: 100, tickets: 0 }), playMatch: async () => assert.fail('no start') }, chain: { send: async () => assert.fail('never paid twice') } })
  m.store.addPending('hash9', 0, 'ranked_ticket', { tx_hash: 'hash9' })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, liveSnapshot(), [{ action: RANKED, reason: '' }])
    assert.equal(r!.status, 'refused', r!.summary)
    assert.match(r!.summary, /waiting|waits/)
  })
  const told: string[] = []
  const seen: string[] = []
  await retryPendingPayments({ store: m.store, fox: { shopConfirm: async () => assert.fail('not a shop product'), joinTournament: async () => assert.fail('not a seat'), buyRankedTicket: async (_w: unknown, h: string) => { seen.push(h); return { live: true, price_foxsy: 100, tickets: 1 } } } as never, notify: t => told.push(t) }, 0, liveWallet)
  assert.deepEqual(seen, ['hash9'])
  assert.equal(m.store.pending(0).length, 0)
  assert.match(told[0]!, /ticket/)
})

test('CL6: "Transaction already processed" on the retry is final: an earlier confirm recorded it', async () => {
  const m = setup()
  m.store.addPending('hash9', 0, 'ranked_ticket', { tx_hash: 'hash9' })
  await retryPendingPayments({ store: m.store, fox: { buyRankedTicket: async () => { throw new ApiRefusal('Transaction already processed') } } as never, notify: () => undefined }, 0, liveWallet)
  assert.equal(m.store.pending(0).length, 0)
})

test('CL7: a payment FoxLeague cannot verify yet keeps its hash; nothing is paid again and the start waits', async () => {
  let pressed = 0
  const m = setup({
    fox: {
      rankedTicket: async () => ({ live: true, price_foxsy: 100, tickets: 0 }),
      playMatch: async () => { if (pressed++ === 0) throw required(); assert.fail('no start without the ticket') },
      buyRankedTicket: async () => { throw new ApiRefusal('Could not verify transaction yet. Please confirm again in a moment.', 'tx_pending') },
    },
  })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, liveSnapshot(), [{ action: RANKED, reason: '' }])
    assert.equal(r!.status, 'unconfirmed', r!.summary)
  })
  assert.deepEqual(m.store.pending(0).map(p => p.hash), ['hash1'])
  assert.equal(m.store.openSpend(0, 'shop:', false).length, 1, 'it stays counted')
})

test('CL8: a start refused after the ticket was bought says the ticket stays, and the payment stays counted', async () => {
  let pressed = 0
  const m = setup({
    fox: {
      rankedTicket: async () => ({ live: true, price_foxsy: 100, tickets: 0 }),
      playMatch: async () => { if (pressed++ === 0) throw required(); throw new ApiRefusal('Servers are busy with other matches right now. Please try again in a few seconds.') },
      buyRankedTicket: async () => ({ live: true, price_foxsy: 100, tickets: 1 }),
    },
  })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, liveSnapshot(), [{ action: RANKED, reason: '' }])
    assert.equal(r!.status, 'error', r!.summary)
    assert.match(r!.summary, /ticket stays/)
    assert.equal(r!.txHash, 'hash1')
  })
  assert.equal(m.store.openSpend(0, 'shop:', false).length, 1)
})

test('CL9: a game the AI fills says so: free, the ticket stays', async () => {
  const m = setup({ fox: { rankedTicket: async () => ({ live: true, price_foxsy: 100, tickets: 1 }), playMatch: async () => ({ match_id: 13, ranked_paid: false }) } })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, liveSnapshot(), [{ action: RANKED, reason: '' }])
    assert.equal(r!.status, 'confirmed', r!.summary)
    assert.match(r!.summary, /started \(ranked\)/, 'the cooldown reads the word ranked in this row')
    assert.match(r!.summary, /AI filled it.*ticket stays/)
  })
})

test('CL10: the ticket keeps to the owner\'s limit and the wallet', async () => {
  const over = setup({ fox: { rankedTicket: async () => ({ live: true, price_foxsy: 100, tickets: 0 }), playMatch: async () => assert.fail('no start') } })
  over.store.updateSettings(0, { maxShopPaymentFoxsy: 99 })
  await withLive(over.store, async () => {
    const [r] = await over.exec.run(over.agent(), liveWallet, liveSnapshot(), [{ action: RANKED, reason: '' }])
    assert.equal(r!.status, 'refused', r!.summary)
    assert.match(r!.summary, /maximum|limit/)
  })
  const poor = setup({ fox: { rankedTicket: async () => ({ live: true, price_foxsy: 100, tickets: 0 }), playMatch: async () => assert.fail('no start') } })
  const s = liveSnapshot()
  s.chain!.foxsy = wholeToAtomic(99)
  await withLive(poor.store, async () => {
    const [r] = await poor.exec.run(poor.agent(), liveWallet, s, [{ action: RANKED, reason: '' }])
    assert.equal(r!.status, 'refused', r!.summary)
    assert.match(r!.summary, /needs 100 FOXSY/)
  })
  // Casual stays free whatever the switch says.
  const casual = setup({ fox: { playMatch: async () => ({ match_id: 2 }) }, chain: { send: async () => assert.fail('nothing is paid') } })
  await withLive(casual.store, async () => {
    const [r] = await casual.exec.run(casual.agent(), liveWallet, s, [{ action: { type: 'play_match', match_type: 'casual' }, reason: '' }])
    assert.equal(r!.status, 'confirmed', r!.summary)
  })
})

test('CL11: a dry run simulates the ticket and presses nothing', async () => {
  const m = setup({ fox: { rankedTicket: async () => ({ live: true, price_foxsy: 100, tickets: 0 }), playMatch: async () => assert.fail('no start in a dry run') } })
  const [r] = await m.exec.run(m.agent(), dryWallet, liveSnapshot(), [{ action: RANKED, reason: '' }])
  assert.equal(r!.status, 'dry_run', r!.summary)
  assert.match(r!.summary, /shopPay: simulation ok/)
  assert.match(r!.summary, /100 FOXSY/)
})

// ---- paid Bronze ----

test('CL12: a paid Bronze takes its seat on chain, a free one as before', async () => {
  const calls: string[] = []
  const paid = setup({
    fox: { tournament: async () => tournament(7, { tier: 'bronze', entry_fee_foxsy: 250 }), joinTournament: async (_w: unknown, id: number, h?: string) => { calls.push(`join ${id} ${h}`); return {} } },
    chain: { send: async (tx: { data?: string }) => { calls.push(Buffer.from(tx.data ?? '', 'base64').toString().split('@').slice(0, 3).join('@')); return 'hash1' } },
  })
  await withLive(paid.store, async () => {
    const [r] = await paid.exec.run(paid.agent(), liveWallet, liveSnapshot(), [{ action: { type: 'join_tournament', tournament_id: 7 }, reason: '' }])
    assert.equal(r!.status, 'confirmed', r!.summary)
    assert.match(r!.summary, /250 FOXSY/)
  })
  assert.match(calls[0]!, /^ESDTTransfer@[0-9a-f]+@0d8d726b7177a80000$/, 'exactly 250 FOXSY')
  assert.equal(calls[1], 'join 7 hash1')
  assert.equal(paid.store.openSpend(0, 'join:7', false).length, 1)

  const over = setup({ fox: { tournament: async () => tournament(7, { tier: 'bronze', entry_fee_foxsy: 250 }) } })
  over.store.updateSettings(0, { maxEntryFeeFoxsy: 200 })
  const [r] = await over.exec.run(over.agent(), dryWallet, liveSnapshot(), [{ action: { type: 'join_tournament', tournament_id: 7 }, reason: '' }])
  assert.equal(r!.status, 'refused', 'the owner\'s entry limit holds on Bronze too')

  const free = setup({ fox: { tournament: async () => tournament(8, { tier: 'bronze', entry_fee_foxsy: 0 }), joinTournament: async () => ({}) }, chain: { send: async () => assert.fail('a free seat pays nothing') } })
  await withLive(free.store, async () => {
    const [f] = await free.exec.run(free.agent(), liveWallet, snapshot(), [{ action: { type: 'join_tournament', tournament_id: 8 }, reason: '' }])
    assert.equal(f!.status, 'confirmed', f!.summary)
    assert.match(f!.summary, /seated \(free\)/)
  })
})

const CUP = { type: 'create_tournament', title: 'Autumn Cup', format: 'round_robin', tier: 'bronze', max_teams: 4, min_teams: 3, entry_fee_foxsy: 100, starts_in_hours: 6, registration_closes_minutes_before: 60, round_interval_minutes: 30 }

test('CL13: a Bronze is created only once it earns, at an amount of the owner\'s list inside FoxLeague\'s band', async () => {
  const action = parseAction(CUP)
  assert.equal((action as { tier: string }).tier, 'bronze')
  const quote = async () => ({ owed: false, games: 6, private_fee_foxsy: 0, deposit_foxsy: 0, total_foxsy: 0, grace_minutes: 60, no_free_cancel: false })

  const before = setup({ fox: { organizerFeeQuote: quote } })
  const [early] = await before.exec.run(before.agent(), dryWallet, snapshot(), [{ action, reason: '' }])
  assert.equal(early!.status, 'refused', early!.summary)
  assert.match(early!.summary, /Bronze/)

  const live = setup({ fox: { organizerFeeQuote: quote } })
  const [ok] = await live.exec.run(live.agent(), dryWallet, liveSnapshot(), [{ action, reason: '' }])
  assert.equal(ok!.status, 'dry_run', ok!.summary)

  const [odd] = await live.exec.run(live.agent(), dryWallet, liveSnapshot(), [{ action: parseAction({ ...CUP, entry_fee_foxsy: 137 }), reason: '' }])
  assert.equal(odd!.status, 'refused', odd!.summary)
  assert.match(odd!.summary, /configured amounts/)

  const band = liveSnapshot()
  band.config!.tournament_fee_bounds = { ...band.config!.tournament_fee_bounds, bronze_min: 200, bronze_max: 999 }
  const [out] = await live.exec.run(live.agent(), dryWallet, band, [{ action, reason: '' }])
  assert.equal(out!.status, 'refused', out!.summary)
  assert.match(out!.summary, /bronze bounds/)

  const off = setup({ fox: { organizerFeeQuote: quote } })
  off.store.updateSettings(0, { entryFeesBronze: [] })
  const [none] = await off.exec.run(off.agent(), dryWallet, liveSnapshot(), [{ action, reason: '' }])
  assert.equal(none!.status, 'refused', 'an empty list turns Bronze creates off')
})

test('CL13: the Bronze amounts are a setting, inside the band, and an empty list is allowed', () => {
  assert.deepEqual(validateSettingsPatch({ entryFeesBronze: [500, 100] }).entryFeesBronze, [100, 500])
  assert.deepEqual(validateSettingsPatch({ entryFeesBronze: [] }).entryFeesBronze, [])
  assert.throws(() => validateSettingsPatch({ entryFeesBronze: [1000] }), /entryFeesBronze/)
  assert.throws(() => validateSettingsPatch({ entryFeesBronze: [99] }), /entryFeesBronze/)
})

// ---- the leave lock ----

const us = { user_id: 100 }
const rivals = (n: number) => Array.from({ length: n }, (_, i) => ({ user_id: 200 + i }))

test('CL14: with the lock on, a leave that takes a tournament below its minimum is refused', async () => {
  const leave = { action: { type: 'leave_tournament' as const, tournament_id: 7 }, reason: '' }
  const at = (seated: number, min = 4, status?: unknown) => setup({ fox: { tournament: async () => tournament(7, { format: 'round_robin', max_teams: 8, min_teams: min, ...(status ? { status } : {}) }, [us, ...rivals(seated - 1)]) } })
  const atMin = at(4)
  const [locked] = await atMin.exec.run(atMin.agent(), dryWallet, liveSnapshot(), [leave])
  assert.equal(locked!.status, 'refused', locked!.summary)
  assert.match(locked!.summary, /minimum of 4/)

  const above = at(5)
  const [free] = await above.exec.run(above.agent(), dryWallet, liveSnapshot(), [leave])
  assert.notEqual(free!.status, 'refused', free!.summary)

  const below = at(2)
  const [never] = await below.exec.run(below.agent(), dryWallet, liveSnapshot(), [leave])
  assert.notEqual(never!.status, 'refused', 'one that never reached its minimum can still lose teams')

  const off = at(4)
  const [before] = await off.exec.run(off.agent(), dryWallet, snapshot(), [leave])
  assert.notEqual(before!.status, 'refused', 'before the switch a leave goes through')
})

test('CL14: the digest says when your own seat is locked', () => {
  const s = liveSnapshot()
  s.auth!.myTournaments = { active: [{ id: 7, title: 'Cup', status: 'open', tier: 'silver', format: 'round_robin', max_teams: 8, min_teams: 4, participant_count: 4, entry_fee_foxsy: 1000, deadline: new Date(Date.now() + 3600_000).toISOString(), starts_at: new Date(Date.now() + 7200_000).toISOString(), creator_user_id: 900 }], completed: [] } as never
  assert.match(renderDigest(s), /T7[^\n]*seats locked/)
  s.config!.tournament_defaults = { ...s.config!.tournament_defaults, leave_lock_live: false }
  assert.doesNotMatch(renderDigest(s), /seats locked/)
})

// ---- the organizer's deposit and fee ----

const SILVER_CUP = parseAction({ ...CUP, tier: 'silver', entry_fee_foxsy: 1000 })
const OWED = { owed: true, games: 6, private_fee_foxsy: 0, deposit_foxsy: 150, total_foxsy: 150, grace_minutes: 60, no_free_cancel: false }

const feeRequired = () => new ApiRefusal('This tournament needs a payment of 150 FOXSY from its organizer before it is created.', 'organizer_fee_required')
/** FoxLeague's create: every other check first, then it asks for the payment; `then` answers once a hash is sent. */
const createAsks = (bodies: Record<string, unknown>[], then: () => unknown = () => ({ id: 55 })) => async (_w: unknown, body: Record<string, unknown>) => {
  bodies.push({ ...body })
  if (!body.organizer_fee_tx_hash) throw feeRequired()
  return then()
}

test('CL15: the create is pressed first; asked for the payment it pays once, sends the hash, and the seat pays the entry alone', async () => {
  const calls: string[] = []
  const created: Record<string, unknown>[] = []
  const m = setup({
    fox: { organizerFeeQuote: async () => OWED, createTournament: createAsks(created), tournament: async () => tournament(55), joinTournament: async () => ({}) },
    chain: { send: async (tx: { data?: string }) => { const d = Buffer.from(tx.data ?? '', 'base64').toString().split('@').slice(0, 3).join('@'); calls.push(d); return calls.length === 1 ? 'hashfee' : 'hashseat' } },
  })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, liveSnapshot(), [{ action: SILVER_CUP, reason: '' }])
    assert.equal(r!.status, 'confirmed', r!.summary)
    assert.match(r!.summary, /1150 FOXSY/)
  })
  assert.match(calls[0]!, /@0821ab0d4414980000$/, '150 FOXSY for the deposit')
  assert.match(calls[1]!, /@3635c9adc5dea00000$/, '1000 FOXSY for the seat, not 1150')
  assert.deepEqual(created.map(b => b.organizer_fee_tx_hash), [undefined, 'hashfee'])
  assert.deepEqual(spendOf(m, 'shop:'), [['shop:organizer_fee', wholeToAtomic(150).toString()]])
  assert.deepEqual(spendOf(m, 'join:'), [['join:55', wholeToAtomic(1000).toString()]], 'a refunded seat credits the entry, never the deposit')
  assert.equal(m.store.pending(0).filter(p => p.kind === 'organizer_fee').length, 0, 'the hash is settled')
})

test('CL15: a create refused before the payment pays nothing and counts nothing', async () => {
  const m = setup({ fox: { organizerFeeQuote: async () => OWED, createTournament: async () => { throw new ApiRefusal('time slot taken') } }, chain: { send: async () => assert.fail('nothing is paid') } })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, liveSnapshot(), [{ action: SILVER_CUP, reason: '' }])
    assert.equal(r!.status, 'error', r!.summary)
  })
  assert.deepEqual(rowsOf(m, ''), [])
})

test('CL15: asked nothing after all, the organizer booking goes and the seat follows', async () => {
  const m = setup({ fox: { organizerFeeQuote: async () => OWED, createTournament: async () => ({ id: 55 }), tournament: async () => tournament(55), joinTournament: async () => ({}) } })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, liveSnapshot(), [{ action: SILVER_CUP, reason: '' }])
    assert.equal(r!.status, 'confirmed', r!.summary)
  })
  assert.deepEqual(spendOf(m, 'shop:'), [])
  assert.deepEqual(spendOf(m, 'join:'), [['join:55', wholeToAtomic(1000).toString()]])
})

test('CL15: a create that owes nothing pays nothing extra and sends no hash; a 1v1 asks no quote', async () => {
  const created: Record<string, unknown>[] = []
  const m = setup({ fox: { organizerFeeQuote: async () => ({ ...OWED, owed: false, total_foxsy: 0 }), createTournament: async (_w: unknown, b: Record<string, unknown>) => { created.push(b); return { id: 55 } }, tournament: async () => tournament(55), joinTournament: async () => ({}) } })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, liveSnapshot(), [{ action: SILVER_CUP, reason: '' }])
    assert.equal(r!.status, 'confirmed', r!.summary)
  })
  assert.equal('organizer_fee_tx_hash' in created[0]!, false)

  const duel = setup({ fox: { organizerFeeQuote: async () => assert.fail('a 1v1 owes neither') } })
  const [d] = await duel.exec.run(duel.agent(), dryWallet, liveSnapshot(), [{ action: { type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: null, deadline_minutes: 60 }, reason: '' }])
  assert.notEqual(d!.status, 'error', d!.summary)
})

test('CL15: a quote that cannot be read is no "owes nothing"; the owner\'s limit and the wallet hold', async () => {
  const blind = setup({ fox: { organizerFeeQuote: async () => { throw new Error('HTTP 502') }, createTournament: async () => assert.fail('no create') } })
  const [b] = await blind.exec.run(blind.agent(), dryWallet, liveSnapshot(), [{ action: SILVER_CUP, reason: '' }])
  assert.equal(b!.status, 'refused', b!.summary)
  assert.match(b!.summary, /could not be read/)

  const dear = setup({ fox: { organizerFeeQuote: async () => ({ ...OWED, total_foxsy: 3000, deposit_foxsy: 3000 }) } })
  const [d] = await dear.exec.run(dear.agent(), dryWallet, liveSnapshot(), [{ action: SILVER_CUP, reason: '' }])
  assert.equal(d!.status, 'refused', d!.summary)
  assert.match(d!.summary, /maximum|limit/)

  const poor = setup({ fox: { organizerFeeQuote: async () => OWED } })
  const s = liveSnapshot()
  s.chain!.foxsy = wholeToAtomic(1100)
  const [p] = await poor.exec.run(poor.agent(), dryWallet, s, [{ action: SILVER_CUP, reason: '' }])
  assert.equal(p!.status, 'refused', p!.summary)
  assert.match(p!.summary, /needs 1150 FOXSY/)
})

test('CL15: a payment FoxLeague cannot verify yet is sent again with the same hash, never paid twice', async () => {
  const sends: string[] = []
  const bodies: Record<string, unknown>[] = []
  let tries = 0
  const m = setup({
    fox: {
      organizerFeeQuote: async () => OWED,
      createTournament: createAsks(bodies, () => { if (tries++ === 0) throw new ApiRefusal('Could not verify transaction yet.', 'tx_pending'); return { id: 55 } }),
      tournament: async () => tournament(55),
      joinTournament: async () => ({}),
    },
    chain: { send: async () => { sends.push('send'); return sends.length === 1 ? 'hashfee' : 'hashseat' } },
  })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, liveSnapshot(), [{ action: SILVER_CUP, reason: '' }])
    assert.equal(r!.status, 'confirmed', r!.summary)
  })
  assert.deepEqual(bodies.map(b => b.organizer_fee_tx_hash), [undefined, 'hashfee', 'hashfee'])
  assert.equal(sends.length, 2, 'one deposit, one seat')
})

// Agent review of PR #41 (medium): a payment no create used was dropped, so the next plan paid a second one. FoxLeague's
// own app keeps the hash and reuses it for the same amount (useOrganizerFee.ts).
test('R41-1: a create refused after the payment keeps its hash, and the next create uses it with no second payment', async () => {
  const sends: string[] = []
  const bodies: Record<string, unknown>[] = []
  let refuse = true
  const m = setup({
    fox: {
      organizerFeeQuote: async () => OWED,
      createTournament: createAsks(bodies, () => { if (refuse) throw new ApiRefusal('time slot taken'); return { id: 55 } }),
      tournament: async () => tournament(55),
      joinTournament: async () => ({}),
    },
    chain: { send: async () => { sends.push('send'); return sends.length === 1 ? 'hashfee' : 'hashseat' } },
  })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, liveSnapshot(), [{ action: SILVER_CUP, reason: '' }])
    assert.equal(r!.status, 'error', r!.summary)
    assert.match(r!.summary, /time slot taken/)
    assert.match(r!.summary, /hashfee/)
    assert.deepEqual(spendOf(m, 'shop:'), [['shop:organizer_fee', wholeToAtomic(150).toString()]])
    assert.deepEqual(spendOf(m, 'join:'), [], 'nothing was signed for the seat')
    assert.deepEqual(m.store.pending(0).map(p => [p.hash, p.kind]), [['hashfee', 'organizer_fee']])
    refuse = false
    const [again] = await m.exec.run(m.agent(), liveWallet, liveSnapshot(), [{ action: SILVER_CUP, reason: '' }])
    assert.equal(again!.status, 'confirmed', again!.summary)
  })
  assert.equal(sends.length, 2, 'one deposit, one seat: never a second deposit')
  assert.deepEqual(bodies.map(b => b.organizer_fee_tx_hash), [undefined, 'hashfee', 'hashfee'])
  assert.deepEqual(spendOf(m, 'shop:'), [['shop:organizer_fee', wholeToAtomic(150).toString()]], 'counted once')
  assert.equal(m.store.pending(0).length, 0)
})

test('R41-1: an organizer payment not final yet creates nothing, and the next create uses the same hash', async () => {
  const sends: string[] = []
  const bodies: Record<string, unknown>[] = []
  let outcome = 'unconfirmed'
  const m = setup({
    fox: { organizerFeeQuote: async () => OWED, createTournament: createAsks(bodies), tournament: async () => tournament(55), joinTournament: async () => ({}) },
    chain: { send: async () => { sends.push('send'); return sends.length === 1 ? 'hashfee' : 'hashseat' }, waitForOutcome: async () => ({ kind: outcome, reason: 'still on its way' }) },
  })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, liveSnapshot(), [{ action: SILVER_CUP, reason: '' }])
    assert.equal(r!.status, 'unconfirmed', r!.summary)
    assert.deepEqual(m.store.pending(0).map(p => p.hash), ['hashfee'])
    outcome = 'success'
    const [again] = await m.exec.run(m.agent(), liveWallet, liveSnapshot(), [{ action: SILVER_CUP, reason: '' }])
    assert.equal(again!.status, 'confirmed', again!.summary)
  })
  assert.equal(sends.length, 2)
  assert.equal(bodies.at(-1)!.organizer_fee_tx_hash, 'hashfee')
})

test('R41-1: while a payment waits, a tournament that owes another amount pays no second one', async () => {
  const m = setup({ fox: { organizerFeeQuote: async () => ({ ...OWED, total_foxsy: 200, deposit_foxsy: 200 }), createTournament: async () => assert.fail('no create') }, chain: { send: async () => assert.fail('nothing is paid') } })
  m.store.addPending('hashfee', 0, 'organizer_fee', { total: 150 })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, liveSnapshot(), [{ action: SILVER_CUP, reason: '' }])
    assert.equal(r!.status, 'refused', r!.summary)
    assert.match(r!.summary, /150 FOXSY/)
  })
})

test('R41-1: an answer that settles the hash forgets it; a refunded payment stops counting', async () => {
  const m = setup({ fox: { organizerFeeQuote: async () => OWED, createTournament: async () => { throw new ApiRefusal('This payment was already refunded and cannot be used for a purchase.') } }, chain: { send: async () => assert.fail('nothing is paid') } })
  const id = m.store.recordSpend({ agentIndex: 0, at: new Date(), gameDay: 'd', category: 'play', action: 'shop:organizer_fee', foxsyAtomic: wholeToAtomic(150), egldAtomic: 0n, usd: 0.4, txHash: 'hashfee', dryRun: false })
  assert.ok(id)
  m.store.addPending('hashfee', 0, 'organizer_fee', { total: 150 })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, liveSnapshot(), [{ action: SILVER_CUP, reason: '' }])
    assert.equal(r!.status, 'error', r!.summary)
  })
  assert.equal(m.store.pending(0).length, 0)
  assert.equal(m.store.openSpend(0, 'shop:organizer_fee', false).length, 0, 'credited')
})

test('R41-1: a payment no create used is given up after the window, and the owner hears of it', async () => {
  const m = setup()
  m.store.addPending('hashfee', 0, 'organizer_fee', { total: 150 })
  const told: string[] = []
  const deps = { store: m.store, fox: {} as never, notify: () => assert.fail('routine news'), alert: (t: string) => told.push(t) }
  await retryPendingPayments(deps, 0, liveWallet)
  assert.equal(m.store.pending(0).length, 1, 'kept inside the window')
  await retryPendingPayments(deps, 0, liveWallet, Date.now() + 61 * 60_000)
  assert.equal(m.store.pending(0).length, 0)
  assert.match(told[0]!, /organizer payment hashfee/)
})

// Agent review of PR #41 (low): a sent transaction keeps at least its gas (AGENTS.md rule 3).
test('R41-2: the organizer transaction keeps its gas when no tournament comes of it', async () => {
  const gas = (m: { store: Store }) => m.store.db.prepare("SELECT count(*) n FROM spend WHERE agent_idx = 0 AND dry_run = 0 AND foxsy_atomic = '0' AND usd > 0").get() as { n: number }
  const refused = setup({ fox: { organizerFeeQuote: async () => OWED, createTournament: createAsks([], () => { throw new ApiRefusal('time slot taken') }) } })
  await withLive(refused.store, async () => { await refused.exec.run(refused.agent(), liveWallet, liveSnapshot(), [{ action: SILVER_CUP, reason: '' }]) })
  assert.equal(Number(gas(refused).n), 1, 'a refused create')
  const open = setup({ fox: { organizerFeeQuote: async () => OWED, createTournament: createAsks([]) }, chain: { waitForOutcome: async () => ({ kind: 'unconfirmed', reason: 'later' }) } })
  await withLive(open.store, async () => { await open.exec.run(open.agent(), liveWallet, liveSnapshot(), [{ action: SILVER_CUP, reason: '' }]) })
  assert.equal(Number(gas(open).n), 1, 'an outcome not read yet')
})

test('CL15: a deposit payment that reverts creates nothing and leaves only the gas', async () => {
  const bodies: Record<string, unknown>[] = []
  const m = setup({ fox: { organizerFeeQuote: async () => OWED, createTournament: createAsks(bodies, () => assert.fail('no create without the payment')) }, chain: { waitForOutcome: async () => ({ kind: 'failed', reason: 'insufficient funds' }) } })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, liveSnapshot(), [{ action: SILVER_CUP, reason: '' }])
    assert.equal(r!.status, 'failed', r!.summary)
  })
  assert.deepEqual(spendOf(m, 'shop:'), [])
  assert.deepEqual(spendOf(m, 'join:'), [])
  assert.equal(m.store.pending(0).length, 0)
})

// ---- flexible groups ----

test('CL16: a Groups + Knockout may start from 6 teams, and the condition check counts its largest group', async () => {
  const quote = async () => ({ ...OWED, owed: false, total_foxsy: 0 })
  const cup = { ...CUP, tier: 'silver', entry_fee_foxsy: 1000, format: 'groups_knockout', max_teams: 16, starts_in_hours: 24 }
  const m = setup({ fox: { organizerFeeQuote: quote } })
  const s = liveSnapshot()
  s.market.recentStandard = Array.from({ length: 5 }, (_, i) => ({ id: i, tier: 'silver', format: 'knockout', max_teams: 16, seated: 16, fee: 1000, status: 'completed', starts_at: new Date().toISOString() }))
  const [ok] = await m.exec.run(m.agent(), dryWallet, s, [{ action: parseAction({ ...cup, min_teams: 6 }), reason: '' }])
  assert.doesNotMatch(ok!.summary, /min_teams/, ok!.summary)
  const [low] = await m.exec.run(m.agent(), dryWallet, s, [{ action: parseAction({ ...cup, min_teams: 5 }), reason: '' }])
  assert.equal(low!.status, 'refused', low!.summary)
  assert.match(low!.summary, /min_teams/)
  // FoxLeague's groups_knockout_most_matches: 16 seats, 11 teams, 2 groups of 6: 5 group games and 2 knockout rounds.
  assert.equal(matchesAtMost('groups_knockout', 16, false, 4), 7)
  // A full tournament draws what it always drew: 4 groups of 4, 3 games and 3 rounds.
  assert.equal(matchesAtMost('groups_knockout', 16, false, 4, 16), 6)
  assert.equal(matchesAtMost('groups_knockout', 8, false, 4), 5)
})

// ---- what the plan sees ----

test('CL17: at the Zeus level a paid Bronze fixture is worth a booster once the levels are live, a free one never', async () => {
  const fixture = (fee: number, s = liveSnapshot()) => {
    s.auth!.myTournaments = { active: [{ id: 7, tier: 'bronze', entry_fee_foxsy: fee, format: 'round_robin', max_teams: 4, min_teams: 3, status: 'active' }], completed: [] } as never
    s.auth!.upcoming!.matches = [{ tournament_id: 7, phase: 'upcoming', scheduled_at: new Date(Date.now() + 3 * 3600_000).toISOString(), strategy_locks_at: new Date(Date.now() + 3 * 3600_000).toISOString() }] as never
    return s
  }
  const m = setup()
  m.store.updateSettings(0, { strategy: STRATEGY_PRESETS.zeus! })
  const booster = { action: { type: 'buy' as const, product: 'xp_booster' as const }, reason: '' }
  const [paid] = await m.exec.run(m.agent(), dryWallet, fixture(250), [booster])
  assert.notEqual(paid!.status, 'refused', paid!.summary)
  const [free] = await m.exec.run(m.agent(), dryWallet, fixture(0), [booster])
  assert.equal(free!.status, 'refused', free!.summary)
})

test('CL18: the digest states the levels only from what FoxLeague serves', () => {
  assert.doesNotMatch(renderDigest(snapshot()), /Competition levels/)
  const before = liveSnapshot()
  before.config!.competition_levels = { ...LIVE_LEVELS, live: false }
  before.config!.organizer_fees = { ...LIVE_FEES, live: false }
  const soon = renderDigest({ ...before, takenAt: '2026-11-08T10:00:00Z' })
  assert.match(soon, /Competition levels: not live yet, from 2026-11-09T14:00:00Z/)
  const on = renderDigest(liveSnapshot())
  assert.match(on, /Competition levels: LIVE/)
  assert.match(on, /ranked ticket 100 FOXSY/)
  assert.match(on, /XP ranked 50%, Bronze 25%, Silver 75%, Gold 100%/)
  assert.match(on, /K ranked 9, Bronze 5, Silver 13, Gold 17/)
  assert.match(on, /3 competitive matches a card a day/)
  assert.match(on, /calendar deposit 25 FOXSY a game/)
  assert.doesNotMatch(on, /ranked, casual and Bronze never count/)
})

test('CL19: the prompt carries the rules and no number of the levels; a ticket is no shop purchase', async () => {
  const { SYSTEM_PROMPT: STATIC_PROMPT } = await import('../src/strategist/prompt.ts')
  assert.match(STATIC_PROMPT, /Competition levels: the snapshot's "Competition levels" line/)
  assert.match(STATIC_PROMPT, /a match fee, not a shop purchase/)
  assert.match(STATIC_PROMPT, /"tier":"bronze\|silver\|gold"/)
  assert.match(STATIC_PROMPT, /marks the leave lock/)
  assert.match(STATIC_PROMPT, /calendar deposit per scheduled game/)
  assert.doesNotMatch(STATIC_PROMPT, /9 November|2026-11-09/)
})

test('CL7: the dashboard has the Bronze amounts with an info bubble', async () => {
  const { readFileSync } = await import('node:fs')
  const html = readFileSync(new URL('../src/web/dashboard.html', import.meta.url), 'utf8')
  assert.match(html, /id="sBronze"/)
  assert.match(html, /data-tip="bronze"/)
  assert.match(html, /entryFeesBronze: list\('sBronze'\)/)
  assert.match(html, /bronze: \['Bronze amounts/)
})

// Agent review of PR #41, second round (medium): an unclear broadcast may still land, and the row written only after the
// send's answer left nothing to stop the next plan paying again.
test('R41-3: an organizer payment whose broadcast answer is unclear is kept, and the next create pays no second one', async () => {
  const sends: string[] = []
  const bodies: Record<string, unknown>[] = []
  const m = setup({
    fox: { organizerFeeQuote: async () => OWED, createTournament: createAsks(bodies), tournament: async () => tournament(55), joinTournament: async () => ({}) },
    chain: { send: async () => { sends.push('send'); if (sends.length === 1) throw new Error('broadcast unclear (HTTP 502, no hash)'); return 'hashseat' } },
  })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, liveSnapshot(), [{ action: SILVER_CUP, reason: '' }])
    assert.equal(r!.status, 'error', r!.summary)
    assert.equal(r!.sent, true, 'R41-4: the owner hears at once that a payment may have left the wallet')
    const held = m.store.pending(0)
    assert.deepEqual(held.map(p => p.kind), ['organizer_fee'])
    const [again] = await m.exec.run(m.agent(), liveWallet, liveSnapshot(), [{ action: SILVER_CUP, reason: '' }])
    assert.equal(again!.status, 'confirmed', again!.summary)
    assert.equal(bodies.at(-1)!.organizer_fee_tx_hash, held[0]!.hash)
  })
  assert.equal(sends.length, 2, 'the unclear payment and the seat: no second deposit')
})

test('R41-3: a ticket whose broadcast answer is unclear is kept, and the next ranked start pays no second one', async () => {
  let pressed = 0
  const sends: string[] = []
  const m = setup({
    fox: { rankedTicket: async () => ({ live: true, price_foxsy: 100, tickets: 0 }), playMatch: async () => { pressed++; throw required() } },
    chain: { send: async () => { sends.push('send'); throw new Error('broadcast unclear (HTTP 502, no hash)') } },
  })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, liveSnapshot(), [{ action: RANKED, reason: '' }])
    assert.equal(r!.status, 'error', r!.summary)
    assert.deepEqual(m.store.pending(0).map(p => p.kind), ['ranked_ticket'])
    const [again] = await m.exec.run(m.agent(), liveWallet, liveSnapshot(), [{ action: RANKED, reason: '' }])
    assert.equal(again!.status, 'refused', again!.summary)
  })
  assert.equal(sends.length, 1)
  assert.equal(pressed, 1)
})

test('R41-3: a broadcast the gateway definitely refused leaves nothing kept and nothing counted', async () => {
  const m = setup({
    fox: { rankedTicket: async () => ({ live: true, price_foxsy: 100, tickets: 0 }), playMatch: async () => { throw required() } },
    chain: { send: async () => { throw new BroadcastRefused('insufficient funds') }, lookupTransaction: async () => 'not_found' },
  })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, liveSnapshot(), [{ action: RANKED, reason: '' }])
    assert.equal(r!.status, 'error', r!.summary)
  })
  assert.equal(m.store.pending(0).length, 0)
  assert.deepEqual(rowsOf(m, ''), [])
})

// Agent review of PR #41, second round (low): the organizer transaction's gas sat in the seat's row.
test('R41-2: the organizer transaction keeps its gas when anything after it fails', async () => {
  const m = setup({ fox: { organizerFeeQuote: async () => OWED, createTournament: createAsks([]), tournament: async () => { throw new Error('HTTP 502') } } })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, liveSnapshot(), [{ action: SILVER_CUP, reason: '' }])
    assert.equal(r!.status, 'error', r!.summary)
  })
  const gas = m.store.db.prepare("SELECT tx_hash FROM spend WHERE agent_idx = 0 AND dry_run = 0 AND foxsy_atomic = '0' AND usd > 0").all() as { tx_hash: string }[]
  assert.deepEqual(gas.map(g => g.tx_hash), ['hash1'], 'the gas of what was sent, under its hash')
  assert.deepEqual(spendOf(m, 'join:'), [], 'nothing was signed for the seat')
  assert.deepEqual(spendOf(m, 'shop:'), [['shop:organizer_fee', wholeToAtomic(150).toString()]])
})

