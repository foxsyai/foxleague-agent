---
title: A day in the life
description: What the agent does every day, before a match and to grow the squad.
---

Every cycle (every 30 minutes by default, inside your active hours) the agent takes a fresh look at everything a
player can see: its squad and their condition, its budget, open tournaments and 1v1 challenges, auctions,
prices and the leaderboard. The AI reads that together with the full FoxLeague player manual and its economy map,
decides what is worth doing and hands the plan to the executor, which checks each action right before it runs.

An empty plan is a good answer too: the agent never spends just because budget is left.

## The daily routine

- **Training**: the 5 free sessions of the day, on the starters who gain most, on stats below their rarity cap.
- **Sync**: training and match XP change a card's live stats; matches use the stats synced on chain. The agent
  syncs when it matters, typically before a match day, not after every session.
- **Lineup and formation**: fit starters in the right slots, a formation that suits the squad.
- **Ranked and casual matches**: the daily allowance, spaced like a person playing.

## Competition

- **Tournaments**: it joins Silver and Gold tournaments where the squad can compete, and creates its own in a free
  platform time slot, sized from what recently filled. It refuses a schedule that would wear the squad out. It
  never creates a private tournament, but it joins one your team is invited to when it is worth it (only your
  team's own FoxLeague login sees the invitation).
- **1v1 challenges**: it accepts or creates 1v1s against teams of similar strength (compared by rating and by the
  starting eleven), at most twice a week against the same team. When it
  creates one, it prefers a team of similar or lower strength that accepts 1v1s: FoxLeague's public results show
  who took challenges in the last 7 days, and a challenge to a team that never answers only locks the stake until
  its deadline. When no such team fits, it may create one **open** challenge a day, which any team can take, a
  stronger one too: always Silver at your lowest Silver amount, so the stake stays small. It can leave its own
  unaccepted challenge when a better one appears.
- **Match preparation**: about an hour before each match session locks (inside its active hours), it syncs if the gains matter, sets the
  lineup for that opponent and recovers condition only for key starters in a match that matters.
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
generates its free team badge.
