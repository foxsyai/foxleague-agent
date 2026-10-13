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

test('the server guide sets WEB_UI_TRUST_PROXY=1 behind nginx, so strangers cannot lock the owner out', () => {
  const step3 = read('docs/SERVER.md').split('\n3. ')[1]!.split('\n4. ')[0]!
  assert.match(step3, /WEB_UI_TRUST_PROXY=1/, 'step 3 of the first setup does not set WEB_UI_TRUST_PROXY')
  assert.match(read('.env.example'), /WEB_UI_TRUST_PROXY=1[^\n]*\n#[^\n]*lock/, '.env.example does not say why it matters')
})
