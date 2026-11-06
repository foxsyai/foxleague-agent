// Production, 2026-11-06: agents 7 and 1 sent a targeted challenge with an OVR range ("OVR 1 to 100", "OVR 1 to 38").
// The executor refused it (only the chosen team can accept a targeted challenge, so a range could only lock it out),
// nothing was paid, but the challenge was not sent. The prompt showed one create_challenge form with both a target and
// a range, and the snapshot offered "a range about 10 percent either way for what you create".

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderDigest } from '../src/snapshot/digest.ts'
import { SYSTEM_PROMPT } from '../src/strategist/prompt.ts'
import { snapshot } from './fixtures.ts'

test('TR-1: the prompt and the snapshot offer an OVR range only for an open challenge or tournament, never a targeted challenge', () => {
  // Two forms: a challenge to a named team has no range fields at all; an open one carries them.
  assert.match(SYSTEM_PROMPT, /\{"type":"create_challenge","tier":"silver\|gold","stake_foxsy":N,"target_user_id":N,"deadline_minutes":30\|60\|120\|240\} a challenge to one named team: never ovr_min or ovr_max/)
  assert.match(SYSTEM_PROMPT, /\{"type":"create_challenge","tier":"silver\|gold","stake_foxsy":N,"target_user_id":null,"deadline_minutes":30\|60\|120\|240,"ovr_min":N,"ovr_max":N\} an open challenge/)
  assert.doesNotMatch(SYSTEM_PROMPT, /"target_user_id":N\|null/, 'no single form mixing a target with a range')
  const s = snapshot()
  s.auth!.bestXiOvr = 31.4
  const d = renderDigest(s)
  assert.doesNotMatch(d, /for what you create/)
  assert.match(d, /a range about 10 percent either way for your own open tournament: ovr_min 28, ovr_max 35/)
  assert.match(d, /a targeted challenge or a private tournament takes none/)
})
