// Strategy proposals from the owner's chat with the manager, waiting for Apply (a Telegram button or
// the web UI). Held in memory: a restart drops them, and the owner simply asks again.

import { randomBytes } from 'node:crypto'

/**
 * A message to the manager while it is still answering another one (the owner, 2026-11-13, CO-1): one answer at a time,
 * so a second message from Telegram, another tab or a request made by hand never pays for a second answer meanwhile.
 * Service.discuss throws it; the web route answers it with 409 and Telegram with its text as the reply. It lives here,
 * with the chat's other plain data, so the web server can tell it apart without importing the service.
 */
export class ChatBusyError extends Error {
  constructor() {
    super('The manager is still answering the last message. Send this one when its answer is in.')
    this.name = 'ChatBusyError'
  }
}

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

  /** Drops every open proposal (the owner cleared the conversation they were made in). */
  clear(): void {
    this.open.clear()
  }

  /** True while a proposal can still be applied or dropped. */
  isOpen(id: string, now = Date.now()): boolean {
    const p = this.open.get(id)
    return p !== undefined && now - p.at <= TTL_MS
  }

  /** Removes and returns an open proposal: each one is applied or dropped once, from either channel. */
  take(id: string, now = Date.now()): Proposal | undefined {
    const p = this.open.get(id)
    this.open.delete(id)
    return p && now - p.at <= TTL_MS ? p : undefined
  }
}
