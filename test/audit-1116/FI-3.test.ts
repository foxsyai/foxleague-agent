// FI-3 (MAC-1, renew_plist): plist_on_launcher is to change only the plist the installer wrote ("bash with run.sh")
// and to leave every other one: "one that starts anything else is not the installer's" (install.sh:597-599), and
// MAC-1's own test pins that for a plist that starts another script. Its pattern is
//   "  <key>ProgramArguments</key><array><string>"*"</string><string>$ROOT/run.sh</string></array>"
// and the * takes anything, further <string> elements included. An owner who put a program of macOS in front of bash
// on that line, so that the Mac stays awake while the agent plays (the Mac guide's own subject: "a sleeping Mac plays
// nothing"), has
//   <array><string>/usr/bin/caffeinate</string><string>-i</string><string>/bin/bash</string><string>ROOT/run.sh</string></array>
// (the same holds for nice, arch or env in front). `./install.sh --update` takes that line for the installer's, puts
// the launcher alone in its place and loads the job again from it: the owner's program is gone from the job without a
// word on the screen, and the Mac sleeps again with paid matches ahead.
// Right: a program line that is not exactly one program and run.sh is not the installer's form: the plist stays as it
// is, no launcher is written and the agent is restarted into the new release as before (kickstart).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildRelease, publish, serve } from '../update-fixtures.ts'
import { KEY, realTree, running, sh, stubs, tmp } from '../audit-1111/install-helpers.ts'

const NAME = 'FoxLeague Agent'
const LABEL = 'ai.foxleague.agent'
const MAC = 'case "${1:-}" in -s | "") echo Darwin ;; -m) /usr/bin/uname -m ;; *) exec /usr/bin/uname "$@" ;; esac'
const plistPath = (home: string): string => join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`)
const bashPath = (): string => execFileSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).trim()

/** The plist as the installer of 31adfb7 wrote it, with the program line given. */
function plist(root: string, programLine: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
${programLine}
  <key>WorkingDirectory</key><string>${root}</string>
  <key>EnvironmentVariables</key><dict><key>AGENT_ENV_FILE</key><string>${root}/.env</string><key>AGENT_DATA_DIR</key><string>${root}/data</string><key>FOXAGENT_SUPERVISED</key><string>1</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ExitTimeOut</key><integer>180</integer>
  <key>StandardOutPath</key><string>${root}/data/service.log</string>
  <key>StandardErrorPath</key><string>${root}/data/service.log</string>
</dict></plist>
`
}

/** `./install.sh --update` from 3.1.0 to 3.2.0 on a Mac whose job is loaded, with the program line given. */
async function macUpdate(programLine: (root: string) => string): Promise<{ calls: string[]; home: string; root: string; out: string; before: string }> {
  const s = stubs()
  const i = running(s, { service: false })
  s.stub('uname', MAC)
  mkdirSync(join(i.home, 'Library', 'LaunchAgents'), { recursive: true })
  const before = plist(i.root, programLine(i.root))
  writeFileSync(plistPath(i.home), before)
  writeFileSync(join(s.dir, 'calls.log.loaded'), '')
  const out = tmp()
  buildRelease(out, realTree(tmp(), '3.2.0'), '3.2.0', KEY.privatePem)
  const web = await serve(publish(tmp(), [{ dir: out, version: '3.2.0' }], '3.2.0'))
  try {
    const r = await sh(join(i.root, 'install.sh'), ['--update'], i.env(web.base), { cwd: i.root })
    assert.equal(r.status, 0, r.out)
    assert.equal(readFileSync(join(i.root, 'versions', 'active'), 'utf8'), 'v3.2.0\n', r.out)
    return { calls: s.calls().filter(c => /^launchctl (kickstart|bootstrap|bootout|enable|load) /.test(c)), home: i.home, root: i.root, out: r.out, before }
  } finally {
    await web.close()
  }
}

test('FI-3: ./install.sh --update leaves alone a plist whose program line the owner put a program of their own in front of', { timeout: 240_000 }, async () => {
  // Control: the installer's own line (one program, then run.sh) is moved to the launcher, as MAC-1 says.
  const own = await macUpdate(root => `  <key>ProgramArguments</key><array><string>${bashPath()}</string><string>${root}/run.sh</string></array>`)
  assert.match(readFileSync(plistPath(own.home), 'utf8'), new RegExp(`<array><string>${join(own.root, NAME)}</string></array>`))

  // The owner's line: caffeinate keeps the Mac awake for as long as the agent runs.
  const u = await macUpdate(root => `  <key>ProgramArguments</key><array><string>/usr/bin/caffeinate</string><string>-i</string><string>/bin/bash</string><string>${root}/run.sh</string></array>`)
  const now = readFileSync(plistPath(u.home), 'utf8')
  assert.match(now, /<string>\/usr\/bin\/caffeinate<\/string><string>-i<\/string>/, `the owner's program was taken out of the job without a word:\n${now}\n${u.out}`)
  assert.equal(now, u.before, 'a plist the installer did not write is left as it is')
  assert.equal(existsSync(join(u.root, NAME)), false, 'and no launcher is written for it')
  assert.deepEqual(u.calls, [`launchctl kickstart -k gui/${process.getuid!()}/${LABEL}`], 'restarted into the new release as before')
})
