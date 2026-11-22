// Audit 2026-11-11 (Fable 5.2 reviewers at extra-high effort): DOCS-4, failing on the old text.
// DOCS: the pages said "About $1 a day for a single agent ... about $0.15 a plan" and suggested a monthly limit of $20
// at Anthropic. The sentence was measured when the game manual was 143 KB; it is 245 KB now, and nothing tied the
// sentence to it. Measured again on the maintainer's server on 2026-11-11, from real plans (the manual of main
// ac8833f): the rules prompt and the game manual are about 99,000 tokens and a plan reads about 111,000 input tokens
// in all; ten agents on Opus 5.5 at high effort averaged $0.15 a plan with the manual served from the cache and
// $0.60 without.
//
// This file ties every stated number to the code: the size of the text every plan sends (so a manual that grows
// fails here until the numbers are looked at again), the list prices in MODELS, the default tick and active hours.
// The cost of the default (Haiku 5.5 at high since the owner's decision of 2026-11-20, DEF-1; Sonnet 5.5 at medium
// before) is derived from the measured token counts; no cost of a model is stated that was neither measured nor derived
// this way.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type Anthropic from '@anthropic-ai/sdk'
import { MODELS, usd } from '../../src/strategist/strategist.ts'
import { SYSTEM_PROMPT } from '../../src/strategist/prompt.ts'
import { DEFAULT_AI, DEFAULT_SETTINGS } from '../../src/store/settings.ts'

const ROOT = new URL('../../', import.meta.url)
const raw = (f: string) => readFileSync(new URL(f, ROOT), 'utf8')
const read = (f: string) => raw(f).replace(/\s+/g, ' ')

/** What was measured on 2026-11-11, and the size of the text it was measured on (SYSTEM_PROMPT, a blank line, manual.md trimmed). */
const MEASURED = {
  systemBytes: 275_312,
  systemTokens: 99_000,
  planInputTokens: 111_000,
  opusHigh: { cached: 0.15, uncached: 0.6, agents: 10 },
}

/** The text every plan sends before the snapshot, as the strategist builds it, and its tokens at the measured bytes per token. */
const systemBytes = Buffer.byteLength(`${SYSTEM_PROMPT}\n\n${raw('src/strategist/manual.md').trim()}`)
const systemTokens = Math.round((MEASURED.systemTokens * systemBytes) / MEASURED.systemBytes)
/** A plan's input: that text plus the snapshot and the request, as measured. */
const planInputTokens = systemTokens + (MEASURED.planInputTokens - MEASURED.systemTokens)
const [from, to] = DEFAULT_SETTINGS.activeHoursUtc
const activeHours = (to - from + 24) % 24 || 24
const plansADay = (activeHours * 60) / DEFAULT_SETTINGS.tickMinutes

const PLACES = ['site/src/content/docs/help/costs.md', 'site/src/content/docs/start/keys.mdx', 'INSTALL.md', 'README.md', 'src/web/dashboard.html']
const num = (re: RegExp, text: string, what: string): number => {
  const m = re.exec(text)
  assert.ok(m, `not stated: ${what}`)
  return Number(m[1]!.replace(/,/g, ''))
}
const STATED = {
  perDay: [/about \$(\d+(?:\.\d+)?) a day for a single agent/i, 'the cost of a day'],
  perPlan: [/about \$(\d+(?:\.\d+)?) a plan\)/i, 'the cost of a plan'],
  tickHours: [/a plan every (\d+) hours inside \d+ active hours/, 'the tick'],
  hours: [/a plan every \d+ hours inside (\d+) active hours/, 'the active hours'],
  tokens: [/the rules and the game manual, about ([\d,]+) tokens/, 'the size of the rules and the manual'],
  cached: [/averaged \$(\d+(?:\.\d+)?) a plan with the manual from the cache/, 'the measured cost with the cache'],
  uncached: [/from the cache and \$(\d+(?:\.\d+)?) without/, 'the measured cost without the cache'],
} as const
/** One stated number of a page, read when a test asks for it, so each test fails for its own reason. */
const stated = (f: string) => {
  const text = read(f)
  const out = {} as Record<keyof typeof STATED, number>
  for (const k of Object.keys(STATED) as (keyof typeof STATED)[]) Object.defineProperty(out, k, { get: () => num(STATED[k][0], text, `${f}: ${STATED[k][1]}`) })
  return out
}

test('DOCS-4 the default the sentence names is the default of the code: Haiku 5.5 at high, a plan every 2 hours inside 16 active hours', () => {
  assert.deepEqual(DEFAULT_AI, { model: 'claude-haiku-5-5', effort: 'high' })
  assert.match(raw('src/config.ts'), /model: process\.env\.AGENT_MODEL\?\.trim\(\) \|\| DEFAULT_AI\.model/)
  assert.match(raw('src/strategist/strategist.ts'), /process\.env\.AGENT_MODEL_EFFORT \?\? \(modelNamed \? 'medium' : DEFAULT_AI\.effort\)/)
  assert.equal(MODELS[DEFAULT_AI.model]!.label, 'Haiku 5.5')
  for (const f of PLACES) {
    const s = stated(f)
    assert.match(read(f), /Haiku 5\.5 at high/, f)
    assert.equal(s.tickHours * 60, DEFAULT_SETTINGS.tickMinutes, f)
    assert.equal(s.hours, activeHours, f)
  }
})

test('DOCS-4 the stated size of the rules and the manual is the size of the text every plan sends today', () => {
  for (const f of PLACES) {
    const s = stated(f)
    const off = Math.abs(systemTokens - s.tokens) / s.tokens
    assert.ok(off <= 0.05, `${f} says about ${s.tokens} tokens; the prompt and the manual are about ${systemTokens} today (${systemBytes} bytes): measure a plan again and restate the costs`)
  }
})

test('DOCS-4 the stated cost of a plan at the defaults is what its input costs at the list price, plus a short answer', () => {
  // Priced as the code books it (usd): Haiku 5.5's card for a prompt over 100,000 tokens, which a plan's is. Its answer
  // at high effort is about 16,300 tokens (src/strategist/strategist.ts, roomFor), about $0.04 at that card.
  const input = usd(DEFAULT_AI.model, { input_tokens: planInputTokens, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, iterations: null } as unknown as Anthropic.Beta.BetaUsage)
  for (const f of PLACES) {
    const { perPlan } = stated(f)
    assert.ok(input <= perPlan, `${f}: a lone plan reads about ${planInputTokens} tokens, $${input.toFixed(3)} on ${MODELS[DEFAULT_AI.model]!.label} before the answer; the page says about $${perPlan}`)
    assert.ok(perPlan - input <= 0.05, `${f}: $${perPlan} a plan is more than the input ($${input.toFixed(3)}) and a short answer`)
  }
})

test('DOCS-4 the stated cost of a day is the plans of a default day at the stated cost of a plan', () => {
  // 06:00 to 22:00 UTC since HOURS-1 (the owner, 2026-11-22): 16 hours at a 2-hour tick.
  assert.equal(plansADay, 8)
  for (const f of PLACES) {
    const s = stated(f)
    assert.equal(s.perDay.toFixed(2), (plansADay * s.perPlan).toFixed(2), `${f}: ${plansADay} plans of $${s.perPlan}`)
  }
})

test('DOCS-4 the cost of Opus 5.5 at high effort is the one measured on ten agents, and no less than its input costs at the list prices', () => {
  const [inP, , readP] = MODELS['claude-opus-5-5']!.price
  const rest = MEASURED.planInputTokens - MEASURED.systemTokens
  const floorCached = (MEASURED.systemTokens * readP + rest * inP) / 1e6
  const floorUncached = (MEASURED.planInputTokens * inP) / 1e6
  assert.ok(floorCached < MEASURED.opusHigh.cached && floorUncached < MEASURED.opusHigh.uncached, 'the measured costs hold the input at the list prices')
  for (const f of PLACES) {
    const s = stated(f)
    assert.match(read(f), /measured on real plans, ten agents on Opus 5\.5 at high effort averaged/, f)
    assert.equal(s.cached, MEASURED.opusHigh.cached, f)
    assert.equal(s.uncached, MEASURED.opusHigh.uncached, f)
  }
})

test('DOCS-4 no page keeps the old cost or a cost per agent that was not measured', () => {
  for (const f of [...PLACES, 'install.sh']) {
    const text = read(f)
    assert.doesNotMatch(text, /About \$1 a day for a single agent/i, f)
    assert.doesNotMatch(text, /About \$1\.50 a day for a single agent/i, `${f}: the cost of Sonnet 5.5 at medium, the default before 2026-11-20`)
    assert.doesNotMatch(text, /about \$0\.40 a day/, `${f}: three or more agents at $0.40 a day each was never measured on today's manual`)
    assert.doesNotMatch(text, /\$20\. Then it can never cost more/, f)
  }
})

test('DOCS-4 the monthly limit the pages suggest at Anthropic lasts a month of a default agent with room to spare', () => {
  const perDay = stated('site/src/content/docs/help/costs.md').perDay
  const limits: [string, RegExp][] = [
    ['site/src/content/docs/start/keys.mdx', /monthly spend limit, for example \$(\d+)/],
    ['INSTALL.md', /monthly spend limit, for example \$(\d+)/],
    ['src/web/dashboard.html', /monthly spend limit, for example \$(\d+)/],
    ['install.sh', /Set a monthly limit \(\$(\d+)\)/],
  ]
  for (const [f, re] of limits) {
    const limit = num(re, read(f), `${f}: the example limit`)
    assert.ok(limit >= 31 * perDay * 1.25, `${f}: a limit of $${limit} a month ends the plans after about ${Math.floor(limit / perDay)} days at $${perDay} a day`)
  }
})

test('DOCS-4 the first credit the pages suggest is said for what it is: about two weeks of a default agent', () => {
  // About a week at Sonnet 5.5 at medium, the default before 2026-11-20 (DEF-1); about two weeks at Haiku 5.5 at high.
  const perDay = stated('site/src/content/docs/help/costs.md').perDay
  for (const f of ['site/src/content/docs/start/keys.mdx', 'INSTALL.md', 'src/web/dashboard.html']) {
    const credit = num(/add credit\. \$(\d+) /i, read(f), `${f}: the first credit`)
    const days = credit / perDay
    assert.ok(days >= 12 && days <= 17, `${f}: $${credit} is ${days.toFixed(1)} days at $${perDay} a day`)
    assert.match(read(f), /add credit\. \$\d+ (is enough to start: it )?(runs|lasts) a single agent at the defaults (for )?about two weeks/i, f)
  }
})
