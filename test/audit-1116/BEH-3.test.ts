// Audit 2026-11-16 (BEHAVIOUR): the proof of BEH-3, failing before its fix.
// The digest listed an open tournament the executor will refuse for its schedule, with nothing that says so. The join
// rule (rules.ts scheduleRefusal) refuses a tournament whose matches cost more condition than the eleven and bench hold
// above 30 at its start plus what they regain over its span. Production, 9 to 16 Nov: 9 such refusals, 7 agents, 5
// tournaments, each proposed in the plan's own words as worth it; the plan paid a model call and an action for each.
// The digest already tells the plan what the executor would say for a casual game ("Casual game now: not free: ...").
//
// The reviewer's example, the 18-team home-and-away round robin T5566, is joinable since MNT-1 (FoxLeague plays its 306
// matches over 12.7 days), so the proof takes a tournament the corrected rule still refuses: a knockout of 8 that starts
// in an hour while the squad is tired.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkAction, type RulesContext } from '../../src/executor/rules.ts'
import { renderDigest } from '../../src/snapshot/digest.ts'
import type { TournamentDetail } from '../../src/foxleague/types.ts'
import { TEST_SETTINGS, snapshot, tournament } from '../fixtures.ts'

const hours = (h: number): string => new Date(Date.now() + h * 3600_000).toISOString()

test('BEH-3: an open tournament whose schedule the executor refuses is marked so in the digest the plan reads', () => {
  const shape = { format: 'knockout', max_teams: 8, min_teams: 8, round_interval_minutes: 30, entry_fee_foxsy: 1000, deadline: hours(0.5), starts_at: hours(1), participant_count: 5 }
  const detail = tournament(5566, shape) as TournamentDetail
  const s = snapshot()
  for (const p of s.players) p.condition = 35 // after a heavy day: 3 matches in 3 hours are too many

  // The executor's answer to the join: refused for the schedule.
  const ctx: RulesContext = { settings: { ...TEST_SETTINGS }, now: new Date(), field: [], tournament: detail }
  const v = checkAction({ type: 'join_tournament', tournament_id: 5566 }, s, ctx)
  assert.equal(v.ok, false)
  assert.match(v.refusal ?? '', /the schedule would wear the squad down: up to 3 matches/)

  // What the plan reads about the same tournament.
  s.market.openStandard = [detail.tournament]
  const lines = renderDigest(s).split('\n')
  const at = lines.findIndex(l => l.trimStart().startsWith('T5566 '))
  assert.ok(at >= 0, 'the tournament is listed among the open ones')
  // Its own line and the field line under it.
  const shown = [lines[at]!, ...(lines[at + 1]?.startsWith('    ') ? [lines[at + 1]!] : [])].join('\n')
  assert.match(shown, /wear|worn|refuse|not joinable|cannot (be )?join|condition/i, `the tournament's lines must say the executor refuses its schedule; they read:\n${shown}`)
})

test('BEH-3: a tournament the schedule fits carries no such mark', () => {
  const detail = tournament(5567, { format: 'knockout', max_teams: 8, min_teams: 8, round_interval_minutes: 30, deadline: hours(0.5), starts_at: hours(1) }) as TournamentDetail
  const s = snapshot() // every card at condition 100
  s.market.openStandard = [detail.tournament]
  const lines = renderDigest(s).split('\n')
  const at = lines.findIndex(l => l.trimStart().startsWith('T5567 '))
  assert.ok(at >= 0)
  assert.ok(!(lines[at + 1] ?? '').includes('schedule'), lines[at + 1])
})
