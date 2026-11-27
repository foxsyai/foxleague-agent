// TMP-1 (27 Nov 2026): the tests make throwaway folders (homes, releases, stubs, installs) in os.tmpdir() and most
// never remove them, so every `npm test` left hundreds behind in the system temp folder. On the maintainer's laptop
// repeated runs piled up about 313,000 of them in /tmp; the clean of /tmp at boot held up the start for 11 min 43 s.
// `npm test` now runs node --test through scripts/run-tests.ts: one temp folder per run (TMPDIR, TMP and TEMP point at
// it), removed when the run passes, fails or is stopped with Ctrl-C.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { DEFAULT_TESTS, testArgs } from '../../scripts/test-runner.ts'
import { FIXTURE, REPO, RUNNER, place, run } from './fixtures/launch.ts'

test('TMP1-1 npm test goes through scripts/run-tests.ts and the type check reads it', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
  assert.equal(pkg.scripts.test, 'node --disable-warning=ExperimentalWarning scripts/run-tests.ts')
  const ts = JSON.parse(readFileSync(join(REPO, 'tsconfig.json'), 'utf8')) as { include: string[] }
  assert.ok(ts.include.includes('scripts/run-tests.ts'), ts.include.join(', '))
})

test('TMP1-2 a passing run: the folders a test leaves in os.tmpdir() sit in the run\'s own folder, which is gone afterwards', (t) => {
  const r = run()
  t.after(r.clean)
  assert.equal(r.status, 0, r.output)
  assert.ok(readFileSync(r.probe, 'utf8').startsWith(join(r.parent, 'foxagent-tests-')), 'the test\'s os.tmpdir() is the run\'s folder')
  assert.deepEqual(readdirSync(r.parent), [], 'nothing left, the read-only folder included')
})

test('TMP1-3 a failing run: the folder is gone too and the runner exits with the failure', (t) => {
  const r = run({ TMP1_FAIL: '1' })
  t.after(r.clean)
  assert.notEqual(r.status, 0, r.output)
  assert.ok(existsSync(r.probe), 'the fixture ran')
  assert.deepEqual(readdirSync(r.parent), [])
})

test('TMP1-4 Ctrl-C during a run: the runner still removes the folder', async (t) => {
  const p = place({ TMP1_HANG: '1' })
  t.after(p.clean)
  // Its own process group, as a terminal makes one: Ctrl-C reaches the runner, node --test and the test file.
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', RUNNER, FIXTURE], { cwd: REPO, env: p.env, detached: true, stdio: 'ignore' })
  const exited = new Promise<number | null>((done) => child.on('exit', (code) => done(code)))
  for (let i = 0; i < 300 && !existsSync(p.probe); i++) await sleep(100)
  assert.ok(existsSync(p.probe), 'the fixture started and made its folders')
  process.kill(-child.pid!, 'SIGINT')
  const code = await Promise.race([exited, sleep(30_000).then(() => 'still running')])
  assert.notEqual(code, 'still running')
  assert.notEqual(code, 0)
  assert.deepEqual(readdirSync(p.parent), [])
})

test('TMP1-5 files and options pass through; with options only the whole suite still runs', () => {
  const base = ['--disable-warning=ExperimentalWarning', '--test']
  assert.equal(DEFAULT_TESTS, 'test/**/*.test.ts')
  assert.deepEqual(testArgs([]), [...base, DEFAULT_TESTS])
  assert.deepEqual(testArgs(['test/a.test.ts', 'test/b.test.ts']), [...base, 'test/a.test.ts', 'test/b.test.ts'])
  assert.deepEqual(testArgs(['--test-name-pattern=BUSY1']), [...base, '--test-name-pattern=BUSY1', DEFAULT_TESTS])
  assert.deepEqual(testArgs(['test/a.test.ts', '--test-only']), [...base, '--test-only', 'test/a.test.ts'])
})
