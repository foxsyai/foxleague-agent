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
| **"systemd user services are not available" on Windows** | Turn on systemd in WSL2 ([Install](/start/install/), Windows), restart WSL, run the installer again. |
| **The agent does not start after I changed the recovery words** | The logs say "The recovery words ... are not the ones this install's agents were made with". Put the original words back in `.env` and restart the agent. To play another wallet's FoxLeague team, keep the original words and use **Import team** ([Import your team](/use/import-team/)). To start over with the new words, stop the agent and move `data/agent.db`, `agent.db-wal` and `agent.db-shm` to another folder: history and settings start fresh, so do it only when the old agent wallets are empty or you keep their words. Replacing `pem/agent1.pem` changes nothing for the agent: it signs with the words, the PEM file is only for you to log into FoxLeague. |

## Logs and restart

| What | Linux and Windows (WSL2) | macOS |
|---|---|---|
| Logs | `journalctl --user -u foxleague-agent -f` | `tail -f data/service.log` |
| Restart | `systemctl --user restart foxleague-agent` | `launchctl kickstart -k gui/$(id -u)/ai.foxleague.agent` |
