// Audit 2026-11-04 (five Fable 5.1 reviewers at max effort, PRs #29 to #50): the proof of a finding, failing before its fix.
// INTEG-3: FoxLeague's `competition_levels.competitive_daily_cap` is "0 = no cap" (backend/src/routes/config.rs:550-551,
// competition_levels.rs:36-37 "default 3, 0 = no cap"); the plan is told "at most 0 competitive matches a card a day".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderDigest } from '../../src/snapshot/digest.ts'
import { snapshot } from '../fixtures.ts'

test('INTEG-3: a competitive daily cap of 0 is no cap, never "at most 0 competitive matches"', () => {
  const s = snapshot()
  s.config!.competition_levels = {
    live: true, live_from: '2026-11-09T14:00:00Z', ranked_ticket_price_foxsy: 25,
    xp_factor_pct: { ranked: 25, bronze: 50, silver: 75, gold: 100 }, elo_k: { ranked: 5, bronze: 9, silver: 13, gold: 17 },
    private_bronze_earns: true, competitive_daily_cap: 0,
  }
  const text = renderDigest(s)
  assert.doesNotMatch(text, /at most 0 competitive matches/, text.split('\n').find(l => /Competition levels/.test(l)))
})
