// Screenshots of the real dashboard for the site, taken on throwaway demo agents with made-up data: a fresh
// wallet in a temporary folder, no network calls, nothing real. Run from the repository root:
//   node --disable-warning=ExperimentalWarning site/scripts/screenshots.ts
// Needs Google Chrome (or Chromium) on PATH; writes site/public/screenshots/*.png.

import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { Mnemonic } from '@multiversx/sdk-core'
import { Service } from '../../src/service.ts'
import { saveImportedKey } from '../../src/wallet/imported.ts'
import { startWeb } from '../../src/web/server.ts'
import { Sessions, hashPassword } from '../../src/web/auth.ts'
import { wholeToAtomic } from '../../src/util/encoding.ts'
import { snapshot } from '../../test/fixtures.ts'
import type { Config } from '../../src/config.ts'

const OUT = join(import.meta.dirname, '..', 'public', 'screenshots')
const CHROME = process.env.CHROME ?? 'google-chrome'
mkdirSync(OUT, { recursive: true })

// ---- demo agents: agent 1 from the install's words, agent 2 an imported team ----
const dir = mkdtempSync(join(tmpdir(), 'foxagent-demo-'))
process.env.WEB_UI_INSECURE_COOKIE = '1'
process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-DEMOdemoDEMOdemoDEMOdemoDEMOdemoDEMOdemo-0000'
process.env.TELEGRAM_BOT_TOKEN = '123456789:AAHdemoDEMOdemoDEMOdemoDEMOdemoDEMOx'
process.env.TELEGRAM_CHAT_ID = '123456789'
delete process.env.BINANCE_API_KEY
delete process.env.BINANCE_API_SECRET
process.env.AGENT_LIVE_ENABLED = '1'
const cfg = {
  mnemonic: Mnemonic.generate().toString(), dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
  gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: process.env.ANTHROPIC_API_KEY, model: 'claude-haiku-5-5', // src/config.ts: the default when AGENT_MODEL is not set (DEFAULT_AI)
  telegramToken: process.env.TELEGRAM_BOT_TOKEN, telegramChatId: process.env.TELEGRAM_CHAT_ID, isServer: false, defaultDryRun: true, maxAgents: 5,
} as Config
const svc = new Service(cfg)
;(svc as unknown as { telegram: unknown }).telegram = { send: () => undefined, stop: () => undefined } // linked, but nothing leaves this machine
svc.ensureAgents()
const store = svc.store
store.setKv('welcome_hidden', '1')
store.setKv('model_usd_total', '1.84')

const now = Date.now()
const iso = (ms: number) => new Date(ms).toISOString()
const snap = snapshot()
snap.chain = { egld: wholeToAtomic(3) + wholeToAtomic(1) / 5n, nonce: 42, foxsy: wholeToAtomic(4250), wegld: 0n, nftCount: 18 }
snap.profile = { ...snap.profile!, team_name: 'Fox Demo XI', elo_rating: 1215, matches_won: 6, matches_drawn: 1, matches_lost: 3, tournament_wins: 1 }
snap.auth!.allowance = { today_count: 3, daily_limit: 5, reset_hour_utc: 14 } as never
snap.auth!.myTournaments = {
  active: [
    { id: 204, title: 'Fox Demo Cup', status: 'open', tier: 'silver', format: 'knockout', max_teams: 8, min_teams: 8, participant_count: 5, entry_fee_foxsy: 1000, deadline: iso(now + 20 * 3600_000), starts_at: iso(now + 21 * 3600_000), creator_user_id: 100, target_user_id: null },
    { id: 212, title: 'Silver 1v1 1000', status: 'open', tier: 'silver', format: 'knockout', max_teams: 2, min_teams: 2, participant_count: 1, entry_fee_foxsy: 1000, deadline: iso(now + 90 * 60_000), starts_at: iso(now + 95 * 60_000), creator_user_id: 100, target_user_id: 55 },
  ],
  completed: [],
} as never
snap.market.openStandard = Array.from({ length: 6 }, () => ({})) as never
snap.market.openChallenges = Array.from({ length: 2 }, () => ({})) as never
svc.snapshots.set(0, snap)
const imported = store.addImportedAgent(saveImportedKey(dir, Mnemonic.generate().deriveKey(0)))
const snap2 = structuredClone(snap)
snap2.team = { ...snap2.team!, name: 'Vixen United' }
snap2.profile = { ...snap2.profile!, team_name: 'Vixen United', elo_rating: 1288, matches_won: 23, matches_drawn: 4, matches_lost: 11, tournament_wins: 3 }
svc.snapshots.set(imported.index, snap2)
// Agent 3, parked with Retire a few days ago (it shows in Retired, not in the tabs).
store.addAgent(imported.index + 1, svc.wallet(imported.index + 1).address)
store.retireAgent(imported.index + 1, { at: iso(now - 3 * 86_400_000), by: 'demo', team: 'Kestrel Forge', egld: '0.8500', foxsy: '1250', usd: 6.12 })

const plan = `agent 1 plan: Squad is fit (condition 72 to 100) and today's free training is still open. The own knockout T204 has 5 of 8 teams and the targeted 1v1 T212 waits for its opponent, so no new entries: train the starters who gain most and sync before tomorrow's first lock.
1. train #6034 speed (Legendary starter, speed lowest at 40 with cap 100)
2. train #977 power (Epic defender, power 42, far from its cap of 90)
3. train #7190 stamina (Rare goalkeeper, stamina 36, cap 75)
4. play ranked match (one of today's free matches; similar ELO opponents available)
5. sync (5 starters gained live points; worth it before tomorrow's lock)
model cost $0.0512 (cache read 52140 tokens)`
store.setKv('last_plan_0', plan)
store.log({ agentIndex: 0, kind: 'plan', status: 'info', summary: plan })
for (const [kind, status, summary] of [
  ['train', 'dry_run', 'DRY RUN would train #6034 speed, cost ~$0.00; then POST /api/training/train'],
  ['train', 'dry_run', 'DRY RUN would train #977 power, cost ~$0.00; then POST /api/training/train'],
  ['train', 'dry_run', 'DRY RUN would train #7190 stamina, cost ~$0.00; then POST /api/training/train'],
  ['play_match', 'dry_run', 'DRY RUN would play a ranked match, cost ~$0.00; then POST /api/matches/play'],
  ['sync', 'dry_run', 'DRY RUN would sync dirty cards to chain, cost ~$0.25 (50 FOXSY + fees); syncMyStats: simulation ok (success)'],
  ['create_challenge', 'dry_run', 'DRY RUN would create silver 1v1, stake 1000 vs user 55, cost ~$2.41 (1000 FOXSY + fees)'],
  ['join_tournament', 'refused', 'join tournament T198: the opponent is far stronger (ELO 1402 vs 1215)'],
] as const) store.log({ agentIndex: 0, kind, status, summary })
const gameDay = snap.gameDay.nextResetAt ? new Date(new Date(snap.gameDay.nextResetAt).getTime() - 86_400_000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)
for (const usd of [2.41, 0.25]) store.recordSpend({ agentIndex: 0, at: new Date(), gameDay, category: 'play', action: '', foxsyAtomic: 0n, egldAtomic: 0n, usd, txHash: null, dryRun: true })

const creds = { username: 'demo', passwordHash: hashPassword('demo-password-123'), secretKey: 'd'.repeat(64) }
const server = startWeb(svc, creds, 0)
if (!server.listening) await once(server, 'listening')
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
const cookie = new Sessions(creds.secretKey, creds.passwordHash).issue('demo')

// ---- Chrome over the DevTools protocol ----
const port = 9333
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'foxagent-chrome-'))}`, 'about:blank'], { stdio: 'ignore' })
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
let target: { webSocketDebuggerUrl: string } | undefined
for (let i = 0; i < 50 && !target; i++) {
  try {
    target = (await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()) as { webSocketDebuggerUrl: string }
  } catch {
    await sleep(200)
  }
}
if (!target) throw new Error('Chrome did not start')
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise(r => ws.addEventListener('open', r, { once: true }))
let nextId = 0
const pending = new Map<number, (v: unknown) => void>()
ws.addEventListener('message', e => {
  const m = JSON.parse(String(e.data)) as { id?: number; result?: unknown; error?: unknown }
  if (m.id !== undefined) pending.get(m.id)?.(m.error ? Promise.reject(new Error(JSON.stringify(m.error))) : m.result)
})
const send = <T = unknown>(method: string, params: Record<string, unknown> = {}) =>
  new Promise<T>((resolve, reject) => {
    const id = ++nextId
    pending.set(id, v => Promise.resolve(v).then(resolve as (v: unknown) => void, reject))
    ws.send(JSON.stringify({ id, method, params }))
  })
const js = (expression: string) => send('Runtime.evaluate', { expression, awaitPromise: true })
const shot = async (name: string, clip?: { x: number; y: number; width: number; height: number }) => {
  const r = await send<{ data: string }>('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) })
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.data, 'base64'))
  console.log(`site/public/screenshots/${name}.png`)
}

await send('Network.enable')
await send('Network.setCookie', { name: 'foxagent_session', value: cookie, url: base, httpOnly: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.enable')
await send('Page.navigate', { url: `${base}/` })
await sleep(3000)

await shot('dashboard')
// The agent page from its top in a taller window, so its plan, its budget and its settings are in one picture (the page's
// caption); the window is set back for the shots after it (review of PR #83).
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1700, deviceScaleFactor: 1, mobile: false })
await js(`window.scrollTo(0, 0)`)
await sleep(800)
await shot('agent-page')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await sleep(400)
await js(`window.scrollTo(0, 0); S.instance.setup.welcomeHidden = false; showGuide(true, 'ai')`)
await sleep(800)
await shot('getting-started')
await js(`showGuide(false)`)
await js(`void $('modeBtn').click()`)
await sleep(500)
await js(`$('pwType').value = 'GO LIVE'`)
await shot('go-live')
await js(`$('pwCancel').click(); void addAgent()`)
await sleep(500)
await shot('add-agent')
await js(`$('pwCancel').click(); openImport()`)
await sleep(400)
await shot('import-team')
// Find my team as it looks after a search (the demo has no FoxLeague to ask): throwaway words, one team on account 4.
const demoWords = Mnemonic.generate()
const found = Array.from({ length: 20 }, (_, n) => ({ account: n, address: demoWords.deriveKey(n).generatePublicKey().toAddress('erd').toBech32(), team: n === 4 ? 'Vixen United' : null }))
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1150, deviceScaleFactor: 1, mobile: false }) // the list below the dialog's fields
await js(`document.querySelector('input[name=impKind][value=words]').click(); $('impWords').value = ${JSON.stringify(demoWords.toString())}; impShowFound(${JSON.stringify(found)}, 0)`)
await sleep(400)
await shot('import-team-find')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await js(`impReset()`)
await sleep(300)
// Step 2 as it looks after the check (the demo has no FoxLeague to ask).
await js(`impToken = 'demo'; $('impFound').replaceChildren(el('div', { text: 'Vixen United · overall 64 · has a badge' }), el('div', { text: S.agents[1].address }), el('div', { text: '1.2500 EGLD · 3,120 FOXSY' })); $('impStep1').hidden = true; $('impStep2').hidden = false; $('impOk').textContent = 'Import team'`)
await sleep(300)
await shot('import-team-check')
await js(`closeImport(); void $('retireBtn').click()`)
await sleep(400)
await shot('retire')
await js(`$('pwCancel').click(); openRetired()`)
await sleep(400)
await shot('retired')
await js(`closeRetired(); toggleAdmin(true)`)
await sleep(1200)
await js(`document.getElementById('adminPanel').scrollIntoView({block: 'start'})`)
await sleep(500)
await shot('keys')

// The conversation with the manager, for its page in the manual: a stand-in answers, nothing leaves this machine.
const realStrategist = svc.strategist
const answers = [
  { reply: 'Agent 1 is in good shape: the squad is fit, three of today\'s five free trainings are still open and it holds a seat in the Fox Demo Cup (5 of 8 teams).', proposal: null },
  { reply: 'Understood: Silver only this week and no boosters.', proposal: { agents: [0], strategy: 'This week: Silver tournaments and Silver 1v1s only, at modest stakes. No XP boosters. Keep the squad healthy, use every free training and sync when enough stats changed.', changes: 'Silver only this week, no boosters' } },
]
svc.strategist = { discuss: async () => ({ ...answers.shift()!, usd: 0 }) } as never
await svc.discuss('How is agent 1 doing today?', 'web UI, demo', [0])
await svc.discuss('This week focus on Silver tournaments and skip boosters.', 'web UI, demo', [0])
svc.strategist = realStrategist
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1600, deviceScaleFactor: 1, mobile: false }) // tall enough for the whole card
await js(`toggleAdmin(false); void loadState()`)
await sleep(1000)
await js(`document.getElementById('chatLog').closest('.card').scrollIntoView({block: 'center'})`)
await sleep(400)
const card = await send<{ result: { value: string } }>('Runtime.evaluate', {
  expression: `JSON.stringify((r => ({ x: Math.max(0, r.x + scrollX - 12), y: r.y + scrollY - 12, width: r.width + 24, height: r.height + 24 }))(document.getElementById('chatLog').closest('.card').getBoundingClientRect()))`,
})
await shot('talk-to-the-manager', JSON.parse(card.result.value))

ws.close()
chrome.kill()
server.close()
process.exit(0)
