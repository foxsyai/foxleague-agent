// The team badge. A team registered without one looks anonymous, so the first cycle that finds no badge
// generates FoxLeague's free AI badge and saves it: once per agent, never paid for. FoxLeague gives the
// first 3 generations after registration for free and asks 1,000 FOXSY after that; a payment request
// stops the step for good. A badge the owner picks in the app is never replaced.

import { ApiRefusal, type FoxLeague } from '../foxleague/api.ts'
import type { Team } from '../foxleague/types.ts'
import type { Store } from '../store/db.ts'
import { agentName } from '../names.ts'
import type { AgentWallet } from '../wallet/wallet.ts'

export interface BadgeDeps {
  store: Store
  fox: Pick<FoxLeague, 'generateBadge' | 'saveBadge'>
  notify: (text: string) => void
}

const MAX_TRIES = 5

export async function ensureBadge(d: BadgeDeps, agentIndex: number, wallet: AgentWallet, team: Team | null, dryRun: boolean): Promise<void> {
  if (!team || team.badge || team.badge_ipfs_uri) return
  const key = (k: string) => `badge_${k}:${agentIndex}`
  if (d.store.getKv(key('done')) || d.store.getKv(key('stop'))) return
  const log = (status: 'confirmed' | 'refused' | 'failed' | 'info' | 'dry_run', summary: string) => d.store.log({ agentIndex, kind: 'badge', status, summary })
  if (dryRun) {
    if (!d.store.getKv(key('dry'))) {
      d.store.setKv(key('dry'), '1')
      log('dry_run', 'team badge: none yet; live, the agent generates the free one')
    }
    return
  }
  // A badge generated earlier but not saved is saved again, never generated twice.
  let uri = d.store.getKv(key('uri'))
  try {
    if (!uri) {
      const r = await d.fox.generateBadge(wallet, team.name)
      if (typeof r?.badge_ipfs_uri !== 'string' || !/^ipfs:\/\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(r.badge_ipfs_uri)) throw new Error('the badge answer has no ipfs:// address')
      uri = r.badge_ipfs_uri
      d.store.setKv(key('uri'), uri)
    }
    await d.fox.saveBadge(wallet, uri)
    d.store.setKv(key('done'), '1')
    log('confirmed', `team badge generated and saved (free): ${uri}`)
    d.notify(`${agentName(agentIndex)}: "${team.name}" now has its team badge`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const data = err instanceof ApiRefusal ? (err.data as { payment_required?: boolean; cost_foxsy?: number } | undefined) : undefined
    if (data?.payment_required) {
      d.store.setKv(key('stop'), 'payment required')
      log('refused', `team badge: the free generations are used up; a new one costs ${data.cost_foxsy ?? 1000} FOXSY and the agent does not buy it`)
      d.notify(`${agentName(agentIndex)}: no free team badge left (the next one costs ${data.cost_foxsy ?? 1000} FOXSY); pick one in the FoxLeague app if you want it`)
      return
    }
    const tries = Number(d.store.getKv(key('tries')) ?? 0) + 1
    d.store.setKv(key('tries'), String(tries))
    if (tries >= MAX_TRIES) {
      d.store.setKv(key('stop'), 'gave up')
      log('failed', `team badge: gave up after ${tries} tries (${msg})`)
      d.notify(`${agentName(agentIndex)}: gave up on the team badge after ${tries} tries (${msg})`)
    } else {
      log('info', `team badge: ${msg}; trying again next cycle (${tries} of ${MAX_TRIES})`)
    }
  }
}
