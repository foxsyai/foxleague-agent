// The disk side of an update, for an install made by get.sh (run.sh describes the layout):
//   stage    unpack a verified archive next to the running release and let THAT release's own install.sh prepare it
//   activate point versions/active at it and leave a note for the launcher (versions/pending)
//   confirm  the new release is up: drop the note; or learn that the launcher undid the update
// The running release is never written to, so a failed download, unpack or prepare leaves the agent as it was.
// The old code only fetches, verifies and unpacks; every later step belongs to the new release (install.sh
// --prepare), so the way an update is installed can itself be changed by an update.

import { spawn } from 'node:child_process'
import { accessSync, chmodSync, closeSync, constants, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
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
      : 'this install was not made by the one-line installer: paste the install line again once, and later updates are one click'
  }
  try {
    accessSync(join(layout.root, 'versions'), constants.W_OK)
  } catch {
    return 'the agent may not write to its own folder: update it in a terminal with ./install.sh --update'
  }
  return null
}

/** A lock older than this was left by an update that was killed (preparing takes at most 15 minutes). */
const LOCK_STALE_MS = 30 * 60_000

export interface RunResult {
  code: number | null
  /** The last lines of what the command printed, for an error message. */
  tail: string
  /** Its standard output, up to 4 MB (a listing); empty beyond that. */
  out: string
}
export type Runner = (cmd: string, args: string[], o: { cwd: string; env: Record<string, string>; timeoutMs: number }) => Promise<RunResult>

/** Runs a command and keeps the tail of its output. No shell: the arguments are passed as they are. */
export const run: Runner = (cmd, args, o) =>
  new Promise(done => {
    let tail = ''
    let out = ''
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
    child.stderr.on('data', keep)
    child.on('error', err => done({ code: null, tail: err.message, out: '' }))
    child.on('close', code => done({ code, tail: tail.trim(), out: tooMuch ? '' : out }))
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
 * Unpacks a verified archive into versions/v<version> and has the new release prepare itself (its own
 * `install.sh --prepare`: Node, dependencies, the recovery words check, the launcher). Returns the folder's name.
 * Throws UpdateError and leaves nothing behind when a step fails.
 */
export async function stage(layout: Layout, manifest: Manifest, archive: string, o: { run?: Runner; env?: Record<string, string> } = {}): Promise<string> {
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
    let age = Infinity
    try {
      age = Date.now() - statSync(lock).mtimeMs
    } catch {
      // gone again: the other update just ended
    }
    if (age < LOCK_STALE_MS) throw new UpdateError('another update is being installed right now')
    writeFileSync(lock, '', { mode: 0o600 }) // left by an update that was killed: taken over
  }
  const clean = (): void => rmSync(staging, { recursive: true, force: true })
  const fail = (why: string): never => {
    clean()
    rmSync(lock, { force: true })
    throw new UpdateError(why)
  }
  clean()
  const listing = await exec('tar', ['-tzf', archive], { cwd: versions, env, timeoutMs: 60_000 })
  if (listing.code !== 0) return fail('the archive could not be read')
  if (!archivePathsSafe(listing.out)) return fail('the archive holds a path outside its own folder')
  mkdirSync(staging, { recursive: true, mode: 0o700 })
  const unpack = await exec('tar', ['-xzf', archive, '-C', staging, '--strip-components=1'], { cwd: versions, env, timeoutMs: 120_000 })
  if (unpack.code !== 0) return fail('the archive could not be unpacked')
  let pkg: { name?: unknown; version?: unknown }
  try {
    pkg = JSON.parse(readFileSync(join(staging, 'package.json'), 'utf8')) as typeof pkg
  } catch {
    return fail('the archive is not a foxleague-agent release')
  }
  if (pkg.name !== RELEASE_NAME || pkg.version !== manifest.version) return fail('the archive holds another version than its signed manifest says')
  if (!existsSync(join(staging, 'install.sh')) || !existsSync(join(staging, 'src', 'service.ts'))) return fail('the archive is not a foxleague-agent release')
  const prepared = await exec('bash', [join(staging, 'install.sh'), '--prepare'], { cwd: staging, env, timeoutMs: 15 * 60_000 })
  if (prepared.code !== 0) return fail(`the new version could not be prepared, nothing was changed${prepared.tail ? `: ${prepared.tail.split('\n').slice(-3).join(' | ')}` : ''}`)
  rmSync(target, { recursive: true, force: true }) // what an earlier attempt that was undone left there
  renameSync(staging, target)
  rmSync(lock, { force: true })
  return name
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
 */
export function confirmStart(layout: Layout): void {
  if (!layout.managed) return
  const versions = join(layout.root, 'versions')
  const me = basename(layout.code)
  const pending = readLine(join(versions, 'pending'))?.split(' ') ?? []
  const previous = pending[1] === me && NAME_RE.test(pending[0] ?? '') ? pending[0]! : readLine(join(versions, 'previous'))
  rmSync(join(versions, 'pending'), { force: true })
  rmSync(join(versions, 'rolled-back'), { force: true })
  if (previous && previous !== me && NAME_RE.test(previous)) writeAtomic(join(versions, 'previous'), `${previous}\n`)
  for (const entry of readdirSync(versions, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === me || entry.name === previous) continue
    if (entry.name.startsWith('v') || entry.name.startsWith('.staging-')) rmSync(join(versions, entry.name), { recursive: true, force: true })
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

/**
 * Once a new release is confirmed: its launcher, its command line (cli.sh) and its installer's entry replace the
 * ones in the install's folder. By rename, never in place, so a script that is running keeps reading the file it started from.
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
  return changed
}
