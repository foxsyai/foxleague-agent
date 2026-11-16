// UPD-A2: two asks for the update at the same moment both start an install, and the two installs break each other.
//
// Updater.begin (src/update/updater.ts:254-273) looks at `state` first and sets it to 'downloading' only after
// `await this.check()` (line 265). While the agent knows no release yet (after every start `available` is empty
// until the first check, 30 to 90 seconds later; also after a check that failed), that await lets a second begin()
// pass the same test: the dashboard's Update now from a page that was open before the restart, and /upgrade on
// Telegram, or two devices. Both then run install() side by side on the same file
// data/update/foxleague-agent-v<version>.tar.gz: each stream truncates the other's file and the first to end
// removes it under the other. Seen here: both fail ("the archive is not the size of the signed release" and "an
// unexpected error (see the log)"), nothing is installed, the owner is told twice that the update failed. With
// other timing the one that loses at versions/update.lock sets state back to 'idle' and removes the archive while
// the other still unpacks it.
//
// It fails closed (nothing unsigned is ever installed). Right ("one at a time", UPD-12..20): the first ask installs,
// the second is told that an update is already being installed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectLayout } from '../../src/update/install.ts'
import { Updater, type UpdaterDeps } from '../../src/update/updater.ts'
import { buildRelease, codeTree, managedInstall, publish, serve, testKey, tmp } from '../update-fixtures.ts'

const KEY = testKey()

test('UPD-A2: two asks at the same moment install once: the second is refused and the update goes through', async () => {
  const inst = managedInstall('1.1.0')
  const out = tmp()
  buildRelease(out, codeTree(tmp(), '1.2.0'), '1.2.0', KEY.privatePem)
  const web = await serve(publish(tmp(), [{ dir: out, version: '1.2.0' }], '1.2.0'))
  const said: string[] = []
  const restarts = { n: 0 }
  const kv = new Map<string, string>()
  const d: UpdaterDeps = {
    layout: detectLayout(inst.code), installed: '1.1.0', keys: [KEY.publicPem], source: web.base, isServer: false, enabled: true,
    dataDir: join(inst.root, 'data'), kv: { get: k => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
    notify: t => void said.push(t), restart: async () => void restarts.n++,
  }
  // Silence the "update failed:" stack this code prints; the assertions below tell the story.
  const realError = console.error
  console.error = () => undefined
  try {
    const up = new Updater(d)
    // No check has run yet, as in the first 30 to 90 seconds after every start of the agent.
    assert.equal(up.view().available, null)
    const asks = await Promise.allSettled([up.begin('web UI, owner'), up.begin('Telegram')])
    const started = asks.filter(a => a.status === 'fulfilled' && /^Installing 1\.2\.0/.test(a.value))
    const refused = asks.filter(a => a.status === 'rejected' && /already being installed/.test(String((a.reason as Error).message)))
    const end = Date.now() + 10_000
    while (up.view().state !== 'idle' && restarts.n === 0 && Date.now() < end) await new Promise(r => setTimeout(r, 20))
    await new Promise(r => setTimeout(r, 300)) // let a second install, if one runs, end too
    assert.equal(started.length, 1, `one install starts, not ${started.length}`)
    assert.equal(refused.length, 1, 'the other ask is told that an update is already being installed')
    assert.deepEqual(said.filter(t => /was not installed/.test(t)), [], 'no failure is told')
    assert.equal(readFileSync(join(inst.root, 'versions', 'active'), 'utf8'), 'v1.2.0\n', 'the release is in place')
    assert.equal(restarts.n, 1, 'one restart')
  } finally {
    console.error = realError
    await web.close()
  }
})
