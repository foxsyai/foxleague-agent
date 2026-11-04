// Audit 2026-11-04, what stayed open: the owner asked for the items that are not hard to close (OPEN-1 to OPEN-8),
// and the agent review of PR #51 added R51A-1. Each test fails before its fix.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ApiRefusal } from '../../src/foxleague/api.ts'
import { casualCostRefusal } from '../../src/executor/rules.ts'
import { lastMatchStarts } from '../../src/executor/match-starts.ts'
import { retryPendingPayments } from '../../src/executor/pending.ts'
import { renderDigest } from '../../src/snapshot/digest.ts'
import { validateSettingsPatch } from '../../src/store/settings.ts'
import { liveWallet, setup, snapshot, withLive } from '../fixtures.ts'

const HOUR = 3600_000
const at = (h: number) => new Date(Date.now() + h * HOUR).toISOString()
function withLock(s: ReturnType<typeof snapshot>, h: number) {
  s.auth!.upcoming!.matches = [{ tournament_id: 9, tournament_title: 'Cup', round_label: 'Round 1', is_home: true, opponent_name: 'Rival FC', scheduled_at: at(h + 0.5), strategy_locks_at: at(h), locked: false, phase: 'upcoming', home_score: null, away_score: null }] as never
  return s
}
const XI_523 = [1, 2, 3, 4, 5, 13, 6, 7, 10, 11, 17]
const BENCH_523 = [12, 14, 8, 9, 15, 16, 18]

// Agent review of PR #51 (low): MONEY-2 missed the ranked start pressed again after a ticket was bought.
test('R51A-1: a ranked start after a bought ticket whose answer and read-back are both lost counts as a start', async () => {
  let pressed = 0
  const m = setup({
    fox: {
      rankedTicket: async () => ({ live: true, price_foxsy: 25, tickets: 0 }),
      playMatch: async () => { if (pressed++ === 0) throw new ApiRefusal('A ranked game costs 25 FOXSY: pay for a ticket first.', 'ranked_ticket_required'); throw new Error('HTTP 502') },
      activeMatch: async () => { throw new Error('HTTP 502') },
      buyRankedTicket: async () => ({ live: true, price_foxsy: 25, tickets: 1 }),
    },
    chain: { send: async () => 'hashT' },
  })
  const s = snapshot()
  s.config!.competition_levels = { live: true, live_from: '2026-11-09T14:00:00Z', ranked_ticket_price_foxsy: 25, xp_factor_pct: { ranked: 25, bronze: 50, silver: 75, gold: 100 }, elo_k: { ranked: 5, bronze: 9, silver: 13, gold: 17 }, private_bronze_earns: true, competitive_daily_cap: 3 }
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, s, [{ action: { type: 'play_match', match_type: 'ranked' }, reason: '' }])
    assert.equal(r!.status, 'error', r!.summary)
    assert.doesNotMatch(r!.summary, /the ticket stays for the next start/, 'it may have used the ticket')
    assert.match(r!.summary, /may have started/)
  })
  assert.ok(lastMatchStarts(m.store, 0, new Date()).ranked, 'the cooldowns see it')
})

test('OPEN-1: the casual condition rule refuses when the condition a casual game costs or regains cannot be read', () => {
  const squad = (s: ReturnType<typeof snapshot>) => [...s.team!.lineup, ...s.team!.substitutes]
  for (const bad of [{ condition_loss_per_match_ranked: 0 }, { condition_loss_per_match_ranked: undefined }, { condition_loss_per_match_ranked: Number.NaN }, { condition_regen_points_per_day: Number.NaN }]) {
    const s = withLock(snapshot(), 2)
    Object.assign(s.config!, bad)
    assert.match(casualCostRefusal(s, squad(s), new Date()) ?? 'free', /could not be read/, JSON.stringify(bad))
  }
  const free = snapshot()
  free.config!.condition_loss_per_match_ranked = undefined as never
  assert.equal(casualCostRefusal(free, squad(free), new Date()), null, 'with no match that counts ahead there is nothing to protect')
})

test('OPEN-2: the kill switch turned on during a casual test stops the start, and the formation goes back', async () => {
  const calls: string[] = []
  let store: ReturnType<typeof setup>['store'] | undefined
  const m = setup({
    fox: {
      setLineup: async (_w: unknown, _l: number[], _s: number[], f?: string) => { calls.push(`lineup ${f}`); if (f === '5-2-3') store!.setKillSwitch(true) },
      playMatch: async () => { calls.push('play casual'); return { match_id: 77 } },
    },
  })
  store = m.store
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, snapshot(), [{ action: { type: 'play_match', match_type: 'casual', test: { formation: '5-2-3', lineup: XI_523, substitutes: BENCH_523 } }, reason: '' }])
    assert.notEqual(r!.status, 'confirmed', r!.summary)
    assert.match(r!.summary, /kill switch/)
  })
  assert.deepEqual(calls, ['lineup 5-2-3', 'lineup 4-4-2'])
})

test('OPEN-3: a competition levels or organizer block without its numbers says unknown, and the plan is still made', () => {
  const s = snapshot()
  s.config!.competition_levels = { live: true, live_from: '2026-11-09T14:00:00Z', ranked_ticket_price_foxsy: 25, private_bronze_earns: true, competitive_daily_cap: 3 } as never
  s.config!.organizer_fees = { live: true, live_from: '2026-11-09T14:00:00Z' } as never
  const d = renderDigest(s)
  assert.match(d, /XP ranked unknown/)
  assert.match(d, /K ranked unknown/)
  assert.match(d, /calendar deposit unknown FOXSY a game/)
})

test('OPEN-4: a rival strength read that failed is not kept: the next plan reads it again', async () => {
  const { rivalStrengthCached } = await import('../../src/snapshot/snapshot.ts')
  let fail = true
  const cards = Array.from({ length: 11 }, () => Object.fromEntries(['speed', 'accuracy', 'defense', 'power', 'control', 'vision', 'stamina'].map(k => [`${k}_synced`, 20])))
  const fox = { players: async () => { if (fail) throw new Error('HTTP 502'); return cards } } as never
  assert.equal(await rivalStrengthCached(fox, 'wallet-open-4'), null)
  fail = false
  assert.equal(await rivalStrengthCached(fox, 'wallet-open-4'), 1540)
})

test('OPEN-5: active hours take a start of 0 to 23 and an end of 1 to 24, as the dashboard does', () => {
  assert.throws(() => validateSettingsPatch({ activeHoursUtc: [24, 0] }), /activeHoursUtc/)
  assert.throws(() => validateSettingsPatch({ activeHoursUtc: [5, 0] }), /activeHoursUtc/)
  assert.deepEqual(validateSettingsPatch({ activeHoursUtc: [23, 1] }), { activeHoursUtc: [23, 1] })
  assert.deepEqual(validateSettingsPatch({ activeHoursUtc: [0, 24] }), { activeHoursUtc: [0, 24] })
  assert.deepEqual(validateSettingsPatch({ activeHoursUtc: [6, 22] }), { activeHoursUtc: [6, 22] })
})

test('OPEN-6: "Do NOT pay again" for a pending seat is not final: the seat is asked for without the hash, as FoxLeague\'s app does', async () => {
  const DO_NOT_PAY = new ApiRefusal('Your entry of 1000 FOXSY is verified, but the seat is not recorded yet. Do NOT pay again: try joining again in a moment.')
  const calls: string[] = []
  const m = setup()
  m.store.addPending('hashJ', 0, 'join', { tournamentId: 7 })
  await retryPendingPayments({ store: m.store, fox: { shopConfirm: async () => assert.fail('no shop'), joinTournament: async (_w: unknown, _id: number, hash?: string) => { calls.push(hash ?? 'no hash'); if (hash) throw DO_NOT_PAY; return {} } } as never, notify: () => undefined }, 0, liveWallet)
  assert.deepEqual(calls, ['hashJ', 'no hash'])
  assert.equal(m.store.pending(0).length, 0, 'seated')
  const n = setup()
  n.store.addPending('hashK', 0, 'join', { tournamentId: 8 })
  await retryPendingPayments({ store: n.store, fox: { shopConfirm: async () => assert.fail('no shop'), joinTournament: async (_w: unknown, _id: number, hash?: string) => { throw hash ? DO_NOT_PAY : new ApiRefusal('The seat is not recorded yet') } } as never, notify: () => undefined }, 0, liveWallet)
  assert.equal(n.store.pending(0).length, 1, 'kept and asked again next time, never settled as done without a seat')
})

test('OPEN-7: the plan hears that an organizer payment must fit the max shop payment and that an invitation is accepted 30 minutes before it expires; the levels page names the ranked ticket', async () => {
  const { SYSTEM_PROMPT } = await import('../../src/strategist/prompt.ts')
  assert.match(SYSTEM_PROMPT, /calendar deposit per scheduled game[^.]*within the owner's max shop payment/)
  const s = snapshot()
  s.auth!.invitations = [{ tournament_id: 3001, title: 'Champions FoxLeague', tier: 'gold', entry_fee_foxsy: 5000, wave: 1, expires_at: at(20), seats_lock_at: at(40), can_accept: true, refusal: null, prize_atomic: null, tournament: null }] as never
  assert.match(renderDigest(s), /accept one with join_tournament at least 30 minutes before it expires/)
  const { readFileSync } = await import('node:fs')
  const levels = readFileSync(new URL('../../site/src/content/docs/play/strategy-levels.md', import.meta.url), 'utf8').replace(/\s+/g, ' ')
  assert.match(levels, /\| \*\*1\. Steady\*\* \|[^|]*ranked ticket/)
})

test('OPEN-8: a tournament the agent created and holds no seat in is named to the plan, with what an unfilled one costs', async () => {
  const { takeSnapshot } = await import('../../src/snapshot/snapshot.ts')
  const { ADDR, dryWallet } = await import('../fixtures.ts')
  const created = { id: 55, title: 'Autumn Cup', status: 'open', tier: 'silver', format: 'round_robin', max_teams: 4, min_teams: 3, entry_fee_foxsy: 1000, creator_user_id: 100, participant_count: 0, deadline: at(5), starts_at: at(6) }
  const cfg = snapshot().config!
  cfg.organizer_fees = { live: true, live_from: '2026-11-09T14:00:00Z', private_match_fee_foxsy: 0, calendar_deposit_per_match_foxsy: 25, calendar_deposit_min_foxsy: 0, calendar_deposit_grace_minutes: 60 }
  const base = (participants: unknown[]) => {
    const fox: Record<string, unknown> = {
      config: async () => cfg, user: async (a: string) => (a === ADDR ? snapshot().profile : null), team: async () => snapshot().team,
      players: async () => [], tournaments: async () => [], leaderboard: async () => ({ users: [], total: 0, limit: 200, offset: 0 }), listings: async () => [],
      floorPrices: async () => [], shopStatus: async () => snapshot().auth!.shop, dailyAllowance: async () => snapshot().auth!.allowance, activeMatch: async () => null,
      myTournaments: async () => ({ active: [created], completed: [] }), upcomingMatches: async () => ({ lead_minutes: 30, my_team_name: 'Agent', matches: [] }), challengesForMe: async () => [],
      tournament: async (id: number) => (id === 55 ? { tournament: created, participants } : assert.fail(`T${id}`)),
      matchHistory: async () => [], matchFormations: async () => null,
    }
    const chain = { account: async () => ({ balance: 0n, nonce: 1 }), esdts: async () => [], egldUsd: async () => 25, query: async () => { throw new Error('no pool') } }
    return { chain, fox } as never
  }
  const unseated = renderDigest(await takeSnapshot(base([]), { wallet: dryWallet }))
  assert.match(unseated, /T55 [^\n]*created by you, with no seat of yours: take it with join_tournament, or unfilled at its deadline it keeps your organizer deposit/)
  const seated = renderDigest(await takeSnapshot(base([{ user_id: 100, wallet_address: ADDR, team_name: 'Agent' }]), { wallet: dryWallet }))
  assert.doesNotMatch(seated, /with no seat of yours/)
})
