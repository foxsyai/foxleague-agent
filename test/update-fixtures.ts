// Helpers for the update tests: a throwaway release key, releases built the way the maintainers build them, a
// local release server laid out like GitHub's (`/latest/download/…`, `/download/v1.2.3/…`) and a throwaway install.
import { execFileSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { archiveName, manifestBytes, sha256File, signManifest, type Manifest } from '../src/update/release.ts'

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')

export function testKey(): { publicPem: string; privatePem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return { publicPem: publicKey.export({ type: 'spki', format: 'pem' }) as string, privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string }
}

export function tmp(prefix = 'fox-update-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

/** A release's code as a folder: a package.json, a service that the fake Node "runs" and an install.sh. */
export function codeTree(dir: string, version: string, o: { prepare?: string; extra?: Record<string, string> } = {}): string {
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'foxleague-agent', version }, null, 2))
  writeFileSync(join(dir, 'src', 'service.ts'), `// release ${version}\n`)
  // The stand-in for the real installer's --prepare: notes that it ran, from where and with which environment.
  writeFileSync(
    join(dir, 'install.sh'),
    o.prepare ??
      ['#!/usr/bin/env bash', 'set -eu', 'here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)', 'printf "%s\\n" "$*" > "$here/.prepared"', 'env > "$here/.prepare-env"', 'exit 0', ''].join('\n'),
  )
  chmodSync(join(dir, 'install.sh'), 0o755)
  for (const [path, text] of Object.entries(o.extra ?? {})) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  return dir
}

export interface BuiltRelease {
  manifest: Manifest
  bytes: Uint8Array
  signature: string
  archive: string
}

/** Packs a code folder as `foxleague-agent-v<version>/…` and signs its manifest. */
export function buildRelease(out: string, tree: string, version: string, privatePem: string, o: { notes?: string; manifest?: Partial<Manifest>; top?: string } = {}): BuiltRelease {
  mkdirSync(out, { recursive: true })
  const top = o.top ?? `foxleague-agent-v${version}`
  const stage = tmp('fox-pack-')
  cpSync(tree, join(stage, top), { recursive: true })
  const archive = join(out, archiveName(version))
  execFileSync('tar', ['-czf', archive, '-C', stage, top])
  const manifest: Manifest = { name: 'foxleague-agent', version, sha256: sha256File(archive), size: readFileSync(archive).length, published: '2026-11-11T10:00:00Z', notes: o.notes ?? `What is new in ${version}.`, ...o.manifest }
  const bytes = manifestBytes(manifest)
  const signature = signManifest(bytes, privatePem)
  writeFileSync(join(out, 'release.json'), bytes)
  writeFileSync(join(out, 'release.json.sig'), signature + '\n')
  return { manifest, bytes, signature, archive }
}

/** Publishes built releases under a folder the way GitHub serves them and returns the folder. */
export function publish(site: string, built: { dir: string; version: string }[], latest: string): string {
  for (const b of built) {
    const d = join(site, 'download', `v${b.version}`)
    mkdirSync(d, { recursive: true })
    for (const f of ['release.json', 'release.json.sig', archiveName(b.version)]) if (existsSync(join(b.dir, f))) copyFileSync(join(b.dir, f), join(d, f))
    if (b.version === latest) {
      const l = join(site, 'latest', 'download')
      mkdirSync(l, { recursive: true })
      for (const f of ['release.json', 'release.json.sig']) if (existsSync(join(b.dir, f))) copyFileSync(join(b.dir, f), join(l, f))
    }
  }
  return site
}

/** Serves a folder on 127.0.0.1. `hits` counts the requests per path. */
export async function serve(site: string, o: { rewrite?: (path: string) => { status?: number; body?: Uint8Array; location?: string } | undefined } = {}): Promise<{ base: string; server: Server; hits: Map<string, number>; close: () => Promise<void> }> {
  const hits = new Map<string, number>()
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname
    hits.set(path, (hits.get(path) ?? 0) + 1)
    const over = o.rewrite?.(path)
    if (over?.location) return void res.writeHead(302, { location: over.location }).end()
    if (over?.body || over?.status) return void res.writeHead(over.status ?? 200).end(over.body ?? '')
    const file = join(site, path)
    if (!file.startsWith(site) || !existsSync(file)) return void res.writeHead(404).end('not found')
    res.writeHead(200).end(readFileSync(file))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  return { base: `http://127.0.0.1:${port}`, server, hits, close: () => new Promise<void>(resolve => server.close(() => resolve())) }
}

/**
 * An install as get.sh makes it: root/versions/v<version> with the code, versions/active, the real launcher and a
 * fake Node (a script that notes which service it was asked to run and exits with the code in root/.exit).
 */
export function managedInstall(version: string, o: { prepare?: string } = {}): { root: string; code: string; started: () => string[] } {
  const root = tmp('fox-install-')
  const code = codeTree(join(root, 'versions', `v${version}`), version, o)
  writeFileSync(join(root, 'versions', 'active'), `v${version}\n`)
  copyFileSync(join(REPO, 'run.sh'), join(root, 'run.sh'))
  chmodSync(join(root, 'run.sh'), 0o755)
  const fake = join(root, 'fake-node')
  writeFileSync(fake, ['#!/usr/bin/env bash', `root=${JSON.stringify(root)}`, 'for a in "$@"; do case "$a" in */src/service.ts) printf "%s\\n" "$a" >> "$root/.started" ;; esac; done', 'exit "$(cat "$root/.exit" 2>/dev/null || echo 0)"', ''].join('\n'))
  chmodSync(fake, 0o755)
  writeFileSync(join(root, '.node-path'), fake + '\n')
  return { root, code, started: () => (existsSync(join(root, '.started')) ? readFileSync(join(root, '.started'), 'utf8').trim().split('\n') : []) }
}
