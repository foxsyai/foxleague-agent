// RESET-1 (production, 18 and 19 Nov 2026, two models): actions planned just before FoxLeague's daily reset (14:00
// UTC) ran before it and were refused. 19 Nov, agent 3 (Opus) planned at 13:57 five trainings and four matches with
// the day's five free sessions and five starts used up: the trainings were refused 13:57 to 13:59 ("daily training
// exhausted (5 used, 0 paid slots banked)") and a ranked match at 13:59 ("daily match limit reached (5/5)"). 18 Nov,
// agent 10 (Haiku) planned at 13:27 five trainings with the free sessions used: four were refused 13:32 to 13:55. The
// plans were right; the scheduler ran them at random moments of the window, the reset ignored. An action that by the
// plan's own snapshot can only run on the new game day now waits for the reset plus a margin, and one whose window
// ends before then is dropped with an info line, never sent to be refused.

import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Mnemonic } from '@multiversx/sdk-core'
import type { Config } from '../../src/config.ts'
import { Service } from '../../src/service.ts'
import { parseAction, type PlannedAction } from '../../src/executor/actions.ts'
import type { AgentSnapshot } from '../../src/snapshot/snapshot.ts'
import type { Tournament } from '../../src/foxleague/types.ts'
import { snapshot } from '../fixtures.ts'

const MIN = 60_000
const act = (raw: unknown): PlannedAction => ({ action: parseAction(raw), reason: '' })
const at = (hhmmss: string, day = '2026-11-19') => Date.parse(`${day}T${hhmmss}Z`)
const hhmmss = (ms: number) => new Date(ms).toISOString().slice(11, 19)
const train = (n: number) => act({ type: 'train', player_nonce: n, attribute: 'speed' })
const match = (kind: 'ranked' | 'casual') => act({ type: 'play_match', match_type: kind })

function testConfig(dir: string): Config {
  return {
    mnemonic: Mnemonic.generate().toString(), dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config
}

/** The snapshot a plan was made from at `t0`: the sessions used today, the banked paid slots and the starts used. */
function planSnap(t0: number, q: { used: number; banked?: number; starts: number }): AgentSnapshot {
  const s = snapshot()
  s.takenAt = new Date(t0).toISOString()
  s.auth!.shop!.training = { daily_free: 5, premium_cap: 10, used_today: q.used, premium_used_today: 0, slots_banked: q.banked ?? 0 }
  s.auth!.allowance = { today_count: q.starts, daily_limit: 5, reset_hour_utc: 14 }
  return s
}

/**
 * Runs a routine plan through runPlan on a clock frozen at `t0` (a 60-minute tick: a 48-minute window, 30 s between
 * actions). Returns when each action reached the executor and when the fresh snapshot it was checked against was read,
 * and the plan's info lines.
 */
async function runPlanned(t0: number, actions: PlannedAction[], snap: AgentSnapshot | undefined, random: () => number) {
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-reset-'))))
  svc.ensureAgents()
  const h = new Date(t0).getUTCHours()
  svc.store.updateSettings(0, { tickMinutes: 60, tickJitterMinutes: 10, minGapSeconds: 30, activeHoursUtc: [h, (h + 3) % 24], actionProbability: 1 })
  const ran: { type: string; at: number; read: number }[] = []
  let read = 0
  mock.timers.enable({ apis: ['Date'], now: t0 })
  const realRandom = Math.random
  try {
    const s = svc as unknown as { snapshot: unknown; pause: unknown; executor: unknown; runPlan: (a: unknown, p: PlannedAction[], routine: boolean, snap?: AgentSnapshot) => Promise<void> }
    s.snapshot = async () => { read = Date.now(); return snapshot() }
    s.pause = async (ms: number) => { mock.timers.tick(Math.max(0, ms)) }
    s.executor = { liveEnabled: false, run: async (_a: unknown, _w: unknown, _s: unknown, a: PlannedAction[]) => { ran.push({ type: a[0]!.action.type, at: Date.now(), read }); return [] } }
    Math.random = random
    await s.runPlan(svc.store.agent(0), actions, true, snap)
  } finally {
    Math.random = realRandom
    mock.timers.reset()
  }
  const info = svc.store.activity(0, 50).filter(r => r.status === 'info').map(r => r.summary).reverse()
  return { ran, info }
}

const RESET_PLUS_MARGIN = at('14:02:00')

test('RESET-1 19 Nov agent 3: a plan at 13:57 with the sessions and starts used up runs no train or match before the reset plus the margin', async () => {
  const t0 = at('13:57:00')
  const plan = [train(1), train(2), train(3), train(4), train(5), match('ranked'), match('casual'), match('casual'), match('casual')]
  // Every draw at the start of the window: as it ran on 19 Nov, everything at once.
  const { ran, info } = await runPlanned(t0, plan, planSnap(t0, { used: 5, starts: 5 }), () => 0)
  const early = ran.filter(r => r.at < RESET_PLUS_MARGIN)
  assert.deepEqual(early.map(r => `${r.type} ${hhmmss(r.at)}`), [], 'nothing reaches the executor before 14:02 UTC')
  assert.ok(ran.every(r => r.read >= RESET_PLUS_MARGIN), 'each is checked against a snapshot read after the reset plus the margin')
  // The plan's order holds; the trainings first, then the matches spaced by their gates (16 min after a start). The
  // window ends at 14:45, so the fourth match is dropped with the usual line.
  assert.deepEqual(ran.map(r => r.type), ['train', 'train', 'train', 'train', 'train', 'play_match', 'play_match', 'play_match'])
  assert.deepEqual(ran.map(r => hhmmss(r.at)), ['14:02:00', '14:02:30', '14:03:00', '14:03:30', '14:04:00', '14:04:30', '14:20:30', '14:36:30'])
  assert.equal(info.length, 1, info.join('\n'))
  assert.match(info[0]!, /^dropped from this plan: play casual match: the match before it/)
})

test('RESET-1 18 Nov agent 10: a plan at 13:27 (window to 14:15) with the free sessions used runs its five trainings after the reset', async () => {
  const t0 = at('13:27:00', '2026-11-18')
  const plan = [train(1), train(2), train(3), train(4), train(5)]
  // Spread over the window as on 18 Nov: 13:32 to 14:10.
  const draws = [0.1, 0.3, 0.5, 0.6, 0.9]
  const { ran, info } = await runPlanned(t0, plan, planSnap(t0, { used: 5, starts: 0 }), () => draws.shift() ?? 0)
  assert.equal(ran.length, 5, info.join('\n'))
  assert.ok(ran.every(r => r.at >= at('14:02:00', '2026-11-18')), ran.map(r => hhmmss(r.at)).join(', '))
  // Each keeps its own draw when that is after the hold: the last at 13:27 + 0.9 x 48 min = 14:10:12.
  assert.deepEqual(ran.map(r => hhmmss(r.at)), ['14:02:00', '14:02:30', '14:03:00', '14:03:30', '14:10:12'])
  assert.deepEqual(info, [])
})

test('RESET-1 a plan whose window ends before the reset plus the margin drops them with the info line', async () => {
  // 10:00, the window to 10:48: the reset is hours away.
  const t0 = at('10:00:00')
  const plan = [train(1), act({ type: 'sync' }), match('ranked')]
  const { ran, info } = await runPlanned(t0, plan, planSnap(t0, { used: 5, starts: 5 }), () => 0.5)
  assert.deepEqual(ran.map(r => r.type), ['sync'], 'the action that can run now still runs')
  assert.deepEqual(info, [
    "dropped from this plan: train #1 speed: the wait for the new game day at 14:00 UTC (this one's training sessions are used up: 5 used, 0 paid slots banked) leaves no room before the plan's window ends; the next plan can play it",
    "dropped from this plan: play ranked match: the wait for the new game day at 14:00 UTC (this one's match starts are used up: 5 of 5) leaves no room before the plan's window ends; the next plan can play it",
  ])
  // 13:13, the window to 14:01: it crosses the reset but ends before the margin is over.
  const t1 = at('13:13:00')
  const crossing = await runPlanned(t1, [train(1)], planSnap(t1, { used: 5, starts: 0 }), () => 0)
  assert.deepEqual(crossing.ran, [])
  assert.match(crossing.info[0] ?? '', /^dropped from this plan: train #1 speed: the wait for the new game day at 14:00 UTC/)
})

test('RESET-1 a plan with sessions and starts left is not delayed; only what the day has no room for waits', async () => {
  const t0 = at('13:57:00')
  // Two sessions and two starts left: the first two of each run now, at their draws; the rest wait for 14:02.
  const plan = [train(1), train(2), train(3), match('casual'), match('casual'), match('casual')]
  const { ran, info } = await runPlanned(t0, plan, planSnap(t0, { used: 3, starts: 3 }), () => 0)
  assert.deepEqual(ran.map(r => `${r.type} ${hhmmss(r.at)}`), ['train 13:57:00', 'train 13:57:30', 'train 14:02:00', 'play_match 14:02:30', 'play_match 14:18:30', 'play_match 14:34:30'])
  assert.deepEqual(info, [])
  // Nothing used up: the same plan runs as before, at its draws.
  const free = await runPlanned(t0, plan, planSnap(t0, { used: 0, starts: 0 }), () => 0)
  assert.equal(free.ran[0]!.at, t0)
  assert.ok(free.ran.filter(r => r.type === 'train').every(r => r.at < at('14:00:00')))
  // A banked paid slot lets one more session run today (the executor's rule): it is not held.
  const banked = await runPlanned(t0, [train(1), train(2)], planSnap(t0, { used: 5, banked: 1, starts: 0 }), () => 0)
  assert.deepEqual(banked.ran.map(r => hhmmss(r.at)), ['13:57:00', '14:02:00'])
})

test('RESET-1 an action held for the reset never pushes a later deadline action late: it is dropped instead', async () => {
  const t0 = at('13:57:00')
  // A seat whose deadline is 14:04: the leave must run by 13:59. The training before it could only run at 14:02.
  const s = planSnap(t0, { used: 5, starts: 0 })
  const seat = { id: 5976, creator_user_id: 900, title: 'T5976', format: 'knockout', tier: 'silver', max_teams: 8, min_teams: 4, entry_fee_foxsy: 2500, status: 'open', deadline: new Date(at('14:04:00')).toISOString(), starts_at: new Date(at('14:30:00')).toISOString(), target_user_id: null } as unknown as Tournament
  s.auth!.myTournaments!.active.push(seat)
  const { ran, info } = await runPlanned(t0, [train(1), act({ type: 'leave_tournament', tournament_id: 5976 })], s, () => 0.99)
  assert.deepEqual(ran.map(r => `${r.type} ${hhmmss(r.at)}`), ['leave_tournament 13:59:00'])
  assert.match(info[0] ?? '', /^dropped from this plan: train #1 speed: the wait for the new game day at 14:00 UTC .* leaves no room before an action after it that must run by its deadline; the next plan can play it$/)
})
