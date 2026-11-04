// Audit 2026-11-04 (five Fable 5.1 reviewers at max effort, PRs #29 to #50): the proof of a finding, failing before its fix.
// INPUT-2: a casual test whose game started but whose put-back failed twice is logged with status 'error' and
// "match #N started (casual)". casualStartsSince counts it (R49A), lastMatchStarts does not: the executor's match
// cooldown and the service's match spacing then read "no match started".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lastMatchStarts, casualStartsSince } from '../../src/executor/match-starts.ts'
import { setup, snapshot, dryWallet } from '../fixtures.ts'

const ERROR_ROW = 'play casual match (test 5-2-3: lineup 1,2,3,4,5,13,6,7,10,11,17 | bench 12,14,8,9,15,16,18): match #77 started (casual); the test formation 5-2-3 may still be saved: 4-4-2 could not be put back (HTTP 502); put back 4-4-2 with set_formation, lineup 1,2,3,4,5,6,7,8,9,10,11 | bench 12,13,14,15,16,17,18'

test('INPUT-2: a casual start whose put-back failed counts as a start for the cooldowns, as it does for the daily count', async () => {
  const { exec, agent, store } = setup()
  store.log({ agentIndex: 0, kind: 'play_match', status: 'error', summary: ERROR_ROW })
  const now = new Date()
  assert.equal(casualStartsSince(store, 0, new Date(now.getTime() - 3600_000)), 1, 'the daily count sees the start')
  assert.ok(lastMatchStarts(store, 0, now).match, 'the last match start sees it too')
  const [r] = await exec.run(agent(), dryWallet, snapshot(), [{ action: { type: 'play_match', match_type: 'ranked' }, reason: '' }])
  assert.equal(r!.status, 'refused', r!.summary)
  assert.match(r!.summary, /match cooldown/)
})
