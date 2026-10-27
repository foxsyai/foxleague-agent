// Owner, 2026-10-23: an agent holding 199 EGLD wrote "the wallet holds about 770 FOXSY, so no entries, bids or
// recovery are possible": it judged what it could afford on its FOXSY alone, although the EGLD above its gas reserve
// swaps into FOXSY within its limits. (The one-challenger-per-rival rule of the same day was removed on 2026-10-27:
// test/agents-alone.test.ts.)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderPlanRequest } from '../src/strategist/strategist.ts'
import { SYSTEM_PROMPT } from '../src/strategist/prompt.ts'
import { budgetView } from '../src/executor/budget.ts'
import { DEFAULT_SETTINGS } from '../src/store/settings.ts'
import { wholeToAtomic } from '../src/util/encoding.ts'
import { setup, snapshot } from './fixtures.ts'

// ---- buying power ----

test('the plan sees its buying power: the FOXSY held plus what the EGLD above the gas reserve swaps into', () => {
  const store = setup().store
  const s = snapshot()
  s.chain!.egld = wholeToAtomic(200)
  s.chain!.foxsy = wholeToAtomic(2270)
  const settings = { ...DEFAULT_SETTINGS, egldGasReserve: '1', maxSwapFoxsy: 50_000, dailyCapUsd: 150 }
  const text = renderPlanRequest({ snapshot: s, settings, budget: budgetView(store, 0, settings, true, new Date()), recent: [], dryRun: true })
  // 199 EGLD above the reserve at 0.0005 EGLD a FOXSY, held to the $150 the daily swap allowance lets through at
  // $0.00225 a FOXSY (audit A3/B3); $150 left today in the daily cap.
  assert.match(text, /Buying power: 2,270 FOXSY held plus about 66,666 FOXSY from the 199 EGLD above the gas reserve, as much as the swap allowances still let through \(the EGLD alone would give about 398,000\); swapped so far \$0\.00 of \$150\.00 today, \$0\.00 of \$150\.00 this month; one swap at most 50,000 FOXSY, and today's \$150\.00 left in the daily cap spends about 66,667 FOXSY\. Judge what you can afford on both, never on the FOXSY alone\./)
  // Where the EGLD is what binds, the line says only what it swaps into.
  s.chain!.egld = wholeToAtomic(2)
  assert.match(renderPlanRequest({ snapshot: s, settings, budget: budgetView(store, 0, settings, true, new Date()), recent: [], dryRun: true }), /plus about 2,000 FOXSY from the 1 EGLD above the gas reserve; swapped so far/)
  const blind = snapshot()
  blind.prices = null
  assert.match(renderPlanRequest({ snapshot: blind, settings, budget: budgetView(store, 0, settings, true, new Date()), recent: [], dryRun: true }), /Buying power: \d[\d,]* FOXSY held; what the EGLD swaps into is unknown \(no price\)/)
})

// Agent review of PR #19 (low): while xExchange has paused the pair every swap is refused, so nothing comes from EGLD.
test('while xExchange has paused the pair, the buying power is the FOXSY held', () => {
  const store = setup().store
  const s = snapshot()
  s.prices = { ...s.prices!, frozen: true }
  const text = renderPlanRequest({ snapshot: s, settings: DEFAULT_SETTINGS, budget: budgetView(store, 0, DEFAULT_SETTINGS, true, new Date()), recent: [], dryRun: true })
  assert.match(text, /Buying power: [\d,]+ FOXSY held; no swap is possible while xExchange has paused the FOXSY pair, so the FOXSY held is all there is/)
})

test('the prompt says EGLD above the reserve is buying power, swapped earlier in the same plan when an action needs it', () => {
  assert.match(SYSTEM_PROMPT, /never call something unaffordable on the FOXSY alone/)
  assert.match(SYSTEM_PROMPT, /swap for it earlier in the same plan/)
})
