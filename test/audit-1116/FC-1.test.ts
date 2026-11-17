// FC-1 (medium; R2T-1 is not closed): the budget of R2T-1 (MAX_WRITTEN) counts what `canon` walks and writes, but the
// fingerprint also follows `$ref`s OUTSIDE `canon`: `deref` (src/foxleague/api-routes.ts:187-191) resolves a request
// body and every 2xx answer given by reference, up to 8 hops each, and `resolve` (147-151) splits the name and runs two
// regex replaces over every part of it. None of that is spent from the budget (only the `$ref`s `canon` meets are:
// line 162). So one long `$ref` kept ONCE in the document and named by short ones is resolved again 4 times for every
// request body and every 2xx answer of every route: thousands of passes over a megabyte, all in the one synchronous
// call of the hourly look, while the budget has spent a few thousand of its 2,000,000.
//
// The document below: `s` names a key of 100,000 slashes by its JSON-pointer form (200,000 characters of `~1`), that
// key names `s` again, and each route's request body and 2xx answers are `{"$ref":"#/s"}`. It is a valid answer of
// GET /api/openapi.json for checkApi (an object with `openapi` and `paths`), far under MAX_API_BYTES.
// Measured on this machine on the frozen tree: 418 KB with 100 answers on each of the 54 routes holds the event loop
// for 79 seconds; 3.6 MB (a key of 1,200,000) takes 290 ms for EACH body or answer, about 26 minutes for 54 x 101.
// The kill switch, the dashboard, Telegram and the payment confirms stand still meanwhile, as in R2T-1 and ATK-1.
//
// Right: a document the look cannot judge cheaply is "could not be read" (null) within the bound, whatever its shape.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { API_ROUTES, routePrints } from '../../src/foxleague/api-routes.ts'
import { MAX_API_BYTES } from '../../src/strategist/manual-watch.ts'

/** `routes` routes, each with a request body and `answers` 2xx answers given by `$ref`; one long `$ref` in the document. */
function hostile(keyLength: number, routes: number, answers: number): string {
  const key = '/'.repeat(keyLength)
  const paths: Record<string, Record<string, unknown>> = {}
  for (const route of API_ROUTES.slice(0, routes)) {
    const [method, path] = route.split(' ') as [string, string]
    const responses: Record<string, unknown> = {}
    for (let i = 0; i < answers; i++) responses[String(200 + i)] = { $ref: '#/s' }
    ;(paths[path] ??= {})[method.toLowerCase()] = { requestBody: { $ref: '#/s' }, responses }
  }
  return JSON.stringify({ openapi: '3.1.0', paths, s: { $ref: `#/${'~1'.repeat(keyLength)}` }, [key]: { $ref: '#/s' } })
}

test('FC-1 an API description whose bodies and answers are given by a long $ref is judged (or given up on) within 2 seconds', () => {
  // 6 of the 54 routes are enough to show it without holding this machine for minutes: the time grows with each route.
  const text = hostile(100_000, 6, 100)
  const bytes = Buffer.byteLength(text)
  assert.ok(bytes < 400 * 1024 && bytes < MAX_API_BYTES, `the document is ${bytes} bytes, a tenth of the 4 MB the look reads`)
  const doc = JSON.parse(text) as unknown
  const t = performance.now()
  const out = routePrints(doc)
  const ms = Math.round(performance.now() - t)
  assert.ok(ms < 2000, `routePrints held the event loop for ${ms} ms on a ${bytes}-byte document, 6 routes of 54 (result: ${out === null ? 'null' : 'fingerprints, so the budget of 2,000,000 was never reached'})`)
})

// Added by the fix: each hop of a body or an answer given by reference is counted, also by `$ref`s of a usual length,
// and a `$ref` longer than any description names is not judged at all.
import { MAX_REF, MAX_WRITTEN } from '../../src/foxleague/api-routes.ts'

test('FC-1 the hops of bodies and answers given by reference spend from the budget: past it the document could not be read', () => {
  // `$ref`s of 902 characters, under MAX_REF: 10 routes of a body and 100 answers, 8 hops each, write out nothing but
  // ask about 3,600,000 characters of names.
  const keyLength = 450
  assert.ok(2 + 2 * keyLength <= MAX_REF)
  const doc = JSON.parse(hostile(keyLength, 10, 100)) as unknown
  assert.equal(routePrints(doc, MAX_WRITTEN), null, 'the hops were not counted: the document was judged')
  // Control: the same document with one answer a route stays well within the bound and is judged.
  const one = routePrints(JSON.parse(hostile(keyLength, 10, 1)) as unknown)
  assert.ok(one && Object.values(one).every(p => /^(?:[0-9a-f]{64}|absent)$/.test(p)), 'a small document is judged')
})

test('FC-1 a $ref longer than MAX_REF is not judged, at once', () => {
  const doc = JSON.parse(hostile((MAX_REF + 2) / 2, 1, 0)) as unknown
  const t = performance.now()
  assert.equal(routePrints(doc), null)
  assert.ok(performance.now() - t < 200)
})
