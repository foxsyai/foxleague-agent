---
title: Strategy levels
description: "The six strategy levels, one brain for all of them and a budget that grows from Steady to Zeus."
---

The strategy is the direction the AI follows on every cycle. Six presets set it for you, and they work like
subscription tiers: **every level has the same brain**, and each level up adds money. The brain is the one Zeus
had: every action has to name its benefit against its cost and risk, it weighs a win chance for every team, and it
waits when nothing clearly pays. What grows from one level to the next is what the agent may spend: the daily cap and
the monthly budget, the largest entry, shop payment and bid, and how many paid training sessions, XP boosters and
Common packs it may buy. Higher levels also plan more often.

Pick one in **Settings → Strategy** or on Telegram (`/strategy 2 hunter`). In the dashboard, picking a level opens
a short proposal: the settings the level would change (moving up, those that fall short, raised to the level;
moving down, those above it, lowered to the level), each with a tick, and its recommended AI. **Accept and save** takes the ticked ones; **Cancel** keeps everything as it is saved. You can edit the text
afterwards or write your own. [Every setting explained](/use/settings/) covers the field itself.

## The same at every level

- Every part of FoxLeague is open: ranked and casual games, joining and creating tournaments (public or private),
  1v1s against a named team or as an open challenge, Champions FoxLeague invitations and the marketplace.
- It weighs a **win chance** for each team on its challenge list (up to 10, first the teams that take 1v1s they had not arranged).
- A 1v1 against a known team only from 55 percent; an open challenge only to teams no stronger by OVR.
- A tournament only with a real chance of the top three (fewer than three clearly stronger seated teams, our eleven
  taken at the start); a Champions FoxLeague invitation only with a real chance of the knockout (fewer than 24 of the
  invited teams clearly stronger). A team is clearly stronger when its starting eleven is more than 10 percent
  stronger than ours, whatever its rating, or more than 5 percent stronger with a rating more than 50 above ours: a
  low rating never makes a stronger eleven look even.
- Ranked while the squad is fit, casual formation tests when they cost nothing to a match that counts, the formation
  and eleven set against each opponent before every lock, training on the stats each role needs.
- A sync only when it changes a match that counts, condition recovery for key starters before a match that matters,
  the XP booster only on days with 3 sure competitive matches of its own.
- A player of any rarity bought only at a good price and for a reason; a spare card sold when its price beats its
  use; a fusion when the fees pay back.

## The six levels

| Level | What its money buys | Daily cap |
|---|---|---|
| **1. Steady** | Entries at your lowest Silver amounts, 2 paid training sessions a day, cards at auction up to 500 FOXSY, fusion fees and small waivers; from FoxLeague's competition levels on, the ranked ticket of each ranked start (within Max shop payment) | $5 |
| **2. Climber** | Gold entries too, 4 paid sessions a day, an XP booster a week, cards up to 1,500 FOXSY | $15 |
| **3. Hunter** | 6 paid sessions a day, 2 boosters and a Common pack a week, cards up to 7,000 FOXSY | $25 |
| **4. Predator** | 8 paid sessions a day, 3 boosters and 2 packs a week, a Rare's fusion match waivers, cards up to 14,000 FOXSY | $50 |
| **5. Beast** | All 10 paid sessions a day, a booster every day, an Epic's fusion match waivers | $100 |
| **6. Zeus** | Cards up to 38,000 FOXSY, the largest budget, a plan every hour | $150 |

On average about 90 percent of all entry fees come back as prizes, so entries are mostly a stake that returns,
not a cost. They still count toward the day's budget when they are paid: a prize goes back to the wallet but not
back into the budget. The shop, the waivers and the bids are real spending.

## What each level may buy

| Bought | Steady | Climber | Hunter | Predator | Beast | Zeus |
|---|---|---|---|---|---|---|
| Paid training sessions a day (20 FOXSY each) | 2 | 4 | 6 | 8 | 10 | 10 |
| XP boosters a week (2,000 FOXSY) | none | 1 | 2 | 3 | every day | every day |
| Common packs a week (2,500 FOXSY) | none | none | 1 | 2 | 2 | 2 |
| Days of injury medicine a week (100 to 500 FOXSY a day, by rarity) | none | 2 | 4 | 6 | 12 | 18 |
| Bids at auction | any rarity, up to 500 | up to 1,500 | up to 7,000 | up to 14,000 | up to 14,000 | up to 38,000 |
| Fusion fees (100 to 800) | up to 400 | all | all | all | all | all |
| Fusion waivers, one payment | up to 500 | up to 2,000 | up to 2,500 | up to 3,000 (a Rare's) | up to 9,000 (an Epic's) | up to 9,000 |
| Champions FoxLeague (League + Knockout) invitations | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

The counts are upper limits, not targets: the agent buys a boost only when it pays. The largest single shop payment
grades the waivers by itself: a fusion match waiver buys every missing match in one payment, so a level reaches only the rarities its limit covers. A fusion fee is held to the same limit: Steady's 500 reaches the fees up to 400. Medicine for an injured player is one
payment held to it too (Zeus's 9,000 covers the 18 days a Legendary's longest injury can save), and to the level's medicine days a week: 2 days are the whole of a light injury, 6 of a medium one and 18 of a serious one, since FoxLeague always keeps a third.

**Bids.** Every level bids at auction, on any rarity. A bid is limited by money, not by rarity: it stays at or under
the lowest of three numbers, the level's **Max bid**, your limit for the card's rarity and the cost of building the
card. So a Steady agent can take a Legendary listed at 500 FOXSY, and Zeus can buy a Common, never above 500 for it.
Raise a level's max bid and it can take a dearer card.

A bid is the whole price of the card, not an amount added to its start. The seller sets the reserve (at least 500
FOXSY); the agent bids the reserve or the smallest raise FoxLeague accepts over the top bid (for example 5 percent), and if it is outbid it may bid once more (two bids
on one auction at most). Every bid stays at or under the lowest of three numbers: the max bid, your limit for the card's
rarity and the cost of building the card.

**Never above the market.** The agent sees the market price of each rarity, worked out from what cards really sold
for on FoxLeague (the median of each trading day's median price over the last 30 days (60 or 90 days when fewer
than 5 days traded; with too few sales even then the agent sees no market price), so one day of cheap sales counts
once), and aims below it: it bids the reserve or the smallest raise that wins. Your limits per rarity are the
most it may pay: by default 500 FOXSY for a Common (a pack card's price, so never more than the shop charges), 1,500
for an Uncommon (under the 1,600 that three Commons and the fusion fee cost), 7,000 for a Rare, 14,000 for an Epic and
38,000 for a Legendary. Each sits a little above the market price it was set from, about 20 percent for the last
three, so an agent that is outbid once can still bid again. Settings shows today's market price under each limit, in
colour, so you can see whether it still fits. Raising them asks for your password.

**Never above the cost of building it.** A bid never goes above what the same card would cost to build yourself and
bring to its match gate (only a card at its gate can be listed), whatever the max bid. Building is the Common packs (a
pack is 2,500 for 5 Commons) and the fusion fees (100, 200, 400 and 800), plus the time it takes, priced the way
FoxLeague prices time: each competitive match a card needs to reach its gate at the price of a bought match of its
rarity (20 FOXSY for an Uncommon, 100 from a Rare up; 20 for a Common, which has none), and each of the 14 days a fused
card waits before it can be fused again at 75 FOXSY, the price of a day bought off. With these prices that is
about **14,450 FOXSY** for a Rare (9 Commons, four fusions and their matches), **60,400** for an Epic and **225,650**
for a Legendary, so your limits per rarity (above) usually bind first. The fusion route is slower still than the money
says: one fusion per wallet every 20 hours and two Common packs a week. An auction at a fair price under that cost often wins.

**Every level decides from numbers.** For each team on its challenge list (up to 10) it reads the ELO and the lineup
strength, ours at today's condition and theirs at full condition, and turns them into a win chance: the ELO expectation and the squad ratio, averaged, and never more than the two
starting elevens alone give. An eleven that is weaker than the rival's never reads as a favourite because the
rival's ELO is low (a new team starts low, and a team can lose on purpose), while a rival's higher ELO still lowers
the chance. The code holds it to
its rules whatever the AI decides: no 1v1 against a named team under 55 percent (an open challenge is topped at its own best XI OVR instead, so no stronger team can take it), no Champions FoxLeague where 24 of the invited teams are clearly stronger and no tournament where three seated teams are clearly
stronger. Each 1v1 records the chance it was taken at, so
the estimate can be checked against real results.

**No level ever** sends a card straight from one wallet to another or buys a paid badge. Buying at auction is not
such a transfer: one of your agents may buy a card another of yours listed, as any team may. Every level keeps your
agents' Fair Play: it never arranges a result with any team.

## The default limits of each level

The presets set the direction and your limits always win: an agent stops at its daily cap, its monthly budget,
its largest single payment and its counts, whatever its strategy says. So each level comes with its own limits, and **picking a
level in Settings proposes them**: each setting that does not fit the level yet gets a row with a tick, and
**Accept and save** saves the ticked ones (raising a limit or shortening the tick asks for your password). You can change any of them
afterwards. The dollar values are sized for a FOXSY price of about $0.0027; at a very different price, adjust them:

| Setting | Steady | Climber | Hunter | Predator | Beast | Zeus |
|---|---|---|---|---|---|---|
| Daily cap | $5 | $15 | $25 | $50 | $100 | $150 |
| Monthly budget | $150 | $250 | $400 | $750 | $2,000 | $3,000 |
| Top-up warning | $10 | $30 | $50 | $100 | $200 | $300 |
| Max entry fee or stake (FOXSY) | 1,500 | 5,000 | 7,500 | 10,000 | 20,000 | 25,000 |
| Max shop payment (FOXSY) | 500 | 2,000 | 2,500 | 3,000 | 9,000 | 9,000 |
| Max swap (FOXSY) | 10,000 | 10,000 | 10,000 | 20,000 | 40,000 | 50,000 |
| Max bid (FOXSY) | 500 | 1,500 | 7,000 | 14,000 | 14,000 | 38,000 |
| Paid training a day | 2 | 4 | 6 | 8 | 10 | 10 |
| Boosters a week | 0 | 1 | 2 | 3 | 7 | 7 |
| Packs a week | 0 | 0 | 1 | 2 | 2 | 2 |
| Medicine days a week | 0 | 2 | 4 | 6 | 12 | 18 |
| Silver amounts (FOXSY) | 1,000, 1,500 | + 2,000, 2,500 | + 3,000, 3,500 | + 4,000, 4,500 | + 4,999 | as beast |
| Gold amounts (FOXSY) | none (no Gold) | 5,000 | 5,000, 7,500 | up to 10,000 | up to 20,000 | up to 25,000 |
| Tick | 120 min | 120 min | 90 min | 90 min | 75 min | 60 min |
| Recommended AI | Opus 5.5, high | Opus 5.5, high | Opus 5.5, high | Opus 5.5, high | Opus 5.5, high | Opus 5.5, high |

The same for every level: the setup budget ($20), the EGLD gas reserve (1 EGLD), the Bronze amounts (100, 250 and 500), the active hours (08:00 to 20:00
UTC), a random shift of up to 10 minutes either way, actions at least 30 seconds apart.

A level with no Gold amounts stays out of Gold by the amount too: it pays no entry or stake from FoxLeague's Gold
minimum up (for example 5,000 FOXSY), whatever the tournament is called. At every level the agent joins only a
tournament of a tier it knows (Bronze, Silver or Gold).

How the limits are sized: the daily cap covers the largest entry the level allows (a climber's Gold entry of 5,000
FOXSY is about $13.50, a beast's of 20,000 about $54) and a busy day of its buying (entries, ranked tickets, syncs,
recovery, its paid sessions, booster and pack), the monthly budget is close to 30 days of typical play at that level,
and the top-up warning comes when about two days of play at the daily cap are left. The AI is one setting for every
agent; a level that plans twice as often costs about twice as much in AI calls.

A bid also needs a daily cap above its value, and each level's daily cap fits its max bid: a predator's 14,000 FOXSY
is about $38 of its $50, Zeus's 38,000 about $103 of its $150.

## Good to know

- An agent keeps the text and limits it has. Changing a preset here or in a later version does not change an agent's
  strategy until you pick the preset again. An agent saved before the counts existed plays on at FoxLeague's own
  maximum (10 paid sessions a day, a booster every day, 2 packs a week) until you pick a level or lower them. Medicine is the other way round: an agent saved before its count existed buys none until you pick a level again or set Medicine days a week.
- The levels describe what the AI aims for; the code still checks every action: the game's rules, your limits and
  counts, a 1v1 against a named team or one it joins only when that team is of similar strength, an open challenge
  only to teams no stronger by OVR, a waiver only when a fusion with that card can really happen.
- A level higher than your wallet can carry runs out of FOXSY sooner. The **Top-up warning** in Settings tells you
  when the wallet runs low.
