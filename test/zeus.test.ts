import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkAction, type RulesContext } from '../src/executor/rules.ts'
import { parseAction } from '../src/executor/actions.ts'
import { winChance, percent } from '../src/snapshot/winchance.ts'
import { LEVEL_AI, LEVEL_SETTINGS, STRATEGY_PRESETS, isZeus, validateSettingsPatch } from '../src/store/settings.ts'
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
  assert.equal(isZeus(STRATEGY_PRESETS.zeus!), true)
  assert.equal(isZeus(STRATEGY_PRESETS.beast!), false)
  assert.equal(validateSettingsPatch({ strategy: STRATEGY_PRESETS.zeus! }).strategy, STRATEGY_PRESETS.zeus)
  const z = LEVEL_SETTINGS.zeus!
  assert.deepEqual([z.dailyCapUsd, z.monthlyBudgetUsd, z.topUpWarningUsd, z.maxBidFoxsy, z.tickMinutes], [150, 3000, 300, 38_000, 60])
  assert.equal(z.topUpWarningUsd, 2 * z.dailyCapUsd, 'the warning at two days of play')
  assert.deepEqual(LEVEL_AI.zeus, { model: 'claude-opus-5-5', effort: 'high' })
  assert.deepEqual(Object.keys(LEVEL_AI), Object.keys(STRATEGY_PRESETS), 'a recommended AI for every level')
})

test('Zeus 1v1: refused under a 55 percent win chance, where the other levels may still play it', () => {
  const s = snapshot() // our eleven: 11 x 140 = 1540 at full condition, ELO 1200
  const challenge = { type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: 55, deadline_minutes: 60 } as const
  const tough = { userId: 55, elo: 1250, strength: 1600 }
  assert.equal(checkAction(challenge, s, ctx({ opponent: tough })).ok, true, 'within the gates for every level')
  const z = checkAction(challenge, s, ctx({ opponent: tough, zeus: true }))
  assert.equal(z.ok, false)
  assert.match((z as { refusal: string }).refusal, /win chance against user 55 is about 43 percent; Zeus plays a 1v1 from 55 percent/)
  assert.equal(checkAction(challenge, s, ctx({ opponent: { userId: 55, elo: 1150, strength: 1400 }, zeus: true })).ok, true, 'about 63 percent: played')
})

test('Zeus tournaments: refused when three seated teams are clearly stronger, so the top three is out of reach', () => {
  const s = snapshot()
  const seated = [{ user_id: 501 }, { user_id: 502 }, { user_id: 503 }, { user_id: 504 }]
  const d = tournament(301, { max_teams: 8, min_teams: 8 }, seated) as TournamentDetail
  const strong = { strength: 1700, elo: 1260 } // above 1540 x 1.05 and 1200 + 50
  const weak = { strength: 1400, elo: 1180 }
  const field = (n: number) => seated.map((p, i) => ({ userId: p.user_id, ...(i < n ? strong : weak) }))
  const join = { type: 'join_tournament', tournament_id: 301 } as const
  const three = checkAction(join, s, ctx({ tournament: d, zeus: true, field: field(3) }))
  assert.equal(three.ok, false)
  assert.match((three as { refusal: string }).refusal, /3 seated teams are clearly stronger \(lineup and ELO\): no real chance of the top three/)
  assert.equal(checkAction(join, s, ctx({ tournament: d, zeus: true, field: field(2) })).ok, true)
  assert.equal(checkAction(join, s, ctx({ tournament: d, field: field(4) })).ok, true, 'the other levels decide by the plan')
})

test('private tournaments: Zeus only, the owner\'s own teams left out without a word, sized to the invites', () => {
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
  assert.match(refusal(parsed, {}), /only the Zeus level creates private tournaments/)
  // An own team is dropped silently; with too few left the refusal names no team.
  const short = refusal(parsed, { zeus: true, ownUserIds: [12] })
  assert.match(short, /3 cannot reach the minimum of 4; invite more active teams/)
  assert.doesNotMatch(short, /12/)
  const three = checkAction(parseAction({ ...base, min_teams: 3, invite_user_ids: [11, 12, 13] }) as never, s, ctx({ zeus: true, ownUserIds: [12] }))
  if (three.ok) assert.deepEqual(three.facts.invites, [11, 13], 'the list FoxLeague gets leaves the own team out')
  else assert.doesNotMatch((three as { refusal: string }).refusal, /invite/)
  assert.equal((parseAction({ ...base, invite_user_ids: [] }) as { invite_user_ids?: number[] }).invite_user_ids, undefined, 'an empty list is a public tournament')
  assert.match(refusal(parseAction({ ...base, invite_user_ids: [1, 2, 3, 4, 5, 6] }), { zeus: true }), /at most 5 invited teams for 6 seats/)
  assert.match(refusal(parseAction({ ...base, invite_user_ids: [11, 12] }), { zeus: true }), /3 cannot reach the minimum of 4/)
  assert.doesNotMatch(refusal(parsed, { zeus: true, ownUserIds: [99] }), /invite/, 'a good invite list passes the invite checks')
})

test('Zeus never acts blind: an unread field is refused, an unread squad with a clearly higher ELO counts as stronger, no open 1v1', () => {
  const s = snapshot()
  const seated = [{ user_id: 501 }, { user_id: 502 }, { user_id: 503 }, { user_id: 504 }]
  const d = tournament(301, { max_teams: 8, min_teams: 8 }, seated) as TournamentDetail
  const join = { type: 'join_tournament', tournament_id: 301 } as const
  const why = (c: Partial<RulesContext>) => { const v = checkAction(join, s, ctx({ tournament: d, zeus: true, ...c })); return v.ok ? '' : (v as { refusal: string }).refusal }
  assert.match(why({}), /the seated teams could not be read/)
  assert.match(why({ field: seated.map(p => ({ userId: p.user_id, strength: null, elo: null })) }), /4 seated teams could not be read/)
  assert.match(why({ field: seated.map(p => ({ userId: p.user_id, strength: null, elo: 1500 })) }), /4 seated teams are clearly stronger/)
  const open = checkAction({ type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: null, deadline_minutes: 60 }, s, ctx({ zeus: true }))
  assert.match(open.ok ? '' : (open as { refusal: string }).refusal, /Zeus plays a 1v1 only against a named team/)
})
