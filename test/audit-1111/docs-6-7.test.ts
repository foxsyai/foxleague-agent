// Audit 2026-11-11 (Fable 5.2 reviewers at extra-high effort): DOCS-6 and DOCS-7, failing on the old text, and the
// sentences the installer's fixes ask the install pages to carry.
//
// DOCS-6: every page gives one line that starts with curl and none said that curl is needed. Ubuntu Desktop ships
// without it, so the line ended in "Command 'curl' not found" before get.sh's own check was ever read; Ubuntu's hint
// names the snap first, and the snap's curl has a /tmp of its own, which the installer's Node.js download (curl -o
// into a mktemp folder) cannot use. The pages now give the step: sudo apt install curl.
//
// DOCS-7: on Windows the agent is a systemd user service inside WSL2. WSL stops a distribution some time after its
// last terminal closes and does not start it with Windows, so "keeps it running after a restart" did not hold
// there. Not provable from this tree (it is how WSL works); the pages now say it. On macOS the service is a
// LaunchAgent: it starts at login, and a sleeping Mac runs nothing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ROOT = new URL('../../', import.meta.url)
const raw = (f: string) => readFileSync(new URL(f, ROOT), 'utf8')
const read = (f: string) => raw(f).replace(/\s+/g, ' ')
const INSTALL_PAGE = 'site/src/content/docs/start/install.mdx'
const HOME = 'site/src/content/docs/index.mdx'
const TROUBLE = 'site/src/content/docs/help/troubleshooting.md'

test('DOCS-6 the facts: the pasted line needs curl before anything of ours runs, and the installer downloads Node.js with curl into a temp folder', () => {
  const get = raw('get.sh')
  assert.match(get, /for tool in curl tar; do command -v "\$tool" >\/dev\/null 2>&1 \|\| die "\$tool is needed/)
  const sh = raw('install.sh')
  // Since FRESH-11 curl writes to its output and the shell puts that into the temp folder (a confined curl can do
  // that); the pages keep the advice to take the apt one, which is the one the install was walked through with.
  assert.ok(sh.includes('tmp=$(mktemp -d)') && /curl -fsSL [^\n]*\$tarball" > "\$tmp\/\$tarball"/.test(sh))
})

test('DOCS-6 the Install page, the home page, INSTALL.md and the README give the Ubuntu step: sudo apt install curl, the apt one', () => {
  for (const f of [INSTALL_PAGE, HOME, 'INSTALL.md', 'README.md']) {
    assert.match(read(f), /sudo apt install curl/, `${f} never names curl as something to install`)
  }
  for (const f of [INSTALL_PAGE, 'INSTALL.md']) assert.match(read(f), /not the snap/i, `${f} does not say which curl`)
})

test('DOCS-6 the Windows steps install curl too: they paste the same line in Ubuntu', () => {
  const page = read(INSTALL_PAGE)
  const windows = page.slice(page.indexOf('<TabItem label="Windows">'), page.indexOf('</Tabs>'))
  assert.match(windows, /sudo apt install curl/)
})

test('DOCS-7 the Windows steps say when the agent runs under WSL2', () => {
  const page = read(INSTALL_PAGE)
  const windows = page.slice(page.indexOf('<TabItem label="Windows">'), page.indexOf('</Tabs>'))
  assert.ok(windows.includes('systemd'), 'the Windows tab was found')
  assert.match(windows, /runs while Ubuntu \(WSL\) runs/, 'the Windows tab does not say that the agent runs only while WSL runs')
  assert.match(windows, /closing the last Ubuntu window may stop it/i)
  assert.match(windows, /does not start with Windows/)
})

test('DOCS-7 INSTALL.md, the README and Troubleshooting say the same of Windows', () => {
  for (const f of ['INSTALL.md', TROUBLE]) {
    const text = read(f)
    assert.match(text, /runs while Ubuntu \(WSL\) runs/, f)
    assert.match(text, /does not start with Windows/, f)
  }
  assert.match(read('README.md'), /On Windows the agent runs while Ubuntu \(WSL\) runs/)
  assert.match(read(TROUBLE), /\*\*The agent stops on Windows[^|]*\*\* \|/, 'no row for an agent that stops when the Ubuntu window is closed')
})

test('DOCS-7 no page promises a background service that survives a restart on every system', () => {
  for (const f of [INSTALL_PAGE, 'INSTALL.md']) {
    assert.doesNotMatch(read(f), /\| 7\. Background service \| Starts the agent in the background and keeps it running after a restart\. \|/, f)
    assert.match(read(f), /\| 7\. Background service \|[^|]*Linux[^|]*macOS[^|]*Windows[^|]*\|/, `${f}: step 7 says what each system does`)
  }
})

test('DOCS-7 macOS: the service is a LaunchAgent started at login, and the pages say so and that a sleeping Mac plays nothing', () => {
  const sh = raw('install.sh')
  assert.match(sh, /PLIST="\$HOME\/Library\/LaunchAgents\/\$PLIST_LABEL\.plist"/)
  assert.match(sh, /<key>RunAtLoad<\/key><true\/>/)
  assert.match(sh, /launchctl bootstrap "gui\/\$\(id -u\)" "\$PLIST"/)
  for (const f of [INSTALL_PAGE, 'INSTALL.md']) {
    assert.match(read(f), /starts when you log in/, f)
    assert.match(read(f), /a sleeping Mac plays nothing/, f)
  }
})

test('the install pages give the Node.js rule of the installer and of package.json', () => {
  assert.equal((JSON.parse(raw('package.json')) as { engines: { node: string } }).engines.node, '>=22.18.0 <23 || >=24.2.0')
  assert.match(raw('install.sh'), /\(a===22&&b>=18\)\|\|\(a===24&&b>=2\)\|\|a>24/)
  for (const f of [INSTALL_PAGE, 'INSTALL.md']) {
    assert.match(read(f), /\(22 from 22\.18, or 24\.2 and later, with npm beside it\), otherwise downloads a private copy[^|]*and checks it against the SHA-256 written in the installer/, f)
  }
  assert.doesNotMatch(read(INSTALL_PAGE), /if it is recent enough/)
})

test('the install pages say: not as root, no older version over a newer one, another folder, the words until the yes, Enter at the live permission', () => {
  const get = raw('get.sh')
  for (const name of ['FOXAGENT_ALLOW_DOWNGRADE', 'FOXAGENT_DIR', 'FOXAGENT_VERSION', 'FOXAGENT_ALLOW_ROOT']) assert.ok(get.includes(name), name)
  // The loop that asks until the yes is typed (since FRESH-9a yes in any case counts, and another answer is told what to type).
  assert.match(raw('install.sh'), /while :; do\n +case "\$\(ask 'Type yes when the words are written down'\)" in\n +\[Yy\]\[Ee\]\[Ss\]\) break ;;/)
  for (const f of [INSTALL_PAGE, 'INSTALL.md']) {
    const text = read(f)
    assert.match(text, /Install as a user of your own, not as root: as root the installer stops and tells you to create a user first/, f)
    assert.match(text, /An older version is not put over a newer install: add `FOXAGENT_ALLOW_DOWNGRADE=1` in front of `bash` to go back anyway \(the settings and limits the newer version added are then not applied\)/, f)
    assert.match(text, /Another folder is named with `FOXAGENT_DIR`; it must be empty or hold an install of foxleague-agent/, f)
    assert.match(text, /run `\.\/cli\.sh backup-words` in (the `foxleague-agent`|that) folder, in your own terminal/, f)
    assert.match(text, /Until you have typed `yes` at "Type yes when the words are written down", every run of the installer shows them and asks again/, f)
    assert.match(text, /Pressing Enter at the live permission keeps it as `\.env` has it: on only when it already says 1 or true/, f)
  }
})
