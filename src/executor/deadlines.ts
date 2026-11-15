// When a planned action must have run by, read from the snapshot its plan was made from: the time gates the executor
// checks (rules.ts) at the times that snapshot shows. It only picks the moment an action runs (scheduleActions in
// service.ts); the executor still checks everything against a fresh snapshot when the action runs, and nothing here
// lets an action skip a check.

import { CREATE_START_MIN_MS, type Action } from './actions.ts'
import type { AgentSnapshot } from '../snapshot/snapshot.ts'
import { BUSY_OPENS_MARGIN_S, INVITATION_MARGIN_MS } from './rules.ts'

/**
 * An action's deadline: the last moment the executor would still let it through by the plan's snapshot, in ms since
 * the epoch; 'unread' for an action with a time limit the snapshot cannot tell (unknown is not "none": it runs early);
 * null for an action with no time limit.
 */
export type Deadline = number | 'unread' | null

/** A time FoxLeague served, or null when it is none. */
function time(v: unknown): number | null {
  if (typeof v !== 'string') return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

/** The earliest of the times read, or null when none was. */
function earliest(ts: (number | null)[]): number | null {
  const read = ts.filter((t): t is number => t !== null)
  return read.length ? Math.min(...read) : null
}

interface Copy {
  deadline: unknown
  starts_at?: unknown
  tier?: unknown
  entry_fee_foxsy?: unknown
  format?: unknown
}

/**
 * Every copy of a tournament or 1v1 the snapshot holds: its own tournaments, the open ones, the 1v1s aimed at this
 * team and its League + Knockout invitations.
 */
function copies(s: AgentSnapshot | null | undefined, id: number): Copy[] {
  if (!s) return []
  const out: Copy[] = []
  for (const t of [...(s.auth?.myTournaments?.active ?? []), ...(s.market?.openStandard ?? []), ...(s.market?.openChallenges ?? [])]) if (t.id === id) out.push(t)
  for (const i of s.auth?.invitations ?? []) if (i.tournament?.id === id) out.push(i.tournament)
  // A 1v1 aimed at this team: always Silver or Gold, so a paid entry.
  for (const c of s.auth?.challengesForMe ?? []) if (c.tournament_id === id) out.push({ deadline: c.deadline, entry_fee_foxsy: c.entry_fee_foxsy })
  return out
}

/** When registration closes, by the earliest deadline a copy shows; null when no copy shows one. */
function closes(cs: Copy[]): number | null {
  return earliest(cs.map(c => time(c.deadline)))
}

/** The deadline of a planned action by the snapshot its plan was made from (see Deadline). */
export function actionDeadline(a: Action, s: AgentSnapshot | null | undefined): Deadline {
  switch (a.type) {
    case 'join_tournament': {
      // The executor: open, before the deadline, a paid entry not within 120 s of it (FoxLeague checks the deadline when
      // the join arrives, after the payment settled); a League + Knockout not within 30 minutes of its invitation's expiry.
      const cs = copies(s, a.tournament_id)
      const close = closes(cs)
      if (close === null) return 'unread'
      // Free only when every copy says a Bronze without a fee: anything else is paid, the stricter of the two.
      const free = cs.every(c => c.tier === 'bronze' && !(typeof c.entry_fee_foxsy === 'number' && c.entry_fee_foxsy > 0))
      let by = free ? close : close - BUSY_OPENS_MARGIN_S * 1000
      // A tournament starts after its deadline; a start that comes sooner closes it too.
      const start = earliest(cs.map(c => time(c.starts_at)))
      if (start !== null) by = Math.min(by, start)
      const inv = s?.auth?.invitations?.find(i => i.tournament_id === a.tournament_id)
      if (inv) {
        const expires = time(inv.expires_at)
        if (expires === null) return 'unread'
        by = Math.min(by, expires - INVITATION_MARGIN_MS)
      } else if (cs.some(c => c.format === 'league_knockout')) {
        return 'unread'
      }
      return by
    }
    case 'leave_tournament': {
      // The executor: open and before its deadline; a League + Knockout seat not within 30 minutes of its seats lock.
      const cs = copies(s, a.tournament_id)
      const close = closes(cs)
      if (close === null) return 'unread'
      const seat = s?.auth?.leagueSeats?.find(x => x.tournamentId === a.tournament_id)
      if (!seat && !cs.some(c => c.format === 'league_knockout')) return close
      const lock = time(seat?.seatsLockAt)
      return lock === null ? 'unread' : Math.min(close, lock - INVITATION_MARGIN_MS)
    }
    case 'widen_range': {
      // The executor: only while it is open for joining, before its deadline.
      const close = closes(copies(s, a.tournament_id))
      return close === null ? 'unread' : close
    }
    case 'bid': {
      // The executor: before the auction's end.
      const end = time(s?.market?.auctions?.find(l => l.nft_nonce === a.nonce)?.ends_at)
      return end === null ? 'unread' : end
    }
    case 'cancel_listing':
      // A cancel matters only until the first bid (the executor refuses one after it) or the auction's end, and the
      // snapshot holds no end of the agent's own auctions (its market list leaves them out): unknown, so early.
      return 'unread'
    case 'create_tournament': {
      // A start at a fixed minute (2026-11-15): the executor wants it at least 2 hours ahead and registration closing
      // more than 30 minutes from now. Whole hours count from the run, so they have no time limit; a start the rules
      // cannot read is refused whenever it runs.
      if (a.starts_at === undefined) return null
      const start = time(a.starts_at)
      return start === null ? null : start - Math.max(CREATE_START_MIN_MS, (a.registration_closes_minutes_before + 30) * 60_000)
    }
    default:
      return null
  }
}
