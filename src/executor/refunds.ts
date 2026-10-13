// Bids that came back. A bid's FOXSY is booked when it is placed (tag bid:<nonce>); when a rival outbids
// the agent the contract refunds it at once, and when the auction ends someone else's the money never
// left. Checked at the start of every tick against the chain, so a rival cannot burn the agent's daily
// budget with bids that are refunded. Entries left or refunded are credited by the executor itself.
//
// Only the chain decides: the auction's top bidder while it runs, the wallet's own cards once it is
// settled. A won bid is closed (bid:<nonce>:won) so a later state of the same card (the agent listing
// it, an API lag) can never credit money that really left. A bid younger than a few minutes may still
// be in flight and is left alone; dry-run bids never reached the chain and always keep counting. Right
// after the settlement the card may still be crossing to the agent's shard: FoxLeague naming the agent
// as its owner closes the bid as won, and otherwise it is credited only once the card stayed out of the
// wallet for ten minutes after the settled auction was first seen (an unreadable owner keeps counting).
// A card FoxLeague no longer knows ("Player not found": it deletes cards burned in a fusion) counts like
// another owner, unless the agent's own log holds a fusion of it. The agent's own live auction of the
// card means it won the bid and listed the card again before the won-close ran.
//
// Seats and stakes too (tag join:<tournament>): FoxLeague refunds them by itself when a tournament or a
// 1v1 is cancelled for not filling. Credited once the tournament is cancelled and the contract holds no
// entry for the agent any more; a finished tournament's seat is closed (it was really spent) once the
// contract holds nothing for the agent, so a seat it still holds can still be claimed and credited. A
// finished tournament the agent never sat in (FoxLeague refunded a seat it could not give) is credited;
// one whose detail cannot tell keeps counting.

import { Address } from '@multiversx/sdk-core'
import { MAINNET } from '../config.ts'
import { getAuction } from '../chain/players.ts'
import type { Chain } from '../chain/gateway.ts'
import { ApiRefusal, type FoxLeague } from '../foxleague/api.ts'
import type { TournamentDetail } from '../foxleague/types.ts'
import type { AgentRow, Store } from '../store/db.ts'
import type { AgentWallet } from '../wallet/wallet.ts'
import { b64ToBigInt, u64Hex } from '../util/encoding.ts'

export interface RefundDeps {
  store: Store
  chain: Pick<Chain, 'query' | 'esdts'>
  fox?: Pick<FoxLeague, 'tournament' | 'player'>
  /** The agent's wallet: the tournament detail read with it says whether this team sat in it (user_is_participant). */
  wallet?: AgentWallet
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
  /**
   * The card's owner as FoxLeague names it, or null when FoxLeague no longer knows the card (it deletes a card burned
   * in a fusion; its answer is "Player not found"). Throws when it cannot be read (no answer, a 5xx, no owner).
   */
  const ownerOf = async (nonce: number): Promise<string | null> => {
    if (!d.fox?.player) throw new Error('owner unreadable')
    let owner: unknown
    try {
      owner = (await d.fox.player(nonce)).owner_address
    } catch (err) {
      if (err instanceof ApiRefusal && /not found/i.test(err.message)) return null
      throw err
    }
    if (typeof owner !== 'string' || !owner) throw new Error('owner unreadable')
    return owner
  }
  /** The agent's own fusion of this card since the bid: 'confirmed', 'maybe' (sent, outcome unknown) or null. */
  const ownFusion = (nonce: number, since: string): 'confirmed' | 'maybe' | null => {
    let found: 'confirmed' | 'maybe' | null = null
    for (const r of d.store.activityOf(agent.index, ['fuse'], new Date(since))) {
      let detail: { sent?: boolean; action?: { player_nonces?: unknown } }
      try {
        detail = JSON.parse(r.detail ?? '{}') as typeof detail
      } catch {
        detail = {}
      }
      if (!Array.isArray(detail.action?.player_nonces) || !detail.action.player_nonces.includes(nonce)) continue
      if (r.status === 'confirmed') return 'confirmed'
      if (r.status === 'unconfirmed' || r.status === 'sent' || detail.sent === true) found = 'maybe'
    }
    return found
  }
  // Settled auctions whose card was not in the wallet: nonce -> first sighting (ms), kept across ticks.
  const goneKey = `bid_gone:${agent.index}`
  let gone: Record<string, number> = {}
  try {
    gone = JSON.parse(d.store.getKv(goneKey) ?? '{}') as Record<string, number>
  } catch {
    gone = {}
  }
  const goneBefore = JSON.stringify(gone)
  for (const [nonce, rows] of byNonce) {
    const latest = rows[rows.length - 1]!
    if (!latest.txHash || now - new Date(latest.at).getTime() < SETTLE_MS) continue
    // Only the latest bid can still stand; the agent never outbids itself, so older ones were refunded.
    let standing: boolean
    try {
      const auction = await getAuction(d.chain as Chain, nonce)
      let owner: string | null | undefined
      if (auction && auction.seller === agent.address) {
        // The agent's own auction of the card: it won the bid and listed the card again before the won-close ran.
        d.store.closeSpend(latest.id, 'won')
        standing = true
      } else if (auction) standing = auction.highestBidder === agent.address
      else if (await holds(nonce)) {
        // Settled and the card is in the wallet: the agent won; that bid stays counted for good.
        d.store.closeSpend(latest.id, 'won')
        standing = true
      } else if ((owner = await ownerOf(nonce)) === agent.address) {
        // Settled, and FoxLeague already names the agent as the owner: the card is still crossing from the
        // contract's shard. Won, so it stays counted for good.
        d.store.closeSpend(latest.id, 'won')
        standing = true
      } else if (owner === null && ownFusion(nonce, latest.at) === 'confirmed') {
        // FoxLeague no longer knows the card because the agent itself burned it in a fusion: it had won the bid.
        d.store.closeSpend(latest.id, 'won')
        standing = true
      } else {
        // A fusion of it the agent sent whose outcome is unknown: it may have won and burned the card. Asked again.
        if (owner === null && ownFusion(nonce, latest.at) === 'maybe') continue
        // Someone else won (and may have burned the card since), or FoxLeague still names the seller while the card
        // is in flight to the agent: credited only once the card stayed out of the wallet for SETTLE_MS after the
        // settled auction was first seen.
        const first = gone[nonce]
        if (first === undefined) gone[nonce] = now
        if (first === undefined || now - first < SETTLE_MS) continue
        standing = false
      }
    } catch {
      continue // unknown (the auction, the wallet or the owner unreadable): keep counting (the safe side)
    }
    delete gone[nonce]
    for (const r of rows) {
      if (standing && r === latest) continue
      d.store.creditSpend(r.id)
      credited++
    }
  }
  for (const k of Object.keys(gone)) if (!byNonce.has(Number(k))) delete gone[k]
  if (JSON.stringify(gone) !== goneBefore) d.store.setKv(goneKey, JSON.stringify(gone))
  if (d.fox) credited += await creditCancelledEntries({ ...d, fox: d.fox }, agent, now)
  return credited
}

/**
 * Whether the agent sat in a tournament, from its detail: true, false, or null when the detail cannot tell. A seat
 * is recognised by the agent's wallet or its FoxLeague user id (noted by every snapshot) among the participants, or
 * by user_is_participant; "not seated" needs the user id (the participants carry it) or a detail read with the
 * agent's wallet (only then is user_is_participant about this team).
 */
function seatedIn(d: TournamentDetail, agent: AgentRow, userId: number | null, withWallet: boolean): boolean | null {
  if (d.user_is_participant === true) return true
  if (d.participants.some(p => p.wallet_address === agent.address || (userId !== null && p.user_id === userId))) return true
  if (withWallet && d.user_is_participant === false) return false
  return userId !== null ? false : null
}

async function creditCancelledEntries(d: RefundDeps & { fox: Pick<FoxLeague, 'tournament'> }, agent: AgentRow, now: number): Promise<number> {
  let credited = 0
  const noted = Number(d.store.getKv(`agent_user_id:${agent.index}`))
  const userId = Number.isInteger(noted) && noted > 0 ? noted : null
  for (const r of d.store.openSpend(agent.index, 'join:', false)) {
    const m = /^join:(\d+)$/.exec(r.action)
    if (!m || now - new Date(r.at).getTime() < SETTLE_MS) continue
    try {
      const detail = await d.fox.tournament(Number(m[1]), d.wallet)
      const t = detail.tournament
      if (t.status !== 'completed' && t.status !== 'cancelled') continue
      const [amount] = await d.chain.query(MAINNET.tournamentsContract, 'getEntryAmount', [u64Hex(t.sc_tournament_id ?? t.id), Address.newFromBech32(agent.address).toHex()])
      // Still held by the contract (an unseated escrow, a refund not sent yet): a claim_refund gets it back and credits it.
      if (b64ToBigInt(amount) !== 0n) continue
      if (t.status === 'completed') {
        // Seated: played, so really spent, never looked at again. Never seated (a join gate after the payment, the
        // 15-minute sweep): FoxLeague refunded the entry, credited below. Unknown: keeps counting, asked next tick.
        const sat = seatedIn(detail, agent, userId, Boolean(d.wallet))
        if (sat === null) continue
        if (sat) {
          d.store.closeSpend(r.id, 'played')
          continue
        }
      }
      d.store.creditSpend(r.id)
      credited++
    } catch {
      // unknown: keeps counting
    }
  }
  return credited
}
