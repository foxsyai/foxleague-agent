// P2 (audit 2026-11-16, behaviour review): 52 of the week's 161 bids were refused "below the minimum": another bid
// landed in the up to 48 minutes between the plan's snapshot and the action, and the plan's exact amount no longer
// won. A bid may now carry a ceiling, max_foxsy: the executor pays the fresh minimum up to it, never less than the
// amount planned and never above the owner's Max bid, the rarity limit or the build cost; the same rules and booking.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAction } from '../../src/executor/actions.ts'
import { wholeToAtomic } from '../../src/util/encoding.ts'
import { STRANGER, dryWallet, encodeAuction, setup, snapshot } from '../fixtures.ts'

const card = (rarity: string) => ({ user: async () => null, player: async () => ({ rarity, transferred_at: null, transfer_cooldown_hours: null, owner_address: STRANGER }) })

/** An auction with a reserve of 500 and this top bid; the bid transactions the dry run simulates, kept. */
function market(top: number, rarity = 'Rare') {
  const sent: string[] = []
  const m = setup({
    chain: {
      query: async (_sc: string, fn: string) => (fn === 'getAuction' ? [encodeAuction({ seller: STRANGER, min: wholeToAtomic(500), top: wholeToAtomic(top), bidder: top ? STRANGER : null, endsInS: 3600 })] : []),
      simulate: async (tx: { data?: string }) => (sent.push(Buffer.from(String(tx.data ?? ''), 'base64').toString()), { ok: true, detail: 'success', raw: {} }),
    },
    fox: card(rarity),
  })
  return { ...m, sent }
}

/** The whole FOXSY a simulated auctionBid carries (ESDTTransfer@token@amount@auctionBid@nonce). */
const amountOf = (data: string) => Number(BigInt(`0x${data.split('@')[2]}`) / 10n ** 18n)
const booked = (store: ReturnType<typeof setup>['store']) => ((store as unknown as { db: { prepare(q: string): { all(): { foxsy_atomic: string }[] } } }).db.prepare("SELECT foxsy_atomic FROM spend WHERE action LIKE 'bid:%'").all()).map(r => Number(BigInt(r.foxsy_atomic) / 10n ** 18n))

async function bid(top: number, raw: Record<string, unknown>, rarity?: string) {
  const m = market(top, rarity)
  const [r] = await m.exec.run(m.agent(), dryWallet, snapshot(), [{ action: parseAction({ type: 'bid', nonce: 20, ...raw }), reason: '' }])
  return { r: r!, sent: m.sent, booked: booked(m.store) }
}

test('P2: a bid with a ceiling pays the fresh minimum when another bid landed since the plan, up to the ceiling', async () => {
  // The plan saw a top bid of 600 and bid 700, up to 900. Another team bid 800 since: the minimum is now 840.
  const moved = await bid(800, { foxsy: 700, max_foxsy: 900 })
  assert.equal(moved.r.status, 'dry_run', moved.r.summary)
  assert.deepEqual(moved.sent.map(amountOf), [840], 'the bid signed is the fresh minimum')
  assert.deepEqual(moved.booked, [840], 'and the ledger books what is signed')
  assert.match(moved.r.summary, /840/)
  // Without a ceiling, as before: refused below the minimum.
  const plain = await bid(800, { foxsy: 700 })
  assert.equal(plain.r.status, 'refused')
  assert.match(plain.r.summary, /below the minimum 840/)
  // The minimum still under the amount planned: the amount planned, never less.
  const still = await bid(600, { foxsy: 700, max_foxsy: 900 })
  assert.deepEqual(still.sent.map(amountOf), [700])
})

test('P2: never above the ceiling, the owner\'s Max bid or the rarity limit', async () => {
  // The fresh minimum (945) above the ceiling: refused, nothing signed.
  const over = await bid(900, { foxsy: 700, max_foxsy: 900 })
  assert.equal(over.r.status, 'refused')
  assert.match(over.r.summary, /below the minimum 945/)
  assert.match(over.r.summary, /ceiling 900/)
  assert.deepEqual(over.sent, [])
  // A ceiling above the owner's Max bid (2,500 here): the minimum (2,625) is refused by the Max bid, as a bid of it is.
  const owner = await bid(2500, { foxsy: 2000, max_foxsy: 9000 })
  assert.equal(owner.r.status, 'refused')
  assert.match(owner.r.summary, /exceeds the per-action maximum 2500/)
  assert.deepEqual(owner.sent, [])
  // An Uncommon card: the minimum (1,680) above the Uncommon limit (1,650 since BIDS-1) is refused by it, whatever the ceiling.
  const rare = await bid(1600, { foxsy: 1200, max_foxsy: 2400 }, 'Uncommon')
  assert.equal(rare.r.status, 'refused')
  assert.match(rare.r.summary, /above your limit for an Uncommon \(1650 FOXSY\)/)
  assert.deepEqual(rare.sent, [])
})

test('P2: the ceiling is a whole number no lower than the bid', () => {
  assert.throws(() => parseAction({ type: 'bid', nonce: 20, foxsy: 700, max_foxsy: 600 }), /max_foxsy/)
  assert.throws(() => parseAction({ type: 'bid', nonce: 20, foxsy: 700, max_foxsy: 750.5 }), /max_foxsy/)
  assert.deepEqual(parseAction({ type: 'bid', nonce: 20, foxsy: 700 }), { type: 'bid', nonce: 20, foxsy: 700 })
  assert.deepEqual(parseAction({ type: 'bid', nonce: 20, foxsy: 700, max_foxsy: 900 }), { type: 'bid', nonce: 20, foxsy: 700, max_foxsy: 900 })
})

test('P2: the action catalogue offers the ceiling', async () => {
  const { SYSTEM_PROMPT } = await import('../../src/strategist/prompt.ts')
  assert.match(SYSTEM_PROMPT, /\{"type":"bid","nonce":N,"foxsy":N,"max_foxsy":N\}[^\n]*the executor bids the new minimum up to it/)
})
