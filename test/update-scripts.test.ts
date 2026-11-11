// The scripts of an install: get.sh (the pasted line), install.sh --prepare and --update, with the real files.
// Each runs in a throwaway HOME against a local release server; npm, systemctl and loginctl are stand-ins on PATH.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { archiveName } from '../src/update/release.ts'
import { REPO, buildRelease, publish, serve, testKey, tmp } from './update-fixtures.ts'

const KEY = testKey()

/** Stand-ins: npm (notes where it ran and links the real dependencies), systemctl, loginctl and launchctl (note their arguments). */
function stubs(): { dir: string; calls: () => string[] } {
  const dir = tmp('fox-stubs-')
  const log = join(dir, 'calls.log')
  const stub = (name: string, body: string): void => {
    writeFileSync(join(dir, name), `#!/usr/bin/env bash\n${body}\n`)
    chmodSync(join(dir, name), 0o755)
  }
  stub('npm', `printf 'npm %s in %s\\n' "$*" "$PWD" >> ${JSON.stringify(log)}\n[ -e node_modules ] || ln -s ${JSON.stringify(join(REPO, 'node_modules'))} node_modules`)
  for (const name of ['systemctl', 'loginctl', 'launchctl']) stub(name, `printf '${name} %s\\n' "$*" >> ${JSON.stringify(log)}`)
  // The installer puts its Node's folder first on the PATH: with Node found here, the stand-in npm is the one it runs.
  symlinkSync(process.execPath, join(dir, 'node'))
  return { dir, calls: () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []) }
}

/** The real code as a release folder: src, the scripts and package.json at the given version, with the test key pinned. */
function realTree(dir: string, version: string): string {
  mkdirSync(dir, { recursive: true })
  cpSync(join(REPO, 'src'), join(dir, 'src'), { recursive: true, filter: p => !p.includes(`${join('src', 'local')}`) })
  for (const f of ['install.sh', 'get.sh', 'run.sh', 'package-lock.json']) cpSync(join(REPO, f), join(dir, f))
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as Record<string, unknown>
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ ...pkg, version }, null, 2) + '\n')
  writeFileSync(join(dir, 'src', 'update', 'keys.ts'), `export const RELEASE_KEYS: readonly string[] = [${JSON.stringify(KEY.publicPem)}]\n`)
  return dir
}

// Not spawnSync: the release server lives in this process and must answer while the script runs.
function sh(script: string, args: string[], env: Record<string, string>): Promise<{ status: number; out: string }> {
  return new Promise(done => {
    let out = ''
    const child = spawn('bash', [script, ...args], { env: { PATH: process.env.PATH ?? '', ...env }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 })
    child.stdout.on('data', (b: Buffer) => (out += b.toString('utf8')))
    child.stderr.on('data', (b: Buffer) => (out += b.toString('utf8')))
    child.on('close', code => done({ status: code ?? -1, out }))
  })
}

test('GET-1: the pasted line puts a release in its own folder, only when the download matches the manifest', async () => {
  const out = tmp()
  const built = buildRelease(out, realTree(tmp(), '3.1.0'), '3.1.0', KEY.privatePem)
  const site = publish(tmp(), [{ dir: out, version: '3.1.0' }], '3.1.0')
  const web = await serve(site)
  const home = tmp('fox-home-')
  const env = { HOME: home, FOXAGENT_RELEASES: web.base, FOXAGENT_NO_RUN: '1' }
  try {
    const r = await sh(join(REPO, 'get.sh'), [], env)
    assert.equal(r.status, 0, r.out)
    assert.match(r.out, /Downloading foxleague-agent 3\.1\.0 into .*\/foxleague-agent/)
    assert.match(r.out, /The download matches the release's checksum\./)
    const dir = join(home, 'foxleague-agent')
    assert.equal(readFileSync(join(dir, 'versions', 'active'), 'utf8'), 'v3.1.0\n')
    assert.ok(existsSync(join(dir, 'versions', 'v3.1.0', 'src', 'service.ts')))
    assert.deepEqual(readdirSync(join(dir, 'versions')).sort(), ['active', 'v3.1.0'], 'nothing half-done is left')
    assert.equal((await sh(join(REPO, 'get.sh'), [], { ...env, FOXAGENT_VERSION: 'v3.1.0' })).status, 0, 'a given version')
    assert.match((await sh(join(REPO, 'get.sh'), [], { ...env, FOXAGENT_VERSION: 'v9.9.9' })).out, /could not find the release/)
    assert.match((await sh(join(REPO, 'get.sh'), [], { ...env, FOXAGENT_VERSION: '3.1.0; rm -rf ~' })).out, /must look like v1\.2\.3/)
    assert.match((await sh(join(REPO, 'get.sh'), [], { ...env, FOXAGENT_DIR: '/' })).out, /must name a folder of its own/)
    mkdirSync(join(home, 'checkout', '.git'), { recursive: true })
    assert.match((await sh(join(REPO, 'get.sh'), [], { ...env, FOXAGENT_DIR: join(home, 'checkout') })).out, /is a git checkout/)
  } finally {
    await web.close()
  }
  // The archive on the server is not the one the manifest names.
  const changed = Buffer.from(readFileSync(built.archive))
  changed[changed.length - 30]! ^= 0xff
  const bad = await serve(site, { rewrite: p => (p.endsWith(archiveName('3.1.0')) ? { body: changed } : undefined) })
  const home2 = tmp('fox-home-')
  try {
    const r = await sh(join(REPO, 'get.sh'), [], { HOME: home2, FOXAGENT_RELEASES: bad.base, FOXAGENT_NO_RUN: '1' })
    assert.notEqual(r.status, 0)
    assert.match(r.out, /does not match the checksum of release 3\.1\.0: nothing was installed/)
    assert.equal(existsSync(join(home2, 'foxleague-agent', 'versions', 'active')), false)
  } finally {
    await bad.close()
  }
})

test('GET-2: the pasted line over an older install replaces its code and keeps the wallet, the keys, the data and Node', async () => {
  const out = tmp()
  buildRelease(out, realTree(tmp(), '3.1.0'), '3.1.0', KEY.privatePem)
  const web = await serve(publish(tmp(), [{ dir: out, version: '3.1.0' }], '3.1.0'))
  const home = tmp('fox-home-')
  const dir = join(home, 'foxleague-agent')
  // The layout the installer made before releases had their own folders.
  for (const d of ['src', 'deploy', 'test', 'docs', 'data', 'pem', '.node/bin', 'node_modules/x']) mkdirSync(join(dir, d), { recursive: true })
  const mine: Record<string, string> = { '.env': 'AGENT_MNEMONIC="the owner words"\n', 'data/agent.db': 'database', 'pem/agent1.pem': 'pem', '.node/bin/node': 'node' }
  for (const [f, text] of Object.entries(mine)) writeFileSync(join(dir, f), text)
  for (const f of ['src/service.ts', 'install.sh', 'get.sh']) writeFileSync(join(dir, f), 'old')
  // What tells get.sh that the folder is an older foxleague-agent install (INSTALL-9): its package.json says so.
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'foxleague-agent', version: '0.11.0' }, null, 2))
  try {
    const r = await sh(join(REPO, 'get.sh'), [], { HOME: home, FOXAGENT_RELEASES: web.base, FOXAGENT_NO_RUN: '1' })
    assert.equal(r.status, 0, r.out)
    assert.match(r.out, /An older install was found there: its code is replaced, your wallet, keys and data are kept\./)
    for (const [f, text] of Object.entries(mine)) assert.equal(readFileSync(join(dir, f), 'utf8'), text, `${f} is kept as it was`)
    for (const gone of ['src', 'deploy', 'test', 'docs', 'node_modules', 'package.json']) assert.equal(existsSync(join(dir, gone)), false, `the old ${gone} is gone`)
    assert.equal(readFileSync(join(dir, 'versions', 'active'), 'utf8'), 'v3.1.0\n')
  } finally {
    await web.close()
  }
})

test('INS-1: install.sh --prepare touches only the new release folder and Node: no service, no database, no .env', async () => {
  const s = stubs()
  const root = tmp('fox-root-')
  const staged = realTree(join(root, 'versions', '.staging-v3.2.0'), '3.2.0')
  writeFileSync(join(root, 'versions', 'active'), 'v3.1.0\n')
  const r = await sh(join(staged, 'install.sh'), ['--prepare'], { HOME: tmp('fox-home-'), PATH: `${s.dir}:${process.env.PATH}`, FOXAGENT_ROOT: root })
  assert.equal(r.status, 0, r.out)
  assert.deepEqual(s.calls(), [`npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error in ${staged}`])
  assert.deepEqual(readdirSync(root).sort(), ['.node-path', 'versions'], 'nothing else appears in the install folder')
  assert.match(readFileSync(join(root, '.node-path'), 'utf8'), /\/node\n$/)
  // By hand, outside an update, it refuses.
  assert.match((await sh(join(REPO, 'install.sh'), ['--prepare'], { HOME: tmp('fox-home-'), PATH: `${s.dir}:${process.env.PATH}` })).out, /--prepare is run by an update, not by hand/)
})

test('INS-2: ./install.sh --update takes the newest signed release, prepares it, switches and restarts; a bad one changes nothing', { timeout: 240_000 }, async () => {
  const s = stubs()
  const home = tmp('fox-home-')
  const root = join(home, 'foxleague-agent')
  const running = realTree(join(root, 'versions', 'v3.1.0'), '3.1.0')
  symlinkSync(join(REPO, 'node_modules'), join(running, 'node_modules'))
  writeFileSync(join(root, 'versions', 'active'), 'v3.1.0\n')
  // The install's private Node.js, as the installer leaves it: its npm is the one an update runs.
  mkdirSync(join(root, '.node', 'bin'), { recursive: true })
  symlinkSync(process.execPath, join(root, '.node', 'bin', 'node'))
  cpSync(join(s.dir, 'npm'), join(root, '.node', 'bin', 'npm'))
  // The background service exists, so the update restarts it.
  mkdirSync(join(home, '.config', 'systemd', 'user'), { recursive: true })
  writeFileSync(join(home, '.config', 'systemd', 'user', 'foxleague-agent.service'), '[Unit]\n')
  const out = tmp()
  const built = buildRelease(out, realTree(tmp(), '3.2.0'), '3.2.0', KEY.privatePem, { notes: 'Medicine for injured cards.' })
  const site = publish(tmp(), [{ dir: out, version: '3.2.0' }], '3.2.0')
  const env = (base: string): Record<string, string> => ({ HOME: home, PATH: `${s.dir}:${process.env.PATH}`, AGENT_UPDATE_URL: base, FOXAGENT_TTY: '/dev/null' })
  const before = readFileSync(join(running, 'src', 'service.ts'), 'utf8')

  // First a server whose archive was swapped: refused, nothing switched, no restart.
  const changed = Buffer.from(readFileSync(built.archive))
  changed[changed.length - 30]! ^= 0xff
  const bad = await serve(site, { rewrite: p => (p.endsWith(archiveName('3.2.0')) ? { body: changed } : undefined) })
  try {
    const r = await sh(join(running, 'install.sh'), ['--update'], env(bad.base))
    assert.notEqual(r.status, 0)
    assert.match(r.out, /No update: the archive is not the one that was signed/)
    assert.match(r.out, /The update was not installed\. The agent runs as before\./)
    assert.equal(readFileSync(join(root, 'versions', 'active'), 'utf8'), 'v3.1.0\n')
    assert.deepEqual(s.calls().filter(c => c.startsWith('systemctl')), [], 'no restart')
  } finally {
    await bad.close()
  }

  const web = await serve(site)
  try {
    const r = await sh(join(running, 'install.sh'), ['--update'], env(web.base))
    assert.equal(r.status, 0, r.out)
    assert.match(r.out, /Version 3\.2\.0 is out \(you run 3\.1\.0\); its signature is good\./)
    assert.match(r.out, /Medicine for injured cards\./)
    assert.match(r.out, /Version 3\.2\.0 is in place\./)
    assert.equal(readFileSync(join(root, 'versions', 'active'), 'utf8'), 'v3.2.0\n')
    assert.equal(readFileSync(join(root, 'versions', 'pending'), 'utf8'), 'v3.1.0 v3.2.0 0\n', 'the launcher can still undo it')
    assert.equal(readFileSync(join(running, 'src', 'service.ts'), 'utf8'), before, 'the release that was running is untouched')
    assert.ok(s.calls().includes(`npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error in ${join(root, 'versions', '.staging-v3.2.0')}`), 'the new release installed its own dependencies before the switch')
    // The owner's restart: the user's service manager is looked for, the unit's start counter is cleared (FRESH-1), then the restart.
    assert.deepEqual(s.calls().filter(c => c.startsWith('systemctl')), ['systemctl --user show-environment', 'systemctl --user reset-failed foxleague-agent', 'systemctl --user restart foxleague-agent'])
    // Again, from the new release: nothing newer, no second restart.
    const again = await sh(join(root, 'versions', 'v3.2.0', 'install.sh'), ['--update'], env(web.base))
    assert.equal(again.status, 0, again.out)
    assert.match(again.out, /You run 3\.2\.0, the newest version\./)
    assert.equal(s.calls().filter(c => c === 'systemctl --user restart foxleague-agent').length, 1)
  } finally {
    await web.close()
  }
})
