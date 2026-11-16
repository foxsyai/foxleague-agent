// Audit 2026-11-16, ATTACK reviewer. ATK-4: txt() in src/snapshot/digest.ts cuts rival text by UTF-16 units
// (`s.slice(0, max - 1)`), so a character outside the basic plane (any emoji) that sits across the cut is left as
// half a pair: a lone surrogate. FoxLeague takes any title of up to 100 bytes (routes/tournaments.rs,
// TOURNAMENT_TITLE_MAX_BYTES: only the length in bytes is checked), so any player can write one: 58 letters, one
// emoji, two letters (64 bytes). The digest prints an open tournament's title cut to 60 units and a slot's to 40, and
// every agent of every install reads the same open tournaments and slots. The plan request then holds a lone
// surrogate. JSON.stringify writes it as a bare \ud83e escape, which Anthropic's API refuses whole ("The request
// body is not valid JSON: no low surrogate in string", HTTP 400): no plan, no /ask and no manager answer for as long
// as that tournament is listed. Nothing is signed and no cap is passed, but one player stops every agent from planning.
// The same cut is made on each recent activity line (300 units), there by chance (ATK-4d).
// Right behaviour: whatever a rival writes, the text sent to the model is well-formed Unicode.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setup, snapshot, tournament } from '../fixtures.ts'
import { budgetView } from '../../src/executor/budget.ts'
import { renderDigest, txt } from '../../src/snapshot/digest.ts'
import { DEFAULT_SETTINGS } from '../../src/store/settings.ts'
import { renderChatRequest, renderPlanRequest } from '../../src/strategist/strategist.ts'

/** A lone surrogate as JSON.stringify writes it: a \ud8xx escape not followed by its low half, or a low half alone. */
const LONE_ESCAPE = /\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f][0-9a-f]{2})|(?<!\\ud[89ab][0-9a-f]{2})\\ud[c-f][0-9a-f]{2}/i

/** A title FoxLeague accepts (100 bytes at most, any characters) with one emoji across the cut at `max` units. */
const titleFor = (max: number) => `${'A'.repeat(max - 2)}\u{1F98A}xx`

const request = (s: ReturnType<typeof snapshot>, recent: unknown[] = []) => {
  const { store } = setup()
  return renderPlanRequest({ snapshot: s, settings: DEFAULT_SETTINGS, budget: budgetView(store, 0, DEFAULT_SETTINGS, true, new Date()), recent: recent as never, dryRun: true })
}

test('ATK-4a an open tournament whose title holds an emoji across the cut leaves the plan request well-formed', () => {
  const title = titleFor(60)
  assert.ok(Buffer.byteLength(title) <= 100, `FoxLeague takes this title: ${Buffer.byteLength(title)} bytes`)
  const s = snapshot()
  s.market.openStandard = [(tournament(7001, { title, creator_user_id: 900 }) as { tournament: never }).tournament]
  const text = request(s)
  assert.match(text, /T7001 "A{58}/, 'the rival tournament is in the request')
  assert.equal(text.isWellFormed(), true, 'the plan request holds a lone surrogate (half an emoji) from the rival title')
  assert.doesNotMatch(JSON.stringify({ messages: [{ role: 'user', content: text }] }), LONE_ESCAPE, 'the request body as the SDK writes it carries a lone \\ud83e escape, which the API refuses as invalid JSON')
})

test('ATK-4b the same in the time slots every agent reads (cut at 40) and in the digest the manager chat and /ask send', () => {
  const s = snapshot()
  const start = Date.now() + 5 * 3600_000
  s.market.slots = [{ id: 7002, title: titleFor(40), start, end: start + 3 * 3600_000 }] as never
  const digest = renderDigest(s)
  assert.match(digest, /T7002 "A{38}/)
  assert.equal(digest.isWellFormed(), true, 'the digest holds a lone surrogate from a slot title')
  const chat = renderChatRequest({ message: 'how are we doing?', source: 'Telegram', defaultAgents: [0], agents: [{ index: 0, team: 'Agent', strategy: 'x', paused: false }], recent: [], digests: [{ index: 0, digest }] })
  assert.equal(chat.isWellFormed(), true, 'the manager chat request holds it too')
})

test('ATK-4c txt() never returns half a character, at any cut', () => {
  const bad: number[] = []
  for (let max = 5; max <= 60; max++) if (!txt(titleFor(max), max).isWellFormed()) bad.push(max)
  assert.deepEqual(bad, [], `txt(value, max) returned a lone surrogate for these max values: ${bad.join(', ')}`)
})

test('ATK-4d an activity line read back from the database with an emoji across its 300-unit cut leaves the request well-formed', () => {
  // The database itself stores no half character (a lone surrogate is written as U+FFFD), so this is the cut that
  // renderPlanRequest makes on each recent line: an older plan whose summary, as the model wrote it, holds an emoji
  // at units 298 and 299 (it quoted a title, or wrote one itself). By chance, not at a rival's will.
  const { store } = setup()
  store.log({ agentIndex: 0, kind: 'plan', status: 'info', summary: `Agent 1 plan: ${'b'.repeat(284)}\u{1F98A} then wait for the 1v1` })
  store.log({ agentIndex: 0, kind: 'plan', status: 'info', summary: 'Agent 1 plan: the newest one' })
  const recent = store.planHistory(0, 20)
  assert.equal(recent.every(r => r.summary.isWellFormed()), true, 'the rows come back well-formed')
  const text = renderPlanRequest({ snapshot: snapshot(), settings: DEFAULT_SETTINGS, budget: budgetView(store, 0, DEFAULT_SETTINGS, true, new Date()), recent, dryRun: true })
  assert.equal(text.isWellFormed(), true, 'the request holds a lone surrogate from the cut of an older activity line: every plan of this agent fails until that row leaves its last 20')
})

// Added by the fix (same finding, the other cuts the brief names): the Telegram chunks and the request as it leaves.

test('ATK-4e a long Telegram message is cut into chunks on whole characters, each one well-formed', async () => {
  const { split, forTelegram } = await import('../../src/telegram/telegram.ts')
  // No line break near the 4,000-unit cut, an emoji across it: two chunks with half a character each before the fix.
  const text = `${'a'.repeat(3999)}\u{1F98A}${'b'.repeat(500)}`
  const chunks = split(forTelegram(text))
  assert.ok(chunks.length >= 2, 'it is more than one message')
  assert.deepEqual(chunks.map(c => c.isWellFormed()), chunks.map(() => true), 'a chunk holds half an emoji: Telegram refuses it and the 4xx drops it for good')
  assert.equal(chunks.join(''), text, 'nothing of the message is lost')
  // A lone half that came in from elsewhere (a server's message) is made a replacement character, not sent as is.
  assert.equal(forTelegram('x\ud83e y').isWellFormed(), true)
})

test('ATK-4f the request is made well-formed where it leaves for the model, whatever text reached it', async () => {
  const { Strategist } = await import('../../src/strategist/strategist.ts')
  const s = new Strategist('test-key', 'claude-sonnet-5', 'medium')
  const bodies: string[] = []
  ;(s as unknown as { client: unknown }).client = {
    beta: { messages: { stream: (p: unknown) => ({ finalMessage: async () => (bodies.push(JSON.stringify(p)), { model: 'claude-sonnet-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 0, output_tokens: 0, iterations: null } }) }) } },
  }
  // A text cut somewhere this audit did not look at, with half an emoji in it.
  await s.planFromRequest(`## Recent activity\n- a line cut at the wrong unit \ud83e\n`)
  await s.discuss({ message: 'how are we doing? \ud83e', source: 'Telegram', defaultAgents: [0], agents: [{ index: 0, team: 'Agent', strategy: 'x', paused: false }], recent: [{ from: 'manager', text: 'half \udd8a' }], digests: [] })
  assert.equal(bodies.length, 2)
  for (const body of bodies) assert.doesNotMatch(body, LONE_ESCAPE, 'the body sent to the API carries a lone surrogate escape, which the API refuses as invalid JSON')
})
