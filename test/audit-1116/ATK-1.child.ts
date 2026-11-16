// The child of ATK-1.test.ts: one day's check of FoxLeague's manual against a FoxLeague MCP server that answers one
// page of a few kilobytes. It prints one JSON line when the check is done. It is its own process because the defect
// blocks the event loop: no timer of the test could end it.
import { createHash } from 'node:crypto'
import { checkManual, type McpFetch } from '../../src/strategist/manual-watch.ts'

const n = Number(process.argv[2] ?? 3000)
const SLUG = 'mechanics/one-v-one'
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const manual = '# the agents manual\n'
// What sync-manual would have recorded: any fingerprint will do, the page only has to be compared.
const record = { synced: '9ebcbc52d 2026-11-13', manual: sha256(manual), pages: { [SLUG]: 'a'.repeat(64) } }

// A page as FoxLeague's server gives it (title, body, the Source line), with runs of blank lines and trailing spaces:
// n line breaks, the Source line, n spaces, n line breaks and one more character. About 7 bytes of answer per n.
const text = `# One v one\nbody${'\n'.repeat(n)}Source: https://docs.foxleague.ai/mechanics/one-v-one/${' '.repeat(n)}${'\n'.repeat(n)}.`

const answer = (value: unknown) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(value) }] } }), { status: 200, headers: { 'content-type': 'application/json' } })
const fetchStub: McpFetch = async (_url, init) => {
  const call = JSON.parse(init.body) as { params: { name: string } }
  return call.params.name === 'list_manual_pages' ? answer([{ slug: SLUG }]) : answer({ slug: SLUG, text })
}

const started = Date.now()
// The longest time the event loop stood still while the check ran (the process that signs and books shares it).
let stall = 0
let tick = Date.now()
const beat = setInterval(() => {
  stall = Math.max(stall, Date.now() - tick)
  tick = Date.now()
}, 20)
const check = await checkManual({ base: 'https://foxleague.invalid', manual, record, fetch: fetchStub, gapMs: 0 })
stall = Math.max(stall, Date.now() - tick)
clearInterval(beat)
console.log(JSON.stringify({ state: check.state, pages: check.pages, ms: Date.now() - started, stallMs: stall, pageBytes: Buffer.byteLength(text) }))
