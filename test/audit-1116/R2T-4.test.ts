// R2T-4 (MID-1 with MNT-5 and P-W7): "one found behind stays so for the day" was right for a notice. Since MID-1 the
// plans read the stored text under the words "as FoxLeague serves it now", and since P-W7 the owner's pause holds the
// pages of that stored check. A copy already behind in the morning (the usual state between a FoxLeague deploy and the
// maintainer's sync) is not looked at again that day: what FoxLeague changes after the first check of the day (on
// 16 Nov it deployed at 09:48, after the 07:00 check) reaches no plan, and its pages are not paused, until the next
// morning. The hourly looks through the day must bring it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { changedPagesBlock } from '../../src/strategist/page-text.ts'
import { AT_0700, HOUR, mcp, watch } from './watch-helpers.ts'

test('R2T-4 while behind, the hourly looks bring the plans the text FoxLeague serves now, not the text of the first check of the day', async () => {
  const server = mcp()
  // 07:00: FoxLeague fixed a word on the matches page. The copy is behind from here on.
  server.state.pages['mechanics/matches'] = 'Ranked moves ELO a little.'
  const w = watch(server)
  assert.equal((await w.today(AT_0700))?.state, 'behind')
  assert.match(changedPagesBlock(w.planPages()), /Ranked moves ELO a little/)
  // 09:48: FoxLeague deploys new Shop rules.
  server.state.pages['mechanics/shop'] = 'A Common pack costs 9,000 FOXSY, at most 1 per wallet per rolling 7 days.'
  // The service looks every hour until the evening.
  for (let h = 1; h <= 12; h++) await w.today(AT_0700 + h * HOUR)
  const block = changedPagesBlock(w.planPages())
  assert.match(block, /9,000 FOXSY/, 'twelve hourly looks after FoxLeague changed its Shop page, the plans still read only the morning\'s text')
})

test('R2T-4 while behind with the pause on, a page FoxLeague changes later that day is paused within the hour', async () => {
  const server = mcp()
  server.state.pages['mechanics/matches'] = 'Ranked moves ELO a little.'
  const w = watch(server)
  w.setHold(true)
  await w.today(AT_0700)
  assert.deepEqual(w.held(), ['mechanics/matches'])
  server.state.pages['mechanics/shop'] = 'A Common pack costs 9,000 FOXSY, at most 1 per wallet per rolling 7 days.'
  for (let h = 1; h <= 12; h++) await w.today(AT_0700 + h * HOUR)
  assert.ok(w.held().includes('mechanics/shop'), `the owner chose to pause the actions of a changed page, and buy still runs on the old Shop rules: held ${JSON.stringify(w.held())}`)
})

// Added by the fix: the owner's line once per set of changed pages, and a recheck that cannot tell takes nothing away.
test('R2T-4 the hourly looks while behind tell the owner once per set of changed pages', async () => {
  const server = mcp()
  server.state.pages['mechanics/matches'] = 'Ranked moves ELO a little.'
  const w = watch(server)
  await w.today(AT_0700)
  for (let h = 1; h <= 3; h++) await w.today(AT_0700 + h * HOUR)
  assert.equal(w.told.filter(t => /manual changed/.test(t)).length, 1, w.told.join('\n'))
  server.state.pages['mechanics/matches'] = 'Ranked moves ELO a little more.'
  await w.today(AT_0700 + 4 * HOUR)
  assert.equal(w.told.filter(t => /manual changed/.test(t)).length, 1, 'the same page changed again: no new line')
  assert.match(changedPagesBlock(w.planPages()), /a little more/)
  server.state.pages['mechanics/shop'] = 'A Common pack costs 9,000 FOXSY.'
  await w.today(AT_0700 + 5 * HOUR)
  const lines = w.told.filter(t => /manual changed/.test(t))
  assert.equal(lines.length, 2)
  assert.match(lines[1]!, /\(pages: mechanics\/matches, mechanics\/shop\)/)
})

test('R2T-4 a recheck that cannot reach FoxLeague keeps the behind check, its text and the pause, up to 4 tries in a row', async () => {
  const server = mcp()
  server.state.pages['mechanics/shop'] = 'A Common pack costs 9,000 FOXSY.'
  const w = watch(server)
  w.setHold(true)
  assert.equal((await w.today(AT_0700))?.state, 'behind')
  server.state.down = true
  const asked = server.state.asked
  for (let h = 1; h <= 6; h++) {
    assert.equal((await w.today(AT_0700 + h * HOUR))?.state, 'behind', `at ${7 + h}:00`)
    assert.match(changedPagesBlock(w.planPages()), /9,000 FOXSY/)
    assert.deepEqual(w.planNote()?.pages, ['mechanics/shop'])
    assert.deepEqual(w.held(), ['mechanics/shop'])
  }
  assert.equal(server.state.asked - asked, 4, 'four tries in a row that could not tell, then none more that day')
  assert.match(w.view(AT_0700 + 6 * HOUR).text ?? '', /manual changed since the agents' copy \(pages: mechanics\/shop\)/)
  // FoxLeague back: the next day's check.
  server.state.down = false
  assert.equal((await w.today(AT_0700 + 24 * HOUR))?.state, 'behind')
})
