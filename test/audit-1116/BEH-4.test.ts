// BEH-4: an open 1v1 has exactly one legal ovr_max, the team's best XI OVR rounded up: lower and FoxLeague refuses the
// creator (outside its own range), higher and the executor refuses (a stronger team could take it). The prompt and
// the executor both say "at most" ("it needs ovr_max, at most your best XI OVR rounded up"; "an open challenge takes
// ovr_max N at most"), so a plan that wants only weaker rivals lowers it, and the refusal it gets back names no value
// to send. Production: 5 refusals (agent 3 Opus 30 to 38 at OVR 38.4; agent 9 Opus 1 to 39 at 41; agent 10 Haiku 1 to
// 35, 30 to 35 and 1 to 35 at OVR 43, on 14, 14 and 16 Nov: the same refused action three times in three days).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkAction, type RulesContext } from '../../src/executor/rules.ts'
import { TEST_SETTINGS, snapshot } from '../fixtures.ts'

const ctx = (more: Partial<RulesContext> = {}): RulesContext => ({ settings: { ...TEST_SETTINGS }, now: new Date(), ...more })

test('BEH-4: a refused open challenge topped below the team\'s own OVR names the one ovr_max that works', () => {
  const s = snapshot()
  // Agent 10 on 16 Nov: best XI OVR 43.1, an open Silver 1v1 "capped at OVR 35 so only weaker teams can take it".
  const lowTop = { type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: null, deadline_minutes: 240, ovr_min: 1, ovr_max: 35 } as const
  const v = checkAction(lowTop, s, ctx({ bestXiOvr: 43.1 }))
  assert.equal(v.ok, false, 'refused, as FoxLeague would refuse it')
  // The only range that passes both checks tops out at 44. The refusal is what the next plan reads: it must give it.
  assert.equal(checkAction({ ...lowTop, ovr_max: 44 }, { ...s, players: s.players.map(p => ({ ...p, syncedTotal: 7 * 44, synced: Object.fromEntries(Object.keys(p.synced).map(k => [k, 44])) as typeof p.synced })) }, ctx({ bestXiOvr: 43.1 })).ok, true, 'control: ovr_max 44 is allowed')
  assert.match(v.refusal ?? '', /ovr_max(?: of| must be| is)? 44\b/, `the refusal must name ovr_max 44, the only top FoxLeague and the executor both take; it reads: ${v.refusal}`)
})

test('BEH-4: the instructions and the snapshot give the open challenge\'s top as its only value', async () => {
  const { SYSTEM_PROMPT } = await import('../../src/strategist/prompt.ts')
  const { renderDigest } = await import('../../src/snapshot/digest.ts')
  assert.doesNotMatch(SYSTEM_PROMPT, /it needs ovr_max, at most your best XI OVR/)
  assert.match(SYSTEM_PROMPT, /it needs ovr_max, exactly your best XI OVR rounded up/)
  const s = snapshot()
  s.auth!.bestXiOvr = 43.1
  assert.match(renderDigest(s), /for an open challenge: ovr_max 44 \(no stronger team can take it\), no other value/)
})
