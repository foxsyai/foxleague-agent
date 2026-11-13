// Shadow plans (the owner, 2026-11-11): right after an agent's real plan the service sends the very same request to a
// second model and only records what that model would have done, so an owner can compare a cheaper model with the one
// that plays before switching. A shadow plan is never carried out, never shown to the playing model and changes
// nothing the agents play by. Since 2026-11-12 several shadow models can be set at once: each gets the request and is
// recorded by itself. Since 2026-11-13 each entry may carry its own effort (`claude-opus-5-5:low`) and each agent may
// have its own list (kv shadow_model_agent_N, N as agents are numbered from 1), so the same model can plan in the
// shadow at other efforts next to the one that plays. Also since 2026-11-13 the entry `same` asks the very model and
// effort of the real plan again (a repeat): the same model at the same effort does not plan the same twice either, and
// how often it agrees with itself is the baseline the other shadows are read against. This module holds what is plain
// data about a shadow plan: the setting, the copy that is kept and the report. It knows nothing of wallets, the chain
// or the code that carries actions out.

import type { Store } from '../store/db.ts'
import { agentName } from '../names.ts'
import { EFFORTS, MODELS, isKnownModel, type Effort, type Plan, type PlanOutcome } from './strategist.ts'

/** The kind of a shadow plan's row in the activity. Every reader of the activity that counts or replays rows leaves it out. */
export const SHADOW_KIND = 'shadow'

/** A shadow request that has not answered after this long is given up (the request is cancelled, nothing is asked again). */
export const SHADOW_TIMEOUT_MS = 10 * 60_000

/**
 * The entry of a shadow list that asks the real plan's own model and effort again: a repeat. It is written exactly so,
 * takes no effort after a colon and never rests: it follows the model and effort the real plan of that tick was asked
 * with, whatever they are.
 */
export const SAME = 'same'

/** How the activity and the report name a repeat. */
const AGAIN = "the real plan's own model and effort again"

/** An entry as the log and the CLI name it: `same` in plain words, any other as written. */
export const entryText = (entry: string): string => (entry === SAME ? `${SAME} (the real plan's model and effort again)` : entry)

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

/** The shadow models that run next to one real plan, their efforts and why an entry of the setting does not run. */
export interface ShadowChoices {
  /**
   * The entries that get this plan's request, in the order they were written, each (model and effort) once: a model
   * id, a model id and its effort after a colon (`claude-opus-5-5:low`) or `same`. Empty: no shadow plans. shadowRuns
   * reads them as models and efforts.
   */
  readonly models: string[]
  /** The effort of an entry written without its own (shadow_effort, else medium). */
  readonly effort: Effort
  /** For the log: one reason per entry that was left out (not on the list or the model that plays). */
  readonly leftOut: string[]
  /** The model and effort `same` runs at: the pair the real plan was asked with. Only there while `same` runs. */
  readonly repeat?: { readonly model: string; readonly effort: Effort }
}

/** The entries of a setting that are read: the list of models has four, and a setting typed by hand must not fill the log. */
const MAX_ENTRIES = 16

/** The kv key of one agent's own list of shadow models: N as agents are numbered in the CLI and the dashboard, from 1. */
export const agentShadowKey = (index: number): string => `shadow_model_agent_${index + 1}`

/**
 * The list that holds for an agent: its own (kv shadow_model_agent_N) when that holds anything but blanks, else the
 * all-agents one (kv shadow_model, else AGENT_SHADOW_MODEL from the environment). Without an agent, the all-agents one.
 */
function listOf(store: Store, agentIndex?: number | null): { text: string; own: boolean } {
  if (agentIndex !== undefined && agentIndex !== null) {
    const own = store.getKv(agentShadowKey(agentIndex))
    if (own !== undefined && own.trim()) return { text: own, own: true }
  }
  return { text: store.getKv('shadow_model') ?? process.env.AGENT_SHADOW_MODEL ?? '', own: false }
}

/** Whether an agent has a list of its own, set on the machine (else it follows the all-agents list). */
export function hasOwnShadowList(store: Store, agentIndex: number): boolean {
  return listOf(store, agentIndex).own
}

/**
 * The setting as written: entries separated by commas, each once. Not set, empty or "off" means none; "off" anywhere
 * among several switches all of them off, so a half-typed setting never costs anything.
 */
function entriesSet(store: Store, agentIndex?: number | null): { read: string[]; unread: number } {
  const ids = [...new Set(listOf(store, agentIndex).text.split(',').map(id => id.trim()).filter(Boolean))]
  if (ids.some(id => id.toLowerCase() === 'off')) return { read: [], unread: 0 }
  return { read: ids.slice(0, MAX_ENTRIES), unread: Math.max(0, ids.length - MAX_ENTRIES) }
}

/** One entry of the setting: its model and its own effort, null when it has none (`claude-opus-5-5:low`, `claude-haiku-5-5`). */
export function entryOf(entry: string): { model: string; effort: string | null } {
  const at = entry.indexOf(':')
  return at < 0 ? { model: entry, effort: null } : { model: entry.slice(0, at), effort: entry.slice(at + 1) }
}

const isEffort = (effort: string): effort is Effort => (EFFORTS as readonly string[]).includes(effort)

/** An entry that can run: `same`, or a model of the list with no effort or one of the five. */
const runnable = (entry: string): boolean => {
  if (entry === SAME) return true
  const e = entryOf(entry)
  return isKnownModel(e.model) && (e.effort === null || isEffort(e.effort))
}

/**
 * Whether an entry rests while this model and effort play: one with its own effort only at that very model and effort,
 * one without at its model whatever the effort, as before entries had efforts. `playing` given as a model alone (no
 * effort known) rests only the entries without an effort. `same` never rests: it is the pair that plays.
 */
export function rests(entry: string, playing: string | { model: string; effort: string | null }): boolean {
  if (entry === SAME) return false
  const e = entryOf(entry)
  const p = typeof playing === 'string' ? { model: playing, effort: null } : playing
  return e.model === p.model && (e.effort === null || e.effort === p.effort)
}

/**
 * The shadow models of a plan and their efforts. The list is the agent's own (kv shadow_model_agent_N) when it has
 * one, else the all-agents one: the database's setting (kv shadow_model), else AGENT_SHADOW_MODEL from the
 * environment. It holds one entry or several separated by commas, each a model id with or without its effort after a
 * colon, or `same`. Not set, empty or "off" means no shadow plans, which is the default. An entry without an effort
 * takes shadow_effort (else AGENT_SHADOW_EFFORT, else medium; one nobody knows is medium). An entry the list of models
 * does not have, an effort that is not one of the five and an entry that rests (see `rests`) are left out, each with
 * its reason for the log; a repeated model and effort counts once. `same` runs at `playing` (a repeat) and never rests;
 * it is left out when `playing` is not a model of the list with one of the five efforts, since the pair it would run is
 * then not known. An explicit entry at the playing pair rests as before, so with `same` beside it the pair runs once.
 * There is no dashboard control and no Telegram command for any of it: it adds AI spend, so it is switched on only on
 * the machine itself.
 */
export function shadowChoices(store: Store, playing: string | { model: string; effort: string | null }, agentIndex?: number | null): ShadowChoices {
  const { read, unread } = entriesSet(store, agentIndex)
  const fallback = (store.getKv('shadow_effort') ?? process.env.AGENT_SHADOW_EFFORT ?? 'medium').trim()
  const effort: Effort = isEffort(fallback) ? fallback : 'medium'
  const models: string[] = []
  const leftOut: string[] = []
  const pairs = new Set<string>()
  let repeat: { model: string; effort: Effort } | undefined
  for (const id of read) {
    // A setting typed by hand: only what a model id and an effort can hold reaches the log.
    const named = id.slice(0, 60).replace(/[^\w.:-]/g, '?')
    const e = entryOf(id)
    if (id === SAME) {
      const p = typeof playing === 'string' ? { model: playing, effort: null } : playing
      if (!isKnownModel(p.model)) leftOut.push(`${SAME} needs a model of the list, and the one that plays (${String(p.model).slice(0, 60).replace(/[^\w.:-]/g, '?')}) is not`)
      else if (p.effort === null || !isEffort(p.effort)) leftOut.push(`${SAME} needs the effort that plays, which is not known here`)
      else {
        const pair = `${p.model}:${p.effort}`
        if (!pairs.has(pair)) models.push(SAME)
        pairs.add(pair)
        repeat = { model: p.model, effort: p.effort }
      }
    } else if (e.model === SAME) leftOut.push(`${named} has an effort, and ${SAME} takes none: it is the real plan's model and effort`)
    else if (!isKnownModel(e.model)) leftOut.push(`${named} is not a model on the list (${Object.keys(MODELS).join(', ')})`)
    else if (e.effort !== null && !isEffort(e.effort)) leftOut.push(`${named} has an effort that is not one of ${EFFORTS.join(', ')}`)
    else if (rests(id, playing)) {
      leftOut.push(e.effort === null ? `${named} is the model that plays, and a shadow plan needs another one` : `${named} is the model and effort that play, and a shadow plan needs another model or effort`)
    } else {
      const pair = `${e.model}:${e.effort ?? effort}`
      if (!pairs.has(pair)) models.push(id)
      pairs.add(pair)
    }
  }
  if (unread) leftOut.push(`${unread} more entries are not read (${MAX_ENTRIES} at most)`)
  // `repeat` only while `same` runs: a setting without it reads exactly as before.
  return { models, effort, leftOut, ...(repeat && models.includes(SAME) ? { repeat } : {}) }
}

/**
 * The models and efforts that get a plan's request, from its choices: each entry with its own effort or the shared one,
 * `same` at the pair the real plan was asked with (none without that pair).
 */
export function shadowRuns(choices: ShadowChoices): { model: string; effort: Effort }[] {
  return choices.models.flatMap(id => {
    if (id === SAME) return choices.repeat ? [{ model: choices.repeat.model, effort: choices.repeat.effort }] : []
    const e = entryOf(id)
    return [{ model: e.model, effort: e.effort !== null && isEffort(e.effort) ? e.effort : choices.effort }]
  })
}

/**
 * What the log says of a setting of which an entry does not run, or null when every entry runs (or none is set). The
 * service says it once, not at every plan.
 */
export function shadowNote(choices: ShadowChoices): string | null {
  if (!choices.leftOut.length) return null
  return `${choices.models.length ? `shadow plans run by ${choices.models.map(entryText).join(', ')} only` : 'shadow plans are off'}: ${choices.leftOut.join('; ')}`
}

/**
 * The shadow entries that are set for an agent (its own list, else the all-agents one) or, without an agent, the
 * all-agents ones, whatever model plays: the entries that can run (`same`, or a model of the list with no effort or one
 * of the five), each once; none when nothing is set or it is "off". One of them rests while its model (and its effort,
 * when it has one) plays and runs under any other, which is why a switch of the playing model or effort away from it
 * starts its shadow plans and asks for the password (wakesShadow in src/web/server.ts). `same` never rests, so no
 * switch starts it: it costs what the pair that plays costs, and a switch to a dearer pair asks for the password anyway.
 */
export function shadowModelsSet(store: Store, agentIndex?: number | null): string[] {
  return entriesSet(store, agentIndex).read.filter(runnable)
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
 * answer in time) the one line that says so. A repeat (`repeat`: the real plan's own model and effort) says so.
 */
export function shadowLine(o: { model: string; effort: string; usd: number; ms: number; text: string; plan?: RecordedPlan; repeat?: boolean }): string {
  const head = `shadow plan by ${MODELS[o.model]?.label ?? o.model} (${o.effort})${o.repeat ? `, ${AGAIN}` : ''}, $${o.usd.toFixed(4)}, ${Math.round(o.ms / 1000)} s: `
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

const minute = (at: string): string => at.slice(0, 16).replace('T', ' ')
const OTHER_OUTCOMES = [['refused', 'declined'], ['cut_off', 'cut off'], ['no_call', 'no tool call'], ['error', 'error'], ['timeout', 'no answer in time']] as const

/** The numbers of one shadow model's plans (or of all, where there is one model): the lines from "Models" to "Average time". */
function summaryOf(rows: ShadowPlanRow[]): string[] {
  const n = rows.length
  const count = (f: (r: ShadowPlanRow) => boolean) => rows.filter(f).length
  const plans = rows.filter(r => r.outcome === 'plan')
  const proposed = plans.reduce((s, r) => s + r.shadow.actions.length, 0)
  const parsed = plans.reduce((s, r) => s + r.shadow.actions.filter(a => a.ok).length, 0)
  const usd = rows.reduce((s, r) => s + r.usd, 0)
  const realUsd = rows.reduce((s, r) => s + (r.real.usd ?? 0), 0)
  const answered = rows.filter(r => r.outcome !== 'error' && r.outcome !== 'timeout')
  const pairs = [...new Set(rows.map(r => `${label(r.shadowModel)} (${r.shadowEffort}) next to ${label(r.realModel)} (${r.realEffort})`))]
  const rest = OTHER_OUTCOMES.map(([k, text]) => [count(r => r.outcome === k), text] as const).filter(([c]) => c > 0).map(([c, text]) => `${c} ${text}`)
  return [
    `Models: ${pairs.join('; ')}`,
    `With a valid tool call: ${plans.length} of ${n}${rest.length ? ` (${rest.join(', ')})` : ''}`,
    `Actions proposed by the shadow: ${proposed}, of which ${parsed} parsed${proposed - parsed ? ` (the parser rejected ${proposed - parsed})` : ''}`,
    `Same action types as the real plan of the same tick: ${count(r => r.outcome === 'plan' && sameTypes(r.real, r.shadow))} of ${plans.length}`,
    `Average cost: $${(usd / n).toFixed(4)} a shadow plan ($${usd.toFixed(2)} in all); the real plans of the same ticks: $${(realUsd / n).toFixed(4)} each`,
    `Average time: ${answered.length ? Math.round(answered.reduce((s, r) => s + r.ms, 0) / answered.length / 1000) : 0} s over the ${answered.length} that answered`,
  ]
}

/** The shadow models of the rows: those of the list of models in its order, then any other in the order met. */
function modelsOf(rows: ShadowPlanRow[]): string[] {
  const met = [...new Set(rows.map(r => r.shadowModel))]
  const listedFirst = Object.keys(MODELS).filter(id => met.includes(id))
  return [...listedFirst, ...met.filter(id => !listedFirst.includes(id))]
}

/** A shadow model at one effort, as a row records it. */
type ShadowPair = { model: string; effort: string }
const samePair = (r: ShadowPlanRow, p: ShadowPair): boolean => r.shadowModel === p.model && r.shadowEffort === p.effort

/**
 * The shadow models and efforts of the rows (since 2026-11-13 one model can plan in the shadow at several efforts):
 * the models in the order of modelsOf, each model's efforts from the least, then any other effort in the order met.
 */
function pairsOf(rows: ShadowPlanRow[]): ShadowPair[] {
  return modelsOf(rows).flatMap(model => {
    const met = [...new Set(rows.filter(r => r.shadowModel === model).map(r => r.shadowEffort))]
    const known: string[] = EFFORTS.filter(e => met.includes(e))
    return [...known, ...met.filter(e => !known.includes(e))].map(effort => ({ model, effort }))
  })
}

/** A row of a repeat (`same`): its shadow model and effort are the real plan's own. No shadow of another entry can be one. */
const isRepeat = (r: ShadowPlanRow): boolean => r.shadowModel === r.realModel && r.shadowEffort === r.realEffort

/** A block of the report: one shadow model at one effort, its repeats apart from its shadows next to another real pair. */
type ShadowGroup = ShadowPair & { repeat: boolean }
const inGroup = (r: ShadowPlanRow, g: ShadowGroup): boolean => samePair(r, g) && isRepeat(r) === g.repeat

/** The blocks of the rows, in the order of pairsOf; at one model and effort the shadows of another real pair first, then the repeats. */
function groupsOf(rows: ShadowPlanRow[]): ShadowGroup[] {
  return pairsOf(rows).flatMap(p => [false, true].filter(repeat => rows.some(r => inGroup(r, { ...p, repeat }))).map(repeat => ({ ...p, repeat })))
}

/** The shadow plans of one real plan are recorded within this long of each other: each is given up after SHADOW_TIMEOUT_MS. */
const SAME_TICK_MS = SHADOW_TIMEOUT_MS + 60_000

/**
 * The rows grouped by the real plan they stand next to, newest first: the same agent, the same recorded real plan
 * (model, effort and the plan itself, with its cost), recorded within the time one tick's shadow plans can take, and
 * each shadow model at each effort once. The table has no column for it and needs none. Two rows that only look alike (the same
 * agent with the very same real plan twice) are told apart by the time or by a shadow model met twice.
 */
function byRealPlan(rows: ShadowPlanRow[]): ShadowPlanRow[][] {
  const groups: ShadowPlanRow[][] = []
  const newest = new Map<string, ShadowPlanRow[]>()
  for (const r of rows) {
    const key = JSON.stringify([r.agentIndex, r.realModel, r.realEffort, r.real])
    const group = newest.get(key)
    if (group && !group.some(x => samePair(x, { model: r.shadowModel, effort: r.shadowEffort })) && Date.parse(group[0]!.at) - Date.parse(r.at) <= SAME_TICK_MS) group.push(r)
    else {
      const next = [r]
      newest.set(key, next)
      groups.push(next)
    }
  }
  return groups
}

/**
 * The report of `cli shadow-report`: how many shadow plans, how many answered with a plan, how many of their actions
 * parsed, how often the shadow proposed the same action types as the real plan of the same tick and the average cost
 * and time, once per shadow model when there are several, and once per model and effort when a model planned at
 * several efforts (each block then named like "Opus 5.5 (low)"); then the last real plans, each with its model and
 * effort and its shadow plans below it. Repeats (`same`: a row whose shadow model and effort are its real plan's own)
 * are a block of their own per model and effort, named "Opus 5.5 (xhigh), the real plan's own model and effort again",
 * and marked "repeat" under their real plan. `rows` newest first, as the store gives them; rows of one agent for `N`.
 * Rows without a repeat give the report as before, line for line.
 */
export function shadowReport(rows: ShadowPlanRow[], o: { last?: number; agentIndex?: number | null } = {}): string {
  const who = o.agentIndex === null || o.agentIndex === undefined ? 'all agents' : agentName(o.agentIndex)
  if (!rows.length) return `No shadow plans recorded (${who}). Shadow plans are off unless shadow_model is set on this machine (or shadow_model_agent_N for agent N): see docs/SERVER.md.`
  const groups = groupsOf(rows)
  const repeats = rows.filter(isRepeat).length
  // Named by the model alone while each model planned at one effort and nothing repeated, as before; else by model and
  // effort. A repeat is named by its model and effort and in words.
  const byEffort = repeats > 0 || pairsOf(rows).length > modelsOf(rows).length
  const name = (g: ShadowGroup): string => (g.repeat ? `${label(g.model)} (${g.effort}), ${AGAIN}` : byEffort ? `${label(g.model)} (${g.effort})` : label(g.model))
  const span = `from ${minute(rows.at(-1)!.at)} to ${minute(rows[0]!.at)} UTC`
  const lines: string[] = []
  if (groups.length === 1 && !repeats) lines.push(`Shadow plans (${who}): ${rows.length}, ${span}`, ...summaryOf(rows))
  else {
    lines.push(repeats
      ? `Shadow plans (${who}): ${rows.length}, ${span}; ${repeats} of them by ${AGAIN}`
      : `Shadow plans (${who}): ${rows.length} by ${groups.length} ${byEffort ? 'shadow pairs (model and effort)' : 'shadow models'}, ${span}`)
    for (const g of groups) {
      const own = rows.filter(r => inGroup(r, g))
      lines.push('', `${name(g)}: ${own.length} shadow plan${own.length === 1 ? '' : 's'}`, ...summaryOf(own))
    }
    lines.push('')
  }
  const ticks = byRealPlan(rows)
  const last = ticks.slice(0, o.last ?? 5)
  lines.push('A shadow plan is judged by reading it: nothing here says which plan was the better one.')
  if (repeats) lines.push(`A repeat asks the real plan's own model and effort again: how often it agrees with the real plan is the baseline for the other groups.`)
  lines.push('', `The last ${last.length}:`)
  for (const tick of last) {
    // The first recorded of the group is the nearest to the moment the real plan was made.
    const first = tick.at(-1)!
    lines.push(
      `${minute(first.at)} ${agentName(first.agentIndex)}`,
      `  real   ${label(first.realModel)} (${first.realEffort}): ${listed(first.real)}`,
      `         ${oneLine(first.real.summary).slice(0, 200)}`,
    )
    const at = (r: ShadowPlanRow): number => groups.findIndex(g => inGroup(r, g))
    for (const r of [...tick].sort((a, b) => at(a) - at(b))) {
      lines.push(
        `  ${isRepeat(r) ? 'repeat' : 'shadow'} ${label(r.shadowModel)} (${r.shadowEffort}), $${r.usd.toFixed(4)}, ${Math.round(r.ms / 1000)} s: ${r.outcome === 'plan' ? listed(r.shadow) : (OTHER_OUTCOMES.find(([k]) => k === r.outcome)?.[1] ?? r.outcome)}`,
        `         ${oneLine(r.shadow.summary).slice(0, 200)}`,
      )
    }
  }
  return lines.join('\n')
}
