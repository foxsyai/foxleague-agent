// R2I-10 (UPD-U5, a stop that is still under way): `./install.sh --update` leaves a stopped service stopped only when
// `systemctl --user is-active` answers exactly "inactive" at that one moment. An agent that is busy takes up to 150
// seconds to stop (it finishes the action it is signing; the unit gives it TimeoutStopSec=180), and for all that time
// systemd answers "deactivating". The owner types `systemctl --user stop foxleague-agent`, the command seems to hang,
// and in a second terminal they run `./install.sh --update` (the guides give the update as the remedy for much). The
// update reads "deactivating", takes the other branch and runs `systemctl --user restart`: systemd queues a start
// behind the stop, the agent the owner just stopped plays again, LIVE if its database says so, and the screen says
// only "Restarted.": what UPD-U5 was fixed for ("an update is not the owner's word to start the agent again, which
// may sign LIVE").
// Right: a service that is on its way to stopped is waited for; once it is stopped it stays stopped and the screen says
// so with the command that starts it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildRelease, publish, serve, tmp } from '../update-fixtures.ts'
import { KEY, realTree, running, sh, stubs } from '../audit-1111/install-helpers.ts'

test('R2I-10: ./install.sh --update does not start again a background service whose stop is still under way', { timeout: 240_000 }, async () => {
  const s = stubs()
  const i = running(s)
  // systemd as it answers while a stop the owner asked for runs: "deactivating" (status 3) until the agent has ended,
  // then "inactive" (status 3). A restart asked meanwhile is queued behind the stop and starts the agent.
  s.stub('systemctl', [
    'printf \'systemctl %s\\n\' "$*" >> "$LOG"',
    'case "$*" in *is-active*)',
    '  n=$(cat "$LOG.asked" 2>/dev/null || echo 0); echo $((n + 1)) > "$LOG.asked"',
    '  if [ "$n" -lt 2 ]; then echo deactivating; else echo inactive; fi',
    '  exit 3 ;;',
    'esac',
  ].join('\n'))
  const out = tmp()
  buildRelease(out, realTree(tmp(), '3.2.0'), '3.2.0', KEY.privatePem)
  const web = await serve(publish(tmp(), [{ dir: out, version: '3.2.0' }], '3.2.0'))
  try {
    const r = await sh(join(i.root, 'install.sh'), ['--update'], i.env(web.base), { cwd: i.root })
    assert.equal(readFileSync(join(i.root, 'versions', 'active'), 'utf8'), 'v3.2.0\n', r.out)
    assert.deepEqual(s.calls().filter(c => /systemctl --user (restart|start) /.test(c)), [], `the agent the owner is stopping was started again:\n${r.out.slice(-400)}`)
    assert.doesNotMatch(r.out, /Restarted\./)
    assert.match(r.out, /stays stopped/, r.out.slice(-400))
    assert.match(r.out, /systemctl --user start foxleague-agent/, 'the command that starts it')
  } finally {
    await web.close()
  }
})

// Added by the fix: what the stop ends in decides; the wait is for a stop seen under way only.
async function updateWhile(after: string) {
  const s = stubs()
  const i = running(s)
  s.stub('systemctl', [
    'printf \'systemctl %s\\n\' "$*" >> "$LOG"',
    'case "$*" in *is-active*)',
    '  n=$(cat "$LOG.asked" 2>/dev/null || echo 0); echo $((n + 1)) > "$LOG.asked"',
    `  if [ "$n" -lt 1 ]; then echo deactivating; exit 3; else echo ${after}; [ ${after} = active ] && exit 0; exit 3; fi ;;`,
    'esac',
  ].join('\n'))
  const out = tmp()
  buildRelease(out, realTree(tmp(), '3.2.0'), '3.2.0', KEY.privatePem)
  const web = await serve(publish(tmp(), [{ dir: out, version: '3.2.0' }], '3.2.0'))
  try {
    const r = await sh(join(i.root, 'install.sh'), ['--update'], i.env(web.base), { cwd: i.root })
    return { r, starts: s.calls().filter(c => /systemctl --user (restart|start) /.test(c)) }
  } finally {
    await web.close()
  }
}

test('R2I-10: a stop that ends "failed" (killed at its timeout) stays stopped; one that ends "active" (a restart) is restarted', { timeout: 240_000 }, async () => {
  const failed = await updateWhile('failed')
  assert.deepEqual(failed.starts, [], failed.r.out.slice(-400))
  assert.match(failed.r.out, /stays stopped/)
  const active = await updateWhile('active')
  assert.ok(active.starts.length > 0, `a service that runs again is restarted into the new version:\n${active.r.out.slice(-400)}`)
})
