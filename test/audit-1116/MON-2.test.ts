// MON-2 (rule 4): the 2-a-week limit per rival counts a 1v1 "still open, played or unknown" (docs/SECURITY-REVIEW.md, D11).
// A targeted challenge whose stake was signed and sent, and whose POST /join then answered a refusal, ends as an error
// row: FoxLeague seats the creator of a 1v1 from the paid entry (the executor's own words), so the 1v1 may be played.
// oneVOnesThisWeek counts only confirmed and unconfirmed rows: this one is read as "no 1v1", and a third follows.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setup, snapshot, tournament, liveWallet, withLive } from '../fixtures.ts'
import { ApiRefusal } from '../../src/foxleague/api.ts'
import { oneVOnesThisWeek } from '../../src/executor/rivals.ts'
import type { PlannedAction } from '../../src/executor/actions.ts'

const RIVAL = 900
const CHALLENGE: PlannedAction = { action: { type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: RIVAL, deadline_minutes: 60 }, reason: 'test' }
const OTHER = 'erd1qyu5wthldzr8wx5c9ucg8kjagg0jfs53s8nr3zpz3hypefsdd8ssycr6th'

function world() {
  let id = 50
  const s = () => {
    const x = snapshot()
    x.leaderboardNeighbours = [{ id: RIVAL, wallet_address: OTHER, team_name: 'Rival', elo_rating: 1200, league: 'Bronze', accepted7d: 1, matches: 10, bestXiOvr: 18 }] as never
    return x
  }
  const m = setup({
    fox: {
      user: async () => ({ id: RIVAL, elo_rating: 1200 }),
      createTournament: async () => ({ id: ++id }),
      tournament: async (n: number) => tournament(n, { max_teams: 2, min_teams: 2, creator_user_id: 100, target_user_id: RIVAL }),
      // The stake is on chain; FoxLeague's join answers its own refusal (not a tx_pending, not "retry").
      joinTournament: async () => { throw new ApiRefusal('Could not seat the team right now.') },
    },
    chain: { send: async () => `hash${id}` },
  })
  return { m, s }
}

test('MON-2: a 1v1 whose stake was sent and whose seat is unknown counts toward the 2 a week against that rival', async () => {
  const { m, s } = world()
  await withLive(m.store, async () => {
    for (let i = 0; i < 2; i++) {
      const [r] = await m.exec.run(m.agent(), liveWallet, s(), [CHALLENGE])
      assert.equal(r!.status, 'error', r!.summary)
      assert.match(r!.summary, /paid hash\d+ but not seated/)
      assert.equal(r!.sent, true, 'the stake was signed and sent')
    }
    // Both stakes left the wallet (still booked), and nothing says they came back.
    const open = m.store.openSpend(0, 'join:', false)
    assert.equal(open.length, 2, 'two stakes are booked as paid')
    assert.equal(oneVOnesThisWeek(m.store, 0, false, new Date()).get(RIVAL)?.length ?? 0, 2, 'two 1v1s against the rival whose outcome is unknown count as two')
    const [third] = await m.exec.run(m.agent(), liveWallet, s(), [CHALLENGE])
    assert.equal(third!.status, 'refused', `a third stake against the same rival in 7 days: ${third!.summary}`)
    assert.match(third!.summary, /already 2 1v1s/)
  })
})
