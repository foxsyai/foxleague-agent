// FoxLeague's platform-wide time slots. Every standard tournament reserves a blocking window from one
// hour before its start to one hour after its estimated end, and a new tournament whose window overlaps
// any live one is refused at create ("Time slot conflicts with tournament #N"). The estimate is the
// backend's own (tournaments.rs estimate_duration_minutes, release/mainnet-1.0): about 3 minutes per
// match, far shorter than the real run, but it is what the check uses. 1v1s and developer tournaments
// have no window.

import type { Tournament } from '../foxleague/types.ts'

export interface SlotWindow {
  id: number
  title: string
  start: number
  end: number
}

/** The backend's estimate in minutes (not the real duration: it only drives the slot check). */
export function estimateMinutes(format: string, maxTeams: number, homeAndAway: boolean): number {
  switch (format) {
    case 'knockout':
      return maxTeams * 3
    case 'groups_knockout':
      return maxTeams * 6
    case 'round_robin':
      return (homeAndAway ? maxTeams * (maxTeams - 1) : Math.floor((maxTeams * (maxTeams - 1)) / 2)) * 3
    case 'swiss':
      return (Math.ceil(Math.log2(maxTeams)) + 1) * Math.floor(maxTeams / 2) * 3
    case 'league_knockout':
      // The league phase plays 8 matches a team, the knockout 46 (tournament_engine.rs LEAGUE_MATCHES_PER_TEAM,
      // LEAGUE_KNOCKOUT_KO_MATCHES): 570 minutes for 36 teams (audit C4, 2026-10-23).
      return (Math.floor((maxTeams * 8) / 2) + 46) * 3
    default:
      return maxTeams * 3
  }
}

/** The smallest estimate of a tournament the agent may create: 9 minutes (3 matches: a round robin or a Swiss of 3). */
export const SMALLEST_ESTIMATE_MIN = Math.min(estimateMinutes('round_robin', 3, false), estimateMinutes('swiss', 3, false), estimateMinutes('knockout', 4, false), estimateMinutes('groups_knockout', 8, false))

/** The pad a booking keeps before the start and after the estimate (FoxLeague's BOOKING_PAD_MINUTES). */
const BOOKING_PAD_MS = 3600_000

export function blockingWindow(format: string, maxTeams: number, homeAndAway: boolean, startsAt: number): { start: number; end: number } {
  return { start: startsAt - BOOKING_PAD_MS, end: startsAt + estimateMinutes(format, maxTeams, format === 'round_robin' && homeAndAway) * 60_000 + BOOKING_PAD_MS }
}

/** Windows of the live standard tournaments (any status but completed, cancelled and delayed). */
export function slotWindows(tournaments: Tournament[]): SlotWindow[] {
  const seen = new Set<number>()
  const out: SlotWindow[] = []
  for (const t of tournaments) {
    if (seen.has(t.id) || t.max_teams <= 2 || t.developer_mode || ['completed', 'cancelled', 'simulation_delayed'].includes(t.status)) continue
    seen.add(t.id)
    const w = blockingWindow(t.format, t.max_teams, Boolean(t.home_and_away), new Date(t.starts_at).getTime())
    out.push({ id: t.id, title: t.title, ...w })
  }
  return out.sort((a, b) => a.start - b.start)
}

/** The live window a new one would overlap (the backend's test: start < other end and end > other start). */
export function clash(windows: SlotWindow[], w: { start: number; end: number }): SlotWindow | undefined {
  return windows.find(x => x.start < w.end && x.end > w.start)
}

const MINUTE = 60_000

/**
 * The share of its tick a plan's actions are spread over (runPlan in service.ts): they run up to 0.8 of a tick after
 * the plan, and the next plan is timed a tick and its jitter after the last of them (scheduleNext).
 */
export const PLAN_WINDOW_SHARE = 0.8

/**
 * Room for a plan's call and the fresh snapshot an action reads before it runs: a plan call at high effort is given up
 * after 11 min 40 s (deadlineMs of its 32,000 tokens) and a snapshot takes tens of seconds. A longer call (xhigh) is
 * covered too: the create of a start this far ahead then has its deadline inside the window, and the deadline-first
 * schedule of PR #70 runs it by that deadline less 5 minutes.
 */
export const PLAN_CALL_ROOM_MS = 15 * MINUTE

/**
 * How long after a snapshot the create of a plan made from it can run, at the latest (R74A-2, 2026-11-15): the plan's
 * window, where match gates can still hold a create that has a deadline, and the room for its call. The first start the
 * snapshot gives is at least this long past the 2-hour floor, so the create still finds it 2 hours ahead.
 */
export function planLeadMs(tickMinutes: number): number {
  return tickMinutes * PLAN_WINDOW_SHARE * MINUTE + PLAN_CALL_ROOM_MS
}

/**
 * How long after a refusal the create of the next plan can run, at the latest (R74A-1, 2026-11-15): the rest of this
 * plan's window (the refusal can come at its start), the tick and its jitter before the next plan, then that plan's
 * own lead. The first free start a refusal names is at least this long past the 2-hour floor, so the next plan still
 * finds it 2 hours ahead when its create runs.
 */
export function nextPlanLeadMs(s: { tickMinutes: number; tickJitterMinutes: number }): number {
  return (s.tickMinutes * PLAN_WINDOW_SHARE + s.tickMinutes + s.tickJitterMinutes) * MINUTE + planLeadMs(s.tickMinutes)
}

/** A moment rounded up, or down, to the whole minute. */
export const ceilMinute = (t: number): number => Math.ceil(t / MINUTE) * MINUTE
export const floorMinute = (t: number): number => Math.floor(t / MINUTE) * MINUTE

/**
 * The first whole minute from `minAhead` to `maxAhead` after now (the create action's range: 2 hours to 30 days) whose
 * window is free, in ms; null when none is. Each window refuses the starts strictly between its start less the new
 * window's length after the kickoff and its end plus the hour before it, so the first free minute is the first one of
 * the range or the first minute at or after such an end (FoxLeague's `free_starts`, tournament_slots.rs). A refusal
 * asks from 2 hours plus the next plan's lead (nextPlanLeadMs): a free stretch that ends before a start that late fits
 * is passed over, never named.
 */
export function firstFreeStart(windows: SlotWindow[], format: string, maxTeams: number, homeAndAway: boolean, now: number, minAhead = 2 * 3600_000, maxAhead = 30 * 86_400_000): number | null {
  const lo = ceilMinute(now + minAhead)
  const hi = now + maxAhead
  const candidates = [lo, ...windows.map(w => ceilMinute(w.end + BOOKING_PAD_MS))].filter(t => t >= lo && t <= hi).sort((a, b) => a - b)
  return candidates.find(t => !clash(windows, blockingWindow(format, maxTeams, homeAndAway, t))) ?? null
}

/** Stretches of time no window covers, between two moments, longest first after the first five by time. */
export function freeGaps(windows: SlotWindow[], from: number, to: number): { start: number; end: number }[] {
  const gaps: { start: number; end: number }[] = []
  let cursor = from
  for (const w of windows) {
    if (w.end <= cursor) continue
    if (w.start > cursor) gaps.push({ start: cursor, end: Math.min(w.start, to) })
    cursor = Math.max(cursor, w.end)
    if (cursor >= to) break
  }
  if (cursor < to) gaps.push({ start: cursor, end: to })
  return gaps.filter(g => g.end > g.start)
}
