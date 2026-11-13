// W-12 (Windows real-PC check of 2026-11-13, cosmetic): long lines of the uninstall broke in the middle of a word at
// the edge of the 120-column window ("hold f / unds", "disable-linger / sebas"). Safe: every line of both uninstall
// screens fits in 100 columns, also with the longest Linux user name (32 characters). The PowerShell side is checked
// in test/windows/get-ps1.checks.ps1 ("W-12 ..."). Both failed before the fix.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { running, sh, stubs } from '../audit-1111/install-helpers.ts'

test('W-12 every line of ./install.sh --uninstall fits in 100 columns, also with a user name of 32 characters', async () => {
  const s = stubs()
  // linger is on, as the installer leaves it: the uninstall then says how to turn it off.
  s.stub('loginctl', `printf 'loginctl %s\\n' "$*" >> "$LOG"\ncase "$*" in show-user*) echo Linger=yes ;; esac`)
  const i = running(s)
  const r = await sh(join(i.root, 'install.sh'), ['--uninstall'], i.env(''), { cwd: i.root })
  assert.equal(r.status, 0, r.out)
  const me = execFileSync('id', ['-un'], { encoding: 'utf8' }).trim()
  assert.match(r.out, new RegExp(`loginctl disable-linger ${me}`), 'the linger lines are there')
  const longest = r.out.split('\n').map(l => l.replaceAll(me, 'x'.repeat(32)))
  const over = longest.filter(l => l.length > 100)
  assert.deepEqual(over, [], 'lines over 100 columns')
})
