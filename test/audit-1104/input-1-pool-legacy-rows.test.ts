// Audit 2026-11-04 (five Fable 5.1 reviewers at max effort, PRs #29 to #50): the proof of a finding, failing before its fix.
// INPUT-1: rows kept in formation_results before the casual bench split (a casual game or an AI-filled ranked game,
// rival_user_id NULL) are still counted in the pooled formation record for 14 days after the split.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Store } from '../../src/store/db.ts'

test('INPUT-1: a game against the AI kept before the split is not a match of the pooled formation record', () => {
  const store = new Store('', ':memory:')
  const at = new Date(Date.now() - 86_400_000).toISOString()
  // Exactly what every plan before PR #49 wrote for a casual game (and an AI-filled ranked game): no rival user id.
  store.putFormationResults(0, 100, [{ key: 'm:1', at, mine: '4-3-3b', theirs: '5-2-3', gf: 3, ga: 0, edge: 2, rivalUserId: null }])
  store.putFormationResults(0, 100, [{ key: 't:A', at, mine: '4-3-3b', theirs: '4-4-2', gf: 1, ga: 0, edge: 0, rivalUserId: 200 }])
  const pool = store.formationPool()
  assert.equal(pool.matches, 1, 'only the match against a real team')
  assert.deepEqual(pool.field, [{ formation: '4-4-2', matches: 1 }], "the AI's random formation is not a rival formation")
})
