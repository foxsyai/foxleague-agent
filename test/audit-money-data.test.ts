// Audit of 2026-10-23 (money and data): one test per finding, each seen failing on the unchanged code first.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// ---- E2: the formations test does not depend on the calendar ----

test('E2: test/formations.test.ts still passes with the clock at 2026-11-10', () => {
  const clock = `const R = Date; const S = new R('2026-11-10T12:00:00Z').getTime() - R.now();
globalThis.Date = class extends R { constructor(...a) { if (a.length === 0) super(R.now() + S); else super(...a) } static now() { return R.now() + S } }`
  const file = fileURLToPath(new URL('./formations.test.ts', import.meta.url))
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', `data:text/javascript,${encodeURIComponent(clock)}`, '--test', '--test-reporter=tap', file], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 120_000, env })
  const failed = (r.stdout + r.stderr).split('\n').filter(l => /^\s*not ok|^# fail/.test(l))
  assert.equal(r.status, 0, `exit ${r.status}\n${failed.join('\n')}`)
})
