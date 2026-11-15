// Audit 2026-11-11 (Fable 5.2 reviewers at extra-high effort): the proof of EDGE-5, failing before its fix.
// EDGE: an entry is refused only once the registration deadline has passed. A plan's actions run at random moments
// over 80 percent of the cycle, and the snapshot shows the tournaments closing soonest first, so a join can be signed
// seconds before the deadline. The payment then settles and reaches FoxLeague's join gate after it: "Registration
// deadline has passed", the entry refunded on chain and the gas lost (the tournaments contract itself does not check
// the deadline, docs/FOXLEAGUE-INTEGRATION.md 10.4). The same was closed with a 120 s margin for the 1v1 busy hour
// (LIVE-1, R58A-1) and with 30 minutes for an invitation's expiry; the plain deadline has none. The refunded entry
// then keeps counting against the daily cap until the tournament is over, and the pending retry hears "deadline has
// passed" every minute, which is not among its final answers.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OTHER, dryWallet, setup, snapshot, tournament } from '../fixtures.ts'
import type { PlannedAction } from '../../src/executor/actions.ts'

const act = (action: unknown): PlannedAction[] => [{ action: action as PlannedAction['action'], reason: '' }]
const inS = (s: number) => new Date(Date.now() + s * 1000).toISOString()

test('no entry is signed 20 seconds before the registration deadline: it would reach the join gate after it', async () => {
  const closing = tournament(77, { deadline: inS(20), starts_at: inS(20 * 60) }, [{ user_id: 900, wallet_address: OTHER }])
  const m = setup({ fox: { user: async () => ({ elo_rating: 1100 }), tournament: async () => closing } })
  const [r] = await m.exec.run(m.agent(), dryWallet, snapshot(), act({ type: 'join_tournament', tournament_id: 77 }))
  assert.equal(r!.status, 'refused', `a seat payment 20 s before the deadline was let through: ${r!.summary}`)
  assert.match(r!.summary, /deadline/)
})

test('an entry with an hour to the deadline still goes through (the margin is no new refusal for a normal join)', async () => {
  const open = tournament(78, { deadline: inS(3600), starts_at: inS(2 * 3600) }, [{ user_id: 900, wallet_address: OTHER }])
  const m = setup({ fox: { user: async () => ({ elo_rating: 1100 }), tournament: async () => open } })
  const [r] = await m.exec.run(m.agent(), dryWallet, snapshot(), act({ type: 'join_tournament', tournament_id: 78 }))
  assert.equal(r!.status, 'dry_run', r!.summary)
})

// What follows such a join today: FoxLeague's gate refunds the entry in the same request ("(R)", 10.4) and answers
// "Registration deadline has passed". The pending retry does not know that answer as final: it asks again every
// minute and, an hour on, tells the owner at once that the seat payment "was never confirmed" and that FoxLeague
// "may still seat the team", for an entry that came back in the first minute.
test('the retry takes FoxLeague\'s "Registration deadline has passed" as final: no hour of asking, no alarm', async () => {
  const { retryPendingPayments } = await import('../../src/executor/pending.ts')
  const { ApiRefusal } = await import('../../src/foxleague/api.ts')
  const { Store } = await import('../../src/store/db.ts')
  const store = new Store('', ':memory:')
  store.addAgent(0, 'erd1fdp7wx5sspwft8jqhp44wlgjyqgjyj229yzfukdpas3g7gkhh32qcr4rpl')
  store.addPending('ab'.repeat(32), 0, 'join', { tournamentId: 77 })
  let asked = 0
  const alerts: string[] = []
  const fox = { shopConfirm: async () => ({ purchase_id: 1, message: '' }), joinTournament: async () => { asked++; throw new ApiRefusal('Registration deadline has passed') } }
  const deps = { store, fox: fox as never, notify: () => undefined, alert: (t: string) => alerts.push(t) }
  await retryPendingPayments(deps, 0, dryWallet)
  assert.equal(store.pending(0).length, 0, 'the deadline cannot un-pass and the entry was refunded in that request: the row is settled')
  await retryPendingPayments(deps, 0, dryWallet, Date.now() + 61 * 60_000)
  assert.equal(asked, 1, 'not asked again')
  assert.deepEqual(alerts, [], 'no "never confirmed" alarm for an entry FoxLeague refunded at once')
})

// Added with the fix. FoxLeague refunds at its deadline gate only for the request that carries the payment's hash
// (tournaments.rs: refund_failed_join(.., join_hash(&req), "deadline_passed"), and refund_failed_join_with returns at
// once without a hash). The retry's second ask, without the hash after "Do NOT pay again", carries none: its
// "deadline has passed" settles nothing, and the next pass asks with the hash again.
test('"Registration deadline has passed" is final only as the answer to the ask that carried the hash', async () => {
  const { retryPendingPayments } = await import('../../src/executor/pending.ts')
  const { ApiRefusal } = await import('../../src/foxleague/api.ts')
  const { Store } = await import('../../src/store/db.ts')
  const store = new Store('', ':memory:')
  store.addAgent(0, 'erd1fdp7wx5sspwft8jqhp44wlgjyqgjyj229yzfukdpas3g7gkhh32qcr4rpl')
  const hash = 'cd'.repeat(32)
  store.addPending(hash, 0, 'join', { tournamentId: 77 })
  const asks: (string | undefined)[] = []
  let pass = 1
  const fox = {
    shopConfirm: async () => ({ purchase_id: 1, message: '' }),
    joinTournament: async (_w: unknown, _id: number, h?: string) => {
      asks.push(h)
      if (pass === 1 && h) throw new ApiRefusal("Your entry payment is confirmed. We're finalizing your seat and this page updates automatically. Do NOT pay again.")
      throw new ApiRefusal('Registration deadline has passed')
    },
  }
  const deps = { store, fox: fox as never, notify: () => undefined, alert: () => undefined }
  await retryPendingPayments(deps, 0, dryWallet)
  assert.deepEqual(asks, [hash, undefined])
  assert.equal(store.pending(0).length, 1, 'the ask without the hash refunded nothing: the row waits for the next pass')
  pass = 2
  await retryPendingPayments(deps, 0, dryWallet)
  assert.deepEqual(asks, [hash, undefined, hash])
  assert.equal(store.pending(0).length, 0, 'asked with the hash, FoxLeague refunds in that request: settled')
})
