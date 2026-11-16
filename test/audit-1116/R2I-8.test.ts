// R2I-8 (UPD-U1, the larger half of its own window): UPD-U1 keeps the release a terminal update PUT IN PLACE inside the
// 45 seconds before the confirm. A terminal update spends most of its time before that, preparing the new release in
// versions/.staging-v<version> (the download, then npm ci: a minute on a home line). When the confirm of the running
// release (or any start of the agent: confirmStart runs at every start) lands in that time, versions/active still names
// the running release, nothing is "waiting", and confirmStart removes every folder that starts with ".staging-": the
// folder the other process is preparing in. The update then ends with "the new version could not be prepared" (npm's
// own error about files that are gone) or with a rename that finds no folder, and the owner is left to guess why.
// stage() holds versions/update.lock for exactly that time, and confirmStart does not look at it.
// Same window as UPD-U1, same two processes: `./install.sh --update` typed within 45 seconds after an update's restart
// on an install without a background service (or the service starting again while the terminal prepares).
// Right: the confirm of the running release leaves alone the folder an update in flight is preparing in; the terminal
// update ends well and its release is in place.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { confirmStart, detectLayout, run, type Runner } from '../../src/update/install.ts'
import { Updater, terminalUpdate } from '../../src/update/updater.ts'
import { buildRelease, codeTree, managedInstall, publish, serve, testKey, tmp } from '../update-fixtures.ts'

const KEY = testKey()

test('R2I-8: the confirm of the running release leaves alone the folder a terminal update is still preparing in', async () => {
  // 1.2.0 was just started from 1.1.0 (the launcher counted one start); 1.3.0 is published.
  const inst = managedInstall('1.1.0')
  const code = codeTree(join(inst.root, 'versions', 'v1.2.0'), '1.2.0')
  writeFileSync(join(inst.root, 'versions', 'active'), 'v1.2.0\n')
  writeFileSync(join(inst.root, 'versions', 'pending'), 'v1.1.0 v1.2.0 1\n')
  const out = tmp()
  buildRelease(out, codeTree(tmp(), '1.3.0'), '1.3.0', KEY.privatePem)
  const web = await serve(publish(tmp(), [{ dir: out, version: '1.3.0' }], '1.3.0'))
  const said: string[] = []
  const kv = new Map<string, string>()
  const up = new Updater({
    layout: detectLayout(code), installed: '1.2.0', keys: [KEY.publicPem], source: web.base, isServer: false, enabled: false, confirmAfterMs: 600,
    dataDir: join(inst.root, 'data'), kv: { get: k => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
    notify: t => void said.push(t), restart: async () => undefined, supervised: false,
  })
  const versions = join(inst.root, 'versions')
  const staging = join(versions, '.staging-v1.3.0')
  // The new release's own install.sh --prepare takes its time (npm ci): the confirm of 1.2.0 comes while it runs.
  let stagingAtPrepareEnd: boolean | null = null
  const slowPrepare: Runner = async (cmd, args, o) => {
    if (!args.includes('--prepare')) return run(cmd, args, o)
    assert.ok(existsSync(join(staging, 'install.sh')), 'the release is unpacked in its staging folder')
    assert.ok(existsSync(join(versions, 'update.lock')), 'and the update holds its lock')
    const end = Date.now() + 10_000
    while (!said.includes('foxleague-agent: Updated from 1.1.0 to 1.2.0.') && Date.now() < end) await new Promise(r => setTimeout(r, 25))
    stagingAtPrepareEnd = existsSync(join(staging, 'install.sh'))
    // With the folder gone bash has nothing to run (and nowhere to run it): the prepare fails, as npm does there.
    if (!stagingAtPrepareEnd) return { code: 1, tail: 'npm error enoent: the folder is gone', out: '' }
    return run(cmd, args, o)
  }
  try {
    up.start()
    let to: string | null = null
    let failed = ''
    try {
      to = await terminalUpdate({ layout: detectLayout(code), installed: '1.2.0', keys: [KEY.publicPem], source: web.base, dataDir: join(inst.root, 'data'), say: () => undefined, run: slowPrepare })
    } catch (err) {
      failed = err instanceof Error ? err.message : String(err)
    }
    assert.ok(said.includes('foxleague-agent: Updated from 1.1.0 to 1.2.0.'), 'the confirm of 1.2.0 ran while the terminal update prepared')
    assert.equal(stagingAtPrepareEnd, true, 'the confirm of 1.2.0 removed the folder the terminal update was preparing in')
    assert.equal(failed, '', 'the terminal update failed')
    assert.equal(to, '1.3.0')
    assert.equal(readFileSync(join(versions, 'active'), 'utf8'), 'v1.3.0\n')
  } finally {
    up.stop()
    await web.close()
  }
})

// Added by the fix: the folders wait only while the lock is fresh; a lock a killed update left does not keep them.

test('R2I-8: confirmStart keeps the folders while an update holds a fresh lock, and removes them past a stale one', () => {
  const inst = managedInstall('1.1.0')
  const code = codeTree(join(inst.root, 'versions', 'v1.2.0'), '1.2.0')
  writeFileSync(join(inst.root, 'versions', 'active'), 'v1.2.0\n')
  const versions = join(inst.root, 'versions')
  const staging = join(versions, '.staging-v1.3.0')
  mkdirSync(staging, { recursive: true })
  const old = codeTree(join(versions, 'v0.9.0'), '0.9.0')
  writeFileSync(join(versions, 'update.lock'), '')
  confirmStart(detectLayout(code))
  assert.ok(existsSync(staging) && existsSync(old), 'an update in flight: nothing removed')
  const past = (Date.now() - 31 * 60_000) / 1000
  utimesSync(join(versions, 'update.lock'), past, past)
  confirmStart(detectLayout(code))
  assert.equal(existsSync(staging), false, 'a lock left by a killed update: the staging folder goes')
  assert.equal(existsSync(old), false)
})
