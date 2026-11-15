// W-5 (Windows real-PC check of 2026-11-13, low): the installer's last screen printed the dashboard address in dark
// blue (ESC[4;34m), which on Windows PowerShell's blue background was only a dark smudge on the photo. Safe: the
// address is bold and underlined in the terminal's own text colour, which every background shows (dark, light and
// PowerShell's blue), still a real hyperlink where the terminal knows them. The test failed before the fix.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { shellFunction } from '../audit-1111/install-helpers.ts'
import { REPO } from '../update-fixtures.ts'

const ESC = '\u001b'

test('W-5 the dashboard link is bold and underlined in the terminal\'s own colour, never a colour of its own', () => {
  const fn = shellFunction(join(REPO, 'install.sh'), 'link')
  const out = spawnSync('bash', ['-c', `LINKS=1\n${fn}\nlink http://localhost:8870`], { encoding: 'utf8' }).stdout
  // Every SGR sequence it prints: none may set a foreground or background colour (30-37, 38, 39, 40-49, 90-107).
  const sgr = [...out.matchAll(/\u001b\[([0-9;]*)m/g)].map(m => m[1]!)
  for (const codes of sgr) for (const c of codes.split(';').map(Number)) assert.ok(!(c >= 30 && c <= 49) && !(c >= 90 && c <= 107), `colour ${c} in ESC[${codes}m`)
  assert.equal(out, `${ESC}]8;;http://localhost:8870${ESC}\\${ESC}[1;4mhttp://localhost:8870${ESC}[0m${ESC}]8;;${ESC}\\`)
})
