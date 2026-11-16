// FI-U5 (the INSTALL reviewer's unproven U5 of the final pass, proven here): versions/update.lock counts as fresh while
// it is younger than 30 minutes, read as `now - mtime < 30 minutes`. A lock whose time is in the future is younger
// than nothing, so it stays fresh until the clock passes it: a lock a killed update left on a machine whose clock ran
// ahead (a wrong clock at boot that the network set right later) refuses every update ("another update is being
// installed right now") and keeps confirmStart from removing old release folders for as long as the clock was ahead,
// days or years. The pasted line (FI-2) reads it the same way.
// Right: a lock is fresh only within 30 minutes either side of now; one further in the future was not made by an
// update that runs on this clock and is taken over like an old one.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { confirmStart, detectLayout, stage } from '../../src/update/install.ts'
import { buildRelease, codeTree, managedInstall, testKey, tmp } from '../update-fixtures.ts'
import { ownedInstall, pack, sh, smallTree } from '../audit-1111/install-helpers.ts'

const KEY = testKey()
const GET = fileURLToPath(new URL('../../get.sh', import.meta.url))
const ahead = (minutes: number): number => (Date.now() + minutes * 60_000) / 1000

test('FI-U5: a lock a day in the future does not refuse every update, and confirmStart removes what it would keep', async () => {
  const inst = managedInstall('1.1.0')
  const versions = join(inst.root, 'versions')
  const lock = join(versions, 'update.lock')
  writeFileSync(lock, '')
  utimesSync(lock, ahead(24 * 60), ahead(24 * 60))
  const built = buildRelease(tmp(), codeTree(tmp(), '1.2.0'), '1.2.0', KEY.privatePem)
  let refused = ''
  try {
    await stage(detectLayout(inst.code), built.manifest, built.archive)
  } catch (err) {
    refused = err instanceof Error ? err.message : String(err)
  }
  assert.doesNotMatch(refused, /another update is being installed right now/, 'a lock a day ahead of the clock refused the update')
  // confirmStart past such a lock: the folders of a killed update go.
  const code = codeTree(join(versions, 'v1.3.0'), '1.3.0')
  writeFileSync(join(versions, 'active'), 'v1.3.0\n')
  const staging = join(versions, '.staging-v1.4.0')
  mkdirSync(staging, { recursive: true })
  writeFileSync(lock, '')
  utimesSync(lock, ahead(24 * 60), ahead(24 * 60))
  confirmStart(detectLayout(code))
  assert.equal(existsSync(staging), false, 'a lock a day ahead kept the staging folder of a killed update')
})

test('FI-U5: the pasted line takes over a lock a day in the future; a lock a few minutes ahead (a clock set back meanwhile) still counts', { timeout: 120_000 }, async () => {
  const i = ownedInstall('1.1.0')
  const lock = join(i.dir, 'versions', 'update.lock')
  const archive = pack(smallTree(tmp(), '1.2.0'))
  writeFileSync(lock, '')
  utimesSync(lock, ahead(10), ahead(10))
  const near = await sh(GET, [], { HOME: i.home, FOXAGENT_NO_RUN: '1', FOXAGENT_SOURCE: archive })
  assert.notEqual(near.status, 0, near.out)
  assert.match(near.out, /another update is being installed right now/)
  utimesSync(lock, ahead(24 * 60), ahead(24 * 60))
  const far = await sh(GET, [], { HOME: i.home, FOXAGENT_NO_RUN: '1', FOXAGENT_SOURCE: archive })
  assert.equal(far.status, 0, far.out)
  assert.equal(readFileSync(join(i.dir, 'versions', 'active'), 'utf8'), 'v1.2.0\n')
  assert.equal(existsSync(lock), false)
})
