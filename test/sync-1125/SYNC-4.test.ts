// SYNC-4: FoxLeague's manual of 23 Nov 2026 (main 681bf9cfb). The agents' manual check said on 24 and 25 Nov that three
// pages changed since the agents' copy (getting-started/players, mechanics/tournaments, mechanics/economy-map). All three
// change wording only: the tournament page's match card shows the lineup changes before kickoff as one line with a badge
// per team (a tap lists them) and the Shop's rate limit row says a payment kept for a re-check is signed but not
// confirmed yet. No rule, number, game setting key or route shape the agent uses changed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { API_RECORD_FILE } from '../../src/foxleague/api-routes.ts'
import { MANUAL_FILE, RECORD_FILE } from '../../src/strategist/manual-watch.ts'

test('SYNC4-1 the agents\' manual and the route record are FoxLeague\'s main of 23 Nov (681bf9cfb)', () => {
  const manual = readFileSync(MANUAL_FILE, 'utf8')
  assert.match(manual.split('\n', 3).join('\n'), / main at 681bf9cfb 2026-11-23\./)
  // The three changed pages, as FoxLeague words them now.
  assert.match(manual, /its card on the tournament page shows one line, \*\*Lineup changes before kickoff\*\*, where each side's name carries a small badge/)
  assert.match(manual, /a tap on \*\*Lineup changes before kickoff\*\* \(one line where each team's name carries a small badge/)
  assert.match(manual, /the shop says your payment is signed but not confirmed yet; press Pay Now again after a moment/)
  assert.doesNotMatch(manual, /the shop says "Not confirmed yet"/)
  // What stays: the rules of 21 Nov and the busy-card rule, still off.
  assert.match(manual, /A player that is in an auction cannot be trained/)
  assert.match(manual, /From a date still to be announced a player plays one match at a time/)
  const record = JSON.parse(readFileSync(RECORD_FILE, 'utf8')) as { synced: string; pages: Record<string, string> }
  assert.equal(record.synced, '681bf9cfb 2026-11-23')
  assert.equal(Object.keys(record.pages).length, 16)
  assert.equal(record.pages['legal/account-bans'], undefined, 'the bans page stays left out (SYNC-2)')
  const shapes = JSON.parse(readFileSync(API_RECORD_FILE, 'utf8')) as { synced: string; routes: Record<string, string | null> }
  assert.equal(shapes.synced, '681bf9cfb 2026-11-23')
  assert.equal(Object.keys(shapes.routes).length, 54)
})
