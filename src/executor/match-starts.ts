// When the agent last started a casual or ranked match, from its own log (FoxLeague's cooldowns are not public). The
// executor's play_match check and the service's scheduling of a plan's matches both read it here (audit 2026-10-23, D1).

import type { ActivityRow, Store } from '../store/db.ts'

/**
 * A start that may have happened: confirmed or simulated, a casual test whose start went through although putting the
 * team's formation back did not, or an answer lost on the way whose read-back failed too (audit 2026-11-04, INPUT-2 and
 * MONEY-2). Unknown is not "none": the cooldowns and the daily casual count read the same rows.
 */
export function maybeStarted(r: ActivityRow): boolean {
  return r.status === 'confirmed' || r.status === 'dry_run' || /: match #\d+ started \((casual|ranked)\)/.test(r.summary) || (r.status === 'error' && /"startUnknown":true/.test(r.detail ?? ''))
}

/** The agent's last casual or ranked start and its last ranked one, in the last 24 hours (null: none). */
export function lastMatchStarts(store: Store, agentIndex: number, now: Date): { match: Date | null; ranked: Date | null } {
  const recent = store.activityOf(agentIndex, ['play_match'], new Date(now.getTime() - 86_400_000)).filter(maybeStarted)
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

/** Casual games this agent started since `since`, from its own log, every start that may have happened (maybeStarted). */
export function casualStartsSince(store: Store, agentIndex: number, since: Date): number {
  return store
    .activityOf(agentIndex, ['play_match'], since)
    .filter(r => r.summary.includes('play casual match') && maybeStarted(r)).length
}
