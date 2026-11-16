// Compact text rendering of a snapshot: for the CLI, Telegram and the strategist's prompt.

import { cardBansLive, eloPairCapLive, fusionMode, leaveLockLive, levelsLive, organizerFeesLive, shopDiscountLive } from '../foxleague/levels.ts'
import { SMALLEST_ESTIMATE_MIN, ceilMinute, floorMinute, freeGaps, planLeadMs } from '../executor/slots.ts'
import { CREATE_START_MAX_MS, CREATE_START_MIN_MS } from '../executor/actions.ts'
import { calendarLines } from './calendar.ts'
import { ownTournamentLines } from './own-tournaments.ts'
import { MAX_TICK_MINUTES } from '../store/settings.ts'
import { auctionMinRaisePercent, casualCostRefusal, conditionAtStart, elevenOvrToday, paidSessionsToday, judgeField, lineupPositionsOk, lineupStrength, outInjured, scheduleRefusal, scheduleSpanMinutes, shopPrice, shopRateBp, LK_KNOCKOUT_MATCHES, LK_KNOCKOUT_PLACES, LK_LEAGUE_MATCHES, MAX_1V1_PER_OPPONENT_WEEK, MAX_1V1_STRENGTH_RATIO, MIN_1V1_CHANCE, XP_BOOSTER_RENEW_HOURS, FIELD_LIMIT, STRONGER_ELO, STRONGER_SQUAD } from '../executor/rules.ts'
import { atomicToFloat, formatAtomic } from '../util/encoding.ts'
import { cut } from '../util/text.ts'
import { agentName } from '../names.ts'
import { disciplineOf, transferLockEnd, type AgentSnapshot, type PlayerView } from './snapshot.ts'
import { CASUAL_DAYS, ELO_BAND, EVEN_BAND, formationsToTest, LEAGUE_DAYS, LEAGUE_MIN_PLAYED, LEAGUE_TEAMS, type FormationRecordRow } from './formations.ts'
import { gateLine, matchGate, type MatchGate } from '../foxleague/gate.ts'
import { unknownSwitchLines } from '../foxleague/config-watch.ts'
import type { PrizeSplit, ShopStatus, Tournament } from '../foxleague/types.ts'

/**
 * Text written by other players or servers (titles, team, card and listing names, error messages) as
 * data: control characters and line breaks become spaces, so it can never open a heading or a line of
 * its own in the prompt, and it is cut to a short length. Quotes are swapped so a value cannot close
 * the quotes around it; the snapshot fence (<<<SNAPSHOT, SNAPSHOT>>>) and heading marks cannot be
 * written at all. It is cut on whole characters: half of an emoji would make the whole plan request unreadable for
 * the model's API (audit 2026-11-16, ATK-4).
 */
export function txt(v: unknown, max = 40): string {
  const s = String(v ?? '')
    .toWellFormed()
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, ' ')
    .replace(/"/g, "'")
    .replace(/#+/g, '')
    .replace(/<{2,}/g, '<')
    .replace(/>{2,}/g, '>')
    .replace(/SNAPSHOT/gi, 'snapshot')
    .replace(/\s+/g, ' ')
    .trim()
  return s.length > max ? `${cut(s, max - 1)}…` : s
}

const SHORT: Record<string, string> = { speed: 'spd', accuracy: 'acc', defense: 'def', power: 'pow', control: 'ctl', vision: 'vis', stamina: 'sta' }
/** XP a stat's pool needs for +1 (FoxLeague's stat bump), and the pool from which the squad line shows it. */
export const XP_PER_POINT = 2000
export const XP_SHOWN_FROM = 1500

/** A stat's pool is shown only when a few sessions or a match bring the point, and only below the rarity cap (XP on a capped stat is lost). */
function statLine(p: PlayerView): string {
  return Object.keys(SHORT)
    .map(s => {
      const synced = p.synced[s] ?? 0
      const live = p.live[s] ?? 0
      const xp = p.xp?.[s]
      const pool = typeof xp === 'number' && xp >= XP_SHOWN_FROM && xp < XP_PER_POINT && live < p.cap ? ` (${xp}/${XP_PER_POINT})` : ''
      return `${SHORT[s]} ${synced}${live !== synced ? `>${live}` : ''}${pool}`
    })
    .join(' ')
}

/**
 * One card. With its rarity's match gate, the competitive matches read "played+credit of gate" and "at-gate" marks a
 * card that can be fused or listed. `perBan`: the yellow cards of a ban (FoxLeague's config), for the count toward one.
 */
export function playerLine(p: PlayerView, gate?: MatchGate, perBan?: number): string {
  const tags = [
    p.role === 'starter' ? `XI#${p.slot}` : p.role === 'bench' ? 'bench' : 'res',
    p.dirty ? 'dirty' : '',
    p.listed ? 'LISTED' : '',
    p.transferLockedUntil ? `locked-until ${p.transferLockedUntil.slice(0, 16)}` : '',
    p.injuredUntil ? `INJURED-until ${p.injuredUntil.slice(0, 16)}` : '',
    p.suspended ? 'SUSPENDED' : '',
    p.banYellows > 0 ? `yellow ${p.banYellows}${typeof perBan === 'number' && perBan > 0 ? `/${perBan}` : ''}` : '',
    p.disciplineUnread ? 'injury-and-ban-unknown' : '',
    p.fusionReadyAt ? `fusion-cooldown-until ${p.fusionReadyAt.slice(0, 16)}` : '',
    gate && p.competitiveMatches >= gate.floor && p.competitiveMatches + p.fusionMatchCredit >= gate.gate ? 'at-gate' : '',
  ].filter(Boolean)
  const comp = (p.fusionMatchCredit ? `${p.competitiveMatches}+${p.fusionMatchCredit} credit` : `${p.competitiveMatches}`) + (gate ? ` of ${gate.gate}` : '')
  return `#${p.nonce} ${txt(p.name, 30)} ${p.position} ${p.rarity}(cap ${p.cap}) cond ${p.condition} age ${p.ageYears} comp ${comp} | ${statLine(p)} | tot ${p.syncedTotal} [${tags.join(',')}]`
}

/**
 * The XP booster as FoxLeague's shop status reports it (flat fields). An unreadable status is said to be unknown,
 * never "none active". The expiry is printed as parsed, so no raw server text reaches the prompt.
 */
export function boosterLine(shop: ShopStatus | null | undefined, takenAt: string): string {
  if (!shop || typeof shop.xp_booster_active !== 'boolean') return 'XP booster: status unknown (shop status could not be read)'
  if (!shop.xp_booster_active) return 'XP booster: none active'
  const until = typeof shop.xp_booster_expires_at === 'string' ? Date.parse(shop.xp_booster_expires_at) : NaN
  if (!Number.isFinite(until)) return 'XP booster active, expiry unknown (no new one is bought until it is known)'
  const left = Math.max(0, (until - Date.parse(takenAt)) / 3600_000)
  return `XP booster active until ${new Date(until).toISOString()} (${left.toFixed(1)} h left; a new one restarts the 24 h and is refused while more than ${XP_BOOSTER_RENEW_HOURS} h are left)`
}

/**
 * The Shop's prices as the executor pays them (MNT-2b): the list prices FoxLeague's config serves and, while its
 * MetaStaking discount is live, this wallet's own prices and rate next to them (shopRateBp and shopPrice, the rules'
 * own). While the discount is live and the rate is unread, no price: the executor buys nothing in the Shop then.
 */
export function shopPriceLine(s: AgentSnapshot): string | null {
  const cfg = s.config
  if (!cfg) return null
  const now = new Date(s.takenAt)
  const p = cfg.shop_prices_foxsy
  const whole = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null)
  const items: { name: string; list: number | null; unit: string; one: string }[] = [
    { name: 'XP booster', list: whole(p?.xp_booster), unit: '', one: '' },
    { name: 'Common pack', list: whole(cfg.common_pack_price_foxsy), unit: '', one: '' },
    { name: 'training slot', list: whole(p?.training), unit: ' each', one: ' for one' },
    { name: 'condition recovery', list: whole(p?.condition), unit: " for a card's 100 points", one: " for a card's 100 points" },
  ]
  const listed = (i: (typeof items)[number]) => `${i.name} ${i.list ?? 'unknown'}${i.unit}`
  const live = shopDiscountLive(cfg, now)
  const bp = shopRateBp(s.auth?.shop?.metastaking_discount_bp, cfg, now)
  if (!live && bp === 0) return `Shop prices (FOXSY): ${items.map(listed).join(', ')}`
  if (bp === null) return `Shop prices for this wallet: unknown (FoxLeague's MetaStaking discount is live and this wallet's rate could not be read, so the executor buys nothing in the Shop until it is); list prices: ${items.map(listed).join(', ')}`
  // The ranked ticket is discounted too (FoxLeague's ticket view); its list price is on the Competition levels line.
  const ticket = levelsLive(cfg, now) ? whole(cfg.competition_levels?.ranked_ticket_price_foxsy) : null
  if (ticket !== null) items.push({ name: 'ranked ticket', list: ticket, unit: '', one: '' })
  const mine = (i: (typeof items)[number]) => (i.list === null ? `${i.name} unknown` : `${i.name} ${shopPrice(i.list, bp)}${i.one} (list ${i.list})`)
  return `Shop prices for this wallet (FoxLeague's MetaStaking discount${live ? ' is live' : ''}: your rate ${bp} basis points, ${bp / 100} percent off, taken once on each payment's total; the executor pays these, FoxLeague takes no other amount): ${items.map(mine).join(', ')}; medicine at FoxLeague's quote, ${bp / 100} percent off its days' full cost`
}

/** A rival's last acceptances of a stranger's targeted 1v1 (P3b): when to the minute and how long after it was sent. */
function acceptedText(last: { at: string; afterMin: number | null }[] | undefined): string {
  const at = (iso: string) => (Number.isFinite(Date.parse(iso)) ? `${new Date(Date.parse(iso)).toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'unknown time')
  const one = (x: { at: string; afterMin: number | null }) => `${at(x.at)}${typeof x.afterMin === 'number' ? `, ${x.afterMin} min after it was sent` : ''}`
  return last?.length ? ` (${last.length === 1 ? 'last' : 'last ones'}: ${last.map(one).join('; ')})` : ''
}

/** A rival's formations in its last revealed matches (written by FoxLeague's server, still read as data). */
function formationsText(f: string[] | null): string {
  return f?.length ? `their last formations, newest first: ${f.map(x => txt(x, 12)).join(', ')}` : 'their formations: unknown'
}

function formationRow(r: FormationRecordRow): string {
  const bands = (['stronger', 'even', 'weaker'] as const).filter(b => r.bands[b].some(n => n > 0)).map(b => `${b} W${r.bands[b][0]} D${r.bands[b][1]} L${r.bands[b][2]}`)
  const u = r.underdog?.some(n => n > 0) ? `; as the ELO underdog: W${r.underdog[0]} D${r.underdog[1]} L${r.underdog[2]}` : ''
  return `${txt(r.mine, 12)} vs ${txt(r.theirs, 12)}: ${r.played} played, W${r.won} D${r.drawn} L${r.lost}, goals ${r.goalsFor}-${r.goalsAgainst}${r.edge === null ? '' : `, strength edge ${r.edge >= 0 ? '+' : ''}${r.edge}%`}${bands.length ? `; by strength: ${bands.join(', ')}` : ''}${u}`
}

/** A coming rival: its last formations and its best eleven at full condition against yours today. */
function rivalText(f: string[] | null, strength: number | null | undefined, mine: number): string {
  const vs = typeof strength === 'number' && strength > 0 && mine > 0
    ? `their best eleven ${Math.round(strength)} at full condition, yours ${Math.round(mine)} today: you are ${Math.abs(Math.round(((mine - strength) / strength) * 100))}% ${mine >= strength ? 'stronger' : 'weaker'}`
    : 'their strength: unknown'
  return `${formationsText(f)}; ${vs}`
}

/**
 * What a seat's schedule brings, as the executor counts it (matchesAtMost, scheduleRefusal): a home-and-away round
 * robin plays every other team twice, and FoxLeague plays one match of the whole tournament every round interval, so
 * a team's matches are spread over all of them (MNT-1). Only what FoxLeague says is shown.
 */
function scheduleText(t: { format: string; max_teams: number; home_and_away?: boolean | null; has_third_place_match?: boolean | null; round_interval_minutes?: number | null }, groupSize: number): string {
  const interval = t.round_interval_minutes
  const span = typeof interval === 'number' && interval > 0 ? scheduleSpanMinutes(t.format, t.max_teams, t.home_and_away === true, interval, groupSize, t.has_third_place_match === true) : null
  const parts = [
    t.format === 'round_robin' && t.home_and_away === true ? `home and away (2 x ${t.max_teams - 1} matches)` : '',
    span !== null && interval ? `one match of the whole tournament every ${interval} min: its ${span / interval + 1} matches with ${t.max_teams} teams take about ${Math.round(span / 60)} h` : '',
  ].filter(Boolean)
  return parts.length ? `, ${parts.join(', ')}` : ''
}

/**
 * How an open tournament's seated field compares with this team, by the join rule's own test (judgeField), with
 * our eleven at the tournament's start as the rule takes it (conditionAtStart).
 */
function fieldText(s: AgentSnapshot, t: Tournament, f: NonNullable<AgentSnapshot['market']['fields']>[number]): string {
  if (!f.seats || !s.profile) return 'field: unknown (the seated teams could not be read)'
  // An unread roster is an unknown eleven, never a lineup of 0 (audit 2026-11-04, INPUT-3).
  if (!s.players.length) return 'field: unknown (your roster could not be read, so your eleven cannot be compared)'
  const atStart = conditionAtStart(s, t, new Date(s.takenAt))
  const ours = lineupStrength(s, atStart?.at)
  const j = judgeField(f.seats, ours, s.profile.elo_rating)
  const read = f.seats.length < f.seated ? ` (${f.seats.length} of ${f.seated} seated teams read)` : ''
  const strongest = `strongest ELO ${j.strongestElo ?? 'unknown'}, lineup ${j.strongestLineup === null ? 'unknown' : Math.round(j.strongestLineup)}`
  return `field${read}: ${j.stronger} clearly stronger, ${j.even} even, ${j.weaker} clearly weaker${j.unread ? `, ${j.unread} unknown` : ''} (${strongest}; yours ELO ${s.profile.elo_rating}, lineup ${Math.round(ours)} ${atStart ? 'at its start' : 'today'})`
}

/**
 * What the executor's 1v1 checks will count against a rival (planning snapshots, s.oneVOnes): this agent's 1v1s
 * against it in the last 7 days with the weekly limit.
 */
function rivalNote(s: AgentSnapshot, userId: number | null | undefined): string {
  const o = s.oneVOnes
  if (!o || typeof userId !== 'number') return eloPairNote(s, userId)
  const notes: string[] = []
  const w = o.week.find(x => x.userId === userId)
  if (w && w.count >= MAX_1V1_PER_OPPONENT_WEEK) notes.push(`${w.count} of ${MAX_1V1_PER_OPPONENT_WEEK} 1v1s against it this week (the limit), free again ${w.freeAt ? `${w.freeAt.slice(0, 16)} UTC` : 'later'}`)
  else if (w && w.count > 0) notes.push(`${w.count} of ${MAX_1V1_PER_OPPONENT_WEEK} 1v1s against it this week`)
  // This agent's own targeted 1v1s to it (BEH-2, P-V1): a rival that lets them expire reads so.
  const t = o.targeted?.find(x => x.userId === userId)
  if (t && t.sent > 0) {
    const limit = t.freeAt ? ` (no third targeted 1v1 to it before ${t.freeAt.slice(0, 16)} UTC)` : ''
    notes.push(`you sent it ${t.sent} targeted 1v1${t.sent === 1 ? '' : 's'} in 7 days: ${t.accepted} accepted, ${t.unanswered} expired unanswered${limit}`)
  }
  return notes.map(n => `, ${n}`).join('') + eloPairNote(s, userId)
}

/** The ELO pair cap against one rival this game day (MNT-3), only while the cap is live and the planning snapshot read it. */
function eloPairNote(s: AgentSnapshot, userId: number | null | undefined): string {
  const pair = typeof userId === 'number' ? s.eloPairs?.find(p => p.userId === userId) : undefined
  if (!pair || !eloPairCapLive(s.config, new Date(s.takenAt))) return ''
  const cap = s.config?.elo_pair_cap?.per_day
  if (pair.meetings === null) return ', ELO meetings today: unknown'
  const at = typeof cap === 'number' && Number.isFinite(cap) ? cap : null
  const full = at !== null && pair.meetings >= at
  return `, ${pair.meetings} of ${at ?? 'unknown'} ELO meetings today${full ? `: a game against it moves no ELO until ${pair.noEloUntil ? pair.noEloUntil.slice(0, 16) : 'the next daily reset'}` : ''}`
}

/**
 * The ELO pair cap against a tournament opponent of this game day (MNT-3b), from its seat's user id and the meetings
 * read for it. Only on a planning snapshot that read them while the cap is live; one that could not be read is unknown.
 */
function upcomingPairNote(s: AgentSnapshot, m: { tournament_id: number; opponent_name: string | null }): string {
  if (!s.upcomingRivals || !eloPairCapLive(s.config, new Date(s.takenAt))) return ''
  const r = s.upcomingRivals.find(x => x.tournamentId === m.tournament_id && x.opponent === m.opponent_name)
  if (!r) return ''
  if (r.userId === null) return ', ELO meetings today: unknown (the opponent\'s seat could not be read)'
  return s.eloPairs?.some(p => p.userId === r.userId) ? eloPairNote(s, r.userId) : ', ELO meetings today: unknown'
}

/**
 * A team with its own open 1v1 (created by it, not accepted yet) cannot accept ours: FoxLeague allows one active 1v1
 * per team, created or joined. Read from the open challenges in the snapshot, until that challenge's deadline.
 */
function ownChallengeOut(s: AgentSnapshot, userId: number): string {
  const now = Date.parse(s.takenAt)
  const out = s.market.openChallenges
    .filter(t => t.max_teams === 2 && t.creator_user_id === userId && Date.parse(t.deadline) > now)
    .sort((a, b) => b.deadline.localeCompare(a.deadline))[0]
  return out ? `, has a 1v1 out until ${new Date(Date.parse(out.deadline)).toISOString().slice(0, 16)} UTC: cannot accept yours before` : ''
}

/** A tournament's or a 1v1's OVR range, as FoxLeague checks it at the join (numbers only). */
function ovrRange(t: { ovr_min?: number | null; ovr_max?: number | null }): string {
  const lo = typeof t.ovr_min === 'number' ? t.ovr_min : null
  const hi = typeof t.ovr_max === 'number' ? t.ovr_max : null
  return lo === null && hi === null ? '' : `, OVR range ${lo ?? 'any'} to ${hi ?? 'any'}`
}

/**
 * A range that shuts this team out, as the join rule refuses it (BEH-3b): the best XI OVR the snapshot read outside it.
 * An unread OVR marks nothing: the executor reads its own right before a join and refuses a range it cannot read.
 */
function rangeClosed(s: AgentSnapshot, t: { ovr_min?: number | null; ovr_max?: number | null }): string {
  const lo = typeof t.ovr_min === 'number' ? t.ovr_min : null
  const hi = typeof t.ovr_max === 'number' ? t.ovr_max : null
  const ovr = s.auth?.bestXiOvr
  if ((lo === null && hi === null) || typeof ovr !== 'number' || !Number.isFinite(ovr)) return ''
  return (lo !== null && ovr < lo) || (hi !== null && ovr > hi) ? `, closed to you: range ${lo ?? 'any'} to ${hi ?? 'any'}, your best XI OVR ${ovr}` : ''
}

/**
 * A League + Knockout's prize from FoxLeague, in whole FOXSY per team. Tiered (FoxLeague's `prize_tiered`, its
 * TIERED_WEIGHTS): the top 24 by the round reached, 4 / 2 / 1 shares of 56, each floored as the contract pays it.
 * Otherwise the 8 quarter-finalists share it equally.
 */
function prizeText(atomic: bigint, tiered: boolean): string {
  const whole = (a: bigint) => (a / 10n ** 18n).toString()
  if (!tiered) return `prize from FoxLeague ${whole(atomic)} FOXSY shared equally by the 8 quarter-finalists (${whole(atomic / 8n)} each)`
  const share = (w: bigint) => whole((atomic * w) / 56n)
  return `prize from FoxLeague ${whole(atomic)} FOXSY for the top 24 by the round reached: ${share(4n)} to each quarter-finalist (4 shares), ${share(2n)} to each round-of-16 loser (2), ${share(1n)} to each play-off loser (1); places 25 to 36 get none`
}

/** The competition levels and the organizer's amounts, only as FoxLeague serves them (the prompt holds no number of them). */
const splitText = (p: PrizeSplit) => `pays ${p.winner_percent}/${p.runner_up_percent}/${p.third_percent}, platform ${p.platform_fee_percent}%`
/** A split to tell the plan about: one FoxLeague names that differs from the public tournaments' split. */
const otherSplit = (s: AgentSnapshot, p: PrizeSplit | null | undefined) => {
  const pub = s.config?.tournament_prize_split
  return p && pub && p.platform_fee_percent !== pub.platform_fee_percent ? splitText(p) : ''
}

/**
 * What a card at auction brings with it (a sale keeps its yellow cards, its ban and its injury), from numbers and a
 * parsed time only. Once the bans are live a listing without them is said to be unknown, never clean.
 */
function disciplineText(s: AgentSnapshot, l: { injured_until?: string | null; bans_pending?: number; ban_yellow_cards?: number }): string {
  const now = new Date(s.takenAt)
  const d = disciplineOf(l, now, cardBansLive(s.config, now))
  if (d.disciplineUnread) return ' | injury and ban unknown'
  const per = s.config?.card_bans?.yellow_cards_per_ban
  const marks = [
    d.injuredUntil ? `INJURED until ${d.injuredUntil.slice(0, 16)}` : '',
    d.suspended ? 'suspended' : '',
    d.banYellows > 0 ? `yellow ${d.banYellows}${typeof per === 'number' && per > 0 ? `/${per}` : ''}` : '',
  ].filter(Boolean)
  return marks.length ? ` | ${marks.join(', ')}` : ''
}

/** A number FoxLeague's config serves, or unknown when it does not: a missing block field never fails the plan (OPEN-3). */
const known = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : 'unknown')

function levelLines(s: AgentSnapshot): string[] {
  const out: string[] = []
  const now = new Date(s.takenAt)
  const whenLive = (live: boolean, from: string | null | undefined) => (live ? 'LIVE' : from ? `not live yet, from ${from}` : 'not switched on yet')
  const c = s.config?.competition_levels
  if (c) {
    const b = s.config?.tournament_fee_bounds
    const bronze = (typeof b?.bronze_min === 'number' && typeof b?.bronze_max === 'number' ? `; a paid Bronze costs ${b.bronze_min} to ${b.bronze_max} FOXSY` : '')
      + (c.private_bronze_earns === true ? '; a private paid Bronze (an invite list) earns like a public one' : '; a private Bronze (an invite list) earns nothing')
    out.push(`Competition levels: ${whenLive(levelsLive(s.config, now), c.live_from)}: ranked ticket ${known(c.ranked_ticket_price_foxsy)} FOXSY a game you start${bronze}; XP ranked ${known(c.xp_factor_pct?.ranked)}%, Bronze ${known(c.xp_factor_pct?.bronze)}%, Silver ${known(c.xp_factor_pct?.silver)}%, Gold ${known(c.xp_factor_pct?.gold)}%; K ranked ${known(c.elo_k?.ranked)}, Bronze ${known(c.elo_k?.bronze)}, Silver ${known(c.elo_k?.silver)}, Gold ${known(c.elo_k?.gold)}; ${typeof c.competitive_daily_cap !== 'number' ? 'competitive matches a card counts a day: unknown' : c.competitive_daily_cap > 0 ? `at most ${c.competitive_daily_cap} competitive matches a card a day` : 'no daily cap on the competitive matches a card counts'}`)
  }
  const f = s.config?.organizer_fees
  if (f) out.push(`Organizer of a tournament: ${whenLive(organizerFeesLive(s.config, now), f.live_from)}: calendar deposit ${known(f.calendar_deposit_per_match_foxsy)} FOXSY a game${f.calendar_deposit_min_foxsy > 0 ? ` (at least ${f.calendar_deposit_min_foxsy})` : ''}${f.private_match_fee_foxsy > 0 ? `, private fee ${f.private_match_fee_foxsy} a game on an invite list` : ''}`)
  // Yellow card bans and injuries: one switch (FoxLeague's card_bans). The injury chance and the days out are FoxLeague's
  // Admin settings, served in card_bans: the line gives the ones in force and the prompt points here (audit 2026-11-11,
  // INTEG-2). Numbers it does not serve are said to be unread, never given a value. Medicine is in the prompt.
  const b = s.config?.card_bans
  if (b) {
    const percent = (bp: unknown) => (typeof bp === 'number' && Number.isFinite(bp) && bp >= 0 && bp <= 10_000 ? String(Math.round(bp) / 100) : null)
    const full = percent(b.injury_chance_bp_full_condition)
    const floor = percent(b.injury_chance_bp_condition_floor)
    const chance = full !== null && floor !== null ? `a foul the referee calls injures the player fouled at ${full} percent at condition 100, moving evenly to ${floor} percent at condition 30 and below` : 'the injury chance could not be read'
    const d = b.injury_days_out
    const days = Array.isArray(d) && d.length === 3 && d.every(n => typeof n === 'number' && Number.isFinite(n) && n > 0) ? `one injury in a match keeps a card out ${d[0]} days, two ${d[1]}, three or more ${d[2]}` : 'the days an injury keeps a card out could not be read'
    out.push(`Cards and injuries: ${whenLive(cardBansLive(s.config, now), b.live_from)}: ${known(b.yellow_cards_per_ban)} yellow cards in tournaments of more than 2 teams = out of the team's next tournament match; an injured card plays no match until its injury ends; ${chance}; ${days}`)
  }
  // FoxLeague's fusion switch (fusion_mint): which fusion runs now and when it changes. The executor reads the same.
  if (s.config) {
    const f = fusionMode(s.config, now)
    out.push(
      f.mode === 'closed' ? `Fusion: closed now (${f.why})`
      : f.mode === 'mint' ? `Fusion: LIVE, a new card is minted: each stat = the three inputs' values added up x the new rarity's cap / (3 x their cap), rounded down, at least the new rarity's floor (Uncommon 22, Rare 30, Epic 36, Legendary 40); no sync needed (FoxLeague signs the live stats and competitive matches); the new card starts at level 1, condition 100 and 0 competitive matches`
      : f.liveFrom ? `Fusion: until ${f.liveFrom} a card drawn from the fusion pool (inputs synced first); from then a new card is minted instead, each stat the average of the three inputs translated to the new rarity, no sync needed (the executor refuses a fusion in the last 10 minutes before the switch)`
      : 'Fusion: a card drawn from the fusion pool (inputs synced first)',
    )
  }
  // The ELO pair cap (FoxLeague's elo_pair_cap, MNT-3): a fact for the plan, no rule of the executor.
  const pc = s.config?.elo_pair_cap
  if (pc) out.push(`ELO pair cap: ${whenLive(eloPairCapLive(s.config, now), pc.live_from)}: the same two teams move ELO in at most ${known(pc.per_day)} meetings a game day (from ${known(pc.reset_hour_utc)}:00 UTC), ranked, 1v1s and tournaments of every level together; a later meeting that day still counts for the result, the prize, XP and competitive matches but moves no ELO for either team (a forfeit always costs its ELO), and ranked draws no team already met that often; the rivals listed below and your tournament opponents of the game day show their meetings today once it is live`)
  const dearer = otherSplit(s, s.config?.private_tournament_prize_split)
  if (dearer) out.push(`A private tournament created now ${dearer}: every team in it shares that fee`)
  // A switch FoxLeague serves that no rule of the agent reads: its key, state and numbers only (audit 2026-11-16, P-W6).
  out.push(...unknownSwitchLines(s.config))
  return out
}

/**
 * The snapshot as text. `tickMinutes` is the agent's tick when the text goes into its plan: the first start each free
 * gap gives leaves room for that plan's actions to run (R74A-2). Without it (the CLI, the owner's chat) the longest
 * tick the settings allow is taken, the safe side.
 */
export function renderDigest(s: AgentSnapshot, o: { tickMinutes?: number } = {}): string {
  const scout = (id: number) => {
    const r = (s.market.scouted ?? []).find(x => x.id === id)
    return r ? ` [rival ELO ${r.elo ?? 'unknown'}, lineup ${r.strength === null ? 'unknown' : r.strength} at full condition${r.formations === undefined ? '' : `, ${formationsText(r.formations)}`}]` : ''
  }
  const out: string[] = []
  const who = s.agent.index !== null ? agentName(s.agent.index) : 'watch'
  out.push(`# ${who} ${s.agent.address} (shard ${s.agent.shard ?? '?'}) at ${s.takenAt}`)
  out.push(`Game day resets ${s.gameDay.nextResetAt} (in ${s.gameDay.hoursToReset} h)`)
  if (s.chain) {
    const usd = s.prices ? ` (~$${(atomicToFloat(s.chain.egld) * s.prices.egldUsd).toFixed(2)} + ~$${(atomicToFloat(s.chain.foxsy) * s.prices.foxsyUsd).toFixed(2)})` : ''
    out.push(`Wallet: ${formatAtomic(s.chain.egld, 4)} EGLD, ${formatAtomic(s.chain.foxsy, 2)} FOXSY, ${formatAtomic(s.chain.wegld, 4)} WEGLD, ${s.chain.nftCount} cards, nonce ${s.chain.nonce}${usd}`)
  }
  if (s.prices) out.push(`Prices: EGLD $${s.prices.egldUsd.toFixed(2)}, FOXSY ${s.prices.egldPerFoxsy.toExponential(3)} EGLD = $${s.prices.foxsyUsd.toFixed(5)}`)

  const r = s.registration
  if (!r.registered) {
    out.push(
      `NOT REGISTERED: fee paid on chain ${r.feePaidOnChain ?? '?'}, whitelisted ${r.whitelisted ?? '?'}, relayer ${r.relayerEnabled ?? '?'} (${r.relaysRemaining ?? '?'} relays left today), fee ${s.config?.registration_fee_foxsy ?? '?'} FOXSY`,
    )
  } else if (s.profile) {
    const p = s.profile
    out.push(`Team "${txt(p.team_name, 20)}" (user ${p.id}): ELO ${p.elo_rating} ${p.league}, W/D/L ${p.matches_won}/${p.matches_drawn}/${p.matches_lost}, tournament wins ${p.tournament_wins}, ${p.player_count} cards`)
  }
  if (s.team) out.push(s.team.hidden ? 'Formation and lineup: not public (FoxLeague shows them to the team itself only)' : `Formation ${s.team.formation}; XI ${s.team.lineup.join(',')}; bench ${s.team.substitutes.join(',')}`)
  const misfit = s.team && !s.team.hidden && s.players.length ? lineupPositionsOk(s, s.team.formation, s.team.lineup) : null
  if (misfit) out.push(`LINEUP DOES NOT FIT ${s.team!.formation} (${misfit}): no match, entry or 1v1 runs until set_formation with lineup and substitutes (or set_lineup) saves one that fits`)

  if (s.auth) {
    const a = s.auth
    if (a.allowance) out.push(`Matches started today: ${a.allowance.today_count}/${a.allowance.daily_limit}`)
    const t = a.shop?.training
    if (t) out.push(`Training today: ${t.used_today} used (free ${t.daily_free}, paid sessions used today ${Number.isFinite(t.used_today) && Number.isFinite(t.daily_free) ? paidSessionsToday(t) : 'unknown'}, paid slots bought in 24 h ${t.premium_used_today}/${t.premium_cap}), banked paid slots ${t.slots_banked}`)
    out.push(boosterLine(a.shop, s.takenAt))
    // FoxLeague's own count of the wallet's Common packs; unread, no pack is bought (audit 2026-11-11, INTEG-6).
    const packs = a.shop?.common_pack_remaining_this_week
    // The pack week runs from Monday at the daily reset (FoxLeague 2026-11-16): when it starts again, as parsed (MNT-4).
    const resets = typeof a.shop?.common_pack_week_resets_at === 'string' ? Date.parse(a.shop.common_pack_week_resets_at) : NaN
    const again = Number.isFinite(resets) ? `, the week starts again ${new Date(resets).toISOString()}` : ''
    out.push(typeof packs === 'number' && Number.isFinite(packs) ? `Common packs left this week (FoxLeague's count for this wallet): ${Math.max(0, packs)}${again}` : 'Common packs left this week: unknown (the shop status could not be read; no pack is bought until it is)')
    // What the Shop costs this wallet, as the executor pays it (MNT-2b).
    const prices = shopPriceLine(s)
    if (prices) out.push(prices)
    if (a.activeMatch) out.push(`IN A MATCH: #${a.activeMatch.match_id ?? a.activeMatch.tournament_match_id ?? '?'} ${a.activeMatch.kind} ${a.activeMatch.status}`)
    for (const m of a.upcoming?.matches ?? []) {
      const rf = s.rivalFormations?.find(r => r.tournamentId === m.tournament_id && r.opponent === m.opponent_name)
      out.push(`Upcoming: T${m.tournament_id} "${txt(m.tournament_title, 60)}" ${txt(m.round_label ?? '', 20)} vs ${m.opponent_name ? txt(m.opponent_name, 20) : 'TBD'} at ${m.scheduled_at}, locks ${m.strategy_locks_at} [${m.phase}]${rf ? ` [${rivalText(rf.formations, rf.strength, lineupStrength(s))}]` : ''}${upcomingPairNote(s, m)}`)
    }
    for (const t of a.myTournaments?.active ?? []) out.push(`My active tournament: T${t.id} "${txt(t.title, 60)}" ${t.tier} ${t.format} ${t.status} fee ${t.entry_fee_foxsy}${t.status === 'open' && leaveLockLive(s.config) && t.participant_count === t.min_teams ? ' (seats locked: at its minimum, no leave until more teams join)' : ''}${a.unseatedCreated?.includes(t.id) ? ` (created by you, with no seat of yours: take it with join_tournament${organizerFeesLive(s.config, new Date(s.takenAt)) ? ', or unfilled at its deadline it keeps your organizer deposit' : ''})` : ''}`)
    // Its own open creations with a range: FoxLeague lets the creator widen one while it is open for joining (only one
    // this agent created itself: a range the owner set with the same team is the owner's).
    for (const t of a.myTournaments?.active ?? []) {
      if (!s.ownCreations?.includes(t.id) || t.creator_user_id !== s.profile?.id || t.status !== 'open' || !(Date.parse(t.deadline) > Date.parse(s.takenAt)) || t.format === 'league_knockout' || t.developer_mode || !ovrRange(t)) continue
      // FoxLeague's /tournaments/my carries no seat count; the public list does.
      const listed = [...s.market.openStandard, ...s.market.openChallenges].find(x => x.id === t.id)
      const seated = typeof t.participant_count === 'number' ? t.participant_count : listed?.participant_count ?? '?'
      out.push(`Your open T${t.id} (${t.max_teams === 2 ? 'a 1v1' : `a ${t.format} of ${t.max_teams}, min ${t.min_teams}`}):${ovrRange(t).slice(1)}, ${seated} of ${t.max_teams} seated, deadline ${t.deadline}: widen_range lets more teams in (only wider)`)
    }
    // Whether each open tournament it created still fits its squad and schedule (ORG-1: src/snapshot/own-tournaments.ts).
    out.push(...ownTournamentLines(s))
    for (const c of a.challengesForMe) out.push(`Challenge for me: T${c.tournament_id} from ${txt(c.creator_team_name, 20)} (user ${c.creator_user_id}) stake ${c.entry_fee_foxsy} FOXSY, deadline ${c.deadline}${scout(c.tournament_id)}${rivalNote(s, c.creator_user_id)}`)
  }

  out.push(...levelLines(s))

  if (s.players.length) {
    out.push(`Squad (${s.players.length}; stats synced>live, (xp/${XP_PER_POINT}) = that stat's XP pool when ${XP_SHOWN_FROM} or more, ${XP_PER_POINT} gives +1; comp = competitive matches of the rarity's match gate):`)
    if (s.config) out.push(`Match gates (fusion input or listing; ${levelsLive(s.config, new Date(s.takenAt)) ? 'a ranked game you started and paid for and a paid Bronze match count too, casual and free Bronze never' : 'ranked, casual and Bronze never count'}): ${gateLine(s.config)}`)
    const order = { starter: 0, bench: 1, reserve: 2 }
    const cfg = s.config
    for (const p of [...s.players].sort((a, b) => order[a.role] - order[b.role] || (a.slot ?? 99) - (b.slot ?? 99))) out.push(`  ${playerLine(p, cfg ? matchGate(cfg, p.rarity) : undefined, cfg?.card_bans?.yellow_cards_per_ban)}`)
    // What the executor's squad check refuses on (squadLegal), said before the plan sends a match into it.
    const at = new Date(s.takenAt)
    const hurt = s.players.filter(p => p.role === 'starter' && outInjured(p, at))
    if (hurt.length) out.push(`INJURED IN YOUR ELEVEN: ${hurt.map(p => (p.injuredUntil ? `#${p.nonce} until ${p.injuredUntil.slice(0, 16)}` : `#${p.nonce} (its injury could not be read)`)).join(', ')}: no match, 1v1 or entry runs until set_lineup (or set_formation with lineup and substitutes) saves an eleven without ${hurt.length === 1 ? 'it' : 'them'}`)
    // A card in an auction is held by the contract and does not play: FoxLeague forfeits a tournament or 1v1 match whose
    // lineup locks with it in the saved 18 (mainnet 2026-11-16, MNT-4). The agent lists none of its 18; the owner may.
    const auctioned = s.players.filter(p => p.listed && p.role !== 'reserve')
    if (auctioned.length) out.push(`LISTED IN YOUR 18: ${auctioned.map(p => `#${p.nonce}`).join(', ')}: a card in an auction does not play, and FoxLeague forfeits (3-0, the full K lost) your next tournament or 1v1 match whose lineup locks with ${auctioned.length === 1 ? 'it' : 'them'} in your 18; no match, 1v1 or entry runs until set_lineup (or set_formation with lineup and substitutes) saves an 18 without ${auctioned.length === 1 ? 'it' : 'them'}`)
    const banned = s.players.filter(p => p.suspended && p.role !== 'reserve')
    if (banned.length) out.push(`Suspended in your 18: ${banned.map(p => `#${p.nonce}`).join(', ')}: out of your next tournament match of more than 2 teams (a 1v1 or a ranked game never serves a ban and still takes the card)`)
  }

  const fr = s.formationRecord
  if (fr === null) out.push('Formation record: unknown (the match history could not be read)')
  else if (fr) {
    out.push(fr.matches ? `Formation record (your last ${fr.matches} revealed matches, your formation vs the rival's; strength edge = how much stronger your eleven was than theirs as both played, synced stats x condition, minus means weaker; by strength = the results when you were more than ${EVEN_BAND}% stronger, within ${EVEN_BAND}% (even) and more than ${EVEN_BAND}% weaker):` : 'Formation record: no revealed match read yet')
    for (const r of fr.rows) out.push(`  ${formationRow(r)}`)
    if (fr.unread) out.push(`  (${fr.unread} more finished match${fr.unread === 1 ? '' : 'es'} not read yet)`)
    if (fr.field.length) out.push(`Rival formations in those matches: ${fr.field.map(f => `${txt(f.formation, 12)} ${f.matches}`).join(', ')}`)
  }
  const pool = s.formationPool
  if (pool?.matches) {
    out.push(`Pooled formation record (${pool.matches} matches of the last 14 days of every team your owner runs here, yours included, matches between them left out; names not shown):`)
    for (const r of pool.rows.slice(0, 20)) out.push(`  ${formationRow(r)}`)
    if (pool.field.length) out.push(`Rival formations in the pooled matches: ${pool.field.map(f => `${txt(f.formation, 12)} ${f.matches}`).join(', ')}`)
  }
  const league = s.leagueFormations
  if (league?.matches) {
    out.push(`League formation table (the public matches of the top ${LEAGUE_TEAMS} teams by ELO in the last ${LEAGUE_DAYS} days, your owner's teams left out, names not shown: ${league.matches} matches between ${league.teams} teams, ${league.withStrength} with both strengths known; each match counted from both sides, same-formation matches left out, pairings of fewer than ${LEAGUE_MIN_PLAYED} matches not shown; underdog = rated more than ${ELO_BAND} ELO below the rival at kickoff):`)
    for (const r of league.rows.filter(x => x.played >= LEAGUE_MIN_PLAYED).slice(0, 30)) out.push(`  ${formationRow(r)}`)
    if (league.field.length) out.push(`Formations the league played (each side of each match once): ${league.field.map(f => `${txt(f.formation, 12)} ${f.matches}`).join(', ')}`)
  }
  const bench = s.casualBench
  if (bench) {
    out.push(bench.matches ? `Casual test bench (the casual games of every team your owner runs here in the last ${CASUAL_DAYS} days, against FoxLeague's AI built at the team's own OVR with a random formation; no ELO, XP or FOXSY):` : 'Casual test bench: no casual test played yet')
    for (const r of bench.rows) out.push(`  ${formationRow(r)}`)
    const next = formationsToTest(s.players, bench)
    if (next.length) out.push(`Next formations to test (fewest casual tests first, ones your squad can field): ${next.map(f => `${f.formation} ${f.tests}`).join(', ')}`)
    if (typeof s.casualToday === 'number') out.push(`Casual games today: ${s.casualToday} (casual and ranked share FoxLeague's daily starts)`)
    const why = s.team ? casualCostRefusal(s, [...s.team.lineup, ...s.team.substitutes], new Date(s.takenAt)) : 'your team could not be read'
    out.push(why ? `Casual game now: not free: ${why}` : 'Casual game now: free for your saved eleven and bench (each back to full condition before your next match that counts)')
  }

  const m = s.market
  if (typeof s.auth?.bestXiOvr === 'number') {
    // The default range for what the agent creates (owner, 2026-10-24): about 10 percent either way, whole numbers 1 to 100.
    const ovr = s.auth.bestXiOvr
    const lo = Math.max(1, Math.floor(ovr * 0.9))
    const hi = Math.min(100, Math.ceil(ovr * 1.1))
    // How many teams it lets in, from the leaderboard's best XI OVRs (FoxLeague, 2026-10-26).
    const inside = (v: number[]) => v.filter(x => x >= lo && x <= hi).length
    const b = s.market.boardOvrs
    const count = b?.all.length ? ` (inside it: ${inside(b.all)} of the ${b.all.length} leaderboard teams read, ${inside(b.takers)} of the ${b.takers.length} that took a 1v1 in 7 days they had not arranged)` : ''
    // An open challenge tops out at the team's own best XI OVR, rounded up so the creator fits its own range (OP-4), and
    // waits while that top is more than 10 percent above our eleven at today's condition (R54A-1).
    const today = elevenOvrToday(s)
    const eleven = today === null ? '; your eleven today could not be read, so no open challenge' : `; your eleven today: OVR ${today.toFixed(1)} at today's condition, ${today * MAX_1V1_STRENGTH_RATIO < Math.ceil(ovr) ? 'so an open challenge waits until it is within 10 percent of the top' : 'within 10 percent of the top'}`
    out.push(`Your best XI OVR (what OVR ranges are checked against): ${ovr}; a range about 10 percent either way for your own open tournament: ovr_min ${lo}, ovr_max ${hi}${count}; a targeted challenge or a private tournament takes none; for an open challenge: ovr_max ${Math.ceil(ovr)} (no stronger team can take it), no other value (a lower top and FoxLeague refuses you as its creator), and any ovr_min up to ${Math.floor(ovr)}${eleven}`)
  }
  out.push(`Open tournaments: ${m.openStandard.length ? '' : 'none'}`)
  // Every level is held to the field rule (Zeus only until 2026-11-06).
  if (m.fields?.length) out.push(`  (field lines: a seated team is clearly stronger when its lineup (each card at the stronger of its synced and live stats, at full condition) is more than ${Math.round((MAX_1V1_STRENGTH_RATIO - 1) * 100)} percent above yours at the tournament's start, whatever its ELO, or more than ${Math.round((STRONGER_SQUAD - 1) * 100)} percent above yours with an ELO more than ${STRONGER_ELO} above yours; an unread lineup counts on its ELO alone, and a team known only in part that is not clearly stronger counts as unknown; clearly weaker is both the other way; the executor never joins a field with ${FIELD_LIMIT} or more clearly stronger teams, or ${FIELD_LIMIT} or more unknown ones)`)
  // The join rule's schedule test (BEH-3): its own team only; an unread calendar is said once, not under every line.
  let calendarBlind = false
  for (const t of m.openStandard.slice(0, 30)) {
    out.push(`  T${t.id} "${txt(t.title, 60)}" ${t.tier} ${t.format} ${t.participant_count ?? '?'}/${t.max_teams} (min ${t.min_teams}) fee ${t.entry_fee_foxsy} deadline ${t.deadline} starts ${t.starts_at}${scheduleText(t, s.config?.tournament_defaults?.groups_knockout_group_size ?? 4)}${t.is_private ? (t.invited ? ', private, you are invited' : ', private') : ''}${otherSplit(s, t.prize_split) ? `, ${otherSplit(s, t.prize_split)}` : ''}${ovrRange(t)}${rangeClosed(s, t)}`)
    // What the join rule's schedule test answers now, so the plan does not propose a seat it will refuse (BEH-3).
    const worn = s.team && s.auth && !s.watchOnly ? scheduleRefusal(s, t, new Date(s.takenAt)) : null
    if (worn && /could not be read/.test(worn)) calendarBlind = true
    else if (worn) out.push(`    schedule: the executor refuses this join now: ${worn}`)
    const field = m.fields?.find(f => f.id === t.id)
    if (field) out.push(`    ${fieldText(s, t, field)}`)
  }
  if (calendarBlind) out.push('  (schedule: your current tournaments or their upcoming matches could not be read, so the executor refuses every join until they are)')
  // League + Knockout invitations: accepted with join_tournament, by every level within its limits (owner, 2026-10-24).
  const invitations = s.auth?.invitations ?? []
  if (invitations.length) {
    out.push(`League + Knockout invitations (36 teams: ${LK_LEAGUE_MATCHES} league matches, then places 1 to ${LK_KNOCKOUT_PLACES} play the knockout, at most ${LK_LEAGUE_MATCHES + LK_KNOCKOUT_MATCHES} matches; one match at a time for the whole tournament; while it runs no other tournament, 1v1s and ranked stay open; no leaving once the seats lock; accept one with join_tournament at least 30 minutes before it expires):`)
    const at = (iso: string | null | undefined) => (iso && Number.isFinite(Date.parse(iso)) ? new Date(Date.parse(iso)).toISOString().slice(0, 16).replace('T', ' ') : '?')
    for (const i of invitations) {
      const t = i.tournament
      const prize = i.prize_atomic && /^\d+$/.test(i.prize_atomic) ? `, ${prizeText(BigInt(i.prize_atomic), i.prize_tiered === true)}` : ''
      const run = t ? `, one match every ${t.round_interval_minutes ?? '?'} min from ${at(t.starts_at)}` : ', its schedule could not be read'
      const can = i.can_accept ? 'accept with join_tournament' : `FoxLeague says it cannot be accepted now${i.refusal ? ` (${txt(i.refusal, 120)})` : ''}`
      out.push(`  T${Number(i.tournament_id)} "${txt(i.title, 60)}" ${txt(i.tier, 10)}, entry ${Number(i.entry_fee_foxsy)} FOXSY${prize}${run}, expires ${at(i.expires_at)}, seats lock ${at(i.seats_lock_at)}: ${can}`)
    }
  }
  for (const seat of s.auth?.leagueSeats ?? []) {
    const lock = seat.seatsLockAt ? `seats lock ${seat.seatsLockAt.slice(0, 16).replace('T', ' ')} UTC: until then you may leave a seat you joined yourself for the whole entry back, but only when you see no real chance of the top 24 (places 1 to 24 play the knockout; leaving closes the invitation for good); after that nobody can leave` : 'when its seats lock could not be read: no leaving'
    out.push(`Your League + Knockout T${Number(seat.tournamentId)}: ${seat.accepted ?? '?'} of 36 seats taken; ${lock}`)
  }
  if (m.scouted?.length || s.leaderboardNeighbours.some(u => typeof u.strength === 'number')) out.push(s.players.length && Number.isFinite(lineupStrength(s)) ? `Your lineup strength today (synced stats x condition): ${Math.round(lineupStrength(s))}; a targeted or joined 1v1 is refused when the rival's lineup (the stronger of its synced and live stats, at full condition) is more than 10 percent above it (an open challenge is held to its OVR range instead).` : 'Your lineup strength today: unknown (your roster or a starter\'s stats could not be read); a 1v1 and a tournament entry are refused until it is known.')
  out.push(`Open 1v1 challenges: ${m.openChallenges.length ? '' : 'none'}`)
  for (const t of m.openChallenges.slice(0, 20)) {
    out.push(`  T${t.id} "${txt(t.title, 60)}" ${t.tier} stake ${t.entry_fee_foxsy} creator user ${t.creator_user_id}${t.target_user_id ? ` targets user ${t.target_user_id}` : t.targeted ? ' targets another team' : ' open'} deadline ${t.deadline} seated ${t.participant_count ?? '?'}${ovrRange(t)}${rangeClosed(s, t)}${scout(t.id)}${rivalNote(s, t.creator_user_id)}`)
  }
  // Time slots for creating: every window a new tournament's own window may not overlap, and the gaps.
  const now = Date.now()
  const hm = (t: number) => new Date(t).toISOString().slice(5, 16).replace('T', ' ')
  const slots = (m.slots ?? []).filter(w => w.end > now)
  out.push(`Tournament time slots taken (UTC; a created tournament reserves 1 h before its start to 1 h after start + FoxLeague's estimate, ~3 min per match; it may not overlap these): ${slots.length ? '' : 'none'}`)
  // To the minute, never a minute short: a window ends at its minute rounded up, a gap is rounded inward (2026-11-15).
  for (const w of slots.slice(0, 20)) out.push(`  T${w.id} "${txt(w.title, 40)}" ${hm(w.start)} to ${hm(ceilMinute(w.end))}`)
  const minute = (t: number) => `${new Date(t).toISOString().slice(0, 16)}Z`
  // Each gap with the starts that fit it, as starts_at takes them: from its first minute plus the hour before a kickoff,
  // to its last minute less the hour after the estimate. No start is given before 2 hours after the latest moment the
  // plan's create can run (R74A-2): a gap open now begins its starts there, and a gap too short for the smallest
  // tournament (3 matches) from its first start is left out.
  const earliest = ceilMinute(now + CREATE_START_MIN_MS + planLeadMs(o.tickMinutes ?? MAX_TICK_MINUTES))
  const gaps = freeGaps(slots, now + 3600_000, now + CREATE_START_MAX_MS)
    .map(g => ({ start: ceilMinute(g.start), end: floorMinute(g.end) }))
    .map(g => ({ ...g, first: Math.max(g.start + 3600_000, earliest) }))
    .filter(g => g.end - g.first >= 3600_000 + SMALLEST_ESTIMATE_MIN * 60_000)
  if (slots.length) out.push(`Free for a new tournament's whole window (next ${CREATE_START_MAX_MS / 86_400_000} days; a start fits a gap when its window, from 1 h before it to 1 h after its estimated end, is inside; no start is given before ${minute(earliest)}, 2 h after the latest moment this plan's actions run): ${gaps.slice(0, 8).map(g => `${minute(g.start)} to ${minute(g.end)} (starts_at from ${minute(g.first)} to ${minute(g.end - 3600_000)} less the estimate)`).join('; ') || 'none'}`)
  // FoxLeague's own free starts and this agent's own pick among them (P-O1, P-O2: src/snapshot/calendar.ts).
  out.push(...calendarLines(s, { now, earliest }))
  if (m.recentStandard.length) {
    out.push('Recent standard tournaments (seated/max, fee, status):')
    for (const t of m.recentStandard.slice(0, 10)) out.push(`  T${t.id} ${t.tier} ${t.format} ${t.seated}/${t.max_teams} fee ${t.fee} ${t.status} ${t.starts_at.slice(0, 16)}`)
  }
  if (m.floors.length) out.push(`Marketplace floors (lowest reserve by rarity): ${m.floors.map(f => `${f.rarity} ${f.floor_price} (${f.count} listed)`).join(', ')}`)
  if (m.prices) {
    const known = (r: string) => {
      const p = m.prices![r]
      return p ? `${r} ${p.price.toLocaleString('en-US')} (${p.tradingDays} trading days in ${p.windowDays} days)` : `${r} unknown (too few sales in 90 days)`
    }
    out.push(`Market prices (median of the daily median sale prices; every trading day counts once): ${['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'].map(known).join(', ')}`)
  }
  if (m.auctions.length) {
    // The raise the contract asks over a top bid, as FoxLeague serves it (audit 2026-11-11, INTEG-3). Game settings
    // that were not read at all give no raise either: the default is for an answer that leaves the number out.
    const raise = s.config ? auctionMinRaisePercent(s.config) : null
    out.push(raise === null ? 'A bid must reach the reserve; the raise over a top bid could not be read, so no raise is placed.' : `A bid must reach the reserve, or the top bid plus ${raise} percent.`)
    out.push('Open auctions: the 10 strongest, then the 3 cheapest of each rarity (nonce, card, OVR, price now, ends):')
    for (const l of m.auctions) {
      const ovr = Math.round((l.speed + l.accuracy + l.defense + l.power + l.control + l.vision + l.stamina) / 7)
      const price = l.highest_bid ? `top bid ${l.highest_bid}` : `reserve ${l.min_price ?? '?'}`
      // Hours left out are FoxLeague's default lock, as on the agent's own cards (audit 2026-11-11, EDGE-1).
      const lock = transferLockEnd(l.transferred_at, l.transfer_cooldown_hours, s.config)
      // Own keys only: a rarity named like an inherited property (toString) has no market price (review of PR #21).
      const market = m.prices && Object.hasOwn(m.prices, l.rarity) ? m.prices[l.rarity] : undefined
      out.push(`  #${l.nft_nonce} ${txt(l.name, 30)} ${l.position} ${l.rarity} lvl ${l.level} OVR ${ovr} cond ${l.condition} | ${price}${market ? ` (market ${market.price.toLocaleString('en-US')})` : ''} | ends ${l.ends_at?.slice(0, 16) ?? '?'}${lock && lock > new Date(s.takenAt) ? ` | transfer lock until ${lock.toISOString().slice(0, 16)}` : ''}${disciplineText(s, l)}`)
    }
  }
  // The threshold every level's 1v1s against a known team are held to, next to the chances below.
  if (s.leaderboardNeighbours.some(u => typeof u.winChance === 'number')) out.push(`Win chances: the ELO expectation and the lineup strength averaged, and never above what the lineups alone give (a rival's low ELO lifts no chance), ours at today's condition, theirs at full condition; a 1v1 against a known team is played from ${Math.round(MIN_1V1_CHANCE * 100)} percent.`)
  if (s.leaderboardNeighbours.length) {
    out.push(`Teams to challenge (first the ones that take 1v1s they had not arranged: a targeted 1v1 it accepted from a team it had not played a 1v1 against before, more than 2 minutes after it was sent; a pair that plays again and again arranges it, and an open challenge a team took from the list is said apart): ${s.leaderboardNeighbours.map(u => `${txt(u.team_name, 20)} (user ${u.id}) ${u.elo_rating}${u.accepted7d ? `, took ${u.accepted7d} 1v1 in 7 days it had not arranged${acceptedText(u.acceptedLast)}` : ', took no 1v1 in 7 days it had not arranged'}${u.openTaken7d ? `, took ${u.openTaken7d} open challenge${u.openTaken7d === 1 ? '' : 's'}` : ''}${typeof u.bestXiOvr === 'number' ? `, best XI OVR ${u.bestXiOvr}` : ''}${u.played ? `, ${u.played.matches} matches in ${u.played.days} days` : ''}${typeof u.strength === 'number' ? `, lineup ${Math.round(u.strength)}` : ''}${typeof u.winChance === 'number' ? `, your win chance ${Math.round(u.winChance * 100)} percent` : ''}${ownChallengeOut(s, u.id)}${rivalNote(s, u.id)}`).join('; ')}`)
  }
  for (const w of s.warnings) out.push(`WARNING ${txt(w, 160)}`)
  return out.join('\n')
}

/** JSON-safe copy (bigint as decimal strings). */
export function snapshotToJson(s: AgentSnapshot): string {
  return JSON.stringify(s, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2)
}
