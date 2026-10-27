// Audit 2026-10-23 (48 hours of the 10 live agents): actions the plan lost to refusals it could have avoided, because
// it lacked what the executor knows, or because the scheduling defeated it. One test per finding, named after it.
import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Mnemonic } from '@multiversx/sdk-core'
import type { Config } from '../src/config.ts'
import { Service, scheduleActions } from '../src/service.ts'
import { Executor } from '../src/executor/executor.ts'
import { parseAction, type PlannedAction } from '../src/executor/actions.ts'
import { checkAction, lineupStrength, type RulesContext } from '../src/executor/rules.ts'
import type { TournamentDetail } from '../src/foxleague/types.ts'
import { renderPlanRequest, type PlanInput } from '../src/strategist/strategist.ts'
import { SYSTEM_PROMPT } from '../src/strategist/prompt.ts'
import { takeSnapshot } from '../src/snapshot/snapshot.ts'
import { playerLine, renderDigest } from '../src/snapshot/digest.ts'
import type { Store } from '../src/store/db.ts'
import { wholeToAtomic } from '../src/util/encoding.ts'
import { ADDR, OTHER, TEST_SETTINGS, dryWallet, rivalSquad, setup, snapshot, tournament } from './fixtures.ts'

function testConfig(dir: string): Config {
  return {
    mnemonic: Mnemonic.generate().toString(), dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config
}
const act = (raw: unknown, reason = ''): PlannedAction => ({ action: parseAction(raw), reason })
const hours = (h: number): string => new Date(Date.now() + h * 3600_000).toISOString()
const ctx = (more: Partial<RulesContext> = {}): RulesContext => ({ settings: { ...TEST_SETTINGS }, now: new Date(), ...more })

// ---- D1: the scheduler spaces the plan's matches by the cooldowns the executor enforces ----

test('D1 two ranked matches of one plan are scheduled at least the 15-minute ranked cooldown apart', async () => {
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-d1-'))))
  svc.ensureAgents()
  const h = new Date().getUTCHours()
  // The live agents: a 60-minute cycle (the plan's window is 80 percent of it), 30 s between actions.
  svc.store.updateSettings(0, { tickMinutes: 60, tickJitterMinutes: 10, minGapSeconds: 30, activeHoursUtc: [h, (h + 1) % 24], actionProbability: 1 })
  const scheduled: number[] = []
  ;(svc as unknown as { snapshot: unknown }).snapshot = async () => snapshot()
  ;(svc as unknown as { pause: unknown }).pause = async (ms: number) => { scheduled.push(Date.now() + ms) }
  ;(svc as unknown as { executor: unknown }).executor = { liveEnabled: false, run: async () => [] }
  const realRandom = Math.random
  Math.random = () => 0.5 // both offsets land on the same moment of the window
  try {
    const ranked = () => act({ type: 'play_match', match_type: 'ranked' })
    await (svc as unknown as { runPlan: (b: unknown, a: unknown[], r: boolean) => Promise<void> }).runPlan(svc.store.agent(0), [ranked(), ranked()], true)
  } finally {
    Math.random = realRandom
  }
  assert.equal(scheduled.length, 2, 'both ranked matches were scheduled')
  const gapMin = (scheduled[1]! - scheduled[0]!) / 60_000
  assert.ok(gapMin >= 15.5, `the second ranked start is scheduled ${gapMin.toFixed(2)} min after the first; the executor refuses a ranked start within 15.5 min of the last one, so the second is lost`)
})

test('D1 scheduleActions spaces the matches by their gates, keeps the other actions random and drops what no longer fits', () => {
  const MIN = 60_000
  const seq = (...xs: number[]) => () => xs.shift() ?? 0
  const ranked = act({ type: 'play_match', match_type: 'ranked' })
  const casual = act({ type: 'play_match', match_type: 'casual' })
  const train = act({ type: 'train', player_nonce: 1, attribute: 'speed' })
  const sync = act({ type: 'sync' })
  const at = (r: ReturnType<typeof scheduleActions>) => r.kept.map(k => +(k.offset / MIN).toFixed(2))
  const base = { windowMs: 48 * MIN, gapMs: 30_000 }
  // Two ranked starts on the same random moment: 16 min apart (the 15.5-minute gate and 30 s for the action before).
  assert.deepEqual(at(scheduleActions([ranked, ranked], { ...base, random: () => 0.5 })), [24, 40])
  // A third no longer fits the 48-minute window: dropped, with the reason, and it pushes nothing.
  const three = scheduleActions([ranked, ranked, ranked, sync], { ...base, random: () => 0.5 })
  assert.deepEqual(at(three), [24, 40, 40.5])
  assert.deepEqual(three.dropped.map(d => d.reason), ['the ranked cooldown (15 min after the last ranked start)'])
  // After any match the next waits until it is over (11 min); a casual start does not wait the ranked cooldown.
  assert.deepEqual(at(scheduleActions([casual, ranked, casual], { ...base, random: () => 0 })), [0, 11, 22])
  // The agent's last ranked start 5 minutes before the plan counts too.
  assert.deepEqual(at(scheduleActions([ranked], { ...base, random: () => 0, lastMatchMs: -5 * MIN, lastRankedMs: -5 * MIN })), [11])
  assert.deepEqual(at(scheduleActions([casual], { ...base, random: () => 0, lastMatchMs: -5 * MIN, lastRankedMs: -5 * MIN })), [6])
  // The other actions keep their random moments; only a match pushed later moves what follows it.
  assert.deepEqual(at(scheduleActions([train, sync, train], { ...base, random: seq(0.1, 0.5, 0.9) })), [4.8, 24, 43.2])
  assert.deepEqual(at(scheduleActions([ranked, train, ranked, sync], { ...base, random: seq(0.2, 0.25, 0.3, 0.9) })), [9.6, 12, 25.6, 43.2])
  // An owner request runs at once (no window): a second match cannot wait out the first and is dropped.
  const owner = scheduleActions([casual, casual], { windowMs: 0, gapMs: 30_000, random: () => 0.5 })
  assert.deepEqual(at(owner), [0])
  assert.match(owner.dropped[0]!.reason, /the match before it/)
})

test('D1 a match waits for the real gate when the action before it took longer than planned', async () => {
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-d1b-'))))
  svc.ensureAgents()
  const h = new Date().getUTCHours()
  // Two hours of active time: the plan's 45 minutes on the mocked clock stay inside them.
  svc.store.updateSettings(0, { tickMinutes: 60, tickJitterMinutes: 10, minGapSeconds: 30, activeHoursUtc: [h, (h + 2) % 24], actionProbability: 1 })
  mock.timers.enable({ apis: ['Date'], now: Date.now() })
  const checked: number[] = []
  const logged: number[] = []
  try {
    ;(svc as unknown as { snapshot: unknown }).snapshot = async () => snapshot()
    ;(svc as unknown as { pause: unknown }).pause = async (ms: number) => { mock.timers.tick(Math.max(0, ms)) }
    // The executor checks the ranked cooldown when the action starts; this start then takes 3 minutes before it is
    // logged (FoxLeague waiting for a match slot), and the log row is what the next check counts from.
    ;(svc as unknown as { executor: unknown }).executor = {
      liveEnabled: false,
      run: async (_b: unknown, _w: unknown, _s: unknown, a: PlannedAction[]) => {
        checked.push(Date.now())
        mock.timers.tick(3 * 60_000)
        logged.push(Date.now())
        svc.store.log({ agentIndex: 0, kind: 'play_match', status: 'dry_run', summary: 'DRY RUN would play ranked match', detail: { action: a[0]!.action } })
        return []
      },
    }
    const realRandom = Math.random
    Math.random = () => 0.5
    try {
      await (svc as unknown as { runPlan: (b: unknown, a: unknown[], r: boolean) => Promise<void> }).runPlan(svc.store.agent(0), [act({ type: 'play_match', match_type: 'ranked' }), act({ type: 'play_match', match_type: 'ranked' })], true)
    } finally {
      Math.random = realRandom
    }
  } finally {
    mock.timers.reset()
  }
  assert.equal(checked.length, 2)
  assert.ok(checked[1]! - logged[0]! >= 15.5 * 60_000, `the second ranked start is checked ${((checked[1]! - logged[0]!) / 60_000).toFixed(2)} min after the first was logged: refused as the ranked cooldown`)
})

// ---- D2: the weekly 1v1 count per rival ----

const neighbour = (id: number, name: string) => ({ id, wallet_address: `erd1${name.toLowerCase()}`, team_name: name, elo_rating: 1200, league: 'Bronze', accepted7d: 3, strength: 1500, winChance: 0.69 })

/** Two challenges to user 877 this week, logged the way the executor logs them (detail.opponentUserId is what the rule counts). */
function twoChallenges(store: Store): void {
  for (const tid of [2283, 2306]) {
    store.log({ agentIndex: 0, kind: 'create_challenge', status: 'dry_run', summary: `DRY RUN would create silver 1v1, stake 1000 vs user 877 (T${tid})`, detail: { action: { type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: 877, deadline_minutes: 60 }, reason: '', opponentUserId: 877 } })
  }
}

/** The plan request the service builds for agent 1 from its store, with `s` as the snapshot. */
async function planRequest(svc: Service, s: ReturnType<typeof snapshot>): Promise<string> {
  let text = ''
  svc.strategist = {
    model: 'claude-opus-5-5',
    plan: async (input: PlanInput) => {
      text = renderPlanRequest(input)
      return { summary: 'x', actions: [], rejected: [], usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0, servedBy: 'claude-opus-5-5' }, stopReason: 'end_turn' }
    },
  } as never
  await (svc as unknown as { makePlan: (a: unknown, s: unknown) => Promise<unknown> }).makePlan(svc.store.agent(0), s)
  return text
}

test('D2 the plan request marks a challenge target the executor would refuse for the weekly per-opponent limit', async () => {
  const s = snapshot()
  s.leaderboardNeighbours = [neighbour(877, 'Liverpool'), neighbour(878, 'Other')]

  // Sanity: on exactly these rows the executor refuses a third challenge to 877.
  const m = setup()
  twoChallenges(m.store)
  const [r] = await m.exec.run(m.agent(), dryWallet, s, [act({ type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: 877, deadline_minutes: 60 })])
  assert.equal(r!.status, 'refused')
  assert.match(r!.summary, /already 2 1v1s against user 877 in the last 7 days/)

  // The plan request built by the service from the same rows, a day of plans later.
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-d2-'))))
  svc.ensureAgents()
  twoChallenges(svc.store)
  for (let i = 0; i < 21; i++) svc.store.log({ agentIndex: 0, kind: 'plan', status: 'info', summary: `agent 1 plan: tick ${i}` })
  const text = await planRequest(svc, s)
  assert.ok(text.length > 0, 'the request was rendered')
  const entry = text.split('\n').flatMap(l => l.split(';')).find(e => /user 877\)/.test(e)) ?? ''
  assert.ok(entry, 'user 877 is in the list of teams to challenge')
  // Any wording that tells the model this target is at the weekly limit (or leaves it out of the list) would do.
  const told = /\blimit\b|\balready\b|unavailable|not available|refus|\b(2|two)\b[^;]*\b(7 days|this week|a week|weekly)\b/i.test(entry)
  assert.ok(told, `the request says nothing about the 2 challenges already sent to user 877 this week; the model proposes it and loses the slot:\n${entry}`)
})

test('D2 the counts come from the executor\'s own helpers: the free-again date, and nothing of the owner\'s other agents', async () => {
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-d2b-'))))
  svc.ensureAgents()
  svc.store.addAgent(1, OTHER)
  twoChallenges(svc.store)
  // Another of the owner's agents has a 1v1 out against 878: since 2026-10-27 it counts for nothing (each plays alone).
  svc.store.log({ agentIndex: 1, kind: 'create_challenge', status: 'dry_run', summary: 'DRY RUN would create silver 1v1, stake 1000 vs user 878 (T2400)', detail: { action: { type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: 878, deadline_minutes: 60 }, reason: '', opponentUserId: 878 } })
  const s = snapshot()
  s.leaderboardNeighbours = [neighbour(877, 'Liverpool'), neighbour(878, 'Other'), neighbour(879, 'Third'), neighbour(880, 'Free')]
  s.market.openChallenges = [{ ...(tournament(2500) as { tournament: Record<string, unknown> }).tournament, max_teams: 2, creator_user_id: 877, entry_fee_foxsy: 1000, participant_count: 1 } as never]
  const text = await planRequest(svc, s)
  const entry = (id: number) => text.split('\n').flatMap(l => l.split(';')).find(e => new RegExp(`user ${id}\\)`).test(e)) ?? ''
  const oldest = svc.store.activityOf(0, ['create_challenge'], new Date(0)).at(-1)!.at
  const freeAt = new Date(Date.parse(oldest) + 7 * 86_400_000).toISOString().slice(0, 16)
  assert.match(entry(877), new RegExp(`2 of 2 1v1s against it this week \\(the limit\\), free again ${freeAt} UTC`))
  for (const id of [878, 879, 880]) assert.doesNotMatch(entry(id), /not available|1v1s against it/)
  assert.doesNotMatch(text, /agent 2|another of your owner/, 'no team named')
  // The open challenge 877 created (joining it is a 1v1 against 877) carries the same count.
  assert.match(text, /T2500 [^\n]*creator user 877[^\n]*2 of 2 1v1s against it this week \(the limit\)/)
  // What the plan is told is what the executor refuses (an executor on the same store, FoxLeague mocked).
  const exec = new Executor({ cfg: {} as Config, chain: {} as never, fox: { user: async () => null, ...rivalSquad(20) } as never, store: svc.store })
  const wallet = { ...dryWallet, address: svc.store.agent(0)!.address }
  const [r] = await exec.run(svc.store.agent(0)!, wallet, s, [act({ type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: 878, deadline_minutes: 60 })])
  assert.equal(r!.status, 'dry_run', r!.summary)
  const [again] = await exec.run(svc.store.agent(0)!, wallet, s, [act({ type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: 877, deadline_minutes: 60 })])
  assert.match(again!.summary, /already 2 1v1s against user 877 in the last 7 days/)
})

// ---- D3: the seated field of an open tournament, judged by the rule's own test ----

const STATS = ['speed', 'accuracy', 'defense', 'power', 'control', 'vision', 'stamina']
const synced = (v: number) => Object.fromEntries(STATS.map(k => [`${k}_synced`, v]))
const plain = (v: number) => Object.fromEntries(STATS.map(k => [k, v]))
const xpZero = () => Object.fromEntries(STATS.map(k => [`${k}_xp`, 0]))
/** The fixture's own 18 cards in FoxLeague's card shape (every stat 20: lineup strength 1540 at full condition). */
const ownCards = () => {
  const now = new Date().toISOString()
  return snapshot().players.map(p => ({
    id: p.nonce, nft_nonce: p.nonce, owner_address: ADDR, name: p.name, position: p.position, rarity: p.rarity, shirt_number: 1, level: 1, experience: 0,
    ...plain(20), ...synced(20), ...xpZero(), condition: 100, condition_updated_at: now, stats_dirty: false, matches_played: 20, competitive_matches: 20, fusion_match_credit: 0,
    fusion_ready_at: null, goals: 0, assists: 0, listed_for_sale: false, sale_price: null, transferred_at: null, transfer_cooldown_hours: null, minted_at: now, created_at: now,
  }))
}
const giants = (stat: number) => Array.from({ length: 11 }, (_, i) => ({ nft_nonce: 9001 + i, ...synced(stat) }))

test('D3 the open-tournament line shows the seated field the Zeus join rule judges (ELO and lineup of the seated teams)', async () => {
  const base = snapshot()
  const open = { ...(tournament(60) as { tournament: Record<string, unknown> }).tournament, format: 'round_robin', max_teams: 8, min_teams: 3, participant_count: 3, home_and_away: false, round_interval_minutes: 60 }
  const seated = [501, 502, 503].map(id => ({ user_id: id, team_name: `Giant ${id}`, wallet_address: `erd1giant${id}` }))
  const giantProfile = (id: number) => ({ id, wallet_address: `erd1giant${id}`, username: null, elo_rating: 1500, league: 'Silver', matches_won: 50, matches_lost: 5, matches_drawn: 0, team_name: `Giant ${id}`, badge: null, verified: false, tournament_wins: 3, active_title: null, player_count: 18 })
  const fox = {
    config: async () => base.config,
    user: async (addr: string) => (addr === ADDR ? base.profile : giantProfile(Number(addr.replace('erd1giant', '')))),
    team: async (addr: string) => (addr === ADDR ? base.team : { ...base.team, hidden: true, lineup: [], substitutes: [] }),
    // Every seated team fields eleven cards at 40 a stat: 3,080 against our 1,540, far above the 5 percent margin.
    players: async (addr: string) => (addr === ADDR ? ownCards() : giants(40)),
    shopStatus: async () => base.auth!.shop,
    dailyAllowance: async () => base.auth!.allowance,
    activeMatch: async () => null,
    myTournaments: async () => ({ active: [], completed: [] }),
    upcomingMatches: async () => ({ lead_minutes: 30, my_team_name: 'Agent', matches: [] }),
    challengesForMe: async () => [],
    tournaments: async (q: { status?: string }) => (q.status === 'open' ? [open] : []),
    tournament: async () => ({ tournament: open, participants: seated }),
    leaderboard: async () => ({ users: [base.profile, ...[501, 502, 503].map(giantProfile)], total: 4, limit: 200, offset: 0 }),
    listings: async () => [],
    floorPrices: async () => [],
    matchHistory: async () => [],
  } as never
  const chain = { account: async () => ({ nonce: 1, balance: wholeToAtomic(10) }), esdts: async () => [], egldUsd: async () => 4.5, query: async () => { throw new Error('off') } } as never
  // A planning snapshot (the service passes the match facts cache only to the snapshot a plan is made from).
  const matchFacts = { get: () => undefined, put: () => undefined }
  const s = await takeSnapshot({ chain, fox }, { wallet: dryWallet }, new Date(), { research: true, matchFacts })
  const digest = renderDigest(s)
  const lines = digest.split('\n')
  const at = lines.findIndex(l => /^\s+T60 /.test(l))
  assert.ok(at >= 0, `the open tournament is listed:\n${digest}`)
  // The tournament's line and any indented lines right after it (where a field summary would go).
  const block: string[] = [lines[at]!]
  for (let i = at + 1; i < lines.length && /^\s+/.test(lines[i]!) && !/^\s+T\d+ "/.test(lines[i]!); i++) block.push(lines[i]!)
  assert.match(block.join('\n'), /stronger|weaker|lineup|ELO/, `the plan sees only "3/8 seated" and nothing about who sits there; the executor would refuse the join because 3 seated teams are clearly stronger:\n${block.join('\n')}`)
  assert.match(block.join('\n'), /field: 3 clearly stronger, 0 even, 0 clearly weaker \(strongest ELO 1500, lineup 3080; yours ELO 1200, lineup 1540 at its start\)/)
  // The line and the rule share one test: the same seats refuse a Zeus join.
  const seats = s.market.fields!.find(f => f.id === 60)!.seats!
  const verdict = checkAction({ type: 'join_tournament', tournament_id: 60 }, s, ctx({ zeus: true, field: seats, tournament: { tournament: open, participants: seated } as never }))
  assert.match(verdict.refusal ?? '', /3 seated teams are clearly stronger/)
})

test('D3 a field that cannot be read is shown as unknown; a check before an action reads no field', async () => {
  const base = snapshot()
  const open = { ...(tournament(61) as { tournament: Record<string, unknown> }).tournament, participant_count: 2 }
  let reads = 0
  const fox = {
    config: async () => base.config,
    user: async () => base.profile,
    team: async () => base.team,
    players: async () => ownCards(),
    shopStatus: async () => base.auth!.shop,
    dailyAllowance: async () => base.auth!.allowance,
    activeMatch: async () => null,
    myTournaments: async () => ({ active: [], completed: [] }),
    upcomingMatches: async () => ({ lead_minutes: 30, my_team_name: 'Agent', matches: [] }),
    challengesForMe: async () => [],
    tournaments: async (q: { status?: string }) => (q.status === 'open' ? [open] : []),
    tournament: async () => { reads++; throw new Error('503') },
    leaderboard: async () => ({ users: [base.profile], total: 1, limit: 200, offset: 0 }),
    listings: async () => [],
    floorPrices: async () => [],
    matchHistory: async () => [],
  } as never
  const chain = { account: async () => ({ nonce: 1, balance: wholeToAtomic(10) }), esdts: async () => [], egldUsd: async () => 4.5, query: async () => { throw new Error('off') } } as never
  const planning = await takeSnapshot({ chain, fox }, { wallet: dryWallet }, new Date(), { matchFacts: { get: () => undefined, put: () => undefined } })
  assert.match(renderDigest(planning), /T61 [^\n]*\n {4}field: unknown \(the seated teams could not be read\)/)
  const before = reads
  const check = await takeSnapshot({ chain, fox }, { wallet: dryWallet }, new Date())
  assert.equal(reads, before, 'the snapshot before each action reads no field')
  assert.equal(check.market.fields, undefined)
})

// ---- D4: the schedule check projects the squad's condition to the tournament's start ----

/** A Silver round robin of 14 teams (13 matches each, 30 minutes apart) that starts in a week. */
const weekAway = () => tournament(301, { format: 'round_robin', max_teams: 14, min_teams: 3, round_interval_minutes: 30, deadline: hours(6 * 24), starts_at: hours(7 * 24), entry_fee_foxsy: 2000 }) as TournamentDetail

test('D4 a tournament a week away is judged on the condition the squad will have at its start, not tonight', () => {
  const join = { type: 'join_tournament', tournament_id: 301 } as const
  const fresh = snapshot()
  const ok = checkAction(join, fresh, ctx({ tournament: weekAway() }))
  assert.equal(ok.ok, true, `at full condition the schedule fits: ${ok.refusal}`)

  const tired = snapshot()
  for (const p of tired.players) p.condition = 60 // after the day's ranked matches and training; back to 100 within 20 hours
  const v = checkAction(join, tired, ctx({ tournament: weekAway() }))
  assert.equal(v.ok, true, `refused a seat the squad is fit for in 7 days: ${v.refusal}`)
})

test('D4 the projection keeps the forfeit guard: a start tonight, an unreadable start, matches owed before the start', () => {
  const join = { type: 'join_tournament', tournament_id: 301 } as const
  const tired = () => {
    const s = snapshot()
    for (const p of s.players) p.condition = 60
    return s
  }
  // The same 14-team round robin starting in an hour: 2 points of rest per card change nothing.
  const soon = tournament(301, { format: 'round_robin', max_teams: 14, min_teams: 3, round_interval_minutes: 30, deadline: hours(0.5), starts_at: hours(1) }) as TournamentDetail
  assert.match(checkAction(join, tired(), ctx({ tournament: soon })).refusal ?? '', /the schedule would wear the squad down/)
  // A start that cannot be read is judged at today's condition, never projected.
  const unreadable = tournament(301, { format: 'round_robin', max_teams: 14, min_teams: 3, round_interval_minutes: 30, starts_at: 'soon' }) as TournamentDetail
  assert.match(checkAction(join, tired(), ctx({ tournament: unreadable })).refusal ?? '', /the schedule would wear the squad down/)
  // Seated in a 7-match round robin that plays from in 1 h to in 4 h: its matches cost the condition the rest until
  // a start in 5 h would bring, so a small round robin then is refused; three days later the squad is fresh again.
  const busy = tired()
  busy.auth!.myTournaments!.active = [{ ...(tournament(400) as { tournament: Record<string, unknown> }).tournament, format: 'round_robin', max_teams: 8, min_teams: 3, round_interval_minutes: 30, starts_at: hours(1), started_at: null, home_and_away: false } as never]
  const small = (startsIn: number) => tournament(301, { format: 'round_robin', max_teams: 4, min_teams: 3, round_interval_minutes: 30, deadline: hours(startsIn - 0.5), starts_at: hours(startsIn) }) as TournamentDetail
  assert.match(checkAction(join, busy, ctx({ tournament: small(5) })).refusal ?? '', /the schedule would wear the squad down: up to 3 matches/)
  assert.equal(checkAction(join, busy, ctx({ tournament: small(72) })).ok, true)
  // The instructions state the rule as it now judges: the squad at the start, rested until then.
  assert.match(SYSTEM_PROMPT, /more condition than it will have above 30 at the start \(rested until then\) plus what it regenerates between rounds/)
})

// ---- D5: the Zeus field test compares the field with our eleven at the tournament's start ----

test('D5 Zeus judges a field days away against the squad at the condition it will have then', () => {
  const join = { type: 'join_tournament', tournament_id: 302 } as const
  const seated = [{ user_id: 501 }, { user_id: 502 }, { user_id: 503 }]
  const inThreeDays = () => tournament(302, { format: 'swiss', max_teams: 8, min_teams: 3, round_interval_minutes: 60, deadline: hours(71), starts_at: hours(72) }, seated) as TournamentDetail
  // Three rivals with exactly our full-condition strength (11 x 140 = 1540) and 70 ELO more: not "clearly stronger" by the squad margin.
  const field = seated.map(p => ({ userId: p.user_id, strength: 1540, elo: 1270 }))
  const fresh = snapshot()
  assert.equal(lineupStrength(fresh), 1540)
  assert.equal(checkAction(join, fresh, ctx({ tournament: inThreeDays(), zeus: true, field })).ok, true, 'equal squads at full condition: a real chance of the top three')

  const tired = snapshot()
  for (const p of tired.players) p.condition = 70 // tonight, after the ranked matches; 100 again by tomorrow noon
  const v = checkAction(join, tired, ctx({ tournament: inThreeDays(), zeus: true, field }))
  assert.equal(v.ok, true, `the same field, the same squad, judged 72 hours early at 70 condition: ${v.refusal}`)

  // A start within the hour leaves the squad tired: the same field is still three clearly stronger teams.
  const soon = tournament(302, { format: 'swiss', max_teams: 8, min_teams: 3, round_interval_minutes: 60, deadline: hours(0.5), starts_at: hours(1) }, seated) as TournamentDetail
  assert.match(checkAction(join, tired, ctx({ tournament: soon, zeus: true, field })).refusal ?? '', /3 seated teams are clearly stronger/)
  // A 1v1 is played now: still judged at today's condition.
  const oneVOne = checkAction({ type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: 501, deadline_minutes: 60 }, tired, ctx({ zeus: true, opponent: { userId: 501, elo: 1200, strength: 1500 } }))
  assert.match(oneVOne.refusal ?? '', /the opponent's squad is stronger .* at today's condition/)
})

// ---- D6: the XP pool of a stat about to gain a point ----

test('D6 the squad lines show the XP pool of a stat about to gain a point', () => {
  const s = snapshot()
  const p = s.players.find(x => x.nonce === 7)!
  p.xp = { speed: 10, accuracy: 0, defense: 0, power: 0, control: 0, vision: 1990, stamina: 0 }
  const line = renderDigest(s).split('\n').find(l => /^\s+#7 /.test(l)) ?? playerLine(p)
  assert.match(line, /1,?990/, `the pools are not in the digest, so the plan cannot see that one session on vision gives +1:\n${line}`)
  // Compact: a pool far from its point, or on a stat at its rarity cap (XP there is lost), is left out.
  p.xp = { ...p.xp, stamina: 1800 }
  p.live.stamina = p.cap
  const again = renderDigest(s).split('\n').find(l => /^\s+#7 /.test(l))!
  assert.match(again, /vis 20 \(1990\/2000\)/)
  assert.doesNotMatch(again, /\(10\/2000\)|\(1800\/2000\)/)
})

// ---- D7: the one-card sync ----

test('D7 the model can ask for a one-card sync', () => {
  const s = snapshot()
  for (const p of s.players) p.dirty = true
  s.players.find(p => p.nonce === 7)!.live.vision = 21
  // The rules already price a one-card sync at 10 FOXSY, against 180 for all 18 dirty cards.
  assert.equal(checkAction({ type: 'sync', nonce: 7 }, s, ctx()).foxsy, 10n * 10n ** 18n)
  assert.equal(checkAction({ type: 'sync' }, s, ctx()).foxsy, 180n * 10n ** 18n)
  assert.ok(/"type":"sync"[^\n]*nonce/.test(SYSTEM_PROMPT), 'the catalogue offers the one-card sync (the system prompt lists only {"type":"sync"} all dirty cards)')
  assert.equal((parseAction({ type: 'sync', nonce: 7 }) as { nonce?: number }).nonce, 7, 'parseAction keeps the nonce')
  // Validated like every other card nonce; without one it stays the sync of every dirty card.
  for (const nonce of [0, -1, 1.5, '7', 2 ** 41]) assert.throws(() => parseAction({ type: 'sync', nonce }), /nonce must be an integer/)
  assert.deepEqual(parseAction({ type: 'sync' }), { type: 'sync' })
  assert.deepEqual(parseAction({ type: 'sync', nonce: null }), { type: 'sync' })
})

// ---- D8: home and away, the round interval ----

const createBase = { type: 'create_tournament', title: 'Varna Cup', format: 'round_robin', tier: 'silver', max_teams: 6, min_teams: 4, entry_fee_foxsy: 1000, starts_in_hours: 6, registration_closes_minutes_before: 60, round_interval_minutes: 60 }

test('D8a the create catalogue offers the home-and-away round robin the action accepts', () => {
  assert.equal((parseAction({ ...createBase, home_and_away: true }) as { home_and_away?: boolean }).home_and_away, true, 'parseAction takes it')
  assert.ok(/home_and_away/.test(SYSTEM_PROMPT), 'the catalogue in the system prompt never names home_and_away')
})

test('D8b an open round robin says whether it is home and away and how far apart its rounds are', () => {
  const s = snapshot()
  s.market.openStandard = [{ ...(tournament(60) as { tournament: Record<string, unknown> }).tournament, format: 'round_robin', max_teams: 6, min_teams: 3, participant_count: 2, home_and_away: true, round_interval_minutes: 480 } as never]
  const line = renderDigest(s).split('\n').find(l => /^\s+T60 /.test(l)) ?? ''
  assert.match(line, /home.and.away|twice|double/i, `10 matches for one seat, shown as any other round robin:\n${line}`)
  assert.match(line, /480|8 h|every 8/i, `the round interval is not shown:\n${line}`)
})

// ---- D10: a target with its own 1v1 out cannot accept ours ----

test('D10 a challenge target with its own 1v1 out is marked as unable to accept now', () => {
  const s = snapshot()
  s.leaderboardNeighbours = [{ id: 597, wallet_address: 'erd1benfica', team_name: 'SL BENFICA', elo_rating: 1248, league: 'Bronze', accepted7d: 5, strength: 1400, winChance: 0.73 }]
  s.market.openChallenges = [{ ...(tournament(2330) as { tournament: Record<string, unknown> }).tournament, max_teams: 2, creator_user_id: 597, target_user_id: null, targeted: true, entry_fee_foxsy: 1000, deadline: hours(2), participant_count: 1 } as never]
  const entry = renderDigest(s).split('\n').flatMap(l => l.split(';')).find(e => /user 597\)/.test(e)) ?? ''
  assert.ok(entry, 'the team is listed')
  assert.match(entry, /busy|cannot accept|can't accept|own 1v1|1v1 out|challenge out|active 1v1/i, `nothing says user 597 already has a 1v1 out and cannot take ours until it ends:\n${entry}`)
  assert.match(entry, new RegExp(`until ${s.market.openChallenges[0]!.deadline.slice(0, 16)} UTC`))
  // Another creator's challenge marks nobody else.
  s.market.openChallenges = [{ ...s.market.openChallenges[0]!, creator_user_id: 598 }]
  assert.doesNotMatch(renderDigest(s), /cannot accept/)
})
