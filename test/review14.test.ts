// Proof tests for the agent review of PR #14 (FoxLeague's manual of 2026-10-15). Each test is named after its
// finding (R14A-1, R14A-2) and failed before its fix (R14A-1 on 5bbe423, R14A-2 on 208c4f9); a control says so.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STRANGER, dryWallet, setup, snapshot, tournament } from './fixtures.ts'
import { parseAction, type PlannedAction } from '../src/executor/actions.ts'
import type { AgentSnapshot } from '../src/snapshot/snapshot.ts'
import type { Tournament, UpcomingMatch } from '../src/foxleague/types.ts'

const act = (action: unknown): PlannedAction[] => [{ action: action as PlannedAction['action'], reason: '' }]
const iso = (minutesFromNow: number) => new Date(Date.now() + minutesFromNow * 60_000).toISOString()

// ---- R14A-1: the 1v1 busy gate follows FoxLeague's rows (#512, 2026-10-15) ----

/** One row of GET /api/tournaments/upcoming-matches: an own fixture, `minutes` from now. */
const fixture = (tid: number, minutes: number, phase: UpcomingMatch['phase'], more: Partial<UpcomingMatch> = {}): UpcomingMatch => ({
  tournament_id: tid, tournament_title: `T${tid}`, round_label: null, group_name: null, is_home: true, opponent_name: 'Rival',
  scheduled_at: iso(minutes), strategy_locks_at: iso(minutes - 30), locked: phase !== 'upcoming', phase, tournament_match_id: `m${tid}${minutes}`,
  home_score: phase === 'finished' ? 1 : null, away_score: phase === 'finished' ? 0 : null, ...more,
})
/** A tournament of the agent's (GET /api/tournaments/my, active), started two hours ago. */
const running = (id: number, format: string, more: Record<string, unknown> = {}): Tournament =>
  (tournament(id, { status: 'active', format, max_teams: 8, min_teams: 8, starts_at: iso(-120), started_at: iso(-120), round_interval_minutes: 30, ...more }) as { tournament: Tournament }).tournament

const oneVOneRig = (detail: Record<string, unknown> = {}) =>
  setup({
    fox: {
      user: async (a: string) => (a === STRANGER ? { id: 900, wallet_address: STRANGER, elo_rating: 1200 } : null),
      tournament: async () => ({ ...(tournament(555, { max_teams: 2, min_teams: 2, creator_user_id: 900 }, [{ user_id: 900, wallet_address: STRANGER }]) as object), ...detail }),
    },
  })
const join1v1 = act({ type: 'join_tournament', tournament_id: 555 })
const openChallenge = act({ type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: null, deadline_minutes: 60 })

/** The 1v1 join and the challenge in this snapshot: both statuses and the join's summary. */
async function oneVOne(s: AgentSnapshot, detail: Record<string, unknown> = {}) {
  const j = oneVOneRig(detail)
  const join = (await j.exec.run(j.agent(), dryWallet, s, join1v1))[0]!
  const c = oneVOneRig(detail)
  const create = (await c.exec.run(c.agent(), dryWallet, s, openChallenge))[0]!
  return { join: join.status, create: create.status, summary: `${join.summary} | ${create.summary}` }
}
const withRows = (active: Tournament[], rows: UpcomingMatch[]): AgentSnapshot => {
  const s = snapshot()
  s.auth!.myTournaments = { active, completed: [] }
  s.auth!.upcoming = { lead_minutes: 30, my_team_name: 'Agent', matches: rows }
  return s
}

test('R14A-1 an own match past its kickoff whose broadcast has not ended (20 min after kickoff, still live) refuses the 1v1 join and the challenge', async () => {
  const r = await oneVOne(withRows([running(201, 'knockout')], [fixture(201, -20, 'live')]))
  assert.equal(r.join, 'refused', r.summary)
  assert.equal(r.create, 'refused', r.summary)
  // Control: FoxLeague's own example, a first match 33 h away, does not keep the team busy.
  const far = await oneVOne(withRows([running(203, 'round_robin')], [fixture(203, 33 * 60, 'upcoming')]))
  assert.equal(far.join, 'dry_run', far.summary)
  assert.equal(far.create, 'dry_run', far.summary)
})

test('R14A-1 groups_knockout: the own group matches ended but the group has not (no knockout fixture out yet): busy', async () => {
  const group = [fixture(202, -150, 'finished', { group_name: 'A' }), fixture(202, -90, 'finished', { group_name: 'A' }), fixture(202, -30, 'finished', { group_name: 'A' })]
  const r = await oneVOne(withRows([running(202, 'groups_knockout')], group))
  assert.equal(r.join, 'refused', r.summary)
  assert.equal(r.create, 'refused', r.summary)
  assert.match(r.summary, /group/)
  // Control: the own knockout fixture is out (it shows only once the whole group has ended) and is 3 h away.
  const done = await oneVOne(withRows([running(202, 'groups_knockout')], [...group, fixture(202, 180, 'upcoming', { group_name: null })]))
  assert.equal(done.join, 'dry_run', done.summary)
  // Control: the group's last own match is 3 h away; the group arm starts only an hour before the group's last kickoff.
  const early = await oneVOne(withRows([running(202, 'groups_knockout')], [fixture(202, -60, 'finished', { group_name: 'A' }), fixture(202, 180, 'upcoming', { group_name: 'A' })]))
  assert.equal(early.join, 'dry_run', early.summary)
})

test('R14A-1 swiss: the own round match ended but the round has not (the next round is not out): busy', async () => {
  const r = await oneVOne(withRows([running(204, 'swiss')], [fixture(204, -40, 'finished')]))
  assert.equal(r.join, 'refused', r.summary)
  assert.equal(r.create, 'refused', r.summary)
  assert.match(r.summary, /round/)
  // Control: the next round's own fixture is out (so the round before it has ended) and is 3 h away.
  const next = await oneVOne(withRows([running(204, 'swiss')], [fixture(204, -40, 'finished'), fixture(204, 180, 'upcoming')]))
  assert.equal(next.join, 'dry_run', next.summary)
})

test('R14A-1 when the snapshot cannot tell (no own fixture listed, group not sent, an unknown format or status) it refuses', async () => {
  const cases: [string, AgentSnapshot][] = [
    ['groups_knockout without any own fixture in the list', withRows([running(205, 'groups_knockout')], [])],
    ['swiss without any own fixture in the list', withRows([running(206, 'swiss')], [])],
    ['group rows without group_name', withRows([running(207, 'groups_knockout')], [fixture(207, -30, 'finished', { group_name: undefined })])],
    ['a format the agent does not know', withRows([running(208, 'league_knockout', { max_teams: 36 })], [fixture(208, 600, 'upcoming')])],
    ['a status the agent does not know', withRows([running(209, 'knockout', { status: 'paused' })], [])],
  ]
  for (const [what, s] of cases) {
    const r = await oneVOne(s)
    assert.equal(r.join, 'refused', `${what}: ${r.summary}`)
    assert.equal(r.create, 'refused', `${what}: ${r.summary}`)
  }
})

test('R14A-1 a tournament of the agent\'s that starts within the hour and has not published its fixtures yet: busy', async () => {
  const soon = running(210, 'round_robin', { status: 'open', starts_at: iso(40), started_at: null })
  const r = await oneVOne(withRows([soon], []))
  assert.equal(r.join, 'refused', r.summary)
  assert.equal(r.create, 'refused', r.summary)
  // Control: one that starts in 3 hours.
  const later = await oneVOne(withRows([{ ...soon, starts_at: iso(180) }], []))
  assert.equal(later.join, 'dry_run', later.summary)
})

test('R14A-1 FoxLeague\'s own answer on the 1v1 (viewer_blocked_tournament_window true) refuses the join', async () => {
  const r = await oneVOne(withRows([], []), { viewer_blocked_tournament_window: true })
  assert.equal(r.join, 'refused', r.summary)
  assert.match(r.summary, /FoxLeague/)
  const free = await oneVOne(withRows([], []), { viewer_blocked_tournament_window: false })
  assert.equal(free.join, 'dry_run', free.summary)
})

test('R14A-1 a full page of upcoming matches (FoxLeague\'s 50 without a limit) may hide a match within the hour: refused', async () => {
  // Fifty games of the last day (a completed tournament) fill the page; the next fixture of T213 would be cut from it.
  const page = Array.from({ length: 50 }, (_, i) => fixture(212, -24 * 60 + i * 20, 'finished'))
  const r = await oneVOne(withRows([running(213, 'knockout')], page))
  assert.equal(r.join, 'refused', r.summary)
  assert.equal(r.create, 'refused', r.summary)
  // Control: 49 rows are the whole list.
  const whole = await oneVOne(withRows([running(213, 'knockout')], page.slice(1)))
  assert.equal(whole.join, 'dry_run', whole.summary)
})

test('R14A-1 control: play_match keeps its pre-match lockout (an own match within the hour)', async () => {
  const m = setup()
  const [r] = await m.exec.run(m.agent(), dryWallet, withRows([running(211, 'knockout')], [fixture(211, 30, 'upcoming')]), act({ type: 'play_match', match_type: 'casual' }))
  assert.equal(r!.status, 'refused', r!.summary)
  assert.match(r!.summary, /pre-match lockout/)
})

// ---- R14A-2: a tournament of a format the agent does not know is neither joined nor created ----

test('R14A-2 a league_knockout tournament (36 teams, a daily round) is not joined: the format is not supported yet', async () => {
  const m = setup({
    fox: { tournament: async () => tournament(600, { format: 'league_knockout', max_teams: 36, min_teams: 36, round_interval_minutes: 1440 }) },
  })
  const [r] = await m.exec.run(m.agent(), dryWallet, snapshot(), act({ type: 'join_tournament', tournament_id: 600 }))
  assert.equal(r!.status, 'refused', r!.summary)
  assert.match(r!.summary, /format league_knockout is not supported yet: not joining blind/)
  // Control: the four known formats still join.
  for (const [format, max] of [['knockout', 8], ['groups_knockout', 8], ['round_robin', 6], ['swiss', 6]] as const) {
    const k = setup({ fox: { tournament: async () => tournament(601, { format, max_teams: max, min_teams: max }) } })
    const [ok] = await k.exec.run(k.agent(), dryWallet, snapshot(), act({ type: 'join_tournament', tournament_id: 601 }))
    assert.equal(ok!.status, 'dry_run', `${format}: ${ok!.summary}`)
  }
})

test('R14A-2 a create of an unknown format is refused by the rules, not left to a crash (parseAction already refuses it)', async () => {
  const create = { type: 'create_tournament', title: 'League Cup', format: 'league_knockout', tier: 'silver', max_teams: 36, min_teams: 36, entry_fee_foxsy: 1000, starts_in_hours: 6, registration_closes_minutes_before: 60, round_interval_minutes: 30 }
  assert.throws(() => parseAction(create), /format must be one of/)
  const m = setup()
  const [r] = await m.exec.run(m.agent(), dryWallet, snapshot(), act(create))
  assert.equal(r!.status, 'refused', r!.summary)
  assert.match(r!.summary, /format league_knockout is not supported yet/)
})
