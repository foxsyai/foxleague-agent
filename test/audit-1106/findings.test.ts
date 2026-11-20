// Grand audit of 2026-11-06 (owner: the manual a mirror of the deployed agent, and a Fable 5.1 max review of PRs #53
// to #56): five reviewers (MONEY, ATTACK, EDGE, INTEG, DOCS) on the frozen production tree 20ceea1. One test per
// finding, each failing on 20ceea1 and passing after its fix (docs/SECURITY-REVIEW.md, "Grand audit of 2026-11-06").

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseAction } from '../../src/executor/actions.ts'
import { checkAction, CORE_CARDS, type RulesContext } from '../../src/executor/rules.ts'
import { ApiRefusal, rivalStrength } from '../../src/foxleague/api.ts'
import type { TournamentDetail } from '../../src/foxleague/types.ts'
import { renderDigest } from '../../src/snapshot/digest.ts'
import { LEVEL_SETTINGS } from '../../src/store/settings.ts'
import { SYSTEM_PROMPT } from '../../src/strategist/prompt.ts'
import { STRANGER, TEST_SETTINGS, card, dryWallet, liveWallet, rivalSquad, setup, snapshot, tournament, withLive } from '../fixtures.ts'

const ctx = (more: Partial<RulesContext> = {}): RulesContext => ({ settings: { ...TEST_SETTINGS }, now: new Date(), ...more })
const why = (a: unknown, more: Partial<RulesContext> = {}, s = snapshot()) => {
  const v = checkAction(a as never, s, ctx(more))
  return v.ok ? '' : (v as { refusal: string }).refusal
}
const act = (a: Record<string, unknown>) => [{ action: a as never, reason: '' }]
const read = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8').replace(/\s+/g, ' ')
const STATS = ['speed', 'accuracy', 'defense', 'power', 'control', 'vision', 'stamina']
const withoutStats = (s: ReturnType<typeof snapshot>) => {
  delete (s.players.find(p => p.nonce === s.team!.lineup[3])! as unknown as Record<string, unknown>).syncedTotal
  return s
}

// ---- ATTACK ----

/** A rival roster: every synced stat at `synced` (ours are 20), every live stat at `live`. */
const roster = (synced: number, live: number) => ({
  players: async () => Array.from({ length: 11 }, (_, i) => ({
    nft_nonce: 9001 + i,
    ...Object.fromEntries(STATS.map(k => [`${k}_synced`, synced])),
    ...Object.fromEntries(STATS.map(k => [k, live])),
  })),
})

test('ATTACK-1: a rival is judged at the stronger of its synced and its live stats: training it can sync before the match counts', async () => {
  assert.equal(await rivalStrength(roster(18, 40) as never, STRANGER), await rivalStrength(roster(40, 40) as never, STRANGER))
  assert.equal(await rivalStrength(roster(18, 10) as never, STRANGER), 11 * 7 * 18, 'live under synced: the synced stats play')
  const open = setup({
    fox: {
      user: async (a: string) => (a === STRANGER ? { id: 900, wallet_address: STRANGER, elo_rating: 1200 } : null),
      tournament: async () => tournament(555, { max_teams: 2, min_teams: 2, creator_user_id: 900 }, [{ user_id: 900, wallet_address: STRANGER }]),
      ...roster(18, 40),
    },
  })
  const [j] = await open.exec.run(open.agent(), dryWallet, snapshot(), act({ type: 'join_tournament', tournament_id: 555 }))
  assert.equal(j!.status, 'refused', j!.summary)
  assert.match(j!.summary, /stronger/)
  const s = snapshot()
  s.leaderboardNeighbours = [{ id: 50, wallet_address: STRANGER, team_name: 'Rival', elo_rating: 1190, league: 'Bronze', accepted7d: 3 }]
  const aimed = setup({ fox: roster(18, 40) })
  const [c] = await aimed.exec.run(aimed.agent(), dryWallet, s, act({ type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: 50, deadline_minutes: 60 }))
  assert.equal(c!.status, 'refused', c!.summary)
  assert.match(c!.summary, /stronger/)
})

// ---- EDGE ----

test('EDGE-1: our own stats or ELO that cannot be read refuse a 1v1 and a tournament entry, never "nobody is stronger"', async () => {
  const challenge = { type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: 55, deadline_minutes: 60 }
  assert.match(why(challenge, { opponent: { userId: 55, elo: 1150, strength: 3080 } }, withoutStats(snapshot())), /could not be read/)
  const seated = [501, 502, 503, 504].map(id => ({ user_id: id, wallet_address: `erd1seat${id}` }))
  const d = tournament(301, { max_teams: 8, min_teams: 8 }, seated) as TournamentDetail
  const field = seated.map(p => ({ userId: p.user_id, elo: 1300, strength: 3080 }))
  assert.match(why({ type: 'join_tournament', tournament_id: 301 }, { tournament: d, field }, withoutStats(snapshot())), /could not be read|clearly stronger/)
  const noElo = snapshot()
  delete (noElo.profile as unknown as Record<string, unknown>).elo_rating
  assert.match(why({ type: 'join_tournament', tournament_id: 301 }, { tournament: d, field }, noElo), /could not be read|clearly stronger/)
  assert.match(why(challenge, { opponent: { userId: 55, elo: 1150, strength: 1400 } }, noElo), /could not be read/)
  const m = setup({ fox: { tournament: async () => d, user: async () => ({ elo_rating: 1300 }), ...rivalSquad(40) } })
  const [r] = await m.exec.run(m.agent(), dryWallet, withoutStats(snapshot()), act({ type: 'join_tournament', tournament_id: 301 }))
  assert.equal(r!.status, 'refused', r!.summary)
  const view = withoutStats(snapshot())
  view.leaderboardNeighbours = [{ id: 7, wallet_address: 'erd1x', team_name: 'X', elo_rating: 1200, league: 'Bronze', accepted7d: 1, strength: 1500, winChance: 0.5 }] as never
  assert.doesNotMatch(renderDigest(view), /NaN/)
})

test('EDGE-2: a seated team whose ELO could not be read but whose lineup reads is unread, not even: three of them stop the join', async () => {
  const seated = [501, 502, 503].map(id => ({ user_id: id, wallet_address: `erd1seat${id}` }))
  const d = tournament(302, { max_teams: 8, min_teams: 8 }, seated) as TournamentDetail
  assert.match(why({ type: 'join_tournament', tournament_id: 302 }, { tournament: d, field: seated.map(p => ({ userId: p.user_id, elo: null, strength: 3080 })) }), /could not be read|clearly stronger/)
  const m = setup({ fox: { tournament: async () => d, user: async () => { throw new Error('429 Too Many Requests') }, ...rivalSquad(40) } })
  const [r] = await m.exec.run(m.agent(), dryWallet, snapshot(), act({ type: 'join_tournament', tournament_id: 302 }))
  assert.equal(r!.status, 'refused', r!.summary)
})

test('EDGE-3: a training status whose used-today or free-session number cannot be read refuses a session', () => {
  for (const field of ['used_today', 'daily_free'] as const) {
    const s = snapshot()
    const t = s.auth!.shop!.training! as unknown as Record<string, unknown>
    Object.assign(t, { premium_used_today: 2, slots_banked: 3 })
    delete t[field]
    assert.match(why({ type: 'train', player_nonce: 12, attribute: 'defense' }, { settings: { ...TEST_SETTINGS, paidTrainingPerDay: 2 } }, s), /training quota unknown/, field)
  }
})

// ---- INTEG ----

test('INTEG-1: the paid sessions of the day are the sessions past the free ones (premium_used_today counts purchases in 24 h, shop.rs:866-873)', () => {
  const limit = { settings: { ...TEST_SETTINGS, paidTrainingPerDay: 2 } }
  // One purchase of 2 slots, both used: FoxLeague answers premium_used_today 1 (one purchase row); a third slot is over 2.
  const used = snapshot()
  used.auth!.shop!.training = { daily_free: 5, premium_cap: 10, used_today: 7, premium_used_today: 1, slots_banked: 0 }
  assert.match(why({ type: 'buy', product: 'training_slot', quantity: 1 }, limit, used), /paid training sessions a day at this level/)
  // Two one-slot purchases yesterday evening: no paid session used today, the first of the day is allowed.
  const fresh = snapshot()
  fresh.auth!.shop!.training = { daily_free: 5, premium_cap: 10, used_today: 5, premium_used_today: 2, slots_banked: 3 }
  assert.equal(why({ type: 'train', player_nonce: 12, attribute: 'defense' }, limit, fresh), '')
  assert.match(renderDigest(fresh), /paid sessions used today 0/)
})

test('INTEG-2: a create FoxLeague left pending on chain after the organizer payment is not reported as nothing created and refunded', async () => {
  const fees = { live: true, live_from: '2026-11-09T14:00:00Z', private_match_fee_foxsy: 0, calendar_deposit_per_match_foxsy: 25, calendar_deposit_min_foxsy: 0, calendar_deposit_grace_minutes: 60 }
  const s = snapshot()
  s.config!.organizer_fees = fees
  const cup = parseAction({ type: 'create_tournament', title: 'Autumn Cup', format: 'round_robin', tier: 'silver', max_teams: 4, min_teams: 3, entry_fee_foxsy: 1000, starts_in_hours: 96, registration_closes_minutes_before: 60, round_interval_minutes: 30 })
  const bodies: Record<string, unknown>[] = []
  const m = setup({
    fox: {
      organizerFeeQuote: async () => ({ owed: true, games: 6, private_fee_foxsy: 0, deposit_foxsy: 150, total_foxsy: 150, grace_minutes: 60, no_free_cancel: false }),
      createTournament: async (_w: unknown, body: Record<string, unknown>) => {
        bodies.push({ ...body })
        if (!body.organizer_fee_tx_hash) throw new ApiRefusal('This tournament needs a payment of 150 FOXSY from its organizer before it is created.', 'organizer_fee_required')
        // tournaments.rs:4990-4994: the row is committed pending_sc with the payment on it.
        throw new ApiRefusal('On-chain tournament creation could not be confirmed yet. The network may not be producing blocks; the tournament stays pending until its creation can be confirmed. Please check the tournament list before retrying.')
      },
    },
    chain: { send: async () => 'hashfee' },
  })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, s, [{ action: cup, reason: '' }])
    assert.deepEqual(bodies.map(b => b.organizer_fee_tx_hash), [undefined, 'hashfee'], 'paid once, the hash sent once')
    assert.doesNotMatch(r!.summary, /nothing created|FoxLeague refunds one that stays unused/, r!.summary)
    assert.match(r!.summary, /may have created it/, r!.summary)
    // The payment stays counted (it is on that tournament) and is no longer held as a payment to reuse or refund.
    assert.equal(m.store.openSpend(0, 'shop:organizer_fee', false).length, 1, 'the organizer payment stays in the ledger')
    assert.equal(m.store.pending(0).filter(p => p.kind === 'organizer_fee').length, 0, 'nothing left pending')
  })
  // "Not verified yet" with the same words is FoxLeague's tx_pending: the same hash is asked again first, never paid twice.
  let asked = 0
  const retry = setup({
    fox: {
      organizerFeeQuote: async () => ({ owed: true, games: 6, private_fee_foxsy: 0, deposit_foxsy: 150, total_foxsy: 150, grace_minutes: 60, no_free_cancel: false }),
      createTournament: async (_w: unknown, body: Record<string, unknown>) => {
        if (!body.organizer_fee_tx_hash) throw new ApiRefusal('This tournament needs a payment of 150 FOXSY from its organizer before it is created.', 'organizer_fee_required')
        if (++asked === 1) throw new ApiRefusal('Could not verify the payment state right now. Please retry in a moment.', 'tx_pending')
        throw new ApiRefusal('On-chain tournament creation could not be confirmed yet. The tournament stays pending until its creation can be confirmed.')
      },
    },
    chain: { send: async () => 'hashfee2' },
  })
  await withLive(retry.store, async () => {
    const [r] = await retry.exec.run(retry.agent(), liveWallet, s, [{ action: cup, reason: '' }])
    assert.equal(asked, 2, 'asked again after tx_pending, with the same hash')
    assert.match(r!.summary, /hashfee2 made, and FoxLeague may have created it/, r!.summary)
  })
})

// ---- MONEY (EDGE-4 found the same) ----

test('MONEY-1: three clearly stronger teams in seats 33 to 35 of a 64-team field are judged like the ones in seats 1 to 3', async () => {
  const joins = async (strongSeats: number[]) => {
    const seated = Array.from({ length: 35 }, (_, i) => ({ user_id: 501 + i, wallet_address: `erd1seat${501 + i}` }))
    const strong = new Set(strongSeats.map(i => `erd1seat${501 + i}`))
    const d = tournament(301, { max_teams: 64, min_teams: 6, format: 'groups_knockout', round_interval_minutes: 30 }, seated) as TournamentDetail
    const weak = rivalSquad(20)
    const beast = rivalSquad(30)
    const m = setup({ fox: {
      tournament: async () => d,
      user: async (w: string) => ({ elo_rating: strong.has(w) ? 1500 : 1200 }),
      team: async (w: string) => (strong.has(w) ? beast : weak).team(),
      players: async (w: string) => (strong.has(w) ? beast : weak).players(),
    } })
    const [r] = await m.exec.run(m.agent(), dryWallet, snapshot(), act({ type: 'join_tournament', tournament_id: 301 }))
    return `${r!.status}: ${r!.summary}`
  }
  assert.match(await joins([0, 1, 2]), /^refused: .*3 seated teams are clearly stronger/)
  assert.match(await joins([32, 33, 34]), /^refused: .*3 seated teams are clearly stronger/)
})

// ---- DOCS ----

test('DOCS-1: a fusion fee is held to the largest shop payment, as the levels page says (Steady: fees up to 400)', () => {
  const epics = [40, 41, 42].map(n => card(n, 'FWD', 'reserve', { rarity: 'Epic', cap: 90, competitiveMatches: 135 }))
  const s = snapshot(epics)
  const fuse = { type: 'fuse', player_nonces: [40, 41, 42], position_of: 0 }
  const steady = { ...TEST_SETTINGS, maxShopPaymentFoxsy: LEVEL_SETTINGS.steady!.maxShopPaymentFoxsy }
  assert.match(why(fuse, { settings: steady, canFuse: { can_fuse: true }, fusionPool: 4 }, s), /fusion fee of 800 FOXSY exceeds the per-action maximum 500/)
  assert.equal(why(fuse, { settings: { ...steady, maxShopPaymentFoxsy: 800 }, canFuse: { can_fuse: true }, fusionPool: 4 }, s), '')
  assert.match(read('site/src/content/docs/play/strategy-levels.md'), /\| Fusion fees \(100 to 800\) \| up to 400 \| all \| all \| all \| all \| all \|/)
  assert.match(read('site/src/content/docs/use/settings.md'), /\| Max shop payment \|[^|]*\|[^|]*a fusion fee \(100 to 800\)/)
  assert.doesNotMatch(read('src/web/dashboard.html'), /Fusion fees \(100 to 800\) and marketplace bids have their own rules/)
})

test('DOCS-2: the settings page lists the three counts among what a level proposes', () => {
  assert.match(read('site/src/content/docs/use/settings.md'), /the Silver and Gold amounts, the paid training a day, the boosters and packs a week, the medicine days a week or the tick/)
})

test('DOCS-3: how-it-plays makes a higher private platform fee conditional, as FoxLeague serves one split today', () => {
  const plays = read('site/src/content/docs/play/how-it-plays.md')
  assert.doesNotMatch(plays, /A private tournament pays a higher platform fee out of its prize pool/)
  assert.match(plays, /Once FoxLeague charges a private tournament a higher platform fee out of its prize pool \(its prize split says so\), shared by every team in it, the agent weighs that before it invites/)
})

test('DOCS-4: the manual says the agent never lists one of its 18 strongest cards nor leaves fewer than 18', () => {
  assert.equal(CORE_CARDS, 18)
  assert.match(read('site/src/content/docs/play/how-it-plays.md'), /lists spare cards above the floor, never one of its 18 strongest cards and never so that fewer than 18 cards remain/)
})

test('DOCS-5: the prompt offers no formation the action catalogue refuses (4-4-2a is not playable yet)', () => {
  const styles = SYSTEM_PROMPT.match(/Formation styles: [^.]*\./)?.[0] ?? '(no styles line)'
  assert.doesNotMatch(styles, /4-4-2a/, styles)
  assert.throws(() => parseAction({ type: 'set_formation', formation: '4-4-2a' }), /formation/)
})
