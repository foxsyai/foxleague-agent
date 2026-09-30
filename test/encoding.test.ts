import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decimalToAtomic, formatAtomic, numberToHex, u64Hex, wholeToAtomic } from '../src/util/encoding.ts'
import { applySlippage, composeTasksEgldToFoxsyData } from '../src/chain/xexchange.ts'

test('literals from docs/FOXLEAGUE-INTEGRATION.md 1.4', () => {
  assert.equal(numberToHex(wholeToAtomic(10)), '8ac7230489e80000')
  assert.equal(numberToHex(wholeToAtomic(20)), '01158e460913d00000')
  assert.equal(numberToHex(wholeToAtomic(100)), '056bc75e2d63100000')
  assert.equal(numberToHex(wholeToAtomic(1000)), '3635c9adc5dea00000')
  assert.equal(numberToHex(wholeToAtomic(2500)), '878678326eac900000')
  assert.equal(numberToHex(wholeToAtomic(5000)), '010f0cf064dd59200000')
  assert.equal(numberToHex(0), '00')
  assert.equal(u64Hex(1234), '00000000000004d2')
})

test('composeTasks matches the web app pin for 5,000 FOXSY (xexchangeSwap.test.ts:63)', () => {
  assert.equal(
    composeTasksEgldToFoxsyData(wholeToAtomic(5000)),
    'composeTasks@0000000c464f5853592d35643566336500000000000000000000000a010f0cf064dd59200000@@@02@0000001473776170546f6b656e734669786564496e7075740000000c464f5853592d3564356633650000000a010f0cf064dd59200000',
  )
})

test('slippage rounds down like the web app (2420448279809306763 -> 2444652762607399830 at 1%)', () => {
  assert.equal(applySlippage(2420448279809306763n, 100), 2444652762607399830n)
})

test('decimal amounts', () => {
  assert.equal(decimalToAtomic('15.37'), 15_370_000_000_000_000_000n)
  assert.equal(formatAtomic(15_370_000_000_000_000_000n, 2), '15.37')
  assert.throws(() => decimalToAtomic('1.2.3'))
})
