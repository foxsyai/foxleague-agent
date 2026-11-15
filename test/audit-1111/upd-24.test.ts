// UPD-24 (fresh Ubuntu walk-through, 2026-11-11): a new release counts as started once it has been up for 45
// seconds; until then versions/pending still names it and the launcher may still undo it. A second Update now (or
// /upgrade) in that window was accepted: it replaced the note of the first update, so the release that had not yet
// proven that it starts became the one to go back to, and the release before it could be removed. Safe: while the
// last update is not confirmed, a new one is refused with one sentence and nothing is asked, downloaded or switched.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectLayout } from '../../src/update/install.ts'
import { UpdateError } from '../../src/update/release.ts'
import { CONFIRM_AFTER_MS, Updater } from '../../src/update/updater.ts'
import { REPO, buildRelease, codeTree, managedInstall, publish, serve, testKey, tmp } from '../update-fixtures.ts'

const KEY = testKey()
const until = async (ok: () => boolean, ms = 20_000): Promise<void> => {
  const end = Date.now() + ms
  while (!ok() && Date.now() < end) await new Promise(r => setTimeout(r, 25))
  assert.ok(ok(), 'waited too long')
}

/** An install that has just restarted into 1.2.0 from 1.1.0 (the launcher counted one start), with 1.3.0 published. */
async function justUpdated(confirmAfterMs: number) {
  const inst = managedInstall('1.1.0')
  const code = codeTree(join(inst.root, 'versions', 'v1.2.0'), '1.2.0')
  cpSync(join(inst.root, 'run.sh'), join(code, 'run.sh'))
  writeFileSync(join(inst.root, 'versions', 'active'), 'v1.2.0\n')
  writeFileSync(join(inst.root, 'versions', 'pending'), 'v1.1.0 v1.2.0 1\n')
  const out = tmp()
  buildRelease(out, codeTree(tmp(), '1.3.0'), '1.3.0', KEY.privatePem)
  const web = await serve(publish(tmp(), [{ dir: out, version: '1.3.0' }], '1.3.0'))
  const said: string[] = []
  const restarts = { n: 0 }
  const kv = new Map<string, string>()
  const up = new Updater({
    layout: detectLayout(code), installed: '1.2.0', keys: [KEY.publicPem], source: web.base, isServer: false, enabled: true, confirmAfterMs,
    dataDir: join(inst.root, 'data'), kv: { get: k => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
    notify: t => void said.push(t), restart: async () => void restarts.n++,
  })
  const versions = join(inst.root, 'versions')
  return { inst, web, up, said, restarts, versions, hits: () => [...web.hits.values()].reduce((a, b) => a + b, 0) }
}

test('UPD-24: an update asked for while the last one is not yet confirmed is refused, and nothing is started', async () => {
  assert.equal(CONFIRM_AFTER_MS, 45_000)
  const t = await justUpdated(60_000) // not confirmed during this test
  try {
    t.up.start()
    await assert.rejects(t.up.begin('web UI, admin'), (err: unknown) => {
      assert.ok(err instanceof UpdateError, 'a refusal with words for the owner')
      assert.equal(err.message, 'the last update is still being confirmed, try again in a minute')
      return true
    })
    await new Promise(r => setTimeout(r, 300))
    assert.equal(t.hits(), 0, 'the release server was not asked')
    assert.equal(t.up.view().state, 'idle')
    assert.equal(t.restarts.n, 0)
    assert.equal(readFileSync(join(t.versions, 'active'), 'utf8'), 'v1.2.0\n')
    assert.equal(readFileSync(join(t.versions, 'pending'), 'utf8'), 'v1.1.0 v1.2.0 1\n', 'the note of the first update is the launcher\'s to act on')
    assert.ok(existsSync(join(t.versions, 'v1.1.0')), 'the release to go back to is still there')
    assert.ok(!existsSync(join(t.versions, 'v1.3.0')))
    assert.ok(!t.said.some(s => /1\.3\.0/.test(s)))
  } finally {
    t.up.stop()
    await t.web.close()
  }
})

test('UPD-24: once the release has stayed up and is confirmed, the next update is taken', async () => {
  const t = await justUpdated(300)
  try {
    t.up.start()
    await assert.rejects(t.up.begin('Telegram'), /still being confirmed/)
    await until(() => t.said.some(s => s === 'foxleague-agent: Updated from 1.1.0 to 1.2.0.'))
    assert.ok(!existsSync(join(t.versions, 'pending')))
    assert.match(await t.up.begin('Telegram'), /^Installing 1\.3\.0\./)
    await until(() => t.restarts.n === 1)
    assert.equal(readFileSync(join(t.versions, 'active'), 'utf8'), 'v1.3.0\n')
    assert.equal(readFileSync(join(t.versions, 'pending'), 'utf8'), 'v1.2.0 v1.3.0 0\n', 'the confirmed release is the one to go back to')
  } finally {
    t.up.stop()
    await t.web.close()
  }
})

test('UPD-24: Telegram and the dashboard give the sentence as it is, and the troubleshooting page names it', async () => {
  // The service puts "No update was started: " in front and a full stop after; the dashboard shows the words.
  const service = readFileSync(join(REPO, 'src/service.ts'), 'utf8')
  assert.match(service, /return `No update was started: \$\{err\.message\}\.`/)
  assert.match(readFileSync(join(REPO, 'src/web/server.ts'), 'utf8'), /if \(err instanceof UpdateError\) throw new HttpFail\(409, err\.message\)/)
  const page = readFileSync(join(REPO, 'site/src/content/docs/help/troubleshooting.md'), 'utf8')
  assert.ok(page.includes('the last update is still being confirmed, try again in a minute'), 'the row "No update was started" does not give this reason')
})
