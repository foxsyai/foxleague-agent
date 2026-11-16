// INS-A2: `./install.sh --uninstall` says "Stopped." for an agent it never stopped.
//  (a) Linux, with sudo in front (a newcomer's reflex before "uninstall"; --uninstall is let through as root). sudo
//      sets HOME to root's on Ubuntu, so the unit of the owner's user is not found under it, `systemctl --user` of
//      root reaches no service manager (its failure is hidden), `is-active` fails too and reads as "not running".
//      The screen says "Stopped. Your folder ... are untouched" while the agent goes on planning and signing.
//  (b) macOS: `launchctl bootout ... || true`, then "Stopped." whatever launchd answered. With sudo (macOS keeps
//      HOME, the domain becomes gui/0) the bootout fails, the plist of the owner IS removed, the job stays loaded
//      and KeepAlive keeps it running until the next logout; a second run without sudo cannot boot it out by a
//      path that no longer exists and says "Stopped." again.
// FRESH-3 fixed the same sentence for a terminal opened with su ("Never 'Stopped.' for a service that could not be
// asked to stop: the agent would keep playing", install.sh). Safe: an uninstall that stopped nothing never says
// "Stopped.", and it removes nothing it could not stop.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildRelease, publish, serve } from '../update-fixtures.ts'
import { KEY, realTree, running, sh, stubs, tmp } from '../audit-1111/install-helpers.ts'

/**
 * The owner's agent as it runs: a process of this user that runs .../src/service.ts under Node.js (what run.sh
 * starts), named in the install's data/service.pid as the service itself writes it. Returns what ends it.
 */
function liveAgent(root: string): { pid: number; runs: () => boolean; end: () => void } {
  const fake = join(tmp('fox-agent-'), 'src')
  mkdirSync(fake, { recursive: true })
  writeFileSync(join(fake, 'service.ts'), 'setTimeout(() => undefined, 120_000)\n')
  const agent = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(fake, 'service.ts')], { stdio: 'ignore' })
  mkdirSync(join(root, 'data'), { recursive: true })
  writeFileSync(join(root, 'data', 'service.pid'), String(agent.pid))
  return { pid: agent.pid!, runs: () => agent.exitCode === null && agent.signalCode === null, end: () => void agent.kill('SIGKILL') }
}

test('INS-A2: sudo ./install.sh --uninstall on Linux does not say "Stopped." while the owner\'s service still runs', async () => {
  const s = stubs()
  const i = running(s) // the owner's install, with the unit in the owner's HOME
  const rootHome = tmp('fox-roothome-')
  // As sudo makes it: the user is root and HOME is root's. Root has no user service manager to reach.
  s.stub('id', 'case "$*" in -u) echo 0 ;; -un) echo root ;; *) exec /usr/bin/id "$@" ;; esac')
  s.stub('systemctl', `printf 'systemctl %s\\n' "$*" >> "$LOG"\necho "Failed to connect to bus: No medium found" >&2\nexit 1`)
  const agent = liveAgent(i.root)
  try {
    const r = await sh(join(i.root, 'install.sh'), ['--uninstall'], { HOME: rootHome, USER: 'root', PATH: `${s.dir}:${process.env.PATH}`, FOXAGENT_TTY: '/dev/null', FOXAGENT_RUN: tmp('fox-run-') }, { cwd: i.root })
    assert.ok(agent.runs() && existsSync(i.unit), 'the owner\'s agent still runs and its unit is still there: nothing was stopped or removed')
    assert.doesNotMatch(r.out, /Stopped\./, `nothing was stopped, the agent keeps playing:\n${r.out}`)
  } finally {
    agent.end()
  }
})

test('INS-A2: the uninstall on a Mac does not say "Stopped." when launchd did not unload the agent', async () => {
  const s = stubs()
  const i = running(s, { service: false })
  s.stub('uname', 'case "${1:-}" in -s | "") echo Darwin ;; -m) /usr/bin/uname -m ;; *) exec /usr/bin/uname "$@" ;; esac')
  const plist = join(i.home, 'Library', 'LaunchAgents', 'ai.foxleague.agent.plist')
  mkdirSync(join(i.home, 'Library', 'LaunchAgents'), { recursive: true })
  writeFileSync(plist, '<plist version="1.0"><dict><key>Label</key><string>ai.foxleague.agent</string></dict></plist>\n')
  // launchd as it answers a bootout it cannot do (the domain of another user under sudo, a session without it):
  // status 125 and one line; the job stays loaded, so `print` and `list` of it still answer.
  s.stub('launchctl', `printf 'launchctl %s\\n' "$*" >> "$LOG"\ncase "$1" in bootout) echo "Boot-out failed: 125: Domain does not support specified action" >&2; exit 125 ;; esac\nexit 0`)
  const agent = liveAgent(i.root)
  try {
    const r = await sh(join(i.root, 'install.sh'), ['--uninstall'], { HOME: i.home, USER: 'tester', PATH: `${s.dir}:${process.env.PATH}`, FOXAGENT_TTY: '/dev/null' }, { cwd: i.root })
    assert.ok(s.calls().some(c => c.startsWith('launchctl bootout ')), s.calls().join('\n'))
    assert.ok(agent.runs(), 'the agent still runs')
    assert.doesNotMatch(r.out, /Stopped\./, `launchd refused the bootout and the job is still loaded:\n${r.out}`)
    assert.ok(existsSync(plist), 'the plist stays while the job is loaded: without it the next uninstall has no path to boot out')
  } finally {
    agent.end()
  }
})

test('INS-A2: sudo ./install.sh --update on Linux does not put a release in place as root and then say that no service is installed', { timeout: 240_000 }, async () => {
  // The same reflex before --update. As root (HOME is root's) the update is downloaded, unpacked and switched to by
  // root inside the owner's folder (root's files in versions/, data/update and .npm-cache, which the owner's agent
  // cannot write to at its next one-click update), and the owner's unit is not found, so the last line is "No
  // background service is installed here: start the agent again to run the new version (.../run.sh)" although the
  // service runs. Root is told here by the stand-in `id`, as the script asks it everywhere ([ "$(id -u)" = 0 ]).
  const s = stubs()
  const i = running(s)
  const out = tmp()
  buildRelease(out, realTree(tmp(), '3.2.0'), '3.2.0', KEY.privatePem)
  const web = await serve(publish(tmp(), [{ dir: out, version: '3.2.0' }], '3.2.0'))
  s.stub('id', 'case "$*" in -u) echo 0 ;; -un) echo root ;; *) exec /usr/bin/id "$@" ;; esac')
  s.stub('systemctl', `printf 'systemctl %s\\n' "$*" >> "$LOG"\necho "Failed to connect to bus: No medium found" >&2\nexit 1`)
  try {
    const r = await sh(join(i.root, 'install.sh'), ['--update'], { HOME: tmp('fox-roothome-'), USER: 'root', PATH: `${s.dir}:${process.env.PATH}`, AGENT_UPDATE_URL: web.base, FOXAGENT_TTY: '/dev/null', FOXAGENT_RUN: tmp('fox-run-') }, { cwd: i.root })
    assert.doesNotMatch(r.out, /No background service is installed here/, `the owner's service is installed and runs; root's HOME just does not hold its unit:\n${r.out}`)
  } finally {
    await web.close()
  }
})

test('INS-A2: the uninstall of an install without a background service does not say "Stopped." while its agent, started with ./run.sh, still runs', async () => {
  // The guides' own path for a machine without systemd: ./install.sh --no-service, then ./run.sh (in a terminal, under
  // tmux or nohup, or under a supervisor of the owner's own: "If you keep the agent running another way", Update
  // page). The documented uninstall then finds no unit, every systemctl call fails unseen and the screen says
  // "Stopped." The agent's own pid file (data/service.pid, which the installer already reads at step 3) names the
  // process that still plays.
  const s = stubs()
  const i = running(s, { service: false })
  s.stub('systemctl', `printf 'systemctl %s\\n' "$*" >> "$LOG"\necho "System has not been booted with systemd as init system (PID 1). Can't operate." >&2\nexit 1`)
  const agent = liveAgent(i.root)
  try {
    const r = await sh(join(i.root, 'install.sh'), ['--uninstall'], { HOME: i.home, USER: 'tester', PATH: `${s.dir}:${process.env.PATH}`, FOXAGENT_TTY: '/dev/null', FOXAGENT_RUN: tmp('fox-run-') }, { cwd: i.root })
    assert.ok(agent.runs(), 'the agent still runs')
    assert.doesNotMatch(r.out, /Stopped\./, `the agent (pid ${agent.pid}, in data/service.pid) still runs:\n${r.out}`)
  } finally {
    agent.end()
  }
})
