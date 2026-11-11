// INSTALL-9: get.sh took any folder with a src/ and a package.json for an older install of foxleague-agent and
// ran rm -rf on its src, deploy, test and docs; and it unpacked a release into a folder that held the owner's
// own files. FOXAGENT_DIR is documented as "another folder". Safe: a folder counts as an older install only when
// its package.json names foxleague-agent, and a folder that is neither an install nor empty is refused untouched.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO, pack, sh, smallTree, snapshotOf, tmp } from './install-helpers.ts'

const GET = join(REPO, 'get.sh')
const RELEASE = pack(smallTree(tmp(), '3.1.0'))
const run = (home: string, dir: string) => sh(GET, [], { HOME: home, FOXAGENT_DIR: dir, FOXAGENT_NO_RUN: '1', FOXAGENT_SOURCE: RELEASE })

test('INSTALL-9: another project that has a src/ and a package.json is not taken for an older install', async () => {
  const home = tmp('fox-home-')
  const other = join(home, 'projects', 'other')
  mkdirSync(join(other, 'src'), { recursive: true })
  mkdirSync(join(other, 'docs'))
  writeFileSync(join(other, 'install.sh'), '#!/bin/sh\n')
  writeFileSync(join(other, 'package.json'), '{ "name": "other-project" }\n')
  writeFileSync(join(other, 'src', 'main.c'), 'two years of work\n')
  writeFileSync(join(other, 'docs', 'design.md'), 'notes\n')
  const before = snapshotOf(other)
  const r = await run(home, other)
  assert.notEqual(r.status, 0, r.out)
  assert.match(r.out, /Error: .*\/projects\/other is not empty and is not a foxleague-agent install: nothing was changed\./)
  assert.match(r.out, /FOXAGENT_DIR/)
  assert.deepEqual(snapshotOf(other), before, 'nothing was removed and nothing was added')
})

test('INSTALL-9: a folder with the owner\'s own files is refused, also when asked twice', async () => {
  const home = tmp('fox-home-')
  const work = join(home, 'work')
  mkdirSync(join(work, 'src'), { recursive: true })
  mkdirSync(join(work, 'docs'))
  writeFileSync(join(work, 'src', 'thesis.tex'), 'mine\n')
  writeFileSync(join(work, 'docs', 'contract.pdf'), 'mine\n')
  const before = snapshotOf(work)
  for (const _ of [1, 2]) {
    const r = await run(home, work)
    assert.notEqual(r.status, 0, r.out)
    assert.match(r.out, /is not empty and is not a foxleague-agent install/)
    assert.deepEqual(snapshotOf(work), before)
  }
  // One hidden file is enough to be "not empty", and so is a file where the folder should be.
  const hidden = join(home, 'hidden')
  mkdirSync(hidden)
  writeFileSync(join(hidden, '.notes'), 'mine\n')
  assert.match((await run(home, hidden)).out, /is not empty and is not a foxleague-agent install/)
  assert.deepEqual(snapshotOf(hidden), { '.notes': 'mine\n' })
  writeFileSync(join(home, 'a-file'), 'mine\n')
  assert.notEqual((await run(home, join(home, 'a-file'))).status, 0)
  assert.equal(readFileSync(join(home, 'a-file'), 'utf8'), 'mine\n')
})

test('INSTALL-9: an empty folder, a folder not there yet and what an interrupted run left are installed into', async () => {
  const home = tmp('fox-home-')
  const empty = join(home, 'empty')
  mkdirSync(empty)
  const interrupted = join(home, 'interrupted')
  mkdirSync(join(interrupted, 'versions', '.staging-get', 'src'), { recursive: true })
  for (const dir of [empty, join(home, 'not', 'there', 'yet'), interrupted]) {
    const r = await run(home, dir)
    assert.equal(r.status, 0, r.out)
    assert.equal(readFileSync(join(dir, 'versions', 'active'), 'utf8'), 'v3.1.0\n')
  }
})

test('INSTALL-9: an older flat install is recognised by its package.json and keeps everything that is not its code', async () => {
  const home = tmp('fox-home-')
  const dir = join(home, 'foxleague-agent')
  for (const d of ['src', 'docs', 'data', 'notes']) mkdirSync(join(dir, d), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'foxleague-agent', version: '0.11.0' }, null, 2))
  const mine: Record<string, string> = { '.env': 'AGENT_MNEMONIC="the owner words"\n', 'data/agent.db': 'the ledger', 'notes/ideas.txt': 'mine' }
  for (const [f, text] of Object.entries(mine)) writeFileSync(join(dir, f), text)
  writeFileSync(join(dir, 'src', 'service.ts'), '// old\n')
  const r = await run(home, dir)
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /An older install was found there: its code is replaced, your wallet, keys and data are kept\./)
  for (const [f, text] of Object.entries(mine)) assert.equal(readFileSync(join(dir, f), 'utf8'), text, `${f} is kept`)
  assert.equal(readFileSync(join(dir, 'versions', 'active'), 'utf8'), 'v3.1.0\n')
})
