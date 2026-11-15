// FoxLeague's platform-wide time slots: a created tournament must not overlap any live one's window.

import { test } from 'node:test'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import { blockingWindow, clash, estimateMinutes, firstFreeStart, freeGaps, slotWindows } from '../src/executor/slots.ts'
import { renderDigest } from '../src/snapshot/digest.ts'
import type { Tournament } from '../src/foxleague/types.ts'
import type { PlannedAction } from '../src/executor/actions.ts'
import { dryWallet, setup, snapshot, tournament } from './fixtures.ts'
import { wholeToAtomic } from '../src/util/encoding.ts'

const H = 3600_000

test("slots: the backend's estimate per format", () => {
  assert.equal(estimateMinutes('knockout', 8, false), 24)
  assert.equal(estimateMinutes('groups_knockout', 16, false), 96)
  assert.equal(estimateMinutes('round_robin', 16, false), 360) // 120 matches
  assert.equal(estimateMinutes('round_robin', 4, true), 36) // 12 matches, home and away
  assert.equal(estimateMinutes('swiss', 16, false), 120) // 5 rounds x 8 matches
})

test('slots: OTAN (16-team round robin at 06:51) blocks 05:51 to 13:51, the start that FoxLeague refused', () => {
  const otanStart = Date.parse('2026-09-30T06:51:00Z')
  const windows = slotWindows([
    { id: 65, title: 'OTAN', status: 'open', format: 'round_robin', max_teams: 16, home_and_away: false, starts_at: '2026-09-30T06:51:00Z', developer_mode: false },
    { id: 103, title: '1v1', status: 'open', format: 'knockout', max_teams: 2, home_and_away: false, starts_at: '2026-09-30T08:00:00Z', developer_mode: false },
    { id: 99, title: 'dev', status: 'open', format: 'knockout', max_teams: 8, home_and_away: false, starts_at: '2026-09-30T08:00:00Z', developer_mode: true },
    { id: 14, title: 'done', status: 'completed', format: 'knockout', max_teams: 8, home_and_away: false, starts_at: '2026-09-30T08:00:00Z', developer_mode: false },
  ] as unknown as Tournament[])
  assert.deepEqual(windows.map(w => w.id), [65], '1v1s, developer and finished tournaments reserve nothing')
  assert.equal(windows[0]!.start, otanStart - H)
  assert.equal(windows[0]!.end, otanStart + 6 * H + H)
  // The agent's knockout, 18 h after 15:37: 09:37, inside OTAN's window.
  const now = Date.parse('2026-09-29T15:37:00Z')
  assert.equal(clash(windows, blockingWindow('knockout', 8, false, now + 18 * H))?.id, 65)
  // First free minute (whole hours until 2026-11-15): the new window (1 h before, 24 min + 1 h after) must clear 05:51.
  assert.equal(firstFreeStart(windows, 'knockout', 8, false, now), now + 2 * H)
  // From 13 h on: the window starts 1 h before the kickoff, so the kickoff must be at 14:51 or later: 14:51 itself
  // (in whole hours it was 24 h, 15:37).
  assert.equal(firstFreeStart(windows, 'knockout', 8, false, now, 13 * H), Date.parse('2026-09-30T14:51:00Z'))
})

test('slots: free gaps between windows', () => {
  const w = [
    { id: 1, title: 'a', start: 10 * H, end: 12 * H },
    { id: 2, title: 'b', start: 11 * H, end: 14 * H },
    { id: 3, title: 'c', start: 20 * H, end: 22 * H },
  ]
  assert.deepEqual(freeGaps(w, 8 * H, 24 * H), [
    { start: 8 * H, end: 10 * H },
    { start: 14 * H, end: 20 * H },
    { start: 22 * H, end: 24 * H },
  ])
})

test('slots: a create that clashes is refused before FoxLeague is asked, with the first free start', async () => {
  const m = setup({ fox: { user: async () => null } })
  const s = snapshot()
  const now = Date.now()
  s.market.recentStandard = [{ id: 1, tier: 'silver', format: 'knockout', max_teams: 8, seated: 8, fee: 1000, status: 'completed', starts_at: new Date(now - 24 * H).toISOString() }]
  s.market.slots = [{ id: 65, title: 'OTAN', start: now + 10 * H, end: now + 17 * H }]
  const create = (hours: number): PlannedAction[] => [{
    action: { type: 'create_tournament', title: 'Fox Cup', format: 'knockout', tier: 'silver', max_teams: 8, min_teams: 8, entry_fee_foxsy: 1000, starts_in_hours: hours, registration_closes_minutes_before: 60, round_interval_minutes: 30 },
    reason: '',
  }]
  const [r] = await m.exec.run(m.agent(), dryWallet, s, create(12))
  assert.equal(r!.status, 'refused')
  assert.match(r!.summary, /time slot taken by T65/)
  // The first free start as the minute itself (whole hours until 2026-11-15): 2 hours from now, rounded up to the minute.
  const free = Date.parse(/starts_at (\S+)/.exec(r!.summary)?.[1] ?? '')
  assert.ok(free % 60_000 === 0 && free >= now + 2 * H && free <= Date.now() + 2 * H + 60_000, `a start well before OTAN fits: ${r!.summary}`)
  const [ok] = await m.exec.run(m.agent(), dryWallet, s, create(19))
  assert.equal(ok!.status, 'dry_run', 'after OTAN (window ends at +17 h, ours starts 1 h earlier)')
  assert.match(renderDigest(s), /Tournament time slots taken[\s\S]*T65 "OTAN"/)
  assert.match(renderDigest(s), /Free for a new tournament's whole window/)
})

test('1v1: leaving a challenge the agent created and nobody accepted also closes it', async () => {
  const { tournament, withLive, liveWallet } = await import('./fixtures.ts')
  const calls: string[] = []
  let seats = [{ user_id: 100 }]
  const m = setup({
    fox: {
      user: async () => null,
      tournament: async () => tournament(103, { max_teams: 2, min_teams: 2, creator_user_id: 100 }, seats),
      leaveTournament: async () => (calls.push('leave'), { message: 'You have left the tournament.', refund_tx_hash: 'r1' }),
      cancelTournament: async () => (calls.push('cancel'), { message: 'Challenge cancelled.' }),
    },
  })
  const leave: PlannedAction[] = [{ action: { type: 'leave_tournament', tournament_id: 103 }, reason: '' }]
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, snapshot(), leave)
    assert.equal(r!.status, 'confirmed')
    assert.deepEqual(calls, ['leave', 'cancel'])
    assert.match(r!.summary, /challenge closed/)
    // Someone else's tournament: leave only.
    calls.length = 0
    seats = [{ user_id: 100 }, { user_id: 7 }]
    const other = setup({
      fox: {
        user: async () => null,
        tournament: async () => tournament(104, { max_teams: 8, creator_user_id: 7 }, seats),
        leaveTournament: async () => (calls.push('leave'), { message: 'You have left the tournament.' }),
        cancelTournament: async () => (calls.push('cancel'), { message: 'x' }),
      },
    })
    other.store.setLiveMode(true)
    await other.exec.run(other.agent(), liveWallet, snapshot(), [{ action: { type: 'leave_tournament', tournament_id: 104 }, reason: '' }])
    assert.deepEqual(calls, ['leave'])
  })
})

test('web: the owner can leave a tournament from the dashboard (same executor path)', async () => {
  const { startWeb } = await import('../src/web/server.ts')
  const { Sessions, hashPassword } = await import('../src/web/auth.ts')
  const { Store } = await import('../src/store/db.ts')
  const store = new Store('', ':memory:')
  store.addAgent(0, 'erd1fdp7wx5sspwft8jqhp44wlgjyqgjyj229yzfukdpas3g7gkhh32qcr4rpl')
  const asked: [number, number, string][] = []
  const service = { store, cfg: {}, notify: () => undefined, leave: async (i: number, id: number, who: string) => (asked.push([i, id, who]), 'left') }
  const creds = { username: 'admin', passwordHash: hashPassword('correct-horse-battery'), secretKey: 'k'.repeat(64) }
  const server = startWeb(service as never, creds, 0)
  if (!server.listening) await once(server, 'listening')
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const sessions = new Sessions(creds.secretKey, creds.passwordHash)
  const cookie = sessions.issue('admin')
  const post = (body: unknown) => fetch(`${url}/api/agents/0/leave`, { method: 'POST', headers: { cookie: `foxagent_session=${cookie}`, origin: url, 'x-csrf-token': sessions.csrfFor(cookie), 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try {
    assert.equal((await post({ tournament_id: 'x' })).status, 400)
    const r = await post({ tournament_id: 103 })
    assert.equal(r.status, 200)
    assert.deepEqual(asked, [[0, 103, 'web UI, admin']])
  } finally {
    server.close()
  }
})

test('1v1 scouting: the AI sees the rival ELO and lineup next to each challenge it could take', () => {
  const s = snapshot()
  s.market.openChallenges = [{ id: 102, title: 'Takers?', tier: 'silver', entry_fee_foxsy: 1000, creator_user_id: 14, target_user_id: null, deadline: '2026-09-29T19:17:26Z', participant_count: 1 } as never]
  s.market.scouted = [{ id: 102, elo: 1191, strength: 1600 }]
  const d = renderDigest(s)
  assert.match(d, /T102 "Takers\?".*\[rival ELO 1191, lineup 1600 at full condition\]/)
  assert.match(d, /Your lineup strength today \(synced stats x condition\): 1540/)
})

test('LR2 a created 1v1 stake is credited back when the agent leaves it or FoxLeague cancels it', async () => {
  const { withLive, liveWallet, STRANGER } = await import('./fixtures.ts')
  const { creditRefunds } = await import('../src/executor/refunds.ts')
  let status = 'open'
  let entry = 0n
  const seats: { user_id: number; wallet_address?: string }[] = []
  const t200 = () => ({ tournament: { id: 200, title: '1v1', status, tier: 'silver', format: 'knockout', max_teams: 2, min_teams: 2, entry_fee_foxsy: 1000, deadline: new Date(Date.now() + 3600_000).toISOString(), starts_at: new Date(Date.now() + 2 * 3600_000).toISOString(), sc_tournament_id: 200, creator_user_id: 100, target_user_id: 50, is_private: false, developer_mode: false }, participants: [...seats] })
  const b64 = (n: bigint) => Buffer.from(n ? n.toString(16).padStart(2, '0') : '', 'hex').toString('base64')
  const m = setup({
    chain: { query: async (_sc: string, fn: string) => (fn === 'getEntryAmount' ? [b64(entry)] : []) },
    fox: {
      user: async (a: string) => (a === STRANGER ? { id: 50, wallet_address: STRANGER, elo_rating: 1190 } : null),
      createTournament: async () => ({ id: 200 }),
      tournament: async () => t200(),
      joinTournament: async () => (seats.push({ user_id: 100 }), {}),
      leaveTournament: async () => ({ message: 'You have left the tournament.' }),
      cancelTournament: async () => ({ message: 'Challenge cancelled.' }),
    },
  })
  const s = snapshot()
  s.leaderboardNeighbours = [{ id: 50, wallet_address: STRANGER, team_name: 'Rival', elo_rating: 1190, league: 'Bronze', accepted7d: 0 }]
  const live = () => m.store.spentUsd(0, { category: 'play', dryRun: false })
  await withLive(m.store, async () => {
    const [c] = await m.exec.run(m.agent(), liveWallet, s, [{ action: { type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: 50, deadline_minutes: 60 }, reason: '' }])
    assert.equal(c!.status, 'confirmed', c!.summary)
    assert.ok(live() > 2, 'the stake counts while it is held')
    const [l] = await m.exec.run(m.agent(), liveWallet, snapshot(), [{ action: { type: 'leave_tournament', tournament_id: 200 }, reason: '' }])
    assert.equal(l!.status, 'confirmed', l!.summary)
    assert.ok(live() < 0.05, `leaving gives the budget back (only gas stays), got ${live()}`)

    // Another one that FoxLeague cancels by itself at the deadline.
    seats.length = 0
    const [c2] = await m.exec.run(m.agent(), liveWallet, s, [{ action: { type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: 50, deadline_minutes: 60 }, reason: '' }])
    assert.equal(c2!.status, 'confirmed', c2!.summary)
    const later = Date.now() + 11 * 60_000
    status = 'cancelled'
    entry = wholeToAtomic(1000)
    await creditRefunds({ store: m.store, chain: { query: async (_sc: string, fn: string) => (fn === 'getEntryAmount' ? [b64(entry)] : []), esdts: async () => [] } as never, fox: { tournament: async () => t200() } as never }, m.agent(), false, later)
    assert.ok(live() > 2, 'cancelled but the contract still holds the stake: a claim gets it back')
    entry = 0n
    await creditRefunds({ store: m.store, chain: { query: async (_sc: string, fn: string) => (fn === 'getEntryAmount' ? [b64(entry)] : []), esdts: async () => [] } as never, fox: { tournament: async () => t200() } as never }, m.agent(), false, later)
    assert.ok(live() < 0.1, `refunded by FoxLeague: the budget comes back, got ${live()}`)
  })
})

test('LR3 the owner can leave while the agent is paused; the agent itself cannot', async () => {
  const m = setup({ fox: { user: async () => null, tournament: async () => tournament(300, {}, [{ user_id: 100 }]) } })
  m.store.setPaused(0, true)
  const leave = (reason: string, byOwner?: true) => m.exec.run(m.agent(), dryWallet, snapshot(), [{ action: { type: 'leave_tournament', tournament_id: 300 }, reason, ...(byOwner ? { byOwner } : {}) }])
  assert.equal((await leave('owner (web UI, admin)', true))[0]!.status, 'dry_run')
  assert.equal((await leave('the plan'))[0]!.status, 'refused')
  assert.equal((await leave('owner asked me to leave T300'))[0]!.status, 'refused', 'FR2: a plan whose reason starts with "owner" is still the plan')
  m.store.setKillSwitch(true)
  assert.equal((await leave('owner (web UI, admin)', true))[0]!.status, 'refused', 'never under the kill switch')
})

test('FR1 the owner leave while paused works live too (it signs nothing)', async () => {
  const { withLive, liveWallet } = await import('./fixtures.ts')
  const calls: string[] = []
  const m = setup({ fox: { user: async () => null, tournament: async () => tournament(300, {}, [{ user_id: 100 }]), leaveTournament: async () => (calls.push('leave'), { message: 'You have left the tournament.' }) } })
  m.store.setPaused(0, true)
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, snapshot(), [{ action: { type: 'leave_tournament', tournament_id: 300 }, reason: 'owner (web UI, admin)', byOwner: true }])
    assert.equal(r!.status, 'confirmed', r!.summary)
    assert.deepEqual(calls, ['leave'])
  })
})

test('FR4 a completed tournament whose contract still holds the seat stays claimable and is credited on the claim', async () => {
  const { withLive, liveWallet } = await import('./fixtures.ts')
  const { creditRefunds } = await import('../src/executor/refunds.ts')
  let status = 'open'
  let entry = wholeToAtomic(1000)
  const seats: { user_id: number }[] = []
  const b64 = (n: bigint) => Buffer.from(n ? n.toString(16).padStart(2, '0') : '', 'hex').toString('base64')
  const t5 = () => tournament(5, { status, participant_count: 3, min_teams: 4 }, seats)
  const chain = { query: async (_sc: string, fn: string) => (fn === 'getEntryAmount' ? [b64(entry)] : []), esdts: async () => [] }
  const m = setup({ chain, fox: { user: async () => null, tournament: async () => t5(), joinTournament: async () => (seats.push({ user_id: 100 }), {}) } })
  // The agent's FoxLeague user id, as every snapshot notes it: the refund check knows its seat by it (A5).
  m.store.setKv('agent_user_id:0', '100')
  const spent = () => m.store.spentUsd(0, { category: 'play', dryRun: false })
  const later = Date.now() + 11 * 60_000
  await withLive(m.store, async () => {
    assert.equal((await m.exec.run(m.agent(), liveWallet, snapshot(), [{ action: { type: 'join_tournament', tournament_id: 5 }, reason: '' }]))[0]!.status, 'confirmed')
    status = 'completed'
    await creditRefunds({ store: m.store, chain: chain as never, fox: { tournament: async () => t5() } as never }, m.agent(), false, later)
    assert.deepEqual(m.store.openSpend(0, 'join:', false).map(r => r.action), ['join:5'], 'the contract still holds it: left open')
    const [c] = await m.exec.run(m.agent(), liveWallet, snapshot(), [{ action: { type: 'claim_refund', tournament_id: 5 }, reason: '' }])
    assert.equal(c!.status, 'confirmed', c!.summary)
    assert.ok(spent() < 0.05, `the claimed seat no longer counts, got ${spent()}`)
    // A normally played one: the contract clears the entry, the row is closed and keeps counting.
    seats.length = 0
    status = 'open'
    entry = wholeToAtomic(1000)
    assert.equal((await m.exec.run(m.agent(), liveWallet, snapshot(), [{ action: { type: 'join_tournament', tournament_id: 5 }, reason: '' }]))[0]!.status, 'confirmed')
    status = 'completed'
    entry = 0n
    await creditRefunds({ store: m.store, chain: chain as never, fox: { tournament: async () => t5() } as never }, m.agent(), false, later)
    assert.deepEqual(m.store.openSpend(0, 'join:', false).map(r => r.action), ['join:5:played'], 'played: closed, never checked again')
    assert.ok(spent() > 2, 'and still counted')
  })
})
