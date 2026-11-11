// INSTALL-6: get.sh put any version over an install, an older one too (FOXAGENT_VERSION=vX.Y.Z from the guide, a
// release that was withdrawn, an archive of another version), without a word. The older code does not know the
// limits and settings added since, so limits the owner set would silently not be applied. Safe: an older version
// over a newer install is refused unless the owner says FOXAGENT_ALLOW_DOWNGRADE=1, and the refusal says what is
// lost. (No database version mark: an update can be undone by the launcher, so older code must open the database.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildRelease, publish, serve } from '../update-fixtures.ts'
import { KEY, REPO, ownedInstall, pack, sh, smallTree, snapshotOf, tmp } from './install-helpers.ts'

const GET = join(REPO, 'get.sh')

test('INSTALL-6: an older version over a newer install is refused, and the refusal says what would be lost', async () => {
  const i = ownedInstall('1.2.0')
  const before = snapshotOf(i.dir)
  const older = pack(smallTree(tmp(), '1.1.9'))
  const env = { HOME: i.home, FOXAGENT_NO_RUN: '1' }
  const r = await sh(GET, [], { ...env, FOXAGENT_SOURCE: older })
  assert.notEqual(r.status, 0, r.out)
  assert.match(r.out, /Error: version 1\.1\.9 is older than the 1\.2\.0 installed in .*\/foxleague-agent: nothing was changed\./)
  assert.match(r.out, /does not know the settings and limits added since, so limits you set would not be applied/)
  assert.match(r.out, /FOXAGENT_ALLOW_DOWNGRADE=1/)
  assert.deepEqual(snapshotOf(i.dir), before, 'the install is exactly as it was: no staging folder, no other release')

  // Every part of the version counts as a number, not as text.
  for (const [installed, offered] of [['1.10.0', '1.9.9'], ['2.0.0', '1.99.99'], ['1.2.10', '1.2.9']] as const) {
    const j = ownedInstall(installed)
    const refused = await sh(GET, [], { HOME: j.home, FOXAGENT_NO_RUN: '1', FOXAGENT_SOURCE: pack(smallTree(tmp(), offered)) })
    assert.match(refused.out, new RegExp(`version ${offered.replace(/\./g, '\\.')} is older than the ${installed.replace(/\./g, '\\.')} installed`), `${offered} over ${installed}`)
    assert.equal(readFileSync(join(j.dir, 'versions', 'active'), 'utf8'), `v${installed}\n`)
  }

  // The owner's explicit word lets it through.
  const forced = await sh(GET, [], { ...env, FOXAGENT_SOURCE: older, FOXAGENT_ALLOW_DOWNGRADE: '1' })
  assert.equal(forced.status, 0, forced.out)
  assert.match(forced.out, /Going back from 1\.2\.0 to 1\.1\.9 because FOXAGENT_ALLOW_DOWNGRADE=1 says so\./)
  assert.equal(readFileSync(join(i.dir, 'versions', 'active'), 'utf8'), 'v1.1.9\n')
  i.untouched()
})

test('INSTALL-6: the same version again and a newer one go through as before', async () => {
  const i = ownedInstall('1.2.0')
  const env = { HOME: i.home, FOXAGENT_NO_RUN: '1' }
  const same = await sh(GET, [], { ...env, FOXAGENT_SOURCE: pack(smallTree(tmp(), '1.2.0', { 'src/again.ts': '// again\n' })) })
  assert.equal(same.status, 0, same.out)
  assert.equal(readFileSync(join(i.dir, 'versions', 'v1.2.0', 'src', 'again.ts'), 'utf8'), '// again\n')
  const newer = await sh(GET, [], { ...env, FOXAGENT_SOURCE: pack(smallTree(tmp(), '1.3.0')) })
  assert.equal(newer.status, 0, newer.out)
  assert.equal(readFileSync(join(i.dir, 'versions', 'active'), 'utf8'), 'v1.3.0\n')
  assert.deepEqual(readdirSync(join(i.dir, 'versions')).sort(), ['active', 'v1.2.0', 'v1.3.0'])
  i.untouched()
})

test('INSTALL-6: FOXAGENT_VERSION naming an older release, and an older flat install, are held to the same rule', async () => {
  // The guide's own line: a given version, from the release server.
  const out11 = tmp()
  buildRelease(out11, smallTree(tmp(), '1.1.0'), '1.1.0', KEY.privatePem)
  const web = await serve(publish(tmp(), [{ dir: out11, version: '1.1.0' }], '1.1.0'))
  try {
    const i = ownedInstall('1.2.0')
    const r = await sh(GET, [], { HOME: i.home, FOXAGENT_NO_RUN: '1', FOXAGENT_RELEASES: web.base, FOXAGENT_VERSION: 'v1.1.0' })
    assert.notEqual(r.status, 0)
    assert.match(r.out, /version 1\.1\.0 is older than the 1\.2\.0 installed/)
    assert.equal(readFileSync(join(i.dir, 'versions', 'active'), 'utf8'), 'v1.2.0\n')
  } finally {
    await web.close()
  }
  // An install made before releases had their own folders, at a later version than the archive.
  const home = tmp('fox-home-')
  const dir = join(home, 'foxleague-agent')
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'foxleague-agent', version: '1.2.0' }, null, 2))
  writeFileSync(join(dir, 'src', 'service.ts'), '// the newer code\n')
  const before = snapshotOf(dir)
  const r = await sh(GET, [], { HOME: home, FOXAGENT_NO_RUN: '1', FOXAGENT_SOURCE: pack(smallTree(tmp(), '0.11.0')) })
  assert.notEqual(r.status, 0)
  assert.match(r.out, /version 0\.11\.0 is older than the 1\.2\.0 installed/)
  assert.deepEqual(snapshotOf(dir), before, 'its code was not removed')
})
