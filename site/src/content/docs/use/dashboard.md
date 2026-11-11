---
title: The dashboard
description: A tour of the dashboard at localhost:8870.
---

The dashboard runs on your own computer at **http://localhost:8870** (or the port you chose). Every field has a
small **i**: hover it for a preview, tap or click it for the full explanation.

![The dashboard: header, totals and an agent's page](/screenshots/dashboard.png)

## The header

- **Getting started** reopens the guide to your keys, funding and going live.
- **Keys** holds the AI, Telegram and Binance keys for all agents ([Your keys](/start/keys/)).
- **Go LIVE / Back to dry run** is one switch for all agents. Going live asks you to type `GO LIVE` and your
  password; back to dry run is one click.
- **Kill switch** stops every agent at once. Turning it on is one click; releasing it asks for your password.

## The totals

- **Agents**: how many agents are active on this computer, how many are paused, how many are retired and how many
  are low on funds.
- **EGLD** and **FOXSY**: the live prices. Every payment is valued in USD before it is checked; FOXSY counts at the
  higher of its spot price and its two-day median, so a sudden dip never makes a payment look cheaper.
- **Spent today**: what all agents spent this game day (it resets at 14:00 UTC, like the game's own daily limits).
- **Strategist**: the AI model and effort for every agent, from four models: Haiku 5.5, Sonnet 5.5, Opus 5.5 and
  Fable 5.2. Sonnet 5.5 is the default and plays well; Haiku 5.5 is the cheapest, for trying things out: how well it
  plays this game has not been measured yet; Opus 5.5, Fable 5.2 and a higher effort think harder and cost more. A
  dearer model or a higher effort asks for your password, because the AI spend has no cap of its own; a cheaper one is
  one click. The entry "Local model (free, coming soon)" at the top of the list cannot be picked: a free model that
  runs on your own computer is being tested and is not ready.

## An agent's page

- **Controls**: **Plan now** runs a planning cycle at once; **Pause** stops this agent only; **Retire** parks an
  agent you no longer use (see below).
- **Wallet and team**: the EGLD, WEGLD and FOXSY balances (WEGLD shows 0.0000 when the wallet holds none), cards,
  team, rating and record, matches and training today. While the page is open, a reading older than 10 minutes is
  taken again by itself, so a top-up shows within seconds (**Refresh** reads it at once). **Value** is what
  the wallet's EGLD, WEGLD and FOXSY are worth in USD, and next to it what the agent can play with (the EGLD gas
  reserve aside); it turns orange, and the agent's tab shows **low funds**, when that falls under your **Top-up
  warning** (it shows in the morning summary on Telegram, at once with `/updates all`; with a Binance key, Telegram and the platform LIVE, a top-up
  proposal comes at once (once a day per agent)). To top up, send EGLD to the agent's
  address: it buys FOXSY by itself (WEGLD and FOXSY work too). **In tournaments** lists the tournaments and 1v1s the agent is in, each open
  one with a **Leave** button (once FoxLeague's leave lock is on, a tournament exactly at its minimum number of teams
  cannot be left).
- **Last plan**: the agent's latest reading of the situation, each action with a one-line reason and the cost of
  the AI call.
- **Activity**: everything the agent did, newest first, with a filter for plans, actions or problems.
- **Budget**: spend against today's cap, this month's budget and the setup budget.
- **Talk to the manager**: advice or questions in plain words, typed or spoken ([Talk to your manager](/use/talk-to-your-manager/)).
- **Settings**: the strategy and every limit ([Every setting explained](/use/settings/)).

Above the pages, a tab per agent shows its number and team. **+ Add agent** adds one from your recovery words;
**Import team** adds one for a team you already play, marked **imported**, which also gets a **Remove** button on
its page ([Import your team](/use/import-team/)).

![An agent's plan, budget and settings](/screenshots/agent-page.png)

## Retire and restore an agent

An agent you no longer use can be parked, so only the ones that play stay in the tabs. On its page, press
**Retire** and confirm. The agent is paused and moves to **Retired**, a button next to **Import team** that shows
how many agents are parked there.

![Retire: the agent is paused and moves to Retired](/screenshots/retire.png)

A retired agent makes no plans, costs nothing, sends no warnings and does not count toward the agent limit, so it
frees its place for a new agent. Nothing is sold or moved: the wallet keeps its funds and cards, the team stays in
FoxLeague (tournaments it already joined go on without it) and an imported team keeps its key. An agent cannot be
retired while a payment waits for FoxLeague's confirmation.

**Retired** lists each parked agent with its team, wallet address, the day it was retired and what the wallet held
then. **Restore** brings it back to the tabs with its settings and history, paused: check its limits, then press
**Resume**. Restore needs a free place under the agent limit.

![Retired: the parked agents, each with Restore](/screenshots/retired.png)

On Telegram, `/status` names the retired agents, and commands for one of them answer that it is retired. Restore
is in the dashboard only.

## Delete an agent that was never used

An agent you added but never used, with a wallet that sent no transaction, holds nothing (no EGLD, WEGLD, FOXSY or
cards) and has no FoxLeague team, can be deleted instead of retired. Its page then shows **Delete**, next to
**Retire**. Before anything goes, the wallet is read again from the chain and FoxLeague; if any of it is not clean
or cannot be read, nothing is deleted.

The agent, its settings and its history are deleted, and so is its PEM file in `pem/`. On a server install the PEM
files are on your computer: run `./deploy/sync-pems.sh` there and it removes the files of the deleted agents. Nothing
is lost, because the wallet is empty and comes from your recovery words: **+ Add agent** takes the lowest free
number, so it makes the same wallet again. An agent that was ever used is retired, never deleted.

## Opening it from your phone

The dashboard listens on your computer only, never on the internet. To open it from another device, use an SSH
tunnel (`ssh -L 8870:localhost:8870 you@your-computer`), or follow the agent on Telegram.
