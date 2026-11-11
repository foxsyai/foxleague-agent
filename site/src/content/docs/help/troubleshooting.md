---
title: Troubleshooting
description: Fixes for the most common problems.
---

| Problem | Fix |
|---|---|
| **The dashboard does not open** | Check the logs (below). Another program may use the port: run `./install.sh` again in the `foxleague-agent` folder and pick another one. |
| **"The AI key is missing" banner** | Add your Anthropic key in Keys ([Your keys](/start/keys/)). Without it your agents only watch. |
| **Go LIVE is grey** | This computer does not allow live signing yet: set `AGENT_LIVE_ENABLED=1` in the `.env` file in the `foxleague-agent` folder and restart the agent. |
| **Nothing happens at night** | Each agent plans only inside its active hours (08:00 to 20:00 UTC by default). Change them in Settings, Timing. |
| **"refused" in the Activity** | An action did not fit the game rules or your limits; the line says why. The agent adapts on its next cycle. Raise a limit only if you mean it. |
| **Telegram stays silent** | By default Telegram sends only the morning summary and urgent messages; send `/updates all` for every plan and result as it happens. If nothing arrives at all, press Test keys in Keys; if the chat is not linked, press Link my Telegram and send the code to your Telegram bot. |
| **The agent stops when I log out (Linux)** | Run `sudo loginctl enable-linger $USER` once. |
| **The agent stops on Windows when I close Ubuntu, or after Windows restarts** | On Windows the agent runs while Ubuntu (WSL) runs. Closing the last Ubuntu window may stop it after a short while, and it does not start with Windows. Open Ubuntu again and leave its window open (minimised is fine): the agent starts with it. |
| **The agent does not play while my Mac sleeps** | On macOS the agent starts when you log in, and a sleeping Mac plays nothing. Set the Mac not to sleep while the agent should play. |
| **"Command 'curl' not found" on Ubuntu** | Run `sudo apt install curl`, then paste the install line again. Use this one, not the snap: the installer cannot download with the snap's curl. |
| **"systemd user services are not available" on Windows** | Turn on systemd in WSL2 ([Install](/start/install/), Windows), restart WSL, run the installer again. |
| **"foxleague-agent already runs on this data folder"** | A second copy was started while the agent runs, for example `./run.sh` in a terminal next to the background service. It does not start, because two copies would plan and pay for every agent twice. Use the one that runs (its dashboard or Telegram) or stop it first. If you are sure that no other copy runs, delete the file the message names and start again. |
| **"The update to ... did not start and was undone"** | The new version did not stay up, so the agent went back to the version that ran before. Nothing of yours changed. Try again later with **Update now** or `/upgrade`; if it is undone again, keep the version you run and tell the maintainers what the logs (below) say. |
| **"No update was started: ..."** | The answer names the reason: "you run ..., the newest version"; "an update is already being installed" (wait a minute or two); "updates are switched off on this machine (AGENT_UPDATE_CHECK=0)" (remove that line from `.env` and restart, or update in a terminal); "the release server could not be asked" (GitHub or your connection, try again later); or what this install does instead, such as `./install.sh --update` for a git checkout ([Update](/help/update/)). |
| **The update notice never appears** | The agent asks GitHub about every 10 minutes and only tells you of a release that is signed and newer than yours. Run `./cli.sh update-check` in the `foxleague-agent` folder to ask now. With `AGENT_UPDATE_CHECK=0` in `.env` it never asks. |
| **The agent does not start after I changed the recovery words** | The logs say "The recovery words ... are not the ones this install's agents were made with". Put the original words back in `.env` and restart the agent. To play another wallet's FoxLeague team, keep the original words and use **Import team** ([Import your team](/use/import-team/)). To start over with the new words, stop the agent and move `data/agent.db`, `agent.db-wal` and `agent.db-shm` to another folder: history and settings start fresh, so do it only when the old agent wallets are empty or you keep their words. Replacing `pem/agent1.pem` changes nothing for the agent: it signs with the words, the PEM file is only for you to log into FoxLeague. |

## Logs and restart

| What | Linux and Windows (WSL2) | macOS |
|---|---|---|
| Logs | `journalctl --user -u foxleague-agent -f` | `tail -f data/service.log` |
| Restart | `systemctl --user restart foxleague-agent` | `launchctl kickstart -k gui/$(id -u)/ai.foxleague.agent` |
