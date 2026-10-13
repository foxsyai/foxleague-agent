// Whole-project review, 2026-10-13: what the documentation, the dashboard and the prompt promise, held against the
// code (D1 to D12 and the server setup).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Config } from '../src/config.ts'
import { DEFAULT_SETTINGS, LEVEL_SETTINGS, MIN_TICK_MINUTES, STRATEGY_PRESETS } from '../src/store/settings.ts'
import { SYSTEM_PROMPT } from '../src/strategist/prompt.ts'
import { checkAction } from '../src/executor/rules.ts'
import { parseAction } from '../src/executor/actions.ts'
import { wholeToAtomic } from '../src/util/encoding.ts'
import { TEST_SETTINGS, snapshot } from './fixtures.ts'

const REPO = resolve(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(REPO, p), 'utf8')
const DOCS = 'site/src/content/docs'

test('D1 the docs give the default tick: every two hours (Zeus every hour), never every half hour', () => {
  assert.equal(DEFAULT_SETTINGS.tickMinutes, 120)
  assert.equal(LEVEL_SETTINGS.zeus!.tickMinutes, 60)
  for (const f of ['README.md', 'INSTALL.md', `${DOCS}/index.mdx`]) {
    assert.doesNotMatch(read(f), /half hour/i, `${f} says the agent plans every half hour`)
    assert.match(read(f), /every two hours/i, `${f} does not give the default tick`)
  }
})

test('D2 the strategist prompt gives the match gate per rarity, not 20 per card', () => {
  assert.doesNotMatch(SYSTEM_PROMPT, /20 per card/)
  assert.match(SYSTEM_PROMPT, /the match gate of each card's rarity \(below\)/)
})

test('D3 the safety page says Zeus creates private tournaments, which the rules allow', () => {
  const doc = read(`${DOCS}/play/safety.md`)
  assert.doesNotMatch(doc, /never creates a private tournament/)
  assert.match(doc, /private tournament only at the Zeus level/)
  const invite = { type: 'create_tournament', title: 'Varna Cup', format: 'round_robin', tier: 'silver', max_teams: 6, min_teams: 4, entry_fee_foxsy: 1000, starts_in_hours: 6, registration_closes_minutes_before: 60, round_interval_minutes: 60, invite_user_ids: [11, 12, 13] }
  const v = checkAction(parseAction(invite), snapshot(), { settings: TEST_SETTINGS, now: new Date(), zeus: true, ownUserIds: [99] })
  assert.equal(v.ok, true, `a Zeus agent's private tournament is refused: ${v.ok ? "" : v.refusal}`)
})

test('D4 picking a level opens a proposal with ticks, and Accept and save saves the ticked rows', () => {
  for (const f of [`${DOCS}/use/settings.md`, `${DOCS}/play/strategy-levels.md`]) {
    const doc = read(f).replace(/\s+/g, ' ')
    assert.doesNotMatch(doc, /[Cc]heck them and press Save/, `${f} says to check the filled form and press Save`)
    assert.doesNotMatch(doc, /fills (its default limits|them)/, `${f} says a level fills the form`)
    assert.match(doc, /\*\*Accept and save\*\* saves the ticked ones/, `${f} does not explain the proposal`)
  }
})

test('D5 a low-funds warning waits for the morning summary in the default quiet mode: the docs say so', async () => {
  assert.doesNotMatch(read(`${DOCS}/use/dashboard.md`), /you also get one message on Telegram/)
  assert.doesNotMatch(read('src/web/dashboard.html'), /You also get one message on Telegram when it falls under/)
  assert.match(read(`${DOCS}/use/dashboard.md`).replace(/\s+/g, ' '), /it shows in the morning summary on Telegram, at once with `\/updates all`/)
  const { Service } = await import('../src/service.ts')
  const cfg = {
    mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', dataDir: mkdtempSync(join(tmpdir(), 'foxagent-')),
    gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9', gatewayRps: 5, apiRps: 1, foxleagueRps: 5,
    anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined, isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config
  const svc = new Service(cfg)
  svc.ensureAgents()
  const told: string[] = []
  svc.notify = (text: string) => void told.push(text)
  assert.equal(svc.updatesMode(), 'daily')
  const snap = snapshot()
  snap.chain = { ...snap.chain!, egld: wholeToAtomic(1), foxsy: wholeToAtomic(1000) } // nothing above the 1 EGLD reserve, about $2 of FOXSY
  ;(svc as unknown as { checkFunds: (a: unknown, s: unknown) => void }).checkFunds(svc.store.agent(0), snap)
  assert.ok(svc.store.activity(0, 5).some(r => /is low on funds/.test(r.summary)), 'the warning was not logged')
  assert.deepEqual(told, [], 'the warning went to Telegram at once in the quiet mode')
})

test('D6 the settings page counts the presets the code has', () => {
  const words: Record<number, string> = { 5: 'Five', 6: 'Six', 7: 'Seven' }
  const n = Object.keys(STRATEGY_PRESETS).length
  assert.match(read(`${DOCS}/use/settings.md`), new RegExp(`${words[n]} presets set it for you`), `the code has ${n} presets`)
})

test('D7 a version named in the README is the package version', () => {
  const pkg = (JSON.parse(read('package.json')) as { version: string }).version
  for (const m of read('README.md').matchAll(/version (\d+\.\d+)/gi)) assert.ok(pkg.startsWith(`${m[1]}.`), `the README says version ${m[1]}, package.json is ${pkg}`)
})

test('D8 the review count is not the stale thirteen, and the open items point at the review record', () => {
  for (const f of ['README.md', `${DOCS}/play/safety.md`]) {
    const doc = read(f).replace(/\s+/g, ' ')
    assert.doesNotMatch(doc, /thirteen adversarial reviews/i, `${f} still counts thirteen reviews`)
    assert.doesNotMatch(doc, /except two low ones/, `${f} still says only two low findings stay open`)
    assert.match(doc, /Fourteen numbered adversarial reviews/i, `${f} does not give the review count`)
  }
})

test('D9 INSTALL.md says Binance top-ups are built, each approved by a code', () => {
  const doc = read('INSTALL.md').replace(/\s+/g, ' ')
  assert.doesNotMatch(doc, /a later feature/)
  assert.doesNotMatch(doc, /for automatic top-ups/)
  assert.match(doc, /Optional: a Telegram bot [^.]*Binance API key for EGLD top-ups[^.]*one-time code/)
})

test('D10 the dashboard Tick input allows what the server allows: the floor is MIN_TICK_MINUTES', () => {
  const m = read('src/web/dashboard.html').match(/id="sTick" type="number" min="(\d+)"/)
  assert.ok(m, 'no Tick input')
  assert.equal(Number(m[1]), MIN_TICK_MINUTES)
})

test('D11 the economy reference does not offer the removed pool-status route as a live value', () => {
  for (const line of read('docs/ECONOMY-AND-RULES.md').split('\n').filter(l => l.includes('/api/register/pool-status'))) {
    assert.match(line, /removed|not public/i, `still read as a live value: ${line.slice(0, 120)}`)
  }
})

test('D12 no comma before the last "and" or "or" of a list in these user texts (owner rule)', () => {
  const bad: string[] = []
  const check = (file: string, re: RegExp) => { if (re.test(read(file))) bad.push(`${file}: ${re.source}`) }
  check('INSTALL.md', /details on request, and you can talk to your manager/)
  check(`${DOCS}/start/keys.mdx`, /any detail on request, and you can talk to your manager/)
  check('src/web/dashboard.html', /any detail on request \(\/status, \/plan, \/log\), and you can talk/)
  check(`${DOCS}/use/talk-to-your-manager.md`, /a payment whose outcome is unclear, and top-up codes/)
  check('src/web/dashboard.html', /no plans, no AI cost, no warnings, and they don't count/)
  check('src/web/dashboard.html', /today's matches and training, and the tournaments it is in/)
  check('src/store/settings.ts', /a fusion input, a resale margin, or a clear upgrade/)
  check('src/store/settings.ts', /how often a team plays and accepts 1v1s, and the engine facts/)
  assert.deepEqual(bad, [], `Oxford commas:\n${bad.join('\n')}`)
})

test('the server guide sets WEB_UI_TRUST_PROXY=1 behind nginx, so strangers cannot lock the owner out', () => {
  const step3 = read('docs/SERVER.md').split('\n3. ')[1]!.split('\n4. ')[0]!
  assert.match(step3, /WEB_UI_TRUST_PROXY=1/, 'step 3 of the first setup does not set WEB_UI_TRUST_PROXY')
  assert.match(read('.env.example'), /WEB_UI_TRUST_PROXY=1[^\n]*\n#[^\n]*lock/, '.env.example does not say why it matters')
})
