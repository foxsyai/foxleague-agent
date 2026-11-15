// W-11 (Windows real-PC check of 2026-11-13, low): after the line was pasted again by hand, the release that ran just
// before (1.0.1) was deleted and an older one (1.0.0) kept as the spare. get.sh put the new release in place without
// naming the one it replaced; the new release's first confirmed start (confirmStart) then kept versions/previous as
// an earlier update had left it. No harm (the undo reads versions/pending), but the spare was the wrong one. Safe:
// get.sh writes versions/previous = the release it replaces. The test failed before the fix.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { confirmStart, detectLayout } from '../../src/update/install.ts'
import { REPO, buildRelease, codeTree, publish, serve, testKey, tmp } from '../update-fixtures.ts'

function run(script: string, env: Record<string, string>): Promise<{ status: number; out: string }> {
  return new Promise(done => {
    const child = spawn('bash', [script], { env: { PATH: process.env.PATH ?? '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (b: Buffer) => (out += b.toString('utf8')))
    child.stderr.on('data', (b: Buffer) => (out += b.toString('utf8')))
    child.on('close', code => done({ status: code ?? -1, out }))
  })
}

const tree = (dir: string, version: string): string => codeTree(dir, version, { extra: { 'run.sh': '#!/usr/bin/env bash\n' } })

test('W-11 the line pasted again keeps the release it replaced as the spare, not an older one', async () => {
  const key = testKey()
  const home = tmp('fox-home-')
  const root = join(home, 'foxleague-agent')
  // 1.0.0 installed, then updated from the dashboard to 1.0.1: the confirmed start kept 1.0.0 as the spare.
  tree(join(root, 'versions', 'v1.0.0'), '1.0.0')
  tree(join(root, 'versions', 'v1.0.1'), '1.0.1')
  writeFileSync(join(root, 'versions', 'active'), 'v1.0.1\n')
  writeFileSync(join(root, 'versions', 'previous'), 'v1.0.0\n')
  // The line is pasted again: the newest release, 1.0.3, is put in place by hand.
  const out = tmp()
  buildRelease(out, tree(tmp(), '1.0.3'), '1.0.3', key.privatePem)
  const web = await serve(publish(tmp(), [{ dir: out, version: '1.0.3' }], '1.0.3'))
  try {
    const r = await run(join(REPO, 'get.sh'), { HOME: home, FOXAGENT_RELEASES: web.base, FOXAGENT_NO_RUN: '1' })
    assert.equal(r.status, 0, r.out)
  } finally {
    await web.close()
  }
  assert.equal(readFileSync(join(root, 'versions', 'active'), 'utf8'), 'v1.0.3\n')
  // 1.0.3 starts and stays up.
  confirmStart(detectLayout(join(root, 'versions', 'v1.0.3')))
  assert.equal(readFileSync(join(root, 'versions', 'previous'), 'utf8'), 'v1.0.1\n', 'the spare is the release that ran just before')
  assert.deepEqual(readdirSync(join(root, 'versions')).filter(n => n.startsWith('v')).sort(), ['v1.0.1', 'v1.0.3'])
})

test('W-11 the same release pasted again, or a first install, names no spare', async () => {
  const key = testKey()
  const out = tmp()
  buildRelease(out, tree(tmp(), '1.0.3'), '1.0.3', key.privatePem)
  const web = await serve(publish(tmp(), [{ dir: out, version: '1.0.3' }], '1.0.3'))
  try {
    const home = tmp('fox-home-')
    const first = await run(join(REPO, 'get.sh'), { HOME: home, FOXAGENT_RELEASES: web.base, FOXAGENT_NO_RUN: '1' })
    assert.equal(first.status, 0, first.out)
    const versions = join(home, 'foxleague-agent', 'versions')
    assert.ok(!readdirSync(versions).includes('previous'), 'a first install has no spare')
    const again = await run(join(REPO, 'get.sh'), { HOME: home, FOXAGENT_RELEASES: web.base, FOXAGENT_NO_RUN: '1' })
    assert.equal(again.status, 0, again.out)
    assert.ok(!readdirSync(versions).includes('previous'), 'the same release is not its own spare')
  } finally {
    await web.close()
  }
})
