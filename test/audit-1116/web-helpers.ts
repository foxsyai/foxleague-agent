// Shared by the ATTACK proofs that drive the dashboard: a service on a throwaway data folder and its web server.
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '../../src/config.ts'
import { Service } from '../../src/service.ts'
import { Sessions, hashPassword } from '../../src/web/auth.ts'
import { startWeb } from '../../src/web/server.ts'

const TEST_WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

export async function webService() {
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-atk-'))
  const svc = new Service({
    mnemonic: TEST_WORDS, dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-sonnet-5-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config)
  svc.ensureAgents()
  ;(svc as unknown as { schedule: unknown }).schedule = () => undefined
  const password = 'correct-horse-battery'
  const creds = { username: 'admin', passwordHash: hashPassword(password), secretKey: 'k'.repeat(64) }
  const server = startWeb(svc, creds, 0)
  if (!server.listening) await once(server, 'listening')
  const port = (server.address() as AddressInfo).port
  const url = `http://127.0.0.1:${port}`
  const sessions = new Sessions(creds.secretKey, creds.passwordHash)
  const cookie = sessions.issue('admin')
  const close = () => {
    server.closeAllConnections()
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
  return { svc, url, port, password, sessions, cookie, close }
}

/** One request written by hand (fetch sets Host and normalises the path itself). */
export function raw(port: number, o: { method: string; path: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: o.method, path: o.path, headers: { ...(o.body !== undefined ? { 'content-length': String(Buffer.byteLength(o.body)) } : {}), ...o.headers } }, res => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', c => (body += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }))
    })
    req.on('error', reject)
    req.end(o.body)
  })
}
