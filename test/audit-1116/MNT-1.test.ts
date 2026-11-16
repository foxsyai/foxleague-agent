// Audit 2026-11-16 (MAINNET): the proof of MNT-1, failing before its fix.
// FoxLeague plays ONE match per round interval for the whole tournament, in every format
// (tournament_engine.rs write_league_matchdays: "One game per round_interval ... fully sequential, consistent with the
// Groups + KO and Swiss formats"; generate_groups, generate_swiss_round1, reschedule_sequential say the same). The
// agent's schedule rule counted one ROUND per interval (scheduleSpanMinutes = (a team's matches - 1) x interval), so it
// believed an 18-team home-and-away round robin plays a team's 34 matches in 33 hours. It is 306 matches, one an hour:
// 12.7 days, a match about every 9 hours for a team, 18 condition points regained for 10 lost.
// The unsafe side (MNT-1b): the same wrong span ended a tournament the squad still plays in. A 16-team round robin at 30
// minutes is 120 matches, 59.5 hours; the agent's span was 14 x 30 min = 7 hours, so 10 hours after its start the agent
// took it for over and stopped counting the fixtures FoxLeague still lists for it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkAction, scheduleSpanMinutes, type RulesContext } from '../../src/executor/rules.ts'
import { renderDigest } from '../../src/snapshot/digest.ts'
import type { TournamentDetail } from '../../src/foxleague/types.ts'
import { TEST_SETTINGS, snapshot, tournament } from '../fixtures.ts'

const hours = (h: number): string => new Date(Date.now() + h * 3600_000).toISOString()
const ctx = (more: Partial<RulesContext> = {}): RulesContext => ({ settings: { ...TEST_SETTINGS }, now: new Date(), ...more })

test('MNT-1 a fresh squad may join an 18-team home-and-away round robin: its 34 matches come one every 9 hours, not one an hour', () => {
  // The tournament the live agents were refused 12 times in the week of 9 Nov (T5544, T5554, T5563, T5566, T5576).
  const t = tournament(5544, { format: 'round_robin', max_teams: 18, min_teams: 3, home_and_away: true, round_interval_minutes: 60, deadline: hours(47), starts_at: hours(48) }) as TournamentDetail
  const v = checkAction({ type: 'join_tournament', tournament_id: 5544 }, snapshot(), ctx({ field: [], tournament: t }))
  assert.equal(v.ok, true, `refused a schedule FoxLeague spreads over 12.7 days: ${v.refusal}`)
})

test('MNT-1 the span of a round robin is every match of the tournament, one per interval', () => {
  // 18 teams, home and away: 18 x 17 = 306 matches, the last one 305 intervals after the first.
  assert.equal(scheduleSpanMinutes('round_robin', 18, true, 60), 305 * 60)
  // 20 teams, home and away, 30 minutes: 380 matches. FoxLeague measured its T564 of this shape at 189.7 hours.
  assert.equal(scheduleSpanMinutes('round_robin', 20, true, 30), 379 * 30)
})

test('MNT-1 fixtures FoxLeague still lists for a running round robin count, whatever the agent estimated its end to be', () => {
  const s = snapshot()
  for (const p of s.players) p.condition = 45
  // Seated in T400, a 16-team round robin at 30 minutes that started 10 hours ago: FoxLeague plays it for 59.5 hours.
  s.auth!.myTournaments!.active = [{ ...(tournament(400, { status: 'active' }) as { tournament: Record<string, unknown> }).tournament, format: 'round_robin', max_teams: 16, min_teams: 3, round_interval_minutes: 30, starts_at: hours(-10), started_at: hours(-10), home_and_away: false } as never]
  // Three of its fixtures fall inside the hours the new tournament plays in.
  s.auth!.upcoming!.matches = [2.2, 2.6, 2.9].map((h, i) => ({ tournament_id: 400, tournament_title: 'T400', round_label: `Matchday ${10 + i}`, group_name: 'League', is_home: true, opponent_name: 'Rival', scheduled_at: hours(h), strategy_locks_at: hours(h - 0.5), locked: false, phase: 'upcoming', home_score: null, away_score: null })) as never
  // A 4-team round robin from in 2 h: 3 matches of its own (330 condition) fit the squad alone, not with 3 more owed.
  const t = tournament(301, { format: 'round_robin', max_teams: 4, min_teams: 3, round_interval_minutes: 30, deadline: hours(1.5), starts_at: hours(2) }) as TournamentDetail
  const v = checkAction({ type: 'join_tournament', tournament_id: 301 }, s, ctx({ field: [], tournament: t }))
  assert.equal(v.ok, false, 'joined a second tournament while 3 fixtures of the first fall in the same hours and the squad is at condition 45')
  assert.match(v.refusal ?? '', /still owed to your other tournaments/)
})

test('MNT-1 a long round robin of ours counts only its fixtures that fall inside the new tournament, by their listed times', () => {
  // Seated in an 18-team home-and-away round robin at 60 minutes that started a day ago: FoxLeague plays it for 12.7
  // days and lists all 30 fixtures still to play, one about every 9 hours. One of them falls inside the 3 hours a
  // knockout of 8 starting in 2 hours plays; the other 29 come after it and cost it nothing.
  const s = snapshot()
  s.auth!.myTournaments!.active = [{ ...(tournament(500, { status: 'active' }) as { tournament: Record<string, unknown> }).tournament, format: 'round_robin', max_teams: 18, min_teams: 3, round_interval_minutes: 60, starts_at: hours(-24), started_at: hours(-24), home_and_away: true } as never]
  s.auth!.upcoming!.matches = Array.from({ length: 30 }, (_, i) => ({ tournament_id: 500, tournament_title: 'T500', round_label: `Matchday ${5 + i}`, group_name: 'League', is_home: i % 2 === 0, opponent_name: 'Rival', scheduled_at: hours(3 + 9 * i), strategy_locks_at: hours(2.5 + 9 * i), locked: false, phase: 'upcoming', home_score: null, away_score: null })) as never
  const t = tournament(302, { format: 'knockout', max_teams: 8, min_teams: 8, round_interval_minutes: 30, deadline: hours(1.5), starts_at: hours(2) }) as TournamentDetail
  const v = checkAction({ type: 'join_tournament', tournament_id: 302 }, s, ctx({ field: [], tournament: t }))
  assert.equal(v.ok, true, `refused for 29 fixtures that play after it: ${v.refusal}`)
})

test('MNT-1 the plan reads the schedule as FoxLeague plays it: one match of the whole tournament every interval', () => {
  const s = snapshot()
  s.market.openStandard = [(tournament(5544, { format: 'round_robin', max_teams: 18, min_teams: 3, home_and_away: true, round_interval_minutes: 60, deadline: hours(47), starts_at: hours(48) }) as TournamentDetail).tournament]
  const line = renderDigest(s).split('\n').find(l => l.trimStart().startsWith('T5544 ')) ?? ''
  assert.doesNotMatch(line, /rounds every/, line)
  assert.match(line, /one match of the whole tournament every 60 min: its 306 matches with 18 teams take about 305 h/, line)
})
