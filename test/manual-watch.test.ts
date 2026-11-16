// The daily check of FoxLeague's manual (the owner's yes of 2026-11-15). On 15 Nov the agents' manual was five days
// behind FoxLeague's, with a fusion change, and nobody was told: manual-status needs a FoxLeague checkout, which only
// the maintainer's computer has. The server now reads the manual pages FoxLeague's public MCP server serves, once a
// day, and compares each page the agents take in with the fingerprint sync-manual recorded for it. Each test (MW =
// manual watch) was seen failing before the code it holds was written.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Mnemonic } from '@multiversx/sdk-core'
import type { Config } from '../src/config.ts'
import { Sessions, hashPassword } from '../src/web/auth.ts'
import { MAX_ANSWER_BYTES, MAX_NAMED, MAX_PAGES, MAX_SLUG, ManualWatch, checkManual, manualLine, manualRecord, type ManualRecord, type McpFetch } from '../src/strategist/manual-watch.ts'
import { MAX_ANSWER_BYTES as HTTP_MAX_ANSWER_BYTES } from '../src/util/http.ts'
import { snapshot } from './fixtures.ts'

const REPO = new URL('..', import.meta.url).pathname
const raw = (f: string) => readFileSync(join(REPO, f), 'utf8')
const flat = (f: string) => raw(f).replace(/\s+/g, ' ')
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

// ---- a FoxLeague manual: the source in a git repository, and the pages its MCP server serves ----

/** The manual's source files (under docs/manual/src/content/docs), MDX as FoxLeague writes it. */
const SOURCE: Record<string, string> = {
  'index.mdx': `---\ntitle: Welcome to FoxLeague\n---\nimport { Card } from '@astrojs/starlight/components';\n\nOwn your squad.\n`,
  'connect-ai.mdx': `---\ntitle: Connect an AI client\ndescription: The read-only MCP server.\n---\nThe address is https://foxleague.ai/mcp.\n`,
  'getting-started/players.md': `---\ntitle: Get Your First Players\ndescription: 'Register and receive 18 players.'\n---\n\nYou get 18 players.\n`,
  'mechanics/fusion.mdx': `---\ntitle: "Fusion"\n---\nimport { Aside } from '@astrojs/starlight/components';\n\n{/* a note for the editors, not rendered */}\nBurn three players of the same rarity.\n\n\n\n<!-- not rendered either -->\n| Fee | 100 FOXSY |\n|---|---|\n`,
  'mechanics/shop.mdx': `---\ntitle: Shop\n---\nA Common pack costs 2,500 FOXSY.\n`,
  'mechanics/world-cup.mdx': `---\ntitle: World Cup\n---\nA preview.\n`,
  'mechanics/leagues-draft.mdx': `---\ntitle: Leagues\ndraft: true\n---\nNot on the site yet.\n`,
  'legal/fair-play.md': `---\ntitle: Fair Play Rules\n---\nOne wallet, one team.\n`,
  'legal/terms.md': `---\ntitle: Terms of Use\n---\nThe terms.\n`,
}
/** The manual's sidebar: what the site publishes and the MCP server serves, in its order. */
const SIDEBAR = ['index', 'getting-started/players', 'connect-ai', 'mechanics/fusion', 'mechanics/shop', 'mechanics/world-cup', 'mechanics/leagues-draft', 'legal/fair-play', 'legal/terms']
const astroConfig = (slugs: string[]) => `export default {\n  sidebar: [\n${slugs.map(s => `    { label: '${s}', slug: '${s}' },`).join('\n')}\n  ],\n}\n`

/** A FoxLeague checkout with that manual, committed. */
function foxleagueRepo(source = SOURCE, sidebar = SIDEBAR): string {
  const dir = mkdtempSync(join(tmpdir(), 'foxleague-'))
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' })
  git('init', '--quiet')
  for (const [path, text] of Object.entries({ 'docs/manual/astro.config.mjs': astroConfig(sidebar), ...Object.fromEntries(Object.entries(source).map(([p, t]) => [`docs/manual/src/content/docs/${p}`, t])) })) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  git('add', '.')
  git('commit', '--quiet', '-m', 'manual')
  return dir
}

/**
 * The pages FoxLeague's MCP server serves, as its own code builds them (FoxLeague's mcp/src/resources.ts on main at
 * 56e5b9855, copied here as the reference): the sidebar's pages, drafts left out, as Markdown without MDX imports
 * and comments, under a title heading and above the page's address.
 */
function servedPages(source: Record<string, string>, sidebar: string[]): { slug: string; title: string; text: string }[] {
  const pages: { slug: string; title: string; text: string }[] = []
  for (const slug of sidebar) {
    const raw = source[`${slug}.md`] ?? source[`${slug}.mdx`]
    if (raw === undefined) continue
    const m = raw.match(/^---\n([\s\S]*?)\n---\n?/)
    const meta: Record<string, string> = {}
    for (const line of (m?.[1] ?? '').split('\n')) {
      const kv = line.match(/^(\w+):\s*(.*)$/)
      if (kv) meta[kv[1]!] = kv[2]!.replace(/^['"]|['"]$/g, '')
    }
    if (/^true$/i.test(meta.draft ?? '')) continue
    const body = (m ? raw.slice(m[0].length) : raw)
      .replace(/^import\s.+$/gm, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    const title = meta.title || slug
    pages.push({ slug, title, text: `# ${title}\n\n${body}\n\nSource: https://docs.foxleague.ai/${slug === 'index' ? '' : slug + '/'}\n` })
  }
  return pages
}

interface Seen { url: string; method: string; headers: Record<string, string>; body: { jsonrpc: string; method: string; params: { name: string; arguments: Record<string, unknown> } } }

/** FoxLeague's MCP route (POST /mcp, JSON answers) for that manual, as a stand-in fetch that keeps every request. */
function foxleagueMcp(source = SOURCE, sidebar = SIDEBAR, o: { answer?: (call: Seen, n: number) => Response | Promise<Response | null> | null } = {}) {
  const pages = servedPages(source, sidebar)
  const seen: Seen[] = []
  const fetch: McpFetch = async (url, init) => {
    const call: Seen = { url, method: init.method, headers: { ...init.headers }, body: JSON.parse(init.body) as Seen['body'] }
    seen.push(call)
    const special = await o.answer?.(call, seen.length)
    if (special) return special
    const reply = (value: unknown, isError = false) => new Response(JSON.stringify({ result: { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], ...(isError ? { isError: true } : {}) }, jsonrpc: '2.0', id: 1 }), { status: 200, headers: { 'content-type': 'application/json' } })
    const { name, arguments: args } = call.body.params
    if (name === 'list_manual_pages') return reply(pages.map(p => ({ slug: p.slug, title: p.title, description: '', uri: `foxleague://manual/${p.slug}` })))
    if (name === 'get_manual_page') {
      const page = pages.find(p => p.slug === args.slug)
      return page ? reply({ slug: page.slug, title: page.title, description: '', uri: `foxleague://manual/${page.slug}`, text: page.text }) : reply(`There is no manual page "${String(args.slug)}".`, true)
    }
    return new Response('{}', { status: 404 })
  }
  return { fetch, seen, pages }
}

/** The agents' manual.md as sync-manual writes it: its header names the commit it was synced at. */
const MANUAL = '# FoxLeague player manual\nThe official player manual (docs.foxleague.ai), synced from the FoxLeague repository, main at 1a2b3c4d5 2026-11-10.\nRules and numbers as the platform runs them.\n\n# Fusion\n(docs.foxleague.ai/mechanics/fusion/)\n\nBurn three players of the same rarity.\n'

const BASE = 'https://foxleague.test'
const recorded = (): ManualRecord => manualRecord(foxleagueRepo(), 'HEAD', MANUAL)
const check = (record: unknown, fetch: McpFetch, more: Partial<Parameters<typeof checkManual>[0]> = {}) => checkManual({ base: BASE, manual: MANUAL, record, fetch, gapMs: 0, ...more })

// ---- the check ----

test('MW-1 the check says "behind" when FoxLeague serves a newer manual, and names the pages', async () => {
  const record = recorded()
  // What sync-manual records: each page the agents take in that FoxLeague serves. Not the pages left out on purpose
  // (the welcome page, connect-ai, the World Cup preview, the terms) and not a draft, which FoxLeague does not serve.
  assert.deepEqual(Object.keys(record.pages).sort(), ['getting-started/players', 'legal/fair-play', 'mechanics/fusion', 'mechanics/shop'])
  assert.equal(record.synced, '1a2b3c4d5 2026-11-10')
  assert.equal(record.manual, sha256(MANUAL))

  // FoxLeague changed the fusion page and added a mechanics page.
  const newer = { ...SOURCE, 'mechanics/fusion.mdx': SOURCE['mechanics/fusion.mdx']!.replace('Burn three players of the same rarity.', 'Burn three players of the same rarity. An injured player cannot be fused.'), 'mechanics/medicine.mdx': '---\ntitle: Medicine\n---\nHeals an injury.\n' }
  const live = foxleagueMcp(newer, [...SIDEBAR, 'mechanics/medicine'])
  const c = await check(record, live.fetch)
  assert.equal(c.state, 'behind')
  assert.deepEqual(c.pages, ['mechanics/fusion', 'mechanics/medicine (new)'])
  assert.equal(c.why, null)
  assert.equal(c.synced, '1a2b3c4d5 2026-11-10')
  assert.equal(manualLine(c), "FoxLeague's manual changed since the agents' copy (pages: mechanics/fusion, mechanics/medicine (new)). The maintainer runs sync-manual.")

  // A page FoxLeague no longer serves, and a new page nobody decided on (sync-manual stops on it) count too.
  const gone = foxleagueMcp({ ...SOURCE, 'season.mdx': '---\ntitle: Seasons\n---\nA season lasts a month.\n' }, [...SIDEBAR.filter(s => s !== 'mechanics/shop'), 'season'])
  const g = await check(record, gone.fetch)
  assert.equal(g.state, 'behind')
  assert.deepEqual(g.pages, ['season (new)', 'mechanics/shop (gone)'])
})

test('MW-2 the check says "current" when the two match, also when only a page left out on purpose changed', async () => {
  const record = recorded()
  const live = foxleagueMcp()
  const same = await check(record, live.fetch)
  assert.equal(same.state, 'current')
  assert.deepEqual(same.pages, [])
  assert.equal(same.why, null)
  assert.equal(same.synced, '1a2b3c4d5 2026-11-10')
  // "current" only from a comparison: the list and each of the four pages were read.
  assert.deepEqual(live.seen.map(s => s.body.params.arguments.slug ?? s.body.params.name), ['list_manual_pages', 'getting-started/players', 'mechanics/fusion', 'mechanics/shop', 'legal/fair-play'])
  assert.equal(manualLine(same), null, 'nothing to tell: the morning summary stays as it was')
  // Pages the agents leave out on purpose (connect-ai, the World Cup preview, the terms) and whitespace alone are no
  // change of the rules; a page whose title alone changed is not either.
  const other = {
    ...SOURCE,
    'connect-ai.mdx': SOURCE['connect-ai.mdx']!.replace('The address', 'The new address'),
    'mechanics/world-cup.mdx': '---\ntitle: World Cup\n---\nStill a preview, with dates.\n',
    'legal/terms.md': '---\ntitle: Terms of Use\n---\nNew terms.\n',
    'mechanics/shop.mdx': '---\ntitle: The Shop\n---\nA Common pack   costs 2,500 FOXSY.\n\n',
  }
  const c = await check(record, foxleagueMcp(other).fetch)
  assert.equal(c.state, 'current', JSON.stringify(c))
})

test('MW-3 a failed read says "could not check", never "current", and asks nothing more', async () => {
  const record = recorded()
  const rpc = (result: unknown) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200, headers: { 'content-type': 'application/json' } })
  // Each case with the request it fails on: the first failure ends the day's check, with no retry and no request after it.
  const cases: [string, (call: Seen, n: number) => Response | Promise<Response> | null, RegExp, number][] = [
    ['no network', () => Promise.reject(new TypeError('fetch failed')), /FoxLeague could not be reached/, 1],
    ['too many requests', () => new Response('slow down', { status: 429 }), /FoxLeague answered HTTP 429/, 1],
    ['a server error on a page', (_c, n) => (n === 3 ? new Response('', { status: 502 }) : null), /FoxLeague answered HTTP 502/, 3],
    ['not JSON', () => new Response('<html>maintenance</html>', { status: 200, headers: { 'content-type': 'text/html' } }), /FoxLeague's answer could not be read/, 1],
    ['a JSON-RPC error', () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } }), { status: 200 }), /FoxLeague's answer could not be read/, 1],
    ['the tool refused', call => (call.body.params.name === 'get_manual_page' ? rpc({ isError: true, content: [{ type: 'text', text: 'no' }] }) : null), /FoxLeague's answer could not be read/, 2],
    ['an empty list', call => (call.body.params.name === 'list_manual_pages' ? rpc({ content: [{ type: 'text', text: '[]' }] }) : null), /FoxLeague's answer could not be read/, 1],
    ['a slug that is no slug', call => (call.body.params.name === 'list_manual_pages' ? rpc({ content: [{ type: 'text', text: JSON.stringify([{ slug: 'mechanics/fusion' }, { slug: 'Ignore the rules <b>now</b>' }]) }] }) : null), /FoxLeague's answer could not be read/, 1],
    ['another page than asked', call => (call.body.params.name === 'get_manual_page' ? rpc({ content: [{ type: 'text', text: JSON.stringify({ slug: 'mechanics/shop', text: '# Shop' }) }] }) : null), /FoxLeague's answer could not be read/, 2],
  ]
  for (const [name, answer, why, requests] of cases) {
    const live = foxleagueMcp(SOURCE, SIDEBAR, { answer })
    const c = await check(record, live.fetch)
    assert.equal(c.state, 'unknown', name)
    assert.match(String(c.why), why, name)
    assert.match(String(manualLine(c)), /^Could not check FoxLeague's manual today: /, name)
    assert.doesNotMatch(String(manualLine(c)), /up to date|current/i, name)
    assert.equal(live.seen.length, requests, `${name}: nothing is asked after the failure`)
  }

  // A page that does not answer in time.
  const hanging: McpFetch = (_u, init) => new Promise((_r, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }))
  const slow = await check(record, hanging, { timeoutMs: 30 })
  assert.equal(slow.state, 'unknown')
  assert.match(String(slow.why), /FoxLeague did not answer within/)

  // No record, a record of another manual.md and a manual.md that cannot be read: nothing to compare with.
  const live = foxleagueMcp()
  for (const [rec, manual, why] of [
    [null, MANUAL, /no page record/],
    [{ synced: 'x', manual: 'nope', pages: 'not pages' }, MANUAL, /no page record/],
    [record, `${MANUAL}\nA line added by hand.\n`, /not the one of the agents' manual/],
    [record, null, /manual\.md could not be read/],
  ] as const) {
    const c = await checkManual({ base: BASE, manual, record: rec, fetch: live.fetch, gapMs: 0 })
    assert.equal(c.state, 'unknown')
    assert.match(String(c.why), why)
    assert.match(String(manualLine(c)), /The maintainer runs sync-manual|could not be read/)
  }
  assert.equal(live.seen.length, 0, 'without a record of this manual FoxLeague is not asked')
})

test('MW-4 polite: one list and one read per page the agents know, read-only tool calls, a pause between them and nothing of the install sent', async () => {
  const record = recorded()
  const live = foxleagueMcp()
  const pauses: number[] = []
  const c = await checkManual({ base: BASE, manual: MANUAL, record, fetch: live.fetch, gapMs: 600, sleep: async ms => void pauses.push(ms) })
  assert.equal(c.state, 'current')
  assert.equal(live.seen.length, 1 + Object.keys(record.pages).length, 'the list and the four pages the agents take in')
  assert.deepEqual(live.seen.map(s => s.body.params.name), ['list_manual_pages', 'get_manual_page', 'get_manual_page', 'get_manual_page', 'get_manual_page'])
  assert.deepEqual(pauses, [600, 600, 600, 600], 'a pause before every request after the first: FoxLeague allows 2 a second on /mcp')
  for (const s of live.seen) {
    assert.equal(s.url, `${BASE}/mcp`)
    assert.equal(s.method, 'POST', 'the MCP route takes POST only; tools/call of the two read-only manual tools')
    assert.equal(s.body.method, 'tools/call')
    assert.deepEqual(Object.keys(s.headers).sort(), ['accept', 'content-type', 'user-agent'])
    assert.equal(s.headers['user-agent'], 'foxleague-agent')
    assert.doesNotMatch(JSON.stringify(s), /erd1|cookie|authorization|token/i)
  }
})

// ---- once a day, in the morning summary and in the dashboard ----

function memoryKv() {
  const m = new Map<string, string>()
  return { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => void m.set(k, v), m }
}

test('MW-5 through the day: within the hour a second call, a call meanwhile and a restart ask nothing more; a current copy is checked again each hour, a behind one stays so for the day and a failed check is tried again up to 4 times a day', async () => {
  // Until the audit of 2026-11-16 the check was made once a day whatever it found (MNT-5, MNT-6): this test pinned
  // that. It now holds the check through the day.
  const record = recorded()
  const kv = memoryKv()
  const live = foxleagueMcp()
  const watch = (fetch: McpFetch, store = kv) => Object.assign(new ManualWatch({ enabled: true, base: BASE, zone: 'UTC', kv: store }), { fetch, readManual: () => MANUAL, readRecord: () => record, gapMs: 0 })
  const morning = Date.parse('2026-11-16T07:00:00Z')
  const w = watch(live.fetch)
  const [a, b] = await Promise.all([w.today(morning), w.today(morning)])
  assert.equal(a?.state, 'current')
  assert.deepEqual(a, b)
  const set = live.seen.length
  assert.equal(set, 5)
  await w.today(morning + 30 * 60_000)
  await watch(live.fetch).today(morning + 50 * 60_000)
  assert.equal(live.seen.length, set, 'within the hour: no second request set, also after a restart')
  await w.today(morning + 6 * 3600_000)
  assert.equal(live.seen.length, 2 * set, 'a copy found current is checked again at a later hourly look')
  await w.today(Date.parse('2026-11-17T07:00:00Z'))
  assert.equal(live.seen.length, 3 * set, 'the next day: one more')

  // A copy found behind stays so for the day: nothing more is asked until the next day.
  const fusion = { ...SOURCE, 'mechanics/fusion.mdx': SOURCE['mechanics/fusion.mdx']!.replace('same rarity', 'same rarity, none of them injured') }
  const newer = foxleagueMcp(fusion)
  const n = watch(newer.fetch, memoryKv())
  assert.equal((await n.today(morning))?.state, 'behind')
  for (let h = 1; h <= 12; h++) assert.equal((await n.today(morning + h * 3600_000))?.state, 'behind')
  assert.equal(newer.seen.length, set)

  // A failed check is tried again at the hourly looks, at most 4 tries a day, and the next day again.
  const down = foxleagueMcp(SOURCE, SIDEBAR, { answer: () => new Response('', { status: 503 }) })
  const d = watch(down.fetch)
  const day3 = Date.parse('2026-11-18T07:00:00Z')
  assert.equal((await d.today(day3))?.state, 'unknown')
  assert.equal((await d.today(day3 + 30 * 60_000))?.state, 'unknown')
  assert.equal(down.seen.length, 1, 'not within the hour')
  for (let h = 1; h <= 8; h++) assert.equal((await d.today(day3 + h * 3600_000))?.state, 'unknown')
  assert.equal(down.seen.length, 4, 'at most 4 tries a day')
  await d.today(Date.parse('2026-11-19T07:00:00Z'))
  assert.equal(down.seen.length, 5, 'the next day: tried again')
  // Switched off (AGENT_MANUAL_CHECK=0): it asks nobody and says nothing.
  const off = Object.assign(new ManualWatch({ enabled: false, base: BASE, zone: 'UTC', kv: memoryKv() }), { fetch: live.fetch })
  assert.equal(await off.today(day3), null)
  assert.equal(off.line(day3), null)
  assert.equal(live.seen.length, 3 * set)
})

function testConfig(dir: string, more: Partial<Config> = {}): Config {
  return {
    mnemonic: Mnemonic.generate().toString(), dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: BASE,
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: true, defaultDryRun: true, maxAgents: 5, ...more,
  } as Config
}

/** A service whose daily check reads this test's FoxLeague and agents' copy, with a Telegram that keeps what it is sent. */
async function service(fetch: McpFetch, record: unknown = recorded()) {
  const { Service } = await import('../src/service.ts')
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-')), { manualCheck: true }))
  svc.ensureAgents()
  svc.snapshots.set(0, snapshot())
  const watch = (svc as unknown as { manualWatch?: ManualWatch }).manualWatch
  assert.ok(watch, 'the service has a daily check of the manual')
  Object.assign(watch, { fetch, readManual: () => MANUAL, readRecord: () => record, gapMs: 0 })
  const sent: string[] = []
  ;(svc as unknown as { telegram: unknown }).telegram = { send: (t: string) => void sent.push(t), stop: () => undefined }
  const morning = () => (svc as unknown as { sendDailySummary: () => Promise<void> }).sendDailySummary()
  return { svc, sent, morning, watch }
}

test('MW-6 the morning summary carries the line: changed pages, could not check, and nothing when the copy is current', async () => {
  const fusion = { ...SOURCE, 'mechanics/fusion.mdx': SOURCE['mechanics/fusion.mdx']!.replace('same rarity', 'same rarity, none of them injured') }
  const behind = await service(foxleagueMcp(fusion).fetch)
  await behind.morning()
  assert.equal(behind.sent.length, 1)
  assert.match(behind.sent[0]!, /^Daily summary, /)
  assert.match(behind.sent[0]!, /\nFoxLeague's manual changed since the agents' copy \(pages: mechanics\/fusion\)\. The maintainer runs sync-manual\.\n/)
  // /summary on Telegram says the same, from the same check (no second request set).
  assert.match(await behind.svc.command('summary', ['today'], 'today'), /FoxLeague's manual changed since the agents' copy \(pages: mechanics\/fusion\)/)

  const down = await service(foxleagueMcp(SOURCE, SIDEBAR, { answer: () => Promise.reject(new TypeError('fetch failed')) }).fetch)
  await down.morning()
  assert.match(down.sent[0]!, /\nCould not check FoxLeague's manual today: FoxLeague could not be reached\.\n/)
  assert.doesNotMatch(down.sent[0]!, /manual[^\n]*(up to date|current)/i)

  const current = await service(foxleagueMcp().fetch)
  await current.morning()
  assert.match(current.sent[0]!, /^Daily summary, /)
  assert.doesNotMatch(current.sent[0]!, /FoxLeague's manual/, 'quiet when the agents know what FoxLeague serves')
})

test('MW-7 the dashboard shows the notice with its info bubble', async () => {
  const html = raw('src/web/dashboard.html')
  assert.match(html, /<div class="banner up" id="manualBanner" hidden><span id="manualText"><\/span><i class="info" data-tip="manual">i<\/i><\/div>/)
  const tips = html.slice(html.indexOf('\nconst TIPS = {'), html.indexOf('\n}\n', html.indexOf('\nconst TIPS = {')))
  const bubble = tips.slice(tips.indexOf("\n  manual: ['FoxLeague manual check',"), tips.indexOf('`],', tips.indexOf("\n  manual: ['FoxLeague manual check',")))
  assert.ok(bubble.length > 100, 'the bubble is in TIPS')
  // Every hour since the audit of 2026-11-16 (MNT-5): the check runs through the day.
  assert.match(bubble.replace(/\s+/g, ' '), /every hour/i)
  assert.match(bubble.replace(/\s+/g, ' '), /sync-manual/)
  assert.doesNotMatch(bubble, /—|, and |, or |\bbots?\b/i)

  // The page's own renderManual, run on stand-in elements.
  const fn = html.slice(html.indexOf('function renderManual() {'), html.indexOf('function renderHeader() {'))
  assert.ok(fn.startsWith('function renderManual()'), 'renderManual is in the page')
  const show = (manual: unknown) => {
    const els: Record<string, { hidden: boolean; textContent: string }> = {}
    const $ = (id: string) => (els[id] ??= { hidden: true, textContent: '' })
    new Function('S', '$', `${fn}\nrenderManual()`)({ instance: { manual } }, $)
    return { shown: !$('manualBanner').hidden, text: $('manualText').textContent }
  }
  const line = "FoxLeague's manual changed since the agents' copy (pages: mechanics/fusion). The maintainer runs sync-manual."
  assert.deepEqual(show({ enabled: true, state: 'behind', text: line }), { shown: true, text: line })
  assert.deepEqual(show({ enabled: true, state: 'unknown', text: "Could not check FoxLeague's manual today: FoxLeague answered HTTP 503." }), { shown: true, text: "Could not check FoxLeague's manual today: FoxLeague answered HTTP 503." })
  assert.equal(show({ enabled: true, state: 'current', text: null }).shown, false)
  assert.equal(show({ enabled: false, state: null, text: null }).shown, false)
  assert.equal(show(undefined).shown, false, 'an agent of the version before gives none')
  assert.match(html.slice(html.indexOf('function renderHeader() {'), html.indexOf('function renderHeader() {') + 200), /renderManual\(\)/, 'the header draws it')

  // What the agent gives the page: the last check's line.
  const { svc } = await service(foxleagueMcp({ ...SOURCE, 'mechanics/shop.mdx': '---\ntitle: Shop\n---\nA Common pack costs 3,000 FOXSY.\n' }).fetch)
  await svc.manualWatch.today()
  const { startWeb } = await import('../src/web/server.ts')
  const creds = { username: 'admin', passwordHash: hashPassword('correct-horse-battery'), secretKey: 'k'.repeat(64) }
  const server = startWeb(svc, creds, 0)
  if (!server.listening) await once(server, 'listening')
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const cookie = new Sessions(creds.secretKey, creds.passwordHash).issue('admin')
    const state = (await (await fetch(`${url}/api/state`, { headers: { cookie: `foxagent_session=${cookie}` } })).json()) as { instance: { manual: { enabled: boolean; state: string; text: string; pages: string[] } } }
    assert.equal(state.instance.manual.enabled, true)
    assert.equal(state.instance.manual.state, 'behind')
    assert.deepEqual(state.instance.manual.pages, ['mechanics/shop'])
    assert.equal(state.instance.manual.text, "FoxLeague's manual changed since the agents' copy (pages: mechanics/shop). The maintainer runs sync-manual.")
  } finally {
    server.close()
  }
})

// ---- the maintainer's side: sync-manual records, manual-check asks without a checkout ----

test('MW-8 sync-manual writes the page record next to manual.md, and the committed record belongs to the committed manual.md', () => {
  const cli = raw('src/cli.ts')
  const sync = cli.slice(cli.indexOf("case 'sync-manual': {"), cli.indexOf("case 'snapshot':"))
  // Since the audit of 2026-11-16 (P-W8) the record also names the keys of FoxLeague's game settings, read first.
  assert.match(sync, /writeFileSync\(out, text\)\n\s+writeFileSync\(RECORD_FILE, `\$\{JSON\.stringify\(manualRecord\(repo, MANUAL_BRANCH, text, settings\), null, 2\)\}\\n`\)/)
  const manual = raw('src/strategist/manual.md')
  const record = JSON.parse(raw('src/strategist/manual-pages.json')) as ManualRecord
  assert.equal(record.manual, sha256(manual), 'the record is of this manual.md: after a sync-manual without it, run sync-manual again')
  assert.equal(record.synced, / at ([0-9a-f]{7,} \d{4}-\d{2}-\d{2})\./.exec(manual.split('\n', 3).join('\n'))?.[1])
  assert.ok(Object.keys(record.pages).length >= 10, 'every mechanics page and the players and fair play pages')
  for (const slug of ['mechanics/fusion', 'mechanics/economy-map', 'getting-started/players', 'legal/fair-play']) assert.match(String(record.pages[slug]), /^[0-9a-f]{64}$/, slug)
  for (const slug of ['mechanics/world-cup', 'connect-ai', 'index']) assert.equal(record.pages[slug], undefined, `${slug} is left out on purpose`)
})

test('MW-9 manual-check runs the same check from the command line, without a FoxLeague checkout', async () => {
  let mode: 'down' | 'new' = 'down'
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => {
      if (req.method !== 'POST' || req.url !== '/mcp') return void res.writeHead(404).end()
      if (mode === 'down') return void res.writeHead(503).end()
      const call = JSON.parse(body) as Seen['body']
      const text = call.params.name === 'list_manual_pages' ? JSON.stringify([{ slug: 'mechanics/leagues' }]) : '{}'
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }] } }))
    })
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-'))
  const run = () => new Promise<{ code: number | null; out: string }>(resolve => {
    const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(REPO, 'src/cli.ts'), 'manual-check'], {
      cwd: dir, env: { PATH: process.env.PATH ?? '', HOME: dir, AGENT_ENV_FILE: join(dir, 'none.env'), AGENT_DATA_DIR: dir, FOXLEAGUE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}` },
    })
    let out = ''
    p.stdout.on('data', c => (out += c))
    p.stderr.on('data', c => (out += c))
    p.on('close', code => resolve({ code, out }))
  })
  try {
    const down = await run()
    assert.equal(down.out.trim(), "Could not check FoxLeague's manual today: FoxLeague answered HTTP 503.")
    assert.equal(down.code, 1)
    mode = 'new'
    const changed = await run()
    assert.match(changed.out, /^FoxLeague's manual changed since the agents' copy \(pages: mechanics\/leagues \(new\), [^\n]*mechanics\/fusion \(gone\)[^\n]*\)\. The maintainer runs sync-manual\.\n$/)
    assert.equal(changed.code, 2)
  } finally {
    server.close()
  }
  assert.match(raw('src/cli.ts'), /\n {2}manual-check {18}/, 'the command is in the usage')
})

test('MW-10 the guides and the record say what the line means and what the maintainer does', () => {
  for (const f of ['docs/SERVER.md', 'site/src/content/docs/help/update.md', 'site/src/content/docs/help/troubleshooting.md']) {
    const t = flat(f)
    assert.match(t, /FoxLeague's manual changed since the agents' copy/, f)
    assert.match(t, /Could not check FoxLeague's manual today/, f)
    assert.match(t, /sync-manual/, f)
  }
  assert.match(flat('docs/SERVER.md'), /`AGENT_MANUAL_CHECK=0`/)
  assert.match(raw('.env.example'), /^# AGENT_MANUAL_CHECK=1$/m)
  assert.match(raw('src/config.ts'), /manualCheck: flag\('AGENT_MANUAL_CHECK', true\)/)
  assert.match(flat('site/src/content/docs/play/safety.md'), /every hour/i)

  const review = raw('docs/SECURITY-REVIEW.md')
  const start = review.indexOf("\n## Daily check of FoxLeague's manual (2026-11-15)\n")
  assert.ok(start > review.indexOf('\n## GitHub review of PR #71 (2026-11-15)\n'), 'after the review of PR #71')
  const next = review.indexOf('\n## ', start + 1)
  assert.ok(next > start && next <= review.indexOf('\n## One manager message at a time (2026-11-13)\n'), 'before the last section')
  const section = review.slice(start, next)
  assert.match(section, /\| Id \| Severity \| Finding \| Fix \|\n\|---\|---\|---\|---\|\n\| MW-1 \| /)
  for (const line of section.split('\n').filter(l => l.startsWith('| MW-'))) assert.equal(line.split(' | ').length, 4, line.slice(0, 40))
  assert.ok(section.includes('\nStays open:\n'))
  for (const f of ['docs/SERVER.md', 'site/src/content/docs/help/update.md', 'site/src/content/docs/help/troubleshooting.md']) {
    const t = flat(f)
    const at = t.indexOf("FoxLeague's manual changed since")
    assert.doesNotMatch(t.slice(Math.max(0, at - 400), at + 900), /—|\bbots?\b/i, f)
  }
  assert.doesNotMatch(section, /—|\bbots?\b/i)
})

// ---- the GitHub review of PR #72 (Claude Fable 5.2 at high effort): each test failed first, or was seen biting ----

const MB = 1024 * 1024

/** An answer of `total` bytes of spaces that counts what was pulled from it and whether it was cancelled. */
function counted(total: number, headers: Record<string, string> = {}) {
  const s = { pulled: 0, cancelled: false }
  const response = () => new Response(new ReadableStream<Uint8Array>({
    pull(ctl) {
      if (s.pulled >= total) return ctl.close()
      s.pulled += MB
      ctl.enqueue(new Uint8Array(MB).fill(0x20))
    },
    cancel() {
      s.cancelled = true
    },
  }), { status: 200, headers: { 'content-type': 'application/json', ...headers } })
  return Object.assign(s, { response })
}

test('R72A-1 a very large answer is cut off while it streams, never buffered whole by the process that signs', async () => {
  const record = recorded()
  // 64 MB that never ends in JSON: the old read took in all of it, then compared its length.
  const big = counted(64 * MB)
  const live = foxleagueMcp(SOURCE, SIDEBAR, { answer: () => big.response() })
  const c = await check(record, live.fetch)
  assert.equal(c.state, 'unknown')
  assert.equal(c.why, "FoxLeague's answer could not be read")
  assert.equal(live.seen.length, 1, 'nothing is asked after it')
  assert.ok(big.pulled <= 4 * MB, `the read took in ${big.pulled / MB} MB of one answer; the longest page is about 60 KB`)
  assert.ok(big.cancelled, 'the stream is cancelled, not read to the end')

  // One that declares more than the cap in its content-length is refused before a byte of it is read.
  const declared = counted(64 * MB, { 'content-length': String(64 * MB) })
  const d = await check(record, foxleagueMcp(SOURCE, SIDEBAR, { answer: () => declared.response() }).fetch)
  assert.equal(d.state, 'unknown')
  assert.equal(d.why, "FoxLeague's answer could not be read")
  assert.ok(declared.pulled <= MB, `${declared.pulled / MB} MB pulled: only what the stream queued on its own`)
  assert.ok(declared.cancelled)
})

test('R72A-2 a new copy of the manual brought the same day is checked again, and the old copy\'s line is not shown', async () => {
  const fusion = { ...SOURCE, 'mechanics/fusion.mdx': SOURCE['mechanics/fusion.mdx']!.replace('same rarity', 'same rarity, none of them injured') }
  const live = foxleagueMcp(fusion)
  const kv = memoryKv()
  const watch = (manual: string, record: unknown) => Object.assign(new ManualWatch({ enabled: true, base: BASE, zone: 'UTC', kv }), { fetch: live.fetch, readManual: () => manual, readRecord: () => record, gapMs: 0 })
  // The installed copy (A) and the one the maintainer syncs and releases the same day (B), built from FoxLeague's newer manual.
  const recordA = recorded()
  const manualB = MANUAL.replace('1a2b3c4d5 2026-11-10', '9f8e7d6c5 2026-11-16')
  const recordB = manualRecord(foxleagueRepo(fusion), 'HEAD', manualB)
  const morning = Date.parse('2026-11-16T09:00:00Z')

  const a = watch(MANUAL, recordA)
  assert.equal((await a.today(morning))?.state, 'behind')
  const set = live.seen.length
  assert.equal(set, 5)
  assert.match(String(a.view(morning).text), /^FoxLeague's manual changed since the agents' copy \(pages: mechanics\/fusion\)/)
  assert.match(String(a.line(morning)), /^FoxLeague's manual changed since the agents' copy/)

  // 14:00: an update brings copy B and the service restarts on it, with the same database.
  const afternoon = morning + 5 * 3600_000
  const b = watch(manualB, recordB)
  // Before its own check, the line about copy A is not shown: the dashboard has nothing, the summary says it could not check.
  assert.equal(b.view(afternoon).text, null, 'the dashboard does not show the old copy\'s line')
  assert.equal(b.view(afternoon).state, null)
  assert.equal(b.line(afternoon), "Could not check FoxLeague's manual today.")
  const c = await b.today(afternoon)
  assert.equal(c?.state, 'current', JSON.stringify(c))
  assert.equal(live.seen.length, 2 * set, 'one more request set, for the new copy')
  assert.equal(b.view(afternoon).text, null)
  assert.equal(b.view(afternoon).state, 'current')
  assert.equal(b.line(afternoon), null, 'the summary is quiet: the new copy matches')
  // Still once within the hour per copy: another call and a restart on copy B ask nothing more (since the audit of
  // 2026-11-16 a copy found current is checked again an hour later, MNT-5).
  await b.today(afternoon + 20 * 60_000)
  await watch(manualB, recordB).today(afternoon + 40 * 60_000)
  assert.equal(live.seen.length, 2 * set)
  await b.today(afternoon + 2 * 3600_000)
  assert.equal(live.seen.length, 3 * set, 'an hour on, the current copy is checked again')

  // The next day a copy with a record of another manual.md is installed ("could not check" without asking), then the
  // fixed record: the same manual.md, so the record is part of what is compared too.
  const day2 = Date.parse('2026-11-17T09:00:00Z')
  const wrong = watch(manualB, recordA)
  assert.match(String((await wrong.today(day2))?.why), /not the one of the agents' manual/)
  assert.equal(live.seen.length, 3 * set, 'FoxLeague is not asked without a record of this manual.md')
  const fixed = watch(manualB, recordB)
  assert.equal(fixed.view(day2).text, null, 'the line about the wrong record is not shown')
  assert.equal((await fixed.today(day2 + 3600_000))?.state, 'current')
  assert.equal(live.seen.length, 4 * set)
})

test('R72A-3 while the day\'s check runs, the dashboard shows the check before it, never its restart marker', async () => {
  const fusion = { ...SOURCE, 'mechanics/fusion.mdx': SOURCE['mechanics/fusion.mdx']!.replace('same rarity', 'same rarity, none of them injured') }
  // FoxLeague holds its answer to the first request of the second day until the test lets it go.
  let release = () => {}
  const held = new Promise<void>(r => (release = r))
  const live = foxleagueMcp(fusion, SIDEBAR, { answer: async (_c, n) => (n === 6 ? (await held, null) : null) })
  const kv = memoryKv()
  const record = recorded()
  const watch = () => Object.assign(new ManualWatch({ enabled: true, base: BASE, zone: 'UTC', kv }), { fetch: live.fetch, readManual: () => MANUAL, readRecord: () => record, gapMs: 0 })
  const changed = "FoxLeague's manual changed since the agents' copy (pages: mechanics/fusion). The maintainer runs sync-manual."
  const w = watch()
  assert.equal((await w.today(Date.parse('2026-11-16T09:00:00Z')))?.state, 'behind')
  assert.equal(live.seen.length, 5)

  // The next morning's check starts and waits for FoxLeague (a healthy one takes 10 to 90 seconds).
  const day2 = Date.parse('2026-11-17T09:00:00Z')
  const running = w.today(day2)
  await new Promise(r => setImmediate(r))
  assert.equal(live.seen.length, 6, 'the check is under way')
  const meanwhile = w.view(day2 + 5_000)
  assert.doesNotMatch(String(meanwhile.text), /Could not check|did not finish/, 'no failed check is shown while it runs')
  assert.equal(meanwhile.text, changed, 'the check before it')
  assert.equal(meanwhile.state, 'behind')
  assert.equal(meanwhile.day, '2026-11-16')
  assert.doesNotMatch(String(w.line(day2 + 5_000)), /did not finish/)

  // The marker keeps its meaning where no check runs: a service that restarted while the check was under way.
  const restarted = watch()
  assert.equal(restarted.view(day2 + 5_000).text, "Could not check FoxLeague's manual today: the check did not finish.")
  assert.equal(restarted.line(day2 + 5_000), "Could not check FoxLeague's manual today: the check did not finish.")

  release()
  assert.equal((await running)?.state, 'behind')
  assert.equal(w.view(day2 + 60_000).day, '2026-11-17')
  assert.equal(w.view(day2 + 60_000).text, changed)

  // The very first check: nothing to show while it runs.
  let releaseFirst = () => {}
  const heldFirst = new Promise<void>(r => (releaseFirst = r))
  const first = foxleagueMcp(SOURCE, SIDEBAR, { answer: async () => (await heldFirst, null) })
  const fresh = Object.assign(new ManualWatch({ enabled: true, base: BASE, zone: 'UTC', kv: memoryKv() }), { fetch: first.fetch, readManual: () => MANUAL, readRecord: () => record, gapMs: 0 })
  const going = fresh.today(day2)
  await new Promise(r => setImmediate(r))
  assert.deepEqual([fresh.view(day2).state, fresh.view(day2).text], [null, null])
  releaseFirst()
  assert.equal((await going)?.state, 'current')
})

test('R72A-4 without Telegram the service runs the day\'s check from the summary hour on, looks every hour and stops looking at stop', async t => {
  /** A service without Telegram (summary at 09:00 UTC) whose watch notes when it is asked for the day's check. */
  const build = async (enabled = true) => {
    const { svc, watch } = await service(foxleagueMcp().fetch)
    const inner = svc as unknown as { telegram: unknown; armManualCheck: () => void }
    inner.telegram = undefined
    Object.assign(svc, { summaryZone: 'UTC', summaryHour: 9 })
    const asked: string[] = []
    Object.assign(watch, { enabled, today: () => (asked.push(new Date().toISOString().slice(0, 16)), Promise.resolve(null)) })
    return { svc, arm: () => inner.armManualCheck(), asked }
  }
  const early = await build()
  const late = await build()
  const off = await build(false)
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-11-16T05:00:00Z') })
  const hours = (n: number) => {
    for (let i = 0; i < n; i++) t.mock.timers.tick(3600_000)
  }

  // A start at 05:00: the first look three minutes later, then every hour; nothing is asked before 09:00.
  early.arm()
  off.arm()
  t.mock.timers.tick(180_000)
  hours(3)
  assert.deepEqual(early.asked, [], 'before the summary hour nothing is asked')
  hours(1)
  assert.deepEqual(early.asked, ['2026-11-16T09:03'])
  hours(2)
  assert.deepEqual(early.asked, ['2026-11-16T09:03', '2026-11-16T10:03', '2026-11-16T11:03'], 'looked at every hour; the watch itself keeps it to once a day')

  // A start after the summary hour asks at its first look.
  late.arm()
  t.mock.timers.tick(180_000)
  assert.deepEqual(late.asked, ['2026-11-16T11:06'])

  // At stop the timer is cleared: nothing more is asked, the next day either.
  await early.svc.stop()
  await late.svc.stop()
  hours(30)
  assert.equal(early.asked.length, 3, 'nothing after the stop')
  assert.equal(late.asked.length, 1, 'nothing after the stop')
  // Switched off (AGENT_MANUAL_CHECK=0): never asked.
  assert.deepEqual(off.asked, [])
})

test('R72A-5 an answer sent as an event stream is read, and the caps on an answer\'s size and the page count refuse past them', async () => {
  const record = recorded()
  // FoxLeague's MCP server may answer a tool call as server-sent events: the JSON-RPC answer is on the last data line,
  // after a notification or none.
  const asEvents = (before: string) => {
    const plain = foxleagueMcp()
    const fetch: McpFetch = async (url, init) => {
      const body = await (await plain.fetch(url, init)).text()
      return new Response(`${before}event: message\nid: 1\ndata: ${body}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } })
    }
    return { fetch, seen: plain.seen }
  }
  for (const before of ['', 'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}\n\n']) {
    const live = asEvents(before)
    const c = await check(record, live.fetch)
    assert.equal(c.state, 'current', `${JSON.stringify(c)} (${before ? 'after a notification' : 'alone'})`)
    assert.equal(live.seen.length, 5)
  }
  const noData: McpFetch = async () => new Response('event: message\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })
  const empty = await check(record, noData)
  assert.equal(empty.state, 'unknown')
  assert.equal(empty.why, "FoxLeague's answer could not be read")

  // The size cap: an answer of MAX_ANSWER_BYTES is read, one byte more is refused. Below http.ts's own cap.
  assert.ok(MAX_ANSWER_BYTES >= MB && MAX_ANSWER_BYTES <= HTTP_MAX_ANSWER_BYTES, String(MAX_ANSWER_BYTES))
  const padded = (extra: number) => {
    const plain = foxleagueMcp()
    const fetch: McpFetch = async (url, init) => {
      const res = await plain.fetch(url, init)
      if ((JSON.parse(init.body) as Seen['body']).params.name !== 'list_manual_pages') return res
      const body = await res.text()
      return new Response(body + ' '.repeat(MAX_ANSWER_BYTES - Buffer.byteLength(body) + extra), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return { fetch, seen: plain.seen }
  }
  const atCap = padded(0)
  assert.equal((await check(record, atCap.fetch)).state, 'current')
  assert.equal(atCap.seen.length, 5)
  const overCap = padded(1)
  const over = await check(record, overCap.fetch)
  assert.equal(over.state, 'unknown')
  assert.equal(over.why, "FoxLeague's answer could not be read")
  assert.equal(overCap.seen.length, 1, 'nothing is asked after it')

  // The page count: a list of MAX_PAGES pages is compared, one more is refused unread.
  assert.equal(MAX_PAGES, 200)
  const listOf = (n: number) => {
    const slugs = [...Object.keys(record.pages), ...Array.from({ length: n - Object.keys(record.pages).length }, (_, i) => `extra/page-${i}`)]
    const rpc = new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(slugs.map(slug => ({ slug }))) }] } }), { status: 200, headers: { 'content-type': 'application/json' } })
    return foxleagueMcp(SOURCE, SIDEBAR, { answer: call => (call.body.params.name === 'list_manual_pages' ? rpc : null) })
  }
  const full = listOf(MAX_PAGES)
  const f = await check(record, full.fetch)
  assert.equal(f.state, 'behind')
  assert.equal(f.pages.length, MAX_PAGES - Object.keys(record.pages).length, 'every page past the four recorded is new')
  assert.equal(full.seen.length, 5)
  const tooMany = listOf(MAX_PAGES + 1)
  const t = await check(record, tooMany.fetch)
  assert.equal(t.state, 'unknown')
  assert.equal(t.why, "FoxLeague's answer could not be read")
  assert.equal(tooMany.seen.length, 1, 'no page is read from a list that long')
})

test('R72A-1 to R72A-5 the record has their rows in the section of the daily check, and the guides say a new copy is checked the same day', () => {
  const review = raw('docs/SECURITY-REVIEW.md')
  const start = review.indexOf("\n## Daily check of FoxLeague's manual (2026-11-15)\n")
  const section = review.slice(start, review.indexOf('\n## ', start + 1))
  const part = section.slice(section.indexOf('\nGitHub review of PR #72 (2026-11-15).'))
  assert.ok(part.length > 1 && part.length < section.length, 'a part of its own at the end of the section')
  assert.match(part, /\| Id \| Severity \| Finding \| Fix \|\n\|---\|---\|---\|---\|\n\| R72A-1 \| medium \(agent review of PR #72; [^|]+\) \| /)
  for (const [id, severity] of [['R72A-1', 'medium'], ['R72A-2', 'medium'], ['R72A-3', 'low'], ['R72A-4', 'low'], ['R72A-5', 'low']] as const) {
    const row = part.split('\n').find(l => l.startsWith(`| ${id} | ${severity} (agent review of PR #72; `))
    assert.ok(row, id)
    assert.equal(row.split(' | ').length, 4, id)
    assert.ok(row.endsWith(' |'), id)
  }
  assert.ok(part.includes('\nStays open after the review:\n'))
  assert.doesNotMatch(part, /—|, and |, or |\bbots?\b/i)

  for (const f of ['docs/SERVER.md', 'site/src/content/docs/help/update.md', 'site/src/content/docs/help/troubleshooting.md']) {
    assert.match(flat(f), /new copy[^.]*the same day/i, f)
  }
  const html = raw('src/web/dashboard.html')
  const bubble = html.slice(html.indexOf("\n  manual: ['FoxLeague manual check',"), html.indexOf('`],', html.indexOf("\n  manual: ['FoxLeague manual check',")))
  assert.match(bubble.replace(/\s+/g, ' '), /new copy[^.]*the same day/i)
})

// ---- the GitHub re-review of PR #72: R72A-6, how much of FoxLeague's text the owner is sent ----

/** The longest slug taken (the longest real one is 29 characters) and the most pages the owner's line names. */
const SLUG_CAP = 120
const NAMED = 8
const UNREADABLE = "FoxLeague's answer could not be read"

/** FoxLeague's MCP route with its list of pages answered by `list` (one entry per slug); every other call as usual. */
function listing(slugs: string[], entry: (slug: string, i: number) => Record<string, unknown> = slug => ({ slug })) {
  const rpc = () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(slugs.map(entry)) }] } }), { status: 200, headers: { 'content-type': 'application/json' } })
  return foxleagueMcp(SOURCE, SIDEBAR, { answer: call => (call.body.params.name === 'list_manual_pages' ? rpc() : null) })
}

/** The day's check by a watch with a database of its own: what the summary line, the dashboard and the stored row hold. */
async function shownBy(fetch: McpFetch, record: unknown = recorded()) {
  const kv = memoryKv()
  const w = Object.assign(new ManualWatch({ enabled: true, base: BASE, zone: 'UTC', kv }), { fetch, readManual: () => MANUAL, readRecord: () => record, gapMs: 0 })
  const now = Date.parse('2026-11-16T09:00:00Z')
  const c = await w.today(now)
  return { c, line: w.line(now), view: w.view(now), state: JSON.stringify(w.view(now)), row: kv.m.get('manual_check') ?? '' }
}

test('R72A-6 a slug longer than 120 characters makes the list unreadable, and a record with one is no record', async () => {
  const record = recorded()
  const known = Object.keys(record.pages)
  const long = (n: number, tail = '') => `extra/${'a'.repeat(n - 6 - tail.length)}${tail}`
  assert.equal(MAX_SLUG, SLUG_CAP)
  assert.equal(long(SLUG_CAP).length, SLUG_CAP)

  // At the cap a slug is taken: a new page, named.
  const at = await check(record, listing([...known, long(SLUG_CAP)]).fetch)
  assert.equal(at.state, 'behind', JSON.stringify(at).slice(0, 300))
  assert.deepEqual(at.pages, [`${long(SLUG_CAP)} (new)`])

  // Past it the list is not read: "could not check", nothing asked after it, nothing of it kept or shown. Each of
  // these answers stays under the 2 MB cap on an answer and the 200 pages cap.
  const cases: [string, string[]][] = [
    ['one character over the cap', [...known, long(SLUG_CAP + 1)]],
    ['one slug of 10,000 characters', [...known, long(10_000)]],
    ['one slug of 1.9 MB', [...known, long(1_900_000)]],
    ['196 slugs of 10,000 characters', [...known, ...Array.from({ length: 196 }, (_, i) => long(10_000, `-${String(i).padStart(3, '0')}`))]],
  ]
  for (const [name, slugs] of cases) {
    const live = listing(slugs)
    const c = await check(record, live.fetch)
    assert.equal(c.state, 'unknown', `${name}: ${JSON.stringify(c).slice(0, 200)}`)
    assert.equal(c.why, UNREADABLE, name)
    assert.deepEqual(c.pages, [], name)
    assert.equal(live.seen.length, 1, `${name}: no page is read from that list`)
    const shown = await shownBy(listing(slugs).fetch, record)
    assert.equal(shown.line, `Could not check FoxLeague's manual today: ${UNREADABLE}.`, name)
    assert.equal(shown.view.text, shown.line, name)
    assert.ok(shown.state.length < 1_000, `${name}: /api/state carries ${shown.state.length} characters of the check`)
    assert.ok(shown.row.length < 1_000, `${name}: the stored row holds ${shown.row.length} characters`)
  }

  // The same cap on the page record: one with a slug that long is no record, and FoxLeague is not asked.
  const live = foxleagueMcp()
  const odd = await check({ ...record, pages: { ...record.pages, [long(10_000)]: 'f'.repeat(64) } }, live.fetch)
  assert.equal(odd.state, 'unknown', JSON.stringify(odd).slice(0, 200))
  assert.match(String(odd.why), /no page record/)
  assert.equal(live.seen.length, 0)
})

test('R72A-6 many pages: the line names at most eight and says how many more, so the morning summary stays one message', async () => {
  const record = recorded()
  const known = Object.keys(record.pages)
  const news = (n: number) => Array.from({ length: n }, (_, i) => `extra/page-${i}`)
  const line = (named: string[], more = '') => `FoxLeague's manual changed since the agents' copy (pages: ${named.map(s => `${s} (new)`).join(', ')}${more}). The maintainer runs sync-manual.`
  assert.equal(MAX_NAMED, NAMED)

  // Eight are all named; from nine on the first eight are named and the rest counted.
  const eight = await check(record, listing([...known, ...news(NAMED)]).fetch)
  assert.equal(manualLine(eight), line(news(NAMED)))
  const nine = await check(record, listing([...known, ...news(NAMED + 1)]).fetch)
  assert.equal(nine.pages.length, NAMED + 1, 'the check keeps every page it found')
  assert.equal(manualLine(nine), line(news(NAMED), ' and 1 more'))

  // The most FoxLeague can send: 200 pages, every new one with a slug of the longest length taken.
  const longest = Array.from({ length: MAX_PAGES - known.length }, (_, i) => `extra/${String(i).padStart(3, '0')}-${'a'.repeat(SLUG_CAP - 10)}`)
  assert.ok(longest.every(s => s.length === SLUG_CAP))
  const full = await shownBy(listing([...known, ...longest]).fetch, record)
  assert.equal(full.c?.state, 'behind')
  assert.equal(full.c?.pages.length, longest.length)
  assert.equal(full.line, line(longest.slice(0, NAMED), ` and ${longest.length - NAMED} more`))
  assert.ok(String(full.line).length < 1_500, `the line has ${String(full.line).length} characters`)
  assert.equal(full.view.text, full.line, 'the dashboard shows the same line')

  // The morning summary that carries it is one Telegram message (4,000 characters at most).
  const { sent, morning } = await service(listing([...known, ...longest]).fetch, record)
  await morning()
  assert.equal(sent.length, 1)
  assert.ok(sent[0]!.length < 4_000, `the summary has ${sent[0]!.length} characters`)
  assert.ok(sent[0]!.includes(`\n${line(longest.slice(0, NAMED), ` and ${longest.length - NAMED} more`)}\n`))
})

test('R72A-6 an oversized text in FoxLeague\'s answer (an error, a refusal, a title) reaches neither the summary nor the dashboard nor the stored check', async () => {
  const record = recorded()
  // Under the 2 MB cap on an answer, so each of them is read whole.
  const huge = 'x'.repeat(1.5 * MB)
  const rpc = (body: Record<string, unknown>) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, ...body }), { status: 200, headers: { 'content-type': 'application/json' } })
  const cases: [string, (call: Seen) => Response | Promise<Response> | null, string | null][] = [
    ['an HTTP error with a long page', () => new Response(huge, { status: 500, headers: { 'content-type': 'text/plain' } }), 'FoxLeague answered HTTP 500'],
    ['a JSON-RPC error with a long message', () => rpc({ error: { code: -32000, message: huge, data: huge.slice(0, 1000) } }), UNREADABLE],
    ['a tool refusal with a long text', call => (call.body.params.name === 'get_manual_page' ? rpc({ result: { isError: true, content: [{ type: 'text', text: huge }] } }) : null), UNREADABLE],
    ['a long text that is not JSON', () => new Response(huge, { status: 200, headers: { 'content-type': 'application/json' } }), UNREADABLE],
    ['a cut connection with a long message', () => Promise.reject(Object.assign(new TypeError(huge), { cause: new Error(huge) })), 'FoxLeague could not be reached'],
    ['a long page of another slug', call => (call.body.params.name === 'get_manual_page' ? rpc({ result: { content: [{ type: 'text', text: JSON.stringify({ slug: 'mechanics/shop', text: huge }) }] } }) : null), UNREADABLE],
    ['a long title in the list', call => (call.body.params.name === 'list_manual_pages' ? rpc({ result: { content: [{ type: 'text', text: JSON.stringify(Object.keys(record.pages).map((slug, i) => ({ slug, title: i ? slug : huge, description: i ? '' : huge.slice(0, 100_000) }))) }] } }) : null), null],
  ]
  for (const [name, answer, why] of cases) {
    const shown = await shownBy(foxleagueMcp(SOURCE, SIDEBAR, { answer }).fetch, record)
    assert.equal(shown.c?.why ?? null, why, name)
    assert.equal(shown.line, why === null ? null : `Could not check FoxLeague's manual today: ${why}.`, name)
    assert.equal(shown.view.text, shown.line, name)
    for (const [where, text] of [['the summary line', shown.line ?? ''], ['/api/state', shown.state], ['the stored row', shown.row]] as const) {
      assert.ok(text.length < 1_000, `${name}: ${where} has ${text.length} characters`)
      assert.ok(!text.includes('x'.repeat(50)), `${name}: ${where} carries FoxLeague's text`)
    }
  }

  // And the morning summary itself.
  const { sent, morning } = await service(foxleagueMcp(SOURCE, SIDEBAR, { answer: () => new Response(huge, { status: 500 }) }).fetch, record)
  await morning()
  assert.equal(sent.length, 1)
  assert.ok(sent[0]!.length < 4_000, `the summary has ${sent[0]!.length} characters`)
  assert.ok(sent[0]!.includes("\nCould not check FoxLeague's manual today: FoxLeague answered HTTP 500.\n"))
})

test('R72A-6 the record has its row in the part of the review of PR #72', () => {
  const review = raw('docs/SECURITY-REVIEW.md')
  const start = review.indexOf("\n## Daily check of FoxLeague's manual (2026-11-15)\n")
  const section = review.slice(start, review.indexOf('\n## ', start + 1))
  const part = section.slice(section.indexOf('\nGitHub review of PR #72 (2026-11-15).'))
  const rows = part.split('\n').filter(l => /^\| R72A-\d+ \| /.test(l)).map(l => l.slice(2, 8))
  assert.deepEqual(rows, ['R72A-1', 'R72A-2', 'R72A-3', 'R72A-4', 'R72A-5', 'R72A-6'], 'one table, in order')
  const row = part.split('\n').find(l => l.startsWith('| R72A-6 | medium (agent re-review of PR #72; '))
  assert.ok(row, 'R72A-6 is a medium of the re-review')
  assert.equal(row.split(' | ').length, 4)
  assert.ok(row.endsWith(' |'))
  assert.match(row, /120 characters/)
  assert.match(row, /eight/)
  assert.match(part, /re-review/)
  assert.doesNotMatch(part, /—|, and |, or |\bbots?\b/i)

  // The guides and the info bubble say that the line names up to eight pages.
  for (const f of ['docs/SERVER.md', 'site/src/content/docs/help/update.md', 'site/src/content/docs/use/dashboard.md', 'site/src/content/docs/use/talk-to-your-manager.md']) {
    const t = flat(f)
    assert.match(t, /up to eight[^.]*(how many more|counts the rest)/i, f)
    // The sentence that says it.
    const at = t.search(/up to eight/i)
    assert.doesNotMatch(t.slice(t.lastIndexOf('. ', at) + 1, t.indexOf('. ', at)), /—|, and |, or |\bbots?\b/i, f)
  }
  const html = raw('src/web/dashboard.html')
  const bubble = html.slice(html.indexOf("\n  manual: ['FoxLeague manual check',"), html.indexOf('`],', html.indexOf("\n  manual: ['FoxLeague manual check',"))).replace(/\s+/g, ' ')
  assert.match(bubble, /up to eight[^.]*(how many more|counts the rest)/i)
  assert.doesNotMatch(bubble, /—|, and |, or |\bbots?\b/i)
})
