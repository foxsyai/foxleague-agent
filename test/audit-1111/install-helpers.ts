// Helpers for the installer findings of the audit of 2026-11-11 (INSTALL-n): the real get.sh, install.sh, run.sh
// and cli.sh, run in a throwaway HOME. npm, systemctl, loginctl, launchctl and curl are stand-ins on the PATH; the
// installer's questions are answered through FOXAGENT_TTY. Nothing here reaches the network or the real HOME.
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync, writeSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { INSTALL_SHIM } from '../../src/update/install.ts'
import { REPO, codeTree, testKey, tmp } from '../update-fixtures.ts'

export const KEY = testKey()
export const NPM_CI = 'npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error'

export interface Stubs {
  dir: string
  calls: () => string[]
  /** Replaces one stand-in (a bash body). `$LOG` is the calls file. */
  stub: (name: string, body: string) => void
}

/** Stand-ins: npm (notes where it ran and links the real dependencies), systemctl, loginctl and launchctl (note their arguments). */
export function stubs(o: { node?: boolean; npm?: boolean } = {}): Stubs {
  const dir = tmp('fox-stubs-')
  const log = join(dir, 'calls.log')
  const stub = (name: string, body: string): void => {
    writeFileSync(join(dir, name), `#!/usr/bin/env bash\nLOG=${JSON.stringify(log)}\n${body}\n`)
    chmodSync(join(dir, name), 0o755)
  }
  if (o.npm !== false) stub('npm', `printf 'npm %s in %s\\n' "$*" "$PWD" >> "$LOG"\n[ -e node_modules ] || ln -s ${JSON.stringify(join(REPO, 'node_modules'))} node_modules`)
  stub('loginctl', `printf 'loginctl %s\\n' "$*" >> "$LOG"`)
  // As launchd: `print` of the job answers between a bootstrap and a bootout (its status 113: not loaded).
  stub('launchctl', `printf 'launchctl %s\\n' "$*" >> "$LOG"\ncase "$1" in bootstrap) : > "$LOG.loaded" ;; bootout) rm -f "$LOG.loaded" ;; print) [ -f "$LOG.loaded" ] || exit 113 ;; esac`)
  // As the real one: `is-active` of a service that does not run ends with status 3; everything else goes through.
  stub('systemctl', `printf 'systemctl %s\\n' "$*" >> "$LOG"\ncase "$*" in *is-active*) exit 3 ;; esac`)
  // No stand-in ever lets curl out: a test that needs a download gives its own curl.
  stub('curl', `printf 'curl %s\\n' "$*" >> "$LOG"\necho "curl stand-in: no network in a test" >&2\nexit 6`)
  // The installer puts its Node's folder first on the PATH: with Node found here, the stand-in npm is the one it runs.
  if (o.node !== false) symlinkSync(process.execPath, join(dir, 'node'))
  return { dir, stub, calls: () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []) }
}

/** The system's tools without any Node.js or npm: a folder of links to /usr/bin and /bin, for a PATH of its own. */
export function systemTools(): string {
  const dir = tmp('fox-sys-')
  for (const from of ['/bin', '/usr/bin']) {
    for (const name of readdirSync(from)) {
      if (/^(node|nodejs|npm|npx|corepack)$/.test(name) || existsSync(join(dir, name))) continue
      try {
        symlinkSync(join(from, name), join(dir, name))
      } catch {
        // a name that cannot be linked is not a tool the scripts use
      }
    }
  }
  return dir
}

/** The real code as a release folder: src, the scripts and package.json at the given version, with the test key pinned. */
export function realTree(dir: string, version: string): string {
  mkdirSync(dir, { recursive: true })
  cpSync(join(REPO, 'src'), join(dir, 'src'), { recursive: true, filter: p => !p.includes(`${join('src', 'local')}`) })
  for (const f of ['install.sh', 'get.sh', 'run.sh', 'cli.sh', 'package-lock.json']) if (existsSync(join(REPO, f))) cpSync(join(REPO, f), join(dir, f))
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as Record<string, unknown>
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ ...pkg, version }, null, 2) + '\n')
  writeFileSync(join(dir, 'src', 'update', 'keys.ts'), `export const RELEASE_KEYS: readonly string[] = [${JSON.stringify(KEY.publicPem)}]\n`)
  return dir
}

export interface Ran {
  status: number
  out: string
}

// Not spawnSync: a release server may live in this process and must answer while the script runs.
export function sh(script: string, args: string[], env: Record<string, string>, o: { stdin?: string | Buffer; cwd?: string; timeoutMs?: number; stopWhen?: () => boolean } = {}): Promise<Ran> {
  return new Promise(done => {
    let out = ''
    // Its own process group, ended as a whole when the time is up: a question that waits for an answer waits in
    // a subshell, which would otherwise keep the output open after bash itself was stopped.
    const child = spawn('bash', script ? [script, ...args] : args, { cwd: o.cwd, env: { PATH: process.env.PATH ?? '', ...env }, stdio: [o.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], detached: true })
    const timer = setTimeout(() => {
      out += '\n[the test ended this run: it took too long]\n'
      try {
        process.kill(-child.pid!, 'SIGKILL')
      } catch {
        // already gone
      }
    }, o.timeoutMs ?? 120_000)
    // The owner closes the terminal: the run is ended as soon as the test's condition holds.
    const watch = o.stopWhen
      ? setInterval(() => {
          if (!o.stopWhen!()) return
          clearInterval(watch)
          try {
            process.kill(-child.pid!, 'SIGKILL')
          } catch {
            // already gone
          }
        }, 50)
      : undefined
    child.on('close', () => {
      clearTimeout(timer)
      clearInterval(watch)
    })
    if (o.stdin !== undefined) {
      child.stdin!.on('error', () => undefined) // a script that ends early closes its end
      child.stdin!.end(o.stdin)
    }
    child.stdout!.on('data', (b: Buffer) => (out += b.toString('utf8')))
    child.stderr!.on('data', (b: Buffer) => (out += b.toString('utf8')))
    child.on('close', code => done({ status: code ?? -1, out: out.replace(/\x1b\[[0-9;]*m/g, '') }))
  })
}

/**
 * The owner's keyboard: a named pipe that FOXAGENT_TTY points at, holding one line per question in the order the
 * installer asks them. Each question opens it and reads one line. A question past the last answer waits (and the
 * run then ends by its timeout), so a test never answers a question it did not expect.
 */
export function answers(lines: string[]): { tty: string; left: () => number; close: () => void } {
  const tty = join(tmp('fox-tty-'), 'tty')
  execFileSync('mkfifo', [tty])
  const fd = openSync(tty, 'r+')
  if (lines.length) writeSync(fd, lines.map(l => `${l}\n`).join(''))
  // FIONREAD has no binding here: the answers still unread are counted by a reader that does not wait.
  const left = (): number => Number(execFileSync('bash', ['-c', 'n=0; while IFS= read -r -t 0.2 _; do n=$((n+1)); done < "$0"; echo $n', tty], { encoding: 'utf8' }).trim())
  return { tty, left, close: () => closeSync(fd) }
}

export interface Install {
  home: string
  root: string
  /** The release folder that runs. */
  code: string
  s: Stubs
  env: Record<string, string>
  /** Where the stand-in Node.js notes that the recovery words were shown. */
  shownLog: string
  wordsShown: () => number
}

/**
 * An install as get.sh leaves it before the installer runs: root/versions/v<version> with the real code,
 * versions/active and a private Node.js in root/.node. That Node.js is the real one behind a wrapper with one
 * difference: `backup-words` (which prints only to a terminal, and a test has none) notes that the words were
 * shown instead of printing them.
 */
export function freshInstall(version = '3.1.0', o: { service?: boolean } = {}): Install {
  const s = stubs()
  const home = tmp('fox-home-')
  const root = join(home, 'foxleague-agent')
  const code = realTree(join(root, 'versions', `v${version}`), version)
  symlinkSync(join(REPO, 'node_modules'), join(code, 'node_modules'))
  writeFileSync(join(root, 'versions', 'active'), `v${version}\n`)
  const shownLog = join(home, 'words-shown.log')
  mkdirSync(join(root, '.node', 'bin'), { recursive: true })
  writeFileSync(
    join(root, '.node', 'bin', 'node'),
    ['#!/usr/bin/env bash', `for a in "$@"; do if [ "$a" = backup-words ]; then echo shown >> ${JSON.stringify(shownLog)}; echo " 1. (the recovery words, shown by the stand-in)"; exit 0; fi; done`, `exec ${JSON.stringify(process.execPath)} "$@"`, ''].join('\n'),
  )
  chmodSync(join(root, '.node', 'bin', 'node'), 0o755)
  cpSync(join(s.dir, 'npm'), join(root, '.node', 'bin', 'npm'))
  if (o.service) {
    mkdirSync(join(home, '.config', 'systemd', 'user'), { recursive: true })
    writeFileSync(join(home, '.config', 'systemd', 'user', 'foxleague-agent.service'), '[Unit]\n')
  }
  const env = { HOME: home, USER: 'tester', PATH: `${s.dir}:${process.env.PATH}` }
  return { home, root, code, s, env, shownLog, wordsShown: () => (existsSync(shownLog) ? readFileSync(shownLog, 'utf8').trim().split('\n').length : 0) }
}

/**
 * A dashboard login already in .env, so the installer keeps it and does not ask for a password on a terminal, and a
 * dashboard port of the tests' own: the installer refuses a port that another program holds (FRESH-10), and the
 * default 8870 is taken on any machine where an agent runs, a developer's own included.
 */
export const TEST_PORT = '18870'
export const LOGIN_LINES = `WEB_UI_USER="owner"\nWEB_UI_PASSWORD_HASH="scrypt$c2FsdA==$aGFzaA=="\nWEB_UI_PORT="${TEST_PORT}"\n`

/**
 * The guided installer (no background service) with the given answers. The questions, in order: the typed yes
 * (only when the words are shown), "A login is already set. Change it?", the port, "Enter keys now?" and the
 * live permission.
 */
export async function guided(i: Install, lines: string[], o: { args?: string[]; env?: Record<string, string>; stopWhen?: () => boolean } = {}): Promise<Ran & { unread: number }> {
  const a = answers(lines)
  try {
    const r = await sh(join(i.code, 'install.sh'), o.args ?? ['--no-service'], { ...i.env, FOXAGENT_ROOT: i.root, FOXAGENT_TTY: a.tty, ...o.env }, { timeoutMs: 60_000, stopWhen: o.stopWhen })
    return { ...r, unread: a.left() }
  } finally {
    a.close()
  }
}

export function mode(path: string): string {
  return (statSync(path).mode & 0o777).toString(8)
}

/** One function of a shell script, as its text (from `name() {` at the start of a line to the closing `}`). */
export function shellFunction(script: string, name: string): string {
  const text = readFileSync(script, 'utf8')
  const single = new RegExp(`^${name}\\(\\) \\{.*\\}$`, 'm').exec(text)
  if (single) return single[0]
  const multi = new RegExp(`^${name}\\(\\) \\{[^\\n]*\\n[\\s\\S]*?^\\}$`, 'm').exec(text)
  if (multi) return multi[0]
  throw new Error(`no function ${name} in ${script}`)
}

/** A small release folder that get.sh takes for foxleague-agent: package.json, src/service.ts, install.sh and run.sh. */
export function smallTree(dir: string, version: string, extra: Record<string, string> = {}): string {
  return codeTree(dir, version, { extra: { 'run.sh': '#!/usr/bin/env bash\n', ...extra } })
}

/** Packs a folder as `<top>/…` the way a release is packed, with no manifest: for FOXAGENT_SOURCE. */
export function pack(tree: string, top = 'foxleague-agent-vX'): string {
  const archive = join(tmp('fox-archive-'), 'release.tar.gz')
  // A folder that already has the top name is packed where it is: a copy would turn a hard link into two files.
  if (basename(tree) === top) {
    execFileSync('tar', ['-czf', archive, '-C', dirname(tree), top])
    return archive
  }
  const stage = tmp('fox-pack-')
  cpSync(tree, join(stage, top), { recursive: true, verbatimSymlinks: true })
  execFileSync('tar', ['-czf', archive, '-C', stage, top])
  return archive
}

/** An install made by get.sh at one version, with the owner's files beside it, and a check that those never changed. */
export function ownedInstall(version: string): { home: string; dir: string; mine: Record<string, string>; untouched: () => void } {
  const home = tmp('fox-home-')
  const dir = join(home, 'foxleague-agent')
  smallTree(join(dir, 'versions', `v${version}`), version)
  writeFileSync(join(dir, 'versions', 'active'), `v${version}\n`)
  const mine: Record<string, string> = { '.env': 'AGENT_MNEMONIC="the owner words"\n', 'data/agent.db': 'the ledger', 'pem/agent1.pem': 'the key', '.node/bin/node': 'node' }
  for (const [f, text] of Object.entries(mine)) {
    mkdirSync(join(dir, f, '..'), { recursive: true })
    writeFileSync(join(dir, f), text)
  }
  return {
    home,
    dir,
    mine,
    untouched: () => {
      for (const [f, text] of Object.entries(mine)) if (readFileSync(join(dir, f), 'utf8') !== text) throw new Error(`${f} of the owner was changed`)
    },
  }
}

/** Every file under a folder with its text, for "nothing was changed". */
export function snapshotOf(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (d: string, rel: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        out[`${r}/`] = ''
        walk(join(d, e.name), r)
      } else if (e.isFile()) out[r] = readFileSync(join(d, e.name), 'utf8')
      else out[r] = '(not a plain file)'
    }
  }
  if (existsSync(dir)) walk(dir, '')
  return out
}

/** An install at 3.1.0 as the installer leaves it: the scripts in its folder, a private Node.js with npm and (unless told otherwise) a background service. */
export function running(s: Stubs, o: { service?: boolean } = {}): { home: string; root: string; code: string; unit: string; env: (base: string) => Record<string, string> } {
  const home = tmp('fox-home-')
  const root = join(home, 'foxleague-agent')
  const code = realTree(join(root, 'versions', 'v3.1.0'), '3.1.0')
  symlinkSync(join(REPO, 'node_modules'), join(code, 'node_modules'))
  writeFileSync(join(root, 'versions', 'active'), 'v3.1.0\n')
  for (const f of ['run.sh', 'cli.sh', 'get.sh']) cpSync(join(code, f), join(root, f))
  writeFileSync(join(root, 'install.sh'), INSTALL_SHIM, { mode: 0o755 })
  mkdirSync(join(root, '.node', 'bin'), { recursive: true })
  symlinkSync(process.execPath, join(root, '.node', 'bin', 'node'))
  cpSync(join(s.dir, 'npm'), join(root, '.node', 'bin', 'npm'))
  const unit = join(home, '.config', 'systemd', 'user', 'foxleague-agent.service')
  if (o.service !== false) {
    mkdirSync(join(home, '.config', 'systemd', 'user'), { recursive: true })
    writeFileSync(unit, '[Unit]\n')
  }
  return { home, root, code, unit, env: base => ({ HOME: home, USER: 'tester', PATH: `${s.dir}:${process.env.PATH}`, AGENT_UPDATE_URL: base, FOXAGENT_TTY: '/dev/null' }) }
}

export { REPO, tmp }
