// FRESH-6 (fresh Ubuntu walk-through, 2026-11-11): a fresh Ubuntu Desktop has no curl. install.sh (reached by
// `git clone ... && ./install.sh`, or by a line fetched with wget) never looked for it: at step 1 bash printed
// "curl: command not found" and the installer added "Node.js could not be downloaded from nodejs.org. Check the
// connection and run this again.", which sends the newcomer to their network. get.sh did look, and said "curl is
// needed. Install it and run this again." without saying how. Safe: both scripts say at their start which tool is
// missing and the one command that installs it on Ubuntu and Debian.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { REPO, freshInstall, guided, sh, stubs, systemTools, tmp } from './install-helpers.ts'

/** The system's tools without Node.js, npm and curl: what a fresh Ubuntu Desktop has on its PATH. */
function noCurl(): string {
  const dir = systemTools()
  rmSync(join(dir, 'curl'), { force: true })
  return dir
}

test('FRESH-6: install.sh without curl says so before step 1, with the command that installs it', { timeout: 120_000 }, async () => {
  const i = freshInstall()
  // No private Node.js yet and none on the system: the installer has to download one.
  rmSync(join(i.root, '.node'), { recursive: true })
  rmSync(join(i.s.dir, 'curl'))
  rmSync(join(i.s.dir, 'node'))
  const r = await guided(i, ['yes', 'owner', '18997', 'n', 'n'], { env: { PATH: `${i.s.dir}:${noCurl()}` } })
  assert.notEqual(r.status, 0, r.out)
  assert.match(r.out, /Error: curl is needed and is not installed\./)
  assert.match(r.out, /sudo apt install curl/)
  assert.doesNotMatch(r.out, /Check the connection/, 'the network is not what is missing')
  assert.doesNotMatch(r.out, /command not found/)
  assert.doesNotMatch(r.out, /1\/7 Node\.js/, 'it stopped before its first step')
  assert.equal(r.unread, 5, 'no question was asked')
  assert.equal(existsSync(join(i.root, '.env')), false)
})

test('FRESH-6: get.sh without curl names the command that installs it', async () => {
  const s = stubs({ node: false, npm: false })
  rmSync(join(s.dir, 'curl'))
  const home = tmp('fox-home-')
  const r = await sh(join(REPO, 'get.sh'), [], { HOME: home, PATH: `${s.dir}:${noCurl()}`, FOXAGENT_NO_RUN: '1' })
  assert.notEqual(r.status, 0, r.out)
  assert.match(r.out, /Error: curl is needed and is not installed\./)
  assert.match(r.out, /sudo apt install curl/)
  assert.equal(existsSync(join(home, 'foxleague-agent')), false)
})
