// Audit 2026-11-11, found while the words of the one-click update were written (DOCS-15): the notice of a new
// version told the owner "To install it: send /update here". The Telegram command is /upgrade (the menu, /help and
// /status all say so); /update is no command, and the agent answers it with "unknown command /update (see /help)".
// An owner who did what the one message about a new version says got a refusal. Only the words of the notice
// change: what is installed, and when, is as it was.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '../../src/config.ts'
import { Updater } from '../../src/update/updater.ts'
import { Service } from '../../src/service.ts'

const raw = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')

/** The notice as the updater builds it for an install that can update itself (a folder it may write to), without asking any server. */
function notice(): string {
  const root = mkdtempSync(join(tmpdir(), 'foxagent-notice-install-'))
  mkdirSync(join(root, 'versions', 'v1.1.0'), { recursive: true })
  const u = new Updater({
    layout: { root, code: join(root, 'versions', 'v1.1.0'), managed: true }, installed: '1.1.0', keys: [], isServer: false, enabled: true,
    dataDir: join(root, 'data'), kv: { get: () => null, set: () => undefined }, notify: () => undefined, restart: async () => undefined,
  })
  const build = (u as unknown as { notice(m: object): string }).notice.bind(u)
  return build({ name: 'foxleague-agent', version: '1.2.0', sha256: '0'.repeat(64), size: 1, published: '2026-11-11T00:00:00Z', notes: 'What is new.' })
}

test('the notice of a new version names a command the agent has', async () => {
  const text = notice()
  // Every command the notice names must be one the service answers.
  const named = [...text.matchAll(/(?:^|\s)\/([a-z]+)\b/g)].map(m => m[1]!)
  // A service that asks nobody: no key, no Telegram, upstreams on a closed port.
  const svc = new Service({
    mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', dataDir: mkdtempSync(join(tmpdir(), 'foxagent-notice-')),
    gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9', gatewayRps: 5, apiRps: 1, foxleagueRps: 5,
    anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined, isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config)
  assert.ok(named.length >= 1, `the notice names a command: ${text}`)
  for (const cmd of named) {
    const answer = await svc.command(cmd, [], `/${cmd}`).catch((err: unknown) => String(err))
    assert.doesNotMatch(answer, /^unknown command/, `the notice says /${cmd}; the agent answers: ${answer}`)
  }
})

test('the words of the notice: /upgrade on Telegram, Update now in the dashboard', () => {
  const src = raw('src/update/updater.ts')
  assert.doesNotMatch(src, /\/update(?![s\w/.])/, 'updater.ts names /update, which is no command')
  assert.match(src, /'To install it: send \/upgrade here, or press Update now in the dashboard\. The agent restarts and tells you when it is back\.'/)
  assert.match(raw('src/service.ts'), /case 'upgrade':/)
})
