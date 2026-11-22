// Audit 2026-11-11: the words of the one-click update (the Update page, Safety, the dashboard page, the Telegram
// command table, Troubleshooting, README and INSTALL.md), held to what the updater does. Every number and every
// quoted message is read from the code, so a change there fails here until the pages are looked at again.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CHECK_EVERY_MS, CONFIRM_AFTER_MS } from '../../src/update/updater.ts'
import { DEFAULT_SOURCE } from '../../src/update/release.ts'
import { selfUpdateRefusal } from '../../src/update/install.ts'

const ROOT = new URL('../../', import.meta.url)
const raw = (f: string) => readFileSync(new URL(f, ROOT), 'utf8')
const read = (f: string) => raw(f).replace(/\s+/g, ' ')
const DOCS = 'site/src/content/docs'
const UPDATE = `${DOCS}/help/update.md`
const SAFETY = `${DOCS}/play/safety.md`
const DASH = `${DOCS}/use/dashboard.md`
const TALK = `${DOCS}/use/talk-to-your-manager.md`
const TROUBLE = `${DOCS}/help/troubleshooting.md`
const service = raw('src/service.ts')
const minutes = CHECK_EVERY_MS / 60_000
const seconds = CONFIRM_AFTER_MS / 1000

test('the check: about every 10 minutes, to GitHub, and AGENT_UPDATE_CHECK=0 switches it off', () => {
  assert.equal(minutes, 10)
  assert.equal(new URL(DEFAULT_SOURCE).hostname, 'github.com')
  assert.match(raw('src/config.ts'), /updateCheck: flag\('AGENT_UPDATE_CHECK', true\)/)
  for (const f of [UPDATE, SAFETY, DASH]) assert.match(read(f), new RegExp(`[Aa]bout every ${minutes} minutes`), f)
  for (const f of [UPDATE, SAFETY]) {
    assert.match(read(f), /GitHub/, f)
    assert.match(read(f), /`AGENT_UPDATE_CHECK=0`/, f)
  }
  // The request carries nothing of the install: a fixed client name and nothing else.
  assert.match(raw('src/update/release.ts'), /const HEADERS = \{ 'user-agent': 'foxleague-agent-updater', accept: '[^']+' \}/)
  assert.match(read(SAFETY), /It says nothing about your install/)
})

test('the command is /upgrade on Telegram and Update now in the dashboard, and no page or message names another', () => {
  assert.match(service, /\{ command: 'upgrade', description: 'Install the newest version when one is out' \}/)
  assert.match(service, /case 'upgrade':/)
  assert.doesNotMatch(service, /case 'update':/, 'there is no /update command: /updates is another one')
  assert.match(raw('src/web/dashboard.html'), /id="upBtn" hidden>Update now<\/button>/)
  for (const f of [UPDATE, SAFETY, DASH, TALK, 'README.md', 'INSTALL.md']) {
    assert.match(read(f), /\/upgrade/, `${f} does not name /upgrade`)
    assert.match(read(f), /Update now/, `${f} does not name Update now`)
    assert.doesNotMatch(read(f), /\/update(?![s\w/.])/, `${f} names a command the agent does not have`)
  }
  // What the agent itself tells the owner to send.
  assert.doesNotMatch(raw('src/update/updater.ts'), /send \/update here/, 'the notice names /update, which the agent answers with "unknown command"')
  assert.match(raw('src/update/updater.ts'), /send \/upgrade here or press Update now in the dashboard/)
})

test('/status shows the version, and the pages say so', () => {
  assert.match(service, /`foxleague-agent \$\{VERSION\}\$\{up\.available \? ` \(version \$\{up\.available\.version\} is out: \/upgrade installs it\)` : ''\}`/)
  assert.match(read(TALK), /\| `\/status` \| This install, its version and every agent at a glance/)
  assert.match(read(UPDATE), /`\/status`/)
})

test('every command of Telegram\'s menu is in the command table of the Talk page', () => {
  const menu = [...service.slice(service.indexOf('const TELEGRAM_MENU = ['), service.indexOf('/** One line of the conversation')).matchAll(/command: '([a-z]+)'/g)].map(m => m[1]!)
  assert.ok(menu.length >= 20 && menu.includes('upgrade'))
  const page = raw(TALK)
  const table = page.slice(page.indexOf('| Command | What it does |'))
  for (const c of menu) assert.match(table, new RegExp('`/' + c + '\\b'), `/${c} is not in the table`)
})

test('no password, and the page says why: only a signed, newer release can be installed, whoever asks', () => {
  assert.match(raw('src/web/server.ts'), /One click, no password: nothing here can be steered\. Only a release signed by the maintainers and newer\s+\/\/ than the running one is ever installed, whoever asks/)
  for (const f of [UPDATE, SAFETY]) {
    assert.match(read(f), /no password/i, f)
    assert.match(read(f), /only a release that is signed by the foxleague-agent maintainers and newer than yours/i, f)
  }
  assert.match(read(UPDATE), /Nothing is ever installed by itself/)
  // The dashboard's own bubble says the same three things.
  const bubble = read('src/web/dashboard.html')
  assert.match(bubble, /Nothing is ever installed by itself\. Only a signed release that is newer than yours is accepted, whoever presses the button: that is why it asks for no password/)
  assert.match(bubble, /the other waiting actions of a running plan are dropped and the next plan takes them up/)
  assert.match(read(SAFETY), /a key that never leaves the maintainers' own computers/)
})

test('the undo: a version that has not stayed up for 45 seconds in two starts is undone by the launcher, and the owner is told', () => {
  assert.equal(seconds, 45)
  assert.match(raw('run.sh'), /if \[ "\$tries" -ge 2 \]; then/)
  const page = read(UPDATE)
  assert.match(page, new RegExp(`up for ${seconds} seconds`))
  assert.match(page, /in two starts/)
  // The message the owner gets, as the updater writes it.
  assert.match(raw('src/update/updater.ts'), /`The update to \$\{to\} did not start and was undone: you run \$\{this\.d\.installed\} as before\. Your wallet, settings and history are untouched\. It is safe to try again later\.`/)
  assert.match(page, /did not start and was undone/)
  assert.match(read(TROUBLE), /\*\*"The update to \.\.\. did not start and was undone"\*\*/)
})

test('the Update page tells the steps as the code runs them', () => {
  const page = read(UPDATE)
  assert.match(page, /checks its signature/)
  assert.match(page, /next to the running version/)
  assert.match(page, /The running version is not written to/)
  assert.match(page, /An action that is being signed finishes and is booked first/)
  assert.match(page, /actions of a running plan that were still waiting are dropped; the next plan takes them up/)
  assert.match(page, /`\.\/install\.sh --update`/)
  assert.match(page, /`FOXAGENT_ALLOW_DOWNGRADE=1`/)
  assert.match(page, /keeps the version that ran before/)
  // Kept on disk: the running release and the one before it (install.ts, confirmStart).
  assert.match(raw('src/update/install.ts'), /every\s+\* release folder but this one and the one before it/)
})

test('the env example, the server guide and the FAQ carry the update too', () => {
  const env = raw('.env.example')
  assert.match(env, /# AGENT_UPDATE_CHECK=1\n# AGENT_UPDATE_URL=/)
  assert.match(raw('src/config.ts'), /updateUrl: process\.env\.AGENT_UPDATE_URL\?\.trim\(\) \|\| undefined/)
  assert.match(env.replace(/\n# /g, ' '), new RegExp(`about every ${minutes} minutes the agent asks GitHub`))
  const guide = read('docs/SERVER.md')
  assert.match(guide, /does not update itself: there is no Update now button, and `\/upgrade` answers that it is updated the way it was deployed/)
  assert.match(read(`${DOCS}/help/server.mdx`), /A server set up this way does not update itself/)
  assert.match(read(`${DOCS}/help/faq.md`), /### How do I get a new version\?/)
  assert.match(read(`${DOCS}/help/faq.md`), /Nothing is ever installed by itself/)
})

test('the installs that show the notice and cannot update themselves are named with what they do instead', () => {
  // The three answers of the code, for a server, a git checkout and an install from before the release folders.
  const server = selfUpdateRefusal({ root: '/x', code: '/x', managed: false }, { isServer: true })
  const flat = selfUpdateRefusal({ root: '/nowhere-such', code: '/nowhere-such', managed: false })
  assert.equal(server, 'this agent runs on a server set up by hand: update it the way it was deployed')
  assert.equal(flat, 'this install was not made by the one-line installer: paste the install line again once; later updates are one click')
  assert.match(raw('src/update/install.ts'), /'this install is a git checkout: update it in a terminal with \.\/install\.sh --update'/)
  const page = read(UPDATE)
  assert.match(page, /A git checkout/)
  assert.match(page, /follows its branch, which may hold code that is in no release yet/)
  assert.match(page, /A server set up by hand/)
  assert.match(page, /paste the install line again once/)
})

test('Troubleshooting has the rows of the updater and of the second copy, quoted as the agent says them', () => {
  assert.match(service, /`foxleague-agent already runs on this data folder \(process \$\{pid\}\)/)
  assert.match(service, /return `No update was started: \$\{err\.message\}\.`/)
  const page = read(TROUBLE)
  assert.match(page, /\*\*"foxleague-agent already runs on this data folder"\*\*/)
  assert.match(page, /\*\*"No update was started: \.\.\."\*\*/)
  // The reasons the row gives are the updater's own words.
  const updater = raw('src/update/updater.ts')
  for (const reason of ['updates are switched off on this machine (AGENT_UPDATE_CHECK=0)', 'an update is already being installed']) {
    assert.ok(updater.includes(reason), reason)
    assert.ok(page.includes(reason), `the row does not give: ${reason}`)
  }
  assert.ok(updater.includes('the newest version`') || updater.includes(', the newest version'), 'the newest version')
  assert.match(page, /you run \.\.\., the newest version/)
})
