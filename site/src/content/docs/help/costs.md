---
title: What it costs
description: The game, the AI and the network fees.
---

The agent itself is free. Three things cost money, and you control each one:

| What | How much | Who limits it |
|---|---|---|
| **The game** (entries, stakes, shop, sync, bids) | Never more than your limits: by default $5 a day and $150 a month, plus $20 once for the registration. | Your daily cap, monthly budget and per-action maximums, enforced in code. |
| **The AI** (every plan and chat) | About $1.50 a day for a single agent with the default model, effort and tick (Sonnet 5.5 at medium, a plan every 2 hours inside 12 active hours, about $0.25 a plan): every plan sends the rules and the game manual, about 105,000 tokens, and they are cached for an hour only when another plan comes within that hour, so a lone agent sends them at the plain price. Agents that plan within the same hour share the cache and pay far less for that text: measured on real plans, ten agents on Opus 5.5 at high effort averaged $0.15 a plan with the manual from the cache and $0.60 without. Opus, Fable and a higher effort cost more for the same plan, and a shorter tick means more plans a day. After a start of the service the first agent of each model and effort plans at once and the others of that pair 3 to 6 minutes later, so they read the cache it wrote instead of each writing it again. With shadow plans on, the models and efforts of the shadow plans count too, so two agents that share a shadow model do not both write its cache. | The monthly spend limit you set at Anthropic, plus the model and effort in the dashboard for all agents; each agent can also have its own model and effort. |
| **Network fees** | A few cents a day. | Paid from the EGLD gas reserve, which swaps never touch. |

## Comparing a second model before you switch

Before you move the strategist to another AI model, you can let that model plan in the shadow: after each real plan
the same request goes to the second model too. What it would have done is only recorded, next to the real plan.
A shadow plan never plays: nothing of it is carried out and the playing model never reads it. Each one costs what
one plan costs on the second model, on top of the real plan. It shows in the dashboard's AI spend. You can try
several models this way at the same time: each one plans by itself and each adds its own cost per plan. The model
that plays can also plan in the shadow at another effort, to see what more or less thinking would change. The model
that plays can also plan once more in the shadow at its own effort, to see how much its plans differ from one request
to the very same request. Shadow plans can be set for one agent only. It is off
unless you switch it on yourself on the computer that runs the agent: the server guide in the repository
(`docs/SERVER.md`) says how to do it and how to read the comparison (`shadow-report`).

## To start

About **5 EGLD**: 2.5 buys the 5,000 FOXSY registration, 1 stays in the wallet as the gas reserve, the rest plays
the first games. After that, top up as the agent plays: by hand, or from Binance with top-ups you approve on Telegram
([Your keys](/start/keys/#3-cex-top-up-optional)). Each agent's page shows what its wallet is worth, and you are warned there,
in the morning summary on Telegram (at once with `/updates all`) and, with a Binance key, Telegram and the platform
LIVE, a top-up proposal comes at once (once a day per agent), when it falls under your **Top-up warning** ($10 unless you change it). Send EGLD, the agent buys
FOXSY with it by itself; FOXSY and WEGLD work too. When a swap fits in the wallet's WEGLD, the agent spends that
first, all of it if needed: WEGLD pays no network fees, so none of it is kept as a reserve.

## What you get back

Tournament and 1v1 prizes go straight to the agent's wallet. The agent plays with them. Entries that come back
(a tournament that did not fill, an expired challenge) stop counting against your budget.
