// ORG-1 (organizer, open after P-O1 of the audit of 16 Nov 2026): since P-O1 the agent creates a tournament up to 30
// days ahead, and the squad and schedule checks of the create (condition at its start with the other tournaments,
// injuries and bans) ran only at the create. A tournament joined since, or cards hurt since, could leave the agent's own
// tournament past what the squad can play, and nothing told the plan before its registration closed. Each planning
// snapshot now runs those checks again on each open tournament the agent created itself and holds a seat in: a line
// says whether it still fits, and when it no longer does, until when the plan may leave it and what comes back (the
// entry; FoxLeague's leave lock refuses a leave at exactly its minimum, release/mainnet-1.0 729164194 tournaments.rs
// `leave_breaks_the_minimum`; an organizer's deposit follows the tournament, organizer_fees.rs `refund_of`). Such a leave
// runs first in its plan, as BEH-9: any team that joins can bring the tournament to its minimum and lock the seats. A
// check that cannot be made says so: unknown is not a fit.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAction, type PlannedAction } from '../../src/executor/actions.ts'
import { actionDeadline } from '../../src/executor/deadlines.ts'
import type { Tournament } from '../../src/foxleague/types.ts'
import { renderDigest } from '../../src/snapshot/digest.ts'
import type { AgentSnapshot } from '../../src/snapshot/snapshot.ts'
import { scheduleActions } from '../../src/service.ts'
import { dryWallet, setup, snapshot, tournament } from '../fixtures.ts'

const H = 3600_000
const MIN = 60_000
const DAY = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString()
const hm = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`

/** A tournament row as /tournaments/my serves it. */
function row(id: number, more: Partial<Tournament>): Tournament {
  return (tournament(id, { format: 'round_robin', max_teams: 8, min_teams: 4, round_interval_minutes: 30, home_and_away: false, has_third_place_match: false, started_at: null, ...more }) as { tournament: Tournament }).tournament
}

/** The agent's own Silver round robin of 8, created 10 days ahead, 2 of 8 seated; `extra` are its other tournaments. */
function withOwn(extra: Tournament[] = [], more: Partial<Tournament> = {}): { s: AgentSnapshot; start: number; deadline: number } {
  const start = Math.ceil((Date.now() + 10 * DAY) / MIN) * MIN
  const deadline = start - H
  const s = snapshot()
  const own = row(7001, { creator_user_id: 100, entry_fee_foxsy: 1000, starts_at: iso(start), deadline: iso(deadline), participant_count: 2, ...more })
  s.auth!.myTournaments!.active = [own, ...extra]
  s.ownCreations = [7001]
  return { s, start, deadline }
}
const ownLine = (s: AgentSnapshot) => renderDigest(s).split('\n').find(l => l.startsWith('Your own T7001')) ?? ''

test('ORG-1 a tournament joined since the create wears the squad down at the start of the agent\'s own: the snapshot says it no longer fits and until when it may leave', () => {
  // A round robin of 20 of another team's, joined after the create, at the same hour: 19 more matches then.
  const { s, deadline } = withOwn([row(7002, { creator_user_id: 900, max_teams: 20, min_teams: 3, starts_at: iso(Date.now() + 10 * DAY), deadline: iso(Date.now() + 10 * DAY - H) })])
  const line = ownLine(s)
  assert.match(line, /NO LONGER FITS: the schedule would wear the squad down/, line || renderDigest(s))
  assert.match(line, /19 still owed to your other tournaments/)
  assert.match(line, new RegExp(`You may leave it with leave_tournament until its registration closes at ${hm(deadline)}`))
  assert.match(line, /your entry of 1000 FOXSY comes back/)
  assert.doesNotMatch(line, /—|\bbots?\b/i)
  // Alone it fits, as it did at the create.
  const alone = ownLine(withOwn().s)
  assert.match(alone, /still fits your squad and schedule/, alone)
  assert.doesNotMatch(alone, /NO LONGER FITS|leave_tournament/)
})

test('ORG-1 cards hurt since the create: fewer than 11 of the 18 can play at its start, so it no longer fits; a card whose injury cannot be read is unknown, not a fit', () => {
  const { s, start } = withOwn()
  // Eight of the 18 injured until a day after the start: 10 left, a forfeit at every match.
  for (const p of s.players.slice(0, 8)) p.injuredUntil = iso(start + DAY)
  const line = ownLine(s)
  assert.match(line, /NO LONGER FITS: only 10 of your 18 can play at its start/, line)
  assert.match(line, /fewer than 11/)
  // The same, but one of them unread: the count could be 11, so the check could not be made.
  s.players[7]!.injuredUntil = null
  s.players[7]!.disciplineUnread = true
  const unread = ownLine(s)
  assert.match(unread, /could not check whether it still fits/, unread)
  assert.doesNotMatch(unread, /still fits your squad|NO LONGER FITS/)
})

test('ORG-1 the agent\'s other tournaments unread: it could not check, never "fits"', () => {
  // A tournament under way whose upcoming matches could not be read: what it still owes is unknown (MON-1).
  const { s } = withOwn([row(7003, { creator_user_id: 900, status: 'active', started_at: iso(Date.now() - H), starts_at: iso(Date.now() - H) })])
  s.auth!.upcoming = null
  const line = ownLine(s)
  assert.match(line, /could not check whether it still fits/, line)
  assert.doesNotMatch(line, /still fits your squad|NO LONGER FITS/)
})

test('ORG-1 the leave lock is said: at exactly its minimum the seats are locked now; a tournament the owner created, or one with no seat of ours, gets no line', () => {
  const { s } = withOwn([row(7002, { creator_user_id: 900, max_teams: 20, min_teams: 3, starts_at: iso(Date.now() + 10 * DAY), deadline: iso(Date.now() + 10 * DAY - H) })], { participant_count: 4 })
  ;(s.config!.tournament_defaults as { leave_lock_live?: boolean }).leave_lock_live = true
  const locked = ownLine(s)
  assert.match(locked, /NO LONGER FITS/, locked)
  assert.match(locked, /Its seats are locked now: at its minimum of 4 seated nobody can leave until more teams join/)
  s.auth!.myTournaments!.active[0] = { ...s.auth!.myTournaments!.active[0]!, participant_count: 3 }
  assert.match(ownLine(s), /not while exactly 4 teams \(its minimum\) are seated/)
  s.ownCreations = []
  assert.equal(ownLine(s), '', 'one the owner created with the same team is the owner\'s')
  s.ownCreations = [7001]
  s.auth!.unseatedCreated = [7001]
  assert.equal(ownLine(s), '', 'no seat of ours: nothing to leave (the "created by you, with no seat" line speaks)')
})

test('ORG-1 leaving its own tournament runs first in the plan (as BEH-9), and the executor lets it through', async () => {
  const now = Date.now()
  const { s } = withOwn()
  s.takenAt = iso(now)
  assert.equal(actionDeadline(parseAction({ type: 'leave_tournament', tournament_id: 7001 }), s), 'now')
  const plan: PlannedAction[] = [
    { action: parseAction({ type: 'train', player_nonce: 1, attribute: 'speed' }), reason: '' },
    { action: parseAction({ type: 'leave_tournament', tournament_id: 7001 }), reason: 'it no longer fits' },
  ]
  const deadlines = plan.map(p => {
    const d = actionDeadline(p.action, s)
    return typeof d === 'number' ? d - now : d
  })
  const r = scheduleActions(plan, { windowMs: 48 * MIN, gapMs: 30_000, random: () => 0.9, lastMatchMs: null, lastRankedMs: null, deadlines })
  assert.deepEqual(r.kept.map(k => k.p.action.type), ['leave_tournament', 'train'])
  assert.equal(r.kept[0]!.offset, 0)
  // The executor: the agent is seated in its own open tournament before its deadline.
  const m = setup({ fox: { tournament: async () => tournament(7001, { creator_user_id: 100, format: 'round_robin', max_teams: 8, min_teams: 4, deadline: iso(now + 10 * DAY - H), starts_at: iso(now + 10 * DAY) }, [{ user_id: 100 }, { user_id: 5 }]) } })
  const [left] = await m.exec.run(m.agent(), dryWallet, s, [{ action: parseAction({ type: 'leave_tournament', tournament_id: 7001 }), reason: '' }])
  assert.equal(left!.status, 'dry_run', left!.summary)
})
