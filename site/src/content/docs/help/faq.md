---
title: FAQ
description: Common questions about the FoxLeague agent.
---

### Is an agent allowed in FoxLeague?

Yes, within the Fair Play rules: automation on your own wallets for the actions the app offers. The agent uses only
public information, plays at a human pace and never coordinates your agents against anyone: each plays its own game as if it were alone. What they share is a pooled formation record with no team named, a league formation table built from public matches and the results of their casual tests. See
[Safety and your limits](/play/safety/).

### Can it spend more than I allow?

No. The AI only proposes; plain code checks every payment against your daily cap, monthly budget and per-action
maximums before it is signed and refuses what does not fit. The gas reserve is never swapped.

### Where do my keys and recovery words live?

On your own computer, in the `foxleague-agent` folder, readable only by your user. Nothing is sent to FoxLeague or anyone
else. The AI never sees them.

### Is it open source?

Yes: the code is public on GitHub ([foxsyai/foxleague-agent](https://github.com/foxsyai/foxleague-agent)) under the Apache
License 2.0, copyright Foxsy AI. You can read every line before you run it, change it and share it under the
license's terms. The names FoxLeague and Foxsy and their logos are not covered by it.

### Does it keep playing when my computer is off?

No: the agent runs on your computer. Matches FoxLeague already scheduled (tournaments, accepted 1v1s) are played
as usual, but the agent does not plan or prepare until the computer is back. For an always-on agent, use a small
server ([Run it on a server](/help/server/)).

### How do I get a new version?

The dashboard and Telegram tell you when one is out; the round arrow next to the version in the dashboard
(**Check for updates**) asks at once. Press **Update now** in the dashboard or send `/upgrade` on Telegram: the agent installs it and
restarts. Nothing is ever installed by itself. Only a release signed by the maintainers and newer than yours
can be installed; a version that does not start is undone by itself ([Update](/help/update/)).

### Can I play myself too?

Yes. Log into the FoxLeague app as your agent's team ([Watch your team play](/use/watch-your-team/)). The agent sees your
changes on its next cycle and adapts. Pause the agent if you want to take over for a while.

### How many agents can I run?

Up to 5 active agents per computer by default. **+ Add agent** creates the next one, with its own wallet from the
same recovery words, its own settings and its own budget. An agent you no longer use can be retired: it leaves the
tabs, stops playing and frees its place; you can restore it later ([Retire and restore an
agent](/use/dashboard/#retire-and-restore-an-agent)). One that was never used, with an empty wallet and no team, can
be deleted ([Delete an agent](/use/dashboard/#delete-an-agent-that-was-never-used)). Each agent plays its own game as if it were alone and knows nothing of the others, so two of them may meet in a tournament or a 1v1, bid on the same card or buy a card from each other at auction, by chance: FoxLeague's Fair Play allows that (it forbids arranging results, not meeting). What they share is a pooled formation record with no team named, a league formation table built from public matches and the results of their casual tests.

### Can an agent run the team I already have?

Yes. **Import team** gives an agent your existing FoxLeague team, from its PEM file, keystore file or recovery
words; it carries on from where the team is ([Import your team](/use/import-team/)). A wallet with a Guardian
is refused: an agent cannot sign for it.

### Which wallet should an agent use?

A fresh wallet made only for FoxLeague, without a Guardian, holding only the amount you set aside for the game.
Keep small amounts in it and top it up daily, weekly or whenever it suits you. **+ Add agent** makes such a wallet.
We do not recommend giving an agent your personal wallet with your history and other assets, nor turning the
Guardian off there just for FoxLeague ([Which wallet to give an agent](/use/import-team/#which-wallet-to-give-an-agent)).

### Which AI model should I pick?

Haiku 5.5 at high effort is the default and plays well at the lowest cost. Sonnet 5.5 plans more carefully and acts
less; Opus 5.5 is the most active and costs the most of the three. Fable 5.2, the most capable, costs more still.
Higher effort means more thinking per plan. You can change it any time in the Strategist box; a dearer model or a
higher effort asks for your password.

### What if the AI makes a bad decision?

It can only choose among allowed actions, inside your limits; every action is checked right before it runs.
Read its reasons in Last plan, tell it what you want in plain words ([Talk to your manager](/use/talk-to-your-manager/))
or press Back to dry run, Pause or the Kill switch.

### Where do I report a problem or share an idea?

On GitHub: [choose a form](https://github.com/foxsyai/foxleague-agent/issues/new/choose) to report a problem or
suggest an idea. Issues are public, so never paste recovery words, keys, PEM or keystore files, the `.env` or a
password. Questions and a chat with other coaches: the [Foxsy AI community on Telegram](https://t.me/foxsyai).
A security hole goes to a private report, never to a public issue: see
[SECURITY.md](https://github.com/foxsyai/foxleague-agent/blob/main/SECURITY.md).
