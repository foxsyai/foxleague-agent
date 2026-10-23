// Owner, 2026-10-24: the manual must be one to one with the code, so a user knows from it exactly how the software
// behaves. Three read-only reviewers read every page, README, INSTALL.md and the dashboard's info bubbles against the
// code; each test below is one of their findings (MS = manual sync), seen failing before the fix. Where a number lives
// in the code, the test reads it from there.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { Mnemonic } from '@multiversx/sdk-core'
import type { Config } from '../src/config.ts'
import { Sessions, hashPassword } from '../src/web/auth.ts'
import { LEVEL_SETTINGS } from '../src/store/settings.ts'
import { MARKET_WINDOWS, MIN_TRADING_DAYS } from '../src/snapshot/market.ts'
import { FIELD_SEATS, FIELD_TOURNAMENTS } from '../src/snapshot/snapshot.ts'
import { PREVIOUS_PLAN_CHARS } from '../src/strategist/strategist.ts'
import { RANKED_COOLDOWN_MS } from '../src/executor/rules.ts'

const REPO = new URL('..', import.meta.url).pathname
const read = (f: string) => readFileSync(join(REPO, f), 'utf8').replace(/\s+/g, ' ')
const DOCS = 'site/src/content/docs'
const html = readFileSync(join(REPO, 'src/web/dashboard.html'), 'utf8')
/** One info bubble whole: from its key to the end of its entry. */
function tip(key: string): string {
  const lines = html.split('\n')
  const start = lines.findIndex(l => l.startsWith(`  ${key}: [`))
  if (start < 0) return ''
  const end = lines.findIndex((l, i) => i >= start && l.trimEnd().endsWith('`],'))
  return lines.slice(start, end + 1).join(' ').replace(/\s+/g, ' ')
}
const guide = html.replace(/\s+/g, ' ')

function testConfig(dir: string): Config {
  return {
    mnemonic: Mnemonic.generate().toString(), dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config
}

// ---- code: what the software answers ----

test('MS-B3 /tick and Plan now outside the active hours say so instead of "started"', async () => {
  const { Service } = await import('../src/service.ts')
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-'))))
  svc.ensureAgents()
  const h = new Date().getUTCHours()
  svc.store.updateSettings(0, { activeHoursUtc: [(h + 2) % 24, (h + 3) % 24] })
  let started = 0
  ;(svc as unknown as { tick: () => Promise<string> }).tick = async () => { started++; return 'ran' }
  const reply = await svc.command('tick', ['1'], '1')
  assert.match(reply, /agent 1: outside active hours/, reply)
  assert.match(reply, /\/do 1 /, 'it names the command that runs anyway')
  assert.doesNotMatch(reply, /tick started/)
  const { startWeb } = await import('../src/web/server.ts')
  const pw = 'correct-horse-battery'
  const creds = { username: 'admin', passwordHash: hashPassword(pw), secretKey: 'k'.repeat(64) }
  const server = startWeb(svc, creds, 0)
  if (!server.listening) await once(server, 'listening')
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const sessions = new Sessions(creds.secretKey, creds.passwordHash)
  const cookie = sessions.issue('admin')
  try {
    const res = await fetch(`${url}/api/agents/0/tick`, { method: 'POST', headers: { cookie: `foxagent_session=${cookie}`, origin: url, 'x-csrf-token': sessions.csrfFor(cookie), 'content-type': 'application/json' }, body: '{}' })
    const body = await res.json() as { error?: string }
    assert.equal(res.status, 409)
    assert.match(String(body.error), /outside active hours/)
    assert.equal(started, 0, 'nothing was started')
    // Inside the hours both start the plan, as before.
    svc.store.updateSettings(0, { activeHoursUtc: [0, 24] })
    assert.match(await svc.command('tick', ['1'], '1'), /tick started/)
    const ok = await fetch(`${url}/api/agents/0/tick`, { method: 'POST', headers: { cookie: `foxagent_session=${cookie}`, origin: url, 'x-csrf-token': sessions.csrfFor(cookie), 'content-type': 'application/json' }, body: '{}' })
    assert.equal(ok.status, 200)
    assert.equal(started, 2)
  } finally {
    server.close()
  }
})

test('MS-C2 bootstrap.sh installs the service file from its own folder, so it runs before the first deploy', () => {
  const sh = readFileSync(join(REPO, 'deploy/bootstrap.sh'), 'utf8')
  assert.doesNotMatch(sh, /install -m 644 "\$BASE\/app\/deploy\/foxleague-agent\.service"/)
  assert.match(sh, /HERE="\$\(cd "\$\(dirname "\$0"\)" && pwd\)"/)
  assert.match(sh, /install -m 644 "\$HERE\/foxleague-agent\.service" \/etc\/systemd\/system\/foxleague-agent\.service/)
})

// ---- the play pages, the home page and README ----

test('MS-A how it plays, strategy levels, safety and the home page say what the code does', () => {
  const plays = read(`${DOCS}/play/how-it-plays.md`)
  const levels = read(`${DOCS}/play/strategy-levels.md`)
  const safety = read(`${DOCS}/play/safety.md`)
  const home = read(`${DOCS}/index.mdx`)
  assert.match(plays, new RegExp(`For the ${FIELD_TOURNAMENTS} open Silver or Gold tournaments it could join whose deadlines come first \\(up to ${FIELD_SEATS} seated teams each\\)`), 'A1 the field read')
  assert.match(levels, /a \*\*win chance\*\* for each team on its challenge list \(up to 10, the teams that accept 1v1s first\)/, 'A2 the challenge list')
  assert.match(levels, /For each team on its challenge list \(up to 10\) it reads the ELO and the lineup strength, ours at today's condition and theirs at full condition/, 'A2')
  assert.match(levels, new RegExp(`over the last ${MARKET_WINDOWS[0]} days \\(${MARKET_WINDOWS[1]} or ${MARKET_WINDOWS[2]} days when fewer than ${MIN_TRADING_DAYS} days traded; with too few sales even then the agent sees no market price\\)`), 'A3 the market windows')
  assert.match(levels, /the settings the level would change \(moving up, those that fall short, raised to the level; moving down, those above it, lowered to the level\), each with a tick/, 'A4 the level proposal')
  assert.match(plays, /it may create one open challenge a day \(never at the Zeus level, which challenges only a named team with a known win chance\)/, 'A5 Zeus and open challenges')
  assert.match(plays, new RegExp(`the ranked cooldown \\(${Math.floor(RANKED_COOLDOWN_MS / 60_000)} minutes in the game; the plan spaces ranked games 16 minutes apart to be sure\\)`), 'A6 the ranked cooldown')
  assert.match(home, /prepares the squad before each match session locks/, 'A7 one preparation per match session')
  assert.match(levels, /Every bid stays at or under the lowest of three numbers/, 'A8')
  assert.match(plays, /it sees each stat's XP pool once it is within 500 XP of its next point/, 'A9 the XP pools')
  assert.match(levels, /a random shift of up to 10 minutes either way/, 'A10 the random shift')
  assert.match(plays, new RegExp(`its previous plan \\(summary and actions, up to ${PREVIOUS_PLAN_CHARS.toLocaleString('en-US')} characters\\)`), 'A11 the previous plan')
  assert.match(levels, /\(raising a limit or shortening the tick asks for your password\)/, 'A12')
  assert.match(safety, /raising a limit \(also a shorter tick, longer active hours, Gold back on or a smaller gas reserve\), switching to a dearer AI, releasing the kill switch and changing a key all ask for your password again/, 'A12')
  assert.match(safety, /needs you to type `GO LIVE` and your password, and this machine's permission \(`AGENT_LIVE_ENABLED=1` in `\.env`, asked by the installer\)/, 'A13')
  assert.equal(LEVEL_SETTINGS.zeus!.tickMinutes, 60)
})

// ---- the use pages and the info bubbles ----

test('MS-B the settings, dashboard and Telegram pages and the info bubbles say what the code does', () => {
  const settings = read(`${DOCS}/use/settings.md`)
  const dash = read(`${DOCS}/use/dashboard.md`)
  const talk = read(`${DOCS}/use/talk-to-your-manager.md`)
  const zeusTick = LEVEL_SETTINGS.zeus!.tickMinutes
  assert.match(settings, new RegExp(`120 minutes is the default of every level but Zeus, which plans every ${zeusTick} minutes`), 'B1 the Zeus tick')
  assert.match(tip('tick'), new RegExp(`The default is 120 for every level but Zeus, which plans every ${zeusTick} minutes`), 'B1')
  assert.match(talk, /`\/topup <code> \[EGLD\]` \| Approve it \(with a smaller amount after the code, that much instead; more than proposed is refused\)/, 'B2')
  assert.match(talk, /`\/tick N` \| Plan and run now, inside the agent's active hours \(outside them it says so; `\/do N request` runs anyway\)/, 'B3')
  for (const [name, text] of [['settings', settings], ['tick bubble', tip('tick')]] as const) assert.match(text, /a planning cycle also runs about an hour before each match session locks \(matches whose locks fall within 2 hours of each other share it\)/i, `B4 ${name}`)
  // The Costs page too (agent review of PR #28, low).
  for (const [name, text] of [['dashboard', dash], ['settings', settings], ['funds bubble', tip('funds')], ['topup bubble', tip('topup')], ['costs', read(`${DOCS}/help/costs.md`)]] as const) {
    assert.match(text, /with a Binance key, Telegram and the platform LIVE, a top-up proposal comes at once \(once a day per agent\)/i, `B5 ${name}`)
  }
  assert.match(settings, /Lowering a limit is one click\. Raising one asks for your password, and so do a smaller gas reserve, Gold amounts where there were none, a shorter tick and longer active hours\./, 'B6')
  assert.match(settings, /the Silver and Gold amounts or the tick; your limits per rarity stay as they are\)/, 'B7')
  assert.match(tip('strategy'), /the settings that do not fit it yet \(moving up, those under its values; moving down, those above them\), each with a tick, and its recommended AI/, 'B8')
  assert.match(settings, /Each level up to the predator adds two Silver steps; the beast and Zeus add the 4,999 ceiling\./, 'B9')
  assert.match(settings, /every planned action is carried out \(a match that its cooldown pushes past the plan's window waits for the next plan; a plan keeps at most 12 actions\)/, 'B10')
})

// ---- the start and help pages, INSTALL.md and README ----

test('MS-C install, keys, costs, server, FAQ, troubleshooting, update, INSTALL.md and README say what the code does', () => {
  const COST = /About \$2 a day for a single agent with the default model, effort and tick \(Sonnet 5 at medium, a plan every 2 hours, about \$0\.30 a plan\)/i
  for (const f of [`${DOCS}/help/costs.md`, `${DOCS}/start/keys.mdx`, 'INSTALL.md', 'README.md']) {
    assert.doesNotMatch(read(f), /\$0\.20 to \$0\.50/, `C1 ${f} keeps the old AI cost`)
    assert.match(read(f), COST, `C1 ${f}`)
  }
  assert.doesNotMatch(guide, /\$0\.20 to \$0\.50/, 'C1 the Getting started guide')
  assert.match(guide, COST, 'C1 the Getting started guide')
  const server = read(`${DOCS}/help/server.mdx`)
  assert.match(server, /Copy the repository to the server and run, as root, `deploy\/bootstrap\.sh`/, 'C2 the server order')
  assert.match(server, /Ubuntu with systemd, on an x86-64 processor/, 'C3')
  const shared = /the rule that a private tournament it creates never invites another of your teams/
  for (const f of [`${DOCS}/help/faq.md`, `${DOCS}/help/update.md`, 'INSTALL.md', 'README.md', `${DOCS}/play/safety.md`]) assert.match(read(f), shared, `C4 ${f}`)
  assert.match(read(`${DOCS}/help/costs.md`), /you are warned there, in the morning summary on Telegram \(at once with `\/updates all`\)/, 'C5')
  assert.match(read(`${DOCS}/help/troubleshooting.md`), /By default Telegram sends only the morning summary and urgent messages; send `\/updates all` for every plan and result as it happens/, 'C6')
  const keys = read(`${DOCS}/start/keys.mdx`)
  assert.match(keys, /an API key that can only read your account and withdraw EGLD to your agent wallets/, 'C7')
  assert.match(keys, /`\/topup 482193 10` withdraws 10 EGLD instead, less than proposed \(Binance's fee comes off that\)/, 'C8')
})
