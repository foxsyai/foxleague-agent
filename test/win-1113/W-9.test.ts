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
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { childEnv, detectLayout, stage } from '../../src/update/install.ts'
import { REPO, buildRelease, codeTree, managedInstall, publish, serve, testKey, tmp } from '../update-fixtures.ts'
import { failingTar } from './helpers.ts'
import { KEY as INSTALL_KEY, LOGIN_LINES, freshInstall, guided, realTree, running, sh, stubs } from '../audit-1111/install-helpers.ts'

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
  // What 26.04 does otherwise, seen in its first replay: its image has no adduser (step 9 types it, as the
  // installer's own message says), and systemd 259 lists the service manager of a user with linger as a session of
  // class manager, so "nobody is logged in" counts the sessions of a person only.
  assert.match(script, /apt-get install -y --no-install-recommends [^\n]*\badduser\b/)
  assert.match(script, /^nobody_logged_in\(\) \{ docker exec "\$C" sh -c 'for s in \$\(loginctl list-sessions --no-legend \| awk "\{print \\\$1\}"\); do case "\$\(loginctl show-session "\$s" -p Class --value\)" in manager \| manager-early\) ;; \*\) exit 1 ;; esac; done'; \}$/m)
  assert.match(script, /^check "nobody is logged in \(the service manager of a user with linger is no person\)" nobody_logged_in$/m)
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

/** The unit the installers before 2026-11-14 wrote (install.sh of the release candidate ed8b41f), for a folder. */
function oldUnit(root: string): string {
  return [
    '[Unit]',
    'Description=foxleague-agent: AI team manager for FoxLeague',
    'After=network-online.target',
    'StartLimitIntervalSec=600',
    'StartLimitBurst=5',
    '',
    '[Service]',
    `WorkingDirectory=${root}`,
    '# FOXAGENT_SUPERVISED=1 tells the agent that this unit starts it again when it ends: an update may then end it.',
    `Environment="AGENT_ENV_FILE=${root}/.env" "AGENT_DATA_DIR=${root}/data" "FOXAGENT_SUPERVISED=1"`,
    `ExecStart="/usr/bin/bash" "${root}/run.sh"`,
    'Restart=always',
    'RestartSec=30',
    'SuccessExitStatus=75',
    'RestartForceExitStatus=75',
    'TimeoutStopSec=180',
    'UMask=0077',
    'NoNewPrivileges=true',
    'LockPersonality=true',
    'RestrictRealtime=true',
    'RestrictSUIDSGID=true',
    'RestrictNamespaces=true',
    'RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX',
    'SystemCallArchitectures=native',
    'SystemCallFilter=@system-service',
    'SystemCallFilter=~@privileged @resources',
    'SystemCallErrorNumber=EPERM',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n')
}
const SANDBOX = ['NoNewPrivileges=true', 'LockPersonality=true', 'RestrictRealtime=true', 'RestrictNamespaces=true', 'RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX', 'SystemCallArchitectures=native', 'SystemCallFilter=@system-service', 'SystemCallFilter=~@privileged @resources', 'SystemCallErrorNumber=EPERM', 'UMask=0077']

test('W-9 the unit the installer writes has no RestrictSUIDSGID and keeps the rest of its sandbox', { timeout: 120_000 }, async () => {
  const i = freshInstall()
  i.s.stub('curl', 'exit 0') // the dashboard "answers" at once
  writeFileSync(join(i.root, '.env'), LOGIN_LINES, { mode: 0o600 })
  const r = await guided(i, ['yes', '', '18997', 'n', 'n'], { args: [] })
  assert.equal(r.status, 0, r.out)
  const unit = readFileSync(join(i.home, '.config', 'systemd', 'user', 'foxleague-agent.service'), 'utf8')
  const lines = unit.split('\n')
  assert.ok(!lines.some(l => /^\s*RestrictSUIDSGID\s*=/.test(l)), unit)
  for (const line of SANDBOX) assert.ok(lines.includes(line), `${line} is kept`)
  assert.match(unit, /^# No RestrictSUIDSGID: its filter refuses openat2, which the tar of Ubuntu 26\.04 needs to unpack an update\.$/m, 'the unit says why, so that nobody puts it back')
})

test('W-9 ./install.sh --update in a terminal installs the update and renews the unit of an older install before it restarts the agent', { timeout: 240_000 }, async () => {
  const s = stubs()
  const i = running(s)
  writeFileSync(i.unit, oldUnit(i.root))
  const out = tmp()
  buildRelease(out, realTree(tmp(), '3.2.0'), '3.2.0', INSTALL_KEY.privatePem)
  const web = await serve(publish(tmp(), [{ dir: out, version: '3.2.0' }], '3.2.0'))
  try {
    const r = await sh(join(i.root, 'install.sh'), ['--update'], i.env(web.base), { cwd: i.root })
    assert.equal(r.status, 0, r.out)
    assert.match(r.out, /Restarted\./)
    assert.equal(readFileSync(i.unit, 'utf8'), oldUnit(i.root).replace('RestrictSUIDSGID=true\n', ''))
    const calls = s.calls()
    const reload = calls.lastIndexOf('systemctl --user daemon-reload')
    const restart = calls.indexOf('systemctl --user restart foxleague-agent')
    assert.ok(reload >= 0 && restart > reload, `systemd reads the unit again before the restart:\n${calls.join('\n')}`)
  } finally {
    await web.close()
  }
})
