// STEP-1 (the owner's test of 22 Nov 2026, Settings, Steady to Zeus): BIDS-1 made the Uncommon limit 1,650 by default
// (and Climber's Max bid 1,650), but the dashboard's FOXSY fields took steps of 100: the browser refused the form
// ("Please enter a valid value. The two nearest valid values are 1600 and 1700") and nothing could be saved until the
// owner changed the number. Now every default and every level value is one its field accepts (min, max and step).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, LEVEL_SETTINGS } from '../../src/store/settings.ts'

const HTML = readFileSync(join(import.meta.dirname, '..', '..', 'src/web/dashboard.html'), 'utf8')

/** Each setting the form saves from a number field, by the field's id (the form's own save map). */
function fields(): Map<string, string> {
  const map = new Map([...HTML.matchAll(/(\w+): n\('(s\w+)'\)/g)].map(m => [m[1]!, m[2]!]))
  return map
}

/** What the browser accepts in a number field: its min, max and step (the step counts from min, else from 0). */
function accepts(id: string, value: number): string | null {
  const tag = HTML.match(new RegExp(`<input id="${id}" type="number"[^>]*>`))?.[0]
  if (!tag) return `no number field ${id}`
  const attr = (name: string) => {
    const v = tag.match(new RegExp(` ${name}="([^"]*)"`))?.[1]
    return v === undefined ? undefined : Number(v)
  }
  const min = attr('min')
  const max = attr('max')
  const step = attr('step') ?? 1
  if (min !== undefined && value < min) return `${value} is under the min ${min}`
  if (max !== undefined && value > max) return `${value} is over the max ${max}`
  const steps = (value - (min ?? 0)) / step
  if (Math.abs(steps - Math.round(steps)) > 1e-9) return `${value} is not a step of ${step} from ${min ?? 0}`
  return null
}

test('STEP-1 every default and every level value is one its dashboard field accepts', () => {
  const map = fields()
  assert.ok(map.size >= 15, `the save map was not read: ${map.size} fields`)
  const refused: string[] = []
  const sets: [string, Record<string, unknown>][] = [['default', DEFAULT_SETTINGS as unknown as Record<string, unknown>], ...Object.entries(LEVEL_SETTINGS).map(([k, v]) => [k, v as unknown as Record<string, unknown>] as [string, Record<string, unknown>])]
  for (const [name, values] of sets) {
    for (const [key, id] of map) {
      const value = values[key]
      if (typeof value !== 'number') continue
      const why = accepts(id, value)
      if (why) refused.push(`${name} ${key} (${id}): ${why}`)
    }
    const hours = values.activeHoursUtc
    if (Array.isArray(hours)) {
      for (const [i, id] of ['sFrom', 'sTo'].entries()) {
        const why = accepts(id, hours[i] as number)
        if (why) refused.push(`${name} activeHoursUtc[${i}] (${id}): ${why}`)
      }
    }
  }
  assert.deepEqual(refused, [], 'the browser refuses the form with these values')
})

test('STEP-1 a bid limit can be any round 10 FOXSY, as the owner may type it', () => {
  for (const id of ['sBid', 'sBidCommon', 'sBidUncommon', 'sBidRare', 'sBidEpic', 'sBidLegendary', 'sEntry', 'sShop']) {
    assert.equal(accepts(id, 1650), null, id)
    assert.equal(accepts(id, 1660), null, id)
  }
})
