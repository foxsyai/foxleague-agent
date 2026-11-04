// Audit 2026-11-04 (five Fable 5.1 reviewers at max effort, PRs #29 to #50): the proof of a finding, failing before its fix.
// Adversarial money review of afc3238 (PRs #29 to #50). Each test FAILS on the current code and passes after the fix named
// in the report. Run from W: node --disable-warning=ExperimentalWarning --test /tmp/audit-money/money-findings.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BroadcastRefused } from '../../src/chain/gateway.ts'
import { casualStartsSince } from '../../src/executor/match-starts.ts'
import { liveWallet, setup, snapshot, tournament, withLive } from '../fixtures.ts'

/** The gateway's non-definite refusal (a nonce or duplicate answer): the executor rightly treats it as "may have gone out". */
const mayHaveGoneOut = () => new BroadcastRefused('transaction generation failed: higher nonce in transaction')

test('MONEY-1a: a seat payment whose broadcast may have gone out is held as pending from the signature on, and the next join of that tournament pays nothing', async () => {
  let sends = 0
  const m = setup({
    fox: { tournament: async () => tournament(7), joinTournament: async () => assert.fail('no seat confirm in this test') },
    chain: { send: async () => { sends++; throw mayHaveGoneOut() }, lookupTransaction: async () => 'known' },
  })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, snapshot(), [{ action: { type: 'join_tournament', tournament_id: 7 }, reason: '' }])
    assert.equal(r!.status, 'error', r!.summary)
    assert.equal(r!.sent, true, 'the executor itself says it may have gone out')
    assert.equal(m.store.openSpend(0, 'join:7', false).length, 1, 'the seat stays counted (correct)')
    assert.equal(m.store.pending(0).filter(p => p.kind === 'join').length, 1, 'held from the signature on, as the ticket and the organizer payment are since R41-3')
    const [again] = await m.exec.run(m.agent(), liveWallet, snapshot(), [{ action: { type: 'join_tournament', tournament_id: 7 }, reason: '' }])
    assert.equal(again!.status, 'refused', again!.summary)
  })
  assert.equal(sends, 1, 'never a second seat payment while the first may have landed')
})

test('MONEY-1b: a shop payment whose broadcast may have gone out is held as pending from the signature on, and the same product is not paid again', async () => {
  let sends = 0
  const m = setup({
    fox: { shopConfirm: async () => assert.fail('no confirm in this test') },
    chain: { send: async () => { sends++; throw mayHaveGoneOut() }, lookupTransaction: async () => 'known' },
  })
  const s = snapshot()
  s.players[0]!.condition = 40
  const buy = { action: { type: 'buy' as const, product: 'condition_recovery' as const, player_nonces: [1] }, reason: '' }
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, s, [buy])
    assert.equal(r!.status, 'error', r!.summary)
    assert.equal(r!.sent, true)
    assert.equal(m.store.pending(0).filter(p => p.kind === 'shop').length, 1, 'held from the signature on')
    const [again] = await m.exec.run(m.agent(), liveWallet, s, [buy])
    assert.equal(again!.status, 'refused', again!.summary)
  })
  assert.equal(sends, 1, 'never a second shop payment while the first may have landed')
})

test('MONEY-2: casual starts whose answer was lost and whose read-back failed are not "none" for the 4-a-day cap', async () => {
  let lost = true
  const m = setup({ fox: { playMatch: async () => { if (lost) throw new Error('HTTP 502'); return { match_id: 9 } }, activeMatch: async () => { throw new Error('HTTP 502') } } })
  const casual = { action: { type: 'play_match' as const, match_type: 'casual' as const }, reason: '' }
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, snapshot(), [casual])
    assert.equal(r!.status, 'error', r!.summary)
    assert.doesNotMatch(r!.summary, /refused by FoxLeague/, 'not a refusal: the match may have started')
    assert.equal(casualStartsSince(m.store, 0, new Date(Date.now() - 3600_000)), 1, 'a start of unknown outcome counts (unknown is not zero)')
    // Three more like it (a start of unknown outcome also holds the 30 s cooldown, INPUT-2, so they are not run back to back here).
    const [row] = m.store.activity(0, 1)
    for (let i = 0; i < 3; i++) m.store.log({ agentIndex: 0, kind: 'play_match', status: 'error', summary: row!.summary, detail: JSON.parse(row!.detail ?? '{}') })
    assert.equal(casualStartsSince(m.store, 0, new Date(Date.now() - 3600_000)), 4)
    lost = false
    const [fifth] = await m.exec.run(m.agent(), liveWallet, snapshot(), [casual])
    assert.equal(fifth!.status, 'refused', fifth!.summary)
    assert.match(fifth!.summary, /casual games today/)
  })
})
