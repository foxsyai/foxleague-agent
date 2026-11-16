// R2I-1 (INS-A8 fooled by a link): the root check of cli.sh, run.sh, install.sh and get.sh asks `stat` for the owner
// of the folder as it was named, and stat does not follow a link in the last part of a path (GNU `stat -c`, BSD
// `stat -f` alike; both need -L). The scripts name the folder with `cd ... && pwd`, which keeps a link as it was typed.
// A link that root made to a user's install (sudo ln -s /home/ana/foxleague-agent /opt/fox) is root's own, so
// `sudo /opt/fox/cli.sh ...`, `sudo /opt/fox/run.sh`, `sudo /opt/fox/install.sh --update` and the pasted line with
// FOXAGENT_DIR=/opt/fox pass the check and write root's files into ana's install: the very harm INS-A8 names.
// Seen with real root in a container (out/R2I-1.real-root.txt): "NODE RAN as uid 0 ... /opt/fox/versions/.../cli.ts".
// Right: the owner asked about is the folder's, whatever name it was reached by.
//
// Root is played by a stand-in `id`, as INS-A8's own test does. `stat` is the real one with one difference: a path
// that is a link and is asked without -L answers as a link that root made (uid 0, root), which is what the real stat
// says of such a link. Every other question goes to the real stat (the folder is the test user's own, not root's).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO, ownedInstall, pack, running, sh, smallTree, snapshotOf, stubs, tmp } from '../audit-1111/install-helpers.ts'

const AS_ROOT = 'case "$*" in -u) echo 0 ;; -un) echo root ;; *) exec /usr/bin/id "$@" ;; esac'
const ROOTS_LINK = [
  'follow=0; for a in "$@"; do [ "$a" = -L ] && follow=1; done',
  'last="${@: -1}"',
  'if [ "$follow" = 0 ] && [ -L "$last" ]; then',
  '  case " $* " in *" %u "*) echo 0; exit 0 ;; *" %U "* | *" %Su "*) echo root; exit 0 ;; esac',
  'fi',
  'exec /usr/bin/stat "$@"',
].join('\n')
const REFUSAL = /belongs to \S+, not to root/

function countingNode(root: string): () => string[] {
  const ran = join(tmp('fox-ran-'), 'ran')
  const fake = join(tmp('fox-node-'), 'node')
  writeFileSync(fake, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(ran)}\nexit 0\n`, { mode: 0o755 })
  writeFileSync(join(root, '.node-path'), `${fake}\n`)
  return () => (existsSync(ran) ? readFileSync(ran, 'utf8').trim().split('\n') : [])
}

function linked(): { s: ReturnType<typeof stubs>; root: string; link: string; ran: () => string[]; env: Record<string, string> } {
  const s = stubs()
  s.stub('id', AS_ROOT)
  s.stub('stat', ROOTS_LINK)
  const i = running(s)
  const ran = countingNode(i.root)
  const link = join(tmp('fox-opt-'), 'fox')
  symlinkSync(i.root, link)
  return { s, root: i.root, link, ran, env: { HOME: tmp('fox-roothome-'), USER: 'root', PATH: `${s.dir}:${process.env.PATH}`, AGENT_UPDATE_URL: 'http://127.0.0.1:9', FOXAGENT_TTY: '/dev/null' } }
}

test('R2I-1: the stand-in stat answers as the real one does for the folder itself (the direct path is still refused)', async () => {
  const l = linked()
  const r = await sh(join(l.root, 'cli.sh'), ['agents'], l.env, { cwd: l.root })
  assert.match(r.out, REFUSAL, r.out)
  assert.deepEqual(l.ran(), [])
})

test('R2I-1: sudo ./cli.sh reached through a link root made to a user\'s install is refused like the folder itself', async () => {
  const l = linked()
  const r = await sh(join(l.link, 'cli.sh'), ['agents'], l.env, { cwd: l.link })
  assert.deepEqual(l.ran(), [], `root ran the command line in a user's install through the link:\n${r.out}`)
  assert.match(r.out, REFUSAL, r.out)
  assert.notEqual(r.status, 0)
})

test('R2I-1: sudo ./run.sh reached through such a link does not start the agent as root', async () => {
  const l = linked()
  const r = await sh(join(l.link, 'run.sh'), [], l.env, { cwd: l.link })
  assert.deepEqual(l.ran(), [], `root started the agent of a user's install through the link:\n${r.out}`)
  assert.match(r.out, REFUSAL, r.out)
})

test('R2I-1: sudo ./install.sh --update reached through such a link stops before it changes anything', { timeout: 120_000 }, async () => {
  const l = linked()
  const r = await sh(join(l.link, 'install.sh'), ['--update'], l.env, { cwd: l.link, timeoutMs: 60_000 })
  assert.doesNotMatch(r.out, /Updating foxleague-agent/, `the update began as root in a user's install:\n${r.out}`)
  assert.match(r.out, REFUSAL, r.out)
  assert.deepEqual(l.ran(), [], 'Node.js was started as root')
})

test('R2I-1: the pasted line with FOXAGENT_DIR naming such a link stops before it writes anything', async () => {
  const s = stubs({ node: false, npm: false })
  s.stub('id', AS_ROOT)
  s.stub('stat', ROOTS_LINK)
  const o = ownedInstall('3.1.0')
  const link = join(tmp('fox-opt-'), 'fox')
  symlinkSync(o.dir, link)
  const before = snapshotOf(o.dir)
  const r = await sh(join(REPO, 'get.sh'), [], { HOME: tmp('fox-roothome-'), PATH: `${s.dir}:${process.env.PATH}`, FOXAGENT_DIR: link, FOXAGENT_SOURCE: pack(smallTree(tmp(), '3.2.0')), FOXAGENT_ALLOW_ROOT: '1', FOXAGENT_NO_RUN: '1' })
  assert.match(r.out, REFUSAL, r.out)
  assert.notEqual(r.status, 0, r.out)
  assert.deepEqual(snapshotOf(o.dir), before, 'root put a release into the user\'s install')
})
