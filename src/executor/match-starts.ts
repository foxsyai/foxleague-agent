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
