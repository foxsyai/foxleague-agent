// INSTALL-13: generateMnemonicInto decided "words already exist" with /^\s*AGENT_MNEMONIC\s*=\s*\S/m. The \s* after
// the = also crosses line ends, so `AGENT_MNEMONIC=` with nothing after it counted as set whenever a later line
// held text: exactly .env.example. `cp .env.example .env` then made `setup` answer "Recovery words already
// exist" and fail, and the installer said "A new wallet was created" and stopped. Safe: an empty AGENT_MNEMONIC
// line gets its words (in place, no second line), a line that holds anything is never replaced, and the
// installer says a wallet was created only when it was.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateMnemonicInto, validateMnemonic } from '../../src/wallet/wallet.ts'
import { LOGIN_LINES, REPO, freshInstall, guided, mode, tmp } from './install-helpers.ts'

function loaded(file: string): string | undefined {
  const before = process.env.AGENT_MNEMONIC
  delete process.env.AGENT_MNEMONIC
  try {
    process.loadEnvFile(file)
    return process.env.AGENT_MNEMONIC
  } finally {
    if (before === undefined) delete process.env.AGENT_MNEMONIC
    else process.env.AGENT_MNEMONIC = before
  }
}

test('INSTALL-13: an empty AGENT_MNEMONIC line, as .env.example has it, is filled in place', () => {
  const example = readFileSync(join(REPO, '.env.example'), 'utf8')
  assert.match(example, /^AGENT_MNEMONIC=$/m, '.env.example ships the empty line')
  const file = join(tmp(), '.env')
  writeFileSync(file, example, { mode: 0o644 })
  assert.deepEqual(generateMnemonicInto(file), { created: true })
  const text = readFileSync(file, 'utf8')
  const lines = text.match(/^AGENT_MNEMONIC=.*$/gm) ?? []
  assert.equal(lines.length, 1, 'one AGENT_MNEMONIC line, not a second one at the end')
  validateMnemonic(loaded(file) ?? '')
  assert.equal(text.replace(/^AGENT_MNEMONIC=.*$/m, 'AGENT_MNEMONIC='), example, 'every other line is as it was')
  assert.equal(mode(file), '600')
  // A second setup leaves them alone.
  assert.deepEqual(generateMnemonicInto(file), { created: false })
  assert.equal(readFileSync(file, 'utf8'), text)
})

test('INSTALL-13: every way of writing an empty value counts as empty; the last such line gets the words', () => {
  for (const empty of ['AGENT_MNEMONIC=', 'AGENT_MNEMONIC=   ', 'AGENT_MNEMONIC=""', "AGENT_MNEMONIC=''", 'AGENT_MNEMONIC = ', 'AGENT_MNEMONIC=\r', '  AGENT_MNEMONIC=', 'export AGENT_MNEMONIC=']) {
    const file = join(tmp(), '.env')
    writeFileSync(file, `FIRST=1\n${empty}\nLAST=2\n`)
    assert.deepEqual(generateMnemonicInto(file), { created: true }, JSON.stringify(empty))
    const text = readFileSync(file, 'utf8')
    assert.match(text, /^FIRST=1\n(export )?AGENT_MNEMONIC="[a-z ]+"\nLAST=2\n$/, JSON.stringify(empty))
    validateMnemonic(loaded(file) ?? '')
  }
  // Two empty lines: Node reads the last one, so that is the one filled.
  const file = join(tmp(), '.env')
  writeFileSync(file, 'AGENT_MNEMONIC=\nA=1\nAGENT_MNEMONIC=\n')
  assert.deepEqual(generateMnemonicInto(file), { created: true })
  assert.match(readFileSync(file, 'utf8'), /^AGENT_MNEMONIC=\nA=1\nAGENT_MNEMONIC="[a-z ]+"\n$/)
  validateMnemonic(loaded(file) ?? '')
  // No line at all, or only a comment: appended, as before.
  for (const start of ['', 'A=1', '# AGENT_MNEMONIC=\nA=1\n']) {
    writeFileSync(file, start)
    assert.deepEqual(generateMnemonicInto(file), { created: true })
    assert.ok(readFileSync(file, 'utf8').startsWith(start))
    validateMnemonic(loaded(file) ?? '')
  }
})

test('INSTALL-13: a line that holds anything is never replaced and never doubled', () => {
  const words = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
  for (const held of [`AGENT_MNEMONIC="${words}"`, `AGENT_MNEMONIC=${words}`, `export AGENT_MNEMONIC="${words}"`, `  AGENT_MNEMONIC = "${words}"`, 'AGENT_MNEMONIC="not a mnemonic"', 'AGENT_MNEMONIC= # filled in later', 'AGENT_MNEMONIC="', `AGENT_MNEMONIC="${words}"\nAGENT_MNEMONIC=`]) {
    const file = join(tmp(), '.env')
    const before = `A=1\n${held}\nB=2\n`
    writeFileSync(file, before)
    assert.deepEqual(generateMnemonicInto(file), { created: false }, JSON.stringify(held))
    assert.equal(readFileSync(file, 'utf8'), before, `${JSON.stringify(held)} is left as it is`)
  }
})

test('INSTALL-13: the installer on a copy of .env.example makes the wallet', { timeout: 120_000 }, async () => {
  const i = freshInstall()
  const env = join(i.root, '.env')
  writeFileSync(env, readFileSync(join(REPO, '.env.example'), 'utf8') + LOGIN_LINES, { mode: 0o600 })
  const r = await guided(i, ['yes', '', '18997', 'n', ''])
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /A new wallet was created\./)
  assert.equal(i.wordsShown(), 1)
  assert.equal((readFileSync(env, 'utf8').match(/^AGENT_MNEMONIC=.+$/gm) ?? []).length, 1)
  validateMnemonic(loaded(env) ?? '')
  assert.match(readFileSync(env, 'utf8'), /^AGENT_LIVE_ENABLED="0"$/m, 'the commented example line is not a yes: Enter left live signing off')
})

test('INSTALL-13: when the wallet could not be set up, the installer says so and does not call it created', { timeout: 120_000 }, async () => {
  const i = freshInstall()
  writeFileSync(join(i.root, '.env'), LOGIN_LINES, { mode: 0o600 })
  // The CLI's setup fails (as it did on a copy of .env.example): everything else is the real Node.js.
  const node = join(i.root, '.node', 'bin', 'node')
  writeFileSync(node, readFileSync(node, 'utf8').replace('#!/usr/bin/env bash\n', '#!/usr/bin/env bash\nfor a in "$@"; do if [ "$a" = setup ]; then echo "Wrong mnemonic format" >&2; exit 1; fi; done\n'))
  chmodSync(node, 0o755)
  const r = await guided(i, ['yes', '', '18997', 'n', ''])
  assert.notEqual(r.status, 0)
  assert.match(r.out, /Wrong mnemonic format/, 'what the setup said is shown')
  assert.match(r.out, /Error: the wallet could not be set up/)
  assert.doesNotMatch(r.out, /A new wallet was created/)
  assert.equal(i.wordsShown(), 0, 'no words are shown for a wallet that was not made')
  assert.doesNotMatch(r.out, /3\/7 Dashboard login/, 'and the installer stops there')
})
