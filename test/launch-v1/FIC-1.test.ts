// Review of PR #85 (medium, the release process): with the tree at 1.0.0 the fresh install check's first throwaway
// release, also 1.0.0, wrote package.json, package-lock.json and src/service.ts back unchanged, `git commit` had nothing
// to commit and the check stopped at its step 2 ("the release could not be built"). docs/WINDOWS-TEST.md's recipe uses
// the same tool. The tool is run here as the script writes it, without Docker.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REPO = join(import.meta.dirname, '..', '..')
const script = readFileSync(join(REPO, 'scripts/release/fresh-install-check.sh'), 'utf8')

test('FIC-1 the fresh install check builds its release 1.0.0 from a tree that is already at 1.0.0', () => {
  const m = /cat > "\$TOOLS\/mkrel\.ts" <<'EOF'\n([\s\S]*?)\nEOF\n/.exec(script)
  assert.ok(m, 'the script writes mkrel.ts from a heredoc')
  const dir = mkdtempSync(join(tmpdir(), 'fic1-'))
  try {
    const tool = join(dir, 'mkrel.ts')
    writeFileSync(tool, m[1]! + '\n')
    const work = join(dir, 'rel')
    const run = (...args: string[]) => execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', tool, ...args], { env: { ...process.env, FOX_REPO: REPO }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    assert.equal(JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version, '1.0.0', 'the case of the launch: the tree is at the version the check builds first')
    run('init', work)
    run('release', work, '1.0.0', '--notes', 'The first release.')
    assert.ok(existsSync(join(work, 'site', 'latest', 'download', 'release.json')), 'the release is served')
    assert.equal(JSON.parse(readFileSync(join(work, 'site', 'latest', 'download', 'release.json'), 'utf8')).version, '1.0.0')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
