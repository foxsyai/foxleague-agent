// The owner's release key (2026-11-20, before the public release): the public half the owner's own `release.ts keygen`
// printed is pinned in src/update/keys.ts, so a release signed with the private half (on the owner's computer only)
// is the one every installed agent takes. Until then the list was empty and every in-app update was refused.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createPublicKey } from 'node:crypto'
import { RELEASE_KEYS } from '../../src/update/keys.ts'
import { pinnedKeys } from '../../scripts/release/release.ts'

const source = readFileSync(new URL('../../src/update/keys.ts', import.meta.url), 'utf8')
const withNewline = (k: string) => (k.endsWith('\n') ? k : `${k}\n`)

test("KEY-1 the owner's release key is pinned: one Ed25519 public key, the one the release tool finds, and no private half", () => {
  assert.equal(RELEASE_KEYS.length, 1, "exactly one release key, the owner's")
  const key = createPublicKey(RELEASE_KEYS[0]!)
  assert.equal(key.type, 'public')
  assert.equal(key.asymmetricKeyType, 'ed25519', 'release.ts keygen makes Ed25519 keys and the agents verify with Ed25519')
  // The tool refuses to build a release whose tag pins no key, and reads them from this file the same way.
  assert.deepEqual(pinnedKeys(source), RELEASE_KEYS.map(withNewline))
  assert.doesNotMatch(source, /PRIVATE KEY/, 'only the public half is ever in the repository')
})
