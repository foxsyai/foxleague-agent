# FoxLeague Agent: an AI team manager for FoxLeague

A self-hosted manager for your [FoxLeague](https://foxleague.ai) teams on MultiversX mainnet, for players who
have a budget but not the time to sit in the app all day. A Claude model plans; plain code checks every action
against the game rules and your spending limits before anything is paid. It uses FoxLeague's public API and
smart contracts, exactly like the player app, from your own computer or server. Your wallet words and keys never
leave it.

Status: in internal testing (the newest version is on the releases page). Everything below works live on mainnet.

## Install

Linux, macOS or Windows through WSL2. On Linux and macOS, open a terminal and paste one line (on Ubuntu, first
`sudo apt install curl`):

```
curl -fsSL https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.sh | bash
```

On Windows 10 and 11, open PowerShell (a normal window) and paste this line instead. It sets up WSL2 and Ubuntu
where they are missing, which may need an administrator prompt and one restart of Windows (then paste the same
line again), and runs the same installer inside Ubuntu. Installing Ubuntu needs about 4 GB free on drive C:.

```
irm https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.ps1 | iex
```

A guided installer sets up a new wallet, your dashboard login, your keys, PEM files to watch your team in the
FoxLeague app and a background service. The dashboard's **Getting started** guide then explains each key step
by step. Each system has its own guide, step by step, with what to do if it gets stuck:
[Install on Windows](https://agent.foxleague.ai/start/install-windows/),
[Install on Mac](https://agent.foxleague.ai/start/install-mac/) and
[Install on Linux](https://agent.foxleague.ai/start/install-linux/). The same is in [INSTALL.md](INSTALL.md), with
everything else. On Windows the agent runs while Ubuntu (WSL) runs (a scheduled task of the Windows installer is
there to keep Ubuntu running while you are logged in), and on macOS it starts when you log in.

You need about 5 EGLD to start (2.5 buys the 5,000 FOXSY registration, 1 stays as the gas reserve) and an
Anthropic API key for the AI. Telegram and Binance are optional.

## What it does

Every two hours by default (randomised, inside the active hours you choose; higher levels plan more often, Zeus every
hour, and the tick is yours to set) each agent reads its team and the platform, asks the AI for a plan and runs the actions spread over the
next minutes, in the plan's order (one with a deadline, such as leaving a 1v1 before it runs out or a bid before the auction
ends, at least 5 minutes before it; leaving its own 1v1 nobody took yet and taking another team's open 1v1 at the start):

- **Daily routine:** the free training sessions on the starters who gain most, syncing stats to chain when it
  matters, lineup and formation, ranked and casual matches.
- **Competition:** joins Silver and Gold tournaments and 1v1 challenges it can win, creates its own (public or
  private) in a free platform time slot, challenges a named team or, only when the squad needs the competitive matches, posts an open challenge with an OVR range around its own, prepares before each match session locks (sync, lineup, condition), leaves or cancels when a
  better option appears, claims refunds.
- **Growth:** XP booster and paid training when the numbers say so, Common packs, fusion and both fusion
  waivers, bids and listings on the marketplace.
- **Yellow cards and injuries:** sees each card's ban and injury (its own and those at auction), plays no match
  with an injured starter, counts its fit players before a 1v1 stake and buys medicine only for a starter it cannot
  replace, within the level's medicine days a week and the shop payment limit.
- **Onboarding:** swaps EGLD to FOXSY, registers the team and generates its free badge.

The AI reasons from the full player manual and its economy map. You steer it with a strategy in plain words, in
the dashboard or by chatting with it on Telegram.

## Safety

- **Your limits are code, not a prompt.** A daily cap, a monthly budget and a one-time setup budget in USD at
  live prices, and a maximum per entry fee, shop payment, bid and swap in FOXSY. The AI proposes; the executor refuses
  anything over them. An EGLD gas reserve (1 EGLD by default) is never swapped.
- **The AI never holds keys** and cannot build a transaction: it picks from a fixed list of actions, each checked
  against the game rules first.
- **Dry run first.** A new install only simulates. Going live needs your Go LIVE (typed, with your password, in
  the dashboard; or `/mode live confirm` from your own Telegram chat) and this machine's permission. Back to dry run is one click; a kill switch stops every agent at once.
- **Fair play.** Public information only and a human pace. Your agents are never coordinated against anyone: each
  plays its own game as if it were alone, without knowing which teams are yours, so two of them may meet in a
  tournament or a 1v1, bid on the same card or buy a card from each other at auction, by chance (FoxLeague's Fair
  Play forbids arranging results, not meeting). What they share is a pooled formation record with no team named, a league formation table built from public matches and the results of their casual tests. Guards against rivals who try to farm
  an agent (a 1v1 against a named team only when it is of similar strength, at most two played 1v1s a week each; an
  open challenge only to teams no stronger by OVR). Six strategy levels, one brain: every level weighs a win chance for
  every team and plays only what pays; the levels differ in the money they may spend (your limits, the paid training,
  boosters and packs they may buy) and in how often they plan.
- **Reviewed.** Fourteen numbered adversarial reviews, a review of CI and whole-project reviews before release,
  the last of them a final audit by six reviewers before the public launch. Every confirmed finding is fixed or
  decided; the few still open are listed in [docs/SECURITY-REVIEW.md](docs/SECURITY-REVIEW.md).

## Using it

- **Dashboard** at `http://localhost:8870`: every agent with its balances, spend against the caps, last plan and
  activity; settings with an explanation on every field; Pause, Plan now, Add agent, Go LIVE and the kill switch;
  the AI's model and effort for all agents or one agent; the Keys panel.
- **Telegram** (optional): a summary of every agent each morning, every update as it happens if you want it
  (`/updates all`). Write in plain words ("focus on Silver tournaments this
  week") and the manager answers, or proposes a new strategy you apply with one tap. Commands: `/status`
  (it shows the version too), `/plan`, `/summary`, `/pause`, `/mode`, `/kill`, `/topup`, `/upgrade`, `/help`.
- **Updates:** about every 10 minutes the agent asks GitHub for the newest release and tells you, in the dashboard
  and on Telegram, when one is out; the round arrow next to the version in the dashboard (**Check for updates**)
  asks at once. **Update now** in the dashboard or `/upgrade` on Telegram installs it; nothing installs by itself.
  Only a release signed by the maintainers and newer than yours is taken, it is prepared next to the running
  version, and a version that does not start is undone by itself. `./install.sh --update` does the same from a
  terminal; `AGENT_UPDATE_CHECK=0` in `.env` switches the check off.
- **FoxLeague's manual:** every hour from the morning summary's hour the agent compares the manual FoxLeague serves
  with the copy its agents play by; each snapshot also compares FoxLeague's game settings with the ones that copy was
  built against. When a page or a setting changed, Telegram says so at once, the morning summary and the dashboard
  name it and each plan is told that the live values win over the manual there; a version with the new manual follows
  (the maintainer runs `sync-manual`). Until then each plan also reads the current text of the changed pages as data,
  inside the game snapshot (cut at 24,000 characters a page and 60,000 in all; never to Telegram, the dashboard or the
  executor). The same hourly look names a route of FoxLeague's API your agents call whose shape changed. On the
  dashboard you may also pause the actions whose rules changed until the agents are synced (turning that off asks for
  your password). `AGENT_MANUAL_CHECK=0` in `.env` switches the check off.
- **More agents:** + Add agent. Each has its own wallet from the same recovery words, its own settings and PEM file.
  Retire parks an agent you no longer use (out of the tabs, restore it any time).

## What it costs

- **The game:** never more than your caps (defaults $5 a day and $150 a month, plus $20 for the registration).
- **The AI:** about $1.50 a day for a single agent with the default model, effort and tick (Sonnet 5.5 at medium, a plan every 2 hours inside 12 active hours, about $0.25 a plan): every plan sends the rules and the game manual, about 105,000 tokens, and they are cached for an hour only when another plan comes within that hour, so a lone agent sends them at the plain price. Agents that plan within the same hour share the cache and pay far less for that text: measured on real plans, ten agents on Opus 5.5 at high effort averaged $0.15 a plan with the manual from the cache and $0.60 without. Opus, Fable and a higher effort cost more for the same plan, and a shorter tick means more plans a day. Each agent can also have its own model and effort; the cache is shared by the agents on the same model and effort. After a start of the service the first agent of each model and effort plans at once and the others of that pair 3 to 6 minutes later, so they read the cache it wrote instead of each writing it again. With shadow plans on, the models and efforts of the shadow plans count too, so two agents that share a shadow model do not both write its cache.
- **Network fees:** a few cents a day.

## Command line

In the `foxleague-agent` folder, as yourself and without sudo (`./cli.sh` uses the Node.js the installer set up, so
it needs no npm; alone it lists every command; as root on your folder it stops and says so, because files of root
there would keep the agent from starting again):

```
./cli.sh agents               # every agent (numbered from 1) and its address
./cli.sh snapshot 1           # read-only state of agent 1
./cli.sh plan 1               # the AI's plan for agent 1, simulated
./cli.sh dry-run 1 '<json>'   # run hand-written actions through the checks, simulated
./cli.sh kill on|off | pause N | resume N | mode [dry|live] | log [N]
./cli.sh shadow-report [N]     # what each shadow model would have planned (shadow plans, docs/SERVER.md)
./cli.sh model [N] [model effort]  # each agent's AI; agent N's own model and effort (same: the all-agents one)
./cli.sh configure            # keys, typed hidden
./cli.sh check-keys           # test the keys
./cli.sh set-web-password     # dashboard login
./cli.sh backup-words         # show the recovery words again, only in your own terminal
./cli.sh export-pem N pem/agentN.pem
./run.sh                      # start the agent in this terminal (an install without the background service)
./install.sh --update | --uninstall
```

In a git checkout with your own Node.js, `npm run cli -- <command>` and `npm start` do the same.

To run it on a server behind nginx instead, see [docs/SERVER.md](docs/SERVER.md).

## How it works

TypeScript on Node 22 (no build step), SQLite for state. `npm test` runs the test suite.

- `src/snapshot`: the team, cards, balances, tournaments, challenges, auctions and time slots, from the public
  API and the chain.
- `src/strategist`: the Claude planner (tool use, the player manual in a cached system prompt).
- `src/executor`: the action list, the game rules, the caps, transaction builders, dry run and live paths.
- `src/chain`, `src/foxleague`, `src/wallet`, `src/telegram`, `src/web`, `src/store`, `src/service.ts`.

Knowledge base: `docs/FOXLEAGUE-INTEGRATION.md` (every action as API calls and transactions),
`docs/ECONOMY-AND-RULES.md` (costs, rewards, caps and cooldowns) and `src/strategist/manual.md` (the player
manual, rebuilt with `./cli.sh sync-manual <path to the FoxLeague repository>`, which also writes
`src/strategist/manual-pages.json`, the page record the daily check compares FoxLeague's manual with, and
`src/foxleague/api-shapes.json`, the shapes of the routes listed in `src/foxleague/api-routes.ts`).

## Fair play

FoxLeague's Fair Play rules allow automation on your own wallets for the actions the app offers, and prohibit
its abuse: bypassing an enforced rule, overloading the platform, using hidden information, coordinating teams or
harvesting bonuses. Every agent must stay inside them. You are responsible for your agents.

## Contributing

Pull requests are welcome. Read [AGENTS.md](AGENTS.md) first: it holds the rules that keep money safe, how to run
the tests and how a change reaches `main`. Opening a pull request runs nothing; when a maintainer decides to merge
it, the label `merge-check` runs the tests and an agent review, and `main` takes the change once both pass and a
maintainer approved it. New versions reach users as signed releases ([docs/RELEASING.md](docs/RELEASING.md)): the
installer takes the newest one, and an installed agent offers each new one to its owner.
