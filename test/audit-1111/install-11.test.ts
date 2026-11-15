// INSTALL-11: for an install made with git clone, `./install.sh --update` is `git pull --ff-only`: the tip of the
// branch, which may hold commits that are in no release (not yet run on the maintainer's server), while the
// guides promised "the newest release". The pull stays (a checkout follows its branch, that is what one is for);
// safe is that the installer says so in one line before it pulls.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NPM_CI, REPO, realTree, sh, stubs, tmp } from './install-helpers.ts'

test('INSTALL-11: the update of a git checkout says that it follows its branch and may hold unreleased code', { timeout: 120_000 }, async (t) => {
  const gitEnv = { PATH: process.env.PATH ?? '', HOME: tmp('fox-home-'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
  const git = (dir: string, ...args: string[]): string => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', env: gitEnv })
  const origin = realTree(join(tmp(), 'origin'), '3.1.0')
  try {
    git(origin, 'init', '-q', '-b', 'main')
  } catch {
    return t.skip('git is not on this machine')
  }
  writeFileSync(join(origin, '.gitignore'), 'node_modules\n.node-path\n')
  git(origin, 'add', '.')
  git(origin, 'commit', '-q', '-m', 'release 3.1.0')
  const s = stubs()
  const home = tmp('fox-home-')
  const checkout = join(home, 'foxleague-agent')
  git(home, 'clone', '-q', origin, checkout)
  symlinkSync(join(REPO, 'node_modules'), join(checkout, 'node_modules'))
  mkdirSync(join(home, '.config', 'systemd', 'user'), { recursive: true })
  writeFileSync(join(home, '.config', 'systemd', 'user', 'foxleague-agent.service'), '[Unit]\n')
  // A commit merged after the release, in no release yet.
  writeFileSync(join(origin, 'src', 'UNRELEASED.ts'), '// merged an hour ago\n')
  git(origin, 'add', '.')
  git(origin, 'commit', '-q', '-m', 'merged, not released')

  const r = await sh(join(checkout, 'install.sh'), ['--update'], { ...gitEnv, HOME: home, USER: 'tester', PATH: `${s.dir}:${process.env.PATH}`, FOXAGENT_TTY: '/dev/null' }, { cwd: checkout })
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /This folder is a git checkout: it follows its branch \(main\), which may hold code that is in no release yet\./)
  assert.ok(r.out.indexOf('This folder is a git checkout') < r.out.search(/Updating [0-9a-f]+\.\.[0-9a-f]+|Fast-forward/), 'said before the pull')
  // The pull itself is as before: the branch's newest commit, dependencies, restart.
  assert.ok(existsSync(join(checkout, 'src', 'UNRELEASED.ts')))
  // (Before the restart the user's service manager is looked for and the unit's start counter is cleared: FRESH-1.)
  assert.deepEqual(s.calls(), [`${NPM_CI} in ${checkout}`, 'systemctl --user show-environment', 'systemctl --user reset-failed foxleague-agent', 'systemctl --user restart foxleague-agent'])
})
