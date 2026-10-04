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

- **Agents**: how many agents run on this computer, how many are paused and how many are low on funds.
- **EGLD** and **FOXSY**: the live prices. Every payment is valued in USD before it is checked; FOXSY counts at the
  higher of its spot price and its two-day median, so a sudden dip never makes a payment look cheaper.
- **Spent today**: what all agents spent this game day (it resets at 14:00 UTC, like the game's own daily limits).
- **Strategist**: the AI model and effort for every agent. Sonnet 5 is the default and plays well; Sonnet 5.5 is the
  newer Sonnet at the same price; higher models or effort think harder and cost more.

## An agent's page

- **Controls**: **Plan now** runs a planning cycle at once; **Pause** stops this agent only.
- **Wallet and team**: the EGLD, WEGLD and FOXSY balances (WEGLD shows 0.0000 when the wallet holds none), cards,
  team, rating and record, matches and training today. **Value** is what
  the wallet's EGLD, WEGLD and FOXSY are worth in USD, and next to it what the agent can play with (the EGLD gas
  reserve aside); it turns orange, and the agent's tab shows **low funds**, when that falls under your **Top-up
  warning** (you also get one message on Telegram). To top up, send EGLD to the agent's
  address: it buys FOXSY by itself (WEGLD and FOXSY work too). **In tournaments** lists the tournaments and 1v1s the agent is in, each open
  one with a **Leave** button.
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

## Opening it from your phone

The dashboard listens on your computer only, never on the internet. To open it from another device, use an SSH
tunnel (`ssh -L 8870:localhost:8870 you@your-computer`), or follow the agent on Telegram.
