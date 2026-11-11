# Run your own FoxLeague Agent

FoxLeague Agent manages FoxLeague teams for you: it trains your players, sets the lineup, plays matches and
enters tournaments and 1v1s. It can also fuse cards and bid at auctions. An AI plans every two hours by default
(every hour at the Zeus level); plain code checks every action against the game rules and your spending limits
before anything is paid.

Everything runs on your own computer. Your wallet words and your keys never leave it.

## What you need

- A computer that stays on: Linux with systemd or macOS. On Windows, use WSL2 with systemd turned on.
  A small cloud server works too. Install as a user of your own, not as root: as root the installer stops and
  tells you to create a user first (`adduser fox`, then `su - fox` and paste the line; for a server set up by
  hand, see [docs/SERVER.md](docs/SERVER.md)).
  On Linux the agent keeps running after you log out and after a restart. On macOS the agent starts when you log
  in, and a sleeping Mac plays nothing. On Windows the agent runs while Ubuntu (WSL) runs: closing the last Ubuntu
  window may stop it after a short while, and it does not start with Windows, so after every restart of Windows
  open Ubuntu again and leave its window open for as long as the agent should play.
- About 5 EGLD to start: about 2.5 buys the 5,000 FOXSY registration, 1 stays in the wallet as the gas reserve
  (Settings: EGLD gas reserve), the rest pays for the first games.
- An Anthropic API key: the AI that plans. Without it your agents only watch. The steps are below; about 5 minutes.
- Optional: a Telegram bot for notifications and commands on your phone, and a Binance API key for EGLD top-ups
  of the agent wallets, each one approved by you on Telegram with a one-time code.

## Install

Open a terminal and paste this one line:

```
curl -fsSL https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.sh | bash
```

On Ubuntu, install curl first, because Ubuntu Desktop comes without it: `sudo apt install curl`. Use this one, not
the snap that Ubuntu's hint offers: the apt one is the one the install is tested with.

The line downloads the newest release into `~/foxleague-agent`, checks the download against the release's checksum
and starts the guided installer. To install a given version, put it in front: `curl -fsSL .../get.sh | FOXAGENT_VERSION=vX.Y.Z bash`. An older version is not
put over a newer install: add `FOXAGENT_ALLOW_DOWNGRADE=1` in front of `bash` to go back anyway (the settings and
limits the newer version added are then not applied). Another folder is named with `FOXAGENT_DIR`; it must be
empty or hold an install of foxleague-agent. On Windows, first install WSL2
(Ubuntu) from the Microsoft Store and paste the line in its terminal. If you prefer git:
`git clone https://github.com/foxsyai/foxleague-agent.git && cd foxleague-agent && ./install.sh`. A git checkout
follows its branch: `./install.sh --update` pulls it, and that may be code that is in no release yet.

The installer walks you through seven steps and explains each one:

| Step | What happens |
|---|---|
| 1. Node.js | Uses the Node.js on your computer when the agent runs on it (22 from 22.18, or 24.2 and later, with npm beside it), otherwise downloads a private copy into the `foxleague-agent` folder and checks it against the SHA-256 written in the installer. |
| 2. Wallet | Creates a new wallet and shows its recovery words once. Write them down on paper. |
| 3. Dashboard login | You choose a username, a password (at least 12 characters) and a port (default 8870). A password that is too short or typed differently the second time is asked for again. A port that another program already uses is refused and the next one is offered. |
| 4. Keys | The AI key, Telegram and the CEX top-up key. Every key can be skipped and added later in the dashboard. |
| 5. Settings | A new install starts in dry run. You choose whether this computer may sign real transactions once you press Go LIVE. |
| 6. PEM files | Writes `pem/agent1.pem`, so you can log into FoxLeague as your agent's team and watch it play. |
| 7. Background service | Starts the agent in the background. On Linux it keeps running after you log out and after a restart. On macOS it starts when you log in. On Windows it runs while Ubuntu (WSL) runs. |

Run `./install.sh` again at any time: it keeps your wallet, login and keys. It asks again for the port, the keys
and the live permission, each with your earlier answer as the default, so pressing Enter keeps things as they are.
At "Enter keys now?" Enter means no on every later run: the keys stay as they are, and you change them in the
dashboard. Pressing Enter at the live permission keeps it as `.env` has it: on only when it already says 1 or true.
The dashboard's **Getting started** guide repeats the key steps below, shows which keys are set and has a
"Don't show this again" box.

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

1. In Telegram, open [BotFather](https://t.me/BotFather), the official bot that makes bots.
2. Send `/newbot`. Give it a name, then a username that ends in `bot`.
3. Copy the token it sends you (it looks like `123456789:AAH...`).
4. Paste it in the installer, or in the dashboard: Keys, Telegram bot token, your password, Save.
5. Link your chat: the installer shows a 6-digit code, or press **Link my Telegram** in Keys. Send the code to
   your new Telegram bot from your own account, then press **I sent it**. It then talks only to you.

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
- **The AI:** about $1.50 a day for a single agent with the default model, effort and tick (Sonnet 5 at medium, a plan every 2 hours inside 12 active hours, about $0.25 a plan): every plan sends the rules and the game manual, about 100,000 tokens, and they are cached for an hour only when another plan comes within that hour, so a lone agent sends them at the plain price. Agents that plan within the same hour share the cache and pay far less for that text: measured on real plans, ten agents on Opus 5.5 at high effort averaged $0.15 a plan with the manual from the cache and $0.60 without. Opus, Fable and a higher effort cost more for the same plan, and a shorter tick means more plans a day. You pick the model and effort in the dashboard.
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

## Updates

About every 10 minutes the agent asks GitHub whether a newer release is out. When one is, the dashboard shows a
notice with what is new and Telegram tells you once. Press **Update now** in the dashboard or send `/upgrade` on
Telegram: nothing is ever installed by itself, and no password is asked, because only a release that is signed by
the foxleague-agent maintainers and newer than yours can be installed. The agent checks the signature, prepares the
new version next to the running one and restarts into it; the waiting actions of a running plan are dropped and the
next plan takes them up. The dashboard is away for about half a minute. A new version that does not start is undone
by itself after about a minute and a half, and you are told. Your wallet, keys, settings and history are kept.

`./install.sh --update` does the same from a terminal. A git checkout and a server set up by hand show the notice
with what to do instead of the button. `AGENT_UPDATE_CHECK=0` in `.env` switches the check off.

An update restarts the background service; when the restart fails it says so and names the command to run. An
install made with `./install.sh --no-service` has no background service and an update does not add one: you start
the agent with `./run.sh`. Nothing starts such an agent again, so an update does not end it: the new version is put
in place and the agent keeps playing on the version it runs. The dashboard then says "Version ... is in place and
runs from the next start" (Telegram too, after **Update now** or `/upgrade`). Stop the agent (Ctrl-C in its
terminal) and run `./run.sh` again.

Uninstall stops the background service and leaves your folder (about 190 MB), wallet and PEM files in place.
On Linux it also leaves linger on, which lets background services of your user start without a login:
`loginctl disable-linger $USER` turns it off. Delete the folder only when the agent wallets are empty and your
recovery words are safe.

## Troubleshooting

- **The dashboard does not open:** check the logs (see above). Another program may use the port: run
  `./install.sh` again and pick another one.
- **"The dashboard could not start: port ... is used by another program":** the agent says this once, in the logs
  and on Telegram. Your agents keep playing without the dashboard, and the agent tries the port again every minute.
  Close the other program or choose another port. For another port run `./install.sh` again; you can also set
  `WEB_UI_PORT` in `.env` and restart the agent.
- **The dashboard asks for the login although I am signed in:** the dashboard may be open in two browsers, for
  example a tab inside an editor and your default browser. Each has its own sign-in: log in there too.
- **"this machine does not run systemd":** systemd keeps the agent running in the background. On Windows turn it
  on in WSL2 (`/etc/wsl.conf`, the two lines `[boot]` and `systemd=true`), run `wsl --shutdown` in PowerShell, open
  Ubuntu again and run the installer again. Without systemd: run `./install.sh --no-service` in the agent's folder,
  then start the agent yourself with `./run.sh`.
- **"the background services of the user ... cannot be reached from this terminal":** the terminal was opened with
  `su` or `sudo` and the installer could not start the user's services from it. Log in as that user itself (a new
  terminal, or `ssh` to the machine as that user) and run the installer again.
- **"Job for foxleague-agent.service failed" (or "Start request repeated too quickly"):** systemd allows the agent
  five starts in ten minutes and then refuses the next one. Run
  `systemctl --user reset-failed foxleague-agent && systemctl --user restart foxleague-agent`. The installer and
  `./install.sh --update` clear that count themselves before they restart the agent.
- **The agent stops when I log out (Linux):** run `sudo loginctl enable-linger $USER` once.
- **The agent stops on Windows when I close Ubuntu, or after Windows restarts:** on Windows the agent runs while
  Ubuntu (WSL) runs. Open Ubuntu again and leave its window open: the agent starts with it.
- **"Command 'curl' not found" on Ubuntu:** run `sudo apt install curl`, then paste the install line again.
- **The agent does not start after I changed the recovery words:** its history and limits belong to the wallets
  of the words it was made with. Put the original words back in `.env` and restart. To play another wallet's
  team, keep the original words and use **Import team** in the dashboard. To start over with the new words, stop
  the agent and move `data/agent.db*` to another folder (only when the old agent wallets are empty or you keep
  their words). The installer checks this before it starts the agent.
- **Nothing happens at night:** each agent plays from 08:00 to 20:00 UTC by default (Settings: Active from and Active until).
- **"strategist OFF" in the logs:** add your Anthropic API key in Keys.
