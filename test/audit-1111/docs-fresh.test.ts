// The guides after the fresh install walk-through (FRESH-1 to FRESH-14) and the four fixes that followed it (UPD-21
// to UPD-24): the sentences a newcomer needs, each held to what the installer, the updater and the web server
// really print. A message that changes in the code fails here until the pages are looked at again.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CONFIRM_AFTER_MS } from '../../src/update/updater.ts'
import { LISTEN_RETRY_MS } from '../../src/web/server.ts'

const ROOT = new URL('../../', import.meta.url)
const raw = (f: string): string => readFileSync(new URL(f, ROOT), 'utf8')
const read = (f: string): string => raw(f).replace(/\s+/g, ' ')
const DOCS = 'site/src/content/docs'
// Since the guide of 2026-11-15 each system has its own install page (the Install page only picks one), and the rows
// that belong to one system moved from Troubleshooting to that page.
const WINDOWS = `${DOCS}/start/install-windows.mdx`
const MAC = `${DOCS}/start/install-mac.mdx`
const LINUX = `${DOCS}/start/install-linux.mdx`
const SYSTEMS = [WINDOWS, MAC, LINUX]
const UPDATE = `${DOCS}/help/update.md`
const TROUBLE = `${DOCS}/help/troubleshooting.md`
const DASH = `${DOCS}/use/dashboard.md`
const installer = raw('install.sh')
const updater = raw('src/update/updater.ts')
const server = raw('src/web/server.ts')

test('the two messages about systemd are the installer\'s own, in place of the one it no longer prints', () => {
  assert.doesNotMatch(installer, /systemd user services are not available/)
  assert.match(installer, /die "this machine does not run systemd, which keeps the agent running in the background\./)
  assert.match(installer, /die "the background services of the user \$USER_NAME cannot be reached from this terminal\./)
  for (const f of ['INSTALL.md', LINUX]) {
    const page = read(f)
    assert.doesNotMatch(page, /systemd user services are not available/, `${f} still names a message the installer no longer prints`)
    assert.match(page, /\*\*"this machine does not run systemd"/, f)
    assert.match(page, /`wsl --shutdown`/, f)
    assert.match(page, /`\.\/install\.sh --no-service`/, f)
    assert.match(page, /`\.\/run\.sh`/, f)
    assert.match(page, /\*\*"the background services of the user \.\.\. cannot be reached from this terminal"/, f)
    assert.match(page, /opened with `su` or `sudo`/, f)
  }
})

test('"Job for foxleague-agent.service failed": the start limit, and the two commands that clear it', () => {
  const fix = 'systemctl --user reset-failed foxleague-agent && systemctl --user restart foxleague-agent'
  assert.match(installer, /systemctl --user reset-failed \$SERVICE && systemctl --user restart \$SERVICE/)
  assert.match(installer, /^StartLimitIntervalSec=600\nStartLimitBurst=5$/m)
  for (const f of ['INSTALL.md', LINUX]) {
    const page = read(f)
    assert.match(page, /\*\*"Job for foxleague-agent\.service failed"/, f)
    assert.ok(page.includes(fix), `${f} does not give: ${fix}`)
    assert.match(page, /five starts in ten minutes/, f)
  }
})

test('the everyday commands are typed in the agent\'s folder, and the pages say so', () => {
  assert.match(installer, /The next three are typed in the agent's folder\. Go there first:\n\s+cd \$ROOT/)
  for (const f of ['INSTALL.md', TROUBLE]) assert.match(read(f), /typed in the agent's folder[^.]*`cd ~\/foxleague-agent`/, f)
})

test('step 3: a short or mistyped password is asked for again, and a port in use is refused', () => {
  assert.match(installer, /Nothing was saved\. Try again: 3 to 32 letters or digits for the username, at least 12 characters for the password, typed the same both times\./)
  assert.match(installer, /Port \$port is already used by another program on this machine\. Choose another one\./)
  // (The rows carry the installer's own step names since 2026-11-15: 3/7 Dashboard login.)
  for (const f of ['INSTALL.md', ...SYSTEMS]) {
    const page = read(f)
    const at = page.indexOf('| 3/7 Dashboard login |')
    assert.ok(at > 0, `${f}: the row of step 3`)
    const row = page.slice(at, page.indexOf('| 4/7 Keys |'))
    assert.match(row, /asked for again/, f)
    assert.match(row, /port that another program already uses is refused/, f)
  }
})

test('as root: adduser fox, then su - fox and paste the line', () => {
  assert.match(installer, /do not install the agent as root: create a user for it \(adduser fox,/)
  // A terminal opened with su works since FRESH-3: the installer finds the user's service manager itself.
  assert.match(installer, /find_user_systemd start \|\| no_user_systemd/)
  for (const f of ['INSTALL.md', LINUX]) assert.match(read(f), /`adduser fox`, then `su - fox` and paste the line/, f)
})

test('the uninstall leaves linger on and the folder in place, and the pages say how to turn linger off', () => {
  assert.match(installer, /To turn that off: loginctl disable-linger \$USER_NAME/)
  for (const f of ['INSTALL.md', LINUX]) {
    const page = read(f)
    assert.match(page, /`loginctl disable-linger \$USER`/, f)
    assert.match(page, /leaves your folder/, f)
  }
  // The Mac's uninstall leaves the folder too; on Windows the uninstall inside Ubuntu names linger with the Linux user.
  assert.match(read(MAC), /leaves your folder/)
  assert.match(read(WINDOWS), /`loginctl disable-linger` and your Linux username, inside Ubuntu/)
  // The Update page leads to the three.
  for (const f of SYSTEMS) assert.ok(read(UPDATE).includes(`(/${f.slice(DOCS.length + 1).replace(/\.mdx$/, '')}/#uninstalling)`), f)
})

test('the update page gives the timings: the dashboard is away about half a minute, an update that does not start is undone after about a minute and a half', () => {
  // The unit waits 30 seconds before each start; the undo is the third start after the agent ended for the update.
  assert.match(installer, /^RestartSec=30$/m)
  assert.match(raw('run.sh'), /if \[ "\$tries" -ge 2 \]; then/)
  const page = read(UPDATE)
  assert.match(page, /away for about half a minute/)
  assert.match(page, /about a minute and a half/)
  assert.match(read('INSTALL.md'), /about half a minute/)
})

test('the curl sentence no longer says that the snap cannot download', () => {
  for (const f of ['INSTALL.md', LINUX]) {
    const page = read(f)
    assert.match(page, /not the snap/i, f)
    assert.match(page, /the apt one is the one the install is tested with/, f)
    assert.doesNotMatch(page, /cannot download with the snap/, f)
  }
  assert.doesNotMatch(read(TROUBLE), /cannot download with the snap/)
})

test('the last screen: the dashboard address is a link, a desktop is offered the browser, and Enter at the keys question skips the keys on a later run', () => {
  assert.match(installer, /in most terminals: hold Ctrl and click it; on a Mac, Cmd/)
  assert.match(installer, /yes_no "Open the dashboard in your browser now\?" y/)
  assert.match(installer, /On every later\n# run it means no/)
  assert.match(read('INSTALL.md'), /offers to open it in your browser/)
  for (const f of ['INSTALL.md', LINUX]) assert.match(read(f), /hold Ctrl and click/, f)
  assert.match(read(MAC), /hold Cmd and click/)
  assert.match(read(WINDOWS), /in most terminals Ctrl and a click on it opens it/)
  for (const f of SYSTEMS) assert.match(read(f), /"Open the dashboard in your browser now\?"/, f)
  for (const f of ['INSTALL.md', ...SYSTEMS]) assert.match(read(f), /"Enter keys now\?"[^.]*Enter (means no|skips the keys)/, f)
})

test('two browsers, two sign-ins: the pages say why the page the installer opens can ask for the login', () => {
  for (const f of ['INSTALL.md', ...SYSTEMS, TROUBLE]) {
    const page = read(f)
    assert.match(page, /two browsers/, f)
    assert.match(page, /[Ee]ach (browser )?has its own sign-in/, f)
  }
})

test('UPD-21 in the pages: where nothing restarts the agent, the new version is put in place and runs from the next start', () => {
  assert.ok(updater.includes('is in place and runs from the next start.'))
  assert.ok(updater.includes('stop the agent (Ctrl-C in its terminal), then run ./run.sh again in'))
  const page = read(UPDATE)
  assert.doesNotMatch(page, /There the agent ends once the new version is in place/, 'the page still says that the agent ends')
  assert.match(page, /"Version \.\.\. is in place and runs from the next start"/)
  assert.match(page, /keeps playing/)
  assert.match(page, /run `\.\/run\.sh` again/)
  assert.match(page, /`FOXAGENT_SUPERVISED=1`/)
  assert.match(read(TROUBLE), /\*\*"Version \.\.\. is in place and runs from the next start"\*\*/)
  assert.match(read('INSTALL.md'), /is in place and runs from the next start/)
  assert.match(read(DASH), /started by hand/)
})

test('UPD-22 in the pages: the background service starts the agent again after every exit, and a changed service file needs the installer once', () => {
  assert.match(installer, /^Restart=always$/m)
  const page = read(UPDATE)
  assert.match(page, /starts the agent again after every exit/)
  assert.match(page, /run `\.\/install\.sh` again/)
})

test('UPD-23 in the pages: a dashboard port that is taken leaves the agents playing', () => {
  assert.equal(LISTEN_RETRY_MS, 60_000)
  assert.ok(server.includes('The dashboard could not start: port ${port} on this machine ${why}. Your agents keep playing without the dashboard. The agent tries the port again every minute.'))
  for (const f of ['INSTALL.md', TROUBLE]) {
    const page = read(f)
    assert.match(page, /"The dashboard could not start: port \.\.\./, f)
    assert.match(page, /keep playing/, f)
    assert.match(page, /every minute/, f)
    assert.match(page, /`WEB_UI_PORT`/, f)
  }
})

test('UPD-24 in the pages: a second update is refused until the last one has stayed up for 45 seconds', () => {
  assert.equal(CONFIRM_AFTER_MS, 45_000)
  assert.ok(updater.includes("'the last update is still being confirmed, try again in a minute'"))
  for (const f of [UPDATE, TROUBLE]) assert.ok(read(f).includes('the last update is still being confirmed, try again in a minute'), f)
})
