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
// The fixture's eleven plays at OVR 20 (11 cards of 140 synced stats at condition 100): a best XI OVR of 20 fits it.
const open = (more: Record<string, unknown> = {}) => parseAction({ type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: null, deadline_minutes: 120, ovr_min: 18, ovr_max: 20, ...more })

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
  assert.equal(why(open(), { zeus: true, bestXiOvr: 20 }), '')
  assert.doesNotMatch(SYSTEM_PROMPT, /never at the Zeus level/)
})

test('OP-3: an open challenge at any configured stake, Silver or Gold, and more than one in 24 hours', async () => {
  const m = setup({ fox: { bestXiOvr: async () => ({ best_xi_ovr: 20 }) } })
  m.store.updateSettings(0, { ...TEST_SETTINGS, dailyCapUsd: 1000 })
  const create = async (tier: 'silver' | 'gold', stake: number) => (await m.exec.run(m.agent(), dryWallet, snapshot(), [{ action: open({ tier, stake_foxsy: stake }), reason: '' }]))[0]!
  for (const [tier, stake] of [['silver', 1000], ['silver', 2500], ['gold', 5000], ['silver', 1000]] as const) {
    const r = await create(tier, stake)
    assert.equal(r.status, 'dry_run', `${tier} ${stake}: ${r.summary}`)
  }
  assert.match(why(open({ stake_foxsy: 1200 }), { bestXiOvr: 20 }), /not one of the configured amounts/, 'still only the owner\'s amounts')
  assert.match(why(open({ tier: 'gold', stake_foxsy: 5000 }), { bestXiOvr: 20, settings: { ...TEST_SETTINGS, entryFeesGold: [] } }), /Gold is off/)
  assert.match(why(open({ stake_foxsy: 3000 }), { bestXiOvr: 20, settings: { ...TEST_SETTINGS, maxEntryFeeFoxsy: 2500 } }), /per-action maximum 2500/)
})

test('OP-4: an open challenge needs an OVR range whose top is the team\'s own best XI OVR, rounded up to a whole number', () => {
  const plain = parseAction({ type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: null, deadline_minutes: 120 })
  assert.match(why(plain, { bestXiOvr: 20 }), /an open challenge needs an OVR range up to your best XI OVR/)
  assert.match(why(open({ ovr_max: 21 }), { bestXiOvr: 20 }), /ovr_max 20 at most/)
  assert.match(why(open({ ovr_max: 21 }), { bestXiOvr: 19.4 }), /ovr_max 20 at most/)
  assert.equal(why(open({ ovr_max: 20 }), { bestXiOvr: 19.4 }), '', 'a fractional OVR rounds up: the creator must fit its own range')
  assert.match(why(open(), { bestXiOvr: null }), /best XI OVR could not be read/)
  assert.match(why(open({ ovr_max: 19 }), { bestXiOvr: 19.4 }), /outside the OVR range you set/)
  // A targeted 1v1 keeps its rival checks (A2) and takes no range.
  assert.match(why(parseAction({ type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: 50, deadline_minutes: 120 }), { bestXiOvr: 20 }), /strength could not be read/)
  assert.match(SYSTEM_PROMPT, /open challenge[^.]*ovr_max[^.]*your best XI OVR/)
  const s = snapshot()
  s.auth!.bestXiOvr = 19.4
  assert.match(renderDigest(s), /for an open challenge: ovr_max 20 \(no stronger team can take it\)/)
})

// Agent review of PR #54 (high): the best XI OVR ignores condition, so a fresh team at our own OVR could take an open
// challenge while our starters are tired, far past A2's 10 percent. The strongest team a range lets in plays at its top
// at full condition; our eleven plays at today's condition.
test('R54A-1: an open challenge is held to A2\'s strength test against the strongest team its range lets in, at full condition, against our eleven today', () => {
  // The fixture's eleven: 11 cards of 140 synced stats (card OVR 20) at condition 100, so OVR 20 today.
  const at = (condition: number) => {
    const s = snapshot()
    for (const n of s.team!.lineup) s.players.find(p => p.nonce === n)!.condition = condition
    return s
  }
  const range = open({ ovr_min: 18, ovr_max: 20 })
  assert.equal(why(range, { bestXiOvr: 19.6 }, at(100)), '')
  assert.equal(why(range, { bestXiOvr: 19.6 }, at(82)), '', 'at 82 the eleven plays at 91 percent: OVR 18.2, and 20 is within 10 percent')
  assert.match(why(range, { bestXiOvr: 19.6 }, at(80)), /a team at the top of the range \(OVR 20\) at full condition would be more than 10 percent stronger than your eleven today \(OVR 18\.0/)
  assert.match(why(range, { bestXiOvr: 19.6, zeus: true }, at(50)), /more than 10 percent stronger/, 'at 50 a fresh team of our OVR is a third stronger')
  const unread = snapshot()
  unread.team = null
  assert.match(why(range, { bestXiOvr: 19.6 }, unread), /could not be read/)
  const d = renderDigest(Object.assign(at(80), { auth: { ...at(80).auth!, bestXiOvr: 19.6 } }))
  assert.match(d, /your eleven today: OVR 18\.0 at today's condition, so an open challenge waits until it is within 10 percent of the top/)
})

// Agent review of PR #54 (medium): a starter's missing condition or synced stats made the eleven's OVR NaN, and the
// R54A-1 test then let the challenge through (rule 4).
test('R54A-2: a starter whose condition or stats cannot be read leaves the eleven unread: no open challenge', () => {
  for (const field of ['condition', 'syncedTotal'] as const) {
    const s = snapshot()
    delete (s.players.find(p => p.nonce === s.team!.lineup[3])! as unknown as Record<string, unknown>)[field]
    assert.match(why(open(), { bestXiOvr: 20 }, s), /your eleven could not be read/, field)
    s.auth!.bestXiOvr = 20
    assert.doesNotMatch(renderDigest(s), /NaN/, field)
    assert.match(renderDigest(s), /your eleven today could not be read, so no open challenge/, field)
  }
})

// Agent review of PR #54 (medium): R54A-1 ran only at the create, while an open challenge waits up to 240 minutes. A
// ranked start, training on a starter or a weaker eleven could push our eleven past A2's 10 percent before anyone takes it.
test('R54A-3: while an open challenge of ours waits, a ranked start, training a starter or a new eleven keeps a team at its top within 10 percent', () => {
  const at = (condition: number, waiting = true) => {
    const s = snapshot()
    for (const n of s.team!.lineup) s.players.find(p => p.nonce === n)!.condition = condition
    if (waiting) s.auth!.myTournaments = { active: [{ ...(tournament(950, { max_teams: 2, min_teams: 2, creator_user_id: s.profile!.id, ovr_min: 18, ovr_max: 20, status: 'open' }) as { tournament: object }).tournament, participant_count: 1 }], completed: [] } as never
    return s
  }
  const ranked = { type: 'play_match', match_type: 'ranked' } as const
  // At 83 the eleven plays at OVR 18.3 (20 within 10 percent); a ranked game takes 5: at 78 it is 17.8, and 20 is not.
  assert.match(why(ranked, {}, at(83)), /your open challenge T950 waits for an opponent \(up to OVR 20\): after this ranked game your eleven would play at OVR 17\.8/)
  assert.equal(why(ranked, {}, at(100)), '', 'a fresh eleven still within 10 percent after the game')
  assert.equal(why(ranked, {}, at(83, false)), '', 'no open challenge waits')
  // Training one starter at 82 (OVR 18.2) takes 5 from it: 18.155 (shown 18.2), and 20 is no longer within 10 percent.
  assert.match(why({ type: 'train', player_nonce: 2, attribute: 'defense' }, {}, at(82)), /after this training your eleven would play at OVR 18\.2/)
  assert.equal(why({ type: 'train', player_nonce: 12, attribute: 'defense' }, {}, at(82)), '', 'a bench card trains freely')
  // A weaker defender in the eleven (card OVR 10 instead of 20) at condition 90: OVR 18.1 (19.0 with an equal one).
  const weak = at(90)
  Object.assign(weak.players.find(p => p.nonce === 13)!, { syncedTotal: 70, condition: 90 })
  const rotated = { type: 'set_lineup', lineup: [1, 13, 3, 4, 5, 6, 7, 8, 9, 10, 11], substitutes: [12, 2, 14, 15, 16, 17, 18] } as const
  assert.match(why(rotated, {}, weak), /after this lineup your eleven would play at OVR 18\.1/)
  assert.equal(why({ ...rotated, lineup: [1, 14, 3, 4, 5, 6, 7, 8, 9, 10, 11], substitutes: [12, 2, 13, 15, 16, 17, 18] }, {}, weak), '', 'an equal defender is fine')
  // Our tournaments unread: refused only while an open challenge of ours may still wait (created in the last 4 hours).
  const unread = at(83, false)
  unread.auth!.myTournaments = null
  assert.match(why(ranked, { openChallengeRecent: true }, unread), /an open challenge of yours may still wait/)
  assert.doesNotMatch(why(ranked, { openChallengeRecent: false }, unread), /open challenge/)
})

// Agent review of PR #54, third pass: R54A-3 judged only the eleven after a change, so once the eleven was already
// below the bar (a tournament match during the wait) a stronger eleven was refused too (medium); training with the team
// unread skipped the check (low); a waiting challenge without a target field was read as targeted (low).
const waitingAt = (condition: number, more: Record<string, unknown> = {}) => {
  const s = snapshot()
  for (const n of s.team!.lineup) s.players.find(p => p.nonce === n)!.condition = condition
  s.auth!.myTournaments = { active: [{ ...(tournament(950, { max_teams: 2, min_teams: 2, creator_user_id: s.profile!.id, ovr_min: 18, ovr_max: 20, status: 'open', ...more }) as { tournament: object }).tournament, participant_count: 1 }], completed: [] } as never
  return s
}

test('R54A-4: an eleven already below the bar may still be made stronger while an open challenge waits', () => {
  // At 70 the eleven plays at OVR 17.0; a fresh defender from the bench (100) lifts it to 17.3: still below, but better.
  const s = waitingAt(70)
  const fresher = { type: 'set_lineup', lineup: [1, 13, 3, 4, 5, 6, 7, 8, 9, 10, 11], substitutes: [12, 2, 14, 15, 16, 17, 18] } as const
  assert.equal(why(fresher, {}, s), '')
  s.players.find(p => p.nonce === 13)!.condition = 60
  assert.match(why(fresher, {}, s), /after this lineup your eleven would play at OVR 16\.9/, 'a weaker one is still refused')
})

test('R54A-5: training with the team unread is checked like training a starter while an open challenge waits', () => {
  const s = waitingAt(100)
  s.team = null
  assert.match(why({ type: 'train', player_nonce: 2, attribute: 'defense' }, {}, s), /could not be read/)
})

test('R54A-6: a waiting challenge of ours without a target field is checked as an open one', () => {
  const s = waitingAt(83, { target_user_id: undefined })
  assert.match(why({ type: 'play_match', match_type: 'ranked' }, {}, s), /your open challenge T950 waits/)
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
