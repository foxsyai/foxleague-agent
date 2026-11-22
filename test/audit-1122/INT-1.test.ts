// INT-1 (pre-release audit 2026-11-22, INTEGRATION): FoxLeague's own-session roster (GET /api/players/{address} with the
// session, roster_chain_view.rs compute_fresh / fetch_from_records AND NOT listed_for_sale) leaves OUT every card the
// marketplace contract holds. The saved 18 (GET /api/teams/{address}) still name it. So the agent's roster never shows
// a card with listed_for_sale: true (only FoxLeague's fallback does), and the MNT-4 line "LISTED IN YOUR 18" never fires
// for a card the owner put in an auction. The executor refuses every match, entry and 1v1 ("#15 in the squad is not in
// the wallet"), so nothing is paid wrongly, but the plan was never told to save a new 18, and the next locked tournament
// or 1v1 match was forfeited 3-0 (manual: "a card of your saved 18 that is not in your wallet at a match's lock (in an
// auction, sold or sent away) makes your squad short, so that match is forfeited 3-0").
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderDigest } from '../../src/snapshot/digest.ts'
import { snapshot, withFixture } from '../fixtures.ts'

const line = (text: string, n: number): string => text.split('\n').find(l => new RegExp(`#${n}\\b`).test(l) && /forfeit/i.test(l) && /3-0/.test(l)) ?? ''

test('INT-1 a bench card of the saved 18 left out of the roster (in an auction, sold or sent) is named in capitals with the forfeit', () => {
  const s = withFixture(snapshot())
  // The owner listed bench card #15 in FoxLeague's app: the roster leaves it out, the saved 18 still name it.
  s.players = s.players.filter(p => p.nonce !== 15)
  assert.ok(s.team!.substitutes.includes(15))
  const found = line(renderDigest(s), 15)
  assert.ok(found, 'the plan is not told that its next locked match is forfeited unless #15 is replaced')
  assert.match(found, /^[A-Z0-9 ,]{6,}:/, `the line must open in capitals: ${found}`)
  assert.match(found, /save[^\n]*an 18 without it/, `the line must say to save an 18 without it: ${found}`)
})

test('INT-1 a starter of the saved 18 left out of the roster is named too, not only as a lineup that does not fit', () => {
  const s = withFixture(snapshot())
  s.players = s.players.filter(p => p.nonce !== 4)
  assert.ok(line(renderDigest(s), 4), 'a missing starter got only "LINEUP DOES NOT FIT (#4 is not in the wallet)"')
})

test('INT-1 two cards missing: one line names both', () => {
  const s = withFixture(snapshot())
  s.players = s.players.filter(p => p.nonce !== 4 && p.nonce !== 16)
  const text = renderDigest(s)
  const both = text.split('\n').filter(l => /#4\b/.test(l) && /#16\b/.test(l) && /forfeit/i.test(l))
  assert.equal(both.length, 1, text)
  assert.match(both[0]!, /without them/)
})

test('INT-1 an unread roster says nothing as if known (rule 4): no card is called missing', () => {
  const s = withFixture(snapshot())
  // attempt() leaves the roster empty with a warning when GET /api/players fails.
  s.players = []
  s.warnings = ['players: FoxLeague 503']
  assert.doesNotMatch(renderDigest(s), /3-0[^\n]*#1\b|#1\b[^\n]*3-0|NOT IN YOUR ROSTER/i)
})

test('INT-1 control: every card of the saved 18 in the roster, no such line', () => {
  const s = withFixture(snapshot())
  assert.doesNotMatch(renderDigest(s), /NOT IN YOUR ROSTER/i)
})
