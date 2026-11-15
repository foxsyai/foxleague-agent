// Audit 2026-11-11 (Fable 5.2 reviewers at extra-high effort): the proof of INTEG-2, failing before its fix.
// INTEG-2: the plan is told an injury chance three times what FoxLeague runs.
// FoxLeague lowered the chance per called foul suffered to 1% at condition 100 rising to 3% at condition 30 (its #721,
// on origin/main: backend/src/card_injuries.rs:49-52 CHANCE_BP_AT_FULL_CONDITION = 100, CHANCE_BP_AT_CONDITION_FLOOR = 300;
// docs/manual/src/content/docs/getting-started/players.md:77 "The chance is **1%** at condition 100 and grows evenly to
// **3%** at condition 30"), made the numbers Admin settings and serves the ones in force in /api/config card_bans
// (backend/src/routes/config.rs:608-631: injury_chance_bp_full_condition, injury_chance_bp_condition_floor,
// injury_days_out). The live config of 2026-11-11 serves 100 / 300 / [3, 9, 27].
// The agent's prompt states "3 percent at condition 100 rising evenly to 9 percent at condition 30"
// (src/strategist/prompt.ts:38), its manual copy says 3% to 9% (src/strategist/manual.md:2123) and its digest gives no
// chance at all (src/snapshot/digest.ts:218-220: "the chance, the days out and medicine are in the prompt").
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SYSTEM_PROMPT } from '../../src/strategist/prompt.ts'
import { renderDigest } from '../../src/snapshot/digest.ts'
import { snapshot } from '../fixtures.ts'

// The card_bans block of FoxLeague's mainnet /api/config as read on 2026-11-11 (the reviewer's saved answer), word for word.
const live = { card_bans: { live: false, live_from: '2026-11-13T14:00:00Z', yellow_cards_per_ban: 3, injury_chance_bp_full_condition: 100, injury_chance_bp_condition_floor: 300, injury_days_out: [3, 9, 27] } }

test('INTEG-2: what the model reads about the injury chance is the chance FoxLeague runs (its /api/config card_bans)', () => {
  const s = snapshot()
  s.config!.card_bans = live.card_bans
  const told = SYSTEM_PROMPT + '\n' + renderDigest(s)
  const full = live.card_bans.injury_chance_bp_full_condition / 100 // 1 (percent at condition 100)
  const floor = live.card_bans.injury_chance_bp_condition_floor / 100 // 3 (percent at condition 30)
  assert.deepEqual([full, floor], [1, 3], "FoxLeague's live config of 2026-11-11")
  // The numbers of before FoxLeague's #721 must be gone from what the model reads.
  assert.doesNotMatch(told, /3 percent at condition 100/, 'the prompt still states the chance of before FoxLeague lowered it (3 percent at condition 100, 9 percent at condition 30)')
  // And the chance in force must be there, from the config.
  assert.match(told, new RegExp(`\\b${full}(\\.0)? ?(%|percent) at condition 100`), 'the chance FoxLeague serves (1 percent at condition 100) is nowhere in the prompt or the snapshot')
  assert.match(told, new RegExp(`\\b${floor}(\\.0)? ?(%|percent) at condition 30`), 'the chance FoxLeague serves at the floor (3 percent at condition 30) is nowhere in the prompt or the snapshot')
})

test('INTEG-2: the game manual copy does not state the chance of before FoxLeague lowered it', () => {
  const manual = readFileSync(new URL('../../src/strategist/manual.md', import.meta.url), 'utf8')
  assert.doesNotMatch(manual, /The chance is \*\*3%\*\* at condition 100 and grows evenly to \*\*9%\*\*/, "manual.md is FoxLeague's players page of before its #721: main says 1% to 3%")
})

// Added with the fix: the line gives the days too, another setting is told as served, and numbers that are missing are
// said to be unread, never printed as a value.
test('INTEG-2: the "Cards and injuries" line gives the chance and the days FoxLeague serves, whatever they are', () => {
  const s = snapshot()
  s.config!.card_bans = live.card_bans
  const line = (x: typeof s) => renderDigest(x).split('\n').find(l => l.startsWith('Cards and injuries:')) ?? ''
  assert.match(line(s), /one injury in a match keeps a card out 3 days, two 9, three or more 27/)
  s.config!.card_bans = { ...live.card_bans, injury_chance_bp_full_condition: 150, injury_chance_bp_condition_floor: 450, injury_days_out: [2, 6, 18] }
  assert.match(line(s), /1\.5 percent at condition 100, moving evenly to 4\.5 percent at condition 30 and below/)
  assert.match(line(s), /keeps a card out 2 days, two 6, three or more 18/)
  // An older answer without the numbers, or numbers that are no numbers: unread, said so.
  s.config!.card_bans = { live: false, live_from: '2026-11-13T14:00:00Z', yellow_cards_per_ban: 3 }
  assert.match(line(s), /the injury chance could not be read/)
  assert.match(line(s), /the days an injury keeps a card out could not be read/)
  s.config!.card_bans = { ...live.card_bans, injury_chance_bp_full_condition: Number.NaN, injury_days_out: [3, 9] }
  assert.match(line(s), /the injury chance could not be read/)
  assert.match(line(s), /the days an injury keeps a card out could not be read/)
})

test('INTEG-2: the prompt names no chance and no days of its own: it points at the line', () => {
  assert.match(SYSTEM_PROMPT, /at the chance the line gives/)
  assert.match(SYSTEM_PROMPT, /for the days the line gives/)
  assert.doesNotMatch(SYSTEM_PROMPT, /9 percent at condition 30/)
  assert.doesNotMatch(SYSTEM_PROMPT, /three times as likely/)
})
