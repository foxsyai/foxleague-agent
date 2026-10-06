import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { Mnemonic } from '@multiversx/sdk-core'
import type { Config } from '../src/config.ts'
import { Sessions, hashPassword } from '../src/web/auth.ts'

function testConfig(dir: string): Config {
  return {
    mnemonic: Mnemonic.generate().toString(), dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config
}

/** A service whose timers are only recorded: `scheduled` holds each delay asked for, `nextAt` when the next tick is due. */
async function recordingService() {
  const { Service } = await import('../src/service.ts')
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-'))))
  svc.ensureAgents()
  const scheduled: number[] = []
  const inner = svc as unknown as { schedule: (i: number, ms: number) => void; nextAt: Map<number, number>; busy: Set<number> }
  inner.schedule = (i, ms) => { scheduled.push(ms); inner.nextAt.set(i, Date.now() + ms) }
  return { svc, scheduled, nextAt: inner.nextAt, busy: inner.busy }
}

test('settings save: a shorter cycle brings the next plan forward to one new cycle from now, never later and never during a plan', async () => {
  const { svc, scheduled, nextAt, busy } = await recordingService()
  svc.store.updateSettings(0, { tickMinutes: 60 })
  nextAt.set(0, Date.now() + 59 * 60_000)

  svc.store.updateSettings(0, { tickMinutes: 30 })
  busy.add(0)
  svc.settingsSaved(0)
  assert.deepEqual(scheduled, [], 'a plan still running sets the next one itself when it ends')
  busy.delete(0)
  svc.settingsSaved(0)
  assert.deepEqual(scheduled, [30 * 60_000], 'the next plan in 30 minutes, not 59')
  svc.settingsSaved(0)
  assert.deepEqual(scheduled, [30 * 60_000], 'already within the new cycle: left alone')

  nextAt.set(0, Date.now() + 5 * 60_000)
  svc.store.updateSettings(0, { tickMinutes: 120 })
  svc.settingsSaved(0)
  assert.deepEqual(scheduled, [30 * 60_000], 'a longer cycle never delays the plan already due')
})

test('settings save: over the web, saving a shorter cycle moves the next plan', async () => {
  const { svc, scheduled, nextAt } = await recordingService()
  const { startWeb } = await import('../src/web/server.ts')
  svc.store.updateSettings(0, { tickMinutes: 60 })
  nextAt.set(0, Date.now() + 55 * 60_000)
  const pw = 'correct-horse-battery'
  const creds = { username: 'admin', passwordHash: hashPassword(pw), secretKey: 'k'.repeat(64) }
  const server = startWeb(svc, creds, 0)
  if (!server.listening) await once(server, 'listening')
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const sessions = new Sessions(creds.secretKey, creds.passwordHash)
  const cookie = sessions.issue('admin')
  try {
    const res = await fetch(`${url}/api/agents/0/settings`, {
      method: 'POST',
      headers: { cookie: `foxagent_session=${cookie}`, origin: url, 'x-csrf-token': sessions.csrfFor(cookie), 'content-type': 'application/json' },
      body: JSON.stringify({ tickMinutes: 30, password: pw }),
    })
    assert.equal(res.status, 200)
    assert.deepEqual(scheduled, [30 * 60_000])
  } finally {
    server.close()
  }
})
