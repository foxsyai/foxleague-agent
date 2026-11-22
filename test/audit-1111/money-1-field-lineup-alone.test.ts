// Audit 2026-11-11 (Fable 5.2 reviewers at extra-high effort): the proof of MONEY-1, failing before its fix.
// MONEY-1 (final audit 2026-11-11): the podium rule counts a seated team as "clearly stronger" only when its ELO is
// ALSO more than 50 above ours. ELO is the one number a rival controls downward (a new team starts at 1200, a team
// can lose on purpose), so a field of far stronger elevens at our own ELO counts 0 stronger and the entry is paid.
import test from 'node:test'
import assert from 'node:assert/strict'

import { setup, snapshot, dryWallet, tournament, rivalSquad, TEST_SETTINGS } from '../fixtures.ts'
import { checkAction, judgeField } from '../../src/executor/rules.ts'
import type { TournamentDetail } from '../../src/foxleague/types.ts'

test('MONEY-1: seven seated teams with elevens twice as strong as ours and our own ELO are no field to pay into (executor, dry run)', async () => {
  // Our eleven: 11 cards x 140 = 1540 at full condition, ELO 1200. Every seated rival: 11 x 280 = 3080, ELO 1200.
  const seated = Array.from({ length: 7 }, (_, i) => ({ user_id: 501 + i, wallet_address: `erd1seat${501 + i}` }))
  const d = tournament(301, { max_teams: 8, min_teams: 8, format: 'knockout', tier: 'silver', entry_fee_foxsy: 3000 }, seated)
  const monster = rivalSquad(40)
  const m = setup({ fox: { tournament: async () => d, user: async () => ({ elo_rating: 1200 }), team: monster.team, players: monster.players } })
  const [r] = await m.exec.run(m.agent(), dryWallet, snapshot(), [{ action: { type: 'join_tournament', tournament_id: 301 }, reason: 'proof' }])
  assert.equal(r!.status, 'refused', `the executor would pay 3,000 FOXSY into a field where all 7 seated elevens are twice as strong: ${r!.status}: ${r!.summary}`)
})

test('MONEY-1: the same at the rule: a lineup twice ours is clearly stronger whatever its ELO says', () => {
  const seats = Array.from({ length: 7 }, (_, i) => ({ userId: 501 + i, strength: 3080, elo: 1200 }))
  const judged = judgeField(seats, 1540, 1200)
  assert.equal(judged.stronger, 7, `judgeField counts ${judged.stronger} clearly stronger and ${judged.even} even`)
  const d = tournament(302, { max_teams: 8, min_teams: 8, entry_fee_foxsy: 3000 }, seats.map(s => ({ user_id: s.userId })))
  const v = checkAction({ type: 'join_tournament', tournament_id: 302 }, snapshot(), { settings: TEST_SETTINGS, now: new Date(), tournament: d as TournamentDetail, field: seats })
  assert.equal(v.ok, false, 'the join passes the rules')
})

// Added with the fix: where the lineup alone decides (more than the 10 percent of the 1v1 rule), what stays as it was
// (5 to 10 percent needs the ELO too; an unread lineup is judged on its ELO), and what the plan is told.
test('MONEY-1: a lineup more than 10 percent above ours is clearly stronger at any ELO; up to 10 percent it needs the ELO too', () => {
  const one = (strength: number | null, elo: number | null) => judgeField([{ userId: 1, strength, elo }], 1000, 1200)
  // More than 10 percent above ours: stronger whatever its ELO, also far below ours or unread.
  assert.equal(one(1101, 1200).stronger, 1)
  assert.equal(one(1101, 900).stronger, 1, 'a low ELO does not make a stronger eleven even')
  assert.deepEqual([one(1101, null).stronger, one(1101, null).unread], [1, 0], 'its lineup was read: it is no unknown')
  // Exactly 10 percent, and between 5 and 10: the ELO still has its say, as before.
  assert.deepEqual([one(1100, 1200).stronger, one(1100, 1200).even], [0, 1])
  assert.equal(one(1080, 1251).stronger, 1)
  assert.deepEqual([one(1080, 1250).stronger, one(1080, 1250).even], [0, 1])
  // An unread lineup: the ELO alone, as before.
  assert.equal(one(null, 1251).stronger, 1)
  assert.deepEqual([one(null, 1250).stronger, one(null, 1250).unread], [0, 1])
  // A weaker eleven is never stronger by this rule.
  assert.deepEqual([one(900, 1100).stronger, one(900, 1100).weaker], [0, 1])
})

test('MONEY-1: two such teams are still a field to enter, three are not, and the refusal and the snapshot say how they are counted', () => {
  const monster = (id: number) => ({ userId: id, strength: 3080, elo: 1200 })
  const even = (id: number) => ({ userId: id, strength: 1500, elo: 1200 })
  const join = (field: { userId: number; strength: number; elo: number }[]) => {
    const d = tournament(303, { max_teams: 8, min_teams: 8, entry_fee_foxsy: 3000 }, field.map(f => ({ user_id: f.userId })))
    return checkAction({ type: 'join_tournament', tournament_id: 303 }, snapshot(), { settings: TEST_SETTINGS, now: new Date(), tournament: d as TournamentDetail, field })
  }
  assert.equal(join([monster(1), monster(2), even(3), even(4)]).ok, true)
  assert.match(String(join([monster(1), monster(2), monster(3), even(4)]).refusal), /3 seated teams are clearly stronger \(a lineup more than 10 percent above yours or more than 5 percent above yours with an ELO more than 50 above yours\): no real chance of the top three/)
})

test('MONEY-1: the plan\'s field line counts as the rule does and its legend says so', async () => {
  const { renderDigest } = await import('../../src/snapshot/digest.ts')
  const s = snapshot()
  const t = (tournament(304, { max_teams: 8, min_teams: 8, entry_fee_foxsy: 3000 }) as TournamentDetail).tournament
  s.market.openStandard = [{ ...t, seated: 7 }] as never
  s.market.fields = [{ id: 304, seated: 7, seats: Array.from({ length: 7 }, (_, i) => ({ userId: 501 + i, strength: 3080, elo: 1200 })) }]
  const d = renderDigest(s)
  assert.match(d, /field: 7 clearly stronger, 0 even, 0 clearly weaker/)
  assert.match(d, /a seated team is clearly stronger when its lineup \(each card at the stronger of its synced and live stats, at full condition\) is more than 10 percent above yours at the tournament's start, whatever its ELO, or more than 5 percent above yours with an ELO more than 50 above yours/)
})
