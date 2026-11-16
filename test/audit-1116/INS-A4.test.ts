// INS-A4: on a Mac, step 7 loads the agent with `launchctl bootout ... || true` and then `launchctl bootstrap`,
// with nothing around the second. When launchd refuses the bootstrap, `set -e` ends the installer on launchd's own
// line ("Bootstrap failed: 5: Input/output error"): no "Error:" of the installer, no next step, no "Done" screen
// with the dashboard address and the commands. On a run over an install that plays (the guides: "Run the installer
// again at any time"), the bootout one line earlier has just stopped the agent, so it stays stopped until the next
// login. launchd refuses a bootstrap in ordinary cases: a Mac reached over SSH whose user is not logged in at the
// screen (no gui/<uid> domain: "125: Domain does not support specified action"), and a job that is still on its way
// out after the bootout (the agent may take up to 150 s to stop; ExitTimeOut is 180). On Linux every step of the
// same function ends in a sentence of the installer (daemon-reload, enable, restart).
// Safe: a bootstrap that fails is said in the installer's own words, with what to do, and an agent that the
// installer itself stopped is not left stopped without a word.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOGIN_LINES, freshInstall, guided } from '../audit-1111/install-helpers.ts'

test('INS-A4: on a Mac a launchctl bootstrap that fails ends in the installer\'s own sentence with what to do', { timeout: 240_000 }, async () => {
  const i = freshInstall()
  i.s.stub('uname', 'case "${1:-}" in -s | "") echo Darwin ;; -m) /usr/bin/uname -m ;; *) exec /usr/bin/uname "$@" ;; esac')
  i.s.stub('curl', 'exit 7') // nothing answers on the dashboard port
  // launchd as it answers while the job it was just told to boot out is still there, or without a gui domain.
  i.s.stub('launchctl', `printf 'launchctl %s\\n' "$*" >> "$LOG"\ncase "$1" in bootstrap) echo "Bootstrap failed: 5: Input/output error" >&2; exit 5 ;; esac\nexit 0`)
  writeFileSync(join(i.root, '.env'), LOGIN_LINES, { mode: 0o600 })
  const r = await guided(i, ['yes', '', '18997', 'n', 'n'], { args: [] })
  const calls = i.s.calls().filter(c => c.startsWith('launchctl'))
  assert.ok(calls.some(c => c.startsWith('launchctl bootout ')) && calls.some(c => c.startsWith('launchctl bootstrap ')), calls.join('\n'))
  const tail = r.out.slice(r.out.indexOf('7/7'))
  assert.match(tail, /Error: /, `after launchd's refusal the installer says nothing of its own:\n${tail}`)
  assert.match(tail, /install\.sh|launchctl (bootstrap|kickstart)|log in/i, `and names no next step:\n${tail}`)
})
