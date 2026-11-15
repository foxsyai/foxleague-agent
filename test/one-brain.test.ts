// Owner, 2026-11-06: one brain for every level. Every level plays by what was Zeus's code (the win chances in its view,
// a 1v1 against a known team from 55 percent, the field rules, the XP booster only for its own fixtures) and reads the
// same strategy core; the levels differ only in money: the caps, the largest payments, the bid limits and three counts
// the code holds (paid training sessions a day, XP boosters a week, Common packs a week), and in how often they plan.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkAction, type RulesContext } from '../src/executor/rules.ts'
import type { TournamentDetail } from '../src/foxleague/types.ts'
import { Store } from '../src/store/db.ts'
import { DEFAULT_SETTINGS, LEVEL_AI, LEVEL_SETTINGS, STRATEGY_PRESETS, STRATEGY_CORE, validateSettingsPatch } from '../src/store/settings.ts'
import { budgetView } from '../src/executor/budget.ts'
import { renderPlanRequest } from '../src/strategist/strategist.ts'
import { raisesLimit } from '../src/web/server.ts'
import { TEST_SETTINGS, dryWallet, rivalSquad, setup, snapshot, tournament, withFixture } from './fixtures.ts'

const ctx = (more: Partial<RulesContext> = {}): RulesContext => ({ settings: { ...TEST_SETTINGS }, now: new Date(), ...more })
const why = (a: unknown, more: Partial<RulesContext> = {}, s = snapshot()) => {
  const v = checkAction(a as never, s, ctx(more))
  return v.ok ? '' : (v as { refusal: string }).refusal
}
const steady = { ...TEST_SETTINGS, strategy: STRATEGY_PRESETS.steady! }

test('OB-1: every level plays a 1v1 against a known team only from a 55 percent win chance', () => {
  // Our eleven: 11 x 140 = 1540 at full condition, ELO 1200; this rival is about 42 percent (the squads alone; the
  // average with its ELO was 43 until the estimate stopped at the squads' chance, audit 2026-11-11, MONEY-2).
  const challenge = { type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: 55, deadline_minutes: 60 }
  assert.match(why(challenge, { opponent: { userId: 55, elo: 1250, strength: 1600 } }), /win chance against user 55 is about 42 percent; a 1v1 against a known team is played from 55 percent/)
  assert.equal(why(challenge, { opponent: { userId: 55, elo: 1150, strength: 1400 } }), '', 'about 63 percent: played')
})

test('OB-2: every level reads a tournament\'s seated field and stays out of one with three clearly stronger teams', async () => {
  const seated = [501, 502, 503, 504].map(id => ({ user_id: id, wallet_address: `erd1seat${id}` }))
  const d = tournament(301, { max_teams: 8, min_teams: 8 }, seated) as TournamentDetail
  assert.match(why({ type: 'join_tournament', tournament_id: 301 }, { tournament: d }), /the seated teams could not be read/)
  // The executor of a Steady agent reads the field: four rivals with an ELO of 1300 and every stat at 25 (ours 20).
  const m = setup({ fox: { tournament: async () => d, user: async () => ({ elo_rating: 1300 }), ...rivalSquad(25) } })
  m.store.updateSettings(0, steady)
  const [r] = await m.exec.run(m.agent(), dryWallet, snapshot(), [{ action: { type: 'join_tournament', tournament_id: 301 }, reason: '' }])
  assert.equal(r!.status, 'refused', r!.summary)
  assert.match(r!.summary, /4 seated teams are clearly stronger/)
})

test('OB-3: every level buys the XP booster only once a competitive match of its own is drawn within its 24 hours', () => {
  const s = snapshot()
  s.auth!.upcoming!.matches = []
  assert.match(why({ type: 'buy', product: 'xp_booster' }, {}, s), /no competitive match of yours is scheduled in the next 24 hours/)
})

test('OB-4: every level\'s planning snapshot carries the win chances', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { Mnemonic } = await import('@multiversx/sdk-core')
  const { Service } = await import('../src/service.ts')
  const svc = new Service({ mnemonic: Mnemonic.generate().toString(), dataDir: mkdtempSync(join(tmpdir(), 'foxagent-')), gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9', gatewayRps: 5, apiRps: 1, foxleagueRps: 5, isServer: false, defaultDryRun: true, maxAgents: 3 } as never)
  svc.ensureAgents()
  ;(svc as unknown as { schedule: unknown }).schedule = () => undefined
  assert.equal(svc.store.agent(0)!.settings.strategy, STRATEGY_PRESETS.steady, 'a new agent starts at the Steady level')
  const fail = async () => { throw new Error('offline') }
  const me = snapshot().profile!
  const rival = { id: 77, wallet_address: 'erd1rival', team_name: 'Rival FC', elo_rating: 1210, league: 'Bronze' }
  const fakeFox: Record<string, unknown> = {
    user: async () => me,
    team: async () => snapshot().team,
    players: async (w: string) => (w === rival.wallet_address ? (await rivalSquad(20).players()) : []),
    leaderboard: async () => ({ users: [{ ...me, team_name: 'Mine' }, rival] }),
  }
  const fox = svc.fox as unknown as Record<string, unknown>
  for (const client of [svc.chain, svc.fox] as unknown as Record<string, unknown>[]) {
    for (const k of Object.getOwnPropertyNames(Object.getPrototypeOf(client))) if (k !== 'constructor' && typeof client[k] === 'function') client[k] = (client === fox ? fakeFox[k] : undefined) ?? fail
  }
  const planned = await (svc as unknown as { snapshot(i: number, plan: boolean): Promise<{ leaderboardNeighbours: { id: number; winChance?: number | null }[] }> }).snapshot(0, true)
  assert.equal(typeof planned.leaderboardNeighbours.find(u => u.id === 77)?.winChance, 'number')
})

test('OB-5: paid training sessions a day are held to the level\'s count, used and bought', () => {
  const s = snapshot()
  s.auth!.shop!.training = { ...s.auth!.shop!.training!, used_today: 7, daily_free: 5, premium_used_today: 2, premium_cap: 10, slots_banked: 3 }
  const train = { type: 'train', player_nonce: 12, attribute: 'defense' }
  const limit = (n: number) => ({ settings: { ...TEST_SETTINGS, paidTrainingPerDay: n } })
  assert.match(why(train, limit(2), s), /2 paid training sessions a day at this level, 2 used today/)
  assert.equal(why(train, limit(3), s), '')
  // Buying: what is used today and still banked counts, so 2 used + 3 banked + 1 more is over 5.
  assert.match(why({ type: 'buy', product: 'training_slot', quantity: 1 }, limit(5), s), /paid training sessions a day at this level/)
  assert.equal(why({ type: 'buy', product: 'training_slot', quantity: 1 }, limit(6), s), '')
  const blind = snapshot()
  blind.auth!.shop = null as never
  assert.match(why({ type: 'buy', product: 'training_slot', quantity: 1 }, limit(6), blind), /training quota unknown/)
})

test('OB-6: XP boosters a week are held to the level\'s count, from the agent\'s own purchases', () => {
  const s = snapshot()
  s.auth!.myTournaments!.active = [{ ...(tournament(60, { status: 'active' }) as { tournament: object }).tournament }] as never
  s.auth!.upcoming!.matches = [{ tournament_id: 60, tournament_title: 'T60', round_label: 'R1', group_name: null, is_home: true, opponent_name: 'Rival', scheduled_at: new Date(Date.now() + 2 * 3600_000).toISOString(), strategy_locks_at: new Date(Date.now() + 1.5 * 3600_000).toISOString(), locked: false, phase: 'upcoming', home_score: null, away_score: null }] as never
  const booster = { type: 'buy', product: 'xp_booster' }
  const at = (perWeek: number, thisWeek: number) => ({ settings: { ...TEST_SETTINGS, boostersPerWeek: perWeek }, boostersThisWeek: thisWeek })
  assert.equal(why(booster, at(2, 1), s), '')
  assert.match(why(booster, at(2, 2), s), /2 XP boosters a week at this level, 2 bought in the last 7 days/)
  assert.match(why(booster, at(0, 0), s), /no XP booster at this level/)
  assert.match(why(booster, { settings: { ...TEST_SETTINGS, boostersPerWeek: 2 } }, s), /the XP boosters bought this week could not be counted/)
})

test('OB-7: Common packs a week are held to the level\'s count, from the agent\'s own purchases', () => {
  const pack = { type: 'buy', product: 'common_pack' }
  const at = (perWeek: number, thisWeek: number) => ({ settings: { ...TEST_SETTINGS, packsPerWeek: perWeek }, packsThisWeek: thisWeek })
  assert.equal(why(pack, at(1, 0)), '')
  assert.match(why(pack, at(1, 1)), /1 Common pack a week at this level, 1 bought in the last 7 days/)
  assert.match(why(pack, at(0, 0)), /no Common packs at this level/)
})

test('OB-8: an agent saved before the counts plays on at FoxLeague\'s maximum; a new one starts at Steady\'s; a raise asks the password', () => {
  const store = new Store('', ':memory:')
  store.addAgent(0, dryWallet.address)
  const fresh = store.agent(0)!.settings
  assert.deepEqual([fresh.paidTrainingPerDay, fresh.boostersPerWeek, fresh.packsPerWeek], [2, 0, 0], 'a new agent: Steady')
  // A row written before the counts existed: no count in its JSON.
  const { paidTrainingPerDay: _a, boostersPerWeek: _b, packsPerWeek: _c, ...old } = { ...DEFAULT_SETTINGS, strategy: STRATEGY_PRESETS.zeus! }
  ;(store as unknown as { db: { prepare(q: string): { run(...a: unknown[]): unknown } } }).db.prepare('UPDATE agents SET settings = ? WHERE idx = 0').run(JSON.stringify(old))
  const saved = store.agent(0)!.settings
  assert.deepEqual([saved.paidTrainingPerDay, saved.boostersPerWeek, saved.packsPerWeek], [10, 7, 2], 'FoxLeague\'s own maximum: nothing changes for it')
  for (const k of ['paidTrainingPerDay', 'boostersPerWeek', 'packsPerWeek'] as const) {
    assert.equal(raisesLimit({ ...DEFAULT_SETTINGS }, { [k]: DEFAULT_SETTINGS[k] + 1 }), true, `${k} up asks the password`)
    assert.equal(raisesLimit({ ...DEFAULT_SETTINGS, [k]: 2 }, { [k]: 1 }), false, `${k} down is one click`)
  }
  assert.throws(() => validateSettingsPatch({ paidTrainingPerDay: 11 }), /paidTrainingPerDay/)
  assert.throws(() => validateSettingsPatch({ boostersPerWeek: 8 }), /boostersPerWeek/)
  assert.throws(() => validateSettingsPatch({ packsPerWeek: 3 }), /packsPerWeek/)
})

test('OB-9: the six levels share one strategy core and differ in money and pace only', () => {
  for (const [level, text] of Object.entries(STRATEGY_PRESETS)) {
    assert.ok(text.includes(STRATEGY_CORE), `${level} carries the core`)
    assert.ok(text.length <= 3000, `${level} fits the 3,000 characters`)
    assert.match(text, new RegExp(`^${level[0]!.toUpperCase()}${level.slice(1)} \\(level \\d of 6\\)`), level)
  }
  assert.equal(new Set(Object.values(LEVEL_AI).map(a => `${a.model} ${a.effort}`)).size, 1, 'one AI for every level')
  const row = (k: keyof (typeof LEVEL_SETTINGS)['steady']) => Object.values(LEVEL_SETTINGS).map(l => l[k])
  assert.deepEqual(row('dailyCapUsd'), [5, 15, 25, 50, 100, 150])
  assert.deepEqual(row('paidTrainingPerDay'), [2, 4, 6, 8, 10, 10])
  assert.deepEqual(row('boostersPerWeek'), [0, 1, 2, 3, 7, 7])
  assert.deepEqual(row('packsPerWeek'), [0, 0, 1, 2, 2, 2])
  assert.deepEqual(row('maxBidFoxsy'), [500, 1500, 7000, 14_000, 14_000, 38_000])
  assert.deepEqual(row('maxShopPaymentFoxsy'), [500, 2000, 2500, 3000, 9000, 9000])
  assert.deepEqual(row('tickMinutes'), [120, 120, 90, 90, 75, 60])
  // The plan sees the counts with the other limits.
  const counts = { ...TEST_SETTINGS, paidTrainingPerDay: 4, boostersPerWeek: 1, packsPerWeek: 0 }
  const text = renderPlanRequest({ settings: counts, snapshot: snapshot(), budget: budgetView(setup().store, 0, counts, true, new Date()), recent: [], dryRun: true })
  assert.match(text, /Counts at this level: paid training sessions at most 4 a day, XP boosters at most 1 a week, Common packs none/)
})

// Agent review of PR #55 (low): the Boosters a week help said 3 sure matches, while the code needs one competitive
// match of its own drawn within the booster's 24 hours; the integration notes still said Zeus for two rules every level
// now follows.
test('R55A-1: the counts\' help and the integration notes say what the code does', async () => {
  const { readFileSync } = await import('node:fs')
  const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\s+/g, ' ')
  for (const f of ['src/web/dashboard.html', 'site/src/content/docs/use/settings.md']) {
    assert.doesNotMatch(read(f), /only when 3 competitive matches of its own are sure/, f)
    assert.match(read(f), /only once a competitive match of its own is drawn within the 24 hours/, f)
  }
  const notes = read('docs/FOXLEAGUE-INTEGRATION.md')
  assert.doesNotMatch(notes, /Zeus with fewer than 24 clearly stronger invited teams/)
  assert.doesNotMatch(notes, /at the Zeus level the agent buys one only with such a fixture/)
})

// Agent review of PR #55 (low, test): the 7-day count of the agent's own purchases had no executor-level test.
test('R55A-2: the executor counts the agent\'s own boosters of the last 7 days: this mode, this product, sent or lost, never refunded', async () => {
  const m = setup()
  m.store.updateSettings(0, { boostersPerWeek: 2, maxShopPaymentFoxsy: 2500 })
  const row = (status: string, product: string, more: Record<string, unknown> = {}, txHash: string | null = null) =>
    m.store.log({ agentIndex: 0, kind: 'buy', status: status as never, summary: `buy ${product}`, detail: { action: { type: 'buy', product }, ...more }, txHash })
  row('dry_run', 'xp_booster', {}, 'h1') // counted (dry run, this mode)
  row('error', 'xp_booster', { sent: true }) // counted: it may have paid
  row('confirmed', 'xp_booster', {}, 'h3') // the live ledger: not this mode
  row('dry_run', 'common_pack', {}, 'h4') // another product
  row('error', 'xp_booster', { sent: false }) // never sent
  const age = (ms: number) => (m.store as unknown as { db: { prepare(q: string): { run(...a: unknown[]): unknown } } }).db.prepare("UPDATE activity SET at = ? WHERE kind = 'buy'").run(new Date(Date.now() - ms).toISOString())
  age(2 * 86_400_000) // two days ago: past the booster's own renewal window, inside the week
  const buy = async () => (await m.exec.run(m.agent(), dryWallet, withFixture(snapshot()), [{ action: { type: 'buy', product: 'xp_booster' }, reason: '' }]))[0]!
  const two = await buy()
  assert.equal(two.status, 'refused', two.summary)
  assert.match(two.summary, /2 XP boosters a week at this level, 2 bought in the last 7 days/)
  // A refunded payment counts for nothing: the FOXSY came back and nothing was delivered.
  m.store.recordSpend({ agentIndex: 0, at: new Date(), gameDay: '2026-11-06', category: 'play', action: 'shop:xp_booster:refunded', foxsyAtomic: 0n, egldAtomic: 0n, usd: 0, txHash: 'h1', dryRun: true })
  assert.equal((await buy()).status, 'dry_run', 'one left after the refund')
  // Older than 7 days: none count.
  const n = setup()
  n.store.updateSettings(0, { boostersPerWeek: 1, maxShopPaymentFoxsy: 2500 })
  n.store.log({ agentIndex: 0, kind: 'buy', status: 'dry_run', summary: 'buy xp_booster', detail: { action: { type: 'buy', product: 'xp_booster' } } })
  ;(n.store as unknown as { db: { prepare(q: string): { run(...a: unknown[]): unknown } } }).db.prepare("UPDATE activity SET at = ? WHERE kind = 'buy'").run(new Date(Date.now() - 8 * 86_400_000).toISOString())
  assert.equal((await n.exec.run(n.agent(), dryWallet, withFixture(snapshot()), [{ action: { type: 'buy', product: 'xp_booster' }, reason: '' }]))[0]!.status, 'dry_run')
})

// Agent review of PR #55, second pass (low, rule 4): a training status without its used or banked numbers made the count
// NaN, and a paid session or a slot purchase went through unchecked.
test('R55A-3: a training status whose used or banked numbers cannot be read refuses a paid session and a slot purchase', () => {
  for (const field of ['premium_used_today', 'slots_banked'] as const) {
    const s = snapshot()
    s.auth!.shop!.training = { ...s.auth!.shop!.training!, used_today: 7, daily_free: 5, premium_used_today: 1, premium_cap: 10, slots_banked: 2 }
    delete (s.auth!.shop!.training as unknown as Record<string, unknown>)[field]
    const limit = { settings: { ...TEST_SETTINGS, paidTrainingPerDay: 10 } }
    assert.match(why({ type: 'buy', product: 'training_slot', quantity: 1 }, limit, s), /training quota unknown/, field)
    if (field === 'premium_used_today') assert.match(why({ type: 'train', player_nonce: 12, attribute: 'defense' }, limit, s), /training quota unknown/, field)
  }
})

// Agent review of PR #55, third pass (low, docs): the Settings page still called a Max bid of 0 the Steady and Climber
// default, while every level bids since 2026-11-06.
test('R55A-4: no page or bubble says a level\'s default turns bidding off', async () => {
  const { readFileSync } = await import('node:fs')
  const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\s+/g, ' ')
  for (const f of ['site/src/content/docs/use/settings.md', 'site/src/content/docs/play/strategy-levels.md', 'src/web/dashboard.html', 'README.md']) {
    assert.doesNotMatch(read(f), /\(the Steady and Climber default\)|no bids below the hunter|Max bid \| 0 \(off\)/i, f)
  }
  assert.ok(Object.values(LEVEL_SETTINGS).every(l => l.maxBidFoxsy > 0), 'every level bids')
})
