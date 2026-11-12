// Shadow plans (the owner, 2026-11-11): right after an agent's real plan the service sends the very same request to a
// second model and only records what that model would have done, so an owner can compare a cheaper model with the one
// that plays before switching. A shadow plan is never carried out, never shown to the playing model and changes
// nothing the agents play by. This module holds what is plain data about one: the setting, the copy that is kept and
// the report. It knows nothing of wallets, the chain or the code that carries actions out.

import type { Store } from '../store/db.ts'
import { agentName } from '../names.ts'
import { EFFORTS, MODELS, isKnownModel, type Effort, type Plan, type PlanOutcome } from './strategist.ts'

/** The kind of a shadow plan's row in the activity. Every reader of the activity that counts or replays rows leaves it out. */
export const SHADOW_KIND = 'shadow'

/** A shadow request that has not answered after this long is given up (the request is cancelled, nothing is asked again). */
export const SHADOW_TIMEOUT_MS = 10 * 60_000

/** How a shadow request ended: as a plan request can end, or with an error, or without an answer in time. */
export type ShadowOutcome = PlanOutcome | 'error' | 'timeout'

/**
 * One action of a recorded plan: plain data, a copy. `ok` is what parseAction said of it; `error` is its refusal.
 * It is not a planned action and no function that carries actions out takes one.
 */
export interface RecordedAction {
  readonly ok: boolean
  readonly type: string | null
  readonly action: unknown
  readonly reason?: string
  readonly error?: string
}

export interface RecordedPlan {
  readonly summary: string
  readonly actions: readonly RecordedAction[]
}

/** The structured copy of one shadow plan next to the real plan of the same tick (the table shadow_plans). */
export interface ShadowPlanRow {
  id: number
  at: string
  agentIndex: number
  realModel: string
  realEffort: string
  shadowModel: string
  shadowEffort: string
  outcome: ShadowOutcome
  /** The real plan as the playing model proposed it, with what it cost. */
  real: RecordedPlan & { readonly usd?: number; readonly servedBy?: string }
  shadow: RecordedPlan
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  usd: number
  ms: number
}

/** The shadow models that run next to one real plan, their one effort, and why an entry of the setting does not run. */
export interface ShadowChoices {
  /** The models that get this plan's request, in the order they were written, each once. Empty: no shadow plans. */
  readonly models: string[]
  /** One effort for every shadow model. */
  readonly effort: Effort
  /** For the log: one reason per entry that was left out (not on the list, or the model that plays). */
  readonly leftOut: string[]
}

/** The entries of a setting that are read: the list of models has four, and a setting typed by hand must not fill the log. */
const MAX_ENTRIES = 16

/**
 * The setting as written: the database's (kv shadow_model), else AGENT_SHADOW_MODEL from the environment. One model
 * id or several separated by commas, each once. Not set, empty or "off" means none; "off" anywhere among several
 * switches all of them off, so a half-typed setting never costs anything.
 */
function entriesSet(store: Store): { read: string[]; unread: number } {
  const ids = [...new Set((store.getKv('shadow_model') ?? process.env.AGENT_SHADOW_MODEL ?? '').split(',').map(id => id.trim()).filter(Boolean))]
  if (ids.some(id => id.toLowerCase() === 'off')) return { read: [], unread: 0 }
  return { read: ids.slice(0, MAX_ENTRIES), unread: Math.max(0, ids.length - MAX_ENTRIES) }
}

/**
 * The shadow models of a plan and their effort: the database's setting (kv shadow_model, shadow_effort), else
 * AGENT_SHADOW_MODEL and AGENT_SHADOW_EFFORT from the environment. shadow_model holds one model id or several
 * separated by commas. Not set, empty or "off" means no shadow plans, which is the default. An entry the list of
 * models does not have and the model that plays are left out, each with its reason for the log; a repeated entry
 * counts once. The effort is one for every shadow model. There is no dashboard control and no Telegram command for
 * any of it: it adds AI spend, so it is switched on only on the machine itself.
 */
export function shadowChoices(store: Store, playing: string): ShadowChoices {
  const { read, unread } = entriesSet(store)
  const models: string[] = []
  const leftOut: string[] = []
  for (const id of read) {
    // A setting typed by hand: only what a model id can hold reaches the log.
    const named = id.slice(0, 60).replace(/[^\w.:-]/g, '?')
    if (!isKnownModel(id)) leftOut.push(`${named} is not a model on the list (${Object.keys(MODELS).join(', ')})`)
    else if (id === playing) leftOut.push(`${named} is the model that plays, and a shadow plan needs another one`)
    else models.push(id)
  }
  if (unread) leftOut.push(`${unread} more entries are not read (${MAX_ENTRIES} at most)`)
  const effort = (store.getKv('shadow_effort') ?? process.env.AGENT_SHADOW_EFFORT ?? 'medium').trim()
  return { models, effort: (EFFORTS as readonly string[]).includes(effort) ? (effort as Effort) : 'medium', leftOut }
}

/**
 * What the log says of a setting of which an entry does not run, or null when every entry runs (or none is set). The
 * service says it once, not at every plan.
 */
export function shadowNote(choices: ShadowChoices): string | null {
  if (!choices.leftOut.length) return null
  return `${choices.models.length ? `shadow plans run by ${choices.models.join(', ')} only` : 'shadow plans are off'}: ${choices.leftOut.join('; ')}`
}

/**
 * The shadow models that are set, whatever model plays: the entries of the setting that the list of models has, each
 * once; none when nothing is set or it is "off". One of them rests while it is the model that plays and runs under
 * any other, which is why a switch of the playing model away from it starts its shadow plans and asks for the
 * password (wakesShadow in src/web/server.ts).
 */
export function shadowModelsSet(store: Store): string[] {
  return entriesSet(store).read.filter(id => isKnownModel(id))
}

/** The most a rejected proposal may take in a record: a model can write anything there. */
const RAW_CHARS = 400
const MAX_REJECTED = 12

function frozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) frozen(v)
    Object.freeze(value)
  }
  return value
}

/** A copy made of plain data only (through JSON); something too long is kept as the start of its text. */
function copyOf(value: unknown, max: number): unknown {
  let text: string | undefined
  try {
    text = JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))
  } catch {
    return '(not readable)'
  }
  if (text === undefined) return null
  return text.length > max ? `${text.slice(0, max)}…` : (JSON.parse(text) as unknown)
}

/**
 * A plan as plain, frozen data: its summary and each proposed action with what parseAction said of it, the accepted
 * ones first. Every action is a copy, so nothing of the plan's own objects is kept, and the result has no type that
 * the code which carries actions out accepts.
 */
export function recordPlan(plan: Plan): RecordedPlan {
  const accepted: RecordedAction[] = plan.actions.map(a => ({ ok: true, type: a.action.type, action: copyOf(a.action, 2000), reason: a.reason.slice(0, 300) }))
  const rejected: RecordedAction[] = plan.rejected.slice(0, MAX_REJECTED).map(r => {
    const type = (r.raw as { type?: unknown } | null | undefined)?.type
    return { ok: false, type: typeof type === 'string' ? type.slice(0, 40) : null, action: copyOf(r.raw, RAW_CHARS), error: r.error.slice(0, 300) }
  })
  return frozen({ summary: plan.summary.slice(0, 2000), actions: [...accepted, ...rejected] })
}

const SUMMARY_CHARS = 600
const LINE_CHARS = 1500
const oneLine = (text: string): string => text.replace(/[\p{Cc}\p{Cf}\u2028\u2029]+/gu, ' ').trim()

/**
 * The activity line of a shadow plan: who, the cost and the time, then the plan's own summary and its actions as
 * compact JSON, each marked with what parseAction said. Without a plan (a refusal, a cut-off answer, an error, no
 * answer in time) the one line that says so.
 */
export function shadowLine(o: { model: string; effort: string; usd: number; ms: number; text: string; plan?: RecordedPlan }): string {
  const head = `shadow plan by ${MODELS[o.model]?.label ?? o.model} (${o.effort}), $${o.usd.toFixed(4)}, ${Math.round(o.ms / 1000)} s: `
  const actions = o.plan ? ` ${JSON.stringify(o.plan.actions.map(a => (a.ok ? { ok: true, action: a.action } : { error: a.error, action: a.action })))}` : ''
  const line = head + oneLine(o.text).slice(0, SUMMARY_CHARS) + actions
  return line.length > LINE_CHARS ? `${line.slice(0, LINE_CHARS - 1)}…` : line
}

const label = (model: string): string => MODELS[model]?.label ?? model
const types = (p: RecordedPlan): string[] => p.actions.filter(a => a.ok).map(a => String(a.type))
const sameTypes = (a: RecordedPlan, b: RecordedPlan): boolean => {
  const x = [...new Set(types(a))].sort(), y = [...new Set(types(b))].sort()
  return x.length === y.length && x.every((t, i) => t === y[i])
}
const listed = (p: RecordedPlan): string => {
  const ok = types(p)
  const bad = p.actions.length - ok.length
  return (ok.length ? ok.join(', ') : 'no actions') + (bad ? ` (+${bad} rejected)` : '')
}

/**
 * The report of `cli shadow-report`: how many shadow plans, how many answered with a plan, how many of their actions
 * parsed, how often the shadow proposed the same action types as the real plan of the same tick, the average cost
 * and time, and the last pairs side by side. `rows` newest first, as the store gives them.
 */
export function shadowReport(rows: ShadowPlanRow[], o: { last?: number; agentIndex?: number | null } = {}): string {
  const who = o.agentIndex === null || o.agentIndex === undefined ? 'all agents' : agentName(o.agentIndex)
  if (!rows.length) return `No shadow plans recorded (${who}). Shadow plans are off unless shadow_model is set on this machine: see docs/SERVER.md.`
  const n = rows.length
  const count = (f: (r: ShadowPlanRow) => boolean) => rows.filter(f).length
  const plans = rows.filter(r => r.outcome === 'plan')
  const proposed = plans.reduce((s, r) => s + r.shadow.actions.length, 0)
  const parsed = plans.reduce((s, r) => s + r.shadow.actions.filter(a => a.ok).length, 0)
  const usd = rows.reduce((s, r) => s + r.usd, 0)
  const realUsd = rows.reduce((s, r) => s + (r.real.usd ?? 0), 0)
  const answered = rows.filter(r => r.outcome !== 'error' && r.outcome !== 'timeout')
  const pairs = [...new Set(rows.map(r => `${label(r.shadowModel)} (${r.shadowEffort}) next to ${label(r.realModel)} (${r.realEffort})`))]
  const other = [['refused', 'declined'], ['cut_off', 'cut off'], ['no_call', 'no tool call'], ['error', 'error'], ['timeout', 'no answer in time']] as const
  const rest = other.map(([k, text]) => [count(r => r.outcome === k), text] as const).filter(([c]) => c > 0).map(([c, text]) => `${c} ${text}`)
  const lines = [
    `Shadow plans (${who}): ${n}, from ${rows.at(-1)!.at.slice(0, 16).replace('T', ' ')} to ${rows[0]!.at.slice(0, 16).replace('T', ' ')} UTC`,
    `Models: ${pairs.join('; ')}`,
    `With a valid tool call: ${plans.length} of ${n}${rest.length ? ` (${rest.join(', ')})` : ''}`,
    `Actions proposed by the shadow: ${proposed}, of which ${parsed} parsed${proposed - parsed ? ` (the parser rejected ${proposed - parsed})` : ''}`,
    `Same action types as the real plan of the same tick: ${count(r => r.outcome === 'plan' && sameTypes(r.real, r.shadow))} of ${plans.length}`,
    `Average cost: $${(usd / n).toFixed(4)} a shadow plan ($${usd.toFixed(2)} in all); the real plans of the same ticks: $${(realUsd / n).toFixed(4)} each`,
    `Average time: ${answered.length ? Math.round(answered.reduce((s, r) => s + r.ms, 0) / answered.length / 1000) : 0} s over the ${answered.length} that answered`,
    'A shadow plan is judged by reading it: nothing here says which plan was the better one.',
    '',
    `The last ${Math.min(o.last ?? 5, n)}:`,
  ]
  for (const r of rows.slice(0, o.last ?? 5)) {
    lines.push(
      `${r.at.slice(0, 16).replace('T', ' ')} ${agentName(r.agentIndex)}`,
      `  real   ${label(r.realModel)} (${r.realEffort}): ${listed(r.real)}`,
      `         ${oneLine(r.real.summary).slice(0, 200)}`,
      `  shadow ${label(r.shadowModel)} (${r.shadowEffort}), $${r.usd.toFixed(4)}, ${Math.round(r.ms / 1000)} s: ${r.outcome === 'plan' ? listed(r.shadow) : (other.find(([k]) => k === r.outcome)?.[1] ?? r.outcome)}`,
      `         ${oneLine(r.shadow.summary).slice(0, 200)}`,
    )
  }
  return lines.join('\n')
}
