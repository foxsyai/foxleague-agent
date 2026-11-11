// UPD-22 (from reading the unit, 2026-11-11): the systemd user unit the installer writes restarted the agent only
// after a failure (`Restart=on-failure`). A new release that ends at once with status 0 (what Node.js 23 does with
// this code: it loads the service and ends) was therefore never started a second time, so the launcher never
// counted two starts and the undo waited for the owner. The launchd plist had the same gap (`KeepAlive` with
// `SuccessfulExit` false: only an exit that is not 0 is restarted). Safe: both restart the agent after every exit.
// A stop that the owner asks for (systemctl --user stop, the uninstall) is not an exit of that kind: systemd does
// not restart a unit it was told to stop, and the uninstall unloads the launchd job.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOGIN_LINES, TEST_PORT, freshInstall, guided, sh, type Install } from './install-helpers.ts'
import { managedInstall } from '../update-fixtures.ts'
import { execFileSync } from 'node:child_process'

/** The guided install with a background service, on stand-ins: the dashboard answers its health check. */
async function install(i: Install): Promise<string> {
  i.s.stub('curl', 'exit 0')
  writeFileSync(join(i.root, '.env'), LOGIN_LINES, { mode: 0o600 })
  const r = await guided(i, ['yes', '', TEST_PORT, 'n', 'n'], { args: [] })
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /Running\./)
  return r.out
}
/** The lines of one section of a unit file, without comments. */
function section(unit: string, name: string): string[] {
  const from = unit.indexOf(`[${name}]`)
  assert.ok(from >= 0, `no [${name}] in the unit`)
  const rest = unit.slice(from + name.length + 2)
  const to = rest.search(/^\[/m)
  return (to < 0 ? rest : rest.slice(0, to)).split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
}

test('UPD-22: the systemd user unit restarts the agent after every exit, also one with status 0', { timeout: 120_000 }, async () => {
  const i = freshInstall()
  await install(i)
  const unit = readFileSync(join(i.home, '.config', 'systemd', 'user', 'foxleague-agent.service'), 'utf8')
  const service = section(unit, 'Service')
  assert.ok(service.includes('Restart=always'), `the unit restarts only after a failure:\n${service.filter(l => l.startsWith('Restart')).join('\n')}`)
  assert.equal(service.filter(l => l.startsWith('Restart=')).length, 1, 'one Restart= line')
  // What bounds the restarts stays as it was: 30 seconds apart, at most 5 starts in 10 minutes.
  assert.ok(service.includes('RestartSec=30'))
  assert.deepEqual(section(unit, 'Unit').filter(l => l.startsWith('StartLimit')), ['StartLimitIntervalSec=600', 'StartLimitBurst=5'])
  // Exit code 75 (an update asks for the restart) is still no failure of the unit.
  assert.ok(service.includes('SuccessExitStatus=75') && service.includes('RestartForceExitStatus=75'))
  assert.ok(!service.some(l => l.startsWith('RestartPreventExitStatus')), 'no exit status is kept from restarting')
  // And the unit tells the agent that it is started again (UPD-21).
  assert.ok(service.some(l => l.startsWith('Environment=') && l.includes('"FOXAGENT_SUPERVISED=1"')))
})

test('UPD-22: the launchd plist keeps the agent alive after every exit', { timeout: 120_000 }, async () => {
  const i = freshInstall()
  // The same installer as a Mac runs it: uname names Darwin, launchctl is the stand-in.
  i.s.stub('uname', 'case "${1:-}" in -s | "") echo Darwin ;; -m) /usr/bin/uname -m ;; *) exec /usr/bin/uname "$@" ;; esac')
  await install(i)
  const plist = readFileSync(join(i.home, 'Library', 'LaunchAgents', 'ai.foxleague.agent.plist'), 'utf8')
  assert.match(plist, /<key>KeepAlive<\/key><true\/>/, 'KeepAlive true: launchd starts the job again whatever its exit status')
  assert.doesNotMatch(plist, /SuccessfulExit/, 'a condition on the exit status leaves an exit with 0 stopped')
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/)
  assert.match(plist, /<key>FOXAGENT_SUPERVISED<\/key><string>1<\/string>/)
  execFileSync('python3', ['-I', '-c', 'import plistlib,sys; d=plistlib.load(open(sys.argv[1],"rb")); assert d["KeepAlive"] is True and d["Label"]=="ai.foxleague.agent"', join(i.home, 'Library', 'LaunchAgents', 'ai.foxleague.agent.plist')])
  assert.ok(i.s.calls().some(c => c.startsWith('launchctl bootstrap gui/')), 'the job was loaded')
})

test('UPD-22: the uninstall still stops the service through the service manager and removes the unit', { timeout: 120_000 }, async () => {
  const i = freshInstall()
  await install(i)
  const unit = join(i.home, '.config', 'systemd', 'user', 'foxleague-agent.service')
  assert.ok(existsSync(unit))
  const before = i.s.calls().length
  const r = await sh(join(i.code, 'install.sh'), ['--uninstall'], { ...i.env, FOXAGENT_ROOT: i.root, FOXAGENT_TTY: '/dev/null' })
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /Stopped\./)
  const calls = i.s.calls().slice(before).filter(c => c.startsWith('systemctl'))
  // disable --now is a stop asked of systemd itself: a unit stopped that way is not restarted, whatever Restart= says.
  assert.ok(calls.includes('systemctl --user disable --now foxleague-agent'), calls.join('\n'))
  assert.ok(calls.indexOf('systemctl --user is-active --quiet foxleague-agent') > calls.indexOf('systemctl --user disable --now foxleague-agent'), 'it then asks whether the agent really stopped')
  assert.ok(!calls.some(c => /\b(restart|start)\b/.test(c.replace('reset-failed', ''))), 'nothing starts it again')
  assert.ok(!existsSync(unit))
})

test('UPD-22: started again after an exit with status 0, a release that ends at once is undone by the launcher at the third start', () => {
  // What `Restart=always` gives the launcher: one more start after each exit, also a clean one.
  const inst = managedInstall('1.1.0')
  const next = join(inst.root, 'versions', 'v1.2.0')
  execFileSync('cp', ['-R', inst.code, next])
  writeFileSync(join(inst.root, 'versions', 'active'), 'v1.2.0\n')
  writeFileSync(join(inst.root, 'versions', 'pending'), 'v1.1.0 v1.2.0 0\n')
  writeFileSync(join(inst.root, '.exit'), '0\n') // the stand-in Node.js ends at once, with status 0
  const start = (): string => execFileSync('bash', [join(inst.root, 'run.sh')], { encoding: 'utf8' })
  start()
  start()
  assert.equal(readFileSync(join(inst.root, 'versions', 'active'), 'utf8'), 'v1.2.0\n', 'two starts are the new release\'s')
  assert.match(start(), /the update to v1\.2\.0 did not start twice, back on v1\.1\.0/)
  assert.equal(readFileSync(join(inst.root, 'versions', 'active'), 'utf8'), 'v1.1.0\n')
  assert.deepEqual(inst.started().map(s => s.split('/versions/')[1]), ['v1.2.0/src/service.ts', 'v1.2.0/src/service.ts', 'v1.1.0/src/service.ts'])
})
