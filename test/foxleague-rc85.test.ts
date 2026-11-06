// FoxLeague's release of 2026-11-05 (rc.85, its main 16d9a455e, live on mainnet 23:51:59 UTC) against the agent.
// R85-1: a ranked or casual match holds its team until its broadcast has aired (matches.rs live_match_predicate:
// the simulation, about 1.5 minutes, then the recording's 600 s plus stoppage time, then 30 s); the agent spaced its
// matches 11 minutes apart and FoxLeague refused three starts on 2026-11-05 at 11 min 6 s ("Already in match").
// R85-2: since FoxLeague's #638 the broadcast starts by itself, and GET /api/matches/active returns the previous match
// while it airs (status 'finished'); a start whose answer was lost took that match for the new one.
// R85-3: since FoxLeague's #647 the AI of a casual game plays at the OVR it is built at; before, every AI player
// played as a Common, at 30 at most, so the casual games played before it say nothing of a formation now.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scheduleActions } from '../src/service.ts'
import { Store } from '../src/store/db.ts'
import { liveWallet, setup, snapshot, withLive } from './fixtures.ts'

const MIN = 60_000

test('R85-1: a plan spaces a casual and a ranked match by FoxLeague\'s in-match gate (simulation, broadcast and 30 s), not 11 minutes', () => {
  const casual = { action: { type: 'play_match' as const, match_type: 'casual' as const }, reason: '' }
  const ranked = { action: { type: 'play_match' as const, match_type: 'ranked' as const }, reason: '' }
  const [first, second] = scheduleActions([casual, ranked], { windowMs: 48 * MIN, gapMs: 30_000, random: () => 0 }).kept.map(k => k.offset)
  // About 90 s of simulation (FoxLeague's manual), a 615 s recording (6149 frames seen) and the gate's 30 s.
  assert.ok(second! - first! >= 90_000 + 615_000 + 30_000, `the ranked start comes ${((second! - first!) / MIN).toFixed(2)} min after the casual one`)
  const [after] = scheduleActions([casual], { windowMs: 48 * MIN, gapMs: 30_000, random: () => 0, lastMatchMs: -11.5 * MIN }).kept.map(k => k.offset)
  assert.ok(after! > 0, 'a match started 11.5 minutes before the plan still airs: the casual start waits')
})

test('R85-2: a Play whose answer was lost does not take the previous match, still on air, for the new one', async () => {
  const timeout = async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError') }
  const onAir = setup({ fox: { playMatch: timeout, activeMatch: async () => ({ match_id: 6, kind: 'ranked', status: 'finished', tournament_id: null, created_at: new Date(Date.now() - 12 * MIN).toISOString() }) } })
  await withLive(onAir.store, async () => {
    const [r] = await onAir.exec.run(onAir.agent(), liveWallet, snapshot(), [{ action: { type: 'play_match', match_type: 'casual' }, reason: '' }])
    assert.equal(r!.status, 'error', r!.summary)
    assert.match(r!.summary, /aborted due to timeout/)
    assert.doesNotMatch(r!.summary, /match #6 started/)
  })
  // The new match itself, created after the press, counts whatever its status (a long wait may find it on air already).
  const fresh = setup({ fox: { playMatch: timeout, activeMatch: async () => ({ match_id: 7, kind: 'ranked', status: 'finished', tournament_id: null, created_at: new Date().toISOString() }) } })
  await withLive(fresh.store, async () => {
    const [r] = await fresh.exec.run(fresh.agent(), liveWallet, snapshot(), [{ action: { type: 'play_match', match_type: 'casual' }, reason: '' }])
    assert.equal(r!.status, 'confirmed', r!.summary)
    assert.match(r!.summary, /match #7 started \(casual\)/)
  })
})

test('R85-2: without a readable creation time the read-back counts a match only while it is still being played', async () => {
  const timeout = async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError') }
  const read = (status: string) => async () => ({ match_id: 8, kind: 'ranked', status, tournament_id: null, created_at: 'unknown' })
  const playing = setup({ fox: { playMatch: timeout, activeMatch: read('simulating') } })
  await withLive(playing.store, async () => {
    const [r] = await playing.exec.run(playing.agent(), liveWallet, snapshot(), [{ action: { type: 'play_match', match_type: 'casual' }, reason: '' }])
    assert.equal(r!.status, 'confirmed', r!.summary)
    assert.match(r!.summary, /match #8 started \(casual\)/)
  })
  const airing = setup({ fox: { playMatch: timeout, activeMatch: read('finished') } })
  await withLive(airing.store, async () => {
    const [r] = await airing.exec.run(airing.agent(), liveWallet, snapshot(), [{ action: { type: 'play_match', match_type: 'casual' }, reason: '' }])
    assert.equal(r!.status, 'error', r!.summary)
    assert.doesNotMatch(r!.summary, /match #8 started/)
  })
})

test('R85-3: the casual test bench counts no game played before FoxLeague\'s AI played at its full strength', t => {
  // The clock is pinned the night of the change, so the 40-day window keeps both games and only the cut-off can drop one.
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-06T00:30:00.000Z') })
  const store = new Store('', ':memory:')
  const g = (key: string, at: string, mine: string) => ({ key, at, mine, theirs: '4-4-2', gf: 2, ga: 1, edge: 1, rivalUserId: null })
  store.putCasualResults(0, [g('m:1', '2026-11-05T15:38:52.000Z', '4-3-3w'), g('m:2', '2026-11-06T00:29:00.000Z', '4-3-3b')])
  const bench = store.casualBench()
  assert.deepEqual(bench.rows.map(r => [r.mine, r.played]), [['4-3-3b', 1]], 'the game against the AI capped at 30 is left out')
})
