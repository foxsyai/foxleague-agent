// Owner, 2026-10-24: FoxLeague switched its OVR range on, so the agents may set one on what they create. FoxLeague's
// create takes optional `ovr_min` and `ovr_max`, whole numbers 1 to 100 with min <= max (next-foxleague
// `tournament_models.rs:459-466`, `ovr_range.rs` `validate`); it refuses a range on a Champions FoxLeague or a developer
// tournament, and a creator who takes a seat outside their own range (`creator_check`, before any payment). The agent
// always takes its own seat, so its range must hold its best XI OVR, read right before the create; unreadable is no
// range. A range on an open challenge keeps stronger teams out of it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAction } from '../src/executor/actions.ts'
import { checkAction, type RulesContext } from '../src/executor/rules.ts'
import { SYSTEM_PROMPT } from '../src/strategist/prompt.ts'
import { TEST_SETTINGS, liveWallet, setup, snapshot, tournament, withLive } from './fixtures.ts'

const challenge = (more: Record<string, unknown> = {}) => ({ type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: null, deadline_minutes: 60, ...more })
const cup = (more: Record<string, unknown> = {}) => ({ type: 'create_tournament', title: 'Autumn Cup', format: 'knockout', tier: 'silver', max_teams: 8, min_teams: 8, entry_fee_foxsy: 1000, starts_in_hours: 24, registration_closes_minutes_before: 60, round_interval_minutes: 30, ...more })

test('a create may carry an OVR range of whole numbers 1 to 100, the minimum not above the maximum', () => {
  assert.deepEqual([(parseAction(challenge({ ovr_max: 33 })) as { ovr_max?: number }).ovr_max, (parseAction(cup({ ovr_min: 25, ovr_max: 35 })) as { ovr_min?: number }).ovr_min], [33, 25])
  assert.equal('ovr_min' in parseAction(cup()), false, 'none when not set')
  assert.throws(() => parseAction(cup({ ovr_min: 0 })), /ovr_min/)
  assert.throws(() => parseAction(cup({ ovr_max: 101 })), /ovr_max/)
  assert.throws(() => parseAction(cup({ ovr_min: 30.5 })), /ovr_min/)
  assert.throws(() => parseAction(challenge({ ovr_min: 36, ovr_max: 35 })), /minimum OVR cannot be above the maximum/)
})

test('the range must hold the team\'s own best XI OVR, read right before the create; unreadable is no range', () => {
  const s = snapshot()
  const ctx = (bestXiOvr: number | null | undefined) => ({ settings: TEST_SETTINGS, now: new Date(), bestXiOvr } as RulesContext)
  // The fixture's eleven plays at OVR 20: an open challenge topped above 22 waits (R54A-1).
  assert.equal(checkAction(parseAction(challenge({ ovr_max: 20 })), s, ctx(19.6)).ok, true, checkAction(parseAction(challenge({ ovr_max: 20 })), s, ctx(19.6)).refusal)
  assert.match(checkAction(parseAction(challenge({ ovr_max: 30 })), s, ctx(31.4)).refusal!, /your best XI OVR is 31\.4, outside the OVR range you set \(at most 30\): FoxLeague refuses a creator outside their own range/)
  assert.match(checkAction(parseAction(challenge({ ovr_min: 32 })), s, ctx(31.4)).refusal!, /outside the OVR range you set \(at least 32\)/)
  assert.match(checkAction(parseAction(challenge({ ovr_max: 33 })), s, ctx(null)).refusal!, /your best XI OVR could not be read: no OVR range without it/)
  // An open challenge must carry one since 2026-11-06 (OP-4): without it the refusal asks for the range, not a read.
  assert.match(checkAction(parseAction(challenge()), s, ctx(undefined)).refusal!, /an open challenge needs an OVR range/)
})

test('the create sends the range to FoxLeague; the executor reads the best XI OVR only for a create with a range', async () => {
  const bodies: Record<string, unknown>[] = []
  let reads = 0
  const fox = {
    createTournament: async (_w: unknown, body: Record<string, unknown>) => { bodies.push(body); return { id: 900 } },
    tournament: async () => tournament(900, { max_teams: 2, min_teams: 2, creator_user_id: 100, sc_tournament_id: 900 }),
    joinTournament: async () => ({ participant_id: 1 }),
    bestXiOvr: async () => { reads++; return { best_xi_ovr: 19.6 } },
  }
  const m = setup({ fox })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, snapshot(), [{ action: parseAction(challenge({ ovr_min: 18, ovr_max: 20 })), reason: '' }])
    assert.equal(r!.status, 'confirmed', r!.summary)
  })
  assert.equal(bodies[0]!.ovr_min, 18)
  assert.equal(bodies[0]!.ovr_max, 20)
  assert.equal(reads, 1)
  // A tournament without a range (an open challenge must carry one since 2026-11-06, OP-4).
  const filled = snapshot()
  filled.market.recentStandard = [{ id: 1, tier: 'silver', format: 'knockout', max_teams: 8, seated: 8, fee: 1000, status: 'completed', starts_at: new Date().toISOString() }]
  const n = setup({ fox: { ...fox, createTournament: async (_w: unknown, body: Record<string, unknown>) => { bodies.push(body); return { id: 901 } }, tournament: async () => tournament(901, { max_teams: 8, min_teams: 8, creator_user_id: 100, sc_tournament_id: 901 }) } })
  await withLive(n.store, async () => { await n.exec.run(n.agent(), liveWallet, filled, [{ action: parseAction(cup()), reason: '' }]) })
  assert.equal('ovr_min' in bodies[1]!, false, 'no range: none sent')
  assert.equal(reads, 1, 'no read without a range')
})

test('the plan knows it may set a range on what it creates, and a refusal names the range', () => {
  assert.match(SYSTEM_PROMPT, /"ovr_min":N,"ovr_max":N/)
  assert.match(SYSTEM_PROMPT, /take an OVR range \(whole numbers 1 to 100\): only teams whose best XI OVR is inside may join; it must hold your own best XI OVR/)
})

test('the manual describes creating with an OVR range', async () => {
  const { readFileSync } = await import('node:fs')
  const plays = readFileSync(new URL('../site/src/content/docs/play/how-it-plays.md', import.meta.url), 'utf8').replace(/\s+/g, ' ')
  assert.match(plays, /It may set an OVR range on a tournament or a 1v1 it creates, so only teams of a strength it chooses can join; the range must hold its own best XI OVR/)
  assert.match(plays, /On its own open tournament it sets one by default, about 10 percent either way around its best XI OVR/)
  assert.match(plays, /An open challenge can be taken by any team inside its OVR range, often within minutes: its range tops out at your team's own best XI OVR/)
})

// Agent review of PR #35 (medium): only the chosen team can accept a targeted challenge, so a range there can only lock
// out the target (whose best XI OVR the agent cannot read): the stake would sit unaccepted until the deadline. The same
// holds for a private tournament's invited teams. No range on either.
test('R35A-1 no range on a targeted challenge or a private tournament', () => {
  const s = snapshot()
  const ctx = { settings: TEST_SETTINGS, now: new Date(), bestXiOvr: 31.4 } as RulesContext
  assert.match(checkAction(parseAction(challenge({ target_user_id: 42, ovr_max: 33 })), s, ctx).refusal!, /no OVR range on a targeted challenge: only the chosen team can accept it/)
  assert.match(checkAction(parseAction(cup({ invite_user_ids: [42, 43, 44, 45, 46, 47, 48], ovr_max: 33 })), s, ctx).refusal!, /no OVR range on a private tournament: it could lock out the teams you invite/)
})

// Agent review of PR #35 (low, tests): the tournament body and the executor's fail-closed path.
test('R35A-2 a tournament create carries the range; a failed best XI OVR read creates and books nothing', async () => {
  const bodies: Record<string, unknown>[] = []
  const fox = {
    createTournament: async (_w: unknown, body: Record<string, unknown>) => { bodies.push(body); return { id: 910 } },
    tournament: async () => tournament(910, { max_teams: 8, min_teams: 8, creator_user_id: 100, sc_tournament_id: 910 }),
    joinTournament: async () => ({ participant_id: 1 }),
    bestXiOvr: async () => ({ best_xi_ovr: 31.4 }),
  }
  const s = snapshot()
  s.market.recentStandard = [{ id: 1, tier: 'silver', format: 'knockout', max_teams: 8, seated: 8, fee: 1000, status: 'completed', starts_at: new Date().toISOString() }]
  const m = setup({ fox })
  await withLive(m.store, async () => { await m.exec.run(m.agent(), liveWallet, s, [{ action: parseAction(cup({ ovr_min: 28, ovr_max: 34 })), reason: '' }]) })
  assert.deepEqual([bodies[0]?.ovr_min, bodies[0]?.ovr_max], [28, 34], JSON.stringify(m.store.activity(0, 3).map(r => r.summary)))
  let created = 0
  const down = setup({ fox: { ...fox, createTournament: async () => { created++; return { id: 911 } }, bestXiOvr: async () => { throw new Error('down') } } })
  let r: { status: string; summary: string } | undefined
  await withLive(down.store, async () => { r = (await down.exec.run(down.agent(), liveWallet, snapshot(), [{ action: parseAction(challenge({ ovr_max: 33 })), reason: '' }]))[0] })
  assert.equal(r!.status, 'refused', r!.summary)
  assert.match(r!.summary, /best XI OVR could not be read/)
  assert.equal(created, 0, 'FoxLeague was not asked')
  assert.equal(down.store.openSpend(0, 'join:', false).length, 0, 'nothing booked')
})

// Owner, 2026-10-24: what the agent creates should carry a range by default, about 10 percent either way around its
// best XI OVR, so teams of its strength enter; the agent decides, widening it when tournaments fill slowly.
test('the snapshot suggests a range about 10 percent either way around the best XI OVR, and the prompt makes it the default', async () => {
  const { renderDigest } = await import('../src/snapshot/digest.ts')
  const s = snapshot()
  s.auth!.bestXiOvr = 31.4
  assert.match(renderDigest(s), /Your best XI OVR \(what OVR ranges are checked against\): 31\.4; a range about 10 percent either way for what you create: ovr_min 28, ovr_max 35/)
  s.auth!.bestXiOvr = 95.5
  assert.match(renderDigest(s), /ovr_min 85, ovr_max 100/, 'at most 100')
  assert.match(SYSTEM_PROMPT, /On your own open tournament set one by default, about 10 percent either way around your best XI OVR \(the snapshot suggests it\), so teams of your strength can enter; widen it when recent tournaments filled slowly/)
})
