// Audit 2026-11-11 (Fable 5.2 reviewers at extra-high effort): DOCS-13. The manual's eleven screenshots dated from
// 2026-10-06 and showed a dashboard that no longer exists (five levels, no limits per rarity, no counts, the old AI
// cost). They were taken again on 2026-11-11 with site/scripts/screenshots.ts, on its throwaway demo agents.
// What an image shows cannot be read here, so this file holds what can be: every screenshot a page names exists
// and is one the script takes, and the script uses made-up data only (no key, no wallet and no service of the
// machine it runs on).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const DOCS = join(ROOT, 'site/src/content/docs')
const SHOTS = join(ROOT, 'site/public/screenshots')
const pages = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? pages(join(dir, e.name)) : /\.mdx?$/.test(e.name) ? [join(dir, e.name)] : []))

test('DOCS-13 every screenshot a page of the manual names exists, and the script writes each of them', () => {
  const named = new Set(pages(DOCS).flatMap(p => [...readFileSync(p, 'utf8').matchAll(/\]\(\/screenshots\/([a-z0-9-]+\.png)\)/g)].map(m => m[1]!)))
  const files = readdirSync(SHOTS).filter(f => f.endsWith('.png'))
  // Find my team's list (import-team-find.png) since the launch update of 2026-11-22.
  assert.equal(named.size, 11)
  // The script takes one more (add-agent.png), which no page shows today.
  assert.equal(files.length, 12)
  const script = readFileSync(join(ROOT, 'site/scripts/screenshots.ts'), 'utf8')
  for (const f of named) {
    assert.ok(files.includes(f), `${f} is named on a page and is not there`)
    assert.ok(script.includes(`shot('${f.replace(/\.png$/, '')}'`), `${f} is not taken by the script, so it cannot be retaken`)
  }
  for (const f of files) assert.ok(statSync(join(SHOTS, f)).size > 10_000, `${f} is an image`)
})

test('DOCS-13 the script takes them on demo data only: a new throwaway wallet, demo keys, no upstream it could reach', () => {
  const script = readFileSync(join(ROOT, 'site/scripts/screenshots.ts'), 'utf8')
  assert.match(script, /mnemonic: Mnemonic\.generate\(\)\.toString\(\), dataDir: dir, gatewayUrl: 'http:\/\/127\.0\.0\.1:9', apiUrl: 'http:\/\/127\.0\.0\.1:9', foxleagueUrl: 'http:\/\/127\.0\.0\.1:9'/)
  assert.match(script, /const dir = mkdtempSync\(join\(tmpdir\(\), 'foxagent-demo-'\)\)/)
  assert.match(script, /process\.env\.ANTHROPIC_API_KEY = 'sk-ant-api03-DEMOdemo/)
  assert.match(script, /delete process\.env\.BINANCE_API_KEY\ndelete process\.env\.BINANCE_API_SECRET/)
  // It never starts the service (no scheduler, no Telegram reader, no update check) and never loads an env file.
  assert.doesNotMatch(script, /svc\.start\(\)|loadConfig\(|loadEnvFile\(/)
  assert.match(readFileSync(join(ROOT, 'site/README.md'), 'utf8'), /node --disable-warning=ExperimentalWarning site\/scripts\/screenshots\.ts/)
})
