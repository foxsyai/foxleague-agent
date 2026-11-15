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
import { MAINNET } from '../../src/config.ts'
import { checkAction, type RulesContext } from '../../src/executor/rules.ts'
import { wholeToAtomic } from '../../src/util/encoding.ts'
import { ApiRefusal } from '../../src/foxleague/api.ts'
import { TEST_SETTINGS, dryWallet, liveWallet, setup, withLive } from '../fixtures.ts'
import { fuse, prepared, spares, type Over } from './mint-fixture.ts'

const why = (v: ReturnType<typeof checkAction>) => (v.ok ? '' : (v as { refusal: string }).refusal)
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

// The dry run simulated FoxLeague's prepared data until the review of PR #73: since R73A-2 a dry run asks no prepare (a
// write on FoxLeague), so it has no signed fusionMint to simulate; it checks and counts the fusion and never signs it.
test('FL13-4: in a dry run the fusion that mints is never signed (since R73A-2 neither prepared nor simulated)', async () => {
  let simulated: { data?: string } | undefined
  let prepares = 0
  const m = setup({
    chain: { simulate: async (plain: typeof simulated) => { simulated = plain; return { ok: true, detail: 'success', raw: {} } } },
    fox: { fusionPrepare: async () => { prepares++; return prepared() } },
  })
  const [r] = await m.exec.run(m.agent(), dryWallet, spares(), [{ action: fuse, reason: 'grow' }])
  assert.equal(r!.status, 'dry_run', r!.summary)
  assert.equal(prepares, 0)
  assert.equal(simulated, undefined)
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
