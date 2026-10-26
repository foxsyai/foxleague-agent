// The 1v1 counts (and the agent's own creations) the rules read from the activity log, in one place: the executor's
// checks and the plan request both call these, so the plan is told exactly what the rule will count (audit 2026-10-23, D2).

import type { ActivityRow, Store } from '../store/db.ts'

/** The 1v1 kinds whose rows name the opponent (detail.opponentUserId, written by the executor). */
const ONE_V_ONE_KINDS = ['join_tournament', 'create_challenge']
const WEEK_MS = 7 * 86_400_000
/** How far back the owner's other agents' 1v1s are read: the longest deadline (240 min) plus the match hour, and more. */
const OTHERS_MS = 6 * 3_600_000

/** How far back the owner's other agents' bids are read: an auction runs 24 hours, and more. */
const BIDS_MS = 48 * 3_600_000

/** How far back the agent's own creates are read: a tournament starts at most 72 hours after it is created, and more. */
const CREATED_MS = 7 * 86_400_000

/** Activity of the same ledger (dry run or live) the action is judged in. */
const counted = (dry: boolean, status: string) => (dry ? status === 'dry_run' : status === 'confirmed' || status === 'unconfirmed')

function detailOf(r: ActivityRow): { opponentUserId?: number; untouched?: boolean; sent?: boolean; createdTournamentId?: number; byOwner?: boolean; reason?: string; action?: { deadline_minutes?: number; nonce?: number } } {
  try {
    return JSON.parse(r.detail ?? '{}') as { opponentUserId?: number; untouched?: boolean; sent?: boolean; createdTournamentId?: number; byOwner?: boolean; reason?: string; action?: { deadline_minutes?: number; nonce?: number } }
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
 * Per rival: the 1v1s the owner's other agents have out against it, retired and removed agents too (a 1v1 stays out
 * after its team is parked; audit A2). A 1v1 of theirs is out until its deadline (a join: at once) and an hour for the
 * match have passed. On the safe side, a create that failed or errored may have left a challenge, unless the error came
 * before FoxLeague was asked or anything was signed (`untouched`, audit A1).
 */
export function rivalsOutByOthers(store: Store, agentIndex: number, dry: boolean, now: Date): Map<number, number> {
  const out = new Map<number, number>()
  const rows = store
    .agentIndexes()
    .filter(i => i !== agentIndex)
    .flatMap(i => store.activityOf(i, ONE_V_ONE_KINDS, new Date(now.getTime() - OTHERS_MS)))
  for (const r of rows) {
    const d = detailOf(r)
    if (!(counted(dry, r.status) || r.status === 'failed' || (r.status === 'error' && !d.untouched)) || typeof d.opponentUserId !== 'number') continue
    if (Date.parse(r.at) + ((d.action?.deadline_minutes ?? 0) + 60) * 60_000 <= now.getTime()) continue
    out.set(d.opponentUserId, (out.get(d.opponentUserId) ?? 0) + 1)
  }
  return out
}

/**
 * The cards at auction the owner's other agents have bid on in the last 48 hours, retired and removed agents too: one
 * team per card, so the owner never bids against their own bid (owner, 2026-10-23). On the safe side, a bid that errored
 * after its signature may have landed; a refused, reverted or unsigned one placed nothing.
 */
export function cardsBidByOthers(store: Store, agentIndex: number, dry: boolean, now: Date): Set<number> {
  const out = new Set<number>()
  const rows = store
    .agentIndexes()
    .filter(i => i !== agentIndex)
    .flatMap(i => store.activityOf(i, ['bid'], new Date(now.getTime() - BIDS_MS)))
  for (const r of rows) {
    const d = detailOf(r)
    if (!(counted(dry, r.status) || r.status === 'sent' || (r.status === 'error' && d.sent === true)) || typeof d.action?.nonce !== 'number') continue
    out.add(d.action.nonce)
  }
  return out
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
