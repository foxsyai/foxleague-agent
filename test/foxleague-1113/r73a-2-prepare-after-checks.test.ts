// GitHub review of PR #73, R73A-2 (low, hygiene): from FoxLeague's fusion switch the executor asked the prepare
// (POST /api/fusion/prepare, a write on FoxLeague: it signs a new card for 10 minutes, at most one every 2 seconds a
// wallet, up to 45 s) while it read the context, before any check of its own and in a dry run too. A fuse the agent
// refuses for what it already knows (a listed card, a card in its fusion cooldown, one on the bench, the daily cap, the
// EGLD for gas) still cost a prepare and that time under the wallet's lock, and a dry run asked one for every fuse it
// simulated. Now the prepare is asked once every check of the agent's own passed, live only, and its answer goes through
// every check again; a dry run asks none and simulates no fusionMint (the signature in it is FoxLeague's).
import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiRefusal } from '../../src/foxleague/api.ts'
import { costUsd } from '../../src/executor/budget.ts'
import * as tx from '../../src/executor/tx.ts'
import { fusionMintTx, maxFeeAtomic } from '../../src/executor/tx.ts'
import type { AgentSnapshot } from '../../src/snapshot/snapshot.ts'
import type { AgentSettings } from '../../src/store/settings.ts'
import { wholeToAtomic } from '../../src/util/encoding.ts'
import { TEST_SETTINGS, dryWallet, liveWallet, setup, withLive } from '../fixtures.ts'
import { fuse, prepared, spares } from './mint-fixture.ts'

const FEE = wholeToAtomic(100)

/** An agent whose prepare answers FoxLeague's fusionMint; what it asked, simulated, booked and signed is counted. */
function agentWith(settings: Partial<AgentSettings> = {}, answer: () => unknown = () => prepared()) {
  let asked = 0
  let simulated = 0
  let signed = 0
  const m = setup({
    chain: {
      simulate: async () => { simulated++; return { ok: true, detail: 'success', raw: {} } },
      send: async () => { signed++; return 'mint1' },
    },
    fox: {
      fusionPrepare: async () => { asked++; return answer() },
      fusionConfirm: async () => ({ confirmed: true, indexed: true, message: 'Fusion confirmed' }),
    },
  })
  m.store.updateSettings(0, { ...TEST_SETTINGS, ...settings })
  const booked = (dry: boolean) => m.store.db.prepare('SELECT usd FROM spend WHERE dry_run = ?').all(dry ? 1 : 0) as { usd: number }[]
  return {
    asked: () => asked,
    simulated: () => simulated,
    signed: () => signed,
    booked,
    live: (s: AgentSnapshot) => withLive(m.store, () => m.exec.run(m.agent(), liveWallet, s, [{ action: fuse, reason: 'grow' }])).then(([r]) => r!),
    dry: (s: AgentSnapshot) => m.exec.run(m.agent(), dryWallet, s, [{ action: fuse, reason: 'grow' }]).then(([r]) => r!),
  }
}

/** Fuses the agent's own checks refuse, each with the words of its refusal. */
const refusedLocally: [string, (s: AgentSnapshot) => void, Partial<AgentSettings>, RegExp][] = [
  ['a listed card', s => { s.players.find(p => p.nonce === 102)!.listed = true }, {}, /#102 is listed for sale/],
  ['a card in its fusion cooldown', s => { s.players.find(p => p.nonce === 101)!.fusionReadyAt = new Date(Date.now() + 3 * 86_400_000).toISOString() }, {}, /#101 is in its fusion cooldown/],
  ['a card on the bench', s => { s.team!.substitutes = [...s.team!.substitutes, 103] }, {}, /#103 is in the lineup or on the bench/],
  ['a card short of its match gate', s => { s.players.find(p => p.nonce === 102)!.competitiveMatches = 4 }, {}, /#102 has played 4 competitive matches/],
  ['too little FOXSY for the fee', s => { s.chain!.foxsy = wholeToAtomic(50) }, {}, /needs 100 FOXSY, wallet holds less/],
  ['a fee above Max shop payment', () => {}, { maxShopPaymentFoxsy: 50 }, /exceeds the per-action maximum 50 \(Max shop payment\)/],
  ['no prices to value it', s => { s.prices = null }, {}, /prices unavailable/],
  ['over the daily cap', () => {}, { dailyCapUsd: 0.1 }, /daily cap: \$0\.2\d needed/],
  ['no EGLD for its gas', s => { s.chain!.egld = 0n }, {}, /EGLD for gas, wallet has 0/],
]

test('R73A-2: a fuse the agent\'s own checks refuse asks FoxLeague for no prepare, live', async () => {
  for (const [name, change, settings, words] of refusedLocally) {
    const x = agentWith(settings)
    const s = spares()
    change(s)
    const r = await x.live(s)
    assert.equal(r.status, 'refused', `${name}: ${r.summary}`)
    assert.match(r.summary, words, name)
    assert.equal(x.asked(), 0, `${name}: a prepare was asked for a fuse the agent refuses itself`)
    assert.equal(x.signed(), 0, `${name}: nothing signed`)
    assert.equal(x.booked(false).length, 0, `${name}: nothing booked`)
  }
})

test('R73A-2: a dry run asks FoxLeague for no prepare and simulates no fusionMint', async () => {
  const x = agentWith()
  const r = await x.dry(spares())
  assert.equal(r.status, 'dry_run', r.summary)
  assert.equal(x.asked(), 0, 'a prepare was asked in a dry run')
  assert.equal(x.simulated(), 0, 'a fusionMint without FoxLeague\'s signature was simulated')
  assert.match(r.summary, /would fuse #101,#102,#103/)
  assert.match(r.summary, /100 FOXSY \+ fees/)
  assert.match(r.summary, /FoxLeague prepares the new card only for a live fusion/)
  // Its gas is not known before FoxLeague serves it: the dry run counts at least what a served one costs, never nothing.
  const served = costUsd(FEE, maxFeeAtomic(fusionMintTx(liveWallet.address, prepared(), { feeAtomic: FEE, nonces: [101, 102, 103], positionChoice: 0, now: new Date() })), { egldUsd: 4.5, foxsyUsd: 0.00225 })
  const booked = x.booked(true).reduce((sum, row) => sum + row.usd, 0)
  assert.ok(booked >= served, `booked $${booked} in the dry run, a served fusionMint costs $${served}`)
  assert.equal(r.costUsd, booked)
})

test('R73A-2: a dry run refuses what the agent\'s own checks refuse, without a prepare', async () => {
  for (const [name, change, settings, words] of refusedLocally) {
    const x = agentWith(settings)
    const s = spares()
    change(s)
    const r = await x.dry(s)
    assert.equal(r.status, 'refused', `${name}: ${r.summary}`)
    assert.match(r.summary, words, name)
    assert.equal(x.asked(), 0, `${name}: a prepare was asked in a dry run`)
  }
})

test('R73A-2 (control): a fuse that passes every check of the agent\'s own asks the prepare once, live, and signs its data', async () => {
  const x = agentWith()
  const r = await x.live(spares())
  assert.equal(r.status, 'confirmed', r.summary)
  assert.equal(x.asked(), 1)
  assert.equal(x.signed(), 1)
})

test('R73A-2 (control): the answer goes through every check again: a served fusion that is not the one planned, or one the cap cannot hold, is refused', async () => {
  const tampered = agentWith({}, () => prepared({ cost: wholeToAtomic(200) }))
  const r = await tampered.live(spares())
  assert.equal(r.status, 'refused', r.summary)
  assert.match(r.summary, /not the fusion planned/)
  assert.equal(tampered.asked(), 1)
  assert.equal(tampered.signed(), 0)
  assert.equal(tampered.booked(false).length, 0)

  const refused = agentWith({}, () => { throw new ApiRefusal('Fusion cooldown active: your next fusion in 0d 7h.', 'fusion_cooldown') })
  assert.match((await refused.live(spares())).summary, /FoxLeague says not now: Fusion cooldown active/)
  assert.equal(refused.signed(), 0)

  // A daily cap just under the served fusion's cost: the check before the prepare counts the least a fusionMint costs,
  // so it lets the prepare be asked, and the served gas is what the cap refuses.
  const p = prepared()
  const served = costUsd(FEE, maxFeeAtomic(fusionMintTx(liveWallet.address, p, { feeAtomic: FEE, nonces: [101, 102, 103], positionChoice: 0, now: new Date() })), { egldUsd: 4.5, foxsyUsd: 0.00225 })
  const capped = agentWith({ dailyCapUsd: served - 0.0001 }, () => p)
  const c = await capped.live(spares())
  assert.equal(c.status, 'refused', c.summary)
  assert.match(c.summary, /daily cap/)
  assert.equal(capped.asked(), 1, 'the check before the prepare refused what only the served gas decides')
  assert.equal(capped.signed(), 0)
  assert.equal(capped.booked(false).length, 0)
})

test('R73A-2: the gas counted before a prepare is the least a signable fusionMint costs (live) and the most (dry run)', () => {
  const now = new Date()
  const expect = { feeAtomic: FEE, nonces: [101, 102, 103], positionChoice: 0, now }
  const fee = (o: Parameters<typeof prepared>[0]) => maxFeeAtomic(fusionMintTx(liveWallet.address, prepared(o), expect))
  // The extremes fusionMintTx still signs: one byte or 500 bytes of new card and attributes, gas at the band's floor or ceiling.
  const smallest = fee({ output: '00', attrs: ['00', '00', '00'], gas: tx.FUSION_MINT_GAS.floor })
  const largest = fee({ output: 'ff'.repeat(500), attrs: ['ff'.repeat(500), 'ff'.repeat(500), 'ff'.repeat(500)], gas: tx.FUSION_MINT_GAS.ceiling })
  const bound = (b: 'least' | 'most') => maxFeeAtomic(tx.fusionMintBound(liveWallet.address, FEE, [101, 102, 103], 0, b, now))
  assert.ok(bound('least') <= smallest, `least ${bound('least')} above the smallest signable ${smallest}`)
  assert.ok(bound('most') >= largest, `most ${bound('most')} below the largest signable ${largest}`)
  assert.ok(bound('least') <= fee({}) && fee({}) <= bound('most'), 'FoxLeague\'s usual answer lies between the two')
})
