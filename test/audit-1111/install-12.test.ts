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
