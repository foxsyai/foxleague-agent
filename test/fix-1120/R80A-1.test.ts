// R80A-1 (low, the GitHub review of PR #80): in create_tournament the seat's signature comes up to 60 s after the
// organizer payment, so the chain check right before it reads every shard afresh (`retries: 1`). A short gateway blip
// (no halt) then left "created T..., its seat not paid" with the organizer payment already sent: money stays safe (the
// seat booking is released, the next plan can take the seat), but an unfilled tournament keeps the organizer's deposit.
// No test covered a halt between the two signatures of one action. Now: tests for a halt and for an unreadable status
// between them (organizer payment then seat, and the ranked ticket after the press), and one more read, after a short
// pause, for "could not be read" only, right before a signature. A stale block is a halt and is never read again.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Transaction } from '@multiversx/sdk-core'
import { parseAction } from '../../src/executor/actions.ts'
import { ApiRefusal } from '../../src/foxleague/api.ts'
import type { Store } from '../../src/store/db.ts'
import type { AgentWallet } from '../../src/wallet/wallet.ts'
import { liveWallet, setup, snapshot, tournament, withFixture, withLive } from '../fixtures.ts'

const META = 4294967295
const HOURS = 3600_000
const LIVE_FEES = { live: true, live_from: '2026-11-09T14:00:00Z', private_match_fee_foxsy: 0, calendar_deposit_per_match_foxsy: 25, calendar_deposit_min_foxsy: 0, calendar_deposit_grace_minutes: 60 }
const OWED = { owed: true, games: 6, private_fee_foxsy: 0, deposit_foxsy: 150, total_foxsy: 150, grace_minutes: 60, no_free_cancel: false }
// Four days ahead: an organizer tournament the agent may create (ORG-3).
const SILVER_CUP = parseAction({ type: 'create_tournament', title: 'Autumn Cup', format: 'round_robin', tier: 'silver', max_teams: 4, min_teams: 3, entry_fee_foxsy: 1000, starts_in_hours: 96, registration_closes_minutes_before: 60, round_interval_minutes: 30 })
const FEE_REQUIRED = () => new ApiRefusal('This tournament needs a payment of 150 FOXSY from its organizer before it is created.', 'organizer_fee_required')
const LEVELS = { live: true, live_from: '2026-11-09T14:00:00Z', ranked_ticket_price_foxsy: 25, xp_factor_pct: { ranked: 25, bronze: 50, silver: 75, gold: 100 }, elo_k: { ranked: 5, bronze: 9, silver: 13, gold: 17 }, private_bronze_earns: true, competitive_daily_cap: 3 }
const STALE = /the MultiversX network has produced no block since .* \(the metachain, 6 h ago\): nothing is signed, the next plan tries again/
const UNREAD = /whether the MultiversX network is producing blocks could not be read \(the metachain: gateway \/network\/status\/4294967295: HTTP 502 no data\): nothing is signed, the next plan tries again/

/**
 * The newest block per shard: fresh until `turn()` is called, then the metachain answers as `mode` says: 'halt' (6 hours
 * old), 'blip' (one failed read, then fresh) or 'down' (every read fails).
 */
function blocks() {
  let mode: 'fresh' | 'halt' | 'blip' | 'down' = 'fresh'
  let failed = 0
  const reads: number[] = []
  return {
    reads,
    turn: (m: 'halt' | 'blip' | 'down') => { mode = m },
    get failed() { return failed },
    newestBlockMs: async (shard: number) => {
      if (shard === META) reads.push(Date.now())
      if (shard === META && mode === 'halt') return Date.now() - 6 * HOURS
      if (shard === META && (mode === 'down' || (mode === 'blip' && failed === 0))) {
        failed++
        throw new Error(`gateway /network/status/${META}: HTTP 502 no data`)
      }
      return Date.now() - 400
    },
  }
}

function signer(): AgentWallet & { signed: Transaction[] } {
  const signed: Transaction[] = []
  return { ...liveWallet, signed, signTransaction: (tx: Transaction) => void signed.push(tx) }
}

/** The pauses the executor takes before it reads the chain once more (none on the code before R80A-1). */
function pauses(exec: unknown): number[] {
  const seen: number[] = []
  ;(exec as { haltPause: (ms: number) => Promise<void> }).haltPause = async (ms: number) => void seen.push(ms)
  return seen
}

const detailOf = (store: Store) => JSON.parse(store.activity(0, 1)[0]!.detail ?? '{}') as { createdTournamentId?: number }

/** A create whose organizer payment goes out, then the chain turns as `mode` says while FoxLeague creates T55. */
async function createWith(mode: 'halt' | 'blip' | 'down') {
  const b = blocks()
  const sends: string[] = []
  const joins: (string | undefined)[] = []
  const m = setup({
    fox: {
      organizerFeeQuote: async () => OWED,
      createTournament: async (_w: unknown, body: Record<string, unknown>) => {
        if (!body.organizer_fee_tx_hash) throw FEE_REQUIRED()
        b.turn(mode) // between the organizer payment and the seat's signature
        return { id: 55 }
      },
      tournament: async () => tournament(55),
      joinTournament: async (_w: unknown, _id: number, hash?: string) => { joins.push(hash); return { participant_id: 1 } },
    },
    chain: { newestBlockMs: b.newestBlockMs, send: async () => { sends.push(sends.length ? 'hashS' : 'hashO'); return sends.at(-1)! } },
  })
  const seen = pauses(m.exec)
  const wallet = signer()
  const s = snapshot()
  s.config!.organizer_fees = LIVE_FEES
  let r: { status: string; summary: string; sent?: boolean } | undefined
  await withLive(m.store, async () => { r = (await m.exec.run(m.agent(), wallet, s, [{ action: SILVER_CUP, reason: '' }]))[0] })
  return { r: r!, m, b, wallet, sends, joins, seen }
}

test('R80A-1 a halt between the organizer payment and the seat: the deposit stays counted, the seat is released, the row names T55 without its seat', async () => {
  const { r, m, wallet, sends, joins, seen } = await createWith('halt')
  assert.equal(r.status, 'error', r.summary)
  assert.equal(r.sent, true, 'the organizer payment went out')
  assert.equal(wallet.signed.length, 1, 'only the organizer payment is signed')
  assert.deepEqual(sends, ['hashO'])
  assert.deepEqual(joins, [])
  assert.equal(m.store.openSpend(0, 'shop:organizer_fee', false).length, 1, 'the deposit sent stays counted')
  assert.equal(m.store.openSpend(0, 'join:', false).length, 0, 'the seat, never signed, is released')
  assert.match(r.summary, /created T55 with organizer payment hashO, its seat not paid: /)
  assert.match(r.summary, STALE)
  assert.match(r.summary, /; T55 waits with no seat of yours \(unfilled at its deadline it keeps the organizer's deposit\)$/)
  assert.equal(detailOf(m.store).createdTournamentId, 55, 'the row keeps the tournament it made (OPEN-8 shows it to the next plan)')
  assert.deepEqual(seen, [], 'a stale block is a halt: never read again')
})

test('R80A-1 one unreadable status between the organizer payment and the seat is read once more: T55 gets its seat', async () => {
  const { r, m, b, wallet, sends, joins, seen } = await createWith('blip')
  assert.equal(b.failed, 1)
  assert.equal(r.status, 'confirmed', r.summary)
  assert.match(r.summary, /\(T55\): seated/)
  assert.equal(wallet.signed.length, 2, 'the organizer payment and the seat')
  assert.deepEqual(sends, ['hashO', 'hashS'])
  assert.deepEqual(joins, ['hashS'])
  assert.equal(seen.length, 1, 'one pause, then one more read')
  assert.ok(seen[0]! >= 2000 && seen[0]! <= 10_000, `a short pause: ${seen[0]} ms`)
  assert.equal(m.store.openSpend(0, 'join:55', false).length, 1)
})

test('R80A-1 a status still unreadable after the one more read refuses: bounded, fail closed, the seat released', async () => {
  const { r, m, b, wallet, joins, seen } = await createWith('down')
  assert.equal(r.status, 'error', r.summary)
  assert.equal(wallet.signed.length, 1, 'only the organizer payment')
  assert.deepEqual(joins, [])
  assert.equal(seen.length, 1, 'read once more, never more')
  assert.equal(b.failed, 2, 'the seat\'s check and its one more read')
  assert.equal(m.store.openSpend(0, 'join:', false).length, 0, 'the seat is released')
  assert.equal(m.store.openSpend(0, 'shop:organizer_fee', false).length, 1, 'the deposit stays counted')
  assert.match(r.summary, /created T55 with organizer payment hashO, its seat not paid: /)
  assert.match(r.summary, UNREAD)
})

/** A ranked start that needs a ticket: the press is refused for it, then the chain turns as `mode` says. */
async function rankedWith(mode: 'halt' | 'blip') {
  const b = blocks()
  let pressed = 0
  const sends: string[] = []
  const view = { live: true, live_from: '2026-11-09T14:00:00Z', price_foxsy: 25, tickets: 0, discount_bp: 0, discounted_price_foxsy: 25 }
  const m = setup({
    fox: {
      rankedTicket: async () => view,
      playMatch: async () => {
        if (pressed++ === 0) {
          b.turn(mode) // between the check before the booking and the ticket's signature
          throw new ApiRefusal('A ranked game costs 25 FOXSY: pay for a ticket first.', 'ranked_ticket_required')
        }
        return { match_id: 11, ranked_paid: true }
      },
      buyRankedTicket: async () => ({ ...view, tickets: 1 }),
    },
    chain: { newestBlockMs: b.newestBlockMs, send: async () => { sends.push('hashT'); return 'hashT' } },
  })
  const seen = pauses(m.exec)
  const wallet = signer()
  const s = withFixture(snapshot())
  s.config!.competition_levels = LEVELS
  let r: { status: string; summary: string; sent?: boolean } | undefined
  await withLive(m.store, async () => { r = (await m.exec.run(m.agent(), wallet, s, [{ action: { type: 'play_match', match_type: 'ranked' }, reason: '' }]))[0] })
  return { r: r!, m, wallet, sends, seen, pressed: () => pressed }
}

test('R80A-1 a halt between the press and the ranked ticket\'s signature: nothing signed, the ticket booking released', async () => {
  const { r, m, wallet, sends, seen, pressed } = await rankedWith('halt')
  assert.equal(r.status, 'error', r.summary)
  assert.notEqual(r.sent, true)
  assert.equal(wallet.signed.length, 0)
  assert.deepEqual(sends, [])
  assert.equal(pressed(), 1, 'not pressed again')
  assert.equal(m.store.openSpend(0, 'shop:', false).length, 0, 'the ticket, never signed, is released')
  assert.deepEqual(m.store.pending(0), [])
  assert.match(r.summary, /^play ranked match: /)
  assert.match(r.summary, STALE)
  assert.deepEqual(seen, [])
})

test('R80A-1 one unreadable status before the ranked ticket\'s signature is read once more: the ticket is paid and the game starts', async () => {
  const { r, wallet, sends, seen } = await rankedWith('blip')
  assert.equal(r.status, 'confirmed', r.summary)
  assert.match(r.summary, /match #11 started \(ranked\)/)
  assert.equal(wallet.signed.length, 1)
  assert.deepEqual(sends, ['hashT'])
  assert.equal(seen.length, 1)
})
