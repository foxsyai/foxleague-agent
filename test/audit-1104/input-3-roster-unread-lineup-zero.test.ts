// Audit 2026-11-04 (five Fable 5.1 reviewers at max effort, PRs #29 to #50): the proof of a finding, failing before its fix.
// INPUT-3: when the roster could not be read (players: [] with a warning) the digest tells the plan its lineup
// strength is 0 and judges every seated field against 0.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderDigest } from '../../src/snapshot/digest.ts'
import { snapshot } from '../fixtures.ts'

test('INPUT-3: an unreadable roster is an unknown lineup strength, not 0, on the field lines and the 1v1 line', () => {
  const s = snapshot()
  s.players = []
  s.warnings.push('players: HTTP 503')
  const t = { id: 7, title: 'Cup', status: 'open', tier: 'silver', format: 'knockout', max_teams: 8, min_teams: 8, entry_fee_foxsy: 1000, participant_count: 2, deadline: new Date(Date.now() + 6 * 3600_000).toISOString(), starts_at: new Date(Date.now() + 7 * 3600_000).toISOString(), creator_user_id: 900, target_user_id: null, is_private: false, developer_mode: false }
  s.market.openStandard = [t as never]
  s.market.fields = [{ id: 7, seated: 2, seats: [{ userId: 901, elo: 1300, strength: 1400 }, { userId: 902, elo: 1100, strength: 900 }] }]
  s.market.scouted = [{ id: 8, elo: 1200, strength: 1500 }]
  const d = renderDigest(s)
  assert.doesNotMatch(d, /lineup 0 (today|at its start)/, 'a roster that could not be read is not a lineup of 0')
  assert.doesNotMatch(d, /Your lineup strength today[^\n]*: 0;/, 'nor a strength of 0')
  assert.match(d, /field: unknown/, 'a field judged against an unknown eleven is unknown')
})
