// The routes of FoxLeague's API the agent calls (api.ts), and a fingerprint of each one's shape as FoxLeague describes
// it (audit 2026-11-16, MAINNET proposal P-W4). FoxLeague's mainnet serves its API description, an OpenAPI 3.1
// document, at GET /api/openapi.json (backend/src/openapi/mod.rs, SPEC_PATH; the same document as docs/manual/openapi.json
// in its repository, pinned by its test the_committed_spec_is_the_generated_spec). sync-manual records the fingerprint
// of every route below from the FoxLeague checkout it syncs the manual from (api-shapes.json); the hourly look of the
// manual check reads the live document and names the routes whose request or response shape changed since.
//
// A shape is what a client reads and sends: the parameters, the JSON body and the JSON of each 2xx answer, with every
// schema it refers to, without the prose (descriptions, titles, examples, defaults). A text FoxLeague edits is no change;
// a field added, removed or retyped is. Nothing of FoxLeague's document is ever written out: a route is named by this
// list, in our own words.

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

/** Every route api.ts calls, as FoxLeague's API description names it (method, then path with its parameters). */
export const API_ROUTES = [
  'POST /api/auth/verify',
  'GET /api/config',
  'GET /api/marketplace/recent-sales',
  'GET /api/matches/history',
  'GET /api/public/tournament-match/{id}/stats',
  'GET /api/matches/{id}/stats',
  'GET /api/users/{address}',
  'GET /api/teams/{address}',
  'GET /api/players/{address}',
  'GET /api/players/nonce/{nonce}',
  'GET /api/tournaments',
  'GET /api/tournaments/{id}',
  'GET /api/leaderboard',
  'GET /api/tournaments/availability',
  // Not in FoxLeague's API description: recorded as absent, named only if it ever comes or the others change.
  'GET /api/whitelist/check',
  'GET /api/shop/status',
  'GET /api/matches/daily-allowance',
  'GET /api/matches/active',
  'GET /api/tournaments/my',
  'GET /api/tournaments/upcoming-matches',
  'GET /api/notifications/challenges-for-me',
  'GET /api/tournaments/invitations',
  'GET /api/teams/best-xi-ovr',
  'GET /api/matches/elo-pair/{user_id}',
  'GET /api/tournaments/{id}/invitations',
  'POST /api/training/train',
  'POST /api/teams/formation',
  'POST /api/teams/lineup',
  'POST /api/matches/play',
  'POST /api/tournaments/{id}/join',
  'POST /api/tournaments/{id}/cancel',
  'POST /api/tournaments/{id}/leave',
  'POST /api/tournaments/{id}/ovr-range',
  'POST /api/tournaments/create',
  'GET /api/shop/ranked-ticket',
  'POST /api/shop/ranked-ticket',
  'POST /api/tournaments/organizer-fee/quote',
  'POST /api/shop/confirm',
  'GET /api/shop/medicine/quote',
  'POST /api/shop/medicine',
  'GET /api/sync/prepare',
  'POST /api/sync/confirm',
  'POST /api/onboarding/relay',
  'GET /api/players/nonce/{nonce}/match-waiver-quote',
  'GET /api/fusion/can-fuse',
  'POST /api/fusion/prepare',
  'POST /api/fusion/confirm',
  'GET /api/marketplace/can-list',
  'GET /api/marketplace/listings',
  'GET /api/marketplace/floor-prices',
  'POST /api/onboarding/generate-badge',
  'POST /api/teams/badge',
  'GET /api/register/name-available',
  'POST /api/register',
] as const

/** Where FoxLeague serves its API description, and where its repository keeps the same document. */
export const OPENAPI_PATH = '/api/openapi.json'
export const OPENAPI_FILE = 'docs/manual/openapi.json'
/** The record sync-manual writes next to this file. */
export const API_RECORD_FILE = join(import.meta.dirname, 'api-shapes.json')
/** A route as named: our own list only, checked again wherever a name is read back. */
const ROUTE = /^(?:GET|POST|PUT|DELETE) \/api(?:\/[a-z0-9_{}-]{1,40}){1,6}$/
export const isRouteName = (s: unknown): s is string => typeof s === 'string' && s.length <= 80 && ROUTE.test(s) && (API_ROUTES as readonly string[]).includes(s)
/** A route's fingerprint: a sha256, or `absent` when the document does not describe it. */
const PRINT = /^(?:[0-9a-f]{64}|absent)$/

/** The prose of a schema or an operation: left out of a shape. */
const PROSE = new Set(['description', 'summary', 'title', 'example', 'examples', 'externalDocs', 'deprecated', 'default', 'xml', 'tags', 'operationId'])
/** The most nodes one route's shape may visit: a document past it is not judged. */
const MAX_NODES = 200_000

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

class TooLarge extends Error {}

/** The shape of one route of `doc`, as a canonical value; null when the document does not describe it. */
function routeShape(doc: Record<string, unknown>, route: string): unknown {
  const [method, path] = route.split(' ') as [string, string]
  const item = isObject(doc.paths) ? doc.paths[path] : undefined
  const op = isObject(item) ? item[method.toLowerCase()] : undefined
  if (!isObject(item) || !isObject(op)) return null
  const memo = new Map<string, unknown>()
  const stack: string[] = []
  let nodes = 0
  const resolve = (ref: string): unknown => {
    let at: unknown = doc
    for (const part of ref.slice(2).split('/')) at = isObject(at) ? at[part.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined
    return at
  }
  const canon = (v: unknown, props = false): unknown => {
    if (++nodes > MAX_NODES) throw new TooLarge()
    if (Array.isArray(v)) return v.map(x => canon(x))
    if (!isObject(v)) return v ?? null
    const ref = v.$ref
    if (typeof ref === 'string' && ref.startsWith('#/')) {
      if (stack.includes(ref)) return { $cycle: ref }
      if (memo.has(ref)) return memo.get(ref)
      stack.push(ref)
      const out = canon(resolve(ref))
      stack.pop()
      memo.set(ref, out)
      return out
    }
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v).sort()) {
      // Under `properties` every key is a field name, kept whatever it is called.
      if (!props && (PROSE.has(k) || k.startsWith('x-'))) continue
      out[k] = props ? canon(v[k]) : canon(v[k], k === 'properties' || k === 'patternProperties')
    }
    return out
  }
  /** A request body or an answer given by reference: the object it names. */
  const deref = (v: unknown): unknown => {
    let x = v
    for (let i = 0; i < 8 && isObject(x) && typeof x.$ref === 'string' && x.$ref.startsWith('#/'); i++) x = resolve(x.$ref)
    return x
  }
  /** The JSON schema of a body or an answer: what a client sends or reads. */
  const schemaOf = (v: unknown): unknown => {
    const content = isObject(v) ? v.content : undefined
    const media = isObject(content) ? content['application/json'] : undefined
    return canon(isObject(media) ? media.schema : null)
  }
  const params = [...(Array.isArray(item.parameters) ? item.parameters : []), ...(Array.isArray(op.parameters) ? op.parameters : [])]
    .map(p => JSON.stringify(canon(p)))
    .sort()
  const rb = deref(op.requestBody)
  const body = isObject(rb) ? { required: rb.required === true, schema: schemaOf(rb) } : null
  const answers: Record<string, unknown> = {}
  if (isObject(op.responses)) {
    for (const status of Object.keys(op.responses).filter(s => /^2\d\d$/.test(s)).sort()) answers[status] = schemaOf(deref(op.responses[status]))
  }
  return { params, body, answers }
}

/**
 * The fingerprint of each route of API_ROUTES in an API description: a sha256 of its shape, or `absent`. Null for an
 * answer that is not an OpenAPI document, or one too large to judge.
 */
export function routePrints(doc: unknown): Record<string, string> | null {
  if (!isObject(doc) || typeof doc.openapi !== 'string' || !isObject(doc.paths)) return null
  const out: Record<string, string> = {}
  try {
    for (const route of API_ROUTES) {
      const shape = routeShape(doc, route)
      out[route] = shape === null ? 'absent' : sha256(JSON.stringify(shape))
    }
  } catch (err) {
    if (err instanceof TooLarge || err instanceof RangeError) return null
    throw err
  }
  return out
}

/** The routes whose shape differs between the record and the live description, in the list's order: `GET /api/x`, `... (gone)`, `... (new)`. */
export function changedRoutes(recorded: Record<string, string>, live: Record<string, string>): string[] {
  const out: string[] = []
  for (const route of API_ROUTES) {
    const was = recorded[route]
    const now = live[route]
    if (was === undefined || now === undefined || was === now) continue
    out.push(now === 'absent' ? `${route} (gone)` : was === 'absent' ? `${route} (new)` : route)
  }
  return out
}

/** A changed route as named, checked again when read back. */
export const isChangedRoute = (s: unknown): s is string => typeof s === 'string' && isRouteName(s.replace(/ \((?:new|gone)\)$/, ''))

/** What sync-manual records: the FoxLeague commit of the copy and the fingerprint of each route. */
export interface ApiRecord {
  synced: string
  routes: Record<string, string>
}

/** The record as read from api-shapes.json: anything else is no record. */
export function validApiRecord(r: unknown): ApiRecord | null {
  if (!isObject(r) || typeof r.synced !== 'string' || r.synced.length > 80 || !isObject(r.routes)) return null
  const entries = Object.entries(r.routes)
  if (!entries.length || entries.some(([route, print]) => !isRouteName(route) || typeof print !== 'string' || !PRINT.test(print))) return null
  return { synced: r.synced, routes: Object.fromEntries(entries) as Record<string, string> }
}

/**
 * The record for the copy sync-manual writes, from FoxLeague's checkout (read only: no fetch here): the fingerprints
 * of the API description at the same commit as the manual. Throws when that commit has none or it cannot be read as
 * one, so a sync never writes a record of nothing.
 */
export function apiRecord(repo: string, ref: string, synced: string): ApiRecord {
  const text = execFileSync('git', ['-C', repo, 'show', `${ref}:${OPENAPI_FILE}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const routes = routePrints(JSON.parse(text) as unknown)
  if (!routes) throw new Error(`FoxLeague's ${OPENAPI_FILE} at ${ref} could not be read as an API description`)
  return { synced, routes }
}
