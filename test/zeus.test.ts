import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkAction, type RulesContext } from '../src/executor/rules.ts'
import { parseAction } from '../src/executor/actions.ts'
import { winChance, percent } from '../src/snapshot/winchance.ts'
import { LEVEL_AI, LEVEL_SETTINGS, STRATEGY_PRESETS, validateSettingsPatch } from '../src/store/settings.ts'
import { TEST_SETTINGS, snapshot, tournament } from './fixtures.ts'
import type { TournamentDetail } from '../src/foxleague/types.ts'

const ctx = (more: Partial<RulesContext> = {}): RulesContext => ({ settings: { ...TEST_SETTINGS }, now: new Date(), ...more })

test('win chance: ELO expectation and squad ratio, each alone or averaged', () => {
  assert.equal(winChance({ myElo: 1200, oppElo: 1200, myStrength: 1500, oppStrength: 1500 }), 0.5)
  assert.equal(winChance({ myElo: 1400, oppElo: 1200, myStrength: null, oppStrength: null }), 0.76, 'ELO alone: +200 is 76 percent')
  assert.equal(winChance({ myElo: null, oppElo: null, myStrength: 1650, oppStrength: 1500 }), 0.68, 'a squad 10 percent stronger: 68 percent')
  assert.equal(winChance({ myElo: 1200, oppElo: 1200, myStrength: 1650, oppStrength: 1500 }), 0.59)
  assert.equal(winChance({ myElo: null, oppElo: 1200, myStrength: null, oppStrength: 1500 }), null)
  assert.equal(percent(0.624), '62 percent')
})

test('Zeus is level 6 of 6 with its own limits and AI, and the strategy text fits the settings', () => {
  assert.match(STRATEGY_PRESETS.zeus!, /^Zeus \(level 6 of 6\)/)
  assert.equal(validateSettingsPatch({ strategy: STRATEGY_PRESETS.zeus! }).strategy, STRATEGY_PRESETS.zeus)
  const z = LEVEL_SETTINGS.zeus!
  assert.deepEqual([z.dailyCapUsd, z.monthlyBudgetUsd, z.topUpWarningUsd, z.maxBidFoxsy, z.tickMinutes], [150, 3000, 300, 38_000, 60])
  assert.equal(z.topUpWarningUsd, 2 * z.dailyCapUsd, 'the warning at two days of play')
  assert.deepEqual(LEVEL_AI.zeus, { model: 'claude-opus-5-5', effort: 'high' })
  assert.deepEqual(Object.keys(LEVEL_AI), Object.keys(STRATEGY_PRESETS), 'a recommended AI for every level')
})

test('a 1v1 against a known team: refused under a 55 percent win chance (Zeus\'s floor, every level\'s since 2026-11-06)', () => {
  const s = snapshot() // our eleven: 11 x 140 = 1540 at full condition, ELO 1200
  const challenge = { type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: 55, deadline_minutes: 60 } as const
  const tough = { userId: 55, elo: 1250, strength: 1600 } // within A2's gates (ELO under +100, squad under 10 percent stronger)
  const z = checkAction(challenge, s, ctx({ opponent: tough }))
  assert.equal(z.ok, false)
  assert.match((z as { refusal: string }).refusal, /win chance against user 55 is about 43 percent; a 1v1 against a known team is played from 55 percent/)
  assert.equal(checkAction(challenge, s, ctx({ opponent: { userId: 55, elo: 1150, strength: 1400 } })).ok, true, 'about 63 percent: played')
})

test('tournaments: refused when three seated teams are clearly stronger, so the top three is out of reach (every level since 2026-11-06)', () => {
  const s = snapshot()
  const seated = [{ user_id: 501 }, { user_id: 502 }, { user_id: 503 }, { user_id: 504 }]
  const d = tournament(301, { max_teams: 8, min_teams: 8 }, seated) as TournamentDetail
  const strong = { strength: 1700, elo: 1260 } // above 1540 x 1.05 and 1200 + 50
  const weak = { strength: 1400, elo: 1180 }
  const field = (n: number) => seated.map((p, i) => ({ userId: p.user_id, ...(i < n ? strong : weak) }))
  const join = { type: 'join_tournament', tournament_id: 301 } as const
  const three = checkAction(join, s, ctx({ tournament: d, field: field(3) }))
  assert.equal(three.ok, false)
  assert.match((three as { refusal: string }).refusal, /3 seated teams are clearly stronger \(lineup and ELO\): no real chance of the top three/)
  assert.equal(checkAction(join, s, ctx({ tournament: d, field: field(2) })).ok, true)
})

test('private tournaments: every level (owner, 2026-11-06, OP-6), sized to the invites', () => {
  const s = snapshot()
  const base = { type: 'create_tournament', title: 'Varna Cup', format: 'round_robin', tier: 'silver', max_teams: 6, min_teams: 4, entry_fee_foxsy: 1000, starts_in_hours: 6, registration_closes_minutes_before: 60, round_interval_minutes: 60 }
  const parsed = parseAction({ ...base, invite_user_ids: [11, 12, 13] })
  assert.deepEqual((parsed as { invite_user_ids?: number[] }).invite_user_ids, [11, 12, 13])
  assert.throws(() => parseAction({ ...base, invite_user_ids: [11, 11] }), /holds a user id twice/)
  assert.throws(() => parseAction({ ...base, invite_user_ids: [0] }), /bad user id/)
  const refusal = (a: unknown, c: Partial<RulesContext>) => {
    const v = checkAction(a as never, s, ctx(c))
    return v.ok ? '' : (v as { refusal: string }).refusal
  }
  assert.doesNotMatch(refusal(parsed, {}), /Zeus|invite/, 'every level may make one private')
  // Every invited team is kept, one the owner runs too (owner, 2026-10-27: each agent plays as if it were alone).
  const three = checkAction(parsed as never, s, ctx({}))
  if (three.ok) assert.deepEqual(three.facts.invites, [11, 12, 13], 'the list FoxLeague gets is the plan\'s')
  else assert.doesNotMatch((three as { refusal: string }).refusal, /invite/)
  assert.equal((parseAction({ ...base, invite_user_ids: [] }) as { invite_user_ids?: number[] }).invite_user_ids, undefined, 'an empty list is a public tournament')
  assert.match(refusal(parseAction({ ...base, invite_user_ids: [1, 2, 3, 4, 5, 6] }), {}), /at most 5 invited teams for 6 seats/)
  assert.match(refusal(parseAction({ ...base, invite_user_ids: [11, 12] }), {}), /3 cannot reach the minimum of 4/)
  assert.doesNotMatch(refusal(parsed, {}), /invite/, 'a good invite list passes the invite checks')
})

test('Zeus never acts blind: an unread field is refused, an unread squad with a clearly higher ELO counts as stronger; an open 1v1 only with its range', () => {
  const s = snapshot()
  const seated = [{ user_id: 501 }, { user_id: 502 }, { user_id: 503 }, { user_id: 504 }]
  const d = tournament(301, { max_teams: 8, min_teams: 8 }, seated) as TournamentDetail
  const join = { type: 'join_tournament', tournament_id: 301 } as const
  const why = (c: Partial<RulesContext>) => { const v = checkAction(join, s, ctx({ tournament: d, ...c })); return v.ok ? '' : (v as { refusal: string }).refusal }
  assert.match(why({}), /the seated teams could not be read/)
  assert.match(why({ field: seated.map(p => ({ userId: p.user_id, strength: null, elo: null })) }), /4 seated teams could not be read/)
  assert.match(why({ field: seated.map(p => ({ userId: p.user_id, strength: null, elo: 1500 })) }), /4 seated teams are clearly stronger/)
  // Since 2026-11-06 (OP-2, OP-4) Zeus may post an open challenge, topped at its own best XI OVR, and none without the range.
  const open = checkAction({ type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: null, deadline_minutes: 60 }, s, ctx({}))
  assert.match(open.ok ? '' : (open as { refusal: string }).refusal, /an open challenge needs an OVR range/)
  assert.equal(checkAction({ type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: null, deadline_minutes: 60, ovr_min: 18, ovr_max: 20 }, s, ctx({ bestXiOvr: 20 })).ok, true)
})
