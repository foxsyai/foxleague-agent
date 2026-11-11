// FRESH-11 (fresh Ubuntu walk-through, 2026-11-11): on an Ubuntu without curl the shell's own hint offers
// `sudo snap install curl` before `sudo apt install curl`. The curl of a snap is confined: it has a /tmp of its
// own, so a file it is told to write there (`curl -o /tmp/...`) is not where the script looks for it. get.sh and
// install.sh downloaded that way (the manifest, the archive, Node.js) and would then say "the release manifest
// names no version" or "the Node.js download is not the file this installer expects". (Not measured with a real
// snap: a container cannot run one. The stand-in below is a curl that cannot write a file by itself.) Safe: the
// scripts let curl write to its output and the shell puts that into the file, which a confined curl can do; the
// pasted line itself (`curl ... | bash`) already works that way.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { buildRelease, publish, serve } from '../update-fixtures.ts'
import { KEY, REPO, freshInstall, guided, sh, smallTree, stubs, systemTools, tmp } from './install-helpers.ts'

/** A curl that reaches the network (here: this machine) but may not write a file itself, as a confined one in /tmp. */
const CONFINED = [
  'printf \'curl %s\\n\' "$*" >> "$LOG"',
  'for a in "$@"; do case "$a" in -o | --output | -O) echo "curl: (23) Failure writing output to destination" >&2; exit 23 ;; esac; done',
].join('\n')

test('FRESH-11: get.sh installs a release with a curl that cannot write files itself', async () => {
  const s = stubs({ node: false, npm: false })
  const real = ['/usr/bin/curl', '/bin/curl', '/usr/local/bin/curl', '/opt/homebrew/bin/curl'].find(p => existsSync(p))
  assert.ok(real, 'this machine has a curl')
  s.stub('curl', `${CONFINED}\nexec ${JSON.stringify(real)} "$@"`)
  const out = tmp()
  buildRelease(out, smallTree(tmp(), '3.1.0'), '3.1.0', KEY.privatePem)
  const web = await serve(publish(tmp(), [{ dir: out, version: '3.1.0' }], '3.1.0'))
  const home = tmp('fox-home-')
  try {
    const r = await sh(join(REPO, 'get.sh'), [], { HOME: home, PATH: `${s.dir}:${process.env.PATH}`, FOXAGENT_RELEASES: web.base, FOXAGENT_NO_RUN: '1' })
    assert.equal(r.status, 0, r.out)
    assert.match(r.out, /The download matches the release's checksum\./)
    assert.equal(readFileSync(join(home, 'foxleague-agent', 'versions', 'active'), 'utf8'), 'v3.1.0\n')
    assert.ok(s.calls().filter(c => c.startsWith('curl')).length >= 2, 'the manifest and the archive were fetched with that curl')
  } finally {
    await web.close()
  }
})

test('FRESH-11: install.sh takes the Node.js download from a curl that cannot write files itself', { timeout: 120_000 }, async () => {
  const i = freshInstall()
  // No Node.js in the install and none on the system: the installer downloads one.
  rmSync(join(i.root, '.node'), { recursive: true })
  rmSync(join(i.s.dir, 'node'))
  // What this curl "downloads" is one line, so the checksum cannot match: the refusal then names the SHA-256 of
  // exactly the bytes the installer was given, which shows that they reached the file it reads.
  const body = 'not a Node.js archive'
  i.s.stub('curl', `${CONFINED}\nprintf '%s' ${JSON.stringify(body)}`)
  const tools = systemTools()
  rmSync(join(tools, 'curl'), { force: true })
  const r = await guided(i, ['yes', 'owner', '18997', 'n', 'n'], { env: { PATH: `${i.s.dir}:${tools}` } })
  assert.notEqual(r.status, 0, r.out)
  assert.doesNotMatch(r.out, /Node\.js could not be downloaded/, 'the download itself went through')
  const sum = createHash('sha256').update(body).digest('hex')
  assert.ok(r.out.includes(`the Node.js download is not the file this installer expects (SHA-256 ${sum},`), r.out)
  assert.equal(existsSync(join(i.root, '.node')), false, 'nothing was unpacked')
})
