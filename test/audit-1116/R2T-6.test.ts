// R2T-6 (P-W3, the owner's Telegram): "a switch the agents have no rule for is told once". The once is keyed by the
// switch's key AND its `live_from`, with no pause between two tells (the settings keys have one of 6 hours) and a
// memory of the newest 64 tells only. Every snapshot of every agent passes its game settings to observeConfig. So
// settings whose switch time moves from one answer to the next send one urgent Telegram line a snapshot, for good; and
// settings with more than 64 such switches send all of them again with every snapshot (the list forgets the oldest
// before the loop comes back to it). FoxLeague's server alone decides both.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AT_0700, HOUR, MIN, liveConfig, mcp, watch } from './watch-helpers.ts'

const DAY = 86_400_000
const at = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z')

test('R2T-6 a switch whose live_from moves with every answer is not told to the owner with every snapshot', async () => {
  const w = watch(mcp())
  await w.observeConfig(liveConfig(), AT_0700)
  // Thirty snapshots in half an hour (ten agents plan and act): the same unknown switch, its time a second later each read.
  for (let i = 0; i < 30; i++) await w.observeConfig({ ...liveConfig(), some_new_rule: { live: false, live_from: at(AT_0700 + 2 * DAY + i * 1000), per_day: 3 } }, AT_0700 + i * MIN)
  const told = w.told.filter(t => /rule switch the agents do not know yet: some_new_rule/.test(t))
  assert.ok(told.length <= 2, `the owner got ${told.length} urgent Telegram lines about one switch in 30 minutes`)
})

test('R2T-6 more unknown switches than the memory of tells holds are not all told again by the next snapshot', async () => {
  const w = watch(mcp())
  const many = { ...liveConfig(), ...Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`new_rule_${i}`, { live: false, live_from: at(AT_0700 + 2 * DAY) }])) }
  await w.observeConfig(many, AT_0700)
  const first = w.told.filter(t => /rule switch the agents do not know yet/.test(t)).length
  await w.observeConfig(many, AT_0700 + MIN)
  const again = w.told.filter(t => /rule switch the agents do not know yet/.test(t)).length - first
  assert.equal(again, 0, `the very same settings a minute later: ${again} more urgent Telegram lines (after ${first} the first time)`)
  assert.ok(first <= 8, `one snapshot sent ${first} urgent Telegram lines: the lines about pages, keys and routes name at most 8 and count the rest`)
})

// Added by the fix: one line for many switches, and a new switch is told after the pause, a told one not again.
test('R2T-6 many switches make one line that names eight and counts the rest; a new switch waits for the pause, a told one is not told again', async () => {
  const w = watch(mcp())
  const many = { ...liveConfig(), ...Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`new_rule_${String(i).padStart(2, '0')}`, { live: false, live_from: at(AT_0700 + 2 * DAY) }])) }
  await w.observeConfig(many, AT_0700)
  const lines = w.told.filter(t => /rule switch the agents do not know yet/.test(t))
  assert.equal(lines.length, 1)
  assert.match(lines[0]!, /more than one rule switch the agents do not know yet: new_rule_00 \(live from \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\), .*new_rule_07 \(live from [^)]*\) and 62 more\. /)
  assert.doesNotMatch(lines[0]!, /new_rule_08|—/)
  // A new switch an hour later waits for the 6-hour pause; then it alone is told.
  const more = { ...many, brand_new_rule: { live: false, live_from: at(AT_0700 + 2 * DAY) } }
  await w.observeConfig(more, AT_0700 + HOUR)
  assert.equal(w.told.filter(t => /rule switch the agents do not know yet: .*brand_new_rule/.test(t)).length, 0)
  await w.observeConfig(more, AT_0700 + 6 * HOUR + MIN)
  const late = w.told.filter(t => /rule switch the agents do not know yet/.test(t))
  assert.equal(late.length, 2)
  assert.match(late[1]!, /a rule switch the agents do not know yet: brand_new_rule, live from /)
  // A day later, its time moved: none of them is told again.
  await w.observeConfig({ ...more, brand_new_rule: { live: false, live_from: at(AT_0700 + 3 * DAY) } }, AT_0700 + DAY)
  assert.equal(w.told.filter(t => /rule switch the agents do not know yet/.test(t)).length, 2)
})
