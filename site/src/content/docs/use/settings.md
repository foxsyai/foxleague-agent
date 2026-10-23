---
title: Every setting explained
description: The strategy, spending limits, per-action maximums and timing of each agent.
---

Each agent has its own settings, on its page under **Settings**. Lowering a limit is one click; **raising** one (or
shrinking the gas reserve) asks for your password.

## Strategy

The direction the AI follows on every cycle, in plain words: what to aim for, what to avoid and how much risk to
take. Six presets set it for you. The first five go from careful to all-in: **steady**, **climber**, **hunter**,
**predator** and **beast**. Each of them does everything the level below does and adds more spending to grow the
squad. The sixth, **Zeus**, may do everything a beast does but only what pays, aiming at No. 1 on the leaderboard.
[Strategy levels](/play/strategy-levels/) lists every action level by level and the limits to set for each. Edit the
text freely, or let [Talk to your manager](/use/talk-to-your-manager/) rewrite it for you. Your limits always win:
the strategy guides the choices, the code enforces the limits.

**Picking a level opens a proposal** with its default limits: each setting that does not fit the level yet (the daily
cap, the monthly budget, the top-up warning, the per-action maximums, the Silver and Gold amounts or the tick) gets a
row with a tick, and the level's recommended AI is offered apart. **Accept and save** saves the ticked ones; untick a
row to keep your own value, and **Cancel** keeps everything as it is saved. Raising a limit or switching to a dearer
AI asks for your password. The defaults below are the steady level's, the one every new agent starts with;
[Strategy levels](/play/strategy-levels/#the-default-limits-of-each-level) lists every level's.

## Spending (USD)

| Setting | Default | What it does |
|---|---|---|
| Daily cap | $5 | The most this agent may spend in one game day (resets at 14:00 UTC), in USD at live prices. It counts FOXSY paid (entries, stakes, shop, sync) and network fees. A Gold entry of 5,000 FOXSY needs a daily cap above its USD value. It also limits the EGLD or WEGLD swapped to FOXSY in one game day (before the team exists: the larger of this and the setup budget). |
| Monthly budget | $150 | The most this agent may spend in a calendar month. Every action must fit both this and the daily cap. It also limits the EGLD swapped to FOXSY in a month. |
| Setup budget | $20 | A separate one-time budget for starting the team: the 5,000 FOXSY registration, the swap that buys it and its fee. It does not count against the daily or monthly caps. |
| EGLD gas reserve | 1 EGLD | EGLD that always stays in the wallet for network fees. A swap may only use the EGLD above it; WEGLD in the wallet has no reserve and is spent first when it covers the swap. 1 EGLD pays for well over a thousand ordinary transactions. The lowest allowed is 0.05. |
| Top-up warning | $10 | You are warned when what the wallet can play with (its EGLD, WEGLD and FOXSY, the EGLD gas reserve aside) is worth less than this: the value turns orange on the agent's page and it shows in the morning summary on Telegram (with a Binance key, a top-up proposal comes at once), again only after a top-up to well above it. Nothing is paused. The default of each level is about two days of play at its daily cap. 0 switches it off. |

## Per action (FOXSY)

| Setting | Default | What it does |
|---|---|---|
| Max entry fee or stake | 1,500 | The largest single tournament entry or 1v1 stake. Silver runs from 1,000 to 4,999 FOXSY and Gold starts at 5,000; below 5,000 the agent never enters Gold. |
| Max shop payment | 500 | The largest single shop payment: condition recovery (up to 100 per player), a training slot (20), the XP booster (2,000), a Common pack (2,500). The two fusion waivers use the same maximum: a fusion match waiver costs 20 FOXSY a match for an Uncommon and 100 for a Rare or an Epic (a Rare's 30 waivable matches are 3,000), a cooldown waiver 75 FOXSY a day. |
| Max swap | 10,000 | The largest single swap of EGLD (or WEGLD) to FOXSY on xExchange. The agent swaps only what its next actions need. |
| Max bid | 0 (off) | The largest single bid on a marketplace auction. 0 turns bidding off. Whatever it says, a bid never goes above what the card would cost to build yourself and bring to its match gate: the Common packs, the fusion fees and the time, each match and each day of waiting at FoxLeague's own price for skipping it (about 14,450 FOXSY for a Rare, 60,400 for an Epic, 225,650 for a Legendary). The limits per rarity below usually bind first. |
| Max bid for a Rare | 6,000 | The most the agent may bid for a Rare card, under the max bid. The default is the round market price of October 2026: the median of what Rares sold for each trading day (so one day of cheap sales counts once). The agent is shown today's market price and aims below it. Under the field, today's market price is shown in colour: green when your limit is in range (90 to 150 percent of it), amber when it is under the market (the agent may miss most sales), red when it is far above (the agent may pay too much), with a button that fills in the market price, rounded. The line judges whichever limit binds: with a Max bid of 0 (the Steady and Climber default) all three lines are amber and read "Bids are off: Max bid is 0"; with a Max bid under this limit the colour follows the Max bid and the line names it, for example "Max bid (4,000) is the limit here", with no button, since raising this field would not help. Raising it asks for your password. |
| Max bid for an Epic | 12,000 | The same for an Epic card. |
| Max bid for a Legendary | 32,000 | The same for a Legendary card. With a max bid under it, the max bid is the limit. |
| Silver and Gold amounts | 1,000 and 1,500; none | The round entry fees the agent may choose when it creates a tournament or a 1v1, never odd numbers like 1,246. Each level adds two Silver steps, up to 4,999 for the beast. No Gold amounts (the steady default) keep the agent out of Gold altogether: it never creates or joins a Gold tournament or 1v1. |

## Timing

| Setting | Default | What it does |
|---|---|---|
| Tick | 120 minutes | How often the agent plans, every level: the daily trainings, matches and entries fit in 6 to 8 plans a day, and a match still gets its own planning cycle about an hour before it locks. Shorter reacts faster and costs more in AI calls. The shortest allowed is 10 minutes. A shorter tick counts from the save: the next plan comes within one new tick. |
| Random window | 10 | Each cycle starts up to this many minutes earlier or later, at random, so the agent does not act like clockwork. It can never bring a cycle under 10 minutes: with a 30-minute tick it may be up to 20. |
| Active hours | 08:00 to 20:00 UTC | The agent plans only inside this window, in UTC: 12 hours around the 14:00 UTC game-day reset. A plan still running at the end hour stops. Matches FoxLeague already scheduled are played as usual. The window may cross midnight; from 0 until 24 runs all day. |

Two things are fixed: the actions of a plan run at least 30 seconds apart, and every planned action is carried out.

Before each match session, the agent also plans about an hour before the lineup locks (inside its active hours), so
it can sync, set the lineup and recover condition in time.
