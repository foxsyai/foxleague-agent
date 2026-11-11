// INSTALL-17: the one-line installer run as root (the usual login on a small cloud server) neither refused nor
// warned. It installed a systemd user unit for root: the agent, which holds the recovery words, reads data from
// FoxLeague, the chain and a model and serves a web dashboard, then ran as root. Safe: as root the installer
// stops with one sentence (create a user, or follow docs/SERVER.md) before it downloads or writes anything,
// unless the owner says FOXAGENT_ALLOW_ROOT=1.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOGIN_LINES, REPO, freshInstall, guided, pack, realTree, sh, smallTree, stubs, tmp } from './install-helpers.ts'

/** A stand-in `id` that says uid 0: the scripts ask `id -u`. */
function asRoot(dir: string): void {
  writeFileSync(join(dir, 'id'), '#!/usr/bin/env bash\nif [ "${1:-}" = -u ]; then echo 0; else exec /usr/bin/id "$@"; fi\n', { mode: 0o755 })
}

const SENTENCE = /Error: do not install the agent as root: create a user for it .* or follow docs\/SERVER\.md for a server\. To install as root anyway, put FOXAGENT_ALLOW_ROOT=1 in front of/

test('INSTALL-17: the installer run as root stops with one sentence before it does anything', { timeout: 120_000 }, async () => {
  const i = freshInstall()
  asRoot(i.s.dir)
  writeFileSync(join(i.root, '.env'), LOGIN_LINES, { mode: 0o600 })
  const before = readdirSync(i.root).sort()
  const r = await guided(i, ['yes', '', '18997', 'n', 'n'])
  assert.notEqual(r.status, 0, r.out)
  assert.match(r.out, SENTENCE)
  assert.doesNotMatch(r.out, /1\/7 Node\.js/, 'no step ran')
  assert.deepEqual(i.s.calls(), [], 'no npm, no service manager')
  assert.deepEqual(readdirSync(i.root).sort(), before, 'nothing was written')
  assert.equal(i.wordsShown(), 0)
  // The owner's explicit word: it goes through.
  const allowed = await guided(i, ['yes', '', '18997', 'n', 'n'], { env: { FOXAGENT_ALLOW_ROOT: '1' } })
  assert.equal(allowed.status, 0, allowed.out)
  assert.match(allowed.out, /Done/)
})

test('INSTALL-17: the pasted line run as root stops before it downloads anything', async () => {
  const s = stubs({ node: false, npm: false })
  asRoot(s.dir)
  const home = tmp('fox-home-')
  const archive = pack(smallTree(tmp(), '3.1.0'))
  const env = { HOME: home, PATH: `${s.dir}:${process.env.PATH}`, FOXAGENT_NO_RUN: '1' }
  const r = await sh(join(REPO, 'get.sh'), [], env)
  assert.notEqual(r.status, 0, r.out)
  assert.match(r.out, SENTENCE)
  assert.deepEqual(s.calls(), [], 'no download was asked for')
  assert.equal(existsSync(join(home, 'foxleague-agent')), false, 'no folder was made')
  const allowed = await sh(join(REPO, 'get.sh'), [], { ...env, FOXAGENT_SOURCE: archive, FOXAGENT_ALLOW_ROOT: '1' })
  assert.equal(allowed.status, 0, allowed.out)
})

test('INSTALL-17: what an install that already runs as root needs still works: preparing an update and removing the service', async () => {
  const s = stubs()
  asRoot(s.dir)
  const root = tmp('fox-root-')
  const staged = realTree(join(root, 'versions', '.staging-v3.2.0'), '3.2.0')
  writeFileSync(join(root, 'versions', 'active'), 'v3.1.0\n')
  const env = { HOME: tmp('fox-home-'), PATH: `${s.dir}:${process.env.PATH}`, FOXAGENT_ROOT: root }
  const prepared = await sh(join(staged, 'install.sh'), ['--prepare'], env)
  assert.equal(prepared.status, 0, prepared.out)
  const removed = await sh(join(staged, 'install.sh'), ['--uninstall'], env)
  assert.equal(removed.status, 0, removed.out)
  assert.match(removed.out, /Stopped\. Your folder, your wallet words/)
})
