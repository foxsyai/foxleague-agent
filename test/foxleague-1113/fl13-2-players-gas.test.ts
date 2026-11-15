// FoxLeague mainnet of 13 Nov 2026, FL13-2: the players contract grew, and every call of it with it.
// The players contract was upgraded on mainnet at 2026-11-13 21:32:50 UTC (tx 486df9ae...e05d, code hash e628771c...cacc4,
// the canonical fusionMint build of 72,036 bytes; 63,693 before: about 834,300 gas more on every call). FoxLeague's own
// app re-sized its limits for it (next-foxleague origin/main frontend/src/lib/gasLimits.ts, the owner's rule: about 1.5x
// of the gas a call really uses, inside 1.4x to 1.8x; gasBand.test.ts). The agent kept the limits sized for the contract
// before, between 1.27x and 1.38x of the gas used now: still above 1x, but under the band, and the next upgrade adds as
// much again. The gas used below is FoxLeague's, on the 72,036-byte contract (gasLimits.ts comments).
import test from 'node:test'
import assert from 'node:assert/strict'
import { GAS } from '../../src/config.ts'
import { auctionBidTx, auctionCancelTx, auctionListTx, fusionTx, fusionWaiverTx, registerAndPayTx, shopPayTx } from '../../src/executor/tx.ts'
import { ADDR } from '../fixtures.ts'

const UPGRADE = 834_300 // 72,036 - 63,693 bytes at 100 gas a byte
const CODE_2026_10 = 454_700 // 63,693 - 59,146 bytes: the 2026-09-25 samples on the contract of 2026-10-26

test('FL13-2: every players-contract limit the agent signs is 1.4x to 1.8x of its gas on the upgraded contract', () => {
  const calls: { name: string; limit: bigint; used: [number, number] }[] = [
    // `fusion`, the old fusion that draws from the pool: 14,428,275 today + 834,300 (gasLimits.ts FUSION_GAS_LIMIT).
    { name: 'fusion', limit: fusionTx(ADDR, 10n ** 20n, [1, 2, 3], 0).gasLimit, used: [15_262_575, 15_262_575] },
    // payFusionMatchWaiver 9.59M to payFusionCooldownWaiver 10.47M on the 59,146-byte contract (FUSION_WAIVER_GAS_LIMIT).
    { name: 'fusion waiver', limit: fusionWaiverTx(ADDR, 5, 10n ** 20n, 'payFusionCooldownWaiver').gasLimit, used: [9_590_000 + CODE_2026_10 + UPGRADE, 10_470_000 + CODE_2026_10 + UPGRADE] },
    // shopPay 8,576,067 with the refundable record (testnet, 2026-10-25) + 834,300 (SHOP_PAY_GAS_LIMIT).
    { name: 'shopPay', limit: shopPayTx(10n ** 20n).gasLimit, used: [8_576_067 + UPGRADE, 8_576_067 + UPGRADE] },
    // auctionList 10.25M on mainnet (59,146 bytes), AUCTION_GAS.list.
    { name: 'auctionList', limit: auctionListTx(ADDR, 5, 500).gasLimit, used: [10_250_000 + CODE_2026_10 + UPGRADE, 10_250_000 + CODE_2026_10 + UPGRADE] },
    // auctionBid 8.73M a first bid, about 0.6M more when it refunds the previous bidder (AUCTION_GAS.bid).
    { name: 'auctionBid', limit: auctionBidTx(5, 600).gasLimit, used: [8_730_000 + CODE_2026_10 + UPGRADE, 9_330_000 + CODE_2026_10 + UPGRADE] },
    // auctionCancel 8.04M simulated (AUCTION_GAS.cancel).
    { name: 'auctionCancel', limit: auctionCancelTx(5).gasLimit, used: [8_040_000 + CODE_2026_10 + UPGRADE, 8_040_000 + CODE_2026_10 + UPGRADE] },
  ]
  const off: string[] = []
  for (const c of calls) {
    const lo = Number(c.limit) / c.used[1]
    const hi = Number(c.limit) / c.used[0]
    if (lo < 1.4 || hi > 1.8) off.push(`${c.name}: ${c.limit} is ${lo.toFixed(2)}x to ${hi.toFixed(2)}x of ${c.used.join(' to ')}`)
  }
  assert.deepEqual(off, [])
})

test('FL13-2: the relayed registration keeps FoxLeague\'s 12M, bound by the relay ceiling, above 1.1x of its gas on the upgraded contract', () => {
  // registerAndPay 9.48M to 9.62M on the 72,036-byte contract; the relay refuses a limit above relayer_max_gas_limit
  // (12.5M served), so FoxLeague's app signs 12M too (REGISTER_AND_PAY_GAS_LIMIT, "left for the owner").
  const limit = registerAndPayTx(10n ** 21n, ADDR, 12_500_000).gasLimit
  assert.equal(limit, GAS.registerAndPayMax)
  assert.ok(Number(limit) / 9_620_000 >= 1.1, `${limit} is ${(Number(limit) / 9_620_000).toFixed(2)}x`)
})
