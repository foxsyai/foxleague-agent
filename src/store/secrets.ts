// API keys set from the web UI's admin panel. The service cannot write /etc (ProtectSystem=strict),
// so they live in the data dir in a mode-600 JSON file and override the env file's values:
// loadConfig applies them at start, and the service applies a change at once.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const KEY_FIELDS = [
  { key: 'ANTHROPIC_API_KEY', label: 'Anthropic API key', secret: true },
  { key: 'TELEGRAM_BOT_TOKEN', label: 'Telegram token', secret: true },
  { key: 'TELEGRAM_CHAT_ID', label: 'Telegram chat id', secret: false },
  { key: 'BINANCE_API_KEY', label: 'Binance API key', secret: true },
  { key: 'BINANCE_API_SECRET', label: 'Binance API secret', secret: true },
] as const
export type KeyName = (typeof KEY_FIELDS)[number]['key']
export type KeyValues = Partial<Record<KeyName, string>>

export function isKeyName(k: string): k is KeyName {
  return KEY_FIELDS.some(f => f.key === k)
}

export function secretsFile(dataDir: string): string {
  return join(dataDir, 'secrets.json')
}

export function readSecrets(file: string): KeyValues {
  if (!existsSync(file)) return {}
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    return Object.fromEntries(Object.entries(raw).filter(([k, v]) => isKeyName(k) && typeof v === 'string' && v)) as KeyValues
  } catch {
    return {}
  }
}

/** Merges into the file (written whole, mode 600, then renamed); an empty value removes that override. */
export function writeSecrets(file: string, patch: KeyValues): void {
  const next: Record<string, string> = { ...readSecrets(file) }
  for (const [k, v] of Object.entries(patch)) {
    if (v) next[k] = v
    else delete next[k]
  }
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 })
  renameSync(tmp, file)
}

/** The admin panel's values win over the env file's. */
export function applySecretOverrides(dataDir: string): void {
  for (const [k, v] of Object.entries(readSecrets(secretsFile(dataDir)))) process.env[k] = v
}

/** Checks a value's shape before it is saved (a paste with a stray space, or into the wrong field). */
export function keyFormatError(key: KeyName, v: string): string | null {
  if (/\s/.test(v)) return 'contains spaces or line breaks'
  switch (key) {
    case 'ANTHROPIC_API_KEY':
      return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(v) ? null : 'expected sk-ant-…'
    case 'TELEGRAM_BOT_TOKEN':
      return /^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(v) ? null : 'expected 123456789:AA… from BotFather'
    case 'TELEGRAM_CHAT_ID':
      return /^-?\d{3,}$/.test(v) ? null : 'expected a number'
    case 'BINANCE_API_KEY':
    case 'BINANCE_API_SECRET':
      return /^[A-Za-z0-9]{32,128}$/.test(v) ? null : 'expected 32 to 128 letters and digits'
  }
}

/** Enough to recognise a key, not to use it. */
export function maskKey(v: string | undefined, secret: boolean): string {
  if (!v) return ''
  if (!secret) return v
  if (v.length < 16) return '••••'
  return `${v.slice(0, v.startsWith('sk-ant-') ? 10 : 4)}…${v.slice(-4)}`
}
