// HALT (see HALT-executor.test.ts): the gateway's read of the newest block of a shard and the threshold that says the
// network is not producing blocks. GET /network/status/<shard> answers `erd_block_timestamp_ms` (and
// `erd_block_timestamp` in seconds), as the public gateway and a MultiversX proxy serve it (mainnet, 18 Nov 2026: about
// a second old on the metachain and on shard 1, rounds of 600 ms).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BLOCK_CACHE_MS, BLOCK_STALE_MS, Chain, METACHAIN, chainHalt } from '../../src/chain/gateway.ts'

/** The gateway's answers, by URL; every URL asked is kept. */
async function withGateway<T>(answer: (url: string) => Response, fn: (asked: string[]) => Promise<T>): Promise<T> {
  const real = globalThis.fetch
  const asked: string[] = []
  globalThis.fetch = (async (url: string | URL) => (asked.push(String(url)), answer(String(url)))) as typeof fetch
  try {
    return await fn(asked)
  } finally {
    globalThis.fetch = real
  }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const status = (s: Record<string, unknown>) => json({ data: { status: s }, error: '', code: 'successful' })
const chain = () => new Chain({ gatewayUrl: 'http://gw.test', apiUrl: 'http://api.test', gatewayRps: 100, apiRps: 100 })
/** Mainnet's metachain at 2026-11-18 (the shape and the numbers as the public gateway served them). */
const META_STATUS = { erd_block_timestamp: 1795043337, erd_block_timestamp_ms: 1795043337000, erd_current_round: 42123946, erd_epoch_number: 2298, erd_nonce: 41223409, erd_rounds_per_epoch: 144000 }

test('HALT-1 the newest block of a shard is read from the gateway\'s network status, in ms', async () => {
  await withGateway(() => status(META_STATUS), async asked => {
    assert.equal(await chain().newestBlockMs(METACHAIN), 1795043337000)
    assert.deepEqual(asked, ['http://gw.test/network/status/4294967295'])
  })
  // A gateway that serves the seconds only (an older proxy): the same time.
  await withGateway(() => status({ erd_block_timestamp: 1795043337 }), async () => {
    assert.equal(await chain().newestBlockMs(1), 1795043337000)
  })
  // Sub-second block times (rounds of 600 ms) are kept as served.
  await withGateway(() => status({ erd_block_timestamp: 1795043337, erd_block_timestamp_ms: 1795043337600 }), async () => {
    assert.equal(await chain().newestBlockMs(1), 1795043337600)
  })
})

test('HALT-1 an answer that is not a block time is a failed read, never a time', async () => {
  const bad: [string, Response][] = [
    ['no status', json({ data: {}, error: '', code: 'successful' })],
    ['no block time', status({ erd_nonce: 41223409 })],
    ['a block time that is not a number', status({ erd_block_timestamp_ms: '1795043337000' })],
    ['zero', status({ erd_block_timestamp_ms: 0, erd_block_timestamp: 0 })],
    ['the two units disagree', status({ erd_block_timestamp_ms: 1795043337, erd_block_timestamp: 1795043337 })],
    ['seconds where the milliseconds go', status({ erd_block_timestamp_ms: 1795043337 })],
    ['the gateway\'s error', json({ data: null, error: 'shard not found', code: 'bad_request' }, 400)],
  ]
  for (const [what, res] of bad) {
    await withGateway(() => res.clone(), async () => {
      await assert.rejects(chain().newestBlockMs(1), Error, what)
    })
  }
})

test('HALT-1 a reading is kept a few seconds, well under the threshold; a failed one is not kept', async () => {
  assert.ok(BLOCK_CACHE_MS > 0 && BLOCK_CACHE_MS * 5 <= BLOCK_STALE_MS, 'a kept reading can make a block look at most BLOCK_CACHE_MS older, never fresher')
  const c = chain()
  await withGateway(() => status(META_STATUS), async asked => {
    await c.newestBlockMs(METACHAIN)
    await c.newestBlockMs(METACHAIN)
    await c.newestBlockMs(1)
    assert.deepEqual(asked, ['http://gw.test/network/status/4294967295', 'http://gw.test/network/status/1'])
  })
  const d = chain()
  let n = 0
  await withGateway(() => (n++ === 0 ? json({ data: null, error: 'internal', code: 'internal_issue' }, 500) : status(META_STATUS)), async asked => {
    await assert.rejects(d.newestBlockMs(1))
    assert.equal(await d.newestBlockMs(1), 1795043337000)
    assert.equal(asked.length, 2)
  })
})

/** A chain whose shards answer these block times (or errors); every shard asked is kept. */
function blocks(times: Record<number, number | Error>) {
  const asked: number[] = []
  return {
    asked,
    newestBlockMs: async (shard: number) => {
      asked.push(shard)
      const t = times[shard]
      if (t === undefined) throw new Error(`shard ${shard} was not expected`)
      if (t instanceof Error) throw t
      return t
    },
  }
}
const NOW = Date.parse('2026-11-17T15:00:00Z')
const HALTED_AT = Date.parse('2026-11-17T09:01:00Z')

test('HALT-2 a block under a second old, or a few missed rounds, is a chain producing blocks', async () => {
  assert.equal(await chainHalt(blocks({ [METACHAIN]: NOW - 600, 0: NOW - 300, 1: NOW - 900 }), [METACHAIN, 0, 1], () => NOW), null)
  // Ten missed rounds of 600 ms, a slow observer: far under the threshold.
  assert.equal(await chainHalt(blocks({ [METACHAIN]: NOW - 6_000, 1: NOW - 20_000 }), [METACHAIN, 1], () => NOW), null)
  // A clock a little behind the chain's (a block "from the future" by a few seconds).
  assert.equal(await chainHalt(blocks({ [METACHAIN]: NOW + 3_000 }), [METACHAIN], () => NOW), null)
  // The threshold itself still passes; one millisecond more does not.
  assert.equal(await chainHalt(blocks({ [METACHAIN]: NOW - BLOCK_STALE_MS }), [METACHAIN], () => NOW), null)
  assert.notEqual(await chainHalt(blocks({ [METACHAIN]: NOW - BLOCK_STALE_MS - 1 }), [METACHAIN], () => NOW), null)
})

test('HALT-2 a shard with no block for longer than the threshold is a halt, named with its last block', async () => {
  // 17 Nov 2026: no block from 09:01 UTC.
  assert.equal(
    await chainHalt(blocks({ [METACHAIN]: HALTED_AT, 1: NOW - 500 }), [METACHAIN, 1], () => NOW),
    'the MultiversX network has produced no block since 2026-11-17 09:01:00 UTC (the metachain, 5 h 59 min ago): nothing is signed, the next plan tries again',
  )
  assert.equal(
    await chainHalt(blocks({ [METACHAIN]: NOW - 500, 2: NOW - 3 * 60_000 }), [METACHAIN, 2], () => NOW),
    `the MultiversX network has produced no block since ${new Date(NOW - 3 * 60_000).toISOString().slice(0, 19).replace('T', ' ')} UTC (shard 2, 3 min ago): nothing is signed, the next plan tries again`,
  )
})

test('HALT-2 a shard whose status cannot be read, or one dated far ahead of this computer\'s clock, refuses too', async () => {
  assert.equal(
    await chainHalt(blocks({ [METACHAIN]: NOW - 500, 1: new Error('gateway /network/status/1: HTTP 502 no data') }), [METACHAIN, 1], () => NOW),
    'whether the MultiversX network is producing blocks could not be read (shard 1: gateway /network/status/1: HTTP 502 no data): nothing is signed, the next plan tries again',
  )
  assert.match(
    (await chainHalt(blocks({ [METACHAIN]: NOW + 10 * 60_000 }), [METACHAIN], () => NOW)) ?? '',
    /^the newest MultiversX block of the metachain is dated 2026-11-17 15:10:00 UTC, ahead of this computer's clock \(2026-11-17 15:00:00 UTC\) by more than 60 s: whether the network is producing blocks cannot be told, so nothing is signed \(check the computer's clock\); the next plan tries again$/,
  )
  // A chain client without the read at all.
  assert.match((await chainHalt({} as never, [METACHAIN], () => NOW)) ?? '', /could not be read \(the metachain: /)
  // Every shard is read, at once: one halted shard among fresh ones is enough.
  const b = blocks({ [METACHAIN]: NOW - 500, 0: NOW - 400, 1: HALTED_AT })
  assert.match((await chainHalt(b, [METACHAIN, 0, 1], () => NOW)) ?? '', /no block since 2026-11-17 09:01:00 UTC \(shard 1, /)
  assert.deepEqual(b.asked.sort(), [0, 1, METACHAIN])
})
