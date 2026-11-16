// P-V1 (audit 2026-11-16, MAINNET proposal, with BEH-2 and the behaviour review's P3): 158 targeted challenges in the
// week, 1 played; about 110 went to five teams that took none, 89 to a rival that had already let two or more of the
// same agent's challenges expire. Since D11 an unanswered challenge counts for nothing, so nothing stopped the next one.
// The rule: after 2 targeted challenges a rival let expire in 7 days, no third. From the agent's own log only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STRANGER, liveWallet, rivalSquad, setup, snapshot, withLive } from '../fixtures.ts'

type Store = ReturnType<typeof setup>['store']

/** A live targeted challenge of agent 1 to `opponent` some days ago, as the executor logs it; refunded: the stake came back. */
function sent(store: Store, o: { opponent: number; daysAgo: number; hash: string; tournament: number; refunded?: boolean; played?: boolean; leftByUs?: boolean }) {
  const at = new Date(Date.now() - o.daysAgo * 86_400_000)
  const setAt = (id: number, when: Date) => (store as unknown as { db: { prepare(q: string): { run(...a: unknown[]): void } } }).db.prepare('UPDATE activity SET at = ? WHERE id = ?').run(when.toISOString(), id)
  const id = store.log({ agentIndex: 0, kind: 'create_challenge', status: 'confirmed', summary: `create silver 1v1, stake 1000 vs user ${o.opponent} (T${o.tournament}): seated`, txHash: o.hash,
    detail: { action: { type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: o.opponent, deadline_minutes: 240 }, opponentUserId: o.opponent, createdTournamentId: o.tournament } })
  setAt(id, at)
  const spend = store.recordSpend({ agentIndex: 0, at, gameDay: at.toISOString().slice(0, 10), category: 'play', action: `join:${o.tournament}`, foxsyAtomic: 10n ** 21n, egldAtomic: 0n, usd: 2.7, txHash: o.hash, dryRun: false })
  if (o.leftByUs) setAt(store.log({ agentIndex: 0, kind: 'leave_tournament', status: 'confirmed', summary: `left T${o.tournament}`, detail: { action: { type: 'leave_tournament', tournament_id: o.tournament } } }), new Date(at.getTime() + 60_000))
  if (o.refunded || o.leftByUs) store.creditSpend(spend)
  if (o.played) store.closeSpend(spend, 'played')
}

const RIVAL = { id: 50, wallet_address: STRANGER, team_name: 'Rival', elo_rating: 1190, league: 'Bronze', accepted7d: 3 }
const CHALLENGE = { type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: 50, deadline_minutes: 60 } as const

async function challenge(prepare: (store: Store) => void): Promise<{ status: string; summary: string }> {
  const m = setup({ fox: { user: async () => null, ...rivalSquad(18) } })
  prepare(m.store)
  const s = snapshot()
  s.leaderboardNeighbours = [RIVAL]
  let out = { status: '', summary: '' }
  await withLive(m.store, async () => { out = (await m.exec.run(m.agent(), liveWallet, s, [{ action: CHALLENGE, reason: '' }]))[0]! })
  return out
}

test('P-V1: no third targeted 1v1 to a rival that let two of this agent\'s own expire unanswered in 7 days', async () => {
  const { status, summary: refused } = await challenge(store => {
    sent(store, { opponent: 50, daysAgo: 1, hash: 'a1', tournament: 2501, refunded: true })
    sent(store, { opponent: 50, daysAgo: 3, hash: 'a2', tournament: 2502, refunded: true })
  })
  assert.equal(status, 'refused', refused)
  assert.match(refused, /user 50 let 2 of your targeted 1v1s expire unanswered in the last 7 days: no third targeted 1v1 to it before \d{4}-\d\d-\d\dT\d\d:\d\d UTC/, refused)
  // One unanswered, one the agent left itself, one played, or two older than 7 days: not this refusal.
  for (const [why, prepare] of [
    ['one unanswered', (store: Store) => sent(store, { opponent: 50, daysAgo: 1, hash: 'b1', tournament: 2601, refunded: true })],
    ['one unanswered and one the agent left itself', (store: Store) => {
      sent(store, { opponent: 50, daysAgo: 1, hash: 'c1', tournament: 2701, refunded: true })
      sent(store, { opponent: 50, daysAgo: 2, hash: 'c2', tournament: 2702, leftByUs: true })
    }],
    ['two unanswered more than 7 days ago', (store: Store) => {
      sent(store, { opponent: 50, daysAgo: 8, hash: 'd1', tournament: 2801, refunded: true })
      sent(store, { opponent: 50, daysAgo: 9, hash: 'd2', tournament: 2802, refunded: true })
    }],
    ['two unanswered to another rival', (store: Store) => {
      sent(store, { opponent: 60, daysAgo: 1, hash: 'e1', tournament: 2901, refunded: true })
      sent(store, { opponent: 60, daysAgo: 2, hash: 'e2', tournament: 2902, refunded: true })
    }],
  ] as const) {
    const { summary } = await challenge(prepare)
    assert.doesNotMatch(summary, /expire unanswered/, `${why}: ${summary}`)
  }
})

test('P-V1: the record counts what was sent, accepted and let expire, from the agent\'s own log', async () => {
  const { targetedRecord } = await import('../../src/executor/rivals.ts')
  const { store } = setup()
  sent(store, { opponent: 50, daysAgo: 1, hash: 'f1', tournament: 3001, refunded: true })
  sent(store, { opponent: 50, daysAgo: 2, hash: 'f2', tournament: 3002, played: true })
  sent(store, { opponent: 50, daysAgo: 3, hash: 'f3', tournament: 3003, leftByUs: true })
  sent(store, { opponent: 50, daysAgo: 0.1, hash: 'f4', tournament: 3004 })
  sent(store, { opponent: 50, daysAgo: 0.2, hash: 'f5', tournament: 3005 })
  // T3005 is taken by the rival now (the snapshot shows two teams in it): accepted.
  const r = targetedRecord(store, 0, false, new Date(), new Set([3005])).get(50)!
  assert.equal(r.sent, 5)
  assert.equal(r.accepted, 2, 'the played one and the one taken now')
  assert.equal(r.unanswered.length, 1, 'the one the agent left itself and the one still waiting are not unanswered')
  // A dry run's ledger never sees a refund: nothing is unanswered there.
  assert.equal(targetedRecord(store, 0, true, new Date()).size, 0)
})
