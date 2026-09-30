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

- **Dry run first**: new agents only simulate. Going live needs you to type `GO LIVE` and your password.
- **Back to dry run** is one click. **Pause** stops one agent; the **Kill switch** stops every agent, even free actions.
- Raising a limit, releasing the kill switch and changing a key all ask for your password again.
- Your recovery words and keys stay on your computer. The dashboard is not on the internet.

## Fair play

FoxLeague's Fair Play rules allow automation on your own wallets for the actions the app offers, and prohibit its
abuse. The agent:

- uses only public information, the same a player sees in the app;
- plays at a human pace (random timing, spread-out actions, active hours);
- never lets your agents meet in a 1v1, trade with each other or feed each other's tournaments;
- protects itself from rivals trying to farm it (1v1s only against teams of similar strength, at most two a week
  against the same team, never an open challenge).

You remain responsible for your agents.

## Reviewed

The code went through six adversarial reviews that tried to break the money limits, attack it from outside and
break its security. Every finding was fixed with a test that proves it.
