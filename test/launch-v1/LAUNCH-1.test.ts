// The public release (v1.0.0, Monday 23 Nov 2026): DOCS-11's launch-day items (docs/SECURITY-REVIEW.md, site/README.md
// "Launch day") are done in one pull request, merged on launch day. Until then the site said "Coming soon" around the
// install line, the README said "in internal testing" and the version was 0.11.0.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const pages = (dir: string): string[] =>
  readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? pages(`${dir}/${e.name}`) : /\.mdx?$/.test(e.name) ? [`${dir}/${e.name}`] : []))
const REPO = 'https://github.com/foxsyai/foxleague-agent'

test('LAUNCH-1 the version is 1.0.0 in package.json and in both places of package-lock.json', () => {
  assert.equal(JSON.parse(read('package.json')).version, '1.0.0')
  const lock = JSON.parse(read('package-lock.json'))
  assert.equal(lock.version, '1.0.0')
  assert.equal(lock.packages[''].version, '1.0.0')
})

test('LAUNCH-1 no page of the site says "Coming soon" or wraps the install line in a frame: no banner, no ComingSoon', () => {
  for (const p of pages('site/src/content/docs')) {
    const text = read(p)
    assert.doesNotMatch(text, /^banner:/m, `${p} still has a banner`)
    assert.doesNotMatch(text, /ComingSoon|Coming soon|with the public release/, `${p} still says it is coming`)
  }
  assert.equal(existsSync(join(ROOT, 'site/src/components/ComingSoon.astro')), false, 'the frame is gone with its last use')
  // The pages that sent the reader to the repository through the frame name it themselves now.
  for (const p of ['site/src/content/docs/index.mdx', 'site/src/content/docs/help/server.mdx']) assert.ok(read(p).includes(REPO), `${p} links the repository`)
})

test('LAUNCH-1 the site\'s GitHub icon opens the repository and the README no longer says "in internal testing"', () => {
  assert.match(read('site/astro.config.mjs'), new RegExp(`icon: 'github', label: 'GitHub', href: '${REPO}'`))
  const readme = read('README.md')
  assert.doesNotMatch(readme, /internal testing/)
  assert.match(readme, /^Status: released\./m)
})
