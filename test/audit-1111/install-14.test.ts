// INSTALL-14 and INSTALL-3B: Node.js.
// 14A: a system Node.js new enough but with no npm beside it (Debian and Ubuntu package npm apart) was chosen, and
//      the installer then stopped at `npm ci` with "npm: command not found" instead of using its private copy.
// 14B: the version rule accepted every 23.x and 24.0/24.1, which have no import.meta.main: there the service
//      process loads, starts nothing and ends with status 0, and nothing says why.
// 3B:  the private Node.js download was checked only against a SHASUMS256.txt fetched from the same server.
// Safe: a system Node.js is used only when it is 22 from 22.18 or 24.2 and later and npm sits beside it; the
// private copy is checked against SHA-256 values written in install.sh; package.json names the same range.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NPM_CI, REPO, realTree, sh, shellFunction, stubs, systemTools, tmp, type Stubs } from './install-helpers.ts'

const SYS = systemTools()
const INSTALLER = readFileSync(join(REPO, 'install.sh'), 'utf8')
const NODE_VERSION = /^NODE_VERSION=(v\d+\.\d+\.\d+)$/m.exec(INSTALLER)![1]!
const TARBALL = `node-${NODE_VERSION}-${process.platform}-${process.arch}.tar.gz`

/** A Node.js on the PATH that says it is another version (the real one behind a preload), with or without npm beside it. */
function nodeSaying(version: string, s: Stubs, npm: boolean): string {
  const dir = tmp('fox-node-')
  writeFileSync(join(dir, 'version.cjs'), `Object.defineProperty(process, 'versions', { value: Object.freeze({ ...process.versions, node: ${JSON.stringify(version)} }) })\nObject.defineProperty(process, 'version', { value: ${JSON.stringify(`v${version}`)} })\n`)
  writeFileSync(join(dir, 'node'), `#!/usr/bin/env bash\nexec ${JSON.stringify(process.execPath)} --require ${JSON.stringify(join(dir, 'version.cjs'))} "$@"\n`)
  chmodSync(join(dir, 'node'), 0o755)
  if (npm) cpSync(join(s.dir, 'npm'), join(dir, 'npm'))
  return dir
}

/** An install folder with a release that waits to be prepared: `install.sh --prepare` is Node.js and dependencies, no questions. */
function staged(): { root: string; code: string } {
  const root = tmp('fox-root-')
  const code = realTree(join(root, 'versions', '.staging-v3.2.0'), '3.2.0')
  writeFileSync(join(root, 'versions', 'active'), 'v3.1.0\n')
  return { root, code }
}

const prepare = (i: { root: string; code: string }, path: string) => sh(join(i.code, 'install.sh'), ['--prepare'], { HOME: tmp('fox-home-'), PATH: path, FOXAGENT_ROOT: i.root })

test('INSTALL-14A: a system Node.js without npm beside it is not chosen: the installer goes for its private copy', async () => {
  const s = stubs({ node: false, npm: false })
  const i = staged()
  const lone = nodeSaying('22.22.0', s, false)
  const r = await prepare(i, `${lone}:${s.dir}:${SYS}`)
  assert.doesNotMatch(r.out, /npm: command not found/)
  assert.match(r.out, new RegExp(`Downloading Node\\.js ${NODE_VERSION.replace(/\./g, '\\.')} \\(a private copy`))
  assert.ok(s.calls().some(c => c.startsWith('curl ') && c.includes(`https://nodejs.org/dist/${NODE_VERSION}/${TARBALL}`)), `the download was asked for (${s.calls().join(' | ')})`)
  // No network in a test, so the download fails, and the installer says that in words.
  assert.notEqual(r.status, 0)
  assert.match(r.out, /Error: Node\.js could not be downloaded from nodejs\.org/)
  assert.equal(existsSync(join(i.root, '.node-path')), false, 'the npm-less Node.js was not noted for the launcher')

  // The same Node.js with npm beside it is used, and that npm is the one that runs.
  const s2 = stubs({ node: false })
  const whole = nodeSaying('22.22.0', s2, true)
  const ok = await prepare(i, `${whole}:${s2.dir}:${SYS}`)
  assert.equal(ok.status, 0, ok.out)
  assert.equal(readFileSync(join(i.root, '.node-path'), 'utf8'), `${join(whole, 'node')}\n`)
  assert.deepEqual(s2.calls(), [`${NPM_CI} in ${i.code}`])
})

const VERSIONS: [string, boolean][] = [
  ['20.19.0', false],
  ['22.17.1', false],
  ['22.18.0', true],
  ['22.22.0', true],
  ['23.3.0', false],
  ['23.11.1', false],
  ['24.0.0', false],
  ['24.1.0', false],
  ['24.2.0', true],
  ['24.11.0', true],
  ['25.1.0', true],
]

test('INSTALL-14B: a system Node.js is taken only when it is 22 from 22.18, or 24.2 and later', { timeout: 120_000 }, async () => {
  const i = staged()
  for (const [version, ok] of VERSIONS) {
    rmSync(join(i.root, '.node-path'), { force: true })
    const s = stubs({ node: false })
    const dir = nodeSaying(version, s, true)
    const r = await prepare(i, `${dir}:${s.dir}:${SYS}`)
    const downloads = s.calls().filter(c => c.startsWith('curl '))
    if (ok) {
      assert.equal(r.status, 0, `Node.js ${version} is accepted: ${r.out}`)
      assert.equal(readFileSync(join(i.root, '.node-path'), 'utf8'), `${join(dir, 'node')}\n`)
      assert.deepEqual(downloads, [], `no private copy is fetched over Node.js ${version}`)
    } else {
      assert.equal(downloads.length, 1, `Node.js ${version} is refused and the private copy is fetched instead (status ${r.status}: ${r.out.trim().split('\n').pop()})`)
      assert.equal(existsSync(join(i.root, '.node-path')), false, `Node.js ${version} is not noted for the launcher`)
    }
  }
})

/** The few forms an engines range takes here: alternatives joined by ||, each a list of >= and < bounds. */
function inRange(range: string, version: string): boolean {
  const num = (v: string): number[] => v.split('.').map(Number)
  const cmp = (a: number[], b: number[]): number => {
    for (let k = 0; k < 3; k++) if ((a[k] ?? 0) !== (b[k] ?? 0)) return (a[k] ?? 0) - (b[k] ?? 0)
    return 0
  }
  return range.split('||').some(alt =>
    alt.trim().split(/\s+/).every(bound => {
      const m = /^(>=|<)(\d+(?:\.\d+){0,2})$/.exec(bound)
      if (!m) throw new Error(`an engines bound this test cannot read: ${bound}`)
      const c = cmp(num(version), num(m[2]!))
      return m[1] === '>=' ? c >= 0 : c < 0
    }),
  )
}

test('INSTALL-14B: package.json engines names the same Node.js range as the installer', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { engines: { node: string } }
  for (const [version, ok] of VERSIONS) assert.equal(inRange(pkg.engines.node, version), ok, `engines "${pkg.engines.node}" on Node.js ${version}`)
  const lock = JSON.parse(readFileSync(join(REPO, 'package-lock.json'), 'utf8')) as { packages: Record<string, { engines?: { node?: string } }> }
  assert.equal(lock.packages['']!.engines?.node, pkg.engines.node, 'and the lock file repeats it')
})

/** A curl that serves one archive for every Node.js download and a SHASUMS256.txt that matches it, as a server that was replaced would. */
function replacedServer(s: Stubs): { ranLog: string; sha: string } {
  const pack = tmp('fox-fake-node-')
  const top = TARBALL.replace(/\.tar\.gz$/, '')
  const ranLog = join(pack, 'ran.log')
  mkdirSync(join(pack, top, 'bin'), { recursive: true })
  for (const name of ['node', 'npm']) {
    writeFileSync(join(pack, top, 'bin', name), `#!/usr/bin/env bash\nprintf '${name} %s\\n' "$*" >> ${JSON.stringify(ranLog)}\necho ${NODE_VERSION}\n`)
    chmodSync(join(pack, top, 'bin', name), 0o755)
  }
  const archive = join(pack, TARBALL)
  execFileSync('tar', ['-czf', archive, '-C', pack, top])
  const sha = createHash('sha256').update(readFileSync(archive)).digest('hex')
  s.stub(
    'curl',
    [
      `out=''; url=''`,
      `while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift ;; http*) url=$1 ;; esac; shift; done`,
      `printf 'curl %s\\n' "$url" >> "$LOG"`,
      `case "$url" in`,
      `  https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt) printf '${sha}  %s\\n' ${JSON.stringify(TARBALL)} > "$out" ;;`,
      `  https://nodejs.org/dist/${NODE_VERSION}/${TARBALL}) cp ${JSON.stringify(archive)} "$out" ;;`,
      `  *) exit 22 ;;`,
      `esac`,
    ].join('\n'),
  )
  return { ranLog, sha }
}

test('INSTALL-3B: a Node.js download that is not the archive pinned in install.sh is refused before it is unpacked or run', async () => {
  const s = stubs({ node: false, npm: false })
  const fake = replacedServer(s)
  const i = staged()
  const r = await prepare(i, `${s.dir}:${SYS}`)
  assert.notEqual(r.status, 0)
  assert.match(r.out, /Error: the Node\.js download is not the file this installer expects/)
  assert.match(r.out, new RegExp(fake.sha), 'the message names what was downloaded')
  assert.equal(existsSync(fake.ranLog), false, `the downloaded program was never run (${existsSync(fake.ranLog) ? readFileSync(fake.ranLog, 'utf8').trim() : ''})`)
  assert.equal(existsSync(join(i.root, '.node')), false, 'nothing was unpacked into the install')
  assert.equal(existsSync(join(i.root, '.node.new')), false)
  assert.equal(existsSync(join(i.root, '.node-path')), false)
  assert.ok(!s.calls().some(c => c.includes('SHASUMS256.txt')), 'no checksum list is fetched from the server that serves the download')
})

test('INSTALL-3B: install.sh holds one SHA-256 for each of the four archives of its Node.js version', async () => {
  const seen = new Set<string>()
  const script = join(tmp(), 'sha.sh')
  writeFileSync(script, `set -eu\n${shellFunction(join(REPO, 'install.sh'), 'node_sha256')}\nPLATFORM=$1 NODE_ARCH=$2\nnode_sha256\n`)
  for (const [platform, arch] of [['linux', 'x64'], ['linux', 'arm64'], ['darwin', 'x64'], ['darwin', 'arm64']] as const) {
    const r = await sh(script, [platform, arch], {})
    assert.equal(r.status, 0, r.out)
    assert.match(r.out, /^[0-9a-f]{64}\n$/, `${platform}-${arch}`)
    seen.add(r.out.trim())
  }
  assert.equal(seen.size, 4, 'four different archives, four different values')
  assert.notEqual((await sh(script, ['linux', 'riscv64'], {})).status, 0, 'a system with no pinned archive gets no value')
})

test('INSTALL-3B: the server setup checks its Node.js archive against a pinned SHA-256 too', () => {
  const bootstrap = readFileSync(join(REPO, 'deploy', 'bootstrap.sh'), 'utf8')
  assert.doesNotMatch(bootstrap, /curl[^\n]*SHASUMS256/, 'no checksum list is fetched from the download server')
  assert.match(bootstrap, /^NODE_SHA256=[0-9a-f]{64}$/m)
  assert.match(bootstrap, /printf '%s  %s\\n' "\$NODE_SHA256" "\$tmp\/\$tarball" \| sha256sum -c -/)
  assert.equal(/^NODE_VERSION=(v[\d.]+)$/m.exec(bootstrap)?.[1], NODE_VERSION, 'the same Node.js version as the installer')
})
