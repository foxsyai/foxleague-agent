// MON-3: the schedule rule counts what a tournament under way still owes the squad as the fixtures LISTED
// (rules.ts otherMatches: Math.max(1, left)). FoxLeague draws a Swiss round only when the round before it has ended
// (tournament_engine.rs, advance to the next round), and a knockout or a Groups + Knockout lists a team's next
// knockout fixture only once it is reached. So a Swiss of 16 after its first round shows 1 fixture while up to 4 are
// still to play: the rule counts 1, and a paid entry it would refuse on the 4 is allowed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setup, snapshot, tournament, dryWallet } from '../fixtures.ts'
import { matchesAtMost } from '../../src/executor/rules.ts'
import type { PlannedAction } from '../../src/executor/actions.ts'

const at = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()
const fixture = (round: number, when: number, phase: string) => ({ tournament_id: 60, tournament_title: 'T60', round_label: `Round ${round}`, group_name: null, is_home: true, opponent_name: 'Rival', scheduled_at: at(when), strategy_locks_at: at(when - 0.5), locked: phase !== 'upcoming', phase, home_score: phase === 'finished' ? 1 : null, away_score: phase === 'finished' ? 0 : null })

/** The agent sits in a Swiss of 16 that started an hour ago (5 rounds, one an hour); squad at condition 60. */
function inSwiss(listed: ReturnType<typeof fixture>[]) {
  const s = snapshot()
  for (const p of s.players) p.condition = 60
  const swiss = { ...(tournament(60, { status: 'active', format: 'swiss', max_teams: 16, min_teams: 8, starts_at: at(-1), deadline: at(-2), started_at: at(-1), round_interval_minutes: 60 }) as { tournament: object }).tournament }
  s.auth!.myTournaments!.active = [swiss] as never
  s.auth!.upcoming = { lead_minutes: 30, my_team_name: 'Agent', matches: listed } as never
  return s
}

const JOIN: PlannedAction = { action: { type: 'join_tournament', tournament_id: 70 }, reason: 'test' }
const mocks = () => setup({ fox: { tournament: async () => tournament(70, { starts_at: at(2), deadline: at(1), round_interval_minutes: 30 }, []), user: async () => ({ elo_rating: 1200 }) } })

test('the numbers: a Swiss of 16 plays 5 rounds, so 4 are still to play after the first', () => {
  assert.equal(matchesAtMost('swiss', 16, false), 5)
})

test('control: were the 4 rounds still to play listed, the paid entry is refused', async () => {
  const m = mocks()
  const all = [fixture(1, -1, 'finished'), fixture(2, 0.5, 'upcoming'), fixture(3, 1.5, 'upcoming'), fixture(4, 2.5, 'upcoming'), fixture(5, 3.5, 'upcoming')]
  const [r] = await m.exec.run(m.agent(), dryWallet, inSwiss(all), [JOIN])
  assert.equal(r!.status, 'refused', r!.summary)
  assert.match(r!.summary, /wear the squad down/)
})

test('MON-3: a Swiss under way owes its rounds still to play, not only the one FoxLeague has drawn', async () => {
  const m = mocks()
  // What FoxLeague serves after round 1: the finished game and round 2. Rounds 3 to 5 are drawn later.
  const [r] = await m.exec.run(m.agent(), dryWallet, inSwiss([fixture(1, -1, 'finished'), fixture(2, 0.5, 'upcoming')]), [JOIN])
  assert.equal(r!.status, 'refused', `3 rounds nobody has drawn yet were read as none: ${r!.summary}`)
})
