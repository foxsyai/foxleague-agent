// INSTALL-16 (regression on the new scripts; the audit's proof was written against the flat install of ac8833f,
// where get.sh copied the whole archive over the install and an archive that held a .env replaced the owner's
// recovery words). In the new layout a release is unpacked into its own folder, so the owner's files cannot be
// written over. What this adds: an archive that holds .env, data/, pem/, keys, node_modules or .node is not a
// release (it was packed from a folder in use) and is refused by get.sh and by the updater before it is unpacked.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { detectLayout, stage } from '../../src/update/install.ts'
import { UpdateError, sha256File, type Manifest } from '../../src/update/release.ts'
import { REPO, ownedInstall, pack, sh, smallTree, snapshotOf, tmp } from './install-helpers.ts'

const GET = join(REPO, 'get.sh')

const HELD: Record<string, string> = {
  '.env': 'AGENT_MNEMONIC=\n',
  '.env.local': 'ANTHROPIC_API_KEY=sk-ant-from-the-build-machine\n',
  'data/agent.db': 'an empty database from the build machine',
  'pem/agent1.pem': 'a sample key',
  'keys/release.key': 'a key',
  'node_modules/left-pad/index.js': 'module.exports = 1\n',
  'src/node_modules/@multiversx/sdk-core/index.js': 'module.exports = {}\n',
  '.node/bin/node': '#!/bin/sh\n',
  'src/wallet/agent7.pem': 'a key that was left in the tree',
  'deploy/.env': 'AGENT_MNEMONIC="words of the build machine"\n',
}

function manifestOf(archive: string, version: string): Manifest {
  return { name: 'foxleague-agent', version, sha256: sha256File(archive), size: readFileSync(archive).length, published: '2026-11-11T10:00:00Z', notes: '' }
}

test('INSTALL-16: get.sh refuses an archive that holds what belongs to an install, and touches nothing', async () => {
  for (const [path, text] of Object.entries(HELD)) {
    const i = ownedInstall('3.1.0')
    const before = snapshotOf(i.dir)
    const archive = pack(smallTree(tmp(), '3.2.0', { [path]: text }))
    const r = await sh(GET, [], { HOME: i.home, FOXAGENT_NO_RUN: '1', FOXAGENT_SOURCE: archive })
    assert.notEqual(r.status, 0, `${path}: ${r.out}`)
    assert.match(r.out, /Error: the download holds files that belong to an install, not to a release \(.*\): nothing was installed/, path)
    assert.ok(r.out.includes(path.split('/')[0]!), `the refusal names ${path}`)
    assert.deepEqual(snapshotOf(i.dir), before, `${path}: the install is exactly as it was`)
    i.untouched()
  }
  // What a real release does hold is let through: .env.example, a keys.ts, a folder named data deeper down.
  const i = ownedInstall('3.1.0')
  const fine = pack(smallTree(tmp(), '3.2.0', { '.env.example': 'AGENT_MNEMONIC=\n', 'src/update/keys.ts': 'export const RELEASE_KEYS = []\n', 'src/store/data/x.ts': '// x\n', 'docs/pem.md': 'about PEM files\n' }))
  const ok = await sh(GET, [], { HOME: i.home, FOXAGENT_NO_RUN: '1', FOXAGENT_SOURCE: fine })
  assert.equal(ok.status, 0, ok.out)
  assert.equal(readFileSync(join(i.dir, 'versions', 'active'), 'utf8'), 'v3.2.0\n')
  i.untouched()
})

test('INSTALL-16: the updater refuses such an archive before it unpacks it, and touches nothing', async () => {
  for (const [path, text] of Object.entries(HELD)) {
    const i = ownedInstall('3.1.0')
    const before = snapshotOf(i.dir)
    const archive = pack(smallTree(tmp(), '3.2.0', { [path]: text }), 'foxleague-agent-v3.2.0')
    await assert.rejects(
      stage(detectLayout(join(i.dir, 'versions', 'v3.1.0')), manifestOf(archive, '3.2.0'), archive),
      (err: unknown) => err instanceof UpdateError && /the archive holds files that belong to an install, not to a release/.test(err.message),
      path,
    )
    assert.deepEqual(snapshotOf(i.dir), before, `${path}: the install is exactly as it was (no staging folder, no lock)`)
  }
  const i = ownedInstall('3.1.0')
  const fine = pack(smallTree(tmp(), '3.2.0', { '.env.example': 'AGENT_MNEMONIC=\n', 'src/update/keys.ts': 'export const RELEASE_KEYS = []\n', 'src/store/data/x.ts': '// x\n' }), 'foxleague-agent-v3.2.0')
  assert.equal(await stage(detectLayout(join(i.dir, 'versions', 'v3.1.0')), manifestOf(fine, '3.2.0'), fine), 'v3.2.0')
  assert.ok(existsSync(join(i.dir, 'versions', 'v3.2.0', '.env.example')))
  i.untouched()
})

test('INSTALL-16: an archive that holds a .env cannot write over the owner\'s .env, data or PEM files (the new layout)', async () => {
  // What the audit showed on the flat install, asked of the new scripts with the refusal taken away: even when
  // the owner forces the archive in, it lands in its own folder.
  const i = ownedInstall('3.1.0')
  const archive = pack(smallTree(tmp(), '3.2.0', { '.env.example': 'AGENT_MNEMONIC=\n' }))
  const r = await sh(GET, [], { HOME: i.home, FOXAGENT_NO_RUN: '1', FOXAGENT_SOURCE: archive })
  assert.equal(r.status, 0, r.out)
  i.untouched()
  assert.deepEqual(readdirSync(i.dir).sort(), ['.env', '.node', 'data', 'pem', 'versions'], 'a release adds nothing to the install folder but its own folder under versions/')
})

test('INSTALL-16: no path that belongs to an install is tracked in the repository, so no release can hold one', (t) => {
  if (!existsSync(join(REPO, '.git'))) return t.skip('not a git checkout (a release archive holds no .git)')
  const tracked = execFileSync('git', ['-C', REPO, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean)
  // The website's sources stay out of every release (.gitattributes: site export-ignore).
  const inRelease = tracked.filter(p => !p.startsWith('site/'))
  const bad = inRelease.filter(p => {
    const parts = p.split('/')
    return ['data', 'pem', 'keys'].includes(parts[0]!) || parts.some(x => x === '.env' || x === '.node' || x === 'node_modules' || (x.startsWith('.env.') && x !== '.env.example') || x.endsWith('.pem'))
  })
  assert.deepEqual(bad, [])
  assert.match(readFileSync(join(REPO, '.gitattributes'), 'utf8'), /^site export-ignore$/m)
})
