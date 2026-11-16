// INS-A5: one user, two installs. Every guide gives FOXAGENT_DIR ("Another folder is named with FOXAGENT_DIR; it
// must be empty or hold an install of foxleague-agent"; get.ps1 even offers /home/you/fox2 as its example), and a
// git clone next to a pasted install is the same case. The background service has one fixed name for the user
// (foxleague-agent.service; ai.foxleague.agent on a Mac). Step 7 of the second install writes that file anew for
// its own folder and restarts it: the first install's agent is stopped and is never started again, without a
// word. The installer even prepared the owner for two agents: at step 3 it called the first agent's port "used by
// another program" and offered the next one. The first install may be LIVE with paid seats and open bids that
// nobody plays now. Afterwards `./install.sh --uninstall` and `--update` in the FIRST folder act on the SECOND
// folder's agent ("Stopped.").
// Safe: an install never takes the background service away from another install without saying so. It refuses
// with the other folder's name, asks, or gives each folder a service of its own.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO } from '../update-fixtures.ts'
import { answers, freshInstall, guided, realTree, sh } from '../audit-1111/install-helpers.ts'

const login = (port: string): string => `WEB_UI_USER="owner"\nWEB_UI_PASSWORD_HASH="scrypt$c2FsdA==$aGFzaA=="\nWEB_UI_PORT="${port}"\n`

test('INS-A5: a second install in another folder does not take the background service from the first without a word', { timeout: 240_000 }, async () => {
  // The first install, with its background service, as the guided installer leaves it.
  const a = freshInstall()
  a.s.stub('curl', 'exit 0') // the dashboard "answers"
  writeFileSync(join(a.root, '.env'), login('18996'), { mode: 0o600 })
  const first = await guided(a, ['yes', '', '18996', 'n', 'n'], { args: [] })
  assert.equal(first.status, 0, first.out)
  const units = join(a.home, '.config', 'systemd', 'user')
  const unit = join(units, 'foxleague-agent.service')
  assert.match(readFileSync(unit, 'utf8'), new RegExp(`^WorkingDirectory=${a.root}$`, 'm'))

  // The second install of the same user, in the folder FOXAGENT_DIR names (as get.sh leaves it before the installer).
  const root2 = join(a.home, 'fox2')
  const code2 = realTree(join(root2, 'versions', 'v3.1.0'), '3.1.0')
  symlinkSync(join(REPO, 'node_modules'), join(code2, 'node_modules'))
  writeFileSync(join(root2, 'versions', 'active'), 'v3.1.0\n')
  mkdirSync(join(root2, '.node', 'bin'), { recursive: true })
  for (const f of ['node', 'npm']) cpSync(join(a.root, '.node', 'bin', f), join(root2, '.node', 'bin', f))
  chmodSync(join(root2, '.node', 'bin', 'node'), 0o755)
  writeFileSync(join(root2, '.env'), login('18995'), { mode: 0o600 })
  const before = a.s.calls().length
  const t = answers(['yes', '', '18995', 'n', 'n'])
  let second
  try {
    second = await sh(join(code2, 'install.sh'), [], { ...a.env, FOXAGENT_ROOT: root2, FOXAGENT_TTY: t.tty }, { timeoutMs: 60_000 })
  } finally {
    t.close()
  }

  const stillFirst = readdirSync(units).filter(f => f.endsWith('.service')).some(f => new RegExp(`^WorkingDirectory=${a.root}$`, 'm').test(readFileSync(join(units, f), 'utf8')))
  const said = second.out.includes(a.root)
  const restarted = a.s.calls().slice(before).filter(c => /^systemctl --user (restart|stop|disable)/.test(c))
  assert.ok(
    stillFirst || said,
    `the first install (${a.root}) lost its background service to the second and the installer never named it.\n` +
      `The unit now: ${readFileSync(unit, 'utf8').split('\n').filter(l => l.startsWith('WorkingDirectory=')).join(' ')}\nsystemctl after it: ${restarted.join(' | ')}\n` +
      `The second installer's screen from step 7:\n${second.out.slice(second.out.indexOf('7/7'), second.out.indexOf('7/7') + 300)}`,
  )
  assert.ok(existsSync(join(a.root, '.env')))
})
