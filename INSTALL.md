# Run your own FoxLeague Agent

FoxLeague Agent manages FoxLeague teams for you: it trains your players, sets the lineup, plays matches and
enters tournaments and 1v1s. It can also fuse cards and bid at auctions. An AI plans every two hours by default
(every hour at the Zeus level); plain code checks every action against the game rules and your spending limits
before anything is paid.

Everything runs on your own computer. Your wallet words and your keys never leave it.

## What you need

- A computer that stays on and awake: Windows 10 or 11, a Mac or Linux with systemd. Each has its own section
  below. A small cloud server works too: for a server set up by hand, see [docs/SERVER.md](docs/SERVER.md).
- About 5 EGLD to start: about 2.5 buys the 5,000 FOXSY registration, 1 stays in the wallet as the gas reserve
  (Settings: EGLD gas reserve), the rest pays for the first games.
- An Anthropic API key: the AI that plans. Without it your agents only watch. The steps are below; about 5 minutes.
- Optional: your agent's Telegram account for notifications and commands on your phone, and a Binance API key for
  EGLD top-ups of the agent wallets, each one approved by you on Telegram with a one-time code.

## Install

Pick your system: [On Windows](#on-windows), [On a Mac](#on-a-mac) or [On Linux](#on-linux). Each section has the
line to paste, what you will see step by step, how to update and uninstall and what to do if it gets stuck. The
site has the same guide as one page per system: [Install on Windows](https://agent.foxleague.ai/start/install-windows/),
[Install on Mac](https://agent.foxleague.ai/start/install-mac/) and
[Install on Linux](https://agent.foxleague.ai/start/install-linux/).

### On Windows

On Windows the agent runs inside Ubuntu, a Linux that Windows itself runs (WSL 2). One line in PowerShell sets
that up where it is missing and then starts the same guided installer as on Linux. The agent then plays while you
are logged in to Windows and the PC is awake.

#### Before you start

- **64-bit Windows 11 or Windows 10 version 2004 or later** (build 19041 or newer). To see yours, press the Windows
  key and R, type `winver` and press Enter. The installer checks it in its first step.
- **Virtualization turned on** in the PC's BIOS or UEFI setup. Most PCs have it on. The installer checks it and
  says so when it is off.
- **About 4 GB free on drive C:** when Ubuntu still has to be installed. The line checks it before the download
  and stops below that.
- **Internet**, for Ubuntu, the agent and its Node.js.
- **An ordinary PowerShell window**, not "Run as administrator". Where an administrator is needed, Windows asks
  with its own prompt.

#### The line to paste

Open **Windows PowerShell**: press Start, type PowerShell and choose Windows PowerShell. Use a normal window, not
"as administrator". Paste this line into the window with a right click or Ctrl+V and press Enter:

```
irm https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.ps1 | iex
```

It is safe to paste it again at any time: each run finds what is already done and goes on from there. Paste one
line at a time, here and everywhere in this section. To install a given version, set it in PowerShell before the
line, for example `$env:FOXAGENT_VERSION = 'vX.Y.Z'`. `FOXAGENT_DIR` names another folder, always one inside
Ubuntu, never a Windows folder. Your Linux user has one background service: when it already runs the agent of another folder, the installer
stops and says how to go on.

#### What you will see, step by step

The installer says each step in one yellow line. Most steps pass by themselves; the ones that need you are said
here.

1. **Windows 1/6: checking this PC.** "64-bit Windows, build ...: new enough for WSL 2." On a PC that cannot run
   the agent it stops with the reason in one red line: a 32-bit Windows, the 32-bit PowerShell ("Windows
   PowerShell (x86)": open the normal one), a build that is too old (install the Windows updates in Settings,
   Windows Update) or the PowerShell ISE (open Windows PowerShell instead).
2. **Windows 2/6: WSL, the part of Windows that runs Linux.** "Asking Windows about WSL (this can take a minute)."
   On a PC that already has WSL 2 it then says "WSL 2 is installed." A WSL that is too old for systemd is updated
   with Microsoft's own `wsl --update`. When WSL is missing, the installer first looks at virtualization. Then it
   runs Microsoft's own `wsl --install --no-distribution`. That needs an administrator, so Windows shows its own
   prompt: answer Yes. The prompt names Windows Subsystem for Linux (wsl.exe). The installer asks "Ready?" before
   it (Enter means yes). A window may open while it works; it closes by itself. When Windows then needs a restart,
   the installer says so: restart, open PowerShell again and paste the same line. It says "Restart Windows now,
   then paste the same line again": use Start, Power, Restart (not Shut down).
3. **Windows 3/6: Ubuntu, the Linux the agent runs in.** When Ubuntu is not installed yet, the installer checks the
   free space, says what comes next and asks "Ready?". Then it downloads Ubuntu with Microsoft's own
   `wsl --install -d Ubuntu`, in the same window, with a progress bar.
   - The download can look stuck at 0%: a click into the PowerShell window pauses it (Windows then selects text),
     and Enter once lets it go on. A window "Welcome to WSL" may open by itself: close it.
   - Ubuntu then asks you to choose a Linux username and password, in the same window or in a window of its own.
     They are new and yours to choose: they are not your Windows login and the installer never sees them. Use
     small letters for the username, for example `ana`: Ubuntu refuses capitals and spaces.
   - Nothing shows while you type the password, not even dots. That is normal: type it, press Enter, type it
     again. Remember it: Ubuntu asks for it when a command starts with `sudo`.
   - Ubuntu may also ask "Help improve Ubuntu!" (Y/n/e): either answer is fine for the agent.
   - When Ubuntu then shows its own prompt (a line that ends with `$`), type `exit` and press Enter to come back to
     the installer. The last yellow line before the download says it too.
4. **Windows 4/6: Ubuntu's settings (systemd, curl).** The installer turns on systemd in Ubuntu's `/etc/wsl.conf`.
   It corrects the line that is there and never adds a second `[boot]`; the file as it was is kept in
   `/etc/wsl.conf.before-foxleague`. When systemd still has to start, it restarts Ubuntu once; if you already use
   this Ubuntu, it asks "Restart Ubuntu now?" first. Then it installs curl, tar and the certificates for https
   when they are missing.
5. **Windows 5/6: the agent's installer, inside Ubuntu.** The same seven steps as on Linux, in the same window
   ([The seven steps](#the-seven-steps)).
6. **Windows 6/6: keeping the agent running.** The installer makes a scheduled task of your Windows user, "FoxLeague
   Agent (WSL)", started at logon and every 5 minutes, which keeps one hidden `wsl.exe` attached to Ubuntu. It
   says "The task is running."
7. **Done.** The dashboard address (`http://localhost:8870` unless you chose another port), the agent's folder as
   Windows Explorer opens it and the line that opens Ubuntu. "Open the dashboard in your browser now?" is asked
   once, by the installer inside Ubuntu or by this last screen: Enter opens it in your Windows browser.

**When it plays.** On Windows the agent runs while Ubuntu (WSL) runs. By itself, closing the last Ubuntu window
may stop it after a short while and Ubuntu does not start with Windows. The scheduled task is there to keep Ubuntu
running while you are logged in to Windows, with every window closed. The agent does not play while the PC is off
or asleep and not before you log in after a restart. After a restart the agent is back about a minute after you
log in; after `wsl --shutdown`, within about 5 minutes, at the task's next check. To let it play while you are
away from the PC, set the PC not to sleep (Settings, System, Power & sleep on Windows 10 or Power & battery on
Windows 11).

**Its files** are inside Ubuntu, in `~/foxleague-agent`; from Windows Explorer that folder is
`\\wsl$\Ubuntu\home\<your Linux username>\foxleague-agent`. The commands of this guide that start with `./`,
`systemctl` or `journalctl` are typed inside Ubuntu: open it with `wsl -d Ubuntu --cd ~` in PowerShell, then
`cd foxleague-agent`. Type `exit` to come back to PowerShell. A line with `&&` belongs inside Ubuntu (Windows
PowerShell refuses `&&`), and a line that starts with `wsl` belongs in PowerShell.

#### Updating

An update is one click: **Update now** in the dashboard ([Updates](#updates)). The round arrow next to the version
in the dashboard's header, **Check for updates**, asks now. A new version that does not start is undone by itself
after about a minute and a half, and a failed update says why in the notice. From a terminal: open Ubuntu with
`wsl -d Ubuntu --cd ~`, then `cd foxleague-agent` and `./install.sh --update`. Pasting the PowerShell line again
also puts the newest version in place. When the notice says "this system's tar cannot unpack inside the agent's
background service", an older installer set that service up: open Ubuntu, `cd foxleague-agent` and run
`./install.sh --update` once; later updates are one click again.

#### Uninstalling

The uninstall is one line in PowerShell:

```
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.ps1))) -Uninstall
```

It removes the scheduled task that keeps Ubuntu running and stops the hidden `wsl.exe` the task started (known by
its whole command line). Nothing else of Windows is touched. Then it asks one question: "Also stop the agent and
remove its background service in Ubuntu?" Enter means yes: it runs `./install.sh --uninstall` inside Ubuntu for you
and says how that went. Nothing has to be typed inside Ubuntu. With `n` or when it cannot do it, it shows the lines
to type by hand: `wsl -d Ubuntu --cd ~` in PowerShell, then inside Ubuntu
`cd ~/foxleague-agent && ./install.sh --uninstall` and `exit`, one line at a time.

What stays: your folder inside Ubuntu, with the wallet words (`.env`), the data and the PEM files (about 240 MB,
and about 280 MB once an update has kept the release before it); WSL, Ubuntu and the line `systemd=true` in
Ubuntu's `/etc/wsl.conf`, because other programs may use them (a file the installer changed is kept as it was in
`/etc/wsl.conf.before-foxleague`); and linger, which the uninstall says how to turn off. The agent wallets may
still hold funds. Keep the recovery words, and delete the folder only when the wallets are empty. Ubuntu stops by
itself a short while after its last window closes. Do not remove Ubuntu itself (`wsl --unregister Ubuntu`
deletes everything in it) while the agent wallets hold funds or the recovery words are not on paper.
`Unregister-ScheduledTask -TaskName 'FoxLeague Agent (WSL)' -Confirm:$false` removes only the task: the hidden
`wsl.exe` it started runs on and keeps Ubuntu up until Windows restarts (`wsl --terminate Ubuntu` stops Ubuntu now).

#### If it gets stuck

- **"Windows says that virtualization is turned off", or an error that names virtualization or 0x80370102:** WSL 2
  needs virtualization, which is turned on in the PC's BIOS or UEFI setup. At "Go on anyway?" Enter means no and
  nothing is changed. Restart the PC and press the setup key while it starts: F2, Del, F10 or Esc, depending on the
  maker (the PC maker's guide tells which). Turn on Intel VT-x (Intel Virtualization Technology), AMD-V or SVM,
  save and restart, then paste the PowerShell line again. `systeminfo` shows "Virtualization Enabled In Firmware:
  Yes" once it is on. Where a hypervisor already runs (Windows 11 starts one for its own security as soon as
  virtualization is on) it shows "A hypervisor has been detected. Features required for Hyper-V will not be
  displayed." instead, which means it is on too. Task Manager shows it too (Performance, CPU, "Virtualization:
  Enabled").
- **"Ubuntu and the agent need about 4 GB free on C:":** free some space on C:, then paste the line again.
  Settings, System, Storage shows what takes the room (Storage Sense and Disk Cleanup remove temporary files). The
  hibernation file, `hiberfil.sys`, can take several GB: `powercfg /h off` in a PowerShell opened as administrator
  removes it. That turns off hibernation and Fast Startup; `powercfg /h on` turns them on again.
- **"WSL 2 requires an update to its kernel component":** run `wsl --update` in PowerShell, then paste the
  PowerShell line again.
- **"Restart Windows now, then paste the same line again":** Windows finishes installing WSL while it restarts.
  Use Restart (not Shut down), open PowerShell again and paste the same line: it goes on where it stopped. Pasting
  it more than once does no harm.
- **"WSL was not installed: the administrator prompt was answered with No":** paste the line again and answer Yes.
  On an account that is not an administrator: open PowerShell as administrator (right-click the Start button,
  then Terminal (Admin) or Windows PowerShell (Admin)), type `wsl --install --no-distribution`, restart Windows
  when it says so and paste the line again in a normal window.
- **The Ubuntu download stays at 0%:** a click into the PowerShell window starts Windows' text selection, which
  pauses the program in it: press Enter once (Esc works too) and the download goes on. A window "Welcome to WSL"
  may open by itself while Ubuntu installs: close it.
- **Ubuntu shows a line that ends with `$` and nothing happens:** that is Ubuntu's own prompt. Type `exit` and
  press Enter: the installer goes on.
- **"Ubuntu has no user of your own yet":** press Enter and choose the username and password Ubuntu asks for. If
  it asks nothing and shows a prompt at once, type `exit`, open Ubuntu from the Start menu, choose them there and
  paste the line again.
- **"Ubuntu starts as root":** Ubuntu's first start was done earlier with root as its user (or root was made its
  default since), so it asks for nothing. The agent is installed as the user Ubuntu starts as, which has to be one of
  your own. The installer names the user Ubuntu has, or says how to make one (`adduser`), and how to make it the one
  Ubuntu starts as: the two lines `[user]` and `default=` with its name in `/etc/wsl.conf`, then
  `wsl --terminate Ubuntu` in PowerShell and the line again.
- **The browser did not open:** open `http://localhost:8870` in your browser yourself (or the port you chose).
- **The dashboard does not open at `http://localhost:8870`:** the agent runs inside Ubuntu and Windows passes
  `localhost` on to it. Run `wsl --shutdown` in PowerShell, wait ten seconds and paste the PowerShell line again: it
  starts Ubuntu, the agent and the scheduled task again. Your wallet and your answers are kept.
- **The agent stops when I close Ubuntu, or after Windows restarts:** the scheduled task "FoxLeague Agent (WSL)",
  which the PowerShell line makes, is there to keep Ubuntu running while you are logged in: look for it in Task
  Scheduler (Task Scheduler Library) and paste the PowerShell line again to make it again. Until it runs, open
  Ubuntu and leave its window open (minimised is fine): the agent starts with it. The agent does not play while the
  PC is off or asleep and not before you log in.
- **Task Scheduler shows 0x800710E0 for "FoxLeague Agent (WSL)":** Windows' "The operator or administrator has
  refused the request". The task's 5-minute trigger found the task still running and did not start a second
  copy: normal while the agent runs.
- **"this machine does not run systemd":** the PowerShell line turns systemd on by itself: it puts `systemd=true`
  under `[boot]` in Ubuntu's `/etc/wsl.conf` (it corrects a line that says false and never adds a second `[boot]`)
  and restarts Ubuntu. Paste the line again.
- **"The token '&&' is not a valid statement separator in this version":** that line belongs inside Ubuntu. Open
  Ubuntu with `wsl -d Ubuntu --cd ~` and paste it there, one line at a time.
- **"wsl: command not found":** that line belongs in PowerShell. Type `exit` to leave Ubuntu, then paste it again.

#### Installing by hand

Without the PowerShell line: run `wsl --install -d Ubuntu` in PowerShell opened as administrator, restart if
Windows asks, open Ubuntu and choose its username and password. Turn on systemd: make the line under `[boot]` in
`/etc/wsl.conf` read `systemd=true` (add the two lines `[boot]` and `systemd=true` when the file has no `[boot]`;
never a second `[boot]`: WSL takes the first `systemd` line it finds), run `wsl --shutdown` in PowerShell and open
Ubuntu again. Run `sudo apt install curl` if curl is missing and paste the curl line of [On Linux](#on-linux) in
Ubuntu. Installed that way, nothing keeps Ubuntu running: leave an Ubuntu window open. Or paste the PowerShell line
once: it keeps your install and adds the scheduled task.

### On a Mac

On a Mac the agent runs as a background agent of your own user (launchd). The agent then plays while you are
logged in and the Mac is awake.

#### Before you start

- **A Mac with macOS**, with an Apple silicon or an Intel processor. The install was checked on macOS 15 on Apple
  silicon.
- **No Xcode and no developer tools.** The line needs only what every Mac has (Terminal, curl and tar), and the
  installer brings its own copy of Node.js. The install was checked on a Mac without Xcode's command line tools.
- **Your own user account**, the one you log in with. Do not put `sudo` in front of the line: as root the installer
  stops.
- **Internet**, for the agent and its Node.js.

#### The line to paste

Open **Terminal**: press Cmd and Space, type Terminal and press Enter (or Finder, Applications, Utilities,
Terminal). Paste this line with Cmd and V and press Enter:

```
curl -fsSL https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.sh | bash
```

macOS has curl already. The download and the setup take a few minutes; the questions take as long as you need.
The switches of [On Linux](#on-linux) (`FOXAGENT_VERSION`, `FOXAGENT_ALLOW_DOWNGRADE`, `FOXAGENT_DIR`) work the same
way.

#### What you will see, step by step

"Downloading foxleague-agent" with the version and the folder, "The download matches the release's checksum." and
"Starting the installer". Then [the seven steps](#the-seven-steps). Step 7 starts the agent as a launch agent of
your user (`ai.foxleague.agent`). The dashboard address on the last screen is a link: hold Cmd and click it. Then
"Open the dashboard in your browser now?": Enter opens it.

**When it plays.** On macOS the agent starts when you log in, and a sleeping Mac plays nothing. Its timers pause
while the Mac sleeps: it plans, plays and checks for updates only while the Mac is awake. When the Mac wakes, it
goes on. To let it play while you are away, keep the Mac awake. In System Settings open Energy (on a MacBook:
Battery, then Options) and turn on "Prevent automatic sleeping" (on a MacBook: on power adapter). Or run
`caffeinate -i` in a Terminal window and leave it open: the Mac stays awake until you press Ctrl-C there. A
MacBook with its lid closed sleeps.

#### Updating

An update is one click: **Update now** in the dashboard ([Updates](#updates)). The round arrow next to the version
in the dashboard's header, **Check for updates**, asks now; by itself the agent asks about every 10 minutes while
the Mac is awake. A new version that does not start is undone by itself, and a failed update says why in the
notice. From a terminal: `cd ~/foxleague-agent`, then `./install.sh --update` (as yourself, without sudo).

#### Uninstalling

`cd ~/foxleague-agent`, then `./install.sh --uninstall`. It stops the background agent and removes its file from
`~/Library/LaunchAgents`: no service, no background process and no open port of the agent are left. It leaves your
folder, wallet and PEM files in place. Everything the install added is in that folder, its own Node.js and the
download cache of npm included: about 240 MB, and about 280 MB once an update has kept the release before it (kept
so that the update can be undone). The agent wallets may still hold funds. Keep the recovery words, and delete the
folder only when the wallets are empty. Type it as yourself, without sudo: with sudo it stops and says so. When it cannot stop the agent (one you
started yourself with `./run.sh`, for example), it says so and how to stop it.

#### If it gets stuck

- **The agent does not play while my Mac sleeps:** a sleeping Mac plays nothing. Keep it awake while the agent
  should play: "Prevent automatic sleeping" in System Settings under Energy (on a MacBook: Battery, then Options),
  or `caffeinate -i` in a Terminal window you leave open.
- **The agent does not run after a restart of the Mac:** it starts when you log in: log in at the Mac.
- **No update notice, although a new version is out:** the agent checks only while the Mac is awake, about every
  10 minutes. Press the round arrow next to the version (**Check for updates**) to ask now.
- **"do not install the agent as root":** the line was run with `sudo` or as root. Paste it as your own user,
  without `sudo`.
- **The dashboard does not open:** look at the log, `tail -f ~/foxleague-agent/data/service.log`, and restart the
  agent with `launchctl kickstart -k gui/$(id -u)/ai.foxleague.agent`.

### On Linux

On Linux the agent runs as a background service of your own user (systemd). It keeps running after you log out
and after a restart, for as long as the computer is on and awake.

#### Before you start

- **Linux with systemd** on a 64-bit processor (x86-64 or ARM64). The install is checked on Ubuntu 24.04 and
  26.04.
- **A normal user account**, not root. Install as a user of your own, not as root: as root the installer stops and
  tells you to create a user first (`adduser fox`, then `su - fox` and paste the line).
- **curl.** On Ubuntu, install curl first, because Ubuntu Desktop comes without it: `sudo apt install curl`. Use
  this one, not the snap that Ubuntu's hint offers: the apt one is the one the install is tested with.
- **Internet**, for the agent and its Node.js.

#### The line to paste

Open a terminal (on Ubuntu: Ctrl+Alt+T), paste this line with Ctrl+Shift+V and press Enter:

```
curl -fsSL https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.sh | bash
```

The line downloads the newest release into `~/foxleague-agent`, checks the download against the release's checksum
and starts the guided installer. To install a given version, put it in front: `curl -fsSL .../get.sh | FOXAGENT_VERSION=vX.Y.Z bash`. An older version is not
put over a newer install: add `FOXAGENT_ALLOW_DOWNGRADE=1` in front of `bash` to go back anyway (the settings and
limits the newer version added are then not applied). Another folder is named with `FOXAGENT_DIR`; it must be
empty or hold an install of foxleague-agent. Your user has one background service: when it already runs the agent of another folder, the installer stops
before the first question and says how to go on (`./install.sh --uninstall` in that folder first, or
`./install.sh --no-service` here). If you prefer git:
`git clone https://github.com/foxsyai/foxleague-agent.git && cd foxleague-agent && ./install.sh`. A git checkout
follows its branch: `./install.sh --update` pulls it, and that may be code that is in no release yet.

#### What you will see, step by step

"Downloading foxleague-agent" with the version and the folder, "The download matches the release's checksum." and
"Starting the installer". Before the first question the installer checks that curl, tar and your user's systemd
are there. Then [the seven steps](#the-seven-steps). Step 7 starts the agent as a systemd service of your user
(`foxleague-agent`) and turns on linger, which lets services of your user start without a login. The dashboard
address on the last screen is a link: in most terminals, hold Ctrl and click it. On a computer with a desktop the
installer then asks "Open the dashboard in your browser now?".

**When it plays.** On Linux the agent keeps running after you log out and after a restart, also when nobody logs
in. It plays while the computer is on and awake: a laptop that sleeps plays nothing until it wakes.

**On a server without a desktop** the dashboard listens on that machine only (127.0.0.1). From your own computer,
open an SSH tunnel and leave it open: `ssh -L 8870:localhost:8870 you@your-server`, then open
`http://localhost:8870` on your own computer. Never open the port to the internet. For a server with its own user
for the agent and the dashboard behind nginx, see [docs/SERVER.md](docs/SERVER.md).

#### Updating

An update is one click: **Update now** in the dashboard ([Updates](#updates)). The round arrow next to the version
in the dashboard's header, **Check for updates**, asks now. A new version that does not start is undone by itself
after about a minute and a half, and a failed update says why in the notice. From a terminal:
`cd ~/foxleague-agent`, then `./install.sh --update` (as yourself, without sudo). When the notice says "this system's tar cannot unpack inside
the agent's background service", an older installer set that service up: run `./install.sh --update` once in a
terminal, in the agent's folder; later updates are one click again.

#### Uninstalling

`cd ~/foxleague-agent`, then `./install.sh --uninstall`. It stops the background service, removes it and leaves
your folder, wallet and PEM files in place. Everything the install added is in that folder, its own Node.js and the
download cache of npm included: about 240 MB, and about 280 MB once an update has kept the release before it (kept
so that the update can be undone). The agent wallets may still hold funds. Keep the recovery words, and delete the
folder only when the wallets are empty. The uninstall also leaves linger on, which lets background services of
your user start without a login, because other services of yours may count on it: `loginctl disable-linger $USER`
turns it off. Type it as yourself, without sudo: with sudo it stops and says so. When it cannot stop the agent (one you
started yourself with `./run.sh`, for example), it says so and how to stop it.

#### If it gets stuck

- **"Command 'curl' not found" or "curl is needed and is not installed":** run `sudo apt install curl`, then paste
  the install line again. A missing tar is said the same way: `sudo apt install tar`.
- **"do not install the agent as root":** create a user for the agent: `adduser fox`, then `su - fox` and paste the
  line again.
- **"this machine does not run systemd":** systemd keeps the agent running in the background. Without systemd: run
  `./install.sh --no-service` in the agent's folder, then start the agent yourself with `./run.sh`. In Ubuntu on
  Windows (WSL) the PowerShell line turns systemd on by itself (see [On Windows](#on-windows)). By hand there: make
  the line under `[boot]` in `/etc/wsl.conf` read `systemd=true` (add the two lines `[boot]` and `systemd=true` when
  the file has no `[boot]`), run `wsl --shutdown` in PowerShell, open Ubuntu again and run the installer again.
- **"the background services of the user ... cannot be reached from this terminal":** the terminal was opened with
  `su` or `sudo` and the installer could not start the user's services from it. Log in as that user itself (a new
  terminal, or `ssh` to the machine as that user) and run the installer again.
- **"Job for foxleague-agent.service failed" (or "Start request repeated too quickly"):** systemd allows the agent
  five starts in ten minutes and then refuses the next one. Run
  `systemctl --user reset-failed foxleague-agent && systemctl --user restart foxleague-agent`. The installer and
  `./install.sh --update` clear that count themselves before they restart the agent.
- **The agent stops when I log out:** run `sudo loginctl enable-linger $USER` once. The installer turns linger on;
  when it could not, it said "the agent runs while you are logged in".
- **The browser did not open:** open `http://localhost:8870` in your browser yourself (or the port you chose). On a
  server without a desktop, use the SSH tunnel above.

### The seven steps

On every system the installer walks you through seven steps and explains each one:

| Step | What happens |
|---|---|
| 1/7 Node.js and dependencies | Uses the Node.js on your computer when the agent runs on it (22 from 22.18, or 24.2 and later, with npm beside it), otherwise downloads a private copy into the `foxleague-agent` folder and checks it against the SHA-256 written in the installer. Nothing is installed for the whole system. |
| 2/7 Your wallet | Creates a new wallet and shows its recovery words once. Write them down on paper, then type `yes`. |
| 3/7 Dashboard login | You choose a username (3 to 32 letters or digits), a password (at least 12 characters, typed twice) and a port (default 8870). There is no default username: Enter alone is refused. A password that is too short or typed differently the second time is asked for again. A port that another program already uses is refused and the next one is offered. |
| 4/7 Keys | The AI key, Telegram and the CEX top-up key. Nothing you paste is shown. Every key can be skipped and added later in the dashboard. |
| 5/7 Settings | A new install starts in dry run. You choose whether this computer may sign real transactions once you press Go LIVE. |
| 6/7 PEM files | Writes `pem/agent1.pem`, so you can log into FoxLeague as your agent's team and watch it play. |
| 7/7 Background service | Starts the agent in the background. On Linux it keeps running after you log out and after a restart. On macOS it starts when you log in. On Windows it runs while Ubuntu (WSL) runs: the scheduled task of the Windows installer is there to keep Ubuntu running while you are logged in. |
| Done | The dashboard address with your username, agent 1's wallet address, the PEM folder, the next steps and the everyday commands. On a computer with a desktop: "Open the dashboard in your browser now?" |

Run `./install.sh` again at any time (on Windows, paste the PowerShell line again): it keeps your wallet, login and
keys. It asks again for the port, the keys and the live permission, each with your earlier answer as the default,
so pressing Enter keeps things as they are. At "Enter keys now?" Enter means no on every later run: the keys stay
as they are, and you change them in the dashboard. Pressing Enter at the live permission keeps it as `.env` has it:
on only when it already says 1 or true. The dashboard's **Getting started** guide repeats the key steps below,
shows which keys are set and has a "Don't show this again" box.

## After the install

1. **Fund your agent.** Send EGLD on the MultiversX network to agent 1's wallet, which the installer printed.
   It is also in the dashboard.
2. **Open the dashboard** at `http://localhost:8870` (or the port you chose) and log in. The installer's last
   screen shows the address as a link (in most terminals: hold Ctrl and click it; on a Mac, Cmd) and, on a
   computer with a desktop, offers to open it in your browser. The dashboard may be open in two browsers, for
   example a tab inside an editor and your default browser: each has its own sign-in, so the page the installer
   opens can ask for the login although another tab is signed in.
3. **Watch the dry run.** Once the EGLD arrives, the agent plans its first steps. In dry run nothing is paid and
   nothing is bought, so a new wallet shows only the simulated FOXSY swap: the registration line then says it
   needs 5,000 FOXSY for the fee, because nothing was really bought. That is expected. The team is registered once
   you go live, and training and matches follow. Read a plan or two in Last plan and Activity.
4. **Set your limits and strategy** in Settings: daily cap, monthly budget, the largest entry fee, shop payment
   and bid. Write your strategy in plain words too. Every field has an "i" that explains it.
5. **Go live.** Press Go LIVE in the header, type `GO LIVE` and your password. Back to dry run is one click.
6. **Watch it play.** In the FoxLeague app, connect with `pem/agent1.pem` to see the team as the agent runs it.

## Your recovery words and PEM files

- The recovery words are the only way to recover the agent wallets. Keep them on paper, offline. Anyone with them
  controls every agent wallet. They give each agent its wallet: agent 1 uses account 0 of the words, agent 2
  account 1 and so on (in mxpy, `--address-index` is N-1 for agent N).
- The words are also stored in the `.env` file in the `foxleague-agent` folder, readable only by your user.
  To see them again, run `./cli.sh backup-words` in that folder, in your own terminal. Until you have typed `yes`
  at "Type yes when the words are written down", every run of the installer shows them and asks again.
- `pem/` holds one PEM file per agent (`agent1.pem`, `agent2.pem`...). Use them to log into FoxLeague. Never send
  them to anyone and never upload them anywhere.

## Keys, step by step

Add or change them any time in the dashboard: **Keys** in the header (your password confirms every change).

**1. AI key (Anthropic), needed for the agents to play**

1. Sign up or log in at [platform.claude.com](https://platform.claude.com).
2. Open [Billing](https://platform.claude.com/settings/billing) and add credit. $10 runs a single agent at the
   defaults for about a week.
3. Open [Limits](https://platform.claude.com/settings/limits) and set a monthly spend limit, for example $60: a
   month of a single agent at the defaults with room to spare.
4. Open [API keys](https://platform.claude.com/settings/keys), press Create key, name it foxleague-agent and copy it.
   It is shown only once.
5. Paste it in the installer, or in the dashboard: Keys, Anthropic API key, your password, Save.

**2. Telegram (optional): a morning summary of every agent and details on request; you can also talk to your manager**

1. In Telegram, open [BotFather](https://t.me/BotFather). It creates your agent's Telegram account.
2. Send `/newbot`. Give it a name, then a username. Telegram requires the username to end in "bot".
3. Copy the token it sends you (it looks like `123456789:AAH...`).
4. Paste it in the installer, or in the dashboard: Keys, Telegram token, your password, Save.
5. Link your chat: the installer shows a 6-digit code, or press **Link my Telegram** in Keys. Send the code to
   your agent's Telegram account from your own Telegram account, then press **I sent it**. It then talks only to you.

**3. CEX top-up (optional): EGLD top-ups from an exchange, each one approved by you on Telegram**

When an agent runs low, Telegram shows what it has, the EGLD that brings it to its monthly budget and a one-time
code; `/topup <code>` sends it (`/topup N` asks for one at any time). It needs Telegram and LIVE mode. An account
in the EU also needs `BINANCE_ACCOUNT_TYPE=individual` (or `corporate`) in `.env`, for Binance's Travel Rule form.
The example is Binance: an API key that can only read and withdraw EGLD to your agent wallets.

1. Log in to Binance and open [API Management](https://www.binance.com/en/my/settings/api-management).
2. Press Create API, choose System generated, name it foxleague-agent and confirm with your 2FA.
3. Press Edit restrictions: tick only **Enable Withdrawals** and restrict access to the public IP of the computer
   the agent runs on ([shown here](https://api.ipify.org) when you open it there). Never tick trading.
4. In [Address Management](https://www.binance.com/en/my/security/address-management), add each agent wallet on
   the MultiversX (EGLD) network and switch the whitelist on, so money can only go to your agents.
5. Copy the API key and the secret (the secret is shown only once) and paste both in Keys.

A saved key is used at once. Showing or changing a key needs your password; every reveal is logged.

## Talking to your agents

- **Telegram:** write in plain words ("this week focus on Silver tournaments, no boosters"). The agent answers
  questions and turns advice into a new strategy you confirm with Apply. `/status` (it shows the version too),
  `/plan`, `/pause 1`, `/mode dry`, `/mode live confirm`, `/upgrade` and `/help` work too.
- **Dashboard:** each agent's page has a Talk to the manager box that works the same way. Its Speak button lets
  you talk instead of typing.

## More agents

Press **+ Add agent** in the dashboard. Each agent has its own wallet from the same recovery words, its own PEM
file in `pem/`, its own settings and strategy. Fund it like the first one. Each agent plays its own game as if it
were alone and knows nothing of the others, so two of them may meet in a tournament or a 1v1, bid on the same card
or buy a card from each other at auction, by chance: FoxLeague's Fair Play allows that (it forbids arranging
results, not meeting). What they share is a pooled formation record with no team named, a league formation table built from public matches and the results of their casual tests.

## What it costs

- **The game:** limited by your daily cap and monthly budget (defaults $5 a day and $150 a month) plus a
  one-time $20 setup budget for the registration. Your agents never go over them.
- **The AI:** about $1.50 a day for a single agent with the default model, effort and tick (Sonnet 5.5 at medium, a plan every 2 hours inside 12 active hours, about $0.25 a plan): every plan sends the rules and the game manual, about 105,000 tokens, and they are cached for an hour only when another plan comes within that hour, so a lone agent sends them at the plain price. Agents that plan within the same hour share the cache and pay far less for that text: measured on real plans, ten agents on Opus 5.5 at high effort averaged $0.15 a plan with the manual from the cache and $0.60 without. Opus, Fable and a higher effort cost more for the same plan, and a shorter tick means more plans a day. You pick the model and effort in the dashboard.
- **Network fees:** a few cents a day. Each agent always keeps an EGLD reserve for them (1 EGLD by default, never swapped).

## Safety built in

- A new install starts in dry run; an agent added later follows the current mode. Live needs your Go LIVE plus
  this computer's permission.
- The AI only proposes; plain code checks every action against the game rules and your caps before paying.
- A kill switch in the dashboard (and `/kill on` in Telegram) stops every agent at once.
- The dashboard listens on this computer only. To open it from another device, use an SSH tunnel
  (`ssh -L 8870:localhost:8870 you@your-computer`) instead of opening the port to the internet.

## Everyday commands

| What | Linux | macOS |
|---|---|---|
| Logs | `journalctl --user -u foxleague-agent -f` | `tail -f data/service.log` |
| Restart | `systemctl --user restart foxleague-agent` | `launchctl kickstart -k gui/$(id -u)/ai.foxleague.agent` |
| Update | **Update now** in the dashboard, `/upgrade` on Telegram or `./install.sh --update` | the same |
| Command line | `./cli.sh` (alone it lists the commands) | `./cli.sh` |
| Uninstall | `./install.sh --uninstall` | `./install.sh --uninstall` |

The logs and the restart work from any folder. The other three (`./install.sh --update`, `./cli.sh` and
`./install.sh --uninstall`) are typed in the agent's folder: go there first with `cd ~/foxleague-agent`.
Type them as yourself, without sudo: as root on your folder `./cli.sh`, `./run.sh` and `./install.sh` stop before
they change anything and say so, because files of root there would keep the agent from starting again.
On Windows they are the Linux ones, typed inside Ubuntu (open it with `wsl -d Ubuntu --cd ~` in PowerShell), and the
uninstall is one line in PowerShell ([On Windows](#on-windows), "Uninstalling").

## Updates

About every 10 minutes the agent asks GitHub whether a newer release is out; the round arrow next to the version
in the dashboard (**Check for updates**) asks at once. When one is out, the dashboard shows a notice with what is
new and Telegram tells you once. Press **Update now** in the dashboard or send `/upgrade` on Telegram: nothing is ever installed by
itself, and no password is asked, because only a release that is signed by the foxleague-agent maintainers and
newer than yours can be installed. The agent checks the signature, prepares the
new version next to the running one and restarts into it; the waiting actions of a running plan are dropped and the
next plan takes them up. The dashboard is away for about half a minute. A new version that does not start is undone
by itself after about a minute and a half, and you are told. Your wallet, keys, settings and history are kept.

`./install.sh --update` does the same from a terminal. A git checkout and a server set up by hand show the notice
with what to do instead of the button. `AGENT_UPDATE_CHECK=0` in `.env` switches the check off.

An update restarts the background service; when the restart fails it says so and names the command to run. A
background service you stopped stays stopped: `./install.sh --update` says so and names the command that starts it
(`systemctl --user start foxleague-agent`; on a Mac it starts at your next login). An
install made with `./install.sh --no-service` has no background service and an update does not add one: you start
the agent with `./run.sh`. Nothing starts such an agent again, so an update does not end it: the new version is put
in place and the agent keeps playing on the version it runs. The dashboard then says "Version ... is in place and
runs from the next start" (Telegram too, after **Update now** or `/upgrade`). Stop the agent (Ctrl-C in its
terminal) and run `./run.sh` again.

How to uninstall, and what stays, is in the section of your system: [On Windows](#on-windows),
[On a Mac](#on-a-mac) and [On Linux](#on-linux), under "Uninstalling".

## Troubleshooting

Problems while installing, and those of one system only, are under "If it gets stuck" in the section of your
system: [On Windows](#on-windows), [On a Mac](#on-a-mac) and [On Linux](#on-linux). Here is what can happen on every
system once the agent runs.

- **The dashboard does not open:** check the logs (see above). Another program may use the port: run
  `./install.sh` again and pick another one.
- **"The dashboard could not start: port ... is used by another program":** the agent says this once, in the logs
  and on Telegram. Your agents keep playing without the dashboard, and the agent tries the port again every minute.
  Close the other program or choose another port. For another port run `./install.sh` again; you can also set
  `WEB_UI_PORT` in `.env` and restart the agent.
- **The dashboard asks for the login although I am signed in:** the dashboard may be open in two browsers, for
  example a tab inside an editor and your default browser. Each has its own sign-in: log in there too.
- **"The update to ... was not installed: this system's tar cannot unpack inside the agent's background service":**
  the background service of an install made by an older installer refuses a call that the tar of Ubuntu 26.04
  needs to unpack an update. Run `./install.sh --update` once in a terminal, in the agent's folder: it installs the
  update outside the service and takes that one line out of the service's file, so later updates are one click
  again. Pasting the install line again does the same. On Windows, open Ubuntu first: `wsl -d Ubuntu --cd ~` in
  PowerShell, then `cd foxleague-agent`. Until then the dashboard offers no **Update now**: it would fail the same
  way.
- **The agent does not start after I changed the recovery words:** its history and limits belong to the wallets
  of the words it was made with. Put the original words back in `.env` and restart. To play another wallet's
  team, keep the original words and use **Import team** in the dashboard. To start over with the new words, stop
  the agent and move `data/agent.db*` to another folder (only when the old agent wallets are empty or you keep
  their words). The installer checks this before it starts the agent.
- **Nothing happens at night:** each agent plays from 08:00 to 20:00 UTC by default (Settings: Active from and Active until).
- **"strategist OFF" in the logs:** add your Anthropic API key in Keys.
