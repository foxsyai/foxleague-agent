---
title: Every setting explained
description: The strategy, spending limits, per-action maximums and timing of each agent.
---

Each agent has its own settings, on its page under **Settings**. Lowering a limit is one click; **raising** one (or
shrinking the gas reserve) asks for your password.

## Strategy

The direction the AI follows on every cycle, in plain words: what to aim for, what to avoid and how much risk to
take. Presets, from careful to all-in:

| Preset | What it does |
|---|---|
| **steady** | Grows XP and keeps the squad healthy, modest stakes |
| **climber** | Chases ELO: ranked matches, the strongest lineup, tournaments when fit |
| **hunter** | Goes for tournament wins and prize pools |
| **predator** | Hunter, plus paying to grow: all 15 training sessions a day, the XP booster on match days, recovery, both Common packs a week, fusions with real matches and the full 14-day cooldown (no fusion waivers) |
| **whale** | Every paid advantage, every day: the booster always on, all paid training, recovery, both packs, a fusion every 20 hours with both waivers, 3 competitive matches a day, Legendary players at fair auction prices; keeps at least 22 cards and sells spare ones above 36 |

Edit the text freely, or let [Talk to your manager](/use/talk-to-your-manager/) rewrite it for you. Your limits
always win: the strategy guides the choices, the code enforces the limits. Predator and whale spend far more than
the default limits allow (about 3,500 and 6,000 FOXSY a day on growth, plus entry fees), so raise that agent's
daily cap and monthly budget, or they stop at the limits. To buy a Legendary, a whale also needs a **Max bid** above
Legendary prices (from about 18,000 FOXSY) and a daily cap above that bid. No preset ever moves cards between wallets.

## Spending (USD)

| Setting | Default | What it does |
|---|---|---|
| Daily cap | $10 | The most this agent may spend in one game day (resets at 14:00 UTC), in USD at live prices. It counts FOXSY paid (entries, stakes, shop, sync) and network fees. A Gold entry of 5,000 FOXSY needs a daily cap above its USD value. It also limits the EGLD or WEGLD swapped to FOXSY in one game day (before the team exists: the larger of this and the setup budget). |
| Monthly budget | $300 | The most this agent may spend in a calendar month. Every action must fit both this and the daily cap. It also limits the EGLD swapped to FOXSY in a month. |
| Setup budget | $20 | A separate one-time budget for starting the team: the 5,000 FOXSY registration, the swap that buys it and its fee. It does not count against the daily or monthly caps. |
| EGLD gas reserve | 1 EGLD | EGLD that always stays in the wallet for network fees. A swap may only use the EGLD above it; WEGLD in the wallet has no reserve and is spent first when it covers the swap. 1 EGLD pays for well over a thousand ordinary transactions. The lowest allowed is 0.05. |
| Top-up warning | $10 | You are warned when what the wallet can play with (its EGLD, WEGLD and FOXSY, the EGLD gas reserve aside) is worth less than this: the value turns orange on the agent's page and one message goes to Telegram, the next one only after a top-up to well above it. Nothing is paused. 0 switches it off. |

## Per action (FOXSY)

| Setting | Default | What it does |
|---|---|---|
| Max entry fee or stake | 5,000 | The largest single tournament entry or 1v1 stake. Silver runs from 1,000 to 4,999 FOXSY and Gold starts at 5,000; below 5,000 the agent never enters Gold. |
| Max shop payment | 2,500 | The largest single shop payment: condition recovery (up to 100 per player), a training slot (20), the XP booster (2,000), a Common pack (2,500). The two fusion waivers use the same maximum. |
| Max swap | 10,000 | The largest single swap of EGLD (or WEGLD) to FOXSY on xExchange. The agent swaps only what its next actions need. |
| Max bid | 2,500 | The largest single bid on a marketplace auction. 0 turns bidding off. |
| Silver and Gold amounts | 1,000 to 3,000; 5,000 | The round entry fees the agent may choose when it creates a tournament or a 1v1, never odd numbers like 1,246. |

## Timing

| Setting | Default | What it does |
|---|---|---|
| Tick | 30 minutes | How often the agent plans. Shorter reacts faster and costs more in AI calls. |
| Random window | ±10 minutes | Each cycle starts a little earlier or later, at random, so the agent does not act like clockwork. |
| Active hours | 05:00 to 21:00 UTC | The agent plans only inside this window, in UTC; a plan still running at the end hour stops. Matches FoxLeague already scheduled are played as usual. The window may cross midnight. |
| Min gap between actions | 90 seconds | The shortest pause between two actions of one plan. |
| Action probability | 1 | The chance that each routine action really runs. 0.8 skips about one in five at random. Your own requests always run. |

Before each match session, the agent also plans about an hour before the lineup locks (inside its active hours), so
it can sync, set the lineup and recover condition in time.
