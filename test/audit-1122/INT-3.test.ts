// INT-3 (pre-release audit 2026-11-22, INTEGRATION): Tournament.participant_count is "Filled by GET /api/tournaments;
// null in other answers" (FoxLeague's API description). GET /api/tournaments/my never selects it, yet two places read
// the seat count from those rows only:
//  (a) service.ts withOneVOnes, BEH-2's seated set: a targeted 1v1 another team took read "0 accepted";
//  (b) digest.ts, the "(seats locked ...)" note of a joined tournament at its minimum never printed.
// The public list row carries the count, as src/snapshot/own-tournaments.ts already reads it. Information only: the
// executor's leave rule reads the tournament's detail (rules.ts).
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
import { snapshot } from '../fixtures.ts'

function testConfig(dir: string): Config {
  return {
    mnemonic: Mnemonic.generate().toString(), dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-sonnet-5-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config
}

const RIVAL = 4495
const future = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()

test('INT-3 (a) a targeted 1v1 another team took counts as accepted though /tournaments/my serves no seat count', () => {
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-int3-'))))
  svc.ensureAgents()
  const agent = svc.store.agent(0)!
  svc.store.log({ agentIndex: 0, kind: 'create_challenge', status: 'confirmed', summary: `create silver 1v1, stake 1000 vs user ${RIVAL} (T7100): seated`, txHash: 'stake',
    detail: { action: { type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: RIVAL, deadline_minutes: 240 }, opponentUserId: RIVAL, createdTournamentId: 7100 } })
  const snap = snapshot()
  const t = { id: 7100, title: '1v1', tier: 'silver', format: 'knockout', status: 'open', entry_fee_foxsy: 1000, max_teams: 2, min_teams: 2, creator_user_id: 100, target_user_id: RIVAL, targeted: true, deadline: future(3), starts_at: future(4) }
  // As FoxLeague serves them: no seat count in the my-tournaments row, 2 seated in the public list.
  snap.auth!.myTournaments!.active = [{ ...t, participant_count: null }] as never
  snap.market.openChallenges = [{ ...t, participant_count: 2 }] as never
  const out = (svc as unknown as { withOneVOnes: (a: unknown, s: AgentSnapshot, dry: boolean) => AgentSnapshot }).withOneVOnes(agent, snap, false)
  const rec = out.oneVOnes?.targeted?.find(r => r.userId === RIVAL)
  assert.equal(rec?.sent, 1)
  assert.equal(rec?.accepted, 1, 'the public list shows the 1v1 taken by two teams; the seated set read only the my-tournaments row, whose count FoxLeague never fills')
})

test('INT-3 (b) a joined tournament at its minimum reads "seats locked" though /tournaments/my serves no seat count', () => {
  const s = snapshot()
  ;(s.config as { tournament_defaults: Record<string, unknown> }).tournament_defaults.leave_lock_live = true
  const t = { id: 70, title: 'T70', tier: 'silver', format: 'round_robin', status: 'open', entry_fee_foxsy: 1000, max_teams: 8, min_teams: 4, creator_user_id: 900, deadline: future(24), starts_at: future(25) }
  s.auth!.myTournaments!.active = [{ ...t, participant_count: null }] as never
  s.market.openStandard = [{ ...t, participant_count: 4 }] as never
  const line = renderDigest(s).split('\n').find(l => l.startsWith('My active tournament: T70')) ?? ''
  assert.match(line, /seats locked/, `the public list shows 4 seated at a minimum of 4: ${line}`)
})

test('INT-3 (b) control: above its minimum, or with no seat count anywhere, no lock is said', () => {
  const s = snapshot()
  ;(s.config as { tournament_defaults: Record<string, unknown> }).tournament_defaults.leave_lock_live = true
  const t = { id: 70, title: 'T70', tier: 'silver', format: 'round_robin', status: 'open', entry_fee_foxsy: 1000, max_teams: 8, min_teams: 4, creator_user_id: 900, deadline: future(24), starts_at: future(25) }
  s.auth!.myTournaments!.active = [{ ...t, participant_count: null }] as never
  s.market.openStandard = [{ ...t, participant_count: 5 }] as never
  assert.doesNotMatch(renderDigest(s), /seats locked/)
  s.market.openStandard = []
  assert.doesNotMatch(renderDigest(s), /seats locked/)
})
