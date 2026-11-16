// CHN-U4 (the CHAIN reviewer's unproven item 4): a fusion cooldown waiver can revert at a day boundary. The contract
// quotes the waivable days as ceil((readyAt - now - floor) / 86400) (player_nft.rs cooldown_waiver_quote) and takes
// exactly `days x price`: without `days` the quote of the block, with `days` only `days <= quoted days`
// (pay_fusion_cooldown_waiver: "Wrong waiver payment", "Cooldown waiver exceeds the floor"). The agent reads the quote
// right before it signs; when the quoted days drop by one between that read and the block, the call reverts and its gas
// is lost. Seconds a day, but every one of them is gas paid for nothing. Near the boundary the agent buys one day less,
// named, so the payment stays exact whichever side of the boundary the block lands.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkAction, type RulesContext } from '../../src/executor/rules.ts'
import { wholeToAtomic } from '../../src/util/encoding.ts'
import { TEST_SETTINGS, card, snapshot } from '../fixtures.ts'

const DAY = 86_400_000
const FLOOR_S = 259_200
const NOW = new Date()

/** A spare Common #101 in its fusion cooldown, ready `ms` after now, with the squad room a fusion needs. */
function cooling(ms: number) {
  const s = snapshot([
    card(101, 'MID', 'reserve', { fusionReadyAt: new Date(NOW.getTime() + ms).toISOString() }),
    card(102, 'DEF', 'reserve', { rarity: 'Uncommon', competitiveMatches: 8 }),
    card(103, 'DEF', 'reserve', { rarity: 'Uncommon', competitiveMatches: 15 }),
    card(104, 'MID', 'reserve', { rarity: 'Uncommon', competitiveMatches: 15 }),
  ])
  ;(s.config as Record<string, unknown>).fusion_cooldown_waiver_floor_seconds = FLOOR_S
  return s
}
/** The contract's quote at this moment: ceil((ready - now - floor) / 1 day) days at 75 FOXSY. */
const quoteFor = (ms: number) => {
  const days = Math.ceil((ms - FLOOR_S * 1000) / DAY)
  return { days, costAtomic: wholeToAtomic(75 * days) }
}
const ctx = (ms: number): RulesContext => ({ settings: { ...TEST_SETTINGS }, now: NOW, cooldownQuote: quoteFor(ms) })
const waive = (ms: number, days?: number) => checkAction({ type: 'fusion_cooldown_waiver', nonce: 101, ...(days ? { days } : {}) }, cooling(ms), ctx(ms))

test('CHN-U4 a minute before the quoted days drop by one, the waiver buys the days still there after it, named', () => {
  const ms = FLOOR_S * 1000 + 2 * DAY + 60_000 // the quote says 3 days for one more minute, then 2
  const v = waive(ms)
  assert.equal(v.ok, true, v.refusal)
  assert.equal(v.facts.days, 2, 'all 3 quoted days, unnamed: a block a minute later quotes 2 and the exact payment of 3 reverts')
  assert.equal(v.foxsy, wholeToAtomic(150))
  const named = waive(ms, 3)
  assert.equal(named.facts.days, 2, 'the 3 days named are more than the block a minute later quotes: "exceeds the floor"')
})

test('CHN-U4 control: far from the boundary the waiver is unchanged, and fewer days named are kept', () => {
  const ms = FLOOR_S * 1000 + 2 * DAY + 6 * 3600_000
  const v = waive(ms)
  assert.equal(v.ok, true, v.refusal)
  assert.equal(v.facts.days, undefined)
  assert.equal(v.foxsy, wholeToAtomic(225))
  assert.equal(waive(FLOOR_S * 1000 + 2 * DAY + 60_000, 1).facts.days, 1)
})

test('CHN-U4 a last waivable day about to end is not bought', () => {
  const v = waive(FLOOR_S * 1000 + 60_000)
  assert.equal(v.ok, false)
  assert.match(v.refusal ?? '', /minutes/)
})
