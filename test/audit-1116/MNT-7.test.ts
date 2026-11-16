// Audit 2026-11-16 (MAINNET): the proof of MNT-7, failing before its fix.
// The prompt's game notes still gave the rules of before the competition levels (live since Mon 9 Nov 2026 14:00 UTC
// and never going back) as the standing rules, and the levels as a condition "once live". FoxLeague fixed the same
// stale sentences in its own texts on mainnet (#740). Every plan read a ranked K, an XP rule and a Bronze rule that the
// live game settings contradict, and had to undo them from the snapshot line.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SYSTEM_PROMPT } from '../../src/strategist/prompt.ts'

/** The live game settings of 16 Nov 2026 11:50 UTC (GET /api/config `competition_levels`). */
const live = { competition_levels: { live: true, elo_k: { ranked: 5 }, xp_factor_pct: { ranked: 25 } } }

test('MNT-7 the K the instructions give for a ranked game is the one mainnet applies', () => {
  assert.equal(live.competition_levels.live, true)
  const stated = Number(/Ranked vs a real team moves ELO \(K (\d+)/.exec(SYSTEM_PROMPT)?.[1])
  // No number at all (the snapshot's line gives it) passes too: a number that differs from mainnet's does not.
  assert.ok(Number.isNaN(stated) || stated === live.competition_levels.elo_k.ranked, `the instructions say ranked moves ELO at K ${stated}; mainnet applies K ${live.competition_levels.elo_k.ranked}`)
})

test('MNT-7 the instructions do not say ranked gives no XP and Bronze is free (mainnet: ranked earns XP at its share, Bronze is paid and earns)', () => {
  assert.equal(live.competition_levels.xp_factor_pct.ranked > 0, true)
  assert.doesNotMatch(SYSTEM_PROMPT, /They give NO FOXSY and NO XP/)
  assert.doesNotMatch(SYSTEM_PROMPT, /Silver\/Gold tournaments and 1v1s are the only matches that give XP/)
  assert.doesNotMatch(SYSTEM_PROMPT, /Bronze tournaments: free, no pool, no XP, no ELO/)
})

test('MNT-7 the instructions state the levels as the standing rules, not as a condition "once live"', () => {
  for (const stale of [/until the competition levels (below )?are live/, /once the levels are live/, /until ranked costs a ticket/, /until they are, the notes above hold/]) {
    assert.doesNotMatch(SYSTEM_PROMPT, stale)
  }
  // The rules themselves stay, without their numbers (the snapshot's line gives them).
  assert.match(SYSTEM_PROMPT, /A ranked game you start costs a ticket/)
  assert.match(SYSTEM_PROMPT, /a match fee, not a shop purchase/)
  assert.match(SYSTEM_PROMPT, /A Bronze tournament has an entry fee and a prize pool like Silver/)
})
