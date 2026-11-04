// When the agent last started a casual or ranked match, from its own log (FoxLeague's cooldowns are not public). The
// executor's play_match check and the service's scheduling of a plan's matches both read it here (audit 2026-10-23, D1).

import type { Store } from '../store/db.ts'

/** The agent's last casual or ranked start and its last ranked one, in the last 24 hours (null: none). */
export function lastMatchStarts(store: Store, agentIndex: number, now: Date): { match: Date | null; ranked: Date | null } {
  const recent = store.activityOf(agentIndex, ['play_match'], new Date(now.getTime() - 86_400_000)).filter(r => r.status === 'confirmed' || r.status === 'dry_run')
  const lastMatch = recent[0]
  const lastRanked = recent.find(r => r.summary.includes('ranked'))
  return { match: lastMatch ? new Date(lastMatch.at) : null, ranked: lastRanked ? new Date(lastRanked.at) : null }
}

/** When the current game day began: the last reset hour (UTC) at or before `now`. */
export function gameDayStart(now: Date, resetHourUtc: number): Date {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), resetHourUtc))
  if (start > now) start.setUTCDate(start.getUTCDate() - 1)
  return start
}

/**
 * Casual games this agent started since `since`, from its own log: confirmed and simulated starts, and a test whose
 * start went through although putting the team's formation back did not (it counts in FoxLeague's allowance too).
 */
export function casualStartsSince(store: Store, agentIndex: number, since: Date): number {
  return store
    .activityOf(agentIndex, ['play_match'], since)
    .filter(r => r.summary.includes('play casual match') && (r.status === 'confirmed' || r.status === 'dry_run' || r.summary.includes('started (casual)'))).length
}
