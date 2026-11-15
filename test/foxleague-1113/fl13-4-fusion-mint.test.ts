// FoxLeague mainnet of 13 Nov 2026, FL13-4: the fusion that mints its result.
// From the players contract's live time (/api/config fusion_mint.live_from, 2026-11-20T14:00:00Z on mainnet) a fusion is
// FoxLeague's `fusionMint` (next-foxleague origin/main #711 + #736, the contract on mainnet since 2026-11-13 21:32:50
// UTC): the game server signs the three inputs' live attributes and the new card (backend/src/routes/fusion_mint.rs, POST
// /api/fusion/prepare), and the wallet signs the data field it serves, a self MultiESDTNFTTransfer of the FOXSY cost and
// the three cards to the players contract with `fusionMint@position@expiry@signature@output@nonce1@attrs1@...`
// (backend/src/fusion_mint.rs call_data, call_arguments), with the gas limit served with it, between 24.3M and 48.6M
// (frontend/src/lib/gasLimits.ts fusionMintGasLimit). From then the old `fusion` reverts, can-fuse with nonces answers
// an error (code fusion_mint_live), the pool is emptied (clearAllFusionPools) and no sync is needed.
// The agent knew only the old fusion: from the switch it could never fuse again (its pre-check unreadable, the pool
// empty), and nothing in it could sign the new one. The money checks of the served data are the agent's own, as for a
// sync (tx.ts syncTx): exactly the fusion planned, never more FOXSY than the checks allowed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Address } from '@multiversx/sdk-core'
import { MAINNET } from '../../src/config.ts'
import { checkAction, type RulesContext } from '../../src/executor/rules.ts'
import type { Action } from '../../src/executor/actions.ts'
import type { AgentSnapshot } from '../../src/snapshot/snapshot.ts'
import { wholeToAtomic } from '../../src/util/encoding.ts'
import { ApiRefusal } from '../../src/foxleague/api.ts'
import { TEST_SETTINGS, card, dryWallet, liveWallet, setup, snapshot, withLive } from '../fixtures.ts'

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

interface Over { nonces?: number[]; argNonces?: number[]; position?: number; argPosition?: string; cost?: bigint; costRaw?: string; expiry?: number; gas?: number; endpoint?: string; receiver?: string; transfers?: string; token?: string; sig?: string; extra?: string[] }
function prepared(o: Over = {}) {
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

const fuse: Action = { type: 'fuse', player_nonces: [101, 102, 103], position_of: 0 }
const why = (v: ReturnType<typeof checkAction>) => (v.ok ? '' : (v as { refusal: string }).refusal)
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

/** Three spare Commons at their gate, one with unsynced training (no sync is needed from the switch). */
function spares(): AgentSnapshot {
  const s = snapshot([card(101, 'MID', 'reserve', { dirty: true }), card(102, 'MID', 'reserve'), card(103, 'DEF', 'reserve')])
  ;(s.config as Record<string, unknown>).fusion_mint = { live: true, live_from: minutesAgo(60), paused: false }
  return s
}
const mintCtx = (p: unknown): RulesContext => ({ settings: { ...TEST_SETTINGS }, now: new Date(), canFuse: null, fusionPool: 0, fusionPrepared: p as RulesContext['fusionPrepared'] })

test('FL13-4: from the switch a fusion FoxLeague prepared exactly as planned is allowed: no sync, no can-fuse, no pool', () => {
  const v = checkAction(fuse, spares(), mintCtx(prepared()))
  assert.equal(v.ok, true, why(v))
  assert.equal(v.foxsy, wholeToAtomic(100))
  assert.ok((v.facts as { prepared?: unknown }).prepared, 'the prepared fusion goes to the builder')
  assert.match(v.notes.join('; '), /a new Uncommon MID, OVR 36/)
})

test('FL13-4: a prepared fusion that is not exactly the one planned is never signed', () => {
  const now = Math.floor(Date.now() / 1000)
  const cases: [string, Over][] = [
    ['more FOXSY than the fee', { cost: wholeToAtomic(200) }],
    ['a cost it names apart from its data', { costRaw: wholeToAtomic(50).toString() }],
    ['another card sent', { nonces: [101, 102, 104] }],
    ['the cards in another order', { nonces: [102, 101, 103] }],
    ['another card signed as an input', { argNonces: [101, 102, 104] }],
    ['the old fusion endpoint', { endpoint: 'fusion' }],
    ['another position', { argPosition: '01' }],
    ['a fifth transfer', { transfers: '05' }],
    ['another token as the fee', { token: 'WEGLD-bd4d79' }],
    ['another contract', { receiver: MAINNET.tournamentsContract }],
    ['a gas limit above the band', { gas: 60_000_000 }],
    ['a gas limit below the band', { gas: 20_000_000 }],
    ['an expiry already past', { expiry: now - 5 }],
    ['an expiry too close to run', { expiry: now + 30 }],
    ['an expiry far ahead', { expiry: now + 3600 }],
    ['a signature that is not 64 bytes', { sig: 'abcd' }],
    ['an argument more', { extra: ['00'] }],
  ]
  for (const [name, o] of cases) {
    const v = checkAction(fuse, spares(), mintCtx(prepared(o)))
    assert.equal(v.ok, false, `${name}: allowed`)
    assert.match(why(v), /not the fusion planned/, name)
  }
  const s = spares()
  assert.equal(checkAction(fuse, s, mintCtx({ ...prepared(), receiver: MAINNET.playersContract, gas_limit: 33_000_000.5 })).ok, false, 'a gas limit that is no whole number')
})

test('FL13-4: FoxLeague\'s refusal of the prepare is its word; an unanswered prepare is no "yes"', () => {
  assert.match(why(checkAction(fuse, spares(), mintCtx({ refusal: 'Fusion cooldown active: your next fusion in 0d 7h.' }))), /FoxLeague says not now: Fusion cooldown active/)
  assert.match(why(checkAction(fuse, spares(), mintCtx(null))), /could not be prepared/)
  assert.match(why(checkAction(fuse, spares(), mintCtx(undefined))), /could not be prepared/)
})

test('FL13-4: the agent\'s own checks still hold from the switch (the gate, an injury, the squad, 18 cards left)', () => {
  const s = spares()
  s.players.find(p => p.nonce === 102)!.competitiveMatches = 4
  assert.match(why(checkAction(fuse, s, mintCtx(prepared()))), /#102 has played 4 competitive matches/)
  const hurt = spares()
  hurt.players.find(p => p.nonce === 103)!.injuredUntil = new Date(Date.now() + 86_400_000).toISOString()
  assert.match(why(checkAction(fuse, hurt, mintCtx(prepared()))), /injured/)
})

test('FL13-4: live, the executor prepares the fusion with FoxLeague and signs exactly its data with its gas limit', async () => {
  const asked: unknown[] = []
  let sent: { data?: string; gasLimit: number; receiver: string; value: string } | undefined
  let poolRead = false
  let canFuseAsked = false
  const p = prepared()
  const m = setup({
    chain: {
      query: async (_sc: string, fn: string) => { if (fn === 'getFusionPoolCount') poolRead = true; return [] },
      send: async (plain: typeof sent) => { sent = plain; return 'mint1' },
    },
    fox: {
      fusionPrepare: async (_w: unknown, nonces: number[], position: number) => { asked.push({ nonces, position }); return p },
      canFuse: async () => { canFuseAsked = true; throw new ApiRefusal('Fusion now makes a brand new card. Reload the page to fuse the new way. Nothing was signed.', 'fusion_mint_live') },
      fusionConfirm: async () => ({ confirmed: true, indexed: true, message: 'Fusion confirmed' }),
    },
  })
  const [r] = await withLive(m.store, () => m.exec.run(m.agent(), liveWallet, spares(), [{ action: fuse, reason: 'grow' }]))
  assert.equal(r!.status, 'confirmed', r!.summary)
  assert.deepEqual(asked, [{ nonces: [101, 102, 103], position: 0 }])
  assert.equal(canFuseAsked, false, 'the old pre-check is not asked from the switch')
  assert.equal(poolRead, false, 'the emptied pool is not read from the switch')
  assert.ok(sent, 'a transaction was sent')
  assert.equal(Buffer.from(sent!.data!, 'base64').toString(), p.sc_call_data)
  assert.equal(sent!.gasLimit, p.gas_limit)
  assert.equal(sent!.receiver, liveWallet.address, 'a self transfer, as FoxLeague builds it')
  assert.equal(sent!.value, '0')
})

test('FL13-4: in a dry run the prepared fusion is simulated, never signed', async () => {
  let simulated: { data?: string } | undefined
  const p = prepared()
  const m = setup({
    chain: { simulate: async (plain: typeof simulated) => { simulated = plain; return { ok: true, detail: 'success', raw: {} } } },
    fox: { fusionPrepare: async () => p },
  })
  const [r] = await m.exec.run(m.agent(), dryWallet, spares(), [{ action: fuse, reason: 'grow' }])
  assert.equal(r!.status, 'dry_run', r!.summary)
  assert.equal(Buffer.from(simulated!.data!, 'base64').toString(), p.sc_call_data)
})

test('FL13-4: before the switch the executor keeps the old fusion and never asks for a prepare', async () => {
  let prepares = 0
  const b64 = (n: number) => Buffer.from([n]).toString('base64')
  const m = setup({
    chain: { query: async (_sc: string, fn: string) => (fn === 'getFusionPoolCount' ? [b64(4)] : []) },
    fox: { fusionPrepare: async () => { prepares++; return prepared() }, canFuse: async () => ({ can_fuse: true }) },
  })
  const s = spares()
  s.players.find(p => p.nonce === 101)!.dirty = false
  ;(s.config as Record<string, unknown>).fusion_mint = { live: false, live_from: new Date(Date.now() + 5 * 86_400_000).toISOString(), paused: false }
  const [r] = await m.exec.run(m.agent(), dryWallet, s, [{ action: fuse, reason: 'grow' }])
  assert.equal(r!.status, 'dry_run', r!.summary)
  assert.equal(prepares, 0)
  assert.match(r!.summary, /fusion: simulation ok/)
})
