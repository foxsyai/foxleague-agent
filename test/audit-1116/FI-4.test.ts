// FI-4 (R2I-10 on a Mac, and the guides' sentence): R2I-10 made `./install.sh --update` wait for a stop that is still
// under way and then leave the agent stopped. The wait is in the Linux branch only. INSTALL.md:549-552 and
// help/update.md:88-91 say it of every system: "A background service you stopped stays stopped ... (on a Mac it starts
// at your next login). One still stopping (a busy agent finishes what it signs first, up to three minutes) is waited
// for, then stays stopped too."
// On a Mac the stop is `launchctl bootout gui/<uid>/ai.foxleague.agent` (the counterpart of the `launchctl bootstrap`
// the update's own line names as the start). A busy agent finishes what it signs first (up to 150 s; ExitTimeOut is
// 180) and launchd keeps the job listed meanwhile (INS-U1, R2I-U1). mac_after_update reads "listed" as "runs":
//   - with a plist of an install made before 2026-11-16 (renew_plist changed it) it calls mac_load, which sends a
//     second bootout, WAITS for the owner's stop to end and then bootstraps the job: the agent the owner just stopped
//     plays again, LIVE if it was, and the screen says "Restarted.";
//   - with a plist already on the launcher it sends `launchctl kickstart -k` to the job that is stopping.
// It is R2I-10's scenario word for word: the owner stops it, it seems to hang, they run ./install.sh --update in a
// second terminal.
// Right: a stop under way on a Mac is waited for and the agent then stays stopped, as the guides say; the screen says
// so and nothing loads or restarts the job.
// The launchctl stand-in is the project's own model of a busy job (test/audit-1116/R2I-U1.test.ts): the job stays
// listed until it is done, a bootout meanwhile answers 36, a bootstrap meanwhile is refused. Its `print` says nothing
// (as the stand-in of install-helpers.ts): what a real Mac prints for a job on its way out is not known here.
// The fix reads the agent's own word instead (added with it): a stopping agent writes data/service.stopping with its
// pid when its stop begins and removes it with data/service.pid when the stop ends. The busy agent below does that.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildRelease, publish, serve } from '../update-fixtures.ts'
import { KEY, realTree, running, sh, stubs, tmp } from '../audit-1111/install-helpers.ts'

const NAME = 'FoxLeague Agent'
const LABEL = 'ai.foxleague.agent'
const MAC = 'case "${1:-}" in -s | "") echo Darwin ;; -m) /usr/bin/uname -m ;; *) exec /usr/bin/uname "$@" ;; esac'
const plistPath = (home: string): string => join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`)
const bashPath = (): string => execFileSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).trim()

/**
 * The busy agent the owner is stopping, until `untilSec` (seconds since 1970): a live process whose command line is the
 * service's, named by data/service.pid and data/service.stopping, as the service writes them when its stop begins.
 */
async function stoppingAgent(root: string, untilSec: number): Promise<{ end: () => Promise<void> }> {
  const file = join(tmp('fox-agent-'), 'src', 'service.ts')
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, `setTimeout(() => process.exit(0), Math.max(0, ${untilSec * 1000} - Date.now()))\n`)
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', file], { stdio: 'ignore' })
  await once(child, 'spawn')
  mkdirSync(join(root, 'data'), { recursive: true })
  writeFileSync(join(root, 'data', 'service.pid'), String(child.pid))
  writeFileSync(join(root, 'data', 'service.stopping'), String(child.pid))
  return {
    end: async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
        await once(child, 'exit')
      }
    },
  }
}

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

// launchd with the agent's job on its way out: the owner's bootout was sent, the agent finishes what it signs and
// goes after `busy` more seconds. Until then the job is listed, a bootout answers 36 and a bootstrap is refused.
const LAUNCHD = [
  `printf 'launchctl %s\\n' "$*" >> "$LOG"`,
  'S="$LOG.state"; now=$(date +%s)',
  'listed() { [ -f "$S" ] || return 1; read -r st until < "$S"; if [ "$st" = going ] && [ "$now" -ge "$until" ]; then rm -f "$S"; return 1; fi; return 0; }',
  'case "$1" in',
  '  print) listed || exit 113; exit 0 ;;',
  `  print-disabled) printf 'disabled services = {\\n\\t"com.apple.Siri.agent" => enabled\\n}\\n'; exit 0 ;;`,
  '  bootout) if listed; then read -r st until < "$S"; [ "$st" = going ] || echo "going $((now + 6))" > "$S"; exit 36; fi; echo "Boot-out failed: 3: No such process" >&2; exit 3 ;;',
  '  bootstrap) if listed; then echo "Bootstrap failed: 5: Input/output error" >&2; exit 5; fi; echo loaded > "$S"; exit 0 ;;',
  '  kickstart) listed || exit 113; echo loaded > "$S"; exit 0 ;;',
  'esac',
  'exit 0',
].join('\n')

for (const c of [
  { what: 'a plist of an install made before 2026-11-16', line: (root: string) => `  <key>ProgramArguments</key><array><string>${bashPath()}</string><string>${root}/run.sh</string></array>`, launcher: false },
  { what: 'a plist on the launcher', line: (root: string) => `  <key>ProgramArguments</key><array><string>${join(root, NAME)}</string></array>`, launcher: true },
]) {
  test(`FI-4: on a Mac ./install.sh --update waits for a stop under way and leaves the agent stopped (${c.what})`, { timeout: 240_000 }, async () => {
    const s = stubs()
    const i = running(s, { service: false })
    s.stub('uname', MAC)
    s.stub('launchctl', LAUNCHD)
    mkdirSync(join(i.home, 'Library', 'LaunchAgents'), { recursive: true })
    writeFileSync(plistPath(i.home), plist(i.root, c.line(i.root)))
    if (c.launcher) writeFileSync(join(i.root, NAME), '#!/bin/bash\n', { mode: 0o755 })
    const out = tmp()
    buildRelease(out, realTree(tmp(), '3.2.0'), '3.2.0', KEY.privatePem)
    const web = await serve(publish(tmp(), [{ dir: out, version: '3.2.0' }], '3.2.0'))
    const state = join(s.dir, 'calls.log.state')
    // The owner typed `launchctl bootout gui/<uid>/ai.foxleague.agent` a moment ago; the busy agent needs 8 s more.
    const until = Math.floor(Date.now() / 1000) + 8
    const agent = await stoppingAgent(i.root, until)
    try {
      writeFileSync(state, `going ${until}\n`)
      const r = await sh(join(i.root, 'install.sh'), ['--update'], i.env(web.base), { cwd: i.root })
      assert.equal(readFileSync(join(i.root, 'versions', 'active'), 'utf8'), 'v3.2.0\n', r.out)
      const asked = s.calls().filter(l => /^launchctl (bootstrap|kickstart|load) /.test(l))
      assert.deepEqual(asked, [], `launchd was asked to start the agent the owner is stopping:\n${r.out}`)
      assert.equal(existsSync(state) ? readFileSync(state, 'utf8').trim() : 'not loaded', 'not loaded', `the agent the owner stopped runs again:\n${r.out}`)
      assert.doesNotMatch(r.out, /Restarted\./, r.out)
      assert.match(r.out, /stays stopped/, r.out)
      assert.equal(r.status, 0, r.out)
    } finally {
      await agent.end()
      await web.close()
    }
  })
}

// Added by the fix: a stop that launchd follows with a start (`launchctl kickstart -k`, an update's exit 75) is waited
// for too, and the job it still holds is then restarted into the new release as before.
test('FI-4: on a Mac a stop under way that launchd follows with a start is waited for, then the job is restarted as before', { timeout: 240_000 }, async () => {
  const s = stubs()
  const i = running(s, { service: false })
  s.stub('uname', MAC)
  mkdirSync(join(i.home, 'Library', 'LaunchAgents'), { recursive: true })
  writeFileSync(plistPath(i.home), plist(i.root, `  <key>ProgramArguments</key><array><string>${join(i.root, NAME)}</string></array>`))
  writeFileSync(join(i.root, NAME), '#!/bin/bash\n', { mode: 0o755 })
  // launchd holds the job throughout (the stand-in of install-helpers.ts lists it while calls.log.loaded is there).
  writeFileSync(join(s.dir, 'calls.log.loaded'), '')
  const out = tmp()
  buildRelease(out, realTree(tmp(), '3.2.0'), '3.2.0', KEY.privatePem)
  const web = await serve(publish(tmp(), [{ dir: out, version: '3.2.0' }], '3.2.0'))
  const agent = await stoppingAgent(i.root, Math.floor(Date.now() / 1000) + 4)
  try {
    const r = await sh(join(i.root, 'install.sh'), ['--update'], i.env(web.base), { cwd: i.root })
    assert.equal(r.status, 0, r.out)
    assert.match(r.out, /Waiting for the agent that is stopping/, r.out)
    assert.deepEqual(s.calls().filter(l => /^launchctl (bootstrap|kickstart|load) /.test(l)), [`launchctl kickstart -k gui/${process.getuid!()}/${LABEL}`], r.out)
    assert.match(r.out, /Restarted\./, r.out)
  } finally {
    await agent.end()
    await web.close()
  }
})

// The agent's side: its word that a stop is under way.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type { Config } from '../../src/config.ts'
import { Service } from '../../src/service.ts'
import { snapshot } from '../fixtures.ts'

test('FI-4: the service writes data/service.stopping when its stop begins and removes it with service.pid when the stop ends', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-fi4-'))
  const env = { user: process.env.WEB_UI_USER, hash: process.env.WEB_UI_PASSWORD_HASH }
  delete process.env.WEB_UI_USER
  delete process.env.WEB_UI_PASSWORD_HASH
  try {
    // A stop marker a killed agent left: the next start takes it away.
    writeFileSync(join(dir, 'service.stopping'), '999999')
    const svc = new Service({
      mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
      gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined, isServer: false, defaultDryRun: true, maxAgents: 5,
    } as Config)
    svc.notify = () => undefined
    ;(svc as unknown as { startTelegram: unknown }).startTelegram = () => undefined
    ;(svc as unknown as { schedule: unknown }).schedule = () => undefined
    ;(svc as unknown as { snapshot: unknown }).snapshot = async () => snapshot()
    await svc.start()
    const busy = (svc as unknown as { busy: Set<number> }).busy
    let leftover: boolean
    let during = 'not asked'
    try {
      leftover = existsSync(join(dir, 'service.stopping'))
      assert.equal(readFileSync(join(dir, 'service.pid'), 'utf8').trim(), String(process.pid))
      // A plan in flight keeps the stop waiting (up to 150 s): meanwhile the marker names this process.
      busy.add(1)
      const stopped = svc.stop()
      try {
        await new Promise(r => setTimeout(r, 100))
        during = existsSync(join(dir, 'service.stopping')) ? readFileSync(join(dir, 'service.stopping'), 'utf8').trim() : 'none'
      } finally {
        busy.delete(1)
        await stopped
      }
    } finally {
      busy.delete(1)
      await svc.stop()
    }
    assert.equal(leftover, false, 'a leftover marker is gone at the start')
    assert.equal(during, String(process.pid), 'while the stop waits for the plan in flight, the marker names this process')
    assert.equal(existsSync(join(dir, 'service.stopping')), false, 'the marker goes when the stop ends')
    assert.equal(existsSync(join(dir, 'service.pid')), false)
  } finally {
    if (env.user !== undefined) process.env.WEB_UI_USER = env.user
    if (env.hash !== undefined) process.env.WEB_UI_PASSWORD_HASH = env.hash
    rmSync(dir, { recursive: true, force: true })
  }
})
