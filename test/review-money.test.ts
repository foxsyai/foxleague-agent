// Proof tests for the whole-project review of 2026-10-13 (money and limits). Each test is named after its finding
// (A = the money reviewer, C = the chain reviewer) and failed on main 5ab42c2 before the fix.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OTHER, STRANGER, dryWallet, setup, snapshot, tournament } from './fixtures.ts'
import type { PlannedAction } from '../src/executor/actions.ts'

const act = (action: unknown): PlannedAction[] => [{ action: action as PlannedAction['action'], reason: '' }]

// ---- A3 + C2: a 1v1 stake is never paid while the routes its gates read could not be read ----

const oneVOneRig = () =>
  setup({
    fox: {
      user: async (a: string) => (a === STRANGER ? { id: 900, wallet_address: STRANGER, elo_rating: 1200 } : null),
      tournament: async () => tournament(555, { max_teams: 2, min_teams: 2, creator_user_id: 900 }, [{ user_id: 900, wallet_address: STRANGER }]),
    },
  })
const join1v1 = act({ type: 'join_tournament', tournament_id: 555 })
const openChallenge = act({ type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: null, deadline_minutes: 60 })

test('A3 C2 control: with the own tournaments and upcoming matches readable, the 1v1 join and the challenge go through', async () => {
  const m = oneVOneRig()
  assert.equal((await m.exec.run(m.agent(), dryWallet, snapshot(), join1v1))[0]!.status, 'dry_run')
  assert.equal((await m.exec.run(m.agent(), dryWallet, snapshot(), openChallenge))[0]!.status, 'dry_run')
})

test('A3 C2 a 1v1 join pays no stake while the agent\'s own tournaments could not be read (an active 1v1 is unknown)', async () => {
  const m = oneVOneRig()
  const s = snapshot()
  s.auth!.myTournaments = null
  const [r] = await m.exec.run(m.agent(), dryWallet, s, join1v1)
  assert.equal(r!.status, 'refused', `my tournaments unreadable, yet: ${r!.summary}`)
  assert.match(r!.summary, /could not be read/)
})

test('A3 C2 a 1v1 join pays no stake while the upcoming matches could not be read (the one-hour gate is unknown)', async () => {
  const m = oneVOneRig()
  const s = snapshot()
  s.auth!.upcoming = null
  const [r] = await m.exec.run(m.agent(), dryWallet, s, join1v1)
  assert.equal(r!.status, 'refused', `upcoming matches unreadable, yet: ${r!.summary}`)
  assert.match(r!.summary, /could not be read/)
})

test('A3 C2 a targeted 1v1 (to this team) is not joined blind either', async () => {
  const rival = { id: 900, wallet_address: OTHER, elo_rating: 1200 }
  const targeted = () => tournament(77, { max_teams: 2, min_teams: 2, creator_user_id: 900, target_user_id: 100, targeted_to_you: true }, [{ user_id: 900, wallet_address: OTHER }])
  for (const blind of ['myTournaments', 'upcoming'] as const) {
    const m = setup({ fox: { tournament: async () => targeted(), user: async () => rival } })
    const s = snapshot()
    s.auth![blind] = null
    const [r] = await m.exec.run(m.agent(), dryWallet, s, act({ type: 'join_tournament', tournament_id: 77 }))
    assert.equal(r!.status, 'refused', `${blind} unreadable, yet: ${r!.summary}`)
  }
})

test('A3 C2 a 1v1 challenge pays no stake while the own tournaments or the upcoming matches could not be read', async () => {
  for (const blind of ['myTournaments', 'upcoming'] as const) {
    const m = oneVOneRig()
    const s = snapshot()
    s.auth![blind] = null
    const [r] = await m.exec.run(m.agent(), dryWallet, s, openChallenge)
    assert.equal(r!.status, 'refused', `${blind} unreadable, yet: ${r!.summary}`)
    assert.match(r!.summary, /could not be read/)
  }
})

test('A3 C2 the within-the-hour check refuses on unreadable upcoming matches (a casual match is not started blind)', async () => {
  const m = setup()
  const s = snapshot()
  s.auth!.upcoming = null
  const [r] = await m.exec.run(m.agent(), dryWallet, s, act({ type: 'play_match', match_type: 'casual' }))
  assert.equal(r!.status, 'refused', `upcoming matches unreadable, yet: ${r!.summary}`)
  assert.match(r!.summary, /could not be read/)
})
