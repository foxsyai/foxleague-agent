// W-16 (Windows real-PC re-test of 2026-11-14, low): after the install line was pasted again (which installed the
// newest release, 1.0.4), the dashboard still showed in red "The update to 1.0.3 did not start and was undone: you
// run 1.0.2 as before..." while its header said V1.0.4. The last one-click result was kept and shown for a day
// whatever ran since. Now each result names the version that told it, and it is shown only while that version runs:
// a re-install by hand or an update from a terminal drops it. The test failed before the fix.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { activate, detectLayout, stage } from '../../src/update/install.ts'
import { Updater, type UpdaterDeps } from '../../src/update/updater.ts'
import { buildRelease, codeTree, managedInstall, testKey, tmp } from '../update-fixtures.ts'

const KEY = testKey()
type Kv = Map<string, string>

/** The updater of an install running `installed` from `code`, with the database `kv` (the one that survives a re-install). */
function updater(code: string, installed: string, kv: Kv, over: Partial<UpdaterDeps> = {}): { up: Updater; said: string[] } {
  const said: string[] = []
  const up = new Updater({
    layout: detectLayout(code), installed, keys: [KEY.publicPem], source: 'http://127.0.0.1:9', isServer: false, enabled: false,
    dataDir: join(code, '..', '..', 'data'), kv: { get: k => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
    notify: t => void said.push(t), restart: async () => undefined, confirmAfterMs: 20, ...over,
  })
  return { up, said }
}
/** An install of 1.0.2 whose update to 1.0.3 the launcher undid (as on the PC), started once: it tells the undo. */
function undoneOn102(kv: Kv): { root: string; code: string } {
  const inst = managedInstall('1.0.2')
  writeFileSync(join(inst.root, 'versions', 'rolled-back'), 'v1.0.2 v1.0.3\n')
  const { up, said } = updater(inst.code, '1.0.2', kv)
  up.start()
  up.stop()
  assert.match(said[0]!, /^The update to 1\.0\.3 did not start and was undone: you run 1\.0\.2 as before\./)
  assert.equal(up.view().last?.kind, 'undone', 'the dashboard of 1.0.2 shows it')
  return inst
}
const until = async (ok: () => boolean, ms = 5000): Promise<void> => {
  const end = Date.now() + ms
  while (!ok() && Date.now() < end) await new Promise(r => setTimeout(r, 10))
  assert.ok(ok(), 'waited too long')
}

test('W-16 after the install line is pasted again (1.0.4 runs), the undo that 1.0.2 told is no longer shown', () => {
  const kv: Kv = new Map()
  const inst = undoneOn102(kv)
  // A restart of the same version: still its result.
  assert.equal(updater(inst.code, '1.0.2', kv).up.view().last?.kind, 'undone')
  // The line pasted again put 1.0.4 in place by hand (no undo note): the agent starts as 1.0.4 with the same database.
  const code104 = codeTree(join(inst.root, 'versions', 'v1.0.4'), '1.0.4')
  writeFileSync(join(inst.root, 'versions', 'active'), 'v1.0.4\n')
  const { up } = updater(code104, '1.0.4', kv)
  up.start()
  up.stop()
  assert.equal(up.view().last, null, 'a result that says "you run 1.0.2" is not shown while 1.0.4 runs')
})

test('W-16 after an update from a terminal the earlier result goes at once, and the new version tells its own once it holds', async () => {
  const kv: Kv = new Map()
  const inst = undoneOn102(kv)
  // ./install.sh --update in a terminal: 1.0.4 prepared and switched to, then the agent restarted into it.
  const layout = detectLayout(inst.code)
  const built = buildRelease(tmp(), codeTree(tmp(), '1.0.4'), '1.0.4', KEY.privatePem)
  activate(layout, await stage(layout, built.manifest, built.archive))
  const { up, said } = updater(join(inst.root, 'versions', 'v1.0.4'), '1.0.4', kv)
  up.start()
  try {
    assert.equal(up.view().last, null, 'not the undo of 1.0.2 while 1.0.4 is being confirmed')
    await until(() => said.length === 1)
    assert.equal(said[0], 'foxleague-agent: Updated from 1.0.2 to 1.0.4.')
    assert.deepEqual(up.view().last && { kind: up.view().last!.kind, version: up.view().last!.version, message: up.view().last!.message }, { kind: 'updated', version: '1.0.4', message: 'Updated from 1.0.2 to 1.0.4.' })
  } finally {
    up.stop()
  }
})
