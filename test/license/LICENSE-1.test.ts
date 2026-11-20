// The owner's decision of 20 Nov 2026, before the public release: the code is open source under the Apache License 2.0,
// copyright Foxsy AI. Until then the repository had no license: public code without one is "all rights reserved".

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
/** sha256 of https://www.apache.org/licenses/LICENSE-2.0.txt as the Apache Software Foundation serves it. */
const APACHE_2_0_SHA256 = 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30'

test('LICENSE-1 LICENSE is the Apache License 2.0, word for word as the Apache Software Foundation publishes it', () => {
  assert.ok(existsSync(join(ROOT, 'LICENSE')), 'a LICENSE file at the root')
  assert.equal(createHash('sha256').update(readFileSync(join(ROOT, 'LICENSE'))).digest('hex'), APACHE_2_0_SHA256)
})

test('LICENSE-1 NOTICE names the work and its copyright holder, Foxsy AI, and what the license does not cover', () => {
  const notice = read('NOTICE')
  assert.match(notice, /^FoxLeague Agent\nCopyright 2026 Foxsy AI\n/)
  // A root LICENSE covers every file; the brand is kept out by name (review of PR #86).
  assert.match(notice.replace(/\s+/g, ' '), /Not covered by the license \(all rights reserved by Foxsy AI\): the names FoxLeague and Foxsy, their logos and the images and videos in site\/public\/ and site\/src\/assets\/ \(with the logo images embedded in src\/web\/login\.html and src\/web\/dashboard\.html\)\./)
  // What it names is there, so the sentence stays true of the tree.
  for (const p of ['site/public', 'site/src/assets']) assert.ok(existsSync(join(ROOT, p)), p)
  for (const p of ['src/web/login.html', 'src/web/dashboard.html']) assert.match(read(p), /data:image\/png;base64,/, `${p} embeds its logo`)
})

test('LICENSE-1 package.json and package-lock.json say Apache-2.0', () => {
  assert.equal(JSON.parse(read('package.json')).license, 'Apache-2.0')
  assert.equal(JSON.parse(read('package-lock.json')).packages[''].license, 'Apache-2.0')
})

test('LICENSE-1 the README says the license, and that the names and logos are not licensed', () => {
  const readme = read('README.md').replace(/\s+/g, ' ')
  assert.match(readme, /## License/)
  assert.match(readme, /Apache License 2\.0/)
  assert.match(readme, /The code and the documentation are open source under the \[Apache License 2\.0\]\(LICENSE\), copyright Foxsy AI/)
  assert.match(readme, /Not covered by the license \(all rights reserved by Foxsy AI\): the names FoxLeague and Foxsy, their logos and the/)
})

test('LICENSE-1 the release archive carries LICENSE and NOTICE: neither is left out of it', () => {
  // The release packs the tag with git archive (scripts/release/release.ts); export-ignore leaves a path out.
  for (const f of ['LICENSE', 'NOTICE']) {
    const attr = execFileSync('git', ['-C', ROOT, 'check-attr', 'export-ignore', '--', f], { encoding: 'utf8' })
    assert.match(attr, /export-ignore: unspecified/, `${f} goes into the release`)
  }
})

