# Trying the Windows installer on a real PC

For maintainers. `get.ps1` was written on Linux. What is checked there: the PowerShell parser reads it, its
decisions are held by `test/windows/get-ps1.checks.ps1` (PowerShell 7 in a container, `wsl.exe` and Windows
replaced by stand-ins) and `test/audit-1111/windows-1.test.ts`. **It ran on a real Windows PC twice**, on
13 and 14 Nov 2026, the same PC both times: Windows 10 Home 22H2 (build 19045), Windows PowerShell 5.1, the
Microsoft Store WSL 3.0.1.0, which installed Ubuntu 26.04.1 LTS. What was seen and fixed is in the sections
"Windows real-PC check (2026-11-13)" and "Windows real-PC re-test (2026-11-14)" of `docs/SECURITY-REVIEW.md`. Run
the walk-through again after a change of `get.ps1` and on another PC when one is at hand: what stays open is listed
there.

What only a real PC can show:

- Windows PowerShell 5.1 itself (the checks run in PowerShell 7).
- Every answer of the real `wsl.exe`: its exit codes, what a PC without WSL answers, the administrator prompt,
  the restart, how Ubuntu's first start asks for the username.
- The scheduled task: that an ordinary user may make it, that `conhost.exe --headless` shows no window, and
  that Ubuntu really stays up with every window closed.
- `http://localhost:8870` from the Windows browser.

Every line typed at the PC is in one text file, `docs/WINDOWS-TEST-LINES.txt`, in the order of the walk-through.
Copying lines from a chat to the PC was the hard part of the first run: section 3 puts that file on the PC's
desktop, and from then on each line is copied from Notepad.

## 1. Let the maintainer's laptop in (once, at the PC)

Only a **public** key crosses a chat. Never a password and never a private key.

The maintainer sends the one line of `~/.ssh/id_ed25519.pub` (it starts with `ssh-ed25519`). At the PC, open
PowerShell **as administrator** and paste the block below. It is one script block: a step that fails ends it with
one sentence that says what to do (on the first PC the steps after a failed one went on and printed errors that
hid the first), and it can be pasted again.

```powershell
& {
  $ErrorActionPreference = 'Stop'
  function Fail([string]$Why) { throw ('Stopped: ' + $Why) }
  if (-not (Get-Service sshd -ErrorAction SilentlyContinue)) {
    try { Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 | Out-Null } catch { }
  }
  if (-not (Get-Service sshd -ErrorAction SilentlyContinue)) {
    Fail 'the OpenSSH server could not be added this way. Install Microsoft''s Win32-OpenSSH MSI (below), then paste this block again.'
  }
  Set-Service -Name sshd -StartupType Automatic
  Start-Service sshd
  if (-not (Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null
  }
  New-ItemProperty -Path 'HKLM:\SOFTWARE\OpenSSH' -Name DefaultShell -PropertyType String -Force -Value 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' | Out-Null
  if (-not (Test-Path "$env:ProgramData\ssh\sshd_config")) { Fail 'sshd_config was not made. Restart the PC and paste this block again.' }
  'The OpenSSH server runs: ' + (Get-Service sshd).Status
}
```

On the first PC `Add-WindowsCapability` failed with "The specified package is not valid Windows package" (the
capability stayed NotPresent). What worked is Microsoft's own Win32-OpenSSH installer: download the newest
`OpenSSH-Win64-vX.Y.Z.msi` from https://github.com/PowerShell/Win32-OpenSSH/releases (that PC took 10.4.0.0),
compare its SHA-256 with the one on the release page, install only the server, then paste the block above again:

```powershell
Get-FileHash .\OpenSSH-Win64-vX.Y.Z.msi -Algorithm SHA256
msiexec /i .\OpenSSH-Win64-vX.Y.Z.msi ADDLOCAL=Server /qn
```

Then the key. For an account that is an administrator of the PC (the usual case) it goes into one file for all
administrators, which only Administrators and SYSTEM may touch (the two SIDs are those groups, in every
language of Windows):

```powershell
$key = 'ssh-ed25519 AAAA... maintainer@laptop'   # the PUBLIC key line, as it was sent
$file = "$env:ProgramData\ssh\administrators_authorized_keys"
Add-Content -Path $file -Value $key -Encoding ascii
icacls.exe $file /inheritance:r /grant '*S-1-5-32-544:F' /grant '*S-1-5-18:F'
```

For an account that is not an administrator the file is `$env:USERPROFILE\.ssh\authorized_keys` instead (make the
`.ssh` folder first; no `icacls` line).

Turn password logins off, so that the key is the only way in. Then restart the server:

```powershell
$cfg = "$env:ProgramData\ssh\sshd_config"
(Get-Content $cfg) -replace '^#?PasswordAuthentication .*', 'PasswordAuthentication no' | Set-Content $cfg
Restart-Service sshd
ipconfig | Select-String IPv4      # the address the maintainer connects to
```

From the laptop: `ssh <windows user>@<address>`. When the test is over, at the PC as administrator:
`Stop-Service sshd; Set-Service sshd -StartupType Disabled; Remove-Item "$env:ProgramData\ssh\administrators_authorized_keys"`.

## 2. What cannot be driven over SSH

- **The administrator prompt (UAC).** An SSH session has no desktop to show it on. An SSH session of an
  administrator account also has full rights already, so `get.ps1` would take another path there (it would run
  `wsl --install` itself, without the prompt). The line is therefore pasted **at the PC**, in a normal PowerShell
  window, every time.
- **The restart**, the **log on**, the **browser** and whether a **window flashes** when the scheduled task
  starts. The task runs in the desktop session of the logged-in user, not in an SSH session.
- **Ubuntu's first questions** (username, password): they are the PC owner's, typed at the PC.

Over SSH the maintainer looks: `wsl --version`, `wsl -l -v`, `Get-ScheduledTask -TaskName 'FoxLeague Agent (WSL)' | Get-ScheduledTaskInfo`,
`curl.exe -s http://localhost:8870/healthz`, the agent's journal. One trap: every `wsl ...` command starts
Ubuntu when it is stopped. A check of "is it still up" must therefore ask `curl.exe` first and `wsl` afterwards.
Task Scheduler's last result `0x800710E0` ("The operator or administrator has refused the request") is normal while
the task runs: its 5-minute trigger found it running and did not start a second copy. `267009` (0x41301) is
"running".

## 3. Getting the files to the PC before the release is public

After the public release the line of the guide is pasted as it is and this section is skipped. Before it, GitHub
gives the PC nothing, so a throwaway release is served from the laptop on the network both machines share. The
recipe uses the tools that `scripts/release/fresh-install-check.sh --keep` leaves in its work folder (the folder
above the `logs` folder its last line names). Put the laptop's address into the lines file and serve it too:

```sh
W=/tmp/fox-fresh.XXXXXX                         # that work folder
mk() { FOX_REPO=$PWD node --disable-warning=ExperimentalWarning "$W/tools/mkrel.ts" "$@"; }
mk init /tmp/fox-win && mk release /tmp/fox-win 1.0.0 --notes "The first release."
cp get.ps1 /tmp/fox-win/site/
sed 's/LAPTOP/<laptop address>/g' docs/WINDOWS-TEST-LINES.txt > /tmp/fox-win/site/lines.txt
node "$W/tools/serve.mjs" /tmp/fox-win/site <laptop address> 8765 &
```

`scp` to the PC did not work on the first one ("Connection closed": its OpenSSH had no working SFTP subsystem), so
the PC fetches the files itself with `curl.exe`, which every Windows 10 and 11 has. The desktop may be a folder of
OneDrive (`C:\Users\<user>\OneDrive\Desktop` on the first PC): Windows names it. At the PC, in a normal PowerShell
window, this is the one line that still comes from the chat:

```powershell
cd ([Environment]::GetFolderPath('Desktop')); curl.exe -fsSLo lines.txt http://<laptop address>:8765/lines.txt; curl.exe -fsSLo get.ps1 http://<laptop address>:8765/get.ps1; notepad lines.txt
```

Every other line is in `lines.txt`. The install itself, in that folder:

```powershell
$env:FOXAGENT_GET_URL = 'http://<laptop address>:8765/get.sh'
$env:FOXAGENT_RELEASES = 'http://<laptop address>:8765'
Get-Content -Raw .\get.ps1 | iex
```

That is the pasted line with the file read from disk. The uninstall line is
`& ([scriptblock]::Create((Get-Content -Raw .\get.ps1))) -Uninstall`.

**For the update steps**, the installed agent does not ask the laptop: `FOXAGENT_RELEASES` is for `get.sh` only,
and the agent asks GitHub unless `AGENT_UPDATE_URL` in its `.env` names another place. It takes plain http only
from this computer itself (a loopback address), so inside Ubuntu a small relay passes `127.0.0.1:8765` on to the
laptop. Typed inside Ubuntu (`wsl -d Ubuntu --cd ~`), not through PowerShell, whose quoting broke the line on the
first PC:

```sh
systemd-run --user --unit fox-test-relay ~/foxleague-agent/.node/bin/node -e "const n=require('net');n.createServer(c=>{const u=n.connect(8765,'<laptop address>');c.pipe(u);u.pipe(c);u.on('error',()=>c.destroy());c.on('error',()=>u.destroy())}).listen(8765,'127.0.0.1')"
printf 'AGENT_UPDATE_URL="http://127.0.0.1:8765"\n' >> ~/foxleague-agent/.env
systemctl --user restart foxleague-agent
```

Then `mk release /tmp/fox-win 1.0.1` on the laptop while the agent runs; the dashboard's round arrow (Check for
updates) finds it at once. When the test is over: `systemctl --user stop fox-test-relay` and take the
`AGENT_UPDATE_URL` line out of `.env`.

Before step 11 (the line pasted again), make sure the newest release on the laptop is one that starts: pasting the
line again puts the newest release in place as chosen by hand, with no undo note, so a release made with
`--break-start` would stay broken.

## 4. The walk-through

Best on a PC that never had WSL. Write down, for every step: what was on the screen (a photo or the copied
text), how long it took, and anything that was not what the installer or the guide said.

| # | Step | Where | Write down |
|---|---|---|---|
| 0 | Before anything: `winver`, `$PSVersionTable.PSVersion`, `wsl --status`, Task Manager, Performance, CPU: "Virtualization", the free space of C: | PC | The Windows edition and build, the PowerShell version, what `wsl --status` says and its `$LASTEXITCODE` on a PC without WSL, how long it takes to answer. Below 4 GB free on C: the line stops before Ubuntu is downloaded |
| 1 | Paste the line in a normal PowerShell window | PC | Every line of "Windows 1/6" and "2/6". Does it name the build? Does "Asking Windows about WSL" appear, and for how long? |
| 2 | The administrator prompt | PC | What the prompt names ("Windows Subsystem for Linux"?). Whether a window opens and closes. What the installer says after Yes. Then once more with **No**: the sentence it stops with. A PC with the Store WSL already there asks nothing here (the first PC) |
| 3 | The restart | PC | Does it say "Restart Windows now, then paste the same line again"? Paste the line again **before** restarting: what happens (a second prompt is expected, no harm) |
| 4 | After the restart, paste again | PC | Does it go straight to "Windows 3/6"? Is there a second administrator prompt (there should be none)? |
| 5 | Ubuntu's first user | PC | Does Ubuntu ask in the same window or in its own? The exact questions (the first PC also got "Help improve Ubuntu!", Y/n/e). Did the download look stuck at 0% (a click pauses the window: Enter goes on) and did a "Welcome to WSL" window open? Is `exit` needed to come back, as the installer said (the last line before Ubuntu's own output, in yellow)? Try Enter alone at Ubuntu's username question once. What the installer prints when it goes on |
| 6 | "Windows 4/6" | PC, then SSH | What it says about `/etc/wsl.conf`. Over SSH: `wsl -d Ubuntu -u root cat /etc/wsl.conf` (one `[boot]`), `wsl -d Ubuntu systemctl is-system-running` |
| 7 | The installer's questions (the seven steps) | PC | Are the questions readable and answered in the same window? The username has no default (Enter alone is refused). Do the recovery words disappear after the yes? Is the dashboard address readable on PowerShell's blue? The installer inside offers the browser (it finds `explorer.exe`): does Enter open the dashboard? |
| 8 | "Windows 6/6" and "Done" | PC, then SSH | The trigger it names ("logon and every 5 minutes"?). "The task is running"? Any window that stays open or flashes? The dashboard address, the Explorer path (open it). The dashboard in the Windows browser: sign in. The window's title is PowerShell's own again |
| 9 | Close **every** window, wait 15 minutes | SSH | First `curl.exe -s http://localhost:8870/healthz` (expected: `ok`), then `Get-ScheduledTask -TaskName 'FoxLeague Agent (WSL)'` (State), `Get-Process wsl, conhost`, and last `wsl -d Ubuntu journalctl --user -u foxleague-agent --since -20min` (no stop and start in between) |
| 10 | Restart Windows, log on, open nothing | PC, then SSH | After 6 minutes the same three checks as step 9. Did a window show at log on? Then lock the screen for 15 minutes and check again |
| 11 | Paste the line again on the finished install | PC | No administrator prompt, no restart of Ubuntu, "systemd is already turned on", the installer's questions with the earlier answers as defaults, one task (not two) in Task Scheduler. Afterwards the dashboard's notice no longer shows how an update of the version before went |
| 12 | An update from the dashboard (Update now) | PC | The notice, the click, the dashboard away for about half a minute, the new version in the header. The task still running (section 3: `AGENT_UPDATE_URL` and the relay) |
| 13 | An update that does not start (a release made with `--break-start`) | PC, then SSH | Update now; after two starts that fail the launcher is back on the version before and the agent says so. The notice says so too, without a reload (it no longer says "Installing" for 20 minutes). Then publish a release that starts, before step 11 is done again |
| 14 | `wsl --shutdown`, open nothing, wait 6 minutes | SSH | `curl.exe` on `/healthz`: is the agent back by itself (the task's 5-minute trigger)? |
| 15 | The uninstall: the one PowerShell line with `-Uninstall` and Enter at its one question | PC, then SSH | What it says: "Stopped the hidden wsl.exe that the task had started", the question "Also stop the agent and remove its background service in Ubuntu?", the installer's own lines from inside Ubuntu, then "Done: the agent is stopped and its background service in Ubuntu is removed." Nothing is typed inside Ubuntu. Task Scheduler without the task. After 15 minutes with every window closed: `wsl -l --running` shows no Ubuntu. Then (this starts Ubuntu, so last): `wsl -l -v` still lists Ubuntu, `/etc/wsl.conf` still has `systemd=true`, the folder and `.env` are there, `wsl -d Ubuntu systemctl --user is-enabled foxleague-agent` finds no unit. If there is time: the line once more answered `n` (the lines by hand, each marked with the window it is typed in) |

Worth a second run when there is time: Windows PowerShell 5.1 and PowerShell 7 (`pwsh`); a PC that already has
an Ubuntu with files in it; a Windows account that is not an administrator (the prompt then asks for another
account's password); a laptop on battery; Windows in another language than English; a PC without the Store WSL
(the administrator prompt and the restart of steps 2 to 4 did not happen on the first PC).

## 5. After the test

Put what was seen into `docs/SECURITY-REVIEW.md` (a section of its own with what stays open), correct the
sentences of the guides that turned out different, and give each defect a check in
`test/windows/get-ps1.checks.ps1` that fails before its fix.
