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
  notify: (text: string) => void
}

const ABANDON_AFTER_MIN = 25

export async function retryPendingPayments(d: PendingDeps, agentIndex: number, wallet: AgentWallet, now = Date.now()): Promise<void> {
  for (const p of d.store.pending(agentIndex)) {
    const ageMin = (now - new Date(p.sentAt).getTime()) / 60_000
    if (p.kind !== 'shop' && p.kind !== 'join') continue
    if (ageMin > ABANDON_AFTER_MIN) {
      d.store.resolvePending(p.hash, 'abandoned')
      d.notify(`${agentName(agentIndex)}: ${p.kind === 'shop' ? 'shop payment' : 'tournament seat payment'} ${p.hash} was never confirmed; FoxLeague refunds it automatically`)
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
      if (p.kind === 'shop' && /already processed|refunded|cannot be used/i.test(msg)) d.store.resolvePending(p.hash, 'done')
      // "not open for registration": the tournament closed before the seat; FoxLeague refunds a paid entry (2026-10-07).
      if (p.kind === 'join' && /already|Do NOT pay again|refunded|not open for registration/i.test(msg)) d.store.resolvePending(p.hash, 'done')
    }
  }
}
