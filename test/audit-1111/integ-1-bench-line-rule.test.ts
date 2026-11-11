// Audit 2026-11-11 (Fable 5.2 reviewers at extra-high effort): the proof of INTEG-1, failing before its fix.
// INTEG-1: the 1v1 match-fit count ignores FoxLeague's line rule.
// FoxLeague's join gate of a 1v1 runs the lock's own forfeit decision AFTER the stake is paid
// (next-foxleague origin/main backend/src/routes/tournaments.rs:6181-6200: squad_would_forfeit, refused with
// SQUAD_NOT_MATCH_FIT and refund_failed_join). That decision (backend/src/tournament_simulator.rs auto_substitute,
// :3893-3906 and :3968-3980) relieves a tired outfield starter only with a fit OUTFIELD bench card:
// line_distance (:4084-4091) is None between the keeper line and any outfield line, find_best_sub never returns the
// bench keeper for an outfield shirt, and a starter nobody relieves stays unfit: fit_count < 11 = forfeit.
// The agent counts 11 fit cards of the 18 whatever their line (src/executor/rules.ts:823-828, :1096-1097, :1284-1285).
import test from 'node:test'
import assert from 'node:assert/strict'
import { checkAction, type RulesContext } from '../../src/executor/rules.ts'
import { OTHER, TEST_SETTINGS, snapshot, tournament } from '../fixtures.ts'
import type { TournamentDetail } from '../../src/foxleague/types.ts'

// A rival far weaker than the tired eleven: every other 1v1 rule passes.
const ctx = (more: Partial<RulesContext> = {}): RulesContext => ({ settings: TEST_SETTINGS, opponent: { userId: 900, elo: 900, strength: 400 }, oneVOneWithOpponentThisWeek: 0, now: new Date(), ...more })
const oneVOne = () => tournament(77, { max_teams: 2, min_teams: 2, format: 'knockout', creator_user_id: 900 }, [{ user_id: 900, wallet_address: OTHER }]) as TournamentDetail

test('INTEG-1 join: 7 tired outfield starters, a bench of 1 keeper + 6 outfielders: FoxLeague forfeits (10 fit), the agent must not pay the stake', () => {
  const s = snapshot()
  // Starters 2..8 (4 DEF, 3 MID) under the field minimum of 30; the keeper, 1 MID and 2 FWD fit; the bench (GK + 6 outfield) fit.
  for (const p of s.players) if (p.nonce >= 2 && p.nonce <= 8) p.condition = 20
  // FoxLeague: 7 unfit outfield shirts, 6 fit outfield bench cards, the bench keeper never takes an outfield shirt
  // => one unfit starter stays => fit_count 10 => forfeit => the paid join is refused (refund, gas lost).
  const v = checkAction({ type: 'join_tournament', tournament_id: 77 }, s, ctx({ tournament: oneVOne() }))
  assert.equal(v.ok, false, `the agent would pay ${v.foxsy / 10n ** 18n} FOXSY into a join FoxLeague refuses as not match-fit`)
  assert.match(String(v.refusal), /match-fit/)
})

test('INTEG-1 create: the same squad creates no targeted challenge (the creator seat goes through the same gate after its stake)', () => {
  const s = snapshot()
  for (const p of s.players) if (p.nonce >= 2 && p.nonce <= 8) p.condition = 20
  const v = checkAction({ type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: 900, deadline_minutes: 60 }, s, ctx())
  assert.equal(v.ok, false, 'the agent would create the 1v1 and pay its own stake into a seat FoxLeague refuses as not match-fit')
  assert.match(String(v.refusal), /match-fit/)
})

test('INTEG-1 from 13 November: one tired outfield starter and a bench whose 6 outfielders are injured (the bench keeper is fit)', () => {
  const s = snapshot()
  s.config!.card_bans = { live: true, live_from: '2026-11-13T14:00:00Z', yellow_cards_per_ban: 3 }
  const until = new Date(Date.now() + 3 * 86_400_000).toISOString()
  for (const p of s.players) {
    if (p.nonce === 2) p.condition = 20 // one DEF starter under 30
    if (p.nonce >= 13) p.injuredUntil = until // the six outfield bench cards are out (squad_would_forfeit holds them out)
  }
  // The agent counts 10 fit starters + the bench keeper = 11; FoxLeague finds no outfield card for the tired shirt: 10 fit, forfeit.
  const v = checkAction({ type: 'join_tournament', tournament_id: 77 }, s, ctx({ tournament: oneVOne() }))
  assert.equal(v.ok, false, 'the agent would pay a stake FoxLeague refuses: the bench keeper cannot relieve a tired defender')
})

// Added with the fix: the count is FoxLeague's own, no stricter (tournament_simulator.rs find_best_sub, last_resort_keeper).
test('INTEG-1 no stricter than FoxLeague: six tired outfield starters and six fit outfield bench cards are 11 fit', () => {
  const s = snapshot()
  for (const p of s.players) if (p.nonce >= 2 && p.nonce <= 7) p.condition = 20
  const v = checkAction({ type: 'join_tournament', tournament_id: 77 }, s, ctx({ tournament: oneVOne() }))
  assert.equal(v.ok, true, String(v.refusal))
})

test('INTEG-1 the keeper: a tired keeper is relieved by the bench keeper, and by an outfield bench card only as the last resort', () => {
  const tiredKeeper = () => {
    const s = snapshot()
    s.players.find(p => p.nonce === 1)!.condition = 20
    return s
  }
  const join = (s: ReturnType<typeof snapshot>) => checkAction({ type: 'join_tournament', tournament_id: 77 }, s, ctx({ tournament: oneVOne() }))
  assert.equal(join(tiredKeeper()).ok, true, 'the fit bench keeper takes the goal')
  // The bench keeper tired too: an outfield bench card goes in goal (FoxLeague's last resort for an unfit keeper).
  const noKeeper = tiredKeeper()
  noKeeper.players.find(p => p.nonce === 12)!.condition = 20
  assert.equal(join(noKeeper).ok, true, 'an outfield bench card takes the goal as the last resort')
  // That card is then gone for the outfield: six tired outfield starters and a tired keeper need seven of the six.
  const short = tiredKeeper()
  short.players.find(p => p.nonce === 12)!.condition = 20
  for (const p of short.players) if (p.nonce >= 2 && p.nonce <= 7) p.condition = 20
  const v = join(short)
  assert.equal(v.ok, false)
  assert.match(String(v.refusal), /only 10 match-fit players/)
})
