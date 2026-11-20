// W-8 (Windows real-PC check of 2026-11-13, to check first): on a fresh install without an AI key the Strategist box
// showed no model and "effort medium", while the level said "Recommended AI for this level: Opus 5.5 at high effort,
// once the AI key is set". The empty model is meant (the strategist is off), but the effort was the page's own
// fallback ('medium' whatever was saved), half of a pair nobody chose. And nothing said which pair the agents start
// on once the key is set (on a fresh install Sonnet 5.5 at medium, AGENT_MODEL's default, not the recommended one).
// Safe: while the strategist is off the box shows that pair (the server's aiAll), both greyed out, and the level's
// line says the agents play it once the key is set. Both tests failed before the fix.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO } from '../update-fixtures.ts'

const SONNET = 'claude-sonnet-5-5'
const OPUS = 'claude-opus-5-5'
const html = readFileSync(join(REPO, 'src/web/dashboard.html'), 'utf8')
const fn = (name: string): string => {
  const found = html.match(new RegExp(`\\nfunction ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0]
  assert.ok(found, `the dashboard defines ${name}()`)
  return found
}
const models = [{ id: OPUS, label: 'Opus 5.5' }, { id: SONNET, label: 'Sonnet 5.5' }]

test('W-8 with no AI key the Strategist box shows the pair the agents start on once the key is set, never an effort nobody chose', () => {
  const header = fn('renderHeader')
  assert.doesNotMatch(header, /i\.effort \|\| 'medium'/, 'no effort of the page\'s own')
  assert.match(header, /const shown = stratShown\(i\)/)
  assert.match(header, /sm\.value = shown\.model; se\.value = shown\.effort/)
  const stratShown = new Function(`${fn('stratShown')}; return stratShown`)() as (i: unknown) => { model: string; effort: string }
  // Off: the pair saved for when there is a key, whatever it is.
  assert.deepEqual(stratShown({ model: null, effort: null, aiAll: { model: SONNET, effort: 'high' } }), { model: SONNET, effort: 'high' })
  assert.deepEqual(stratShown({ model: null, effort: null, aiAll: { model: OPUS, effort: 'low' } }), { model: OPUS, effort: 'low' })
  // On: the strategist's own, as before.
  assert.deepEqual(stratShown({ model: OPUS, effort: 'xhigh', aiAll: { model: OPUS, effort: 'xhigh' } }), { model: OPUS, effort: 'xhigh' })
  // A page of an older server sends no aiAll: nothing is shown as picked.
  assert.deepEqual(stratShown({ model: null, effort: null }), { model: '', effort: '' })
  // Off, the two stay greyed out: nothing can be applied without a strategist.
  assert.match(header, /sm\.disabled = se\.disabled = !i\.model/)
})

test("W-8 with no AI key the level's line says which pair the agents play once the key is set", () => {
  const run = (aiAll: unknown): string => {
    const said: string[] = []
    const box = { hidden: false, replaceChildren: () => undefined, append: (...a: unknown[]) => void said.push(...a.map(String)) }
    const S = { instance: { model: null, effort: null, aiAll, models, levelAi: { zeus: { model: OPUS, effort: 'high' } } } }
    const render = new Function('S', '$', 'agent', 'el', `${fn('renderAiHint')}; return renderAiHint`)(S, () => box, () => null, () => null) as (k: string) => void
    render('zeus')
    return said.join('')
  }
  assert.equal(run({ model: SONNET, effort: 'medium' }), 'Recommended AI for this level: Opus 5.5 at high effort. Once the AI key is set the agents play Sonnet 5.5 at medium effort (the Strategist box) until you switch there.')
  assert.equal(run({ model: OPUS, effort: 'high' }), 'Recommended AI for this level: Opus 5.5 at high effort. The agents play it once the AI key is set.')
  assert.equal(run(undefined), 'Recommended AI for this level: Opus 5.5 at high effort, once the AI key is set.')
})

test('W-8 the Strategist bubble and the Dashboard page say what the box shows without the AI key', () => {
  assert.match(html, /<p>Without the AI key the box is greyed out: it shows the model and effort the agents start on once the key is set\. You can change them from then on\.<\/p>/)
  const page = readFileSync(join(REPO, 'site/src/content/docs/use/dashboard.md'), 'utf8').replace(/\s+/g, ' ')
  assert.match(page, /Without the AI key the box is greyed out: it shows the model and effort the agents start on once the key is set \(Haiku 5\.5 at high on a new install\)/)
})
