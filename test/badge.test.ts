// The team badge: generated once for free when the team has none, never paid for.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Store } from '../src/store/db.ts'
import { ApiRefusal } from '../src/foxleague/api.ts'
import { ensureBadge, type BadgeDeps } from '../src/setup/badge.ts'
import type { Team } from '../src/foxleague/types.ts'
import { ADDR, liveWallet } from './fixtures.ts'

const team = (badge: string | null = null): Team => ({ id: 1, user_id: 946, name: 'Fox Test XI', coach_name: null, formation: '4-4-2', lineup: [], substitutes: [], team_overall: 50, badge })

function setup(fox: { generateBadge?: (...a: unknown[]) => Promise<unknown>; saveBadge?: (...a: unknown[]) => Promise<unknown> } = {}) {
  const store = new Store('', ':memory:')
  store.addAgent(0, ADDR)
  const calls: string[] = []
  const notes: string[] = []
  const deps = {
    store,
    notify: (t: string) => { notes.push(t) },
    fox: {
      generateBadge: async (...a: unknown[]) => { calls.push(`generate ${a[1]}`); return fox.generateBadge ? fox.generateBadge(...a) : { badge_ipfs_uri: 'ipfs://cid1', team_name: 'Fox Test XI', regenerations_used: 1, regenerations_max: 3 } },
      saveBadge: async (...a: unknown[]) => { calls.push(`save ${a[1]}`); return fox.saveBadge ? fox.saveBadge(...a) : {} },
    },
  }
  return { store, calls, notes, run: (t: Team | null, dry = false) => ensureBadge(deps as unknown as BadgeDeps, 0, liveWallet, t, dry) }
}

test('badge: a team without one gets a free badge, generated and saved once', async () => {
  const s = setup()
  await s.run(team())
  assert.deepEqual(s.calls, ['generate Fox Test XI', 'save ipfs://cid1'])
  assert.match(s.notes.join(), /badge/)
  // Done for good, even if FoxLeague's team read lags behind.
  await s.run(team())
  assert.equal(s.calls.length, 2)
})

test('badge: nothing happens before registration or when the team has a badge', async () => {
  const s = setup()
  await s.run(null)
  await s.run(team('ipfs://owner-chosen'))
  assert.deepEqual(s.calls, [])
})

test('badge: dry run generates nothing', async () => {
  const s = setup()
  await s.run(team(), true)
  await s.run(team(), true)
  assert.deepEqual(s.calls, [])
  assert.equal(s.store.activity(0).filter(a => /badge/.test(a.summary)).length, 1)
})

test('badge: never paid for; once FoxLeague asks for FOXSY the agent stops asking', async () => {
  const s = setup({
    generateBadge: async () => { throw new ApiRefusal("You've used your 3 free badge regenerations. The next one costs 1000 FOXSY.", undefined, { payment_required: true, cost_foxsy: 1000, free_regens: 3, regen_count: 3 }) },
  })
  await s.run(team())
  await s.run(team())
  assert.deepEqual(s.calls, ['generate Fox Test XI'])
  assert.match(s.notes.join(), /1000 FOXSY/)
})

test('badge: a save that fails keeps the generated badge; the next cycle saves it without generating again', async () => {
  let fail = true
  const s = setup({ saveBadge: async () => { if (fail) throw new Error('timeout'); return {} } })
  await s.run(team())
  fail = false
  await s.run(team())
  assert.deepEqual(s.calls, ['generate Fox Test XI', 'save ipfs://cid1', 'save ipfs://cid1'])
})

test('badge: gives up after 5 failed cycles', async () => {
  const s = setup({ generateBadge: async () => { throw new ApiRefusal('Badge service temporarily unavailable, please retry.') } })
  for (let i = 0; i < 7; i++) await s.run(team())
  assert.equal(s.calls.length, 5)
  assert.match(s.notes.join(), /gave up/)
})

test('badge: an answer that is not an ipfs:// address is never saved', async () => {
  const s = setup({ generateBadge: async () => ({ badge_ipfs_uri: 'https://evil.example/x.png' }) })
  await s.run(team())
  assert.deepEqual(s.calls, ['generate Fox Test XI'])
})
