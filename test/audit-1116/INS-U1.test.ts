// INS-U1 (unproven item U1 of the INSTALL review of 16 Nov 2026): on a Mac, step 7 of the installer boots the running
// job out and loads it again right after. The agent may take up to 150 s to stop (it finishes an action that is
// signing or waits for its outcome; the plist gives it ExitTimeOut 180). launchd answers such a bootout with
// "Boot-out failed: 36: Operation now in progress" and keeps the job listed until the process has ended; a bootstrap
// of the same label meanwhile is refused. Since INS-A4 the installer waits 10 seconds and then tries, so an agent that
// needs longer than that to stop is refused at every run of the installer over it, and stays stopped until the owner
// runs the installer again (INS-A4's sentence: "it may still be stopping: wait two minutes").
// Shown with a launchctl stand-in that behaves as described: whether the real launchd answers 36 here is from its
// documented behaviour and from the record of others, not seen on a Mac in this test.
// Right: after a bootout that says the job is on its way out, the installer waits as long as the uninstall does
// (up to 185 s, what launchd itself gives the job) and then loads the agent again.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOGIN_LINES, freshInstall, guided } from '../audit-1111/install-helpers.ts'

test('INS-U1: on a Mac the installer run again over a busy agent waits for it to stop and loads it again', { timeout: 240_000 }, async () => {
  const i = freshInstall()
  i.s.stub('uname', 'case "${1:-}" in -s | "") echo Darwin ;; -m) /usr/bin/uname -m ;; *) exec /usr/bin/uname "$@" ;; esac')
  // The dashboard answers once the agent is loaded (so step 7 does not wait 30 s for it).
  i.s.stub('curl', 'case "$*" in *healthz*) exit 0 ;; esac\nexit 6')
  // launchd: the job is loaded (the agent plays). A bootout finds it busy: "36: Operation now in progress", and the
  // job stays listed for 12 seconds while it finishes an action. A bootstrap while it is listed is refused.
  i.s.stub(
    'launchctl',
    [
      `printf 'launchctl %s\\n' "$*" >> "$LOG"`,
      'S="$LOG.state"; now=$(date +%s)',
      'listed() { [ -f "$S" ] || return 1; read -r st until < "$S"; if [ "$st" = going ] && [ "$now" -ge "$until" ]; then rm -f "$S"; return 1; fi; return 0; }',
      'case "$1" in',
      '  print) listed || exit 113; echo "state = running"; exit 0 ;;',
      '  bootout) if listed; then echo "going $((now + 12))" > "$S"; echo "Boot-out failed: 36: Operation now in progress" >&2; exit 36; fi; echo "Boot-out failed: 3: No such process" >&2; exit 3 ;;',
      '  bootstrap) if listed; then echo "Bootstrap failed: 5: Input/output error" >&2; exit 5; fi; echo loaded > "$S"; exit 0 ;;',
      'esac',
      'exit 0',
    ].join('\n'),
  )
  writeFileSync(join(i.s.dir, 'calls.log.state'), 'loaded\n')
  writeFileSync(join(i.root, '.env'), LOGIN_LINES, { mode: 0o600 })
  const r = await guided(i, ['yes', '', '18997', 'n', 'n'], { args: [] })
  const tail = r.out.slice(r.out.indexOf('7/7'))
  assert.equal(r.status, 0, `the installer did not load the agent again after it stopped:\n${tail}`)
  assert.match(tail, /Done/, tail)
  assert.equal(readFileSync(join(i.s.dir, 'calls.log.state'), 'utf8').trim(), 'loaded', 'the agent is loaded again')
  assert.ok(i.s.calls().filter(c => c.startsWith('launchctl bootstrap ')).length >= 1, i.s.calls().join('\n'))
})
