// FoxLeague mainnet of 13 Nov 2026, FL13-6: what the plan knows of fusion.
// From FoxLeague's fusion switch (fusion_mint.live_from, 2026-11-20T14:00:00Z on mainnet) a fusion no longer draws a card
// from the pool: it mints a new card whose 7 stats are each "the average of that stat over your three cards, translated
// to the range of the new rarity: the three values added up, times the new rarity's cap, divided by three times the old
// cap, rounded down", never below the new rarity's stat floor (Uncommon 22, Rare 30, Epic 36, Legendary 40), and no sync
// is needed (next-foxleague origin/main docs/manual/src/content/docs/mechanics/fusion.mdx, "Fusion that makes a new card"
// and "A worked example"). The prompt said only that "the contract draws a random card of that rarity and position from
// its fusion pool ... so the result is never a known card" and that inputs need synced stats, and the snapshot said
// nothing of the switch: from it the plan would weigh every fusion by a rule that no longer runs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { SYSTEM_PROMPT } from '../../src/strategist/prompt.ts'
import { renderDigest } from '../../src/snapshot/digest.ts'
import { snapshot } from '../fixtures.ts'

const at = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString()
const fusionLine = (fusionMint: unknown) => {
  const s = snapshot()
  ;(s.config as Record<string, unknown>).fusion_mint = fusionMint
  return renderDigest(s).split('\n').find(l => l.startsWith('Fusion:')) ?? ''
}

test('FL13-6: the snapshot says which fusion FoxLeague runs and when it changes', () => {
  const from = at(5 * 24 * 60)
  assert.match(fusionLine({ live: false, live_from: from, paused: false }), new RegExp(`^Fusion: until ${from} a card drawn from the fusion pool.*from then a new card is minted`))
  assert.match(fusionLine({ live: true, live_from: at(-60), paused: false }), /^Fusion: LIVE, a new card is minted: each stat = the three inputs' values added up x the new rarity's cap \/ \(3 x their cap\), rounded down/)
  assert.match(fusionLine({ live: false, live_from: null, paused: false }), /^Fusion: a card drawn from the fusion pool/)
  assert.match(fusionLine({ live: false, live_from: null, paused: true }), /^Fusion: closed now \(FoxLeague says fusion is being updated/)
  assert.match(fusionLine(undefined), /^Fusion: closed now \(.*could not be read/)
})

test('FL13-6: the prompt gives both fusions and the average rule, and points at the snapshot\'s Fusion line', () => {
  const fusion = SYSTEM_PROMPT.split('\n').find(l => l.startsWith('Fusion:')) ?? ''
  assert.match(fusion, /snapshot's Fusion line/)
  assert.match(fusion, /average of that stat over the three/)
  assert.match(fusion, /Uncommon 22, Rare 30, Epic 36, Legendary 40/)
  assert.match(fusion, /one trained card does not carry two untrained ones/)
  assert.doesNotMatch(fusion, /so the result is never a known card\./, 'the pool draw is no longer the only fusion')
  assert.doesNotMatch(fusion, /Inputs also need synced stats/, 'from the switch no sync is needed')
})
