// FoxLeague's manual of 2026-10-24 (synced at 688088787): a tournament or a 1v1 challenge can carry an optional OVR
// range (ovr_min, ovr_max, whole numbers 1 to 100). It is checked once, when a team joins, against the team's best XI
// OVR (the average OVR of the strongest eleven it can field, to one decimal; GET /api/teams/best-xi-ovr). A team outside
// the range cannot join, and "a paid entry sent anyway is refunded": the agent would lose the gas. It reads its best XI
// OVR right before paying and joins only inside the range; unreadable is no join (not live on mainnet yet: the agent
// is ready before it is).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkAction, type RulesContext } from '../src/executor/rules.ts'
import type { TournamentDetail } from '../src/foxleague/types.ts'
import { renderDigest } from '../src/snapshot/digest.ts'
import { STRANGER, TEST_SETTINGS, dryWallet, setup, snapshot, tournament } from './fixtures.ts'

const join = (id: number) => ({ type: 'join_tournament' as const, tournament_id: id })
const ranged = (more: Record<string, unknown>) => tournament(4100, { ...more }) as TournamentDetail

test('a tournament with an OVR range is joined only when the team\'s best XI OVR is inside it', () => {
  const s = snapshot()
  // field: [] is a seated field read with nobody in it (every level is held to the field rule since 2026-11-06).
  const ctx = (t: TournamentDetail, bestXiOvr: number | null | undefined) => ({ settings: TEST_SETTINGS, now: new Date(), tournament: t, bestXiOvr, field: [] } as RulesContext)
  assert.equal(checkAction(join(4100), s, ctx(ranged({ ovr_min: 25, ovr_max: 35 }), 30.4)).ok, true)
  assert.match(checkAction(join(4100), s, ctx(ranged({ ovr_max: 29 }), 29.4)).refusal!, /takes teams with a best XI OVR up to 29; yours is 29\.4/)
  assert.match(checkAction(join(4100), s, ctx(ranged({ ovr_min: 31 }), 30.9)).refusal!, /takes teams with a best XI OVR from 31; yours is 30\.9/)
  assert.match(checkAction(join(4100), s, ctx(ranged({ ovr_min: 25 }), null)).refusal!, /best XI OVR could not be read: not paying into an OVR range blind/)
  assert.equal(checkAction(join(4100), s, ctx(ranged({}), undefined)).ok, true, 'no range: nothing to read')
})

test('a 1v1 with an OVR range is checked the same way', () => {
  const s = snapshot()
  const oneVOne = tournament(5001, { max_teams: 2, min_teams: 2, creator_user_id: 50, entry_fee_foxsy: 1000, ovr_max: 28 }, [{ user_id: 50, wallet_address: STRANGER }]) as TournamentDetail
  const c = { settings: TEST_SETTINGS, now: new Date(), tournament: oneVOne, opponent: { userId: 50, elo: 1190, strength: 1000 }, oneVOneWithOpponentThisWeek: 0, bestXiOvr: 31 } as RulesContext
  assert.match(checkAction(join(5001), s, c).refusal!, /up to 28; yours is 31/)
})

test('the executor reads the best XI OVR right before paying, only for a ranged tournament; a failed read pays nothing', async () => {
  let reads = 0
  const m = setup({ fox: { tournament: async () => ranged({ ovr_min: 20 }), bestXiOvr: async () => { reads++; throw new Error('HTTP 502') } } })
  const [r] = await m.exec.run(m.agent(), dryWallet, snapshot(), [{ action: join(4100), reason: '' }])
  assert.match(r!.summary, /could not be read: not paying into an OVR range blind/)
  const ok = setup({ fox: { tournament: async () => ranged({ ovr_min: 20 }), bestXiOvr: async () => ({ best_xi_ovr: 30.2, formation: '4-4-2', complete: true, cards: 18 }) } })
  assert.equal((await ok.exec.run(ok.agent(), dryWallet, snapshot(), [{ action: join(4100), reason: '' }]))[0]!.status, 'dry_run')
  const plain = setup({ fox: { tournament: async () => ranged({}), bestXiOvr: async () => { reads++; return { best_xi_ovr: 30 } } } })
  await plain.exec.run(plain.agent(), dryWallet, snapshot(), [{ action: join(4100), reason: '' }])
  assert.equal(reads, 1, 'no read for a tournament without a range')
})

test('the plan sees each OVR range and the team\'s own best XI OVR', () => {
  const s = snapshot()
  s.market.openStandard = [{ ...ranged({ ovr_min: 25, ovr_max: 35 }).tournament }] as never
  s.auth!.bestXiOvr = 30.4
  const text = renderDigest(s)
  assert.match(text, /T4100 .*, OVR range 25 to 35/)
  assert.match(text, /Your best XI OVR \(what OVR ranges are checked against\): 30\.4/)
})

test('the manual describes the OVR range rule', async () => {
  const { readFileSync } = await import('node:fs')
  const plays = readFileSync(new URL('../site/src/content/docs/play/how-it-plays.md', import.meta.url), 'utf8').replace(/\s+/g, ' ')
  assert.match(plays, /A tournament or a 1v1 with an OVR range is joined only when your team's best XI OVR, read from FoxLeague right before the payment, is inside it/)
})

// Agent review of PR #34 (medium): the route is not live on mainnet yet (it answers as the team route, "Team not
// found"), so a warning in every snapshot told the model its team was not found and kept the dashboard dot off ok.
// The snapshot's value is only information (the rule reads its own right before paying): a failed read is quiet.
test('R34A-1 a failed best XI OVR read in the snapshot is quiet', async () => {
  const { takeSnapshot } = await import('../src/snapshot/snapshot.ts')
  const { ADDR } = await import('./fixtures.ts')
  const { ApiRefusal } = await import('../src/foxleague/api.ts')
  const fox: Record<string, unknown> = {
    config: async () => snapshot().config, user: async (a: string) => (a === ADDR ? snapshot().profile : null), team: async () => snapshot().team, players: async () => [],
    tournaments: async () => [], leaderboard: async () => ({ users: [], total: 0, limit: 200, offset: 0 }), floorPrices: async () => [], listings: async () => [],
    shopStatus: async () => snapshot().auth!.shop, dailyAllowance: async () => snapshot().auth!.allowance, activeMatch: async () => null,
    myTournaments: async () => ({ active: [], completed: [] }), upcomingMatches: async () => ({ lead_minutes: 30, my_team_name: 'Agent', matches: [] }),
    challengesForMe: async () => [], matchHistory: async () => [], leagueInvitations: async () => [],
    bestXiOvr: async () => { throw new ApiRefusal('Team not found') },
  }
  const chain = { account: async () => ({ balance: 0n, nonce: 1 }), esdts: async () => [], egldUsd: async () => 25, query: async () => { throw new Error('no pool in this test') } }
  const s = await takeSnapshot({ chain, fox } as never, { wallet: { ...dryWallet, address: ADDR } }, new Date())
  assert.equal(s.auth!.bestXiOvr, null)
  assert.ok(!s.warnings.some(w => /best XI OVR|Team not found/.test(w)), s.warnings.join(' | '))
})

// Agent review of PR #34 (low, rule 4): a range value that is present but not a number counted as no range.
test('R34A-2 a range the agent cannot read is no range to pay into', async () => {
  const s = snapshot()
  const c = (t: TournamentDetail) => ({ settings: TEST_SETTINGS, now: new Date(), tournament: t, bestXiOvr: 31 } as RulesContext)
  assert.match(checkAction(join(4100), s, c(ranged({ ovr_max: '28' }))).refusal!, /carries an OVR range the agent cannot read: not paying blind/)
  let reads = 0
  const m = setup({ fox: { tournament: async () => ranged({ ovr_min: '20' }), bestXiOvr: async () => { reads++; return { best_xi_ovr: 31 } } } })
  await m.exec.run(m.agent(), dryWallet, snapshot(), [{ action: join(4100), reason: '' }])
  assert.equal(reads, 1, 'the executor reads for any range value, not only a number')
})
