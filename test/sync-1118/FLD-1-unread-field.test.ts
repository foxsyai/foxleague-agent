// FLD-1 (agent 1, 18 Nov 2026): the plan proposed to join two paid Bronze round robins (T5567, T5571, 18 teams each)
// and the executor refused both: "3 (4) seated teams are clearly stronger ... no real chance of the top three". The
// plan could not know: a planning snapshot reads the seated field of only the FIELD_TOURNAMENTS joinable tournaments
// with the nearest deadlines (readFields), and the digest printed a field line for those only, so "not read" and
// "nothing to say" looked the same. Every other tournament the field rule judges at the join now says that its field
// was not read in this snapshot and that the executor reads it at the join, with the rule's own limit (FIELD_LIMIT).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { takeSnapshot } from '../../src/snapshot/snapshot.ts'
import { renderDigest } from '../../src/snapshot/digest.ts'
import { FIELD_LIMIT } from '../../src/executor/rules.ts'
import { wholeToAtomic } from '../../src/util/encoding.ts'
import { ADDR, dryWallet, snapshot, tournament } from '../fixtures.ts'

const STATS = ['speed', 'accuracy', 'defense', 'power', 'control', 'vision', 'stamina']
const plain = (v: number) => Object.fromEntries(STATS.map(k => [k, v]))
const synced = (v: number) => Object.fromEntries(STATS.map(k => [`${k}_synced`, v]))
const xpZero = () => Object.fromEntries(STATS.map(k => [`${k}_xp`, 0]))
/** The fixture's own 18 cards in FoxLeague's card shape (every stat 20). */
const ownCards = () => {
  const now = new Date().toISOString()
  return snapshot().players.map(p => ({
    id: p.nonce, nft_nonce: p.nonce, owner_address: ADDR, name: p.name, position: p.position, rarity: p.rarity, shirt_number: 1, level: 1, experience: 0,
    ...plain(20), ...synced(20), ...xpZero(), condition: 100, condition_updated_at: now, stats_dirty: false, matches_played: 20, competitive_matches: 20, fusion_match_credit: 0,
    fusion_ready_at: null, goals: 0, assists: 0, listed_for_sale: false, sale_price: null, transferred_at: null, transfer_cooldown_hours: null, minted_at: now, created_at: now,
  }))
}

/** A paid Bronze round robin of 18 teams with two seated, its deadline `h` hours ahead. */
const bronze = (id: number, h: number, more: Record<string, unknown> = {}): Record<string, unknown> & { id: number } => ({
  ...(tournament(id) as { tournament: Record<string, unknown> & { id: number } }).tournament,
  tier: 'bronze', entry_fee_foxsy: 100, format: 'round_robin', max_teams: 18, min_teams: 3, participant_count: 2, home_and_away: false, round_interval_minutes: 60,
  deadline: new Date(Date.now() + h * 3600_000).toISOString(), starts_at: new Date(Date.now() + (h + 1) * 3600_000).toISOString(), ...more,
})

async function planningDigest(o: { planning: boolean }) {
  const base = snapshot()
  // Six joinable ones by deadline (5567 and 5571 among them, past the first four), ours already in 5575, a free Bronze
  // and a full one (neither judged by the field rule).
  const open = [
    bronze(5501, 2), bronze(5502, 3), bronze(5503, 4), bronze(5504, 5), bronze(5567, 6), bronze(5571, 7), bronze(5575, 8),
    bronze(5580, 9, { entry_fee_foxsy: 0 }), bronze(5581, 10, { participant_count: 18 }),
  ]
  const asked: number[] = []
  const rival = (id: number) => ({ user_id: id, team_name: `Rival ${id}`, wallet_address: `erd1rival${id}` })
  const fox = {
    config: async () => base.config,
    user: async (addr: string) => (addr === ADDR ? base.profile : { ...base.profile, id: Number(addr.replace('erd1rival', '')), wallet_address: addr, team_name: 'Rival', elo_rating: 1200 }),
    team: async (addr: string) => (addr === ADDR ? base.team : { ...base.team, hidden: true, lineup: [], substitutes: [] }),
    players: async (addr: string) => (addr === ADDR ? ownCards() : Array.from({ length: 11 }, (_, i) => ({ nft_nonce: 9001 + i, ...synced(19) }))),
    shopStatus: async () => base.auth!.shop,
    dailyAllowance: async () => base.auth!.allowance,
    activeMatch: async () => null,
    myTournaments: async () => ({ active: [open[6]], completed: [] }),
    upcomingMatches: async () => ({ lead_minutes: 30, my_team_name: 'Agent', matches: [] }),
    challengesForMe: async () => [],
    tournaments: async (q: { status?: string }) => (q.status === 'open' ? open : []),
    tournament: async (id: number) => (asked.push(id), { tournament: open.find(t => t.id === id), participants: id === 5575 ? [rival(700), { user_id: base.profile!.id, team_name: 'Agent', wallet_address: ADDR }] : [rival(700 + id), rival(800 + id)] }),
    leaderboard: async () => ({ users: [base.profile], total: 1, limit: 200, offset: 0 }),
    listings: async () => [],
    floorPrices: async () => [],
    matchHistory: async () => [],
  } as never
  const chain = { account: async () => ({ nonce: 1, balance: wholeToAtomic(10) }), esdts: async () => [], egldUsd: async () => 4.5, query: async () => { throw new Error('off') } } as never
  const s = await takeSnapshot({ chain, fox }, { wallet: dryWallet }, new Date(), o.planning ? { matchFacts: { get: () => undefined, put: () => undefined } } : {})
  return { digest: renderDigest(s), asked }
}

/** The indented lines under a tournament's line. */
function under(digest: string, id: number): string[] {
  const lines = digest.split('\n')
  const at = lines.findIndex(l => new RegExp(`^\\s+T${id} "`).test(l))
  assert.ok(at >= 0, `T${id} is listed:\n${digest}`)
  const out: string[] = []
  for (let i = at + 1; i < lines.length && /^\s{4}/.test(lines[i]!); i++) out.push(lines[i]!.trim())
  return out
}

const UNREAD = `field: not read in this snapshot; the executor reads it at the join and refuses it with ${FIELD_LIMIT} or more clearly stronger teams`

test('FLD-1 a joinable tournament whose field this snapshot did not read says so, with the rule\'s limit', async () => {
  const { digest, asked } = await planningDigest({ planning: true })
  // The four nearest deadlines are read, as before: no more reads than FIELD_TOURNAMENTS.
  for (const id of [5501, 5502, 5503, 5504]) assert.match(under(digest, id).join('\n'), /^field: \d+ clearly stronger/m, `T${id}`)
  assert.ok(!asked.includes(5567) && !asked.includes(5571), 'the fifth and later are not read')
  // The fifth and the sixth: not read, and said so.
  for (const id of [5567, 5571]) assert.deepEqual(under(digest, id).filter(l => l.startsWith('field')), [UNREAD], `T${id}:\n${digest}`)
  // Already seated in 5575: no field to judge. A free Bronze and a full one are not judged by the field rule.
  for (const id of [5575, 5580, 5581]) assert.deepEqual(under(digest, id).filter(l => l.startsWith('field')), [], `T${id}`)
  // The field rule's legend is there for these lines too.
  assert.match(digest, /\(field lines: a seated team is clearly stronger when/)
})

test('FLD-1 a snapshot that reads no field at all (before each action, the CLI) adds no such line', async () => {
  const { digest } = await planningDigest({ planning: false })
  assert.doesNotMatch(digest, /not read in this snapshot/)
})
