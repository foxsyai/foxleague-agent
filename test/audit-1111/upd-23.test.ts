// UPD-23 (fresh Ubuntu walk-through, 2026-11-11): a dashboard port that another program holds (EADDRINUSE at
// listen) was an error nothing caught: it ended the whole agent. Under the background service it was then started
// again until the unit's start limit, and stayed stopped, although the agents do not need the dashboard to play.
// Safe: the failed listen is caught, said once in the log and to the owner (which port, that the agents keep
// playing, how to choose another port), and the dashboard tries the port again every 60 seconds until it is free.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '../../src/config.ts'
import { hashPassword } from '../../src/web/auth.ts'

const TEST_WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const creds = { username: 'admin', passwordHash: hashPassword('correct-horse-battery'), secretKey: 'k'.repeat(64) }
const until = async (ok: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> => {
  const end = Date.now() + ms
  while (!(await ok()) && Date.now() < end) await new Promise(r => setTimeout(r, 25))
  assert.ok(await ok(), 'waited too long')
}

async function service(o: { isServer?: boolean } = {}) {
  const { Service } = await import('../../src/service.ts')
  const svc = new Service({
    mnemonic: TEST_WORDS, dataDir: mkdtempSync(join(tmpdir(), 'foxagent-upd23-')), gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: o.isServer ?? false, defaultDryRun: true, maxAgents: 5,
  } as Config)
  svc.ensureAgents()
  ;(svc as unknown as { schedule: unknown }).schedule = () => undefined
  const said: string[] = []
  svc.notify = text => void said.push(text)
  return { svc, said }
}
/** Another program on a port of this machine. */
async function held(): Promise<{ port: number; free: () => Promise<void> }> {
  const other = createServer()
  other.listen(0, '127.0.0.1')
  await once(other, 'listening')
  return { port: (other.address() as AddressInfo).port, free: () => new Promise<void>(done => other.close(() => done())) }
}
const healthz = async (port: number): Promise<string> => {
  try {
    return await (await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(2000) })).text()
  } catch {
    return ''
  }
}

test('UPD-23: a dashboard port that another program holds does not end the agent: the owner is told once and the dashboard comes up when the port is free', async () => {
  const { startWeb, LISTEN_RETRY_MS } = await import('../../src/web/server.ts')
  const { svc, said } = await service()
  const other = await held()
  // An error that nothing catches ends a real process; in a test it reaches the runner as an uncaught exception.
  const uncaught: unknown[] = []
  const note = (err: unknown): void => void uncaught.push(err)
  process.on('uncaughtException', note)
  const server = startWeb(svc, creds, other.port, '127.0.0.1', { retryMs: 80 })
  try {
    await until(() => said.length > 0 || uncaught.length > 0)
    assert.deepEqual(uncaught, [], 'the failed listen was not caught: it would have ended the agent')
    assert.equal(server.listening, false)
    assert.equal(LISTEN_RETRY_MS, 60_000, 'it tries again every 60 seconds')
    assert.equal(
      said[0],
      `The dashboard could not start: port ${other.port} on this machine is used by another program. Your agents keep playing without the dashboard. The agent tries the port again every minute. To use another port, set WEB_UI_PORT in the .env file of the agent's folder and restart the agent.`,
    )
    // Several tries later it has still been said once, and the agent answers.
    await new Promise(r => setTimeout(r, 500))
    assert.equal(said.length, 1, 'said once, not at every try')
    assert.deepEqual(uncaught, [])
    assert.match(await svc.command('status', [], ''), /^foxleague-agent \d+\.\d+\.\d+/, 'the service is alive and answers')
    // The other program lets go of the port: the dashboard is there at the next try, and says so once.
    await other.free()
    await until(async () => (await healthz(other.port)) === 'ok')
    assert.equal(server.listening, true)
    assert.equal(said.length, 2)
    assert.equal(said[1], `The dashboard is back: it answers on port ${other.port}.`)
    await new Promise(r => setTimeout(r, 300))
    assert.equal(said.length, 2, 'no further try and no further message once it listens')
  } finally {
    process.off('uncaughtException', note)
    server.close()
    await other.free().catch(() => undefined)
    await svc.stop()
  }
})

test('UPD-23: a server set up by hand is told of its env file, and closing the dashboard ends the tries', async () => {
  const { startWeb } = await import('../../src/web/server.ts')
  const { svc, said } = await service({ isServer: true })
  const other = await held()
  const server = startWeb(svc, creds, other.port, '127.0.0.1', { retryMs: 60 })
  try {
    await until(() => said.length > 0)
    assert.match(said[0]!, new RegExp(`^The dashboard could not start: port ${other.port} on this machine is used by another program\\. Your agents keep playing without the dashboard\\.`))
    assert.match(said[0]!, /To use another port, set WEB_UI_PORT in the agent's env file and restart the service\.$/)
    server.close()
    await other.free()
    await new Promise(r => setTimeout(r, 400))
    assert.equal(server.listening, false, 'a dashboard that was closed does not come up by a late try')
    assert.equal(await healthz(other.port), '')
    assert.equal(said.length, 1)
  } finally {
    await other.free().catch(() => undefined)
    await svc.stop()
  }
})

test('UPD-23: a free port is as before: the dashboard listens at once and nothing is said', async () => {
  const { startWeb } = await import('../../src/web/server.ts')
  const { svc, said } = await service()
  const server = startWeb(svc, creds, 0)
  try {
    if (!server.listening) await once(server, 'listening')
    assert.equal(await healthz((server.address() as AddressInfo).port), 'ok')
    assert.deepEqual(said, [])
  } finally {
    server.close()
    await svc.stop()
  }
})
