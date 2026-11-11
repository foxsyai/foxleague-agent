// The maintainers' side of a release (docs/RELEASING.md). Two commands, both run on a maintainer's own machine:
//
//   node scripts/release/release.ts keygen [--no-passphrase] [--key <file>]
//       makes the release key once. The private half is written to <file> (default
//       ~/.config/foxleague-agent/release-key.pem, readable only by you) and is never printed. The public half
//       is printed: it goes into src/update/keys.ts.
//
//   node scripts/release/release.ts build <version> --notes <file> [--key <file>] [--out <dir>]
//       packs the tag v<version> exactly as git holds it, writes its manifest and signs it. The three files in
//       <dir> (default dist/release/v<version>) are what `gh release create` uploads.
//
// The private key never leaves the machine and never goes to GitHub: an installed agent takes an update only when
// this signature verifies with a key pinned in the code it already runs.

import { execFileSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { MAX_ARCHIVE_BYTES, MAX_NOTES_CHARS, archiveName, manifestBytes, parseManifest, parseVersion, sha256File, signManifest, verifyManifest, type Manifest } from '../../src/update/release.ts'

export const DEFAULT_KEY_FILE = join(homedir(), '.config', 'foxleague-agent', 'release-key.pem')

/** A new Ed25519 key pair. With a passphrase the private half is stored encrypted. */
export function newKey(passphrase?: string): { publicPem: string; privatePem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return {
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }) as string,
    privatePem: (passphrase ? privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase }) : privateKey.export({ type: 'pkcs8', format: 'pem' })) as string,
  }
}

/** Writes the private half where only its owner reads it. Refuses to replace a key: a lost key cannot sign for installed agents. */
export function saveKey(file: string, privatePem: string): void {
  if (existsSync(file)) throw new Error(`${file} already exists: a release key is made once. Move it away first if you really mean to replace it.`)
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  writeFileSync(file, privatePem, { mode: 0o600, flag: 'wx' })
}

/** The public keys a tree pins, read from the text of its src/update/keys.ts. */
export function pinnedKeys(keysTs: string): string[] {
  return [...keysTs.matchAll(/-----BEGIN PUBLIC KEY-----[A-Za-z0-9+/=\\n\s]+?-----END PUBLIC KEY-----/g)].map(m => m[0].replaceAll('\\n', '\n') + '\n')
}

const git = (repo: string, args: string[]): string => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

export interface BuiltFiles {
  dir: string
  manifest: Manifest
  files: string[]
}

/**
 * Packs the tag, writes release.json and signs it. Refuses when the tag is not that version, when the release
 * would not verify with the keys it pins itself, or when the release before it pins keys that would refuse it
 * (an installed agent checks with the keys of the release it runs).
 */
export function buildRelease(o: { repo: string; version: string; notes: string; privatePem: string; passphrase?: string; out?: string; published?: string }): BuiltFiles {
  if (!parseVersion(o.version)) throw new Error('the version must be plain: major.minor.patch')
  const tag = `v${o.version}`
  const notes = o.notes.trim()
  if (!notes) throw new Error('the release notes are empty: say in a few plain lines what is new')
  if (notes.length > MAX_NOTES_CHARS) throw new Error(`the release notes are longer than ${MAX_NOTES_CHARS} characters`)
  let pkg: { name?: unknown; version?: unknown }
  try {
    pkg = JSON.parse(git(o.repo, ['show', `${tag}:package.json`])) as typeof pkg
  } catch {
    throw new Error(`there is no tag ${tag} with a package.json`)
  }
  if (pkg.version !== o.version) throw new Error(`the tag ${tag} holds version ${String(pkg.version)} in its package.json`)
  const own = pinnedKeys(git(o.repo, ['show', `${tag}:src/update/keys.ts`]))
  if (!own.length) throw new Error(`the tag ${tag} pins no release key in src/update/keys.ts: agents on it could never update`)
  const dir = resolve(o.out ?? join(o.repo, 'dist', 'release', tag))
  mkdirSync(dir, { recursive: true })
  const archive = join(dir, archiveName(o.version))
  // Exactly the tag's tree as git holds it (export-ignore applies: the website's sources stay out).
  execFileSync('git', ['-C', o.repo, 'archive', '--format=tar.gz', `--prefix=foxleague-agent-${tag}/`, '-o', archive, tag])
  const size = statSync(archive).size
  if (size > MAX_ARCHIVE_BYTES) throw new Error('the archive is larger than an agent accepts')
  const manifest: Manifest = { name: 'foxleague-agent', version: o.version, sha256: sha256File(archive), size, published: o.published ?? new Date().toISOString().replace(/\.\d+Z$/, 'Z'), notes }
  const bytes = manifestBytes(manifest)
  parseManifest(bytes) // what an agent will read, read back the same way
  const signature = signManifest(bytes, o.privatePem, o.passphrase)
  if (!verifyManifest(bytes, signature, own)) throw new Error(`this key is not one that ${tag} pins in src/update/keys.ts: the release would be refused by its own code`)
  // The agents that will be offered this release run an earlier one and check with ITS keys.
  const earlier = git(o.repo, ['tag', '--list', 'v*', '--sort=-v:refname']).split('\n').filter(t => /^v\d+\.\d+\.\d+$/.test(t) && t !== tag)
  for (const prev of earlier) {
    let keys: string[]
    try {
      keys = pinnedKeys(git(o.repo, ['show', `${prev}:src/update/keys.ts`]))
    } catch {
      continue // a release from before the updater: it has no in-app update to refuse this one
    }
    if (keys.length && !verifyManifest(bytes, signature, keys)) throw new Error(`agents on ${prev} pin other keys and would refuse this release: sign with a key ${prev} knows (add a new key in one release, use it from the next)`)
    if (keys.length) break // the newest earlier release with keys decides
  }
  writeFileSync(join(dir, 'release.json'), bytes)
  writeFileSync(join(dir, 'release.json.sig'), signature + '\n')
  return { dir, manifest, files: [archive, join(dir, 'release.json'), join(dir, 'release.json.sig')] }
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2)
  const opt = (name: string): string | undefined => {
    const i = rest.indexOf(name)
    return i >= 0 ? rest[i + 1] : undefined
  }
  const keyFile = resolve(opt('--key') ?? DEFAULT_KEY_FILE)
  const { promptHidden } = await import('../../src/setup/keys.ts')
  if (cmd === 'keygen') {
    let passphrase: string | undefined
    if (!rest.includes('--no-passphrase')) {
      passphrase = await promptHidden('A passphrase for the release key (asked at every release; --no-passphrase for none): ')
      if (passphrase.length < 8) throw new Error('use at least 8 characters, or --no-passphrase')
      if ((await promptHidden('Again: ')) !== passphrase) throw new Error('the two do not match')
    }
    const key = newKey(passphrase)
    saveKey(keyFile, key.privatePem)
    console.log(`The private key is in ${keyFile} (readable only by you). Back it up offline: without it no installed agent can be updated.`)
    console.log('The public key, for src/update/keys.ts:\n')
    console.log(key.publicPem)
    return
  }
  if (cmd === 'build') {
    const version = rest[0] ?? ''
    const notesFile = opt('--notes')
    if (!notesFile) throw new Error('give the release notes: --notes <file>')
    const privatePem = readFileSync(keyFile, 'utf8')
    const passphrase = privatePem.includes('ENCRYPTED') ? await promptHidden('The release key\'s passphrase: ') : undefined
    const built = buildRelease({ repo: resolve(import.meta.dirname, '..', '..'), version, notes: readFileSync(notesFile, 'utf8'), privatePem, passphrase, out: opt('--out') })
    console.log(`Release ${built.manifest.version}: ${built.manifest.size} bytes, sha256 ${built.manifest.sha256}, signed.`)
    console.log(`Publish it:\n  gh release create v${built.manifest.version} --title v${built.manifest.version} --notes-file ${notesFile} ${built.files.map(f => JSON.stringify(f)).join(' ')}`)
    return
  }
  console.log('usage: release.ts keygen [--no-passphrase] [--key <file>] | build <version> --notes <file> [--key <file>] [--out <dir>]')
  process.exitCode = 1
}

if (import.meta.main) main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exit(1) })
