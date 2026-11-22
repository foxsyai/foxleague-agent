// FIC-2 (the fresh install check of 22 Nov 2026 on bdf4280): `scripts/release/fresh-install-check.sh` waits for texts
// the agent writes to its log (`journal_has`). TEXT-3 took the comma out of the update notice ("send /upgrade here or
// press Update now") and the script still waited for the old text, so the release check failed on a sound agent
// (92 checks passed, 1 failed). The script runs only with Docker, so no test saw it. Now every text it waits for is
// checked against the code: each piece between version numbers must stand in the code as it is.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..')
const SCRIPT = readFileSync(join(ROOT, 'scripts/release/fresh-install-check.sh'), 'utf8')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : /\.(ts|html)$/.test(name) ? [path] : []
  })
}
const CODE = [...files(join(ROOT, 'src')), join(ROOT, 'run.sh'), join(ROOT, 'install.sh')].map(f => readFileSync(f, 'utf8')).join('\n')

/** Texts the agent builds from a call, not from a version number: the pieces that make them. */
const BUILT: Record<string, string[]> = {
  'mode dry run': ['mode ${this.modeText()}', "return 'dry run'"],
}

/** The texts the script waits for in the agent's log, without the ones its own throwaway releases write. */
function awaited(): string[] {
  const texts = [...SCRIPT.matchAll(/journal_has '([^']*)'/g)].map(m => m[1]!)
  return [...new Set(texts)].filter(t => !t.startsWith('fresh-install-check:'))
}

test('FIC-2 every text the fresh install check waits for in the log stands in the code', () => {
  const texts = awaited()
  assert.ok(texts.length >= 5, `the script's journal_has texts were not found: ${texts.length}`)
  const missing: string[] = []
  for (const text of texts) {
    if (BUILT[text]) {
      for (const piece of BUILT[text]) if (!CODE.includes(piece)) missing.push(`${text} (piece ${piece})`)
      continue
    }
    for (const piece of text.split(/v?\d+\.\d+\.\d+/)) {
      if (piece.trim().length >= 4 && !CODE.includes(piece)) missing.push(`${text} (piece "${piece}")`)
    }
  }
  assert.deepEqual(missing, [], 'the check waits for a text the agent no longer writes')
})

test('FIC-2 the notice of a new release, as the check waits for it, is the one the updater writes', () => {
  const notice = SCRIPT.match(/journal_has '(To install it: [^']*)'/)?.[1]
  assert.ok(notice, 'the check waits for the notice of a new release')
  assert.ok(readFileSync(join(ROOT, 'src/update/updater.ts'), 'utf8').includes(notice), notice)
})
