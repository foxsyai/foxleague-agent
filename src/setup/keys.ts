// Owner-facing key setup: hidden prompts that write secrets straight into the env file (never to
// the terminal log or a chat), and checks that each key is what the README requires.

import { createHmac } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
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

/** Sets KEY=value lines in an env file (mode 600), replacing existing ones. */
export function setEnvValues(file: string, values: Record<string, string>): void {
  let text = existsSync(file) ? readFileSync(file, 'utf8') : ''
  for (const [k, v] of Object.entries(values)) {
    if (!/^[A-Z0-9_]+$/.test(k)) throw new Error(`bad key ${k}`)
    if (/[\n"]/.test(v)) throw new Error(`${k}: value holds a newline or quote`)
    const line = `${k}="${v}"`
    const re = new RegExp(`^\\s*${k}\\s*=.*$`, 'm')
    text = re.test(text) ? text.replace(re, () => line) : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`
  }
  // Written aside and renamed over: a full disk or a power cut never leaves a half-written file (it holds the mnemonic).
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, text, { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, file)
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
