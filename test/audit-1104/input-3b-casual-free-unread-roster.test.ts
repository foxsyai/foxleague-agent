// Audit 2026-11-04 (five Fable 5.1 reviewers at max effort, PRs #29 to #50): the proof of a finding, failing before its fix.
// INPUT-3 (same root cause): with the roster unread, "Casual game now" says free although the cards' condition
// before the next lock cannot be judged; the executor's casualCostRefusal skips every card it cannot find.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderDigest } from '../../src/snapshot/digest.ts'
import { casualCostRefusal } from '../../src/executor/rules.ts'
import { snapshot } from '../fixtures.ts'

test('INPUT-3b: a casual game is not free when the roster could not be read', () => {
  const s = snapshot()
  const lock = new Date(Date.now() + 2 * 3600_000).toISOString()
  s.auth!.upcoming!.matches = [{ tournament_id: 9, tournament_title: 'Cup', round_label: 'Round 1', is_home: true, opponent_name: 'Rival FC', scheduled_at: lock, strategy_locks_at: lock, locked: false, phase: 'upcoming', home_score: null, away_score: null }] as never
  assert.match(casualCostRefusal(s, [...s.team!.lineup, ...s.team!.substitutes], new Date())!, /back to full condition/, 'with the roster read: not free before a lock in 2 h')
  s.players = []
  s.warnings.push('players: HTTP 503')
  s.casualBench = { matches: 0, unread: 0, rows: [], field: [] }
  assert.notEqual(casualCostRefusal(s, [...s.team!.lineup, ...s.team!.substitutes], new Date()), null, 'unread cards are no free cards')
  assert.doesNotMatch(renderDigest(s), /Casual game now: free/)
})
