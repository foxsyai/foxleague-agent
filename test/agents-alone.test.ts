// Owner, 2026-10-27: each agent plays as if it were alone, with no friends. It joins any tournament, takes a 1v1
// against any team and bids on any card, whoever of the owner's other teams is in it, sells it or bids on it: if one
// agent sells a player another one really needs, that one buys it. Undone: one of the owner's teams at a time per
// rival (C1, R19A-1, A1, A2 of 2026-10-23), one team per card at auction (SB1 to SB3 of 2026-10-23) and a Zeus private
// tournament leaving the owner's teams out of its invites (2026-10-10). Kept by the owner: the pooled formation record
// (no team named). FoxLeague's manual lists selling a card at auction and buying it back with another wallet of yours
// as a normal route; its Fair Play forbids teams coordinated against other managers, which agents that know nothing
// of each other cannot be.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Mnemonic } from '@multiversx/sdk-core'
import type { Config } from '../src/config.ts'
import { Service } from '../src/service.ts'
import { budgetView } from '../src/executor/budget.ts'
import { parseAction } from '../src/executor/actions.ts'
import { DEFAULT_SETTINGS, STRATEGY_PRESETS } from '../src/store/settings.ts'
import type { Store } from '../src/store/db.ts'
import { renderPlanRequest, type PlanInput } from '../src/strategist/strategist.ts'
import { wholeToAtomic } from '../src/util/encoding.ts'
import { OTHER, STRANGER, TEST_SETTINGS, dryWallet, encodeAuction, setup, snapshot } from './fixtures.ts'

const FOX = { user: async () => null, player: async () => ({ rarity: 'Rare', transferred_at: null, transfer_cooldown_hours: null, owner_address: STRANGER }) }
const auction = (o: { seller?: string; bidder?: string | null; top?: bigint } = {}) => ({
  query: async (_sc: string, fn: string) => (fn === 'getAuction' ? [encodeAuction({ seller: o.seller ?? STRANGER, min: wholeToAtomic(500), top: o.top ?? 0n, bidder: o.bidder ?? null, endsInS: 3600 })] : []),
})
const bid = (nonce = 20, foxsy = 700) => [{ action: { type: 'bid' as const, nonce, foxsy }, reason: '' }]
const SIBLING_WALLET = { ...dryWallet, index: 1, address: OTHER }
const RIVAL = { id: 50, wallet_address: STRANGER, team_name: 'Rival', elo_rating: 1190, league: 'Bronze', accepted7d: 3 }
const CHALLENGE = { type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: 50, deadline_minutes: 60 } as const
const OWN_RULE = /another of your owner's teams|one team per card|one at a time per rival/

/** Agent 2 of the same install (index 1) with an action logged ten minutes ago. */
function sibling(store: Store, kind: string, detail: Record<string, unknown>) {
  if (!store.agent(1)) store.addAgent(1, OTHER)
  const id = store.log({ agentIndex: 1, kind, status: 'dry_run', summary: `${kind} by agent 2`, detail: { reason: '', ...detail } })
  ;(store as unknown as { db: { prepare(q: string): { run(...a: unknown[]): void } } }).db.prepare('UPDATE activity SET at = ? WHERE id = ?').run(new Date(Date.now() - 10 * 60_000).toISOString(), id)
}

function testConfig(dir: string): Config {
  return {
    mnemonic: Mnemonic.generate().toString(), dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as unknown as Config
}

test('AL1 an agent buys a card another of the owner\'s teams sells, and bids on one another of them leads or has bid on', async () => {
  const sells = setup({ chain: auction({ seller: OTHER }), fox: FOX })
  sells.store.addAgent(1, OTHER)
  const [a] = await sells.exec.run(sells.agent(), dryWallet, snapshot(), bid(20))
  assert.equal(a!.status, 'dry_run', a!.summary)

  const leads = setup({ chain: auction({ bidder: OTHER, top: wholeToAtomic(600) }), fox: FOX })
  leads.store.addAgent(1, OTHER)
  const [b] = await leads.exec.run(leads.agent(), dryWallet, snapshot(), bid(20))
  assert.equal(b!.status, 'dry_run', b!.summary)

  const bidOn = setup({ chain: auction(), fox: FOX })
  sibling(bidOn.store, 'bid', { action: { type: 'bid', nonce: 20, foxsy: 700 } })
  const [c] = await bidOn.exec.run(bidOn.agent(), dryWallet, snapshot(), bid(20))
  assert.equal(c!.status, 'dry_run', c!.summary)
})

test('AL1 two agents checking at once may both bid on the same card', async () => {
  let release: () => void = () => undefined
  const held = new Promise<void>(r => { release = r })
  const m = setup({ chain: { ...auction(), simulate: async () => { await held; return { ok: true, detail: 'success', raw: {} } } }, fox: FOX })
  m.store.addAgent(1, OTHER)
  m.store.updateSettings(1, TEST_SETTINGS)
  const first = m.exec.run(m.agent(), dryWallet, snapshot(), bid(20))
  await new Promise(r => setTimeout(r, 30))
  const second = m.exec.run(m.store.agent(1)!, SIBLING_WALLET, snapshot(), bid(20))
  await new Promise(r => setTimeout(r, 30))
  release()
  const [[a], [b]] = await Promise.all([first, second])
  assert.equal(a!.status, 'dry_run', a!.summary)
  assert.equal(b!.status, 'dry_run', b!.summary)
})

test('AL2 an agent takes a 1v1 against a team another of the owner\'s teams has a 1v1 out against, also at the same moment', async () => {
  const s = () => { const x = snapshot(); x.leaderboardNeighbours = [RIVAL]; return x }
  const out = setup()
  sibling(out.store, 'create_challenge', { action: { ...CHALLENGE, deadline_minutes: 120 }, opponentUserId: 50 })
  const [a] = await out.exec.run(out.agent(), dryWallet, s(), [{ action: CHALLENGE, reason: '' }])
  assert.equal(a!.status, 'dry_run', a!.summary)

  let release: () => void = () => undefined
  const held = new Promise<void>(r => { release = r })
  const m = setup({ chain: { simulate: async () => { await held; return { ok: true, detail: 'success', raw: {} } } } })
  m.store.addAgent(1, OTHER)
  m.store.updateSettings(1, TEST_SETTINGS)
  const first = m.exec.run(m.agent(), dryWallet, s(), [{ action: CHALLENGE, reason: '' }])
  await new Promise(r => setTimeout(r, 30))
  const second = m.exec.run(m.store.agent(1)!, SIBLING_WALLET, s(), [{ action: CHALLENGE, reason: '' }])
  await new Promise(r => setTimeout(r, 30))
  release()
  const [[b], [c]] = await Promise.all([first, second])
  assert.equal(b!.status, 'dry_run', b!.summary)
  assert.equal(c!.status, 'dry_run', c!.summary)
})

test('AL3 a Zeus private tournament invites every team the plan names, one the owner runs too', async () => {
  const m = setup()
  m.store.updateSettings(0, { ...TEST_SETTINGS, strategy: STRATEGY_PRESETS.zeus! })
  m.store.setKv('agent_user_id:1', '12') // the FoxLeague user id the service notes for another of the owner's agents
  const s = snapshot()
  s.market.recentStandard = [{ id: 1, tier: 'silver', format: 'round_robin', max_teams: 8, seated: 8, fee: 1000, status: 'completed', starts_at: new Date().toISOString() }] as never
  const cup = { type: 'create_tournament', title: 'Varna Cup', format: 'round_robin', tier: 'silver', max_teams: 6, min_teams: 4, entry_fee_foxsy: 1000, starts_in_hours: 6, registration_closes_minutes_before: 60, round_interval_minutes: 60, invite_user_ids: [11, 12, 13] }
  const [r] = await m.exec.run(m.agent(), dryWallet, s, [{ action: parseAction(cup), reason: '' }])
  assert.doesNotMatch(r!.summary, /cannot reach the minimum/, r!.summary)
  assert.equal(r!.status, 'dry_run', r!.summary)
})

test('AL4 the plan request marks no team and no card as taken by another of the owner\'s teams', async () => {
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-alone-'))))
  svc.ensureAgents()
  sibling(svc.store, 'bid', { action: { type: 'bid', nonce: 20, foxsy: 700 } })
  sibling(svc.store, 'create_challenge', { action: { ...CHALLENGE, target_user_id: 878 }, opponentUserId: 878 })
  const s = snapshot()
  const listing = (nonce: number, owner = STRANGER) => ({ nft_nonce: nonce, owner_address: owner, name: `Card ${nonce}`, position: 'FWD', rarity: 'Rare', level: 1, speed: 40, accuracy: 40, defense: 40, power: 40, control: 40, vision: 40, stamina: 40, condition: 100, is_auction: true, min_price: 500, highest_bid: null, ends_at: new Date(Date.now() + 3600_000).toISOString(), transferred_at: null, transfer_cooldown_hours: null })
  s.market.auctions = [listing(20), listing(21, OTHER)] as never
  s.leaderboardNeighbours = [{ ...RIVAL, id: 878, team_name: 'Other' }]
  let text = ''
  svc.strategist = {
    model: 'claude-opus-5-5',
    plan: async (input: PlanInput) => {
      text = renderPlanRequest(input)
      return { summary: 'x', actions: [], rejected: [], usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0, servedBy: 'claude-opus-5-5' }, stopReason: 'end_turn' }
    },
  } as never
  await (svc as unknown as { makePlan: (a: unknown, s: unknown) => Promise<unknown> }).makePlan(svc.store.agent(0), s)
  assert.ok(text.includes('#20 ') && text.includes('#21 ') && text.includes('user 878)'), 'the cards and the team are listed')
  assert.doesNotMatch(text, /not available now/)
})

test('AL5 an earlier refusal of the removed rules is flagged as no longer holding', () => {
  const store = setup().store
  const row = (summary: string) => [{ id: 1, agentIndex: 0, at: new Date().toISOString(), kind: 'bid', status: 'refused', summary, detail: null, costUsd: null, txHash: null }]
  const plan = (summary: string) => renderPlanRequest({ snapshot: snapshot(), settings: DEFAULT_SETTINGS, budget: budgetView(store, 0, DEFAULT_SETTINGS, true, new Date()), recent: row(summary) as never, dryRun: true })
  for (const summary of [
    "bid 700 FOXSY on #20: refused: another of your owner's teams is bidding on #20 (one team per card: pick another card)",
    "bid 700 FOXSY on #20: refused: #20 is listed by another of your owner's teams: buying it would only move it between the owner's wallets and pay the 10 percent fee",
    "create silver 1v1, stake 1000 vs user 50: refused: another of your owner's teams already has a 1v1 out against user 50 (one at a time per rival: pick another team or wait until it is over)",
  ]) {
    const text = plan(summary)
    assert.match(text, /## Earlier entries\n/, summary)
    assert.match(text, /judge every tournament, 1v1 and auction on its merits/)
  }
  assert.doesNotMatch(plan('bid 700 FOXSY on #20: refused: bid exceeds the per-action maximum'), /## Earlier entries/)
})

test('AL6 the owner-facing pages say each agent plays alone, sharing only the pooled formation record', () => {
  const pages = ['README.md', 'INSTALL.md', 'site/src/content/docs/help/update.md', 'site/src/content/docs/help/faq.md', 'site/src/content/docs/play/safety.md', 'site/src/content/docs/play/how-it-plays.md', 'site/src/content/docs/play/strategy-levels.md']
  for (const f of pages) {
    const page = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\s+/g, ' ')
    assert.doesNotMatch(page, /one of them at a time|only one of them bids|one-team-per-card|one-at-a-time rule|one of your teams at a time per rival|never invites (another of your teams|your other agents)|never while another of your agents/, f)
  }
  for (const f of pages.slice(0, 5)) {
    const page = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\s+/g, ' ')
    assert.match(page, /plays its own game as if it were alone/, f)
    assert.match(page, /The one thing they share is a pooled formation record with no team named/, f)
  }
  assert.doesNotMatch(readFileSync(new URL('../src/strategist/prompt.ts', import.meta.url), 'utf8'), OWN_RULE, 'the prompt names no such rule')
})
