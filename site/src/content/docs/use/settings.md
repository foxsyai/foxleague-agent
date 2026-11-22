---
title: Every setting explained
description: The strategy, spending limits, per-action maximums and timing of each agent.
---

Each agent has its own settings, on its page under **Settings**. Lowering a limit is one click. Raising one asks
for your password, and so do a higher count (paid training, boosters or packs), a smaller gas reserve, Gold amounts
where there were none, a shorter tick and longer active hours. So do a dearer AI model and a higher effort for the
agent.

## Strategy

The direction the AI follows on every cycle, in plain words: what to aim for, what to avoid and how much risk to
take. Six presets set it for you: **steady**, **climber**, **hunter**, **predator**, **beast** and **Zeus**. Every
level plays with the same brain (it weighs every action against its cost and plays only what pays, aiming at No. 1 on
the leaderboard); what grows from one level to the next is the money it may spend and how often it plans.
[Strategy levels](/play/strategy-levels/) shows what each level may buy and the limits to set for each. Edit the
text freely, or let [Talk to your manager](/use/talk-to-your-manager/) rewrite it for you. Your limits always win:
the strategy guides the choices, the code enforces the limits.

**Picking a level opens a proposal** with its default limits: each setting that does not fit the level yet (the daily
cap, the monthly budget, the top-up warning, the max entry fee or stake, the max shop payment, the max swap, the max
bid, the Silver and Gold amounts, the paid training a day, the boosters and packs a week, the medicine days a week or the tick; your limits per rarity stay as they are) gets a row with a tick, and the level's recommended AI is offered apart. **Accept and save** saves the ticked ones; untick a
row to keep your own value, and **Cancel** keeps everything as it is saved. Raising a limit or switching to a dearer
AI asks for your password. The defaults below are the steady level's, the one every new agent starts with;
[Strategy levels](/play/strategy-levels/#the-default-limits-of-each-level) lists every level's.

## AI

| Setting | Default | What it does |
|---|---|---|
| AI model | Same as all agents | The Claude model that plans for this agent. Same as all agents follows the Strategist box at the top of the dashboard. Pick one of the four models (each shown with its list price per million tokens) to give this agent its own: a later switch in the Strategist box does not move it. A dearer model asks for your password; a cheaper one is one click. Going back to Same as all agents counts by the model it lands on. |
| Effort | Same as all agents | How hard the AI thinks on each plan of this agent: low, medium, high, xhigh or max. More effort thinks longer and costs more. A higher effort asks for your password; a lower one is one click. While no effort has been picked in the Strategist box (a new install), an agent with a model of its own plays at medium: the default's high comes only with the default model. |

The line under the two fields says what the agent plays now and what it would play after saving. A change that
starts shadow plans set on the server for this agent asks for your password too
([What it costs](/help/costs/#comparing-a-second-model-before-you-switch)). The manager chat and `/ask` use the
model of the Strategist box.

## Spending (USD)

| Setting | Default | What it does |
|---|---|---|
| Daily cap | $5 | The most this agent may spend in one game day (resets at 14:00 UTC), in USD at live prices. It counts FOXSY paid (entries, stakes, shop, sync) and network fees. A Gold entry of 5,000 FOXSY needs a daily cap above its USD value. It also limits the EGLD or WEGLD swapped to FOXSY in one game day (before the team exists: the larger of this and the setup budget). |
| Monthly budget | $150 | The most this agent may spend in a calendar month (UTC): it starts again on the 1st at 00:00 UTC. In the month you start, the whole budget is there for the days left in it; the daily cap still limits each day. Every action must fit both this and the daily cap. It also limits the EGLD swapped to FOXSY in a month. |
| Setup budget | $20 | A separate one-time budget for starting the team: the 5,000 FOXSY registration, the swap that buys it and its fee. It does not count against the daily or monthly caps. |
| EGLD gas reserve | 1 EGLD | EGLD that always stays in the wallet for network fees. A swap may only use the EGLD above it; WEGLD in the wallet has no reserve and is spent first when it covers the swap. 1 EGLD pays for well over a thousand ordinary transactions. The lowest allowed is 0.05. |
| Top-up warning | $10 | You are warned when what the wallet can play with (its EGLD, WEGLD and FOXSY, the EGLD gas reserve aside) is worth less than this: the value turns orange on the agent's page and it shows in the morning summary on Telegram (with a Binance key, Telegram and the platform LIVE, a top-up proposal comes at once (once a day per agent)), again only after a top-up to well above it. Nothing is paused. The default of each level is about two days of play at its daily cap. 0 switches it off. |

## Per action (FOXSY)

| Setting | Default | What it does |
|---|---|---|
| Max entry fee or stake | 1,500 | The largest single tournament entry or 1v1 stake. Silver runs from 1,000 to 4,999 FOXSY and Gold starts at 5,000; below 5,000 the agent never enters Gold. |
| Max shop payment | 500 | The largest single shop payment: condition recovery (up to 100 per player), a training slot (20), the XP booster (2,000), a Common pack (2,500), a fusion fee (100 to 800) and medicine for an injured player (one payment for the days it saves: 100 FOXSY a day for a Common up to 500 for a Legendary). The two fusion waivers use the same maximum: a fusion match waiver costs 20 FOXSY a match for an Uncommon and 100 for a Rare or an Epic (a Rare's 30 waivable matches are 3,000), a cooldown waiver 75 FOXSY a day. A Legendary's match waiver (100 FOXSY a match) is bought only for its listing gate, for a spare the agent would sell. It also caps the ranked ticket a ranked start pays and the calendar deposit a tournament the agent creates owes (so many FOXSY per scheduled game, counted on its maximum number of teams: a knockout of 16 owes 15 games, a round robin of 8 owes 28). A tournament that owes more than this is not created; a smaller one owes less. |
| Max swap | 10,000 | The largest single swap of EGLD (or WEGLD) to FOXSY on xExchange. The agent swaps only what its next actions need. |
| Max bid | 500 | The largest single bid on a marketplace auction, on a card of any rarity (each level's default reaches the price of a rarity: 500 a Common at steady, up to 38,000 a Legendary at Zeus). 0 turns bidding off. Whatever it says, a bid never goes above what the card would cost to build yourself and bring to its match gate: the Common packs, the fusion fees and the time, each match and each day of waiting at FoxLeague's own price for skipping it (about 14,450 FOXSY for a Rare, 60,400 for an Epic, 225,650 for a Legendary). The limits per rarity below usually bind first. |
| Max bid for a Common | 500 | The most the agent may bid for a Common card, under the max bid. The default is what a card from a Common pack costs (2,500 FOXSY for 5 cards) and the lowest price a card can be listed at, so the agent never pays more for a Common than the shop would charge; a Common at auction has already played its 5 matches and has a known position. 0 turns bids on Commons off. The coloured market line under the field works as for a Rare (below). Raising it asks for your password. |
| Max bid for an Uncommon | 1,500 | The most the agent may bid for an Uncommon card, under the max bid. The default is about a third above the Uncommon's market price when it was set and under what building one costs: 3 Commons and the 100 FOXSY fusion fee, then its 15 matches. The market line works as for a Rare (below). Raising it asks for your password. |
| Max bid for a Rare | 7,000 | The most the agent may bid for a Rare card, under the max bid. The default is about 20 percent above the Rare's market price when it was set (the median of what Rares sold for each trading day, so one day of cheap sales counts once): room to bid once more after being outbid, since the agent bids at most twice on one auction. The agent is shown today's market price and aims below it. Under the field, today's market price is shown in colour: green when your limit is in range (90 to 150 percent of it), amber when it is under the market (the agent may miss most sales), red when it is far above (the agent may pay too much), with a button that fills in the market price, rounded. The line judges whichever limit binds: with a Max bid of 0 (bidding off) every line with a known market price is amber and reads "Bids are off: Max bid is 0" (a rarity with too few sales keeps its grey line); with a Max bid under this limit the colour follows the Max bid and the line names it, for example "Max bid (4,000) is the limit here", with no button when the line is amber, since raising this field would not help (when it is red, the button still lowers this field). Raising it asks for your password. |
| Max bid for an Epic | 14,000 | The same for an Epic card. |
| Max bid for a Legendary | 38,000 | The same for a Legendary card. With a max bid under it, the max bid is the limit. |
| Silver and Gold amounts | 1,000 and 1,500; none | The round entry fees the agent may choose when it creates a tournament or a 1v1, never odd numbers like 1,246. Each level up to the predator adds two Silver steps; the beast and Zeus add the 4,999 ceiling. No Gold amounts (the steady default) keep the agent out of Gold altogether: it never creates or joins a Gold tournament or 1v1. |
| Paid training a day | 2 | How many paid training sessions (20 FOXSY each, on top of the 5 free ones) the agent may use in one game day; FoxLeague allows 10. Sessions it already holds count, so it never buys more than this. The defaults grow with the level: 2, 4, 6, 8, then 10 for beast and Zeus. |
| Boosters a week | 0 | How many XP boosters (2,000 FOXSY, double XP for 24 hours) the agent may buy in any 7 days, counted from its own purchases; 7 is one every day, 0 none. It still buys one only once a competitive match of its own is drawn within the 24 hours, and weighs whether the day's matches make it pay (about 3 sure ones). The defaults: none at steady, then 1, 2 and 3; every day for beast and Zeus. |
| Packs a week | 0 | How many Common packs (2,500 FOXSY for 5 Common cards) the agent may buy in any 7 days, counted from its own purchases; FoxLeague allows 2 a wallet a week. The defaults: none at steady and climber, 1 at hunter, 2 from predator up. |
| Medicine days a week | 0 | How many days of injury medicine the agent may buy in any 7 days, over all its players, counted from its own purchases. Medicine shortens an injury by whole days (100 FOXSY a day for a Common up to 500 for a Legendary); FoxLeague always keeps a third of the injury, so the most it sells is 2 days of a 3-day injury, 6 of 9 and 18 of 27. Each payment also stays within Max shop payment. The defaults: none at steady, then 2, 4, 6, 12 at beast and 18 at Zeus. An agent saved before this field existed has 0 until you set it. |
| Bronze amounts | 100, 250 and 500 | The round entry fees the agent may choose when it creates a Bronze tournament, between 100 and 999 FOXSY, once FoxLeague's competition levels are live (before them it creates none: a Bronze earns nothing until then). Leave it empty and it creates none; it can still join one, within Max entry or stake. |

## Timing

| Setting | Default | What it does |
|---|---|---|
| Tick | 120 minutes | How often the agent plans. The defaults: 120 minutes at steady and climber, 90 at hunter and predator, 75 at beast and 60 at Zeus; at 120 the daily trainings, matches and entries fit in 6 to 8 plans a day, and a planning cycle also runs about an hour before each match session locks (matches whose locks fall within 2 hours of each other share it). Shorter reacts faster and makes more AI calls ([Costs](/help/costs/) says what a plan costs). The shortest allowed is 10 minutes. After a plan with nothing to do the next plan comes after twice the tick (with the random window), and so on after each plan with nothing to do, until a plan acts or the 14:00 UTC game-day reset: the first plan after the reset and any plan after one that acted come at the normal tick, so the quiet hours before the reset cost half the model calls. A shorter tick counts from the save: the next plan comes within one new tick. |
| Random window | 10 | Each cycle starts up to this many minutes earlier or later, at random, so the agent does not act like clockwork. It can never bring a cycle under 10 minutes: with a 30-minute tick it may be up to 20. |
| Active hours | 08:00 to 20:00 UTC | The agent plans only inside this window, in UTC: 12 hours around the 14:00 UTC game-day reset. A plan still running at the end hour stops. Matches FoxLeague already scheduled are played as usual. The window may cross midnight; from 0 until 24 runs all day. |

Two things are fixed: the actions of a plan run at least 30 seconds apart, and every planned action is carried out (a match that its cooldown pushes past the plan's window waits for the next plan; a plan keeps at most 12 actions). The plan's matches start 16 minutes apart, the first ones earlier when that leaves the later ones room in the window.

The actions run in the plan's order at random moments over the next 80 percent of the tick. An action with a deadline (joining or leaving before registration closes, widening a range or bidding before the auction ends) runs at least 5 minutes before it, and the actions listed before it run earlier with it; only a match listed before it, waiting for its gate, can still hold it back. When the deadline is that close already, or cannot be read, it runs at once, right after the actions listed before it. A training or a match the game day has no room for (the free sessions or the day's matches used up) waits until 2 minutes after the daily reset at 14:00 UTC; one whose plan ends before then is left to the next plan. Two actions run at the start of the plan because another team could make them pointless at any moment: leaving the agent's own 1v1 that nobody has taken yet runs first of all, and taking another team's open 1v1 (it goes to whoever takes it first) runs at once, right after the actions listed before it.

Before each match session, the agent also plans about an hour before the lineup locks (inside its active hours), so
it can sync, set the lineup and recover condition in time.
