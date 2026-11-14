// WIN-1 (the Windows one-line installer, 2026-11-11): get.ps1 sets up WSL2, Ubuntu and systemd, runs the normal
// installer inside Ubuntu and keeps Ubuntu running with a scheduled task. This machine is Linux and so is CI:
// nothing here runs get.ps1 on Windows. Held here is what needs no Windows:
//   - the file itself: plain ASCII (Windows PowerShell 5.1 misreads UTF-8 without a byte order mark), one function
//     called on the last line (a download cut short runs nothing), no address but the project's raw GitHub one,
//     Microsoft's documentation and this PC's own, no code built and run;
//   - what it takes for granted of get.sh and install.sh (the switches, the service's file, the port's line, the
//     browser question), so that a change there fails here;
//   - the line in INSTALL.md, the README and the Install page, and the sentences of the guides about Windows;
//   - the record (WIN-1 and what stays open) and the plan for the real PC.
// Where Docker and the PowerShell image are on the machine, the last test runs test/windows/get-ps1.checks.ps1 in
// a throwaway container: the PowerShell parser and the decisions of the script against stand-ins. Without them it
// is skipped and says so. docs/WINDOWS-TEST.md lists what only a real Windows PC can show.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = new URL('../../', import.meta.url)
const raw = (f: string): string => readFileSync(new URL(f, ROOT), 'utf8')
const read = (f: string): string => raw(f).replace(/\s+/g, ' ')
const LINE = 'irm https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.ps1 | iex'
const UNINSTALL_LINE = '& ([scriptblock]::Create((irm https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.ps1))) -Uninstall'
const TASK = 'FoxLeague Agent (WSL)'
const INSTALL_PAGE = 'site/src/content/docs/start/install.mdx'
const TROUBLE = 'site/src/content/docs/help/troubleshooting.md'
const UPDATE = 'site/src/content/docs/help/update.md'
const IMAGE = 'mcr.microsoft.com/powershell:latest'

const ps = raw('get.ps1')
const psLines = ps.split('\n')
/** The script without its comment lines (a line whose first character after the indentation is #). */
const code = psLines.filter(l => !/^\s*#/.test(l)).join('\n')

test('WIN-1 get.ps1 is plain ASCII with Unix line ends: Windows PowerShell 5.1 reads a file without a byte order mark in the PC\'s own code page', () => {
  const bytes = readFileSync(new URL('get.ps1', ROOT))
  const odd: string[] = []
  bytes.forEach((b, i) => { if (b !== 0x0a && (b < 0x20 || b > 0x7e)) odd.push(`byte 0x${b.toString(16)} at ${i}`) })
  assert.deepEqual(odd.slice(0, 5), [])
  assert.ok(bytes.length > 20_000, 'the file is there')
})

test('WIN-1 the whole script is one function, called once, on the last line: a download cut short runs nothing', () => {
  const lines = ps.trimEnd().split('\n')
  assert.equal(lines.at(-1), 'Install-FoxLeagueAgent @args')
  assert.ok(ps.endsWith('Install-FoxLeagueAgent @args\n'), 'the file ends with the call and one line end')
  // Everything that starts in the first column: comments, the function's two braces and the call.
  const top = lines.filter(l => l !== '' && !l.startsWith('#') && !/^\s/.test(l))
  assert.deepEqual(top, ['function Install-FoxLeagueAgent {', '}', 'Install-FoxLeagueAgent @args'])
  assert.equal(ps.split('Install-FoxLeagueAgent @args').length, 2, 'the call is there once')
  // Strict mode and the error preference are set inside the function, so they end with it and never change the user's window.
  assert.match(ps, /^ {4}Set-StrictMode -Version Latest\n {4}\$ErrorActionPreference = 'Stop'$/m)
  assert.doesNotMatch(code, /^\s*exit\b/m, 'exit would close the window the line was pasted into')
})

test('WIN-1 it names no address but the project\'s raw GitHub one, Microsoft\'s documentation and this PC\'s own', () => {
  const urls = ps.match(/https?:\/\/[^\s'"`)]+/g) ?? []
  assert.ok(urls.length >= 5)
  const other = urls.filter(u =>
    !/^https:\/\/raw\.githubusercontent\.com\/foxsyai\/foxleague-agent\/main\/get\.(ps1|sh)$/.test(u) &&
    !/^https:\/\/learn\.microsoft\.com\/windows\/wsl\/[a-z-]+$/.test(u) &&
    !/^http:\/\/(localhost|127\.0\.0\.1):/.test(u) &&
    u !== 'https://' && u !== 'http://') // the two words in "must start with https:// or http://"
  assert.deepEqual(other, [])
  assert.ok(ps.includes(`$FoxLine = '${LINE}'`), 'the line it tells the user to paste again is the line of the guides')
  assert.ok(ps.includes("$FoxGetUrl = 'https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.sh'"))
  assert.ok(raw('get.sh').includes('curl -fsSL https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.sh | bash'), 'get.sh names the same address for itself')
})

test('WIN-1 it never runs text as code and downloads nothing on the Windows side', () => {
  // The one place the code names iex is the line it prints for the user to paste again.
  const without = code.replace(`$FoxLine = '${LINE}'`, '')
  for (const banned of [/\biex\b/i, /Invoke-Expression/i, /\[scriptblock\]/i, /Invoke-Command/i, /\bicm\b/i, /Add-Type/i, /EncodedCommand/i, /FromBase64String/i,
    /\birm\b/i, /Invoke-RestMethod/i, /Invoke-WebRequest/i, /\biwr\b/i, /DownloadString/i, /DownloadFile/i, /Start-BitsTransfer/i, /Net\.WebClient/i, /Set-ExecutionPolicy/i]) {
    assert.doesNotMatch(without, banned)
  }
  // The only request it makes itself is the health check of the dashboard on this PC.
  assert.equal(code.split('[System.Net.WebRequest]::Create(').length, 2)
  assert.match(code, /Test-FoxUrl \(\$address \+ '\/healthz'\)\) -or \(Test-FoxUrl \('http:\/\/127\.0\.0\.1:' \+ \$port \+ '\/healthz'\)\)/)
  // wsl.exe is Microsoft's own, by its full path in the Windows folder; it is the only program started as administrator.
  assert.match(code, /Join-Path \(Join-Path \$f\['SystemRoot'\] 'System32'\) 'wsl\.exe'/)
  assert.equal(code.split('Start-FoxElevated (Get-FoxWslPath)').length, 2)
  assert.equal(code.split('-Verb RunAs').length, 2)
  assert.match(code, /Start-FoxElevated \(Get-FoxWslPath\) '--install --no-distribution'/)
})

test('WIN-1 no secret passes through it: of the agent\'s .env only the digits of the port, and no password is read', () => {
  assert.doesNotMatch(code, /AsSecureString|Get-Credential|PSCredential|ConvertTo-SecureString/i)
  assert.doesNotMatch(code, /MNEMONIC|API_KEY|PASSWORD_HASH|TOKEN/)
  // (.env is also named in one sentence of the uninstall, which reads nothing.)
  const env = (code.match(/[^\n]*\.env[^\n]*/g) ?? []).filter(l => !l.includes('Write-FoxLine'))
  assert.equal(env.length, 1, `one line of code reads .env: ${env.join(' / ')}`)
  assert.match(env[0]!, /grep -a -m 1 ''\^WEB_UI_PORT='' "\$d\/\.env" 2>\/dev\/null \| tr -cd 0-9/)
  assert.match(raw('install.sh'), /^set_env WEB_UI_PORT "\$port"$/m)
})

test('WIN-1 what it takes for granted of get.sh and install.sh is still true of them', () => {
  const get = raw('get.sh')
  const sh = raw('install.sh')
  // The four switches it hands on are get.sh's own.
  for (const name of ['FOXAGENT_VERSION', 'FOXAGENT_RELEASES', 'FOXAGENT_DIR', 'FOXAGENT_ALLOW_DOWNGRADE']) {
    assert.ok(get.includes(`\${${name}:-`), `get.sh reads ${name}`)
    assert.ok(code.includes(`'${name}'`), `get.ps1 hands ${name} on`)
  }
  assert.match(code, /foreach \(\$name in @\('FOXAGENT_VERSION', 'FOXAGENT_RELEASES', 'FOXAGENT_DIR', 'FOXAGENT_ALLOW_DOWNGRADE', 'FOXAGENT_GET_URL'\)\)/)
  assert.match(get, /case "\$VERSION" in v\[0-9\]\*\.\[0-9\]\*\.\[0-9\]\*\) ;; \*\) die "FOXAGENT_VERSION must look like v1\.2\.3"/)
  // The folder, the file that names the running release and the unit of the service.
  assert.match(get, /DIR=\$\{FOXAGENT_DIR:-\$HOME\/foxleague-agent\}/)
  assert.match(get, /printf '%s\\n' "\$name" > "\$DIR\/versions\/active\.new"/)
  assert.match(sh, /^SERVICE=foxleague-agent$/m)
  assert.match(sh, /^UNIT="\$HOME\/\.config\/systemd\/user\/\$SERVICE\.service"$/m)
  assert.ok(code.includes("$FoxUnit = 'foxleague-agent.service'") && code.includes("$FoxFolder = 'foxleague-agent'"))
  // get.sh and install.sh refuse root, and need curl and tar: get.ps1 makes the user and installs both first.
  assert.match(get, /do not install the agent as root/)
  assert.match(get, /for tool in curl tar; do/)
  assert.match(code, /apt-get update && apt-get install -y curl tar ca-certificates/)
  // The installer inside asks about the browser when it finds explorer.exe; get.ps1 then does not ask again.
  assert.match(sh, /elif grep -qi microsoft \/proc\/version 2>\/dev\/null; then o=\$\(command -v explorer\.exe 2>\/dev\/null \|\| true\)/)
  assert.match(sh, /yes_no "Open the dashboard in your browser now\?" y/)
  assert.match(code, /if command -v explorer\.exe >\/dev\/null 2>&1; then echo explorer=1; else echo explorer=0; fi/)
  assert.match(code, /Confirm-Fox 'Open the dashboard in your browser now\?' \$true/)
  // What the installer says when systemd does not run is what get.ps1 sets up beforehand.
  assert.match(sh, /add the two lines \[boot\] and systemd=true to \/etc\/wsl\.conf/)
})

test('WIN-1 only Ubuntu, by name, and never all of WSL: no shutdown, no default changed, nothing unregistered', () => {
  assert.ok(code.includes("$FoxDistro = 'Ubuntu'"))
  assert.match(code, /\$parts = @\('-d', \$FoxDistro\)/)
  // What Invoke-FoxLinux is given always comes after --exec: arguments of the Linux program, never of wsl.exe.
  assert.match(code, /\$parts \+= @\('--cd', '~', '--exec'\)\n\s+foreach \(\$c in \$Command\) \{ \$parts \+= \(ConvertTo-FoxArgument \$c\) \}/)
  // (W-17 of 2026-11-14: the one exception is the agent's own installer inside Ubuntu, `install.sh --uninstall`,
  // given to Invoke-FoxLinux and so after --exec. wsl.exe's own --uninstall, which removes WSL, stays out of every call.)
  const inner = "$r = Invoke-FoxLinux -Command @('/bin/bash', ($folder + '/install.sh'), '--uninstall')"
  assert.equal(code.split(inner).length, 2, 'the uninstall inside Ubuntu is that one call')
  for (const never of ['--shutdown', '--set-default', '--unregister', '--uninstall', '--import', '--export']) {
    // (--shutdown is named in sentences that tell the user what to type; it is never an argument of a call.)
    const calls = code.split('\n').filter(l => /Invoke-FoxWsl|Start-FoxElevated|Invoke-FoxLinux/.test(l) && l.includes(never) && l.trim() !== inner)
    assert.deepEqual(calls, [], never)
  }
  assert.match(code, /Invoke-FoxWsl -Arguments \('--terminate ' \+ \$FoxDistro\)/)
  assert.match(code, /Invoke-FoxWsl -Arguments \('--install -d ' \+ \$FoxDistro\)/)
})

test('WIN-1 the sentences it shows: no comma before the "and" or "or" that ends a list, never the word bot', () => {
  const said = code.split('\n').filter(l => /Write-FoxLine|Write-FoxStep|Stop-Fox|Read-FoxLine|Confirm-Fox|Write-Host|return '/.test(l))
  assert.ok(said.length > 100, `${said.length} lines with a sentence`)
  for (const line of said) {
    assert.doesNotMatch(line, /, (and|or) /, line.trim())
    assert.doesNotMatch(line, /\bbots?\b/i, line.trim())
  }
  assert.doesNotMatch(ps, /\bbots?\b/i)
})

test('WIN-1 the line to paste is the same, letter for letter, in INSTALL.md, the README and the Install page', () => {
  for (const f of ['INSTALL.md', 'README.md', INSTALL_PAGE]) {
    const lines = raw(f).split('\n').map(l => l.trim())
    assert.ok(lines.includes(LINE), `${f} does not give the line on a line of its own`)
    // Every other line that names get.ps1 or irm is the uninstall line.
    const others = lines.filter(l => (/\birm\b/.test(l) || l.includes('get.ps1')) && l !== LINE)
    for (const l of others) assert.equal(l, UNINSTALL_LINE, `${f}: ${l}`)
  }
  assert.ok(psLines.includes(`#   ${LINE}`), 'the head of get.ps1 gives the same line')
  assert.ok(psLines.includes(`#   ${UNINSTALL_LINE}`), 'and the same uninstall line')
  for (const f of ['INSTALL.md', UPDATE]) assert.ok(raw(f).split('\n').includes(UNINSTALL_LINE), `${f} gives the uninstall line`)
  // The home page gives the curl line only, so it sends a Windows reader to the Install page.
  assert.match(read('site/src/content/docs/index.mdx'), /On Windows the line is another one, pasted into PowerShell: see \[Install\]\(\/start\/install\/\)/)
})

test('WIN-1 the Windows tab: the line, what it does and asks, where the dashboard is, when the agent plays, update, uninstall, by hand', () => {
  const page = read(INSTALL_PAGE)
  const tab = page.slice(page.indexOf('<TabItem label="Windows">'), page.indexOf('</Tabs>'))
  assert.ok(tab.indexOf(LINE) < tab.indexOf('**By hand**'), 'the line comes first, the steps by hand after it')
  assert.match(tab, /a normal window, not "as administrator"/)
  assert.match(tab, /64-bit Windows 11 or Windows 10 version 2004 or later/)
  assert.match(tab, /safe to paste it again at any time/)
  // The administrator prompt and the restart.
  assert.match(tab, /`wsl --install --no-distribution`\. That needs an administrator, so Windows shows its own prompt: answer Yes/)
  assert.match(tab, /When Windows then needs a restart, the installer says so: restart, open PowerShell again and paste the same line/)
  // Ubuntu's own username and password.
  assert.match(tab, /choose a Linux username and password, in the same window or in a window of its own/)
  assert.match(tab, /they are not your Windows login and the installer never sees them/)
  assert.match(tab, /type `exit` to come back to the installer/)
  // Then the same questions as on Linux.
  assert.match(tab, /The same seven steps as on Linux, in the same window/)
  // Where the dashboard is.
  assert.match(tab, /`http:\/\/localhost:8870` in your Windows browser \(or at the port you chose\)/)
  // When it plays: said as what the task is there for, with what is true whatever the task does.
  assert.ok(tab.includes(`"${TASK}"`), 'the task is named')
  assert.match(tab, /The scheduled task is there to keep Ubuntu running for as long as you are logged in to Windows/)
  assert.match(tab, /does not play while the PC is off or asleep and not before you log in after a restart/)
  // Update and uninstall.
  assert.match(tab, /An update is one click in the dashboard/)
  // (One line in PowerShell since W-17 of 2026-11-14: it removes the agent inside Ubuntu too, after one question.)
  assert.match(tab, /\[Uninstall\]\(\/help\/update\/#uninstall\): one line in PowerShell, which also removes the agent's background service inside Ubuntu after one question/)
  // By hand: never a second [boot].
  const hand = tab.slice(tab.indexOf('**By hand**'))
  assert.match(hand, /`wsl --install -d Ubuntu`/)
  assert.match(hand, /Do not add a second `\[boot\]`: WSL takes the first `systemd` line it finds/)
  assert.match(hand, /curl -fsSL https:\/\/raw\.githubusercontent\.com\/foxsyai\/foxleague-agent\/main\/get\.sh \| bash/)
  assert.match(hand, /Installed by hand, nothing keeps Ubuntu running/)
  // The files, as get.ps1 names them on its last screen.
  assert.ok(tab.includes('`\\\\wsl$\\Ubuntu\\home\\<your Linux username>\\foxleague-agent`'))
  assert.ok(code.includes("return ('\\\\wsl$\\' + $FoxDistro + ($LinuxFolder -replace '/', '\\'))"))
  assert.ok(tab.includes('`wsl -d Ubuntu --cd ~`'))
  assert.ok(code.includes("To open it: wsl -d ' + $FoxDistro + ' --cd ~'"), 'the last screen names the same command')
})

test('WIN-1 INSTALL.md says the same of Windows, with the switches and the uninstall', () => {
  const page = read('INSTALL.md')
  assert.match(page, /### On Windows Open Windows PowerShell \(Start, type PowerShell\) in a normal window, not "as administrator"/)
  assert.match(page, /`wsl --install --no-distribution`\. That needs an administrator, so Windows shows its own prompt: answer Yes/)
  assert.match(page, /restart, open PowerShell again and paste the same line/)
  assert.match(page, /they are not your Windows login and the installer never sees them/)
  assert.match(page, /never adds a second `\[boot\]`/)
  assert.ok(page.includes(`"${TASK}"`))
  assert.match(page, /The switches above are set in PowerShell before the line, for example `\$env:FOXAGENT_VERSION = 'vX\.Y\.Z'`; `FOXAGENT_DIR` then names a folder inside Ubuntu, never a Windows folder/)
  assert.match(page, /`Unregister-ScheduledTask -TaskName 'FoxLeague Agent \(WSL\)' -Confirm:\$false`/)
  assert.match(page, /`wsl --unregister Ubuntu` deletes everything in it/)
  assert.doesNotMatch(page, /from the Microsoft Store and paste the line in its terminal/, 'the old Windows sentence is gone')
  assert.doesNotMatch(page, /On Windows, use WSL2 with systemd turned on/)
  // What get.ps1 really does of this.
  assert.match(code, /Unregister-ScheduledTask -TaskName \$FoxTaskName -Confirm:\$false/)
  assert.ok(code.includes(`$FoxTaskName = '${TASK}'`))
  assert.match(code, /\/etc\/wsl\.conf\.before-foxleague/)
  assert.match(page, /`\/etc\/wsl\.conf\.before-foxleague`/)
})

test('WIN-1 Troubleshooting has the Windows rows: virtualization, the kernel component, the restart, systemd, localhost, the task', () => {
  const page = read(TROUBLE)
  assert.match(page, /\| \*\*Windows: an error that names virtualization or 0x80370102\*\* \| WSL 2 needs virtualization, which is turned on in the PC's BIOS or UEFI setup/)
  assert.match(page, /\| \*\*Windows: "WSL 2 requires an update to its kernel component"\*\* \| Run `wsl --update` in PowerShell, then paste the PowerShell line again\. \|/)
  assert.match(page, /\| \*\*Windows: "Restart Windows now, then paste the same line again"\*\* \| Windows finishes installing WSL while it restarts\./)
  assert.match(page, /\| \*\*"this machine does not run systemd"\*\* \| [^|]*On Windows the PowerShell line turns it on by itself[^|]*never adds a second `\[boot\]`[^|]*\|/)
  assert.match(page, /\| \*\*Windows: the dashboard does not open at `http:\/\/localhost:8870`\*\* \| [^|]*Run `wsl --shutdown` in PowerShell, wait ten seconds and paste the PowerShell line again/)
  assert.match(page, /\| \*\*The agent stops on Windows[^|]*\*\* \| [^|]*The scheduled task "FoxLeague Agent \(WSL\)"[^|]*is there to keep Ubuntu running while you are logged in/)
  // The words of the rows are the script's own.
  assert.ok(code.includes("Write-FoxStep 'Restart Windows now, then paste the same line again'"))
  assert.match(code, /"WSL 2 requires an update to its kernel component": type {2}wsl --update/)
  assert.match(code, /An error that names virtualization or 0x80370102/)
  assert.match(code, /If it stays closed: type {2}wsl --shutdown {2}wait ten seconds, then paste the line again/)
  for (const f of ['INSTALL.md']) {
    const md = read(f)
    for (const row of ['**Windows: an error that names virtualization or 0x80370102:**', '**Windows: "WSL 2 requires an update to its kernel component":**',
      '**Windows: "Restart Windows now, then paste the same line again":**', '**Windows: the dashboard does not open at `http://localhost:8870`:**']) assert.ok(md.includes(row), `${f}: ${row}`)
  }
})

test('WIN-1 the Update page says how to uninstall on Windows: the agent inside Ubuntu, the task in PowerShell, Ubuntu and WSL left alone', () => {
  const page = read(UPDATE)
  const part = page.slice(page.indexOf('### On Windows'))
  assert.ok(part.length > 200, 'the Uninstall part has a Windows section')
  assert.match(part, /`\.\/install\.sh --uninstall`/)
  assert.match(part, /Unregister-ScheduledTask -TaskName 'FoxLeague Agent \(WSL\)' -Confirm:\$false/)
  assert.ok(part.includes(UNINSTALL_LINE))
  assert.match(part, /The task is all the installer added to Windows/)
  assert.match(part, /WSL, Ubuntu and the line `systemd=true` in Ubuntu's `\/etc\/wsl\.conf` stay/)
  assert.match(part, /`wsl --unregister Ubuntu` deletes everything in it/)
  // What the uninstall of get.ps1 prints.
  assert.match(code, /cd ~\/' \+ \$FoxFolder \+ ' && \.\/install\.sh --uninstall'/)
  // (Two lines since W-12 of 2026-11-14: one line of 116 columns broke a word at the edge of the window.)
  assert.match(code, /'WSL, Ubuntu and the line systemd=true in Ubuntu''s \/etc\/wsl\.conf are left as they are:'\n\s+Write-FoxLine 'other programs may use them\.'/)
})

test('WIN-1 no page promises as seen what nobody has seen on a real Windows PC', () => {
  for (const f of ['INSTALL.md', 'README.md', INSTALL_PAGE, TROUBLE, UPDATE]) {
    const page = read(f)
    // The task is said by its purpose ("is there to keep", "keeps one hidden wsl.exe attached"), never as a result.
    assert.doesNotMatch(page, /(keeps|keep) the agent running (after|when) you close|keeps playing with every window closed|starts with Windows by itself|survives a restart of Windows/i, f)
  }
  assert.match(read('INSTALL.md'), /is there to keep Ubuntu running while you are logged in/)
  assert.match(read('README.md'), /a scheduled task of the Windows installer is there to keep Ubuntu running while you are logged in/)
})

test('WIN-1 the record: one row, and what stays open says that get.ps1 has not run on a real Windows PC', () => {
  const record = raw('docs/SECURITY-REVIEW.md')
  // Its section, found by its heading up to the next one: the sections of later dates follow it.
  const from = record.indexOf('\n## Final audit before the public launch (2026-11-11)')
  assert.ok(from > 0, 'the section is in the record')
  const next = record.indexOf('\n## ', from + 1)
  const section = record.slice(from, next < 0 ? undefined : next)
  const rows = section.split('\n').filter(l => l.startsWith('| WIN-1 |'))
  assert.equal(rows.length, 1)
  const cells = rows[0]!.split(/(?<!\\)\|/).slice(1, -1).map(c => c.trim())
  assert.equal(cells.length, 4)
  assert.equal(cells[1], 'new feature')
  for (const said of ['`get.ps1`', '`wsl --install --no-distribution`', 'the first `systemd` line counts', 'never `--shutdown`', 'a download cut short runs nothing',
    'only the digits of the dashboard port', '`-Uninstall` removes that task and nothing else', 'Checked on Linux only']) assert.ok(cells[3]!.includes(said), said)
  const open = section.slice(section.indexOf('Stays open:')).replace(/\s+/g, ' ')
  // (Since the real-PC check of 2026-11-13 the line says that it ran, and where its findings are.)
  assert.match(open, /`get\.ps1` ran on a real Windows PC on 13 Nov 2026: what was found, fixed and left open is in the section "Windows real-PC check \(2026-11-13\)"/)
  assert.match(open, /`docs\/WINDOWS-TEST\.md` is the walk-through for the owner's PC/)
  assert.doesNotMatch(open, /is prepared apart and is not shipped/)
})

test('WIN-1 the plan for the real PC: the public key only, what cannot be driven over SSH, and every step of the walk-through', () => {
  const plan = raw('docs/WINDOWS-TEST.md')
  const flat = plan.replace(/\s+/g, ' ')
  // (It ran on a real PC on 2026-11-13 and again on 2026-11-14; the walk-through says so and points at the record.)
  assert.match(flat, /\*\*It ran on a real Windows PC twice\*\*, on 13 and 14 Nov 2026, the same PC both times/)
  assert.match(flat, /Only a \*\*public\*\* key crosses a chat\. Never a password and never a private key/)
  // (One script block since W-DOC-2 of 2026-11-14, with Microsoft's MSI where the capability fails: W-DOC-1.)
  assert.match(plan, /^ {4}try \{ Add-WindowsCapability -Online -Name OpenSSH\.Server~~~~0\.0\.1\.0 \| Out-Null \} catch \{ \}$/m)
  assert.match(plan, /^\$file = "\$env:ProgramData\\ssh\\administrators_authorized_keys"$/m)
  assert.match(plan, /^icacls\.exe \$file \/inheritance:r \/grant '\*S-1-5-32-544:F' \/grant '\*S-1-5-18:F'$/m)
  assert.match(plan, /'PasswordAuthentication no'/)
  for (const step of ['The administrator prompt', 'The restart', 'After the restart, paste again', 'Ubuntu\'s first user', 'The installer\'s questions', 'Close **every** window, wait 15 minutes',
    'Restart Windows, log on', 'An update from the dashboard', 'The uninstall']) assert.ok(plan.includes(`| ${step}`), step)
  assert.match(flat, /## 2\. What cannot be driven over SSH - \*\*The administrator prompt \(UAC\)\.\*\*/)
  assert.match(flat, /the \*\*browser\*\*/)
  assert.ok(plan.includes(`'${TASK}'`))
  assert.doesNotMatch(plan, /[^\x00-\x7e]/, 'the plan is plain ASCII: no long dash')
})

// The check in a container: the PowerShell parser and the decisions of get.ps1, with stand-ins for wsl.exe and Windows.
const docker = (...args: string[]) => spawnSync('docker', args, { encoding: 'utf8', timeout: 30_000 })
const why = ((): string | false => {
  if (process.env.FOX_SKIP_DOCKER === '1') return 'FOX_SKIP_DOCKER=1'
  const version = docker('version', '--format', '{{.Server.Version}}')
  if (version.error || version.status !== 0) return 'Docker is not on this machine (or its daemon cannot be reached): the PowerShell checks of get.ps1 did not run'
  if (docker('image', 'inspect', '--format', '{{.Id}}', IMAGE).status !== 0) return `the image ${IMAGE} is not on this machine (docker pull ${IMAGE}): the PowerShell checks of get.ps1 did not run`
  return false
})()

test('WIN-1 in a container (PowerShell 7 on Linux): the parser reads get.ps1 with zero errors and every check of test/windows/get-ps1.checks.ps1 passes', { skip: why }, () => {
  assert.ok(existsSync(new URL('test/windows/get-ps1.checks.ps1', ROOT)))
  const name = `fox-ps-test-${process.pid}`
  const run = spawnSync('docker', ['run', '--rm', '--name', name, '--network', 'none', '-e', 'FOX_PS_SANDBOX=1', '-v', `${fileURLToPath(ROOT)}:/work:ro`, IMAGE,
    'pwsh', '-NoProfile', '-File', '/work/test/windows/get-ps1.checks.ps1'], { encoding: 'utf8', timeout: 200_000 })
  if (run.error) docker('rm', '-f', name)
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`
  assert.equal(run.error, undefined, `the container did not finish: ${String(run.error)}\n${out.slice(-2000)}`)
  const failed = out.split('\n').filter(l => l.startsWith('FAILED'))
  assert.deepEqual(failed, [], out.slice(-3000))
  assert.match(out, /^ok {6}the PowerShell parser reads get\.ps1 with zero errors$/m)
  const total = /^get\.ps1 checks: (\d+) passed, 0 failed$/m.exec(out)
  assert.ok(total, out.slice(-1500))
  assert.ok(Number(total[1]) >= 60, `${total[1]} checks ran`)
  assert.doesNotMatch(out, /== 6\. skipped/, 'the steps against the stand-in wsl.exe ran')
  assert.equal(run.status, 0)
})
