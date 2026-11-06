// Owner, 2026-11-06: every level may use every part of FoxLeague; the levels differ only in what they pay for and the
// caps. The week to 2026-11-06 showed why: the agents created 242 targeted 1v1s and 2 were played, because a targeted
// 1v1 is taken almost only when the two teams arranged it (FoxLeague's public list: 281 of 294 accepted, half within
// 36 seconds), while open challenges were taken 63 times out of 105, half within 11 minutes; and Zeus, the level every
// agent plays, could not post an open one.
// OP-1: "accepted N 1v1s" counted the arranged ones, so the plan aimed at teams that never take a stranger's challenge.
// OP-2: Zeus may post an open challenge.
// OP-3: an open challenge at any configured stake, Silver or Gold, as often as FoxLeague's one active 1v1 allows.
// OP-4: an open challenge carries an OVR range whose top is the team's own best XI OVR: FoxLeague then keeps every
//       stronger team out (the farming guard of A2, kept for targeted and joined 1v1s).
// OP-5: the top of a 1v1's range is never raised or removed later.
// OP-6: every level may create a private tournament.
// OP-7: casual games share FoxLeague's 5 daily starts with ranked, with no count of their own.
// OP-8: every level's text names every part of the game.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAction } from '../src/executor/actions.ts'
import { checkAction, type RulesContext } from '../src/executor/rules.ts'
import type { TournamentDetail } from '../src/foxleague/types.ts'
import { renderDigest } from '../src/snapshot/digest.ts'
import { takeSnapshot } from '../src/snapshot/snapshot.ts'
import { STRATEGY_PRESETS } from '../src/store/settings.ts'
import { SYSTEM_PROMPT } from '../src/strategist/prompt.ts'
import { TEST_SETTINGS, dryWallet, setup, snapshot, tournament } from './fixtures.ts'

const ctx = (more: Partial<RulesContext> = {}): RulesContext => ({ settings: { ...TEST_SETTINGS }, now: new Date(), ...more })
const why = (a: unknown, more: Partial<RulesContext> = {}, s = snapshot()) => {
  const v = checkAction(a as never, s, ctx(more))
  return v.ok ? '' : (v as { refusal: string }).refusal
}
const open = (more: Record<string, unknown> = {}) => parseAction({ type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: null, deadline_minutes: 120, ovr_min: 36, ovr_max: 40, ...more })

test('OP-1: a team is counted as taking 1v1s only for the ones it had not arranged (a targeted 1v1 played within 2 minutes is arranged)', async () => {
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
  const row = (id: number, more: Record<string, unknown>) => ({ ...(tournament(id) as { tournament: object }).tournament, max_teams: 2, completed_at: ago(60), ...more })
  const users = [
    { id: 1, wallet_address: dryWallet.address, team_name: 'Mine', elo_rating: 1200, league: 'Bronze' },
    { id: 40, wallet_address: 'erd1friend', team_name: 'Friend', elo_rating: 1200, league: 'Bronze' },
    { id: 41, wallet_address: 'erd1open', team_name: 'Open taker', elo_rating: 1200, league: 'Bronze' },
    { id: 42, wallet_address: 'erd1late', team_name: 'Late taker', elo_rating: 1200, league: 'Bronze' },
  ]
  const fox = {
    user: async () => ({ id: 1, wallet_address: dryWallet.address, team_name: 'Mine', elo_rating: 1200 }),
    team: async () => ({ id: 1, user_id: 1, name: 'Mine', coach_name: null, formation: '4-4-2', lineup: [], substitutes: [], team_overall: 0, badge: null }),
    players: async () => [],
    leaderboard: async () => ({ users }),
    tournaments: async (q: { status?: string; kind?: string }) =>
      q.status === 'completed' && q.kind === 'challenge'
        ? [
            // Arranged: aimed at the friend and taken 30 seconds later, three times.
            ...[70, 71, 72].map(id => row(id, { creator_user_id: 11, winner_user_id: 40, runner_up_user_id: 11, targeted: true, created_at: ago(120), started_at: ago(119.5) })),
            // Open, taken after 10 minutes.
            row(73, { creator_user_id: 12, winner_user_id: 12, runner_up_user_id: 41, targeted: false, created_at: ago(120), started_at: ago(110) }),
            // Aimed at a team that took it 40 minutes later: not arranged.
            row(74, { creator_user_id: 13, winner_user_id: 42, runner_up_user_id: 13, targeted: true, created_at: ago(120), started_at: ago(80) }),
          ]
        : [],
  } as never
  const chain = { account: async () => { throw new Error('off') }, esdts: async () => { throw new Error('off') }, egldUsd: async () => { throw new Error('off') }, query: async () => { throw new Error('off') } } as never
  const s = await takeSnapshot({ chain, fox }, { wallet: dryWallet })
  const took = Object.fromEntries(s.leaderboardNeighbours.map(u => [u.id, u.accepted7d]))
  assert.deepEqual([took[40], took[41], took[42]], [0, 1, 1], 'the friend took only arranged 1v1s')
  assert.deepEqual(s.leaderboardNeighbours.slice(0, 2).map(u => u.id).sort(), [41, 42], 'the teams that take a stranger\'s challenge come first')
  const d = renderDigest(s)
  assert.match(d, /Open taker \(user 41\) 1200, took 1 1v1 in 7 days it had not arranged/)
  assert.match(d, /Friend \(user 40\) 1200, took no 1v1 in 7 days it had not arranged/)
  assert.doesNotMatch(SYSTEM_PROMPT, /Prefer a targeted challenge/)
  assert.match(SYSTEM_PROMPT, /arranged/)
})

test('OP-2: Zeus may post an open challenge, with its OVR range', () => {
  assert.equal(why(open(), { zeus: true, bestXiOvr: 40 }), '')
  assert.doesNotMatch(SYSTEM_PROMPT, /never at the Zeus level/)
})

test('OP-3: an open challenge at any configured stake, Silver or Gold, and more than one in 24 hours', async () => {
  const m = setup({ fox: { bestXiOvr: async () => ({ best_xi_ovr: 40 }) } })
  m.store.updateSettings(0, { ...TEST_SETTINGS, dailyCapUsd: 1000 })
  const create = async (tier: 'silver' | 'gold', stake: number) => (await m.exec.run(m.agent(), dryWallet, snapshot(), [{ action: open({ tier, stake_foxsy: stake }), reason: '' }]))[0]!
  for (const [tier, stake] of [['silver', 1000], ['silver', 2500], ['gold', 5000], ['silver', 1000]] as const) {
    const r = await create(tier, stake)
    assert.equal(r.status, 'dry_run', `${tier} ${stake}: ${r.summary}`)
  }
  assert.match(why(open({ stake_foxsy: 1200 }), { bestXiOvr: 40 }), /not one of the configured amounts/, 'still only the owner\'s amounts')
  assert.match(why(open({ tier: 'gold', stake_foxsy: 5000 }), { bestXiOvr: 40, settings: { ...TEST_SETTINGS, entryFeesGold: [] } }), /Gold is off/)
  assert.match(why(open({ stake_foxsy: 3000 }), { bestXiOvr: 40, settings: { ...TEST_SETTINGS, maxEntryFeeFoxsy: 2500 } }), /per-action maximum 2500/)
})

test('OP-4: an open challenge needs an OVR range whose top is the team\'s own best XI OVR, rounded up to a whole number', () => {
  const plain = parseAction({ type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: null, deadline_minutes: 120 })
  assert.match(why(plain, { bestXiOvr: 40 }), /an open challenge needs an OVR range up to your best XI OVR/)
  assert.match(why(open({ ovr_max: 44 }), { bestXiOvr: 40 }), /ovr_max 40 at most/)
  assert.match(why(open({ ovr_max: 41 }), { bestXiOvr: 39.4 }), /ovr_max 40 at most/)
  assert.equal(why(open({ ovr_max: 40 }), { bestXiOvr: 39.4 }), '', 'a fractional OVR rounds up: the creator must fit its own range')
  assert.match(why(open(), { bestXiOvr: null }), /best XI OVR could not be read/)
  assert.match(why(open({ ovr_max: 39 }), { bestXiOvr: 39.4 }), /outside the OVR range you set/)
  // A targeted 1v1 keeps its rival checks (A2) and takes no range.
  assert.match(why(parseAction({ type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: 50, deadline_minutes: 120 }), { bestXiOvr: 40 }), /strength could not be read/)
  assert.match(SYSTEM_PROMPT, /open challenge[^.]*ovr_max[^.]*your best XI OVR/)
  const s = snapshot()
  s.auth!.bestXiOvr = 39.4
  assert.match(renderDigest(s), /for an open challenge: ovr_max 40 \(no stronger team can take it\)/)
})

test('OP-5: the top of a 1v1\'s OVR range is never raised or removed', () => {
  const s = snapshot()
  const me = s.profile!.id
  const t = (max: number) => tournament(900, { max_teams: max, min_teams: 2, creator_user_id: me, ovr_min: 36, ovr_max: 40 }, [{ user_id: me }]) as TournamentDetail
  const widen = (more: Record<string, unknown>) => parseAction({ type: 'widen_range', tournament_id: 900, ...more })
  assert.match(why(widen({ ovr_max: 45 }), { tournament: t(2), ownCreation: true }), /the top of a 1v1's range stays/)
  assert.match(why(widen({ ovr_max: null }), { tournament: t(2), ownCreation: true }), /the top of a 1v1's range stays/)
  assert.equal(why(widen({ ovr_min: 30 }), { tournament: t(2), ownCreation: true }), '', 'its minimum may be lowered')
  assert.equal(why(widen({ ovr_max: 45 }), { tournament: t(8), ownCreation: true }), '', 'a tournament\'s maximum may still be raised')
})

test('OP-6: every level may create a private tournament', () => {
  const a = parseAction({ type: 'create_tournament', title: 'Varna Cup', format: 'round_robin', tier: 'silver', max_teams: 6, min_teams: 4, entry_fee_foxsy: 1000, starts_in_hours: 6, registration_closes_minutes_before: 60, round_interval_minutes: 60, invite_user_ids: [11, 12, 13] })
  assert.doesNotMatch(why(a, { zeus: false }), /Zeus|private/)
  assert.doesNotMatch(SYSTEM_PROMPT, /Zeus level only: add "invite_user_ids"/)
})

test('OP-7: casual games share the 5 daily starts with ranked, with no count of their own', async t => {
  // Four casual games a minute ago, so only a count of their own could refuse the fifth (the 30 s gap has passed).
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() - 60_000 })
  const { exec, agent, store } = setup()
  for (let i = 0; i < 4; i++) store.log({ agentIndex: 0, kind: 'play_match', status: 'dry_run', summary: `DRY RUN play casual match: match #${i} started (casual)` })
  t.mock.timers.tick(60_000)
  const [r] = await exec.run(agent(), dryWallet, snapshot(), [{ action: { type: 'play_match', match_type: 'casual' }, reason: '' }])
  assert.equal(r!.status, 'dry_run', r!.summary)
  const s = snapshot() as ReturnType<typeof snapshot> & { casualToday?: number; casualBench?: unknown }
  s.casualBench = { matches: 0, unread: 0, rows: [], field: [] }
  s.casualToday = 4
  assert.match(renderDigest(s), /Casual games today: 4 \(casual and ranked share FoxLeague's daily starts\)/)
  assert.doesNotMatch(SYSTEM_PROMPT, /at most 4 a game day/)
})

test('OP-8: every level\'s text names every part of the game: ranked and casual, joining and creating tournaments (private too), open and targeted 1v1s', () => {
  for (const [level, text] of Object.entries(STRATEGY_PRESETS)) {
    for (const part of [/ranked/i, /casual/i, /create tournaments/i, /private/i, /open challenges?/i, /named team|targeted/i]) assert.match(text, part, `${level} names ${part}`)
  }
})
