// Actions with a deadline run before it (2026-11-15). Seen live on agent 7 six times in seven days: a plan at 10:32
// UTC left its unanswered targeted 1v1 (T5976) "now", 12 minutes before it ran out at 10:44, to send another
// challenge; runPlan gave the leave a random moment of its 48-minute window, it ran at 10:58 and the executor refused
// it ("can only leave an open tournament before its deadline"). A join refused as "is active" 20 minutes after the
// plan chose it was the same. One test per point, named after it; each failed on main at dcac14b before the fix.
import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Mnemonic } from '@multiversx/sdk-core'
import type { Config } from '../src/config.ts'
import { Service, scheduleActions } from '../src/service.ts'
import { parseAction, type PlannedAction } from '../src/executor/actions.ts'
import { actionDeadline } from '../src/executor/deadlines.ts'
import { BUSY_OPENS_MARGIN_S } from '../src/executor/rules.ts'
import type { MarketListing, Tournament } from '../src/foxleague/types.ts'
import type { AgentSnapshot } from '../src/snapshot/snapshot.ts'
import { snapshot } from './fixtures.ts'

const MIN = 60_000
const act = (raw: unknown): PlannedAction => ({ action: parseAction(raw), reason: '' })
const iso = (ms: number) => new Date(ms).toISOString()
const mins = (ran: { ms: number }[]) => ran.map(r => +(r.ms / MIN).toFixed(2))

function testConfig(dir: string): Config {
  return {
    mnemonic: Mnemonic.generate().toString(), dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config
}

/** An open tournament or 1v1 in the shape the snapshot holds it; `deadline` a time, or text that is no time. */
function open(id: number, deadline: number | string, more: Partial<Tournament> = {}): Tournament {
  const at = typeof deadline === 'number' ? deadline : Date.now()
  return {
    id, creator_user_id: 100, title: `T${id}`, description: null, format: 'knockout', tier: 'silver', featured: false, max_teams: 2, min_teams: 2,
    entry_fee_foxsy: 2500, status: 'open', deadline: typeof deadline === 'number' ? iso(deadline) : deadline, starts_at: iso(at + 5 * MIN),
    round_interval_minutes: null, has_third_place_match: false, sc_tournament_id: id, winner_user_id: null, runner_up_user_id: null,
    third_place_user_id: null, created_at: iso(at - 4 * 60 * MIN), started_at: null, completed_at: null, cancelled_at: null, target_user_id: 877,
    challenge_deadline_minutes: 240, is_private: false, home_and_away: false, developer_mode: false, ...more,
  }
}

/** A card at auction, ending at `endsAt` (null: no end served). */
function auction(nonce: number, endsAt: number | null): MarketListing {
  return {
    nft_nonce: nonce, owner_address: 'erd1seller', name: `Card ${nonce}`, position: 'MID', rarity: 'Rare', level: 1, speed: 50, accuracy: 50, defense: 50, power: 50,
    control: 50, vision: 50, stamina: 50, condition: 100, is_auction: true, min_price: 4000, highest_bid: null, ends_at: endsAt === null ? null : iso(endsAt),
    transferred_at: null, transfer_cooldown_hours: null,
  }
}

/**
 * Runs a routine plan through runPlan on a mocked clock frozen at `t0` (a 60-minute tick, so a 48-minute window, 30 s
 * between actions), handing it `planSnap` as the snapshot the plan was made from. Returns when each action reached
 * the executor, in ms after the plan's start.
 */
async function runPlanned(t0: number, actions: PlannedAction[], planSnap: AgentSnapshot | undefined, random: () => number): Promise<{ type: string; ms: number }[]> {
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-dl-'))))
  svc.ensureAgents()
  const h = new Date(t0).getUTCHours()
  svc.store.updateSettings(0, { tickMinutes: 60, tickJitterMinutes: 10, minGapSeconds: 30, activeHoursUtc: [h, (h + 2) % 24], actionProbability: 1 })
  const ran: { type: string; ms: number }[] = []
  mock.timers.enable({ apis: ['Date'], now: t0 })
  const realRandom = Math.random
  try {
    const s = svc as unknown as { snapshot: unknown; pause: unknown; executor: unknown; runPlan: (a: unknown, p: PlannedAction[], routine: boolean, snap?: AgentSnapshot) => Promise<void> }
    s.snapshot = async () => snapshot()
    s.pause = async (ms: number) => { mock.timers.tick(Math.max(0, ms)) }
    s.executor = { liveEnabled: false, run: async (_a: unknown, _w: unknown, _s: unknown, a: PlannedAction[]) => { ran.push({ type: a[0]!.action.type, ms: Date.now() - t0 }); return [] } }
    Math.random = random
    await s.runPlan(svc.store.agent(0), actions, true, planSnap)
  } finally {
    Math.random = realRandom
    mock.timers.reset()
  }
  return ran
}

/** A snapshot whose own tournaments (myTournaments.active) hold these. */
function holding(...ts: Tournament[]): AgentSnapshot {
  const s = snapshot()
  s.auth!.myTournaments!.active.push(...ts)
  return s
}

test('DL-1: a leave_tournament whose deadline is 12 minutes after the plan\'s start runs at least 5 minutes before it, whatever the random draw', async () => {
  const t0 = Date.now()
  const ran = await runPlanned(t0, [act({ type: 'leave_tournament', tournament_id: 5976 })], holding(open(5976, t0 + 12 * MIN)), () => 0.99)
  assert.equal(ran.length, 1)
  // The draw alone put it at 47.5 minutes, 35 minutes after the 1v1 ran out.
  assert.ok(ran[0]!.ms <= 12 * MIN - 5 * MIN, `the leave runs ${(ran[0]!.ms / MIN).toFixed(2)} min after the plan's start; its deadline is at 12`)
  assert.deepEqual(mins(ran), [7], 'at its latest moment: the deadline less the 5-minute margin')
  // The tick hands runPlan the snapshot its plan was made from.
  const src = readFileSync(new URL('../src/service.ts', import.meta.url), 'utf8')
  const tick = src.slice(src.indexOf('  async tick('), src.indexOf('  modelUsdByDay()'))
  assert.match(tick, /const snap = await this\.snapshot\(index, true\)[\s\S]*const plan = await this\.makePlan\(agent, snap, ownerRequest\)[\s\S]*this\.runPlan\(agent, plan\.actions, !ownerRequest, snap\)/)
})

test('DL-2: the plan\'s order holds when a later deadline action moves earlier: the actions before it move with it', async () => {
  const t0 = Date.now()
  // A swap and the day's routine, then the leave: each runs before the one after it, the leave by its latest moment.
  const plan = [
    act({ type: 'swap_egld_for_foxsy', foxsy: 2500 }),
    act({ type: 'train', player_nonce: 1, attribute: 'speed' }),
    act({ type: 'sync' }),
    act({ type: 'leave_tournament', tournament_id: 5976 }),
    act({ type: 'create_challenge', tier: 'silver', stake_foxsy: 2500, target_user_id: 878, deadline_minutes: 240 }),
  ]
  const ran = await runPlanned(t0, plan, holding(open(5976, t0 + 12 * MIN)), () => 0.99)
  assert.deepEqual(ran.map(r => r.type), plan.map(p => p.action.type), 'every action, in the plan\'s order')
  // The ones before it are spaced 90 s back from it (an action's own run: a fresh snapshot, a transaction and its
  // confirmation), so their run time does not push the leave late; the challenge after it keeps its random moment.
  assert.deepEqual(mins(ran), [2.5, 4, 5.5, 7, 47.52])
  // A lineup saved for a match still comes before that match, and both before the leave that follows them.
  const lineup = act({ type: 'set_lineup', lineup: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], substitutes: [12, 13, 14, 15, 16, 17, 18] })
  const match = [lineup, act({ type: 'play_match', match_type: 'casual' }), act({ type: 'leave_tournament', tournament_id: 5976 })]
  const withMatch = await runPlanned(t0, match, holding(open(5976, t0 + 20 * MIN)), () => 0.99)
  assert.deepEqual(withMatch.map(r => r.type), ['set_lineup', 'play_match', 'leave_tournament'])
  assert.deepEqual(mins(withMatch), [12, 13.5, 15])
  // An earlier action whose own draw is earlier keeps it.
  const draws = [0.05, 0.5, 0.9, 0.95]
  const early = await runPlanned(t0, plan.slice(1), holding(open(5976, t0 + 12 * MIN)), () => draws.shift() ?? 0)
  assert.deepEqual(mins(early), [2.4, 5.5, 7, 45.6])
})

test('DL-3: a deadline already past or within the margin runs at once, at the first slot', async () => {
  const t0 = Date.now()
  const leave = act({ type: 'leave_tournament', tournament_id: 5976 })
  assert.deepEqual(mins(await runPlanned(t0, [leave], holding(open(5976, t0 + 3 * MIN)), () => 0.99)), [0], 'deadline in 3 minutes, inside the margin')
  assert.deepEqual(mins(await runPlanned(t0, [leave], holding(open(5976, t0 - MIN)), () => 0.99)), [0], 'deadline a minute ago: the executor says why it cannot leave, at once')
  // Behind an action of the plan: right after it, at the gap.
  const train = act({ type: 'train', player_nonce: 1, attribute: 'speed' })
  assert.deepEqual(mins(await runPlanned(t0, [train, leave], holding(open(5976, t0 + 3 * MIN)), () => 0.99)), [0, 0.5])
})

test('DL-4: a deadline action whose deadline cannot be read runs early, never late', async () => {
  const t0 = Date.now()
  const leave = act({ type: 'leave_tournament', tournament_id: 5976 })
  // Not in the snapshot (its own tournaments could not be read), a deadline that is no time, no snapshot at all.
  const unread = snapshot()
  unread.auth!.myTournaments = null
  assert.deepEqual(mins(await runPlanned(t0, [leave], unread, () => 0.99)), [0], 'its tournament is in no list of the snapshot')
  assert.deepEqual(mins(await runPlanned(t0, [leave], holding(open(5976, 'soon')), () => 0.99)), [0], 'a deadline that is no time')
  assert.deepEqual(mins(await runPlanned(t0, [leave], undefined, () => 0.99)), [0], 'no snapshot')
  // A bid on an auction that serves no end, or one the snapshot does not show.
  const noEnd = snapshot()
  noEnd.market.auctions = [auction(4242, null)]
  assert.deepEqual(mins(await runPlanned(t0, [act({ type: 'bid', nonce: 4242, foxsy: 5000 })], noEnd, () => 0.99)), [0])
  assert.deepEqual(mins(await runPlanned(t0, [act({ type: 'bid', nonce: 4343, foxsy: 5000 })], noEnd, () => 0.99)), [0])
  // The actions before it move with it.
  const train = act({ type: 'train', player_nonce: 1, attribute: 'speed' })
  assert.deepEqual(mins(await runPlanned(t0, [train, leave], undefined, () => 0.99)), [0, 0.5])
})

test('DL-5: actions without a deadline keep their random moments, and the match gates and drops are unchanged', () => {
  const seq = (...xs: number[]) => () => xs.shift() ?? 0
  const ranked = act({ type: 'play_match', match_type: 'ranked' })
  const train = act({ type: 'train', player_nonce: 1, attribute: 'speed' })
  const sync = act({ type: 'sync' })
  const leave = act({ type: 'leave_tournament', tournament_id: 5976 })
  const at = (r: ReturnType<typeof scheduleActions>) => r.kept.map(k => +(k.offset / MIN).toFixed(2))
  const base = { windowMs: 48 * MIN, gapMs: 30_000 }
  // Deadlines in ms after the plan's start, one per action: null for none, 'unread' for one that cannot be read.
  const none = (n: number) => new Array<null>(n).fill(null)
  // No deadline: the same moments as without the option (test D1's own cases).
  assert.deepEqual(at(scheduleActions([train, sync, train], { ...base, random: seq(0.1, 0.5, 0.9), deadlines: none(3) })), [4.8, 24, 43.2])
  const three = scheduleActions([ranked, ranked, ranked, sync], { ...base, random: () => 0.5, deadlines: none(4) })
  assert.deepEqual(at(three), [24, 40, 40.5])
  assert.deepEqual(three.dropped.map(d => d.reason), ['the ranked cooldown (15 min after the last ranked start)'])
  // A deadline beyond the window moves nothing.
  assert.deepEqual(at(scheduleActions([train, leave, sync], { ...base, random: seq(0.1, 0.5, 0.9), deadlines: [null, 3 * 60 * MIN, null] })), [4.8, 24, 43.2])
  // A leave first in the plan moves to its latest moment; the matches after it keep their draws and their gates, the
  // third ranked is dropped as before and the sync after them keeps its place.
  const mixed = scheduleActions([leave, ranked, ranked, ranked, sync], { ...base, random: () => 0.5, deadlines: [12 * MIN, null, null, null, null] })
  assert.deepEqual(at(mixed), [7, 24, 40, 40.5])
  assert.deepEqual(mixed.dropped.map(d => d.reason), ['the ranked cooldown (15 min after the last ranked start)'])
  // The agent's last ranked start before the plan still gates the match.
  assert.deepEqual(at(scheduleActions([leave, ranked], { ...base, random: () => 0, lastMatchMs: -5 * MIN, lastRankedMs: -5 * MIN, deadlines: [12 * MIN, null] })), [0, 11])
  // An owner request (no window) is unchanged too.
  const casual = act({ type: 'play_match', match_type: 'casual' })
  const owner = scheduleActions([leave, casual, casual], { windowMs: 0, gapMs: 30_000, random: () => 0.5, deadlines: ['unread', null, null] })
  assert.deepEqual(at(owner), [0, 0.5])
  assert.match(owner.dropped[0]!.reason, /the match before it/)
})

test('DL-6: a bid on an auction that ends 10 minutes after the plan\'s start runs before the end, the swap that funds it before the bid', async () => {
  const t0 = Date.now()
  const s = snapshot()
  s.market.auctions = [auction(4242, t0 + 10 * MIN)]
  const bid = act({ type: 'bid', nonce: 4242, foxsy: 5000 })
  assert.deepEqual(mins(await runPlanned(t0, [bid], s, () => 0.99)), [5], 'the end less the 5-minute margin')
  const funded = await runPlanned(t0, [act({ type: 'swap_egld_for_foxsy', foxsy: 5000 }), bid], s, () => 0.99)
  assert.deepEqual(funded.map(r => r.type), ['swap_egld_for_foxsy', 'bid'])
  assert.deepEqual(mins(funded), [3.5, 5])
})

test('DL-7: every action with a time limit reads it from the plan\'s snapshot, with the executor\'s own margins; the others have none', async () => {
  const t0 = Date.now()
  const one = async (raw: unknown, s: AgentSnapshot) => mins(await runPlanned(t0, [act(raw)], s, () => 0.99))[0]
  // A paid join: FoxLeague checks the deadline when the join arrives, so the executor stops 120 s before it.
  const paid = snapshot()
  paid.market.openChallenges = [open(5891, t0 + 12 * MIN)]
  assert.equal(await one({ type: 'join_tournament', tournament_id: 5891 }, paid), 5)
  // A tournament found among the open ones: its deadline, its start if sooner.
  const cup = snapshot()
  cup.market.openStandard = [open(6001, t0 + 30 * MIN, { max_teams: 8, starts_at: iso(t0 + 15 * MIN) })]
  assert.equal(await one({ type: 'join_tournament', tournament_id: 6001 }, cup), 10)
  // A free Bronze seat signs nothing: no 120 s.
  const free = snapshot()
  free.market.openStandard = [open(6002, t0 + 12 * MIN, { max_teams: 8, tier: 'bronze', entry_fee_foxsy: 0 })]
  assert.equal(await one({ type: 'join_tournament', tournament_id: 6002 }, free), 7)
  // Accepting a 1v1 aimed at this team: the challenge's own deadline.
  const forMe = snapshot()
  forMe.auth!.challengesForMe = [{ tournament_id: 5990, title: 'x', creator_user_id: 877, creator_team_name: 'Rival', entry_fee_foxsy: 2500, deadline: iso(t0 + 12 * MIN) }]
  assert.equal(await one({ type: 'join_tournament', tournament_id: 5990 }, forMe), 5)
  // A League + Knockout invitation: not paid within 30 minutes of its expiry.
  const lk = snapshot()
  const champions = open(4122, t0 + 3 * 60 * MIN, { format: 'league_knockout', max_teams: 36 })
  lk.auth!.invitations = [{ tournament_id: 4122, title: 'x', tier: 'gold', entry_fee_foxsy: 5000, wave: 1, expires_at: iso(t0 + 45 * MIN), seats_lock_at: iso(t0 + 2 * 60 * MIN), can_accept: true, refusal: null, prize_atomic: null, tournament: champions }]
  assert.equal(await one({ type: 'join_tournament', tournament_id: 4122 }, lk), 10)
  // Leaving one: not within 30 minutes of its seats locking.
  const seated = holding(champions)
  seated.auth!.leagueSeats = [{ tournamentId: 4122, seatsLockAt: iso(t0 + 40 * MIN), accepted: 20 }]
  assert.equal(await one({ type: 'leave_tournament', tournament_id: 4122 }, seated), 5)
  seated.auth!.leagueSeats = [{ tournamentId: 4122, seatsLockAt: null, accepted: 20 }]
  assert.equal(await one({ type: 'leave_tournament', tournament_id: 4122 }, seated), 0, 'a seats lock that cannot be read: early')
  // Widening the range of its own open tournament: while it is open for joining.
  assert.equal(await one({ type: 'widen_range', tournament_id: 5976, ovr_min: 30 }, holding(open(5976, t0 + 12 * MIN, { ovr_min: 35 }))), 7)
  // Cancelling its own listing matters until the first bid or the auction's end, and that end is not in the snapshot
  // (the market list leaves its own auctions out): early.
  assert.equal(await one({ type: 'cancel_listing', nonce: 7 }, snapshot()), 0)
  // No time limit: a claim, a create, a buy keep their draw.
  assert.equal(await one({ type: 'claim_refund', tournament_id: 5976 }, snapshot()), 47.52)
  assert.equal(await one({ type: 'create_challenge', tier: 'silver', stake_foxsy: 2500, target_user_id: 878, deadline_minutes: 240 }, snapshot()), 47.52)
  assert.equal(await one({ type: 'buy', product: 'xp_booster' }, snapshot()), 47.52)
})

// R70A-1 (GitHub review of PR #70): three behaviours of the change had no test that failed without them. Each test
// below was proved by breaking its behaviour in the code for a moment, seeing it fail, then restoring the code.

test('R70A-1: a League + Knockout join whose invitation is not in the snapshot has an unread deadline and runs early', async () => {
  const t0 = Date.now()
  const join = act({ type: 'join_tournament', tournament_id: 4122 })
  // Its tournament is read (registration closes in 3 hours) but not the invitation the executor pays by.
  const champions = open(4122, t0 + 3 * 60 * MIN, { format: 'league_knockout', max_teams: 36, starts_at: iso(t0 + 4 * 60 * MIN) })
  const invitation = (id: number) => ({ tournament_id: id, title: 'x', tier: 'gold', entry_fee_foxsy: 5000, wave: 1, expires_at: iso(t0 + 45 * MIN), seats_lock_at: iso(t0 + 2 * 60 * MIN), can_accept: true, refusal: null, prize_atomic: null, tournament: null })
  const listed = (invitations: ReturnType<typeof invitation>[] | null) => {
    const s = snapshot()
    s.market.openStandard = [champions]
    s.auth!.invitations = invitations
    return s
  }
  // The invitations could not be read, none is pending, or only another tournament's is: unknown, never "no limit"
  // (by the registration deadline alone it would keep its random moment, hours before the invitation runs out).
  assert.equal(actionDeadline(join.action, listed(null)), 'unread', 'the invitations could not be read')
  assert.equal(actionDeadline(join.action, listed([])), 'unread', 'no invitation is pending')
  assert.equal(actionDeadline(join.action, listed([invitation(4123)])), 'unread', 'only another tournament\'s invitation')
  // With its own invitation, its expiry less 30 minutes (as in DL-7).
  assert.equal(actionDeadline(join.action, listed([invitation(4122)])), t0 + 15 * MIN)
  // Unread runs at the first slot.
  assert.deepEqual(mins(await runPlanned(t0, [join], listed(null), () => 0.99)), [0])
})

test('R70A-1: the earliest copy of a tournament sets its deadline, and an entry is free only when every copy says so', () => {
  const t0 = Date.now()
  const join = act({ type: 'join_tournament', tournament_id: 5891 })
  const paid = BUSY_OPENS_MARGIN_S * 1000
  const far = { starts_at: iso(t0 + 5 * 60 * MIN) }
  // The same 1v1 in its own tournaments (registration closes in 40 minutes) and among the open ones (in 12): the
  // earliest counts, whichever list is read first.
  const twice = snapshot()
  twice.auth!.myTournaments!.active.push(open(5891, t0 + 40 * MIN, far))
  twice.market.openChallenges = [open(5891, t0 + 12 * MIN, far)]
  assert.equal(actionDeadline(join.action, twice), t0 + 12 * MIN - paid)
  // A free Bronze copy next to a copy that says paid is a paid entry, the stricter margin: a Bronze copy with a fee,
  // or the same id among the 1v1s aimed at this team.
  const bronze = (fee: number) => open(5891, t0 + 12 * MIN, { ...far, tier: 'bronze', entry_fee_foxsy: fee, max_teams: 8 })
  const feeCopy = snapshot()
  feeCopy.market.openStandard = [bronze(0)]
  feeCopy.auth!.myTournaments!.active.push(bronze(25))
  assert.equal(actionDeadline(join.action, feeCopy), t0 + 12 * MIN - paid, 'a Bronze copy with a fee')
  const forMe = snapshot()
  forMe.market.openStandard = [bronze(0)]
  forMe.auth!.challengesForMe = [{ tournament_id: 5891, title: 'x', creator_user_id: 877, creator_team_name: 'Rival', entry_fee_foxsy: 2500, deadline: iso(t0 + 12 * MIN) }]
  assert.equal(actionDeadline(join.action, forMe), t0 + 12 * MIN - paid, 'a 1v1 aimed at this team')
  // Every copy a free Bronze: free, no 120 s.
  const allFree = snapshot()
  allFree.market.openStandard = [bronze(0)]
  allFree.auth!.myTournaments!.active.push(bronze(0))
  assert.equal(actionDeadline(join.action, allFree), t0 + 12 * MIN)
})

test('R70A-1: a gated match listed before a deadline action keeps the plan\'s order; the deadline action waits behind it', () => {
  const ranked = act({ type: 'play_match', match_type: 'ranked' })
  const leave = act({ type: 'leave_tournament', tournament_id: 5976 })
  // The last ranked start 5 minutes before the plan holds the ranked match to minute 11; the leave's deadline is at
  // 12, so its latest moment is 7. The order is never changed to pass the match: the leave runs right behind it, at
  // 11.5, past its latest moment but before its deadline (the executor checks it again when it runs).
  const r = scheduleActions([ranked, leave], { windowMs: 48 * MIN, gapMs: 30_000, random: () => 0, lastMatchMs: -5 * MIN, lastRankedMs: -5 * MIN, deadlines: [null, 12 * MIN] })
  assert.deepEqual(r.kept.map(k => k.p.action.type), ['play_match', 'leave_tournament'], 'the plan\'s order')
  assert.deepEqual(r.kept.map(k => +(k.offset / MIN).toFixed(2)), [11, 11.5])
  assert.deepEqual(r.dropped, [])
})
