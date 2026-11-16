// R2T-1 (P-W4): FoxLeague's API description is fingerprinted with a memo per `$ref`, so a schema that names the next
// one twice is walked once (MAX_NODES never trips) but written out twice at every level by JSON.stringify: a 10 KB
// document of 20 nested schemas makes 2^20 leaves per route, 54 routes, all in one synchronous call of the hourly look.
// The event loop of the process that books and signs stands still meanwhile (kill switch, dashboard, Telegram, payment
// confirms): the same class as ATK-1. The right behaviour: a document the look cannot judge cheaply is "could not be
// read" (null), within a bound.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { API_ROUTES, routePrints } from '../../src/foxleague/api-routes.ts'
import { MAX_API_BYTES, checkApi, type ApiFetch } from '../../src/strategist/manual-watch.ts'

/** An OpenAPI document whose every route answers schema L0; each L(i) has two properties, both `$ref` L(i+1). */
function nested(depth: number) {
  const schemas: Record<string, unknown> = {}
  for (let i = 0; i < depth; i++) schemas[`L${i}`] = { type: 'object', properties: { a: { $ref: `#/components/schemas/L${i + 1}` }, b: { $ref: `#/components/schemas/L${i + 1}` } } }
  schemas[`L${depth}`] = { type: 'string' }
  const paths: Record<string, Record<string, unknown>> = {}
  for (const r of API_ROUTES) {
    const [m, p] = r.split(' ') as [string, string]
    ;(paths[p] ??= {})[m.toLowerCase()] = { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/L0' } } } } } }
  }
  return { openapi: '3.1.0', paths, components: { schemas } }
}

test('R2T-1 a small API description with nested $refs is judged (or given up on) within 2 seconds, never by standing the service still', () => {
  const doc = nested(20)
  const bytes = Buffer.byteLength(JSON.stringify(doc))
  assert.ok(bytes < 16 * 1024 && bytes < MAX_API_BYTES, `the document is small: ${bytes} bytes, far under the 4 MB the look reads`)
  const t = performance.now()
  const out = routePrints(doc)
  const ms = Math.round(performance.now() - t)
  assert.ok(ms < 2000, `routePrints held the event loop for ${ms} ms on a ${bytes}-byte document (result: ${out === null ? 'null' : 'fingerprints'})`)
})

// Added by the fix: the bound does not cost the look a real document, and past it the look cannot tell.

test('R2T-1 a flat API description of 1.7 MB, each route with fields of its own, is judged within a second', () => {
  const per = Math.floor(1_700_000 / API_ROUTES.length / 40)
  const paths: Record<string, Record<string, unknown>> = {}
  API_ROUTES.forEach((r, i) => {
    const [m, p] = r.split(' ') as [string, string]
    const schema = { type: 'object', properties: Object.fromEntries(Array.from({ length: per }, (_, k) => [`field_${i}_${k}`, { type: 'integer', format: 'int64' }])) }
    ;(paths[p] ??= {})[m.toLowerCase()] = { responses: { '200': { content: { 'application/json': { schema } } } } }
  })
  const doc = { openapi: '3.1.0', paths }
  assert.ok(Buffer.byteLength(JSON.stringify(doc)) > 1_700_000)
  const t = performance.now()
  const out = routePrints(doc)
  const ms = Math.round(performance.now() - t)
  assert.ok(out && Object.values(out).every(p => /^[0-9a-f]{64}$/.test(p)), 'the document is judged')
  assert.ok(ms < 1000, `routePrints took ${ms} ms`)
})

test('R2T-1 past the bound the look says "could not be read", never "changed" and never "the same"', async () => {
  const record = JSON.parse(readFileSync(new URL('../../src/foxleague/api-shapes.json', import.meta.url), 'utf8')) as unknown
  const fetch: ApiFetch = async () => new Response(JSON.stringify(nested(20)), { status: 200, headers: { 'content-type': 'application/json' } })
  const c = await checkApi({ base: 'http://foxleague.test', record, fetch })
  assert.equal(c.state, 'unknown')
  assert.deepEqual(c.routes, [])
  assert.match(c.why ?? '', /could not be read/)
})
