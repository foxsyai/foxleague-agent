// INSTALL-20: only the guided installer set the modes of the files that hold secrets. A folder moved to another
// machine or restored from a backup without modes (scp -r, a zip, a cloud drive) has .env 644 and pem/ 755: the
// recovery words and every agent's key readable by every local account, and the update, the next step on the
// new machine, started the agent like that. Safe: --update and --prepare (what the dashboard's Update now runs)
// put the modes back: .env 600, data 700, pem 700, pem/*.pem 600.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildRelease, publish, serve } from '../update-fixtures.ts'
import { KEY, mode, realTree, running, sh, stubs, tmp } from './install-helpers.ts'

/** The owner's files as they arrive after `scp -r` to a new machine: modes from the umask. */
function loosened(root: string): () => Record<string, string> {
  for (const d of ['data', 'pem']) mkdirSync(join(root, d), { recursive: true })
  const files: Record<string, string> = { '.env': 'AGENT_MNEMONIC="the owner words"\n', 'data/agent.db': 'the ledger', 'pem/agent1.pem': 'a key', 'pem/agent2.pem': 'a key', 'pem/notes.txt': 'not a key' }
  for (const [f, text] of Object.entries(files)) {
    writeFileSync(join(root, f), text)
    chmodSync(join(root, f), 0o644)
  }
  for (const d of ['data', 'pem']) chmodSync(join(root, d), 0o755)
  return () => Object.fromEntries(['.env', 'data', 'pem', 'pem/agent1.pem', 'pem/agent2.pem'].map(f => [f, mode(join(root, f))]))
}

const TIGHT = { '.env': '600', data: '700', pem: '700', 'pem/agent1.pem': '600', 'pem/agent2.pem': '600' }

test('INSTALL-20: ./install.sh --update puts the modes of .env, data, pem and the PEM files back', { timeout: 240_000 }, async () => {
  const s = stubs()
  const i = running(s)
  const modes = loosened(i.root)
  assert.deepEqual(modes(), { '.env': '644', data: '755', pem: '755', 'pem/agent1.pem': '644', 'pem/agent2.pem': '644' })
  // The release server has nothing newer: the modes are put back all the same.
  const out = tmp()
  buildRelease(out, realTree(tmp(), '3.1.0'), '3.1.0', KEY.privatePem)
  const web = await serve(publish(tmp(), [{ dir: out, version: '3.1.0' }], '3.1.0'))
  try {
    const r = await sh(join(i.root, 'install.sh'), ['--update'], i.env(web.base), { cwd: i.root })
    assert.equal(r.status, 0, r.out)
    assert.match(r.out, /You run 3\.1\.0, the newest version\./)
    assert.deepEqual(modes(), TIGHT)
    assert.match(r.out, /\.env, data and pem are readable by you only again/, 'and it says that it did')
  } finally {
    await web.close()
  }
})

test('INSTALL-20: install.sh --prepare, what the dashboard\'s Update now runs, puts them back too and adds nothing', async () => {
  const s = stubs()
  const root = tmp('fox-root-')
  const staged = realTree(join(root, 'versions', '.staging-v3.2.0'), '3.2.0')
  writeFileSync(join(root, 'versions', 'active'), 'v3.1.0\n')
  const modes = loosened(root)
  const r = await sh(join(staged, 'install.sh'), ['--prepare'], { HOME: tmp('fox-home-'), PATH: `${s.dir}:${process.env.PATH}`, FOXAGENT_ROOT: root })
  assert.equal(r.status, 0, r.out)
  assert.deepEqual(modes(), TIGHT)
  assert.deepEqual(readdirSync(root).sort(), ['.env', '.node-path', 'data', 'pem', 'versions'])
  // Where none of them exists, none is made (INS-1 holds).
  const bare = tmp('fox-root-')
  const staged2 = realTree(join(bare, 'versions', '.staging-v3.2.0'), '3.2.0')
  writeFileSync(join(bare, 'versions', 'active'), 'v3.1.0\n')
  const r2 = await sh(join(staged2, 'install.sh'), ['--prepare'], { HOME: tmp('fox-home-'), PATH: `${s.dir}:${process.env.PATH}`, FOXAGENT_ROOT: bare })
  assert.equal(r2.status, 0, r2.out)
  assert.deepEqual(readdirSync(bare).sort(), ['.node-path', 'versions'])
})
