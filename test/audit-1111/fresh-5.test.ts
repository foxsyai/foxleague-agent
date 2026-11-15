// FRESH-5 (fresh Ubuntu walk-through, 2026-11-11): the pasted line is typed in the home folder, and the installer
// ends there. Its last screen then listed `./install.sh --update`, `./install.sh --uninstall` and `./cli.sh` with
// no word about the folder they are in: typed as shown they answered "-bash: ./install.sh: No such file or
// directory". Safe: the last screen names the folder (a `cd` line the newcomer can paste), and so does the line
// that tells how to see the recovery words again.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOGIN_LINES, freshInstall, guided, sh } from './install-helpers.ts'

test('FRESH-5: the last screen of the installer names the folder its commands are typed in', { timeout: 120_000 }, async () => {
  const i = freshInstall()
  writeFileSync(join(i.root, '.env'), LOGIN_LINES, { mode: 0o600 })
  const r = await guided(i, ['yes', '', '18997', 'n', 'n'])
  assert.equal(r.status, 0, r.out)
  const last = r.out.slice(r.out.indexOf('Everyday commands'))
  assert.match(last, /\.\/install\.sh --update/)
  const cd = `cd ${i.root}`
  assert.ok(last.includes(cd), `the last screen has no "${cd}":\n${last}`)
  assert.ok(last.indexOf(cd) < last.indexOf('./install.sh --update'), 'the folder comes before the commands that need it')
  // The way back to the recovery words, told right after the typed yes, names the folder too.
  const words = /To see them again later.*$/m.exec(r.out)?.[0] ?? ''
  assert.ok(words.includes(i.root), `"${words}" does not name ${i.root}`)

  // Typed as shown from the home folder, the commands exist.
  const typed = await sh('', ['-c', `${cd} && ./install.sh --help && ./cli.sh address 1`], { HOME: i.home, PATH: i.env.PATH! }, { cwd: i.home })
  assert.equal(typed.status, 0, typed.out)
  assert.match(typed.out, /^agent 1: erd1/m)
})
