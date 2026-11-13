// W-9 (Windows real-PC check of 2026-11-13, high): the one-click update never installed on Ubuntu 26.04. Ubuntu's
// tar security update for CVE-2025-45582 (tar 1.35+dfsg-4ubuntu0.2, June 2026) resolves every path it unpacks with
// openat2(RESOLVE_BENEATH). The agent's systemd user unit had RestrictSUIDSGID=true, whose seccomp filter answers
// openat2 with ENOSYS because it cannot look inside the call's arguments. The 24.04 build of tar then falls back to
// openat; the 26.04 build does not, and `tar -xzf` inside the service ended with "Cannot mkdir: Function not
// implemented" (status 2). The same tar in a terminal unpacks the release. Each test here failed before its fix.
// The record is the section "Windows real-PC check (2026-11-13)" of docs/SECURITY-REVIEW.md.
import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { childEnv, detectLayout, stage } from '../../src/update/install.ts'
import { REPO, buildRelease, codeTree, managedInstall, testKey, tmp } from '../update-fixtures.ts'
import { failingTar } from './helpers.ts'

const read = (f: string): string => readFileSync(join(REPO, f), 'utf8')

test('W-9 the install replay runs on Ubuntu 26.04 too (FRESH_UBUNTU=26.04), where the user unit meets the tar that needs openat2', () => {
  const file = join(REPO, 'scripts/release/fresh-install-check.sh')
  const script = read('scripts/release/fresh-install-check.sh')
  assert.equal(spawnSync('bash', ['-n', file], { encoding: 'utf8' }).status, 0, 'the script parses')
  assert.match(script, /^UBUNTU=\$\{FRESH_UBUNTU:-24\.04\}$/m, 'the release to replay on is a switch, 24.04 without it')
  assert.match(script, /^case "\$UBUNTU" in 24\.04 \| 26\.04\) ;; \*\) echo "FRESH_UBUNTU must be 24\.04 or 26\.04"; exit 2 ;; esac$/m, 'only the two releases it was tried on')
  assert.match(script, /^IMAGE=fox-fresh-ubuntu:\$UBUNTU$/m)
  // The image is built FROM that release, and the first step names it.
  assert.match(script, /printf 'FROM ubuntu:%s\\n' "\$UBUNTU"/)
  assert.doesNotMatch(script, /^FROM ubuntu:24\.04$/m, 'no release written into the Dockerfile')
  assert.match(script, /say "1\. A fresh Ubuntu \$UBUNTU with systemd, no curl, no Node\.js"/)
  assert.match(script, /^#\s+FRESH_UBUNTU=26\.04 scripts\/release\/fresh-install-check\.sh/m, 'the head of the script says how')
})

const KEY = testKey()

/** An install of 1.1.0, a signed 1.2.0 and the environment of an update with the given tar first on the PATH. */
function updateWith(tarDir: string) {
  const inst = managedInstall('1.1.0')
  const built = buildRelease(tmp(), codeTree(tmp(), '1.2.0'), '1.2.0', KEY.privatePem)
  const env = childEnv(inst.root, { PATH: `${tarDir}:${process.env.PATH}`, HOME: process.env.HOME, LANG: 'de_DE.UTF-8', LC_ALL: 'de_DE.UTF-8' })
  return { inst, layout: detectLayout(inst.code), built, env }
}

test('W-9 an unpack that the service refuses (tar: Function not implemented) tells the owner to run ./install.sh --update once in a terminal', async () => {
  const tar = failingTar('/usr/bin/tar: foxleague-agent-v1.2.0/.github/scripts: Cannot mkdir: Function not implemented')
  const u = updateWith(tar.dir)
  const quiet = mock.method(console, 'error', () => undefined)
  try {
    await assert.rejects(stage(u.layout, u.built.manifest, u.built.archive, { env: u.env }), (err: Error) => {
      assert.match(err.message, /this system's tar cannot unpack inside the agent's background service as an older installer set it up/)
      assert.match(err.message, /Run \.\/install\.sh --update once in a terminal, in the agent's folder: that installs it and renews the service, so later updates are one click again/)
      assert.match(err.message, /\(tar: foxleague-agent-v1\.2\.0\/\.github\/scripts: Cannot mkdir: Function not implemented\)/, "tar's own first line, without the program's path")
      return true
    })
  } finally {
    quiet.mock.restore()
  }
  // tar was asked in the C language whatever the owner's: its words can be read here.
  assert.deepEqual(tar.lcAll().trim().split('\n').at(-1), 'C')
  // Nothing was left behind and nothing was switched.
  assert.deepEqual(readdirSync(join(u.inst.root, 'versions')).sort(), ['active', 'v1.1.0'])
})
