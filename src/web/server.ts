// Password-protected dashboard: agent list with status, balances and spend, per-agent
// settings, activity and controls, Add agent, kill switch. Plain node:http, bound to 127.0.0.1
// behind nginx on a server (TLS).

import { marketPrices } from '../snapshot/market.ts'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Service } from '../service.ts'
import { BoundedQueue, COOKIE_NAME, LoginThrottle, SESSION_TTL_S, Sessions, verifyPassword, verifyPasswordAsync, type Credentials } from './auth.ts'
import { LEVEL_SETTINGS, STRATEGY_PRESETS, checkTiming, validateSettingsPatch, type AgentSettings, LEVEL_AI } from '../store/settings.ts'
import { budgetView } from '../executor/budget.ts'
import { EFFORTS, MODELS, isKnownModel, type Effort } from '../strategist/strategist.ts'
import { isKeyName, type KeyValues } from '../store/secrets.ts'
import { formatAtomic } from '../util/encoding.ts'
import { fundsUsd, lowOnFunds, playableUsd } from '../snapshot/funds.ts'
import type { AgentSnapshot } from '../snapshot/snapshot.ts'
import { agentName, pemName } from '../names.ts'
import type { ImportInput } from '../wallet/imported.ts'

const PAGES = {
  login: readFileSync(join(import.meta.dirname, 'login.html'), 'utf8'),
  dashboard: readFileSync(join(import.meta.dirname, 'dashboard.html'), 'utf8'),
}

const SECURITY_HEADERS: Record<string, string> = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy':
    "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
}

/**
 * An HTML page with its own script allowed by a fresh nonce: an injected <script> (without the nonce)
 * cannot run even if some text ever slipped into the page unescaped.
 */
function sendPage(res: ServerResponse, status: number, html: string): void {
  const nonce = randomBytes(16).toString('base64')
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`
  send(res, status, html.replaceAll('<script>', `<script nonce="${nonce}">`), 'text/html; charset=utf-8', { 'content-security-policy': csp })
}

class HttpFail extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

export function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i <= 0) continue
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
    } catch {
      // A malformed escape (a lone %): the cookie is dropped, not an error before any authentication.
    }
  }
  return out
}

/**
 * The peer's address. X-Real-IP is honoured only behind our own proxy: WEB_UI_TRUST_PROXY=1 and the
 * request coming from this machine (nginx on a server sets the header from $remote_addr). Anywhere
 * else the header is attacker-controlled and the socket address is used, so a forged header cannot
 * dodge the per-address login lockout.
 */
function clientIp(req: IncomingMessage): string {
  const socket = req.socket.remoteAddress || '?'
  const loopback = socket === '127.0.0.1' || socket === '::1' || socket === '::ffff:127.0.0.1'
  const real = req.headers['x-real-ip']
  if (process.env.WEB_UI_TRUST_PROXY === '1' && loopback && typeof real === 'string' && real.trim()) return real.trim()
  return socket
}

async function readBody(req: IncomingMessage, limit = 64 * 1024): Promise<string> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) throw new HttpFail(413, 'request body too large')
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function send(res: ServerResponse, status: number, body: string, type: string, extra: Record<string, string> = {}): void {
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': type, ...extra })
  res.end(body)
}

const json = (res: ServerResponse, status: number, data: unknown) =>
  send(res, status, JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)), 'application/json; charset=utf-8')

/** The last reading shows an untouched wallet: no transaction, no EGLD, WEGLD, FOXSY or cards, no team. */
export function looksUnused(s: AgentSnapshot | undefined): boolean {
  const c = s?.chain
  return Boolean(c && c.nonce === 0 && c.egld === 0n && c.wegld === 0n && c.foxsy === 0n && c.nftCount === 0 && !s!.registration.registered && !s!.registration.profileUnreadable)
}

function snapshotSummary(s: AgentSnapshot | undefined) {
  if (!s) return null
  const p = s.profile
  return {
    takenAt: s.takenAt,
    egld: s.chain ? formatAtomic(s.chain.egld, 4) : null,
    foxsy: s.chain ? formatAtomic(s.chain.foxsy, 2) : null,
    // Always shown, 0.0000 included, so an empty WEGLD balance reads as empty and not as missing.
    wegld: s.chain ? formatAtomic(s.chain.wegld, 4) : null,
    cards: s.chain?.nftCount ?? null,
    prices: s.prices,
    registration: s.registration,
    team: p ? { name: p.team_name, userId: p.id, elo: p.elo_rating, league: p.league, won: p.matches_won, drawn: p.matches_drawn, lost: p.matches_lost, tournamentWins: p.tournament_wins } : null,
    formation: s.team?.formation ?? null,
    matchesToday: s.auth?.allowance ? `${s.auth.allowance.today_count}/${s.auth.allowance.daily_limit}` : null,
    training: s.auth?.shop?.training ?? null,
    upcoming: s.auth?.upcoming?.matches.filter(m => m.phase !== 'finished').length ?? 0,
    // The agent's own tournaments and 1v1s still running, for the Leave buttons.
    mine: (s.auth?.myTournaments?.active ?? []).map(t => ({
      id: t.id,
      title: t.title,
      kind: t.max_teams === 2 ? '1v1' : `${t.format} ${t.participant_count ?? '?'}/${t.max_teams}`,
      tier: t.tier,
      fee: t.entry_fee_foxsy,
      status: t.status,
      deadline: t.deadline,
      startsAt: t.starts_at,
      created: t.creator_user_id === p?.id,
      leavable: t.status === 'open' && new Date(t.deadline).getTime() > Date.now(),
    })),
    openTournaments: s.market.openStandard.length,
    openChallenges: s.market.openChallenges.length,
    gameDay: s.gameDay,
    warnings: s.warnings,
  }
}

/** Settings that let an agent spend more: raising one needs the password, lowering one never does. */
const LIMITS = ['dailyCapUsd', 'monthlyBudgetUsd', 'setupBudgetUsd', 'maxEntryFeeFoxsy', 'maxShopPaymentFoxsy', 'maxSwapFoxsy', 'maxBidFoxsy', 'maxBidCommonFoxsy', 'maxBidUncommonFoxsy', 'maxBidRareFoxsy', 'maxBidEpicFoxsy', 'maxBidLegendaryFoxsy', 'paidTrainingPerDay', 'boostersPerWeek', 'packsPerWeek'] as const

/** Hours in an active window [from, to), which may cross midnight; [0, 24] is all day. */
export function windowHours([from, to]: [number, number]): number {
  return (to - from + 24) % 24 || 24
}

export function raisesLimit(current: AgentSettings, patch: Partial<AgentSettings>): boolean {
  if (LIMITS.some(k => patch[k] !== undefined && Number(patch[k]) > Number(current[k]))) return true
  if (patch.egldGasReserve !== undefined && Number(patch.egldGasReserve) < Number(current.egldGasReserve)) return true
  // Gold back on (entries above the Silver ceiling), more cycles a day (AI spend): the password too.
  if (patch.entryFeesGold !== undefined && patch.entryFeesGold.length > 0 && current.entryFeesGold.length === 0) return true
  if (patch.tickMinutes !== undefined && patch.tickMinutes < current.tickMinutes) return true
  return patch.activeHoursUtc !== undefined && windowHours(patch.activeHoursUtc) > windowHours(current.activeHoursUtc)
}

/**
 * A dearer model (any of its list prices higher) or a higher effort: the AI spend has no cap of its own, so like a
 * shorter tick it needs the password. A model without a known price counts as dearer.
 */
export function raisesAiSpend(current: { model: string; effort: string }, next: { model: string; effort: Effort }): boolean {
  const was = isKnownModel(current.model) ? MODELS[current.model]!.price : null
  const will = MODELS[next.model]!.price
  if (!was || will.some((p, i) => p > was[i]!)) return true
  return EFFORTS.indexOf(next.effort) > (EFFORTS as readonly string[]).indexOf(current.effort)
}

export function startWeb(service: Service, creds: Credentials, port: number, host = '127.0.0.1'): Server {
  const sessions = new Sessions(creds.secretKey, creds.passwordHash)
  const throttle = new LoginThrottle()
  const loginWork = new BoundedQueue()
  const secureCookie = process.env.WEB_UI_INSECURE_COOKIE !== '1'
  const cookieFlags = `HttpOnly; SameSite=Lax; Path=/${secureCookie ? '; Secure' : ''}`
  /** The password again for a sensitive change, under the login's lockout (throws 429 or 403). */
  const recheckPassword = (req: IncomingMessage, password: unknown): void => {
    const ip = clientIp(req)
    const gate = throttle.check(ip, undefined, { global: false }) // behind a session: only this address's own failures count
    if (!gate.ok) throw new HttpFail(429, `too many attempts; try again in ${gate.waitS} s`)
    if (!verifyPassword(String(password ?? ''), creds.passwordHash)) {
      throttle.recordFailure(ip)
      throw new HttpFail(403, 'wrong password')
    }
    throttle.recordSuccess(ip)
  }

  // `seen`: the conversation revision the page already holds; the conversation is sent only when it changed.
  const state = (seen?: string | null) => {
    const cfg = service.cfg
    const agents = service.store.agents()
    const now = new Date()
    const nextIndex = service.nextIndex()
    return {
      instance: {
        killSwitch: service.store.killSwitch,
        liveMode: service.store.liveMode,
        liveEnabled: service.executor.liveEnabled,
        model: service.strategist ? service.strategist.model : null,
        effort: service.strategist ? service.strategist.effort : null,
        models: Object.entries(MODELS).map(([id, m]) => ({ id, label: m.label, price: m.price })),
        efforts: EFFORTS,
        telegram: Boolean(service.telegram),
        // The welcome guide's checklist: which keys are set (never their values) and whether it was hidden.
        setup: {
          ai: Boolean(cfg.anthropicApiKey),
          telegramToken: Boolean(cfg.telegramToken),
          telegramChat: Boolean(cfg.telegramChatId),
          binance: Boolean(process.env.BINANCE_API_KEY?.trim() && process.env.BINANCE_API_SECRET?.trim()),
          welcomeHidden: service.store.getKv('welcome_hidden') === '1',
        },
        modelUsdTotal: Number(service.store.getKv('model_usd_total') ?? 0),
        ...(() => {
          const days = service.modelUsdByDay()
          const today = new Date().toISOString().slice(0, 10)
          const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
          return { modelUsdToday: days[today] ?? 0, modelUsdYesterday: days[yesterday] ?? 0 }
        })(),
        maxAgents: cfg.maxAgents,
        next: agents.length < cfg.maxAgents ? { index: nextIndex, address: service.wallet(nextIndex).address } : null,
        presets: STRATEGY_PRESETS,
        // Today's market price per rarity from the kept sales, shown next to the limits per rarity.
        marketPrices: marketPrices(service.store.salesSince(new Date(Date.now() - 90 * 86_400_000).toISOString()), new Date()),
        levels: LEVEL_SETTINGS,
        levelAi: LEVEL_AI,
        user: creds.username,
      },
      chatRev: service.chatRevision(),
      chat: seen && seen === service.chatRevision() ? null : service.chatLines(),
      agents: agents.map(b => {
        const dry = b.dryRun || !service.executor.liveEnabled
        const snap = service.snapshots.get(b.index)
        return {
          index: b.index,
          address: b.address,
          source: b.source,
          effectiveDryRun: dry,
          paused: b.paused,
          busy: service.isBusy(b.index),
          createdAt: b.createdAt,
          settings: b.settings,
          budget: budgetView(service.store, b.index, b.settings, dry, now, snap?.gameDay.resetHourUtc ?? 14),
          snapshot: snapshotSummary(snap),
          funds: { usd: fundsUsd(snap), playable: playableUsd(snap, b.settings.egldGasReserve), low: lowOnFunds(playableUsd(snap, b.settings.egldGasReserve), b.settings.topUpWarningUsd) },
          lastPlan: service.store.getKv(`last_plan_${b.index}`) ?? null,
          // Delete is offered only for a wallet that looks untouched; pressing it checks again from the chain.
          deletable: b.source !== 'imported' && b.index >= service.agentCount() && looksUnused(snap) && !service.store.everUsed(b.index),
        }
      }),
      // Parked with Retire: what the Retired list shows to restore them.
      retired: service.store.retiredAgents().map(b => ({
        index: b.index, address: b.address, source: b.source, ...b.retired!,
        // For the Spent today total: a retired agent may have spent earlier this game day.
        spentTodayUsd: budgetView(service.store, b.index, b.settings, b.dryRun || !service.executor.liveEnabled, now).spentTodayUsd,
      })),
    }
  }

  const agentIndex = (raw: string | undefined): number => {
    const n = Number(raw)
    if (!Number.isInteger(n) || !service.store.agent(n)) throw new HttpFail(404, `no agent at index ${raw}`)
    if (service.store.agent(n)!.retired) throw new HttpFail(409, `${agentName(n)} is retired: restore it first`)
    return n
  }

  const loginPage = (res: ServerResponse, status: number, error: string) => sendPage(res, status, PAGES.login.replace('{{ERROR}}', escapeHtml(error)))

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const path = url.pathname
      const method = req.method ?? 'GET'
      const session = cookies(req)[COOKIE_NAME]
      const user = sessions.verify(session)

      if (path === '/healthz') return send(res, 200, 'ok', 'text/plain')

      if (path === '/login' && method === 'GET') return user ? send(res, 303, '', 'text/plain', { location: '/' }) : loginPage(res, 200, '')
      if (path === '/login' && method === 'POST') {
        const ip = clientIp(req)
        const gate = throttle.check(ip)
        if (!gate.ok) return loginPage(res, 429, `Too many attempts. Try again in ${gate.waitS} s.`)
        const form = new URLSearchParams(await readBody(req, 4096))
        const username = form.get('username') ?? ''
        const password = form.get('password') ?? ''
        // Both checks always run, so the timing does not reveal which one failed.
        // Off the event loop and one at a time: a flood of attempts must not stall the executor or the kill switch.
        const passOk = await loginWork.run(() => verifyPasswordAsync(password, creds.passwordHash), ip)
        if (passOk === null) return loginPage(res, 429, 'Busy: too many sign-in attempts at once. Try again in a few seconds.')
        const userOk = username.length === creds.username.length && username === creds.username
        if (!(passOk && userOk)) {
          throttle.recordFailure(ip)
          return loginPage(res, 401, 'Wrong username or password.')
        }
        throttle.recordSuccess(ip)
        return send(res, 303, '', 'text/plain', { location: '/', 'set-cookie': `${COOKIE_NAME}=${sessions.issue(username)}; Max-Age=${SESSION_TTL_S}; ${cookieFlags}` })
      }

      if (!user) {
        if (path.startsWith('/api/')) return json(res, 401, { error: 'not signed in' })
        return send(res, 303, '', 'text/plain', { location: '/login' })
      }

      if (method === 'GET' && path === '/') {
        return sendPage(res, 200, PAGES.dashboard.replace('{{CSRF}}', sessions.csrfFor(session!)).replace('{{USER}}', escapeHtml(user)))
      }

      // Every state-changing request: same-origin and the session's CSRF token.
      if (method === 'POST') {
        const origin = req.headers.origin
        if (origin) {
          let host: string | null = null
          try {
            host = new URL(origin).host
          } catch {
            host = null // "null" (sandboxed frames, some redirects) or garbage
          }
          if (!host || host !== req.headers.host) throw new HttpFail(403, 'cross-origin request refused')
        }
        const sent = req.headers['x-csrf-token']
        if (!sessions.checkCsrf(session, typeof sent === 'string' ? sent : undefined)) throw new HttpFail(403, 'missing or wrong CSRF token')
      }

      if (method === 'POST' && path === '/logout') {
        sessions.revoke(session)
        res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': 'application/json', 'set-cookie': `${COOKIE_NAME}=; Max-Age=0; ${cookieFlags}` })
        return res.end('{"ok":true}')
      }
      if (method === 'GET' && path === '/api/state') return json(res, 200, state(url.searchParams.get('chat')))

      const m = /^\/api\/agents\/(\d+)\/([a-z]+)$/.exec(path)
      // Restore is the one route for a retired agent.
      if (m && method === 'POST' && m[2] === 'restore') {
        try {
          return json(res, 200, { ok: true, message: service.restoreAgent(Number(m[1]), user) })
        } catch (err) {
          throw new HttpFail(400, err instanceof Error ? err.message : String(err))
        }
      }
      if (m) {
        const index = agentIndex(m[1])
        const action = m[2]
        if (method === 'GET' && action === 'activity') {
          // SQLite takes only a whole number for LIMIT: anything else (abc, 2.5, empty) would be a 500.
          const asked = Number(url.searchParams.get('limit') || 100)
          const limit = Math.min(300, Math.max(1, Number.isFinite(asked) ? Math.floor(asked) : 100))
          return json(res, 200, service.store.activity(index, limit))
        }
        if (method === 'POST') {
          const body = await readBody(req)
          const data = body ? (JSON.parse(body) as Record<string, unknown>) : {}
          switch (action) {
            case 'pause':
            case 'resume':
              service.store.setPaused(index, action === 'pause')
              service.store.log({ agentIndex: index, kind: 'control', status: 'info', summary: `${action}d from the web UI by ${user}` })
              return json(res, 200, { ok: true })
            case 'advise': {
              const message = String(data.message ?? '').trim()
              if (!message) throw new HttpFail(400, 'write something first')
              if (message.length > 4000) throw new HttpFail(400, 'at most 4000 characters')
              try {
                return json(res, 200, { ...(await service.discuss(message, `web UI, ${user}`, [index])), chat: service.chatLines() })
              } catch (err) {
                throw new HttpFail(502, err instanceof Error ? err.message : String(err))
              }
            }
            case 'tick': {
              // Asked before answering: outside the active hours, paused or busy, nothing would start.
              const refusal = service.tickRefusal(index)
              if (refusal) throw new HttpFail(409, refusal)
              void service.tick(index)
              return json(res, 200, { ok: true, message: `${agentName(index)}: plan started` })
            }
            case 'refresh':
              await service.refreshSnapshot(index)
              return json(res, 200, { ok: true })
            case 'leave': {
              const id = Number(data.tournament_id)
              if (!Number.isInteger(id) || id <= 0) throw new HttpFail(400, 'tournament_id must be a positive whole number')
              return json(res, 200, { ok: true, message: await service.leave(index, id, `web UI, ${user}`) })
            }
            case 'retire':
              try {
                return json(res, 200, { ok: true, message: await service.retireAgent(index, user) })
              } catch (err) {
                throw new HttpFail(400, err instanceof Error ? err.message : String(err))
              }
            case 'delete':
              if (data.confirm !== 'DELETE') throw new HttpFail(400, 'confirm the delete first')
              try {
                return json(res, 200, { ok: true, message: await service.deleteAgent(index, user) })
              } catch (err) {
                throw new HttpFail(400, err instanceof Error ? err.message : String(err))
              }
            case 'remove': {
              if (data.confirm !== 'REMOVE') throw new HttpFail(400, 'type REMOVE to confirm')
              recheckPassword(req, data.password)
              try {
                return json(res, 200, { ok: true, message: service.removeAgent(index, user) })
              } catch (err) {
                throw new HttpFail(400, err instanceof Error ? err.message : String(err))
              }
            }
            case 'settings': {
              const { password, ...fields } = data
              let patch
              try {
                patch = validateSettingsPatch(fields)
                checkTiming({ ...service.store.agent(index)!.settings, ...patch })
              } catch (err) {
                throw new HttpFail(400, err instanceof Error ? err.message : String(err))
              }
              // Lowering a limit is one click; raising one (or shrinking the gas reserve) needs the password again.
              if (raisesLimit(service.store.agent(index)!.settings, patch)) recheckPassword(req, password)
              const next = service.store.updateSettings(index, patch)
              service.settingsSaved(index)
              service.store.log({ agentIndex: index, kind: 'control', status: 'info', summary: `settings changed from the web UI by ${user}: ${Object.keys(patch).join(', ')}` })
              return json(res, 200, { ok: true, settings: next })
            }
          }
        }
      }

      if (method === 'POST' && path === '/api/kill') {
        const body = JSON.parse((await readBody(req)) || '{}') as { on?: unknown; password?: unknown }
        if (body.on !== true) recheckPassword(req, body.password) // stopping is one click, releasing needs the password
        service.store.setKillSwitch(body.on === true)
        service.notify(`kill switch ${body.on === true ? 'ON' : 'off'} (web UI, ${user})`)
        return json(res, 200, { ok: true })
      }
      if (method === 'POST' && path === '/api/mode') {
        const body = JSON.parse((await readBody(req)) || '{}') as { live?: unknown; confirm?: unknown; password?: unknown }
        const live = body.live === true
        if (live && body.confirm !== 'GO LIVE') throw new HttpFail(400, 'going live requires typing GO LIVE')
        if (live) recheckPassword(req, body.password)
        try {
          return json(res, 200, { ok: true, message: service.setMode(live, `web UI, ${user}, ${clientIp(req)}`) })
        } catch (err) {
          throw new HttpFail(409, err instanceof Error ? err.message : String(err))
        }
      }
      if (path === '/api/chat/clear' && method === 'POST') return json(res, 200, { ok: true, message: service.clearChat(`web UI, ${user}`), chat: service.chatLines() })
      const pm = /^\/api\/proposals\/([0-9a-f]{8})\/(apply|cancel)$/.exec(path)
      if (method === 'POST' && pm) {
        if (pm[2] === 'cancel') return json(res, 200, { ok: true, message: service.cancelProposal(pm[1]!) })
        try {
          return json(res, 200, { ok: true, message: service.applyProposal(pm[1]!, `web UI, ${user}`) })
        } catch (err) {
          throw new HttpFail(409, err instanceof Error ? err.message : String(err))
        }
      }
      // Admin panel: one set of keys for the whole instance.
      if (path === '/api/admin/keys' && method === 'GET') return json(res, 200, { keys: service.keyStatus() })
      if (path === '/api/admin/keys' && method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}') as { values?: Record<string, unknown>; password?: unknown }
        // Changing a key needs the password again, like showing one: a stolen session alone cannot re-point Telegram.
        recheckPassword(req, body.password)
        const values: KeyValues = {}
        for (const [k, v] of Object.entries(body.values ?? {})) {
          if (!isKeyName(k)) throw new HttpFail(400, `unknown key ${k}`)
          if (typeof v !== 'string') throw new HttpFail(400, `${k} must be text`)
          if (v.trim()) values[k] = v.trim()
        }
        try {
          return json(res, 200, { ok: true, message: service.updateKeys(values, `web UI, ${user}, ${clientIp(req)}`) })
        } catch (err) {
          throw new HttpFail(400, err instanceof Error ? err.message : String(err))
        }
      }
      if (path === '/api/welcome' && method === 'POST') {
        const body = JSON.parse((await readBody(req, 1024)) || '{}') as { hidden?: unknown }
        service.store.setKv('welcome_hidden', body.hidden === true ? '1' : '0')
        return json(res, 200, { ok: true })
      }
      // Link my Telegram: the owner sends a one-time code to their Telegram bot, so nobody has to find a chat id.
      if (path === '/api/admin/telegram/link' && method === 'POST') {
        const body = JSON.parse((await readBody(req, 4096)) || '{}') as { password?: unknown }
        recheckPassword(req, body.password)
        try {
          return json(res, 200, { ok: true, ...(await service.startTelegramLink()) })
        } catch (err) {
          throw new HttpFail(400, err instanceof Error ? err.message : String(err))
        }
      }
      if (path === '/api/admin/telegram/confirm' && method === 'POST') {
        const body = JSON.parse((await readBody(req, 4096)) || '{}') as { password?: unknown }
        recheckPassword(req, body.password)
        try {
          return json(res, 200, { ok: true, message: await service.finishTelegramLink(`web UI, ${user}, ${clientIp(req)}`) })
        } catch (err) {
          throw new HttpFail(400, err instanceof Error ? err.message : String(err))
        }
      }
      if (path === '/api/admin/keys/reveal' && method === 'POST') {
        // Showing a key needs the password again, with the login's lockout, and is always announced.
        const ip = clientIp(req)
        const body = JSON.parse((await readBody(req, 4096)) || '{}') as { key?: unknown; password?: unknown }
        recheckPassword(req, body.password)
        const key = String(body.key ?? '')
        if (!isKeyName(key)) throw new HttpFail(400, `unknown key ${key}`)
        try {
          return json(res, 200, { value: service.revealKey(key, `${user}, ${ip}`) })
        } catch (err) {
          throw new HttpFail(404, err instanceof Error ? err.message : String(err))
        }
      }
      if (path === '/api/admin/keys/test' && method === 'POST') return json(res, 200, { results: await service.testKeys() })
      if (method === 'POST' && path === '/api/strategist') {
        const body = JSON.parse((await readBody(req)) || '{}') as { model?: unknown; effort?: unknown; password?: unknown }
        const model = String(body.model ?? '')
        const effort = String(body.effort ?? '') as Effort
        if (!isKnownModel(model)) throw new HttpFail(400, `unknown model ${model}`)
        if (!EFFORTS.includes(effort)) throw new HttpFail(400, `unknown effort ${effort}`)
        // A cheaper model or less effort is one click; a dearer one needs the password again.
        if (service.strategist && raisesAiSpend(service.strategist, { model, effort })) recheckPassword(req, body.password)
        try {
          return json(res, 200, { ok: true, message: service.setStrategist(model, effort, `web UI, ${user}`) })
        } catch (err) {
          throw new HttpFail(409, err instanceof Error ? err.message : String(err))
        }
      }
      if (method === 'POST' && path === '/api/agents') {
        let agent
        try {
          agent = service.addNextAgent()
        } catch (err) {
          throw new HttpFail(400, err instanceof Error ? err.message : String(err))
        }
        service.notify(`${agentName(agent.index)} added from the web UI by ${user}: ${agent.address}`)
        // PEM files never live on a server: the owner's computer writes them from the same recovery words.
        const pem = service.cfg.isServer
          ? `its PEM file stays off the server: run ./deploy/sync-pems.sh on your computer to get pem/${pemName(agent.index)}`
          : `its PEM file is pem/${pemName(agent.index)}`
        return json(res, 200, { ok: true, agent, message: `Agent ${agent.index + 1} added; ${pem}` })
      }
      // Import team, step 1: the key is read and the wallet checked; nothing is stored, the answer holds no secret.
      if (method === 'POST' && path === '/api/agents/import/check') {
        const data = JSON.parse((await readBody(req, 16 * 1024)) || '{}') as Record<string, unknown>
        try {
          return json(res, 200, await service.previewImport(data as unknown as ImportInput))
        } catch (err) {
          throw new HttpFail(400, err instanceof Error ? err.message : String(err))
        }
      }
      // Step 2: the dashboard password confirms, then the key is stored and the agent added (paused).
      if (method === 'POST' && path === '/api/agents/import') {
        const data = JSON.parse((await readBody(req, 4096)) || '{}') as { token?: unknown; password?: unknown }
        recheckPassword(req, data.password)
        let agent
        try {
          agent = service.importAgent(String(data.token ?? ''), user)
        } catch (err) {
          throw new HttpFail(400, err instanceof Error ? err.message : String(err))
        }
        return json(res, 200, { ok: true, agent, message: `Agent ${agent.index + 1} added: your team, paused until you resume it` })
      }

      throw new HttpFail(404, 'not found')
    } catch (err) {
      const status = err instanceof HttpFail ? err.status : err instanceof SyntaxError ? 400 : 500
      const message = err instanceof Error ? err.message : String(err)
      if (status === 500) console.error('web UI error:', err)
      if (!res.headersSent) json(res, status, { error: status === 500 ? 'internal error' : message })
    }
  })

  server.listen(port, host, () => console.log(`web UI on http://${host}:${port}`))
  return server
}
