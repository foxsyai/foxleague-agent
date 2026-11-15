// Transaction builders: receiver, data field, value, gas and version exactly as the FoxLeague web
// app signs them (docs/FOXLEAGUE-INTEGRATION.md 1.4, 1.7, 4.4, 5, 7.2, 10.4, 10.7, 12.1).

import { Address, Transaction } from '@multiversx/sdk-core'
import { GAS, MAINNET } from '../config.ts'
import type { PlainTx } from '../chain/gateway.ts'
import type { FusionPrepared } from '../foxleague/types.ts'
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
 * gas limit within the backend's formula with 2M to spare (18M + 3M per card since the fusionMint upgrade of
 * 2026-11-13, sync.rs SYNC_BASE_GAS; 15M before). Returns the FOXSY it pays.
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
 * The band a served fusionMint limit must sit in (FoxLeague's app, gasLimits.ts FUSION_MINT_GAS_FLOOR and _CEILING): at
 * least the heaviest measured call (24.3M), at most twice it, where MultiversX keeps the whole limit.
 */
export const FUSION_MINT_GAS = { floor: 24_300_000, ceiling: 48_600_000 } as const

/** The most and the least time a prepared fusion's signature may have left (FoxLeague signs for 10 minutes). */
const MINT_EXPIRY = { minLeftS: 120, maxAheadS: 20 * 60 } as const

/**
 * fusionMint (FoxLeague's fusion from its switch on; FusionTab.tsx signs the answer of POST /api/fusion/prepare): the
 * data field comes whole from FoxLeague, which signs the new card, and goes from the agent to the agent like the old
 * fusion, signed with the gas limit served with it. Signed only when it is exactly the fusion planned, checked part by
 * part against FoxLeague's own layout (backend/src/fusion_mint.rs call_data and call_arguments):
 * `MultiESDTNFTTransfer@<players>@04@<FOXSY>@00@<fee>@<FXLP>@<nonce>@01 x 3@fusionMint@<position>@<expiry>@<signature>
 * @<new card>@<nonce1>@<attrs1>@<nonce2>@<attrs2>@<nonce3>@<attrs3>`: the fee the checks allowed and nothing more (the
 * cost the answer names too), the three planned cards in their order once each and as the signed inputs, the position
 * asked, an expiry with at least 2 minutes left and a gas limit inside FUSION_MINT_GAS. Anything else throws.
 */
export function fusionMintTx(agentAddress: string, prep: FusionPrepared, expect: { feeAtomic: bigint; nonces: number[]; positionChoice: number; now: Date }): TxSpec {
  const fail = (why: string): never => {
    throw new Error(`FoxLeague's prepared fusion is not the fusion planned (${why}): nothing signed`)
  }
  if (!prep || typeof prep !== 'object' || typeof prep.sc_call_data !== 'string') fail('no data field')
  if (prep.receiver !== MAINNET.playersContract) fail(`it targets ${String(prep.receiver)}, not the players contract`)
  if (prep.foxsy_token_id !== undefined && prep.foxsy_token_id !== MAINNET.foxsyToken) fail(`it pays in ${String(prep.foxsy_token_id)}`)
  if (expect.nonces.length !== 3 || new Set(expect.nonces).size !== 3) fail('a fusion takes 3 different cards')
  if (!Array.isArray(prep.nonces) || prep.nonces.join(',') !== expect.nonces.join(',') || prep.position_choice !== expect.positionChoice) fail('other cards or another position than planned')
  if (prep.cost_raw !== expect.feeAtomic.toString()) fail(`it names a cost of ${String(prep.cost_raw)} atomic FOXSY, the checks allowed ${expect.feeAtomic}`)
  const gas = prep.gas_limit
  if (!Number.isSafeInteger(gas) || gas < FUSION_MINT_GAS.floor || gas > FUSION_MINT_GAS.ceiling) fail(`a gas limit of ${String(gas)}, outside ${FUSION_MINT_GAS.floor} to ${FUSION_MINT_GAS.ceiling}`)
  const parts = prep.sc_call_data.split('@')
  if (parts.length !== 26) fail(`${parts.length} parts in its data field, a fusionMint has 26`)
  const evenHex = (x: string | undefined, max: number) => typeof x === 'string' && x.length > 0 && x.length <= max && /^([0-9a-f]{2})+$/.test(x)
  /** FoxLeague's number argument: minimal even-length hex, 0 the empty argument. */
  const num = (x: string | undefined): bigint | null => (x === '' ? 0n : typeof x === 'string' && /^([0-9a-f]{2})+$/.test(x) && !x.startsWith('00') ? BigInt(`0x${x}`) : null)
  if (parts[0] !== 'MultiESDTNFTTransfer' || parts[1]?.toLowerCase() !== PLAYERS_HEX) fail('it does not send to the players contract')
  if (parts[2] !== '04') fail('it sends more or less than the fee and three cards')
  if (parts[3] !== FOXSY_HEX || parts[4] !== '00') fail('it does not pay in FOXSY first')
  if (num(parts[5]) !== expect.feeAtomic) fail(`it pays ${String(parts[5])} (hex) atomic FOXSY, the checks allowed ${expect.feeAtomic}`)
  for (let i = 0; i < 3; i++) {
    const [token, nonceHex, amount] = parts.slice(6 + i * 3, 9 + i * 3)
    if (token !== FXLP_HEX || num(nonceHex) !== BigInt(expect.nonces[i]!) || amount !== '01') fail('it moves other cards than the three planned, or in another order')
  }
  if (parts[15] !== hexOfString('fusionMint')) fail('it calls another endpoint than fusionMint')
  if (num(parts[16]) !== BigInt(expect.positionChoice)) fail('it takes another position than planned')
  const expiry = num(parts[17])
  const nowS = Math.floor(expect.now.getTime() / 1000)
  if (expiry === null || Number(expiry) !== prep.expiry) fail('its expiry differs from the one it names')
  if (Number(expiry) < nowS + MINT_EXPIRY.minLeftS || Number(expiry) > nowS + MINT_EXPIRY.maxAheadS) fail(`its signature expires at ${String(expiry)}, not between ${MINT_EXPIRY.minLeftS} seconds and ${MINT_EXPIRY.maxAheadS / 60} minutes from now`)
  if (!/^[0-9a-f]{128}$/.test(parts[18] ?? '')) fail('its signature is not 64 bytes')
  if (!evenHex(parts[19], 1_000)) fail('its new card is not readable')
  for (let i = 0; i < 3; i++) {
    if (num(parts[20 + i * 2]) !== BigInt(expect.nonces[i]!) || !evenHex(parts[21 + i * 2], 1_000)) fail('it signs other cards than the three planned')
  }
  return { label: 'fusionMint', receiver: agentAddress, value: 0n, data: prep.sc_call_data, gasLimit: BigInt(gas), version: 1 }
}

/**
 * A fusionMint of these cards before FoxLeague prepared it, only to count its gas (GitHub review of PR #73, R73A-2):
 * FoxLeague's layout with a zero signature (64 bytes, as in every fusionMint), the new card and the inputs' attributes
 * each the least (1 byte) or the most (500 bytes) fusionMintTx signs, and a limit at the floor or the ceiling of
 * FUSION_MINT_GAS, so its fee is the least or the most a fusionMint that fusionMintTx would sign can cost. Never
 * simulated or signed: the signature in a fusionMint is FoxLeague's, and only its prepared data is ever signed.
 */
export function fusionMintBound(agentAddress: string, feeAtomic: bigint, nonces: number[], positionChoice: number, bound: 'least' | 'most', now: Date): TxSpec {
  const cardData = bound === 'least' ? '00' : 'ff'.repeat(500)
  /** FoxLeague's number argument (fusionMintTx): 0 is the empty argument. */
  const num = (n: bigint | number) => (BigInt(n) === 0n ? '' : numberToHex(n))
  const data = [
    'MultiESDTNFTTransfer', PLAYERS_HEX, '04', FOXSY_HEX, '00', num(feeAtomic),
    ...nonces.flatMap(n => [FXLP_HEX, num(n), '01']),
    hexOfString('fusionMint'), num(positionChoice), num(Math.floor(now.getTime() / 1000) + MINT_EXPIRY.maxAheadS), '00'.repeat(64), cardData,
    ...nonces.flatMap(n => [num(n), cardData]),
  ].join('@')
  return { label: 'fusionMint (counted, not prepared)', receiver: agentAddress, value: 0n, data, gasLimit: BigInt(FUSION_MINT_GAS[bound === 'least' ? 'floor' : 'ceiling']), version: 1 }
}

/**
 * Fusion waivers (fusionWaivers.ts): the exact FOXSY and the card go to the players contract and the card comes
 * straight back, receiver = the agent itself. args: the nonce, then the match count (match waiver) or the days
 * when only some are bought (cooldown waiver).
 */
export function fusionWaiverTx(agentAddress: string, nonce: number, costAtomic: bigint, endpoint: 'payFusionCooldownWaiver' | 'payFusionMatchWaiver', count?: number): TxSpec {
  // The match waiver names its match count; the cooldown waiver names days only when it buys some of them
  // (fusionWaivers.ts fusionCooldownWaiverTxData: every quoted day = no days argument).
  const args = `@${numberToHex(nonce)}${endpoint === 'payFusionMatchWaiver' ? `@${numberToHex(count ?? 0)}` : count ? `@${numberToHex(count)}` : ''}`
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
