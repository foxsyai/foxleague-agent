// RULED-1 (merge of the 16 Nov 2026 audit): the RULES fix gave the agent rules for FoxLeague's elo_pair_cap (MNT-3: a
// snapshot rule line and the meetings per rival) and metastaking_discount (MNT-2 with CHN-1: the Shop pays the served
// discounted price, an unread rate refuses once live). A switch the agent has a rule for is no "rule your instructions
// do not cover yet" (P-W6) and no "rule switch the agents do not know yet" for the owner (P-W3): both keys belong in
// RULED_SWITCHES, or the plan reads two lines about the pair cap and the owner is told the agents do not know it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderDigest } from '../../src/snapshot/digest.ts'
import { snapshot } from '../fixtures.ts'
import { AT_0700, HOUR, MIN, configOf13Nov, liveConfig, mcp, watch } from './watch-helpers.ts'

type Observing = { observeConfig: (config: unknown, now?: number) => Promise<unknown> | null }

test('RULED-1 on the live settings of 16 Nov the digest has no generic line for elo_pair_cap or metastaking_discount, only the rule line of the pair cap', () => {
  const s = snapshot()
  s.config = { ...s.config, ...liveConfig() } as typeof s.config
  s.takenAt = new Date(AT_0700).toISOString()
  const digest = renderDigest(s)
  assert.doesNotMatch(digest, /Rule switch elo_pair_cap/, 'the pair cap has its own rule line (MNT-3): a second, generic one says the instructions do not cover it')
  assert.doesNotMatch(digest, /Rule switch metastaking_discount/, 'the executor pays the served discounted price (MNT-2): the rule exists')
  assert.doesNotMatch(digest, /Rule switches your instructions do not cover/)
  // The RULES fix's own line for the pair cap reads as it should.
  assert.match(digest, /\nELO pair cap: not live yet, from 2026-11-20T14:00:00Z: the same two teams move ELO in at most 3 meetings a game day \(from 14:00 UTC\), ranked, 1v1s and tournaments of every level together; /)
})

test('RULED-1 the owner is not told that the agents have no rule for elo_pair_cap or metastaking_discount', async () => {
  const w = watch(mcp())
  await (w as unknown as Observing).observeConfig(configOf13Nov(), AT_0700)
  await (w as unknown as Observing).observeConfig(liveConfig(), AT_0700 + 2 * HOUR + 50 * MIN)
  assert.deepEqual(w.told.filter(t => /rule switch the agents do not know/.test(t)), [], w.told.join('\n'))
})
