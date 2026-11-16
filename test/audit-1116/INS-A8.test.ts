// INS-A8: `sudo ./cli.sh` and `sudo ./run.sh` were not refused on a folder another user owns. As root they write
// root's files into the install: the database's journal files and logs in data/, an update's release folder and
// versions/active through `./cli.sh update`, a new .env through `./cli.sh setup`. The agent runs as its user, may then
// read or write none of them and does not start again: the harm UPD-A4 fixed for `./install.sh --update`. The guided
// installer has the same gap when the owner says FOXAGENT_ALLOW_ROOT=1 in another user's folder: it writes root's
// .env there and a unit of root that runs the launcher as root.
// Right: as root on a folder another user owns, both stop before Node.js starts and name the command without sudo.
// An install that is root's own (its folder is root's) still runs. Root is played by a stand-in `id` and the folder's
// owner by a stand-in `stat`, as the scripts ask them (INSTALL-17 does the same).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOGIN_LINES, REPO, freshInstall, guided, ownedInstall, pack, running, sh, smallTree, snapshotOf, stubs, tmp } from '../audit-1111/install-helpers.ts'

const AS_ROOT = 'case "$*" in -u) echo 0 ;; -un) echo root ;; *) exec /usr/bin/id "$@" ;; esac'
const ROOTS_FOLDER = 'case "$1 $2" in "-c %u") echo 0 ;; "-c %U") echo root ;; *) exec /usr/bin/stat "$@" ;; esac'
const REFUSAL = /belongs to \S+, not to root: run it as \S+, without sudo/

/** A Node.js that notes each start in `ran` and does nothing else: the launchers start it from .node-path. */
function countingNode(root: string): () => string[] {
  const ran = join(tmp('fox-ran-'), 'ran')
  const fake = join(tmp('fox-node-'), 'node')
  writeFileSync(fake, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(ran)}\nexit 0\n`, { mode: 0o755 })
  writeFileSync(join(root, '.node-path'), `${fake}\n`)
  return () => (existsSync(ran) ? readFileSync(ran, 'utf8').trim().split('\n') : [])
}

test('INS-A8: sudo ./cli.sh on a folder another user owns stops before Node.js starts and names the command without sudo', async () => {
  const s = stubs()
  s.stub('id', AS_ROOT)
  const i = running(s)
  const ran = countingNode(i.root)
  const before = readdirSync(i.root).sort()
  const r = await sh(join(i.root, 'cli.sh'), ['export-pem', '1', 'my key.pem'], { HOME: tmp('fox-roothome-'), USER: 'root', PATH: `${s.dir}:${process.env.PATH}` }, { cwd: i.root })
  assert.deepEqual(ran(), [], `root ran the command line in a user's install:\n${r.out}`)
  assert.notEqual(r.status, 0, r.out)
  assert.match(r.out, REFUSAL, r.out)
  assert.ok(r.out.includes(`cd ${i.root} && ./cli.sh export-pem 1 my\\ key.pem`), `the command to type instead, as it was asked for:\n${r.out}`)
  assert.deepEqual(readdirSync(i.root).sort(), before, 'nothing was written')
})

test('INS-A8: sudo ./run.sh on a folder another user owns does not start the agent and names the command without sudo', async () => {
  const s = stubs()
  s.stub('id', AS_ROOT)
  const i = running(s)
  const ran = countingNode(i.root)
  const r = await sh(join(i.root, 'run.sh'), [], { HOME: tmp('fox-roothome-'), USER: 'root', PATH: `${s.dir}:${process.env.PATH}` }, { cwd: i.root })
  assert.deepEqual(ran(), [], `root started the agent of a user's install:\n${r.out}`)
  assert.notEqual(r.status, 0, r.out)
  assert.match(r.out, REFUSAL, r.out)
  assert.ok(r.out.includes(`cd ${i.root} && ./run.sh`), r.out)
})

test('INS-A8: an install that is root\'s own still runs its command line and its launcher as root', async () => {
  const s = stubs()
  s.stub('id', AS_ROOT)
  s.stub('stat', ROOTS_FOLDER)
  const i = running(s)
  const ran = countingNode(i.root)
  const env = { HOME: tmp('fox-roothome-'), USER: 'root', PATH: `${s.dir}:${process.env.PATH}` }
  const cli = await sh(join(i.root, 'cli.sh'), ['address', '1'], env, { cwd: i.root })
  assert.equal(cli.status, 0, cli.out)
  const run = await sh(join(i.root, 'run.sh'), [], env, { cwd: i.root })
  assert.equal(run.status, 0, run.out)
  assert.equal(ran().length, 2, ran().join('\n'))
  assert.match(ran()[0]!, /src\/cli\.ts address 1$/)
  assert.match(ran()[1]!, /src\/service\.ts$/)
})

test('INS-A8: the pasted line with FOXAGENT_ALLOW_ROOT=1 over another user\'s install stops before it writes anything', async () => {
  const s = stubs({ node: false, npm: false })
  s.stub('id', AS_ROOT)
  const o = ownedInstall('3.1.0')
  const archive = pack(smallTree(tmp(), '3.2.0'))
  const before = snapshotOf(o.dir)
  const r = await sh(join(REPO, 'get.sh'), [], { HOME: tmp('fox-roothome-'), PATH: `${s.dir}:${process.env.PATH}`, FOXAGENT_DIR: o.dir, FOXAGENT_SOURCE: archive, FOXAGENT_ALLOW_ROOT: '1', FOXAGENT_NO_RUN: '1' })
  assert.notEqual(r.status, 0, r.out)
  assert.match(r.out, /belongs to \S+, not to root: paste the line as \S+, without sudo/, r.out)
  assert.deepEqual(snapshotOf(o.dir), before, 'nothing was changed')
})

test('INS-A8: the guided install with FOXAGENT_ALLOW_ROOT=1 in another user\'s folder stops before it writes anything', { timeout: 120_000 }, async () => {
  const i = freshInstall()
  i.s.stub('id', AS_ROOT)
  writeFileSync(join(i.root, '.env'), LOGIN_LINES, { mode: 0o600 })
  const env = readFileSync(join(i.root, '.env'), 'utf8')
  const before = readdirSync(i.root).sort()
  const r = await guided(i, ['yes', '', '18997', 'n', 'n'], { env: { FOXAGENT_ALLOW_ROOT: '1' } })
  assert.notEqual(r.status, 0, r.out)
  assert.match(r.out, REFUSAL, r.out)
  assert.doesNotMatch(r.out, /1\/7 Node\.js/, 'no step ran')
  assert.deepEqual(readdirSync(i.root).sort(), before, 'nothing was written')
  assert.equal(readFileSync(join(i.root, '.env'), 'utf8'), env)
})
