// Owner, 2026-10-26: the agents create with an OVR range by default (PR #36), and a range can leave an open challenge
// unaccepted or a tournament unfilled. FoxLeague lets the creator widen it while the tournament or challenge is open
// for joining (next-foxleague #542, `POST /api/tournaments/{id}/ovr-range`, `ovr_range.rs` `widen_refusal`): lower the
// minimum or raise the maximum, a field left out keeps its bound, null removes it; never narrower, never a new bound,
// never on a Champions FoxLeague or a developer tournament. Nothing is paid. The agent may widen its own.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAction } from '../src/executor/actions.ts'
import { checkAction, type RulesContext } from '../src/executor/rules.ts'
import type { TournamentDetail } from '../src/foxleague/types.ts'
import { renderDigest } from '../src/snapshot/digest.ts'
import { SYSTEM_PROMPT } from '../src/strategist/prompt.ts'
import { TEST_SETTINGS, dryWallet, liveWallet, setup, snapshot, tournament, withLive } from './fixtures.ts'

const ME = snapshot().profile!.id
const mine = (more: Record<string, unknown> = {}) => tournament(900, { max_teams: 2, min_teams: 2, creator_user_id: ME, ovr_min: 28, ovr_max: 35, ...more }, [{ user_id: ME }]) as TournamentDetail
const widen = (more: Record<string, unknown>) => parseAction({ type: 'widen_range', tournament_id: 900, ...more })
const ctx = (t: TournamentDetail) => ({ settings: TEST_SETTINGS, now: new Date(), tournament: t } as RulesContext)

test('widen_range takes the tournament and a new bound for either side (a whole number 1 to 100, or null to remove it)', () => {
  assert.deepEqual(widen({ ovr_min: 25 }), { type: 'widen_range', tournament_id: 900, ovr_min: 25 })
  assert.deepEqual(widen({ ovr_max: null }), { type: 'widen_range', tournament_id: 900, ovr_max: null })
  assert.throws(() => widen({}), /ovr_min or ovr_max/)
  assert.throws(() => widen({ ovr_min: 0 }), /ovr_min/)
})

test('the agent widens only its own open tournament or challenge, only wider, as FoxLeague does', () => {
  const s = snapshot()
  assert.equal(checkAction(widen({ ovr_min: 25 }), s, ctx(mine())).ok, true, checkAction(widen({ ovr_min: 25 }), s, ctx(mine())).refusal)
  assert.equal(checkAction(widen({ ovr_max: null }), s, ctx(mine())).ok, true, 'removing a bound is wider')
  assert.match(checkAction(widen({ ovr_min: 25 }), s, ctx(mine({ creator_user_id: 4242 }))).refusal!, /only the creator of T900 can change its OVR range/)
  assert.match(checkAction(widen({ ovr_min: 25 }), s, ctx(mine({ status: 'active' }))).refusal!, /only while T900 is open for joining/)
  assert.match(checkAction(widen({ ovr_min: 25 }), s, ctx(mine({ deadline: new Date(Date.now() - 60_000).toISOString() }))).refusal!, /only while T900 is open for joining/)
  assert.match(checkAction(widen({ ovr_min: 30 }), s, ctx(mine())).refusal!, /wider only: a lower minimum or a higher maximum/)
  assert.match(checkAction(widen({ ovr_max: 33 }), s, ctx(mine())).refusal!, /wider only/)
  assert.match(checkAction(widen({ ovr_min: 28 }), s, ctx(mine())).refusal!, /the range is already 28 to 35: nothing to change/)
  assert.match(checkAction(widen({ ovr_min: 20 }), s, ctx(mine({ ovr_min: null }))).refusal!, /never a new bound where there was none/)
  assert.match(checkAction(widen({ ovr_min: 20 }), s, ctx(mine({ ovr_min: null, ovr_max: null }))).refusal!, /has no OVR range/)
  assert.match(checkAction(widen({ ovr_min: 20 }), s, ctx(mine({ format: 'league_knockout' }))).refusal!, /no OVR range on a League \+ Knockout/)
  assert.match(checkAction(widen({ ovr_min: 20 }), s, ctx(mine({ developer_mode: true }))).refusal!, /no OVR range on a developer tournament/)
})

test('the executor widens through FoxLeague, sends only the sides given, and only in live mode', async () => {
  const sent: Record<string, unknown>[] = []
  const fox = { tournament: async () => mine(), widenOvrRange: async (_w: unknown, id: number, body: Record<string, unknown>) => { sent.push({ id, ...body }); return { ovr_min: 25, ovr_max: null } } }
  const dry = setup({ fox })
  const [d] = await dry.exec.run(dry.agent(), dryWallet, snapshot(), [{ action: widen({ ovr_min: 25 }), reason: '' }])
  assert.equal(d!.status, 'dry_run', d!.summary)
  assert.equal(sent.length, 0, 'dry run asks nothing')
  const live = setup({ fox })
  await withLive(live.store, async () => {
    const [r] = await live.exec.run(live.agent(), liveWallet, snapshot(), [{ action: widen({ ovr_min: 25, ovr_max: null }), reason: '' }])
    assert.equal(r!.status, 'confirmed', r!.summary)
    assert.match(r!.summary, /OVR range of T900 widened to 25 to any/)
  })
  assert.deepEqual(sent, [{ id: 900, ovr_min: 25, ovr_max: null }])
})

test('the plan sees its own open creations with a range, how many joined, and that it may widen them', () => {
  const s = snapshot()
  s.auth!.myTournaments = { active: [{ ...mine().tournament, participant_count: 1, title: 'Silver 1v1 1000' }], completed: [] } as never
  assert.match(renderDigest(s), /Your open T900 \(a 1v1\): OVR range 28 to 35, 1 of 2 seated, deadline .*: widen_range lets more teams in \(only wider\)/)
  assert.match(SYSTEM_PROMPT, /\{"type":"widen_range","tournament_id":N,"ovr_min":N\|null,"ovr_max":N\|null\}/)
})

test('the manual describes widening', async () => {
  const { readFileSync } = await import('node:fs')
  const plays = readFileSync(new URL('../site/src/content/docs/play/how-it-plays.md', import.meta.url), 'utf8').replace(/\s+/g, ' ')
  assert.match(plays, /When too few teams join its own open tournament or challenge, it may widen the range while it is open, never narrow it/)
})
