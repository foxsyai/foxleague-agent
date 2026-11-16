// BEH-7: the plan's second match is started 13 minutes after the first (rules.ts MATCH_RUNS_MS, service.ts
// PLAN_MATCH_GAP_MS), and FoxLeague still holds the team then. Its play gate (backend routes/matches.rs
// live_match_predicate, broadcast_holds_its_team_sql) keeps a team for the simulation, then the recording's own length
// plus 30 s counted from the LATEST of rcg_ready_at, playback_started_at and finished_at: 615 s + 30 s after a
// simulation of 1.5 to 5 minutes is 12.3 to 15.8 minutes, more when a rival opens the replay late.
// Production, 9 to 16 Nov: 17 second starts ran 13.09 to 13.25 minutes after the agent's own first start; 7 were
// refused "already in match #<the first>" (6 by the executor's own read, 1 by FoxLeague after the casual test eleven
// had been saved and had to be put back). None of the 36 second starts from 14.16 minutes up was held by the match before.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scheduleActions } from '../../src/service.ts'
import { parseAction, type PlannedAction } from '../../src/executor/actions.ts'

const act = (raw: unknown): PlannedAction => ({ action: parseAction(raw), reason: '' })
const MIN = 60_000

test('BEH-7: a plan starts its next match only once FoxLeague has let go of the team (more than 13 minutes after the start before)', () => {
  // Agent 8 on 9 Nov, agent 1 on 13 and 14 Nov, agent 9 on 16 Nov: a ranked game, then a casual test in the same plan.
  const lineup = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
  const plan = [act({ type: 'play_match', match_type: 'ranked' }), act({ type: 'play_match', match_type: 'casual', test: { formation: '4-4-2', lineup, substitutes: [12, 13, 14, 15, 16, 17, 18] } })]
  const draws = [0.05, 0.06] // both early in the window: the second waits only for its gate after the first
  let n = 0
  const r = scheduleActions(plan, { windowMs: 48 * MIN, gapMs: 30_000, random: () => draws[n++]!, lastMatchMs: null, lastRankedMs: null })
  assert.equal(r.kept.length, 2)
  const gap = (r.kept[1]!.offset - r.kept[0]!.offset) / MIN
  // 13.1 minutes failed 7 times in 17; nothing from 14.16 minutes up failed in 36.
  assert.ok(gap >= 14, `the second start comes ${gap.toFixed(2)} minutes after the first: FoxLeague refused 7 of 17 such starts at 13.1 minutes`)
})
