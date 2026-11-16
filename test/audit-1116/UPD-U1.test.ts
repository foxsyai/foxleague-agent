// UPD-U1 (unproven item 1 of the UPDATER review of 16 Nov 2026, section 4): confirmStart keeps only the running
// release and the one before it, and drops versions/pending whoever wrote it. begin() waits for the confirm (UPD-24);
// a terminal update does not. On an install without a background service (the agent started with ./run.sh: nothing
// restarts it after an update), the owner updates to 1.2.0 and starts the agent again; within its 45 seconds before the
// confirm, `./install.sh --update` in another terminal puts 1.3.0 in place (versions/active, a pending note for the
// launcher). Then the confirm of 1.2.0 runs: it removed versions/v1.3.0, the release versions/active names, and the
// note. At the agent's next start run.sh finds no code there ("no code in ...; run the install line again") and the
// agent stays down.
// Right: the confirm of the running release leaves alone a release that versions/active names and its note.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { detectLayout } from '../../src/update/install.ts'
import { Updater, terminalUpdate } from '../../src/update/updater.ts'
import { buildRelease, codeTree, managedInstall, publish, serve, testKey, tmp } from '../update-fixtures.ts'

const KEY = testKey()

test('UPD-U1: the confirm of the running release keeps the newer release a terminal update put in place meanwhile', async () => {
  // 1.2.0 was just started (the launcher counted one start) from 1.1.0; 1.3.0 is published.
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
    layout: detectLayout(code), installed: '1.2.0', keys: [KEY.publicPem], source: web.base, isServer: false, enabled: false, confirmAfterMs: 1500,
    dataDir: join(inst.root, 'data'), kv: { get: k => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
    notify: t => void said.push(t), restart: async () => undefined, supervised: false,
  })
  const versions = join(inst.root, 'versions')
  try {
    up.start()
    // ./install.sh --update in a terminal, inside the window: the command line of the active release (1.2.0).
    const to = await terminalUpdate({ layout: detectLayout(code), installed: '1.2.0', keys: [KEY.publicPem], source: web.base, dataDir: join(inst.root, 'data'), say: () => undefined })
    assert.equal(to, '1.3.0')
    assert.equal(readFileSync(join(versions, 'active'), 'utf8'), 'v1.3.0\n')
    // The confirm of 1.2.0.
    const end = Date.now() + 10_000
    while (!said.includes('foxleague-agent: Updated from 1.1.0 to 1.2.0.') && Date.now() < end) await new Promise(r => setTimeout(r, 25))
    assert.ok(said.includes('foxleague-agent: Updated from 1.1.0 to 1.2.0.'), said.join('\n'))
    assert.ok(existsSync(join(versions, 'v1.3.0', 'src', 'service.ts')), 'the confirm of 1.2.0 removed v1.3.0, the release versions/active names: the agent cannot start again')
    assert.equal(readFileSync(join(versions, 'pending'), 'utf8'), 'v1.2.0 v1.3.0 0\n', 'the launcher\'s note for 1.3.0 stays, so an undo can go back to 1.2.0')
    assert.ok(existsSync(join(versions, 'v1.2.0')), 'the release to go back to stays')
    // The agent's next start: the launcher starts 1.3.0.
    const r = spawnSync('bash', [join(inst.root, 'run.sh')], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(inst.started().map(p => p.split('/versions/')[1]), ['v1.3.0/src/service.ts'])
  } finally {
    up.stop()
    await web.close()
  }
})
