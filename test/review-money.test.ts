// Proof tests for the whole-project review of 2026-10-13 (money and limits). Each test is named after its finding
// (A = the money reviewer, C = the chain reviewer) and failed on main 5ab42c2 before the fix.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Mnemonic, Transaction, TransactionComputer } from '@multiversx/sdk-core'
import type { Config } from '../src/config.ts'
import { ADDR, OTHER, STRANGER, card, dryWallet, encodeAuction, liveWallet, setup, snapshot, tournament, withLive } from './fixtures.ts'
import { numberToHex, wholeToAtomic } from '../src/util/encoding.ts'
import { Chain } from '../src/chain/gateway.ts'
import { ApiRefusal } from '../src/foxleague/api.ts'
import { retryPendingPayments } from '../src/executor/pending.ts'
import { creditRefunds } from '../src/executor/refunds.ts'
import { Store } from '../src/store/db.ts'
import { TopUps } from '../src/topup.ts'
import { neverUsedOrWhy } from '../src/delete-agent.ts'
import type { PlannedAction } from '../src/executor/actions.ts'

const act = (action: unknown): PlannedAction[] => [{ action: action as PlannedAction['action'], reason: '' }]

// ---- A3 + C2: a 1v1 stake is never paid while the routes its gates read could not be read ----

const oneVOneRig = () =>
  setup({
    fox: {
      user: async (a: string) => (a === STRANGER ? { id: 900, wallet_address: STRANGER, elo_rating: 1200 } : null),
      tournament: async () => tournament(555, { max_teams: 2, min_teams: 2, creator_user_id: 900 }, [{ user_id: 900, wallet_address: STRANGER }]),
    },
  })
const join1v1 = act({ type: 'join_tournament', tournament_id: 555 })
const openChallenge = act({ type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: null, deadline_minutes: 60 })

test('A3 C2 control: with the own tournaments and upcoming matches readable, the 1v1 join and the challenge go through', async () => {
  const m = oneVOneRig()
  assert.equal((await m.exec.run(m.agent(), dryWallet, snapshot(), join1v1))[0]!.status, 'dry_run')
  assert.equal((await m.exec.run(m.agent(), dryWallet, snapshot(), openChallenge))[0]!.status, 'dry_run')
})

test('A3 C2 a 1v1 join pays no stake while the agent\'s own tournaments could not be read (an active 1v1 is unknown)', async () => {
  const m = oneVOneRig()
  const s = snapshot()
  s.auth!.myTournaments = null
  const [r] = await m.exec.run(m.agent(), dryWallet, s, join1v1)
  assert.equal(r!.status, 'refused', `my tournaments unreadable, yet: ${r!.summary}`)
  assert.match(r!.summary, /could not be read/)
})

test('A3 C2 a 1v1 join pays no stake while the upcoming matches could not be read (the one-hour gate is unknown)', async () => {
  const m = oneVOneRig()
  const s = snapshot()
  s.auth!.upcoming = null
  const [r] = await m.exec.run(m.agent(), dryWallet, s, join1v1)
  assert.equal(r!.status, 'refused', `upcoming matches unreadable, yet: ${r!.summary}`)
  assert.match(r!.summary, /could not be read/)
})

test('A3 C2 a targeted 1v1 (to this team) is not joined blind either', async () => {
  const rival = { id: 900, wallet_address: OTHER, elo_rating: 1200 }
  const targeted = () => tournament(77, { max_teams: 2, min_teams: 2, creator_user_id: 900, target_user_id: 100, targeted_to_you: true }, [{ user_id: 900, wallet_address: OTHER }])
  for (const blind of ['myTournaments', 'upcoming'] as const) {
    const m = setup({ fox: { tournament: async () => targeted(), user: async () => rival } })
    const s = snapshot()
    s.auth![blind] = null
    const [r] = await m.exec.run(m.agent(), dryWallet, s, act({ type: 'join_tournament', tournament_id: 77 }))
    assert.equal(r!.status, 'refused', `${blind} unreadable, yet: ${r!.summary}`)
  }
})

test('A3 C2 a 1v1 challenge pays no stake while the own tournaments or the upcoming matches could not be read', async () => {
  for (const blind of ['myTournaments', 'upcoming'] as const) {
    const m = oneVOneRig()
    const s = snapshot()
    s.auth![blind] = null
    const [r] = await m.exec.run(m.agent(), dryWallet, s, openChallenge)
    assert.equal(r!.status, 'refused', `${blind} unreadable, yet: ${r!.summary}`)
    assert.match(r!.summary, /could not be read/)
  }
})

test('A3 C2 the within-the-hour check refuses on unreadable upcoming matches (a casual match is not started blind)', async () => {
  const m = setup()
  const s = snapshot()
  s.auth!.upcoming = null
  const [r] = await m.exec.run(m.agent(), dryWallet, s, act({ type: 'play_match', match_type: 'casual' }))
  assert.equal(r!.status, 'refused', `upcoming matches unreadable, yet: ${r!.summary}`)
  assert.match(r!.summary, /could not be read/)
})

// ---- A6: an unreadable fusion pre-check refuses the fusion ----

const b64 = (n: bigint) => Buffer.from(numberToHex(n), 'hex').toString('base64')
const spares = () => snapshot([card(40, 'DEF', 'reserve'), card(41, 'MID', 'reserve'), card(42, 'FWD', 'reserve')])
const fuse = act({ type: 'fuse', player_nonces: [40, 41, 42], position_of: 0 })
const poolOf4 = { query: async (_sc: string, fn: string) => (fn === 'getFusionPoolCount' ? [b64(4n)] : []) }

test('A6 control: with can-fuse answering, the fusion is allowed or refused by its answer', async () => {
  const ok = setup({ chain: poolOf4, fox: { user: async () => null, canFuse: async () => ({ can_fuse: true }) } })
  assert.equal((await ok.exec.run(ok.agent(), dryWallet, spares(), fuse))[0]!.status, 'dry_run')
  const no = setup({ chain: poolOf4, fox: { user: async () => null, canFuse: async () => ({ can_fuse: false, cooldown_remaining: 7200 }) } })
  assert.match((await no.exec.run(no.agent(), dryWallet, spares(), fuse))[0]!.summary, /wallet fusion cooldown/)
})

test('A6 a fusion is not signed while the can-fuse pre-check could not be read', async () => {
  const m = setup({ chain: poolOf4, fox: { user: async () => null, canFuse: async () => { throw new Error('HTTP 502') } } })
  const [r] = await m.exec.run(m.agent(), dryWallet, spares(), fuse)
  assert.equal(r!.status, 'refused', `can-fuse unreadable, yet: ${r!.summary}`)
  assert.match(r!.summary, /pre-check is unavailable: not fusing blind/)
})

// ---- A8: a bid that errored after its signature counts toward the two bids per auction ----

const bidRig = (chain: Record<string, unknown> = {}) =>
  setup({
    chain: { query: async (_sc: string, fn: string) => (fn === 'getAuction' ? [encodeAuction({ seller: STRANGER, min: wholeToAtomic(500), top: wholeToAtomic(1000), bidder: STRANGER, endsInS: 3600 })] : []), ...chain },
    fox: { user: async () => null, player: async () => ({ transferred_at: null, transfer_cooldown_hours: null, rarity: 'Rare' }) },
  })
const bid = act({ type: 'bid', nonce: 9, foxsy: 1100 })
const bidRow = (status: 'dry_run' | 'confirmed' | 'error', foxsy: number, sent = false) => ({ agentIndex: 0, kind: 'bid', status, summary: `bid ${foxsy} FOXSY on #9`, detail: { action: { type: 'bid', nonce: 9, foxsy }, ...(sent ? { sent: true } : {}) } })

test('A8 control: two bids out on the auction, a third is refused', async () => {
  const m = bidRig()
  m.store.log(bidRow('dry_run', 600))
  m.store.log(bidRow('dry_run', 800))
  const [r] = await m.exec.run(m.agent(), dryWallet, snapshot(), bid)
  assert.equal(r!.status, 'refused')
  assert.match(r!.summary, /no bidding war/)
})

test('A8 a bid that errored after it was signed (sent) may have landed: it counts toward the two bids per auction', async () => {
  for (const ledger of ['dry_run', 'confirmed'] as const) {
    const m = bidRig()
    m.store.log(bidRow(ledger, 600))
    m.store.log(bidRow('error', 800, true))
    const run = () => m.exec.run(m.agent(), ledger === 'dry_run' ? dryWallet : liveWallet, snapshot(), bid)
    const [r] = ledger === 'dry_run' ? await run() : await withLive(m.store, run)
    assert.equal(r!.status, 'refused', `${ledger}: an errored bid that was sent is not counted, yet: ${r!.summary}`)
    assert.match(r!.summary, /no bidding war/)
  }
})

test('A8 (review of #10) an error before any signature (not sent) does not count toward the two bids per auction', async () => {
  const m = bidRig()
  m.store.log(bidRow('confirmed', 600))
  m.store.log(bidRow('error', 800))
  const [r] = await withLive(m.store, () => m.exec.run(m.agent(), liveWallet, snapshot(), bid))
  assert.equal(r!.status, 'confirmed', `an error before the signature counted as a bid: ${r!.summary}`)
})

test('A8 (review of #10) the executor notes in the log whether an errored bid was sent, and only those count', async () => {
  // Two read hiccups before any signature: the auction can still be bid on.
  let auctionDown = true
  const reads = bidRig({ query: async (_sc: string, fn: string) => { if (auctionDown) throw new Error('vm-values: HTTP 502'); return fn === 'getAuction' ? [encodeAuction({ seller: STRANGER, min: wholeToAtomic(500), top: wholeToAtomic(1000), bidder: STRANGER, endsInS: 3600 })] : [] } })
  await withLive(reads.store, async () => {
    for (let i = 0; i < 2; i++) assert.equal((await reads.exec.run(reads.agent(), liveWallet, snapshot(), bid))[0]!.status, 'error')
    auctionDown = false
    const [r] = await reads.exec.run(reads.agent(), liveWallet, snapshot(), bid)
    assert.equal(r!.status, 'confirmed', `two read errors blocked the auction: ${r!.summary}`)
  })
  // Two bids signed whose broadcast got no answer: a third is refused.
  const lost = bidRig({ send: async () => { throw new TypeError('fetch failed') } })
  await withLive(lost.store, async () => {
    for (let i = 0; i < 2; i++) assert.equal((await lost.exec.run(lost.agent(), liveWallet, snapshot(), bid))[0]!.sent, true)
    const [r] = await lost.exec.run(lost.agent(), liveWallet, snapshot(), bid)
    assert.equal(r!.status, 'refused', r!.summary)
    assert.match(r!.summary, /no bidding war/)
  })
})

// ---- A1: a paid seat is pending (its hash on disk) from the send on, before the outcome wait ----

test('A1 a paid seat is pending (hash kept) from the moment it is sent, before the outcome wait, like a shop payment', async () => {
  let release!: () => void
  let waiting = false
  const m = setup({
    chain: {
      send: async () => 'seat-hash',
      waitForOutcome: async () => {
        waiting = true
        await new Promise<void>(r => (release = r))
        return { kind: 'success' }
      },
    },
    fox: { user: async () => null, tournament: async () => tournament(570, { participant_count: 3 }), joinTournament: async () => ({ participant_id: 1 }) },
  })
  await withLive(m.store, async () => {
    const running = m.exec.run(m.agent(), liveWallet, snapshot(), act({ type: 'join_tournament', tournament_id: 570 }))
    while (!waiting) await new Promise(r => setTimeout(r, 5))
    // Signed and sent; the outcome wait may take 120 s. A stop or a crash here must still find the hash on disk.
    const pending = m.store.pending(0).map(p => [p.kind, p.hash, (p.payload as { tournamentId: number }).tournamentId])
    release()
    const [r] = await running
    assert.equal(r!.status, 'confirmed', r!.summary)
    assert.deepEqual(pending, [['join', 'seat-hash', 570]], 'the seat payment must be pending while its outcome is awaited (a shop payment is)')
    assert.equal(m.store.pending(0).length, 0, 'seated: no longer pending')
  })
})

test('A1 a seat payment that reverted is no longer pending (nothing to confirm, a new seat may be paid)', async () => {
  const m = setup({
    chain: { send: async () => 'seat-hash', waitForOutcome: async () => ({ kind: 'failed', reason: 'insufficient funds' }) },
    fox: { user: async () => null, tournament: async () => tournament(570, { participant_count: 3 }), joinTournament: async () => assert.fail('a reverted seat is not confirmed') },
  })
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, snapshot(), act({ type: 'join_tournament', tournament_id: 570 }))
    assert.equal(r!.status, 'failed', r!.summary)
    assert.deepEqual(m.store.pending(0), [])
  })
})

// ---- A10: a broadcast the gateway refused (its error answer) is no sent payment: the booking goes ----

const envelope = (status: number, error: string, data: unknown = null) => new Response(JSON.stringify({ data, error, code: error ? 'bad_request' : 'successful' }), { status, headers: { 'content-type': 'application/json' } })
const gatewayAnswer = (status: number, error: string) => async () => envelope(status, error)

/**
 * A bid sent through the real Chain over a gateway that answers the broadcast with `send` and a look-up of a
 * transaction by its hash with `lookup` (none: the test fails on a look-up). Returns the hashes looked up and the
 * hash of the signed transaction the broadcast carried, computed locally.
 */
async function bidThroughGateway(send: () => Promise<Response>, lookup?: () => Promise<Response>) {
  const chain = new Chain({ gatewayUrl: 'http://gw.test', apiUrl: 'http://api.test', gatewayRps: 50, apiRps: 50 }, { refusalLookupDelayMs: 0 })
  const realFetch = globalThis.fetch
  const looked: string[] = []
  let sentHash: string | undefined
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (url.endsWith('/transaction/send')) {
      sentHash = new TransactionComputer().computeTransactionHash(Transaction.newFromPlainObject(JSON.parse(String(init!.body))))
      return send()
    }
    const m = /\/transaction\/([0-9a-f]{64})(\?|$)/.exec(url)
    if (m && lookup) return (looked.push(m[1]!), lookup())
    throw new Error(`unexpected gateway call ${url}`)
  }) as typeof fetch
  const auction = [encodeAuction({ seller: STRANGER, min: wholeToAtomic(500), top: 0n, bidder: null, endsInS: 3600 })]
  const m = setup({
    chain: {
      account: async () => ({ nonce: 1, balance: wholeToAtomic(10) }),
      send: (tx: never) => chain.send(tx),
      lookupTransaction: (hash: string) => chain.lookupTransaction(hash),
      query: async (_sc: string, fn: string) => (fn === 'getAuction' ? auction : []),
      esdts: async () => [],
    },
    fox: { user: async () => null, player: async () => ({ transferred_at: null, transfer_cooldown_hours: null, rarity: 'Rare' }) },
  })
  try {
    return await withLive(m.store, async () => {
      const [r] = await m.exec.run(m.agent(), liveWallet, snapshot(), act({ type: 'bid', nonce: 9, foxsy: 1000 }))
      return { r: r!, live: m.store.spentUsd(0, { category: 'play', dryRun: false }), looked, sentHash, bidRows: m.store.openSpend(0, 'bid:', false) }
    })
  } finally {
    globalThis.fetch = realFetch
  }
}

test('A10 a definite refusal (insufficient funds) whose signed transaction the gateway does not know: nothing stays booked', async () => {
  const { r, live, looked, sentHash } = await bidThroughGateway(gatewayAnswer(400, 'insufficient funds for address erd1...'), async () => envelope(500, 'transaction not found'))
  assert.equal(r.status, 'error')
  assert.match(r.summary, /broadcast refused: insufficient funds/)
  assert.deepEqual(looked, [sentHash], 'the look-up asks for the hash of the signed transaction, computed locally')
  assert.equal(r.sent, undefined, 'nothing left the wallet: the result does not say "sent"')
  assert.ok(live < 0.01, `the gateway said no and does not know the transaction: the 1,000 FOXSY must not stay booked, got $${live.toFixed(2)}`)
})

test('A10 a nonce or duplicate refusal may follow a broadcast that went through (the gateway retried another observer): it stays booked', async () => {
  for (const said of ['transaction nonce is lower than account nonce', 'lower nonce in transaction', 'nonce too low', 'duplicated transaction', 'transaction already exists in pool']) {
    const { r, live, sentHash, bidRows } = await bidThroughGateway(gatewayAnswer(400, said), async () => envelope(500, 'transaction not found'))
    assert.equal(r.status, 'error', r.summary)
    assert.equal(r.sent, true, `${said}: the payment may have gone out`)
    assert.ok(live > 2, `${said}: it keeps its booking, got $${live.toFixed(2)}`)
    assert.deepEqual(bidRows.map(b => b.txHash), [sentHash], `${said}: booked under its own hash, so the refund check can read what became of the bid`)
  }
})

test('A10 a definite refusal whose transaction the gateway does know (pending or executed) stays booked', async () => {
  for (const status of ['pending', 'success']) {
    const { r, live, looked } = await bidThroughGateway(gatewayAnswer(400, 'insufficient funds'), async () => envelope(200, '', { transaction: { status, nonce: 1 } }))
    assert.equal(looked.length, 1)
    assert.equal(r.sent, true, `${status}: it is on the network`)
    assert.ok(live > 2, `${status}: it keeps its booking, got $${live.toFixed(2)}`)
  }
})

test('A10 a definite refusal whose look-up fails, or a refusal of unknown meaning, stays booked', async () => {
  for (const [said, lookup] of [
    ['insufficient funds', async () => envelope(500, 'no observer online')],
    ['invalid signature', async () => new Response('<html>bad gateway</html>', { status: 500 })],
    ['bad request', async () => envelope(500, 'transaction not found')],
  ] as const) {
    const { r, live } = await bidThroughGateway(gatewayAnswer(400, said), lookup)
    assert.equal(r.sent, true, `${said}: not surely refused`)
    assert.ok(live > 2, `${said}: it keeps its booking, got $${live.toFixed(2)}`)
  }
})

test('A10 control: a broadcast without an answer (transport error, or a gateway 5xx) may have gone out: it stays booked', async () => {
  for (const answer of [async () => { throw new TypeError('fetch failed') }, gatewayAnswer(500, 'sending transaction to observers failed')]) {
    const { r, live } = await bidThroughGateway(answer as () => Promise<Response>)
    assert.equal(r.status, 'error', r.summary)
    assert.equal(r.sent, true, r.summary)
    assert.ok(live > 2, `an unclear broadcast keeps its booking, got $${live.toFixed(2)}`)
  }
})

// ---- A9: a shop payment FoxLeague refunded stops counting against the caps (the gas stays) ----

/** A Common pack paid live whose first confirm answers tx_pending; the retry then hears `retry`. */
async function packThenRetry(retry: string) {
  let answer: () => never = () => { throw new ApiRefusal('Could not verify the payment state right now. Please retry in a moment.', 'tx_pending') }
  const m = setup({ chain: { send: async () => 'hpack' }, fox: { user: async () => null, shopConfirm: async () => answer() } })
  const live = () => m.store.spentUsd(0, { category: 'play', dryRun: false })
  return withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, snapshot(), act({ type: 'buy', product: 'common_pack' }))
    assert.equal(r!.status, 'unconfirmed', r!.summary)
    const booked = live()
    assert.ok(booked > 5.6, 'the 2,500 FOXSY pack is booked while the confirm is pending')
    answer = () => { throw new ApiRefusal(retry) }
    await retryPendingPayments({ store: m.store, fox: m.exec['d'].fox, notify: () => undefined }, 0, liveWallet)
    return { booked, after: live(), pending: m.store.pending(0).length }
  })
}

test('A9 a shop payment FoxLeague refunded gives its budget back when the retry learns of the refund (the gas stays)', async () => {
  for (const said of ['This payment was already refunded and cannot be used for a purchase.', 'Common pack sold out this week. Your payment is being refunded automatically.']) {
    const { booked, after, pending } = await packThenRetry(said)
    assert.equal(pending, 0, `${said}: the pending payment is resolved`)
    assert.ok(after < 0.01, `${said}: the refunded 2,500 FOXSY must stop counting against the caps (only the gas may stay), got $${after.toFixed(2)}`)
    assert.ok(after > 0 && after < booked, `${said}: the gas of the payment stays counted`)
  }
})

test('A9 control: a shop payment FoxLeague used ("already processed") or may still confirm keeps counting', async () => {
  const used = await packThenRetry('Transaction already processed')
  assert.equal(used.pending, 0)
  assert.equal(used.after, used.booked, 'a delivered purchase stays spent')
  const timeout = await packThenRetry('Transaction verification timed out: rpc. The payment is not lost: it is recognized when this same transaction is confirmed again within 25 minutes; after that it is refunded automatically.')
  assert.equal(timeout.after, timeout.booked, 'not refunded yet: it keeps counting')
})

// ---- A5: a seat FoxLeague refunded (the agent never sat in the completed tournament) is credited, not closed ----

function seatRig(detail: Record<string, unknown>, participants: { user_id: number; wallet_address?: string }[], userId: string | null = '100') {
  const m = setup()
  if (userId) m.store.setKv('agent_user_id:0', userId)
  m.store.recordSpend({ agentIndex: 0, at: new Date(Date.now() - 20 * 60_000), gameDay: '2026-10-13', category: 'play', action: 'join:77', foxsyAtomic: wholeToAtomic(1000), egldAtomic: 0n, usd: 2.25, txHash: 'hseat', dryRun: false })
  const chain = { query: async (_sc: string, fn: string) => (fn === 'getEntryAmount' ? [''] : []), esdts: async () => [] }
  const fox = { tournament: async () => ({ ...(tournament(77, { status: 'completed', winner_user_id: 900 }, participants) as object), ...detail }) }
  return { m, deps: { store: m.store, chain: chain as never, fox: fox as never } }
}
const seat = (m: ReturnType<typeof setup>) => m.store.spentUsd(0, { category: 'play', dryRun: false })

test('A5 control: a seat the agent really played stays counted once the tournament is over, for good', async () => {
  for (const [detail, participants] of [[{}, [{ user_id: 900 }, { user_id: 100 }]], [{}, [{ user_id: 900 }, { user_id: 555, wallet_address: ADDR }]], [{ user_is_participant: true }, [{ user_id: 900 }]]] as const) {
    const { m, deps } = seatRig(detail, [...participants])
    assert.equal(await creditRefunds(deps, m.agent(), false), 0)
    assert.equal(seat(m), 2.25)
    assert.equal(m.store.openSpend(0, 'join:', false)[0]!.action, 'join:77:played', 'closed as played: never looked at again')
  }
})

test('A5 a seat FoxLeague refunded (the agent never sat in the completed tournament) gives its budget back', async () => {
  const { m, deps } = seatRig({}, [{ user_id: 900 }, { user_id: 901 }])
  const n = await creditRefunds(deps, m.agent(), false)
  assert.equal(n, 1, 'the refunded seat is credited')
  assert.equal(seat(m), 0, 'the refunded stake no longer counts against the daily cap and the monthly budget')
})

test('A5 the detail read with the agent\'s wallet answers user_is_participant false: the refunded seat is credited', async () => {
  const { m, deps } = seatRig({ user_is_participant: false }, [{ user_id: 900 }, { user_id: 901 }], null)
  assert.equal(await creditRefunds({ ...deps, wallet: liveWallet }, m.agent(), false), 1)
  assert.equal(seat(m), 0)
})

test('A5 who sat in it unknown (no user id noted, no wallet in the detail): the seat keeps counting and stays open', async () => {
  const { m, deps } = seatRig({}, [{ user_id: 900 }, { user_id: 901 }], null)
  assert.equal(await creditRefunds(deps, m.agent(), false), 0)
  assert.equal(seat(m), 2.25)
  assert.equal(m.store.openSpend(0, 'join:', false)[0]!.action, 'join:77', 'asked again next tick')
})

// ---- C3: a settled auction whose card is not in the wallet yet does not credit a bid the agent may have won ----

/** A bid placed yesterday on #4881; the auction is gone (settled) and the card is not in the wallet. */
function settledRig(player: () => Promise<unknown>) {
  const m = setup()
  m.store.recordSpend({ agentIndex: 0, at: new Date(Date.now() - 25 * 3600_000), gameDay: '2026-10-12', category: 'play', action: 'bid:4881', foxsyAtomic: wholeToAtomic(1100), egldAtomic: 0n, usd: 2.5, txHash: 'h1', dryRun: false })
  const chain = { query: async () => [], esdts: async () => [{ tokenIdentifier: 'FOXSY-5d5f3e', balance: 1n, nonce: 0 }] }
  const deps = { store: m.store, chain: chain as never, fox: { tournament: async () => assert.fail('no seat here'), player } as never }
  const bids = () => m.store.openSpend(0, 'bid:', false).map(r => r.action)
  return { m, deps, bids }
}

test('C3 a won bid is not credited on the first sighting of the settled auction while the card is still in flight', async () => {
  const { m, deps, bids } = settledRig(async () => ({ nft_nonce: 4881, owner_address: ADDR }))
  assert.equal(await creditRefunds(deps, m.agent(), false), 0, 'the bid was credited back although the agent won the card')
  assert.deepEqual(bids(), ['bid:4881:won'], 'FoxLeague names the agent as the owner: closed as won, it keeps counting for good')
})

test('C3 another owner: the bid is credited only once the card stayed away for the grace period (a stale owner is not trusted at once)', async () => {
  const { m, deps, bids } = settledRig(async () => ({ nft_nonce: 4881, owner_address: STRANGER }))
  const now = Date.now()
  assert.equal(await creditRefunds(deps, m.agent(), false, now), 0, 'first sighting: the card may still be crossing shards')
  assert.equal(await creditRefunds(deps, m.agent(), false, now + 5 * 60_000), 0, 'still within the grace')
  assert.deepEqual(bids(), ['bid:4881'])
  assert.equal(await creditRefunds(deps, m.agent(), false, now + 11 * 60_000), 1, 'gone for good, someone else won: credited')
  assert.equal(m.store.spentUsd(0, { category: 'play', dryRun: false }), 0)
})

// ---- A2: no action is prepared, signed or sent after a graceful stop was requested ----

test('A2 no action starts after a graceful stop was requested during the snapshot taken for it', async () => {
  const { Service } = await import('../src/service.ts')
  const cfg = {
    mnemonic: Mnemonic.generate().toString(), dataDir: mkdtempSync(join(tmpdir(), 'foxagent-')), gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined, isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config
  const svc = new Service(cfg)
  svc.ensureAgents()
  svc.store.updateSettings(0, { minGapSeconds: 0 })
  const ran: string[] = []
  let stopped: Promise<void> | undefined
  // SIGTERM (a deploy) arrives while the action's snapshot is being read.
  ;(svc as unknown as { snapshot: unknown }).snapshot = async () => {
    stopped = svc.stop()
    return snapshot()
  }
  ;(svc as unknown as { executor: unknown }).executor = {
    liveEnabled: false,
    idle: true,
    run: async (_b: unknown, _w: unknown, _s: unknown, a: PlannedAction[]) => {
      ran.push(a[0]!.action.type)
      return [{ action: a[0]!.action, reason: '', status: 'dry_run', summary: '', costUsd: 0 }]
    },
  }
  const runPlan = (svc as unknown as { runPlan: (b: unknown, a: PlannedAction[], r: boolean) => Promise<void> }).runPlan.bind(svc)
  await runPlan(svc.store.agent(0), [{ action: { type: 'buy', product: 'training_slot' }, reason: 'r' }, { action: { type: 'play_match', match_type: 'casual' }, reason: 'r' }], false)
  await stopped
  assert.deepEqual(ran, [], 'stop() was called before the action: nothing may be prepared, signed or sent after it')
})

test('A2 the executor signs nothing once the service is stopping (asked before the booking and again before the signature)', async () => {
  for (const at of ['context', 'send'] as const) {
    let stopping = false
    let signed = 0
    const m = setup({
      chain: { account: async () => ((at === 'send' && (stopping = true)), { nonce: 1, balance: wholeToAtomic(10) }) },
      fox: { user: async () => null, shopConfirm: async () => ({ message: 'ok' }) },
    })
    m.exec['d'].stopping = () => stopping
    if (at === 'context') stopping = true // the stop came while the action waited for its turn
    const wallet = { ...liveWallet, signTransaction: () => void signed++ }
    await withLive(m.store, async () => {
      const [r] = await m.exec.run(m.agent(), wallet, snapshot(), act({ type: 'buy', product: 'training_slot' }))
      assert.equal(r!.status, 'error', `${at}: ${r!.summary}`)
      assert.match(r!.summary, /stopping/)
      assert.equal(signed, 0, `${at}: nothing signed after the stop`)
      assert.equal(m.store.spentUsd(0, { category: 'play', dryRun: false }), 0, `${at}: nothing stays booked`)
    })
  }
})

// ---- A7: an agent with a Binance top-up on its way is not deleted as never used ----

function topUpRig(sentMinutesAgo: number, more: Record<string, unknown> = {}) {
  const A = (n: number) => `erd1${String(n).padStart(58, 'q')}`
  const store = new Store('', ':memory:')
  for (let i = 0; i < 4; i++) store.addAgent(i, A(i))
  store.setLiveMode(true)
  const binance = { egldOnBinance: async () => { throw new Error('not read here') }, travelRuleCountry: async () => 'NIL', withdrawEgld: async () => 'x', findWithdrawal: async () => null, whitelisted: async () => true }
  const topups = new TopUps({ store, key: () => ({ apiKey: 'k', secret: 's' }), accountType: () => undefined, live: () => true, binance, send: () => undefined })
  const at = new Date(Date.now() - sentMinutesAgo * 60_000)
  store.setKv('topups', JSON.stringify([{
    id: 'fla4-abc', agentIndex: 3, address: A(3), codeHash: 'h', withdrawEgld: 2, receiveEgld: 1.998, feeEgld: 0.002, playableUsd: 0, warningUsd: 10, targetUsd: 150, egldUsd: 25,
    createdAt: at.toISOString(), expiresAt: new Date(at.getTime() + 3600_000).toISOString(), status: 'sent', binanceId: 'bn-1', ...more,
  }]))
  return { store, topups, deps: { store, chain: { account: async (address: string) => ({ address, nonce: 0, balance: 0n }), esdts: async () => [] }, fox: { user: async () => null }, topups, agentCount: 1 } }
}

test('A7 an agent with a Binance top-up on its way (sent two minutes ago, not arrived) is not deleted as never used', async () => {
  const { deps } = topUpRig(2)
  await assert.rejects(neverUsedOrWhy(deps, 3), /top-up/, 'EGLD is on its way to this wallet: it is not "never used"')
  // Sent at its last minute: the hour counts from the sending, not from the offer.
  const late = topUpRig(70, { sentAt: new Date(Date.now() - 10 * 60_000).toISOString() })
  await assert.rejects(neverUsedOrWhy(late.deps, 3), /top-up/)
})

test('A7 control: a top-up sent more than an hour ago has landed (or the wallet read says so): it no longer holds the delete', async () => {
  const { deps } = topUpRig(130, { sentAt: new Date(Date.now() - 125 * 60_000).toISOString() })
  assert.equal((await neverUsedOrWhy(deps, 3)).index, 3)
})

test('C3 the owner unreadable: the bid keeps counting, even after the grace period', async () => {
  const { m, deps, bids } = settledRig(async () => { throw new Error('HTTP 502') })
  const now = Date.now()
  assert.equal(await creditRefunds(deps, m.agent(), false, now), 0)
  assert.equal(await creditRefunds(deps, m.agent(), false, now + 30 * 60_000), 0)
  assert.deepEqual(bids(), ['bid:4881'])
})
