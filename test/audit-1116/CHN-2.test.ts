// CHN-2: a relay refusal that proves nothing left the wallet (FoxLeague's guards before its broadcast: HTTP 403, 409,
// 429, 503 in its own envelope; routes/onboarding.rs relay_registration, executor.ts RELAY_REFUSED_BEFORE_BROADCAST)
// releases the booking, but the action still ends marked `sent`: executor.ts sets `booking.sent = true` before the
// relay is asked (:982) and the guard branch (:990-993) unbooks without taking it back, where the gateway's definite
// refusal in send() does take it back (:901 `booking.sent = sentBefore`). `sent` means "a payment was signed and handed
// to the network or the relay: with an error, its outcome is unclear" (ExecutionResult.sent): the row of the refusal
// carries `sent: true` and service.ts:430 sends its text at once as a payment with an unclear outcome, in quiet hours too.

import test from 'node:test'
import assert from 'node:assert/strict'
import { Executor, type ExecutionResult } from '../../src/executor/executor.ts'
import { ApiRefusal, type FoxLeague } from '../../src/foxleague/api.ts'
import { Store } from '../../src/store/db.ts'
import type { Chain } from '../../src/chain/gateway.ts'
import type { Config } from '../../src/config.ts'
import { ADDR, TEST_SETTINGS, liveWallet, producingBlocks, snapshot, withLive } from '../fixtures.ts'

async function relayRefuses(status: number, error: string): Promise<{ result: ExecutionResult; row: Record<string, unknown>; booked: number }> {
  const store = new Store('', ':memory:')
  store.addAgent(0, ADDR)
  store.updateSettings(0, TEST_SETTINGS)
  const chain = { ...producingBlocks, account: async () => ({ nonce: 7, balance: 10n ** 19n }), simulate: async () => ({ ok: true, detail: 'success', raw: {} }) } as unknown as Chain
  const fox = {
    nameAvailable: async () => ({ available: true }),
    // FoxLeague's own refusal (its envelope) with the status of a guard that runs before the broadcast.
    relay: async () => { throw new ApiRefusal(error, undefined, undefined, status) },
    register: async () => assert.fail('no team is named after a refused relay'),
  } as unknown as FoxLeague
  const exec = new Executor({ cfg: {} as Config, chain, fox, store })
  const s = snapshot()
  s.registration = { ...s.registration, registered: false, feePaidOnChain: false }
  s.config!.relayer_addresses = [ADDR]
  return await withLive(store, async () => {
    const [r] = await exec.run(store.agent(0)!, liveWallet, s, [{ action: { type: 'register', team_name: 'Lyon Rovers' }, reason: '' }])
    const row = store.db.prepare("SELECT detail FROM activity WHERE agent_idx = 0 AND kind = 'register' ORDER BY id DESC LIMIT 1").get() as { detail: string }
    return { result: r!, row: JSON.parse(row.detail) as Record<string, unknown>, booked: store.spentUsd(0, { category: 'setup', dryRun: false }) }
  })
}

test('CHN-2: a relay guard refusal before the broadcast (409, 403, 429, 503) is not a payment with an unclear outcome: neither the result nor its row says sent', async () => {
  for (const [status, error] of [
    [409, 'Your registration payment is already on its way. Nothing new was sent. Wait until it is final before you try again.'],
    [403, 'wallet holds 0 FOXSY but the registration fee is 5000 FOXSY'],
    [429, 'Too many relay requests. Please wait.'],
    [503, 'The registration relay is not available right now.'],
  ] as const) {
    const { result, row, booked } = await relayRefuses(status, error)
    assert.equal(result.status, 'error')
    assert.equal(booked, 0, `HTTP ${status}: the booking is released (nothing left the wallet)`)
    assert.notEqual(result.sent, true, `HTTP ${status}: the result is marked sent although the relay refused before its broadcast: ${result.summary}`)
    assert.notEqual(row.sent, true, `HTTP ${status}: the activity row is marked sent`)
  }
})
