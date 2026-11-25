// JG-2: FoxLeague's audit of 22 Nov 2026 (its #813, live on mainnet: every player join on the tournaments contract since
// 25 Nov 14:31 UTC signs 11,500,000) found that the 287 mainnet joins since 4 Nov all signed 8,400,000 gas and used
// 7,236,305 to 7,682,119, a margin of 9% to 16%. Each upgrade of the tournaments contract added about 180 gas per byte,
// and 21 earlier joins at 7M failed "not enough gas" on chain, so the next upgrade could push the heaviest joins over
// 8,400,000. FoxLeague's app now signs a join with 11,500,000 (1.50x of the heaviest) and the refund claim with
// 10,100,000 (6,500,000 sat at 0.97x to 1.01x of the 250 one-refundee refundEntries since 4 Nov). The agent signed
// both with the old limits. Out of gas a call reverts and keeps its fee; unused gas goes back to the wallet.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { claimRefundTx, joinTournamentTx } from '../../src/executor/tx.ts'

test('JG2-1 a tournament or 1v1 seat is signed with FoxLeague\'s 11,500,000 gas', () => {
  assert.equal(joinTournamentTx(77, 10n ** 21n).gasLimit, 11_500_000n)
})

test('JG2-2 the refund claim is signed with FoxLeague\'s 10,100,000 gas', () => {
  assert.equal(claimRefundTx(77).gasLimit, 10_100_000n)
})
