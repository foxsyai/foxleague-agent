// MNT-1c (the open item of MON-3 and MNT-1: "a team out of a knockout still counts its span"): the schedule rule
// counts what a tournament under way still owes the squad as the most its format brings less the finished matches it
// lists (MON-3). A team knocked out of a knockout owes nothing more, but the rule still counted its rounds not drawn, so
// a second tournament the squad has the condition for was refused. FoxLeague lists a finished match with its score for
// a day (upcoming-matches): a knockout match of ours with our score below theirs ends our run. A level score went to
// penalties the list does not show (still owed); a group match lost is no exit; a third place match may still follow.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setup, snapshot, tournament, dryWallet } from '../fixtures.ts'
import type { PlannedAction } from '../../src/executor/actions.ts'

const at = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()
const played = (score: [number, number], group: string | null = null) => ({ tournament_id: 60, tournament_title: 'T60', round_label: 'Quarter-final', group_name: group, is_home: true, opponent_name: 'Rival', scheduled_at: at(-0.5), strategy_locks_at: at(-1), locked: true, phase: 'finished', home_score: score[0], away_score: score[1] })

/** The agent sits in a knockout of 8 (or a Groups + Knockout of 8) that started an hour ago; its squad at condition 50. */
function seated(format: string, listed: ReturnType<typeof played>[], thirdPlace = false, condition = 50) {
  const s = snapshot()
  for (const p of s.players) p.condition = condition
  const running = { ...(tournament(60, { status: 'active', format, max_teams: 8, min_teams: format === 'knockout' ? 8 : 6, starts_at: at(-1), deadline: at(-2), started_at: at(-1), round_interval_minutes: 30, has_third_place_match: thirdPlace }) as { tournament: object }).tournament }
  s.auth!.myTournaments!.active = [running] as never
  s.auth!.upcoming = { lead_minutes: 30, my_team_name: 'Agent', matches: listed } as never
  return s
}

const JOIN: PlannedAction = { action: { type: 'join_tournament', tournament_id: 70 }, reason: 'test' }
const join = async (s: ReturnType<typeof snapshot>) => {
  const m = setup({ fox: { tournament: async () => tournament(70, { starts_at: at(2), deadline: at(1), round_interval_minutes: 30 }, []), user: async () => ({ elo_rating: 1200 }) } })
  return (await m.exec.run(m.agent(), dryWallet, s, [JOIN]))[0]!
}

test('control: still in the knockout (the quarter-final won), its rounds still to play count and the entry is refused', async () => {
  const r = await join(seated('knockout', [played([2, 0])]))
  assert.equal(r.status, 'refused', r.summary)
  assert.match(r.summary, /wear the squad down/)
})

test('MNT-1c knocked out of a knockout (the quarter-final lost 0-2), the squad owes it nothing more', async () => {
  const r = await join(seated('knockout', [played([0, 2])]))
  assert.equal(r.status, 'dry_run', `a team out of the knockout was still charged its rounds: ${r.summary}`)
})

test('MNT-1c a level score (decided on penalties the list does not show) and a group match lost still owe', async () => {
  for (const r of [await join(seated('knockout', [played([1, 1])])), await join(seated('groups_knockout', [played([0, 2], 'A')]))]) {
    assert.equal(r.status, 'refused', r.summary)
    assert.match(r.summary, /wear the squad down/)
  }
})

test('MNT-1c out of a Groups + Knockout in its knockout phase, nothing more is owed', async () => {
  assert.equal((await join(seated('groups_knockout', [played([0, 2])]))).status, 'dry_run')
})

test('MNT-1c a knockout with a third place match: a team out may still owe that one match, and only that one', async () => {
  // At condition 40 the squad has room for the new knockout's 3 matches and not for a 4th at the same hours.
  assert.equal((await join(seated('knockout', [played([0, 2])], false, 40))).status, 'dry_run')
  const r = await join(seated('knockout', [played([0, 2])], true, 40))
  assert.equal(r.status, 'refused', r.summary)
  assert.match(r.summary, /3 here plus 1 still owed/)
  // At condition 50 that one match fits; the rounds of the bracket are no longer counted.
  assert.equal((await join(seated('knockout', [played([0, 2])], true))).status, 'dry_run')
})
