// DOCS-3 (the command line with the private Node.js): every guide told the owner to type `npm run cli -- X` and
// `npm start`. An install whose Node.js is the installer's private copy has no npm and no node on the PATH, so
// each of those lines failed with "npm: command not found", the way back to the recovery words (backup-words)
// included. Safe: ./cli.sh, placed next to run.sh, runs the active release's CLI with the Node.js the installer
// chose, and that is the command the installer and the guides show.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectLayout, refreshLauncher } from '../../src/update/install.ts'
import { codeTree } from '../update-fixtures.ts'
import { LOGIN_LINES, REPO, freshInstall, guided, mode, realTree, sh, systemTools, tmp } from './install-helpers.ts'

test('DOCS-3: ./cli.sh runs the active release with the install\'s own Node.js, on a PATH that has no node and no npm', { timeout: 120_000 }, async () => {
  const i = freshInstall()
  writeFileSync(join(i.root, '.env'), LOGIN_LINES, { mode: 0o600 })
  const first = await guided(i, ['yes', '', '18997', 'n', 'n'])
  assert.equal(first.status, 0, first.out)
  const cli = join(i.root, 'cli.sh')
  assert.ok(existsSync(cli), 'the installer put cli.sh next to run.sh')
  assert.equal(mode(cli), '755')
  assert.match(first.out, /To see them again later, in this folder: \.\/cli\.sh backup-words/)
  assert.match(first.out, /Command line +\.\/cli\.sh/)

  // The owner's shell: the system's tools, no Node.js anywhere on the PATH.
  const bare = { HOME: i.home, PATH: systemTools() }
  assert.notEqual((await sh('', ['-c', 'command -v node || command -v npm'], bare)).status, 0, 'this PATH has no node and no npm')
  const address = await sh(cli, ['address', '1'], bare, { cwd: i.home })
  assert.equal(address.status, 0, address.out)
  assert.match(address.out, /^agent 1: erd1[0-9a-z]{58}/m, 'the words of this install were read from its own .env')
  // The way back to the recovery words (the stand-in Node.js notes that they were shown).
  const words = await sh(cli, ['backup-words'], bare, { cwd: i.home })
  assert.equal(words.status, 0, words.out)
  assert.equal(i.wordsShown(), 2)
  // Its exit status is the CLI's own.
  const unknown = await sh(cli, ['no-such-command'], bare)
  assert.equal(unknown.status, 1)
  assert.match(unknown.out, /backup-words +print the recovery words/)

  // After an update it runs the release that is active, and leaves the launcher's undo note alone.
  const next = join(i.root, 'versions', 'v9.9.9')
  mkdirSync(join(next, 'src'), { recursive: true })
  writeFileSync(join(next, 'src', 'cli.ts'), 'console.log(`the CLI of 9.9.9: ${process.argv.slice(2).join(" ")} | ${process.env.AGENT_ENV_FILE} | ${process.env.AGENT_DATA_DIR}`)\n')
  writeFileSync(join(i.root, 'versions', 'active'), 'v9.9.9\n')
  writeFileSync(join(i.root, 'versions', 'pending'), 'v3.1.0 v9.9.9 0\n')
  const after = await sh(cli, ['agents', 'two words'], bare)
  assert.equal(after.out.trim(), `the CLI of 9.9.9: agents two words | ${join(i.root, '.env')} | ${join(i.root, 'data')}`)
  assert.equal(readFileSync(join(i.root, 'versions', 'pending'), 'utf8'), 'v3.1.0 v9.9.9 0\n', 'only the launcher counts starts')
  // A name that is no release is refused, never run.
  writeFileSync(join(i.root, 'versions', 'active'), '../../elsewhere\n')
  const bad = await sh(cli, ['agents'], bare)
  assert.notEqual(bad.status, 0)
  assert.match(bad.out, /versions\/active does not name a release/)
})

test('DOCS-3: in a git checkout ./cli.sh runs the checkout\'s own code with its own .env and data', async () => {
  const dir = realTree(join(tmp(), 'checkout'), '3.1.0')
  symlinkSync(join(REPO, 'node_modules'), join(dir, 'node_modules'))
  const r = await sh(join(dir, 'cli.sh'), ['setup'], { HOME: tmp('fox-home-') }, { cwd: tmp() })
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, new RegExp(`New recovery words written to ${join(dir, '.env').replace(/[.]/g, '\\.')}`))
  assert.match(readFileSync(join(dir, '.env'), 'utf8'), /^AGENT_MNEMONIC="[a-z ]+"\n$/)
})

test('DOCS-3: a confirmed update puts the new release\'s cli.sh in the install folder', () => {
  const root = tmp('fox-install-')
  const code = codeTree(join(root, 'versions', 'v3.2.0'), '3.2.0', { extra: { 'run.sh': '#!/usr/bin/env bash\n# run 3.2.0\n', 'cli.sh': '#!/usr/bin/env bash\n# cli 3.2.0\n' } })
  writeFileSync(join(root, 'versions', 'active'), 'v3.2.0\n')
  writeFileSync(join(root, 'cli.sh'), '#!/usr/bin/env bash\n# cli 3.1.0\n')
  chmodSync(join(root, 'cli.sh'), 0o644)
  const changed = refreshLauncher(detectLayout(code))
  assert.ok(changed.includes('cli.sh'), `cli.sh is among the files replaced (${changed.join(', ')})`)
  assert.equal(readFileSync(join(root, 'cli.sh'), 'utf8'), '#!/usr/bin/env bash\n# cli 3.2.0\n')
  assert.equal(mode(join(root, 'cli.sh')), '755')
})

test('DOCS-3: the installer and the guides show commands that work without npm', () => {
  const installer = readFileSync(join(REPO, 'install.sh'), 'utf8')
  assert.doesNotMatch(installer, /npm (run cli|start)/)
  const guide = readFileSync(join(REPO, 'INSTALL.md'), 'utf8')
  assert.doesNotMatch(guide, /npm (run cli|start)/)
  const readme = readFileSync(join(REPO, 'README.md'), 'utf8')
  const commands = readme.slice(readme.indexOf('## Command line'), readme.indexOf('## How it works'))
  assert.match(commands, /^\.\/cli\.sh agents /m)
  assert.match(commands, /^\.\/cli\.sh backup-words /m)
  assert.doesNotMatch(commands, /^npm run cli/m, 'the commands of an installed agent are not npm lines')
})
