// Payments that left the wallet but were not confirmed with FoxLeague yet (a shop confirm that answered
// tx_pending, a tournament seat whose POST /join failed). Retried at the start of every tick with the
// SAME transaction hash, never paid again; abandoned after 25 minutes, when FoxLeague's own sweep
// refunds what it could not match (shop after 30 min, unseated escrow after 15 min).

import type { FoxLeague } from '../foxleague/api.ts'
import type { Store } from '../store/db.ts'
import { agentName } from '../names.ts'
import type { AgentWallet } from '../wallet/wallet.ts'

export interface PendingDeps {
  store: Store
  fox: Pick<FoxLeague, 'shopConfirm' | 'joinTournament'>
  /** Routine news (a payment confirmed after all). */
  notify: (text: string) => void
  /** A payment given up on: said at once (defaults to notify). */
  alert?: (text: string) => void
}

const ABANDON_AFTER_MIN = 25

/**
 * FoxLeague's answers for a shop payment it refunded (docs/FOXLEAGUE-INTEGRATION.md 12.1): "This payment was already
 * refunded and cannot be used for a purchase." and the "Your payment is being refunded automatically." it appends to
 * a refusal. Not the timeout's "after that it is refunded automatically" (the payment may still be confirmed), not a
 * refund only queued or left to the support team (nothing came back yet).
 */
const SHOP_REFUNDED = /already refunded|being refunded automatically/i

/** Credits the FOXSY row (shop:<product>) booked for this payment; true when one was still counting. */
function creditShopPayment(store: Store, agentIndex: number, hash: string): boolean {
  let credited = false
  for (const r of store.openSpend(agentIndex, 'shop:', false)) {
    if (r.txHash !== hash || !/^shop:[a-z_]+$/.test(r.action)) continue
    store.creditSpend(r.id)
    credited = true
  }
  return credited
}

export async function retryPendingPayments(d: PendingDeps, agentIndex: number, wallet: AgentWallet, now = Date.now()): Promise<void> {
  for (const p of d.store.pending(agentIndex)) {
    const ageMin = (now - new Date(p.sentAt).getTime()) / 60_000
    if (p.kind !== 'shop' && p.kind !== 'join') continue
    if (ageMin > ABANDON_AFTER_MIN) {
      d.store.resolvePending(p.hash, 'abandoned')
      ;(d.alert ?? d.notify)(`${agentName(agentIndex)}: ${p.kind === 'shop' ? 'shop payment' : 'tournament seat payment'} ${p.hash} was never confirmed; FoxLeague refunds it automatically`)
      continue
    }
    try {
      if (p.kind === 'shop') {
        const r = await d.fox.shopConfirm(wallet, p.payload as { tx_hash: string; product: string })
        d.store.resolvePending(p.hash, 'done')
        d.notify(`${agentName(agentIndex)}: pending shop payment confirmed: ${r.message}`)
      } else {
        const { tournamentId } = p.payload as { tournamentId: number }
        await d.fox.joinTournament(wallet, tournamentId, p.hash)
        d.store.resolvePending(p.hash, 'done')
        d.notify(`${agentName(agentIndex)}: paid seat in T${tournamentId} confirmed`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (p.kind === 'shop' && /already processed|refunded|cannot be used/i.test(msg)) {
        d.store.resolvePending(p.hash, 'done')
        // FoxLeague's own word that the payment came back (or is on its way back automatically): its FOXSY stops
        // counting against the caps. The gas, booked in its own row, stays. A used payment keeps counting.
        if (SHOP_REFUNDED.test(msg) && creditShopPayment(d.store, agentIndex, p.hash)) d.notify(`${agentName(agentIndex)}: shop payment ${p.hash} was refunded by FoxLeague; it no longer counts against the budget`)
      }
      // "not open for registration": the tournament closed before the seat; FoxLeague refunds a paid entry (2026-10-07).
      if (p.kind === 'join' && /already|Do NOT pay again|refunded|not open for registration/i.test(msg)) d.store.resolvePending(p.hash, 'done')
    }
  }
}
