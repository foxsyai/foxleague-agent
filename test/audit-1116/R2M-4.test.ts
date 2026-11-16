// R2M-4 (round two of the audit of 16 Nov 2026; the MONEY2 reviewer's "seen, not counted", fixed on the coordinator's
// word): with the owner's pause on (P-W7), manualWatch.held() answered [] when the state it reads could not be read:
// a pause row that is not JSON or not of its shape, a stored check that cannot be parsed, a copy whose manual.md or
// page record cannot be read. So the pause the owner chose held nothing, and the agents bought, bid and fused on rules
// FoxLeague had changed. Unknown is not "nothing changed" (rule 4): with the pause on, every family it covers is held.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HOLD_PAGES, heldActions, holdRefusal } from '../../src/executor/hold.ts'
import { AT_0700, mcp, memoryKv, watch } from './watch-helpers.ts'

const ALL = Object.keys(HOLD_PAGES).sort()

async function pausedBehindOnShop() {
  const server = mcp()
  server.state.pages['mechanics/shop'] = 'A Common pack costs 9,000 FOXSY.'
  const kv = memoryKv()
  const w = watch(server, { kv })
  w.setHold(true)
  assert.equal((await w.today(AT_0700))?.state, 'behind')
  assert.deepEqual(w.held(), ['mechanics/shop'], 'control: the pause holds the Shop page')
  return { w, kv }
}

test('R2M-4 a pause row that cannot be parsed holds every family the pause covers', async () => {
  const { w, kv } = await pausedBehindOnShop()
  kv.m.set('manual_behind', '{"copy": "abc", "pages": [')
  assert.deepEqual([...w.held()].sort(), ALL, 'the pause is on and its state cannot be read: nothing held')
  for (const a of [{ type: 'buy', product: 'common_pack' }, { type: 'bid', nonce: 1, bid_foxsy: 10 }, { type: 'fuse', player_nonces: [1, 2, 3], position_of: 0 }, { type: 'create_tournament' }, { type: 'create_challenge' }] as const)
    assert.match(holdRefusal(a as never, w.held()) ?? '', /paused by the owner's choice/, a.type)
  assert.deepEqual(heldActions(w.held()).length, Object.values(HOLD_PAGES).flat().length)
})

test('R2M-4 a pause row of the wrong shape, or a stored check that cannot be parsed, holds every family too', async () => {
  const a = await pausedBehindOnShop()
  a.kv.m.set('manual_behind', JSON.stringify({ copy: 7, pages: 'mechanics/shop' }))
  assert.deepEqual([...a.w.held()].sort(), ALL)
  const b = await pausedBehindOnShop()
  b.kv.m.delete('manual_behind')
  b.kv.m.set('manual_check', '{"state": "behind", "pag')
  assert.deepEqual([...b.w.held()].sort(), ALL)
})

test('R2M-4 a copy whose manual or page record cannot be read holds every family', async () => {
  const { w } = await pausedBehindOnShop()
  w.readManual = () => {
    throw new Error('EACCES')
  }
  assert.deepEqual([...w.held()].sort(), ALL)
})

test('R2M-4 control: with the pause off nothing is held, whatever the rows; a check of another copy holds nothing', async () => {
  const { w, kv } = await pausedBehindOnShop()
  kv.m.set('manual_behind', 'not json')
  w.setHold(false)
  assert.deepEqual(w.held(), [])
  w.setHold(true)
  kv.m.set('manual_behind', JSON.stringify({ copy: 'another copy', pages: ['mechanics/shop'] }))
  kv.m.set('manual_check', JSON.stringify({ state: 'behind', pages: ['mechanics/shop'], why: null, synced: null, at: new Date(AT_0700).toISOString(), day: '2026-11-16', copy: 'another copy' }))
  assert.deepEqual(w.held(), [], 'the pause ends when another copy comes, until its first check (a design choice of P-W7)')
})
