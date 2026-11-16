// BEH-2: a targeted 1v1 nobody accepted leaves no trace in what the next plans read. The refunded stake drops out of
// the weekly count (rivals.ts oneVOnesThisWeek, audit D11), so the "Teams to challenge" line of a rival that let five
// of this agent's challenges expire reads word for word like the line of a rival never challenged, and the plan sends
// the next one. Production, 9 to 16 Nov: 158 targeted challenges, 1 played; 89 of them were sent by an agent to a
// rival that had already left two or more of that agent's own challenges unanswered (agent 6 to user 4495 nine times,
// agent 7 to user 380 nine times, eight agents to user 12158 five to eight times each).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Mnemonic } from '@multiversx/sdk-core'
import type { Config } from '../../src/config.ts'
import { Service } from '../../src/service.ts'
import { renderDigest } from '../../src/snapshot/digest.ts'
import type { AgentSnapshot } from '../../src/snapshot/snapshot.ts'
import { OTHER, snapshot } from '../fixtures.ts'

function testConfig(dir: string): Config {
  return {
    mnemonic: Mnemonic.generate().toString(), dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-sonnet-5-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config
}

const RIVAL = 12158
const teamsLine = (digest: string): string => digest.split('\n').find(l => l.startsWith('Teams to challenge')) ?? ''

test('BEH-2: the plan is told when a rival let this agent\'s own targeted 1v1s expire unanswered', () => {
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-beh2-'))))
  svc.ensureAgents()
  const agent = svc.store.agent(0)!
  const snap = snapshot()
  snap.leaderboardNeighbours = [{ id: RIVAL, wallet_address: OTHER, team_name: 'Neon Dynamo', elo_rating: 1190, league: 'Silver', accepted7d: 1, strength: 2500, winChance: 0.61 }, { id: 777, wallet_address: OTHER, team_name: 'Other Team', elo_rating: 1180, league: 'Silver', accepted7d: 0, strength: 2400, winChance: 0.6 }] as AgentSnapshot['leaderboardNeighbours']
  // What the plan request is rendered from (service.ts makePlan): the snapshot with this agent's 1v1s of the week.
  const forPlan = (): string => renderDigest((svc as unknown as { withOneVOnes: (a: unknown, s: AgentSnapshot, dry: boolean) => AgentSnapshot }).withOneVOnes(agent, snap, false))

  const never = teamsLine(forPlan()).split('; ').find(t => t.includes(`user ${RIVAL}`)) ?? ''
  assert.match(never, /Neon Dynamo \(user 12158\)/, 'the rival is on the list of teams to challenge')

  // Five targeted challenges to that rival, each logged as the executor logs a live create, each stake credited back
  // when it expired unaccepted (refunds.ts, store.creditSpend: join:<id> becomes join:<id>:refunded).
  for (let i = 0; i < 5; i++) {
    const hash = `stake${i}`
    svc.store.log({ agentIndex: 0, kind: 'create_challenge', status: 'confirmed', summary: `create silver 1v1, stake 1000 vs user ${RIVAL} (T${5800 + i}): seated`, txHash: hash,
      detail: { action: { type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: RIVAL, deadline_minutes: 240 }, opponentUserId: RIVAL, createdTournamentId: 5800 + i } })
    const id = svc.store.recordSpend({ agentIndex: 0, at: new Date(), gameDay: '2026-11-15', category: 'play', action: `join:${5800 + i}`, foxsyAtomic: 1000n * 10n ** 18n, egldAtomic: 0n, usd: 2.4, txHash: hash, dryRun: false })
    svc.store.creditSpend(id)
  }
  // Control: the path is live. A stake still held counts (a second rival, one challenge not refunded), and its line says so.
  svc.store.log({ agentIndex: 0, kind: 'create_challenge', status: 'confirmed', summary: 'create silver 1v1, stake 1000 vs user 777 (T5899): seated', txHash: 'held', detail: { opponentUserId: 777, createdTournamentId: 5899 } })
  svc.store.recordSpend({ agentIndex: 0, at: new Date(), gameDay: '2026-11-15', category: 'play', action: 'join:5899', foxsyAtomic: 1000n * 10n ** 18n, egldAtomic: 0n, usd: 2.4, txHash: 'held', dryRun: false })
  assert.match(teamsLine(forPlan()), /Other Team \(user 777\)[^;]*1 of 2 1v1s against it this week/, 'control: a challenge still open is counted and shown')
  const ignoredFive = teamsLine(forPlan()).split('; ').find(t => t.includes(`user ${RIVAL}`)) ?? ''
  assert.notEqual(ignoredFive, never, `after five unanswered challenges the rival's line must say so; it still reads: ${ignoredFive}`)
})
