// R2I-3 (INS-A8, the words): the guides and the record say that as root on your folder ./install.sh stops "and says
// so, because files of root there would keep the agent from starting again" (INSTALL.md, the troubleshooting page) and
// that it names "the command without sudo" (docs/SECURITY-REVIEW.md, row INS-A8). That is what the screen shows only
// when FOXAGENT_ALLOW_ROOT=1 is set. The mistake an owner really makes is plain `sudo ./install.sh` in their own
// install, and there the older check answers first: "do not install the agent as root: create a user for it (adduser
// fox, then log in as fox and run this again), or follow docs/SERVER.md for a server. To install as root anyway, put
// FOXAGENT_ALLOW_ROOT=1 in front of the command." Nothing says that the install is theirs and that the fix is to
// leave sudo out; the screen sends them to make another user (a second install with another wallet) or to
// FOXAGENT_ALLOW_ROOT=1, which is then refused with the right sentence. The pasted line does the same over an existing
// install (on a Mac sudo keeps HOME, so `curl ... | sudo bash` lands on the owner's own folder).
// Right: on a folder another user owns, the owner is told whose it is and to run the command without sudo, with or
// without FOXAGENT_ALLOW_ROOT.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOGIN_LINES, REPO, freshInstall, guided, ownedInstall, pack, sh, smallTree, snapshotOf, stubs, tmp } from '../audit-1111/install-helpers.ts'

const AS_ROOT = 'case "$*" in -u) echo 0 ;; -un) echo root ;; *) exec /usr/bin/id "$@" ;; esac'
const flat = (f: string): string => readFileSync(join(REPO, f), 'utf8').replace(/\s+/g, ' ')

test('R2I-3: what the guides promise of sudo ./install.sh on your folder is what plain sudo ./install.sh shows', { timeout: 120_000 }, async () => {
  // The promise, read from the pages.
  for (const f of ['INSTALL.md', 'site/src/content/docs/help/troubleshooting.md']) {
    assert.match(flat(f), /as root on your folder `\.\/cli\.sh`, `\.\/run\.sh` and `\.\/install\.sh` stop before they change anything and say so, because files of root there would keep the agent from starting again/, `${f}: the sentence is there`)
  }
  assert.match(flat('docs/SECURITY-REVIEW.md'), /`install\.sh` \(every mode but `--prepare`\) and `get\.sh` stop before anything runs and name the command without sudo/)
  // The screen.
  const i = freshInstall()
  i.s.stub('id', AS_ROOT)
  writeFileSync(join(i.root, '.env'), LOGIN_LINES, { mode: 0o600 })
  const before = readdirSync(i.root).sort()
  const r = await guided(i, ['yes', '', '18997', 'n', 'n'], { args: [] })
  assert.notEqual(r.status, 0, r.out)
  assert.deepEqual(readdirSync(i.root).sort(), before, 'nothing was written')
  assert.match(r.out, /belongs to \S+, not to root: run it as \S+, without sudo: cd \S+ && \.\/install\.sh/, `the screen does not say whose install this is or to leave sudo out:\n${r.out}`)
  assert.doesNotMatch(r.out, /create a user for it|FOXAGENT_ALLOW_ROOT=1/, `the owner of an install is sent to make another user or to FOXAGENT_ALLOW_ROOT=1, which is refused next:\n${r.out}`)
})

test('R2I-3: the pasted line as root over another user\'s install says whose it is, without FOXAGENT_ALLOW_ROOT too', async () => {
  const s = stubs({ node: false, npm: false })
  s.stub('id', AS_ROOT)
  const o = ownedInstall('3.1.0')
  const before = snapshotOf(o.dir)
  // On a Mac sudo keeps HOME: the folder the line lands on is the owner's own.
  const r = await sh(join(REPO, 'get.sh'), [], { HOME: o.home, PATH: `${s.dir}:${process.env.PATH}`, FOXAGENT_SOURCE: pack(smallTree(tmp(), '3.2.0')), FOXAGENT_NO_RUN: '1' })
  assert.notEqual(r.status, 0, r.out)
  assert.deepEqual(snapshotOf(o.dir), before, 'nothing was changed')
  assert.match(r.out, /belongs to \S+, not to root: paste the line as \S+, without sudo/, `the screen does not say whose install this is:\n${r.out}`)
})
