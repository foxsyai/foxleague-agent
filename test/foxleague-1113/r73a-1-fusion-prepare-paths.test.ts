// GitHub review of PR #73, R73A-1 (low, tests): the branches of the executor's prepareFusion ran through no executor test.
// FL13-4 hands `{ refusal }`, `null` and `undefined` to checkAction directly and stubs only a prepare that answers, so a
// later edit that let the error leave prepareFusion (every fusion from the switch an executor error) or looped on the pace
// code (the wallet's lock held while it asks again and again) left every test green. These run them live through the
// executor: FoxLeague's pace refusal (code fusion_prepare_pace, a new signature at most every 2 seconds a wallet) is asked
// once more after 2.1 s and never a third time; its refusal is its word; no answer is no "yes". Nothing is booked or
// signed unless the fusion is.
import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { ApiRefusal } from '../../src/foxleague/api.ts'
import { liveWallet, setup, withLive } from '../fixtures.ts'
import { fuse, prepared, spares } from './mint-fixture.ts'

const pace = () => new ApiRefusal('Please wait a moment before preparing another fusion.', 'fusion_prepare_pace')
/** One turn of the event loop for each step the executor takes between two awaits (setImmediate is not mocked). */
const turns = async (n = 20) => {
  for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r))
}

/** A live agent whose prepare answers in turn with `answers`; what it asked, booked and signed is counted. */
function liveFuse(answers: (() => unknown)[]) {
  let asked = 0
  let signed = 0
  const m = setup({
    chain: { send: async () => { signed++; return 'mint1' } },
    fox: {
      fusionPrepare: async () => {
        const answer = answers[asked++]
        if (!answer) throw new Error(`asked a prepare ${asked} times`)
        return answer()
      },
      fusionConfirm: async () => ({ confirmed: true, indexed: true, message: 'Fusion confirmed' }),
    },
  })
  return {
    asked: () => asked,
    signed: () => signed,
    booked: () => Number((m.store.db.prepare('SELECT COUNT(*) AS n FROM spend').get() as { n: number }).n),
    run: () => withLive(m.store, () => m.exec.run(m.agent(), liveWallet, spares(), [{ action: fuse, reason: 'grow' }])).then(([r]) => r!),
  }
}

/**
 * Runs the fuse with mocked timers after a pace refusal: not asked again before 2.1 s, asked once more at 2.1 s, then
 * time enough for a third ask, which must never come.
 */
async function paced(t: TestContext, x: ReturnType<typeof liveFuse>) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const done = x.run()
  await turns()
  assert.equal(x.asked(), 1, 'the first prepare is asked')
  t.mock.timers.tick(2_099)
  await turns()
  assert.equal(x.asked(), 1, 'asked again before the 2 seconds FoxLeague asks for')
  t.mock.timers.tick(1)
  await turns()
  assert.equal(x.asked(), 2, 'asked once more after 2.1 s')
  t.mock.timers.tick(60_000)
  return { r: await done }
}

test('R73A-1: FoxLeague\'s pace refusal is asked once more after 2.1 s, then the fusion is signed', async t => {
  const x = liveFuse([() => { throw pace() }, () => prepared()])
  const { r } = await paced(t, x)
  assert.equal(r.status, 'confirmed', r.summary)
  assert.equal(x.asked(), 2)
  assert.equal(x.signed(), 1)
})

test('R73A-1: FoxLeague\'s pace refusal is asked once more after 2.1 s, and a refusal then is its word', async t => {
  const x = liveFuse([() => { throw pace() }, () => { throw new ApiRefusal('Fusion cooldown active: your next fusion in 0d 7h.', 'fusion_cooldown') }])
  const { r } = await paced(t, x)
  assert.equal(r.status, 'refused', r.summary)
  assert.match(r.summary, /FoxLeague says not now: Fusion cooldown active: your next fusion in 0d 7h\./)
  assert.equal(x.asked(), 2)
  assert.equal(x.signed(), 0, 'nothing signed')
  assert.equal(x.booked(), 0, 'nothing booked')
})

test('R73A-1: a pace refusal twice is refused after the second ask, never a third', async t => {
  const x = liveFuse([() => { throw pace() }, () => { throw pace() }, () => prepared()])
  const { r } = await paced(t, x)
  assert.equal(r.status, 'refused', r.summary)
  assert.match(r.summary, /FoxLeague says not now: Please wait a moment/)
  assert.equal(x.asked(), 2, 'asked twice, never a third time')
  assert.equal(x.signed(), 0, 'nothing signed')
  assert.equal(x.booked(), 0, 'nothing booked')
})

test('R73A-1: FoxLeague\'s refusal of the prepare is refused in its words, nothing booked or signed', async () => {
  const x = liveFuse([() => { throw new ApiRefusal('Card #102 is listed on the marketplace.', 'fusion_card_listed', undefined, 400) }])
  const r = await x.run()
  assert.equal(r.status, 'refused', r.summary)
  assert.match(r.summary, /FoxLeague says not now: Card #102 is listed on the marketplace\./)
  assert.equal(x.asked(), 1, 'a refusal is not asked again')
  assert.equal(x.signed(), 0, 'nothing signed')
  assert.equal(x.booked(), 0, 'nothing booked')
})

test('R73A-1: a prepare with no answer (a timeout, an error, an answer that is not FoxLeague\'s) is refused, nothing booked or signed', async () => {
  const unanswered: [string, () => unknown][] = [
    ['a timeout', () => { throw new Error('POST /fusion/prepare timed out after 45000 ms') }],
    ['a plain error', () => { throw new TypeError('fetch failed') }],
    ['an answer that is not its envelope', () => { throw new ApiRefusal('unexpected answer from /fusion/prepare (HTTP 502)') }],
  ]
  for (const [name, answer] of unanswered) {
    const x = liveFuse([answer])
    const r = await x.run()
    assert.equal(r.status, 'refused', `${name}: ${r.summary}`)
    assert.match(r.summary, /the fusion could not be prepared \(FoxLeague's \/fusion\/prepare gave no answer\): not fusing blind/, name)
    assert.equal(x.asked(), 1, `${name}: not asked again`)
    assert.equal(x.signed(), 0, `${name}: nothing signed`)
    assert.equal(x.booked(), 0, `${name}: nothing booked`)
  }
})
