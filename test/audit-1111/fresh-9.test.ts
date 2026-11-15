// FRESH-9 (fresh Ubuntu walk-through, 2026-11-11): three small places where the installer left a newcomer guessing.
// a. "Type yes when the words are written down": typing Yes (a capital, as a phone keyboard or a careful person
//    does) asked the same question again without a word. Safe: yes in any case is the yes; anything else is told
//    what to type.
// b. The installer used $USER for `loginctl enable-linger` under `set -u`. Where USER is not set (a shell started
//    by a tool, a minimal container) it ended at step 7 with "USER: unbound variable", after the service was
//    started and before the last screen. Safe: the user's name is asked from the system (`id -un`).
// c. Lines written for a server were shown inside the guided install: "Restart the service to apply it." (there
//    is no service yet at step 3), "Now run check-keys, then restart the service." (the installer does what is
//    needed) and, for the PEM file, "never copy it to the server or into git". Safe: inside the guided install
//    those lines say only what is true there.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateMnemonicInto } from '../../src/wallet/wallet.ts'
import { LOGIN_LINES, REPO, freshInstall, guided, tmp } from './install-helpers.ts'

test('FRESH-9a: Yes with a capital is the typed yes; another answer is told what to type', { timeout: 120_000 }, async () => {
  const i = freshInstall()
  writeFileSync(join(i.root, '.env'), LOGIN_LINES, { mode: 0o600 })
  const r = await guided(i, ['ok', 'Yes', '', '18997', 'n', 'n'])
  assert.equal(r.status, 0, r.out)
  assert.equal(r.unread, 0, 'Yes was taken as the yes: every later answer went to its own question')
  assert.ok(existsSync(join(i.root, 'data', 'words-confirmed')))
  assert.equal((r.out.match(/Type the word yes \(then Enter\) once the words are on paper/g) ?? []).length, 1, 'the answer "ok" was told what to type, once')
  assert.match(r.out, /Done/)
})

test('FRESH-9b: the installer does not need USER in its environment', { timeout: 120_000 }, async () => {
  const i = freshInstall()
  i.s.stub('curl', 'exit 0')
  writeFileSync(join(i.root, '.env'), LOGIN_LINES, { mode: 0o600 })
  const env = { ...i.env } as Record<string, string>
  delete env.USER
  const r = await guided({ ...i, env }, ['yes', '', '18997', 'n', 'n'], { args: [] })
  assert.doesNotMatch(r.out, /unbound variable/)
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /Done/)
  const linger = i.s.calls().filter(c => c.startsWith('loginctl enable-linger'))
  assert.equal(linger.length, 1, i.s.calls().join('\n'))
  assert.match(linger[0]!, /^loginctl enable-linger \S+$/, 'linger is asked for a named user')
})

test('FRESH-9c: inside the guided install the PEM line does not speak of a server or git', () => {
  const home = tmp('fox-home-')
  const envFile = join(home, '.env')
  generateMnemonicInto(envFile)
  const run = (extra: Record<string, string>): string => {
    const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(REPO, 'src', 'cli.ts'), 'export-pem', '1', join(home, 'pem', `agent1${extra.FOXAGENT_GUIDED ? '' : '-plain'}.pem`)], {
      env: { PATH: process.env.PATH ?? '', HOME: home, AGENT_ENV_FILE: envFile, AGENT_DATA_DIR: join(home, 'data'), ...extra },
      encoding: 'utf8',
      cwd: home,
    })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    return r.stdout
  }
  const guidedOut = run({ FOXAGENT_GUIDED: '1' })
  assert.match(guidedOut, /^Wrote .*agent1\.pem \(mode 600\)\./)
  assert.doesNotMatch(guidedOut, /server|git/)
  assert.match(guidedOut, /never send it to anyone/i)
  // Outside the installer the line for a maintainer's machine is as it was.
  assert.match(run({}), /never copy it to the server or into git/)
})

test('FRESH-9c: the installer marks its own calls of the command line as guided', () => {
  const sh = readFileSync(join(REPO, 'install.sh'), 'utf8')
  const cli = /^cli\(\) \{.*\}$/m.exec(sh)?.[0] ?? ''
  assert.match(cli, /FOXAGENT_GUIDED=1/, 'the cli() helper of install.sh sets FOXAGENT_GUIDED=1')
  const src = readFileSync(join(REPO, 'src', 'cli.ts'), 'utf8')
  // The two lines a terminal test cannot reach (they need a real terminal): each has its guided form.
  assert.match(src, /GUIDED \? '' : ' Restart the service to apply it\.'/)
  assert.match(src, /GUIDED \? '' : ' Now run check-keys, then restart the service\.'/)
})
