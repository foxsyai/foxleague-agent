// Audit 2026-11-11 (Fable 5.2 reviewers at extra-high effort): the proof of ATTACK-3 (the same finding as EDGE-2), failing before its fix.
// A Binance top-up whose answer was lost ("may have gone out") is declared "never went out, ask again" once Binance
// shows no such order 30 minutes on (R11-1). The 30 minutes were counted from when the request was CREATED
// (r.createdAt), not from when the withdrawal was asked. A code works for 60 minutes, so an approval in the second
// half hour got no wait at all: seconds after a timed-out withdrawal the owner was told it never went out and to
// ask again, and a second approval sent a second withdrawal while the first could still land.
// Safe behaviour: the 30 minutes run from the moment the withdrawal was attempted.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BinanceError, type EgldOnBinance } from '../../src/cex/binance.ts'
import { Store } from '../../src/store/db.ts'
import { TopUps, type TopUpDeps, type TopUpRequest } from '../../src/topup.ts'
import { ADDR } from '../fixtures.ts'

const NET: EgldOnBinance = { free: 500, network: 'EGLD', withdrawEnable: true, fee: 0.002, min: 0.02, max: 10_000, multiple: 0.00000001 }

/** Top-ups over a stand-in Binance that takes the withdrawal and loses the answer; its history lists nothing. */
function rig(over: Partial<TopUpDeps['binance']> = {}) {
  const store = new Store('', ':memory:')
  store.addAgent(0, ADDR)
  store.updateSettings(0, { monthlyBudgetUsd: 300 })
  store.setLiveMode(true)
  let clock = Date.parse('2026-11-11T10:00:00Z')
  const withdrawals: { amount: string; orderId: string }[] = []
  const sent: string[] = []
  const t = new TopUps({
    store,
    key: () => ({ apiKey: 'k', secret: 's' }),
    accountType: () => 'corporate',
    live: () => store.liveMode,
    binance: {
      egldOnBinance: async () => NET,
      travelRuleCountry: async () => 'NIL',
      withdrawEgld: async (_k, w) => {
        withdrawals.push(w)
        throw new BinanceError('Binance did not answer (timeout)', undefined, false)
      },
      findWithdrawal: async () => null,
      whitelisted: async () => true,
      ...over,
    },
    send: text => void sent.push(text),
    now: () => clock,
    wait: async () => undefined,
  })
  const kept = () => JSON.parse(store.getKv('topups')!) as TopUpRequest[]
  return { store, t, withdrawals, sent, kept, agent: () => store.agent(0)!, tick: (ms: number) => (clock += ms), now: () => clock }
}
const codeOf = (text: string) => /\/topup (\d{6})\b/.exec(text)![1]!

test('ATTACK-3 a top-up approved late in its code hour and answered by a timeout is not called "never went out" ten seconds later', async () => {
  const r = rig()
  const code = codeOf(await r.t.offer(r.agent(), 8, 4.5, 'owner'))
  r.tick(50 * 60_000) // the owner reads Telegram 50 minutes later; the code works for 60
  assert.match(await r.t.approve(code), /may have gone out/)
  assert.equal(r.withdrawals.length, 1)

  r.tick(10_000) // ten seconds later the owner asks again
  const again = await r.t.offer(r.agent(), 8, 4.5, 'owner')
  const second = /\/topup (\d{6})\b/.exec(await r.t.offer(r.agent(), 8, 4.5, 'owner'))?.[1]
  if (second) await r.t.approve(second)
  assert.doesNotMatch(again, /never went out/, `ten seconds after a withdrawal that "may have gone out" the owner was told: "${again}"; asking again then sent ${r.withdrawals.length} withdrawals in all (orders ${r.withdrawals.map(w => w.orderId).join(', ')})`)
  assert.match(again, /outcome is not known/)
  assert.equal(r.withdrawals.length, 1, 'no second withdrawal while the first may still land')

  // The rule itself: unknown until 30 minutes after the withdrawal was asked, then "never went out".
  r.tick(29 * 60_000)
  assert.deepEqual(await r.t.settleUnclear(), [], '29 minutes and 10 seconds after the attempt: still not known')
  assert.equal(r.kept()[0]!.status, 'unknown')
  r.tick(60_000)
  assert.match((await r.t.settleUnclear()).join('\n'), /never went out/, 'past 30 minutes after the attempt')
  assert.equal(r.kept()[0]!.status, 'failed')
})

test('EDGE-2 the same through /topup: approved 40 minutes after its offer, the list keeps the unknown outcome', async () => {
  const r = rig()
  await r.t.offer(r.agent(), 8, 4.5, 'low')
  const code = codeOf(r.sent.at(-1)!)
  r.tick(40 * 60_000)
  assert.match(await r.t.approve(code), /may have gone out/, 'the approval itself says the outcome is unknown')
  r.tick(10_000) // ten seconds later the owner sends /topup, as the message told them to
  const list = await r.t.listText()
  assert.doesNotMatch(list, /never went out/, 'ten seconds after the withdrawal was asked, "Binance has no such withdrawal" is no proof that it never went out')
  assert.equal(r.kept()[0]!.status, 'unknown', 'the request keeps its unknown outcome until 30 minutes after the withdrawal was asked')
})

test('ATTACK-3b the time of the attempt is the last approval\'s: a code that was reopened and approved again starts its 30 minutes anew', async () => {
  let listed = false
  const r = rig({ whitelisted: async () => listed })
  const code = codeOf(await r.t.offer(r.agent(), 8, 4.5, 'owner'))
  r.tick(5 * 60_000)
  assert.match(await r.t.approve(code), /not on your Binance withdrawal whitelist.*the code still works/, 'nothing was asked of Binance: the code stays')
  listed = true
  r.tick(40 * 60_000) // the owner adds the wallet to the whitelist and approves at minute 45
  assert.match(await r.t.approve(code), /may have gone out/)
  r.tick(26 * 60_000) // 31 minutes after the first approval, 26 after the withdrawal
  assert.deepEqual(await r.t.settleUnclear(), [])
  assert.equal(r.kept()[0]!.status, 'unknown')
})

test('ATTACK-3c a request kept by an earlier version (no time of the attempt) counts its 30 minutes from the end of its code hour, the latest it can have been sent', async () => {
  const r = rig()
  await r.t.offer(r.agent(), 8, 4.5, 'owner')
  // What an earlier version left behind after a restart in the middle of an approval: 'sending', no time of the attempt.
  const list = r.kept()
  list[0]!.status = 'sending'
  r.store.setKv('topups', JSON.stringify(list))
  assert.equal(Object.keys(list[0]!).some(k => /sending|attempt/i.test(k) && k !== 'status'), false, 'the old row has no such field')
  r.tick(89 * 60_000) // 29 minutes after its code hour ended
  assert.deepEqual(await r.t.settleUnclear(), [])
  r.tick(2 * 60_000)
  assert.match((await r.t.settleUnclear()).join('\n'), /never went out/)
})
