# FoxLeague Agent: an AI team manager for FoxLeague

A self-hosted manager for your [FoxLeague](https://foxleague.ai) teams on MultiversX mainnet, for players who
have a budget but not the time to sit in the app all day. A Claude model plans; plain code checks every action
against the game rules and your spending limits before anything is paid. It uses FoxLeague's public API and
smart contracts, exactly like the player app, from your own computer or server. Your wallet words and keys never
leave it.

Status: version 0.9, in internal testing. Everything below works live on mainnet.

## Install

Linux, macOS or Windows through WSL2. Open a terminal and paste one line:

```
curl -fsSL https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.sh | bash
```

A guided installer sets up a new wallet, your dashboard login, your keys, PEM files to watch your team in the
FoxLeague app and a background service. The dashboard's **Getting started** guide then explains each key step
by step. Everything else is in [INSTALL.md](INSTALL.md).

You need about 5 EGLD to start (2.5 buys the 5,000 FOXSY registration, 1 stays as the gas reserve) and an
Anthropic API key for the AI. Telegram and Binance are optional.

## What it does

Every half hour (randomised, inside the active hours you choose) each agent reads its team and the platform, asks
the AI for a plan and runs the actions spread over the next minutes:

- **Daily routine:** the free training sessions on the starters who gain most, syncing stats to chain when it
  matters, lineup and formation, ranked and casual matches.
- **Competition:** joins Silver and Gold tournaments and 1v1 challenges it can win, creates its own in a free
  platform time slot, prepares before each match locks (sync, lineup, condition), leaves or cancels when a
  better option appears, claims refunds.
- **Growth:** XP booster and paid training when the numbers say so, Common packs, fusion and both fusion
  waivers, bids and listings on the marketplace.
- **Onboarding:** swaps EGLD to FOXSY, registers the team and generates its free badge.

The AI reasons from the full player manual and its economy map. You steer it with a strategy in plain words, in
the dashboard or by chatting with it on Telegram.

## Safety

- **Your limits are code, not a prompt.** A daily cap, a monthly budget, a one-time setup budget and a maximum
  per entry fee, shop payment, bid and swap, all in USD at live prices. The AI proposes; the executor refuses
  anything over them. An EGLD gas reserve (1 EGLD by default) is never swapped.
- **The AI never holds keys** and cannot build a transaction: it picks from a fixed list of actions, each checked
  against the game rules first.
- **Dry run first.** New agents only simulate. Going live needs your Go LIVE (typed, with your password) and this
  machine's permission. Back to dry run is one click; a kill switch stops every agent at once.
- **Fair play.** Public information only, a human pace, never a 1v1 or trade between your own agents; guards
  against rivals who try to farm an agent (1v1s only against teams of similar strength, at most two a week each).
- **Reviewed.** Seven adversarial reviews, every finding fixed with a test: [docs/SECURITY-REVIEW.md](docs/SECURITY-REVIEW.md).

## Using it

- **Dashboard** at `http://localhost:8870`: every agent with its balances, spend against the caps, last plan and
  activity; settings with an explanation on every field; Pause, Plan now, Add agent, Go LIVE and the kill switch;
  the AI's model and effort; the Keys panel.
- **Telegram** (optional): every action on your phone. Write in plain words ("focus on Silver tournaments this
  week") and the manager answers, or proposes a new strategy you apply with one tap. Commands: `/status`,
  `/plan`, `/pause`, `/mode`, `/kill`, `/help`.
- **More agents:** + Add agent. Each has its own wallet from the same recovery words, its own settings and PEM file.

## What it costs

- **The game:** never more than your caps (defaults $10 a day and $300 a month, plus $20 for the registration).
- **The AI:** about $0.50 to $3 a day per agent, depending on the model and effort you pick.
- **Network fees:** a few cents a day.

## Command line

```
npm run cli -- agents               # every agent (numbered from 1) and its address
npm run cli -- snapshot 1            # read-only state of agent 1
npm run cli -- plan 1                # the AI's plan for agent 1, simulated
npm run cli -- dry-run 1 '<json>'    # run hand-written actions through the checks, simulated
npm run cli -- kill on|off | pause N | resume N | mode [dry|live] | log [N]
npm run cli -- configure             # keys, typed hidden
npm run cli -- check-keys            # test the keys
npm run cli -- set-web-password      # dashboard login
npm run cli -- export-pem N pem/agentN.pem
./install.sh --update | --uninstall
```

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
manual, rebuilt with `npm run cli -- sync-manual <path to the FoxLeague repository>`).

## Fair play

FoxLeague's Fair Play rules allow automation on your own wallets for the actions the app offers, and prohibit
its abuse: bypassing an enforced rule, overloading the platform, using hidden information, coordinating teams or
harvesting bonuses. Every agent must stay inside them. You are responsible for your agents.
