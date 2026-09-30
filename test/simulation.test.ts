import { test } from 'node:test'
import assert from 'node:assert/strict'
import { interpretSimulation } from '../src/chain/gateway.ts'

// Shapes captured from gateway.multiversx.com /transaction/simulate on 2026-09-28 (trimmed).
const intraOk = { result: { status: 'success', scResults: {}, logs: { events: [{ identifier: 'shopPay', topics: ['c2hvcF9wYWlk'] }] } } }
const intraFail = { result: { status: 'fail', failReason: 'user error', hash: 'x' } }
const crossSenderFails = {
  result: {
    receiverShard: { status: 'success', scResults: {}, logs: { events: [{ identifier: 'shopPay' }] } },
    senderShard: { status: 'fail', failReason: 'failed transaction, gas consumed', hash: 'x' },
  },
}
const crossOk = { result: { senderShard: { status: 'success' }, receiverShard: { status: 'success' } } }
const crossRevert = {
  result: {
    senderShard: { status: 'success' },
    receiverShard: { status: 'success', logs: { events: [{ identifier: 'signalError', topics: ['AAAA', Buffer.from('No entry to refund').toString('base64')] }] } },
  },
}

test('intra-shard success and failure', () => {
  assert.equal(interpretSimulation(intraOk).ok, true)
  assert.deepEqual([interpretSimulation(intraFail).ok, interpretSimulation(intraFail).detail], [false, 'user error'])
})

test('cross-shard: a sender-shard failure fails even when the contract side succeeds', () => {
  const r = interpretSimulation(crossSenderFails)
  assert.equal(r.ok, false)
  assert.match(r.detail, /senderShard: failed transaction/)
  assert.equal(interpretSimulation(crossOk).ok, true)
})

test('signalError anywhere is a revert with its message', () => {
  const r = interpretSimulation(crossRevert)
  assert.equal(r.ok, false)
  assert.equal(r.detail, 'revert: No entry to refund')
})

test('fail closed on missing status or unknown shape', () => {
  assert.equal(interpretSimulation({ result: {} }).ok, false)
  assert.equal(interpretSimulation({}).ok, false)
})
