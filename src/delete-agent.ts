// Delete, for an agent whose wallet was never used: no transaction, nothing in it, no FoxLeague team. Such a wallet is
// just a number of the recovery words, so the agent goes for good (row, history, PEM file) and + Add agent can make
// the same wallet again. Anything used is retired instead, never deleted.

import type { Chain } from './chain/gateway.ts'
import type { FoxLeague } from './foxleague/api.ts'
import type { AgentRow, Store } from './store/db.ts'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { agentName, pemName } from './names.ts'
import { formatAtomic } from './util/encoding.ts'

export interface DeleteDeps {
  store: Store
  chain: Pick<Chain, 'account' | 'esdts'>
  fox: Pick<FoxLeague, 'user'>
  topups?: { waitingFor(agentIndex: number): boolean }
  /** AGENT_COUNT: the agents below it are created again at every start, so they are not deleted. */
  agentCount: number
}

/**
 * The agent when its wallet is untouched, read fresh from the chain and FoxLeague; otherwise an error that says why
 * (and to retire it instead). A read that fails refuses too: unknown is not empty.
 */
export async function neverUsedOrWhy(d: DeleteDeps, index: number): Promise<AgentRow> {
  const name = agentName(index)
  const agent = d.store.agent(index)
  if (!agent) throw new Error(`no ${name}`)
  if (agent.source === 'imported') throw new Error(`${name} is an imported team: use Remove`)
  if (index < d.agentCount) throw new Error(`${name} is one of the first ${d.agentCount} (AGENT_COUNT), which come back at every start: lower AGENT_COUNT first`)
  if (d.store.everUsed(index)) throw new Error(`${name} has signed transactions before: retire it instead`)
  if (d.store.pending(index).length) throw new Error(`${name} has a payment waiting for FoxLeague's confirmation: retire it instead`)
  if (d.topups?.waitingFor(index)) throw new Error(`${name} has a Binance top-up waiting: let it arrive or expire first`)
  let read: [Awaited<ReturnType<Chain['account']>>, Awaited<ReturnType<Chain['esdts']>>, Awaited<ReturnType<FoxLeague['user']>>]
  try {
    read = await Promise.all([d.chain.account(agent.address), d.chain.esdts(agent.address), d.fox.user(agent.address)])
  } catch (err) {
    throw new Error(`${name}: the wallet could not be read (${err instanceof Error ? err.message : String(err)}), so nothing was deleted; try again in a minute`)
  }
  const [account, esdts, profile] = read
  if (account.nonce !== 0) throw new Error(`${name}'s wallet has sent ${account.nonce} transaction${account.nonce === 1 ? '' : 's'}: retire it instead`)
  if (account.balance !== 0n) throw new Error(`${name}'s wallet holds ${formatAtomic(account.balance, 4)} EGLD: retire it instead`)
  if (esdts.length) throw new Error(`${name}'s wallet holds tokens or cards (${esdts.length}): retire it instead`)
  if (profile?.team_name) throw new Error(`${name} has the FoxLeague team "${profile.team_name}": retire it instead`)
  return agent
}

/**
 * The PEM file of a deleted agent (pem/agentN.pem on the owner's computer) goes too, but only once its first line
 * names that wallet: a file of other words or another wallet is kept.
 */
export function removePemFile(dir: string, index: number, address: string): 'deleted' | 'kept' | 'none' {
  const file = join(dir, pemName(index))
  if (!existsSync(file)) return 'none'
  if (!(readFileSync(file, 'utf8').split('\n', 1)[0] ?? '').includes(address)) return 'kept'
  rmSync(file)
  return 'deleted'
}
