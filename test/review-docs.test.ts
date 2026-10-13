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

test('D2 the strategist prompt gives the match gate per rarity, not 20 per card', () => {
  assert.doesNotMatch(SYSTEM_PROMPT, /20 per card/)
  assert.match(SYSTEM_PROMPT, /the match gate of each card's rarity \(below\)/)
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

test('D10 the dashboard Tick input allows what the server allows: the floor is MIN_TICK_MINUTES', () => {
  const m = read('src/web/dashboard.html').match(/id="sTick" type="number" min="(\d+)"/)
  assert.ok(m, 'no Tick input')
  assert.equal(Number(m[1]), MIN_TICK_MINUTES)
})

test('the server guide sets WEB_UI_TRUST_PROXY=1 behind nginx, so strangers cannot lock the owner out', () => {
  const step3 = read('docs/SERVER.md').split('\n3. ')[1]!.split('\n4. ')[0]!
  assert.match(step3, /WEB_UI_TRUST_PROXY=1/, 'step 3 of the first setup does not set WEB_UI_TRUST_PROXY')
  assert.match(read('.env.example'), /WEB_UI_TRUST_PROXY=1[^\n]*\n#[^\n]*lock/, '.env.example does not say why it matters')
})
