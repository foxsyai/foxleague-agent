// UPD-A6 (cosmetic): when the new release cannot be prepared, the reason told to the owner on Telegram and in the
// dashboard carries the terminal's colour codes and an empty piece.
//
// stage() (src/update/install.ts:254) appends the last three lines the release's `install.sh --prepare` printed.
// install.sh ends every error through die(), which always prints `\033[1;31mError: ...\033[0m` after an empty line
// (install.sh:58), also when its output is no terminal. So a Node.js download that failed reads, on Telegram:
//   The update to 1.2.0 was not installed: the new version could not be prepared, nothing was changed: Downloading
//   Node.js v22.22.0 (...) |  | ←[1;31mError: Node.js could not be downloaded from nodejs.org. ...←[0m. You run ...
// The dashboard sets it as plain text, so the bytes show there too.
//
// Right: the sentence holds the installer's words only: no control bytes, no empty piece between two bars.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { childEnv, detectLayout, stage } from '../../src/update/install.ts'
import { UpdateError, sha256File, type Manifest } from '../../src/update/release.ts'
import { managedInstall, tmp } from '../update-fixtures.ts'
import { realTree } from '../audit-1111/install-helpers.ts'

test('UPD-A6: the reason of an update that could not be prepared is plain text: no colour codes, no empty piece', { timeout: 120_000 }, async () => {
  // A release with the real install.sh, packed the way a release is.
  const top = 'foxleague-agent-v3.2.0'
  const src = tmp('fox-pack-')
  realTree(join(src, top), '3.2.0')
  const archive = join(tmp('fox-archive-'), 'release.tar.gz')
  execFileSync('tar', ['-czf', archive, '-C', src, top])
  const manifest: Manifest = { name: 'foxleague-agent', version: '3.2.0', sha256: sha256File(archive), size: statSync(archive).size, published: '2026-11-16T10:00:00Z', notes: 'x' }
  const inst = managedInstall('3.1.0')
  // The agent's Node.js has no npm beside it and nodejs.org cannot be reached (curl ends with "could not resolve
  // host"): the release's own --prepare stops with its sentence.
  const bin = tmp('fox-bin-')
  symlinkSync(process.execPath, join(bin, 'node'))
  writeFileSync(join(bin, 'curl'), '#!/usr/bin/env bash\nexit 6\n')
  chmodSync(join(bin, 'curl'), 0o755)
  const env = { ...childEnv(inst.root, { HOME: tmp('fox-home-') }), PATH: `${bin}:/usr/bin:/bin` }
  let message = ''
  await assert.rejects(stage(detectLayout(inst.code), manifest, archive, { env }), (err: unknown) => {
    assert.ok(err instanceof UpdateError)
    message = err.message
    return true
  })
  assert.match(message, /could not be prepared, nothing was changed: .*Node\.js could not be downloaded from nodejs\.org/)
  assert.doesNotMatch(message, /[\u0000-\u0008\u000b-\u001f\u007f]/, `control bytes in what the owner reads: ${JSON.stringify(message)}`)
  assert.doesNotMatch(message, /\|\s*\|/, `an empty piece between two bars: ${JSON.stringify(message)}`)
})
