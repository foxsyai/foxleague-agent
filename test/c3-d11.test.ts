// Owner, 2026-10-24: two decisions left open by the audit of 2026-10-23.
// C3: the agent never joins FoxLeague's League + Knockout format (admin-created, seats by invitation), but the owner
// hears of each pending invitation once, to accept it in FoxLeague by hand.
// D11: a 1v1 nobody accepted (FoxLeague cancelled it and refunded the stake, or the agent closed it) no longer counts
// toward the 2 a week against the same rival; only a 1v1 that was played or may still be played counts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Mnemonic } from '@multiversx/sdk-core'
import type { Config } from '../src/config.ts'
import { oneVOnesThisWeek } from '../src/executor/rivals.ts'
import { STRANGER, dryWallet, setup, snapshot } from './fixtures.ts'

function testConfig(dir: string): Config {
  return {
    mnemonic: Mnemonic.generate().toString(), dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config
}

// ---- D11 ----

type Store = ReturnType<typeof setup>['store']
/** A live 1v1 of agent 1 against `opponent` some days ago, paid with `hash`; refunded: FoxLeague gave the stake back. */
function liveChallenge(store: Store, o: { opponent: number; daysAgo: number; hash: string; tournament: number; refunded?: boolean; kind?: string }) {
  const kind = o.kind ?? 'create_challenge'
  const at = new Date(Date.now() - o.daysAgo * 86_400_000)
  const action = kind === 'create_challenge' ? { type: kind, tier: 'silver', stake_foxsy: 1000, target_user_id: o.opponent, deadline_minutes: 120 } : { type: kind, tournament_id: o.tournament }
  const id = store.log({ agentIndex: 0, kind, status: 'confirmed', summary: `${kind} vs user ${o.opponent} (T${o.tournament}): seated`, detail: { action, opponentUserId: o.opponent }, txHash: o.hash })
  ;(store as unknown as { db: { prepare(q: string): { run(...a: unknown[]): void } } }).db.prepare('UPDATE activity SET at = ? WHERE id = ?').run(at.toISOString(), id)
  const spend = store.recordSpend({ agentIndex: 0, at, gameDay: at.toISOString().slice(0, 10), category: 'play', action: `join:${o.tournament}`, foxsyAtomic: 10n ** 21n, egldAtomic: 0n, usd: 2.7, txHash: o.hash, dryRun: false })
  if (o.refunded) store.creditSpend(spend)
}

test('D11 a 1v1 whose stake came back (nobody accepted it) does not count toward the weekly limit per rival', () => {
  const { store } = setup()
  liveChallenge(store, { opponent: 50, daysAgo: 1, hash: 'h1', tournament: 2401, refunded: true })
  liveChallenge(store, { opponent: 50, daysAgo: 2, hash: 'h2', tournament: 2402 })
  liveChallenge(store, { opponent: 50, daysAgo: 3, hash: 'h3', tournament: 2403, kind: 'join_tournament' })
  liveChallenge(store, { opponent: 60, daysAgo: 1, hash: 'h4', tournament: 2404, refunded: true })
  const week = oneVOnesThisWeek(store, 0, false, new Date())
  assert.equal(week.get(50)?.length, 2, 'the played create and the join count; the refunded create does not')
  assert.equal(week.get(60), undefined, 'a rival whose only challenge was refunded has none this week')
})

test('D11 the executor allows a new challenge once one of the two was never accepted, and still refuses at two played', async () => {
  const { liveWallet, withLive, rivalSquad } = await import('./fixtures.ts')
  const RIVAL = { id: 50, wallet_address: STRANGER, team_name: 'Rival', elo_rating: 1190, league: 'Bronze', accepted7d: 3 }
  const CHALLENGE = { type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: 50, deadline_minutes: 60 } as const
  const run = async (refunded: boolean) => {
    const m = setup({ fox: { user: async () => null, ...rivalSquad(20) } })
    liveChallenge(m.store, { opponent: 50, daysAgo: 1, hash: 'a1', tournament: 2501, refunded })
    liveChallenge(m.store, { opponent: 50, daysAgo: 2, hash: 'a2', tournament: 2502 })
    const s = snapshot()
    s.leaderboardNeighbours = [RIVAL]
    let summary = ''
    await withLive(m.store, async () => { summary = (await m.exec.run(m.agent(), liveWallet, s, [{ action: CHALLENGE, reason: '' }]))[0]!.summary })
    return summary
  }
  assert.doesNotMatch(await run(true), /already 2 1v1s against user 50/, 'one of the two was never accepted')
  assert.match(await run(false), /already 2 1v1s against user 50 in the last 7 days/, 'two played: the limit holds')
  void dryWallet
})

// ---- C3 ----

const INVITE = { tournament_id: 3001, title: 'Champions FoxLeague\nAutumn', tier: 'gold', entry_fee_foxsy: 5000, wave: 1, expires_at: new Date(Date.now() + 2 * 86_400_000).toISOString(), seats_lock_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), can_accept: true, refusal: null, prize_atomic: null }

async function service(invitations: () => Promise<unknown[]>) {
  const { Service } = await import('../src/service.ts')
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-'))))
  svc.ensureAgents()
  const told: string[] = []
  svc.notify = (t: string) => void told.push(t)
  let calls = 0
  ;(svc as unknown as { fox: { leagueInvitations: unknown } }).fox.leagueInvitations = async () => { calls++; return invitations() }
  const notice = (s: ReturnType<typeof snapshot>) => (svc as unknown as { noticeInvitations: (i: number, s: unknown) => Promise<void> }).noticeInvitations(0, s)
  return { svc, told, calls: () => calls, notice }
}

const withKnockout = (on: boolean) => {
  const s = snapshot()
  s.config = { ...s.config!, tournament_defaults: { ...s.config!.tournament_defaults, league_knockout_enabled: on } } as typeof s.config
  return s
}

test('C3 a pending League + Knockout invitation reaches the owner once, with what it costs and until when', async () => {
  const { svc, told, notice } = await service(async () => [INVITE])
  await notice(withKnockout(true))
  await notice(withKnockout(true))
  assert.equal(told.length, 1, told.join(' | '))
  assert.match(told[0]!, /agent 1: invited to the League \+ Knockout T3001 "Champions FoxLeague Autumn" \(gold, entry 5000 FOXSY\), until .* UTC: the agent never joins this format; accept it yourself in FoxLeague/)
  assert.ok(svc.store.activity(0, 5).some(r => /invited to the League \+ Knockout T3001/.test(r.summary)), 'it is in the activity too')
})

test('C3 nothing is read while FoxLeague has the format off; an expired or refused invitation says so or stays quiet', async () => {
  const off = await service(async () => [INVITE])
  await off.notice(withKnockout(false))
  assert.equal(off.calls(), 0, 'no read while the format is off')
  const expired = await service(async () => [{ ...INVITE, expires_at: new Date(Date.now() - 60_000).toISOString() }])
  await expired.notice(withKnockout(true))
  assert.equal(expired.told.length, 0)
  const refused = await service(async () => [{ ...INVITE, can_accept: false, refusal: 'Your team is still in another tournament' }])
  await refused.notice(withKnockout(true))
  assert.match(refused.told[0]!, /FoxLeague says it cannot be accepted now: Your team is still in another tournament/)
  const failing = await service(async () => { throw new Error('HTTP 502') })
  await failing.notice(withKnockout(true)).catch(() => undefined) // as the tick does: a failed read is quiet, the next tick reads again
  assert.equal(failing.told.length, 0)
})

test('C3 the agent still never joins the format', async () => {
  const { checkAction } = await import('../src/executor/rules.ts')
  const { TEST_SETTINGS, tournament } = await import('./fixtures.ts')
  const t = tournament(3001, { format: 'league_knockout', max_teams: 36, entry_fee_foxsy: 5000, tier: 'gold' })
  const v = checkAction({ type: 'join_tournament', tournament_id: 3001 }, snapshot(), { settings: TEST_SETTINGS, now: new Date(), tournament: t as never } as never)
  assert.equal(v.ok, false)
})

test('C3 and D11 the manual says what the agent now does', async () => {
  const { readFileSync } = await import('node:fs')
  const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\s+/g, ' ')
  const plays = read('site/src/content/docs/play/how-it-plays.md')
  assert.match(plays, /FoxLeague's League \+ Knockout format \(created by FoxLeague, seats by invitation\) is the exception: the agent never joins it, but it tells you of each invitation/)
  assert.match(read('site/src/content/docs/use/talk-to-your-manager.md'), /a payment whose outcome is unclear, top-up codes and a League \+ Knockout invitation/)
  assert.match(plays, /at most two played 1v1s a week against the same team \(a challenge nobody accepted, its stake back, does not count\)/)
  assert.match(read('site/src/content/docs/play/safety.md'), /at most two played 1v1s a week against the same team, a challenge nobody accepted not counting/)
  assert.match(read('README.md'), /at most two played 1v1s a week each/)
})
