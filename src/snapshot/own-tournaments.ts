// Whether a tournament the agent created still fits (ORG-1, after the audit of 16 Nov 2026). Since P-O1 a create can
// be up to 30 days ahead, and its squad and schedule checks ran only at the create. Each planning snapshot runs them
// again on every open tournament the agent created itself and holds a seat in: the condition the squad has at its start
// with the agent's other tournaments counted (joined since the create too: scheduleRefusal, the create's own test) and
// how many of the 18 can play at its start (injured until after it, or suspended). One that no longer fits is said
// plainly, with until when the plan may leave it (FoxLeague: open and before its registration deadline, and not at
// exactly its minimum once the leave lock is live, release/mainnet-1.0 729164194 tournaments.rs
// `leave_breaks_the_minimum`) and what comes back (the entry; an organizer's deposit follows the tournament,
// organizer_fees.rs `refund_of`). Such a leave runs first in its plan (deadlines.ts). A check that cannot be made says so:
// unknown is not a fit (AGENTS.md rule 4). Information only: the executor checks every leave as before.

import type { Tournament } from '../foxleague/types.ts'
import { leaveLockLive, organizerFeesLive } from '../foxleague/levels.ts'
import { outInjured, scheduleRefusal } from '../executor/rules.ts'
import type { AgentSnapshot } from './snapshot.ts'

/** What the create's checks answer now for a tournament the agent created. */
export type OwnFit = { fits: true } | { fits: false; why: string } | { unknown: string }

const at16 = (t: number) => `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC`

/** The checks of the create, run again on the agent's own tournament `t` (its own matches left out of "the others"). */
export function ownTournamentFit(s: AgentSnapshot, t: Tournament, now: Date): OwnFit {
  if (!s.config || !s.team || !s.auth?.myTournaments) return { unknown: 'your team, your tournaments or the game settings could not be read' }
  const start = Date.parse(t.starts_at)
  if (!Number.isFinite(start)) return { unknown: 'its start could not be read' }
  const worn = scheduleRefusal(s, t, now)
  if (worn && /could not be read/.test(worn)) return { unknown: worn }
  if (worn) return { fits: false, why: worn }
  // FoxLeague forfeits a match with fewer than 11 of the saved 18 available (an injured or a suspended card is out).
  const at = new Date(start)
  const squad = [...s.team.lineup, ...s.team.substitutes].map(n => ({ n, p: s.players.find(p => p.nonce === n) }))
  const out = squad.filter(({ p }) => !p || outInjured(p, at) || p.suspended)
  const available = squad.length - out.length
  if (available >= 11) return { fits: true }
  const unread = out.filter(({ p }) => p?.disciplineUnread)
  if (unread.length) return { unknown: `the injuries of ${unread.map(({ n }) => `#${n}`).join(', ')} could not be read` }
  const named = out.slice(0, 8).map(({ n, p }) => (!p ? `#${n} not in the wallet` : p.injuredUntil && Date.parse(p.injuredUntil) > start ? `#${n} injured until ${p.injuredUntil.slice(0, 16)}` : `#${n} suspended`))
  return { fits: false, why: `only ${available} of your 18 can play at its start (${named.join(', ')}${out.length > named.length ? ' and more' : ''}): FoxLeague forfeits a match with fewer than 11 (the full K lost)` }
}

/** The plan's lines: one for each open tournament the agent created itself and holds a seat in. */
export function ownTournamentLines(s: AgentSnapshot): string[] {
  const own = s.ownCreations ?? []
  if (!own.length || !s.profile || !s.auth) return []
  const mine = s.auth.myTournaments
  if (!mine) return ['Your own tournaments could not be read: whether one you created still fits your squad and schedule could not be checked (unknown, not a fit)']
  const now = new Date(s.takenAt)
  const out: string[] = []
  for (const t of mine.active) {
    if (!own.includes(t.id) || t.creator_user_id !== s.profile.id || !(t.max_teams > 2) || t.status !== 'open' || t.format === 'league_knockout' || t.developer_mode) continue
    const deadline = Date.parse(t.deadline)
    if (!(deadline > now.getTime())) continue
    // No seat of ours: nothing to leave (the "created by you, with no seat of yours" line speaks).
    if (s.auth.unseatedCreated?.includes(t.id)) continue
    // FoxLeague's /tournaments/my carries no seat count; the public list does.
    const listed = s.market.openStandard.find(x => x.id === t.id)
    const seatedRead = typeof t.participant_count === 'number' ? t.participant_count : listed?.participant_count
    const seated = typeof seatedRead === 'number' && Number.isSafeInteger(seatedRead) ? seatedRead : null
    const start = Date.parse(t.starts_at)
    const head = `Your own T${t.id} (${t.format} of ${t.max_teams}, min ${t.min_teams}, ${seated ?? '?'} of ${t.max_teams} seated, starts ${Number.isFinite(start) ? at16(start) : t.starts_at}, registration closes ${at16(deadline)})`
    const fit = ownTournamentFit(s, t, now)
    if ('unknown' in fit) {
      out.push(`${head}: could not check whether it still fits (${fit.unknown}): unknown, not a fit; the next plan checks again`)
      continue
    }
    if (fit.fits) {
      out.push(`${head}: still fits your squad and schedule (the checks of its create, run again now: the condition at its start with your other tournaments, injuries and bans)`)
      continue
    }
    const back = `${t.entry_fee_foxsy > 0 ? `: your entry of ${t.entry_fee_foxsy} FOXSY comes back` : ''}${organizerFeesLive(s.config, now) ? '; your organizer deposit stays with it (back after its last game, kept if too few teams join by its deadline)' : ''}`
    const lock = leaveLockLive(s.config)
    if (lock && seated === t.min_teams) {
      out.push(`${head}: NO LONGER FITS: ${fit.why}. Its seats are locked now: at its minimum of ${t.min_teams} seated nobody can leave until more teams join; then leave_tournament works until its registration closes at ${at16(deadline)}${back}`)
      continue
    }
    const atMinimum = lock ? `, but not while exactly ${t.min_teams} teams (its minimum) are seated: a join that brings it there locks the seats, so a leave runs first in its plan` : ''
    out.push(`${head}: NO LONGER FITS: ${fit.why}. You may leave it with leave_tournament until its registration closes at ${at16(deadline)}${atMinimum}${back}`)
  }
  return out
}
