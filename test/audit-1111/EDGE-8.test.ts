// Audit 2026-11-11 (Fable 5.2 reviewers at extra-high effort): the proof of EDGE-8, failing before its fix.
// `agentctl tick` is refused while the service runs on the data folder (SS7: "a second, unlocked executor"), but a
// second copy of the service itself was not: `npm start` in a terminal next to the installed background service (or
// two terminals after --no-service) started, took over service.pid and scheduled every agent's plans a second time
// on the same database and the same wallets. The per-agent lock, the busy set and the plan schedule live in one
// process.
// Safe behaviour: the second copy does not start and leaves the pid file alone. A pid file left behind by a crash,
// whose number the system gave to another program since, does not keep the service from starting.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '../../src/config.ts'
import { Service, serviceRunning } from '../../src/service.ts'
import { snapshot } from '../fixtures.ts'

const TEST_WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

function testConfig(dir: string): Config {
  return {
    mnemonic: TEST_WORDS, dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config
}

/** A service that would start for real, without its timers, its reads or a dashboard port. */
function quietService(dir: string) {
  const svc = new Service(testConfig(dir))
  svc.notify = () => undefined
  ;(svc as unknown as { startTelegram: unknown }).startTelegram = () => undefined
  ;(svc as unknown as { schedule: unknown }).schedule = () => undefined
  ;(svc as unknown as { snapshot: unknown }).snapshot = async () => snapshot()
  return svc
}

/** A live process that does nothing: `asService` gives it the command line of the service (node .../src/service.ts). */
async function liveProcess(asService: boolean): Promise<{ child: ChildProcess; end: () => Promise<void> }> {
  const home = mkdtempSync(join(tmpdir(), 'foxagent-edge8-proc-'))
  mkdirSync(join(home, 'src'))
  const file = join(home, 'src', asService ? 'service.ts' : 'something-else.ts')
  writeFileSync(file, 'setInterval(() => undefined, 1000)\n')
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', file], { stdio: 'ignore' })
  await once(child, 'spawn')
  const end = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await once(child, 'exit')
    }
    rmSync(home, { recursive: true, force: true })
  }
  return { child, end }
}

async function withoutDashboard<T>(run: () => Promise<T>): Promise<T> {
  const env = { user: process.env.WEB_UI_USER, hash: process.env.WEB_UI_PASSWORD_HASH }
  delete process.env.WEB_UI_USER // no dashboard port to collide on: nothing else stops the second copy
  delete process.env.WEB_UI_PASSWORD_HASH
  try {
    return await run()
  } finally {
    if (env.user !== undefined) process.env.WEB_UI_USER = env.user
    if (env.hash !== undefined) process.env.WEB_UI_PASSWORD_HASH = env.hash
  }
}

test('EDGE-8 a second service on a data folder whose service is running does not start, and leaves its pid file alone', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-edge8-'))
  // The running service: a live process other than this one, running a src/service.ts, holds the pid file.
  const running = await liveProcess(true)
  try {
    writeFileSync(join(dir, 'service.pid'), String(running.child.pid))
    assert.equal(serviceRunning(dir), running.child.pid, 'the data folder has a running service')
    const svc = quietService(dir)
    let outcome = 'started'
    await withoutDashboard(async () => {
      try {
        await svc.start()
      } catch (err) {
        outcome = `refused: ${err instanceof Error ? err.message : String(err)}`
      }
    })
    const pidNow = readFileSync(join(dir, 'service.pid'), 'utf8').trim()
    await svc.stop()
    assert.notEqual(outcome, 'started', 'the second copy started next to the running service: every agent is now planned and run by two processes')
    assert.match(outcome, /already runs/, 'the owner is told why')
    assert.match(outcome, new RegExp(`\\b${running.child.pid}\\b`), 'and which process holds the data folder')
    assert.doesNotMatch(outcome, /—|\bbot\b/)
    assert.equal(pidNow, String(running.child.pid), 'the running service keeps its pid file (agentctl tick reads it to refuse a second executor)')
    assert.equal(readFileSync(join(dir, 'service.pid'), 'utf8').trim(), String(running.child.pid), 'also after the refused copy has stopped')
  } finally {
    await running.end()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('EDGE-8b a pid file left by a crash does not keep the service from starting: a dead pid, a pid another program has now, its own pid', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-edge8b-'))
  const other = await liveProcess(false)
  const gone = await liveProcess(true)
  try {
    await withoutDashboard(async () => {
      // The pid of a service that is gone (killed, a power cut): nothing lives there.
      const dead = gone.child.pid!
      await gone.end()
      writeFileSync(join(dir, 'service.pid'), String(dead))
      const first = quietService(dir)
      await first.start()
      assert.equal(serviceRunning(dir), process.pid)
      await first.stop()
      // After a reboot the old number belongs to a program that is not the service: the service starts and takes the file.
      writeFileSync(join(dir, 'service.pid'), String(other.child.pid))
      const second = quietService(dir)
      await second.start()
      assert.equal(serviceRunning(dir), process.pid, 'the file names the service that runs now')
      // Its own pid in the file (a container gives the service the same number at every start) is no second copy.
      const third = quietService(dir)
      await third.start()
      await third.stop()
      await second.stop()
    })
  } finally {
    await other.end()
    await gone.end()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('EDGE-8c (unit) what counts as the service: a process that runs src/service.ts; a process of another user that cannot even be looked at does not', async () => {
  // Read at run time, so this file still loads on the tree before the fix.
  const { looksLikeService } = (await import('../../src/service.ts')) as unknown as { looksLikeService: (command: string | null, ownUser: boolean) => boolean }
  for (const command of [
    '/opt/foxleague-agent/node/bin/node --disable-warning=ExperimentalWarning src/service.ts', // the systemd unit
    '/home/owner/foxleague-agent/.node/bin/node --disable-warning=ExperimentalWarning /home/owner/foxleague-agent/versions/1.2.0/src/service.ts', // run.sh
    'node --disable-warning=ExperimentalWarning src/service.ts', // npm start
    'node service.ts',
  ]) for (const own of [true, false]) assert.equal(looksLikeService(command, own), true, command)
  for (const command of [
    '', // a kernel thread, a process that has ended
    '/usr/sbin/nginx -g daemon off;',
    'node --disable-warning=ExperimentalWarning --test test/update-service.test.ts',
    'node --disable-warning=ExperimentalWarning src/cli.ts agents',
    '/usr/bin/python3 /srv/app/myservice.ts.py',
  ]) for (const own of [true, false]) assert.equal(looksLikeService(command, own), false, command)
  // The server's unit hides the processes of other users from the service (ProtectProc=invisible), and a pid file
  // left by a power cut names, after the reboot, a system program's pid: alive, another user's, not to be looked at.
  // Refusing on that would end the unit after three tries and keep the agent down until someone deletes the file.
  assert.equal(looksLikeService(null, false), false, 'a hidden process of another user is not this user\'s service')
  // A process of the same user that cannot be read is not explained by that: refuse, never guess.
  assert.equal(looksLikeService(null, true), true, 'unknown is not "nobody runs"')
})
