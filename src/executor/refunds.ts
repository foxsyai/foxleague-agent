// Bids that came back. A bid's FOXSY is booked when it is placed (tag bid:<nonce>); when a rival outbids
// the agent the contract refunds it at once, and when the auction ends someone else's the money never
// left. Checked at the start of every tick against the chain, so a rival cannot burn the agent's daily
// budget with bids that are refunded. Entries left or refunded are credited by the executor itself.
//
// Only the chain decides: the auction's top bidder while it runs, the wallet's own cards once it is
// settled. A won bid is closed (bid:<nonce>:won) so a later state of the same card (the agent listing
// it, an API lag) can never credit money that really left. A bid younger than a few minutes may still
// be in flight and is left alone; dry-run bids never reached the chain and always keep counting.
//
// Seats and stakes too (tag join:<tournament>): FoxLeague refunds them by itself when a tournament or a
// 1v1 is cancelled for not filling. Credited once the tournament is cancelled and the contract holds no
// entry for the agent any more; a finished tournament's seat is closed (it was really spent) once the
// contract holds nothing for the agent, so a seat it still holds can still be claimed and credited.

import { Address } from '@multiversx/sdk-core'
import { MAINNET } from '../config.ts'
import { getAuction } from '../chain/players.ts'
import type { Chain } from '../chain/gateway.ts'
import type { FoxLeague } from '../foxleague/api.ts'
import type { AgentRow, Store } from '../store/db.ts'
import { b64ToBigInt, u64Hex } from '../util/encoding.ts'

export interface RefundDeps {
  store: Store
  chain: Pick<Chain, 'query' | 'esdts'>
  fox?: Pick<FoxLeague, 'tournament'>
}

/** A bid this young may still be between its signature and its outcome (the executor waits up to 2 min). */
const SETTLE_MS = 10 * 60_000

export async function creditRefunds(d: RefundDeps, agent: AgentRow, dryRun: boolean, now = Date.now()): Promise<number> {
  if (dryRun) return 0
  const byNonce = new Map<number, { id: number; at: string; txHash: string | null }[]>()
  for (const r of d.store.openSpend(agent.index, 'bid:', dryRun)) {
    const m = /^bid:(\d+)$/.exec(r.action)
    if (!m) continue
    const list = byNonce.get(Number(m[1])) ?? []
    list.push(r)
    byNonce.set(Number(m[1]), list)
  }
  let credited = 0
  let holdings: Set<number> | null | undefined
  const holds = async (nonce: number): Promise<boolean> => {
    if (holdings === undefined) {
      try {
        const all = await d.chain.esdts(agent.address)
        holdings = new Set(all.filter(h => h.tokenIdentifier.startsWith(MAINNET.playerCollection) && h.balance > 0n).map(h => h.nonce))
      } catch {
        holdings = null
      }
    }
    if (holdings === null) throw new Error('holdings unreadable')
    return holdings.has(nonce)
  }
  for (const [nonce, rows] of byNonce) {
    const latest = rows[rows.length - 1]!
    if (!latest.txHash || now - new Date(latest.at).getTime() < SETTLE_MS) continue
    // Only the latest bid can still stand; the agent never outbids itself, so older ones were refunded.
    let standing: boolean
    try {
      const auction = await getAuction(d.chain as Chain, nonce)
      if (auction) standing = auction.highestBidder === agent.address
      else if (await holds(nonce)) {
        // Settled and the card is in the wallet: the agent won; that bid stays counted for good.
        d.store.closeSpend(latest.id, 'won')
        standing = true
      } else standing = false
    } catch {
      continue // unknown: keep counting (the safe side)
    }
    for (const r of rows) {
      if (standing && r === latest) continue
      d.store.creditSpend(r.id)
      credited++
    }
  }
  if (d.fox) credited += await creditCancelledEntries({ ...d, fox: d.fox }, agent, now)
  return credited
}

async function creditCancelledEntries(d: RefundDeps & { fox: Pick<FoxLeague, 'tournament'> }, agent: AgentRow, now: number): Promise<number> {
  let credited = 0
  for (const r of d.store.openSpend(agent.index, 'join:', false)) {
    const m = /^join:(\d+)$/.exec(r.action)
    if (!m || now - new Date(r.at).getTime() < SETTLE_MS) continue
    try {
      const t = (await d.fox.tournament(Number(m[1]))).tournament
      if (t.status !== 'completed' && t.status !== 'cancelled') continue
      const [amount] = await d.chain.query(MAINNET.tournamentsContract, 'getEntryAmount', [u64Hex(t.sc_tournament_id ?? t.id), Address.newFromBech32(agent.address).toHex()])
      // Still held by the contract (an unseated escrow, a refund not sent yet): a claim_refund gets it back and credits it.
      if (b64ToBigInt(amount) !== 0n) continue
      if (t.status === 'completed') {
        d.store.closeSpend(r.id, 'played') // played, so really spent: never looked at again
        continue
      }
      d.store.creditSpend(r.id)
      credited++
    } catch {
      // unknown: keeps counting
    }
  }
  return credited
}
