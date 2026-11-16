// Child of UPD-A1.test.ts: one Update now on a throwaway install whose archive cannot be written, in a process of
// its own (the way the service is one). Prints what the owner was told and ends with status 0 when it is still alive.
import { chmodSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { detectLayout } from '../../src/update/install.ts'
import { archiveName } from '../../src/update/release.ts'
import { Updater, type UpdaterDeps } from '../../src/update/updater.ts'
import { buildRelease, codeTree, managedInstall, publish, serve, testKey, tmp } from '../update-fixtures.ts'

const how = process.argv[2] // 'readonly': data/update may not be written to; 'full': the disk is full (ENOSPC at the first write)
const KEY = testKey()
const inst = managedInstall('1.1.0')
const out = tmp()
// Larger than one write buffer, so the write itself reaches the disk before the stream ends.
buildRelease(out, codeTree(tmp(), '1.2.0', { extra: { 'docs/big.bin': Array.from({ length: 4000 }, (_, i) => `${i}:${Math.random()}`).join('\n') } }), '1.2.0', KEY.privatePem)
const web = await serve(publish(tmp(), [{ dir: out, version: '1.2.0' }], '1.2.0'))
const dir = join(inst.root, 'data', 'update')
mkdirSync(dir, { recursive: true })
if (how === 'full') symlinkSync('/dev/full', join(dir, archiveName('1.2.0')))
else chmodSync(dir, 0o500)

const said: string[] = []
const kv = new Map<string, string>()
const d: UpdaterDeps = {
  layout: detectLayout(inst.code), installed: '1.1.0', keys: [KEY.publicPem], source: web.base, isServer: false, enabled: true,
  dataDir: join(inst.root, 'data'), kv: { get: k => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
  notify: t => void said.push(t), restart: async () => void said.push('RESTART'),
}
const up = new Updater(d)
await up.check()
console.log(`begin: ${await up.begin('web UI, owner')}`)
const end = Date.now() + 15_000
while (up.view().state !== 'idle' && !said.includes('RESTART') && Date.now() < end) await new Promise(r => setTimeout(r, 50))
chmodSync(dir, 0o700)
console.log(`state: ${up.view().state}`)
console.log(`last: ${up.view().last?.kind ?? 'none'}`)
console.log(`told: ${said.at(-1)}`)
console.log(`active: ${readFileSync(join(inst.root, 'versions', 'active'), 'utf8').trim()}`)
console.log('ALIVE')
await web.close()
