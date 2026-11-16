// BEH-3b (the BEHAVIOUR reviewer's second half of BEH-3): the digest showed an open challenge whose OVR range shuts
// this team out like any other, scouted and with its rival's numbers, so a plan proposed joining it and the executor
// refused (agent 6, T6070, "outside the challenge's OVR range"). FoxLeague checks the range once at the join against
// the best XI OVR, and the join rule refuses outside it. The line now says "closed to you", with the range and the OVR.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderDigest } from '../../src/snapshot/digest.ts'
import { snapshot, tournament } from '../fixtures.ts'
import type { Tournament } from '../../src/foxleague/types.ts'

const challenge = (id: number, more: Record<string, unknown>) => ({ ...(tournament(id, { max_teams: 2, min_teams: 2, creator_user_id: 900, participant_count: 1, ...more }) as { tournament: Tournament }).tournament })
const lineOf = (text: string, id: number) => text.split('\n').find(l => l.trimStart().startsWith(`T${id} `)) ?? ''

test('BEH-3b an open challenge whose OVR range shuts the team out says so', () => {
  const s = snapshot()
  s.auth!.bestXiOvr = 43.1
  s.market.openChallenges = [challenge(6070, { ovr_min: 30, ovr_max: 40 }), challenge(6071, { ovr_min: 40, ovr_max: 45 }), challenge(6072, { ovr_min: 44 })]
  const text = renderDigest(s)
  assert.match(lineOf(text, 6070), /closed to you: range 30 to 40, your best XI OVR 43\.1/, lineOf(text, 6070))
  assert.match(lineOf(text, 6072), /closed to you: range 44 to any, your best XI OVR 43\.1/, lineOf(text, 6072))
  assert.doesNotMatch(lineOf(text, 6071), /closed to you/, 'a range that holds the team is open to it')
})

test('BEH-3b the same for an open tournament with a range', () => {
  const s = snapshot()
  s.auth!.bestXiOvr = 43.1
  s.market.openStandard = [(tournament(6080, { ovr_min: 20, ovr_max: 35 }) as { tournament: Tournament }).tournament]
  assert.match(lineOf(renderDigest(s), 6080), /closed to you: range 20 to 35, your best XI OVR 43\.1/)
})

test('BEH-3b an unread best XI OVR marks nothing (the executor reads its own before a join)', () => {
  const s = snapshot()
  s.auth!.bestXiOvr = null
  s.market.openChallenges = [challenge(6070, { ovr_min: 30, ovr_max: 40 })]
  assert.doesNotMatch(lineOf(renderDigest(s), 6070), /closed to you/)
})
