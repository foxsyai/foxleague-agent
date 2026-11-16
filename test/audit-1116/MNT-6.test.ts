// MNT-6: the daily check of FoxLeague's manual (src/strategist/manual-watch.ts, PR #72).
// On 16 Nov 2026 the check ran at 07:00 UTC and said "current"; FoxLeague deployed mainnet 729164194 at about 09:48 UTC
// and 10 of the agents' 16 pages changed. The service looks at the check every hour (service.ts armManualCheck) but
// ManualWatch.today() answers the stored check for the whole day, so the owner is told with the summary of 17 Nov, about
// 21 hours later, and the dashboard says "current" until then. The same "once a day" turns one failed request (FoxLeague
// restarting for a deploy at the summary's hour) into "could not check" for 24 hours.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { ManualWatch, type McpFetch } from '../../src/strategist/manual-watch.ts'

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const fingerprint = (body: string) => sha256(body.replace(/\s+/g, ' ').trim())
const MANUAL = '# FoxLeague player manual\nsynced from the FoxLeague repository, main at 9ebcbc52d 2026-11-13.\n'
const PAGES: Record<string, string> = { 'mechanics/matches': 'Ranked moves ELO.', 'mechanics/shop': 'A Common pack costs 2,500 FOXSY, at most 2 per wallet per rolling 7 days.' }
const record = () => ({ synced: '9ebcbc52d 2026-11-13', manual: sha256(MANUAL), pages: Object.fromEntries(Object.entries(PAGES).map(([slug, body]) => [slug, fingerprint(body)])) })

/** FoxLeague's MCP server serving `pages`; `down()` makes every request fail. Counts the requests it got. */
function mcp(pages: Record<string, string>) {
  const state = { pages: { ...pages }, down: false, asked: 0 }
  const fetch: McpFetch = async (_url, init) => {
    state.asked++
    if (state.down) throw new TypeError('fetch failed')
    const { params } = JSON.parse(init.body) as { params: { name: string; arguments: { slug?: string } } }
    const answer = params.name === 'list_manual_pages'
      ? Object.keys(state.pages).map(slug => ({ slug, title: slug }))
      : { slug: params.arguments.slug, text: `# Title\n\n${state.pages[params.arguments.slug!]}\n\nSource: https://docs.foxleague.ai/${params.arguments.slug}/` }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(answer) }] } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return { state, fetch }
}

function watch(server: ReturnType<typeof mcp>) {
  const kv = new Map<string, string>()
  const w = new ManualWatch({ enabled: true, base: 'http://foxleague.test', zone: 'UTC', kv: { get: k => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) } })
  w.fetch = server.fetch
  w.readManual = () => MANUAL
  w.readRecord = () => record()
  w.gapMs = 0
  return w
}

const AT_0700 = Date.parse('2026-11-16T07:00:00Z')
const HOUR = 3600_000

test('MNT-6 a check that could not reach FoxLeague is made again at a later hourly look, not a day later', async () => {
  const server = mcp(PAGES)
  server.state.down = true
  const w = watch(server)
  assert.equal((await w.today(AT_0700))!.state, 'unknown')
  // FoxLeague is back a minute later; its manual has changed meanwhile (a deploy is why it was down).
  server.state.down = false
  server.state.pages['mechanics/matches'] = 'Ranked moves ELO. The ELO pair cap: at most 3 games per day.'
  let seen = 'unknown'
  for (let h = 1; h <= 6; h++) seen = (await w.today(AT_0700 + h * HOUR))!.state
  assert.equal(seen, 'behind', `after one failed request at 07:00 the day's answer stays "${seen}" at 13:00, with FoxLeague reachable since 07:01`)
})
