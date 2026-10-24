// Service configuration: mainnet identifiers (public, from the FoxLeague release branch) and
// the environment (secrets and per-instance choices). Every tunable game value is read live at
// runtime (GET /api/config, contract views); only identifiers are pinned here.

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { applySecretOverrides } from './store/secrets.ts'

/** MultiversX mainnet identifiers (docs/FOXLEAGUE-INTEGRATION.md section 1.2). */
export const MAINNET = {
  chainId: '1',
  playersContract: 'erd1qqqqqqqqqqqqqpgq0r72lj3ja9xj78zf52x0etdk3tvxqd3lutes0058um',
  tournamentsContract: 'erd1qqqqqqqqqqqqqpgqfw3nadv3z7hj6c2x7alndtw03y5ang43utesz8nmg9',
  foxsyToken: 'FOXSY-5d5f3e',
  playerCollection: 'FXLP-6f28e5',
  wegldToken: 'WEGLD-bd4d79',
  foxsyWegldPair: 'erd1qqqqqqqqqqqqqpgq5jnjpsukhl295ry3wjrd3gtff0amrgux2jpsz3reum',
  composableTasks: 'erd1qqqqqqqqqqqqqpgqsytkvnexypp7argk02l0rasnj57sxa542jpshkl7df',
  gameServer: 'erd1cnunps5g2x4crulxxn6fhje06yuwyepdtdm0pj2fps0s65jmcynqetfgz0',
  gasPrice: 1_000_000_000n,
} as const

/** Gas limits the FoxLeague web app signs (frontend/src/lib/gasLimits.ts, xexchangeSwapTx.ts). */
export const GAS = {
  shopPay: 12_000_000n,
  // FoxLeague's app since the League + Knockout upgrade of the tournaments contract (live on mainnet 2026-10-24).
  joinTournament: 8_400_000n,
  claimRefund: 6_500_000n,
  registerAndPayMax: 12_000_000n,
  registerAndPayLegacy: 9_900_000n,
  swapEgldPath: 40_000_000n,
  swapWegldPath: 24_000_000n,
  fusion: 21_000_000n,
  auctionList: 15_000_000n,
  auctionBid: 13_500_000n,
  auctionCancel: 12_000_000n,
  fusionWaiver: 15_000_000n,
} as const

export interface Config {
  mnemonic: string | undefined
  dataDir: string
  gatewayUrl: string
  apiUrl: string
  foxleagueUrl: string
  /** Requests per second allowed to the gateway (public: 5; a local observing squad can take more). */
  gatewayRps: number
  apiRps: number
  foxleagueRps: number
  anthropicApiKey: string | undefined
  model: string
  telegramToken: string | undefined
  telegramChatId: string | undefined
  /** True on a server: refuses local-only commands such as PEM export. */
  isServer: boolean
  /** Global default for new agents; each has its own dry-run flag (default ON). */
  defaultDryRun: boolean
  maxAgents: number
}

function num(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number, got '${raw}'`)
  return n
}

function flag(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase()
  if (raw === undefined || raw === '') return fallback
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

/** The env file the CLI reads and `setup` writes (a server uses a systemd EnvironmentFile). */
export function envFilePath(): string {
  return resolve(process.env.AGENT_ENV_FILE ?? '.env')
}

let loaded: Config | undefined

export function loadConfig(): Config {
  if (loaded) return loaded
  const envFile = envFilePath()
  if (existsSync(envFile)) process.loadEnvFile(envFile)
  applySecretOverrides(resolve(process.env.AGENT_DATA_DIR ?? 'data'))
  loaded = {
    mnemonic: process.env.AGENT_MNEMONIC?.trim() || undefined,
    dataDir: resolve(process.env.AGENT_DATA_DIR ?? 'data'),
    gatewayUrl: (process.env.MVX_GATEWAY_URL ?? 'https://gateway.multiversx.com').replace(/\/+$/, ''),
    apiUrl: (process.env.MVX_API_URL ?? 'https://api.multiversx.com').replace(/\/+$/, ''),
    foxleagueUrl: (process.env.FOXLEAGUE_URL ?? 'https://foxleague.ai').replace(/\/+$/, ''),
    gatewayRps: num('MVX_GATEWAY_RPS', 5),
    apiRps: num('MVX_API_RPS', 1.8),
    foxleagueRps: num('FOXLEAGUE_RPS', 5),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
    model: process.env.AGENT_MODEL?.trim() || 'claude-sonnet-5',
    telegramToken: process.env.TELEGRAM_BOT_TOKEN?.trim() || undefined,
    telegramChatId: process.env.TELEGRAM_CHAT_ID?.trim() || undefined,
    isServer: flag('AGENT_IS_SERVER', false),
    defaultDryRun: flag('AGENT_DEFAULT_DRY_RUN', true),
    maxAgents: Math.min(100, Math.floor(num('AGENT_MAX_AGENTS', 5))),
  }
  return loaded
}
