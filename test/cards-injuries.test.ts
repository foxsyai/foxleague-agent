// FoxLeague, Friday 13 November 2026, 14:00 UTC (its config's card_bans.live_from): yellow card bans, injuries, medicine
// in the Shop, no fusion of an injured or suspended card and an ELO penalty for a forfeit. Every card already carries
// the five discipline fields on mainnet (yellow_cards, fouls_suffered, ban_yellow_cards, bans_pending, injured_until);
// the agent read none of them. Read from FoxLeague's code at bbb1bfba7 (main) and 2913ee7df (release).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkAction, type RulesContext } from '../src/executor/rules.ts'
import { parseAction } from '../src/executor/actions.ts'
import { retryPendingPayments } from '../src/executor/pending.ts'
import { ApiRefusal } from '../src/foxleague/api.ts'
import type { Auction } from '../src/chain/players.ts'
import { wholeToAtomic } from '../src/util/encoding.ts'
import { cardBansLive } from '../src/foxleague/levels.ts'
import type { MarketListing, PlayerCard, TournamentDetail } from '../src/foxleague/types.ts'
import { renderDigest } from '../src/snapshot/digest.ts'
import { playerView } from '../src/snapshot/snapshot.ts'
import { SYSTEM_PROMPT } from '../src/strategist/prompt.ts'
import { OTHER, TEST_SETTINGS, card, encodeAuction, liveWallet, setup, snapshot, tournament, withLive } from './fixtures.ts'

const ctx = (more: Partial<RulesContext> = {}): RulesContext => ({ settings: { ...TEST_SETTINGS }, now: new Date(), ...more })
const why = (a: unknown, more: Partial<RulesContext> = {}, s = snapshot()) => {
  const v = checkAction(a as never, s, ctx(more))
  return v.ok ? '' : (v as { refusal: string }).refusal
}
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString()
const LIVE = { live: true, live_from: '2026-11-13T14:00:00Z', yellow_cards_per_ban: 3 }
/** A snapshot with the bans live and one card changed. */
const withCard = (nonce: number, more: Record<string, unknown>, s = snapshot()) => {
  s.config!.card_bans = LIVE
  Object.assign(s.players.find(p => p.nonce === nonce)!, more)
  return s
}
const raw = (more: Record<string, unknown> = {}): PlayerCard => {
  const stats = Object.fromEntries(['speed', 'accuracy', 'defense', 'power', 'control', 'vision', 'stamina'].flatMap(k => [[k, 20], [`${k}_synced`, 20], [`${k}_xp`, 0]]))
  return { id: 1, nft_nonce: 7, owner_address: 'erd1', name: 'P7', position: 'DEF', rarity: 'Rare', shirt_number: 4, level: 1, experience: 0, ...stats, condition: 90, condition_updated_at: '', stats_dirty: false, matches_played: 0, competitive_matches: 0, fusion_match_credit: 0, fusion_ready_at: null, goals: 0, assists: 0, listed_for_sale: false, sale_price: null, transferred_at: null, transfer_cooldown_hours: null, minted_at: null, created_at: new Date().toISOString(), ...more } as unknown as PlayerCard
}
const ranked = { type: 'play_match', match_type: 'ranked' }
const targeted = { type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: 55, deadline_minutes: 60 }
const rival = { opponent: { userId: 55, elo: 1150, strength: 1400 } }

test('CI-1: a card\'s injury, its ban and its yellow cards toward one are read from FoxLeague\'s card', () => {
  const now = new Date()
  const until = inDays(3)
  const hurt = playerView(raw({ injured_until: until, bans_pending: 1, ban_yellow_cards: 2, yellow_cards: 5 }), null, now, true)
  assert.equal(hurt.injuredUntil, until)
  assert.equal(hurt.suspended, true)
  assert.equal(hurt.banYellows, 2)
  const healed = playerView(raw({ injured_until: inDays(-1), bans_pending: 0, ban_yellow_cards: 0 }), null, now, true)
  assert.equal(healed.injuredUntil, null, 'a past time is no injury')
  assert.equal(healed.suspended, false)
  assert.ok(!healed.disciplineUnread)
  // Once the bans are live a card without the fields is unknown, never healthy (rule 4).
  assert.equal(playerView(raw(), null, now, true).disciplineUnread, true)
  assert.equal(playerView(raw({ injured_until: 'soon', bans_pending: 0 }), null, now, true).disciplineUnread, true)
  assert.ok(!playerView(raw(), null, now, false).disciplineUnread, 'before the switch an older answer is the rules of before')
  // The switch as the other ones: live, or the moment it names has passed.
  assert.equal(cardBansLive({ card_bans: { live: false, live_from: '2026-11-13T14:00:00Z', yellow_cards_per_ban: 3 } } as never, new Date('2026-11-13T13:59:00Z')), false)
  assert.equal(cardBansLive({ card_bans: { live: false, live_from: '2026-11-13T14:00:00Z', yellow_cards_per_ban: 3 } } as never, new Date('2026-11-13T14:00:00Z')), true)
  assert.equal(cardBansLive({} as never, now), false)
})

test('CI-2: the snapshot shows the switch, each card out and what a card at auction carries', () => {
  const until = inDays(9)
  const s = withCard(3, { injuredUntil: until })
  Object.assign(s.players.find(p => p.nonce === 14)!, { suspended: true })
  Object.assign(s.players.find(p => p.nonce === 6)!, { banYellows: 2 })
  const listing = { nft_nonce: 900, owner_address: 'erd1x', name: 'Hurt', position: 'FWD', rarity: 'Rare', level: 3, speed: 60, accuracy: 60, defense: 60, power: 60, control: 60, vision: 60, stamina: 60, condition: 80, is_auction: true, min_price: 4000, highest_bid: null, ends_at: inDays(1), transferred_at: null, transfer_cooldown_hours: null, injured_until: until, bans_pending: 1, ban_yellow_cards: 1 } as MarketListing
  s.market.auctions = [listing, { ...listing, nft_nonce: 901, injured_until: undefined, bans_pending: undefined } as MarketListing]
  const d = renderDigest(s)
  assert.match(d, /Cards and injuries: LIVE: 3 yellow cards in tournaments of more than 2 teams/)
  assert.match(d, new RegExp(`#3 P3 .*INJURED-until ${until.slice(0, 16)}`))
  assert.match(d, /#14 P14 .*SUSPENDED/)
  assert.match(d, /#6 P6 .*yellow 2\/3/)
  assert.match(d, new RegExp(`INJURED IN YOUR ELEVEN: #3 until ${until.slice(0, 16)}: no match, 1v1 or entry runs until`))
  assert.match(d, new RegExp(`#900 Hurt .*\\| INJURED until ${until.slice(0, 16)}, suspended`))
  assert.match(d, /#901 Hurt .*\| injury and ban unknown/)
  // Before the switch the line says when, and a card is never marked.
  const before = snapshot()
  before.config!.card_bans = { live: false, live_from: '2099-01-01T00:00:00Z', yellow_cards_per_ban: 3 }
  assert.match(renderDigest(before), /Cards and injuries: not live yet, from 2099-01-01T00:00:00Z/)
  assert.doesNotMatch(renderDigest(before), /INJURED|SUSPENDED/)
})

test('CI-3: no match, 1v1 or entry while an injured card is in the eleven', () => {
  const s = withCard(3, { injuredUntil: inDays(3) })
  assert.match(why(ranked, { rankedTicket: { tickets: 1, price_foxsy: 25 } as never }, s), /starter #3 is injured until .*: save an eleven without it first/)
  assert.match(why(targeted, rival, s), /starter #3 is injured until/)
  const d = tournament(301, { max_teams: 2, min_teams: 2 }, [{ user_id: 55 }]) as TournamentDetail
  assert.match(why({ type: 'join_tournament', tournament_id: 301 }, { tournament: d, ...rival }, s), /starter #3 is injured until/)
  // An injured card on the bench stops nothing: the eleven plays as saved.
  const bench = withCard(14, { injuredUntil: inDays(3) })
  assert.equal(why(targeted, rival, bench), '')
})

test('CI-4: a 1v1 is created or joined only with 11 match-fit players of the 18, an injured one not among them', () => {
  // Ten fit starters and one at condition 20; the whole bench injured: FoxLeague refuses the seat after the stake is paid.
  const s = withCard(2, { condition: 20 })
  for (const p of s.players.filter(p => p.role === 'bench')) p.injuredUntil = inDays(3)
  const d = tournament(301, { max_teams: 2, min_teams: 2 }, [{ user_id: 55 }]) as TournamentDetail
  assert.match(why({ type: 'join_tournament', tournament_id: 301 }, { tournament: d, ...rival }, s), /only 10 match-fit players/)
  assert.match(why(targeted, rival, s), /only 10 match-fit players/)
  // With a fit bench the same eleven is one FoxLeague seats.
  assert.equal(why(targeted, rival, withCard(2, { condition: 20 })), '')
})

test('CI-5: once the bans are live an injury that could not be read stops the eleven, never counts as healthy', () => {
  const s = withCard(3, { disciplineUnread: true })
  assert.match(why(targeted, rival, s), /#3's injury could not be read: not acting blind/)
  assert.match(why(ranked, { rankedTicket: { tickets: 1, price_foxsy: 25 } as never }, s), /#3's injury could not be read/)
})

test('CI-6: an injured or suspended card is no fusion input', () => {
  const spare = (n: number, more = {}) => card(n, 'DEF', 'reserve', { competitiveMatches: 5, ...more })
  const fuse = { type: 'fuse', player_nonces: [101, 102, 103], position_of: 0 }
  const can = { canFuse: { can_fuse: true } as never, fusionPool: 5 }
  const until = inDays(3)
  assert.match(why(fuse, can, snapshot([spare(101, { injuredUntil: until }), spare(102), spare(103)])), /#101 is injured until .*: an injured card cannot be fused/)
  assert.match(why(fuse, can, snapshot([spare(101), spare(102, { suspended: true }), spare(103)])), /#102 is suspended.*: a suspended card cannot be fused/)
  assert.match(why(fuse, can, snapshot([spare(101), spare(102), spare(103, { disciplineUnread: true })])), /#103's injury could not be read/)
  assert.doesNotMatch(why(fuse, can, snapshot([spare(101), spare(102), spare(103)])), /injur|suspend/)
})

test('CI-7: a casual test or a new eleven never counts on an injured card', () => {
  const s = withCard(3, { injuredUntil: inDays(3) })
  const all = s.players.map(p => p.nonce)
  const test = { type: 'play_match', match_type: 'casual', test: { formation: '4-4-2', lineup: all.slice(0, 11), substitutes: all.slice(11) } }
  // The saved eleven holds #3 too, so the squad check speaks first; with #3 on the bench only the test would field it.
  const eleven = [1, 2, 13, 4, 5, 6, 7, 8, 9, 10, 11]
  const benchNow = [12, 3, 14, 15, 16, 17, 18]
  s.team!.lineup = eleven
  s.team!.substitutes = benchNow
  Object.assign(s.players.find(p => p.nonce === 3)!, { role: 'bench', slot: undefined })
  Object.assign(s.players.find(p => p.nonce === 13)!, { role: 'starter', slot: 2 })
  assert.match(why(test, {}, s), /#3 is injured until .*: a test eleven plays without it/)
  const v = checkAction({ type: 'set_lineup', lineup: all.slice(0, 11), substitutes: all.slice(11) } as never, s, ctx())
  assert.equal(v.ok, true, 'saving is free: the next match may be after the injury')
  assert.ok(v.notes.some(n => /starter #3 is injured until/.test(n)), v.notes.join(' | '))
})

test('CI-8: a tournament entry is judged at its start: a starter healed by then plays, one still out does not', () => {
  const seated = [501, 502].map(id => ({ user_id: id, wallet_address: `erd1seat${id}` }))
  const d = tournament(301, { max_teams: 8, min_teams: 3, starts_at: inDays(5), deadline: inDays(4) }, seated) as TournamentDetail
  const field = { tournament: d, field: seated.map(x => ({ userId: x.user_id, strength: 1200, elo: 1100 })) }
  assert.doesNotMatch(why({ type: 'join_tournament', tournament_id: 301 }, field, withCard(3, { injuredUntil: inDays(2) })), /injured/)
  assert.match(why({ type: 'join_tournament', tournament_id: 301 }, field, withCard(3, { injuredUntil: inDays(9) })), /starter #3 is injured until .* past the start of T301/)
})

test('CI-9: medicine is a shop product for one injured card, priced by FoxLeague\'s quote and held to the shop payment cap', () => {
  const buy = { type: 'buy', product: 'medicine', player_nonces: [3], quantity: 2 }
  assert.deepEqual(parseAction(buy), buy)
  assert.throws(() => parseAction({ type: 'buy', product: 'medicine', player_nonces: [3, 4], quantity: 2 }), /player_nonces/)
  assert.throws(() => parseAction({ type: 'buy', product: 'medicine', player_nonces: [3] }), /quantity/)
  const until = inDays(8)
  const s = () => withCard(3, { injuredUntil: until })
  const quote = (more = {}) => ({ medicineQuote: { player_nonce: 3, injured_until: until, served_until: inDays(2), price_per_day: 300, max_days: 6, days_paid: 2, cost_foxsy: 600, ...more } })
  assert.match(why(buy, quote(), snapshot()), /#3 is not injured/)
  assert.match(why(buy, {}, s()), /the medicine quote for #3 could not be read: not paying blind/)
  assert.match(why(buy, { medicineQuote: null }, s()), /could not be read: not paying blind/)
  assert.match(why({ ...buy, quantity: 7 }, quote({ days_paid: 7, cost_foxsy: 2100 }), s()), /medicine saves #3 6 days at most/)
  assert.match(why(buy, quote({ max_days: 0 }), s()), /a third of every injury is always served/)
  assert.match(why(buy, quote({ cost_foxsy: 900 }), s()), /the medicine quote does not match 2 days at 300 FOXSY: not paying blind/)
  assert.match(why(buy, quote({ player_nonce: 4 }), s()), /does not match/)
  assert.match(why(buy, quote({ price_per_day: 1500, cost_foxsy: 3000 }), s()), /payment 3000 FOXSY exceeds the per-action maximum 2500/)
  assert.match(why(buy, { ...quote(), pendingShop: new Set(['medicine']) }, s()), /a medicine payment is still waiting/)
  const v = checkAction(buy as never, s(), ctx(quote()))
  assert.equal(v.ok, true, v.ok ? '' : (v as { refusal: string }).refusal)
  assert.equal(v.foxsy, 600n * 10n ** 18n)
})

test('CI-10: the executor pays the quoted medicine with one shopPay and confirms it on FoxLeague\'s medicine route, the same hash again while pending', async () => {
  const until = inDays(8)
  const asked: unknown[] = []
  let answer: () => unknown = () => { throw new ApiRefusal('Could not verify transaction yet. Please confirm again in a moment.', 'tx_pending') }
  const sent: { data: string }[] = []
  const m = setup({
    chain: { send: async (tx: { data: string }) => (sent.push({ data: Buffer.from(tx.data, 'base64').toString() }), 'hmed') },
    fox: {
      user: async () => null,
      medicineQuote: async (_w: unknown, nonce: number, days: number) => ({ player_nonce: nonce, injured_until: until, served_until: inDays(2), price_per_day: 300, max_days: 6, days_paid: days, cost_foxsy: 300 * days }),
      buyMedicine: async (_w: unknown, body: unknown) => (asked.push(body), answer()),
      shopConfirm: async () => assert.fail('medicine is not confirmed on /shop/confirm (it refuses the product)'),
    },
  })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, withCard(3, { injuredUntil: until }), [{ action: { type: 'buy', product: 'medicine', player_nonces: [3], quantity: 2 }, reason: '' }])
    assert.equal(r!.status, 'unconfirmed', r!.summary)
    assert.equal(sent.length, 1)
    // 600 FOXSY = 0x2086ac351052600000, to shopPay.
    assert.match(sent[0]!.data, /^ESDTTransfer@[0-9a-f]+@2086ac351052600000@73686f70506179$/)
    assert.deepEqual(asked, [{ player_nonce: 3, days: 2, tx_hash: 'hmed' }])
    assert.equal(m.store.pending(0).length, 1)
    answer = () => ({ player_nonce: 3, cost_foxsy: 600, days_paid: 2, injured_until: inDays(6) })
    const told: string[] = []
    await retryPendingPayments({ store: m.store, fox: m.exec['d'].fox, notify: t => void told.push(t) }, 0, liveWallet)
    assert.deepEqual(asked[1], { player_nonce: 3, days: 2, tx_hash: 'hmed' }, 'the same payment, never a second one')
    assert.equal(sent.length, 1)
    assert.equal(m.store.pending(0).length, 0, told.join(' | '))
  })
})

test('CI-11: the prompt carries the rules of cards, injuries, medicine and forfeits, and the medicine action', () => {
  assert.match(SYSTEM_PROMPT, /Cards and injuries: the snapshot's "Cards and injuries" line says whether they are live/)
  assert.match(SYSTEM_PROMPT, /3 percent at condition 100 rising evenly to 9 percent at condition 30/)
  assert.match(SYSTEM_PROMPT, /one injury in a match keeps the card out 3 days, two 9, three or more 27/)
  assert.match(SYSTEM_PROMPT, /a third of every injury is always served/)
  assert.match(SYSTEM_PROMPT, /loses the full ELO K of the match's level/)
  assert.match(SYSTEM_PROMPT, /\{"type":"buy","product":"medicine","player_nonces":\[N\],"quantity":D\}/)
  assert.match(SYSTEM_PROMPT, /no transfer cooldown, no injury, no ban to serve and no running fusion cooldown/)
  assert.doesNotMatch(SYSTEM_PROMPT, /A forfeit or a match that could not be played moves no ELO/)
})

test('LIVE-1: a 1v1 is not joined when FoxLeague says the team\'s busy hour opens within two minutes', () => {
  const d = (secs: number | null) => ({ ...(tournament(301, { max_teams: 2, min_teams: 2 }, [{ user_id: 55 }]) as TournamentDetail), viewer_tournament_window_opens_in_secs: secs })
  assert.match(why({ type: 'join_tournament', tournament_id: 301 }, { tournament: d(45), ...rival }), /busy with a tournament in 45 s .*it would refuse the join after the stake is paid/)
  assert.equal(why({ type: 'join_tournament', tournament_id: 301 }, { tournament: d(4000), ...rival }), '')
  assert.equal(why({ type: 'join_tournament', tournament_id: 301 }, { tournament: d(null), ...rival }), '')
})

test('CI-12: a card out for a whole tournament adds no condition to the schedule the entry is weighed against', () => {
  const seated = [501, 502].map(id => ({ user_id: id, wallet_address: `erd1seat${id}` }))
  const d = tournament(301, { format: 'round_robin', max_teams: 7, min_teams: 3, home_and_away: true, round_interval_minutes: 30, starts_at: inDays(1), deadline: inDays(0.9) }, seated) as TournamentDetail
  const field = { tournament: d, field: seated.map(x => ({ userId: x.user_id, strength: 1200, elo: 1100 })) }
  const join = { type: 'join_tournament', tournament_id: 301 }
  assert.equal(why(join, field), '', 'the 18 carry its 12 matches')
  const s = snapshot()
  s.config!.card_bans = LIVE
  for (const p of s.players.filter(p => p.role === 'bench')) p.injuredUntil = inDays(30)
  assert.match(why(join, field, s), /the schedule would wear the squad down/)
  // Out for a part of it only: counted, as before.
  for (const p of s.players.filter(p => p.role === 'bench')) p.injuredUntil = inDays(1.01)
  assert.equal(why(join, field, s), '')
})

test('CI-13: the game manual copy holds the page that states the yellow card bans and the injuries', async () => {
  const { readFileSync } = await import('node:fs')
  const { undecidedPages } = await import('../src/strategist/manual.ts')
  const manual = readFileSync(new URL('../src/strategist/manual.md', import.meta.url), 'utf8')
  assert.match(manual, /\(docs\.foxleague\.ai\/getting-started\/players\/\)/)
  assert.match(manual, /### Yellow card bans/)
  assert.match(manual, /### Injuries/)
  assert.match(manual, /## Medicine/)
  // The other getting-started pages stay out, each by name: a new one is named, never skipped unseen.
  const pages = ['first-match.md', 'onboarding.mdx', 'players.md', 'quick-start.mdx', 'squad.md', 'wallet.mdx'].map(p => `getting-started/${p}`)
  assert.deepEqual(undecidedPages(pages), [])
  assert.deepEqual(undecidedPages([...pages, 'getting-started/transfers.md']), ['getting-started/transfers.md'])
})

test('CI-14: no bid on a card that would arrive injured for more than 72 hours, or whose injury cannot be read', async () => {
  const auction: Auction = { seller: OTHER, minPrice: wholeToAtomic(500), highestBid: 0n, highestBidder: null, endsAt: new Date(Date.now() + 3600_000) }
  const bid = (lock: RulesContext['cardLock']) => why({ type: 'bid', nonce: 9, foxsy: 500 }, { auction, cardRarity: 'Uncommon', priorBids: 0, cardLock: lock })
  assert.equal(bid({ until: null, injuredUntil: null }), '')
  assert.equal(bid({ until: null, injuredUntil: new Date(Date.now() + 71 * 3600_000) }), '', 'a short injury is the plan\'s call (the snapshot shows it)')
  assert.match(bid({ until: null, injuredUntil: new Date(Date.now() + 9 * 86_400_000) }), /#9 is injured until .*: it could not play for more than 72 hours/)
  assert.match(bid({ until: null, injuryUnread: true }), /the injury of #9 could not be read: not bidding blind/)
  // The executor reads it from the card's own record, right before the bid.
  const until = inDays(9)
  const m = setup({
    chain: { query: async () => [encodeAuction({ seller: OTHER, min: wholeToAtomic(500), top: 0n, bidder: null, endsInS: 3600 })] },
    fox: { user: async () => null, player: async () => ({ nft_nonce: 9, rarity: 'Uncommon', transferred_at: null, transfer_cooldown_hours: null, injured_until: until, bans_pending: 0 }) },
  })
  const s = snapshot()
  s.config!.card_bans = LIVE
  const [r] = await m.exec.run(m.agent(), liveWallet, s, [{ action: { type: 'bid', nonce: 9, foxsy: 500 }, reason: '' }])
  assert.equal(r!.status, 'refused', r!.summary)
  assert.match(r!.summary, /#9 is injured until/)
})
