// FRESH-7 (fresh Ubuntu walk-through, 2026-11-11): when a release is out the agent tells the owner on Telegram
// (and in its log) "To install it: send /update here". The command that installs it is /upgrade. Telegram has no
// /update command (/updates is another one: daily or all), so the owner who did as told got no update. Safe: the
// notice names the command the service answers to.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectLayout } from '../../src/update/install.ts'
import { Updater, type UpdaterDeps } from '../../src/update/updater.ts'
import { buildRelease, codeTree, managedInstall, publish, serve, tmp } from '../update-fixtures.ts'
import { KEY, REPO } from './install-helpers.ts'

test('FRESH-7: the notice of a new release names /upgrade, the command that installs it on Telegram', async () => {
  const inst = managedInstall('1.1.0')
  const out = tmp()
  buildRelease(out, codeTree(tmp(), '1.2.0'), '1.2.0', KEY.privatePem, { notes: 'New in 1.2.0.' })
  const web = await serve(publish(tmp(), [{ dir: out, version: '1.2.0' }], '1.2.0'))
  const said: string[] = []
  const kv = new Map<string, string>()
  const d: UpdaterDeps = {
    layout: detectLayout(inst.code), installed: '1.1.0', keys: [KEY.publicPem], source: web.base, isServer: false, enabled: true,
    dataDir: join(inst.root, 'data'), kv: { get: k => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
    notify: t => void said.push(t), restart: async () => undefined,
  }
  try {
    await new Updater(d).check()
  } finally {
    await web.close()
  }
  assert.equal(said.length, 1)
  assert.match(said[0]!, /^To install it: send \/upgrade here or press Update now in the dashboard\./m)
  assert.doesNotMatch(said[0]!, /\/update\b/, 'no command that Telegram does not know')
  // The command the notice names is one the service has.
  const service = readFileSync(join(REPO, 'src', 'service.ts'), 'utf8')
  assert.match(service, /case 'upgrade':/)
  assert.doesNotMatch(service, /case 'update':/)
})
