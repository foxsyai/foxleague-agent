// Audit 2026-11-11 (DOCS-3, the part the installer fixer left): the messages the agent itself prints still told the
// owner of an installed agent to type `npm run cli -- setup`. An install with the installer's private Node.js has no
// npm on the PATH, so that line fails; `./cli.sh` (next to run.sh) is the command that works there, and on a server
// it is deploy/agentctl.sh. Developer instructions (AGENTS.md, a maintainer's sync-manual) keep npm.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Config } from '../../src/config.ts'
import { Service } from '../../src/service.ts'

const ROOT = new URL('../../', import.meta.url)
const raw = (f: string) => readFileSync(new URL(f, ROOT), 'utf8')

/** A command of the CLI on an env file without recovery words: what it prints and how it ends. */
function cliWithoutWords(args: string[], env: Record<string, string>): { out: string; status: number | null } {
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-commands-'))
  writeFileSync(join(dir, 'env'), '', { mode: 0o600 })
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', fileURLToPath(new URL('src/cli.ts', ROOT)), ...args], {
    encoding: 'utf8', cwd: dir,
    env: { PATH: process.env.PATH ?? '', HOME: dir, AGENT_ENV_FILE: join(dir, 'env'), AGENT_DATA_DIR: join(dir, 'data'), ...env },
  })
  return { out: `${r.stdout}${r.stderr}`, status: r.status }
}

test('the command line without recovery words names the setup command that works on this install', () => {
  const local = cliWithoutWords(['backup-words'], {})
  assert.equal(local.status, 1)
  assert.doesNotMatch(local.out, /npm run cli/, local.out)
  assert.match(local.out, /No AGENT_MNEMONIC in .*: run `\.\/cli\.sh setup` first\./)
  const server = cliWithoutWords(['export-pem', '1', 'x.pem'], { AGENT_IS_SERVER: '1' })
  assert.equal(server.status, 1)
  assert.match(server.out, /No AGENT_MNEMONIC in .*: run `agentctl\.sh setup` first\./)
})

test('the service without recovery words names the same command, by install', () => {
  const cfg = (isServer: boolean) => ({ mnemonic: undefined, isServer, dataDir: mkdtempSync(join(tmpdir(), 'foxagent-commands-svc-')) }) as unknown as Config
  assert.throws(() => new Service(cfg(false)), /AGENT_MNEMONIC is not set: run `\.\/cli\.sh setup` first/)
  assert.throws(() => new Service(cfg(true)), /AGENT_MNEMONIC is not set: run `agentctl\.sh setup` first/)
})

test('no message for the owner of an installed agent names npm: the sources and the env example', () => {
  const cli = raw('src/cli.ts')
  // The one npm line left is the maintainers': sync-manual needs the FoxLeague repository and ends in "commit and deploy".
  const npmLines = cli.split('\n').filter(l => l.includes('npm run cli') && !l.trimStart().startsWith('//'))
  assert.equal(npmLines.length, 1, npmLines.join('\n'))
  assert.match(npmLines[0]!, /Run: npm run cli -- sync-manual, then commit and deploy\./)
  assert.doesNotMatch(raw('src/service.ts'), /npm run cli/)
  assert.doesNotMatch(raw('.env.example'), /npm run cli|npm start/)
  assert.match(raw('.env.example'), /created by `\.\/cli\.sh setup` \(on a server: `agentctl\.sh setup`\)/)
  assert.match(raw('.env.example'), /`\.\/cli\.sh set-web-password`/)
  // The dashboard that is off says how to turn it on, by install.
  assert.ok(raw('src/service.ts').includes("web UI off: set it up with \\`${this.cfg.isServer ? 'agentctl.sh' : './cli.sh'} set-web-password\\`"))
})

test('the guides keep npm only where a developer is meant', () => {
  assert.match(raw('README.md'), /In a git checkout with your own Node\.js, `npm run cli -- <command>` and `npm start` do the same\./)
  for (const f of ['INSTALL.md', 'docs/SERVER.md', 'site/src/content/docs/help/update.md', 'site/src/content/docs/help/troubleshooting.md', 'site/src/content/docs/start/install.mdx', 'site/src/content/docs/start/install-windows.mdx', 'site/src/content/docs/start/install-mac.mdx', 'site/src/content/docs/start/install-linux.mdx']) {
    assert.doesNotMatch(raw(f), /npm run cli|npm start/, f)
  }
  assert.match(raw('AGENTS.md'), /`npm ci --ignore-scripts` then `npm run typecheck` and `npm test`/)
})
