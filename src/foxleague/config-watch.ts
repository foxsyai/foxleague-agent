// FoxLeague's game settings (GET /api/config) as a fingerprint, so the agent sees the day FoxLeague changes its rules
// (audit 2026-11-16, MAINNET proposals P-W2 and P-W6). Each snapshot reads the settings anyway: their keys at every
// depth say when FoxLeague added or removed a setting (the surest sign of a deploy), and the values of the rule numbers
// say when one moved. A block with a switch (`live`, `live_from`) the agent has no rule for is shown to the plan as
// numbers and times only.
//
// Everything here comes from FoxLeague and is data: a key is named only when it has the shape of a key (letters,
// digits and underscores, joined by dots), at most MAX_NAMED of them in a line, and no value but a number or a time is
// ever written out. The rest is counted or only hashed.

import { createHash } from 'node:crypto'

/** The longest key path named (the longest real one has 40 characters). */
export const MAX_KEY = 120
/** The most key paths kept: a settings answer with more is not judged at all. */
export const MAX_KEYS = 2000
/** How deep the walk goes; a deeper setting counts by its parent's key. */
export const MAX_DEPTH = 6
/** The most keys or pages a line names; the rest are counted. */
export const MAX_NAMED = 8

/** One key as FoxLeague writes them (`elo_pair_cap`, `Common` in rarity_next). */
const KEY = /^[A-Za-z0-9_]{1,64}$/
/** A key path: `elo_pair_cap`, `competition_levels.elo_k.ranked`, `rarity_match_gate.rarities[].gate`. */
const PATH = /^[A-Za-z0-9_]+(?:\[\])?(?:\.[A-Za-z0-9_]+(?:\[\])?){0,7}$/
/** A key path as taken: its length first, then its shape. */
export const isConfigKey = (s: unknown): s is string => typeof s === 'string' && s.length <= MAX_KEY && PATH.test(s)

/**
 * The settings that move with play, not with the rules: the relays left today, the packs left in the epoch, the
 * relayer addresses and whether a pack can be bought now. Left out of the rule values (their keys still count).
 */
export const MOVING = new Set(['relays_remaining_today', 'common_pack_epoch_remaining', 'relayer_addresses', 'common_pack_available', 'common_pack_unavailable_reason'])

/**
 * The blocks with a switch that the agent's rules read (levels.ts, gate.ts, the executor and the prompt). A block with
 * `live` or `live_from` that is not here gets the generic snapshot line (P-W6). Whoever adds a rule for a new switch
 * adds its key here, so the plan reads one line about it, not two.
 */
export const RULED_SWITCHES = new Set(['rarity_match_gate', 'competition_levels', 'organizer_fees', 'card_bans', 'fusion_mint', 'elo_pair_cap', 'metastaking_discount', 'referral'])

export interface ConfigPrint {
  /** The key paths with the shape of a key, sorted. */
  keys: string[]
  /** Keys that do not have the shape of one: counted, never named. */
  odd: number
  /** Every key path, shaped or not. */
  keysHash: string
  /** The rule values: every number, flag, time and text but the MOVING ones. Only hashed. */
  valuesHash: string
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

/** The fingerprint of a settings answer; null for one that is not an object or is larger than MAX_KEYS. */
export function configPrint(config: unknown): ConfigPrint | null {
  if (!isObject(config)) return null
  const named = new Set<string>()
  const all = new Set<string>()
  const values: string[] = []
  let odd = 0
  let nodes = 0
  const walk = (v: unknown, path: string, raw: string, shaped: boolean, depth: number): boolean => {
    if (++nodes > MAX_KEYS * 8) return false
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const x = v[i]
        if (isObject(x) || Array.isArray(x)) {
          if (!walk(x, `${path}[]`, `${raw}[]`, shaped, depth)) return false
        } else values.push(`${raw}[${i}]=${JSON.stringify(x ?? null)}`)
      }
      return true
    }
    if (!isObject(v)) {
      values.push(`${raw}=${JSON.stringify(v ?? null)}`)
      return true
    }
    if (depth >= MAX_DEPTH) return true
    for (const [k, x] of Object.entries(v)) {
      const ok = shaped && KEY.test(k)
      if (!KEY.test(k)) odd++
      const p = path ? `${path}.${k}` : k
      const r = raw ? `${raw}.${JSON.stringify(k)}` : JSON.stringify(k)
      all.add(r)
      if (ok && isConfigKey(p)) named.add(p)
      if (all.size > MAX_KEYS) return false
      if (!depth && MOVING.has(k)) continue
      if (!walk(x, p, r, ok, depth + 1)) return false
    }
    return true
  }
  if (!walk(config, '', '', true, 0)) return null
  return { keys: [...named].sort(), odd, keysHash: sha256(JSON.stringify([...all].sort())), valuesHash: sha256(JSON.stringify(values.sort())) }
}

/** The key a path hangs from: `a.b[].c` from `a.b`; '' at the top. */
const parent = (p: string): string => (p.includes('.') ? p.slice(0, p.lastIndexOf('.')).replace(/\[\]$/, '') : '')

/**
 * The keys added and removed between two key sets, each named once at the top of what changed: a new block is
 * `elo_pair_cap`, not each of its fields.
 */
export function keyDiff(base: string[], live: string[]): { added: string[]; removed: string[] } {
  const was = new Set(base)
  const now = new Set(live)
  const top = (list: string[], set: Set<string>) => list.filter(p => !set.has(parent(p))).sort()
  const added = live.filter(p => !was.has(p))
  const removed = base.filter(p => !now.has(p))
  return { added: top(added, new Set(added)), removed: top(removed, new Set(removed)) }
}

/** The changed keys as the owner and the plan read them: `elo_pair_cap (new)`, `old_key (gone)`. */
export function changedKeys(d: { added: string[]; removed: string[] }): string[] {
  return [...d.added.filter(isConfigKey).map(k => `${k} (new)`), ...d.removed.filter(isConfigKey).map(k => `${k} (gone)`)]
}

/** At most MAX_NAMED of `items`, the rest counted: "a, b and 3 more". */
export function named(items: string[]): string {
  const more = items.length - MAX_NAMED
  return `${items.slice(0, MAX_NAMED).join(', ')}${more > 0 ? ` and ${more} more` : ''}`
}

/** A switch block of FoxLeague's settings, as numbers and times only. */
export interface RuleSwitch {
  key: string
  /** `live` as served: true, false or null when it is not a flag. */
  live: boolean | null
  /** `live_from` in ms; null when unset; NaN when it is not a time. */
  from: number | null
  /** The block's own numbers (key and value), at most MAX_NUMBERS. */
  numbers: [string, number][]
}

const MAX_NUMBERS = 10
const SWITCH_KEY = /^[a-z0-9_]{1,64}$/
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/

/**
 * The blocks of the settings with a switch (`live` or `live_from`) that the agent has no rule for (not in
 * RULED_SWITCHES). `odd`: such blocks whose key does not have the shape of one, counted only.
 */
export function unknownSwitches(config: unknown): { switches: RuleSwitch[]; odd: number } {
  const switches: RuleSwitch[] = []
  let odd = 0
  if (!isObject(config)) return { switches, odd }
  for (const [key, block] of Object.entries(config)) {
    if (!isObject(block) || !('live' in block || 'live_from' in block) || RULED_SWITCHES.has(key)) continue
    if (!SWITCH_KEY.test(key)) {
      odd++
      continue
    }
    const f = block.live_from
    const from = f === null || f === undefined ? null : typeof f === 'string' && TIME.test(f) ? Date.parse(f) : Number.NaN
    const numbers = Object.entries(block)
      .filter((e): e is [string, number] => e[0] !== 'live' && e[0] !== 'live_from' && SWITCH_KEY.test(e[0]) && typeof e[1] === 'number' && Number.isFinite(e[1]))
      .slice(0, MAX_NUMBERS)
    switches.push({ key, live: typeof block.live === 'boolean' ? block.live : null, from, numbers })
  }
  return { switches: switches.sort((a, b) => a.key.localeCompare(b.key)), odd }
}

/** A time as the snapshot writes them, `2026-11-20T14:00:00Z`. */
export const isoTime = (ms: number): string => new Date(ms).toISOString().replace('.000Z', 'Z')

/** Where a switch stands: "LIVE", "not live yet, from ...", "not switched on yet". */
export function switchState(sw: RuleSwitch): string {
  const from = sw.from === null ? null : Number.isFinite(sw.from) ? isoTime(sw.from) : 'a time that could not be read'
  if (sw.live === true) return from ? `LIVE (from ${from})` : 'LIVE'
  if (sw.live === null) return `live or not could not be read${from ? `, from ${from}` : ''}`
  return from ? `not live yet, from ${from}` : 'not switched on yet'
}

/** The snapshot's lines for the switches the agent has no rule for (P-W6): a key, where it stands and its numbers. */
export function unknownSwitchLines(config: unknown): string[] {
  const { switches, odd } = unknownSwitches(config)
  const lines = switches.slice(0, MAX_NAMED).map(sw => {
    const numbers = sw.numbers.map(([k, v]) => `${k} ${v}`).join(', ')
    return `Rule switch ${sw.key}: ${switchState(sw)}${numbers ? `; ${numbers}` : ''} (a FoxLeague rule your instructions do not cover yet: weigh it from these numbers and the manual, if it has it; the executor's refusals still decide)`
  })
  const more = switches.length - lines.length + odd
  if (more > 0) lines.push(`Rule switches your instructions do not cover: ${more} more not shown`)
  return lines
}
