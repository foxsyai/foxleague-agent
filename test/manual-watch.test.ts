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
import { ManualWatch, checkManual, manualLine, manualRecord, type ManualRecord, type McpFetch } from '../src/strategist/manual-watch.ts'
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
function foxleagueMcp(source = SOURCE, sidebar = SIDEBAR, o: { answer?: (call: Seen, n: number) => Response | Promise<Response> | null } = {}) {
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

test('MW-5 it runs at most once a day: a second call, a call meanwhile, a restart and a failed check ask nothing more that day', async () => {
  const record = recorded()
  const kv = memoryKv()
  const live = foxleagueMcp()
  const watch = (fetch: McpFetch) => Object.assign(new ManualWatch({ enabled: true, base: BASE, zone: 'UTC', kv }), { fetch, readManual: () => MANUAL, readRecord: () => record, gapMs: 0 })
  const morning = Date.parse('2026-11-16T07:00:00Z')
  const w = watch(live.fetch)
  const [a, b] = await Promise.all([w.today(morning), w.today(morning)])
  assert.equal(a?.state, 'current')
  assert.deepEqual(a, b)
  const set = live.seen.length
  assert.equal(set, 5)
  await w.today(morning + 6 * 3600_000)
  await watch(live.fetch).today(morning + 12 * 3600_000)
  assert.equal(live.seen.length, set, 'the same day: no second request set, also after a restart')
  await w.today(Date.parse('2026-11-17T07:00:00Z'))
  assert.equal(live.seen.length, 2 * set, 'the next day: one more')

  // A failed check is not tried again the same day.
  const down = foxleagueMcp(SOURCE, SIDEBAR, { answer: () => new Response('', { status: 503 }) })
  const d = watch(down.fetch)
  const day3 = Date.parse('2026-11-18T07:00:00Z')
  assert.equal((await d.today(day3))?.state, 'unknown')
  assert.equal((await d.today(day3 + 3600_000))?.state, 'unknown')
  assert.equal(down.seen.length, 1)
  // Switched off (AGENT_MANUAL_CHECK=0): it asks nobody and says nothing.
  const off = Object.assign(new ManualWatch({ enabled: false, base: BASE, zone: 'UTC', kv: memoryKv() }), { fetch: live.fetch })
  assert.equal(await off.today(day3), null)
  assert.equal(off.line(day3), null)
  assert.equal(live.seen.length, 2 * set)
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
  assert.match(bubble.replace(/\s+/g, ' '), /once a day/i)
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
  assert.match(sync, /writeFileSync\(out, text\)\n\s+writeFileSync\(RECORD_FILE, `\$\{JSON\.stringify\(manualRecord\(repo, MANUAL_BRANCH, text\), null, 2\)\}\\n`\)/)
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
  assert.match(flat('site/src/content/docs/play/safety.md'), /once a day/i)

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
