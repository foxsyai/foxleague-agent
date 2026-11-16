// P-W3 (audit 2026-11-16, MAINNET proposals): the owner is told at the change, in one urgent Telegram line, not in the
// next morning's summary: when the manual goes from current to behind, when FoxLeague's game settings gain or lose
// keys, and when a switch the agents have no rule for goes live within 7 days (elo_pair_cap from 20 Nov 14:00 UTC).
// Each is told once; the lines name only shaped slugs and keys, at most eight of each.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '../../src/config.ts'
import { snapshot } from '../fixtures.ts'
import { AT_0700, HOUR, MIN, MANUAL, configOf13Nov, liveConfig, mcp, memoryKv, record, watch } from './watch-helpers.ts'

type Observing = { observeConfig: (config: unknown, now?: number) => Promise<unknown> | null }
const observe = (w: unknown, config: unknown, now: number) => (w as Observing).observeConfig(config, now)
const plain = (t: string) => assert.doesNotMatch(t, /—|, and |, or |\bbots?\b/i, t)

test('P-W3 the manual going from current to behind is told at once, in one line, and once', async () => {
  const server = mcp()
  const kv = memoryKv()
  const w = watch(server, { kv })
  assert.equal((await w.today(AT_0700))!.state, 'current')
  assert.equal(w.told.length, 0, 'nothing to tell while current')
  server.state.pages['mechanics/shop'] = 'A Common pack costs 2,500 FOXSY, at most 2 per wallet per week (from Monday 14:00 UTC).'
  assert.equal((await w.today(AT_0700 + 3 * HOUR))!.state, 'behind')
  assert.equal(w.told.length, 1)
  assert.match(w.told[0]!, /^FoxLeague's manual changed since the agents' copy \(pages: mechanics\/shop\)\. /)
  assert.match(w.told[0]!, /snapshot's live values/)
  plain(w.told[0]!)
  // The next day the same pages are still behind: the summary says it, Telegram is not told again; a restart neither.
  await w.today(AT_0700 + 24 * HOUR)
  await watch(server, { kv }).today(AT_0700 + 26 * HOUR)
  assert.equal(w.told.length, 1)
  // A further page changes: that is news.
  server.state.pages['mechanics/matches'] = 'Ranked moves ELO, at most 3 games a pair a day.'
  const later = watch(server, { kv })
  await later.today(AT_0700 + 48 * HOUR)
  assert.equal(later.told.length, 1)
  assert.match(later.told[0]!, /\(pages: mechanics\/matches, mechanics\/shop\)/)
})

test('P-W3 new keys in the game settings and a switch the agents do not know, live within 7 days, are each told once', async () => {
  const server = mcp()
  const kv = memoryKv()
  const w = watch(server, { kv })
  await observe(w, configOf13Nov(), AT_0700)
  assert.equal(w.told.length, 0)
  await observe(w, liveConfig(), AT_0700 + 2 * HOUR + 50 * MIN)
  await w.today(AT_0700 + 2 * HOUR + 51 * MIN)
  const keys = w.told.find(t => t.startsWith("FoxLeague's game settings changed"))
  assert.ok(keys, w.told.join('\n'))
  assert.match(keys, /\(keys: elo_pair_cap \(new\), metastaking_discount \(new\), player_interest\.reset_hour_utc \(new\)\)/)
  plain(keys)
  const soon = w.told.filter(t => /rule switch/.test(t))
  assert.equal(soon.length, 1, 'elo_pair_cap goes live in 4 days; metastaking_discount has no date; fusion_mint has its rule')
  assert.match(soon[0]!, /elo_pair_cap, live from 2026-11-20 14:00 UTC/)
  plain(soon[0]!)
  // Every snapshot after it, and a restart, tell nothing more.
  const told = w.told.length
  for (let m = 1; m <= 30; m++) await observe(w, liveConfig(), AT_0700 + 3 * HOUR + m * MIN)
  const again = watch(server, { kv })
  await observe(again, liveConfig(), AT_0700 + 4 * HOUR)
  assert.equal(w.told.length + again.told.length, told)
  // A switch further than 7 days ahead is not told yet.
  const far = liveConfig()
  far.season_reset = { live: false, live_from: '2026-12-24T14:00:00Z', every_days: 90 }
  const f = watch(mcp(), { kv: memoryKv() })
  await observe(f, configOf13Nov(), AT_0700)
  await observe(f, far, AT_0700 + HOUR)
  assert.equal(f.told.filter(t => /season_reset, live from/.test(t)).length, 0)
})

test('P-W3 the lines stay short: at most eight keys named, the rest counted', async () => {
  const w = watch(mcp())
  await observe(w, configOf13Nov(), AT_0700)
  const many = configOf13Nov()
  for (let i = 0; i < 200; i++) many[`new_setting_${String(i).padStart(3, '0')}_${'k'.repeat(40)}`] = i
  await observe(w, many, AT_0700 + HOUR)
  const line = w.told.find(t => t.startsWith("FoxLeague's game settings changed"))!
  assert.match(line, / and 192 more\)/)
  assert.ok(line.length < 1_500, `${line.length} characters`)
})

test('P-W3 the service tells the owner on Telegram at once, even with updates set to the daily summary', async () => {
  const { Service } = await import('../../src/service.ts')
  const svc = new Service({
    mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', dataDir: mkdtempSync(join(tmpdir(), 'foxagent-pw3-')),
    gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://foxleague.test', gatewayRps: 5, apiRps: 1, foxleagueRps: 5,
    anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined, isServer: true, defaultDryRun: true, maxAgents: 5, manualCheck: true,
  } as Config)
  svc.ensureAgents()
  svc.snapshots.set(0, snapshot())
  const server = mcp()
  Object.assign(svc.manualWatch, { fetch: server.fetch, readManual: () => MANUAL, readRecord: () => record(), gapMs: 0 })
  const sent: string[] = []
  ;(svc as unknown as { telegram: unknown }).telegram = { send: (t: string) => void sent.push(t), stop: () => undefined }
  svc.store.setKv('telegram_updates', 'daily')
  await svc.manualWatch.today()
  server.state.pages['mechanics/shop'] = 'Changed.'
  // A check an hour later (the hourly look), made here by hand.
  await svc.manualWatch.today(Date.now() + HOUR)
  assert.equal(sent.filter(t => t.startsWith("FoxLeague's manual changed since the agents' copy (pages: mechanics/shop)")).length, 1, sent.join('\n'))
  // The snapshot of every tick hands the settings to the watch.
  const src = (await import('node:fs')).readFileSync(new URL('../../src/service.ts', import.meta.url), 'utf8')
  const fn = src.slice(src.indexOf('  private async snapshot(index: number, plan = false)'), src.indexOf('  /**', src.indexOf('  private async snapshot(index: number, plan = false)')))
  assert.match(fn, /this\.manualWatch\.observeConfig\(snap\.config\)/)
})
