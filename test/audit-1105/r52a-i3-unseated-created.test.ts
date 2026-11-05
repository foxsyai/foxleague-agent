// R52A-I3 (audit of PR #51, what the plan sees): OPEN-8 flags every open tournament the agent created and holds no
// seat in, 1v1s included, and the digest tells the plan "take it with join_tournament". For a 1v1 the agent created
// the executor refuses that join every time (oneVOneStateRefusal: 'already in an active 1v1'; and a 1v1 with no seated
// creator is '1v1 creator has not paid yet'), and a 1v1 owes no organizer deposit: unaccepted at its deadline it is
// cancelled and the creator refunded in full (FOXLEAGUE-INTEGRATION 10.x). The line sends every plan to a dead end.
// The same happens for a created tournament that filled up without the creator: the executor refuses 'full'.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { takeSnapshot } from '../../src/snapshot/snapshot.ts'
import { renderDigest } from '../../src/snapshot/digest.ts'
import { ADDR, OTHER, STRANGER, dryWallet, setup, snapshot } from '../fixtures.ts'

const HOUR = 3600_000
const at = (h: number) => new Date(Date.now() + h * HOUR).toISOString()

function deps(created: Record<string, unknown>, participants: unknown[]) {
  const fox: Record<string, unknown> = {
    config: async () => snapshot().config, user: async (a: string) => (a === ADDR ? snapshot().profile : null), team: async () => snapshot().team,
    players: async () => [], tournaments: async () => [], leaderboard: async () => ({ users: [], total: 0, limit: 200, offset: 0 }), listings: async () => [],
    floorPrices: async () => [], shopStatus: async () => snapshot().auth!.shop, dailyAllowance: async () => snapshot().auth!.allowance, activeMatch: async () => null,
    myTournaments: async () => ({ active: [created], completed: [] }), upcomingMatches: async () => ({ lead_minutes: 30, my_team_name: 'Agent', matches: [] }), challengesForMe: async () => [],
    tournament: async (id: number) => (id === created.id ? { tournament: created, participants } : assert.fail(`T${id}`)),
    matchHistory: async () => [], matchFormations: async () => null,
  }
  const chain = { account: async () => ({ balance: 0n, nonce: 1 }), esdts: async () => [], egldUsd: async () => 25, query: async () => { throw new Error('no pool') } }
  return { chain, fox } as never
}

test('R52A-I3a: a 1v1 the agent created with no seat of its own is told to the plan as "take it with join_tournament", which the executor refuses', async () => {
  const duel = { id: 55, title: 'Duel', status: 'open', tier: 'silver', format: 'knockout', max_teams: 2, min_teams: 2, entry_fee_foxsy: 1000, creator_user_id: 100, participant_count: 0, target_user_id: null, targeted: false, challenge_deadline_minutes: 120, deadline: at(2), starts_at: at(2), is_private: false, developer_mode: false, home_and_away: false, sc_tournament_id: 55 }
  const digest = renderDigest(await takeSnapshot(deps(duel, []), { wallet: dryWallet }))
  const line = digest.split('\n').find(l => l.startsWith('My active tournament: T55')) ?? ''
  // What the executor does with that advice: the join of its own 1v1 is refused (no stake paid, but every plan is sent here).
  const m = setup({ fox: { tournament: async () => ({ tournament: duel, participants: [] }) } })
  const s = snapshot()
  s.auth!.myTournaments = { active: [duel], completed: [] } as never
  const [r] = await m.exec.run(m.agent(), dryWallet, s, [{ action: { type: 'join_tournament', tournament_id: 55 }, reason: '' }])
  assert.equal(r!.status, 'refused', r!.summary)
  assert.doesNotMatch(line, /take it with join_tournament/, `the plan is told to take a seat the executor refuses ("${r!.summary}"): ${line}`)
})

test('R52A-I3b: a created tournament that filled up without its creator is still told as "take it with join_tournament", which the executor refuses as full', async () => {
  const cup = { id: 56, title: 'Autumn Cup', status: 'open', tier: 'silver', format: 'knockout', max_teams: 4, min_teams: 4, entry_fee_foxsy: 1000, creator_user_id: 100, participant_count: 4, target_user_id: null, deadline: at(5), starts_at: at(6), is_private: false, developer_mode: false, home_and_away: false, sc_tournament_id: 56 }
  const seated = [{ user_id: 901, wallet_address: OTHER }, { user_id: 902, wallet_address: STRANGER }, { user_id: 903, wallet_address: OTHER }, { user_id: 904, wallet_address: STRANGER }]
  const digest = renderDigest(await takeSnapshot(deps(cup, seated), { wallet: dryWallet }))
  const line = digest.split('\n').find(l => l.startsWith('My active tournament: T56')) ?? ''
  const m = setup({ fox: { tournament: async () => ({ tournament: cup, participants: seated }) } })
  const s = snapshot()
  s.auth!.myTournaments = { active: [cup], completed: [] } as never
  const [r] = await m.exec.run(m.agent(), dryWallet, s, [{ action: { type: 'join_tournament', tournament_id: 56 }, reason: '' }])
  assert.equal(r!.status, 'refused', r!.summary)
  assert.match(r!.summary, /full/, r!.summary)
  assert.doesNotMatch(line, /take it with join_tournament/, `the plan is told to take a seat the executor refuses ("${r!.summary}"): ${line}`)
})
