// Strategy proposals from the owner's chat with the manager, waiting for Apply (a Telegram button or
// the web UI). Held in memory: a restart drops them, and the owner simply asks again.

import { randomBytes } from 'node:crypto'

export interface Proposal {
  id: string
  agents: number[]
  strategy: string
  changes: string
  source: string
  at: number
}

const TTL_MS = 24 * 3600_000

export class Proposals {
  private readonly open = new Map<string, Proposal>()

  add(p: Omit<Proposal, 'id' | 'at'>, now = Date.now()): Proposal {
    for (const [id, q] of this.open) if (now - q.at > TTL_MS) this.open.delete(id)
    const proposal: Proposal = { ...p, id: randomBytes(4).toString('hex'), at: now }
    this.open.set(proposal.id, proposal)
    return proposal
  }

  /** Removes and returns an open proposal: each one is applied or dropped once, from either channel. */
  take(id: string, now = Date.now()): Proposal | undefined {
    const p = this.open.get(id)
    this.open.delete(id)
    return p && now - p.at <= TTL_MS ? p : undefined
  }
}
