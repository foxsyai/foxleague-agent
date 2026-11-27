// `npm test`: runs the test suite inside a temporary folder of its own and removes that folder afterwards (TMP-1).
//
// The tests make throwaway folders (homes, releases, stubs, installs) through os.tmpdir() and most never remove them:
// every run left hundreds in the system temp folder. On the maintainer's laptop repeated runs piled up more than
// 300,000 of them in /tmp, and the clean of /tmp at boot then held up the start for almost 12 minutes (27 Nov 2026).
// TMPDIR, TMP and TEMP point at one folder per run, so every one of them (and the temp files of the shells the tests
// start) lands in a place that is removed in one go when the run passes, fails or is stopped with Ctrl-C.
//
//   npm test                                     every test (test/**/*.test.ts)
//   npm test -- test/update.test.ts              some files
//   npm test -- --test-name-pattern=BUSY1        options for node --test, as --name=value; with no file named, every test
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { constants, tmpdir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_TESTS = 'test/**/*.test.ts'

/** The arguments of node --test for the arguments given to `npm test --`: options first, then the files or every test. */
export function testArgs(given: string[]): string[] {
  const options = given.filter((a) => a.startsWith('-'))
  const files = given.filter((a) => !a.startsWith('-'))
  return ['--disable-warning=ExperimentalWarning', '--test', ...options, ...(files.length > 0 ? files : [DEFAULT_TESTS])]
}

/** Runs node --test in a temporary folder of its own, removes the folder and answers the exit status of the run. */
export function runTests(given: string[]): number {
  const root = mkdtempSync(join(tmpdir(), 'foxagent-tests-'))
  // Ctrl-C reaches node --test and the test files too: this process waits for them to end and still cleans up.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => {})
  const run = spawnSync(process.execPath, testArgs(given), { stdio: 'inherit', env: { ...process.env, TMPDIR: root, TMP: root, TEMP: root } })
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {
    // A test may leave a read-only folder behind: make everything writable, then remove it.
    spawnSync('chmod', ['-R', 'u+rwX', root])
    try {
      rmSync(root, { recursive: true, force: true })
    } catch (e) {
      console.error(`run-tests: could not remove ${root}: ${(e as Error).message}`)
    }
  }
  if (run.error) {
    console.error(`run-tests: ${run.error.message}`)
    return 1
  }
  // Stopped by a signal: the shell's usual status (130 for Ctrl-C).
  if (run.signal) return 128 + (constants.signals[run.signal] ?? 0)
  return run.status ?? 1
}

if (import.meta.main) process.exit(runTests(process.argv.slice(2)))
