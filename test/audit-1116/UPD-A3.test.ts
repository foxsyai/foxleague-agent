// UPD-A3: an update that ends its preparation while the service is already stopping ends the process after
// 1.5 seconds, although an action is still being signed.
//
// Service.stop (src/service.ts:1428-1444) waits up to 150 seconds for the action in flight ("so it is booked"), but
// a second call returns at once (`if (this.stopping) return`, line 1429). Service.restartForUpdate (1404-1407) is
// `await this.stop()` and then exit(75) after 1.5 seconds. The two meet when SIGTERM comes while an update downloads
// or prepares (one to two minutes: a shutdown or a restart of the machine, `systemctl --user restart`, the installer
// run again in a terminal): the SIGTERM handler's stop() is waiting for the action, the update gets ready,
// restartForUpdate's stop() returns at once, and the process exits under the action. The other order is the same
// through the SIGTERM handler (src/service.ts:2249): its stop() returns at once and it exits with 0 after 1.5 s
// while restartForUpdate still waits.
//
// What is lost is the graceful stop (AGENTS.md rule 3's companion: "an action already signing or waiting for its
// outcome finishes so it is booked"); what is left is the crash path (the booking made before the signature and the
// pending rows). Right: the restart for an update never ends the process while the stop that runs still waits.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '../../src/config.ts'

const TEST_WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
function testConfig(dir: string): Config {
  return {
    mnemonic: TEST_WORDS, dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config
}

test('UPD-A3: the restart for an update waits for the action in flight, also when the service was already asked to stop', async () => {
  const { Service } = await import('../../src/service.ts')
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-a3-'))))
  svc.ensureAgents()
  const exits: number[] = []
  svc.exit = code => void exits.push(code)
  // Agent 1 is in the middle of an action (a plan's action that was sent and waits for its outcome).
  const busy = (svc as unknown as { busy: Set<number> }).busy
  busy.add(0)
  // SIGTERM came first: the graceful stop waits for that action (up to 150 seconds).
  let stopped = false
  const first = svc.stop().then(() => void (stopped = true))
  await new Promise(r => setTimeout(r, 200))
  assert.equal(stopped, false, 'the graceful stop is waiting for the action')
  // The update that was preparing is in place now and asks for its restart.
  void svc.restartForUpdate()
  await new Promise(r => setTimeout(r, 2500))
  const early = [...exits]
  // The action ends and is booked: now the process may go.
  busy.delete(0)
  await first
  await new Promise(r => setTimeout(r, 2300))
  assert.deepEqual(early, [], 'the process was ended (exit code 75) while the action was still in flight')
  assert.deepEqual(exits, [75], 'and it restarts into the update once the action is done')
})
