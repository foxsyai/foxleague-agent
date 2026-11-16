// The 1v1 counts (and the agent's own creations) the rules read from the activity log, in one place: the executor's
// checks and the plan request both call these, so the plan is told exactly what the rule will count (audit 2026-10-23, D2).

import type { ActivityRow, Store } from '../store/db.ts'

/** The 1v1 kinds whose rows name the opponent (detail.opponentUserId, written by the executor). */
const ONE_V_ONE_KINDS = ['join_tournament', 'create_challenge']
const WEEK_MS = 7 * 86_400_000

/** How far back the agent's own creates are read: a tournament starts at most 72 hours after it is created, and more. */
const CREATED_MS = 7 * 86_400_000

/** Activity of the same ledger (dry run or live) the action is judged in. */
const counted = (dry: boolean, status: string) => (dry ? status === 'dry_run' : status === 'confirmed' || status === 'unconfirmed')

function detailOf(r: ActivityRow): { opponentUserId?: number; createdTournamentId?: number; byOwner?: boolean; reason?: string; action?: { tournament_id?: unknown } } {
  try {
    return JSON.parse(r.detail ?? '{}') as { opponentUserId?: number; createdTournamentId?: number; byOwner?: boolean; reason?: string; action?: { tournament_id?: unknown } }
  } catch {
    return {}
  }
}

/**
 * Per rival (FoxLeague user id): when this agent played or entered a 1v1 against it in the last 7 days, newest first.
 * The rule refuses a third within 7 days (MAX_1V1_PER_OPPONENT_WEEK) on exactly this count. A 1v1 whose stake came back
 * (FoxLeague cancelled it unaccepted, the agent closed it, or it never seated) was never played and does not count
 * (owner, 2026-10-24, audit D11); one still open, played or unknown counts.
 */
export function oneVOnesThisWeek(store: Store, agentIndex: number, dry: boolean, now: Date): Map<number, Date[]> {
  const out = new Map<number, Date[]>()
  const refunded = store.refundedSeatHashes(agentIndex)
  for (const r of store.activityOf(agentIndex, ONE_V_ONE_KINDS, new Date(now.getTime() - WEEK_MS))) {
    const opp = detailOf(r).opponentUserId
    if (!counted(dry, r.status) || typeof opp !== 'number' || (r.txHash && refunded.has(r.txHash))) continue
    out.set(opp, [...(out.get(opp) ?? []), new Date(r.at)])
  }
  return out
}

/** This agent's targeted 1v1s to one rival in the last 7 days (targetedRecord). */
export interface TargetedRecord {
  sent: number
  /** Played, or taken by both teams now (`seated`). */
  accepted: number
  /** When each one it let expire was sent, newest first: its stake came back and this agent did not leave it itself. */
  unanswered: Date[]
}

/**
 * Per rival (FoxLeague user id): the targeted 1v1s this agent sent it in the last 7 days, from its own log and ledger
 * only (audit 2026-11-16, BEH-2 and P-V1; no agent reads another's state). One is unanswered when its stake came back
 * and the agent did not leave it itself (FoxLeague cancelled it unaccepted at its deadline), accepted when its stake
 * was closed as played or `seated` (the tournaments the snapshot shows taken by two teams) holds it. Since D11 an
 * unanswered one no longer counts toward the 2 a week, so without this a rival that let five expire read like one
 * never challenged.
 */
export function targetedRecord(store: Store, agentIndex: number, dry: boolean, now: Date, seated: Set<number> = new Set()): Map<number, TargetedRecord> {
  const out = new Map<number, TargetedRecord>()
  const since = new Date(now.getTime() - WEEK_MS)
  const refunded = store.refundedSeatHashes(agentIndex)
  const played = store.playedSeatHashes(agentIndex)
  const left = new Set<number>()
  for (const r of store.activityOf(agentIndex, ['leave_tournament'], since)) {
    const id = detailOf(r).action?.tournament_id
    if (counted(dry, r.status) && typeof id === 'number') left.add(id)
  }
  for (const r of store.activityOf(agentIndex, ['create_challenge'], since)) {
    const d = detailOf(r)
    const opp = d.opponentUserId
    // The executor names the opponent of a targeted create only: an open challenge has none.
    if (!counted(dry, r.status) || typeof opp !== 'number') continue
    const rec = out.get(opp) ?? { sent: 0, accepted: 0, unanswered: [] }
    rec.sent++
    const created = typeof d.createdTournamentId === 'number' ? d.createdTournamentId : null
    if ((r.txHash && played.has(r.txHash)) || (created !== null && seated.has(created))) rec.accepted++
    else if (r.txHash && refunded.has(r.txHash) && !(created !== null && left.has(created))) rec.unanswered.push(new Date(r.at))
    out.set(opp, rec)
  }
  return out
}

/**
 * When a rival at the weekly limit is free again: the moment enough of its 1v1s (`times`, newest first) are 7 days
 * old that fewer than `limit` remain. Null below the limit.
 */
export function weeklyFreeAt(times: Date[], limit: number): Date | null {
  if (times.length < limit) return null
  const sorted = [...times].sort((a, b) => b.getTime() - a.getTime())
  return new Date(sorted[limit - 1]!.getTime() + WEEK_MS)
}

/**
 * The tournaments and 1v1s this agent created itself in the last 7 days: the id FoxLeague gave a live create (written
 * by the executor), whatever came after it. One the owner asked for (Telegram /do: byOwner, or an owner reason on a row
 * from before it was kept) or made in FoxLeague is the owner's: the agent never widens its range (agent review of PR #38).
 */
export function ownCreations(store: Store, agentIndex: number, now: Date): Set<number> {
  const out = new Set<number>()
  for (const r of store.activityOf(agentIndex, ['create_tournament', 'create_challenge'], new Date(now.getTime() - CREATED_MS))) {
    const d = detailOf(r)
    if (typeof d.createdTournamentId !== 'number' || d.byOwner === true || /^owner\b/i.test(String(d.reason ?? ''))) continue
    out.add(d.createdTournamentId)
  }
  return out
}
