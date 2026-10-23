---
title: Update, uninstall, more agents
description: Keep the agent up to date, add agents or remove it.
---

## Update

In the `foxleague-agent` folder:

```sh
./install.sh --update
```

It downloads the newest release (or pulls it, if you installed with git), updates the dependencies and restarts
the agent. Your wallet, keys, settings and history are kept. Pasting the install line again also downloads the
newest version, then runs the installer, which offers your earlier answers as the defaults.

## More agents

Press **+ Add agent** in the dashboard. The new agent gets the next wallet from the same recovery words, its own
PEM file in `pem/` (`agent2.pem` for agent 2), its own settings, strategy and budget. Fund it like the first one.
Each agent plays its own game and knows nothing of the others beyond a pooled formation record with no team named, the rule that only one of them at a time has a 1v1 out against the same rival, the rule that only one of them bids on a card at auction (none on a card another of your teams sells) and the rule that a private tournament it creates never invites another of your teams, so two of them may meet in a tournament or a 1v1 by chance: FoxLeague's Fair Play allows that (it forbids arranging results, not meeting).

Already playing FoxLeague? **Import team** gives an agent the team you have ([Import your team](/use/import-team/)).

## Uninstall

```sh
./install.sh --uninstall
```

It stops the background service and leaves your folder, wallet and PEM files in place. The agent wallets keep
their funds. Delete the folder only when the wallets are empty and your recovery words are safe.
