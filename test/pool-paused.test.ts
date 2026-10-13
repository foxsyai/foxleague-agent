// 2026-10-13 10:39 UTC: xExchange paused every pool at once. The FOXSY price still comes from the frozen reserves
// (nobody can trade, so it is the last real price), the plan is told, and no swap is quoted or sent.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PAIR_PAUSED, poolState, quoteEgldForFoxsy } from '../src/chain/xexchange.ts'
import { takeSnapshot } from '../src/snapshot/snapshot.ts'
import { numberToHex, wholeToAtomic } from '../src/util/encoding.ts'
import { ADDR } from './fixtures.ts'

const b64 = (n: bigint) => (n === 0n ? '' : Buffer.from(numberToHex(n), 'hex').toString('base64'))
const pair = (state: bigint) => {
  const answers: Record<string, string[]> = {
    getState: [b64(state)],
    getFirstTokenId: [Buffer.from('FOXSY-5d5f3e').toString('base64')],
    getSecondTokenId: [Buffer.from('WEGLD-bd4d79').toString('base64')],
    getReservesAndTotalSupply: [b64(wholeToAtomic(1_000_000)), b64(wholeToAtomic(500)), b64(1n)],
    getAmountIn: [b64(wholeToAtomic(1) / 2n)],
  }
  return { query: async (_sc: string, fn: string) => answers[fn] ?? assert.fail(`unexpected query ${fn}`) } as never
}

test('a paused pair still values FOXSY at its frozen reserves, but quotes no swap', async () => {
  const paused = await poolState(pair(0n))
  assert.equal(paused.active, false)
  assert.equal(paused.spotEgldPerFoxsy, 0.0005)
  await assert.rejects(quoteEgldForFoxsy(pair(0n), wholeToAtomic(1000), 100), new RegExp(PAIR_PAUSED.slice(0, 40)))
  assert.equal((await poolState(pair(1n))).active, true)
  assert.equal((await quoteEgldForFoxsy(pair(1n), wholeToAtomic(1000), 100)).amountIn, wholeToAtomic(1) / 2n)
})

test('the snapshot keeps its prices while the pair is paused and tells the plan that swaps are off', async () => {
  const down = async () => { throw new Error('not read in this test') }
  const chain = { ...(pair(0n) as object), account: async () => ({ balance: 0n, nonce: 0 }), esdts: async () => [], egldUsd: async () => 25 } as never
  const fox = new Proxy({}, { get: () => down }) as never
  const s = await takeSnapshot({ chain, fox }, { watch: ADDR })
  assert.equal(s.prices?.egldPerFoxsy, 0.0005, 'FOXSY is still valued, so paid play goes on with the FOXSY held')
  assert.ok(s.warnings.some(w => w.startsWith('xExchange pool: xExchange has paused the FOXSY/WEGLD pair')), s.warnings.join('; '))
})

test('a frozen price adds no sample to the two-day median the caps use', async () => {
  const { setup, snapshot } = await import('./fixtures.ts')
  const { exec, store } = setup()
  const value = (prices: object) => (exec as unknown as { valuationPrices(p: object): { foxsyUsd: number } }).valuationPrices(prices)
  store.setKv('foxsy_usd_seen', JSON.stringify([{ t: Date.now() - 700_000, p: 0.003 }]))
  value({ ...snapshot().prices!, foxsyUsd: 0.001, frozen: true })
  assert.equal(JSON.parse(store.getKv('foxsy_usd_seen')!).length, 1, 'no sample while paused')
  assert.equal(value({ ...snapshot().prices!, foxsyUsd: 0.001, frozen: true }).foxsyUsd, 0.003, 'the median still floors the value')
  value({ ...snapshot().prices!, foxsyUsd: 0.001 })
  assert.equal(JSON.parse(store.getKv('foxsy_usd_seen')!).length, 2, 'a live price is sampled again')
})
