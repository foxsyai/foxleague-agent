// W-15b (Windows real-PC re-test of 2026-11-14, low): next to the old-install message ("Run ./install.sh --update
// once in a terminal, in the agent's folder ...") the dashboard still offered Update now, which fails the same way
// again on that install: the cause is the background service an older installer wrote, not the version. And on
// Windows "a terminal, in the agent's folder" named no way into Ubuntu. Now the updater marks that failure
// (`terminal`, a flag, not words to parse), the notice offers no button while it stands, and under WSL the message
// says how to open Ubuntu from PowerShell. Each test failed before the fix.
import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { childEnv, detectLayout, run, stage, type Runner } from '../../src/update/install.ts'
import { Updater } from '../../src/update/updater.ts'
import { buildRelease, codeTree, managedInstall, publish, serve, testKey, tmp } from '../update-fixtures.ts'
import { failingTar } from '../win-1113/helpers.ts'
import { flat, updatePage } from './helpers.ts'

const KEY = testKey()
const NOT_IMPLEMENTED = '/usr/bin/tar: foxleague-agent-v1.2.0/.github/scripts: Cannot mkdir: Function not implemented'
const NO_SPACE = '/usr/bin/tar: foxleague-agent-v1.2.0/src/service.ts: Cannot write: No space left on device'
const until = async (ok: () => boolean, ms = 8000): Promise<void> => {
  const end = Date.now() + ms
  while (!ok() && Date.now() < end) await new Promise(r => setTimeout(r, 20))
  assert.ok(ok(), 'waited too long')
}

/** A one-click update of an install running 1.1.0 to a signed 1.2.0, with a tar that fails the given way. */
async function failedUpdate(error: string): Promise<{ last: ReturnType<Updater['view']>['last']; said: string[] }> {
  const tar = failingTar(error)
  const tarFirst: Runner = (cmd, args, o) => run(cmd === 'tar' ? join(tar.dir, 'tar') : cmd, args, o)
  const out = tmp()
  buildRelease(out, codeTree(tmp(), '1.2.0'), '1.2.0', KEY.privatePem)
  const web = await serve(publish(tmp(), [{ dir: out, version: '1.2.0' }], '1.2.0'))
  const inst = managedInstall('1.1.0')
  const kv = new Map<string, string>()
  const said: string[] = []
  const quiet = mock.method(console, 'error', () => undefined)
  try {
    const up = new Updater({
      layout: detectLayout(inst.code), installed: '1.1.0', keys: [KEY.publicPem], source: web.base, isServer: false, enabled: true,
      dataDir: join(inst.root, 'data'), kv: { get: k => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
      notify: t => void said.push(t), restart: async () => assert.fail('no restart after a failed update'), run: tarFirst,
    })
    await up.check()
    await up.begin('web UI, sebi')
    await until(() => up.view().state === 'idle')
    return { last: up.view().last, said }
  } finally {
    quiet.mock.restore()
    await web.close()
  }
}

test('W-15b the updater marks a failure that only ./install.sh --update in a terminal gets past, and no other', async () => {
  const old = await failedUpdate(NOT_IMPLEMENTED)
  assert.equal(old.last?.kind, 'failed')
  assert.match(old.last!.message, /Run \.\/install\.sh --update once in a terminal/)
  assert.equal(old.last?.terminal, true, 'the dashboard is told by a flag, not by the words')
  // A full disk is fixed by freeing space and pressing the button again: not marked.
  const full = await failedUpdate(NO_SPACE)
  assert.equal(full.last?.kind, 'failed')
  assert.equal(full.last?.terminal, undefined)
})

test('W-15b while that failure stands the notice offers no Update now, for that version or a newer one, and says what to do', () => {
  const at = new Date().toISOString()
  const message = 'The update to 1.0.2 was not installed: this system\'s tar cannot unpack inside the agent\'s background service as an older installer set it up (tar: .github/scripts: Cannot mkdir: Function not implemented). Run ./install.sh --update once in a terminal, in the agent\'s folder: that installs it and renews the service, so later updates are one click again. You run 1.0.1 as before.'
  const failed = { kind: 'failed' as const, version: '1.0.2', at, message, terminal: true as const }
  const v102 = { version: '1.0.2', notes: 'Medicine.', published: at }
  const same = updatePage({ available: v102, last: failed })
  assert.equal(same.button(), false, 'Update now would fail the same way')
  assert.equal(same.text(), message, 'the message alone: it names the version, what to do and what runs')
  assert.match(same.tone(), /\bbad\b/)
  // A newer release fails the same way on that install: still no button, and the same command installs the newest.
  const newer = updatePage({ available: { ...v102, version: '1.0.3' }, last: failed })
  assert.equal(newer.button(), false)
  assert.ok(newer.text().startsWith(message), newer.text())
  assert.match(newer.text(), / Version 1\.0\.3 is out too: \.\/install\.sh --update installs the newest\.$/)
  // It stays while the version that told it runs (the updater gives it only then), also after a day.
  const old = updatePage({ available: v102, last: { ...failed, at: new Date(Date.now() - 2 * 86_400_000).toISOString() } })
  assert.equal(old.button(), false)
  assert.equal(old.text(), message)
  // Any other failure: the button as before.
  const other = updatePage({ available: v102, last: { kind: 'failed', version: '1.0.2', at, message: 'The update to 1.0.2 was not installed: the archive could not be unpacked (tar: x: No space left on device). You run 1.0.1 as before.' } })
  assert.equal(other.button(), true)
  assert.equal(other.label(), 'Update now')
  // The info bubble says it.
  const html = flat('src/web/dashboard.html')
  const bubble = html.slice(html.indexOf("update: ['Version and updates'"), html.indexOf("how: ['How it works'"))
  assert.match(bubble, /offers no <b>Update now<\/b>/)
})

/** An install of 1.1.0, a signed 1.2.0 and the environment of an update whose tar fails as the PC's did. */
function oldUnitUpdate() {
  const tar = failingTar(NOT_IMPLEMENTED)
  const inst = managedInstall('1.1.0')
  const built = buildRelease(tmp(), codeTree(tmp(), '1.2.0'), '1.2.0', KEY.privatePem)
  return { inst, layout: detectLayout(inst.code), built, env: childEnv(inst.root, { PATH: `${tar.dir}:${process.env.PATH}`, HOME: process.env.HOME }) }
}
async function unpackMessage(o: { wsl: string | null }): Promise<string> {
  const u = oldUnitUpdate()
  const quiet = mock.method(console, 'error', () => undefined)
  try {
    await stage(u.layout, u.built.manifest, u.built.archive, { env: u.env, ...o } as Parameters<typeof stage>[3])
  } catch (err) {
    return `${(err as Error).message}|${u.inst.root}`
  } finally {
    quiet.mock.restore()
  }
  return assert.fail('the unpack did not fail')
}

test('W-15b under WSL the old-install message says how to open Ubuntu from PowerShell; elsewhere it does not', async () => {
  const [wsl, root] = (await unpackMessage({ wsl: 'Ubuntu' })).split('|')
  assert.ok(wsl!.endsWith(`so later updates are one click again. On Windows: open PowerShell and type wsl -d Ubuntu --cd ~ , then cd ${root}`), wsl)
  const [linux] = (await unpackMessage({ wsl: null })).split('|')
  assert.ok(linux!.endsWith('so later updates are one click again'), linux)
  assert.doesNotMatch(linux!, /Windows|wsl/)
})

test('W-15b the agent knows it runs under WSL from the kernel (a service has no WSL_DISTRO_NAME) and names the folder from Ubuntu\'s home', async () => {
  const m = (await import('../../src/update/install.ts')) as Record<string, unknown>
  assert.equal(typeof m.wslDistro, 'function', 'wslDistro is exported by src/update/install.ts')
  assert.equal(typeof m.windowsHint, 'function', 'windowsHint is exported by src/update/install.ts')
  const wslDistro = m.wslDistro as (env: Record<string, string | undefined>, osrelease: string | null) => string | null
  const windowsHint = m.windowsHint as (distro: string, root: string, home: string | undefined) => string
  // The kernel of the PC (WSL 2) and of a plain Linux.
  assert.equal(wslDistro({}, '6.6.87.2-microsoft-standard-WSL2'), 'Ubuntu', 'the one get.ps1 installs')
  assert.equal(wslDistro({}, '4.4.0-19041-Microsoft'), 'Ubuntu', 'WSL 1 says Microsoft')
  assert.equal(wslDistro({}, '6.8.0-149-generic'), null)
  assert.equal(wslDistro({}, null), null, 'unknown is not WSL: the message stays as on Linux')
  // A terminal under WSL has the distribution's own name.
  assert.equal(wslDistro({ WSL_DISTRO_NAME: 'Ubuntu-24.04' }, '6.6.87.2-microsoft-standard-WSL2'), 'Ubuntu-24.04')
  assert.equal(wslDistro({ WSL_DISTRO_NAME: 'x; rm -rf ~' }, '6.6.87.2-microsoft-standard-WSL2'), 'Ubuntu', 'a name that is no plain name is not put into a command')
  // The folder from the home folder (where --cd ~ goes), or in full.
  assert.equal(windowsHint('Ubuntu', '/home/sebas/foxleague-agent', '/home/sebas'), 'On Windows: open PowerShell and type wsl -d Ubuntu --cd ~ , then cd foxleague-agent')
  assert.equal(windowsHint('Ubuntu', '/srv/fox', '/home/sebas'), 'On Windows: open PowerShell and type wsl -d Ubuntu --cd ~ , then cd /srv/fox')
  assert.equal(windowsHint('Ubuntu', '/home/sebasx/fox', '/home/sebas'), 'On Windows: open PowerShell and type wsl -d Ubuntu --cd ~ , then cd /home/sebasx/fox')
  assert.equal(windowsHint('Ubuntu', '/home/sebas/fox', undefined), 'On Windows: open PowerShell and type wsl -d Ubuntu --cd ~ , then cd /home/sebas/fox')
})
