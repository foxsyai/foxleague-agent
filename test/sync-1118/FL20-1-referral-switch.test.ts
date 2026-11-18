// FL20-1 (FoxLeague mainnet a546f7279, 18 Nov 2026): FoxLeague serves a new switch `referral` (its Invite Friends
// programme, live from Fri 20 Nov 14:00 UTC). The agent had no rule for it, so the plan read the generic "a FoxLeague
// rule your instructions do not cover yet" line and the owner was told the agents do not know it. The owner's rule: the
// agents take no part in the programme (no invitation at registration, no invite link shared or used, no referral
// credit, the owner's teams never invite one another), and it changes nothing in how they play. The plan reads that rule
// in its own line, and `referral` is a ruled switch.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unknownSwitches } from '../../src/foxleague/config-watch.ts'
import { renderDigest } from '../../src/snapshot/digest.ts'
import { snapshot } from '../fixtures.ts'
import { HOUR, MIN, liveConfig, mcp, watch } from '../audit-1116/watch-helpers.ts'

/** GET /api/config of mainnet on 19 Nov 2026 (trimmed as liveConfig is): the 16 Nov settings and the referral switch. */
function configOf19Nov(): Record<string, unknown> {
  return { ...liveConfig(), referral: { live: false, live_from: '2026-11-20T14:00:00Z' } }
}
const AT_19NOV = Date.parse('2026-11-19T07:00:00Z')

type Observing = { observeConfig: (config: unknown, now?: number) => Promise<unknown> | null }

test('FL20-1 the referral switch of 19 Nov is a switch the agent has a rule for', () => {
  assert.deepEqual(unknownSwitches(configOf19Nov()).switches.map(sw => sw.key), [])
})

test('FL20-1 the plan reads the referral rule in its own line, never the generic line of a switch it does not know', () => {
  const s = snapshot()
  s.config = { ...s.config, ...configOf19Nov() } as typeof s.config
  s.takenAt = new Date(AT_19NOV).toISOString()
  const digest = renderDigest(s)
  assert.doesNotMatch(digest, /Rule switch referral/)
  assert.doesNotMatch(digest, /Rule switches your instructions do not cover/)
  const line = digest.split('\n').find(l => l.startsWith('Referral programme'))
  assert.ok(line, digest)
  assert.match(line, /^Referral programme \(Invite Friends\): not live yet, from 2026-11-20T14:00:00Z: /)
  assert.match(line, /You take no part in it: never register with an invitation, never share or use an invite link, never use a referral credit, and the owner's teams never invite one another \(Fair Play\)/)
  assert.match(line, /never FOXSY/)
  assert.match(line, /It changes nothing in how you play/)
  // Live from its time: the same rule.
  s.takenAt = new Date(Date.parse('2026-11-20T14:00:00Z')).toISOString()
  assert.match(renderDigest(s), /\nReferral programme \(Invite Friends\): LIVE: [^\n]*You take no part in it/)
})

test('FL20-1 the owner is not told that the agents have no rule for the referral switch', async () => {
  const w = watch(mcp())
  await (w as unknown as Observing).observeConfig(liveConfig(), AT_19NOV)
  await (w as unknown as Observing).observeConfig(configOf19Nov(), AT_19NOV + 2 * HOUR + 50 * MIN)
  assert.deepEqual(w.told.filter(t => /rule switch the agents do not know/.test(t)), [], w.told.join('\n'))
})
