// Audit 2026-11-11 (Fable 5.2 reviewers at extra-high effort): the proof of MONEY-2, failing before its fix.
// MONEY-2 (final audit 2026-11-11): the 55 percent floor of a 1v1 averages the ELO chance and the squad chance. A rival
// whose eleven is 10 percent stronger (the squad alone gives us 32 percent by the code's own SQUAD_K) passes the floor
// as soon as its ELO is about 220 lower than ours, and ELO is the number a rival controls downward (AA1).
import test from 'node:test'
import assert from 'node:assert/strict'

import { setup, snapshot, dryWallet, tournament, rivalSquad, OTHER, TEST_SETTINGS } from '../fixtures.ts'
import { checkAction } from '../../src/executor/rules.ts'
import { winChance } from '../../src/snapshot/winchance.ts'

test('MONEY-2: a 1v1 against an eleven 10 percent stronger is not taken because the rival shows a low ELO (executor, dry run)', async () => {
  // Ours: 1540 at full condition, ELO 1450 (an agent that climbed). The rival: 11 x 154 = 1694 (exactly 10 percent
  // stronger, so A2's ratio lets it through), ELO 1200 (a new team, or one that lost on purpose).
  const s = snapshot()
  s.profile!.elo_rating = 1450
  const d = tournament(401, { max_teams: 2, min_teams: 2, tier: 'silver', entry_fee_foxsy: 3000, creator_user_id: 900 }, [{ user_id: 900, wallet_address: OTHER }])
  const rival = rivalSquad(22)
  const m = setup({ fox: { tournament: async () => d, user: async () => ({ elo_rating: 1200 }), team: rival.team, players: rival.players, leaderboard: async () => ({ users: [] }) } })
  const [r] = await m.exec.run(m.agent(), dryWallet, s, [{ action: { type: 'join_tournament', tournament_id: 401 }, reason: 'proof' }])
  const squadOnly = winChance({ myElo: null, oppElo: null, myStrength: 1540, oppStrength: 1694 })
  assert.equal(r!.status, 'refused', `the stake of 3,000 FOXSY would be paid although the squads alone give ${squadOnly} (${r!.status}: ${r!.summary})`)
})

test('MONEY-2: the same for a challenge the agent sends to a named team', () => {
  const s = snapshot()
  s.profile!.elo_rating = 1450
  const v = checkAction(
    { type: 'create_challenge', tier: 'silver', stake_foxsy: 3000, target_user_id: 900, deadline_minutes: 60 },
    s,
    { settings: TEST_SETTINGS, now: new Date(), opponent: { userId: 900, elo: 1200, strength: 1694 }, oneVOneWithOpponentThisWeek: 0 },
  )
  assert.equal(v.ok, false, `the rules let the stake through: the floor reads ${winChance({ myElo: 1450, oppElo: 1200, myStrength: 1540, oppStrength: 1694 })} where the squads alone give ${winChance({ myElo: null, oppElo: null, myStrength: 1540, oppStrength: 1694 })}`)
  assert.match(String(v.refusal), /the win chance against user 900 is about 32 percent; a 1v1 against a known team is played from 55 percent/)
})

// Added with the fix: the rule the owner approved on 2026-11-11. With both numbers read, the estimate is the smaller
// of their average and the squad-only chance: a rival's lower ELO may lower our chance, never lift it above what the
// squads alone give. With one number read, the estimate is that number's, as before.
test('MONEY-2: the estimate is the smaller of the average and the squad-only chance when both are read', () => {
  const squads = (mine: number, theirs: number) => winChance({ myElo: null, oppElo: null, myStrength: mine, oppStrength: theirs })!
  // A weaker eleven of ours (theirs 10 percent stronger): no ELO of the rival, however low, lifts the chance above the squads'.
  assert.equal(squads(1540, 1694), 0.32)
  for (const oppElo of [1200, 1000, 600]) assert.equal(winChance({ myElo: 1450, oppElo, myStrength: 1540, oppStrength: 1694 }), 0.32, `rival ELO ${oppElo}`)
  // A rival's ELO that says more for us than the squads do (37 percent at +90) lifts nothing either.
  assert.equal(winChance({ myElo: 1200, oppElo: 1290, myStrength: 1540, oppStrength: 1694 }), 0.32)
  // A rival's much higher ELO still lowers it: the average is then the smaller one.
  assert.equal(winChance({ myElo: 1200, oppElo: 1400, myStrength: 1540, oppStrength: 1694 }), 0.28)
  // A stronger eleven of ours: a rival's higher ELO lowers the estimate under the squads' 68 percent, a lower one does not lift it over.
  assert.equal(squads(1650, 1500), 0.68)
  assert.equal(winChance({ myElo: 1200, oppElo: 1200, myStrength: 1650, oppStrength: 1500 }), 0.59)
  assert.equal(winChance({ myElo: 1400, oppElo: 1200, myStrength: 1650, oppStrength: 1500 }), 0.68, 'the average would be 0.72')
  // Equal teams, and one number alone: as before.
  assert.equal(winChance({ myElo: 1200, oppElo: 1200, myStrength: 1500, oppStrength: 1500 }), 0.5)
  assert.equal(winChance({ myElo: 1400, oppElo: 1200, myStrength: null, oppStrength: null }), 0.76)
  assert.equal(winChance({ myElo: null, oppElo: 1200, myStrength: null, oppStrength: 1500 }), null)
})

test('MONEY-2: a 1v1 is played from 55 percent by that estimate: our eleven a little stronger at an even ELO is, an even eleven is not', () => {
  const challenge = (strength: number, elo: number) => checkAction(
    { type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: 900, deadline_minutes: 60 },
    snapshot(),
    { settings: TEST_SETTINGS, now: new Date(), opponent: { userId: 900, elo, strength }, oneVOneWithOpponentThisWeek: 0 },
  )
  // Ours is 1540 at ELO 1200. A rival 10 percent weaker at our ELO: 60 percent, played (as before).
  assert.equal(challenge(1386, 1200).ok, true)
  // An even eleven with an ELO 100 below ours: the average was 57 percent and played; the squads alone give 50.
  assert.match(String(challenge(1540, 1100).refusal), /about 50 percent/)
  // Our eleven about 3 percent stronger with that ELO: the squads give 56 percent, played.
  assert.equal(challenge(1495, 1100).ok, true)
})

test('MONEY-2: the plan is told how the chance it reads is made', async () => {
  const { renderDigest } = await import('../../src/snapshot/digest.ts')
  const s = snapshot()
  s.leaderboardNeighbours = [{ id: 900, wallet_address: OTHER, username: null, elo_rating: 1200, league: 'Bronze', matches_won: 0, matches_lost: 0, matches_drawn: 0, team_name: 'Rival', badge: null, verified: false, tournament_wins: 0, active_title: null, player_count: 18, strength: 1694, winChance: 0.32 }] as never
  assert.match(renderDigest(s), /Win chances: the ELO expectation and the lineup strength averaged, and never above what the lineups alone give \(a rival's low ELO lifts no chance\), ours at today's condition, theirs at full condition; a 1v1 against a known team is played from 55 percent\./)
})
