---
title: Troubleshooting
description: Fixes for the most common problems.
---

Problems while installing, and those of one system only, are on the page of that system, under "If it gets
stuck": [Install on Windows](/start/install-windows/#if-it-gets-stuck),
[Install on Mac](/start/install-mac/#if-it-gets-stuck) and [Install on Linux](/start/install-linux/#if-it-gets-stuck).
For example: virtualization, Ubuntu and the scheduled task on Windows; a Mac that sleeps; curl, root, systemd and
linger on Linux. This page has what can happen on every system once the agent runs.

| Problem | Fix |
|---|---|
| **The dashboard does not open** | Check the logs (below). Another program may use the port: run `./install.sh` again in the `foxleague-agent` folder and pick another one. |
| **"The dashboard could not start: port ... is used by another program"** | The agent says this once, in the logs and on Telegram. Your agents keep playing without the dashboard, and the agent tries the port again every minute. Close the other program or choose another port. For another port run `./install.sh` again in the `foxleague-agent` folder; you can also set `WEB_UI_PORT` in `.env` and restart the agent. |
| **The dashboard asks for the login although I am signed in** | The dashboard may be open in two browsers, for example a tab inside an editor and your default browser. Each has its own sign-in, so the page the installer opens can ask for the login although another tab is signed in. Log in there too. |
| **"The AI key is missing" banner** | Add your Anthropic key in Keys ([Your keys](/start/keys/)). Without it your agents only watch. |
| **Go LIVE is grey** | This computer does not allow live signing yet: set `AGENT_LIVE_ENABLED=1` in the `.env` file in the `foxleague-agent` folder and restart the agent. |
| **Nothing happens at night** | Each agent plans only inside its active hours (08:00 to 20:00 UTC by default). Change them in Settings, Timing. |
| **"refused" in the Activity** | An action did not fit the game rules or your limits; the line says why. The agent adapts on its next cycle. Raise a limit only if you mean it. |
| **Telegram stays silent** | By default Telegram sends only the morning summary and urgent messages; send `/updates all` for every plan and result as it happens. If nothing arrives at all, press Test keys in Keys; if the chat is not linked, press Link my Telegram and send the code to your agent's Telegram account. |
| **"foxleague-agent already runs on this data folder"** | A second copy was started while the agent runs, for example `./run.sh` in a terminal next to the background service. It does not start, because two copies would plan and pay for every agent twice. Use the one that runs (its dashboard or Telegram) or stop it first. If you are sure that no other copy runs, delete the file the message names and start again. |
| **"The update to ... did not start and was undone"** | The new version did not stay up, so the agent went back to the version that ran before. Nothing of yours changed and nothing has to be done: the agent keeps playing on the version it ran. To try that version again later, press **Try again** in the dashboard's notice or send `/upgrade`; if it is undone again, keep the version you run and tell the maintainers what the logs (below) say. |
| **"The update to ... was not installed: this system's tar cannot unpack inside the agent's background service"** | The background service of an install made by an older installer refuses a call that the tar of Ubuntu 26.04 needs to unpack an update. Run `./install.sh --update` once in a terminal, in the `foxleague-agent` folder: it installs the update outside the service and takes that one line out of the service's file, so later updates are one click again. Pasting the install line again does the same. On Windows, open Ubuntu first: `wsl -d Ubuntu --cd ~` in PowerShell, then `cd foxleague-agent`. Until then the dashboard's notice offers no **Update now**: it would fail the same way. |
| **"The update to ... was not installed: the archive could not be unpacked (tar: ...)"** | What tar said is in the brackets; its first lines are in the logs (below). A full disk is the usual reason: free some space, then press **Try again** in the dashboard's notice. |
| **"Version ... is in place and runs from the next start"** | The agent was started by hand with `./run.sh` (an install made with `--no-service`), so nothing starts it again after an update. The new version is in place and the agent keeps playing on the version it runs: stop it (Ctrl-C in its terminal) and run `./run.sh` again in the `foxleague-agent` folder ([Update](/help/update/)). |
| **"No update was started: ..."** | The answer names the reason: "you run ..., the newest version"; "an update is already being installed" (wait a minute or two); "the last update is still being confirmed, try again in a minute" (the version you just installed has to stay up for 45 seconds before the next update is taken); "updates are switched off on this machine (AGENT_UPDATE_CHECK=0)" (remove that line from `.env` and restart, or update in a terminal); "the release server could not be asked" (GitHub or your connection, try again later); or what this install does instead, such as `./install.sh --update` for a git checkout ([Update](/help/update/)). |
| **The update notice never appears** | The agent asks GitHub about every 10 minutes and only tells you of a release that is signed and newer than yours. Press the round arrow next to the version in the dashboard (**Check for updates**) or run `./cli.sh update-check` in the `foxleague-agent` folder to ask now. With `AGENT_UPDATE_CHECK=0` in `.env` it never asks. |
| **The agent does not start after I changed the recovery words** | The logs say "The recovery words ... are not the ones this install's agents were made with". Put the original words back in `.env` and restart the agent. To play another wallet's FoxLeague team, keep the original words and use **Import team** ([Import your team](/use/import-team/)). To start over with the new words, stop the agent and move `data/agent.db`, `agent.db-wal` and `agent.db-shm` to another folder: history and settings start fresh, so do it only when the old agent wallets are empty or you keep their words. Replacing `pem/agent1.pem` changes nothing for the agent: it signs with the words, the PEM file is only for you to log into FoxLeague. |

## Logs and restart

| What | Linux and Windows (WSL2) | macOS |
|---|---|---|
| Logs | `journalctl --user -u foxleague-agent -f` | `tail -f data/service.log` |
| Restart | `systemctl --user restart foxleague-agent` | `launchctl kickstart -k gui/$(id -u)/ai.foxleague.agent` |

The Linux commands work from any folder. The commands that start with `./` (`./install.sh --update`, `./cli.sh`
and `./install.sh --uninstall`) and the Mac's log are typed in the agent's folder: go there first with
`cd ~/foxleague-agent`. On Windows they are typed inside Ubuntu: open it with `wsl -d Ubuntu --cd ~` in
PowerShell. The uninstall on Windows is one line in PowerShell
([Install on Windows](/start/install-windows/#uninstalling)).
