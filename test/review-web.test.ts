// Whole-project review, 2026-10-13: the web UI, the CLI and the setup (B1 to B4).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, ftruncateSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Config } from '../src/config.ts'
import { Store } from '../src/store/db.ts'
import { Sessions, hashPassword } from '../src/web/auth.ts'
import { setEnvValues } from '../src/setup/keys.ts'

const REPO = resolve(import.meta.dirname, '..')
// The public BIP39 test vector, never a real install's words: the derived wallets are known and empty.
const TEST_WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

function testConfig(dir: string, anthropicApiKey?: string): Config {
  return {
    mnemonic: TEST_WORDS, dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config
}

/** A service with the web UI on a free port, timers off, and a signed-in session. */
async function webService(anthropicApiKey?: string) {
  const { Service } = await import('../src/service.ts')
  const { startWeb } = await import('../src/web/server.ts')
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-')), anthropicApiKey))
  svc.ensureAgents()
  ;(svc as unknown as { schedule: unknown }).schedule = () => undefined
  const password = 'correct-horse-battery'
  const creds = { username: 'admin', passwordHash: hashPassword(password), secretKey: 'k'.repeat(64) }
  const server = startWeb(svc, creds, 0)
  if (!server.listening) await once(server, 'listening')
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const sessions = new Sessions(creds.secretKey, creds.passwordHash)
  const cookie = sessions.issue('admin')
  const post = (path: string, body: unknown) => fetch(`${url}${path}`, {
    method: 'POST',
    headers: { cookie: `foxagent_session=${cookie}`, origin: url, 'x-csrf-token': sessions.csrfFor(cookie), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const get = (path: string) => fetch(`${url}${path}`, { headers: { cookie: `foxagent_session=${cookie}` } })
  return { svc, server, password, post, get }
}

test('B1 cli dry-run N and plan N never add an agent: an unknown N is refused and nothing is written', { timeout: 200_000 }, () => {
  for (const cmd of [['dry-run', '7', '[]'], ['plan', '7']]) {
    const dataDir = mkdtempSync(join(tmpdir(), 'foxagent-b1-'))
    const env = {
      PATH: process.env.PATH!, HOME: dataDir,
      AGENT_ENV_FILE: join(dataDir, 'no-such.env'), // the install's real .env is never read
      AGENT_MNEMONIC: TEST_WORDS, AGENT_DATA_DIR: dataDir, AGENT_MAX_AGENTS: '2', AGENT_COUNT: '1',
      MVX_GATEWAY_URL: 'http://127.0.0.1:9', MVX_API_URL: 'http://127.0.0.1:9', FOXLEAGUE_URL: 'http://127.0.0.1:9',
    }
    const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(REPO, 'src/cli.ts'), ...cmd], { env, cwd: dataDir, encoding: 'utf8', timeout: 90_000 })
    const store = new Store(dataDir)
    const row = store.agent(6)
    assert.equal(row, undefined, `cli ${cmd[0]} 7 wrote agent 7 into the database (paused: ${row?.paused})`)
    assert.equal(store.agents().length, 0, `cli ${cmd[0]} 7 left active agents behind`)
    assert.notEqual(r.status, 0, `cli ${cmd[0]} 7 succeeded`)
    assert.match(r.stderr, /no agent 7: add it in the dashboard \(simulate-as runs a throwaway wallet\)/)
  }
})

test('B2 a dearer model or a higher effort for every agent needs the password; a cheaper one is one click', async () => {
  const { svc, server, password, post } = await webService('sk-ant-not-a-real-key-for-this-test-only')
  svc.setStrategist('claude-sonnet-5', 'medium', 'test')
  try {
    let res = await post('/api/strategist', { model: 'claude-fable-5-1', effort: 'max' })
    assert.equal(res.status, 403, 'a dearer model was switched on without the password')
    assert.equal(svc.strategist?.model, 'claude-sonnet-5')
    res = await post('/api/strategist', { model: 'claude-sonnet-5', effort: 'high' })
    assert.equal(res.status, 403, 'a higher effort was switched on without the password')
    assert.equal(svc.strategist?.effort, 'medium')
    res = await post('/api/strategist', { model: 'claude-opus-5-5', effort: 'medium', password: 'wrong' })
    assert.equal(res.status, 403, 'a wrong password let a dearer model through')
    res = await post('/api/strategist', { model: 'claude-opus-5-5', effort: 'high', password })
    assert.equal(res.status, 200, await res.text())
    assert.equal(svc.strategist?.model, 'claude-opus-5-5')
    assert.equal(svc.strategist?.effort, 'high')
    // Cheaper or the same price, and less effort: no password.
    res = await post('/api/strategist', { model: 'claude-sonnet-5', effort: 'low' })
    assert.equal(res.status, 200, await res.text())
    res = await post('/api/strategist', { model: 'claude-sonnet-5-5', effort: 'low' })
    assert.equal(res.status, 200, await res.text())
    assert.equal(svc.strategist?.model, 'claude-sonnet-5-5')
  } finally {
    server.close()
  }
})

test('B2 the dashboard asks for the password before it switches to a dearer AI, from the card and from the level dialog', () => {
  const html = readFileSync(join(REPO, 'src/web/dashboard.html'), 'utf8')
  const apply = html.slice(html.indexOf("$('stratApply').onclick"), html.indexOf("$('stratApply').onclick") + 900)
  assert.match(apply, /aiCostsMore\(/, 'the Apply button never checks whether the AI gets dearer')
  assert.match(apply, /askPassword\(/, 'the Apply button never asks for the password')
  assert.match(apply, /password/, 'the password is not sent with the switch')
  const level = html.slice(html.indexOf("$('lvlOk').onclick"), html.indexOf("$('lvlKeep').onclick"))
  assert.match(level, /aiCostsMore\(/, 'the level dialog never checks whether the AI gets dearer')
  assert.match(html, /k_strat: \['Strategist', `[^`]*dearer model or a higher effort asks for your password/, 'the Strategist bubble does not say a dearer AI asks for the password')
})

test('B3 the CLI updates an env file it owns inside a directory it may not create files in', () => {
  if (process.getuid?.() === 0) return // root ignores directory modes: nothing to prove here
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-b3-'))
  const file = join(dir, 'env')
  writeFileSync(file, 'AGENT_COUNT="1"\nWEB_UI_USER="old"\n', { mode: 0o644 })
  const data = mkdtempSync(join(tmpdir(), 'foxagent-b3-data-'))
  chmodSync(dir, 0o500) // /etc/foxleague-agent as the service user sees it (root:foxleague-agent 750): r-x, no w
  try {
    setEnvValues(file, { WEB_UI_USER: 'admin', ANTHROPIC_API_KEY: 'sk-ant-x' }, data)
    assert.equal(readFileSync(file, 'utf8'), 'AGENT_COUNT="1"\nWEB_UI_USER="admin"\nANTHROPIC_API_KEY="sk-ant-x"\n')
    assert.equal(statSync(file).mode & 0o777, 0o600, 'the env file is not mode 600 after the write')
  } finally {
    chmodSync(dir, 0o700)
  }
  // Where the directory allows it, the file is still written aside and renamed over (a new inode).
  const before = statSync(file).ino
  setEnvValues(file, { WEB_UI_USER: 'owner' }, data)
  assert.notEqual(statSync(file).ino, before, 'a writable directory no longer gets the atomic write')
  assert.match(readFileSync(file, 'utf8'), /^WEB_UI_USER="owner"$/m)
})

test('B3 (review of #8) a rewrite in place that fails leaves the previous env file in a backup in the data directory', () => {
  if (process.getuid?.() === 0) return // root ignores directory modes: nothing to prove here
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-b3-'))
  const data = mkdtempSync(join(tmpdir(), 'foxagent-b3-data-'))
  const file = join(dir, 'env')
  const backup = join(data, 'env.backup')
  const old = `AGENT_MNEMONIC="${TEST_WORDS}"\nWEB_UI_USER="old"\n`
  writeFileSync(file, old, { mode: 0o600 })
  chmodSync(dir, 0o500) // the aside write is refused, as on a server built by deploy/bootstrap.sh
  try {
    // A full disk right after the file was cut to nothing: the env file is left empty.
    const fullDisk = (fd: number) => {
      ftruncateSync(fd, 0)
      throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' })
    }
    assert.throws(() => setEnvValues(file, { WEB_UI_USER: 'admin' }, data, { write: fullDisk }), (e: Error) => {
      assert.ok(e.message.includes(backup), `the error does not say where the previous content is: ${e.message}`)
      return true
    })
    assert.equal(readFileSync(file, 'utf8'), '', 'the simulated failure did not damage the env file')
    assert.ok(existsSync(backup), 'no backup was written before the env file was touched')
    assert.equal(readFileSync(backup, 'utf8'), old, 'the backup does not hold the previous env file')
    assert.equal(statSync(backup).mode & 0o777, 0o600)
    // A second try while that backup is there is refused: the damaged file never overwrites the good copy.
    assert.throws(() => setEnvValues(file, { WEB_UI_USER: 'admin' }, data), /env\.backup/)
    assert.equal(readFileSync(backup, 'utf8'), old)
    // Restored by hand and tried again: the rewrite works and the backup goes (the words stay in one place).
    writeFileSync(file, readFileSync(backup))
    rmSync(backup)
    setEnvValues(file, { WEB_UI_USER: 'admin' }, data)
    assert.equal(readFileSync(file, 'utf8'), `AGENT_MNEMONIC="${TEST_WORDS}"\nWEB_UI_USER="admin"\n`)
    assert.equal(existsSync(backup), false, 'the backup stays after a rewrite that worked')
  } finally {
    chmodSync(dir, 0o700)
  }
})

test('B4 an activity limit that is not a whole number falls back to the default or is rounded down, never a 500', async () => {
  const { svc, server, get } = await webService()
  for (let i = 0; i < 5; i++) svc.store.log({ agentIndex: 0, kind: 'control', status: 'info', summary: `line ${i}` })
  try {
    for (const [limit, rows] of [['abc', 5], ['NaN', 5], ['', 5], ['2.5', 2], ['1e999', 5], ['-3', 1]] as const) {
      const res = await get(`/api/agents/0/activity?limit=${encodeURIComponent(limit)}`)
      assert.equal(res.status, 200, `limit=${JSON.stringify(limit)} answered ${res.status}`)
      assert.equal(((await res.json()) as unknown[]).length, rows, `limit=${JSON.stringify(limit)}`)
    }
  } finally {
    server.close()
  }
})
