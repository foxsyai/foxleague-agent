// What `npm test` runs (TMP-1): scripts/run-tests.ts starts it and the tests import it (R101A-1). See run-tests.ts for
// why the suite runs in a temporary folder of its own.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { constants, tmpdir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_TESTS = 'test/**/*.test.ts'

/** A test file, folder or glob, as against the value of an option. */
const namesTests = (a: string): boolean => a.includes('*') || a.includes('/') || a.includes('\\') || /\.[cm]?[jt]s$/.test(a) || existsSync(a)

/**
 * The arguments of node --test for the arguments given to `npm test --`: the options first, each with its value, then
 * the files or every test (Node reads no option after the first file). An option written with a space before its value
 * keeps it unless the value names a test file, folder or glob (R101A-2); a value that looks like a path goes as
 * --name=value.
 */
export function testArgs(given: string[]): string[] {
  const options: string[] = []
  const files: string[] = []
  for (let i = 0; i < given.length; i++) {
    const a = given[i]!
    if (!a.startsWith('-')) {
      files.push(a)
      continue
    }
    options.push(a)
    const next = given[i + 1]
    if (!a.includes('=') && next !== undefined && !next.startsWith('-') && !namesTests(next)) {
      options.push(next)
      i++
    }
  }
  return ['--disable-warning=ExperimentalWarning', '--test', ...options, ...(files.length > 0 ? files : [DEFAULT_TESTS])]
}

// node --test ends its test files on SIGINT and SIGTERM; on SIGHUP it dies and leaves them running.
const PASS_ON = { SIGINT: 'SIGINT', SIGTERM: 'SIGTERM', SIGHUP: 'SIGTERM' } as const

/** Runs node --test in a temporary folder of its own, removes the folder and answers the exit status of the run. */
export async function runTests(given: string[]): Promise<number> {
  const root = mkdtempSync(join(tmpdir(), 'foxagent-tests-'))
  const child = spawn(process.execPath, testArgs(given), { stdio: 'inherit', env: { ...process.env, TMPDIR: root, TMP: root, TEMP: root } })
  // A stop sent to this process alone is passed on, so the run ends and the folder can go (R101A-3). Ctrl-C at a
  // terminal reaches node --test as well; the second SIGINT changes nothing.
  for (const [signal, to] of Object.entries(PASS_ON)) process.on(signal, () => void child.kill(to))
  const end = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: Error }>((done) => {
    child.once('exit', (code, signal) => done({ code, signal }))
    // Only a failed start ends the wait here: an error after it (a signal not delivered) leaves the run going.
    child.on('error', (error) => {
      if (child.pid === undefined) done({ code: null, signal: null, error })
    })
  })
  remove(root)
  if (end.error) {
    console.error(`run-tests: ${end.error.message}`)
    return 1
  }
  // Stopped by a signal: the shell's usual status (130 for Ctrl-C).
  if (end.signal) return 128 + (constants.signals[end.signal] ?? 0)
  return end.code ?? 1
}

function remove(root: string): void {
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
}
