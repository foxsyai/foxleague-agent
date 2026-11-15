---
title: A day in the life
description: What the agent does every day, before a match and to grow the squad.
---

Every cycle (every 2 hours at the first levels, up to every hour at Zeus, inside your active hours) the agent takes a fresh look
at everything a player can see: its squad and their condition, its budget, open tournaments and 1v1 challenges, auctions,
prices and the leaderboard. The AI reads that together with the full FoxLeague player manual and its economy map,
decides what is worth doing and hands the plan to the executor, which checks each action right before it runs.
It also reads what it did lately and its previous plan (summary and actions, up to 2,000 characters), and each plan says again what the agent still
means to do later (ranked games after a 1v1, saving for an entry, a tournament watched until its deadline), so a
goal carries on for as long as it holds. Where the fresh look says something else, the fresh look wins.

An empty plan is a good answer too: the agent never spends just because budget is left.

## The daily routine

- **Training**: the 5 free sessions of the day, on the starters who gain most, on stats below their rarity cap; it
  sees each stat's XP pool once it is within 500 XP of its next point, so it knows which session or match brings it.
- **Sync**: training and match XP change a card's live stats; matches use the stats synced on chain. The agent
  syncs when it matters, typically before a match day, not after every session, or a single card for 10 FOXSY when
  only one matters.
- **Lineup and formation**: fit starters in the right slots, a formation that suits the squad. The agent keeps a
  record of its results by its formation against the rival's (from FoxLeague's public match statistics, split by
  whether its eleven was clearly stronger, about equal or clearly weaker, since even matches are the fair test), also sees the same record pooled over all the agents of your install (no team
  named) and a league formation table: the public matches of the top 100 teams by ELO over the last 14 days, your
  teams left out, with the same split and the results of the side rated more than 100 ELO lower (what lifts a weaker
  team against a stronger one). Each plan reads a few more of those matches, so the table grows over the first days.
  The agent tests another formation in ranked matches when its own record is thin or keeps losing, starting with the
  one that does best in the pooled record and the league table, and saves a new formation together with the eleven
  it needs.
- **Ranked and casual matches**: the daily allowance, never closer than a match holds the team (about 13 minutes: the game and its broadcast) or the
  ranked cooldown (15 minutes in the game; the plan spaces ranked games 16 minutes apart to be sure), counting the last match before the plan; a match that no longer
  fits waits for the next plan. A ranked match's strength counts in the formation record only when its statistics
  were read within 6 hours of its end (FoxLeague rebuilds them from the cards as they are now).
- **Casual test bench**: FoxLeague plays a casual game against an AI built at your team's own OVR with a random
  formation, so it is a fair, free test of a formation (no ELO, XP or FOXSY; 5 condition for each player who plays and
  one of the 5 daily starts, shared with ranked). The agent aims at 1 to 3 such tests a day, and only when every card that
  plays is back to full condition before your next tournament or 1v1 match (never while a 1v1 of yours waits for an
  opponent). It rotates through every formation your squad can field, the least tested first. For each test it saves
  the test formation, starts the game and puts your formation back at once. The results of all your agents form one
  test bench, apart from the formation record, and the agent weighs it with the league table and its own record
  before it changes its formation.
- **Competition levels**: a ranked game costs a ticket for the team that starts it. The agent presses start first and pays only when FoxLeague asks for a ticket, within your Max shop payment; a game the AI fills is free and keeps the ticket. Only the team that paid earns XP and a competitive match; the team drawn in pays nothing and only its rating moves. A Bronze tournament has an entry and a prize pool and earns too, so the agent weighs it next to Silver and Gold. Each card counts a limited number of competitive matches a day, and the agent reads the numbers from FoxLeague.
- **Yellow cards and injuries**: once FoxLeague counts them, a player with enough yellow cards in tournaments (for
  example 3) misses your team's next tournament match, and a foul can injure a player for days (for example 3, 9 or
  27, by how many injuries he takes in one match), more likely the more tired he is (for example 1 percent a foul at
  full condition, up to 3 percent at condition 30). FoxLeague sets these numbers and may change them: the agent reads
  the ones in force before every plan. The agent sees each card's yellow cards, ban
  and injury, also on the cards at auction. It starts no match, 1v1 or tournament entry while an injured player is in
  your starting eleven: it saves an eleven without him first. Before a 1v1 it counts 11 match-fit players among your
  18 the way FoxLeague does, an injured one not among them and a tired outfield player relieved only by an outfield
  player from the bench (never by the bench keeper), so no stake is paid for a seat FoxLeague would refuse. It never fuses an injured
  or suspended card. It may bid on an injured card when the price is low enough for the days he cannot play, and
  never on one whose injury it cannot read. A forfeit costs your
  team rating, so it keeps the 11 + 7 complete and fit before each lock, as before.

## Competition

- **Tournaments**: it joins Silver and Gold tournaments where the squad can compete, and creates its own in a free
  platform time slot, sized from what recently filled. For the 4 open Silver, Gold or paid Bronze tournaments it could join whose
  deadlines come first (up to 16 seated teams each), it sees how the seated teams compare (clearly stronger, even, clearly weaker, by starting eleven and rating: an eleven more than 10 percent stronger than yours counts as clearly stronger whatever its rating). It
  refuses a schedule that would wear the squad out, counting the largest group a Groups + Knockout can draw, judged on the condition the squad will have at the start (rested
  until then, less what its other tournaments cost before it). It pays no entry and no 1v1 stake in the last two minutes before a registration deadline: a payment that reaches FoxLeague after the deadline is refunded and its gas is lost. When FoxLeague asks the organizer for a calendar deposit, the agent pays that one payment before the create, within your Max shop payment. The deposit is counted on the maximum number of teams, comes back after the last game and is kept when too few teams join by the deadline, so it sizes what it creates from what recently filled. Once FoxLeague charges a private tournament a higher platform fee out of its prize pool (its prize split says so), shared by every team in it, the agent weighs that before it invites. Once FoxLeague's leave lock is on, the agent cannot leave a tournament that is at its minimum number of teams. Every
  level may create a private tournament, inviting the teams it chooses, and joins one your team is invited to when it
  is worth it (only your team's own FoxLeague login sees the invitation).
- **Champions FoxLeague (League + Knockout)**: FoxLeague invites the top of its leaderboard; the agent accepts an
  invitation by itself, at every level, when the entry fee fits your limits and the squad can carry up to 17 matches
  (8 league matches, then the knockout for places 1 to 24), judged on its condition at the start and through the
  knockout's last days, when up to 9 matches come close together, and only with a real chance of the knockout
  (fewer than 24 of the invited teams clearly stronger). It pays only while FoxLeague says the invitation can be
  accepted, read again right before the payment, and never in its last 30 minutes. While it runs your team joins no
  other tournament (1v1s and ranked stay open), and once the seats lock nobody can leave. It never creates one. It may
  leave one it joined early when it sees no real chance of the top 24, but only before the seats lock, while leaving
  still returns the whole entry (it closes the invitation for good), and never within 30 minutes of the lock or when
  the lock time cannot be read. You hear of each invitation, in its activity and at once on Telegram, with the entry fee
  and until when; you can also accept or decline it in FoxLeague yourself.
- **1v1 challenges**: it accepts or creates 1v1s against teams of similar strength (compared by rating and by the
  starting eleven, and it sees each team's best XI OVR), at most two played 1v1s a week against the same team (a challenge nobody accepted, its stake back, does not count).
  A tournament or a 1v1 with an OVR range is joined
  only when your team's best XI OVR, read from FoxLeague right before the payment, is inside it. It may set an OVR
  range on a tournament or a 1v1 it creates, so only teams of a strength it chooses can join; the range must hold its
  own best XI OVR, read right before the create. On its own open tournament it sets one by default, about 10 percent
  either way around its best XI OVR, wider when recent tournaments filled slowly. When too few teams join its own open tournament or challenge, it may widen the range while it is open, never narrow it (a lower minimum, a higher maximum or no bound on that side; on a 1v1 only a lower minimum); teams already seated stay. It widens only what it created itself: a range you set in FoxLeague stays yours. The plan sees how many 1v1s it played against each
  team this week and when the limit frees, and a team with its own challenge out is marked (it cannot accept another
  until that one ends). Every level may play a 1v1 three ways. A challenge to a named team is taken almost only
  when the two teams arranged it first, so the agent aims one only at a team of similar or lower strength that
  FoxLeague's public results show taking challenges it had not arranged in the last 7 days (a challenge played within
  2 minutes of its creation counts as arranged); a challenge to a team that never answers only locks the stake until
  its deadline. An open challenge can be taken by any team inside its OVR range, often within minutes: its range tops
  out at your team's own best XI OVR, so FoxLeague itself keeps every stronger team out, at any of your amounts and as
  often as FoxLeague's one active 1v1 allows; since that rating ignores condition, it waits while a fresh team at the
  top would be more than 10 percent stronger than your starting eleven at today's condition, and while one waits for a
  taker it plays no ranked game, trains no starter and sets no eleven that would break that. And it may take an open challenge another team posted. It can leave its
  own unaccepted challenge when a better one appears.
- **Match preparation**: about an hour before each match session locks (inside its active hours), it syncs if the gains matter, sets the
  formation and lineup for that opponent (from the formations it played last and how strong its eleven is next to ours) and recovers condition only for key starters in a match that matters.
- **Refunds**: seats and stakes that come back (a tournament that did not fill, an expired challenge) are claimed
  when needed and stop counting against your budget.

## Growing the squad

- **XP booster**: doubles training and match XP for 24 hours. The agent weighs it with the numbers: on a day with
  three sure competitive matches at the full rate it is roughly 7 stat points for 2,000 FOXSY, far cheaper than paid
  training, and a level that earns a share of the XP brings that share of it (for example three quarters). It buys
  one only once a competitive match of its own is drawn within the booster's 24 hours, and only within the boosters a
  week its level allows.
- **Paid training slots**: mainly while a booster is active.
- **Medicine**: shortens an injury by whole days (FoxLeague always keeps a third of it). The agent buys it only for a
  starter it cannot replace who would miss matches that matter, only the days up to that match, at FoxLeague's own
  quote, within your level's medicine days a week, your Max shop payment and your daily cap.
- **Common packs**: 5 Common cards, the spare cards the first fusion needs.
- **Fusion**: three cards of one rarity into one of the next, never leaving fewer than the 18 cards a match needs,
  plus both fusion waivers (a shorter cooldown, bought match credit) when a fusion can really happen. FoxLeague runs
  one of two fusions and the agent reads which from FoxLeague's settings: a card drawn from FoxLeague's pool, or a new
  card minted from the three. The new card takes each stat as the average of that stat on the three cards, raised to
  the next rarity's range and never under its floor (for example three Commons at 30, 18 and 12 in a stat give the new
  Uncommon 36 there), so it fuses trained cards. For the new card FoxLeague prepares the transaction, and the agent
  signs it only when it is exactly the fusion it planned, for the fee of that rarity and nothing more. It fuses nothing
  while that setting cannot be read, while FoxLeague updates fusion or in the last minutes before it changes.
- **Marketplace**: bids on cards that clearly strengthen the squad at a fair price (never on a card whose transfer lock still runs more than 72 hours: it could not play for weeks), lists spare cards above the floor, never one of its 18 strongest cards and never so that fewer than 18 cards remain. It judges each card on its own, whoever sells it or bids on it, another of your agents included.

## Getting started by itself

With EGLD in the wallet, a new agent swaps for the 5,000 FOXSY registration, picks a team name, registers and
generates its free team badge. It names the team the way fans name a club: a city or town from anywhere in the
world with a club word, such as FC, United or Rovers. It asks FoxLeague whether the name is free before it pays
the fee, so a taken name costs nothing: it picks another.
