// Audit 2026-11-11 (Fable 5.2 reviewers at extra-high effort): the proof of INTEG-5, failing before its fix.
// INTEG-5: a seat is paid in the last seconds before the registration deadline, and FoxLeague's join refuses it.
// FoxLeague checks the deadline when POST /join ARRIVES, not when the payment landed
// (next-foxleague origin/main backend/src/routes/tournaments.rs:6081-6086:
//   // Validate deadline. Paid joiners get refunded when their tx landed before the deadline but /:id/join arrived after.
//   if Utc::now() > tournament.deadline { refund_failed_join(.., "deadline_passed"); return err("Registration deadline has passed") }
// and again in the seat insert, SEAT_INSERT_SQL: "status = 'open' AND deadline > clock_timestamp()").
// The agent signs the stake, waits for its outcome on chain (first read after 1.5 s, cross-shard, up to 120 s:
// src/chain/gateway.ts:203-223) and only then calls /join (src/executor/executor.ts:1290-1299). Its own rule for the
// same gate says a stake "settles and reaches FoxLeague's gate a minute or two later" (BUSY_OPENS_MARGIN_S = 120,
// src/executor/rules.ts:166-167, :263), yet the deadline is held to the second: deadline <= now
// (src/executor/rules.ts:1043). A join started inside that minute pays, is refused and refunded: the gas is lost and
// the stake is away until FoxLeague's refund.
import test from 'node:test'
import assert from 'node:assert/strict'
import { BUSY_OPENS_MARGIN_S, checkAction, type RulesContext } from '../../src/executor/rules.ts'
import { OTHER, TEST_SETTINGS, snapshot, tournament } from '../fixtures.ts'
import type { TournamentDetail } from '../../src/foxleague/types.ts'

const inSeconds = (s: number) => new Date(Date.now() + s * 1000).toISOString()
const ctx = (d: TournamentDetail, more: Partial<RulesContext> = {}): RulesContext => ({ settings: TEST_SETTINGS, tournament: d, opponent: { userId: 900, elo: 1100, strength: 1300 }, oneVOneWithOpponentThisWeek: 0, field: [], now: new Date(), ...more })

test('INTEG-5: a 1v1 stake is not signed 20 seconds before the challenge deadline (the payment reaches /join after it)', () => {
  const oneVOne = (deadline: string) => tournament(77, { max_teams: 2, min_teams: 2, format: 'knockout', creator_user_id: 900, deadline, starts_at: inSeconds(3600) }, [{ user_id: 900, wallet_address: OTHER }]) as TournamentDetail
  const late = checkAction({ type: 'join_tournament', tournament_id: 77 }, snapshot(), ctx(oneVOne(inSeconds(20))))
  assert.equal(late.ok, false, `the agent signs a ${late.foxsy / 10n ** 18n} FOXSY stake 20 s before the deadline; by its own count (${BUSY_OPENS_MARGIN_S} s for a payment to reach the join gate) FoxLeague answers "Registration deadline has passed" and refunds it`)
  assert.match(String(late.refusal), /deadline/)
  // A deadline comfortably ahead is still joined.
  assert.equal(checkAction({ type: 'join_tournament', tournament_id: 77 }, snapshot(), ctx(oneVOne(inSeconds(1800)))).ok, true)
})

test('INTEG-5: a tournament seat is not signed 20 seconds before the registration deadline', () => {
  const t = (deadline: string) => tournament(78, { deadline, starts_at: inSeconds(7200) }, []) as TournamentDetail
  const late = checkAction({ type: 'join_tournament', tournament_id: 78 }, snapshot(), ctx(t(inSeconds(20))))
  assert.equal(late.ok, false, 'the agent signs a 1,000 FOXSY entry 20 s before the registration deadline: FoxLeague refuses the join that arrives after it and refunds the entry (gas lost)')
  assert.match(String(late.refusal), /deadline/)
  assert.equal(checkAction({ type: 'join_tournament', tournament_id: 78 }, snapshot(), ctx(t(inSeconds(1800)))).ok, true)
})

// Added with the fix: the margin is the one the 1v1 busy hour uses, a free seat signs nothing and needs none, and a
// deadline that cannot be read is no deadline ahead.
test('INTEG-5: the margin is BUSY_OPENS_MARGIN_S: refused at the margin, joined a minute past it', () => {
  const t = (deadline: string) => tournament(78, { deadline, starts_at: inSeconds(7200) }, []) as TournamentDetail
  const at = checkAction({ type: 'join_tournament', tournament_id: 78 }, snapshot(), ctx(t(inSeconds(BUSY_OPENS_MARGIN_S - 5))))
  assert.match(String(at.refusal), /registration deadline is in \d+ s: a payment signed now reaches FoxLeague's join after it/)
  assert.equal(checkAction({ type: 'join_tournament', tournament_id: 78 }, snapshot(), ctx(t(inSeconds(BUSY_OPENS_MARGIN_S + 60)))).ok, true)
})

test('INTEG-5: a free Bronze seat pays nothing and is still taken inside the margin, never after the deadline', () => {
  const free = (deadline: string) => tournament(79, { tier: 'bronze', entry_fee_foxsy: 0, deadline, starts_at: inSeconds(7200) }, []) as TournamentDetail
  assert.equal(checkAction({ type: 'join_tournament', tournament_id: 79 }, snapshot(), ctx(free(inSeconds(20)))).ok, true)
  assert.match(String(checkAction({ type: 'join_tournament', tournament_id: 79 }, snapshot(), ctx(free(inSeconds(-20)))).refusal), /deadline passed/)
})

test('INTEG-5: a deadline that is no time is unread: no entry is paid', () => {
  const t = tournament(78, { deadline: 'soon', starts_at: inSeconds(7200) }, []) as TournamentDetail
  const v = checkAction({ type: 'join_tournament', tournament_id: 78 }, snapshot(), ctx(t))
  assert.equal(v.ok, false, 'an entry was allowed into a tournament whose deadline could not be read')
  assert.match(String(v.refusal), /deadline could not be read: not joining blind/)
})
