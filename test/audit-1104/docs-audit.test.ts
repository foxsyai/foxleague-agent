// Audit 2026-11-04 (five Fable 5.1 reviewers at max effort, PRs #29 to #50): the proof of a finding, failing before its fix.
// Adversarial docs audit of afc3238 (main + PR #50): each test fails on the current text and would pass after the fix.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, STRATEGY_PRESETS } from '../../src/store/settings.ts'
import { SYSTEM_PROMPT } from '../../src/strategist/prompt.ts'
import { parseAction } from '../../src/executor/actions.ts'
import { TEST_SETTINGS, dryWallet, setup, snapshot, tournament } from '../fixtures.ts'

const W = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const read = (f: string) => readFileSync(join(W, f), 'utf8').replace(/\s+/g, ' ')
const html = readFileSync(join(W, 'src/web/dashboard.html'), 'utf8')
/** One info bubble whole (as test/manual-sync.test.ts reads them). */
function tip(key: string): string {
  const lines = html.split('\n')
  const start = lines.findIndex(l => l.startsWith(`  ${key}: [`))
  if (start < 0) return ''
  const end = lines.findIndex((l, i) => i >= start && l.trimEnd().endsWith('`],'))
  return lines.slice(start, end + 1).join(' ').replace(/\s+/g, ' ')
}
const LIVE_FEES = { live: true, live_from: '2026-11-09T14:00:00Z', private_match_fee_foxsy: 0, calendar_deposit_per_match_foxsy: 25, calendar_deposit_min_foxsy: 0, calendar_deposit_grace_minutes: 60 }

test('DOCS-1 the settings page explains the Bronze amounts setting the dashboard has (PR #41, CL7)', () => {
  assert.match(html, /id="sBronze"/, 'the dashboard has the field')
  assert.match(tip('bronze'), /Bronze amounts/, 'the dashboard has its bubble')
  assert.match(read('site/src/content/docs/use/settings.md'), /Bronze amounts/, 'the settings page does not name the setting')
})

test('DOCS-2 Max shop payment caps the organizer deposit and the ranked ticket; the settings page and the bubble say so', async () => {
  // The code: the Steady default (500) refuses a create that owes a deposit of 28 games (a round robin of 8 at 25 a game).
  const m = setup({ fox: { organizerFeeQuote: async () => ({ owed: true, games: 28, private_fee_foxsy: 0, deposit_foxsy: 700, total_foxsy: 700, grace_minutes: 60, no_free_cancel: false }) } })
  m.store.updateSettings(0, DEFAULT_SETTINGS)
  assert.equal(DEFAULT_SETTINGS.maxShopPaymentFoxsy, 500)
  const s = snapshot()
  s.config!.organizer_fees = LIVE_FEES
  const cup = parseAction({ type: 'create_tournament', title: 'Varna Cup', format: 'round_robin', tier: 'silver', max_teams: 8, min_teams: 4, entry_fee_foxsy: 1000, starts_in_hours: 6, registration_closes_minutes_before: 60, round_interval_minutes: 60 })
  const [r] = await m.exec.run(m.agent(), dryWallet, s, [{ action: cup, reason: '' }])
  assert.equal(r!.status, 'refused', r!.summary)
  assert.match(r!.summary, /an organizer payment of 700 FOXSY exceeds the per-action maximum 500: a smaller tournament owes less/)
  // The texts: neither the setting's row nor its bubble names what it now gates (the how-it-plays page does).
  const row = read('site/src/content/docs/use/settings.md').match(/\| Max shop payment \|[^\n]*?\|[^|]*\|/)?.[0] ?? ''
  assert.ok(row, 'the row exists')
  assert.match(read('site/src/content/docs/play/how-it-plays.md'), /calendar deposit[^.]*within your Max shop payment/, 'how-it-plays says the deposit fits the Max shop payment')
  for (const [name, text] of [['settings row', row], ['shop bubble', tip('shop')]] as const) assert.match(text, /deposit|ticket/, `${name} names neither the organizer deposit nor the ranked ticket`)
})

test('DOCS-3 the In tournaments bubble promises a Leave the leave lock refuses, the owner\'s too', async () => {
  const m = setup({ fox: { tournament: async () => tournament(7, { format: 'round_robin', max_teams: 8, min_teams: 4 }, [{ user_id: 100 }, { user_id: 200 }, { user_id: 201 }, { user_id: 202 }]) } })
  const s = snapshot()
  s.config!.tournament_defaults = { ...s.config!.tournament_defaults, leave_lock_live: true }
  const [r] = await m.exec.run(m.agent(), dryWallet, s, [{ action: { type: 'leave_tournament', tournament_id: 7 }, reason: 'owner (web Leave)', byOwner: true }])
  assert.equal(r!.status, 'refused', r!.summary)
  assert.match(r!.summary, /T7 is at its minimum of 4 teams: its seats are locked until more teams join/)
  assert.match(tip('mine'), /While one is still open, <b>Leave<\/b> gives the seat or stake back to the wallet/)
  assert.match(tip('mine'), /minimum|leave lock|locked/, 'the bubble does not say a seat at the minimum cannot be left once the lock is on')
})

test('DOCS-4 the integration notes (9.3) price ELO at the K values FoxLeague no longer runs (seed.sh: 9, 13, 17)', () => {
  const doc = readFileSync(join(W, 'docs/FOXLEAGUE-INTEGRATION.md'), 'utf8')
  const s93 = doc.slice(doc.indexOf('### 9.3'), doc.indexOf('### 9.4')).replace(/\s+/g, ' ')
  assert.match(read('docs/ECONOMY-AND-RULES.md'), /K ranked \(vs a real team\) \| \*\*9\*\* \(24 until 2026-10-30\)/, 'the economy notes have the live value')
  assert.doesNotMatch(s93, /K = 24/, '9.3 still says ranked K = 24')
  assert.doesNotMatch(s93, /K = 12, Gold K = 18/, '9.3 still says Silver 12 and Gold 18')
  assert.match(s93, /K = 9/, '9.3 does not give the live ranked K')
})

test('DOCS-5 the economy notes (11) still call a Groups + Knockout "full" while FoxLeague starts one from min_teams 6', () => {
  const row = readFileSync(join(W, 'docs/ECONOMY-AND-RULES.md'), 'utf8').split('\n').find(l => l.startsWith('| Formats and sizes |')) ?? ''
  assert.ok(row, 'the row exists')
  assert.doesNotMatch(row, /groups \+ knockout 8\/16\/32\/64 \(full\)/, 'the row says a Groups + Knockout needs its full field')
  assert.match(row, /min_teams from 6|from 6 teams|6 or more/, 'the row does not give the flexible minimum')
})

test('DOCS-6 (predates the window) the prompt and the executor agree on the open challenge at the Zeus level', async () => {
  // Since 2026-11-06 (OP-2, OP-4) every level may post one, with its range topped at its own best XI OVR.
  const m = setup({ fox: { bestXiOvr: async () => ({ best_xi_ovr: 31.4 }) } })
  m.store.updateSettings(0, { ...TEST_SETTINGS, strategy: STRATEGY_PRESETS.zeus! })
  const [r] = await m.exec.run(m.agent(), dryWallet, snapshot(), [{ action: { type: 'create_challenge', tier: 'silver', stake_foxsy: 1000, target_user_id: null, deadline_minutes: 60, ovr_min: 28, ovr_max: 32 }, reason: '' }])
  assert.equal(r!.status, 'dry_run', r!.summary)
  assert.match(SYSTEM_PROMPT, /An open challenge \(target_user_id null\) can be taken by any team inside its OVR range/)
  assert.doesNotMatch(SYSTEM_PROMPT, /Zeus[^.\n]*open challenge|open challenge[^.\n]*Zeus/, 'no level is kept from it')
})
