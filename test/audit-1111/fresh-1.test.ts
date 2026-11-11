// FRESH-1 (fresh Ubuntu walk-through, 2026-11-11): the unit the installer writes allows 5 starts in 10 minutes
// (StartLimitBurst, there to end a crash loop). A restart that the owner asks for counts as a start too: on the
// test machine the sixth one (an install, two more runs of the installer, a restart, one update from the dashboard,
// then `./install.sh --update`) was refused by systemd ("Start request repeated too quickly"). The agent was left
// STOPPED, the update said "the old version is still the one running" and the command it named was refused the
// same way. Safe: before a restart the owner asked for, the installer clears the unit's start counter
// (`systemctl --user reset-failed`); when a restart still fails it says what runs now and names a command that works.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildRelease, publish, serve } from '../update-fixtures.ts'
import { KEY, LOGIN_LINES, freshInstall, guided, realTree, running, sh, stubs, tmp } from './install-helpers.ts'

const RESET = 'systemctl --user reset-failed foxleague-agent'
const RESTART = 'systemctl --user restart foxleague-agent'

async function nextRelease(): Promise<{ base: string; close: () => Promise<void> }> {
  const out = tmp()
  buildRelease(out, realTree(tmp(), '3.2.0'), '3.2.0', KEY.privatePem)
  return serve(publish(tmp(), [{ dir: out, version: '3.2.0' }], '3.2.0'))
}

test('FRESH-1: the installer clears the start counter of the unit before it restarts the service', { timeout: 120_000 }, async () => {
  const i = freshInstall()
  i.s.stub('curl', 'exit 0') // the dashboard answers the health check
  writeFileSync(join(i.root, '.env'), LOGIN_LINES, { mode: 0o600 })
  const r = await guided(i, ['yes', '', '18997', 'n', 'n'], { args: [] })
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /Running\./)
  const calls = i.s.calls().filter(c => c.startsWith('systemctl'))
  assert.ok(calls.includes(RESTART), calls.join('\n'))
  assert.ok(calls.includes(RESET), `no reset-failed among:\n${calls.join('\n')}`)
  assert.ok(calls.indexOf(RESET) < calls.indexOf(RESTART), 'the counter is cleared before the restart, not after')
})

test('FRESH-1: an update from a terminal clears the start counter before its restart', { timeout: 240_000 }, async () => {
  const s = stubs()
  const i = running(s)
  const web = await nextRelease()
  try {
    const r = await sh(join(i.root, 'install.sh'), ['--update'], i.env(web.base), { cwd: i.root })
    assert.equal(r.status, 0, r.out)
    assert.match(r.out, /Restarted\./)
    const calls = s.calls().filter(c => c.startsWith('systemctl'))
    assert.ok(calls.includes(RESET), `no reset-failed among:\n${calls.join('\n')}`)
    assert.ok(calls.indexOf(RESET) < calls.indexOf(RESTART))
  } finally {
    await web.close()
  }
})

test('FRESH-1: a restart that systemd refuses is not told as "the old version is still running" when nothing runs', { timeout: 240_000 }, async () => {
  const s = stubs()
  // What systemd answers at its start limit: the stop went through, the start was refused, the unit is not active.
  s.stub('systemctl', `printf 'systemctl %s\\n' "$*" >> "$LOG"\ncase "$*" in *is-active*) exit 3 ;; *restart*) echo "Job for foxleague-agent.service failed." >&2; exit 1 ;; esac`)
  const i = running(s)
  const web = await nextRelease()
  try {
    const r = await sh(join(i.root, 'install.sh'), ['--update'], i.env(web.base), { cwd: i.root })
    assert.notEqual(r.status, 0, r.out)
    assert.match(r.out, /Version 3\.2\.0 is in place\./)
    assert.doesNotMatch(r.out, /the old version is still the one running/, 'nothing is running')
    assert.match(r.out, /Error: the new version is in place but the background service could not be restarted: the agent is not running now\./)
    assert.match(r.out, /systemctl --user reset-failed foxleague-agent && systemctl --user restart foxleague-agent/, 'the command it names is one that systemd takes')
    assert.equal(readFileSync(join(i.root, 'versions', 'active'), 'utf8'), 'v3.2.0\n')
  } finally {
    await web.close()
  }
})

test('FRESH-1: the guided installer says so when the service does not start, and names the log', { timeout: 120_000 }, async () => {
  const i = freshInstall()
  i.s.stub('curl', 'exit 0')
  i.s.stub('systemctl', `printf 'systemctl %s\\n' "$*" >> "$LOG"\ncase "$*" in *is-active*) exit 3 ;; *restart*) echo "Job for foxleague-agent.service failed." >&2; exit 1 ;; esac`)
  writeFileSync(join(i.root, '.env'), LOGIN_LINES, { mode: 0o600 })
  const r = await guided(i, ['yes', '', '18997', 'n', 'n'], { args: [] })
  assert.notEqual(r.status, 0, r.out)
  assert.match(r.out, /Error: the background service did not start\./)
  assert.match(r.out, /journalctl --user -u foxleague-agent/, 'it names where to read why')
  assert.doesNotMatch(r.out, /Running\./)
})
