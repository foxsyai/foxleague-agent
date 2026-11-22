// MNT-4: rules FoxLeague changed on mainnet on 16 Nov (729164194) that the agents' game knowledge still states the old
// way. The manual copy (src/strategist/manual.md, synced at 9ebcbc52d) goes into every plan as the rules "as the
// platform runs them"; the prompt and the snapshot repeat two of them.
//  a) #747: a card in an auction is held by the contract, so one of the saved 18 in an auction at a lock FORFEITS the
//     match 3-0 (and since 13 Nov a forfeit costs the full K of the level). Before: "a listed starter is replaced by a
//     fit substitute ... a listing alone never forfeits a match".
//  b) #757: the Common pack counts 2 a wallet a WEEK FROM MONDAY 14:00 UTC, not a rolling 7 days; the shop status
//     serves when the week starts again (common_pack_week_resets_at).
//  c) #757: the interests a manager sends count the game day from 14:00 UTC, not the UTC day.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderDigest } from '../../src/snapshot/digest.ts'
import { SYSTEM_PROMPT } from '../../src/strategist/prompt.ts'
import { snapshot, withFixture } from '../fixtures.ts'

const manual = readFileSync(new URL('../../src/strategist/manual.md', import.meta.url), 'utf8')

test('MNT-4a the manual copy no longer says a listed card of the 18 is replaced at the lock (mainnet forfeits the match 3-0)', () => {
  assert.doesNotMatch(manual, /a listing alone never forfeits a match/)
  assert.doesNotMatch(manual, /In a tournament the lock does it for you: a starter sold to another wallet or listed for sale is replaced by a fit substitute/)
})

test('MNT-4a the snapshot says in capitals that a card of the saved 18 in an auction forfeits the next locked match', () => {
  const s = withFixture(snapshot())
  // The owner listed a starter in FoxLeague's app (the agent itself lists no card of its 18): the contract holds it, and
  // FoxLeague's own-session roster leaves it out (pre-release audit 2026-11-22, INT-1); the saved 18 still name it.
  s.players = s.players.filter(p => p.nonce !== 4)
  const text = renderDigest(s)
  assert.match(text, /NOT IN YOUR ROSTER: #4\b[^\n]*auction[^\n]*(forfeit|3-0)/, 'the plan is not told the T60 match in 2 h is forfeited unless #4 is replaced')
  // FoxLeague's fallback roster (its record copy) still carries the card with listed_for_sale: true: said the same way.
  const fallback = withFixture(snapshot())
  fallback.players.find(p => p.nonce === 4)!.listed = true
  assert.match(renderDigest(fallback), /LISTED[^\n]*(forfeit|3-0)/i, 'only the squad line\'s LISTED tag: the plan is not told the T60 match in 2 h is forfeited unless #4 is replaced')
})

test('MNT-4b the Common pack week: from Monday 14:00 UTC, in the manual copy and in the instructions', () => {
  assert.doesNotMatch(manual, /per wallet per rolling 7 days/)
  assert.doesNotMatch(SYSTEM_PROMPT, /at most 2 per 7 days/)
})

test('MNT-4b the snapshot says when the pack week starts again (FoxLeague serves common_pack_week_resets_at)', () => {
  const s = snapshot()
  Object.assign(s.auth!.shop as object, { common_pack_remaining_this_week: 0, common_pack_week_resets_at: '2026-11-23T14:00:00Z' })
  assert.match(renderDigest(s), /Common packs left this week[^\n]*2026-11-23T14:00/)
})

test('MNT-4c the manual copy gives the interests a day from 14:00 UTC', () => {
  assert.doesNotMatch(manual, /5 players a day\*\* \(UTC\)/)
})
