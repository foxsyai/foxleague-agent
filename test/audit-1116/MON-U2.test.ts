// MON-U2 (the MONEY reviewer's unproven item 2): `transferLockEnd` gives an invalid Date for a `transferred_at` that is
// no time, and `playerView` then reads the agent's own card as out of its transfer lock (an invalid Date is never
// "after now"). The bid path already refuses such a card ("transfer time unreadable"); the agent's own squad did not:
// the card could be saved in an eleven, counted match-fit or put into a fusion although FoxLeague may still hold it.
// Rule 4: unknown is not "unlocked".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { playerView } from '../../src/snapshot/snapshot.ts'
import { checkAction } from '../../src/executor/rules.ts'
import type { PlayerCard } from '../../src/foxleague/types.ts'
import { TEST_SETTINGS, snapshot } from '../fixtures.ts'

const raw = (transferred_at: unknown): PlayerCard => {
  const stats = Object.fromEntries(['speed', 'accuracy', 'defense', 'power', 'control', 'vision', 'stamina'].flatMap(k => [[k, 20], [`${k}_synced`, 20], [`${k}_xp`, 0]]))
  return { id: 1, nft_nonce: 7, owner_address: 'erd1', name: 'P7', position: 'DEF', rarity: 'Common', level: 1, ...stats, condition: 100, stats_dirty: false, competitive_matches: 20, fusion_match_credit: 0, fusion_ready_at: null, listed_for_sale: false, transferred_at, transfer_cooldown_hours: null, minted_at: null, created_at: new Date().toISOString() } as unknown as PlayerCard
}

test('MON-U2 a card whose transfer time is no time is not read as out of its transfer lock', () => {
  const p = playerView(raw('not a time'), null, new Date())
  assert.notEqual(p.transferLockedUntil, null, 'an unreadable transfer time read as no lock')
})

test('MON-U2 such a card is not saved in an eleven', () => {
  const s = snapshot()
  const p = playerView(raw('2026-13-45T99:00:00Z'), null, new Date())
  s.players[1] = { ...s.players[1]!, transferLockedUntil: p.transferLockedUntil }
  const v = checkAction({ type: 'set_lineup', lineup: s.team!.lineup, substitutes: s.team!.substitutes } as never, s, { settings: { ...TEST_SETTINGS }, now: new Date() })
  assert.equal(v.ok, false, 'saved an eleven with a card whose transfer lock could not be read')
})

test('MON-U2 control: a card never moved and one whose lock has passed read as free, one still locked as locked', () => {
  assert.equal(playerView(raw(null), null, new Date()).transferLockedUntil, null)
  assert.equal(playerView(raw(new Date(Date.now() - 600 * 3600_000).toISOString()), null, new Date()).transferLockedUntil, null)
  assert.match(String(playerView(raw(new Date(Date.now() - 3600_000).toISOString()), null, new Date()).transferLockedUntil), /^\d{4}-/)
})
