// MAC-1 (found on the owner's Mac, macOS 15.7, 16 Nov 2026): the launchd plist the installer writes starts
// `<bash> <folder>/run.sh`. macOS lists every background item in System Settings, General, Login Items & Extensions
// (and says "Background Items Added" when one appears), named after the program the job starts when no app goes with
// it: the agent was listed as "bash". A user cannot tell that it is the FoxLeague agent and may switch it off as
// unknown.
// Right: the job starts a program of the agent's own whose file name says what it is, `FoxLeague Agent` in the
// install's folder, which execs run.sh of that folder. Nothing else of the plist changes (KeepAlive, RunAtLoad,
// FOXAGENT_SUPERVISED, the label, the log), the agent starts as before, exit code 75 still reaches launchd, the
// installer's re-run, `./install.sh --update` and a confirmed update keep it starting, and the uninstall removes the
// launcher with the plist. Linux does not change.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import * as install from '../src/update/install.ts'
import { supervised } from '../src/update/supervised.ts'
import { buildRelease, codeTree, publish, serve } from './update-fixtures.ts'
import { KEY, LOGIN_LINES, REPO, TEST_PORT, freshInstall, guided, mode, realTree, running, sh, stubs, tmp, type Install, type Stubs } from './audit-1111/install-helpers.ts'

const NAME = 'FoxLeague Agent'
const LABEL = 'ai.foxleague.agent'
const MAC = 'case "${1:-}" in -s | "") echo Darwin ;; -m) /usr/bin/uname -m ;; *) exec /usr/bin/uname "$@" ;; esac'
// The launchctl stand-in of install-helpers.ts, for a test that has replaced it and puts it back.
const LAUNCHCTL = `printf 'launchctl %s\\n' "$*" >> "$LOG"\ncase "$1" in bootstrap) : > "$LOG.loaded" ;; bootout) rm -f "$LOG.loaded" ;; print) [ -f "$LOG.loaded" ] || exit 113 ;; esac`
/** What the `install` module exports once the fix is in (read by name: before it, the names are not there). */
const exported = install as unknown as Record<string, unknown>

interface Plist {
  Label: string
  Program?: string
  ProgramArguments: string[]
  WorkingDirectory: string
  EnvironmentVariables: Record<string, string>
  RunAtLoad: boolean
  KeepAlive: boolean
  ExitTimeOut: number
  StandardOutPath: string
  StandardErrorPath: string
}

const plistPath = (home: string): string => join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`)

/** The plist as launchd reads it (Python's plistlib, as UPD-22 reads it). */
function plistOf(home: string): Plist {
  const json = execFileSync('python3', ['-I', '-c', 'import json,plistlib,sys; print(json.dumps(plistlib.load(open(sys.argv[1],"rb"))))', plistPath(home)], { encoding: 'utf8' })
  return JSON.parse(json) as Plist
}

/** The plist as the installer of 31adfb7 wrote it: bash with run.sh. */
function plistOf31adfb7(root: string, bash: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${bash}</string><string>${root}/run.sh</string></array>
  <key>WorkingDirectory</key><string>${root}</string>
  <key>EnvironmentVariables</key><dict><key>AGENT_ENV_FILE</key><string>${root}/.env</string><key>AGENT_DATA_DIR</key><string>${root}/data</string><key>FOXAGENT_SUPERVISED</key><string>1</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ExitTimeOut</key><integer>180</integer>
  <key>StandardOutPath</key><string>${root}/data/service.log</string>
  <key>StandardErrorPath</key><string>${root}/data/service.log</string>
</dict></plist>
`
}

const bashPath = (): string => execFileSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).trim()

/** The guided install with a background service on a Mac (uname says Darwin, launchctl is the stand-in). */
async function macInstall(i: Install, lines = ['yes', '', TEST_PORT, 'n', 'n']): Promise<string> {
  i.s.stub('uname', MAC)
  i.s.stub('curl', 'exit 0') // the dashboard answers its health check
  if (!existsSync(join(i.root, '.env'))) writeFileSync(join(i.root, '.env'), LOGIN_LINES, { mode: 0o600 })
  const r = await guided(i, lines, { args: [] })
  assert.equal(r.status, 0, r.out.slice(-1500))
  assert.match(r.out, /Running\./)
  return r.out
}

/** The plist's own part, as it stands for every install of this folder, apart from the program it starts. */
function assertRestOfPlist(p: Plist, root: string): void {
  assert.equal(p.Label, LABEL)
  assert.equal(p.WorkingDirectory, root)
  assert.deepEqual(p.EnvironmentVariables, { AGENT_ENV_FILE: join(root, '.env'), AGENT_DATA_DIR: join(root, 'data'), FOXAGENT_SUPERVISED: '1' })
  assert.equal(p.RunAtLoad, true)
  assert.equal(p.KeepAlive, true, 'launchd starts the agent again after every exit, 75 included')
  assert.equal(p.ExitTimeOut, 180)
  assert.equal(p.StandardOutPath, join(root, 'data', 'service.log'))
  assert.equal(p.StandardErrorPath, join(root, 'data', 'service.log'))
}

/** The program the job starts is the launcher of the install's folder, named for the agent: not bash. */
function assertStartsLauncher(p: Plist, root: string): string {
  const program = p.Program ?? p.ProgramArguments[0]!
  assert.notEqual(basename(program), 'bash', `macOS lists the background item by this program's name: ${program}`)
  assert.deepEqual(p.ProgramArguments, [join(root, NAME)], 'the job starts the launcher alone')
  assert.equal(p.Program, undefined)
  const launcher = join(root, NAME)
  assert.ok(existsSync(launcher), `${launcher} is not there`)
  assert.ok(lstatSync(launcher).isFile(), 'a plain file: a link would be named after what it points at')
  assert.equal(mode(launcher), '755', 'launchd starts it as a program')
  assert.match(basename(launcher), /FoxLeague/, 'a name that says what it is')
  const text = readFileSync(launcher, 'utf8')
  assert.match(text, /^#!\/bin\/bash\n/)
  assert.equal(text, exported.MAC_LAUNCHER, 'the launcher the installer writes is the one a confirmed update writes')
  return launcher
}

interface Started {
  status: number | null
  /** The process launchd would start. */
  pid: number
  /** What the stand-in Node.js was started with: its process, its arguments, FOXAGENT_SUPERVISED and XPC_SERVICE_NAME. */
  ran: { pid: number; args: string; supervisedVar: string; xpc: string }[]
  out: string
}

/**
 * Starts the job as launchd does: the plist's program with its arguments, no shell, in its working folder, with its
 * environment over launchd's own (its PATH, XPC_SERVICE_NAME naming the label). The agent's Node.js is a stand-in that
 * notes how it was started and ends with `code`.
 */
function startAsLaunchd(root: string, p: Plist, code = 0): Promise<Started> {
  const dir = tmp('fox-node-')
  const log = join(dir, 'ran')
  const fake = join(dir, 'node')
  writeFileSync(fake, ['#!/usr/bin/env bash', `printf '%s\\t%s\\t%s\\t%s\\n' "$$" "$*" "\${FOXAGENT_SUPERVISED-}" "\${XPC_SERVICE_NAME-}" >> ${JSON.stringify(log)}`, `exit ${code}`, ''].join('\n'), { mode: 0o755 })
  writeFileSync(join(root, '.node-path'), `${fake}\n`)
  const program = p.Program ?? p.ProgramArguments[0]!
  const args = p.Program ? p.ProgramArguments : p.ProgramArguments.slice(1)
  return new Promise(done => {
    let out = ''
    const child = spawn(program, args, { cwd: p.WorkingDirectory, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: dirname(root), XPC_SERVICE_NAME: p.Label, ...p.EnvironmentVariables }, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', (b: Buffer) => (out += b.toString('utf8')))
    child.stderr.on('data', (b: Buffer) => (out += b.toString('utf8')))
    const ran = (): Started['ran'] =>
      (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []).map(l => {
        const [pid, a, s, x] = l.split('\t')
        return { pid: Number(pid), args: a ?? '', supervisedVar: s ?? '', xpc: x ?? '' }
      })
    child.on('error', e => done({ status: null, pid: child.pid ?? -1, ran: ran(), out: `${out}${e.message}` }))
    child.on('close', status => done({ status, pid: child.pid!, ran: ran(), out }))
  })
}

/** The agent of the active release started once, in launchd's own process, told that launchd starts it again. */
async function assertAgentStarts(root: string, code: string, p: Plist): Promise<void> {
  const r = await startAsLaunchd(root, p, 75)
  assert.equal(r.ran.length, 1, `the agent did not start:\n${r.out}`)
  assert.ok(r.ran[0]!.args.endsWith(join(code, 'src', 'service.ts')), r.ran[0]!.args)
  assert.equal(r.ran[0]!.pid, r.pid, 'the launcher and run.sh exec: the agent runs in the process launchd started and stops')
  assert.equal(r.status, 75, 'an update\'s exit code 75 reaches launchd')
  assert.equal(r.ran[0]!.supervisedVar, '1')
  assert.equal(supervised({ FOXAGENT_SUPERVISED: r.ran[0]!.supervisedVar, XPC_SERVICE_NAME: r.ran[0]!.xpc }, () => [], () => null), true, 'supervised() still says supervised')
}

test('MAC-1: a Mac install starts its background agent through a program named for the agent, not bash', { timeout: 240_000 }, async () => {
  const i = freshInstall()
  await macInstall(i)
  const p = plistOf(i.home)
  const launcher = assertStartsLauncher(p, i.root)
  assertRestOfPlist(p, i.root)
  assert.ok(i.s.calls().some(c => c === `launchctl bootstrap gui/${process.getuid!()} ${plistPath(i.home)}`), i.s.calls().join('\n'))
  await assertAgentStarts(i.root, i.code, p)

  // The launcher execs run.sh of its own folder, wherever it is started from, also from a folder whose name has
  // spaces, and run.sh need not be executable (the plist started `bash run.sh` before).
  const box = join(tmp('fox-box-'), 'a folder with spaces')
  mkdirSync(box)
  writeFileSync(join(box, NAME), readFileSync(launcher), { mode: 0o755 })
  writeFileSync(join(box, 'run.sh'), 'printf "%s|%s|%s\\n" "$$" "${BASH_SOURCE[0]}" "$*"\n', { mode: 0o644 })
  const own = execFileSync(join(box, NAME), [], { cwd: '/', encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } }).trim().split('|')
  assert.equal(own[1], join(box, 'run.sh'))
  assert.equal(own[2], '', 'launchd passes no arguments and the launcher adds none')
})

test('MAC-1: running the installer again keeps the launcher and the agent starting, and moves an older Mac install off bash', { timeout: 240_000 }, async () => {
  const i = freshInstall()
  await macInstall(i)
  // The install as 31adfb7 left it: the plist starts bash with run.sh and there is no launcher.
  writeFileSync(plistPath(i.home), plistOf31adfb7(i.root, bashPath()))
  rmSync(join(i.root, NAME), { force: true })
  const before = i.s.calls().length
  // The questions of a run after the first: "A login is already set. Change it?", the port, "Enter keys now?" and the
  // live permission (the words were confirmed at the first run).
  await macInstall(i, ['', TEST_PORT, 'n', 'n'])
  const p = plistOf(i.home)
  assertStartsLauncher(p, i.root)
  assertRestOfPlist(p, i.root)
  const calls = i.s.calls().slice(before).filter(c => c.startsWith('launchctl bootout ') || c.startsWith('launchctl bootstrap '))
  assert.deepEqual(calls.map(c => c.split(' ')[1]), ['bootout', 'bootstrap'], 'the job is loaded again from the new plist')
  await assertAgentStarts(i.root, i.code, p)

  // And once more over an install that is already on the launcher: still the launcher, still starting.
  await macInstall(i, ['', TEST_PORT, 'n', 'n'])
  assertStartsLauncher(plistOf(i.home), i.root)
  await assertAgentStarts(i.root, i.code, plistOf(i.home))
})

/**
 * The launchctl stand-in of install-helpers.ts, which also answers `print-disabled` as launchd does: the jobs switched
 * off (System Settings, Login Items & Extensions, or `launchctl disable`) and on. `listed` is the agent's own line, such
 * as `"ai.foxleague.agent" => disabled`; `fails` makes the question fail.
 */
function launchctlWith(o: { listed?: string; fails?: boolean } = {}): string {
  const answer = o.fails ? 'echo "Could not print disabled services: 125: Domain does not support specified action" >&2; exit 125' : `printf 'disabled services = {\\n\\t"com.apple.Siri.agent" => enabled\\n${o.listed ? `\\t${o.listed}\\n` : ''}}\\n'`
  return `${LAUNCHCTL}\ncase "$1" in print-disabled) ${answer} ;; esac`
}
const OFF = `"${LABEL}" => disabled`
/** What launchctl was asked that changes the job: load, unload, restart or switch on. */
const jobCalls = (s: Stubs, from = 0): string[] => s.calls().slice(from).filter(c => /^launchctl (kickstart|bootstrap|bootout|enable|load) /.test(c))

/**
 * `./install.sh --update` from 3.1.0 (this code) on a Mac whose plist is `plist`; the job loaded or not. The newest
 * release is `to`: 3.2.0, or 3.1.0 when the install runs the newest already.
 */
async function macUpdate(o: { plist: (root: string) => string; loaded: boolean; launcher?: string; to?: string; launchctl?: string }): Promise<{ s: Stubs; home: string; root: string; out: string; before: string }> {
  const to = o.to ?? '3.2.0'
  const s = stubs()
  const i = running(s, { service: false })
  s.stub('uname', MAC)
  if (o.launchctl) s.stub('launchctl', o.launchctl)
  mkdirSync(join(i.home, 'Library', 'LaunchAgents'), { recursive: true })
  const before = o.plist(i.root)
  writeFileSync(plistPath(i.home), before)
  if (o.launcher !== undefined) writeFileSync(join(i.root, NAME), o.launcher, { mode: 0o755 })
  if (o.loaded) writeFileSync(join(s.dir, 'calls.log.loaded'), '')
  const out = tmp()
  buildRelease(out, realTree(tmp(), to), to, KEY.privatePem)
  const web = await serve(publish(tmp(), [{ dir: out, version: to }], to))
  try {
    const r = await sh(join(i.root, 'install.sh'), ['--update'], i.env(web.base), { cwd: i.root })
    assert.equal(r.status, 0, r.out)
    assert.equal(readFileSync(join(i.root, 'versions', 'active'), 'utf8'), `v${to}\n`, r.out)
    if (to === '3.1.0') assert.match(r.out, /You run 3\.1\.0, the newest version\./)
    return { s, home: i.home, root: i.root, out: r.out, before }
  } finally {
    await web.close()
  }
}

test('MAC-1: ./install.sh --update moves an older Mac install off bash; a loaded agent is loaded again from it, a stopped one stays stopped', { timeout: 240_000 }, async () => {
  for (const loaded of [true, false]) {
    const u = await macUpdate({ plist: root => plistOf31adfb7(root, bashPath()), loaded })
    const p = plistOf(u.home)
    assertStartsLauncher(p, u.root)
    assertRestOfPlist(p, u.root)
    // Only the line of the program changed: the rest of the file is as it was.
    const now = readFileSync(plistPath(u.home), 'utf8').split('\n')
    const was = u.before.split('\n')
    assert.equal(now.length, was.length)
    assert.deepEqual(now.filter((l, n) => l !== was[n]), [`  <key>ProgramArguments</key><array><string>${join(u.root, NAME)}</string></array>`])
    const restarts = jobCalls(u.s)
    if (loaded) {
      // A kickstart restarts the job launchd holds, from the plist it read at its load: the new one would wait for the
      // next login. Unloaded and loaded again (as the guided installer does), the job starts the launcher now, and with
      // it the new release (R78A-1).
      assert.deepEqual(restarts, [`launchctl bootout gui/${process.getuid!()}/${LABEL}`, `launchctl bootstrap gui/${process.getuid!()} ${plistPath(u.home)}`], u.out)
      assert.match(u.out, /Restarted\./)
    } else {
      assert.deepEqual(restarts, [], `the stopped agent was started again:\n${u.out}`)
      assert.match(u.out, /The background agent is stopped, so it stays stopped/)
    }
    await assertAgentStarts(u.root, join(u.root, 'versions', 'v3.2.0'), p)
  }
})

test('MAC-1: ./install.sh --update leaves a plist alone that is already on the launcher or that it did not write', { timeout: 240_000 }, async () => {
  // Already on the launcher: the plist is not written again (the update and its --prepare leave it and the launcher).
  const launcher = exported.MAC_LAUNCHER as string
  const same = await macUpdate({ plist: root => plistOf31adfb7(root, bashPath()).replace(/<key>ProgramArguments<\/key><array>.*<\/array>/, `<key>ProgramArguments</key><array><string>${join(root, NAME)}</string></array>`), loaded: true, launcher })
  assert.equal(readFileSync(plistPath(same.home), 'utf8'), same.before)
  assert.equal(readFileSync(join(same.root, NAME), 'utf8'), launcher)
  assert.deepEqual(jobCalls(same.s), [`launchctl kickstart -k gui/${process.getuid!()}/${LABEL}`], 'an unchanged plist: restarted as before (UPD-U5)')
  await assertAgentStarts(same.root, join(same.root, 'versions', 'v3.2.0'), plistOf(same.home))
  // A plist that starts something else (an owner's own edit, the code of a flat install) is not the installer's form.
  const other = await macUpdate({ plist: root => plistOf31adfb7(root, bashPath()).replace(`<string>${root}/run.sh</string>`, `<string>${root}/my-own-start.sh</string>`), loaded: true })
  assert.equal(readFileSync(plistPath(other.home), 'utf8'), other.before)
  assert.equal(existsSync(join(other.root, NAME)), false)
})

test('MAC-1: a confirmed update refreshes the launcher like run.sh and cli.sh, and puts none where the installer put none', () => {
  const root = tmp('fox-install-')
  const code = codeTree(join(root, 'versions', 'v3.2.0'), '3.2.0', { extra: { 'run.sh': '#!/usr/bin/env bash\n# run 3.2.0\n', 'cli.sh': '#!/usr/bin/env bash\n# cli 3.2.0\n' } })
  writeFileSync(join(root, 'versions', 'active'), 'v3.2.0\n')
  writeFileSync(join(root, NAME), '#!/bin/bash\n# an older launcher\nexec /bin/bash "$(dirname "$0")/run.sh"\n', { mode: 0o644 })
  const changed = install.refreshLauncher(install.detectLayout(code))
  assert.ok(changed.includes(NAME), `the launcher is among the files replaced (${changed.join(', ')})`)
  assert.equal(readFileSync(join(root, NAME), 'utf8'), exported.MAC_LAUNCHER)
  assert.equal(mode(join(root, NAME)), '755')
  assert.deepEqual(install.refreshLauncher(install.detectLayout(code)), [], 'and nothing the second time')

  // Linux, and a Mac whose plist still starts bash: no launcher, so none is made.
  const linux = tmp('fox-install-')
  const linuxCode = codeTree(join(linux, 'versions', 'v3.2.0'), '3.2.0', { extra: { 'run.sh': '#!/usr/bin/env bash\n' } })
  writeFileSync(join(linux, 'versions', 'active'), 'v3.2.0\n')
  assert.ok(!install.refreshLauncher(install.detectLayout(linuxCode)).includes(NAME))
  assert.equal(existsSync(join(linux, NAME)), false)
})

test('MAC-1: the uninstall removes the launcher with the plist, and keeps both while launchd still lists the job', { timeout: 240_000 }, async () => {
  const i = freshInstall()
  await macInstall(i)
  const launcher = join(i.root, NAME)
  assert.ok(existsSync(launcher), 'the install wrote the launcher')
  const uninstall = (): Promise<{ status: number; out: string }> => sh(join(i.code, 'install.sh'), ['--uninstall'], { ...i.env, FOXAGENT_ROOT: i.root, FOXAGENT_TTY: '/dev/null' })
  // launchd keeps the job (INS-A2): the plist and the program it starts stay, for the next run to unload it.
  i.s.stub('launchctl', `printf 'launchctl %s\\n' "$*" >> "$LOG"\ncase "$1" in bootout) echo "Boot-out failed: 125: Domain does not support specified action" >&2; exit 125 ;; esac\nexit 0`)
  const kept = await uninstall()
  assert.notEqual(kept.status, 0, kept.out)
  assert.ok(existsSync(plistPath(i.home)) && existsSync(launcher), 'the job still runs the launcher')
  // launchd unloads it: both go; run.sh and cli.sh stay for ./run.sh.
  i.s.stub('launchctl', LAUNCHCTL)
  const r = await uninstall()
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /Stopped\./)
  assert.equal(existsSync(plistPath(i.home)), false)
  assert.equal(existsSync(launcher), false, 'the launcher goes with the plist')
  for (const f of ['run.sh', 'cli.sh', 'install.sh']) assert.ok(existsSync(join(i.root, f)), f)
})

/** The plist as this release writes it: the launcher. */
const onLauncher = (root: string): string => plistOf31adfb7(root, bashPath()).replace(/<key>ProgramArguments<\/key><array>.*<\/array>/, `<key>ProgramArguments</key><array><string>${join(root, NAME)}</string></array>`)
const reload = (home: string): string[] => [`launchctl bootout gui/${process.getuid!()}/${LABEL}`, `launchctl bootstrap gui/${process.getuid!()} ${plistPath(home)}`]
/** The commands that switch the agent on again, as the screen gives them. */
const switchOn = (home: string): string => `launchctl enable gui/$(id -u)/${LABEL} && launchctl bootstrap gui/$(id -u) ${plistPath(home)}`

// R78A-1 (GitHub review of PR #78): renew_plist came after `if [ "$rc" = 3 ]; then exit 0; fi`. On an install that runs
// the newest release already (`cli update` ends with 3), `./install.sh --update` ended there and the plist stayed on
// bash. Right: the plist moves to the launcher then too, after the same service checks; a running agent is loaded again
// only when the plist really changed, and a stopped one stays stopped.
test('R78A-1: ./install.sh --update on an install that runs the newest release still moves an older Mac plist off bash', { timeout: 240_000 }, async () => {
  // Running: the plist changed, so the job is loaded again from it and starts the launcher.
  const run = await macUpdate({ plist: root => plistOf31adfb7(root, bashPath()), loaded: true, to: '3.1.0' })
  assertStartsLauncher(plistOf(run.home), run.root)
  assertRestOfPlist(plistOf(run.home), run.root)
  assert.deepEqual(jobCalls(run.s), reload(run.home), run.out)
  assert.match(run.out, /Restarted\./)
  await assertAgentStarts(run.root, join(run.root, 'versions', 'v3.1.0'), plistOf(run.home))
  // Stopped: the plist moves, and the agent stays stopped.
  const stopped = await macUpdate({ plist: root => plistOf31adfb7(root, bashPath()), loaded: false, to: '3.1.0' })
  assertStartsLauncher(plistOf(stopped.home), stopped.root)
  assert.deepEqual(jobCalls(stopped.s), [], `the stopped agent was started:\n${stopped.out}`)
  assert.match(stopped.out, /The background agent is stopped, so it stays stopped/)
  // Already on the launcher: nothing changed, so nothing is restarted and nothing is said.
  const same = await macUpdate({ plist: onLauncher, loaded: true, launcher: exported.MAC_LAUNCHER as string, to: '3.1.0' })
  assert.equal(readFileSync(plistPath(same.home), 'utf8'), same.before)
  assert.deepEqual(jobCalls(same.s), [], same.out)
  assert.doesNotMatch(same.out, /Restarted|stopped|switched off/)
})

// R78A-2 (GitHub review of PR #78, the off switch kept): an owner who switched the "bash" item off (System Settings,
// General, Login Items & Extensions, or `launchctl disable`) had its plist rewritten to a new program by the guided
// installer and by --update, and the guided installer loaded it again. To macOS that can look like a new background
// item, which may start at the next login without the owner's word (LIVE if the database says so). Right: a job that
// launchd lists as switched off (`launchctl print-disabled`: "=> disabled", "=> true" on older macOS) is left as it
// is, plist and all, never loaded, restarted or switched on; the screen says so, that it keeps its old name, and how to
// switch it on. A job launchd lists as on is moved to the launcher as before.
const OLD = (root: string): string => plistOf31adfb7(root, bashPath())

test('R78A-2: ./install.sh --update leaves a job the owner switched off as it is, starts nothing and says how to switch it on', { timeout: 240_000 }, async () => {
  const cases: { listed: string; to: string; loaded: boolean }[] = [
    { listed: OFF, to: '3.2.0', loaded: false },
    { listed: OFF, to: '3.1.0', loaded: false },
    { listed: `"${LABEL}" => true`, to: '3.2.0', loaded: false },
    // `launchctl disable` alone leaves the job that runs loaded: it is not restarted or loaded again either.
    { listed: OFF, to: '3.2.0', loaded: true },
  ]
  for (const c of cases) {
    const u = await macUpdate({ plist: OLD, loaded: c.loaded, to: c.to, launchctl: launchctlWith({ listed: c.listed }) })
    const what = `${c.listed}, ${c.to}, ${c.loaded ? 'loaded' : 'not loaded'}`
    assert.equal(readFileSync(plistPath(u.home), 'utf8'), u.before, `${what}: the plist of a job switched off was rewritten`)
    assert.equal(existsSync(join(u.root, NAME)), false, what)
    assert.deepEqual(jobCalls(u.s), [], `${what}: nothing is loaded, restarted or switched on`)
    assert.match(u.out, /The background agent is switched off/, what)
    assert.match(u.out, /old name/, what)
    assert.ok(u.out.includes(switchOn(u.home)), `${what}: the commands that switch it on\n${u.out}`)
    if (c.to === '3.2.0') assert.match(u.out, /The new version runs from its next start/, what)
    assert.doesNotMatch(u.out, /Restarted\./, what)
  }
})

test('R78A-2: a job launchd lists as switched on is moved to the launcher and loaded again', { timeout: 240_000 }, async () => {
  const u = await macUpdate({ plist: OLD, loaded: true, launchctl: launchctlWith({ listed: `"${LABEL}" => enabled` }) })
  assertStartsLauncher(plistOf(u.home), u.root)
  assert.deepEqual(jobCalls(u.s), reload(u.home), u.out)
  assert.doesNotMatch(u.out, /switched off/)
  await assertAgentStarts(u.root, join(u.root, 'versions', 'v3.2.0'), plistOf(u.home))
})

test('R78A-2: running the installer again leaves a job the owner switched off as it is, plist and all, and says how to switch it on', { timeout: 240_000 }, async () => {
  const i = freshInstall()
  await macInstall(i)
  // The owner switched the "bash" item off in Login Items & Extensions: launchd lists it so and unloaded it.
  writeFileSync(plistPath(i.home), OLD(i.root))
  rmSync(join(i.root, NAME), { force: true })
  i.s.stub('launchctl', launchctlWith({ listed: OFF }))
  rmSync(join(i.s.dir, 'calls.log.loaded'), { force: true })
  const before = readFileSync(plistPath(i.home), 'utf8')
  let from = i.s.calls().length
  const r = await guided(i, ['', TEST_PORT, 'n', 'n'], { args: [] })
  assert.equal(r.status, 0, r.out.slice(-1500))
  assert.equal(readFileSync(plistPath(i.home), 'utf8'), before, 'the plist of a job switched off was rewritten')
  assert.equal(existsSync(join(i.root, NAME)), false)
  assert.deepEqual(jobCalls(i.s, from), [], 'nothing is loaded or switched on')
  assert.match(r.out, /The background agent is switched off/)
  assert.match(r.out, /old name/)
  assert.ok(r.out.includes(switchOn(i.home)), r.out)
  assert.doesNotMatch(r.out, /Running\./)
  assert.match(r.out, /Done/)
  // Still switched off after the uninstall took its plist: a new install writes none.
  rmSync(plistPath(i.home))
  from = i.s.calls().length
  const again = await guided(i, ['', TEST_PORT, 'n', 'n'], { args: [] })
  assert.equal(again.status, 0, again.out.slice(-1500))
  assert.equal(existsSync(plistPath(i.home)), false, 'a plist was written for a job switched off')
  assert.deepEqual(jobCalls(i.s, from), [])
  assert.ok(again.out.includes(`launchctl enable gui/$(id -u)/${LABEL}`), again.out)
  assert.match(again.out, /cd .* && \.\/install\.sh/)
})

test('R78A-2: when launchd cannot say whether the job is switched off, no plist is rewritten', { timeout: 240_000 }, async () => {
  // The guided installer stops in words before it writes anything.
  const i = freshInstall()
  await macInstall(i)
  writeFileSync(plistPath(i.home), OLD(i.root))
  rmSync(join(i.root, NAME), { force: true })
  i.s.stub('launchctl', launchctlWith({ fails: true }))
  const from = i.s.calls().length
  const r = await guided(i, ['', TEST_PORT, 'n', 'n'], { args: [] })
  assert.notEqual(r.status, 0, r.out.slice(-1500))
  assert.match(r.out, /Error: launchd could not be asked whether the background agent is switched off/)
  assert.match(r.out, /cd .* && \.\/install\.sh/)
  assert.equal(readFileSync(plistPath(i.home), 'utf8'), OLD(i.root))
  assert.equal(existsSync(join(i.root, NAME)), false)
  assert.deepEqual(jobCalls(i.s, from), [])
  // --update keeps the plist and restarts the agent that runs as before.
  const u = await macUpdate({ plist: OLD, loaded: true, launchctl: launchctlWith({ fails: true }) })
  assert.equal(readFileSync(plistPath(u.home), 'utf8'), u.before)
  assert.deepEqual(jobCalls(u.s), [`launchctl kickstart -k gui/${process.getuid!()}/${LABEL}`], u.out)
  assert.match(u.out, /Restarted\./)
})

// A guard: Linux and Windows (WSL is Linux) stay as they were.
test('MAC-1: Linux gets no launcher and its unit starts bash with run.sh as before', { timeout: 240_000 }, async () => {
  const i = freshInstall()
  i.s.stub('curl', 'exit 0')
  writeFileSync(join(i.root, '.env'), LOGIN_LINES, { mode: 0o600 })
  const r = await guided(i, ['yes', '', TEST_PORT, 'n', 'n'], { args: [] })
  assert.equal(r.status, 0, r.out.slice(-1500))
  const unit = readFileSync(join(i.home, '.config', 'systemd', 'user', 'foxleague-agent.service'), 'utf8')
  assert.match(unit, new RegExp(`^ExecStart="${bashPath()}" "${join(i.root, 'run.sh')}"$`, 'm'))
  assert.equal(existsSync(join(i.root, NAME)), false)
  assert.equal(existsSync(join(i.home, 'Library')), false)
})

test('MAC-1: the guides name the background item as macOS shows it, and a git checkout ignores the launcher', () => {
  const page = readFileSync(join(REPO, 'site', 'src', 'content', 'docs', 'start', 'install-mac.mdx'), 'utf8')
  assert.match(page, /macOS shows the agent as "FoxLeague Agent" in[^.]*Login Items & Extensions/)
  const guide = readFileSync(join(REPO, 'INSTALL.md'), 'utf8')
  const mac = guide.slice(guide.indexOf('### On a Mac'), guide.indexOf('### On Linux'))
  assert.match(mac, /"FoxLeague Agent"[^.]*Login Items & Extensions/)
  assert.match(readFileSync(join(REPO, 'README.md'), 'utf8'), /"FoxLeague Agent"[^.]*Login Items & Extensions/)
  assert.ok(readFileSync(join(REPO, '.gitignore'), 'utf8').split('\n').includes(`/${NAME}`), 'the launcher of a checkout is the install\'s, not the code\'s')
})
