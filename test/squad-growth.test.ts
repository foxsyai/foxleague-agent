// Owner, 2026-10-22: an agent whose record favours the 4-3-3 family kept 4-4-2 because it has only two strong
// forwards (two Legendaries and three Commons), so the missing forward should be part of its upgrade plan. And no
// fixed number of cards should stop a team from holding spares to fuse, to grow or to sell.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SYSTEM_PROMPT } from '../src/strategist/prompt.ts'
import { STRATEGY_PRESETS } from '../src/store/settings.ts'

test('a formation the squad cannot field at strength makes the missing player part of the upgrade', () => {
  assert.match(SYSTEM_PROMPT, /count the missing player as part of the upgrade: a card of that position at a fair price \(a Rare often gives the most strength per FOXSY; a Legendary only when its price pays\) or a fusion into that position/)
  assert.match(SYSTEM_PROMPT, /until it arrives, test the formation in ranked with the best you have/)
})

test('cards have no upper limit, and a spare reaches its match gate only by playing', () => {
  assert.match(SYSTEM_PROMPT, /[Tt]here is no upper limit on cards/)
  assert.match(SYSTEM_PROMPT, /A card outside the eleven and bench plays no match, so it never moves toward its gate/)
})

test('no level sells by a fixed card count', () => {
  for (const [level, text] of Object.entries(STRATEGY_PRESETS)) assert.doesNotMatch(text, /more than 36|above 36/, level)
  // Every level holds spares and sells one when its price beats its use (one strategy core since 2026-11-06).
  for (const [level, text] of Object.entries(STRATEGY_PRESETS)) assert.match(text, /list spare cards when their price beats their use/, level)
})

// Agent review of PR #16 (low): the dashboard's help for the levels still said the old thing.
test('the dashboard tells the levels the same: every level sells spares by value, no card count', async () => {
  const { readFileSync } = await import('node:fs')
  const html = readFileSync(new URL('../src/web/dashboard.html', import.meta.url), 'utf8')
  assert.doesNotMatch(html, /above 36|more than 36/)
  assert.match(html, /Six levels, one brain: [^<]*sells a spare card when its price beats its use/)
})
