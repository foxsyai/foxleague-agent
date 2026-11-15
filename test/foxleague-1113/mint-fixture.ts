// The fusion that mints its result (FL13-4): FoxLeague's prepared fusionMint as its server serves it, the fuse it
// answers and three spare Commons from the switch on. Shared by the tests of FL13-4 and of the review of PR #73.
import { Address } from '@multiversx/sdk-core'
import { MAINNET } from '../../src/config.ts'
import type { Action } from '../../src/executor/actions.ts'
import type { AgentSnapshot } from '../../src/snapshot/snapshot.ts'
import { wholeToAtomic } from '../../src/util/encoding.ts'
import { card, snapshot } from '../fixtures.ts'

const PLAYERS_HEX = Address.newFromBech32(MAINNET.playersContract).toHex()
const hex = (s: string) => Buffer.from(s).toString('hex')
/** FoxLeague's number_arg: big-endian, even length, 0 is the empty argument (fusion_mint.rs). */
const arg = (n: bigint | number) => {
  const v = BigInt(n)
  if (v === 0n) return ''
  const h = v.toString(16)
  return h.length % 2 ? `0${h}` : h
}
// FoxLeague's own vector (contracts/foxleague-players/scenarios/fusion_mint_vector.json): a signature, a new card and
// three inputs' signed attributes as the contract reads them.
const SIG = 'cbeeef6d931efd1e411ccc746c544ced1b36208e15ba1a484134408f6e740f42b0c875107e78a094be0bcfa89af14b8c6fcbdd535f1314d0112752e70044ce0a'
const OUTPUT = '0000000e416e6472656920506f70657363751f040000004d68747470733a2f2f697066732e666f786c65616775652e61692f697066732f516d52486f4a3647376a58625343685941564542674a747771696777396e77716d6b686f776662445965446b4a540016'
const ATTRS = [
  '00000007436172642035310000010001000000000f0c120d0e10116400000014000000000000000000',
  '0000000743617264203532010004000100000000110e100f120c0d640000000f000000000000000000',
  '000000074361726420353303000900010000000012110c0e0d0e106400000014000000000000000000',
]

export interface Over { nonces?: number[]; argNonces?: number[]; position?: number; argPosition?: string; cost?: bigint; costRaw?: string; expiry?: number; gas?: number; endpoint?: string; receiver?: string; transfers?: string; token?: string; sig?: string; extra?: string[] }
export function prepared(o: Over = {}) {
  const nonces = o.nonces ?? [101, 102, 103]
  const position = o.position ?? 0
  const cost = o.cost ?? wholeToAtomic(100)
  const expiry = o.expiry ?? Math.floor(Date.now() / 1000) + 600
  const data = [
    'MultiESDTNFTTransfer', PLAYERS_HEX, o.transfers ?? '04', hex(o.token ?? MAINNET.foxsyToken), '00', arg(cost),
    ...nonces.flatMap(n => [hex(MAINNET.playerCollection), arg(n), '01']),
    hex(o.endpoint ?? 'fusionMint'), o.argPosition ?? arg(position), arg(expiry), o.sig ?? SIG, OUTPUT,
    ...(o.argNonces ?? nonces).flatMap((n, i) => [arg(n), ATTRS[i]!]),
    ...(o.extra ?? []),
  ].join('@')
  return {
    sc_call_data: data,
    receiver: o.receiver ?? MAINNET.playersContract,
    // FoxLeague's served limit: 50,000 + 1,500 a data byte + 1.5 x 21.4M (fusion_mint.rs gas_limit).
    gas_limit: o.gas ?? 50_000 + 1_500 * data.length + 32_100_000,
    expiry,
    cost_raw: o.costRaw ?? cost.toString(),
    foxsy_token_id: MAINNET.foxsyToken,
    nonces,
    position_choice: position,
    preview: { position: 'MID', rarity: 'Uncommon', ovr: 36, stats: ['speed', 'accuracy', 'defense', 'power', 'control', 'vision', 'stamina'].map(stat => ({ stat, value: 36, input_values: [20, 20, 20], scaled_value: 36 })) },
  }
}

export const fuse: Action = { type: 'fuse', player_nonces: [101, 102, 103], position_of: 0 }
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

/** Three spare Commons at their gate, one with unsynced training (no sync is needed from the switch). */
export function spares(): AgentSnapshot {
  const s = snapshot([card(101, 'MID', 'reserve', { dirty: true }), card(102, 'MID', 'reserve'), card(103, 'DEF', 'reserve')])
  ;(s.config as Record<string, unknown>).fusion_mint = { live: true, live_from: minutesAgo(60), paused: false }
  return s
}
