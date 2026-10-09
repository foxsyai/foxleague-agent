// The daily summary on Telegram: at a set hour in the owner's time zone (09:00 Europe/Bucharest on the owner's
// server), one message with yesterday per agent. Routine messages (plans, action results, low funds) wait for it
// unless the owner asks for every update (/updates all); the owner asks for details with /status, /plan N, /log N.

import { agentName } from './names.ts'

/** How far the zone's wall clock is ahead of UTC at this instant, in ms (DST included). */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(instant))
      .map(x => [x.type, x.value]),
  )
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - Math.floor(instant / 1000) * 1000
}

/** The calendar date (YYYY-MM-DD) of an instant in the zone. */
export function zoneDate(instant: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant))
}

/** The instant a date's wall-clock hour happens in the zone. */
export function zoneInstant(date: string, hour: number, timeZone: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const guess = Date.UTC(y, m - 1, d, hour)
  const first = guess - zoneOffsetMs(guess, timeZone)
  // Once more from the first answer: right across a DST change too.
  return guess - zoneOffsetMs(first, timeZone)
}

/** The date before a date (YYYY-MM-DD). */
export function dayBefore(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10)
}

/** When the next summary is due: today's hour in the zone if it is still ahead, else tomorrow's. */
export function nextSummaryAt(now: number, hour: number, timeZone: string): number {
  const today = zoneInstant(zoneDate(now, timeZone), hour, timeZone)
  if (today > now) return today
  const [y, m, d] = zoneDate(now, timeZone).split('-').map(Number) as [number, number, number]
  return zoneInstant(new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10), hour, timeZone)
}

/** A time zone that Intl knows, else UTC. */
export function validZone(zone: string | undefined): string {
  const z = zone?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: z })
    return z
  } catch {
    return 'UTC'
  }
}

export interface AgentDay {
  index: number
  team: string | null
  registered: boolean
  paused: boolean
  done: number
  refused: number
  failed: number
  plans: number
  errors: number
  spentUsd: number
  elo: number | null
  eloChange: number | null
  worthUsd: number | null
  low: boolean
  topups: number
}

/** "7 to 12, 15" from agent indexes. */
function numbers(indexes: number[]): string {
  const n = [...indexes].sort((a, b) => a - b).map(i => i + 1)
  const parts: string[] = []
  for (let i = 0; i < n.length; ) {
    let j = i
    while (j + 1 < n.length && n[j + 1] === n[j]! + 1) j++
    parts.push(j - i >= 2 ? `${n[i]} to ${n[j]}` : n.slice(i, j + 1).join(', '))
    i = j + 1
  }
  return parts.join(', ')
}

const usd = (v: number) => `$${v.toFixed(2)}`

/** The summary message. `label` names the day (for example "Thursday 8 October"). */
export function summaryText(label: string, days: AgentDay[], o: { aiUsd: number | null; live: boolean; killSwitch: boolean; waitingTopUps: number }): string {
  // Only an agent with nothing at all to tell waits in the one line: errors, plans and a pause are told per agent.
  const idle = days.filter(d => !d.registered && !d.done && !d.refused && !d.failed && !d.topups && !d.errors && !d.plans && !d.paused)
  const shown = days.filter(d => !idle.includes(d))
  const lines = [
    `Daily summary, ${label} (${o.live ? 'LIVE' : 'dry run'}${o.killSwitch ? ', KILL SWITCH ON' : ''})`,
    '',
    ...shown.map(d => {
      const parts = [
        d.done || d.refused || d.failed ? `${d.done} done, ${d.refused} refused${d.failed ? `, ${d.failed} failed` : ''}` : 'no actions',
        ...(d.spentUsd > 0.005 ? [`${usd(d.spentUsd)} spent`] : []),
        ...(d.elo !== null ? [`ELO ${d.elo}${d.eloChange ? ` (${d.eloChange > 0 ? '+' : ''}${d.eloChange})` : ''}`] : []),
        ...(d.worthUsd !== null ? [`worth ${usd(d.worthUsd)}${d.low ? ' LOW' : ''}`] : []),
        ...(d.topups ? [`${d.topups} top-up${d.topups > 1 ? 's' : ''}`] : []),
        ...(d.errors ? [`${d.errors} plan error${d.errors > 1 ? 's' : ''}`] : []),
      ]
      return `${agentName(d.index)}${d.team ? ` · ${d.team}` : ''}${d.paused ? ' (paused)' : ''}: ${parts.join(', ')}`
    }),
    ...(idle.length ? [`${idle.length === 1 ? 'Agent' : 'Agents'} ${numbers(idle.map(d => d.index))}: not registered yet, waiting for funds`] : []),
    '',
    `Spent in all: ${usd(days.reduce((s, d) => s + d.spentUsd, 0))}${o.aiUsd !== null ? `; AI ${usd(o.aiUsd)} (UTC day)` : ''}.${o.waitingTopUps ? ` ${o.waitingTopUps} top-up${o.waitingTopUps > 1 ? 's wait' : ' waits'} for a code (/topup).` : ''}`,
    'Details any time: /status, /plan N, /log N, /budget N. Every update as it happens: /updates all.',
  ]
  return lines.join('\n')
}
