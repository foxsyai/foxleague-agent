// INSTALL-5 (medium): set_env in install.sh rebuilt .env as `grep -v "^KEY=" .env || true` plus the new line. With
// one NUL byte in the file (a line appended from Windows PowerShell, which writes UTF-16) grep printed no line at
// all, the error went to /dev/null and the new .env held only the line set_env was asked to write: the recovery
// words, the login and every key were gone. Safe: set_env never loses a line, and refuses to replace .env when it
// would.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOGIN_LINES, REPO, freshInstall, guided, mode, sh, shellFunction, stubs, tmp } from './install-helpers.ts'

const WORDS = 'AGENT_MNEMONIC="abandon abandon abandon (a placeholder, 24 words in a real file)"\n'
// What PowerShell 5 appends with >>: the line in UTF-16, so every second byte is NUL.
const UTF16_LINE = Buffer.from('TELEGRAM_SUMMARY_HOUR=8\r\n', 'utf16le')

/** install.sh's own set_env and get_env, run on a .env in a folder of its own. */
async function helpers(root: string, body: string, path = process.env.PATH ?? ''): Promise<{ status: number; out: string }> {
  const script = join(tmp(), 'helpers.sh')
  const fns = ['say', 'info', 'die', 'count_lines', 'set_env', 'get_env'].map(n => shellFunction(join(REPO, 'install.sh'), n)).join('\n')
  writeFileSync(script, `set -euo pipefail\nROOT=${JSON.stringify(root)}\nENV_FILE="$ROOT/.env"\n${fns}\n${body}\n`)
  return sh(script, [], { PATH: path })
}

test('INSTALL-5: a .env with a NUL byte keeps the recovery words and every other line through set_env', async () => {
  const root = tmp('fox-root-')
  const env = join(root, '.env')
  writeFileSync(env, Buffer.concat([Buffer.from(WORDS + LOGIN_LINES + 'ANTHROPIC_API_KEY="sk-ant-placeholder"\nWEB_UI_PORT="8870"\n'), UTF16_LINE]))
  chmodSync(env, 0o644)
  const r = await helpers(root, 'set_env WEB_UI_PORT 9001\nset_env AGENT_COUNT 1\nprintf "words seen: [%s]\\n" "$(get_env AGENT_MNEMONIC)"')
  assert.equal(r.status, 0, r.out)
  const after = readFileSync(env)
  const text = after.toString('latin1')
  assert.match(text, /^AGENT_MNEMONIC="abandon abandon abandon \(a placeholder, 24 words in a real file\)"$/m, 'the recovery words are still in .env')
  assert.match(text, /^WEB_UI_PASSWORD_HASH=/m, 'the login is still there')
  assert.match(text, /^ANTHROPIC_API_KEY="sk-ant-placeholder"$/m)
  assert.ok(after.includes(UTF16_LINE.subarray(0, UTF16_LINE.length - 2)), 'the line with the NUL bytes is kept byte for byte')
  assert.deepEqual(text.match(/^WEB_UI_PORT=.*$/gm), ['WEB_UI_PORT="9001"'], 'the key that was set appears once, with the new value')
  assert.match(text, /^AGENT_COUNT="1"$/m)
  assert.match(r.out, /words seen: \[abandon abandon abandon/, 'get_env reads the words from such a file too')
  assert.equal(mode(env), '600', 'and .env is readable by the owner only')
  assert.deepEqual(readdirSync(root), ['.env'], 'no temporary file is left')
})

test('INSTALL-5: set_env on an empty and on a missing .env writes its one line (no line selected is not an error)', async () => {
  const root = tmp('fox-root-')
  const r = await helpers(root, 'set_env WEB_UI_PORT 8870\nset_env WEB_UI_PORT 8871\nset_env A_KEY "two words"')
  assert.equal(r.status, 0, r.out)
  assert.equal(readFileSync(join(root, '.env'), 'utf8'), 'WEB_UI_PORT="8871"\nA_KEY="two words"\n')
  assert.equal(mode(join(root, '.env')), '600')
  // A last line without its line end is a line too.
  writeFileSync(join(root, '.env'), 'ONE="1"\nLAST="no line end"')
  const r2 = await helpers(root, 'set_env ONE 2')
  assert.equal(r2.status, 0, r2.out)
  assert.equal(readFileSync(join(root, '.env'), 'utf8'), 'LAST="no line end"\nONE="2"\n')
})

test('INSTALL-5: when grep fails, set_env stops and .env stays as it was', async () => {
  const root = tmp('fox-root-')
  const env = join(root, '.env')
  writeFileSync(env, WORDS + LOGIN_LINES)
  chmodSync(env, 0o600)
  // A grep that fails the way a broken locale or a read error would: status 2, nothing printed.
  const s = stubs({ node: false })
  s.stub('grep', 'echo "grep: an error" >&2\nexit 2')
  const r = await helpers(root, 'set_env WEB_UI_PORT 8870\necho "went on"', `${s.dir}:${process.env.PATH}`)
  assert.notEqual(r.status, 0)
  assert.doesNotMatch(r.out, /went on/)
  assert.match(r.out, /\.env could not be read line by line: it was left as it is/)
  assert.equal(readFileSync(env, 'utf8'), WORDS + LOGIN_LINES, '.env is untouched')
  assert.deepEqual(readdirSync(root), ['.env'], 'no temporary file is left')
  // A grep that answers but drops lines (what the binary-file rule did): refused by the count of lines.
  s.stub('grep', 'for a in "$@"; do [ "$a" = -c ] && { /usr/bin/env -i PATH=/usr/bin:/bin grep "$@"; exit $?; }; done\nexit 1')
  const r2 = await helpers(root, 'set_env WEB_UI_PORT 8870\necho "went on"', `${s.dir}:${process.env.PATH}`)
  assert.notEqual(r2.status, 0)
  assert.match(r2.out, /lines of \S+\.env would be lost: it was left as it is/)
  assert.equal(readFileSync(env, 'utf8'), WORDS + LOGIN_LINES, '.env is untouched')
})

test('INSTALL-5: the whole installer over a .env with a NUL byte keeps the wallet, the login and the keys', { timeout: 120_000 }, async () => {
  const i = freshInstall()
  // A first run makes the wallet; the owner confirms the words.
  writeFileSync(join(i.root, '.env'), LOGIN_LINES, { mode: 0o600 })
  const first = await guided(i, ['yes', '', '18997', 'n', 'n'])
  assert.equal(first.status, 0, first.out)
  const env = join(i.root, '.env')
  const words = /^AGENT_MNEMONIC=.+$/m.exec(readFileSync(env, 'utf8'))?.[0]
  assert.ok(words, 'the first run wrote the recovery words')
  // One line appended from Windows, then the installer again.
  writeFileSync(env, Buffer.concat([readFileSync(env), UTF16_LINE]))
  const again = await guided(i, ['', '', 'n', ''])
  assert.equal(again.status, 0, again.out)
  const text = readFileSync(env).toString('latin1')
  assert.ok(text.includes(words), 'the same recovery words are still in .env')
  assert.match(text, /^WEB_UI_PASSWORD_HASH=/m)
  assert.match(again.out, /Your existing wallet is kept\./)
  assert.equal(i.wordsShown(), 1, 'the words were shown once, on the first run')
  assert.equal(mode(env), '600')
})
