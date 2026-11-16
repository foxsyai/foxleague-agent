// FI-U3 (the INSTALL reviewer's unproven U3 of the final pass, proven here): on a Mac, `./install.sh --update` with an
// older plist moves it to the launcher and loads the job again (mac_load): it boots the running job out, then waits up
// to three minutes for a busy agent to finish before the bootstrap. Ctrl-C during that wait ends the script at once,
// without a word: the job is booted out (the agent stops once its action is done) and nothing loads it again before
// the next login. The owner sees the screen end on "Waiting for the agent that runs to stop" and cannot tell that the
// agent is no longer playing.
// Right: a stop of the update during that wait says that the background agent is not running now and how to start it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildRelease, publish, serve } from '../update-fixtures.ts'
import { KEY, realTree, running, stubs, tmp } from '../audit-1111/install-helpers.ts'

const LABEL = 'ai.foxleague.agent'
const MAC = 'case "${1:-}" in -s | "") echo Darwin ;; -m) /usr/bin/uname -m ;; *) exec /usr/bin/uname "$@" ;; esac'
const bashPath = (): string => execFileSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).trim()

// launchd with the agent's job loaded: a bootout sets it going for a minute (a busy agent), meanwhile it stays listed.
const LAUNCHD = [
  `printf 'launchctl %s\\n' "$*" >> "$LOG"`,
  'S="$LOG.state"; now=$(date +%s)',
  'listed() { [ -f "$S" ] || return 1; read -r st until < "$S"; if [ "$st" = going ] && [ "$now" -ge "$until" ]; then rm -f "$S"; return 1; fi; return 0; }',
  'case "$1" in',
  '  print) listed || exit 113; exit 0 ;;',
  `  print-disabled) printf 'disabled services = {\\n}\\n'; exit 0 ;;`,
  '  bootout) if listed; then read -r st until < "$S"; [ "$st" = going ] || echo "going $((now + 60))" > "$S"; exit 36; fi; exit 3 ;;',
  '  bootstrap) if listed; then exit 5; fi; echo loaded > "$S"; exit 0 ;;',
  '  kickstart) listed || exit 113; exit 0 ;;',
  'esac',
  'exit 0',
].join('\n')

test('FI-U3: Ctrl-C while ./install.sh --update waits for the agent to stop says that the agent is not running and how to start it', { timeout: 240_000 }, async () => {
  const s = stubs()
  const i = running(s, { service: false })
  s.stub('uname', MAC)
  s.stub('launchctl', LAUNCHD)
  writeFileSync(join(s.dir, 'calls.log.state'), 'loaded\n')
  const plist = join(i.home, 'Library', 'LaunchAgents', `${LABEL}.plist`)
  mkdirSync(join(plist, '..'), { recursive: true })
  writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${bashPath()}</string><string>${i.root}/run.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>
`)
  const out = tmp()
  buildRelease(out, realTree(tmp(), '3.2.0'), '3.2.0', KEY.privatePem)
  const web = await serve(publish(tmp(), [{ dir: out, version: '3.2.0' }], '3.2.0'))
  try {
    const said = await new Promise<{ status: number | null; out: string }>(done => {
      let text = ''
      let sent = false
      const child = spawn('bash', [join(i.root, 'install.sh'), '--update'], { cwd: i.root, env: { PATH: process.env.PATH ?? '', ...i.env(web.base) }, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
      const seen = (b: Buffer) => {
        text += b.toString('utf8')
        // The owner presses Ctrl-C: the terminal sends SIGINT to the whole foreground group.
        if (!sent && /Waiting for the agent that runs to stop/.test(text)) {
          sent = true
          setTimeout(() => process.kill(-child.pid!, 'SIGINT'), 300)
        }
      }
      child.stdout.on('data', seen)
      child.stderr.on('data', seen)
      const timer = setTimeout(() => process.kill(-child.pid!, 'SIGKILL'), 120_000)
      child.on('close', code => {
        clearTimeout(timer)
        done({ status: code, out: text.replace(/\x1b\[[0-9;]*m/g, '') })
      })
    })
    assert.match(said.out, /Waiting for the agent that runs to stop/, said.out)
    assert.equal(readFileSync(join(i.root, 'versions', 'active'), 'utf8'), 'v3.2.0\n', said.out)
    const after = said.out.slice(said.out.indexOf('Waiting for the agent that runs to stop'))
    assert.match(after, /not running now/, `Ctrl-C during the wait left the agent booted out without a word:\n${after}`)
    assert.match(after, /launchctl bootstrap gui\/\$\(id -u\) \S+ai\.foxleague\.agent\.plist/, after)
    assert.doesNotMatch(after, /, (and|or) /)
  } finally {
    await web.close()
  }
})
