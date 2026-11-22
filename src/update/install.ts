// The disk side of an update, for an install made by get.sh (run.sh describes the layout):
//   stage    unpack a verified archive next to the running release and let THAT release's own install.sh prepare it
//   activate point versions/active at it and leave a note for the launcher (versions/pending)
//   confirm  the new release is up: drop the note; or learn that the launcher undid the update
// The running release is never written to, so a failed download, unpack or prepare leaves the agent as it was.
// The old code only fetches, verifies and unpacks; every later step belongs to the new release (install.sh
// --prepare), so the way an update is installed can itself be changed by an update.

import { spawn } from 'node:child_process'
import { accessSync, chmodSync, closeSync, constants, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RELEASE_NAME, UpdateError, parseVersion, type Manifest } from './release.ts'

/** The folder of the code that is running (where package.json is). */
export const CODE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export interface Layout {
  /** The install's folder: .env, data/, pem/ and, when managed, versions/. */
  root: string
  /** The folder of the running code. */
  code: string
  /** True for an install made by get.sh: releases live in root/versions and versions/active names this one. */
  managed: boolean
}

export function installedVersion(code = CODE_DIR): string {
  try {
    const pkg = JSON.parse(readFileSync(join(code, 'package.json'), 'utf8')) as { version?: unknown }
    return typeof pkg.version === 'string' ? pkg.version : '?'
  } catch {
    return '?'
  }
}

function readLine(path: string): string | null {
  try {
    return readFileSync(path, 'utf8').split('\n')[0]!.trim()
  } catch {
    return null
  }
}

export function detectLayout(code = CODE_DIR): Layout {
  const versions = dirname(code)
  const managed = basename(versions) === 'versions' && readLine(join(versions, 'active')) === basename(code)
  return managed ? { root: dirname(versions), code, managed } : { root: code, code, managed: false }
}

/** Why this install cannot update itself, in words for the owner; null when it can. */
export function selfUpdateRefusal(layout: Layout, o: { isServer?: boolean } = {}): string | null {
  if (o.isServer) return 'this agent runs on a server set up by hand: update it the way it was deployed'
  if (!layout.managed) {
    return existsSync(join(layout.code, '.git'))
      ? 'this install is a git checkout: update it in a terminal with ./install.sh --update'
      : 'this install was not made by the one-line installer: paste the install line again once; later updates are one click'
  }
  try {
    accessSync(join(layout.root, 'versions'), constants.W_OK)
  } catch {
    // Not "update it in a terminal" (INS-A7): the terminal's update runs as the same user, asks the same question
    // and answered with this sentence again. What helps is making the folder the user's own again.
    return `the agent may not write to its own folder: make it yours again in a terminal with ${ownFolderCommand(layout.root)} and then update again`
  }
  return null
}

/** The command that makes an install's folder its user's own again, writable by them (another owner after sudo, a backup). */
export function ownFolderCommand(root: string, user: string | null = currentUser()): string {
  const who = user && /^[A-Za-z0-9._-]+$/.test(user) ? user : '"$USER"'
  return `sudo chown -R ${who} "${root}" && chmod -R u+rwX "${root}"`
}

function currentUser(): string | null {
  try {
    return userInfo().username
  } catch {
    return null
  }
}

/** A lock older than this was left by an update that was killed (preparing takes at most 15 minutes). */
const LOCK_STALE_MS = 30 * 60_000
/**
 * Whether a lock made at `mtimeMs` is held by an update that runs now: within LOCK_STALE_MS either side of the clock.
 * One further in the future was not made on this clock (a machine whose clock ran ahead, set right later) and would
 * otherwise stay fresh until the clock passed it (audit 2026-11-16, U5 of the final pass).
 */
const lockFresh = (mtimeMs: number): boolean => Math.abs(Date.now() - mtimeMs) < LOCK_STALE_MS

export interface RunResult {
  code: number | null
  /** The last lines of what the command printed, for an error message. */
  tail: string
  /** Its standard output, up to 4 MB (a listing); empty beyond that. */
  out: string
  /** The first 4 KB of its error output: where a command that fails on many files says why (W-10). */
  err?: string
}
export type Runner = (cmd: string, args: string[], o: { cwd: string; env: Record<string, string>; timeoutMs: number }) => Promise<RunResult>

/** Runs a command and keeps the tail of its output. No shell: the arguments are passed as they are. */
export const run: Runner = (cmd, args, o) =>
  new Promise(done => {
    let tail = ''
    let out = ''
    let err = ''
    let tooMuch = false
    const keep = (b: Buffer) => (tail = (tail + b.toString('utf8')).slice(-1500))
    let child
    try {
      child = spawn(cmd, args, { cwd: o.cwd, env: o.env, stdio: ['ignore', 'pipe', 'pipe'], timeout: o.timeoutMs, killSignal: 'SIGKILL' })
    } catch (err) {
      return done({ code: null, tail: err instanceof Error ? err.message : String(err), out: '' })
    }
    child.stdout.on('data', (b: Buffer) => {
      keep(b)
      if (out.length + b.length > 4 * 1024 * 1024) tooMuch = true
      else out += b.toString('utf8')
    })
    child.stderr.on('data', (b: Buffer) => {
      keep(b)
      if (err.length < 4096) err = (err + b.toString('utf8')).slice(0, 4096)
    })
    child.on('error', e => done({ code: null, tail: e.message, out: '', err: e.message }))
    child.on('close', code => done({ code, tail: tail.trim(), out: tooMuch ? '' : out, err }))
  })

/**
 * The environment of the commands an update runs: the system's own variables and nothing of the agent's.
 * The service's environment holds the recovery words and the API keys (from .env): none of it is passed on.
 */
export function childEnv(root: string, from: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = { FOXAGENT_ROOT: root, PATH: `${dirname(process.execPath)}:${from.PATH ?? '/usr/local/bin:/usr/bin:/bin'}` }
  for (const k of ['HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'SHELL']) {
    const v = from[k]
    if (v !== undefined) env[k] = v
  }
  return env
}

/** Every path in the archive sits under one top folder and none climbs out of it. */
function archivePathsSafe(listing: string): boolean {
  const lines = listing.split('\n').filter(Boolean)
  if (!lines.length) return false
  const top = lines[0]!.split('/')[0]!
  return NAME_RE.test(top) && lines.every(l => !l.startsWith('/') && l.split('/')[0] === top && !l.split('/').includes('..'))
}

/**
 * A release holds plain files and folders only. Read from `tar -tv`, whose lines start with the entry's kind in
 * GNU tar and in bsdtar alike: `-` a file, `d` a folder; `l` a symbolic link, `h` a hard link, `c`, `b` and `p`
 * a device or a pipe. A link could point out of the release folder, at the owner's .env or at a system file.
 */
function archiveOnlyFilesAndFolders(verbose: string): boolean {
  const lines = verbose.split('\n').filter(Boolean)
  return lines.length > 0 && lines.every(l => (l[0] === '-' || l[0] === 'd') && !l.includes(' -> ') && !l.includes(' link to '))
}

/**
 * A path, inside the release folder, that belongs to an install and never to a release: the env file, the data
 * and PEM folders, keys, installed dependencies and the private Node.js. An archive that holds one was packed
 * from a folder in use; it is refused whole (the release's own .env.example is not such a path).
 */
function ownersPath(rel: string): boolean {
  const parts = rel.split('/').filter(Boolean)
  if (!parts.length) return false
  if (parts[0] === 'data' || parts[0] === 'pem' || parts[0] === 'keys') return true
  return parts.some(p => p === '.env' || p === '.node' || p === 'node_modules' || (p.startsWith('.env.') && p !== '.env.example') || p.endsWith('.pem'))
}

/**
 * Why an archive could not be unpacked, in words for the owner, with tar's own first line; its first lines go to the
 * log (W-10: the first lines name the path and the reason, the many after them repeat it for every file).
 * Ubuntu 26.04's tar resolves each path with openat2, which a service started with RestrictSUIDSGID=true is refused
 * with ENOSYS ("Function not implemented"); the 24.04 one falls back to openat. The installers of 2026-11-14 and
 * later write no such line and `./install.sh --update` takes it out of an older unit: an update from the dashboard
 * runs inside that unit, one from a terminal does not (W-9). That failure is marked `terminal` (W-15b) and, under WSL,
 * says how to open Ubuntu from PowerShell: "a terminal" on Windows is not where the owner types.
 */
function unpackFailure(r: RunResult, root: string, wsl: string | null): { message: string; terminal: boolean } {
  const lines = (r.err ?? r.tail).split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length) console.error(`the update's archive could not be unpacked; tar said:\n${lines.slice(0, 8).join('\n')}`)
  const first = lines[0]?.replace(/^\S*tar: /, '').slice(0, 200)
  const said = first ? ` (tar: ${first})` : ''
  if (lines.some(l => /Function not implemented/.test(l))) {
    // Marked (W-15b): the cause is the service, not the release, so a click on Update now would fail the same way.
    const hint = wsl === null ? '' : `. ${windowsHint(wsl, root, process.env.HOME)}`
    return { message: `this system's tar cannot unpack inside the agent's background service as an older installer set it up${said}. Run ./install.sh --update once in a terminal, in the agent's folder: that installs it and renews the service, so later updates are one click again${hint}`, terminal: true }
  }
  return { message: `the archive could not be unpacked${said}`, terminal: false }
}

/**
 * The WSL distribution this agent runs in, or null outside WSL (W-15b). A terminal under WSL has WSL_DISTRO_NAME; the
 * agent's service does not (systemd starts it, not wsl.exe), so the kernel's name tells, and the distribution is then
 * the one get.ps1 installs. A kernel name that cannot be read is not WSL: the message stays the one for Linux.
 */
export function wslDistro(env: Record<string, string | undefined> = process.env, osrelease: string | null = readLine('/proc/sys/kernel/osrelease')): string | null {
  const wsl = osrelease !== null && /microsoft|wsl/i.test(osrelease)
  const named = env.WSL_DISTRO_NAME
  if (named && NAME_RE.test(named)) return named
  return wsl ? 'Ubuntu' : null
}

/** How the owner reaches the agent's folder from Windows: PowerShell, Ubuntu's home, then the folder (W-15b). */
export function windowsHint(distro: string, root: string, home: string | undefined): string {
  const folder = home && root.startsWith(`${home.replace(/\/+$/, '')}/`) ? root.slice(home.replace(/\/+$/, '').length + 1) : root
  return `On Windows: open PowerShell and type wsl -d ${distro} --cd ~ , then cd ${folder}`
}

/** A command's output as plain lines for the owner: no terminal colour or other control bytes, no empty lines. */
function plainLines(text: string): string[] {
  return text
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
}

/**
 * Unpacks a verified archive into versions/v<version> and has the new release prepare itself (its own
 * `install.sh --prepare`: Node, dependencies, the recovery words check, the launcher). Returns the folder's name.
 * Throws UpdateError when a step fails, or the file system's own error (a full disk, a folder that cannot be
 * written), and leaves nothing behind either way: no staging folder and no lock (R69A-1).
 */
export async function stage(layout: Layout, manifest: Manifest, archive: string, o: { run?: Runner; env?: Record<string, string>; /** Left out: wslDistro(). */ wsl?: string | null } = {}): Promise<string> {
  if (!layout.managed) throw new UpdateError('this install cannot update itself')
  if (!parseVersion(manifest.version)) throw new UpdateError('the release has no plain version')
  const exec = o.run ?? run
  const env = o.env ?? childEnv(layout.root)
  const versions = join(layout.root, 'versions')
  const name = `v${manifest.version}`
  const target = join(versions, name)
  const staging = join(versions, `.staging-${name}`)
  if (resolve(target) === resolve(layout.code)) throw new UpdateError('that release is the one already running')
  // One update at a time on an install: the dashboard, Telegram and a terminal may all ask.
  const lock = join(versions, 'update.lock')
  try {
    closeSync(openSync(lock, 'wx', 0o600))
  } catch {
    let fresh = false
    try {
      fresh = lockFresh(statSync(lock).mtimeMs)
    } catch {
      // gone again: the other update just ended
    }
    if (fresh) throw new UpdateError('another update is being installed right now')
    writeFileSync(lock, '', { mode: 0o600 }) // left by an update that was killed: taken over
  }
  // From here the lock is this call's. Every way out releases it (R69A-1): a refusal, a file call that throws (a full
  // disk, a folder that cannot be written) and success alike. Before, a throw outside the refusals left it, and every
  // update for the next 30 minutes was refused as "another update is being installed right now".
  const clean = (): void => rmSync(staging, { recursive: true, force: true })
  const fail = (why: string, terminal = false): never => {
    throw new UpdateError(why, { terminal })
  }
  try {
    clean()
    const listing = await exec('tar', ['-tzf', archive], { cwd: versions, env, timeoutMs: 60_000 })
    if (listing.code !== 0) return fail('the archive could not be read')
    if (!archivePathsSafe(listing.out)) return fail('the archive holds a path outside its own folder')
    if (listing.out.split('\n').some(l => ownersPath(l.split('/').slice(1).join('/')))) return fail('the archive holds files that belong to an install, not to a release (.env, data, pem, keys, node_modules or .node)')
    const kinds = await exec('tar', ['-tvzf', archive], { cwd: versions, env, timeoutMs: 60_000 })
    if (kinds.code !== 0) return fail('the archive could not be read')
    if (!archiveOnlyFilesAndFolders(kinds.out)) return fail('the archive holds something that is not a plain file or folder (a link or a special file)')
    mkdirSync(staging, { recursive: true, mode: 0o700 })
    // In the C language whatever the owner's: tar's reason is read below.
    const unpack = await exec('tar', ['-xzf', archive, '-C', staging, '--strip-components=1'], { cwd: versions, env: { ...env, LC_ALL: 'C' }, timeoutMs: 120_000 })
    if (unpack.code !== 0) {
      const why = unpackFailure(unpack, layout.root, o.wsl === undefined ? wslDistro() : o.wsl)
      return fail(why.message, why.terminal)
    }
    let pkg: { name?: unknown; version?: unknown }
    try {
      pkg = JSON.parse(readFileSync(join(staging, 'package.json'), 'utf8')) as typeof pkg
    } catch {
      return fail('the archive is not a foxleague-agent release')
    }
    if (pkg.name !== RELEASE_NAME || pkg.version !== manifest.version) return fail('the archive holds another version than its signed manifest says')
    if (!existsSync(join(staging, 'install.sh')) || !existsSync(join(staging, 'src', 'service.ts'))) return fail('the archive is not a foxleague-agent release')
    const prepared = await exec('bash', [join(staging, 'install.sh'), '--prepare'], { cwd: staging, env, timeoutMs: 15 * 60_000 })
    if (prepared.code !== 0) {
      // The installer's words only (UPD-A6): its die() colours the line for a terminal and puts an empty line before
      // it, and this reason is read on Telegram and in the dashboard.
      const said = plainLines(prepared.tail).slice(-3).join(' | ')
      return fail(`the new version could not be prepared, nothing was changed${said ? `: ${said}` : ''}`)
    }
    rmSync(target, { recursive: true, force: true }) // what an earlier attempt that was undone left there
    renameSync(staging, target)
    return name
  } finally {
    // After success the staging folder is the release's folder by now, so this finds nothing to remove. A staging
    // folder that cannot be removed is said in the log, not thrown: the reason the update stopped is the one to tell,
    // and the lock goes anyway (the next update and confirmStart try the folder again).
    try {
      clean()
    } catch (err) {
      console.error('the staging folder of the update could not be removed:', err)
    }
    rmSync(lock, { force: true })
  }
}

function writeAtomic(path: string, text: string): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, text, { mode: 0o600 })
  renameSync(tmp, path)
}

/** Points the install at a staged release. The launcher starts it at the next start and undoes it if it does not come up. */
export function activate(layout: Layout, to: string): void {
  if (!layout.managed) throw new UpdateError('this install cannot update itself')
  if (!NAME_RE.test(to) || !existsSync(join(layout.root, 'versions', to, 'src', 'service.ts'))) throw new UpdateError('the new version is not in place')
  const versions = join(layout.root, 'versions')
  rmSync(join(versions, 'rolled-back'), { force: true })
  // The note first: a crash between the two writes leaves a note for a switch that never happened, which the
  // next start of the old release clears (confirmStart), never a switch without its note.
  writeAtomic(join(versions, 'pending'), `${basename(layout.code)} ${to} 0\n`)
  writeAtomic(join(versions, 'active'), `${to}\n`)
}

/**
 * A release that is in place and is not the one running: versions/active names it and its code is there. It runs
 * from the agent's next start. Null when the running release is the active one, or when the file cannot be read.
 */
export function waitingRelease(layout: Layout): string | null {
  if (!layout.managed) return null
  const versions = join(layout.root, 'versions')
  const active = readLine(join(versions, 'active'))
  if (!active || active === basename(layout.code) || !NAME_RE.test(active)) return null
  return existsSync(join(versions, active, 'src', 'service.ts')) ? active : null
}

export interface StartNote {
  /** This start is the first of a new release: the release that ran before. */
  updatedFrom?: string
  /** The launcher undid an update because it did not start: what was tried. */
  rolledBack?: { to: string }
}

/** What the last update left for this start, read without changing anything. */
export function startNote(layout: Layout): StartNote {
  if (!layout.managed) return {}
  const versions = join(layout.root, 'versions')
  const me = basename(layout.code)
  const note: StartNote = {}
  const back = readLine(join(versions, 'rolled-back'))?.split(' ')
  if (back && back.length === 2 && back[0] === me && NAME_RE.test(back[1]!)) note.rolledBack = { to: back[1]! }
  const pending = readLine(join(versions, 'pending'))?.split(' ')
  if (pending && pending.length === 3 && pending[1] === me && NAME_RE.test(pending[0]!)) note.updatedFrom = pending[0]!
  return note
}

/**
 * The running release is up: the update holds. Drops the launcher's note, the undo note it has told and every
 * release folder but this one and the one before it (kept so the next update can still be undone).
 * A release that was put in place while this one runs (`./install.sh --update` or the pasted line inside the 45
 * seconds before the confirm, UPD-U1) is not this start's to judge: the folder versions/active names and the note
 * that goes with it stay for the launcher's next start.
 */
export function confirmStart(layout: Layout): void {
  if (!layout.managed) return
  const versions = join(layout.root, 'versions')
  const me = basename(layout.code)
  const pending = readLine(join(versions, 'pending'))?.split(' ') ?? []
  const previous = pending[1] === me && NAME_RE.test(pending[0] ?? '') ? pending[0]! : readLine(join(versions, 'previous'))
  const active = readLine(join(versions, 'active'))
  const waiting = active && active !== me && NAME_RE.test(active) && existsSync(join(versions, active, 'src', 'service.ts')) ? active : null
  // A note for that switch stays. Any other note is this start's own or one left by a switch that never happened.
  if (!(waiting && pending[1] === waiting)) rmSync(join(versions, 'pending'), { force: true })
  rmSync(join(versions, 'rolled-back'), { force: true })
  if (previous && previous !== me && NAME_RE.test(previous)) writeAtomic(join(versions, 'previous'), `${previous}\n`)
  // An update in flight (stage() holds versions/update.lock while it unpacks and prepares, a minute or more with npm):
  // the folder it prepares in and the release it puts in place are not this start's to remove (R2I-8). The next start
  // removes what is left.
  if (updateInFlight(versions)) return
  for (const entry of readdirSync(versions, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === me || entry.name === previous || entry.name === waiting) continue
    if (entry.name.startsWith('v') || entry.name.startsWith('.staging-')) rmSync(join(versions, entry.name), { recursive: true, force: true })
  }
}

/** Whether an update holds versions/update.lock now: a fresh one (lockFresh; an older one was left by a kill). */
function updateInFlight(versions: string): boolean {
  try {
    return lockFresh(statSync(join(versions, 'update.lock')).mtimeMs)
  } catch {
    return false
  }
}

/** What <root>/install.sh is on an install made by get.sh: it hands over to the installer of the release that runs. */
export const INSTALL_SHIM = `#!/usr/bin/env bash
# foxleague-agent: runs the installer of the release that is active (./install.sh --update, --uninstall, --help).
ROOT=$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)
active=$(head -n 1 "$ROOT/versions/active" 2>/dev/null || true)
case "$active" in '' | .* | *[!A-Za-z0-9._-]*) echo "foxleague-agent: versions/active does not name a release; paste the install line again" >&2; exit 1 ;; esac
FOXAGENT_ROOT="$ROOT" exec bash "$ROOT/versions/$active/install.sh" "$@"
`

/** The file name of the program the background agent of a Mac starts: macOS lists the agent by it (MAC-1). */
export const MAC_LAUNCHER_NAME = 'FoxLeague Agent'

/**
 * What <root>/FoxLeague Agent is on a Mac, the program the launchd job starts; install.sh writes the same text
 * (mac_launcher_text). macOS names a background item after the program its job starts when no app goes with it: the
 * plist once started bash, and Login Items & Extensions listed the agent as "bash" (MAC-1).
 */
export const MAC_LAUNCHER = `#!/bin/bash
# foxleague-agent on a Mac: the program its background agent starts (launchd, ai.foxleague.agent in
# ~/Library/LaunchAgents). macOS names the background item after this file, so System Settings shows it as
# "FoxLeague Agent" under General, Login Items & Extensions. It starts run.sh of its own folder, in its own process.
ROOT=$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd) || exit 1
exec /bin/bash "$ROOT/run.sh" "$@"
`

/**
 * Once a new release is confirmed: its launcher, its command line (cli.sh) and its installer's entry replace the
 * ones in the install's folder. By rename, never in place, so a script that is running keeps reading the file it started from.
 * On a Mac the program the background agent starts (MAC_LAUNCHER) is refreshed too, where the installer put one: Linux
 * has none, and a Mac whose plist still starts bash gets it from its next ./install.sh or ./install.sh --update.
 * Returns the names it replaced.
 */
export function refreshLauncher(layout: Layout): string[] {
  if (!layout.managed) return []
  const changed: string[] = []
  const put = (name: string, text: string): void => {
    const dest = join(layout.root, name)
    let now: string | null = null
    try {
      now = readFileSync(dest, 'utf8')
    } catch {
      // not there yet
    }
    if (now === text) return
    const tmp = `${dest}.new`
    writeFileSync(tmp, text, { mode: 0o755 })
    chmodSync(tmp, 0o755)
    renameSync(tmp, dest)
    changed.push(name)
  }
  for (const name of ['run.sh', 'cli.sh', 'get.sh']) {
    try {
      put(name, readFileSync(join(layout.code, name), 'utf8'))
    } catch {
      // a release without that file keeps the one in place
    }
  }
  put('install.sh', INSTALL_SHIM)
  if (existsSync(join(layout.root, MAC_LAUNCHER_NAME))) put(MAC_LAUNCHER_NAME, MAC_LAUNCHER)
  return changed
}
