// R2I-U1 (round two of the audit of 16 Nov 2026, INSTALL3's unproven item on INS-U1, proven with the stand-in): on a
// Mac, step 7 waits up to 185 s for the running job to go only when launchd answers its bootout with 36 ("Operation now
// in progress"). A bootout that answers 0 or 37 while launchd still lists the job (a busy agent finishing an action)
// got 10 s; the bootstrap of the same label then fails and the agent stays stopped until the owner runs the installer
// again. Right: whenever the job is still listed after the bootout, the installer waits as the uninstall does.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOGIN_LINES, freshInstall, guided } from '../audit-1111/install-helpers.ts'

for (const status of [0, 37]) {
  test(`R2I-U1: on a Mac a bootout that answers ${status} while the busy job is still listed is waited for, then the agent is loaded again`, { timeout: 240_000 }, async () => {
    const i = freshInstall()
    i.s.stub('uname', 'case "${1:-}" in -s | "") echo Darwin ;; -m) /usr/bin/uname -m ;; *) exec /usr/bin/uname "$@" ;; esac')
    i.s.stub('curl', 'case "$*" in *healthz*) exit 0 ;; esac\nexit 6')
    // launchd: the job is loaded. A bootout answers `status` and the job stays listed for 12 seconds while it finishes
    // an action. A bootstrap while it is listed is refused.
    i.s.stub(
      'launchctl',
      [
        `printf 'launchctl %s\\n' "$*" >> "$LOG"`,
        'S="$LOG.state"; now=$(date +%s)',
        'listed() { [ -f "$S" ] || return 1; read -r st until < "$S"; if [ "$st" = going ] && [ "$now" -ge "$until" ]; then rm -f "$S"; return 1; fi; return 0; }',
        'case "$1" in',
        '  print) listed || exit 113; echo "state = running"; exit 0 ;;',
        `  bootout) if listed; then echo "going $((now + 12))" > "$S"; exit ${status}; fi; echo "Boot-out failed: 3: No such process" >&2; exit 3 ;;`,
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
    assert.match(tail, /Waiting for the agent that runs to stop/)
    assert.equal(readFileSync(join(i.s.dir, 'calls.log.state'), 'utf8').trim(), 'loaded', 'the agent is loaded again')
  })
}
