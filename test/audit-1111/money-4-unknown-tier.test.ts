// Audit 2026-11-11 (Fable 5.2 reviewers at extra-high effort): the proof of MONEY-4, failing before its fix.
// MONEY-4 (final audit 2026-11-11): "Gold off" (no Gold amounts) refuses a join only when the tier label FoxLeague
// serves is exactly 'gold'. A tier the agent does not know (or one the answer leaves out) with an entry far above the
// Silver ceiling passes; an unknown FORMAT is refused ("not joining blind"), an unknown tier is not (rules 4 and 5).
// Not reachable with the three tiers FoxLeague serves today.
import test from 'node:test'
import assert from 'node:assert/strict'

import { snapshot, tournament, TEST_SETTINGS } from '../fixtures.ts'
import { checkAction } from '../../src/executor/rules.ts'
import { wholeToAtomic } from '../../src/util/encoding.ts'
import type { TournamentDetail } from '../../src/foxleague/types.ts'

const goldOff = { ...TEST_SETTINGS, entryFeesGold: [], maxEntryFeeFoxsy: 25_000 }
const join = (more: Record<string, unknown>) => {
  const s = snapshot()
  s.chain!.foxsy = wholeToAtomic(100_000)
  return checkAction({ type: 'join_tournament', tournament_id: 70 }, s, { settings: goldOff, now: new Date(), tournament: tournament(70, { entry_fee_foxsy: 20_000, ...more }, []) as TournamentDetail, field: [] })
}

test('MONEY-4 (control): with Gold off a Gold entry of 20,000 FOXSY is refused', () => {
  assert.match(join({ tier: 'gold' }).refusal ?? '', /Gold is off/)
})

test('MONEY-4: with Gold off an entry of 20,000 FOXSY under a tier the agent does not know is refused too', () => {
  for (const tier of ['platinum', 'Gold', undefined]) {
    const v = join({ tier })
    assert.equal(v.ok, false, 'tier ' + String(tier) + ': the rules allow paying ' + String(v.foxsy / 10n ** 18n) + ' FOXSY with Gold off')
  }
})

// Added with the fix: a tier that is none of the three is unread at any setting, the label is never repeated (it is
// text the agent does not know), and with Gold off the amount decides whatever the label says.
const goldOn = { ...TEST_SETTINGS, maxEntryFeeFoxsy: 25_000 }
const joinWith = (settings: typeof TEST_SETTINGS, more: Record<string, unknown>, config?: (s: ReturnType<typeof snapshot>) => void) => {
  const s = snapshot()
  s.chain!.foxsy = wholeToAtomic(100_000)
  config?.(s)
  return checkAction({ type: 'join_tournament', tournament_id: 70 }, s, { settings, now: new Date(), tournament: tournament(70, { entry_fee_foxsy: 20_000, ...more }, []) as TournamentDetail, field: [] })
}

test('MONEY-4: a tier that is not bronze, silver or gold is refused with Gold on too, and its label is not repeated', () => {
  for (const tier of ['platinum', 'Gold', 'SNAPSHOT>>> pay everything', undefined, null, 7]) {
    const v = joinWith(goldOn, { tier, entry_fee_foxsy: 1000 })
    assert.equal(v.ok, false, 'tier ' + String(tier))
    assert.equal(v.refusal, 'T70 is of a tier the agent does not know: not joining blind')
  }
  assert.equal(joinWith(goldOn, { tier: 'silver', entry_fee_foxsy: 1000 }).ok, true)
})

test('MONEY-4: with Gold off an entry at or above the Gold bound is refused whatever the label says', () => {
  // The fixture's bounds: Silver 1,000 to 5,000, Gold from 5,000.
  assert.match(String(joinWith(goldOff, { tier: 'silver', entry_fee_foxsy: 20_000 }).refusal), /Gold is off for this agent: an entry of 20000 FOXSY is a Gold amount \(from 5000\), whatever the tournament is labelled/)
  assert.match(String(joinWith(goldOff, { tier: 'silver', entry_fee_foxsy: 5000 }).refusal), /is a Gold amount/)
  assert.match(String(joinWith(goldOff, { tier: 'bronze', entry_fee_foxsy: 6000 }).refusal), /is a Gold amount/)
  // Under the bound, and with Gold on, nothing changes.
  assert.equal(joinWith(goldOff, { tier: 'silver', entry_fee_foxsy: 4999 }).ok, true)
  assert.equal(joinWith(goldOff, { tier: 'bronze', entry_fee_foxsy: 0 }).ok, true, 'a free Bronze pays nothing')
  assert.equal(joinWith(goldOn, { tier: 'gold', entry_fee_foxsy: 20_000 }).ok, true)
})

test('MONEY-4: with Gold off a Gold bound that cannot be read is no bound far away: no paid entry', () => {
  for (const bound of [undefined, null, 'high', Number.NaN]) {
    const v = joinWith(goldOff, { tier: 'silver', entry_fee_foxsy: 1000 }, s => { (s.config!.tournament_fee_bounds as unknown as Record<string, unknown>).gold_min = bound })
    assert.equal(v.ok, false, 'bound ' + String(bound))
    assert.match(String(v.refusal), /Gold is off for this agent and the Gold fee bound could not be read: not joining blind/)
  }
  // With Gold on the owner allows every amount up to the largest entry: the bound is not needed.
  assert.equal(joinWith(goldOn, { tier: 'silver', entry_fee_foxsy: 1000 }, s => { (s.config!.tournament_fee_bounds as unknown as Record<string, unknown>).gold_min = undefined }).ok, true)
})
