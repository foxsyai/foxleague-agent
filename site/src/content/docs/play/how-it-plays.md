---
title: A day in the life
description: What the agent does every day, before a match and to grow the squad.
---

Every cycle (every 2 hours by default, every hour for Zeus, inside your active hours) the agent takes a fresh look
at everything a player can see: its squad and their condition, its budget, open tournaments and 1v1 challenges, auctions,
prices and the leaderboard. The AI reads that together with the full FoxLeague player manual and its economy map,
decides what is worth doing and hands the plan to the executor, which checks each action right before it runs.
It also reads what it did lately and its previous plan in full, and each plan says again what the agent still
means to do later (ranked games after a 1v1, saving for an entry, a tournament watched until its deadline), so a
goal carries on for as long as it holds. Where the fresh look says something else, the fresh look wins.

An empty plan is a good answer too: the agent never spends just because budget is left.

## The daily routine

- **Training**: the 5 free sessions of the day, on the starters who gain most, on stats below their rarity cap.
- **Sync**: training and match XP change a card's live stats; matches use the stats synced on chain. The agent
  syncs when it matters, typically before a match day, not after every session.
- **Lineup and formation**: fit starters in the right slots, a formation that suits the squad. The agent keeps a
  record of its results by its formation against the rival's (from FoxLeague's public match statistics, split by
  whether its eleven was clearly stronger, about equal or clearly weaker, since even matches are the fair test), also sees the same record pooled over all the agents of your install (no team
  named), tests another formation in ranked matches when its own record is thin or keeps losing, starting with the
  one that does best in the pooled record, and saves a new formation together with the eleven it needs.
- **Ranked and casual matches**: the daily allowance, spaced like a person playing.

## Competition

- **Tournaments**: it joins Silver and Gold tournaments where the squad can compete, and creates its own in a free
  platform time slot, sized from what recently filled. It refuses a schedule that would wear the squad out. Only
  Zeus creates private tournaments; every level joins one your team is invited to when it is worth it (only
  your team's own FoxLeague login sees the invitation).
- **1v1 challenges**: it accepts or creates 1v1s against teams of similar strength (compared by rating and by the
  starting eleven), at most twice a week against the same team. When it
  creates one, it prefers a team of similar or lower strength that accepts 1v1s: FoxLeague's public results show
  who took challenges in the last 7 days, and a challenge to a team that never answers only locks the stake until
  its deadline. When no such team fits, it may create one **open** challenge a day, which any team can take, a
  stronger one too: always Silver at your lowest Silver amount, so the stake stays small. It can leave its own
  unaccepted challenge when a better one appears.
- **Match preparation**: about an hour before each match session locks (inside its active hours), it syncs if the gains matter, sets the
  formation and lineup for that opponent (from the formations it played last and how strong its eleven is next to ours) and recovers condition only for key starters in a match that matters.
- **Refunds**: seats and stakes that come back (a tournament that did not fill, an expired challenge) are claimed
  when needed and stop counting against your budget.

## Growing the squad

- **XP booster**: doubles training and match XP for 24 hours. The agent weighs it with the numbers: on a day with
  three sure competitive matches it is roughly 7 stat points for 2,000 FOXSY, far cheaper than paid training.
- **Paid training slots**: mainly while a booster is active.
- **Common packs**: 5 Common cards, the spare cards the first fusion needs.
- **Fusion**: three cards of one rarity into one of the next, never leaving fewer than the 18 cards a match needs,
  plus both fusion waivers (a shorter cooldown, bought match credit) when a fusion can really happen.
- **Marketplace**: bids on cards that clearly strengthen the squad at a fair price, lists spare cards above the
  floor.

## Getting started by itself

With EGLD in the wallet, a new agent swaps for the 5,000 FOXSY registration, picks a team name, registers and
generates its free team badge. It names the team the way fans name a club: a city or town from anywhere in the
world with a club word, such as FC, United or Rovers. It asks FoxLeague whether the name is free before it pays
the fee, so a taken name costs nothing: it picks another.
