// R2T-7 (P-W7): the pause reads the pages from a row of its own (kv `manual_behind`), which only a check made by this
// version writes. The version before (955664a, on the owner's server now) stores the day's check without it, and a copy
// found behind is not checked again that day. So on the day this version arrives while the copy is behind (the same
// manual.md and page record: this change does not touch them), the notice names the changed pages, the owner chooses
// "also pause the actions whose rules changed", the dashboard shows the choice as on, and nothing is paused until the
// next morning's check. The stored check of the same copy says which pages are behind: the pause must hold them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { heldActions, holdRefusal } from '../../src/executor/hold.ts'
import { AT_0700, HOUR, mcp, memoryKv, watch } from './watch-helpers.ts'

test('R2T-7 the pause holds the pages of the day\'s stored check when the version before made it (no manual_behind row yet)', async () => {
  const server = mcp()
  server.state.pages['mechanics/shop'] = 'A Common pack costs 9,000 FOXSY, at most 1 per wallet per rolling 7 days.'
  const kv = memoryKv()
  // The morning's check, as 955664a leaves it: the `manual_check` row (the same fields), and no row of P-W7 or MID-1.
  assert.equal((await watch(server, { kv }).today(AT_0700))?.state, 'behind')
  kv.m.delete('manual_behind')
  kv.m.delete('manual_texts')
  assert.equal(JSON.parse(kv.m.get('manual_check')!).state, 'behind')

  // The update at 10:00: the same copy, this version. The owner reads the notice and turns the pause on.
  const w = watch(server, { kv })
  assert.match(w.view(AT_0700 + 3 * HOUR).text ?? '', /manual changed since the agents' copy \(pages: mechanics\/shop\)/, 'the dashboard says the copy is behind on the Shop page')
  w.setHold(true)
  // Added by the fix: the pause holds at once, from the stored check, not only after the next look made a row of its own.
  assert.deepEqual(w.held(), ['mechanics/shop'], 'the pause is on and the stored check of this copy is behind on the Shop page')
  assert.match(holdRefusal({ type: 'buy', product: 'common_pack' }, w.held()) ?? '', /paused by the owner's choice/)
  // The hourly looks of the rest of the day.
  for (let h = 3; h <= 12; h++) await w.today(AT_0700 + h * HOUR)
  assert.equal(w.holdOn(), true)
  assert.deepEqual(heldActions(w.held()), ['buy'], 'the pause is on and the copy is behind on the Shop page, yet nothing is held')
  assert.match(holdRefusal({ type: 'buy', product: 'common_pack' }, w.held()) ?? '', /paused by the owner's choice/)
})
