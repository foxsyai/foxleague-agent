# Trying the Windows installer on a real PC

For maintainers. `get.ps1` was written on Linux. What was checked there: the PowerShell parser reads it, its
decisions are held by `test/windows/get-ps1.checks.ps1` (PowerShell 7 in a container, `wsl.exe` and Windows
replaced by stand-ins) and `test/audit-1111/windows-1.test.ts`. **It has never run on Windows.** Nothing below is
known until someone has done it on a real PC and written down what happened. Until then `docs/SECURITY-REVIEW.md`
lists it under "Stays open".

What only a real PC can show:

- Windows PowerShell 5.1 itself (the checks ran in PowerShell 7).
- Every answer of the real `wsl.exe`: its exit codes, what a PC without WSL answers, the administrator prompt,
  the restart, how Ubuntu's first start asks for the username.
- The scheduled task: that an ordinary user may make it, that `conhost.exe --headless` shows no window, and
  that Ubuntu really stays up with every window closed.
- `http://localhost:8870` from the Windows browser.

## 1. Let the maintainer's laptop in (once, at the PC)

Only a **public** key crosses a chat. Never a password and never a private key.

The maintainer sends the one line of `~/.ssh/id_ed25519.pub` (it starts with `ssh-ed25519`). At the PC, open
PowerShell **as administrator** and paste:

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Set-Service -Name sshd -StartupType Automatic
Start-Service sshd
if (-not (Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22
}
New-ItemProperty -Path 'HKLM:\SOFTWARE\OpenSSH' -Name DefaultShell -PropertyType String -Force -Value 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
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

## 3. Getting the files to the PC before the release is public

After the public release the line of the guide is pasted as it is and this section is skipped. Before it, GitHub
gives the PC nothing, so a throwaway release is served from the laptop on the network both machines share. The
recipe uses the tools that `scripts/release/fresh-install-check.sh --keep` leaves in its work folder (the folder
above the `logs` folder its last line names); it was written from reading that script and has not been run:

```sh
W=/tmp/fox-fresh.XXXXXX                         # that work folder
mk() { FOX_REPO=$PWD node --disable-warning=ExperimentalWarning "$W/tools/mkrel.ts" "$@"; }
mk init /tmp/fox-win && mk release /tmp/fox-win 1.0.0 --notes "The first release."
node "$W/tools/serve.mjs" /tmp/fox-win/site <laptop address> 8765 &
scp get.ps1 <windows user>@<pc address>:
```

At the PC, in the normal PowerShell window, in the folder that holds `get.ps1` (the user's home folder):

```powershell
$env:FOXAGENT_GET_URL = 'http://<laptop address>:8765/get.sh'
$env:FOXAGENT_RELEASES = 'http://<laptop address>:8765'
Get-Content -Raw .\get.ps1 | iex
```

That is the pasted line with the file read from disk. For the update of step 10: `mk release /tmp/fox-win 1.0.1`
on the laptop while the agent runs. The uninstall line is
`& ([scriptblock]::Create((Get-Content -Raw .\get.ps1))) -Uninstall`.

## 4. The walk-through

Best on a PC that never had WSL. Write down, for every step: what was on the screen (a photo or the copied
text), how long it took, and anything that was not what the installer or the guide said.

| # | Step | Where | Write down |
|---|---|---|---|
| 0 | Before anything: `winver`, `$PSVersionTable.PSVersion`, `wsl --status`, Task Manager, Performance, CPU: "Virtualization" | PC | The Windows edition and build, the PowerShell version, what `wsl --status` says and its `$LASTEXITCODE` on a PC without WSL, how long it takes to answer |
| 1 | Paste the line in a normal PowerShell window | PC | Every line of "Windows 1/6" and "2/6". Does it name the build? Does "Asking Windows about WSL" appear, and for how long? |
| 2 | The administrator prompt | PC | What the prompt names ("Windows Subsystem for Linux"?). Whether a window opens and closes. What the installer says after Yes. Then once more with **No**: the sentence it stops with |
| 3 | The restart | PC | Does it say "Restart Windows now, then paste the same line again"? Paste the line again **before** restarting: what happens (a second prompt is expected, no harm) |
| 4 | After the restart, paste again | PC | Does it go straight to "Windows 3/6"? Is there a second administrator prompt (there should be none)? |
| 5 | Ubuntu's first user | PC | Does Ubuntu ask in the same window or in its own? The exact questions. Is `exit` needed to come back, as the installer said? What the installer prints when it goes on |
| 6 | "Windows 4/6" | PC, then SSH | What it says about `/etc/wsl.conf`. Over SSH: `wsl -d Ubuntu -u root cat /etc/wsl.conf` (one `[boot]`), `wsl -d Ubuntu systemctl is-system-running` |
| 7 | The installer's questions (the seven steps) | PC | Are the questions readable and answered in the same window? Do the recovery words disappear after the yes? Does the installer inside offer the browser (it does when it finds `explorer.exe`)? |
| 8 | "Windows 6/6" and "Done" | PC, then SSH | The trigger it names ("logon and every 5 minutes"?). "The task is running"? Any window that stays open or flashes? The dashboard address, the Explorer path (open it). The dashboard in the Windows browser: sign in |
| 9 | Close **every** window, wait 15 minutes | SSH | First `curl.exe -s http://localhost:8870/healthz` (expected: `ok`), then `Get-ScheduledTask -TaskName 'FoxLeague Agent (WSL)'` (State), `Get-Process wsl, conhost`, and last `wsl -d Ubuntu journalctl --user -u foxleague-agent --since -20min` (no stop and start in between) |
| 10 | Restart Windows, log on, open nothing | PC, then SSH | After 6 minutes the same three checks as step 9. Did a window show at log on? Then lock the screen for 15 minutes and check again |
| 11 | Paste the line again on the finished install | PC | No administrator prompt, no restart of Ubuntu, "systemd is already turned on", the installer's questions with the earlier answers as defaults, one task (not two) in Task Scheduler |
| 12 | An update from the dashboard (Update now) | PC | The notice, the click, the dashboard away for about half a minute, the new version in the header. The task still running |
| 13 | `wsl --shutdown`, open nothing, wait 6 minutes | SSH | `curl.exe` on `/healthz`: is the agent back by itself (the task's 5-minute trigger)? |
| 14 | The uninstall: the PowerShell line with `-Uninstall`, then `./install.sh --uninstall` inside Ubuntu | PC | What each says. Task Scheduler without the task. After 15 minutes with every window closed: `wsl -l --running` shows no Ubuntu. `wsl -l -v` still lists Ubuntu, `/etc/wsl.conf` still has `systemd=true`, the folder and `.env` are there |

Worth a second run when there is time: Windows PowerShell 5.1 and PowerShell 7 (`pwsh`); a PC that already has
an Ubuntu with files in it; a Windows account that is not an administrator (the prompt then asks for another
account's password); a laptop on battery; Windows in another language than English.

## 5. After the test

Put what was seen into `docs/SECURITY-REVIEW.md` (the WIN-1 row and the line under "Stays open"), correct the
sentences of the guides that turned out different, and give each defect a check in
`test/windows/get-ps1.checks.ps1` that fails before its fix.
