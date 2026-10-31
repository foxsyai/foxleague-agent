// Compact text rendering of a snapshot: for the CLI, Telegram and the strategist's prompt.

import { leaveLockLive, levelsLive, organizerFeesLive } from '../foxleague/levels.ts'
import { freeGaps } from '../executor/slots.ts'
import { conditionAtStart, judgeField, lineupPositionsOk, lineupStrength, LK_KNOCKOUT_MATCHES, LK_KNOCKOUT_PLACES, LK_LEAGUE_MATCHES, MAX_1V1_PER_OPPONENT_WEEK, XP_BOOSTER_RENEW_HOURS, ZEUS_FIELD_LIMIT, ZEUS_STRONGER_ELO, ZEUS_STRONGER_SQUAD } from '../executor/rules.ts'
import { atomicToFloat, formatAtomic } from '../util/encoding.ts'
import { agentName } from '../names.ts'
import type { AgentSnapshot, PlayerView } from './snapshot.ts'
import { EVEN_BAND, type FormationRecordRow } from './formations.ts'
import { gateLine, matchGate, type MatchGate } from '../foxleague/gate.ts'
import type { ShopStatus, Tournament } from '../foxleague/types.ts'

/**
 * Text written by other players or servers (titles, team, card and listing names, error messages) as
 * data: control characters and line breaks become spaces, so it can never open a heading or a line of
 * its own in the prompt, and it is cut to a short length. Quotes are swapped so a value cannot close
 * the quotes around it; the snapshot fence (<<<SNAPSHOT, SNAPSHOT>>>) and heading marks cannot be
 * written at all.
 */
export function txt(v: unknown, max = 40): string {
  const s = String(v ?? '')
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, ' ')
    .replace(/"/g, "'")
    .replace(/#+/g, '')
    .replace(/<{2,}/g, '<')
    .replace(/>{2,}/g, '>')
    .replace(/SNAPSHOT/gi, 'snapshot')
    .replace(/\s+/g, ' ')
    .trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
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

/** One card. With its rarity's match gate, the competitive matches read "played+credit of gate" and "at-gate" marks a card that can be fused or listed. */
export function playerLine(p: PlayerView, gate?: MatchGate): string {
  const tags = [
    p.role === 'starter' ? `XI#${p.slot}` : p.role === 'bench' ? 'bench' : 'res',
    p.dirty ? 'dirty' : '',
    p.listed ? 'LISTED' : '',
    p.transferLockedUntil ? `locked-until ${p.transferLockedUntil.slice(0, 16)}` : '',
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

/** A rival's formations in its last revealed matches (written by FoxLeague's server, still read as data). */
function formationsText(f: string[] | null): string {
  return f?.length ? `their last formations, newest first: ${f.map(x => txt(x, 12)).join(', ')}` : 'their formations: unknown'
}

function formationRow(r: FormationRecordRow): string {
  const bands = (['stronger', 'even', 'weaker'] as const).filter(b => r.bands[b].some(n => n > 0)).map(b => `${b} W${r.bands[b][0]} D${r.bands[b][1]} L${r.bands[b][2]}`)
  return `${txt(r.mine, 12)} vs ${txt(r.theirs, 12)}: ${r.played} played, W${r.won} D${r.drawn} L${r.lost}, goals ${r.goalsFor}-${r.goalsAgainst}${r.edge === null ? '' : `, strength edge ${r.edge >= 0 ? '+' : ''}${r.edge}%`}${bands.length ? `; by strength: ${bands.join(', ')}` : ''}`
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
 * robin plays every other team twice, and the round interval spaces the matches. Only what FoxLeague says is shown.
 */
function scheduleText(t: { format: string; max_teams: number; home_and_away?: boolean | null; round_interval_minutes?: number | null }): string {
  const parts = [
    t.format === 'round_robin' && t.home_and_away === true ? `home and away (2 x ${t.max_teams - 1} matches)` : '',
    typeof t.round_interval_minutes === 'number' && t.round_interval_minutes > 0 ? `rounds every ${t.round_interval_minutes} min` : '',
  ].filter(Boolean)
  return parts.length ? `, ${parts.join(', ')}` : ''
}

/**
 * How an open tournament's seated field compares with this team, by the Zeus join rule's own test (judgeField), with
 * our eleven at the tournament's start as the rule takes it (conditionAtStart).
 */
function fieldText(s: AgentSnapshot, t: Tournament, f: NonNullable<AgentSnapshot['market']['fields']>[number]): string {
  if (!f.seats || !s.profile) return 'field: unknown (the seated teams could not be read)'
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
  if (!o || typeof userId !== 'number') return ''
  const notes: string[] = []
  const w = o.week.find(x => x.userId === userId)
  if (w && w.count >= MAX_1V1_PER_OPPONENT_WEEK) notes.push(`${w.count} of ${MAX_1V1_PER_OPPONENT_WEEK} 1v1s against it this week (the limit), free again ${w.freeAt ? `${w.freeAt.slice(0, 16)} UTC` : 'later'}`)
  else if (w && w.count > 0) notes.push(`${w.count} of ${MAX_1V1_PER_OPPONENT_WEEK} 1v1s against it this week`)
  return notes.map(n => `, ${n}`).join('')
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

/** The competition levels and the organizer's amounts, only as FoxLeague serves them (the prompt holds no number of them). */
function levelLines(s: AgentSnapshot): string[] {
  const out: string[] = []
  const now = new Date(s.takenAt)
  const whenLive = (live: boolean, from: string | null | undefined) => (live ? 'LIVE' : from ? `not live yet, from ${from}` : 'not switched on yet')
  const c = s.config?.competition_levels
  if (c) {
    const b = s.config?.tournament_fee_bounds
    const bronze = typeof b?.bronze_min === 'number' && typeof b?.bronze_max === 'number' ? `; a paid Bronze costs ${b.bronze_min} to ${b.bronze_max} FOXSY` : ''
    out.push(`Competition levels: ${whenLive(levelsLive(s.config, now), c.live_from)}: ranked ticket ${c.ranked_ticket_price_foxsy} FOXSY a game you start${bronze}; XP ranked ${c.xp_factor_pct.ranked}%, Bronze ${c.xp_factor_pct.bronze}%, Silver ${c.xp_factor_pct.silver}%, Gold ${c.xp_factor_pct.gold}%; K ranked ${c.elo_k.ranked}, Bronze ${c.elo_k.bronze}, Silver ${c.elo_k.silver}, Gold ${c.elo_k.gold}; at most ${c.competitive_daily_cap} competitive matches a card a day`)
  }
  const f = s.config?.organizer_fees
  if (f) out.push(`Organizer of a tournament: ${whenLive(organizerFeesLive(s.config, now), f.live_from)}: calendar deposit ${f.calendar_deposit_per_match_foxsy} FOXSY a game (at least ${f.calendar_deposit_min_foxsy}), private fee ${f.private_match_fee_foxsy} a game on an invite list`)
  return out
}

export function renderDigest(s: AgentSnapshot): string {
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
    if (t) out.push(`Training today: ${t.used_today} used (free ${t.daily_free}, paid used ${t.premium_used_today}/${t.premium_cap}), banked paid slots ${t.slots_banked}`)
    out.push(boosterLine(a.shop, s.takenAt))
    if (a.activeMatch) out.push(`IN A MATCH: #${a.activeMatch.match_id ?? a.activeMatch.tournament_match_id ?? '?'} ${a.activeMatch.kind} ${a.activeMatch.status}`)
    for (const m of a.upcoming?.matches ?? []) {
      const rf = s.rivalFormations?.find(r => r.tournamentId === m.tournament_id && r.opponent === m.opponent_name)
      out.push(`Upcoming: T${m.tournament_id} "${txt(m.tournament_title, 60)}" ${txt(m.round_label ?? '', 20)} vs ${m.opponent_name ? txt(m.opponent_name, 20) : 'TBD'} at ${m.scheduled_at}, locks ${m.strategy_locks_at} [${m.phase}]${rf ? ` [${rivalText(rf.formations, rf.strength, lineupStrength(s))}]` : ''}`)
    }
    for (const t of a.myTournaments?.active ?? []) out.push(`My active tournament: T${t.id} "${txt(t.title, 60)}" ${t.tier} ${t.format} ${t.status} fee ${t.entry_fee_foxsy}${t.status === 'open' && leaveLockLive(s.config) && t.participant_count === t.min_teams ? ' (seats locked: at its minimum, no leave until more teams join)' : ''}`)
    // Its own open creations with a range: FoxLeague lets the creator widen one while it is open for joining (only one
    // this agent created itself: a range the owner set with the same team is the owner's).
    for (const t of a.myTournaments?.active ?? []) {
      if (!s.ownCreations?.includes(t.id) || t.creator_user_id !== s.profile?.id || t.status !== 'open' || !(Date.parse(t.deadline) > Date.parse(s.takenAt)) || t.format === 'league_knockout' || t.developer_mode || !ovrRange(t)) continue
      // FoxLeague's /tournaments/my carries no seat count; the public list does.
      const listed = [...s.market.openStandard, ...s.market.openChallenges].find(x => x.id === t.id)
      const seated = typeof t.participant_count === 'number' ? t.participant_count : listed?.participant_count ?? '?'
      out.push(`Your open T${t.id} (${t.max_teams === 2 ? 'a 1v1' : `a ${t.format} of ${t.max_teams}, min ${t.min_teams}`}):${ovrRange(t).slice(1)}, ${seated} of ${t.max_teams} seated, deadline ${t.deadline}: widen_range lets more teams in (only wider)`)
    }
    for (const c of a.challengesForMe) out.push(`Challenge for me: T${c.tournament_id} from ${txt(c.creator_team_name, 20)} (user ${c.creator_user_id}) stake ${c.entry_fee_foxsy} FOXSY, deadline ${c.deadline}${scout(c.tournament_id)}${rivalNote(s, c.creator_user_id)}`)
  }

  out.push(...levelLines(s))

  if (s.players.length) {
    out.push(`Squad (${s.players.length}; stats synced>live, (xp/${XP_PER_POINT}) = that stat's XP pool when ${XP_SHOWN_FROM} or more, ${XP_PER_POINT} gives +1; comp = competitive matches of the rarity's match gate):`)
    if (s.config) out.push(`Match gates (fusion input or listing; ${levelsLive(s.config, new Date(s.takenAt)) ? 'a ranked game you started and paid for and a paid Bronze match count too, casual and free Bronze never' : 'ranked, casual and Bronze never count'}): ${gateLine(s.config)}`)
    const order = { starter: 0, bench: 1, reserve: 2 }
    const cfg = s.config
    for (const p of [...s.players].sort((a, b) => order[a.role] - order[b.role] || (a.slot ?? 99) - (b.slot ?? 99))) out.push(`  ${playerLine(p, cfg ? matchGate(cfg, p.rarity) : undefined)}`)
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

  const m = s.market
  if (typeof s.auth?.bestXiOvr === 'number') {
    // The default range for what the agent creates (owner, 2026-10-24): about 10 percent either way, whole numbers 1 to 100.
    const ovr = s.auth.bestXiOvr
    const lo = Math.max(1, Math.floor(ovr * 0.9))
    const hi = Math.min(100, Math.ceil(ovr * 1.1))
    // How many teams it lets in, from the leaderboard's best XI OVRs (FoxLeague, 2026-10-26).
    const inside = (v: number[]) => v.filter(x => x >= lo && x <= hi).length
    const b = s.market.boardOvrs
    const count = b?.all.length ? ` (inside it: ${inside(b.all)} of the ${b.all.length} leaderboard teams read, ${inside(b.takers)} of the ${b.takers.length} that accepted a 1v1 in 7 days)` : ''
    out.push(`Your best XI OVR (what OVR ranges are checked against): ${ovr}; a range about 10 percent either way for what you create: ovr_min ${lo}, ovr_max ${hi}${count}`)
  }
  out.push(`Open tournaments: ${m.openStandard.length ? '' : 'none'}`)
  // A Zeus snapshot reads each team's win chance (research); only Zeus is held to the field rule.
  const zeus = s.leaderboardNeighbours.some(u => typeof u.winChance === 'number')
  if (m.fields?.length) out.push(`  (field lines: a seated team is clearly stronger when its ELO is more than ${ZEUS_STRONGER_ELO} above yours and its lineup (synced stats at full condition) more than ${Math.round((ZEUS_STRONGER_SQUAD - 1) * 100)} percent above yours at the tournament's start; an unread lineup counts on its ELO alone; clearly weaker is both the other way${zeus ? `; Zeus never joins a field with ${ZEUS_FIELD_LIMIT} or more clearly stronger teams, or ${ZEUS_FIELD_LIMIT} or more unknown ones` : ''})`)
  for (const t of m.openStandard.slice(0, 30)) {
    out.push(`  T${t.id} "${txt(t.title, 60)}" ${t.tier} ${t.format} ${t.participant_count ?? '?'}/${t.max_teams} (min ${t.min_teams}) fee ${t.entry_fee_foxsy} deadline ${t.deadline} starts ${t.starts_at}${scheduleText(t)}${t.is_private ? (t.invited ? ', private, you are invited' : ', private') : ''}${ovrRange(t)}`)
    const field = m.fields?.find(f => f.id === t.id)
    if (field) out.push(`    ${fieldText(s, t, field)}`)
  }
  // League + Knockout invitations: accepted with join_tournament, by every level within its limits (owner, 2026-10-24).
  const invitations = s.auth?.invitations ?? []
  if (invitations.length) {
    out.push(`League + Knockout invitations (36 teams: ${LK_LEAGUE_MATCHES} league matches, then places 1 to ${LK_KNOCKOUT_PLACES} play the knockout, at most ${LK_LEAGUE_MATCHES + LK_KNOCKOUT_MATCHES} matches; one match at a time for the whole tournament; while it runs no other tournament, 1v1s and ranked stay open; no leaving once the seats lock):`)
    const at = (iso: string | null | undefined) => (iso && Number.isFinite(Date.parse(iso)) ? new Date(Date.parse(iso)).toISOString().slice(0, 16).replace('T', ' ') : '?')
    for (const i of invitations) {
      const t = i.tournament
      const prize = i.prize_atomic && /^\d+$/.test(i.prize_atomic) ? `, sponsor prize ${(BigInt(i.prize_atomic) / 10n ** 18n).toString()} FOXSY shared by the last 8` : ''
      const run = t ? `, one match every ${t.round_interval_minutes ?? '?'} min from ${at(t.starts_at)}` : ', its schedule could not be read'
      const can = i.can_accept ? 'accept with join_tournament' : `FoxLeague says it cannot be accepted now${i.refusal ? ` (${txt(i.refusal, 120)})` : ''}`
      out.push(`  T${Number(i.tournament_id)} "${txt(i.title, 60)}" ${txt(i.tier, 10)}, entry ${Number(i.entry_fee_foxsy)} FOXSY${prize}${run}, expires ${at(i.expires_at)}, seats lock ${at(i.seats_lock_at)}: ${can}`)
    }
  }
  for (const seat of s.auth?.leagueSeats ?? []) {
    const lock = seat.seatsLockAt ? `seats lock ${seat.seatsLockAt.slice(0, 16).replace('T', ' ')} UTC: until then you may leave a seat you joined yourself for the whole entry back, but only when you see no real chance of the top 24 (places 1 to 24 play the knockout; leaving closes the invitation for good); after that nobody can leave` : 'when its seats lock could not be read: no leaving'
    out.push(`Your League + Knockout T${Number(seat.tournamentId)}: ${seat.accepted ?? '?'} of 36 seats taken; ${lock}`)
  }
  if (m.scouted?.length || s.leaderboardNeighbours.some(u => typeof u.strength === 'number')) out.push(`Your lineup strength today (synced stats x condition): ${Math.round(lineupStrength(s))}; a 1v1 is refused when the rival's lineup is more than 10 percent above it.`)
  out.push(`Open 1v1 challenges: ${m.openChallenges.length ? '' : 'none'}`)
  for (const t of m.openChallenges.slice(0, 20)) {
    out.push(`  T${t.id} "${txt(t.title, 60)}" ${t.tier} stake ${t.entry_fee_foxsy} creator user ${t.creator_user_id}${t.target_user_id ? ` targets user ${t.target_user_id}` : t.targeted ? ' targets another team' : ' open'} deadline ${t.deadline} seated ${t.participant_count ?? '?'}${ovrRange(t)}${scout(t.id)}${rivalNote(s, t.creator_user_id)}`)
  }
  // Time slots for creating: every window a new tournament's own window may not overlap, and the gaps.
  const now = Date.now()
  const hm = (t: number) => new Date(t).toISOString().slice(5, 16).replace('T', ' ')
  const slots = (m.slots ?? []).filter(w => w.end > now)
  out.push(`Tournament time slots taken (UTC; a created tournament reserves 1 h before its start to 1 h after start + FoxLeague's estimate, ~3 min per match; it may not overlap these): ${slots.length ? '' : 'none'}`)
  for (const w of slots.slice(0, 20)) out.push(`  T${w.id} "${txt(w.title, 40)}" ${hm(w.start)} to ${hm(w.end)}`)
  const gaps = freeGaps(slots, now + 3600_000, now + 72 * 3600_000)
  if (slots.length) out.push(`Free for a new tournament's whole window (next 72 h): ${gaps.slice(0, 8).map(g => `${hm(g.start)} to ${hm(g.end)}`).join('; ') || 'none'}`)
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
    out.push('Open auctions: the 10 strongest, then the 3 cheapest of each rarity (nonce, card, OVR, price now, ends):')
    for (const l of m.auctions) {
      const ovr = Math.round((l.speed + l.accuracy + l.defense + l.power + l.control + l.vision + l.stamina) / 7)
      const price = l.highest_bid ? `top bid ${l.highest_bid}` : `reserve ${l.min_price ?? '?'}`
      const lock = l.transferred_at && l.transfer_cooldown_hours ? new Date(new Date(l.transferred_at).getTime() + l.transfer_cooldown_hours * 3600_000) : null
      // Own keys only: a rarity named like an inherited property (toString) has no market price (review of PR #21).
      const market = m.prices && Object.hasOwn(m.prices, l.rarity) ? m.prices[l.rarity] : undefined
      out.push(`  #${l.nft_nonce} ${txt(l.name, 30)} ${l.position} ${l.rarity} lvl ${l.level} OVR ${ovr} cond ${l.condition} | ${price}${market ? ` (market ${market.price.toLocaleString('en-US')})` : ''} | ends ${l.ends_at?.slice(0, 16) ?? '?'}${lock && lock > new Date(s.takenAt) ? ` | transfer lock until ${lock.toISOString().slice(0, 16)}` : ''}`)
    }
  }
  // Zeus: the threshold its 1v1s are held to, next to the chances below.
  if (s.leaderboardNeighbours.some(u => typeof u.winChance === 'number')) out.push('Win chances: ELO expectation and lineup strength averaged, ours at today\'s condition, theirs at full condition; Zeus plays a 1v1 from 55 percent.')
  if (s.leaderboardNeighbours.length) {
    out.push(`Teams to challenge (the ones that accept 1v1s first): ${s.leaderboardNeighbours.map(u => `${txt(u.team_name, 20)} (user ${u.id}) ${u.elo_rating}${u.accepted7d ? `, accepted ${u.accepted7d} 1v1 in 7 days` : ', no 1v1 accepted in 7 days'}${typeof u.bestXiOvr === 'number' ? `, best XI OVR ${u.bestXiOvr}` : ''}${u.played ? `, ${u.played.matches} matches in ${u.played.days} days` : ''}${typeof u.strength === 'number' ? `, lineup ${Math.round(u.strength)}` : ''}${typeof u.winChance === 'number' ? `, your win chance ${Math.round(u.winChance * 100)} percent` : ''}${ownChallengeOut(s, u.id)}${rivalNote(s, u.id)}`).join('; ')}`)
  }
  for (const w of s.warnings) out.push(`WARNING ${txt(w, 160)}`)
  return out.join('\n')
}

/** JSON-safe copy (bigint as decimal strings). */
export function snapshotToJson(s: AgentSnapshot): string {
  return JSON.stringify(s, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2)
}
