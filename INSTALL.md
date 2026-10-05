# Run your own FoxLeague Agent

FoxLeague Agent manages FoxLeague teams for you: it trains your players, sets the lineup, plays matches and
enters tournaments and 1v1s. It can also fuse cards and bid at auctions. An AI plans every half hour; plain
code checks every action against the game rules and your spending limits before anything is paid.

Everything runs on your own computer. Your wallet words and your keys never leave it.

## What you need

- A computer that stays on: Linux with systemd or macOS. On Windows, use WSL2 with systemd turned on.
  A small cloud server works too.
- About 5 EGLD to start: about 2.5 buys the 5,000 FOXSY registration, 1 stays in the wallet as the gas reserve
  (Settings: EGLD gas reserve), the rest pays for the first games.
- An Anthropic API key: the AI that plans. Without it your agents only watch. The steps are below; about 5 minutes.
- Optional: a Telegram bot for notifications and commands on your phone, and a CEX (Binance) API key for automatic
  top-ups (a later feature).

## Install

Open a terminal and paste this one line:

```
curl -fsSL https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.sh | bash
```

It downloads the newest release into `~/foxleague-agent` and starts the guided installer. To install a
given version, put it in front: `curl -fsSL .../get.sh | FOXAGENT_VERSION=v0.10.0 bash`. On Windows, first install WSL2
(Ubuntu) from the Microsoft Store and paste the line in its terminal. If you prefer git:
`git clone https://github.com/foxsyai/foxleague-agent.git && cd foxleague-agent && ./install.sh`.

The installer walks you through seven steps and explains each one:

| Step | What happens |
|---|---|
| 1. Node.js | Uses the Node.js on your computer if it is recent enough, otherwise downloads a private copy into the `foxleague-agent` folder (checksum verified). |
| 2. Wallet | Creates a new wallet and shows its recovery words once. Write them down on paper. |
| 3. Dashboard login | You choose a username, a password (at least 12 characters) and a port (default 8870). |
| 4. Keys | The AI key, Telegram and the CEX top-up key. Every key can be skipped and added later in the dashboard. |
| 5. Settings | A new install starts in dry run. You choose whether this computer may sign real transactions once you press Go LIVE. |
| 6. PEM files | Writes `pem/agent1.pem`, so you can log into FoxLeague as your agent's team and watch it play. |
| 7. Background service | Starts the agent in the background and keeps it running after a restart. |

Run `./install.sh` again at any time: it keeps your wallet, login and keys. It asks again for the port, the keys
and the live permission, each with your earlier answer as the default, so pressing Enter keeps things as they are.
The dashboard's **Getting started** guide repeats the key steps below, shows which keys are set and has a
"Don't show this again" box.

## After the install

1. **Fund your agent.** Send EGLD on the MultiversX network to agent 1's wallet, which the installer printed.
   It is also in the dashboard.
2. **Open the dashboard** at `http://localhost:8870` (or the port you chose) and log in.
3. **Watch the dry run.** Once the EGLD arrives, the agent plans its first steps: buy FOXSY, register a team, train,
   play. In dry run everything is simulated and logged, nothing is paid. Read a few plans in Last plan and
   Activity.
4. **Set your limits and strategy** in Settings: daily cap, monthly budget, the largest entry fee, shop payment
   and bid. Write your strategy in plain words too. Every field has an "i" that explains it.
5. **Go live.** Press Go LIVE in the header, type `GO LIVE` and your password. Back to dry run is one click.
6. **Watch it play.** In the FoxLeague app, connect with `pem/agent1.pem` to see the team as the agent runs it.

## Your recovery words and PEM files

- The recovery words are the only way to recover the agent wallets. Keep them on paper, offline. Anyone with them
  controls every agent wallet. They give each agent its wallet: agent 1 uses account 0 of the words, agent 2
  account 1 and so on (in mxpy, `--address-index` is N-1 for agent N).
- The words are also stored in the `.env` file in the `foxleague-agent` folder, readable only by your user.
- `pem/` holds one PEM file per agent (`agent1.pem`, `agent2.pem`...). Use them to log into FoxLeague. Never send
  them to anyone and never upload them anywhere.

## Keys, step by step

Add or change them any time in the dashboard: **Keys** in the header (your password confirms every change).

**1. AI key (Anthropic), needed for the agents to play**

1. Sign up or log in at [platform.claude.com](https://platform.claude.com).
2. Open [Billing](https://platform.claude.com/settings/billing) and add credit. $10 is plenty to start.
3. Open [Limits](https://platform.claude.com/settings/limits) and set a monthly spend limit, for example $20.
4. Open [API keys](https://platform.claude.com/settings/keys), press Create key, name it foxleague-agent and copy it.
   It is shown only once.
5. Paste it in the installer, or in the dashboard: Keys, Anthropic API key, your password, Save.

**2. Telegram (optional): every action on your phone, and you can talk to your manager**

1. In Telegram, open [BotFather](https://t.me/BotFather), the official bot that makes bots.
2. Send `/newbot`. Give it a name, then a username that ends in `bot`.
3. Copy the token it sends you (it looks like `123456789:AAH...`).
4. Paste it in the installer, or in the dashboard: Keys, Telegram bot token, your password, Save.
5. Link your chat: the installer shows a 6-digit code, or press **Link my Telegram** in Keys. Send the code to
   your new Telegram bot from your own account, then press **I sent it**. It then talks only to you.

**3. CEX top-up (optional): automatic EGLD top-ups from an exchange, coming in a later version**

The example is Binance: an API key that can only withdraw EGLD to your agent wallets.

1. Log in to Binance and open [API Management](https://www.binance.com/en/my/settings/api-management).
2. Press Create API, choose System generated, name it foxleague-agent and confirm with your 2FA.
3. Press Edit restrictions: tick only **Enable Withdrawals** and restrict access to this computer's public IP
   ([shown here](https://api.ipify.org)). Never tick trading.
4. In [Address Management](https://www.binance.com/en/my/security/address-management), add each agent wallet on
   the MultiversX (EGLD) network and switch the whitelist on, so money can only go to your agents.
5. Copy the API key and the secret (the secret is shown only once) and paste both in Keys.

A saved key is used at once. Showing or changing a key needs your password; every reveal is logged.

## Talking to your agents

- **Telegram:** write in plain words ("this week focus on Silver tournaments, no boosters"). The agent answers
  questions and turns advice into a new strategy you confirm with Apply. `/status`, `/plan`, `/pause 1`,
  `/mode dry`, `/mode live confirm` and `/help` work too.
- **Dashboard:** each agent's page has a Talk to the manager box that works the same way. Its Speak button lets
  you talk instead of typing.

## More agents

Press **+ Add agent** in the dashboard. Each agent has its own wallet from the same recovery words, its own PEM
file in `pem/`, its own settings and strategy. Fund it like the first one. Each agent plays its own game and
knows nothing of the others, so two of them may meet in a tournament or a 1v1, or bid on the same card, by chance:
FoxLeague's Fair Play allows that (it forbids arranging results, not meeting).

## What it costs

- **The game:** limited by your daily cap and monthly budget (defaults $10 a day and $300 a month) plus a
  one-time $20 setup budget for the registration. Your agents never go over them.
- **The AI:** about $1 to $3 a day per agent with the default model and effort, more at a higher effort or with Opus or Fable. You pick the model and effort in the dashboard.
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
| Update | `./install.sh --update` | `./install.sh --update` |
| Uninstall | `./install.sh --uninstall` | `./install.sh --uninstall` |

Uninstall stops the background service and leaves your folder, wallet and PEM files in place. Delete the folder
only when the agent wallets are empty and your recovery words are safe.

## Troubleshooting

- **The dashboard does not open:** check the logs (see above). Another program may use the port: run
  `./install.sh` again and pick another one.
- **"systemd user services are not available" on Windows:** turn on systemd in WSL2 (`/etc/wsl.conf`, section
  `[boot]`, `systemd=true`), restart WSL, run the installer again.
- **The agent stops when I log out (Linux):** run `sudo loginctl enable-linger $USER` once.
- **Nothing happens at night:** each agent plays from 08:00 to 20:00 UTC by default (Settings: Active from and Active until).
- **"strategist OFF" in the logs:** add your Anthropic API key in Keys.
