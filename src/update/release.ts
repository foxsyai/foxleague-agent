// A release as an installed agent sees it: a small signed manifest (release.json + release.json.sig) and the
// archive it names. Nothing here touches the disk layout or the service; see install.ts and updater.ts.
//
// Trust: the manifest is signed with the maintainers' Ed25519 key, whose public half is pinned in keys.ts of the
// code already installed. The manifest names the archive's size and SHA-256. So a release is installed only when
// its signature verifies with a pinned key, its version is newer than the installed one and the archive is byte
// for byte the one that was signed. Where the bytes come from (GitHub, a redirect, a mirror) is then not trusted.

import { createHash, createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto'
import { createWriteStream, readFileSync, rmSync, statSync } from 'node:fs'

export const RELEASE_NAME = 'foxleague-agent'
/** Where releases are published. `<base>/latest/download/<file>` is the newest, `<base>/download/v1.2.3/<file>` a given one. */
export const DEFAULT_SOURCE = 'https://github.com/foxsyai/foxleague-agent/releases'
export const MAX_MANIFEST_BYTES = 16 * 1024
export const MAX_SIGNATURE_BYTES = 1024
export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
export const MAX_NOTES_CHARS = 1500

export interface Manifest {
  name: string
  /** Plain `major.minor.patch`, no prefix. */
  version: string
  /** Lower-case hex SHA-256 of the archive. */
  sha256: string
  /** The archive's exact size in bytes. */
  size: number
  /** When the release was built (ISO 8601, UTC). */
  published: string
  /** What is new, in a few plain lines, shown to the owner before they update. */
  notes: string
}

/** Any reason a release is not taken. The message is safe to show to the owner. */
export class UpdateError extends Error {}

const VERSION_RE = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/

export function parseVersion(v: unknown): [number, number, number] | null {
  const m = typeof v === 'string' ? VERSION_RE.exec(v) : null
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** True only when both are plain versions and `candidate` is the later one. A version that cannot be read is never newer. */
export function isNewer(candidate: unknown, installed: unknown): boolean {
  const a = parseVersion(candidate)
  const b = parseVersion(installed)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!
  return false
}

export function archiveName(version: string): string {
  return `${RELEASE_NAME}-v${version}.tar.gz`
}

/** The manifest's bytes for a release: the exact bytes that are signed, one key per line so a shell can read them. */
export function manifestBytes(m: Manifest): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ name: m.name, version: m.version, sha256: m.sha256, size: m.size, published: m.published, notes: m.notes }, null, 2) + '\n')
}

/** Strict: exactly the known fields, each of its type and range. Throws UpdateError. */
export function parseManifest(bytes: Uint8Array): Manifest {
  if (bytes.length === 0 || bytes.length > MAX_MANIFEST_BYTES) throw new UpdateError('the release manifest has an impossible size')
  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new UpdateError('the release manifest is not valid JSON')
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new UpdateError('the release manifest is not an object')
  const o = raw as Record<string, unknown>
  const known = ['name', 'version', 'sha256', 'size', 'published', 'notes']
  for (const k of Object.keys(o)) if (!known.includes(k)) throw new UpdateError(`the release manifest has an unknown field ${JSON.stringify(k).slice(0, 40)}`)
  if (o.name !== RELEASE_NAME) throw new UpdateError('the release manifest is for another program')
  if (!parseVersion(o.version)) throw new UpdateError('the release manifest has no plain version (major.minor.patch)')
  if (typeof o.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(o.sha256)) throw new UpdateError('the release manifest has no SHA-256')
  if (typeof o.size !== 'number' || !Number.isInteger(o.size) || o.size < 1 || o.size > MAX_ARCHIVE_BYTES) throw new UpdateError('the release manifest names an impossible archive size')
  if (typeof o.published !== 'string' || o.published.length > 40 || !Number.isFinite(Date.parse(o.published))) throw new UpdateError('the release manifest has no date')
  if (typeof o.notes !== 'string' || o.notes.length > MAX_NOTES_CHARS) throw new UpdateError('the release notes are missing or too long')
  return { name: o.name, version: o.version as string, sha256: o.sha256, size: o.size, published: o.published, notes: o.notes }
}

/** True when `signature` (base64) is an Ed25519 signature of exactly `bytes` by one of the pinned keys. Never throws. */
export function verifyManifest(bytes: Uint8Array, signature: string, keys: readonly string[]): boolean {
  const sig = /^[A-Za-z0-9+/]{86}==\s*$/.test(signature) ? Buffer.from(signature.trim(), 'base64') : null
  if (!sig || sig.length !== 64) return false
  for (const pem of keys) {
    try {
      const key = createPublicKey(pem)
      if (key.asymmetricKeyType === 'ed25519' && cryptoVerify(null, bytes, key, sig)) return true
    } catch {
      // a key that cannot be read verifies nothing
    }
  }
  return false
}

/** The maintainers' side: the base64 signature of a manifest's bytes. The private key never leaves their machine. */
export function signManifest(bytes: Uint8Array, privateKeyPem: string, passphrase?: string): string {
  const key = createPrivateKey(passphrase === undefined ? privateKeyPem : { key: privateKeyPem, passphrase })
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('the release key must be an Ed25519 key')
  return cryptoSign(null, bytes, key).toString('base64')
}

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function sourceUrls(base: string, version?: string): { manifest: string; signature: string; archive: (v: string) => string } {
  const b = base.replace(/\/+$/, '')
  const dir = version === undefined ? `${b}/latest/download` : `${b}/download/v${version}`
  return { manifest: `${dir}/release.json`, signature: `${dir}/release.json.sig`, archive: v => `${b}/download/v${v}/${archiveName(v)}` }
}

/** https only; plain http only to this machine (tests, a local mirror). */
function checkUrl(url: string): void {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new UpdateError('the release source is not a URL')
  }
  const local = u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]'
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new UpdateError('the release source must be https')
  if (u.username || u.password) throw new UpdateError('the release source must not carry a login')
}

export type FetchLike = (url: string, init: { signal: AbortSignal; redirect: 'follow'; headers: Record<string, string> }) => Promise<Response>
const HEADERS = { 'user-agent': 'foxleague-agent-updater', accept: 'application/octet-stream, application/json;q=0.9, */*;q=0.1' }

/** A small file in memory, never more than `limit` bytes. */
export async function fetchSmall(url: string, limit: number, o: { fetch?: FetchLike; timeoutMs?: number } = {}): Promise<Uint8Array> {
  checkUrl(url)
  let res: Response
  try {
    res = await (o.fetch ?? (fetch as unknown as FetchLike))(url, { signal: AbortSignal.timeout(o.timeoutMs ?? 20_000), redirect: 'follow', headers: HEADERS })
  } catch {
    throw new UpdateError('the release server did not answer')
  }
  if (res.status === 404) throw new UpdateError('no release is published there yet')
  if (!res.ok || !res.body) throw new UpdateError(`the release server answered ${res.status}`)
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      total += chunk.length
      if (total > limit) throw new UpdateError('the release server sent more than a release file holds')
      chunks.push(chunk)
    }
  } catch (err) {
    if (err instanceof UpdateError) throw err
    throw new UpdateError('the download was cut short')
  }
  return Buffer.concat(chunks)
}

export interface SignedRelease {
  manifest: Manifest
  /** The exact signed bytes and their signature, kept so the installer can show what it verified. */
  bytes: Uint8Array
  signature: string
}

/**
 * The newest release (or a given one) with its signature checked against the pinned keys.
 * Throws UpdateError when anything is missing or wrong: a caller never sees an unverified manifest.
 */
export async function fetchRelease(base: string, keys: readonly string[], o: { fetch?: FetchLike; version?: string } = {}): Promise<SignedRelease> {
  if (!keys.length) throw new UpdateError('this version holds no release key, so it cannot check an update: update it once by hand')
  const urls = sourceUrls(base, o.version)
  const bytes = await fetchSmall(urls.manifest, MAX_MANIFEST_BYTES, o)
  const signature = new TextDecoder().decode(await fetchSmall(urls.signature, MAX_SIGNATURE_BYTES, o))
  if (!verifyManifest(bytes, signature, keys)) throw new UpdateError('the release is not signed by the foxleague-agent maintainers: it was refused')
  const manifest = parseManifest(bytes)
  if (o.version !== undefined && manifest.version !== o.version) throw new UpdateError('the release server answered with another version than the one asked for')
  return { manifest, bytes, signature }
}

/**
 * Downloads the archive a verified manifest names into `dest`, never more than the signed size, and checks the
 * size and the SHA-256. On any failure the partial file is removed and UpdateError is thrown.
 */
export async function downloadArchive(base: string, manifest: Manifest, dest: string, o: { fetch?: FetchLike; timeoutMs?: number } = {}): Promise<void> {
  const url = sourceUrls(base).archive(manifest.version)
  checkUrl(url)
  const fail = (why: string): never => {
    rmSync(dest, { force: true })
    throw new UpdateError(why)
  }
  let res: Response
  try {
    res = await (o.fetch ?? (fetch as unknown as FetchLike))(url, { signal: AbortSignal.timeout(o.timeoutMs ?? 10 * 60_000), redirect: 'follow', headers: HEADERS })
  } catch {
    return fail('the release server did not answer')
  }
  if (!res.ok || !res.body) return fail(`the release server answered ${res.status} for the archive`)
  const hash = createHash('sha256')
  const out = createWriteStream(dest, { mode: 0o600 })
  let total = 0
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      total += chunk.length
      if (total > manifest.size) throw new UpdateError('the archive is larger than the signed release')
      hash.update(chunk)
      if (!out.write(chunk)) await new Promise<void>(resolve => out.once('drain', resolve))
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))
  } catch (err) {
    out.destroy()
    return fail(err instanceof UpdateError ? err.message : 'the download was cut short')
  }
  if (total !== manifest.size || statSync(dest).size !== manifest.size) return fail('the archive is not the size of the signed release')
  if (hash.digest('hex') !== manifest.sha256) return fail('the archive is not the one that was signed (its SHA-256 differs): it was refused')
}
