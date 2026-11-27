// What TMP-1 and R101A share: a parent folder for the run folder of the launcher of `npm test`, the fixture's probe
// file and a run of the launcher on the fixture.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export const REPO = join(import.meta.dirname, '../../..')
export const RUNNER = join(REPO, 'scripts/run-tests.ts')
export const FIXTURE = join(REPO, 'test/fix-1127/fixtures/makes-folders.ts')

/** A parent folder the launcher makes its run folder in, the fixture's probe file and the environment of the run. */
export function place(extra: Record<string, string> = {}) {
  const parent = mkdtempSync(join(tmpdir(), 'tmp1-parent-'))
  const probe = join(mkdtempSync(join(tmpdir(), 'tmp1-probe-')), 'tmpdir')
  // The launcher here is a run of its own, not a child of this one (NODE_TEST_CONTEXT would make it answer as a child).
  const env: NodeJS.ProcessEnv = { ...process.env, TMPDIR: parent, TMP1_PROBE: probe, ...extra }
  delete env.NODE_TEST_CONTEXT
  const clean = () => {
    spawnSync('chmod', ['-R', 'u+rwX', parent])
    rmSync(parent, { recursive: true, force: true })
    rmSync(dirname(probe), { recursive: true, force: true })
  }
  return { parent, probe, env, clean }
}

/** The launcher run to its end on `args` (the fixture by default). */
export function run(extra: Record<string, string> = {}, args: string[] = [FIXTURE]) {
  const p = place(extra)
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', RUNNER, ...args], { cwd: REPO, env: p.env, encoding: 'utf8', timeout: 60_000 })
  return { ...p, status: r.status, output: `${r.stdout}${r.stderr}` }
}

/** What the fixture wrote once its folders were made: its os.tmpdir() and its process id; undefined before. */
export function probed(probe: string): { tmp: string; pid: number } | undefined {
  try {
    const [tmp, pid] = readFileSync(probe, 'utf8').split('\n')
    return tmp && Number(pid) > 0 ? { tmp, pid: Number(pid) } : undefined
  } catch {
    return undefined
  }
}
