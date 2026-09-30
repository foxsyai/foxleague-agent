// Transaction builders: receiver, data field, value, gas and version exactly as the FoxLeague web
// app signs them (docs/FOXLEAGUE-INTEGRATION.md 1.4, 1.7, 4.4, 5, 7.2, 10.4, 10.7, 12.1).

import { Address, Transaction } from '@multiversx/sdk-core'
import { GAS, MAINNET } from '../config.ts'
import type { PlainTx } from '../chain/gateway.ts'
import { hexOfString, numberToHex, u64Hex, wholeToAtomic } from '../util/encoding.ts'
import { composeTasksEgldToFoxsyData, swapWegldToFoxsyData } from '../chain/xexchange.ts'

export interface TxSpec {
  /** Short label for logs. */
  label: string
  receiver: string
  value: bigint
  data: string
  gasLimit: bigint
  version: 1 | 2
  /** Relayed v3: the relayer address (registration only). */
  relayer?: string
}

export function buildTransaction(spec: TxSpec, sender: string, nonce: number): Transaction {
  return new Transaction({
    sender: Address.newFromBech32(sender),
    receiver: Address.newFromBech32(spec.receiver),
    value: spec.value,
    data: Buffer.from(spec.data, 'utf8'),
    gasLimit: spec.gasLimit,
    gasPrice: MAINNET.gasPrice,
    chainID: MAINNET.chainId,
    nonce: BigInt(nonce),
    version: spec.version,
    ...(spec.relayer ? { relayer: Address.newFromBech32(spec.relayer) } : {}),
  })
}

/** Gateway JSON for send/simulate. An unsigned transaction carries a zero signature (simulation only). */
export function toPlain(tx: Transaction): PlainTx {
  const plain: PlainTx = {
    nonce: Number(tx.nonce),
    value: tx.value.toString(),
    receiver: tx.receiver.toBech32(),
    sender: tx.sender.toBech32(),
    gasPrice: Number(tx.gasPrice),
    gasLimit: Number(tx.gasLimit),
    chainID: tx.chainID,
    version: tx.version,
    signature: tx.signature.length ? Buffer.from(tx.signature).toString('hex') : '0'.repeat(128),
  }
  if (tx.data.length) plain.data = Buffer.from(tx.data).toString('base64')
  if (tx.options) plain.options = tx.options
  if (!tx.relayer.isEmpty()) {
    plain.relayer = tx.relayer.toBech32()
    plain.relayerSignature = tx.relayerSignature.length ? Buffer.from(tx.relayerSignature).toString('hex') : '0'.repeat(128)
  }
  return plain
}

/**
 * Upper bound of the fee in EGLD atomic units: the move-balance part at the full gas price and the
 * rest of the limit at the protocol's 1/100 price modifier (mainnet network config).
 */
export function maxFeeAtomic(spec: TxSpec): bigint {
  if (spec.relayer) return 0n // relayed: the relayer pays
  const moveBalance = 50_000n + 1_500n * BigInt(Buffer.byteLength(spec.data, 'utf8'))
  const processing = spec.gasLimit > moveBalance ? spec.gasLimit - moveBalance : 0n
  return moveBalance * MAINNET.gasPrice + (processing * MAINNET.gasPrice) / 100n
}

// ---- builders ----

const FOXSY_HEX = hexOfString(MAINNET.foxsyToken)
const FXLP_HEX = hexOfString(MAINNET.playerCollection)

export function shopPayTx(amountAtomic: bigint): TxSpec {
  return {
    label: 'shopPay',
    receiver: MAINNET.playersContract,
    value: 0n,
    data: `ESDTTransfer@${FOXSY_HEX}@${numberToHex(amountAtomic)}@${hexOfString('shopPay')}`,
    gasLimit: GAS.shopPay,
    version: 1,
  }
}

export function joinTournamentTx(scTournamentId: number, feeAtomic: bigint): TxSpec {
  return {
    label: 'joinTournament',
    receiver: MAINNET.tournamentsContract,
    value: 0n,
    data: `ESDTTransfer@${FOXSY_HEX}@${numberToHex(feeAtomic)}@${hexOfString('joinTournament')}@${u64Hex(scTournamentId)}`,
    gasLimit: GAS.joinTournament,
    version: 2,
  }
}

export function claimRefundTx(scTournamentId: number): TxSpec {
  return {
    label: 'claimRefund',
    receiver: MAINNET.tournamentsContract,
    value: 0n,
    data: `${hexOfString('claimRefund')}@${u64Hex(scTournamentId)}`,
    gasLimit: GAS.claimRefund,
    version: 2,
  }
}

/** Relayed v3 registration; the relayer is the served relayer on the agent's shard. */
export function registerAndPayTx(feeAtomic: bigint, relayer: string | undefined, relayCeiling: number | undefined): TxSpec {
  const ceiling = relayCeiling && Number.isSafeInteger(relayCeiling) && relayCeiling > 0 ? BigInt(relayCeiling) : undefined
  const gasLimit = ceiling === undefined ? GAS.registerAndPayLegacy : ceiling < GAS.registerAndPayMax ? ceiling : GAS.registerAndPayMax
  return {
    label: 'registerAndPay',
    receiver: MAINNET.playersContract,
    value: 0n,
    data: `ESDTTransfer@${FOXSY_HEX}@${numberToHex(feeAtomic)}@${hexOfString('registerAndPay')}`,
    gasLimit,
    version: 2,
    ...(relayer ? { relayer } : {}),
  }
}

/** EGLD path swap: value = maxIn EGLD, at least `foxsyOut` FOXSY comes back (surplus included). */
export function swapEgldTx(foxsyOut: bigint, maxInAtomic: bigint): TxSpec {
  return {
    label: 'composeTasks swap',
    receiver: MAINNET.composableTasks,
    value: maxInAtomic,
    data: composeTasksEgldToFoxsyData(foxsyOut),
    gasLimit: GAS.swapEgldPath,
    version: 2,
  }
}

/** WEGLD path swap: at most `maxIn` WEGLD goes to the pair, exactly `foxsyOut` FOXSY comes back with the unused WEGLD. */
export function swapWegldTx(foxsyOut: bigint, maxInAtomic: bigint): TxSpec {
  return {
    label: 'pair swap (WEGLD)',
    receiver: MAINNET.foxsyWegldPair,
    value: 0n,
    data: swapWegldToFoxsyData(foxsyOut, maxInAtomic),
    gasLimit: GAS.swapWegldPath,
    version: 2,
  }
}

const PLAYERS_HEX = Address.newFromBech32(MAINNET.playersContract).toHex()

export interface SyncPrep {
  sc_call_data: string
  receiver: string
  gas_limit: number
  foxsy_cost?: string
  nonces: number[]
}

/**
 * Sync: the data field comes whole from /api/sync/prepare. Its `receiver` names the players contract
 * the MultiESDTNFTTransfer inside targets (sync.rs:83-84); the transaction itself goes from the agent to
 * the agent (Squad.tsx:246-256). The payload is decoded and signed only if it is exactly a sync: one
 * FOXSY transfer of the per-card fee times the cards, the listed cards once each, syncMyStats, and a
 * gas limit within the backend's formula (15M + 3M per card, sync.rs:36-38). Returns the FOXSY it pays.
 */
export function syncTx(agentAddress: string, prep: SyncPrep, perCardFoxsy: number): { spec: TxSpec; foxsy: bigint } {
  if (prep.receiver !== MAINNET.playersContract) throw new Error(`sync payload targets ${prep.receiver}, not the players contract`)
  const parts = prep.sc_call_data.split('@')
  if (parts[0] !== 'MultiESDTNFTTransfer' || parts[1] !== PLAYERS_HEX) throw new Error('sync payload data does not target the players contract')
  const n = prep.nonces.length
  if (!n || n > 200 || new Set(prep.nonces).size !== n) throw new Error('sync payload card list is empty, too long or repeated')
  if (parseInt(parts[2] ?? '', 16) !== n + 1) throw new Error('sync payload transfers something besides the FOXSY fee and the cards')
  if (parts[3] !== FOXSY_HEX || !/^0*$/.test(parts[4] ?? 'x')) throw new Error('sync payload does not pay in FOXSY first')
  const foxsy = BigInt(`0x${parts[5] || '0'}`)
  const expected = wholeToAtomic(perCardFoxsy) * BigInt(n)
  if (foxsy !== expected) throw new Error(`sync payload pays ${foxsy} atomic FOXSY, expected ${expected} (${perCardFoxsy} per card)`)
  if (prep.foxsy_cost !== undefined && BigInt(prep.foxsy_cost) !== foxsy) throw new Error('sync payload amount differs from the quoted cost')
  const listed = new Set(prep.nonces)
  for (let i = 0; i < n; i++) {
    const [token, nonceHex, amount] = parts.slice(6 + i * 3, 9 + i * 3)
    if (token !== FXLP_HEX || parseInt(amount ?? '', 16) !== 1 || !listed.delete(parseInt(nonceHex ?? '', 16))) throw new Error('sync payload moves a card that is not in its list')
  }
  if (parts[6 + n * 3] !== hexOfString('syncMyStats')) throw new Error('sync payload calls another endpoint than syncMyStats')
  const maxGas = 15_000_000 + 3_000_000 * n + 5_000_000
  if (!Number.isInteger(prep.gas_limit) || prep.gas_limit <= 0 || prep.gas_limit > maxGas) throw new Error(`sync gas limit ${prep.gas_limit} is above ${maxGas}`)
  return { spec: { label: 'syncMyStats', receiver: agentAddress, value: 0n, data: prep.sc_call_data, gasLimit: BigInt(prep.gas_limit), version: 1 }, foxsy }
}

/** Relayer on the wallet's shard (Onboarding.tsx:801-816: s = b & 3, if s > 2 then b & 1). */
export function shardOfPubkeyLastByte(lastByte: number): number {
  const s = lastByte & 0b11
  return s > 2 ? lastByte & 0b01 : s
}

// ---- fusion and the marketplace (docs/FOXLEAGUE-INTEGRATION.md sections 13 and 14) ----


/**
 * Fusion (FusionTab.tsx:377-420): FOXSY first, then the three cards, to the players contract through
 * a MultiESDTNFTTransfer from the agent to the agent. position_choice picks which input's position the
 * output takes; portrait_choice is required and unused on chain.
 */
export function fusionTx(agentAddress: string, feeAtomic: bigint, nonces: number[], positionChoice: number): TxSpec {
  if (nonces.length !== 3 || positionChoice < 0 || positionChoice > 2) throw new Error('fusion takes 3 cards and a position choice 0..2')
  const cards = nonces.map(n => `@${FXLP_HEX}@${numberToHex(n)}@01`).join('')
  return {
    label: 'fusion',
    receiver: agentAddress,
    value: 0n,
    data: `MultiESDTNFTTransfer@${PLAYERS_HEX}@04@${FOXSY_HEX}@00@${numberToHex(feeAtomic)}${cards}@${hexOfString('fusion')}@${numberToHex(positionChoice)}@00`,
    gasLimit: GAS.fusion,
    version: 1,
  }
}

/**
 * Fusion waivers (fusionWaivers.ts:248-290): the exact FOXSY and the card go to the players contract and the
 * card comes straight back, receiver = the agent itself. args: the nonce (and the match count for the match waiver).
 */
export function fusionWaiverTx(agentAddress: string, nonce: number, costAtomic: bigint, endpoint: 'payFusionCooldownWaiver' | 'payFusionMatchWaiver', matches?: number): TxSpec {
  const args = `@${numberToHex(nonce)}${endpoint === 'payFusionMatchWaiver' ? `@${numberToHex(matches ?? 0)}` : ''}`
  return {
    label: endpoint,
    receiver: agentAddress,
    value: 0n,
    data: `MultiESDTNFTTransfer@${PLAYERS_HEX}@02@${FOXSY_HEX}@00@${numberToHex(costAtomic)}@${FXLP_HEX}@${numberToHex(nonce)}@01@${hexOfString(endpoint)}${args}`,
    gasLimit: GAS.fusionWaiver,
    version: 1,
  }
}

/** Auction listing (Marketplace.tsx:1099-1134): the card to the players contract, reserve in whole FOXSY. */
export function auctionListTx(agentAddress: string, nonce: number, reserveFoxsy: number): TxSpec {
  return {
    label: 'auctionList',
    receiver: agentAddress,
    value: 0n,
    data: `ESDTNFTTransfer@${FXLP_HEX}@${numberToHex(nonce)}@01@${PLAYERS_HEX}@${hexOfString('auctionList')}@${numberToHex(wholeToAtomic(reserveFoxsy))}`,
    gasLimit: GAS.auctionList,
    version: 1,
  }
}

/** Bid (Marketplace.tsx:1745-1761): FOXSY to the players contract; the previous top bidder is refunded at once. */
export function auctionBidTx(nonce: number, bidFoxsy: number): TxSpec {
  return {
    label: 'auctionBid',
    receiver: MAINNET.playersContract,
    value: 0n,
    data: `ESDTTransfer@${FOXSY_HEX}@${numberToHex(wholeToAtomic(bidFoxsy))}@${hexOfString('auctionBid')}@${numberToHex(nonce)}`,
    gasLimit: GAS.auctionBid,
    version: 1,
  }
}

/** Cancel an own auction without bids (Marketplace.tsx:1861-1873). */
export function auctionCancelTx(nonce: number): TxSpec {
  return { label: 'auctionCancel', receiver: MAINNET.playersContract, value: 0n, data: `auctionCancel@${numberToHex(nonce)}`, gasLimit: GAS.auctionCancel, version: 1 }
}
