// INS-A6: the installer takes "the Node.js on your computer" by the path the shell finds it at (`command -v node`)
// and writes that path into .node-path, which the launcher starts the agent with. Version managers put a path there
// that does not last: fnm's is a link in a folder made for the one shell
// (/run/user/<uid>/fnm_multishells/<pid>_<time>/bin/node on Linux, gone at the next restart of the computer), nvm's
// names the version (gone when that version is removed), asdf's is a shim that needs the shell's setup. The Node.js
// itself is still installed; only the remembered path is gone. The launcher then finds nothing (the private copy
// was never downloaded and a background service has no such PATH): "Node.js was not found; run ./install.sh again",
// five starts, and the agent stays down after a restart of the computer, without a word on Telegram.
// Safe: the launcher still starts the agent when the folder the shell found Node.js through is gone and the
// Node.js it pointed to is still there (the installer remembers the program itself, or brings its own copy).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, linkSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO } from '../update-fixtures.ts'
import { LOGIN_LINES, answers, realTree, sh, stubs, systemTools, tmp } from '../audit-1111/install-helpers.ts'

test('INS-A6: the agent still starts after the per-shell folder of a Node.js version manager is gone', { timeout: 240_000 }, async () => {
  const s = stubs({ node: false })
  const tools = systemTools() // the system's tools, without any Node.js
  // fnm's folder for this one shell: a link to the installed version, which has npm beside node.
  const installed = join(tmp('fox-fnm-'), 'node-versions', 'v22', 'installation', 'bin')
  mkdirSync(installed, { recursive: true })
  // The program itself (a hard link, or a copy on another disk), so that it knows itself by this path, with the
  // stand-in npm beside it: whichever path the installer remembers, no real npm ever runs in this test.
  try {
    linkSync(process.execPath, join(installed, 'node'))
  } catch {
    copyFileSync(process.execPath, join(installed, 'node'))
  }
  cpSync(join(s.dir, 'npm'), join(installed, 'npm'))
  const shell = join(tmp('fox-run-user-'), 'fnm_multishells', '4242_1763300000000')
  mkdirSync(join(shell, '..'), { recursive: true })
  symlinkSync(join(installed, '..'), shell)

  const home = tmp('fox-home-')
  const root = join(home, 'foxleague-agent')
  const code = realTree(join(root, 'versions', 'v3.1.0'), '3.1.0')
  symlinkSync(join(REPO, 'node_modules'), join(code, 'node_modules'))
  writeFileSync(join(root, 'versions', 'active'), 'v3.1.0\n')
  writeFileSync(join(root, '.env'), LOGIN_LINES, { mode: 0o600 })
  mkdirSync(join(root, 'data'), { recursive: true })
  writeFileSync(join(root, 'data', 'words-confirmed'), 'yes\n') // the words are not shown again (a test has no terminal)
  // The stand-in curl reaches nothing: an installer that chose to download its own Node.js here stops with its
  // own sentence (a test has no network), which is not this finding.
  const a = answers(['', '18994', 'n', 'n'])
  let r
  try {
    r = await sh(join(code, 'install.sh'), ['--no-service'], { HOME: home, USER: 'tester', PATH: `${join(shell, 'bin')}:${s.dir}:${tools}`, FOXAGENT_ROOT: root, FOXAGENT_TTY: a.tty }, { timeoutMs: 60_000 })
  } finally {
    a.close()
  }
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /Node\.js v\d+\.\d+\.\d+ at /, r.out)

  // The computer restarts: the per-shell folder is gone, the installed Node.js is not. The background service's
  // PATH never had either. The release's service is replaced by one line, so that starting it proves the start only.
  rmSync(join(shell, '..', '..'), { recursive: true, force: true })
  writeFileSync(join(code, 'src', 'service.ts'), 'console.log("the agent started")\n')
  const start = spawnSync('bash', [join(root, 'run.sh')], { env: { HOME: home, PATH: tools }, encoding: 'utf8', timeout: 30_000 })
  assert.equal(start.status, 0, `the launcher: ${start.stderr.trim()} (.node-path says ${readFileSync(join(root, '.node-path'), 'utf8').trim()})`)
  assert.match(start.stdout, /the agent started/)
})
