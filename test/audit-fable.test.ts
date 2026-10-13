// Findings of the 2026-10-11 Fable audit (web, auth, Telegram). One test per finding, named after it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoundedQueue, hashPassword, verifyPassword, verifyPasswordAsync } from '../src/web/auth.ts'
import { cookies } from '../src/web/server.ts'
import { MODELS, isKnownModel, strategistChoice } from '../src/strategist/strategist.ts'
import { FORWARD_IGNORED, isForwarded } from '../src/telegram/telegram.ts'
import { Store } from '../src/store/db.ts'
import type { Config } from '../src/config.ts'

test('F-S1 login hashing is off the event loop and bounded: same answers as the sync check, extra waiters are turned away', async () => {
  const h = hashPassword('correct horse battery')
  assert.equal(await verifyPasswordAsync('correct horse battery', h), verifyPassword('correct horse battery', h))
  assert.equal(await verifyPasswordAsync('wrong', h), false)
  assert.equal(await verifyPasswordAsync('x', 'garbage'), false)
  assert.equal(await verifyPasswordAsync('x', 'bcrypt$a$b'), false)

  const q = new BoundedQueue(2)
  let running = 0
  let overlap = 0
  const job = async () => {
    running++
    overlap = Math.max(overlap, running)
    await new Promise(r => setTimeout(r, 15))
    running--
    return 'done'
  }
  const results = await Promise.all([q.run(job), q.run(job), q.run(job), q.run(job)])
  assert.deepEqual(results, ['done', 'done', null, null], 'two accepted, the rest refused at once')
  assert.equal(overlap, 1, 'one hash at a time')
  assert.equal(await q.run(job), 'done', 'room again after the queue drains')

  // One address cannot take the queue: a flood from it is turned away while another address is still served.
  const byKey = new BoundedQueue(10, 1)
  const [a1, a2, b1] = await Promise.all([byKey.run(job, '203.0.113.7'), byKey.run(job, '203.0.113.7'), byKey.run(job, '198.51.100.2')])
  assert.deepEqual([a1, a2, b1], ['done', null, 'done'])
})

test('F-S2 a model id must be an own key of MODELS: constructor, __proto__ and toString are not models', () => {
  for (const bad of ['constructor', '__proto__', 'toString', 'hasOwnProperty', '']) assert.equal(isKnownModel(bad), false, bad)
  for (const good of Object.keys(MODELS)) assert.equal(isKnownModel(good), true, good)
  const store = new Store('', ':memory:')
  const cfg = { model: 'claude-sonnet-5-5' } as Config
  store.setKv('strategist_model', 'constructor')
  assert.equal(strategistChoice(store, cfg).model, 'claude-sonnet-5-5', 'a stored bad id falls back to the configured model')
})

test('F-S3 a forwarded message is not a command: any forward marker makes it ignored', () => {
  assert.equal(isForwarded({ text: '/kill off' }), false)
  assert.equal(isForwarded({ text: '/kill off', forward_origin: { type: 'channel' } }), true)
  assert.equal(isForwarded({ text: '/kill off', forward_date: 1 }), true)
  assert.equal(isForwarded({ text: '/kill off', forward_from: { id: 1 } }), true)
  assert.equal(isForwarded({ text: '/kill off', forward_from_chat: { id: -1 } }), true)
  assert.equal(isForwarded({ text: '/kill off', forward_sender_name: 'Hidden' }), true)
  // Markers Telegram may add later, and other ways words reach the chat that are not the owner's own.
  assert.equal(isForwarded({ text: '/kill off', forward_signature: 'x' }), true)
  assert.equal(isForwarded({ text: '/kill off', forward_from_message_id: 7 }), true)
  assert.equal(isForwarded({ text: '/kill off', is_automatic_forward: true }), true)
  assert.equal(isForwarded({ text: '/kill off', via_bot: { id: 5 } }), true)
  assert.equal(isForwarded({ text: '/kill off', external_reply: { chat: { id: 1 } } }), true)
  assert.equal(isForwarded({ text: '/kill off', forward_origin: undefined }), false, 'an absent marker is not a forward')
  assert.match(FORWARD_IGNORED, /not read/, 'the owner is told, not left waiting')
  assert.doesNotMatch(FORWARD_IGNORED, /\u2014/, 'no em dash in owner text')
})

test('F-S4 a malformed cookie is dropped, never thrown on', () => {
  const req = (cookie: string) => ({ headers: { cookie } }) as never
  assert.deepEqual(cookies(req('foxagent_session=%')), {})
  assert.deepEqual(cookies(req('a=%E0%A4%A; foxagent_session=abc%20def')), { foxagent_session: 'abc def' })
})

// Money, chain and orchestration findings of the same audit.
import { takeSnapshot } from '../src/snapshot/snapshot.ts'
import { ADDR, dryWallet, setup, snapshot } from './fixtures.ts'

test('F-M2 / F-O4 a profile that could not be read is not "not registered": no swap on the setup allowance, no register', async () => {
  const { exec, agent } = setup()
  const s = snapshot()
  s.registration = { ...s.registration, registered: false, feePaidOnChain: true, profileUnreadable: true }
  const swap = { action: { type: 'swap_egld_for_foxsy', foxsy: 1000 }, reason: '' } as const
  const reg = { action: { type: 'register', team_name: 'Fox Agent' }, reason: '' } as const
  const [a] = await exec.run(agent(), dryWallet, s, [swap])
  assert.equal(a!.status, 'refused')
  assert.match(a!.summary, /registration state could not be read/)
  const [b] = await exec.run(agent(), dryWallet, s, [reg])
  assert.match(b!.summary, /registration state could not be read/)
  // Control: a team that is really unregistered (profile answered "not found") is still allowed to swap for setup.
  s.registration = { ...s.registration, profileUnreadable: false }
  const [c] = await exec.run(agent(), dryWallet, s, [swap])
  assert.doesNotMatch(c!.summary, /could not be read/)
})

test('F-O1 balances that could not be read are not "0 FOXSY": the chain section is unknown, so no swap is planned on it', async () => {
  const down = async () => {
    throw new Error('timeout')
  }
  const chain = (esdts: () => Promise<unknown>) => ({ account: async () => ({ balance: 4n * 10n ** 18n, nonce: 3 }), esdts, egldUsd: async () => 25, query: down }) as never
  const fox = new Proxy({}, { get: () => down }) as never
  const broke = await takeSnapshot({ chain: chain(down), fox }, { watch: ADDR })
  assert.equal(broke.chain, null)
  assert.ok(broke.warnings.some(w => w.startsWith('esdts')))
  const fine = await takeSnapshot({ chain: chain(async () => []), fox }, { watch: ADDR })
  assert.equal(fine.chain?.foxsy, 0n, 'a wallet that really holds none still reads 0')
  assert.equal(fine.registration.profileUnreadable, true, 'the failed profile read is flagged, not read as unregistered')
})
