// HOURS-2 (the owner's check of 2026-11-27; HOURS-1 is the default hours of 2026-11-22): a routine plan runs only inside the owner's active hours (06:00 to 22:00 UTC on
// the owner's agents), but no plan was told which they are; the instructions only say "You plan only inside the
// owner's active hours". On 25 Nov at 06:01 UTC agent 5 (Haiku 5.5) guessed that they had ended at 22:00 and began
// again at the game day's reset (14:00 UTC), planned nothing from 06:00 to 14:00 UTC and carried the guess forward
// from each plan to the next: 14 empty plans over three mornings, while the other agents played. Every plan's request
// now says the hours and, from the snapshot's own time, whether this plan runs inside them. The cached instructions
// stay as they are.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderPlanRequest } from '../../src/strategist/strategist.ts'
import { SYSTEM_PROMPT } from '../../src/strategist/prompt.ts'
import { budgetView } from '../../src/executor/budget.ts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, type AgentSettings } from '../../src/store/settings.ts'
import { setup, snapshot } from '../fixtures.ts'

function request(at: string, hours: [number, number], ownerRequest?: string): string {
  const store = setup().store
  const s = snapshot()
  s.takenAt = at
  const settings: AgentSettings = { ...DEFAULT_SETTINGS, activeHoursUtc: hours }
  return renderPlanRequest({ snapshot: s, settings, budget: budgetView(store, 0, settings, true, new Date(at)), recent: [], dryRun: true, ...(ownerRequest ? { ownerRequest } : {}) })
}

test('HOURS2-1 a plan is told the owner\'s active hours and that it runs inside them, apart from the game day\'s reset', () => {
  const text = request('2026-11-27T10:45:00.000Z', [6, 22])
  assert.match(text, /\n## Active hours\nThe owner's active hours for this agent: 06:00 to 22:00 UTC\. It is 10:45 UTC, inside them: the actions of this plan run now\./)
  assert.match(text, /Plans and their actions run only inside these hours; they end at 22:00 UTC and an action that has not run by then waits for the next day's plans\. The game day's reset in the snapshot is FoxLeague's, not the start or the end of these hours\./)
  // Said before the snapshot, in the request; the cached instructions are unchanged.
  assert.ok(text.indexOf('## Active hours') < text.indexOf('<<<SNAPSHOT'))
  assert.doesNotMatch(SYSTEM_PROMPT, /## Active hours|06:00 to 22:00/)
})

test('HOURS2-2 the first minute and the last hour of the window are inside it, the hour it ends at is not', () => {
  assert.match(request('2026-11-27T06:01:57.174Z', [6, 22]), /It is 06:01 UTC, inside them/)
  assert.match(request('2026-11-27T21:59:00.000Z', [6, 22]), /It is 21:59 UTC, inside them/)
  assert.match(request('2026-11-27T22:00:00.000Z', [6, 22]), /It is 22:00 UTC, outside them/)
})

test('HOURS2-3 hours across midnight, to midnight and an owner\'s request outside the hours', () => {
  assert.match(request('2026-11-27T23:30:00.000Z', [22, 6]), /active hours for this agent: 22:00 to 06:00 UTC \(across midnight\)\. It is 23:30 UTC, inside them/)
  assert.match(request('2026-11-27T05:10:00.000Z', [22, 6]), /It is 05:10 UTC, inside them/)
  assert.match(request('2026-11-27T23:10:00.000Z', [6, 24]), /active hours for this agent: 06:00 to 24:00 UTC\. It is 23:10 UTC, inside them/)
  // The owner's one-off request (Telegram /do) may run outside the hours, and its actions run then too.
  assert.match(request('2026-11-27T12:00:00.000Z', [22, 6], 'sync the squad'), /It is 12:00 UTC, outside them, but this plan answers the owner's one-off request: its actions run now\./)
})

// R103A-1 (medium, the agent review of PR #103): an all-day window [0, 24] was told "they end at 24:00 UTC and an
// action that has not run by then waits for the next day's plans", a limit the service never applies to it.
test('R103A-1 an all-day window is told as all day: no end hour, nothing waits for the next day', () => {
  const text = request('2026-11-27T23:40:00.000Z', [0, 24])
  assert.match(text, /\n## Active hours\nThe owner's active hours for this agent: all day \(00:00 to 24:00 UTC\): plans run at any hour and their actions never stop on the hours\. The game day's reset in the snapshot is FoxLeague's, not a limit of these hours\./)
  assert.doesNotMatch(text, /they end at|waits for the next day's plans|outside them/)
})

// R103A-2 (low, the agent review of PR #103): a plan made outside the hours by hand (`cli plan N`, `cli dry-run N`) or
// a tick let in just before the end hour was told only "outside them", so the model would most likely plan nothing.
test('R103A-2 a routine plan outside the hours is told to plan as usual: the service decides when its actions run', () => {
  assert.match(request('2026-11-27T22:00:00.000Z', [6, 22]), /It is 22:00 UTC, outside them: plan as you would inside them; the service decides when the actions run\./)
})

// R103A-3 (low, the agent review of PR #103): the finding first took the id HOURS-1, which names the default hours of
// 2026-11-22; the new function stood between DEFAULT_SETTINGS and its doc comment.
test('R103A-3 the record keeps HOURS-1 for the default hours and HOURS-2 for this; DEFAULT_SETTINGS keeps its comment', () => {
  const root = join(import.meta.dirname, '../..')
  const record = readFileSync(join(root, 'docs/SECURITY-REVIEW.md'), 'utf8')
  assert.equal(record.match(/^\| HOURS-1 \|/gm)?.length, 1)
  assert.equal(record.match(/^\| HOURS-2 \|/gm)?.length, 1)
  assert.match(readFileSync(join(root, 'src/store/settings.ts'), 'utf8'), /actions, every planned action carried out\.\n \*\/\nexport const DEFAULT_SETTINGS: AgentSettings = \{/)
})
