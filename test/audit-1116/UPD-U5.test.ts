// UPD-U5 (unproven item 5 of the UPDATER review of 16 Nov 2026, section 4): `./install.sh --update` restarts the
// background service after the new release is in place (`systemctl --user restart`, `launchctl kickstart -k`). A
// restart starts a service that is stopped: an owner who stopped the agent (`systemctl --user stop foxleague-agent`;
// on a Mac `launchctl bootout`) and updates it in a terminal has it playing again, LIVE if its database says so,
// signing with the owner's FOXSY and EGLD, and the screen says only "Restarted.". On a Mac the kickstart of a job that
// is not loaded fails and the screen said "the old version is still the one running", which is not so either.
// Right: a service the owner stopped stays stopped; the screen says so, that the new version runs from its next start,
// and the command that starts it. A service that runs (or that failed and is waiting to start again) is restarted as
// before.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildRelease, publish, serve, tmp } from '../update-fixtures.ts'
import { KEY, realTree, running, sh, stubs } from '../audit-1111/install-helpers.ts'

async function update(o: { mac?: boolean; state: string }): Promise<{ out: string; status: number; calls: string[]; root: string }> {
  const s = stubs()
  const i = running(s, { service: !o.mac })
  if (o.mac) {
    s.stub('uname', 'case "${1:-}" in -s | "") echo Darwin ;; -m) /usr/bin/uname -m ;; *) exec /usr/bin/uname "$@" ;; esac')
    mkdirSync(join(i.home, 'Library', 'LaunchAgents'), { recursive: true })
    writeFileSync(join(i.home, 'Library', 'LaunchAgents', 'ai.foxleague.agent.plist'), `<plist version="1.0"><dict><key>Label</key><string>ai.foxleague.agent</string><key>WorkingDirectory</key><string>${i.root}</string></dict></plist>\n`)
    // launchd lists the job only while it is loaded: `print` answers 113 for a job that was booted out.
    if (o.state === 'loaded') writeFileSync(join(s.dir, 'calls.log.loaded'), '')
  } else {
    // systemd as it answers is-active: the state's word, and status 0 only for active.
    s.stub('systemctl', `printf 'systemctl %s\\n' "$*" >> "$LOG"\ncase "$*" in *is-active*) echo ${o.state}; [ ${o.state} = active ] || exit 3 ;; esac`)
  }
  const out = tmp()
  buildRelease(out, realTree(tmp(), '3.2.0'), '3.2.0', KEY.privatePem)
  const web = await serve(publish(tmp(), [{ dir: out, version: '3.2.0' }], '3.2.0'))
  try {
    const r = await sh(join(i.root, 'install.sh'), ['--update'], i.env(web.base), { cwd: i.root })
    assert.equal(readFileSync(join(i.root, 'versions', 'active'), 'utf8'), 'v3.2.0\n', r.out)
    return { out: r.out, status: r.status, calls: s.calls(), root: i.root }
  } finally {
    await web.close()
  }
}

test('UPD-U5: ./install.sh --update leaves a background service the owner stopped stopped, and says so', { timeout: 240_000 }, async () => {
  const r = await update({ state: 'inactive' })
  assert.deepEqual(r.calls.filter(c => /systemctl --user (restart|start) /.test(c)), [], `the stopped agent was started again:\n${r.out}`)
  assert.doesNotMatch(r.out, /Restarted\./)
  assert.match(r.out, /The background service is stopped, so it stays stopped/, r.out)
  assert.match(r.out, /systemctl --user start foxleague-agent/, 'the command that starts it')
  assert.equal(r.status, 0, r.out)
})

test('UPD-U5: on a Mac a background agent that is not loaded is not started by ./install.sh --update, and the screen says so', { timeout: 240_000 }, async () => {
  const r = await update({ mac: true, state: 'booted-out' })
  assert.deepEqual(r.calls.filter(c => /launchctl (kickstart|bootstrap) /.test(c)), [], `the stopped agent was started again:\n${r.out}`)
  assert.doesNotMatch(r.out, /Restarted\.|the old version is still the one running/)
  assert.match(r.out, /The background agent is stopped, so it stays stopped/, r.out)
  assert.match(r.out, /launchctl bootstrap gui\/\$\(id -u\) .*ai\.foxleague\.agent\.plist/, 'the command that starts it')
  assert.equal(r.status, 0, r.out)
})

test('UPD-U5: a background service that runs, or that failed, is restarted into the new version as before', { timeout: 240_000 }, async () => {
  for (const state of ['active', 'failed', 'activating']) {
    const r = await update({ state })
    assert.ok(r.calls.includes('systemctl --user restart foxleague-agent'), `${state}:\n${r.out}`)
    assert.match(r.out, /Restarted\./, state)
  }
  const mac = await update({ mac: true, state: 'loaded' })
  assert.ok(mac.calls.some(c => c.startsWith('launchctl kickstart -k gui/')), mac.calls.join('\n'))
  assert.match(mac.out, /Restarted\./)
})
