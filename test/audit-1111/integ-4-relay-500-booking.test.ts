// Audit 2026-11-11 (Fable 5.2 reviewers at extra-high effort): the proof of INTEG-4, failing before its fix.
// INTEG-4: a relayed registration whose broadcast FoxLeague could not confirm is un-booked as "nothing left the wallet".
// FoxLeague's relay answers HTTP 500 with its JSON envelope when broadcast_raw returns an error
// (next-foxleague origin/main backend/src/routes/onboarding.rs:2723-2746, step=gateway_broadcast_failed:
//   return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(relay_err(relay_broadcast_refusal_text(&e)))))
// with RELAY_NOT_SENT = "The registration could not be sent to the network. Please try again in a moment." (:1973)).
// A broadcast error is no proof nothing went out: a gateway that timed out or answered 5xx after it took the
// transaction has broadcast it (FoxLeague says so of its own sends, backend/src/routes/shop.rs:2705: "A submit error
// can come after the node accepted the withdraw"), and the agent itself keeps its own unclear broadcasts booked
// (src/executor/executor.ts:773-787). But src/foxleague/api.ts:98-102 turns ANY JSON envelope with success:false into an
// ApiRefusal whatever the HTTP status, and the register path releases the booking on every ApiRefusal
// (src/executor/executor.ts:867-870: "An explicit refusal means the backend did not broadcast").
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

test('INTEG-4: the registration fee stays booked when FoxLeague answers the relay with its HTTP 500 "could not be sent" (the broadcast may have gone out)', async () => {
  const asked: string[] = []
  const server = createServer((req, res) => {
    asked.push(`${req.method} ${req.url}`)
    req.resume()
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      if (req.url === '/api/auth/verify') return void res.end(JSON.stringify({ success: true, data: { token: 't' } }))
      if (req.url?.startsWith('/api/register/name-available')) return void res.end(JSON.stringify({ success: true, data: { available: true } }))
      if (req.url === '/api/onboarding/relay') {
        // onboarding.rs:2743-2746, byte for byte what the handler returns after a failed broadcast_raw.
        res.statusCode = 500
        return void res.end(JSON.stringify({ success: false, error: 'The registration could not be sent to the network. Please try again in a moment.' }))
      }
      res.statusCode = 404
      res.end('{}')
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
    s.config!.relayer_addresses = [ADDR] // a relayer on the wallet's shard
    const wallet = { ...liveWallet, signMessage: () => 'ab'.repeat(64) }
    await withLive(store, async () => {
      const [r] = await exec.run(store.agent(0)!, wallet, s, [{ action: { type: 'register', team_name: 'Lyon Rovers' }, reason: '' }])
      assert.ok(asked.includes('POST /api/onboarding/relay'), 'the signed registration reached the relay')
      assert.equal(r!.status, 'error')
      // The signed registerAndPay was handed to FoxLeague, whose broadcast failed in a way that does not say it never
      // went out: 5,000 FOXSY may have left the wallet, so the booking must stay (the conservative side, AGENTS.md rule 3).
      const booked = store.spentUsd(0, { category: 'setup', dryRun: false })
      assert.ok(booked > 0, `the 5,000 FOXSY registration fee is no longer in the ledger ($${booked} booked) although the relayed transaction may have gone out`)
    })
  } finally {
    server.close()
  }
})

// Added with the fix: through the real client, the HTTP status FoxLeague's relay gives its own refusal decides. Its
// guards before the broadcast (403, 429, 503 in its envelope, onboarding.rs) release the booking; the same statuses
// on a body that is not its envelope (an edge in front of it) are no word of FoxLeague's and release nothing.
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

test('INTEG-4: a guard of the relay (403, 429, 503 in FoxLeague\'s envelope) still releases the booking: nothing was broadcast', async () => {
  for (const status of [403, 429, 503]) {
    const { booked, summary } = await relayAnswers(status, JSON.stringify({ success: false, error: 'G10: relayer daily cap 5000 reached' }))
    assert.equal(booked, 0, `HTTP ${status}: ${summary}`)
  }
})

test('INTEG-4: the same statuses on an answer that is not FoxLeague\'s envelope release nothing', async () => {
  for (const status of [403, 503]) {
    const { booked, summary } = await relayAnswers(status, JSON.stringify({ title: 'Access denied', status }))
    assert.ok(booked > 0, `HTTP ${status}: ${summary}`)
  }
})
