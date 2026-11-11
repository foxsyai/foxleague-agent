// The one-click update as the owner reaches it: the dashboard's routes, Telegram's /upgrade and the restart.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Config } from '../src/config.ts'
import { Sessions, hashPassword } from '../src/web/auth.ts'
import { detectLayout } from '../src/update/install.ts'
import { RESTART_EXIT_CODE, Updater } from '../src/update/updater.ts'
import { REPO, buildRelease, codeTree, managedInstall, publish, serve, testKey, tmp } from './update-fixtures.ts'

const TEST_WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const KEY = testKey()
const VERSION = (JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { version: string }).version

function testConfig(dir: string): Config {
  return {
    mnemonic: TEST_WORDS, dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config
}

async function webService() {
  const { Service } = await import('../src/service.ts')
  const { startWeb } = await import('../src/web/server.ts')
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-up-'))))
  svc.ensureAgents()
  ;(svc as unknown as { schedule: unknown }).schedule = () => undefined
  const creds = { username: 'admin', passwordHash: hashPassword('correct-horse-battery'), secretKey: 'k'.repeat(64) }
  const server = startWeb(svc, creds, 0)
  if (!server.listening) await once(server, 'listening')
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const sessions = new Sessions(creds.secretKey, creds.passwordHash)
  const cookie = sessions.issue('admin')
  const headers = { cookie: `foxagent_session=${cookie}`, origin: url, 'x-csrf-token': sessions.csrfFor(cookie), 'content-type': 'application/json' }
  const post = (path: string, h: Record<string, string> = headers) => fetch(`${url}${path}`, { method: 'POST', headers: h, body: '{}' })
  const get = (path: string) => fetch(`${url}${path}`, { headers: { cookie: `foxagent_session=${cookie}` } })
  return { svc, server, url, headers, post, get }
}

/** Gives the service an updater over a throwaway install and a local release server with one newer release. */
async function withRelease(svc: { updater: Updater; restartForUpdate(): Promise<void>; notify(t: string): void; cfg: Config }, said: string[]) {
  const inst = managedInstall('1.1.0')
  const out = tmp()
  buildRelease(out, codeTree(tmp(), '1.2.0'), '1.2.0', KEY.privatePem, { notes: 'Faster plans.' })
  const web = await serve(publish(tmp(), [{ dir: out, version: '1.2.0' }], '1.2.0'))
  const kv = new Map<string, string>()
  ;(svc as { updater: Updater }).updater = new Updater({
    layout: detectLayout(inst.code), installed: '1.1.0', keys: [KEY.publicPem], source: web.base, isServer: false, enabled: true,
    dataDir: svc.cfg.dataDir, kv: { get: k => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
    notify: t => void said.push(t), restart: () => svc.restartForUpdate(),
  })
  return { inst, web }
}
const until = async (ok: () => boolean, ms = 10_000): Promise<void> => {
  const end = Date.now() + ms
  while (!ok() && Date.now() < end) await new Promise(r => setTimeout(r, 25))
  assert.ok(ok(), 'waited too long')
}

test('UPD-18: the dashboard shows the version; a service built by a test or the CLI asks no release server', async () => {
  const { svc, server, get } = await webService()
  try {
    const state = (await (await get('/api/state')).json()) as { instance: { update: { installed: string; available: unknown; enabled: boolean; state: string; canInstall: boolean; how: string } } }
    assert.equal(state.instance.update.installed, VERSION)
    assert.equal(state.instance.update.available, null)
    assert.equal(state.instance.update.enabled, false, 'only loadConfig (a real start) switches the check on')
    assert.equal(state.instance.update.state, 'idle')
    assert.equal(state.instance.update.canInstall, false, 'this checkout is not an install made by the one-line installer')
    assert.match(state.instance.update.how, /git checkout/)
  } finally {
    server.close()
    await svc.stop()
  }
})

test('UPD-19: Update now needs the session and its CSRF token, installs only what the updater verified and restarts with code 75', async () => {
  const { svc, server, url, headers, post } = await webService()
  const said: string[] = []
  const { inst, web } = await withRelease(svc as never, said)
  const exits: number[] = []
  svc.exit = code => void exits.push(code)
  try {
    assert.equal((await fetch(`${url}/api/update`, { method: 'POST', body: '{}' })).status, 401, 'not signed in')
    const { 'x-csrf-token': _t, ...noToken } = headers
    assert.equal((await post('/api/update', noToken)).status, 403, 'no CSRF token')
    assert.equal((await post('/api/update', { ...headers, origin: 'https://evil.example' })).status, 403, 'another site')
    assert.equal(readFileSync(join(inst.root, 'versions', 'active'), 'utf8'), 'v1.1.0\n')
    const checked = (await (await post('/api/update/check')).json()) as { update: { available: { version: string; notes: string } } }
    assert.deepEqual({ v: checked.update.available.version, n: checked.update.available.notes }, { v: '1.2.0', n: 'Faster plans.' })
    const res = await post('/api/update')
    assert.equal(res.status, 200)
    assert.match(((await res.json()) as { message: string }).message, /^Installing 1\.2\.0\. This takes a minute or two; the agent then restarts and tells you when it is back\.$/)
    assert.equal((await post('/api/update')).status, 409, 'a second click while it installs')
    await until(() => exits.length === 1)
    assert.deepEqual(exits, [RESTART_EXIT_CODE], 'the code the service manager restarts on')
    assert.equal(readFileSync(join(inst.root, 'versions', 'active'), 'utf8'), 'v1.2.0\n')
    assert.match(said.at(-1)!, /version 1\.2\.0 is in place \(asked by web UI, admin\)/)
  } finally {
    server.close()
    await web.close()
    await svc.stop()
  }
})

test('UPD-20: /upgrade on Telegram installs the newest release, and says so when there is none', async () => {
  const { svc, server } = await webService()
  const said: string[] = []
  const exits: number[] = []
  svc.exit = code => void exits.push(code)
  try {
    assert.match(await svc.command('help', [], ''), /^\/upgrade  install the newest version of foxleague-agent when one is out/m)
    assert.match(await svc.command('status', [], ''), new RegExp(`^foxleague-agent ${VERSION.replaceAll('.', '\\.')}$`, 'm'))
    assert.match(await svc.command('upgrade', [], ''), /^No update was started: updates are switched off on this machine/)
    const { inst, web } = await withRelease(svc as never, said)
    try {
      await svc.updater.check()
      assert.match(await svc.command('status', [], ''), /^foxleague-agent \d+\.\d+\.\d+ \(version 1\.2\.0 is out: \/upgrade installs it\)$/m)
      assert.match(await svc.command('upgrade', [], ''), /^Installing 1\.2\.0\./)
      assert.match(await svc.command('upgrade', [], ''), /^No update was started: an update is already being installed\.$/)
      await until(() => exits.length === 1)
      assert.equal(readFileSync(join(inst.root, 'versions', 'active'), 'utf8'), 'v1.2.0\n')
      assert.match(said.at(-1)!, /asked by Telegram/)
    } finally {
      await web.close()
    }
  } finally {
    server.close()
    await svc.stop()
  }
})
