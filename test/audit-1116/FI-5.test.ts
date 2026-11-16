// FI-5 (the owner's text rule on the new screen lines and guide sentences of MAC-1, R78A-1, R78A-2 and R78A-3): the
// project holds every sentence an owner reads to "no comma before the last and/or" with one pattern, /, (and|or) /
// (get.ps1's own check "every sentence on the screen", WIN-1, D12, DOCS-10, P-O2, and R2I-7 of this same round, which
// took one such comma out of the Linux page). The lines PR #78 added have it again:
//   install.sh mac_off_note (twice): "... (System Settings, General, Login Items & Extensions, or launchctl disable) ..."
//   install.sh mac_after_update:     "... it stays stopped: it starts at your next login, or now with: launchctl bootstrap ..."
//     (its twin eleven lines above has none: "from its next start, at your next login or now with:")
//   INSTALL.md and start/install-mac.mdx: "... Login Items & Extensions, and switching it off there stops the agent."
//   INSTALL.md: "... an update restarts it into the new version, and `launchctl enable` alone switches it on again."
// Right: the screen lines of the Mac's off switch and of its update, and the paragraph the guides got with them, have
// no comma before a closing "and" or "or".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { shellFunction } from '../audit-1111/install-helpers.ts'

const TREE = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '')
const RULE = /, (and|or) /

test('FI-5: the screen lines of the Mac off switch and of the Mac update have no comma before a closing and/or', () => {
  const lines: string[] = []
  for (const fn of ['mac_off_note', 'mac_after_update', 'mac_load']) {
    for (const l of shellFunction(`${TREE}/install.sh`, fn).split('\n')) if (/^\s*(if .*; then )?(info|die) "/.test(l) || /\binfo "/.test(l)) lines.push(l.trim())
  }
  assert.ok(lines.length >= 8, `the screen lines were found (${lines.length})`)
  const bad = lines.filter(l => RULE.test(l))
  assert.deepEqual(bad, [], `a comma before and/or:\n${bad.join('\n')}`)
})

test('FI-5: the paragraph the guides got for "FoxLeague Agent" in Login Items & Extensions has no comma before a closing and/or', () => {
  const bad: string[] = []
  for (const f of ['INSTALL.md', 'site/src/content/docs/start/install-mac.mdx']) {
    const text = readFileSync(`${TREE}/${f}`, 'utf8')
    const at = text.indexOf('macOS shows the agent as "FoxLeague Agent"')
    assert.ok(at >= 0, `${f}: the paragraph is there`)
    const paragraph = text.slice(at, text.indexOf('\n\n', at)).replace(/\s+/g, ' ')
    for (const s of paragraph.split(/(?<=\.) /)) if (RULE.test(s)) bad.push(`${f}: ${s}`)
  }
  assert.deepEqual(bad, [], `a comma before and/or:\n${bad.join('\n')}`)
})
