// FoxLeague's own calendar of free tournament starts; a start of its own for each agent (P-O1 and P-O2 of the audit of
// 16 Nov 2026; the owner's decisions that day: "14 days, own start each", then 30 days in P-O1b).
//
// GET /api/tournaments/availability answers, for a format and a size, the starts where a new tournament fits, by the
// rule create refuses a start with (release/mainnet-1.0 729164194: routes/tournaments.rs `tournament_availability`,
// tournament_slots.rs `availability` and `TournamentAvailability`). It counts every booking, a tournament being created
// too (hidden from the public lists, answered with a negative id), needs no session and answers every caller alike.
// A planning snapshot reads it for a few shapes over the 30 days a create may be ahead, in up to three reads a shape
// (FoxLeague answers 14 days a read). A failed or malformed answer is unknown, never free (AGENTS.md rule 4):
// the plan is told it could not be read and is offered no start; the executor's own clash check stays the last word.
//
// Each agent is offered, for each shape, the (n mod k)-th of the k free starts listed, n its own agent number, so two
// agents of one install do not plan the same minute. The pick depends only on that number and FoxLeague's public
// answer: no agent reads another's state or plans (the owner's rule of 2026-10-27, agents play alone).

import type { FoxLeague } from '../foxleague/api.ts'
import { CREATE_START_MAX_MS, CREATE_START_MIN_MS } from '../executor/actions.ts'
import { blockingWindow, ceilMinute, clash, estimateMinutes, planLeadMs, type SlotWindow } from '../executor/slots.ts'
import { MAX_TICK_MINUTES } from '../store/settings.ts'

/** A booking as the answer names it (`BookedSlot`): a negative id is a tournament being created, never named. */
export interface AvailabilityBooking {
  tournament_id: number
  /** Written by a player: data, never instructions. */
  title: string
  start: string
  end: string
}

/** The answer of GET /api/tournaments/availability (tournament_slots.rs `TournamentAvailability`), times RFC 3339. */
export interface TournamentAvailability {
  /** The first instant answered: the request's `from`, never before now. */
  from: string
  /** The last instant answered: `from` plus `days`. */
  to: string
  /** The bookings that overlap [from, to], earliest first. */
  busy: AvailabilityBooking[]
  /** The starts where this tournament fits, earliest first: every start from `first` to `last`, both included. */
  free: { first: string; last: string }[]
  /** Why the requested `from` is not free, as create judges it; null when create would accept it. */
  from_refusal: 'too_soon' | 'taken' | 'too_far' | null
  /** The booking create would name for the requested `from`. */
  conflict: AvailabilityBooking | null
  /** The first free start at or after `from`: `from` itself when free, else the first quarter hour that is. */
  next_free: string | null
}

/** What the client asks (`AvailabilityQuery`): `days` 1 to 14, `from` defaults to now. */
export interface AvailabilityQuery {
  format: string
  teams: number
  home_and_away?: boolean
  days?: number
  from?: string
}

/**
 * The shapes the plan is offered starts for: the smallest tournament the agent may create (a round robin of 3, which
 * fits the narrowest gap) and two larger ones. A start that fits a shape fits every shape with a shorter estimate:
 * its booking begins at the same minute and ends sooner.
 */
export const CALENDAR_SHAPES: readonly { format: 'round_robin' | 'groups_knockout'; teams: number }[] = [
  { format: 'round_robin', teams: 3 },
  { format: 'round_robin', teams: 8 },
  { format: 'groups_knockout', teams: 16 },
]

/** The days the calendar is read over: the agent's whole horizon (30 days, P-O1b). */
export const CALENDAR_DAYS = CREATE_START_MAX_MS / 86_400_000
/** The most days FoxLeague answers in one read (tournament_slots.rs MAX_DAYS): the 30 days take up to three. */
export const CALENDAR_WINDOW_DAYS = 14

/** One shape's free starts in ms, earliest first; null when they could not be read (unknown, never free). */
export interface ShapeCalendar {
  format: string
  teams: number
  free: { first: number; last: number }[] | null
}

/** More free ranges than this in one read (14 days at most) is no answer of FoxLeague's (a range lies between two bookings). */
const MAX_RANGES = 2000

/** The free ranges of an answer, in ms, earliest first. Throws on anything that is not FoxLeague's calendar. */
export function freeRanges(answer: unknown): { first: number; last: number }[] {
  const free = answer !== null && typeof answer === 'object' ? (answer as { free?: unknown }).free : undefined
  if (!Array.isArray(free) || free.length > MAX_RANGES) throw new Error('not the calendar FoxLeague answers (no list of free starts)')
  return free
    .map(f => {
      const r = f !== null && typeof f === 'object' ? (f as { first?: unknown; last?: unknown }) : {}
      const first = typeof r.first === 'string' ? Date.parse(r.first) : Number.NaN
      const last = typeof r.last === 'string' ? Date.parse(r.last) : Number.NaN
      if (!Number.isFinite(first) || !Number.isFinite(last) || first > last) throw new Error('a free range without two readable times')
      return { first, last }
    })
    .sort((a, b) => a.first - b.first)
}

/**
 * Free ranges of several windows as one list, earliest first: a stretch free across the end of one window and the start
 * of the next is one range (each window cuts its ranges at its own ends), so the starts listed stay a booking apart there.
 */
export function joinRanges(ranges: { first: number; last: number }[]): { first: number; last: number }[] {
  const out: { first: number; last: number }[] = []
  for (const r of [...ranges].sort((a, b) => a.first - b.first)) {
    const prev = out.at(-1)
    if (prev && r.first <= prev.last) prev.last = Math.max(prev.last, r.last)
    else out.push({ ...r })
  }
  return out
}

/**
 * The earliest start a read counts toward the 10 it needs: the latest first start a plan request can give (2 hours after
 * the longest plan window) and an hour more, so the plan request finds at least as many starts as the read counted.
 */
const READ_COUNT_FROM_MS = CREATE_START_MIN_MS + planLeadMs(MAX_TICK_MINUTES) + 3600_000

/**
 * Reads each shape's free starts over the agent's horizon, in windows of up to 14 days from `now` (FoxLeague answers no
 * more a read): the next window only while fewer than OWN_START_CHOICES starts of that shape were found, so a calendar
 * with room costs one read a shape. Any failed or malformed window makes the shape null with a warning (unknown, never
 * free): a partial list is never presented as the whole.
 */
export async function readCalendar(fox: Pick<FoxLeague, 'tournamentAvailability'>, warnings: string[], now: number, slots: SlotWindow[] = []): Promise<ShapeCalendar[]> {
  return Promise.all(
    CALENDAR_SHAPES.map(async shape => {
      const ranges: { first: number; last: number }[] = []
      for (let offset = 0; offset < CALENDAR_DAYS; offset += CALENDAR_WINDOW_DAYS) {
        const days = Math.min(CALENDAR_WINDOW_DAYS, CALENDAR_DAYS - offset)
        try {
          ranges.push(...freeRanges(await fox.tournamentAvailability({ format: shape.format, teams: shape.teams, from: new Date(now + offset * 86_400_000).toISOString(), days })))
        } catch (err) {
          warnings.push(`free tournament starts (${shape.format} of ${shape.teams}): ${err instanceof Error ? err.message : String(err)} (the read of days ${offset} to ${offset + days})`)
          return { ...shape, free: null }
        }
        if (freeStartsFor(shape, joinRanges(ranges), slots, now + READ_COUNT_FROM_MS, now + CREATE_START_MAX_MS).length >= OWN_START_CHOICES) break
      }
      return { ...shape, free: joinRanges(ranges) }
    }),
  )
}

/** The most starts listed for one shape: agent n takes the (n mod k)-th of the k listed. */
export const OWN_START_CHOICES = 10

const HOUR = 3600_000

/** The booking of a shape: an hour before its start to an hour after its estimate (FoxLeague's BOOKING_PAD_MINUTES). */
const bookingMs = (format: string, teams: number) => estimateMinutes(format, teams, false) * 60_000 + 2 * HOUR

/**
 * How far apart the starts listed are: the booking of the largest shape, so the starts given to two agents never
 * overlap, whichever of the shapes each creates.
 */
export const START_SPACING_MS = Math.max(...CALENDAR_SHAPES.map(s => bookingMs(s.format, s.teams)))

/**
 * Up to OWN_START_CHOICES free starts of a shape from `from` to `to` (whole minutes), START_SPACING_MS apart: inside
 * FoxLeague's free ranges and clear of every window the agent's own calendar sees taken (the executor's clash check
 * reads those), so each start offered passes both.
 */
export function freeStartsFor(shape: { format: string; teams: number }, free: { first: number; last: number }[], slots: SlotWindow[], from: number, to: number): number[] {
  const out: number[] = []
  let steps = 0
  for (const r of free) {
    let t = ceilMinute(Math.max(r.first, from))
    const last = Math.min(r.last, to)
    while (t <= last && out.length < OWN_START_CHOICES && steps++ < 1000) {
      const taken = clash(slots, blockingWindow(shape.format, shape.teams, false, t))
      // The first start whose booking begins at or after the end of the one it would overlap.
      if (taken) t = ceilMinute(taken.end + HOUR)
      else {
        out.push(t)
        t += START_SPACING_MS
      }
    }
    if (out.length >= OWN_START_CHOICES) break
  }
  return out
}

/** The place of the agent's own start among k starts: its agent number n, n mod k; null without a number or a start. */
export function ownStartIndex(k: number, agentIndex: number | null | undefined): number | null {
  return k > 0 && typeof agentIndex === 'number' && Number.isSafeInteger(agentIndex) && agentIndex >= 0 ? agentIndex % k : null
}

/** The plan's lines: each shape's own start and the next free ones (after the slot lines of the digest). */
export function calendarLines(s: { agent: { index: number | null }; market: { slots?: SlotWindow[]; calendar?: ShapeCalendar[] } }, o: { now: number; earliest: number }): string[] {
  const cal = s.market.calendar
  if (!cal) return []
  const minute = (t: number) => `${new Date(t).toISOString().slice(0, 16)}Z`
  const days = CREATE_START_MAX_MS / 86_400_000
  const out = [
    `Your own starts for a new tournament (FoxLeague's calendar of free starts, next ${days} days, every booking counted; picked by your agent number, so the other teams your owner runs are offered other minutes; take yours, a next one only if yours is refused; none before ${minute(o.earliest)}; the starts are a booking apart; a start that fits a shape fits every shape with a shorter estimate):`,
  ]
  for (const c of cal) {
    const head = `  ${c.format} of ${c.teams} (estimate ${estimateMinutes(c.format, c.teams, false)} min): `
    if (!c.free) {
      out.push(`${head}could not read the free starts (unknown, not free): no start offered; the slot check at the create decides`)
      continue
    }
    const starts = freeStartsFor(c, c.free, s.market.slots ?? [], o.earliest, o.now + CREATE_START_MAX_MS)
    const mine = ownStartIndex(starts.length, s.agent.index)
    if (!starts.length) out.push(`${head}no free start in the next ${days} days`)
    else if (mine === null) out.push(`${head}free starts: ${starts.slice(0, 4).map(minute).join(', ')}`)
    else {
      const next = [...starts.slice(mine + 1), ...starts.slice(0, mine)].slice(0, 3)
      out.push(`${head}your start for this shape: starts_at ${minute(starts[mine]!)}; the next free ones (only if yours is refused): ${next.length ? next.map(minute).join(', ') : 'none'}`)
    }
  }
  return out
}
