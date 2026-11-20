// What of a plan can only run on the next game day, read from the snapshot the plan was made from (RESET-1, 18 and
// 19 Nov 2026): a plan made just before FoxLeague's daily reset (14:00 UTC) with the day's training sessions or match
// starts used up is right, but its actions ran at random moments of the window, before the reset, and were refused.
// It only picks the moment an action runs (scheduleActions in service.ts), like deadlines.ts; the executor still checks
// everything against a fresh snapshot when the action runs, and nothing here lets an action skip a check.

import type { PlannedAction } from './actions.ts'
import { gameDayStart } from './match-starts.ts'
import { matchDayRefusal, trainingDayRefusal, type TrainingQuota } from './rules.ts'
import type { AgentSnapshot } from '../snapshot/snapshot.ts'
import type { AgentSettings } from '../store/settings.ts'

/**
 * How long after the reset such an action waits. FoxLeague counts the day's sessions and starts at each request from
 * the reset hour (shop.rs `used_today`, matches.rs `DAILY_MATCH_COUNT_SQL`), so a read that starts after the reset sees
 * the new day. But the snapshot an action is checked against is read when its moment comes and takes seconds to tens
 * of seconds: on 19 Nov agent 9's training was refused at 14:00:04 against counts read just before 14:00. Two minutes
 * cover that read, the clocks of the two servers and an action before it that runs long, and cost the plan little.
 */
export const RESET_MARGIN_MS = 2 * 60_000

/** An action held for the new game day: from when it may run (ms since the epoch) and why, for the line of a drop. */
export interface NewDayHold {
  at: number
  why: string
}

/**
 * Per action of the plan, in its order: the hold when by the plan's snapshot it can only run on the next game day, else
 * null. The plan's own earlier actions count: a training or a match start the day still has room for uses it, so the
 * next one may find the day full. The counts the executor refuses on are read with its own rules (trainingDayRefusal,
 * matchDayRefusal); a count that could not be read holds nothing (the executor refuses it on a fresh read). The reset is
 * the first after the snapshot was read: a plan whose snapshot is of the new day already holds to the reset after it.
 */
export function newDayHolds(actions: PlannedAction[], snap: AgentSnapshot | undefined, settings: Pick<AgentSettings, 'paidTrainingPerDay'>): (NewDayHold | null)[] {
  const none = actions.map(() => null)
  if (!snap) return none
  const taken = Date.parse(snap.takenAt)
  const hour = snap.gameDay?.resetHourUtc
  if (!Number.isFinite(taken) || typeof hour !== 'number' || !Number.isInteger(hour) || hour < 0 || hour > 23) return none
  const reset = gameDayStart(new Date(taken), hour).getTime() + 86_400_000
  const at = reset + RESET_MARGIN_MS
  const day = `the wait for the new game day at ${String(hour).padStart(2, '0')}:00 UTC`
  const read = snap.auth?.shop?.training
  const t: TrainingQuota | null = read ? { ...read } : null
  const al = snap.auth?.allowance ? { ...snap.auth.allowance } : null
  return actions.map(p => {
    const a = p.action
    if (a.type === 'train' && t) {
      const full = trainingDayRefusal(t, settings.paidTrainingPerDay)
      if (full) return { at, why: `${day} (this one's ${full.startsWith('daily training exhausted') ? `training sessions are used up: ${t.used_today} used, ${t.slots_banked} paid slots banked` : full})` }
      // The session it takes, as the executor counts one that ran (applyEffect): a paid one uses a banked slot.
      if (t.used_today >= t.daily_free) {
        t.premium_used_today++
        t.slots_banked--
      }
      t.used_today++
    }
    if (a.type === 'play_match' && al) {
      if (matchDayRefusal(al)) return { at, why: `${day} (this one's match starts are used up: ${al.today_count} of ${al.daily_limit})` }
      al.today_count++
    }
    return null
  })
}
