// Audit 2026-11-11 (Fable 5.2 reviewers at extra-high effort): DOCS-11, part (c), failing on the old text.
// DOCS: what becomes public with the repository named the maintainers' own website server (its address, its deploy
// user and another site it hosts) in site/README.md and the nginx files, and two other private projects in comments
// that the sign-in page and the dashboard send to every browser. The real values live outside the repository
// (site/.host, which git ignores, or SITE_HOST). Parts (a), (b) and (d) of DOCS-11 (the "Coming soon" frames, the
// status line of the README and the version) are the launch-day pull request and are not checked here.
//
// The private names themselves are held as SHA-256 digests only (pre-release audit 2026-11-22, REL-2): this file is
// tracked and packed into every release, so it must not publish what it guards (test/audit-1122/private-names.ts).
// No assertion prints a word: a hit is told by its file, its line and the start of its digest.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ADDRESS_PREFIXES, DEPLOY_USERS, HOSTING_WORDS, PRIVATE_WORDS, hitsIn, trackedTexts } from '../audit-1122/private-names.ts'

const ROOT = new URL('../../', import.meta.url)
const raw = (f: string) => readFileSync(new URL(f, ROOT), 'utf8')
const SITE = ['site/README.md', 'site/nginx/agent.foxleague.ai.conf', 'site/nginx/agent.foxleague.ai.http-only.conf', 'site/deploy-site.sh']

test('DOCS-11c the site\'s files give no address of a server, no deploy user and no other site on it', () => {
  for (const f of SITE) {
    const text = raw(f)
    assert.doesNotMatch(text, /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, `${f} gives an IP address`)
    assert.doesNotMatch(text, /foxsy\.ai/, `${f} names another site of the maintainers`)
    assert.deepEqual(hitsIn(f, text, { words: PRIVATE_WORDS }), [], `${f} names another site of the maintainers`)
    assert.deepEqual(hitsIn(f, text, { words: HOSTING_WORDS }), [], `${f} names the hosting`)
    assert.deepEqual(hitsIn(f, text, { users: DEPLOY_USERS }), [], `${f} names the deploy user`)
  }
  assert.match(raw('site/README.md').replace(/\s+/g, ' '), /The real address and the deploy user are kept outside the repository/)
})

test('DOCS-11c the deploy script still gets its host from outside the repository: SITE_HOST or site/.host, which git ignores', () => {
  const sh = raw('site/deploy-site.sh')
  assert.match(sh, /HOST=\$\{SITE_HOST:-\$\(cat "\$REPO\/site\/\.host" 2>\/dev\/null \|\| true\)\}/)
  assert.match(sh, /\[ -n "\$HOST" \] \|\| \{ echo "Set SITE_HOST=/)
  assert.ok(raw('site/.gitignore').split('\n').includes('.host'))
  const repo = fileURLToPath(ROOT)
  assert.equal(execFileSync('git', ['-C', repo, 'ls-files', 'site/.host'], { encoding: 'utf8' }).trim(), '', 'site/.host is not tracked')
  assert.equal(execFileSync('git', ['-C', repo, 'check-ignore', 'site/.host'], { encoding: 'utf8' }).trim(), 'site/.host')
})

test('DOCS-11c the pages sent to every browser, and the code beside them, name no other project of the maintainers', () => {
  for (const f of ['src/web/login.html', 'src/web/dashboard.html', 'src/web/auth.ts', 'test/web.test.ts']) {
    assert.deepEqual(hitsIn(f, raw(f), { words: PRIVATE_WORDS }), [], f)
  }
})

test('DOCS-11c no tracked file outside the review record names a private server or project', () => {
  // This file and its helper are searched too: they hold digests only.
  const hits = trackedTexts(fileURLToPath(ROOT))
    .filter(({ file }) => file !== 'docs/SECURITY-REVIEW.md')
    .flatMap(({ file, text }) => hitsIn(file, text, { words: PRIVATE_WORDS, addresses: ADDRESS_PREFIXES }))
  assert.deepEqual(hits, [])
})
