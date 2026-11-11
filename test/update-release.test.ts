// The maintainers' release tool: what it packs, what it signs and what it refuses to publish.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildRelease, newKey, pinnedKeys, saveKey } from '../scripts/release/release.ts'
import { fetchRelease, downloadArchive, verifyManifest } from '../src/update/release.ts'
import { detectLayout, stage } from '../src/update/install.ts'
import { managedInstall, publish, serve, tmp } from './update-fixtures.ts'

/** A small git repository that looks like the project: package.json, a service, an install.sh and the pinned keys. */
function repo(version: string, keys: string[]): string {
  const dir = tmp('fox-repo-')
  const git = (...args: string[]): void => void execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { stdio: 'pipe' })
  execFileSync('git', ['init', '-q', '-b', 'main', dir])
  const write = (v: string, k: string[]): void => {
    mkdirSync(join(dir, 'src', 'update'), { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'foxleague-agent', version: v }, null, 2))
    writeFileSync(join(dir, 'src', 'service.ts'), `// ${v}\n`)
    writeFileSync(join(dir, 'install.sh'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 })
    writeFileSync(join(dir, 'src', 'update', 'keys.ts'), `export const RELEASE_KEYS: readonly string[] = [\n${k.map(p => `  \`${p}\`,`).join('\n')}\n]\n`)
    git('add', '-A')
    git('commit', '-q', '-m', `v${v}`)
    git('tag', `v${v}`)
  }
  write(version, keys)
  writers.set(dir, write)
  return dir
}
const writers = new Map<string, (version: string, keys: string[]) => void>()
/** The next commit and tag of a repository made by repo(). */
const next = (dir: string, version: string, keys: string[]): void => writers.get(dir)!(version, keys)

test('REL-1: a built release is the tag, signed, and an installed agent with that key takes it', async () => {
  const key = newKey()
  const dir = repo('1.0.0', [key.publicPem])
  assert.deepEqual(pinnedKeys(readFileSync(join(dir, 'src', 'update', 'keys.ts'), 'utf8')), [key.publicPem])
  const built = buildRelease({ repo: dir, version: '1.0.0', notes: 'The first public release.\n', privatePem: key.privatePem, out: tmp(), published: '2026-11-18T12:00:00Z' })
  assert.deepEqual(built.files.map(f => f.split('/').at(-1)), ['foxleague-agent-v1.0.0.tar.gz', 'release.json', 'release.json.sig'])
  assert.equal(built.manifest.notes, 'The first public release.')
  const web = await serve(publish(tmp(), [{ dir: built.dir, version: '1.0.0' }], '1.0.0'))
  try {
    const rel = await fetchRelease(web.base, [key.publicPem])
    assert.deepEqual(rel.manifest, built.manifest)
    const inst = managedInstall('0.9.0')
    const archive = join(tmp(), 'a.tar.gz')
    await downloadArchive(web.base, rel.manifest, archive)
    assert.equal(await stage(detectLayout(inst.code), rel.manifest, archive), 'v1.0.0')
    assert.equal(readFileSync(join(inst.root, 'versions', 'v1.0.0', 'src', 'service.ts'), 'utf8'), '// 1.0.0\n', 'exactly the tag\'s files')
  } finally {
    await web.close()
  }
})

test('REL-2: the tool refuses a release that agents would refuse, and never overwrites or prints the private key', () => {
  const key = newKey()
  const other = newKey()
  const dir = repo('1.0.0', [key.publicPem])
  const base = { repo: dir, notes: 'Notes.', out: tmp() }
  assert.throws(() => buildRelease({ ...base, version: '1.0.0', privatePem: other.privatePem }), /not one that v1\.0\.0 pins/)
  assert.throws(() => buildRelease({ ...base, version: '1.0.1', privatePem: key.privatePem }), /no tag v1\.0\.1/)
  assert.throws(() => buildRelease({ ...base, version: 'v1.0.0', privatePem: key.privatePem }), /must be plain/)
  assert.throws(() => buildRelease({ ...base, version: '1.0.0', notes: '  \n', privatePem: key.privatePem }), /notes are empty/)
  assert.throws(() => buildRelease({ ...base, version: '1.0.0', notes: 'x'.repeat(2000), privatePem: key.privatePem }), /longer than/)
  // The next release pins only a new key and is signed with it: agents on 1.0.0 would refuse it.
  next(dir, '1.1.0', [other.publicPem])
  assert.throws(() => buildRelease({ ...base, version: '1.1.0', privatePem: other.privatePem }), /agents on v1\.0\.0 pin other keys and would refuse this release/)
  // The way to rotate: 1.2.0 pins both and is signed with the old one; 1.3.0 may then use the new one.
  const turn = repo('1.0.0', [key.publicPem])
  next(turn, '1.2.0', [key.publicPem, other.publicPem])
  assert.equal(buildRelease({ ...base, repo: turn, version: '1.2.0', privatePem: key.privatePem }).manifest.version, '1.2.0')
  next(turn, '1.3.0', [other.publicPem])
  const rotated = buildRelease({ ...base, repo: turn, version: '1.3.0', privatePem: other.privatePem })
  assert.equal(verifyManifest(readFileSync(join(rotated.dir, 'release.json')), readFileSync(join(rotated.dir, 'release.json.sig'), 'utf8'), [other.publicPem]), true)
  // A release whose own code pins no key is a dead end for every agent that installs it.
  const bare = repo('2.0.0', [])
  assert.throws(() => buildRelease({ repo: bare, version: '2.0.0', notes: 'Notes.', privatePem: key.privatePem, out: tmp() }), /pins no release key/)
  // The key file: written once, readable only by its owner; with a passphrase it is stored encrypted and still signs.
  const file = join(tmp(), 'keys', 'release-key.pem')
  const locked = newKey('correct horse battery')
  saveKey(file, locked.privatePem)
  assert.equal(statSync(file).mode & 0o777, 0o600)
  assert.match(readFileSync(file, 'utf8'), /BEGIN ENCRYPTED PRIVATE KEY/)
  assert.throws(() => saveKey(file, key.privatePem), /already exists: a release key is made once/)
  const lockedRepo = repo('1.0.0', [locked.publicPem])
  assert.throws(() => buildRelease({ repo: lockedRepo, version: '1.0.0', notes: 'Notes.', privatePem: locked.privatePem, passphrase: 'wrong', out: tmp() }))
  assert.equal(buildRelease({ repo: lockedRepo, version: '1.0.0', notes: 'Notes.', privatePem: locked.privatePem, passphrase: 'correct horse battery', out: tmp() }).manifest.version, '1.0.0')
})
