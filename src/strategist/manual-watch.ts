// Whether FoxLeague's live manual has moved ahead of the agents' copy (manual.md), checked without a FoxLeague
// checkout, so the server can do it. From the morning summary's hour on, every hour while the copy is current (and up
// to MAX_TRIES a day while it cannot tell), the service asks FoxLeague's public, read-only MCP server
// (https://foxleague.ai/mcp) for its manual pages (the tools list_manual_pages and get_manual_page) and compares each
// page the agents take in with the fingerprint sync-manual recorded for it in manual-pages.json. The pages change
// only when FoxLeague's manual changes, not with every FoxLeague deploy. FoxLeague's game settings, which every
// snapshot reads, are fingerprinted too (observeConfig): a change runs the check at once (audit 2026-11-16, P-W1 to
// P-W8).
//
// Unknown is not "current": a failed read, a missing record or a record of another manual.md says "could not check".
// FoxLeague's slugs and settings keys are the only text of FoxLeague's that goes anywhere (the owner's summary and
// Telegram, the dashboard and, as names in a note the code writes, each plan request), bounded: at most MAX_SLUG
// characters each, at most MAX_PAGES of them kept and at most MAX_NAMED in a line, a key only of the shape of one
// (config-watch.ts). Every reason the check gives is in our own words.

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { zoneDate } from '../summary.ts'
import { AnswerTooLargeError, readCapped } from '../util/http.ts'
import { LEFT_OUT, ROOT, undecidedPages } from './manual.ts'
import { MAX_KEYS, changedKeys, configPrint, isConfigKey, isoTime, keyDiff, named, unknownSwitches, type RuleSwitch } from '../foxleague/config-watch.ts'

/** The agents' manual and the page record sync-manual writes next to it. */
export const MANUAL_FILE = join(import.meta.dirname, 'manual.md')
export const RECORD_FILE = join(import.meta.dirname, 'manual-pages.json')
/** The pause between two requests: FoxLeague's nginx allows 2 a second on /mcp. */
export const GAP_MS = 600
/** How long one request may take and how long the whole check may take. */
export const REQUEST_TIMEOUT_MS = 15_000
export const CHECK_DEADLINE_MS = 90_000
/**
 * An answer larger than this is not read (the longest page is about 60 KB): it is counted as it streams and cut off
 * past the cap, one that declares more is refused unread (readCapped, ATTACK-5).
 */
export const MAX_ANSWER_BYTES = 2 * 1024 * 1024
export const MAX_PAGES = 200
/**
 * The longest slug taken (the longest real one has 29 characters): a longer one in FoxLeague's list makes the list
 * unreadable, so FoxLeague cannot put more of its text into the owner's summary, the dashboard or the stored check.
 */
export const MAX_SLUG = 120
/** The most pages the owner's line names: the rest are counted ("and 12 more"), so the line stays one message. */
export const MAX_NAMED = 8
/** What a slug looks like (`mechanics/one-v-one`): anything else in FoxLeague's list makes it unreadable. */
const SLUG = /^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*){0,4}$/
/** A slug as taken, from FoxLeague's list or from the page record: its length first, then its shape. */
const isSlug = (s: unknown): s is string => typeof s === 'string' && s.length <= MAX_SLUG && SLUG.test(s)
/** The kv key of the day's check. */
const KV = 'manual_check'
/**
 * Through the day (audit 2026-11-16, MNT-5 and MNT-6): a check that found the copy current is made again at the
 * service's next hourly look once this long has passed, so a manual FoxLeague deploys after the morning is seen within
 * the hour; one that found it behind stays for the day.
 */
export const RECHECK_MS = 55 * 60_000
/** A check that could not reach FoxLeague is tried again at the next hourly looks, at most this many tries a day. */
export const MAX_TRIES = 4
/** The kv keys of the settings fingerprint (P-W2) and of what the owner was told (P-W3, hashes only). */
const CONFIG_KV = 'manual_config'
const TOLD_KV = 'manual_told'
const KEYS_TOLD_KV = 'manual_keys_told_at'
const TOLD_KEPT = 64
/**
 * How soon after the last check a changed key set runs the check again (P-W2): settings that flip between two
 * FoxLeague servers during a deploy ask at most this often. A moved rule number alone waits RECHECK_MS.
 */
export const FORCE_GAP_MS = 10 * 60_000
/** The most checks the settings run a day, and how often a change of the settings keys is told at most: settings whose
 * keys keep changing (a map keyed by ids) neither ask FoxLeague every 10 minutes nor fill the owner's chat. */
export const MAX_FORCED_A_DAY = 6
export const KEYS_TELL_GAP_MS = 6 * 3600_000
/** A switch the agents have no rule for is told when its `live_from` is this close (P-W3). */
export const SOON_MS = 7 * 86_400_000

export type McpFetch = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal; redirect: 'error' }) => Promise<Response>

/** What sync-manual records: the manual.md it wrote, the FoxLeague commit it names and a fingerprint per page. */
export interface ManualRecord {
  synced: string
  /** sha256 of manual.md: a record of another manual.md is not compared. */
  manual: string
  /** Each page the agents take in that FoxLeague's MCP server serves, by slug: the fingerprint of its text. */
  pages: Record<string, string>
  /**
   * The keys of FoxLeague's game settings (GET /api/config) at every depth when the copy was synced, sorted (audit
   * 2026-11-16, P-W8): what the copy and the rules were built against. A record of the version before has none.
   */
  config?: string[]
}

export type ManualState = 'current' | 'behind' | 'unknown'
export interface ManualCheck {
  state: ManualState
  /** The pages that differ, in FoxLeague's order: "slug", "slug (new)" or "slug (gone)". */
  pages: string[]
  /** Why it could not be checked (state unknown), in our own words. */
  why: string | null
  /** The FoxLeague commit the agents' manual was synced at, from the record. */
  synced: string | null
  at: string
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
/** A page's fingerprint: its Markdown body, whitespace folded, so a change of line breaks alone is no change. */
const fingerprint = (body: string) => sha256(body.replace(/\s+/g, ' ').trim())

/** The commit manual.md's header names (`... main at 89a1955d7 2026-11-10.`), as manualStatus reads it. */
function syncedAt(manual: string): string | null {
  return / at ([0-9a-f]{7,} \d{4}-\d{2}-\d{2})\./.exec(manual.split('\n', 3).join('\n'))?.[1] ?? null
}

/** A slug's source files are `slug.md` or `slug.mdx`: left out when either is. */
function leftOut(slug: string): boolean {
  return [`${slug}.md`, `${slug}.mdx`].some(p => Object.keys(LEFT_OUT).some(e => p === e || p.startsWith(`${e}/`)))
}

/**
 * The body FoxLeague's MCP server gives for a source page; null for a draft (it serves none). As its
 * mcp/src/resources.ts builds it: front matter off, no MDX imports, MDX comments or HTML comments.
 */
function servedBody(source: string): string | null {
  const m = source.match(/^---\n([\s\S]*?)\n---\n?/)
  const meta: Record<string, string> = {}
  for (const line of (m?.[1] ?? '').split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/)
    if (kv) meta[kv[1]!] = kv[2]!.replace(/^['"]|['"]$/g, '')
  }
  if (/^true$/i.test(meta.draft ?? '')) return null
  return (m ? source.slice(m[0].length) : source)
    .replace(/^import\s.+$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * The body of a page as the MCP server gives it: without its title heading and the page's address under it. No
 * regular expression runs over the end of the page: one with nested runs took the cube of the page's length and
 * stood the whole service still (audit 2026-11-16, ATK-1). The fingerprint folds whitespace, so the line breaks
 * before the address need not go.
 */
function liveBody(text: string): string {
  const body = text.replace(/^# [^\n]*\n/, '').trimEnd()
  const at = body.lastIndexOf('\n')
  return at >= 0 && body.startsWith('Source: https://docs.foxleague.ai/', at + 1) ? body.slice(0, at) : body
}

/**
 * The page record for manual.md, from the FoxLeague checkout sync-manual read (read only: no fetch here). The pages
 * the agents take in (manual.ts), each that the manual's sidebar lists and that is no draft, as FoxLeague serves them.
 */
export function manualRecord(repo: string, ref: string, manual: string, settings?: unknown): ManualRecord {
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const all = git('ls-tree', '-r', '--name-only', ref, '--', ROOT).split('\n').filter(f => /\.mdx?$/.test(f)).map(f => f.slice(ROOT.length + 1))
  const undecided = undecidedPages(all)
  const sidebar = new Set([...git('show', `${ref}:${ROOT.replace(/\/src\/content\/docs$/, '')}/astro.config.mjs`).matchAll(/slug:\s*'([^']+)'/g)].map(m => m[1]!))
  const pages: Record<string, string> = {}
  for (const path of [...all].sort()) {
    const slug = path.replace(/\.mdx?$/, '')
    // FoxLeague serves slug.md where both exist; a page outside the sidebar is not served.
    if (leftOut(slug) || undecided.includes(path) || !sidebar.has(slug) || (path.endsWith('.mdx') && all.includes(`${slug}.md`))) continue
    const body = servedBody(git('show', `${ref}:${ROOT}/${path}`))
    if (body !== null) pages[slug] = fingerprint(body)
  }
  const config = settings === undefined ? null : configPrint(settings)
  if (settings !== undefined && !config) throw new Error("FoxLeague's game settings could not be read as settings: the record names their keys")
  return { synced: syncedAt(manual) ?? 'unknown', manual: sha256(manual), pages, ...(config ? { config: config.keys } : {}) }
}

function validRecord(r: unknown): ManualRecord | null {
  if (!r || typeof r !== 'object') return null
  const { synced, manual, pages } = r as Record<string, unknown>
  if (typeof synced !== 'string' || typeof manual !== 'string' || !/^[0-9a-f]{64}$/.test(manual) || !pages || typeof pages !== 'object' || Array.isArray(pages)) return null
  const entries = Object.entries(pages as Record<string, unknown>)
  if (!entries.length || entries.some(([slug, print]) => !isSlug(slug) || typeof print !== 'string' || !/^[0-9a-f]{64}$/.test(print))) return null
  // The key set of the settings (P-W8): read both ways, absent in a record of the version before; one that is not a
  // list of shaped keys makes no record, as an odd slug does.
  const config = (r as Record<string, unknown>).config
  if (config !== undefined && (!Array.isArray(config) || config.length > MAX_KEYS || !config.every(isConfigKey))) return null
  return { synced, manual, pages: Object.fromEntries(entries) as Record<string, string>, ...(config ? { config: config as string[] } : {}) }
}

/** A failure that ends the day's check, in our own words. */
class CheckError extends Error {}
const UNREADABLE = "FoxLeague's answer could not be read"

/**
 * A signal that aborts after `ms` with a TimeoutError. Its timer holds the process open (AbortSignal.timeout's does
 * not), so a request that never answers still ends the check; `clear` stops it once the request is done.
 */
function timeout(ms: number): { signal: AbortSignal; clear: () => void } {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(new DOMException(`no answer within ${ms} ms`, 'TimeoutError')), ms)
  return { signal: ctl.signal, clear: () => clearTimeout(t) }
}

/** One read-only tool call to FoxLeague's MCP server: its JSON answer. */
async function callTool(o: CheckOptions, name: 'list_manual_pages' | 'get_manual_page', args: Record<string, string>, deadline: AbortSignal): Promise<unknown> {
  const limit = timeout(o.timeoutMs ?? REQUEST_TIMEOUT_MS)
  let raw: string
  let type: string
  try {
    const res = await (o.fetch ?? (fetch as unknown as McpFetch))(`${o.base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': 'foxleague-agent' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      signal: AbortSignal.any([limit.signal, deadline]),
      redirect: 'error',
    })
    if (!res.ok) throw new CheckError(`FoxLeague answered HTTP ${res.status}`)
    type = res.headers.get('content-type') ?? ''
    // Never buffered whole: the process that books and signs reads at most MAX_ANSWER_BYTES of it.
    raw = await readCapped(res, `${o.base}/mcp`, MAX_ANSWER_BYTES).catch((err: unknown) => {
      throw err instanceof AnswerTooLargeError ? new CheckError(UNREADABLE) : err
    })
  } finally {
    limit.clear()
  }
  try {
    // A JSON answer or a stream whose last data line holds it.
    const json = /text\/event-stream/.test(type) ? raw.split('\n').filter(l => l.startsWith('data:')).at(-1)?.slice(5) ?? '' : raw
    const msg = JSON.parse(json) as { error?: unknown; result?: { isError?: boolean; content?: { type?: string; text?: unknown }[] } }
    const text = msg.result?.content?.find(c => c.type === 'text')?.text
    if (msg.error !== undefined || msg.result?.isError || typeof text !== 'string') throw new CheckError(UNREADABLE)
    return JSON.parse(text) as unknown
  } catch {
    throw new CheckError(UNREADABLE)
  }
}

export interface CheckOptions {
  /** FoxLeague's address (FOXLEAGUE_URL); the MCP server answers at /mcp. */
  base: string
  /** manual.md's text, null when it could not be read. */
  manual: string | null
  /** manual-pages.json as read (anything: it is checked here), null when there is none. */
  record: unknown
  fetch?: McpFetch
  gapMs?: number
  timeoutMs?: number
  deadlineMs?: number
  sleep?: (ms: number) => Promise<void>
}

/**
 * The check: FoxLeague's page list, then each page the agents know that FoxLeague still serves, one at a time with a
 * pause between them. The first failure ends it ("unknown"); nothing is asked again.
 */
export async function checkManual(o: CheckOptions): Promise<ManualCheck> {
  const at = new Date().toISOString()
  const record = validRecord(o.record)
  const synced = record?.synced ?? null
  const unknown = (why: string): ManualCheck => ({ state: 'unknown', pages: [], why, synced, at })
  if (o.manual === null) return unknown("the agents' manual.md could not be read")
  if (!record) return unknown("the agents' copy has no page record (src/strategist/manual-pages.json). The maintainer runs sync-manual")
  if (record.manual !== sha256(o.manual)) return unknown("the page record is not the one of the agents' manual.md. The maintainer runs sync-manual")
  const whole = timeout(o.deadlineMs ?? CHECK_DEADLINE_MS)
  const deadline = whole.signal
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  let asked = 0
  const call = async (name: 'list_manual_pages' | 'get_manual_page', args: Record<string, string> = {}) => {
    if (asked++) await sleep(o.gapMs ?? GAP_MS)
    return callTool(o, name, args, deadline)
  }
  try {
    const list = await call('list_manual_pages')
    const slugs = Array.isArray(list) ? list.map(p => (p && typeof p === 'object' ? (p as { slug?: unknown }).slug : undefined)) : []
    if (!slugs.length || slugs.length > MAX_PAGES || slugs.some(s => !isSlug(s))) throw new CheckError(UNREADABLE)
    const live = [...new Set(slugs as string[])]
    const differ: string[] = []
    for (const slug of live) {
      if (leftOut(slug)) continue
      const known = record.pages[slug]
      if (known === undefined) {
        differ.push(`${slug} (new)`)
        continue
      }
      const page = await call('get_manual_page', { slug })
      const text = page && typeof page === 'object' && (page as { slug?: unknown }).slug === slug ? (page as { text?: unknown }).text : undefined
      if (typeof text !== 'string') throw new CheckError(UNREADABLE)
      if (fingerprint(liveBody(text)) !== known) differ.push(slug)
    }
    for (const slug of Object.keys(record.pages)) if (!live.includes(slug)) differ.push(`${slug} (gone)`)
    return { state: differ.length ? 'behind' : 'current', pages: differ, why: null, synced, at }
  } catch (err) {
    if (err instanceof CheckError) return unknown(err.message)
    if (deadline.aborted) return unknown(`the check took longer than ${Math.round((o.deadlineMs ?? CHECK_DEADLINE_MS) / 1000)} seconds`)
    if (err instanceof Error && err.name === 'TimeoutError') return unknown(`FoxLeague did not answer within ${Math.round((o.timeoutMs ?? REQUEST_TIMEOUT_MS) / 1000)} seconds`)
    return unknown('FoxLeague could not be reached')
  } finally {
    whole.clear()
  }
}

/**
 * The owner's line for a check; null when the copy is current. `when`: "today" or "on 2026-11-14" for an older one.
 * It names at most MAX_NAMED pages and counts the rest: a manual FoxLeague rebuilt with many pages stays one line.
 */
export function manualLine(c: ManualCheck, when = 'today'): string | null {
  if (c.state === 'behind') {
    const more = c.pages.length - MAX_NAMED
    return `FoxLeague's manual changed since the agents' copy (pages: ${c.pages.slice(0, MAX_NAMED).join(', ')}${more > 0 ? ` and ${more} more` : ''}). The maintainer runs sync-manual.`
  }
  if (c.state === 'unknown') return `Could not check FoxLeague's manual ${when}: ${c.why ?? 'no reason was given'}.`
  return null
}

/** The notice's line about the settings keys that changed since the agents' copy (P-W2). */
export function configLine(keys: string[]): string {
  return `FoxLeague's game settings changed since the agents' copy (keys: ${named(keys)}). The maintainer runs sync-manual.`
}

/** What the owner is told at once (P-W3): the manual gone behind, the settings keys changed, a switch the agents do not know. */
export function manualTell(c: ManualCheck): string {
  return `FoxLeague's manual changed since the agents' copy (pages: ${named(c.pages)}). Until a version of the agent brings the new copy, each plan is told that the snapshot's live values and the executor's refusals win over the manual on those pages. The maintainer runs sync-manual.`
}
export function configTell(keys: string[]): string {
  return `FoxLeague's game settings changed since the agents' copy (keys: ${named(keys)}). Each plan reads the live values and is told of the change, but the agents' rules may not know these keys yet. The maintainer runs sync-manual.`
}
export function switchTell(sw: RuleSwitch): string {
  const at = isoTime(sw.from ?? 0)
  return `FoxLeague's game settings carry a rule switch the agents do not know yet: ${sw.key}, ${sw.live === true ? 'live since' : 'live from'} ${at.slice(0, 10)} ${at.slice(11, 16)} UTC. Each plan sees it in the snapshot with its numbers; the maintainer adds the rule.`
}

export interface ManualWatchDeps {
  /** Off with AGENT_MANUAL_CHECK=0 and for a service a test builds without it: it asks nobody. */
  enabled: boolean
  base: string
  /** The time zone of the morning summary: a day is a day there. */
  zone: string
  kv: { get(key: string): string | null; set(key: string, value: string): void }
  /** Tells the owner at once, an urgent Telegram line (P-W3); each change once. */
  tell?: (text: string) => void
}

export interface ManualView {
  enabled: boolean
  state: ManualState | null
  pages: string[]
  why: string | null
  synced: string | null
  at: string | null
  /** The day (in the summary's zone) of the last check. */
  day: string | null
  /** The settings keys changed since the agents' copy: `elo_pair_cap (new)`, `old_key (gone)` (P-W2). */
  keys: string[]
  /** The notice, null when there is nothing to tell. */
  text: string | null
}

/**
 * The settings fingerprint as the database keeps it, for one copy: the keys it is compared with (null when the page
 * record names them), the last hashes seen and the keys changed, as named.
 */
interface ConfigState { copy: string; base: string[] | null; keysHash: string; valuesHash: string; keys: string[] }
/** A changed key as named, checked again when read back. */
const isChangedKey = (k: unknown): k is string => typeof k === 'string' && / \((?:new|gone)\)$/.test(k) && isConfigKey(k.replace(/ \((?:new|gone)\)$/, ''))

/**
 * A check as the database keeps it: the day it was made (in the summary's zone), the copy it compared, when it was
 * started (`tried`, the service's clock) and how many checks in a row that day could not tell (`fails`). A row of the
 * version before has neither: its `at` stands for `tried`, and it counts as one try.
 */
type StoredCheck = ManualCheck & { day: string; copy?: string; tried?: number; fails?: number }

/**
 * The service's side: the day's check, kept in the database so a restart does not ask again before it is due. A copy
 * found current is checked again each hour, one found behind stays so for the day, and a check that could not tell
 * is tried again each hour up to MAX_TRIES a day.
 */
export class ManualWatch {
  readonly enabled: boolean
  private readonly d: ManualWatchDeps
  private running: Promise<ManualCheck> | null = null
  /** While a check runs: the stored check before it. Its restart marker is not shown meanwhile. */
  private before: StoredCheck | null = null
  /** Set by a test: where the check reads FoxLeague and the agents' copy; the pause between two requests. */
  fetch: McpFetch | undefined = undefined
  readManual: () => string = () => readFileSync(MANUAL_FILE, 'utf8')
  readRecord: () => unknown = () => JSON.parse(readFileSync(RECORD_FILE, 'utf8')) as unknown
  gapMs = GAP_MS
  /** When a changed fingerprint last ran the check (P-W2), and how many it ran on which day. */
  private forcedAt = Number.NEGATIVE_INFINITY
  private forced = { day: '', count: 0 }

  constructor(deps: ManualWatchDeps) {
    this.d = deps
    this.enabled = deps.enabled
  }

  private last(): StoredCheck | null {
    try {
      const v = JSON.parse(this.d.kv.get(KV) ?? 'null') as StoredCheck | null
      if (!v || typeof v.day !== 'string' || !['current', 'behind', 'unknown'].includes(v.state) || !Array.isArray(v.pages)) return null
      return v
    } catch {
      return null
    }
  }

  /**
   * The agents' copy installed now: manual.md and its page record as read, and a key for the pair. A check of another
   * copy (before an update or a deploy brought this one, or a fixed record) tells nothing about this one.
   */
  private copy(): { manual: string | null; record: unknown; key: string } {
    let manual: string | null = null
    let record: unknown = null
    try {
      manual = this.readManual()
    } catch {
      // Said by the check.
    }
    try {
      record = this.readRecord()
    } catch {
      // No record or one that is not JSON: said by the check.
    }
    return { manual, record, key: sha256(JSON.stringify([manual, record ?? null])) }
  }

  /**
   * The check to show: the stored one, or while a check runs the one before it (the stored one is then the marker
   * "the check did not finish", meant for a check a restart cut short). Null when there is none or it is of another
   * copy.
   */
  private shown(): StoredCheck | null {
    const last = this.running ? this.before : this.last()
    return last && last.copy === this.copy().key ? last : null
  }

  /** Whether today's stored check of this copy is to be made again now (see RECHECK_MS and MAX_TRIES). */
  private due(last: StoredCheck, now: number): boolean {
    if (last.state === 'behind') return false
    const tried = typeof last.tried === 'number' ? last.tried : Date.parse(last.at)
    if (Number.isFinite(tried) && now - tried < RECHECK_MS) return false
    return last.state === 'current' || (last.fails ?? 1) < MAX_TRIES
  }

  /**
   * Today's check: the one already made today of the copy installed now while it holds, the one running or a new one.
   * Null when switched off. An update that brings a new manual.md is checked again the same day.
   */
  today(now = Date.now(), o: { force?: boolean; quiet?: boolean } = {}): Promise<ManualCheck | null> {
    if (!this.enabled) return Promise.resolve(null)
    if (this.running) return this.running
    const day = zoneDate(now, this.d.zone)
    const copy = this.copy()
    const last = this.last()
    const same = last?.day === day && last.copy === copy.key
    if (same && !o.force && !this.due(last, now)) return Promise.resolve(last)
    // The checks in a row today that could not tell, this one counted from its start.
    const fails = (same && last.state === 'unknown' ? (last.fails ?? 1) : 0) + 1
    this.before = last
    const run = async (): Promise<ManualCheck> => {
      // Marked before anything is asked: a check that a restart cuts short counts as a try that could not tell.
      this.d.kv.set(KV, JSON.stringify({ state: 'unknown', pages: [], why: 'the check did not finish', synced: null, at: new Date().toISOString(), day, copy: copy.key, tried: now, fails }))
      const c = await checkManual({ base: this.d.base, manual: copy.manual, record: copy.record, fetch: this.fetch, gapMs: this.gapMs })
      this.d.kv.set(KV, JSON.stringify({ ...c, day, copy: copy.key, tried: now, fails: c.state === 'unknown' ? fails : 0 }))
      // Current (or not yet known) to behind, or more pages behind: the owner hears it now, once (P-W3). `quiet`: the
      // caller sends the line itself (the morning summary, /summary), so it is only marked as told.
      if (c.state === 'behind') this.tellOnce(`pages:${copy.key}:${c.pages.join(',')}`, manualTell(c), o.quiet)
      return c
    }
    this.running = run().finally(() => {
      this.running = null
      this.before = null
    })
    return this.running
  }

  /** How long ago a change of the settings keys was last told. */
  private keysToldAgo(now: number): number {
    const at = Number(this.d.kv.get(KEYS_TOLD_KV))
    return Number.isFinite(at) && at > 0 ? now - at : Number.POSITIVE_INFINITY
  }

  /**
   * Each change told once: what was told is kept as hashes, the newest TOLD_KEPT of them. `quiet`: marked, not sent.
   * True when it was told now.
   */
  private tellOnce(what: string, text: string, quiet = false): boolean {
    if (!this.d.tell) return false
    let told: string[] = []
    try {
      const v = JSON.parse(this.d.kv.get(TOLD_KV) ?? '[]') as unknown
      if (Array.isArray(v)) told = v.filter((x): x is string => typeof x === 'string')
    } catch {
      // An unreadable row: start again.
    }
    const id = sha256(what)
    if (told.includes(id)) return false
    this.d.kv.set(TOLD_KV, JSON.stringify([...told, id].slice(-TOLD_KEPT)))
    if (!quiet) this.d.tell(text)
    return !quiet
  }

  private configState(): ConfigState | null {
    try {
      const v = JSON.parse(this.d.kv.get(CONFIG_KV) ?? 'null') as ConfigState | null
      if (!v || typeof v.copy !== 'string' || typeof v.keysHash !== 'string' || typeof v.valuesHash !== 'string' || !Array.isArray(v.keys) || !v.keys.every(isChangedKey)) return null
      if (v.base !== null && !(Array.isArray(v.base) && v.base.every(isConfigKey))) return null
      return v
    } catch {
      return null
    }
  }

  /** The settings keys changed since the agents' copy installed now, as named. */
  private changed(): string[] {
    const st = this.configState()
    return st && st.copy === this.copy().key ? st.keys : []
  }

  /**
   * Each snapshot's game settings (audit 2026-11-16, P-W2 and P-W3). Their keys are compared with the key set the page
   * record names (P-W8), or with the first set this copy saw; a key added or removed runs the manual check at once
   * (at most once in FORCE_GAP_MS), is named on the dashboard, in the summary and in each plan and is told to the
   * owner once. A moved rule number runs the check too (at most once in RECHECK_MS); a counter that moves with play
   * does not. A switch the agents have no rule for with its `live_from` within SOON_MS is told once. Never throws: it
   * runs in every agent's snapshot. Returns the check it started, if any (it never rejects).
   */
  observeConfig(config: unknown, now = Date.now()): Promise<ManualCheck | null> | null {
    if (!this.enabled) return null
    try {
      const print = configPrint(config)
      if (!print) return null
      const copy = this.copy()
      const record = validRecord(copy.record)
      const st = this.configState()
      const fresh = !st || st.copy !== copy.key
      const base = record?.config ?? (fresh ? print.keys : (st.base ?? print.keys))
      const keys = changedKeys(keyDiff(base, print.keys))
      const next = JSON.stringify({ copy: copy.key, base: record?.config ? null : base, keysHash: print.keysHash, valuesHash: print.valuesHash, keys } satisfies ConfigState)
      if (this.d.kv.get(CONFIG_KV) !== next) this.d.kv.set(CONFIG_KV, next)
      if (keys.length && this.keysToldAgo(now) >= KEYS_TELL_GAP_MS && this.tellOnce(`keys:${copy.key}:${keys.join(',')}`, configTell(keys))) this.d.kv.set(KEYS_TOLD_KV, String(now))
      for (const sw of unknownSwitches(config).switches) {
        if (sw.from !== null && Number.isFinite(sw.from) && Math.abs(sw.from - now) <= SOON_MS) this.tellOnce(`switch:${sw.key}:${sw.from}`, switchTell(sw))
      }
      const keysMoved = fresh ? keys.length > 0 : st.keysHash !== print.keysHash
      const valuesMoved = !fresh && st.valuesHash !== print.valuesHash
      if (!keysMoved && !valuesMoved) return null
      const gap = keysMoved ? FORCE_GAP_MS : RECHECK_MS
      const day = zoneDate(now, this.d.zone)
      if (this.forced.day !== day) this.forced = { day, count: 0 }
      if (this.running || now - this.forcedAt < gap || this.forced.count >= MAX_FORCED_A_DAY) return null
      this.forcedAt = now
      this.forced.count++
      console.log(`[${new Date().toISOString()}] FoxLeague's game settings changed (${keysMoved ? `keys: ${keys.length ? named(keys) : 'not shaped like keys'}` : 'rule values'}): checking its manual now`)
      return this.today(now, { force: true }).catch(() => null)
    } catch (err) {
      console.error('the settings watch failed:', err instanceof Error ? err.message : err)
      return null
    }
  }

  /** What the plan request says while the copy is behind (P-W5): the manual pages and the settings keys that changed. */
  planNote(): { pages: string[]; keys: string[] } | null {
    if (!this.enabled) return null
    const last = this.shown()
    const pages = last?.state === 'behind' ? last.pages.filter(p => typeof p === 'string') : []
    const keys = this.changed()
    return pages.length || keys.length ? { pages, keys } : null
  }

  /** The morning summary's line: today's check; "could not check" when there is none for today of this copy. */
  line(now = Date.now()): string | null {
    if (!this.enabled) return null
    const last = this.shown()
    const keys = this.changed()
    const manual = !last || last.day !== zoneDate(now, this.d.zone) ? "Could not check FoxLeague's manual today." : manualLine(last)
    return [manual, keys.length ? configLine(keys) : null].filter(Boolean).join(' ') || null
  }

  /** For the dashboard: the last check of the copy installed now and its notice. */
  view(now = Date.now()): ManualView {
    const last = this.enabled ? this.shown() : null
    const keys = this.enabled ? this.changed() : []
    const settings = keys.length ? configLine(keys) : null
    if (!last) return { enabled: this.enabled, state: null, pages: [], why: null, synced: null, at: null, day: null, keys, text: settings }
    const manual = manualLine(last, last.day === zoneDate(now, this.d.zone) ? 'today' : `on ${last.day}`)
    const text = [manual, settings].filter(Boolean).join(' ') || null
    return { enabled: true, state: last.state, pages: last.pages, why: last.why, synced: last.synced, at: last.at, day: last.day, keys, text }
  }
}
