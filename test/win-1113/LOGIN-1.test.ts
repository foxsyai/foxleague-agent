// LOGIN-1 (Windows real-PC check of 2026-11-13): step "3/7 Dashboard login" asked "Web UI username [admin]:" and
// Enter took admin, so the PC's install was signed in as admin. The owner decided on 12 Nov 2026 that users create
// their own username and password, with no default. Safe: the question offers no name, an empty answer is refused
// and nothing is saved (the installer asks again). Each test failed before the fix.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateMnemonicInto } from '../../src/wallet/wallet.ts'
import { REPO, tmp } from '../update-fixtures.ts'

/** `set-web-password` on a real pseudo-terminal (util-linux `script`), each answer typed when its question shows. */
function onTerminal(envFile: string, dataDir: string, answers: [RegExp, string][]): Promise<{ status: number; out: string }> {
  const cmd = [process.execPath, '--disable-warning=ExperimentalWarning', join(REPO, 'src', 'cli.ts'), 'set-web-password'].map(a => `'${a.replaceAll("'", "'\\''")}'`).join(' ')
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

function install(lines = ''): { envFile: string; dataDir: string } {
  const home = tmp('fox-home-')
  const envFile = join(home, '.env')
  generateMnemonicInto(envFile)
  if (lines) writeFileSync(envFile, readFileSync(envFile, 'utf8') + lines)
  mkdirSync(join(home, 'data'), { mode: 0o700 })
  return { envFile, dataDir: join(home, 'data') }
}

const hasScript = spawnSync('script', ['--version'], { encoding: 'utf8' }).status === 0
const skip = hasScript ? false : 'needs `script` (util-linux) for a pseudo-terminal'

test('LOGIN-1 the dashboard username has no default: the question offers none and Enter saves nothing', { skip, timeout: 120_000 }, async () => {
  const i = install()
  const r = await onTerminal(i.envFile, i.dataDir, [[/username[^:\n]*: /i, '']])
  assert.match(r.out, /Dashboard username, your own choice \(3 to 32 letters or digits\): /)
  assert.doesNotMatch(r.out, /\[admin\]|admin/i, 'no name is offered')
  assert.notEqual(r.status, 0, 'an empty answer is refused')
  assert.match(r.out, /a username is needed: type one of your own/)
  assert.doesNotMatch(readFileSync(i.envFile, 'utf8'), /WEB_UI_USER|WEB_UI_PASSWORD_HASH/, 'nothing was saved')
})

test('LOGIN-1 an earlier name is not offered either: a login that took admin before is changed by typing a name', { skip, timeout: 120_000 }, async () => {
  const i = install('WEB_UI_USER="admin"\n')
  const empty = await onTerminal(i.envFile, i.dataDir, [[/username[^:\n]*: /i, '']])
  assert.notEqual(empty.status, 0)
  assert.doesNotMatch(empty.out, /\[admin\]/)
  const typed = await onTerminal(i.envFile, i.dataDir, [
    [/username[^:\n]*: /i, 'ana'],
    [/Password \(at least 12 characters\): /, 'correct horse battery'],
    [/Repeat the password: /, 'correct horse battery'],
  ])
  assert.equal(typed.status, 0, typed.out)
  assert.match(readFileSync(i.envFile, 'utf8'), /^WEB_UI_USER="ana"$/m)
  assert.doesNotMatch(readFileSync(i.envFile, 'utf8'), /^WEB_UI_USER="admin"$/m)
})

test('LOGIN-1 the install replay types a username of its own, shows that Enter is refused, and the guides say there is no default', () => {
  const script = readFileSync(join(REPO, 'scripts/release/fresh-install-check.sh'), 'utf8')
  assert.doesNotMatch(script, /Web UI username|\[admin\]|login admin/, 'nothing of the old question is left')
  const typed = [...script.matchAll(/'Dashboard username, your own choice \\\(3 to 32 letters or digits\\\): =>([^']*)'/g)].map(m => m[1])
  assert.deepEqual(typed, ['', 'owner', 'owner', 'sam', 'owner'], 'Enter once in step 4 (refused), a name everywhere else')
  assert.match(script, /check "the username has no default: Enter was refused and asked again \(LOGIN-1\)"/)
  for (const f of ['INSTALL.md', 'site/src/content/docs/start/install.mdx']) {
    const row = readFileSync(join(REPO, f), 'utf8').split('\n').find(l => l.startsWith('| 3. Dashboard login |'))
    assert.ok(row, f)
    assert.match(row!, /There is no default username: Enter alone is refused\./, f)
  }
})
