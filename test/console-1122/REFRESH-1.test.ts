// REFRESH-1: the owner, 2026-11-22. Refresh on the Wallet and team panel gave no sign until the reading came back
// (a few seconds: the chain and FoxLeague are read again), so it was not clear whether the press was taken. The button
// is greyed out and reads "Refreshing…" until the new reading is on the page, then it can be pressed again.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const html = readFileSync(join(import.meta.dirname, '..', '..', 'src/web/dashboard.html'), 'utf8')

/** The page's own handler and its per-agent state, run with a fake page: what the button shows while the refresh runs. */
async function press(answer: () => Promise<unknown>) {
  const src = html.match(/\nconst refreshing = new Set\(\)\n[\s\S]*?\n\$\('refreshBtn'\)\.onclick = async \(\) => \{[\s\S]*?\n\}\n/)?.[0]
  assert.ok(src, 'the Refresh handler and its state are in the dashboard')
  const btn = { disabled: false, textContent: 'Refresh', onclick: null as null | (() => Promise<void>) }
  const seen: string[] = []
  const $ = () => btn
  const act = async (_label: string, fn: () => Promise<unknown>) => {
    seen.push(`during: ${btn.disabled} ${btn.textContent}`)
    try { await fn() } catch { return false }
    seen.push(`after the reading: ${btn.disabled} ${btn.textContent}`) // act reloads the state before it returns
    return true
  }
  const api = () => answer()
  new Function('$', 'act', 'api', 'sel', src)($, act, api, 0)
  const first = btn.onclick!()
  const second = btn.onclick!() // a second press while it runs is ignored
  await Promise.all([first, second])
  return { seen, btn }
}

test('REFRESH-1 the Refresh button is greyed out and reads "Refreshing…" until the new reading is shown', async () => {
  const { seen, btn } = await press(async () => ({ ok: true }))
  assert.deepEqual(seen, ['during: true Refreshing…', 'after the reading: true Refreshing…'], 'one refresh, the button greyed out all along')
  assert.deepEqual([btn.disabled, btn.textContent], [false, 'Refresh'], 'pressable again once the reading is shown')
  // A refresh that fails gives the button back too.
  const failed = await press(async () => { throw new Error('FoxLeague did not answer') })
  assert.deepEqual([failed.btn.disabled, failed.btn.textContent], [false, 'Refresh'])
  // The info bubble says so.
  assert.match(html, /Refresh reads the chain and FoxLeague again now; the button stays greyed out until the new reading is shown\./)
})

test('R89A-4 the Refresh state belongs to the agent being read: another tab shows its own button, pressable', () => {
  const src = html.match(/\nconst refreshing = new Set\(\)\n[\s\S]*?\n\$\('refreshBtn'\)\.onclick = async \(\) => \{[\s\S]*?\n\}\n/)?.[0]
  assert.ok(src)
  const btn = { disabled: false, textContent: 'Refresh', onclick: null as null | (() => Promise<void>) }
  let release: () => void = () => undefined
  const page = { sel: 0 }
  const run = new Function('$', 'act', 'api', 'page', `let sel = 0; ${src.replace(/\bsel\b/g, 'page.sel')}; return renderRefresh`)
  const renderRefresh = run(() => btn, async (_l: string, fn: () => Promise<unknown>) => fn(), () => new Promise<void>(r => { release = r }), page) as () => void
  void btn.onclick!() // agent 1 is being read
  assert.deepEqual([btn.disabled, btn.textContent], [true, 'Refreshing…'])
  page.sel = 1; renderRefresh() // the owner opens agent 2
  assert.deepEqual([btn.disabled, btn.textContent], [false, 'Refresh'], 'agent 2 is not being read')
  page.sel = 0; renderRefresh()
  assert.deepEqual([btn.disabled, btn.textContent], [true, 'Refreshing…'], 'back on agent 1, still reading')
  release()
  // A tab switch draws the button for the agent it opens.
  assert.match(html, /function select\(i\) \{[^\n]*renderRefresh\(\)/)
})

test('R89A-5 the page\'s own act reloads the state before it returns, which "until the new reading is shown" rests on', () => {
  const act = html.match(/\nasync function act\(label, fn\) \{[\s\S]*?\n\}\n/)?.[0] ?? ''
  assert.ok(act.indexOf('await loadState()') > 0 && act.indexOf('await loadState()') < act.lastIndexOf('return true'), 'loadState is awaited before act returns')
})
