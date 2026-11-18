// FoxLeague mainnet of 13 Nov 2026, FL13-1: the relay's 409 is a refusal before any broadcast.
// FoxLeague #717 (a11f536eb, "the relayer pays no gas for relays that cannot succeed") gave its relay two new guards that
// answer HTTP 409 in its own envelope before anything is signed or sent (next-foxleague origin/main
// backend/src/routes/onboarding.rs relay_registration): G17, a relayed registration of this wallet still in flight ("Your
// registration payment is already on its way. Nothing new was sent."), and G16, another transaction of the wallet waiting
// in the pool ("Your wallet has another transaction still being processed. Nothing was sent."). Its own app lists
// [400, 403, 409, 429, 503] as refused before broadcast (frontend/src/lib/signingNonce.ts
// RELAY_REFUSED_BEFORE_BROADCAST_STATUSES). The agent knew only 403, 429 and 503, so a 409 kept the 5,000 FOXSY fee
// booked and told the owner the payment "may have gone out". (A 400 stays on the careful side, as MONEY-3 pins it.)
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Executor } from '../../src/executor/executor.ts'
import { FoxLeague } from '../../src/foxleague/api.ts'
import { Store } from '../../src/store/db.ts'
import type { Chain } from '../../src/chain/gateway.ts'
import type { Config } from '../../src/config.ts'
import { ADDR, TEST_SETTINGS, liveWallet, producingBlocks, snapshot, withLive } from '../fixtures.ts'

async function relayAnswers(status: number, body: string): Promise<{ booked: number; summary: string }> {
  const server = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      if (req.url === '/api/auth/verify') return void res.end(JSON.stringify({ success: true, data: { token: 't' } }))
      if (req.url?.startsWith('/api/register/name-available')) return void res.end(JSON.stringify({ success: true, data: { available: true } }))
      res.statusCode = req.url === '/api/onboarding/relay' ? status : 404
      res.end(req.url === '/api/onboarding/relay' ? body : '{}')
    })
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  try {
    const fox = new FoxLeague(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 50)
    const store = new Store('', ':memory:')
    store.addAgent(0, ADDR)
    store.updateSettings(0, TEST_SETTINGS)
    const chain = { ...producingBlocks, account: async () => ({ nonce: 7, balance: 10n ** 19n }), simulate: async () => ({ ok: true, detail: 'success', raw: {} }) } as unknown as Chain
    const exec = new Executor({ cfg: {} as Config, chain, fox, store })
    const s = snapshot()
    s.registration = { ...s.registration, registered: false, feePaidOnChain: false }
    s.config!.relayer_addresses = [ADDR]
    const wallet = { ...liveWallet, signMessage: () => 'ab'.repeat(64) }
    return await withLive(store, async () => {
      const [r] = await exec.run(store.agent(0)!, wallet, s, [{ action: { type: 'register', team_name: 'Lyon Rovers' }, reason: '' }])
      assert.equal(r!.status, 'error')
      return { booked: store.spentUsd(0, { category: 'setup', dryRun: false }), summary: r!.summary }
    })
  } finally {
    server.close()
  }
}

test('FL13-1: a relay refusal with HTTP 409 (a relay in flight, another transaction in the pool) releases the booking: nothing was sent', async () => {
  for (const error of [
    'Your registration payment is already on its way. Nothing new was sent. Wait until it is final before you try again.',
    'Your wallet has another transaction still being processed. Nothing was sent. Wait until it is final, then sign the registration again.',
  ]) {
    const { booked, summary } = await relayAnswers(409, JSON.stringify({ success: false, error }))
    assert.equal(booked, 0, `HTTP 409: ${summary}`)
    assert.doesNotMatch(summary, /may have gone out/, summary)
  }
})

test('FL13-1: a 409 that is not FoxLeague\'s envelope is no word of FoxLeague\'s and releases nothing', async () => {
  const { booked, summary } = await relayAnswers(409, JSON.stringify({ title: 'Conflict', status: 409 }))
  assert.ok(booked > 0, `HTTP 409 without the envelope: ${summary}`)
})
