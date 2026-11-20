// OWN-1 (production, 19 Nov 2026): the model's own words decided that a tournament was the owner's. Since 15 Nov the
// owner's strategy text of every agent has an "Organizer:" line, and the models write reasons like "Owner's organizer
// instruction. ...". `ownCreations` skipped a create row whose reason began with "owner", so agent 4 was refused
// widening T6101, which it created itself ("a tournament or challenge this agent did not create (the owner's)"), and an
// unfilled organizer tournament keeps the organizer's deposit. Ownership is what the executor itself wrote (`byOwner`),
// never model or owner text. The same test held a League + Knockout seat the agent paid itself as the owner's.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAction } from '../../src/executor/actions.ts'
import { ownCreations } from '../../src/executor/rivals.ts'
import type { TournamentDetail } from '../../src/foxleague/types.ts'
import type { Store } from '../../src/store/db.ts'
import { dryWallet, liveWallet, setup, snapshot, tournament, withLive } from '../fixtures.ts'

const H = 3600_000
const ME = snapshot().profile!.id
const MODEL_REASON = "Owner's organizer instruction. In an OVR 36-41 field the agent is the strongest; widen to fill it."
const mine = (more: Record<string, unknown> = {}) => tournament(6101, { max_teams: 8, min_teams: 4, creator_user_id: ME, ovr_min: 36, ovr_max: 41, ...more }, [{ user_id: ME }]) as TournamentDetail
/** The activity row of a live create that made the tournament, as the executor writes it (createdTournamentId). */
const created = (store: Store, id: number, more: Record<string, unknown> = {}) =>
  store.log({ agentIndex: 0, kind: 'create_tournament', status: 'confirmed', summary: `create (T${id})`, detail: { action: { type: 'create_tournament' }, ...more, createdTournamentId: id } })
/** Dates the newest activity row back to `iso` (the store writes rows at now). */
const dateNewest = (store: Store, iso: string) => {
  const db = (store as unknown as { db: { prepare: (q: string) => { run: (...a: unknown[]) => unknown } } }).db
  db.prepare('UPDATE activity SET at = ? WHERE id = (SELECT MAX(id) FROM activity)').run(iso)
}

test('OWN-1 a create row with a model reason "Owner\'s organizer instruction" is the agent\'s own: widen allowed', async () => {
  const widened: number[] = []
  const m = setup({ fox: { tournament: async () => mine(), widenOvrRange: async (_w: unknown, id: number) => { widened.push(id); return { ovr_min: 30, ovr_max: 41 } } } })
  // The row of 16 Nov 14:05 UTC: createdTournamentId 6101, no byOwner, the model's reason.
  created(m.store, 6101, { reason: MODEL_REASON })
  created(m.store, 6102, { reason: "Owner's organizer order: a Silver knockout every day." })
  assert.deepEqual([...ownCreations(m.store, 0, new Date())].sort(), [6101, 6102], 'the model\'s words never make a creation the owner\'s')
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, snapshot(), [{ action: parseAction({ type: 'widen_range', tournament_id: 6101, ovr_min: 30 }), reason: MODEL_REASON }])
    assert.equal(r!.status, 'confirmed', r!.summary)
  })
  assert.deepEqual(widened, [6101])
})

test('OWN-1 a create row with byOwner stays the owner\'s, whatever its reason says', async () => {
  const m = setup({ fox: { tournament: async () => mine(), widenOvrRange: async () => assert.fail('the owner\'s range is never widened by the agent') } })
  created(m.store, 6101, { reason: 'owner (Telegram /do)', byOwner: true })
  created(m.store, 6102, { reason: 'Agent plan: fill the field', byOwner: true })
  assert.deepEqual([...ownCreations(m.store, 0, new Date())], [])
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, snapshot(), [{ action: parseAction({ type: 'widen_range', tournament_id: 6101, ovr_min: 30 }), reason: '' }])
    assert.equal(r!.status, 'refused', r!.summary)
    assert.match(r!.summary, /this agent did not create \(the owner's\)/)
  })
})

// No fallback is kept for creations: createdTournamentId is written since 468fb2a (PR #38, 26 Oct), and every path that
// acts for the owner (Telegram /do, the owner's leave) writes byOwner since 8ceeb56 (PR #32, 24 Oct), an ancestor.
test('OWN-1 no text decides a creation: an owner-like reason without byOwner is the agent\'s, even on an old row', () => {
  const m = setup()
  created(m.store, 6201, { reason: 'owner (Telegram /do)' })
  dateNewest(m.store, new Date(Date.now() - 20 * 86_400_000).toISOString())
  created(m.store, 6202, { reason: 'owner asked for it' })
  assert.deepEqual([...ownCreations(m.store, 0, new Date())].sort(), [6201, 6202])
})

// ---- the League + Knockout seat (the other place a reason decided) ----

const lk = (more: Record<string, unknown> = {}) => tournament(3001, { format: 'league_knockout', max_teams: 36, min_teams: 36, entry_fee_foxsy: 2000, round_interval_minutes: 60, deadline: new Date(Date.now() + 48 * H).toISOString(), starts_at: new Date(Date.now() + 49 * H).toISOString(), ...more }, [{ user_id: ME }]) as TournamentDetail
const leave = { action: { type: 'leave_tournament' as const, tournament_id: 3001 }, reason: '' }
const lockIn10h = async () => ({ invitations: [], seats_lock_at: new Date(Date.now() + 10 * H).toISOString() })
const joined = (store: Store, more: Record<string, unknown>) =>
  store.log({ agentIndex: 0, kind: 'join_tournament', status: 'dry_run', summary: 'DRY RUN would join tournament T3001', detail: { action: { type: 'join_tournament', tournament_id: 3001 }, ...more } })

test('OWN-1 a League + Knockout seat the agent paid itself with a model reason "Owner\'s ..." is its own to leave', async () => {
  const m = setup({ fox: { tournament: async () => lk(), leagueInvitationsView: lockIn10h } })
  joined(m.store, { reason: "Owner's instruction: accept every Champions invitation." })
  const [r] = await m.exec.run(m.agent(), dryWallet, snapshot(), [leave])
  assert.equal(r!.status, 'dry_run', r!.summary)
})

test('OWN-1 a seat with byOwner stays the owner\'s; an owner reason counts only on a row from before byOwner was kept', async () => {
  const owner = setup({ fox: { tournament: async () => lk(), leagueInvitationsView: lockIn10h } })
  joined(owner.store, { reason: 'Agent plan', byOwner: true })
  assert.match((await owner.exec.run(owner.agent(), dryWallet, snapshot(), [leave]))[0]!.summary, /did not pay itself/)
  // A Telegram /do join of 20 Oct, before 8ceeb56 (PR #32, deployed 24 Oct 10:24 UTC) kept byOwner: the owner's seat.
  const old = setup({ fox: { tournament: async () => lk(), leagueInvitationsView: lockIn10h } })
  joined(old.store, { reason: 'owner (Telegram /do)' })
  dateNewest(old.store, '2026-10-20T09:00:00.000Z')
  assert.match((await old.exec.run(old.agent(), dryWallet, snapshot(), [leave]))[0]!.summary, /did not pay itself/)
})
