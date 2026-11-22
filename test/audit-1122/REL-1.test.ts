// REL-1 (pre-release audit 2026-11-22, RELEASE): an update's `install.sh --prepare` rewrote .node-path to one line and
// dropped the second line INS-A6 added for exactly this case. stage() runs the prepare with childEnv(), whose PATH
// starts with the folder of the running Node.js (src/update/install.ts), so ensure_node found the program itself:
// `real` equalled NODE and the else branch wrote one line. The path the owner's shell found Node.js at (Homebrew's
// link, the node snap) was gone. After a later `brew upgrade` the launcher answered "Node.js was not found; run
// ./install.sh again" five times and the agent stayed down without a word. Without the update in between, the same
// upgrade is survived (the control).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, linkSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO } from '../update-fixtures.ts'
import { LOGIN_LINES, answers, realTree, sh, stubs, systemTools, tmp } from '../audit-1111/install-helpers.ts'

/** A Homebrew-style versioned folder holding the program itself (a hard link, or a copy) and the stand-in npm. */
function cellar(npm: string, name: string): string {
  const bin = join(tmp('fox-cellar-'), 'Cellar', 'node@22', name, 'bin')
  mkdirSync(bin, { recursive: true })
  try {
    linkSync(process.execPath, join(bin, 'node'))
  } catch {
    copyFileSync(process.execPath, join(bin, 'node'))
  }
  cpSync(npm, join(bin, 'npm'))
  return bin
}

for (const withUpdate of [false, true]) {
  test(`REL-1 a Homebrew-style Node.js: the launcher starts after brew upgrade, ${withUpdate ? 'after a one-click update prepared a release' : 'with no update in between (control)'}`, { timeout: 240_000 }, async () => {
    const s = stubs({ node: false })
    const tools = systemTools()
    const a22 = cellar(join(s.dir, 'npm'), '22.20.0')
    const brew = join(tmp('fox-brew-'), 'bin')
    mkdirSync(brew, { recursive: true })
    symlinkSync(join(a22, 'node'), join(brew, 'node'))
    symlinkSync(join(a22, 'npm'), join(brew, 'npm'))
    const home = tmp('fox-home-')
    const root = join(home, 'foxleague-agent')
    const code = realTree(join(root, 'versions', 'v3.1.0'), '3.1.0')
    symlinkSync(join(REPO, 'node_modules'), join(code, 'node_modules'))
    writeFileSync(join(root, 'versions', 'active'), 'v3.1.0\n')
    writeFileSync(join(root, '.env'), LOGIN_LINES, { mode: 0o600 })
    mkdirSync(join(root, 'data'), { recursive: true })
    writeFileSync(join(root, 'data', 'words-confirmed'), 'yes\n')
    const a = answers(['', withUpdate ? '18995' : '18996', 'n', 'n'])
    let r
    try {
      r = await sh(join(code, 'install.sh'), ['--no-service'], { HOME: home, USER: 'tester', PATH: `${brew}:${s.dir}:${tools}`, FOXAGENT_ROOT: root, FOXAGENT_TTY: a.tty }, { timeoutMs: 60_000 })
    } finally {
      a.close()
    }
    assert.equal(r.status, 0, r.out)
    assert.deepEqual(readFileSync(join(root, '.node-path'), 'utf8').trim().split('\n'), [join(a22, 'node'), join(brew, 'node')], 'the installer wrote the program and the link (INS-A6)')

    if (withUpdate) {
      // The update from the dashboard: the agent runs on the Node.js of .node-path's first line, and stage() runs the
      // new release's install.sh --prepare with childEnv(root) of that process.
      const staging = realTree(join(root, 'versions', '.staging-v3.2.0'), '3.2.0')
      const env = spawnSync(join(a22, 'node'), ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', `import { childEnv } from ${JSON.stringify(join(REPO, 'src/update/install.ts'))}; process.stdout.write(JSON.stringify(childEnv(process.argv[1], { HOME: process.env.HOME, PATH: process.env.PATH })))`, root], { env: { HOME: home, PATH: tools }, encoding: 'utf8' })
      assert.equal(env.status, 0, env.stderr)
      const child = JSON.parse(env.stdout) as Record<string, string>
      assert.equal(child.PATH!.split(':')[0], a22, 'the prepare runs with the running Node.js first on its PATH')
      const p = spawnSync('bash', [join(staging, 'install.sh'), '--prepare'], { cwd: staging, env: child, encoding: 'utf8' })
      assert.equal(p.status, 0, p.stdout + p.stderr)
      assert.deepEqual(readFileSync(join(root, '.node-path'), 'utf8').trim().split('\n'), [join(a22, 'node'), join(brew, 'node')], 'the prepare must keep a .node-path whose first path is there and good')
    }

    // brew upgrade node@22: a new versioned folder, the link moves to it, the old folder goes.
    const b22 = cellar(join(s.dir, 'npm'), '22.21.1')
    unlinkSync(join(brew, 'node'))
    symlinkSync(join(b22, 'node'), join(brew, 'node'))
    rmSync(join(a22, '..'), { recursive: true, force: true })
    writeFileSync(join(code, 'src', 'service.ts'), 'console.log("the agent started")\n')
    const start = spawnSync('bash', [join(root, 'run.sh')], { env: { HOME: home, PATH: tools }, encoding: 'utf8', timeout: 30_000 })
    assert.equal(start.status, 0, `the launcher: ${start.stderr.trim()} (.node-path says ${JSON.stringify(readFileSync(join(root, '.node-path'), 'utf8'))})`)
    assert.match(start.stdout, /the agent started/)
  })
}

test('REL-1 the prepare still writes .node-path when its first path is gone or fails the Node.js rule (coverage of the fix\'s limits: right before the fix too)', { timeout: 120_000 }, () => {
  const s = stubs({ node: false })
  const tools = systemTools()
  const a22 = cellar(join(s.dir, 'npm'), '22.20.0')
  const home = tmp('fox-home-')
  const root = join(home, 'foxleague-agent')
  const staging = realTree(join(root, 'versions', '.staging-v3.2.0'), '3.2.0')
  for (const first of [join(home, 'gone', 'node'), '']) {
    // A first path that is gone, then an empty file: the running Node.js is written.
    writeFileSync(join(root, '.node-path'), first ? `${first}\n` : '')
    const p = spawnSync('bash', [join(staging, 'install.sh'), '--prepare'], { cwd: staging, env: { HOME: home, PATH: `${a22}:${tools}`, FOXAGENT_ROOT: root }, encoding: 'utf8' })
    assert.equal(p.status, 0, p.stdout + p.stderr)
    assert.equal(readFileSync(join(root, '.node-path'), 'utf8').trim(), join(a22, 'node'))
  }
  // A first path that is there but too old for the release (a stand-in that fails the rule): written again.
  const old = join(tmp('fox-old-'), 'node')
  writeFileSync(old, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
  writeFileSync(join(root, '.node-path'), `${old}\n`)
  const p = spawnSync('bash', [join(staging, 'install.sh'), '--prepare'], { cwd: staging, env: { HOME: home, PATH: `${a22}:${tools}`, FOXAGENT_ROOT: root }, encoding: 'utf8' })
  assert.equal(p.status, 0, p.stdout + p.stderr)
  assert.equal(readFileSync(join(root, '.node-path'), 'utf8').trim(), join(a22, 'node'))
})
