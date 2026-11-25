// BUSY-1 and BUSY-2 (the owner, 2026-11-25): FoxLeague runs at most 3 match simulations at once for the whole game
// (match.sim_max_concurrent). A start that finds every slot busy waits up to 30 s on FoxLeague's side and is then
// refused with "Servers are busy with other matches right now. Please try again in a few seconds." (39 times since
// 4 Oct on the owner's 10 agents, the ranked ticket already bought in 7 of them). The agent gave up at once and the
// next plan, about an hour later, used the ticket kept.
// BUSY-1: the start is pressed again after a minute, at most twice; never after any other refusal and never once the
// kill switch, a pause or a stop came during the wait. Nothing is paid again: the ticket bought stays.
// BUSY-2: when FoxLeague stays busy, the message says so calmly ("[busy]", nothing lost) and is not an urgent one:
// the ticket's payment is confirmed, so its outcome is clear. Its activity row keeps the status it had.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Transaction } from '@multiversx/sdk-core'
import { formatResult, urgentResult, type ExecutionResult } from '../../src/executor/executor.ts'
import { ApiRefusal } from '../../src/foxleague/api.ts'
import type { AgentWallet } from '../../src/wallet/wallet.ts'
import { liveWallet, setup, snapshot, withFixture, withLive } from '../fixtures.ts'

const LEVELS = { live: true, live_from: '2026-11-09T14:00:00Z', ranked_ticket_price_foxsy: 25, xp_factor_pct: { ranked: 25, bronze: 50, silver: 75, gold: 100 }, elo_k: { ranked: 5, bronze: 9, silver: 13, gold: 17 }, private_bronze_earns: true, competitive_daily_cap: 3 }
const BUSY_TEXT = 'Servers are busy with other matches right now. Please try again in a few seconds.'

type Answer = 'ticket' | 'busy' | 'cooldown' | 'ok'

function signer(): AgentWallet & { signed: Transaction[] } {
  const signed: Transaction[] = []
  return { ...liveWallet, signed, signTransaction: (tx: Transaction) => void signed.push(tx) }
}

/**
 * One play_match of `type` whose presses FoxLeague answers in the order of `answers` (then a start). `tickets`: ranked
 * tickets held before. `during(m)`: runs inside each pause the executor takes before it presses again.
 */
async function play(type: 'casual' | 'ranked', answers: Answer[], opts: { tickets?: number; during?: (m: ReturnType<typeof setup>) => void } = {}) {
  let pressed = 0
  const view = { live: true, live_from: '2026-11-09T14:00:00Z', price_foxsy: 25, tickets: opts.tickets ?? 0, discount_bp: 0, discounted_price_foxsy: 25 }
  const m = setup({
    fox: {
      rankedTicket: async () => view,
      playMatch: async () => {
        const x = answers[pressed++] ?? 'ok'
        if (x === 'ticket') throw new ApiRefusal('A ranked game costs 25 FOXSY: pay for a ticket first.', 'ranked_ticket_required')
        if (x === 'busy') throw new ApiRefusal(BUSY_TEXT, undefined, undefined, 503)
        if (x === 'cooldown') throw new ApiRefusal('Match cooldown: wait 30 seconds', undefined, undefined, 429)
        return { match_id: 21, ranked_paid: true }
      },
      buyRankedTicket: async () => ({ ...view, tickets: 1 }),
    },
    chain: { send: async () => 'hashT' },
  })
  const pauses: number[] = []
  ;(m.exec as unknown as { busyPause: (ms: number) => Promise<void> }).busyPause = async (ms: number) => {
    pauses.push(ms)
    opts.during?.(m)
  }
  const wallet = signer()
  // A casual game is refused before a tournament match that locks soon (condition): the casual starts play without one.
  const s = type === 'casual' ? snapshot() : withFixture(snapshot())
  s.config!.competition_levels = LEVELS
  let r: ExecutionResult | undefined
  await withLive(m.store, async () => { r = (await m.exec.run(m.agent(), wallet, s, [{ action: { type: 'play_match', match_type: type }, reason: '' }]))[0] })
  return { r: r!, m, wallet, pauses, pressed: () => pressed }
}

test('BUSY1-1 a ranked start FoxLeague answers busy after the ticket is bought starts on the next press, nothing paid again', async () => {
  const { r, m, wallet, pauses, pressed } = await play('ranked', ['ticket', 'busy'])
  assert.equal(r.status, 'confirmed', r.summary)
  assert.match(r.summary, /^play ranked match: match #21 started \(ranked\) after FoxLeague's match servers were busy \(2nd try\); cost /)
  assert.equal(wallet.signed.length, 1, 'one ticket')
  assert.equal(pressed(), 3)
  assert.deepEqual(pauses, [60_000])
  assert.equal(m.store.openSpend(0, 'shop:', false).length, 1)
})

test('BUSY1-2 a start with nothing to pay, busy twice, starts on the third press', async () => {
  const { r, wallet, pauses, pressed } = await play('casual', ['busy', 'busy'])
  assert.equal(r.status, 'confirmed', r.summary)
  assert.match(r.summary, /match #21 started \(casual\) after FoxLeague's match servers were busy \(3rd try\)/)
  assert.equal(wallet.signed.length, 0)
  assert.equal(pressed(), 3)
  assert.deepEqual(pauses, [60_000, 60_000])
})

test('BUSY1-3 a ranked start on a ticket already held, busy once, starts on the next press with no signature', async () => {
  const { r, wallet, pauses, pressed } = await play('ranked', ['busy'], { tickets: 1 })
  assert.equal(r.status, 'confirmed', r.summary)
  assert.match(r.summary, /match #21 started \(ranked\) after FoxLeague's match servers were busy \(2nd try\)/)
  assert.equal(wallet.signed.length, 0)
  assert.equal(pressed(), 2)
  assert.deepEqual(pauses, [60_000])
})

test('BUSY1-4 busy on every press: three presses and two pauses at most, the ticket bought stays, nothing more is signed', async () => {
  const { r, m, wallet, pauses, pressed } = await play('ranked', ['ticket', 'busy', 'busy', 'busy', 'busy'])
  assert.equal(r.status, 'error', r.summary)
  assert.equal(r.busy, true)
  assert.equal(pressed(), 4, 'the ticket\'s press and three starts')
  assert.deepEqual(pauses, [60_000, 60_000])
  assert.equal(wallet.signed.length, 1)
  assert.equal(m.store.openSpend(0, 'shop:', false).length, 1, 'the ticket stays counted')
  assert.match(r.summary, /^play ranked match: FoxLeague's match servers stayed busy \(3 tries in about 2 minutes\): no match started; the ticket bought stays for the next start; cost /)
})

test('BUSY1-5 busy on every press of a start with nothing to pay: no match started, said calmly', async () => {
  const { r, pauses, pressed } = await play('casual', ['busy', 'busy', 'busy'])
  assert.equal(r.status, 'error', r.summary)
  assert.equal(r.busy, true)
  assert.equal(pressed(), 3)
  assert.deepEqual(pauses, [60_000, 60_000])
  assert.match(r.summary, /^play casual match: FoxLeague's match servers stayed busy \(3 tries in about 2 minutes\): no match started$/)
})

test('BUSY1-6 any other refusal is never pressed again', async () => {
  const { r, pauses, pressed } = await play('casual', ['cooldown'])
  assert.equal(r.status, 'error', r.summary)
  assert.notEqual(r.busy, true)
  assert.equal(pressed(), 1)
  assert.deepEqual(pauses, [])
  assert.match(r.summary, /refused by FoxLeague: Match cooldown: wait 30 seconds/)
})

for (const [name, stop] of [
  ['the kill switch', (m: ReturnType<typeof setup>) => m.store.setKillSwitch(true)],
  ['a pause', (m: ReturnType<typeof setup>) => m.store.setPaused(0, true)],
  ['a stop of the service', (m: ReturnType<typeof setup>) => { (m.exec as unknown as { d: { stopping: () => boolean } }).d.stopping = () => true }],
] as const) {
  test(`BUSY1-7 ${name} during the wait: not pressed again, the ticket bought stays`, async () => {
    const { r, m, wallet, pauses, pressed } = await play('ranked', ['ticket', 'busy'], { during: stop })
    assert.equal(r.status, 'error', r.summary)
    assert.equal(pressed(), 2, 'the ticket\'s press and the busy start only')
    assert.deepEqual(pauses, [60_000])
    assert.equal(wallet.signed.length, 1)
    assert.equal(m.store.openSpend(0, 'shop:', false).length, 1)
    assert.match(r.summary, /FoxLeague's match servers were busy and .* came during the wait: not pressed again; the ticket bought stays for the next start/)
  })
}

test('BUSY2-1 FoxLeague staying busy reads [busy] and is not urgent; an error after a payment still is', async () => {
  const { r } = await play('ranked', ['ticket', 'busy', 'busy', 'busy'])
  const text = formatResult(0, r)
  assert.match(text, / \[busy\] play ranked match: FoxLeague's match servers stayed busy/)
  assert.doesNotMatch(text, /\[ERROR\]/)
  assert.equal(urgentResult(r), false, 'the ticket is confirmed: nothing is unclear')
  const unclear: ExecutionResult = { action: r.action, reason: '', status: 'error', summary: 'x', costUsd: 0, txHash: 'h', sent: true }
  assert.equal(urgentResult(unclear), true)
  assert.equal(urgentResult({ ...unclear, status: 'unconfirmed' }), true)
  assert.equal(urgentResult({ ...unclear, status: 'confirmed' }), false)
  assert.equal(urgentResult({ ...unclear, txHash: undefined, sent: undefined }), false)
})

// R100A-1 (low, the agent review of PR #100): every case above takes the pause without its wait, so nothing ran the real
// loop. The real pause checks every second and ends within a step once the kill switch, a pause or a stop comes.
test('BUSY1-8 the real pause ends within a second once halted and runs its whole length otherwise', async () => {
  const m = setup()
  const pause = (m.exec as unknown as { busyPause: (ms: number, h: () => string | null) => Promise<void> }).busyPause.bind(m.exec)
  let calls = 0
  let t0 = Date.now()
  await pause(5_000, () => (++calls > 1 ? 'the kill switch' : null))
  assert.ok(Date.now() - t0 < 1_500, `ended after ${Date.now() - t0} ms`)
  t0 = Date.now()
  await pause(1_200, () => null)
  assert.ok(Date.now() - t0 >= 1_150, 'not halted: the whole pause')
})
