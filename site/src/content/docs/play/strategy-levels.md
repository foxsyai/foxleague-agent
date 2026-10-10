---
title: Strategy levels
description: The six strategy levels, five from careful to all-in and then Zeus, what each one does with your money and the limits to set for it.
---

The strategy is the direction the AI follows on every cycle. Six presets set it for you. The first five work like
the trim levels of a car: **each level does everything the level below does and adds more**, and what grows from
one level to the next is how much the agent pays to grow the squad. The sixth, **Zeus**, is different: it may do
everything a beast does, but only what pays, and it aims every move at No. 1 on the leaderboard.

Pick one in **Settings → Strategy** or on Telegram (`/strategy 2 hunter`). In the dashboard, picking a level opens
a short proposal: the settings that fall short of the level's recommendation, each with a tick, and its recommended
AI. **Accept and save** takes the ticked ones; **Cancel** keeps everything as it is saved. You can edit the text
afterwards or write your own. [Every setting explained](/use/settings/) covers the field itself.

## The six levels

| Level | Adds on top of the level below | Typical spend a day |
|---|---|---|
| **1. Steady** | The free game used fully: the 5 free training sessions, lineup and formation, the 5 daily matches, sync before match days, the free team badge. Silver tournaments and 1v1s at your lowest amounts. No shop purchases, no bids | Entries and sync: a few hundred FOXSY |
| **2. Climber** | The push for ELO: ranked matches whenever allowed, Gold tournaments when the squad can compete, 1v1s at any of your amounts, condition recovery for key starters before a match that matters | Plus Gold entries (5,000 FOXSY) and some recovery |
| **3. Hunter** | Tournaments and the first purchases: creates its own tournaments, the XP booster on days with 3 sure competitive matches, paid training slots while it runs, a fusion when three spare cards are ready, **bids at auction** (see below) | Plus about 2,000 FOXSY on booster days, and bids |
| **4. Predator** | Pays for everything that grows the squad **except waivers**: all 15 training sessions every day, the booster on every match day, recovery whenever it helps, both Common packs a week, a fusion whenever a triplet is ready (real matches, full 14-day cooldown), a higher max bid | About 3,500 FOXSY, plus entries and bids |
| **5. Beast** | Every paid advantage: the booster always on, **both fusion waivers** so a fusion can happen every 20 hours, 3 competitive matches a day, the highest max bid; keeps 22 to 36 cards and sells the spare ones above 36 | About 6,000 FOXSY, plus entries and bids |
| **6. Zeus** | Not more spending, better decisions: a **win chance** for every team it could face, 1v1s only from 55 percent against active teams that accept them, tournaments only with a real chance of the top three, its own tournaments including **private** ones that invite active teams it should beat, training on the stats each role needs, syncs and recovery only before matches that count, a player bought only at a good price and for a reason that pays. It climbs in steps, from the teams it beats to stronger ones | As little as winning needs, up to its limits |

On average about 90 percent of all entry fees come back as prizes, so entries are mostly a stake that returns,
not a cost. The shop, the waivers and the bids are real spending.

## Every action, level by level

| Action | Steady | Climber | Hunter | Predator | Beast | Zeus |
|---|---|---|---|---|---| --- |
| 5 free training sessions a day | ✓ | ✓ | ✓ | ✓ | ✓ | on the stats each role needs |
| Lineup, formation, the 5 daily matches | ✓ | ✓ | ✓ | ✓ | ✓ | ✓, set against each opponent |
| Ranked matches whenever allowed | | ✓ | ✓ | ✓ | ✓ | ✓ while the squad is fit |
| Sync before match days | ✓ | ✓ | ✓ | ✓ | ✓ | only when it changes a match |
| Free team badge | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Silver tournaments and 1v1s, lowest amounts | ✓ | ✓ | ✓ | ✓ | ✓ | when the win chance is good |
| Gold tournaments, 1v1s at any amount | | ✓ | ✓ | ✓ | ✓ | with a real chance of the top three |
| Creates its own tournaments | | | ✓ | ✓ | ✓ | ✓, also private ones |
| 3 competitive matches every day | | | | | ✓ | when they pay |
| Condition recovery | | key starters, key matches | key starters, key matches | whenever it helps | whenever it helps | key starters, matches that count |
| XP booster (2,000 FOXSY, 24 hours) | | | days with 3 sure matches | every match day | always on | days with 3 sure matches |
| Paid training slots (10 a day, 20 FOXSY) | | | while the booster runs | all 10, every day | all 10, every day | when they beat other uses |
| Common packs (2 a week, 2,500 FOXSY) | | | | ✓ | ✓ | when they pay |
| Fusion | | | spare triplets | whenever ready | every 20 hours | toward Legendary, when it pays |
| Fusion match waiver (20 FOXSY a match) | | | | | ✓ | when the time it wins counts |
| Fusion cooldown waiver (75 FOXSY a day) | | | | | ✓ | when the time it wins counts |
| Bids at auction: Rare, Epic, Legendary | | | ✓ | ✓ | ✓ | only at a good price, for a reason |
| Default max bid (FOXSY) | | | 4,000 | 15,000 | 40,000 | 47,000 |
| Sells spare cards (above 36 cards) | | | | | ✓ | when the price beats the use |

**Bids.** From the hunter up, an agent bids on Rare, Epic and Legendary players, never on Common or Uncommon
ones: two Common packs give 10 Commons, which fuse into three Uncommons and then a Rare, so those cost less from the
shop than at auction. Your **Max bid** decides which rarities are in reach. With the values above, a hunter reaches
Rares, a predator Rares and most Epics, a beast all three. Raise a hunter's max bid and it can take a fairly priced
Epic too.

**Never above the cost of building it.** A bid never goes above what the same card would cost from Common packs and
fusion fees, whatever the max bid: a Rare is 9 Commons (two packs) and four fusions, about **5,000 FOXSY**; an Epic
27 Commons, about **15,400**; a Legendary 81 Commons, about **47,000**, at October 2026 prices (a pack is 2,500 for 5
Commons; the fusion fees are 100, 200, 400 and 800). The fusion route is also slower: one fusion per wallet every 20
hours, 14 days before a fused card can be fused again (3 with the cooldown waiver) and 20 competitive matches per
input, so an auction at a fair price under that cost often wins.

**Zeus decides from numbers.** For every team it could face it reads the ELO and the lineup strength at today's
condition and turns them into a win chance (the ELO expectation and the squad ratio, averaged). The code holds it to
its rules whatever the AI decides: no 1v1 under 55 percent, no tournament where three seated teams are clearly
stronger, and a private tournament never invites your other agents. Each 1v1 records the chance it was taken at, so
the estimate can be checked against real results.

**No level ever** moves cards between wallets or buys a paid badge. Every level keeps your agents' Fair Play: it
never arranges a result with any team.

## The default limits of each level

The presets set the direction and your limits always win: an agent stops at its daily cap, its monthly budget and
its largest single payment, whatever its strategy says. So each level comes with its own limits, and **picking a
level in Settings fills them** in the form; check them and press Save (raising a limit asks for your password). You
can change any of them afterwards. Values at a FOXSY price of about $0.0027 (October 2026):

| Setting | Steady | Climber | Hunter | Predator | Beast | Zeus |
|---|---|---|---|---|---|---|
| Daily cap | $5 | $15 | $25 | $35 | $100 | $150 |
| Monthly budget | $150 | $250 | $400 | $750 | $2,000 | $3,000 |
| Top-up warning | $10 | $30 | $50 | $70 | $200 | $300 |
| Max entry fee or stake (FOXSY) | 1,500 | 5,000 | 7,500 | 10,000 | 20,000 | 25,000 |
| Max shop payment (FOXSY) | 500 | 1,000 | 2,500 | 2,500 | 3,000 | 5,000 |
| Max swap (FOXSY) | 10,000 | 10,000 | 10,000 | 20,000 | 40,000 | 50,000 |
| Max bid (FOXSY) | 0 (off) | 0 (off) | 4,000 | 15,000 | 40,000 | 47,000 |
| Silver amounts (FOXSY) | 1,000, 1,500 | + 2,000, 2,500 | + 3,000, 3,500 | + 4,000, 4,500 | + 4,999 | as beast |
| Gold amounts (FOXSY) | none (no Gold) | 5,000 | 5,000, 7,500 | up to 10,000 | up to 20,000 | up to 25,000 |
| Tick | 120 min | 120 min | 120 min | 120 min | 120 min | 60 min |
| Recommended AI | Sonnet 5, medium | Sonnet 5, medium | Sonnet 5.5, high | Opus 5.5, medium | Opus 5.5, high | Opus 5.5, high |

The same for every level: the setup budget ($20), the EGLD gas reserve (1 EGLD), the active hours (08:00 to 20:00
UTC), a random window of 10 minutes, actions at least 30 seconds apart.

The limits come from what agents spent per game day at each level in October 2026. The daily cap covers the
largest entry the level allows (a climber's Gold entry of 5,000 FOXSY is about $13.50, a beast's of 20,000 about
$54), the monthly budget is close to 30 days of real use, and the top-up warning comes when about two days of play
at the daily cap are left.

At auction a Rare started at about 2,300 FOXSY, an Epic at about 10,000 and a Legendary at about 18,000 (October
2026). A bid also needs a daily cap above its value.

## Good to know

- An agent keeps the text it has. Changing a preset here or in a later version does not change an agent's strategy
  until you pick the preset again.
- The levels describe what the AI aims for; the code still checks every action: the game's rules, your limits, a
  1v1 only against a team of similar strength, a waiver only when a fusion with that card can really happen.
- A level higher than your wallet can carry runs out of FOXSY sooner. The **Top-up warning** in Settings tells you
  when the wallet runs low.
