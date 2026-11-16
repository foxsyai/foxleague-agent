// Audit 2026-11-16, ATTACK reviewer. ATK-1: the daily check of FoxLeague's manual runs a regular expression with
// three nested runs over the page text FoxLeague's MCP server answers (liveBody in src/strategist/manual-watch.ts,
// line 107: /\n+Source: https:\/\/docs\.foxleague\.ai\/[^\n]*\s*$/). A page with n line breaks before a "Source:"
// line, n spaces after it and n more line breaks, not at the very end, costs about n^3 steps: 5 seconds for a page
// of 4.8 KB, hours for one of the size of the longest real page (60 KB), years under the 2 MB cap the check allows.
// The match is synchronous, so the whole service stands still meanwhile: no kill switch, no dashboard, no Telegram,
// no pending-payment confirm, no action before its deadline. Neither the 15 s request limit nor the 90 s deadline of
// the check can end it (both are timers of the same event loop).
// Right behaviour: a page far under the cap is compared in well under a second, whatever it holds.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const CHILD = new URL('./ATK-1.child.ts', import.meta.url).pathname
const LIMIT_MS = 15_000

test('ATK-1 a manual page of about 22 KB from FoxLeague\'s MCP server is compared without stopping the service', () => {
  // n = 3000: a page of about 9 KB of text (about 22 KB on the wire), 0.5 percent of MAX_ANSWER_BYTES.
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', CHILD, '3000'], { encoding: 'utf8', timeout: LIMIT_MS })
  const timedOut = r.signal !== null || (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT'
  assert.equal(timedOut, false, `the check of one 9 KB page did not end within ${LIMIT_MS / 1000} s: the process was still inside liveBody()'s regular expression and had to be killed (stderr: ${r.stderr.slice(0, 300)})`)
  assert.equal(r.status, 0, r.stderr)
  const out = JSON.parse(r.stdout.trim().split('\n').at(-1)!) as { state: string; ms: number; stallMs: number; pageBytes: number }
  assert.equal(out.state, 'behind', 'the page differs from the record, so the check says behind')
  assert.ok(out.stallMs < 1000, `the event loop stood still for ${out.stallMs} ms while a ${out.pageBytes}-byte page was compared`)
})

test('ATK-1b the cost grows with the cube of the page: 1,200 characters of each run already hold the event loop for seconds', () => {
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', CHILD, '1200'], { encoding: 'utf8', timeout: 60_000 })
  assert.equal(r.status, 0, r.stderr)
  const out = JSON.parse(r.stdout.trim().split('\n').at(-1)!) as { state: string; ms: number; stallMs: number; pageBytes: number }
  assert.ok(out.stallMs < 500, `comparing a ${out.pageBytes}-byte page held the event loop for ${out.stallMs} ms (kill switch, dashboard, Telegram and payment confirms wait meanwhile)`)
})
