// UPD-A5: the pasted install line over an install that already runs the newest version replaces the RUNNING
// release's folder before the new copy has its dependencies. When the installer that follows does not get them in
// (npm cannot reach the registry, Ctrl-C or a closed window at "1/7 Node.js and dependencies"), the release that
// versions/active names has no node_modules: the agent that is running goes on from memory, and at its next start
// (a restart of the machine, a crash, the unit's own restart) it cannot load and stays down.
//
// get.sh:185-190: `mv versions/$name versions/.replaced-get; mv $staging versions/$name; rm -rf .replaced-get`.
// For a NEWER version this is safe (the running release keeps its own folder, and `versions/previous` names it);
// for the SAME version it is the old INSTALL-2 again ("the update replaced the code before npm ci and had no way
// back"), which the release-folder layout was meant to close. Pasting the line again is what the agent itself and the
// guides tell an owner to do ("paste the install line again once"; on Windows it is the only line there is), and
// most of the time the newest release is the one already installed.
//
// Right: after a pasted line whose installer stopped at the dependencies, the release that versions/active names
// still has its dependencies and starts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOGIN_LINES, REPO, freshInstall, guided, pack, realTree, sh, tmp } from '../audit-1111/install-helpers.ts'

test('UPD-A5: the pasted line over the same version never leaves the active release without its dependencies', { timeout: 240_000 }, async () => {
  const i = freshInstall('3.1.0')
  writeFileSync(join(i.root, '.env'), LOGIN_LINES, { mode: 0o600 })
  // The running release's installed dependencies: a real folder (the helper's link is taken out, never followed).
  rmSync(join(i.code, 'node_modules'))
  mkdirSync(join(i.code, 'node_modules', '@anthropic-ai', 'sdk'), { recursive: true })
  writeFileSync(join(i.code, 'node_modules', '@anthropic-ai', 'sdk', 'package.json'), '{"name":"@anthropic-ai/sdk"}\n')
  // The registry cannot be reached today: every `npm ci` fails, wherever it is run.
  const failing = '#!/usr/bin/env bash\necho "npm error code ENOTFOUND" >&2\necho "npm error network request to https://registry.npmjs.org/ failed" >&2\nexit 1\n'
  writeFileSync(join(i.s.dir, 'npm'), failing, { mode: 0o755 })
  writeFileSync(join(i.root, '.node', 'bin', 'npm'), failing, { mode: 0o755 })

  // The owner pastes the install line again; the newest release is the 3.1.0 that already runs.
  const archive = pack(realTree(join(tmp(), 'foxleague-agent-v3.1.0'), '3.1.0'), 'foxleague-agent-v3.1.0')
  const got = await sh(join(REPO, 'get.sh'), [], { ...i.env, FOXAGENT_SOURCE: archive, FOXAGENT_NO_RUN: '1' })
  // The installer that the line starts next (get.sh ends in it): it stops at step 1, the dependencies.
  const r = await guided(i, ['', '', 'n', 'n'])
  assert.notEqual(r.status, 0, 'the installer stopped at the dependencies')

  assert.equal(readFileSync(join(i.root, 'versions', 'active'), 'utf8'), 'v3.1.0\n')
  assert.ok(
    existsSync(join(i.root, 'versions', 'v3.1.0', 'node_modules', '@anthropic-ai', 'sdk', 'package.json')),
    `the release that versions/active names lost its dependencies: the agent cannot start again.\nget.sh said:\n${got.out}\ninstall.sh said:\n${r.out.split('\n').slice(-8).join('\n')}`,
  )
})
