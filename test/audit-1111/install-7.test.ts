// INSTALL-7B: `./install.sh --update` ended with status 0 when the restart of the background service failed
// (`service_restart && info` inside an if, then exit 0): the old process kept running and nothing said so.
// INSTALL-15B: an install made with --no-service (the owner starts the agent by hand) was given a background
// service by its first update, enabled and started beside the agent that was already running.
// Safe: a failed restart is an error that says what to do; an update restarts a service only when one is
// installed and never installs one.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildRelease, publish, serve } from '../update-fixtures.ts'
import { KEY, realTree, running, sh, stubs, tmp } from './install-helpers.ts'

async function nextRelease(): Promise<{ base: string; close: () => Promise<void> }> {
  const out = tmp()
  buildRelease(out, realTree(tmp(), '3.2.0'), '3.2.0', KEY.privatePem)
  return serve(publish(tmp(), [{ dir: out, version: '3.2.0' }], '3.2.0'))
}

test('INSTALL-7B: an update whose restart failed ends as an error and says how to restart', { timeout: 240_000 }, async () => {
  const s = stubs()
  // No user bus (cron, sudo -u, an ssh command without a session): restart fails, everything else answers.
  s.stub('systemctl', `printf 'systemctl %s\\n' "$*" >> "$LOG"\ncase "$*" in *restart*) echo "Failed to connect to bus: No medium found" >&2; exit 1 ;; esac`)
  const i = running(s)
  const web = await nextRelease()
  try {
    const r = await sh(join(i.root, 'install.sh'), ['--update'], i.env(web.base), { cwd: i.root })
    assert.match(r.out, /Version 3\.2\.0 is in place\./)
    assert.match(r.out, /Failed to connect to bus/)
    assert.notEqual(r.status, 0, 'the update does not end as a success')
    assert.match(r.out, /Error: the new version is in place but the background service could not be restarted: the old version is still the one running\./)
    assert.match(r.out, /systemctl --user restart foxleague-agent/, 'it names the command to run')
    assert.doesNotMatch(r.out, /Restarted\./)
    assert.equal(readFileSync(join(i.root, 'versions', 'active'), 'utf8'), 'v3.2.0\n')
  } finally {
    await web.close()
  }
})

test('INSTALL-15B: an update of an install without a background service does not create one', { timeout: 240_000 }, async () => {
  const s = stubs()
  const i = running(s, { service: false })
  const web = await nextRelease()
  try {
    // No --no-service on the update: the owner types what the installer's last screen shows.
    const r = await sh(join(i.root, 'install.sh'), ['--update'], i.env(web.base), { cwd: i.root })
    assert.equal(r.status, 0, r.out)
    assert.match(r.out, /Version 3\.2\.0 is in place\./)
    assert.deepEqual(s.calls().filter(c => /^(systemctl|loginctl|launchctl)/.test(c)), [], 'no service was installed, enabled or started')
    assert.equal(existsSync(i.unit), false, 'no unit file was written')
    assert.match(r.out, /No background service is installed here: start the agent again to run the new version \(.*\/run\.sh\)\./)
    assert.doesNotMatch(r.out, /Installed and started\./)
  } finally {
    await web.close()
  }
})
