// FRESH-8 (fresh Ubuntu walk-through, 2026-11-11): step 1 of the installer showed npm's own chatter between the
// installer's lines: spinner characters and, on a first run, "npm notice New major version of npm available! ...
// To update run: npm install -g npm@12.2.2". A newcomer reads that as something to do (it is not, and with the
// private Node.js it would change nothing the agent uses). Safe: the installer runs npm with its update notice and
// its progress display switched off, for the first install and for every update.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOGIN_LINES, REPO, freshInstall, guided, realTree, sh, tmp } from './install-helpers.ts'

/** An npm that notes the two settings it was started with and links the real dependencies. */
function noteNpm(file: string, log: string): void {
  writeFileSync(
    file,
    ['#!/usr/bin/env bash', `printf 'notifier=%s progress=%s\\n' "\${npm_config_update_notifier:-unset}" "\${npm_config_progress:-unset}" >> ${JSON.stringify(log)}`, `[ -e node_modules ] || ln -s ${JSON.stringify(join(REPO, 'node_modules'))} node_modules`, ''].join('\n'),
  )
  chmodSync(file, 0o755)
}

test('FRESH-8: the installer runs npm without its update notice and its spinner', { timeout: 120_000 }, async () => {
  const i = freshInstall()
  const log = join(i.home, 'npm-settings.log')
  noteNpm(join(i.root, '.node', 'bin', 'npm'), log)
  writeFileSync(join(i.root, '.env'), LOGIN_LINES, { mode: 0o600 })
  const r = await guided(i, ['yes', '', '18997', 'n', 'n'])
  assert.equal(r.status, 0, r.out)
  assert.ok(existsSync(log), 'npm ran')
  assert.equal(readFileSync(log, 'utf8'), 'notifier=false progress=false\n')
})

test('FRESH-8: an update prepares the new release the same way', async () => {
  const i = freshInstall()
  const log = join(i.home, 'npm-settings.log')
  noteNpm(join(i.root, '.node', 'bin', 'npm'), log)
  const staged = realTree(join(i.root, 'versions', '.staging-v3.2.0'), '3.2.0')
  const r = await sh(join(staged, 'install.sh'), ['--prepare'], { HOME: tmp('fox-home-'), PATH: i.env.PATH!, FOXAGENT_ROOT: i.root })
  assert.equal(r.status, 0, r.out)
  assert.equal(readFileSync(log, 'utf8'), 'notifier=false progress=false\n')
})
