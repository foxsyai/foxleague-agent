// Owner-facing key setup: hidden prompts that write secrets straight into the env file (never to
// the terminal log or a chat), and checks that each key is what the README requires.

import { createHmac } from 'node:crypto'
import { chmodSync, closeSync, existsSync, fsyncSync, ftruncateSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, unlinkSync, writeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { whitelisted } from '../cex/binance.ts'

/** Reads one line from an interactive terminal without echoing it. */
export function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin
    if (!stdin.isTTY) return reject(new Error('needs an interactive terminal'))
    process.stdout.write(question)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let value = ''
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false)
          stdin.pause()
          stdin.off('data', onData)
          process.stdout.write('\n')
          return resolve(value.trim())
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false)
          process.stdout.write('\n')
          process.exit(130)
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1)
        else value += ch
      }
    }
    stdin.on('data', onData)
  })
}

/** The write that puts new content into an open env file (a test passes one that fails halfway). */
export interface EnvWriteIo {
  write?: (fd: number, data: Buffer) => void
}

/** Writes all of `data` from the start of the file. */
function writeAll(fd: number, data: Buffer): void {
  for (let done = 0; done < data.length; ) done += writeSync(fd, data, done, data.length - done, done)
}

/** A new file (mode 600, never over an existing one), its content synced to disk before it returns. */
function writeNewDurably(path: string, data: Buffer): void {
  const fd = openSync(path, 'wx', 0o600)
  try {
    writeAll(fd, data)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/**
 * Sets KEY=value lines in an env file (mode 600), replacing existing ones. `backupDir` (the data directory) holds the
 * copy of the old file while it is rewritten in place, when its own directory refuses a new file.
 */
export function setEnvValues(file: string, values: Record<string, string>, backupDir = resolve(process.env.AGENT_DATA_DIR ?? 'data'), io: EnvWriteIo = {}): void {
  let text = existsSync(file) ? readFileSync(file, 'utf8') : ''
  for (const [k, v] of Object.entries(values)) {
    if (!/^[A-Z0-9_]+$/.test(k)) throw new Error(`bad key ${k}`)
    if (/[\n"]/.test(v)) throw new Error(`${k}: value holds a newline or quote`)
    const line = `${k}="${v}"`
    const re = new RegExp(`^\\s*${k}\\s*=.*$`, 'm')
    text = re.test(text) ? text.replace(re, () => line) : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`
  }
  // First choice: written aside, synced and renamed over, so a full disk or a power cut never leaves a half-written
  // file (it holds the recovery words).
  const tmp = `${file}.tmp-${process.pid}`
  try {
    writeNewDurably(tmp, Buffer.from(text))
  } catch (err) {
    try {
      unlinkSync(tmp) // a partial copy of the words never stays behind
    } catch {
      // never created
    }
    // A server built by deploy/bootstrap.sh: /etc/foxleague-agent is root's (750) and only the env file is the
    // service user's, so nothing can be created next to it. The file itself is rewritten in place instead.
    const code = (err as NodeJS.ErrnoException).code
    if ((code !== 'EACCES' && code !== 'EPERM') || !existsSync(file)) throw err
    rewriteInPlace(file, Buffer.from(text), backupDir, io)
    return
  }
  chmodSync(tmp, 0o600)
  renameSync(tmp, file)
}

/**
 * Rewrites the env file where it is. A rewrite in place can be cut short (a full disk, a power cut), so the current
 * content is first copied to <backupDir>/env.backup (mode 600) and synced; the new content is then written over the
 * old, cut to its length and synced. A failure names the backup. The backup is removed once the new file is on disk,
 * so the recovery words stay in one place, and one left by an earlier failure stops the next try: a damaged env file
 * never overwrites the good copy.
 */
function rewriteInPlace(file: string, data: Buffer, backupDir: string, io: EnvWriteIo): void {
  const backup = join(backupDir, 'env.backup')
  if (existsSync(backup)) throw new Error(`${backup} holds the env file from an earlier rewrite that failed: compare it with ${file}, restore it if ${file} is damaged, delete it and try again`)
  try {
    mkdirSync(backupDir, { recursive: true, mode: 0o700 })
    writeNewDurably(backup, readFileSync(file))
    syncDirectory(backupDir)
  } catch (err) {
    try {
      rmSync(backup, { force: true })
    } catch {
      // nothing to remove
    }
    throw new Error(`could not back up ${file} to ${backup} before rewriting it (${err instanceof Error ? err.message : String(err)}); ${file} was not changed`, { cause: err })
  }
  let fd: number | undefined
  try {
    fd = openSync(file, 'r+')
    ;(io.write ?? writeAll)(fd, data)
    ftruncateSync(fd, data.length)
    fsyncSync(fd)
  } catch (err) {
    throw new Error(`could not rewrite ${file} (${err instanceof Error ? err.message : String(err)}); its previous content is in ${backup}`, { cause: err })
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
  chmodSync(file, 0o600)
  try {
    rmSync(backup)
  } catch (err) {
    // The new file is saved; the copy only blocks the next rewrite until it is deleted (the error then says so).
    console.error(`saved ${file}, but could not delete ${backup} (${err instanceof Error ? err.message : String(err)}): delete it yourself`)
  }
}

/** Makes a new file's name durable too (a directory fsync); a platform that cannot do it has nothing to sync. */
function syncDirectory(dir: string): void {
  let fd: number | undefined
  try {
    fd = openSync(dir, 'r')
    fsyncSync(fd)
  } catch {
    // not supported here
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

// ---- checks ----

export async function checkAnthropic(apiKey: string, model: string): Promise<string> {
  // The Models API costs no tokens: it proves the key works and the model is reachable.
  const client = new Anthropic({ apiKey, maxRetries: 1 })
  const m = await client.models.retrieve(model)
  return `Anthropic key OK; ${m.id} available (${m.display_name})`
}

export async function telegramMe(token: string): Promise<string> {
  const r = (await (await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(15_000) })).json()) as { ok: boolean; result?: { username: string }; description?: string }
  if (!r.ok) throw new Error(`Telegram token rejected: ${r.description ?? 'unknown'}`)
  return r.result!.username
}

/** Chats that recently wrote to the Telegram bot (the owner sends it any message first). */
export async function telegramRecentChats(token: string): Promise<{ id: string; who: string; text: string }[]> {
  const r = (await (await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=20`, { signal: AbortSignal.timeout(15_000) })).json()) as {
    ok: boolean
    result?: { message?: { chat: { id: number; type: string; username?: string; first_name?: string }; text?: string } }[]
  }
  const out: { id: string; who: string; text: string }[] = []
  for (const u of r.result ?? []) {
    const c = u.message?.chat
    if (c && c.type === 'private') out.push({ id: String(c.id), who: c.username ? `@${c.username}` : c.first_name ?? '?', text: (u.message?.text ?? '').trim().slice(0, 30) })
  }
  return out
}

/**
 * The owner's chat: the private chat that sent the one-time setup code. Anyone can find and message a
 * new Telegram bot, so "the only chat that wrote" could be a stranger's; a code only the owner saw cannot.
 * Null when no chat, or more than one, sent it.
 */
export function pickOwnerChat(chats: { id: string; text: string; who?: string }[], code: string): string | null {
  const ids = new Set(chats.filter(c => c.text.trim() === code).map(c => c.id))
  return ids.size === 1 ? [...ids][0]! : null
}

export async function telegramSend(token: string, chatId: string, text: string): Promise<void> {
  const r = (await (await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(15_000),
  })).json()) as { ok: boolean; description?: string }
  if (!r.ok) throw new Error(`Telegram send failed: ${r.description}`)
}

export interface BinanceRestrictions {
  ipRestrict: boolean
  enableReading: boolean
  enableWithdrawals: boolean
  enableSpotAndMarginTrading: boolean
  enableMargin?: boolean
  enableFutures?: boolean
  enableInternalTransfer?: boolean
  permitsUniversalTransfer?: boolean
  enableVanillaOptions?: boolean
  enablePortfolioMarginTrading?: boolean
}

/** GET /sapi/v1/account/apiRestrictions (HMAC key). Works only from the whitelisted IP. */
export async function binanceRestrictions(apiKey: string, secret: string): Promise<BinanceRestrictions> {
  const query = `timestamp=${Date.now()}&recvWindow=10000`
  const signature = createHmac('sha256', secret).update(query).digest('hex')
  const res = await fetch(`https://api.binance.com/sapi/v1/account/apiRestrictions?${query}&signature=${signature}`, {
    headers: { 'X-MBX-APIKEY': apiKey },
    signal: AbortSignal.timeout(15_000),
  })
  const body = (await res.json()) as BinanceRestrictions & { code?: number; msg?: string }
  if (!res.ok || body.code) throw new Error(`Binance: ${body.msg ?? `HTTP ${res.status}`} (from this machine's IP; the key works only from the IP it is restricted to)`)
  return body
}

/** Problems with a Binance key against the rule: withdraw only, IP-restricted, nothing else. */
export function binanceProblems(r: BinanceRestrictions): string[] {
  const p: string[] = []
  if (!r.ipRestrict) p.push('not restricted to trusted IPs (restrict it to the IP of the machine the agent runs on)')
  if (!r.enableWithdrawals) p.push('withdrawals are not enabled')
  if (r.enableSpotAndMarginTrading) p.push('spot & margin trading is enabled: turn it off')
  for (const k of ['enableMargin', 'enableFutures', 'enableInternalTransfer', 'permitsUniversalTransfer', 'enableVanillaOptions', 'enablePortfolioMarginTrading'] as const) {
    if (r[k]) p.push(`${k} is on: turn it off`)
  }
  return p
}

export interface KeyCheck {
  ok: boolean
  text: string
}

/** Every key checked against its service: the CLI's check-keys and the web UI's Test button. */
export async function checkKeys(k: { anthropicApiKey?: string; model: string; telegramToken?: string; telegramChatId?: string; binanceKey?: string; binanceSecret?: string; agentWallets?: { name: string; address: string }[] }): Promise<KeyCheck[]> {
  const out: KeyCheck[] = []
  const why = (e: unknown) => (e instanceof Error ? e.message : String(e))
  if (k.anthropicApiKey) {
    await checkAnthropic(k.anthropicApiKey, k.model).then(
      text => out.push({ ok: true, text }),
      e => out.push({ ok: false, text: `Anthropic: ${why(e)}` }),
    )
  } else out.push({ ok: false, text: 'ANTHROPIC_API_KEY not set' })
  if (k.telegramToken && k.telegramChatId) {
    await telegramMe(k.telegramToken)
      .then(async name => {
        await telegramSend(k.telegramToken!, k.telegramChatId!, 'foxleague-agent: key check OK. You will get notifications here.')
        out.push({ ok: true, text: `Telegram @${name} can message chat ${k.telegramChatId}` })
      })
      .catch(e => out.push({ ok: false, text: `Telegram: ${why(e)}` }))
  } else out.push({ ok: false, text: 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set' })
  if (k.binanceKey && k.binanceSecret) {
    await binanceRestrictions(k.binanceKey, k.binanceSecret)
      .then(r => {
        const problems = binanceProblems(r)
        out.push(problems.length ? { ok: false, text: `Binance key: ${problems.join('; ')}` } : { ok: true, text: 'Binance key is withdraw-only and IP-restricted (reading on, trading and transfers off)' })
      })
      .catch(e => out.push({ ok: false, text: `Binance: ${why(e)}` }))
    // A top-up goes only to a wallet on the whitelist: say which agent wallets are not on it yet.
    if (k.agentWallets?.length) {
      const key = { apiKey: k.binanceKey, secret: k.binanceSecret }
      await Promise.all(k.agentWallets.map(async w => [w, await whitelisted(key, w.address)] as const))
        .then(rows => {
          const missing = rows.filter(([, on]) => !on).map(([w]) => w.name)
          out.push(missing.length ? { ok: false, text: `Binance withdrawal whitelist: ${missing.join(', ')} not on it yet (Address Management, MultiversX network; top-ups go only to whitelisted wallets)` } : { ok: true, text: 'Binance withdrawal whitelist holds every agent wallet' })
        })
        .catch(e => out.push({ ok: false, text: `Binance whitelist: ${why(e)}` }))
    }
  } else out.push({ ok: false, text: 'BINANCE_API_KEY or BINANCE_API_SECRET not set' })
  return out
}
