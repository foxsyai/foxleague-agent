// Proof tests for the whole-project review of 2026-10-13 (money and limits). Each test is named after its finding
// (A = the money reviewer, C = the chain reviewer) and failed on main 5ab42c2 before the fix.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OTHER, STRANGER, card, dryWallet, encodeAuction, liveWallet, setup, snapshot, tournament, withLive } from './fixtures.ts'
import { numberToHex, wholeToAtomic } from '../src/util/encoding.ts'
import type { PlannedAction } from '../src/executor/actions.ts'

const act = (action: unknown): PlannedAction[] => [{ action: action as PlannedAction['action'], reason: '' }]

// ---- A3 + C2: a 1v1 stake is never paid while the routes its gates read could not be read ----

const oneVOneRig = () =>
  setup({
    fox: {
      user: async (a: string) => (a === STRANGER ? { id: 900, wallet_address: STRANGER, elo_rating: 1200 } : null),
      tournament: async () => tournament(555, { max_teams: 2, min_teams: 2, creator_user_id: 900 }, [{ user_id: 900, wallet_address: STRANGER }]),
    },
  })
const join1v1 = act({ type: 'join_tournament', tournament_id: 555 })
const openChallenge = act({ type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: null, deadline_minutes: 60 })

test('A3 C2 control: with the own tournaments and upcoming matches readable, the 1v1 join and the challenge go through', async () => {
  const m = oneVOneRig()
  assert.equal((await m.exec.run(m.agent(), dryWallet, snapshot(), join1v1))[0]!.status, 'dry_run')
  assert.equal((await m.exec.run(m.agent(), dryWallet, snapshot(), openChallenge))[0]!.status, 'dry_run')
})

test('A3 C2 a 1v1 join pays no stake while the agent\'s own tournaments could not be read (an active 1v1 is unknown)', async () => {
  const m = oneVOneRig()
  const s = snapshot()
  s.auth!.myTournaments = null
  const [r] = await m.exec.run(m.agent(), dryWallet, s, join1v1)
  assert.equal(r!.status, 'refused', `my tournaments unreadable, yet: ${r!.summary}`)
  assert.match(r!.summary, /could not be read/)
})

test('A3 C2 a 1v1 join pays no stake while the upcoming matches could not be read (the one-hour gate is unknown)', async () => {
  const m = oneVOneRig()
  const s = snapshot()
  s.auth!.upcoming = null
  const [r] = await m.exec.run(m.agent(), dryWallet, s, join1v1)
  assert.equal(r!.status, 'refused', `upcoming matches unreadable, yet: ${r!.summary}`)
  assert.match(r!.summary, /could not be read/)
})

test('A3 C2 a targeted 1v1 (to this team) is not joined blind either', async () => {
  const rival = { id: 900, wallet_address: OTHER, elo_rating: 1200 }
  const targeted = () => tournament(77, { max_teams: 2, min_teams: 2, creator_user_id: 900, target_user_id: 100, targeted_to_you: true }, [{ user_id: 900, wallet_address: OTHER }])
  for (const blind of ['myTournaments', 'upcoming'] as const) {
    const m = setup({ fox: { tournament: async () => targeted(), user: async () => rival } })
    const s = snapshot()
    s.auth![blind] = null
    const [r] = await m.exec.run(m.agent(), dryWallet, s, act({ type: 'join_tournament', tournament_id: 77 }))
    assert.equal(r!.status, 'refused', `${blind} unreadable, yet: ${r!.summary}`)
  }
})

test('A3 C2 a 1v1 challenge pays no stake while the own tournaments or the upcoming matches could not be read', async () => {
  for (const blind of ['myTournaments', 'upcoming'] as const) {
    const m = oneVOneRig()
    const s = snapshot()
    s.auth![blind] = null
    const [r] = await m.exec.run(m.agent(), dryWallet, s, openChallenge)
    assert.equal(r!.status, 'refused', `${blind} unreadable, yet: ${r!.summary}`)
    assert.match(r!.summary, /could not be read/)
  }
})

test('A3 C2 the within-the-hour check refuses on unreadable upcoming matches (a casual match is not started blind)', async () => {
  const m = setup()
  const s = snapshot()
  s.auth!.upcoming = null
  const [r] = await m.exec.run(m.agent(), dryWallet, s, act({ type: 'play_match', match_type: 'casual' }))
  assert.equal(r!.status, 'refused', `upcoming matches unreadable, yet: ${r!.summary}`)
  assert.match(r!.summary, /could not be read/)
})

// ---- A6: an unreadable fusion pre-check refuses the fusion ----

const b64 = (n: bigint) => Buffer.from(numberToHex(n), 'hex').toString('base64')
const spares = () => snapshot([card(40, 'DEF', 'reserve'), card(41, 'MID', 'reserve'), card(42, 'FWD', 'reserve')])
const fuse = act({ type: 'fuse', player_nonces: [40, 41, 42], position_of: 0 })
const poolOf4 = { query: async (_sc: string, fn: string) => (fn === 'getFusionPoolCount' ? [b64(4n)] : []) }

test('A6 control: with can-fuse answering, the fusion is allowed or refused by its answer', async () => {
  const ok = setup({ chain: poolOf4, fox: { user: async () => null, canFuse: async () => ({ can_fuse: true }) } })
  assert.equal((await ok.exec.run(ok.agent(), dryWallet, spares(), fuse))[0]!.status, 'dry_run')
  const no = setup({ chain: poolOf4, fox: { user: async () => null, canFuse: async () => ({ can_fuse: false, cooldown_remaining: 7200 }) } })
  assert.match((await no.exec.run(no.agent(), dryWallet, spares(), fuse))[0]!.summary, /wallet fusion cooldown/)
})

test('A6 a fusion is not signed while the can-fuse pre-check could not be read', async () => {
  const m = setup({ chain: poolOf4, fox: { user: async () => null, canFuse: async () => { throw new Error('HTTP 502') } } })
  const [r] = await m.exec.run(m.agent(), dryWallet, spares(), fuse)
  assert.equal(r!.status, 'refused', `can-fuse unreadable, yet: ${r!.summary}`)
  assert.match(r!.summary, /pre-check is unavailable: not fusing blind/)
})

// ---- A8: a bid that errored after its signature counts toward the two bids per auction ----

const bidRig = () =>
  setup({
    chain: { query: async (_sc: string, fn: string) => (fn === 'getAuction' ? [encodeAuction({ seller: STRANGER, min: wholeToAtomic(500), top: wholeToAtomic(1000), bidder: STRANGER, endsInS: 3600 })] : []) },
    fox: { user: async () => null, player: async () => ({ transferred_at: null, transfer_cooldown_hours: null, rarity: 'Rare' }) },
  })
const bid = act({ type: 'bid', nonce: 9, foxsy: 1100 })
const bidRow = (status: 'dry_run' | 'confirmed' | 'error', foxsy: number) => ({ agentIndex: 0, kind: 'bid', status, summary: `bid ${foxsy} FOXSY on #9`, detail: { action: { type: 'bid', nonce: 9, foxsy } } })

test('A8 control: two bids out on the auction, a third is refused', async () => {
  const m = bidRig()
  m.store.log(bidRow('dry_run', 600))
  m.store.log(bidRow('dry_run', 800))
  const [r] = await m.exec.run(m.agent(), dryWallet, snapshot(), bid)
  assert.equal(r!.status, 'refused')
  assert.match(r!.summary, /no bidding war/)
})

test('A8 a bid that errored after it was signed may have landed: it counts toward the two bids per auction', async () => {
  for (const ledger of ['dry_run', 'confirmed'] as const) {
    const m = bidRig()
    m.store.log(bidRow(ledger, 600))
    m.store.log(bidRow('error', 800))
    const run = () => m.exec.run(m.agent(), ledger === 'dry_run' ? dryWallet : liveWallet, snapshot(), bid)
    const [r] = ledger === 'dry_run' ? await run() : await withLive(m.store, run)
    assert.equal(r!.status, 'refused', `${ledger}: an errored bid is not counted, yet: ${r!.summary}`)
    assert.match(r!.summary, /no bidding war/)
  }
})
