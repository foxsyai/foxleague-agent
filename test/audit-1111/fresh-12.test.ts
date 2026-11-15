// FRESH-12 (fresh Ubuntu walk-through, 2026-11-11; the review record lists it as noted without a proof): at step 4
// the newcomer pastes the AI key, then the Telegram token. A token that Telegram does not take, or a network that
// does not answer at that moment, ended `configure` before anything was saved: the AI key that was just pasted
// was lost, and the installer ended there at step 4 of 7 with one bare line. Safe: what was typed is saved, the
// Telegram token that did not work is left out and told with where to add it later, and the installer goes on
// whatever the key step answers (every key can be added in the dashboard).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateMnemonicInto } from '../../src/wallet/wallet.ts'
import { LOGIN_LINES, REPO, freshInstall, guided, tmp } from './install-helpers.ts'

test('FRESH-12: the installer goes on when the key step fails, and says where the keys can be added', { timeout: 120_000 }, async () => {
  const i = freshInstall()
  // The install's Node.js with a `configure` that ends as it did on a refused Telegram token.
  writeFileSync(
    join(i.root, '.node', 'bin', 'node'),
    [
      '#!/usr/bin/env bash',
      'for a in "$@"; do',
      `  if [ "$a" = backup-words ]; then echo shown >> ${JSON.stringify(i.shownLog)}; echo " 1. (the recovery words, shown by the stand-in)"; exit 0; fi`,
      '  if [ "$a" = configure ]; then echo "Telegram token rejected: Unauthorized" >&2; exit 1; fi',
      'done',
      `exec ${JSON.stringify(process.execPath)} "$@"`,
      '',
    ].join('\n'),
  )
  chmodSync(join(i.root, '.node', 'bin', 'node'), 0o755)
  writeFileSync(join(i.root, '.env'), LOGIN_LINES, { mode: 0o600 })
  // yes, keep the login, the port, Enter keys now: y, the live permission.
  const r = await guided(i, ['yes', '', '18997', 'y', 'n'])
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /Telegram token rejected/)
  assert.match(r.out, /The install goes on\. Add or change your keys any time in the dashboard: Keys\./)
  assert.match(r.out, /5\/7 Settings/)
  assert.match(r.out, /Done/)
  assert.equal(r.unread, 0)
})

/**
 * `configure` on a real pseudo-terminal (util-linux `script`), each answer typed when its question shows. fetch is
 * replaced by one that fails, so nothing leaves the machine: for the command that is a network that does not answer.
 */
function configureOnTerminal(envFile: string, dataDir: string, answers: [RegExp, string][]): Promise<{ status: number; out: string }> {
  const noNetwork = 'data:text/javascript,globalThis.fetch=()=>Promise.reject(new Error("no network in a test"))'
  const cmd = [process.execPath, '--disable-warning=ExperimentalWarning', '--import', noNetwork, join(REPO, 'src', 'cli.ts'), 'configure'].map(a => `'${a.replaceAll("'", "'\\''")}'`).join(' ')
  return new Promise(done => {
    const child = spawn('script', ['-qfec', cmd, '/dev/null'], { env: { PATH: process.env.PATH ?? '', HOME: tmp('fox-home-'), TERM: 'dumb', AGENT_ENV_FILE: envFile, AGENT_DATA_DIR: dataDir }, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let seen = 0
    let next = 0
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000)
    child.stdout.on('data', (b: Buffer) => {
      out += b.toString('utf8')
      while (next < answers.length) {
        const m = answers[next]![0].exec(out.slice(seen))
        if (!m) break
        seen += m.index + m[0].length
        const reply = answers[next]![1]
        next++
        setTimeout(() => child.stdin.write(`${reply}\n`), 150)
      }
    })
    child.on('close', code => {
      clearTimeout(timer)
      done({ status: code ?? -1, out })
    })
  })
}

test('FRESH-12: a Telegram token that could not be checked is left out, and the AI key typed before it is saved', { timeout: 120_000 }, async t => {
  if (spawnSync('script', ['--version'], { encoding: 'utf8' }).status !== 0) return t.skip('needs `script` (util-linux) for a pseudo-terminal')
  const home = tmp('fox-home-')
  const envFile = join(home, '.env')
  generateMnemonicInto(envFile)
  mkdirSync(join(home, 'data'), { mode: 0o700 }) // the installer makes it at its first step
  const r = await configureOnTerminal(envFile, join(home, 'data'), [
    [/Anthropic API key \(sk-ant-\.\.\.\): /, 'sk-ant-typed-by-the-owner'],
    // (The question since 2026-11-15, never the word bot: test/no-word-bot.test.ts.)
    [/Telegram token from BotFather: /, '123456789:AAH-a-token-that-cannot-be-checked-now'],
    [/Binance API key [^:]*: /, ''],
    [/Binance API secret: /, ''],
  ])
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /The Telegram token was not saved: it could not be checked \(no network in a test\)\./)
  assert.match(r.out, /Saved: ANTHROPIC_API_KEY\./)
  const env = readFileSync(envFile, 'utf8')
  assert.match(env, /^ANTHROPIC_API_KEY="sk-ant-typed-by-the-owner"$/m, 'the key that was typed first is kept')
  assert.doesNotMatch(env, /TELEGRAM_BOT_TOKEN/, 'a token that was not checked is not saved')
  assert.ok(existsSync(envFile))
})
