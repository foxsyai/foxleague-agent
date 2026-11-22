// REL-2 (pre-release audit 2026-11-22, RELEASE): the test that guards DOCS-11 (c) named what it guards. Its search
// pattern held the first two numbers of both servers' addresses, the word of the owner's own dashboard domain and the
// private project names; other lines held the other site's name, the hosting and the deploy user. It excluded itself
// from its own search, so it passed, and `git archive` packs test/ into every release. The check now holds SHA-256
// digests of the words only (test/audit-1122/private-names.ts). No assertion here prints a word: a hit is told by
// its file, line and the start of its digest.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ADDRESS_PREFIXES, DEPLOY_USERS, HOSTING_WORDS, PRIVATE_WORDS, addressPrefixes, digestsIn, hitsIn, sha, userNames, words } from './private-names.ts'

const ROOT = new URL('../../', import.meta.url)
const ALL = { words: new Set([...PRIVATE_WORDS, ...HOSTING_WORDS]), addresses: ADDRESS_PREFIXES, users: DEPLOY_USERS }

test('REL-2 the check of DOCS-11c and its helper name none of the private names they guard against', () => {
  const hits = ['test/audit-1111/docs-11c.test.ts', 'test/audit-1122/private-names.ts', 'test/audit-1122/REL-2.test.ts']
    .flatMap(f => hitsIn(f, readFileSync(new URL(f, ROOT), 'utf8'), ALL))
  assert.deepEqual(hits, [], 'a tracked test names a private name it guards against (packed into every release)')
})

test('REL-2 the check still finds a name: its words, address prefixes and user names (coverage of the helper, no private word)', () => {
  assert.ok(words('see My-Secret_project.example').has('my-secret-project'))
  assert.ok(words('see My-Secret_project.example').has('secret'))
  assert.ok(addressPrefixes('host 10.20.30.40 and 1110.21.3 and /7\\.8\\./').has('10.20'))
  assert.ok(addressPrefixes('host 10.20.30.40 and 1110.21.3').has('110.21'))
  assert.ok(addressPrefixes('a regex /7\\.8\\./').has('7.8'))
  assert.ok(!addressPrefixes('version 22.18 only').has('22.18'), 'two numbers with no dot after them are no address start')
  assert.ok(userNames('ssh deploy@example.org; chown -R keeper: x; user `alice`').has('deploy'))
  assert.ok(userNames('chown -R keeper:keeper x').has('keeper'))
  assert.ok(userNames('the user `alice` deploys').has('alice'))
  const g = { words: new Set([sha('my-secret')]), addresses: new Set([sha('10.20')]), users: new Set([sha('deploy')]) }
  assert.equal(digestsIn('a line about my-secret.example', g).length, 1)
  assert.equal(digestsIn('host 10.20.30.40', g).length, 1)
  assert.equal(digestsIn('ssh deploy@example.org', g).length, 1)
  assert.deepEqual(digestsIn('nothing here: user@host, 22.18, secrets', g), [])
  assert.deepEqual(hitsIn('x.md', 'one\ntwo my-secret\n', g), [`x.md:2 (word ${sha('my-secret').slice(0, 12)})`])
  assert.ok(fileURLToPath(ROOT))
})
