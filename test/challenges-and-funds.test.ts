// Owner, 2026-10-23: three of the owner's agents had 1v1 challenges out against the same team at once ("Akeno"):
// one of them at a time against a rival, never several piling on one manager. And an agent holding 199 EGLD wrote
// "the wallet holds about 770 FOXSY, so no entries, bids or recovery are possible": it judged what it could afford
// on its FOXSY alone, although the EGLD above its gas reserve swaps into FOXSY within its limits.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderPlanRequest } from '../src/strategist/strategist.ts'
import { SYSTEM_PROMPT } from '../src/strategist/prompt.ts'
import { budgetView } from '../src/executor/budget.ts'
import { DEFAULT_SETTINGS } from '../src/store/settings.ts'
import { wholeToAtomic } from '../src/util/encoding.ts'
import { OTHER, STRANGER, TEST_SETTINGS, dryWallet, setup, snapshot, tournament } from './fixtures.ts'

const RIVAL = { id: 50, wallet_address: STRANGER, team_name: 'Rival', elo_rating: 1190, league: 'Bronze', accepted7d: 3 }
const CHALLENGE = { type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: 50, deadline_minutes: 60 } as const

/** Agent 2 of the same install (index 1) with a 1v1 logged against `opponent` some minutes ago. */
function sibling(store: ReturnType<typeof setup>['store'], o: { opponent: number; minutesAgo: number; kind?: string; deadline?: number; status?: string }) {
  if (!store.agent(1)) store.addAgent(1, OTHER)
  const kind = o.kind ?? 'create_challenge'
  const action = kind === 'create_challenge' ? { type: kind, tier: 'silver', stake_foxsy: 1000, target_user_id: o.opponent, deadline_minutes: o.deadline ?? 120 } : { type: kind, tournament_id: 77 }
  const id = store.log({ agentIndex: 1, kind, status: (o.status ?? 'dry_run') as never, summary: `${kind} vs user ${o.opponent}`, detail: { action, opponentUserId: o.opponent } })
  ;(store as unknown as { db: { prepare(q: string): { run(...a: unknown[]): void } } }).db.prepare('UPDATE activity SET at = ? WHERE id = ?').run(new Date(Date.now() - o.minutesAgo * 60_000).toISOString(), id)
}

test('a team another of the owner\'s agents has a 1v1 out against is not challenged by a second one', async () => {
  const m = setup()
  sibling(m.store, { opponent: 50, minutesAgo: 10 })
  const s = snapshot()
  s.leaderboardNeighbours = [RIVAL]
  const [r] = await m.exec.run(m.agent(), dryWallet, s, [{ action: CHALLENGE, reason: '' }])
  assert.equal(r!.status, 'refused', r!.summary)
  assert.match(r!.summary, /another of your owner's teams already has a 1v1 out against user 50/)

  // A 1v1 of that agent against another team does not stop this one.
  const other = setup()
  sibling(other.store, { opponent: 60, minutesAgo: 10 })
  const [ok] = await other.exec.run(other.agent(), dryWallet, s, [{ action: CHALLENGE, reason: '' }])
  assert.equal(ok!.status, 'dry_run', ok!.summary)
})

test('a create that errored still counts (it may have left a challenge on FoxLeague), one that is over does not', async () => {
  const s = snapshot()
  s.leaderboardNeighbours = [RIVAL]
  const errored = setup()
  sibling(errored.store, { opponent: 50, minutesAgo: 10, status: 'error' })
  const [r] = await errored.exec.run(errored.agent(), dryWallet, s, [{ action: CHALLENGE, reason: '' }])
  assert.equal(r!.status, 'refused', r!.summary)
  // Its deadline (120 min) and an hour for the match have passed: the rival may be challenged again.
  const over = setup()
  sibling(over.store, { opponent: 50, minutesAgo: 200 })
  const [ok] = await over.exec.run(over.agent(), dryWallet, s, [{ action: CHALLENGE, reason: '' }])
  assert.equal(ok!.status, 'dry_run', ok!.summary)
})

test('joining the open 1v1 of a team another of the owner\'s agents is playing is refused too', async () => {
  const detail = tournament(7, { max_teams: 2, min_teams: 2, creator_user_id: 50, entry_fee_foxsy: 1000 }, [{ user_id: 50, wallet_address: STRANGER }])
  const m = setup({ fox: { tournament: async () => detail, user: async () => ({ id: 50, elo_rating: 1190 }) } })
  sibling(m.store, { opponent: 50, minutesAgo: 20, kind: 'join_tournament' })
  const s = snapshot()
  s.leaderboardNeighbours = [RIVAL]
  const [r] = await m.exec.run(m.agent(), dryWallet, s, [{ action: { type: 'join_tournament', tournament_id: 7 }, reason: '' }])
  assert.equal(r!.status, 'refused', r!.summary)
  assert.match(r!.summary, /another of your owner's teams already has a 1v1 out against user 50/)
})

// Agent review of PR #19 (medium): agents plan at the same time and a live create is logged only after the create,
// the payment and the seat, so two agents could both pass the check against one rival. The rival is claimed in the
// shared executor in the same synchronous step as the check.
test('two agents checking at once cannot both take the same rival', async () => {
  const detail = tournament(7, { max_teams: 2, min_teams: 2, creator_user_id: 50, entry_fee_foxsy: 1000 }, [{ user_id: 50, wallet_address: STRANGER }])
  let release: () => void = () => undefined
  const held = new Promise<void>(r => { release = r })
  const m = setup({
    fox: { tournament: async () => detail, user: async () => ({ id: 50, elo_rating: 1190 }) },
    // The first agent's join waits in its simulation, after its check and before its log row.
    chain: { simulate: async () => { await held; return { ok: true, detail: 'success', raw: {} } } },
  })
  m.store.addAgent(1, OTHER)
  m.store.updateSettings(1, TEST_SETTINGS)
  const snap = () => { const x = snapshot(); x.leaderboardNeighbours = [RIVAL]; return x }
  const join = { type: 'join_tournament', tournament_id: 7 } as const
  const first = m.exec.run(m.agent(), dryWallet, snap(), [{ action: join, reason: '' }])
  await new Promise(r => setTimeout(r, 30))
  const second = m.exec.run(m.store.agent(1)!, { ...dryWallet, index: 1, address: OTHER }, snap(), [{ action: join, reason: '' }])
  await new Promise(r => setTimeout(r, 30))
  release()
  const [[a], [b]] = await Promise.all([first, second])
  assert.equal(a!.status, 'dry_run', a!.summary)
  assert.equal(b!.status, 'refused', b!.summary)
  assert.match(b!.summary, /another of your owner's teams already has a 1v1 out against user 50/)
})

// Re-review of PR #19 (medium): a claim must not outlive a refusal after the check (nothing was created), nor hold
// a live agent off a rival for a dry-run 1v1 of before Go LIVE.
test('a refusal after the check releases the claim', async () => {
  const m = setup()
  m.store.addAgent(1, OTHER)
  m.store.updateSettings(1, TEST_SETTINGS)
  const broke = snapshot()
  broke.leaderboardNeighbours = [RIVAL]
  broke.chain!.egld = 0n // no EGLD for the seat payment: refused after the rules allowed it
  const [r] = await m.exec.run(m.agent(), dryWallet, broke, [{ action: CHALLENGE, reason: '' }])
  assert.equal(r!.status, 'refused', r!.summary)
  assert.doesNotMatch(r!.summary, /another of your owner's teams/)
  const s = snapshot()
  s.leaderboardNeighbours = [RIVAL]
  const [ok] = await m.exec.run(m.store.agent(1)!, { ...dryWallet, index: 1, address: OTHER }, s, [{ action: CHALLENGE, reason: '' }])
  assert.equal(ok!.status, 'dry_run', ok!.summary)
})

test('a dry-run claim does not hold a live agent off the rival', async () => {
  const { liveWallet, withLive } = await import('./fixtures.ts')
  const m = setup()
  m.store.addAgent(1, OTHER)
  m.store.updateSettings(1, TEST_SETTINGS)
  const s = () => { const x = snapshot(); x.leaderboardNeighbours = [RIVAL]; return x }
  const [dry] = await m.exec.run(m.agent(), dryWallet, s(), [{ action: CHALLENGE, reason: '' }])
  assert.equal(dry!.status, 'dry_run', dry!.summary)
  await withLive(m.store, async () => {
    const [live] = await m.exec.run(m.store.agent(1)!, { ...liveWallet, index: 1, address: OTHER }, s(), [{ action: CHALLENGE, reason: '' }])
    assert.doesNotMatch(live!.summary, /another of your owner's teams/, live!.summary)
  })
})

test('the refusal is not mistaken for the sibling rule removed on 2026-09-30', () => {
  const store = setup().store
  const recent = [{ id: 1, agentIndex: 0, at: new Date().toISOString(), kind: 'create_challenge', status: 'refused', summary: "create silver 1v1, stake 1000 vs user 50: refused: another of your owner's teams already has a 1v1 out against user 50 (one at a time per rival: pick another team or wait until it is over)", detail: null, costUsd: null, txHash: null }]
  const text = renderPlanRequest({ snapshot: snapshot(), settings: DEFAULT_SETTINGS, budget: budgetView(store, 0, DEFAULT_SETTINGS, true, new Date()), recent: recent as never, dryRun: true })
  assert.doesNotMatch(text, /## Earlier entries/)
})

// ---- buying power ----

test('the plan sees its buying power: the FOXSY held plus what the EGLD above the gas reserve swaps into', () => {
  const store = setup().store
  const s = snapshot()
  s.chain!.egld = wholeToAtomic(200)
  s.chain!.foxsy = wholeToAtomic(2270)
  const settings = { ...DEFAULT_SETTINGS, egldGasReserve: '1', maxSwapFoxsy: 50_000, dailyCapUsd: 150 }
  const text = renderPlanRequest({ snapshot: s, settings, budget: budgetView(store, 0, settings, true, new Date()), recent: [], dryRun: true })
  // 199 EGLD above the reserve at 0.0005 EGLD a FOXSY, held to the $150 the daily swap allowance lets through at
  // $0.00225 a FOXSY (audit A3/B3); $150 left today in the daily cap.
  assert.match(text, /Buying power: 2,270 FOXSY held plus about 66,666 FOXSY from the 199 EGLD above the gas reserve, as much as the swap allowances still let through \(the EGLD alone would give about 398,000\); swapped so far \$0\.00 of \$150\.00 today, \$0\.00 of \$150\.00 this month; one swap at most 50,000 FOXSY, and today's \$150\.00 left in the daily cap spends about 66,667 FOXSY\. Judge what you can afford on both, never on the FOXSY alone\./)
  // Where the EGLD is what binds, the line says only what it swaps into.
  s.chain!.egld = wholeToAtomic(2)
  assert.match(renderPlanRequest({ snapshot: s, settings, budget: budgetView(store, 0, settings, true, new Date()), recent: [], dryRun: true }), /plus about 2,000 FOXSY from the 1 EGLD above the gas reserve; swapped so far/)
  const blind = snapshot()
  blind.prices = null
  assert.match(renderPlanRequest({ snapshot: blind, settings, budget: budgetView(store, 0, settings, true, new Date()), recent: [], dryRun: true }), /Buying power: \d[\d,]* FOXSY held; what the EGLD swaps into is unknown \(no price\)/)
})

// Agent review of PR #19 (low): while xExchange has paused the pair every swap is refused, so nothing comes from EGLD.
test('while xExchange has paused the pair, the buying power is the FOXSY held', () => {
  const store = setup().store
  const s = snapshot()
  s.prices = { ...s.prices!, frozen: true }
  const text = renderPlanRequest({ snapshot: s, settings: DEFAULT_SETTINGS, budget: budgetView(store, 0, DEFAULT_SETTINGS, true, new Date()), recent: [], dryRun: true })
  assert.match(text, /Buying power: [\d,]+ FOXSY held; no swap is possible while xExchange has paused the FOXSY pair, so the FOXSY held is all there is/)
})

// Agent review of PR #19 (low, docs): the manual's safety page said the agents share nothing. Since 2026-10-23 they
// share three things: one team per card at auction too (test/sibling-bids.test.ts).
test('the safety page names the three things the agents share', async () => {
  const { readFileSync } = await import('node:fs')
  const page = readFileSync(new URL('../site/src/content/docs/play/safety.md', import.meta.url), 'utf8').replace(/\s+/g, ' ')
  assert.match(page, /a pooled formation record with no team named/)
  assert.match(page, /only one of them at a time has a 1v1 out against the same rival/)
  assert.match(page, /only one of them bids on a card at auction and none on a card another of your teams sells/)
})

test('the prompt says EGLD above the reserve is buying power, swapped earlier in the same plan when an action needs it', () => {
  assert.match(SYSTEM_PROMPT, /never call something unaffordable on the FOXSY alone/)
  assert.match(SYSTEM_PROMPT, /swap for it earlier in the same plan/)
})
