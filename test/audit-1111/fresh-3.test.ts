// FRESH-3 (fresh Ubuntu walk-through, 2026-11-11): as root the pasted line says "create a user (adduser fox, then
// log in as fox and paste the line again)". On a server the newcomer then types `su - fox`. A terminal opened that
// way has no XDG_RUNTIME_DIR, so `systemctl --user` answers "Failed to connect to bus: No medium found" although
// systemd runs: the installer ended at step 7 with "systemd user services are not available here. On WSL2 ...",
// `./install.sh --update` could not restart the agent, and `./install.sh --uninstall` said "Stopped." while the
// agent kept running (the failure of `systemctl --user disable --now` was hidden). Measured on Ubuntu 24.04:
// `loginctl enable-linger` (allowed for one's own user) starts the user's manager and /run/user/<uid>, and
// with XDG_RUNTIME_DIR set to it `systemctl --user` works. Safe: the installer does exactly that; an uninstall
// that could not stop the service says so.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildRelease, publish, serve } from '../update-fixtures.ts'
import { KEY, LOGIN_LINES, freshInstall, guided, realTree, running, sh, stubs, tmp, type Stubs } from './install-helpers.ts'

const UID = String(process.getuid!())

/**
 * A machine as a terminal opened with su sees it: `systemctl --user` answers only when XDG_RUNTIME_DIR names the
 * user's runtime folder, and that folder exists only once the user's manager runs (`loginctl enable-linger`).
 * Every call is noted with the XDG_RUNTIME_DIR it ran with.
 */
function suTerminal(s: Stubs, o: { managerRuns: boolean; lingerWorks?: boolean; active?: boolean }): { run: string; dir: string } {
  const run = tmp('fox-run-')
  const dir = join(run, 'user', UID)
  mkdirSync(join(run, 'systemd', 'system'), { recursive: true })
  if (o.managerRuns) mkdirSync(dir, { recursive: true })
  s.stub(
    'systemctl',
    [
      `printf 'systemctl %s [%s]\\n' "$*" "\${XDG_RUNTIME_DIR:-}" >> "$LOG"`,
      `if [ "\${XDG_RUNTIME_DIR:-}" != ${JSON.stringify(dir)} ] || [ ! -d ${JSON.stringify(dir)} ]; then echo "Failed to connect to bus: No medium found" >&2; exit 1; fi`,
      `case "$*" in *is-active*) exit ${o.active ? 0 : 3} ;; esac`,
    ].join('\n'),
  )
  s.stub('loginctl', [`printf 'loginctl %s\\n' "$*" >> "$LOG"`, `case "$*" in enable-linger*) ${o.lingerWorks === false ? 'exit 1' : `mkdir -p ${JSON.stringify(dir)}`} ;; esac`].join('\n'))
  return { run, dir }
}

test('FRESH-3: in a terminal opened with su the installer starts and finds the service manager of the user', { timeout: 120_000 }, async () => {
  const i = freshInstall()
  i.s.stub('curl', 'exit 0')
  const m = suTerminal(i.s, { managerRuns: false })
  writeFileSync(join(i.root, '.env'), LOGIN_LINES, { mode: 0o600 })
  const r = await guided(i, ['yes', '', '18997', 'n', 'n'], { args: [], env: { FOXAGENT_RUN: m.run } })
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /Running\./)
  assert.doesNotMatch(r.out, /systemd user services are not available/)
  const calls = i.s.calls()
  assert.ok(calls.includes('loginctl enable-linger tester') || calls.some(c => /^loginctl enable-linger \S+$/.test(c)), 'linger started the manager')
  assert.ok(calls.includes(`systemctl --user restart foxleague-agent [${m.dir}]`), calls.join('\n'))
  assert.ok(existsSync(join(i.home, '.config', 'systemd', 'user', 'foxleague-agent.service')))
})

test('FRESH-3: an update from a terminal opened with su restarts the agent', { timeout: 240_000 }, async () => {
  const s = stubs()
  const m = suTerminal(s, { managerRuns: true })
  const i = running(s)
  const out = tmp()
  buildRelease(out, realTree(tmp(), '3.2.0'), '3.2.0', KEY.privatePem)
  const web = await serve(publish(tmp(), [{ dir: out, version: '3.2.0' }], '3.2.0'))
  try {
    const r = await sh(join(i.root, 'install.sh'), ['--update'], { ...i.env(web.base), FOXAGENT_RUN: m.run }, { cwd: i.root })
    assert.equal(r.status, 0, r.out)
    assert.match(r.out, /Restarted\./)
    assert.ok(s.calls().includes(`systemctl --user restart foxleague-agent [${m.dir}]`), s.calls().join('\n'))
  } finally {
    await web.close()
  }
})

test('FRESH-3: an uninstall from a terminal opened with su stops the service', async () => {
  const s = stubs()
  const m = suTerminal(s, { managerRuns: true })
  const i = running(s)
  const r = await sh(join(i.root, 'install.sh'), ['--uninstall'], { ...i.env(''), FOXAGENT_RUN: m.run }, { cwd: i.root })
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /Stopped\. Your folder, your wallet words/)
  assert.ok(s.calls().includes(`systemctl --user disable --now foxleague-agent [${m.dir}]`), s.calls().join('\n'))
  assert.equal(existsSync(i.unit), false)
})

test('FRESH-3: an uninstall that cannot reach the service does not say "Stopped."', async () => {
  const s = stubs()
  // No runtime folder and linger refused: the service, if it runs, cannot be stopped from here.
  const m = suTerminal(s, { managerRuns: false, lingerWorks: false })
  const i = running(s)
  const r = await sh(join(i.root, 'install.sh'), ['--uninstall'], { ...i.env(''), FOXAGENT_RUN: m.run }, { cwd: i.root })
  assert.notEqual(r.status, 0, r.out)
  assert.doesNotMatch(r.out, /Stopped\./)
  assert.match(r.out, /Error: the background service cannot be reached from this terminal/)
  assert.ok(existsSync(i.unit), 'the unit is left in place: nothing was half removed')
})

test('FRESH-3: an uninstall after which the service still runs does not say "Stopped."', async () => {
  const s = stubs()
  const m = suTerminal(s, { managerRuns: true, active: true })
  const i = running(s)
  const r = await sh(join(i.root, 'install.sh'), ['--uninstall'], { ...i.env(''), FOXAGENT_RUN: m.run }, { cwd: i.root })
  assert.notEqual(r.status, 0, r.out)
  assert.doesNotMatch(r.out, /Stopped\./)
  assert.match(r.out, /Error: the background service is still running/)
})

test('FRESH-3: the uninstall tells that linger stays on and how to turn it off', async () => {
  const s = stubs()
  s.stub('systemctl', `printf 'systemctl %s\\n' "$*" >> "$LOG"\ncase "$*" in *is-active*) exit 3 ;; esac`)
  s.stub('loginctl', `printf 'loginctl %s\\n' "$*" >> "$LOG"\ncase "$*" in show-user*) echo "Linger=yes" ;; esac`)
  const i = running(s)
  const r = await sh(join(i.root, 'install.sh'), ['--uninstall'], i.env(''), { cwd: i.root })
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /Stopped\./)
  assert.match(r.out, /loginctl disable-linger \S+/)
  // Without linger there is nothing to tell.
  const s2 = stubs()
  s2.stub('systemctl', `printf 'systemctl %s\\n' "$*" >> "$LOG"\ncase "$*" in *is-active*) exit 3 ;; esac`)
  const i2 = running(s2)
  const r2 = await sh(join(i2.root, 'install.sh'), ['--uninstall'], i2.env(''), { cwd: i2.root })
  assert.equal(r2.status, 0, r2.out)
  assert.doesNotMatch(r2.out, /disable-linger/)
})
