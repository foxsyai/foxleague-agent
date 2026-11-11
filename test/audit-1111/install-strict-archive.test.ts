// The strict archive check (the installer reviewer's design note on the updater): stage() checked the paths of an
// archive, not what kind of entry each one is. A symbolic link in a release can point out of the release folder
// (at the owner's .env, at a system file), and tar follows what it has just unpacked. Safe: an archive that holds
// anything but plain files and folders (a symbolic link, a hard link, a device, a pipe) is refused before it is
// unpacked, by the updater and by get.sh. Read from `tar -tvzf`: the first character of each line, the same in
// GNU tar and bsdtar.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, linkSync, readFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { detectLayout, stage } from '../../src/update/install.ts'
import { UpdateError, sha256File, type Manifest } from '../../src/update/release.ts'
import { REPO, ownedInstall, pack, sh, smallTree, snapshotOf, tmp } from './install-helpers.ts'

const GET = join(REPO, 'get.sh')
const TOP = 'foxleague-agent-v3.2.0'

function manifestOf(archive: string, version: string): Manifest {
  return { name: 'foxleague-agent', version, sha256: sha256File(archive), size: readFileSync(archive).length, published: '2026-11-11T10:00:00Z', notes: '' }
}

/** Release folders that each hold one entry that is not a plain file or folder. */
function odd(): Record<string, string> {
  const link = smallTree(join(tmp(), TOP), '3.2.0')
  symlinkSync('../../../.env', join(link, 'src', 'settings.ts'))
  const folderLink = smallTree(join(tmp(), TOP), '3.2.0')
  symlinkSync('/etc', join(folderLink, 'docs'))
  const hard = smallTree(join(tmp(), TOP), '3.2.0')
  linkSync(join(hard, 'src', 'service.ts'), join(hard, 'src', 'same-file.ts'))
  const pipe = smallTree(join(tmp(), TOP), '3.2.0')
  execFileSync('mkfifo', [join(pipe, 'src', 'a-pipe')])
  return { 'a symbolic link to a file outside': link, 'a symbolic link to a folder': folderLink, 'a hard link': hard, 'a named pipe': pipe }
}

test('strict archive: the updater refuses an archive that holds a link or a special file, before it unpacks anything', async () => {
  for (const [what, tree] of Object.entries(odd())) {
    const i = ownedInstall('3.1.0')
    const before = snapshotOf(i.dir)
    const archive = pack(tree, TOP)
    await assert.rejects(
      stage(detectLayout(join(i.dir, 'versions', 'v3.1.0')), manifestOf(archive, '3.2.0'), archive),
      (err: unknown) => err instanceof UpdateError && /the archive holds something that is not a plain file or folder/.test(err.message),
      what,
    )
    assert.deepEqual(snapshotOf(i.dir), before, `${what}: the install is exactly as it was`)
  }
})

test('strict archive: get.sh refuses the same archives, and touches nothing', async () => {
  for (const [what, tree] of Object.entries(odd())) {
    const i = ownedInstall('3.1.0')
    const before = snapshotOf(i.dir)
    const r = await sh(GET, [], { HOME: i.home, FOXAGENT_NO_RUN: '1', FOXAGENT_SOURCE: pack(tree, TOP) })
    assert.notEqual(r.status, 0, `${what}: ${r.out}`)
    assert.match(r.out, /Error: the download holds something that is not a plain file or folder \(a link or a special file\): nothing was installed/, what)
    assert.deepEqual(snapshotOf(i.dir), before, `${what}: the install is exactly as it was`)
  }
})

test('strict archive: a release packed the way the maintainers pack one (git archive) holds only files and folders and is taken', async (t) => {
  const repo = smallTree(tmp(), '3.2.0', { 'docs/guide.md': 'a guide\n', 'src/deep/er/file.ts': '// deep\n', 'name with spaces.txt': 'x\n' })
  const git = (...args: string[]): string => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: tmp('fox-home-'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } })
  try {
    git('init', '-q')
  } catch {
    return t.skip('git is not on this machine')
  }
  git('add', '.')
  git('commit', '-q', '-m', 'release 3.2.0')
  const archive = join(tmp('fox-archive-'), 'foxleague-agent-v3.2.0.tar.gz')
  git('archive', '--format=tar.gz', '--prefix=foxleague-agent-v3.2.0/', '-o', archive, 'HEAD')
  const i = ownedInstall('3.1.0')
  assert.equal(await stage(detectLayout(join(i.dir, 'versions', 'v3.1.0')), manifestOf(archive, '3.2.0'), archive), 'v3.2.0')
  assert.equal(readFileSync(join(i.dir, 'versions', 'v3.2.0', 'name with spaces.txt'), 'utf8'), 'x\n')
  assert.ok(existsSync(join(i.dir, 'versions', 'v3.2.0', '.prepared')), 'and its own install.sh prepared it')
  // The same archive through get.sh.
  const j = ownedInstall('3.1.0')
  const r = await sh(GET, [], { HOME: j.home, FOXAGENT_NO_RUN: '1', FOXAGENT_SOURCE: archive })
  assert.equal(r.status, 0, r.out)
  assert.equal(readFileSync(join(j.dir, 'versions', 'active'), 'utf8'), 'v3.2.0\n')
})
