// Payments that left the wallet but were not confirmed with FoxLeague yet (a shop confirm that answered
// tx_pending, a tournament seat whose POST /join failed). Confirmed again with the SAME transaction hash, never
// paid again: by the service's own timer about every minute (whatever the active hours, a pause, a retirement or
// the kill switch say, since a confirm signs and pays nothing) and at the start of every tick. FoxLeague's answer
// for a hash it knows is final at any age (used, refunded, already processed), so every row is asked once more
// whatever its age; a row is given up only when the answer is still not final (tx_pending, no answer, an answer of
// unknown meaning) after ABANDON_AFTER_MIN.

import { ApiRefusal, type FoxLeague } from '../foxleague/api.ts'
import type { Store } from '../store/db.ts'
import { agentName } from '../names.ts'
import type { AgentWallet } from '../wallet/wallet.ts'
import { cut } from '../util/text.ts'

export interface PendingDeps {
  store: Store
  fox: Pick<FoxLeague, 'shopConfirm' | 'joinTournament'> & Partial<Pick<FoxLeague, 'buyRankedTicket' | 'buyMedicine'>>
  /** Routine news (a payment confirmed after all). */
  notify: (text: string) => void
  /** A payment given up on: said at once (defaults to notify). */
  alert?: (text: string) => void
}

/**
 * Past FoxLeague's own 30-minute grace for an unconfirmed shop payment and its 5-minute refund sweep
 * (docs/FOXLEAGUE-INTEGRATION.md 12.1), so a payment it refunded is heard as refunded and credited, not given up on
 * first; well past the 60-second pass in which its reconciler seats a paid wallet (10.4).
 */
export const ABANDON_AFTER_MIN = 60

/**
 * FoxLeague's answers for a shop payment it refunded (docs/FOXLEAGUE-INTEGRATION.md 12.1): "This payment was already
 * refunded and cannot be used for a purchase." and the "Your payment is being refunded automatically." it appends to
 * a refusal. Not the timeout's "after that it is refunded automatically" (the payment may still be confirmed), not a
 * refund only queued or left to the support team (nothing came back yet).
 */
export const SHOP_REFUNDED = /already refunded|being refunded automatically/i

/** A final answer for a shop payment's hash: used, refunded or held by FoxLeague's support team. */
export const SHOP_FINAL = /already processed|refunded|cannot be used/i

/**
 * FoxLeague's own answer about an organizer payment's hash or its create, at the start of a create refusal (shop.rs
 * record_organizer_payment_locked and the payment gates before it; tournaments.rs for a creation still pending on
 * chain). A create refusal can quote another player's title (a time slot clash, tournament_slots.rs): a word inside
 * it is no answer about the payment, so SHOP_FINAL is read only after these openings (MON-U7, rule 6).
 */
export const ORGANIZER_HASH_ANSWER = /^(?:Transaction already processed|This payment |This transaction was already used|Our support team is handling this payment|Organizer payments are not in force)/i
export const CREATE_STILL_PENDING = /^On-chain tournament creation could not be confirmed yet/i

/** A final answer for a seat's hash: seated, used, refunded, or the tournament closed (a paid entry is refunded). */
// "Do NOT pay again" is not final: the entry is verified but the seat not recorded yet (tournaments.rs; OPEN-6).
const JOIN_FINAL = /already|refunded|not open for registration/i

/**
 * "Registration deadline has passed": final too, but only as the answer to the ask that carried the payment's hash.
 * FoxLeague's deadline gate (tournaments.rs join_tournament: refund_failed_join(.., join_hash(&req), "deadline_passed")
 * before the refusal) refunds the entry in that same request, or logs it for its orphan reconcile when the refund
 * itself fails; without a hash it refunds nothing (refund_failed_join_with returns at once). The deadline cannot
 * un-pass, so the seat is settled; the ledger row keeps counting until the refund checks see the entry gone
 * (audit 2026-11-11, EDGE-5).
 */
const JOIN_DEADLINE_PASSED = /deadline has passed/i

/** A shop purchase as the executor keeps it with its payment (the pending row's payload). */
export interface ShopOrder { product: string; player_nonces?: number[]; quantity?: number }

/**
 * Confirms a settled shop payment with FoxLeague and answers its words. Medicine has a route of its own
 * (POST /api/shop/medicine; /shop/confirm refuses the product): one card, `quantity` days.
 */
export async function confirmShop(fox: PendingDeps['fox'], wallet: AgentWallet, order: ShopOrder & { tx_hash: string }): Promise<string> {
  if (order.product !== 'medicine') return (await fox.shopConfirm(wallet, order)).message
  if (!fox.buyMedicine) throw new Error('no medicine confirm in this client')
  const nonce = order.player_nonces?.[0]
  if (typeof nonce !== 'number' || typeof order.quantity !== 'number') throw new Error('a medicine payment without its card or its days')
  const r = await fox.buyMedicine(wallet, { player_nonce: nonce, days: order.quantity, tx_hash: order.tx_hash })
  // Numbers and a parsed time only: no raw server text in the activity log.
  const end = Date.parse(String(r?.injured_until))
  return `${order.quantity} day${order.quantity === 1 ? '' : 's'} of medicine for #${nonce}: ${Number.isFinite(end) ? `injured until ${new Date(end).toISOString().slice(0, 16)} UTC now` : 'its new end could not be read'}`
}

/** Credits the FOXSY row (shop:<product>) booked for this payment; true when one was still counting. */
export function creditShopPayment(store: Store, agentIndex: number, hash: string): boolean {
  let credited = false
  for (const r of store.openSpend(agentIndex, 'shop:', false)) {
    if (r.txHash !== hash || !/^shop:[a-z_]+$/.test(r.action)) continue
    store.creditSpend(r.id)
    credited = true
  }
  return credited
}

/** What the owner is told about a payment given up on: what is known, no promise FoxLeague did not make. */
function givenUp(agentIndex: number, p: { hash: string; kind: string; payload: unknown }, ageMin: number, last: string): string {
  const said = `FoxLeague's last answer, ${Math.round(ageMin)} minutes after the payment: "${cut(last, 200)}"`
  if (p.kind === 'shop' || p.kind === 'ranked_ticket') {
    const { product } = p.kind === 'shop' ? (p.payload as { product?: string }) : { product: 'ranked ticket' }
    return `${agentName(agentIndex)}: shop payment ${p.hash} was never confirmed (${product ?? 'unknown product'}). ${said}. FoxLeague returns a shop payment it did not deliver (by itself or through its support team); until the refund is seen its FOXSY keeps counting against the budget.`
  }
  const { tournamentId } = p.payload as { tournamentId?: number }
  return `${agentName(agentIndex)}: tournament seat payment ${p.hash} was never confirmed (T${tournamentId ?? '?'}). ${said}. FoxLeague may still seat the team from its paid entry or refund it; the seat keeps counting against the budget until the tournament shows which.`
}

export async function retryPendingPayments(d: PendingDeps, agentIndex: number, wallet: AgentWallet, now = Date.now()): Promise<void> {
  for (const p of d.store.pending(agentIndex)) {
    // No route confirms an organizer payment: only a create uses it (the executor). Past the window FoxLeague's net has
    // refunded one that stayed unused, and the next create may pay again.
    if (p.kind === 'organizer_fee') {
      if ((now - new Date(p.sentAt).getTime()) / 60_000 > ABANDON_AFTER_MIN) {
        d.store.resolvePending(p.hash, 'abandoned')
        ;(d.alert ?? d.notify)(`${agentName(agentIndex)}: organizer payment ${p.hash} was not used by a create. FoxLeague's unconfirmed-payment net refunds a payment that stays unused; it stays counted against the budget here.`)
      }
      continue
    }
    if (p.kind !== 'shop' && p.kind !== 'join' && p.kind !== 'ranked_ticket') continue
    const ageMin = (now - new Date(p.sentAt).getTime()) / 60_000
    let last: string
    // A seat's last ask carried the payment's hash (the second ask, after "Do NOT pay again", carries none).
    let askedWithHash = true
    try {
      if (p.kind === 'ranked_ticket') {
        if (!d.fox.buyRankedTicket) throw new Error('no ranked ticket confirm in this client')
        await d.fox.buyRankedTicket(wallet, p.hash)
        d.store.resolvePending(p.hash, 'done')
        d.notify(`${agentName(agentIndex)}: pending ranked ticket confirmed`)
      } else if (p.kind === 'shop') {
        // The row's hash is the payment's; rows kept before 2026-11-04 carry it in the payload too.
        const message = await confirmShop(d.fox, wallet, { ...(p.payload as ShopOrder), tx_hash: p.hash })
        d.store.resolvePending(p.hash, 'done')
        d.notify(`${agentName(agentIndex)}: pending shop payment confirmed: ${message}`)
      } else {
        const { tournamentId } = p.payload as { tournamentId: number }
        try {
          await d.fox.joinTournament(wallet, tournamentId, p.hash)
        } catch (err) {
          // The entry is verified and the seat not recorded yet: asked for without the hash, as FoxLeague's app does
          // (paidJoin.ts) and as payAndJoin does; a failure there leaves the row for the next pass (OPEN-6).
          if (!(err instanceof ApiRefusal && /Do NOT pay again/i.test(err.message))) throw err
          askedWithHash = false
          await d.fox.joinTournament(wallet, tournamentId)
        }
        d.store.resolvePending(p.hash, 'done')
        d.notify(`${agentName(agentIndex)}: paid seat in T${tournamentId} confirmed`)
      }
      continue
    } catch (err) {
      last = err instanceof Error ? err.message : String(err)
      // FoxLeague's tx_pending code: the payment is kept and may still be confirmed with this hash, whatever words
      // come with it (its timeout and retry texts say "refunded", "already" and "do not pay again" too).
      // No answer at all (a transport error, a TypeError) is not final either.
      const final = err instanceof ApiRefusal && !err.isTxPending
      if (final && (p.kind === 'shop' || p.kind === 'ranked_ticket') && SHOP_FINAL.test(last)) {
        d.store.resolvePending(p.hash, 'done')
        // FoxLeague's own word that the payment came back (or is on its way back automatically): its FOXSY stops
        // counting against the caps. The gas, booked in its own row, stays. A used payment keeps counting.
        if (SHOP_REFUNDED.test(last) && creditShopPayment(d.store, agentIndex, p.hash)) d.notify(`${agentName(agentIndex)}: shop payment ${p.hash} was refunded by FoxLeague; it no longer counts against the budget`)
        continue
      }
      // "not open for registration": the tournament closed before the seat; FoxLeague refunds a paid entry (2026-10-07).
      // "deadline has passed": the registration closed before the seat; refunded in the request that carried the hash.
      if (final && p.kind === 'join' && (JOIN_FINAL.test(last) || (askedWithHash && JOIN_DEADLINE_PASSED.test(last)))) {
        d.store.resolvePending(p.hash, 'done')
        continue
      }
    }
    // Not final (tx_pending, no answer, an answer of unknown meaning): asked again next time, given up after the window.
    if (ageMin > ABANDON_AFTER_MIN) {
      d.store.resolvePending(p.hash, 'abandoned')
      ;(d.alert ?? d.notify)(givenUp(agentIndex, p, ageMin, last))
    }
  }
}
