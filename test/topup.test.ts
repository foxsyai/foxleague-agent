import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Store } from '../src/store/db.ts'
import { TopUps, TOPUP_CODE_MINUTES, type TopUpDeps } from '../src/topup.ts'
import { BinanceError, egldText, questionnaireFor, withdrawalAmount, type EgldOnBinance } from '../src/cex/binance.ts'
import { ADDR } from './fixtures.ts'

const NET: EgldOnBinance = { free: 500, network: 'EGLD', withdrawEnable: true, fee: 0.002, min: 0.02, max: 10_000, multiple: 0.00000001 }

/** Top-ups over a stand-in Binance: `withdrawals` records every withdrawal asked for, `sent` every Telegram text. */
function rig(over: Partial<TopUpDeps> & { net?: Partial<EgldOnBinance>; country?: string; withdraw?: TopUpDeps['binance']['withdrawEgld']; listed?: boolean; found?: TopUpDeps['binance']['findWithdrawal'] } = {}) {
  const store = new Store('', ':memory:')
  store.addAgent(0, ADDR)
  // A fixed monthly budget, so the proposals below do not move with the level defaults.
  store.updateSettings(0, { monthlyBudgetUsd: 300 })
  store.setLiveMode(true)
  const withdrawals: { address: string; amount: string; orderId: string; network: string; questionnaire?: string }[] = []
  const sent: string[] = []
  let clock = Date.parse('2026-10-09T10:00:00Z')
  const t = new TopUps({
    store,
    key: () => ({ apiKey: 'k', secret: 's' }),
    accountType: () => 'corporate',
    live: () => store.liveMode,
    binance: {
      egldOnBinance: async () => ({ ...NET, ...over.net }),
      travelRuleCountry: async () => over.country ?? 'NIL',
      withdrawEgld: over.withdraw ?? (async (_k, w) => (withdrawals.push(w), 'bn-1')),
      findWithdrawal: over.found ?? (async () => null),
      whitelisted: async () => over.listed ?? true,
    },
    send: text => sent.push(text),
    now: () => clock,
    wait: async () => undefined,
    ...over,
  })
  const code = () => /\/topup (\d{6})\b/.exec(sent.at(-1) ?? '')?.[1] ?? ''
  return { store, t, withdrawals, sent, code, agent: () => store.agent(0)!, tick: (ms: number) => (clock += ms) }
}

test('top-up amounts: what should arrive plus the fee, rounded up to Binance multiple, at least its minimum, never over its maximum', () => {
  assert.equal(withdrawalAmount(10, NET), 10.002)
  assert.equal(withdrawalAmount(0.001, NET), 0.02, 'the minimum')
  assert.equal(withdrawalAmount(1.23456, { ...NET, multiple: 0.001 }), 1.237)
  assert.equal(withdrawalAmount(20_000, NET), null)
  assert.equal(egldText(10.0020000001), '10.002')
  assert.equal(egldText(3), '3')
})

test('top-up questionnaire: none without the Travel Rule, the EU form to my own private wallet, anything else refused', () => {
  assert.deepEqual(questionnaireFor('NIL', undefined), {})
  assert.deepEqual(JSON.parse((questionnaireFor('RO', 'individual') as { questionnaire: string }).questionnaire), { isAddressOwner: 1, bnfType: 0, sendTo: 1, declaration: true })
  assert.equal(JSON.parse((questionnaireFor('FR', 'corporate') as { questionnaire: string }).questionnaire).bnfType, 1)
  assert.match((questionnaireFor('RO', undefined) as { refusal: string }).refusal, /BINANCE_ACCOUNT_TYPE/)
  assert.match((questionnaireFor('JP', 'individual') as { refusal: string }).refusal, /Travel Rule questionnaire of JP/)
})

test('top-up offer: brings the agent to its monthly budget, holds a one-time code that is never stored in clear, once a day when low', async () => {
  const { store, t, sent, code, agent, tick } = rig()
  assert.equal(await t.offer(agent(), 8, 4.5, 'low'), 'top-up offered for agent 1')
  const text = sent[0]!
  assert.match(text, /agent 1 needs a top-up/)
  assert.match(text, /about \$8\.00 to play with \(its warning is at \$10\.00\)/)
  // (300 - 8) / 4.5 = 64.888... EGLD to arrive, plus the 0.002 fee.
  assert.match(text, /Proposed: 64\.89088889 EGLD from Binance \(about \$292\.01\), so it has about \$300\.00 to play with, its monthly budget/)
  assert.match(text, new RegExp(`works once, for ${TOPUP_CODE_MINUTES} minutes`))
  assert.ok(code().length === 6)
  assert.doesNotMatch(store.getKv('topups')!, new RegExp(code()), 'only a hash of the code is kept')
  assert.equal(await t.offer(agent(), 8, 4.5, 'low'), '', 'a code still open: no second offer from the warning')
  tick(TOPUP_CODE_MINUTES * 60_000 + 1)
  assert.equal(await t.offer(agent(), 8, 4.5, 'low'), '', 'still low: offered again only after a day')
  assert.match(await t.offer(agent(), 8, 4.5, 'owner'), /top-up, as you asked/, 'the owner may ask at once')
})

test('top-up offer: none in dry run, without a key, with the kill switch on, for a retired agent or one already at its budget', async () => {
  const a = rig()
  a.store.setLiveMode(false)
  assert.match(await a.t.offer(a.agent(), 8, 4.5, 'owner'), /only in LIVE mode/)
  const b = rig({ key: () => null })
  assert.match(await b.t.offer(b.agent(), 8, 4.5, 'owner'), /no Binance key/)
  const c = rig()
  c.store.setKillSwitch(true)
  assert.match(await c.t.offer(c.agent(), 8, 4.5, 'owner'), /kill switch/)
  const d = rig()
  d.store.retireAgent(0, { at: '', by: 'owner', team: null, egld: null, foxsy: null, usd: null })
  assert.match(await d.t.offer(d.agent(), 8, 4.5, 'owner'), /retired: restore it first/)
  const e = rig()
  assert.match(await e.t.offer(e.agent(), 300, 4.5, 'owner'), /no top-up needed/)
  for (const x of [a, b, c, d, e]) assert.deepEqual(x.sent, [])
})

test('top-up approval: the code works once, withdraws to the agent wallet with the EU questionnaire, a smaller amount may be chosen', async () => {
  const r = rig({ country: 'RO' })
  const offer = await r.t.offer(r.agent(), 8, 4.5, 'owner')
  assert.match(await r.t.listText(), /agent 1: 64\.89088889 EGLD from Binance, waiting for its code/)
  assert.match(await r.t.approve('000000'), /No open top-up has this code/)
  const code = /\/topup (\d{6})\b/.exec(offer)![1]!
  assert.match(await r.t.approve(code, '100'), /more than the 64\.89088889 EGLD proposed. The code still works/)
  assert.match(await r.t.approve(code, 'ten'), /not an EGLD amount. The code still works/)
  assert.equal(r.withdrawals.length, 0, 'refused before Binance')
  const code2 = code
  assert.match(await r.t.approve(code2, '20'), /^Done: top-up of 20 EGLD sent from Binance to agent 1/)
  assert.equal(r.withdrawals.length, 1)
  const w = r.withdrawals[0]!
  assert.deepEqual([w.address, w.amount, w.network], [ADDR, '20', 'EGLD'])
  assert.match(w.orderId, /^fla1-[0-9a-f]{12}$/)
  assert.deepEqual(JSON.parse(w.questionnaire!), { isAddressOwner: 1, bnfType: 1, sendTo: 1, declaration: true })
  assert.match(await r.t.approve(code2), /No open top-up has this code/, 'a code works once')
  assert.equal(r.withdrawals.length, 1)
  assert.ok(r.store.activity(0, 10).some(a => a.kind === 'topup' && a.status === 'confirmed'))
})

test('top-up approval: an expired code, too little on Binance or a Binance refusal moves nothing', async () => {
  const a = rig()
  const code = /\/topup (\d{6})\b/.exec(await a.t.offer(a.agent(), 8, 4.5, 'owner'))![1]!
  a.tick(TOPUP_CODE_MINUTES * 60_000 + 1)
  assert.match(await a.t.approve(code), /No open top-up has this code/)
  const b = rig({ net: { free: 10 } })
  const codeB = /\/topup (\d{6})\b/.exec(await b.t.offer(b.agent(), 8, 4.5, 'owner'))![1]!
  assert.match(await b.t.approve(codeB), /Binance holds only 10 EGLD on spot/)
  const c = rig({ withdraw: async () => { throw new BinanceError('Address not in whitelist', -4026, true) } })
  const codeC = /\/topup (\d{6})\b/.exec(await c.t.offer(c.agent(), 8, 4.5, 'owner'))![1]!
  assert.match(await c.t.approve(codeC), /not sent: Binance refused it: Address not in whitelist. Nothing left Binance/)
  for (const x of [a, b]) assert.deepEqual(x.withdrawals, [])
})

test('top-up approval: a lost answer is looked up by its order id and never sent again; until it is known no new offer', async () => {
  let calls = 0
  const r = rig({ withdraw: async () => { calls++; throw new BinanceError('Binance did not answer (timeout)', undefined, false) } })
  const code = /\/topup (\d{6})\b/.exec(await r.t.offer(r.agent(), 8, 4.5, 'owner'))![1]!
  assert.match(await r.t.approve(code), /may have gone out. Check Binance's withdrawal history for order fla1-/)
  assert.equal(calls, 1, 'sent once, never again by itself')
  assert.match(await r.t.offer(r.agent(), 8, 4.5, 'owner'), /outcome is not known/)
  const found = rig({ withdraw: async () => { throw new BinanceError('HTTP 502', undefined, false) } })
  ;(found.t as unknown as { d: TopUpDeps }).d.binance.findWithdrawal = async (_k, orderId) => ({ id: `bn-${orderId}`, status: 4 })
  const codeF = /\/topup (\d{6})\b/.exec(await found.t.offer(found.agent(), 8, 4.5, 'owner'))![1]!
  assert.match(await found.t.approve(codeF), /^Done: .* Binance id bn-fla1-/)
})

test('top-up review fixes: a request left sending by a restart is settled on Binance, never stuck; a cancelled or rejected one is not called sent', async () => {
  const r = rig()
  const code = /\/topup (\d{6})\b/.exec(await r.t.offer(r.agent(), 8, 4.5, 'owner'))![1]!
  // The process ends while the approval talks to Binance: the request stays 'sending' in the database.
  // The approval wrote the time of its attempt with the claim (ATTACK-3 of 2026-11-11: the 30 minutes run from it).
  const list = JSON.parse(r.store.getKv('topups')!) as { status: string; id: string; attemptedAt?: string }[]
  list[0]!.status = 'sending'
  list[0]!.attemptedAt = '2026-10-09T10:00:00.000Z'
  r.store.setKv('topups', JSON.stringify(list))
  void code
  assert.match(await r.t.offer(r.agent(), 8, 4.5, 'owner'), /outcome is not known yet/)
  r.tick(29 * 60_000)
  assert.deepEqual(await r.t.settleUnclear(), [], 'not known yet')
  r.tick(2 * 60_000)
  assert.match((await r.t.settleUnclear()).join('\n'), /Binance has no withdrawal for order fla1-.*never went out/)
  assert.match(await r.t.offer(r.agent(), 8, 4.5, 'owner'), /top-up, as you asked/, 'top-ups work again')

  const found = rig({ found: async (_k, id) => ({ id: `bn-${id}`, status: 4 }) })
  await found.t.offer(found.agent(), 8, 4.5, 'owner')
  const l2 = JSON.parse(found.store.getKv('topups')!) as { status: string }[]
  l2[0]!.status = 'sending'
  found.store.setKv('topups', JSON.stringify(l2))
  assert.match(await found.t.listText(), /did go out \(Binance id bn-fla1-/)

  const rejected = rig({ withdraw: async () => { throw new BinanceError('HTTP 503', undefined, false) }, found: async (_k, id) => ({ id: `bn-${id}`, status: 3 }) })
  const codeR = /\/topup (\d{6})\b/.exec(await rejected.t.offer(rejected.agent(), 8, 4.5, 'owner'))![1]!
  assert.match(await rejected.t.approve(codeR), /not sent: Binance rejected it \(status 3\)/)
})

test('top-up review fixes: a typed amount is sent as typed, under the minimum or off the whitelist the code still works, /topup N replaces an open code', async () => {
  assert.equal(withdrawalAmount(0.28 - 0.002, NET), 0.28)
  assert.equal(withdrawalAmount(16.78 - 0.002, { ...NET, multiple: 0.000001 }), 16.78)
  const r = rig({ listed: false })
  const offer = await r.t.offer(r.agent(), 8, 4.5, 'owner')
  assert.match(offer, /not on your Binance withdrawal whitelist yet/)
  const code = /\/topup (\d{6})\b/.exec(offer)![1]!
  assert.match(await r.t.approve(code, '0.001'), /0\.001 EGLD is under Binance's minimum withdrawal of 0\.02 EGLD\. Nothing left Binance; the code still works/)
  assert.match(await r.t.approve(code, '0.28'), /not on your Binance withdrawal whitelist.*the code still works/)
  assert.equal(r.withdrawals.length, 0)
  const again = await r.t.offer(r.agent(), 8, 4.5, 'owner')
  const code2 = /\/topup (\d{6})\b/.exec(again)![1]!
  assert.match(await r.t.approve(code), /No open top-up has this code/, 'the old code stops working')
  assert.notEqual(code2, '')
  const ok = rig()
  const codeOk = /\/topup (\d{6})\b/.exec(await ok.t.offer(ok.agent(), 8, 4.5, 'owner'))![1]!
  assert.match(await ok.t.approve(codeOk, '0.28'), /^Done: top-up of 0\.28 EGLD/)
  assert.equal(ok.withdrawals[0]!.amount, '0.28')
})
