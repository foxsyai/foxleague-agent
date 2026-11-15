// Audit 2026-11-11: AGENTS.md, the project's instructions, held to what the code and the release process are now
// (the Node.js range of INSTALL-14, the signed releases of the one-click update, the owner's review method).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const ROOT = new URL('../../', import.meta.url)
const raw = (f: string) => readFileSync(new URL(f, ROOT), 'utf8')
const agents = raw('AGENTS.md').replace(/\s+/g, ' ')

test('AGENTS.md names the Node.js range the agent runs on, as package.json and the installer hold it', () => {
  assert.equal((JSON.parse(raw('package.json')) as { engines: { node: string } }).engines.node, '>=22.18.0 <23 || >=24.2.0')
  assert.doesNotMatch(agents, /Node >= 22\.18/, 'any Node.js from 22.18 up is not the rule: 23.x, 24.0 and 24.1 load the service and end at once')
  assert.match(agents, /Node 22 from 22\.18, or 24\.2 and later/)
})

test('AGENTS.md says how a release reaches users: a tag on main with a signed manifest, taken only when signed, additive database changes', () => {
  assert.match(agents, /Releases are tags on `main` \(`v1\.0\.0`, `v1\.0\.1`, \.\.\.\) published with a signed manifest \(`docs\/RELEASING\.md`\)/)
  assert.match(agents, /Installed agents take only signed releases/)
  assert.match(agents, /A database change must stay additive, because an update can be undone/)
  assert.match(agents, /passed both checks and already ran on the maintainer's own server/)
  assert.doesNotMatch(agents, /users update by running it again/)
})

test('AGENTS.md carries the owner\'s review method in one sentence', () => {
  assert.match(agents, /An audit or adversarial review is done by Claude Fable 5\.2 at extra-high effort \(read-only reviewers, one area each\), its fixes by Claude Fable 5\.2 at high effort, and a finding counts only with a test that fails before the fix\./)
})

test('AGENTS.md says where the updater, the launchers and the release tool live, and each of them exists', () => {
  for (const [name, path] of [['`src/update/`', 'src/update/updater.ts'], ['`run.sh`', 'run.sh'], ['`cli.sh`', 'cli.sh'], ['`scripts/release/`', 'scripts/release/release.ts']] as const) {
    assert.ok(agents.slice(agents.indexOf('## Where things live')).includes(name), `${name} is not under Where things live`)
    assert.ok(existsSync(new URL(path, ROOT)), path)
  }
})
