// R2M-2 (low, gas): CHN-U4 moves the waiver one day down only while the agent's own clock still sees the drop AHEAD
// (rules.ts waiverDayDropsInMs: it answers null when ceil((readyAt - now - floor) / 1 day) is not the quoted days, and
// then "nothing is moved"). The quote is the contract's view at the timestamp of the last block the gateway holds, which
// is behind the agent's clock (a round, more behind a lagging observer). So in the seconds right AFTER the drop the
// agent holds a quote of N days while its own clock already counts N-1: waiverDayDropsInMs answers null, the waiver is
// signed for all N quoted days with no `days` argument, and the block that takes it (later still) quotes N-1:
// "Wrong waiver payment", reverted, the gas lost. That is the very case CHN-U4 names, one side of the drop left open.
// Right: when the agent's own clock says the quoted days have already dropped by one, the waiver must not be signed for
// the stale N (N-1 named works on the chain, or a refusal that waits for a fresh quote).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkAction, type RulesContext } from '../../src/executor/rules.ts'
import { wholeToAtomic } from '../../src/util/encoding.ts'
import { TEST_SETTINGS, card, snapshot } from '../fixtures.ts'

const DAY = 86_400_000
const FLOOR_S = 259_200
const NOW = new Date()

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

test('R2M-2 a quote of 3 days read from a block a few seconds old, 3 s after the drop to 2 by the clock: never signed for 3', () => {
  // By the agent's clock the card is 2 days less 3 s above the floor: the contract quotes 2 from now on.
  const ms = FLOOR_S * 1000 + 2 * DAY - 3_000
  // The gateway's last block is a round older: its view still answered 3 days.
  const stale = { days: 3, costAtomic: wholeToAtomic(225) }
  const ctx: RulesContext = { settings: { ...TEST_SETTINGS }, now: NOW, cooldownQuote: stale }
  const v = checkAction({ type: 'fusion_cooldown_waiver', nonce: 101 }, cooling(ms), ctx)
  const signsThree = v.ok && v.facts.days === undefined && v.foxsy === wholeToAtomic(225)
  assert.equal(signsThree, false, 'all 3 quoted days, 225 FOXSY, no days argument: the block that takes it quotes 2 and reverts ("Wrong waiver payment"), the gas lost')
  if (v.ok) {
    assert.equal(v.facts.days, 2, 'only the 2 days the chain still quotes can be bought')
    assert.equal(v.foxsy, wholeToAtomic(150))
  }
})

test('R2M-2 the same with the 3 days named by the plan', () => {
  const ms = FLOOR_S * 1000 + 2 * DAY - 3_000
  const ctx: RulesContext = { settings: { ...TEST_SETTINGS }, now: NOW, cooldownQuote: { days: 3, costAtomic: wholeToAtomic(225) } }
  const v = checkAction({ type: 'fusion_cooldown_waiver', nonce: 101, days: 3 }, cooling(ms), ctx)
  assert.equal(v.ok && v.foxsy === wholeToAtomic(225), false, '3 days paid at a block that quotes 2: reverted, the gas lost')
})

test('R2M-2 control: a minute before the drop the fix of CHN-U4 holds', () => {
  const ms = FLOOR_S * 1000 + 2 * DAY + 60_000
  const ctx: RulesContext = { settings: { ...TEST_SETTINGS }, now: NOW, cooldownQuote: { days: 3, costAtomic: wholeToAtomic(225) } }
  const v = checkAction({ type: 'fusion_cooldown_waiver', nonce: 101 }, cooling(ms), ctx)
  assert.equal(v.facts.days, 2)
})

// Added by the fix: a quote of one day just after its drop is refused, with no amount signed.
test('R2M-2 a quote of 1 day read 3 s after the clock saw the last day go: refused, nothing signed', () => {
  const ms = FLOOR_S * 1000 - 3_000
  const ctx: RulesContext = { settings: { ...TEST_SETTINGS }, now: NOW, cooldownQuote: { days: 1, costAtomic: wholeToAtomic(75) } }
  const v = checkAction({ type: 'fusion_cooldown_waiver', nonce: 101 }, cooling(ms), ctx)
  assert.equal(v.ok, false)
  assert.match(v.refusal ?? '', /last waivable day ended by the agent's clock/)
})
