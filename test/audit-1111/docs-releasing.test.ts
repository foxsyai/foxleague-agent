// Audit 2026-11-11: docs/RELEASING.md, the maintainers' guide to a signed release, held to the release tool and the
// updater. Every number, path and refusal it names is read from the code.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { MAX_ARCHIVE_BYTES, MAX_NOTES_CHARS, archiveName } from '../../src/update/release.ts'
import { CHECK_EVERY_MS, RESTART_EXIT_CODE } from '../../src/update/updater.ts'
import { RELEASE_KEYS } from '../../src/update/keys.ts'
import { DEFAULT_KEY_FILE, buildRelease, newKey, pinnedKeys } from '../../scripts/release/release.ts'

const ROOT = new URL('../../', import.meta.url)
const raw = (f: string) => readFileSync(new URL(f, ROOT), 'utf8')
const guide = raw('docs/RELEASING.md').replace(/\s+/g, ' ')
const tool = raw('scripts/release/release.ts')

test('the key: made once with keygen, a passphrase of at least 8 characters, kept where the tool writes it, public half into keys.ts', () => {
  assert.match(guide, /`node scripts\/release\/release\.ts keygen`/)
  assert.equal(DEFAULT_KEY_FILE, join(homedir(), '.config', 'foxleague-agent', 'release-key.pem'))
  assert.match(guide, /`~\/\.config\/foxleague-agent\/release-key\.pem`/)
  assert.match(tool, /if \(passphrase\.length < 8\) throw new Error/)
  assert.match(guide, /at least 8 characters/)
  assert.match(tool, /already exists: a release key is made once/)
  assert.match(guide, /refuses to replace a key that is already there/)
  assert.match(guide, /never reaches GitHub, CI, a server, a chat or an AI session/)
  assert.match(guide, /`RELEASE_KEYS` in `src\/update\/keys\.ts`/)
  assert.ok(Array.isArray(RELEASE_KEYS))
  // A key written the way the guide says is found by the tool.
  const { publicPem } = newKey()
  assert.deepEqual(pinnedKeys(`export const RELEASE_KEYS: readonly string[] = [\`${publicPem}\`]\n`), [publicPem])
})

test('the steps name the tool\'s own command, its three files and its limits', () => {
  assert.match(guide, /`node scripts\/release\/release\.ts build X\.Y\.Z --notes notes\.txt`/)
  assert.match(tool, /build <version> --notes <file>/)
  assert.equal(MAX_NOTES_CHARS, 1500)
  assert.match(guide, /at most 1,500 characters/)
  assert.equal(archiveName('1.2.3'), 'foxleague-agent-v1.2.3.tar.gz')
  assert.match(guide, /exactly the three files it names: `foxleague-agent-vX\.Y\.Z\.tar\.gz`, `release\.json` and `release\.json\.sig`/)
  assert.match(tool, /gh release create v\$\{built\.manifest\.version\}/)
  assert.match(guide, /`gh release create vX\.Y\.Z \.\.\.`/)
  assert.match(tool, /join\(o\.repo, 'dist', 'release', tag\)/)
  assert.match(guide, /`dist\/release\/vX\.Y\.Z\/`/)
  assert.ok(raw('.gitignore').split('\n').includes('dist/'), 'git ignores dist/')
  assert.match(guide, /`\.\/site\/deploy-site\.sh`/)
  assert.match(guide, /`version` in `package\.json` and in `package-lock\.json`/)
  assert.equal(CHECK_EVERY_MS / 60_000, 10)
  assert.match(guide, /within about 10 minutes/)
  // The newest release is read from GitHub's "latest".
  assert.match(raw('get.sh'), /\$RELEASES\/latest\/download\/release\.json/)
  assert.match(guide, /`releases\/latest\/download\/`/)
})

test('every refusal of the tool is in the table, and the table names no other', () => {
  const refusals: [RegExp, RegExp][] = [
    [/the version must be plain: major\.minor\.patch/, /A version that is not plain `major\.minor\.patch`/],
    [/the release notes are empty/, /Notes that are empty or longer than 1,500 characters/],
    [/the release notes are longer than/, /Notes that are empty or longer than 1,500 characters/],
    [/there is no tag \$\{tag\} with a package\.json/, /A tag `vX\.Y\.Z` that does not exist/],
    [/the tag \$\{tag\} holds version/, /whose `package\.json` holds another version/],
    [/pins no release key in src\/update\/keys\.ts/, /A tag that pins no key in `src\/update\/keys\.ts`/],
    [/the archive is larger than an agent accepts/, /An archive larger than 64 MB/],
    [/this key is not one that \$\{tag\} pins/, /A key that the tag itself does not pin/],
    [/agents on \$\{prev\} pin other keys and would refuse this release/, /A key that the newest release before it does not pin/],
  ]
  for (const [inTool, inGuide] of refusals) {
    assert.match(tool, inTool)
    assert.match(guide, inGuide)
  }
  assert.equal(MAX_ARCHIVE_BYTES, 64 * 1024 * 1024)
  // No refusal of buildRelease is left out: each `throw new Error` of it is one of the nine above.
  const body = tool.slice(tool.indexOf('export function buildRelease'), tool.indexOf('async function main'))
  assert.equal([...body.matchAll(/throw new Error\(/g)].length, refusals.length)
  const table = raw('docs/RELEASING.md').split('| It refuses | Because |\n|---|---|\n')[1]!.split('\n\n')[0]!
  assert.equal(table.split('\n').filter(l => l.startsWith('| ')).length, 7, 'seven rows: the two refusals about the notes share one')
  assert.equal(typeof buildRelease, 'function')
})

test('the rules for every release are the ones the updater relies on', () => {
  assert.equal(RESTART_EXIT_CODE, 75)
  assert.match(guide, /Exit code 75 keeps its meaning/)
  assert.match(raw('install.sh'), /SuccessExitStatus=75\nRestartForceExitStatus=75/)
  assert.match(guide, /Database changes are additive/)
  assert.match(guide, /`run\.sh` stays small and backward compatible/)
  for (const name of ['versions/active', 'versions/pending', 'versions/rolled-back']) {
    assert.ok(raw('run.sh').includes(name.replace('versions/', '$V/')), name)
    assert.ok(guide.includes(`\`${name}\``), name)
  }
  assert.match(guide, /`install\.sh --prepare` touches only the new release's own folder and Node\.js/)
  // --prepare as install.sh has it: the modes, Node.js and the dependencies, nothing else.
  assert.match(raw('install.sh'), /if \[ "\$MODE" = prepare \]; then[^]*?secure_modes\n  ensure_node\n  deps\n  exit 0\nfi/)
  assert.match(raw('src/update/install.ts'), /'bash', \[join\(staging, 'install\.sh'\), '--prepare'\], \{ cwd: staging, env, timeoutMs: 15 \* 60_000 \}/)
  assert.match(guide, /it has 15 minutes/)
  assert.match(guide, /The service definition is not rewritten by an update/)
  assert.match(guide, /tag ruleset on `v\*`/)
})

test('the guide says how a key is rotated and what a withdrawn release means, as keys.ts and the updater have it', () => {
  assert.match(raw('src/update/keys.ts'), /To rotate: add the new key here in a release signed with an old one, then drop the old key in a later release/)
  assert.match(guide, /Release N adds the new public key to `src\/update\/keys\.ts`, next to the old one, and is signed with the \*\*old\*\* key/)
  assert.match(guide, /Release N\+1 is signed with the \*\*new\*\* key/)
  assert.match(guide, /Agents never go back by themselves/)
  assert.match(guide, /publish a higher version that fixes the problem/)
  assert.match(guide, /FOXAGENT_VERSION=vX\.Y\.Z FOXAGENT_ALLOW_DOWNGRADE=1 bash/)
})
