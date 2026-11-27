// R101A-1 to R101A-3 (low, the agent review of PR #101), all in the launcher of `npm test` (scripts/run-tests.ts):
// 1. It ran only when import.meta.main said it was the main module. On a Node without import.meta.main (23.x from 23.6,
//    24.0 and 24.1) `npm test` then ran nothing and still exited 0. The launcher is now two files: run-tests.ts always
//    runs and test-runner.ts holds what the tests import.
// 2. An option written with a space before its value (`--test-name-pattern BUSY1`) was split from its value: with a
//    file named after it the file became the pattern; with no file Node's own search replaced test/**/*.test.ts. A
//    value now stays with its option unless it names a test file, folder or glob.
// 3. A SIGTERM or SIGHUP sent to the launcher alone was swallowed, so the run went on to its end. It is passed on now:
//    SIGINT and SIGTERM as they are, a hangup as SIGTERM (node --test leaves its test files running on SIGHUP).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { DEFAULT_TESTS, testArgs } from '../../scripts/test-runner.ts'
import { FIXTURE, REPO, RUNNER, place, probed, run } from './fixtures/launch.ts'

/** True once no process has this id (polled for up to 3 s). */
async function gone(pid: number): Promise<boolean> {
  for (let i = 0; i < 30; i++) {
    try {
      process.kill(pid, 0)
    } catch {
      return true
    }
    await sleep(100)
  }
  return false
}

test('R101A-1 the launcher started some other way than as the main module still runs the tests (a Node without import.meta.main)', (t) => {
  const p = place({ TMP1_FAIL: '1' })
  t.after(p.clean)
  // Imported, import.meta.main is false: what a Node without it gave (undefined) on every start.
  const code = `await import(${JSON.stringify(pathToFileURL(RUNNER).href)})`
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', code, 'node-e', FIXTURE], { cwd: REPO, env: p.env, encoding: 'utf8', timeout: 60_000 })
  assert.ok(probed(p.probe), `the fixture ran: ${r.stdout}${r.stderr}`)
  assert.notEqual(r.status, 0, 'its failure is the exit status')
  assert.deepEqual(readdirSync(p.parent), [])
})

test('R101A-2 an option with a space before its value keeps it: after a file, before another option and with no file at all', (t) => {
  // A file named first: before, the file became the pattern and no test ran.
  const r = run({}, [FIXTURE, '--test-name-pattern', 'makes folders'])
  t.after(r.clean)
  assert.equal(r.status, 0, r.output)
  assert.ok(probed(r.probe), 'the fixture\'s test ran')
  const base = ['--disable-warning=ExperimentalWarning', '--test']
  assert.deepEqual(testArgs(['--test-name-pattern', 'BUSY1']), [...base, '--test-name-pattern', 'BUSY1', DEFAULT_TESTS], 'no file: every test')
  assert.deepEqual(testArgs(['--test-name-pattern', 'BUSY1', '--test-only', 'test/a.test.ts']), [...base, '--test-name-pattern', 'BUSY1', '--test-only', 'test/a.test.ts'])
  assert.deepEqual(testArgs(['test/a.test.ts', '--test-concurrency', '1']), [...base, '--test-concurrency', '1', 'test/a.test.ts'])
  // An option with no value before a file: the file stays a file.
  assert.deepEqual(testArgs(['--test-only', 'test/a.test.ts']), [...base, '--test-only', 'test/a.test.ts'])
  assert.deepEqual(testArgs(['--test-only', 'test/**/*.test.ts']), [...base, '--test-only', 'test/**/*.test.ts'])
})

for (const signal of ['SIGTERM', 'SIGHUP'] as const) {
  test(`R101A-3 ${signal} sent to the launcher alone ends the run, its test file and its folder`, async (t) => {
    const p = place({ TMP1_HANG: '1' })
    // Its own process group, so whatever is left can be ended after the test; the signal goes to the launcher only.
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', RUNNER, FIXTURE], { cwd: REPO, env: p.env, detached: true, stdio: 'ignore' })
    t.after(() => {
      try {
        process.kill(-child.pid!, 'SIGKILL')
      } catch {
        // nothing left
      }
      p.clean()
    })
    const exited = new Promise<number | null>((done) => child.on('exit', (code) => done(code)))
    for (let i = 0; i < 300 && !probed(p.probe); i++) await sleep(100)
    const seen = probed(p.probe)
    assert.ok(seen, 'the fixture started and made its folders')
    child.kill(signal)
    const code = await Promise.race([exited, sleep(15_000).then(() => 'still running' as const)])
    assert.notEqual(code, 'still running', 'the run went on')
    assert.notEqual(code, 0)
    assert.deepEqual(readdirSync(p.parent), [])
    assert.ok(await gone(seen.pid), 'the test file ended too')
  })
}
