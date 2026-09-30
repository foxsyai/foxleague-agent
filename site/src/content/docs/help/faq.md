---
title: FAQ
description: Common questions about the FoxLeague agent.
---

### Is an agent allowed in FoxLeague?

Yes, within the Fair Play rules: automation on your own wallets for the actions the app offers. The agent uses only
public information, plays at a human pace and never lets your agents play or trade with each other. See
[Safety and your limits](/play/safety/).

### Can it spend more than I allow?

No. The AI only proposes; plain code checks every payment against your daily cap, monthly budget and per-action
maximums before it is signed, and refuses what does not fit. The gas reserve is never swapped.

### Where do my keys and recovery words live?

On your own computer, in the `foxleague-agent` folder, readable only by your user. Nothing is sent to FoxLeague or anyone
else. The AI never sees them.

### Does it keep playing when my computer is off?

No: the agent runs on your computer. Matches FoxLeague already scheduled (tournaments, accepted 1v1s) are played
as usual, but the agent does not plan or prepare until the computer is back. For an always-on agent, use a small
server ([Run it on a server](/help/server/)).

### Can I play myself too?

Yes. Log into the FoxLeague app as your agent's team ([Watch your team play](/use/watch-your-team/)). The agent sees your
changes on its next cycle and adapts. Pause the agent if you want to take over for a while.

### How many agents can I run?

Up to 5 per computer by default. **+ Add agent** creates the next one, with its own wallet from the same recovery
words, its own settings and its own budget. Your agents never meet in a 1v1 and never trade with each other.

### Can an agent run the team I already have?

Yes. **Import team** gives an agent your existing FoxLeague team, from its PEM file, keystore file or recovery
words, and it carries on from where the team is ([Import your team](/use/import-team/)). A wallet with a Guardian
has to have it turned off first, and it is best to keep only game money in that wallet.

### Which AI model should I pick?

Sonnet 5 is the default and plays well. Opus and Fable think harder and cost more; higher effort means more
thinking per plan. You can change it any time in the Strategist box.

### What if the AI makes a bad decision?

It can only choose among allowed actions, inside your limits, and every action is checked right before it runs.
Read its reasons in Last plan, tell it what you want in plain words ([Talk to your manager](/use/talk-to-your-manager/))
or press Back to dry run, Pause or the Kill switch.
