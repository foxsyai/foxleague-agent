// P-O2 (MAINNET audit of 16 Nov 2026, section 6; the owner's decision of 16 Nov: "14 days, own start each"). The snapshot
// gave every agent the same single gap and named "starts_at from X": agents 9, 10, 1 and 7 planned the same minute and
// three were refused. Each agent is now offered a start of its own for each shape: agent n takes the (n mod k)-th of the
// k free starts listed, the starts a booking apart so each can hold its own tournament. The pick depends only on the
// agent's own number and FoxLeague's public answer: no agent reads another's state or plans (the owner's rule of
// 2026-10-27, agents play alone). Each test failed on a7e5668 before the change.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAction } from '../../src/executor/actions.ts'
import { blockingWindow } from '../../src/executor/slots.ts'
import { renderDigest } from '../../src/snapshot/digest.ts'
import type { AgentSnapshot } from '../../src/snapshot/snapshot.ts'
import { dryWallet, setup, snapshot } from '../fixtures.ts'

const H = 3600_000
const MIN = 60_000
const DAY = 86_400_000
const ceilMin = (ms: number) => Math.ceil(ms / MIN) * MIN
const minute = (ms: number) => `${new Date(ms).toISOString().slice(0, 16)}Z`

type Calendar = { format: string; teams: number; free: { first: number; last: number }[] | null }[]

/** The snapshot of agent `index`, FoxLeague's calendar free over `free` for every shape. */
function agentSees(index: number, free: { first: number; last: number }[]): AgentSnapshot {
  const s = snapshot()
  s.agent = { ...s.agent, index }
  ;(s.market as { calendar?: Calendar }).calendar = [
    { format: 'round_robin', teams: 3, free },
    { format: 'round_robin', teams: 8, free },
    { format: 'groups_knockout', teams: 16, free },
  ]
  return s
}
const ownStart = (s: AgentSnapshot, shape = 'round_robin of 3') => {
  const line = renderDigest(s).split('\n').find(l => l.startsWith(`  ${shape} (`)) ?? ''
  return /your start for this shape: starts_at (\S+?)(;|$)/.exec(line)?.[1]
}

test('P-O2 the live case: two gaps in 14 days, so agents 0, 2, 4, ... take the first and 1, 3, 5, ... the second; never all the same minute', () => {
  // FoxLeague's answer for a round robin of 3 at 12:33 UTC on 16 Nov 2026, moved to days ahead of now.
  const g1 = ceilMin(Date.now() + 10 * DAY)
  const g2 = ceilMin(Date.now() + 12 * DAY)
  const free = [{ first: g1, last: g1 + 87 * MIN }, { first: g2, last: g2 + 117 * MIN }]
  const starts = [0, 1, 2, 3, 8, 9].map(i => ownStart(agentSees(i, free)))
  assert.deepEqual(starts, [minute(g1), minute(g2), minute(g1), minute(g2), minute(g1), minute(g2)])
})

test('P-O2 ten agents reading the same free stretch get ten different starts, a booking apart, so each can hold its own tournament of any shape listed', () => {
  const first = ceilMin(Date.now() + 4 * DAY)
  const free = [{ first, last: first + 5 * DAY }]
  const starts = Array.from({ length: 10 }, (_, i) => ownStart(agentSees(i, free), 'groups_knockout of 16'))
  assert.equal(new Set(starts).size, 10, starts.join(', '))
  // Whatever shape each agent creates of the three, no two of the ten windows overlap.
  const times = starts.map(x => Date.parse(x!)).sort((a, b) => a - b)
  for (let i = 1; i < times.length; i++) {
    const a = blockingWindow('groups_knockout', 16, false, times[i - 1]!)
    const b = blockingWindow('groups_knockout', 16, false, times[i]!)
    assert.ok(a.end <= b.start, `${minute(times[i - 1]!)} and ${minute(times[i]!)} overlap`)
  }
  // The eleventh agent comes round again to the first agent's start: k is the starts listed.
  assert.equal(ownStart(agentSees(10, free), 'groups_knockout of 16'), starts[0])
})

test('P-O2 the pick depends only on the agent\'s own number and FoxLeague\'s answer: two agents\' own starts both pass the executor, one after the other', async () => {
  const first = ceilMin(Date.now() + 4 * DAY)
  const free = [{ first, last: first + 5 * DAY }]
  const a = agentSees(0, free)
  const b = agentSees(1, free)
  // Nothing else of b is like a's: the same answer and number give the same start whatever the rest of the snapshot.
  b.leaderboardNeighbours = [{ id: 5, wallet_address: 'erd1x', team_name: 'Other', elo_rating: 1300, league: 'Silver', accepted7d: 3 }]
  assert.equal(ownStart(agentSees(1, free)), ownStart(b))
  const sa = ownStart(a)!
  const sb = ownStart(b)!
  assert.notEqual(sa, sb)
  const create = (at: string) => parseAction({ type: 'create_tournament', title: 'Evening Trio', format: 'round_robin', tier: 'silver', max_teams: 3, min_teams: 3, entry_fee_foxsy: 1000, registration_closes_minutes_before: 60, round_interval_minutes: 30, starts_at: at })
  const m = setup()
  const [ra] = await m.exec.run(m.agent(), dryWallet, a, [{ action: create(sa), reason: '' }])
  assert.equal(ra!.status, 'dry_run', ra!.summary)
  // Agent 0's tournament is on the calendar now: agent 1's own start still fits.
  b.market.slots = [{ id: 7100, title: 'Evening Trio', ...blockingWindow('round_robin', 3, false, Date.parse(sa)) }]
  const n = setup()
  const [rb] = await n.exec.run(n.agent(), dryWallet, b, [{ action: create(sb), reason: '' }])
  assert.equal(rb!.status, 'dry_run', rb!.summary)
})

test('P-O2 the plan reads its start and the next free ones in plain words', () => {
  const first = ceilMin(Date.now() + 4 * DAY)
  const s = agentSees(1, [{ first, last: first + 5 * DAY }])
  const line = renderDigest(s).split('\n').find(l => l.startsWith('  round_robin of 3 (')) ?? ''
  assert.match(line, /your start for this shape: starts_at \S+; the next free ones \(only if yours is refused\): \S+Z, \S+Z/)
  assert.match(renderDigest(s), /picked by your agent number/)
  assert.doesNotMatch(renderDigest(s), /—|\bbots?\b/i)
  const own = renderDigest(s).split('\n').filter(l => l.startsWith('Your own starts') || /^ {2}(round_robin|groups_knockout) of \d+ \(/.test(l)).join('\n')
  assert.doesNotMatch(own, /, and |, or /, 'no Oxford comma')
})
