// Whether FoxLeague's live manual has moved ahead of the agents' copy (manual.md), checked without a FoxLeague
// checkout, so the server can do it. Once a day the service asks FoxLeague's public, read-only MCP server
// (https://foxleague.ai/mcp) for its manual pages (the tools list_manual_pages and get_manual_page) and compares each
// page the agents take in with the fingerprint sync-manual recorded for it in manual-pages.json. The pages change
// only when FoxLeague's manual changes, not with every FoxLeague deploy.
//
// Unknown is not "current": a failed read, a missing record or a record of another manual.md says "could not check".
// Nothing read here reaches a prompt: FoxLeague's slugs go to the owner's summary and the dashboard as plain text.

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { zoneDate } from '../summary.ts'
import { LEFT_OUT, ROOT, undecidedPages } from './manual.ts'

/** The agents' manual and the page record sync-manual writes next to it. */
export const MANUAL_FILE = join(import.meta.dirname, 'manual.md')
export const RECORD_FILE = join(import.meta.dirname, 'manual-pages.json')
/** The pause between two requests: FoxLeague's nginx allows 2 a second on /mcp. */
export const GAP_MS = 600
/** How long one request may take and how long the whole check may take. */
export const REQUEST_TIMEOUT_MS = 15_000
export const CHECK_DEADLINE_MS = 90_000
/** An answer larger than this is not read (the longest page is about 60 KB). */
const MAX_ANSWER_CHARS = 2_000_000
const MAX_PAGES = 200
/** What a slug looks like (`mechanics/one-v-one`): anything else in FoxLeague's list makes it unreadable. */
const SLUG = /^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*){0,4}$/
/** The kv key of the day's check. */
const KV = 'manual_check'

export type McpFetch = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal; redirect: 'error' }) => Promise<Response>

/** What sync-manual records: the manual.md it wrote, the FoxLeague commit it names and a fingerprint per page. */
export interface ManualRecord {
  synced: string
  /** sha256 of manual.md: a record of another manual.md is not compared. */
  manual: string
  /** Each page the agents take in that FoxLeague's MCP server serves, by slug: the fingerprint of its text. */
  pages: Record<string, string>
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

/** The body of a page as the MCP server gives it: without its title heading and the page's address under it. */
function liveBody(text: string): string {
  return text.replace(/^# [^\n]*\n/, '').replace(/\n+Source: https:\/\/docs\.foxleague\.ai\/[^\n]*\s*$/, '')
}

/**
 * The page record for manual.md, from the FoxLeague checkout sync-manual read (read only: no fetch here). The pages
 * the agents take in (manual.ts), each that the manual's sidebar lists and that is no draft, as FoxLeague serves them.
 */
export function manualRecord(repo: string, ref: string, manual: string): ManualRecord {
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
  return { synced: syncedAt(manual) ?? 'unknown', manual: sha256(manual), pages }
}

function validRecord(r: unknown): ManualRecord | null {
  if (!r || typeof r !== 'object') return null
  const { synced, manual, pages } = r as Record<string, unknown>
  if (typeof synced !== 'string' || typeof manual !== 'string' || !/^[0-9a-f]{64}$/.test(manual) || !pages || typeof pages !== 'object' || Array.isArray(pages)) return null
  const entries = Object.entries(pages as Record<string, unknown>)
  if (!entries.length || entries.some(([slug, print]) => !SLUG.test(slug) || typeof print !== 'string' || !/^[0-9a-f]{64}$/.test(print))) return null
  return { synced, manual, pages: Object.fromEntries(entries) as Record<string, string> }
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
    raw = await res.text()
    type = res.headers.get('content-type') ?? ''
  } finally {
    limit.clear()
  }
  if (raw.length > MAX_ANSWER_CHARS) throw new CheckError(UNREADABLE)
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
    if (!slugs.length || slugs.length > MAX_PAGES || slugs.some(s => typeof s !== 'string' || !SLUG.test(s))) throw new CheckError(UNREADABLE)
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

/** The owner's line for a check; null when the copy is current. `when`: "today" or "on 2026-11-14" for an older one. */
export function manualLine(c: ManualCheck, when = 'today'): string | null {
  if (c.state === 'behind') return `FoxLeague's manual changed since the agents' copy (pages: ${c.pages.join(', ')}). The maintainer runs sync-manual.`
  if (c.state === 'unknown') return `Could not check FoxLeague's manual ${when}: ${c.why ?? 'no reason was given'}.`
  return null
}

export interface ManualWatchDeps {
  /** Off with AGENT_MANUAL_CHECK=0 and for a service a test builds without it: it asks nobody. */
  enabled: boolean
  base: string
  /** The time zone of the morning summary: a day is a day there. */
  zone: string
  kv: { get(key: string): string | null; set(key: string, value: string): void }
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
  /** The notice, null when there is nothing to tell. */
  text: string | null
}

/** The service's side: the check at most once a day, kept in the database so a restart does not ask again. */
export class ManualWatch {
  readonly enabled: boolean
  private readonly d: ManualWatchDeps
  private running: Promise<ManualCheck> | null = null
  /** Set by a test: where the check reads FoxLeague and the agents' copy; the pause between two requests. */
  fetch: McpFetch | undefined = undefined
  readManual: () => string = () => readFileSync(MANUAL_FILE, 'utf8')
  readRecord: () => unknown = () => JSON.parse(readFileSync(RECORD_FILE, 'utf8')) as unknown
  gapMs = GAP_MS

  constructor(deps: ManualWatchDeps) {
    this.d = deps
    this.enabled = deps.enabled
  }

  private last(): (ManualCheck & { day: string }) | null {
    try {
      const v = JSON.parse(this.d.kv.get(KV) ?? 'null') as (ManualCheck & { day: string }) | null
      if (!v || typeof v.day !== 'string' || !['current', 'behind', 'unknown'].includes(v.state) || !Array.isArray(v.pages)) return null
      return v
    } catch {
      return null
    }
  }

  /** Today's check: the one already made today, the one running or a new one. Null when switched off. */
  today(now = Date.now()): Promise<ManualCheck | null> {
    if (!this.enabled) return Promise.resolve(null)
    if (this.running) return this.running
    const day = zoneDate(now, this.d.zone)
    const last = this.last()
    if (last?.day === day) return Promise.resolve(last)
    const run = async (): Promise<ManualCheck> => {
      // Marked before anything is asked: a check that a restart cuts short is not made again the same day.
      this.d.kv.set(KV, JSON.stringify({ state: 'unknown', pages: [], why: 'the check did not finish', synced: null, at: new Date().toISOString(), day }))
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
      const c = await checkManual({ base: this.d.base, manual, record, fetch: this.fetch, gapMs: this.gapMs })
      this.d.kv.set(KV, JSON.stringify({ ...c, day }))
      return c
    }
    this.running = run().finally(() => {
      this.running = null
    })
    return this.running
  }

  /** The morning summary's line: today's check; "could not check" when there is none for today. */
  line(now = Date.now()): string | null {
    if (!this.enabled) return null
    const last = this.last()
    if (!last || last.day !== zoneDate(now, this.d.zone)) return "Could not check FoxLeague's manual today."
    return manualLine(last)
  }

  /** For the dashboard: the last check and its notice. */
  view(now = Date.now()): ManualView {
    const last = this.enabled ? this.last() : null
    if (!last) return { enabled: this.enabled, state: null, pages: [], why: null, synced: null, at: null, day: null, text: null }
    const text = manualLine(last, last.day === zoneDate(now, this.d.zone) ? 'today' : `on ${last.day}`)
    return { enabled: true, state: last.state, pages: last.pages, why: last.why, synced: last.synced, at: last.at, day: last.day, text }
  }
}
