---
title: Safety and your limits
description: Why the agent can never spend more than you allow, and how it plays fair.
---

## Your limits are code, not a request

The AI only **proposes**. Every action goes through an executor written in plain code, which checks it against the
game rules and your limits right before it runs, and refuses what does not fit:

- a **daily cap**, a **monthly budget** and a one-time **setup budget**, in USD at live prices;
- a maximum per **entry fee or stake**, **shop payment**, **bid** and **swap**;
- an **EGLD gas reserve** (1 EGLD by default) that a swap can never touch.

Every payment is booked before it is signed, so even a crash can never let it go past a limit.

## The AI never holds your keys

The AI sees a snapshot of the game, never your wallet or keys. It cannot build a transaction: it picks from a fixed
list of actions (train, play, join, buy, bid...), each with checked arguments, and the executor builds and signs
it. Text written by other players (team names, tournament titles) reaches it only as data, never as instructions.

## You stay in control

- **Dry run first**: a new install only simulates, and an agent you add later follows the current mode. Going
  live in the dashboard needs you to type `GO LIVE` and your password, and this machine's permission
  (`AGENT_LIVE_ENABLED=1` in `.env`, asked by the installer); on Telegram it takes `/mode live confirm`,
  which only your own chat can send.
- **Back to dry run** is one click. **Pause** stops one agent; the **Kill switch** stops every agent, even free actions.
- In the dashboard, raising a limit (also a shorter tick, longer active hours, Gold back on or a smaller gas
  reserve), switching to a dearer AI, releasing the kill switch and changing a key all ask for your password again.
  Telegram obeys your own chat only (`/kill off` releases the switch there).
- Your recovery words and keys stay on your computer. The dashboard is not on the internet.
- **Top-ups from Binance** move only with a one-time code you send on Telegram, only to an agent's own wallet,
  with a key that can only read and withdraw from one IP. A withdrawal whose answer was lost is never sent again
  by itself: you check Binance first.

## A wallet only for the game

Each agent plays from its own wallet, and the agent's key file can sign for everything that wallet holds. So
keep it a wallet made only for FoxLeague: no Guardian, no other assets, only the amount you set aside for the
game, in small amounts that you top up daily, weekly or whenever it suits you. **+ Add agent** creates such a
wallet. Your personal wallet, with its history and other assets, is better kept away from any automation
([Which wallet to give an agent](/use/import-team/#which-wallet-to-give-an-agent)).

## Fair play

FoxLeague's Fair Play rules allow automation on your own wallets for the actions the app offers, and prohibit its
abuse. The agent:

- uses only public information, the same a player sees in the app;
- plays at a human pace (random timing, spread-out actions, active hours);
- never coordinates your agents against anyone: each plays its own game without knowing which teams are yours, so two
  of them may meet in a tournament or a 1v1 by chance (FoxLeague's Fair Play forbids arranging results, not
  meeting). They share four things only: a pooled formation record with no team named, a rule that only one of them
  at a time has a 1v1 out against the same rival (retired and removed teams count too), so no manager faces several
  of your teams at once, and a rule that only one of them bids on a card at auction and none on a card another of
  your teams sells, so you never bid against yourself or pay the sale fee to move a card between your own wallets, and the rule that a
  private tournament it creates never invites another of your teams;
- protects itself from rivals trying to farm it (1v1s only against teams of similar strength, at most two a week
  against the same team; an open challenge, which any team may take, at most once a day and only at your lowest
  Silver amount);
- creates a private tournament only at the Zeus level (it invites rival teams, never your other agents) and joins
  one only when your team is invited.

You remain responsible for your agents.

## Reviewed

The code went through fourteen numbered adversarial reviews that tried to break the money limits, attack it from
outside and break its security, then a review of CI and whole-project reviews before release. Every finding was
fixed with a test that proves it or weighed and decided; the few still open are listed in the review record.
