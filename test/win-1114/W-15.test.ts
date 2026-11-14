// W-15 (Windows real-PC re-test of 2026-11-14, medium for the owner's view): after a one-click update that FAILED,
// the dashboard kept "Installing version 1.0.2. The agent restarts in a minute or two and this page comes back by
// itself." for up to 20 minutes and hid the failure and what to do. The page's own `updating` (set by the click) was
// cleared only when the new version ran or after 20 minutes; the agent had been idle with the failure for 4 min
// 45 s, and only a reload showed it. The record is the section "Windows real-PC re-test (2026-11-14)" of
// docs/SECURITY-REVIEW.md. The test failed before the fix.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { updatePage } from './helpers.ts'

const V102 = { version: '1.0.2', notes: 'Medicine for injured cards.', published: '2026-11-14T13:40:00Z' }
// The message of the PC (src/update/updater.ts and install.ts), as the agent gave it 4 min 45 s before the photo.
const FAILED = 'The update to 1.0.2 was not installed: this system\'s tar cannot unpack inside the agent\'s background service as an older installer set it up (tar: .github/scripts: Cannot mkdir: Function not implemented). Run ./install.sh --update once in a terminal, in the agent\'s folder: that installs it and renews the service, so later updates are one click again. You run 1.0.1 as before.'
const UNDONE = 'The update to 1.0.2 did not start and was undone: you run 1.0.1 as before. Your wallet, settings and history are untouched. It is safe to try again later.'
const later = (ms: number): string => new Date(Date.now() + ms).toISOString()

test('W-15 after a one-click update fails, the notice shows the failure as soon as the agent is idle again, and stays quiet while the agent is away restarting', async () => {
  const page = updatePage({ available: V102 }, { api: async () => ({ message: 'Installing 1.0.2. This takes a minute or two; the agent then restarts and tells you when it is back.' }) })
  assert.equal(page.label(), 'Update now')
  await page.startUpdate()
  assert.match(page.text(), /^Installing version 1\.0\.2\. The agent restarts in a minute or two and this page comes back by itself\.$/, 'right after the click')
  // While it installs, and while the agent is away (no answer comes, the page renders what it has): Installing.
  page.set({ state: 'downloading' })
  page.set({ state: 'preparing' })
  page.render()
  assert.match(page.text(), /^Installing version 1\.0\.2\./)
  // The agent is idle again with this attempt's failure for 1.0.2: the page says so at once.
  page.set({ state: 'idle', last: { kind: 'failed', version: '1.0.2', at: later(1000), message: FAILED } })
  assert.ok(page.text().startsWith(FAILED), page.text())
  assert.doesNotMatch(page.text(), /Installing/)
  assert.match(page.tone(), /\bbad\b/)
  assert.ok(!page.toasts.some(([m]) => /^Updated to version/.test(m)), 'no "updated" toast for a failure')
})

test('W-15 an update that started and was undone is shown as soon as the old version is back, with Try again', async () => {
  const page = updatePage({ available: V102 })
  await page.startUpdate()
  page.set({ state: 'restarting' })
  assert.match(page.text(), /^Installing version 1\.0\.2\./)
  // The launcher went back to 1.0.1, which tells how it went.
  page.set({ state: 'idle', last: { kind: 'undone', version: '1.0.2', at: later(1000), message: UNDONE } })
  assert.ok(page.text().startsWith(UNDONE), page.text())
  assert.match(page.text(), /Nothing has to be done: the agent keeps running 1\.0\.1\./)
  assert.equal(page.label(), 'Try again')
})

test('W-15 a result that was there before the click is not this attempt\'s: the page keeps saying Installing', async () => {
  // The same version failed once before; the owner presses the button again. An idle answer that still holds that
  // earlier result (the old version starting again after an undo, before it tells the new one) is not the answer.
  const before = { kind: 'failed' as const, version: '1.0.2', at: new Date(Date.now() - 60_000).toISOString(), message: FAILED.replace('Function not implemented', 'No space left on device') }
  const page = updatePage({ available: V102, last: before })
  await page.startUpdate()
  page.set({ state: 'idle' })
  assert.match(page.text(), /^Installing version 1\.0\.2\./)
  // Another version's result is not this attempt's either.
  page.set({ last: { kind: 'failed', version: '1.0.9', at: later(1000), message: 'The update to 1.0.9 was not installed: x. You run 1.0.1 as before.' } })
  assert.match(page.text(), /^Installing version 1\.0\.2\./)
  // This attempt's own result ends it.
  page.set({ last: { kind: 'failed', version: '1.0.2', at: later(2000), message: FAILED } })
  assert.ok(page.text().startsWith(FAILED), page.text())
  // And the new version that runs ends it as before, with its toast.
  const ok = updatePage({ available: V102 })
  await ok.startUpdate()
  ok.set({ installed: '1.0.2', available: null, state: 'idle' })
  assert.ok(ok.toasts.some(([m]) => m === 'Updated to version 1.0.2'))
})
