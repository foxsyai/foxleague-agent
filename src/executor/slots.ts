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

export function blockingWindow(format: string, maxTeams: number, homeAndAway: boolean, startsAt: number): { start: number; end: number } {
  return { start: startsAt - 3600_000, end: startsAt + estimateMinutes(format, maxTeams, format === 'round_robin' && homeAndAway) * 60_000 + 3600_000 }
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

/** The first whole number of hours from now (within the create action's range) whose window is free. */
export function firstFreeStartHours(windows: SlotWindow[], format: string, maxTeams: number, homeAndAway: boolean, now: number, minH = 2, maxH = 72): number | null {
  for (let h = minH; h <= maxH; h++) {
    if (!clash(windows, blockingWindow(format, maxTeams, homeAndAway, now + h * 3600_000))) return h
  }
  return null
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
