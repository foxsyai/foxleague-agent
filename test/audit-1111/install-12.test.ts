// INSTALL-12: the site is published from the maintainer's own computer, and site/deploy-site.sh ran `npm ci`
// without --ignore-scripts over the site's dependency tree (site/Dockerfile too). An install script added through
// site/package-lock.json would run there, next to the maintainer's SSH agent and GitHub login; CI never runs
// those scripts, so it would not show. Safe: every `npm ci` a tracked script runs carries --ignore-scripts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { REPO } from './install-helpers.ts'

test('INSTALL-12: every npm ci in the scripts that install or publish carries --ignore-scripts', () => {
  const files = ['install.sh', 'get.sh', 'site/deploy-site.sh', 'site/Dockerfile', ...readdirSync(join(REPO, 'deploy')).filter(f => f.endsWith('.sh')).map(f => `deploy/${f}`)]
  const found: string[] = []
  for (const f of files) {
    for (const [n, line] of readFileSync(join(REPO, f), 'utf8').split('\n').entries()) {
      if (/^\s*#/.test(line)) continue
      for (const call of line.match(/npm (ci|install|i)\b[^&|;)]*/g) ?? []) {
        found.push(`${f}:${n + 1}`)
        assert.match(call, /--ignore-scripts\b/, `${f}:${n + 1}: ${call.trim()}`)
      }
    }
  }
  for (const must of ['install.sh', 'site/deploy-site.sh', 'site/Dockerfile']) assert.ok(found.some(x => x.startsWith(`${must}:`)), `${must} was read and holds an npm ci`)
})

// R71A-2 (the GitHub review of PR #71): the test above reads scripts only. The steps to draw the install videos
// again (site/scripts/videos/README.md) built the site with `cd site && npm ci && npm run build`; the site's own
// README said `npm install`. A maintainer who follows a page runs the install scripts of the site's dependency tree
// on their own computer (INSTALL-12 closed that for the scripts only) and nothing goes red. Safe: every `npm ci` or
// `npm install` a page of the repository gives (the READMEs, AGENTS.md, INSTALL.md, docs/ and the site's manual)
// carries --ignore-scripts in the same command. docs/SECURITY-REVIEW.md is left out: it is the record, whose rows
// quote the old commands as the findings they were.
test('R71A-2: every npm ci or npm install a page tells a maintainer to run carries --ignore-scripts', () => {
  const docs = readdirSync(join(REPO, 'docs')).filter(f => /\.(md|txt)$/.test(f) && f !== 'SECURITY-REVIEW.md').map(f => `docs/${f}`)
  const manual = readdirSync(join(REPO, 'site/src/content/docs'), { recursive: true, encoding: 'utf8' }).filter(f => /\.mdx?$/.test(f)).map(f => `site/src/content/docs/${f}`)
  const pages = ['README.md', 'INSTALL.md', 'AGENTS.md', 'site/README.md', 'site/scripts/videos/README.md', ...docs, ...manual]
  assert.ok(docs.length >= 5 && manual.length >= 15, `the docs (${docs.length}) and the manual (${manual.length}) were found`)
  const found: string[] = []
  const bare: string[] = []
  for (const f of pages) {
    for (const [n, line] of readFileSync(join(REPO, f), 'utf8').split('\n').entries()) {
      // One command: it ends at &&, a pipe, ; or ) as in the scripts, also at the end of its code span.
      for (const call of line.match(/npm (ci|install|i)\b[^&|;)`]*/g) ?? []) {
        found.push(`${f}:${n + 1}`)
        if (!/--ignore-scripts\b/.test(call)) bare.push(`${f}:${n + 1}: ${call.trim()}`)
      }
    }
  }
  assert.deepEqual(bare, [], 'an npm ci or npm install without --ignore-scripts')
  for (const must of ['AGENTS.md', 'site/README.md', 'site/scripts/videos/README.md']) assert.ok(found.some(x => x.startsWith(`${must}:`)), `${must} was read and holds an npm ci`)
})
