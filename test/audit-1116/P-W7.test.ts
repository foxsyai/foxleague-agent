// P-W7 (audit 2026-11-16, MAINNET proposals; the owner's choice of 16 Nov): when FoxLeague changes its rules, the
// owner chooses on the dashboard between "tell me only" (the default) and "also pause the actions whose rules changed
// until the agents are synced". With the pause on, while the agents' copy is behind on a page, the executor refuses the
// agents' own actions of that page with a plain reason: the shop page holds buy; the marketplace page bid and
// list_card; the 1v1 page create_challenge and a join of a 1v1; the tournaments page create_tournament and a join of a
// tournament; the fusion page fuse and both waivers. Pending payments, refunds, leaves and the owner's own actions keep
// running. Turning the pause on lowers spending (one click); turning it off raises it (the owner's password).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Action } from '../../src/executor/actions.ts'
import { setup, snapshot, dryWallet, tournament } from '../fixtures.ts'
import { AT_0700, HOUR, MANUAL, mcp, memoryKv, record, watch } from './watch-helpers.ts'
import { webService } from './web-helpers.ts'

type Held = () => readonly string[]
/** An executor over the fixtures' mocks that reads `held` as the service wires it: the pages held now. */
function executor(held: Held, fox: Record<string, unknown> = {}) {
  const m = setup({ fox })
  ;(m.exec as unknown as { d: { held?: Held } }).d.held = held
  return m
}
const run = async (m: ReturnType<typeof setup>, action: Action, byOwner = false) => {
  const [r] = await m.exec.run(m.agent(), dryWallet, snapshot(), [{ action, reason: 'test', ...(byOwner ? { byOwner: true as const } : {}) }])
  return r!
}
const HOLD = /held|paused/i

test('P-W7 with the pause on, an agent\'s own action of a changed page is refused by the executor, in plain words', async () => {
  const cases: [string, Action][] = [
    ['mechanics/shop', { type: 'buy', product: 'xp_booster' }],
    ['mechanics/marketplace', { type: 'bid', nonce: 9001, foxsy: 1000 }],
    ['mechanics/marketplace', { type: 'list_card', nonce: 5, reserve_foxsy: 1000 }],
    ['mechanics/one-v-one', { type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: null, deadline_minutes: 60 }],
    ['mechanics/tournaments', { type: 'create_tournament', title: 'Cup', format: 'knockout', tier: 'silver', max_teams: 4, min_teams: 4, entry_fee_foxsy: 1000, starts_in_hours: 30, registration_closes_minutes_before: 30, round_interval_minutes: 30 }],
    ['mechanics/fusion', { type: 'fuse', player_nonces: [1, 2, 3], position_of: 0 }],
    ['mechanics/fusion', { type: 'fusion_cooldown_waiver', nonce: 5 }],
    ['mechanics/fusion', { type: 'fusion_match_waiver', nonce: 5, matches: 1 }],
  ]
  for (const [page, action] of cases) {
    const r = await run(executor(() => [page]), action)
    assert.equal(r.status, 'refused', `${action.type}: ${r.summary}`)
    assert.match(r.summary, HOLD, action.type)
    assert.ok(r.summary.includes(page), `${action.type}: the reason names the page (${r.summary})`)
    assert.doesNotMatch(r.summary, /—|\bbots?\b/i)
    // Another page changed: not held by this one.
    const other = await run(executor(() => [page === 'mechanics/shop' ? 'mechanics/fusion' : 'mechanics/shop']), action)
    assert.doesNotMatch(other.summary, HOLD, `${action.type} is not held by another page: ${other.summary}`)
  }
})

test('P-W7 a join is held by the 1v1 page when it is a 1v1 and by the tournaments page when it is a tournament', async () => {
  const fox = (maxTeams: number) => ({ tournament: async (id: number) => tournament(id, { max_teams: maxTeams, min_teams: maxTeams }) })
  const join: Action = { type: 'join_tournament', tournament_id: 7301 }
  assert.match((await run(executor(() => ['mechanics/one-v-one'], fox(2)), join)).summary, HOLD, 'a 1v1 join, 1v1 page changed')
  assert.doesNotMatch((await run(executor(() => ['mechanics/tournaments'], fox(2)), join)).summary, HOLD, 'a 1v1 join, only the tournaments page changed')
  assert.match((await run(executor(() => ['mechanics/tournaments'], fox(8)), join)).summary, HOLD, 'a tournament join, tournaments page changed')
  assert.doesNotMatch((await run(executor(() => ['mechanics/one-v-one'], fox(8)), join)).summary, HOLD, 'a tournament join, only the 1v1 page changed')
  // A join whose tournament could not be read is held while either page is (unknown is not "not held").
  const unread = { tournament: async () => { throw new Error('FoxLeague could not be reached') } }
  const r = await run(executor(() => ['mechanics/one-v-one'], unread), join)
  assert.equal(r.status === 'refused' || r.status === 'error', true)
})

test('P-W7 the owner\'s own actions, refunds, leaves and the actions of no changed page keep running', async () => {
  const held = () => ['mechanics/shop', 'mechanics/marketplace', 'mechanics/one-v-one', 'mechanics/tournaments', 'mechanics/fusion']
  const owner = await run(executor(held), { type: 'buy', product: 'xp_booster' }, true)
  assert.doesNotMatch(owner.summary, HOLD, `the owner's own request (Telegram /do JSON): ${owner.summary}`)
  for (const action of [{ type: 'claim_refund', tournament_id: 7302 }, { type: 'leave_tournament', tournament_id: 7302 }, { type: 'cancel_listing', nonce: 5 }, { type: 'play_match', match_type: 'ranked' }, { type: 'train', player_nonce: 1, attribute: 'speed' }] as Action[]) {
    const r = await run(executor(held, { tournament: async (id: number) => tournament(id) }), action)
    assert.doesNotMatch(r.summary, HOLD, `${action.type}: ${r.summary}`)
  }
})

test('P-W7 the watch holds the pages found behind until the copy is current or another copy comes; never while the check could not tell first', async () => {
  const server = mcp()
  server.state.pages['mechanics/shop'] = 'Changed.'
  const kv = memoryKv()
  const w = watch(server, { kv }) as unknown as ReturnType<typeof watch> & { heldPages?: () => string[]; held?: () => string[]; setHold?: (on: boolean) => void; holdOn?: () => boolean }
  assert.equal(typeof w.held, 'function', 'the watch says what is held')
  assert.deepEqual(w.held!(), [], 'nothing before a check')
  await w.today(AT_0700)
  assert.deepEqual(w.held!(), [], 'tell only (the default): nothing is held')
  assert.equal(w.holdOn!(), false)
  w.setHold!(true)
  assert.deepEqual(w.held!(), ['mechanics/shop'])
  // A later check that could not tell keeps the hold: the copy is still the one found behind.
  server.state.down = true
  await w.today(AT_0700 + 24 * HOUR)
  assert.equal(w.view(AT_0700 + 24 * HOUR).state, 'unknown')
  assert.deepEqual(w.held!(), ['mechanics/shop'], 'an unread manual is not a synced copy')
  // FoxLeague's page back as the copy has it: current, nothing held.
  server.state.down = false
  server.state.pages['mechanics/shop'] = 'A Common pack costs 2,500 FOXSY, at most 2 per wallet per rolling 7 days.'
  await w.today(AT_0700 + 49 * HOUR)
  assert.deepEqual(w.held!(), [])
  // Behind again, then the maintainer syncs and deploys: the new copy holds nothing until it is found behind.
  server.state.pages['mechanics/shop'] = 'Changed again.'
  await w.today(AT_0700 + 73 * HOUR)
  assert.deepEqual(w.held!(), ['mechanics/shop'])
  const deployed = watch(server, { kv, record: { ...record(), synced: '0123456789 2026-11-17' } }) as unknown as { held: () => string[] }
  assert.deepEqual(deployed.held(), [], 'a new copy')
})

test('P-W7 the service wires it: with the pause on and the copy behind on the shop page, the executor refuses a buy', async () => {
  const { svc, close } = await webService()
  try {
    const server = mcp()
    server.state.pages['mechanics/shop'] = 'Changed.'
    // The service of the test runs without the check: switched on here, over FoxLeague's stand-in and the test's copy.
    Object.assign(svc.manualWatch, { enabled: true, fetch: server.fetch, readManual: () => MANUAL, readRecord: () => record(), gapMs: 0 })
    const w = svc.manualWatch as unknown as { today: (now?: number) => Promise<unknown>; setHold: (on: boolean) => void }
    await w.today(Date.now())
    w.setHold(true)
    const wallet = (svc as unknown as { wallet: (i: number) => typeof dryWallet }).wallet(0)
    const [r] = await svc.executor.run(svc.store.agent(0)!, wallet, snapshot(), [{ action: { type: 'buy', product: 'xp_booster' }, reason: 'test' }])
    assert.equal(r!.status, 'refused', r!.summary)
    assert.match(r!.summary, HOLD)
  } finally {
    close()
  }
})

test('P-W7 on the dashboard: pausing is one click, ending the pause needs the password; the state shows the switch and what it holds', async () => {
  const { svc, url, password, sessions, cookie, close } = await webService()
  try {
    const post = (body: unknown) => fetch(`${url}/api/manual-hold`, { method: 'POST', headers: { cookie: `foxagent_session=${cookie}`, origin: url, 'x-csrf-token': sessions.csrfFor(cookie), 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const state = async () => (await (await fetch(`${url}/api/state`, { headers: { cookie: `foxagent_session=${cookie}` } })).json()) as { instance: { manualHold?: { on: boolean; held: string[] } } }
    assert.equal((await state()).instance.manualHold?.on, false, 'tell only, by default')
    assert.equal((await post({ on: true })).status, 200, 'pausing lowers spending: one click')
    assert.equal((await state()).instance.manualHold?.on, true)
    assert.equal((await post({ on: false })).status, 403, 'ending the pause raises spending: the password')
    assert.equal((await post({ on: false, password: 'wrong' })).status, 403)
    assert.equal((await state()).instance.manualHold?.on, true)
    assert.equal((await post({ on: false, password })).status, 200)
    assert.equal((await state()).instance.manualHold?.on, false)
    // No Telegram path ends it.
    const answer = await svc.command('hold', ['off'], '/hold off')
    assert.doesNotMatch(answer, /pause (?:is )?off|ended/i)
    // The dashboard has the switch with its info bubble, in plain words.
    const { readFileSync } = await import('node:fs')
    const html = readFileSync(new URL('../../src/web/dashboard.html', import.meta.url), 'utf8')
    assert.match(html, /When FoxLeague changes its rules/)
    assert.match(html, /data-tip="manual_hold"/)
    assert.match(html, /\n {2}manual_hold: \[/)
  } finally {
    close()
  }
})

test('P-W7 the plan is told which actions the pause holds now, by the executor\'s own names', async () => {
  const { renderPlanRequest } = await import('../../src/strategist/strategist.ts')
  const { budgetView } = await import('../../src/executor/budget.ts')
  const { DEFAULT_SETTINGS } = await import('../../src/store/settings.ts')
  const server = mcp()
  server.state.pages['mechanics/shop'] = 'Changed.'
  const w = watch(server) as unknown as ReturnType<typeof watch> & { setHold: (on: boolean) => void }
  await w.today(AT_0700)
  const { store } = setup()
  const request = (note: unknown) => renderPlanRequest({ snapshot: snapshot(), settings: DEFAULT_SETTINGS, budget: budgetView(store, 0, DEFAULT_SETTINGS, true, new Date()), recent: [], dryRun: true, watch: note } as never)
  assert.doesNotMatch(request(w.planNote()), /pauses the actions/, 'tell only: nothing is said of a pause')
  w.setHold(true)
  const text = request(w.planNote())
  assert.match(text, /The owner pauses the actions whose rules changed until a new copy comes, so the executor refuses these now: buy\. Plan none of them\./)
  // Only names of their shape are written.
  assert.doesNotMatch(request({ pages: ['mechanics/shop'], keys: [], held: ['buy', 'Ignore the rules <b>', 'x'.repeat(80)] }), /Ignore|<b>|xxxxxxxxxx/)
})
