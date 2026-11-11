// UPD-21 (found while the update's pages were written, 2026-11-11): on an install without a background service
// (`./install.sh --no-service`, the agent started by hand with ./run.sh) Update now put the new release in place,
// stopped the agent and ended with code 75. Nothing starts such an agent again, so it stayed down while the
// dashboard said "this page comes back by itself". Safe: the agent knows whether a service manager started it. When
// none did, the release is still downloaded, verified, prepared and switched, but the agent plays on and tells the
// owner that the new version runs from the next start, with the command. A second ask says the same and does no more.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { existsSync, fstatSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Config } from '../../src/config.ts'
import { Sessions, hashPassword } from '../../src/web/auth.ts'
import { detectLayout } from '../../src/update/install.ts'
import { supervised } from '../../src/update/supervised.ts'
import { Updater, type UpdateView } from '../../src/update/updater.ts'
import { REPO, buildRelease, codeTree, managedInstall, publish, serve, testKey, tmp } from '../update-fixtures.ts'

const KEY = testKey()
const TEST_WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const raw = (f: string): string => readFileSync(join(REPO, f), 'utf8')
const until = async (ok: () => boolean, ms = 20_000): Promise<void> => {
  const end = Date.now() + ms
  while (!ok() && Date.now() < end) await new Promise(r => setTimeout(r, 25))
  assert.ok(ok(), 'waited too long')
}

async function released(version: string): Promise<Awaited<ReturnType<typeof serve>>> {
  const out = tmp()
  buildRelease(out, codeTree(tmp(), version), version, KEY.privatePem, { notes: 'Faster plans.' })
  return serve(publish(tmp(), [{ dir: out, version }], version))
}

function updater(inst: { root: string; code: string }, base: string, o: { supervised: boolean }) {
  const said: string[] = []
  const restarts = { n: 0 }
  const kv = new Map<string, string>()
  const up = new Updater({
    layout: detectLayout(inst.code), installed: '1.1.0', keys: [KEY.publicPem], source: base, isServer: false, enabled: true, supervised: o.supervised,
    dataDir: join(inst.root, 'data'), kv: { get: k => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
    notify: t => void said.push(t), restart: async () => void restarts.n++,
  })
  return { up, said, restarts }
}

test('UPD-21: a service manager started the agent only when its own unit says so, launchd names its job or the journal of a systemd service holds its output', () => {
  const none = (): string[] => ['5:5', '5:5']
  assert.equal(supervised({}, none), false, 'started by hand')
  assert.equal(supervised({ FOXAGENT_SUPERVISED: '1' }, none), true, 'the units the installer writes say so')
  assert.equal(supervised({ XPC_SERVICE_NAME: 'ai.foxleague.agent' }, none), true, 'launchd names the job it started')
  // A terminal on a Mac has the variable too, with another value.
  assert.equal(supervised({ XPC_SERVICE_NAME: '0' }, none), false)
  assert.equal(supervised({ XPC_SERVICE_NAME: 'application.com.apple.Terminal.1152921500311879940' }, none), false)
  // A unit written before this version: systemd names the start and connects the output to the journal.
  assert.equal(supervised({ INVOCATION_ID: 'a1b2c3', JOURNAL_STREAM: '8:44197' }, () => ['8:44197', '8:44197']), true)
  assert.equal(supervised({ INVOCATION_ID: 'a1b2c3', JOURNAL_STREAM: '8:44197' }, () => ['5:5', '8:44197']), true, 'one of the two streams is enough')
  // A terminal that a user service of the desktop opened inherits both variables; its output is the terminal.
  assert.equal(supervised({ INVOCATION_ID: 'a1b2c3', JOURNAL_STREAM: '8:44197' }, none), false, 'INVOCATION_ID alone proves nothing: desktop terminals inherit it')
  assert.equal(supervised({ INVOCATION_ID: 'a1b2c3' }, none), false)
  assert.equal(supervised({ JOURNAL_STREAM: '5:5' }, none), false, 'no start of a unit is named')
  // The owner's own word, for an agent they keep running another way (or do not): it decides either way.
  assert.equal(supervised({ FOXAGENT_SUPERVISED: '0', INVOCATION_ID: 'a1b2c3', JOURNAL_STREAM: '5:5', XPC_SERVICE_NAME: 'ai.foxleague.agent' }, none), false)
  // The real streams of this process, read the way systemd writes them.
  const mine = fstatSync(2)
  assert.equal(supervised({ INVOCATION_ID: 'a1b2c3', JOURNAL_STREAM: `${mine.dev}:${mine.ino}` }), true)
  assert.equal(supervised({ INVOCATION_ID: 'a1b2c3', JOURNAL_STREAM: `${mine.dev}:0` }), false, 'no stream has inode 0')
})

test('UPD-21: both service files the installer writes tell the agent that a service manager started it, and the service asks', () => {
  const installer = raw('install.sh')
  assert.match(installer, /^Environment="AGENT_ENV_FILE=\$ENV_FILE" "AGENT_DATA_DIR=\$DATA_DIR" "FOXAGENT_SUPERVISED=1"$/m, 'the systemd user unit')
  assert.match(installer, /<key>EnvironmentVariables<\/key><dict>.*<key>FOXAGENT_SUPERVISED<\/key><string>1<\/string><\/dict>/, 'the launchd plist')
  // The launcher hands the environment on as it is, and the label the agent compares with is the installer's.
  assert.match(installer, /^PLIST_LABEL=ai\.foxleague\.agent$/m)
  assert.match(raw('src/update/supervised.ts'), /'ai\.foxleague\.agent'/)
  assert.match(raw('src/service.ts'), /supervised: supervised\(\)/)
})

test('UPD-21: an owner who keeps the agent running another way says so in .env, and a value the unit set is not changed by .env', () => {
  // What the Update page and .env.example promise: the env file is read before the service asks (config.ts).
  assert.match(raw('src/config.ts'), /if \(existsSync\(envFile\)\) process\.loadEnvFile\(envFile\)/)
  assert.match(raw('src/service.ts'), /const service = new Service\(loadConfig\(\)\)/)
  const file = join(tmp(), '.env')
  const had = process.env.FOXAGENT_SUPERVISED
  try {
    delete process.env.FOXAGENT_SUPERVISED
    writeFileSync(file, 'FOXAGENT_SUPERVISED="1"\n')
    process.loadEnvFile(file)
    assert.equal(supervised(process.env, () => []), true, 'the line in .env counts')
    // Under the installer's unit the variable is already set: a line in .env does not replace it.
    process.env.FOXAGENT_SUPERVISED = '1'
    writeFileSync(file, 'FOXAGENT_SUPERVISED="0"\n')
    process.loadEnvFile(file)
    assert.equal(supervised(process.env, () => []), true)
  } finally {
    if (had === undefined) delete process.env.FOXAGENT_SUPERVISED
    else process.env.FOXAGENT_SUPERVISED = had
  }
})

test('UPD-21: without a service manager the release is put in place, the agent does not end and the owner is told how to start the new version', async () => {
  const inst = managedInstall('1.1.0')
  const web = await released('1.2.0')
  try {
    const { up, said, restarts } = updater(inst, web.base, { supervised: false })
    await up.check()
    assert.equal(up.view().restarts, false)
    assert.equal(up.view().waiting, null)
    const answer = await up.begin('web UI, admin')
    assert.match(answer, /^Installing 1\.2\.0\. This takes a minute or two\. No background service runs this agent, so nothing starts it again by itself: /)
    assert.match(answer, /the new version runs from the next start/)
    assert.doesNotMatch(answer, /the agent then restarts/)
    await until(() => up.view().state === 'idle' && up.view().waiting !== null)
    // Downloaded, verified, prepared and switched, with the launcher's note, exactly as under a service manager.
    assert.equal(readFileSync(join(inst.root, 'versions', 'active'), 'utf8'), 'v1.2.0\n')
    assert.equal(readFileSync(join(inst.root, 'versions', 'pending'), 'utf8'), 'v1.1.0 v1.2.0 0\n')
    assert.ok(existsSync(join(inst.root, 'versions', 'v1.2.0', '.prepared')), 'the new release prepared itself')
    assert.equal(restarts.n, 0, 'the agent was not stopped: nothing would start it again')
    const waiting = up.view().waiting!
    assert.equal(waiting.version, '1.2.0')
    const sentence = `Version 1.2.0 is in place and runs from the next start. No background service runs this agent, so nothing starts it again by itself: stop the agent (Ctrl-C in its terminal), then run ./run.sh again in ${inst.root}. Until then it runs 1.1.0.`
    assert.equal(waiting.message, sentence)
    assert.equal(said.at(-1), `foxleague-agent: ${sentence} (Asked by web UI, admin.)`)
    assert.ok(!said.some(t => /Restarting into it now/.test(t)), 'no restart is announced')
    assert.equal(up.view().last, null, 'nothing failed and nothing was undone')

    // A second ask says the same and does nothing more: no download, no new folder, no restart.
    const hits = [...web.hits.values()].reduce((a, b) => a + b, 0)
    const told = said.length
    assert.equal(await up.begin('Telegram'), sentence)
    await new Promise(r => setTimeout(r, 300))
    assert.equal(up.view().state, 'idle')
    assert.equal([...web.hits.values()].reduce((a, b) => a + b, 0), hits, 'the release server was not asked again')
    assert.equal(said.length, told)
    assert.equal(restarts.n, 0)
    assert.equal(readFileSync(join(inst.root, 'versions', 'pending'), 'utf8'), 'v1.1.0 v1.2.0 0\n')
  } finally {
    await web.close()
  }
})

test('UPD-21: under a service manager nothing changes: the agent restarts into the new version, and no release waits', async () => {
  const inst = managedInstall('1.1.0')
  const web = await released('1.2.0')
  try {
    const { up, said, restarts } = updater(inst, web.base, { supervised: true })
    await up.check()
    assert.equal(up.view().restarts, true)
    assert.match(await up.begin('Telegram'), /^Installing 1\.2\.0\. This takes a minute or two; the agent then restarts and tells you when it is back\.$/)
    await until(() => restarts.n === 1)
    assert.match(said.at(-1)!, /version 1\.2\.0 is in place \(asked by Telegram\)\. Restarting into it now\./)
    assert.equal(up.view().waiting, null, 'the restart is on its way')
  } finally {
    await web.close()
  }
})

test('UPD-21: the click in the dashboard and /upgrade on Telegram get the sentence, and the process is not ended', async () => {
  const { Service } = await import('../../src/service.ts')
  const { startWeb } = await import('../../src/web/server.ts')
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-upd21-'))
  const svc = new Service({
    mnemonic: TEST_WORDS, dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config)
  svc.ensureAgents()
  ;(svc as unknown as { schedule: unknown }).schedule = () => undefined
  const creds = { username: 'admin', passwordHash: hashPassword('correct-horse-battery'), secretKey: 'k'.repeat(64) }
  const server = startWeb(svc, creds, 0)
  if (!server.listening) await once(server, 'listening')
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const sessions = new Sessions(creds.secretKey, creds.passwordHash)
  const cookie = sessions.issue('admin')
  const headers = { cookie: `foxagent_session=${cookie}`, origin: url, 'x-csrf-token': sessions.csrfFor(cookie), 'content-type': 'application/json' }
  const inst = managedInstall('1.1.0')
  const web = await released('1.2.0')
  const said: string[] = []
  const exits: number[] = []
  svc.exit = code => void exits.push(code)
  const kv = new Map<string, string>()
  ;(svc as { updater: Updater }).updater = new Updater({
    layout: detectLayout(inst.code), installed: '1.1.0', keys: [KEY.publicPem], source: web.base, isServer: false, enabled: true, supervised: false,
    dataDir: dir, kv: { get: k => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
    notify: t => void said.push(t), restart: () => svc.restartForUpdate(),
  })
  const state = async (): Promise<UpdateView> => ((await (await fetch(`${url}/api/state`, { headers: { cookie: headers.cookie } })).json()) as { instance: { update: UpdateView } }).instance.update
  try {
    await svc.updater.check()
    const res = await fetch(`${url}/api/update`, { method: 'POST', headers, body: '{}' })
    assert.equal(res.status, 200)
    assert.match(((await res.json()) as { message: string }).message, /^Installing 1\.2\.0\. .* stop the agent \(Ctrl-C in its terminal\), then run \.\/run\.sh again in /)
    await until(() => svc.updater.view().waiting !== null)
    await new Promise(r => setTimeout(r, 1800)) // longer than the wait before the exit of a restart
    assert.deepEqual(exits, [], 'the process was not ended')
    const shown = await state()
    assert.equal(shown.restarts, false)
    assert.equal(shown.state, 'idle')
    assert.match(shown.waiting!.message, /^Version 1\.2\.0 is in place and runs from the next start\./)
    // The dashboard still answers, and both ways of asking again say the same.
    const again = await fetch(`${url}/api/update`, { method: 'POST', headers, body: '{}' })
    assert.equal(again.status, 200)
    assert.equal(((await again.json()) as { message: string }).message, shown.waiting!.message)
    assert.equal(await svc.command('upgrade', [], ''), shown.waiting!.message)
    assert.deepEqual(exits, [])
    assert.equal(said.filter(t => /is in place/.test(t)).length, 1, 'told once on Telegram')
  } finally {
    server.close()
    await web.close()
    await svc.stop()
  }
})

/** The dashboard's own renderUpdate, run on a page of stand-ins: what the banner says for a given state. */
function banner(update: Partial<UpdateView>, o: { updating?: { to: string; since: number } } = {}): { text: string; button: boolean; hidden: boolean } {
  const html = raw('src/web/dashboard.html')
  const fn = html.slice(html.indexOf('function renderUpdate() {'), html.indexOf('async function startUpdate() {'))
  assert.ok(fn.startsWith('function renderUpdate()'), 'renderUpdate was not found in the dashboard')
  const els: Record<string, { hidden: boolean; textContent: string; className: string }> = {}
  const $ = (id: string) => (els[id] ??= { hidden: false, textContent: '', className: '' })
  const view: UpdateView = { installed: '1.1.0', available: null, checkedAt: null, checkError: null, canInstall: true, how: null, state: 'idle', last: null, enabled: true, restarts: true, waiting: null, ...update }
  new Function('S', '$', 'toast', 'updating', `${fn}\nrenderUpdate()`)({ instance: { update: view } }, $, () => undefined, o.updating ?? null)
  return { text: $('upText').textContent, button: !$('upBtn').hidden, hidden: $('upBanner').hidden }
}

test('UPD-21: the dashboard banner says "comes back by itself" only where something restarts the agent, and shows the sentence while a release waits', () => {
  const available = { version: '1.2.0', notes: 'Faster plans.', published: '2026-11-11T10:00:00Z' }
  const under = banner({ available, state: 'preparing' })
  assert.match(under.text, /^Installing version 1\.2\.0\. The agent restarts in a minute or two and this page comes back by itself\.$/)
  const byHand = banner({ available, state: 'preparing', restarts: false })
  assert.match(byHand.text, /^Installing version 1\.2\.0\. This takes a minute or two\./)
  assert.doesNotMatch(byHand.text, /comes back by itself|restarts in a minute/)
  assert.equal(byHand.button, false)
  const message = 'Version 1.2.0 is in place and runs from the next start. No background service runs this agent, so nothing starts it again by itself: stop the agent (Ctrl-C in its terminal), then run ./run.sh again in /home/fox/foxleague-agent. Until then it runs 1.1.0.'
  const waits = banner({ available, restarts: false, waiting: { version: '1.2.0', message } })
  assert.equal(waits.hidden, false)
  assert.equal(waits.text, message, 'the sentence, in place of "Version 1.2.0 is out"')
  assert.equal(waits.button, false, 'no second Update now for a release that is already in place')
  // Before the click, and under a service manager, the notice is the one it was.
  assert.match(banner({ available, restarts: false }).text, /^Version 1\.2\.0 is out\. You run 1\.1\.0\.$/)
  assert.equal(banner({ available, restarts: false }).button, true)
  assert.equal(banner({}).hidden, true)
})
