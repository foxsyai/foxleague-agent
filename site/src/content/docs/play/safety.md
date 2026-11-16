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

Every payment is booked before it is signed, so even a crash can never let it go past a limit. When an answer is
lost on the way, the payment stays counted until the agent can read what became of it: it may count too much for a
while, never too little. The registration fee is counted once, as FoxLeague takes it once: a registration that did
not go through does not use up the setup budget for the next try.

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
- **Updates** install only when you ask, with **Update now** in the dashboard or `/upgrade` on Telegram. They need
  no password, because only a release that is signed by the foxleague-agent maintainers and newer than yours can be
  installed, whoever asks ([Signed updates](#signed-updates)).
- **Top-ups from Binance** move only with a one-time code you send on Telegram, only to an agent's own wallet,
  with a key that can only read and withdraw from one IP. A withdrawal whose answer was lost is never sent again
  by itself: it stays "not known" for 30 minutes from the moment it was sent, while the agent asks Binance what
  became of it, and you check Binance first.

## What leaves your computer

The agent talks only to the services it needs:

- **FoxLeague and the MultiversX network**: what the player app sends too. It reads public data, logs in as your
  team and sends the transactions it signs. Every hour it also reads the manual pages FoxLeague's public read-only
  server gives, to see whether the game's manual changed since your agents' copy; that request carries nothing of
  yours. `AGENT_MANUAL_CHECK=0` in `.env` switches it off.
- **Anthropic**: what the AI needs to plan and to answer you. That is the snapshot of the game, your strategy, the
  budget that is left, the recent activity and your conversation with the manager. Never your recovery words or keys.
- **Telegram and Binance**, only when you set their keys: your messages and the agent's answers, and the top-ups
  you approve.
- **GitHub**, about every 10 minutes and when you press **Check for updates** (the round arrow next to the version,
  at most once in 15 seconds): one request for the newest release of foxleague-agent, so the agent can tell you
  when an update is out. It says nothing about your install: no version, no wallet and no name. As with any
  download, GitHub sees the address your computer has on the internet. `AGENT_UPDATE_CHECK=0` in `.env` switches
  the request off.

## Signed updates

Releases are signed with a key that never leaves the maintainers' own computers: it is not on GitHub. Your agent
checks every update with the public half of that key, which came with the version it already runs. It takes a
release only when the signature is good, the version is newer than yours and the download is exactly the one that
was signed, so a stolen GitHub account or a changed download cannot put other code on your computer.

That is why an update needs no password: the button and `/upgrade` can start only that one thing. Nothing installs
by itself, the running version is not touched while the new one is prepared, and a new version that does not start
is undone by itself ([Update](/help/update/)).

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
- never coordinates your agents against anyone: each plays its own game as if it were alone, without knowing which
  teams are yours, so two of them may meet in a tournament or a 1v1, bid on the same card or buy a card from each
  other at auction, by chance (FoxLeague's Fair Play forbids arranging results, not meeting). What they share is a pooled formation record with no team named, a league formation table built from public matches and the results of their casual tests;
- protects itself from rivals trying to farm it (a 1v1 against a named team or one it joins only when that team is of
  similar strength, at most two played 1v1s a week against the same team, a challenge nobody accepted not counting; an
  open challenge, which any team inside its range may take, always carries an OVR range that tops out at your team's
  own best XI OVR, so FoxLeague itself keeps every stronger team out, and none while your starters are too tired for
  a fresh team of that rating);
- joins a private tournament only when your team is invited (every level may create one).

You remain responsible for your agents.

## Reviewed

The code went through fourteen numbered adversarial reviews that tried to break the money limits, attack it from
outside and break its security, then a review of CI and whole-project reviews before release. The last was a final
audit before the public launch by six reviewers, one area each: the money limits, attacks from outside, rare cases,
the game's own rules, the installer with its updates and these pages. Every finding was fixed with a test that
proves it or weighed and decided; the few still open are listed in the review record.
