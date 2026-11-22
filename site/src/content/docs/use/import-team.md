---
title: Import your team
description: Give an agent the FoxLeague team you already play, so it carries on from where the team is.
---

Already playing FoxLeague? An agent can take over your team and carry on from where it is: the same players,
rating, record and badge. There is no new wallet and no new registration.

![Import your team: a PEM file, a keystore file or recovery words](/screenshots/import-team.png)

## How to import

1. In the dashboard, press **Import team**, next to **+ Add agent**.
2. Choose how you give the team's wallet:
   - **PEM file**: the file you log into the FoxLeague app with.
   - **Keystore file**: the `.json` file from the MultiversX web wallet, with its password.
   - **Recovery words**: the words of that wallet, plus the account number (0 is the first account of the
     words).

   Not sure which account holds your team? Press **Find my team** (with recovery words or a keystore file made
   from them). The dashboard lists the first 20 accounts of the words, each with its address and the team its
   wallet plays, the way a wallet lists its accounts. Press **Use this one** beside your team: its number is filled
   in and the check runs. **Show the next 20** goes further, up to account 999. It only reads FoxLeague's public
   profiles: no login, no transaction and nothing stored. FoxLeague sees the 20 addresses asked together, from your
   address: if that matters to you, type the account number instead.
3. Press **Check**. The dashboard shows the team it found, the wallet address and what the wallet holds. Nothing
   is stored yet.
4. If it is your team, type your dashboard password and press **Import team**.

![The check: the team, its wallet and its balances](/screenshots/import-team-check.png)

The team becomes your next agent, for example **Agent 2**, marked **imported** in its tab. It starts **paused**:
set its limits and strategy on its page, then press **Resume**. From then on it plays like any other agent, under
the same checks, limits and Fair Play rules.

## What is kept and where

Only the key of that one wallet is kept, in a file readable only by you (on a server, only by the agent's service)
in the agent's data folder. That is the same protection as your install's own recovery words. Recovery words you
give are used once to find the account and are never stored.

Prefer the PEM or keystore file when you have one: recovery words open every account made from them, a key file
only the one. The dashboard is your own program, on your computer or your own server, so nothing goes to anyone
else.

The import refuses:

- a wallet with a Guardian switched on (see [Which wallet to give an agent](#which-wallet-to-give-an-agent));
- a wallet with no FoxLeague team (register the team in the FoxLeague app first or use **+ Add agent** for a new
  one);
- a wallet that is already one of your agents;
- a wallet made from this install's own recovery words (use **+ Add agent** for those).

## Which wallet to give an agent

**Our suggestion: a fresh wallet made only for FoxLeague.** No Guardian, no history, no other assets: only the
team and the amount you set aside for the game. Keep small amounts in it and top it up daily, weekly or whenever
it suits you. **+ Add agent** makes exactly such a wallet for a new team.

We do not recommend giving an agent your personal wallet, the one with your history and your other assets:

- **The key can sign anything the wallet holds.** The agent only swaps EGLD and WEGLD to FOXSY and pays for the game,
  within the limits you set, but the wallet is only as safe as the file that holds its key.
- **A wallet with a Guardian is refused.** A MultiversX Guardian asks for a second signature on every
  transaction, the one you confirm with your 2FA code. The agent holds only the wallet's key, so nothing it
  signs would go through. The **Check** step sees the Guardian and stops there.
- **Turning the Guardian off just for FoxLeague is not a good trade.** It would leave everything else in that
  wallet with one protection less.

If the team you already play lives in your personal wallet, first move your savings and other assets to another
wallet, so that only the team and your game money stay. Then turn the Guardian off in the wallet's Guardian
settings (xPortal or the MultiversX web wallet) and import.

## Before you import

- **Don't put the team's recovery words or PEM file in place of the install's own.** The agents' history and
  limits belong to the wallets of the words they were made with, so an agent refuses to start with other words
  in `.env`. Import team is the way to bring another wallet.
- **Don't play the team by hand while the agent runs it.** To play yourself, pause the agent first and resume it
  when you are done.
- **Set its limits before you resume it.** A new agent starts with the default daily cap, monthly budget and gas
  reserve ([Every setting explained](/use/settings/)).

## Remove an imported team

On the agent's page, pause it, then press **Remove**, type `REMOVE` and your password. The agent stops managing
the team and its key is deleted from this install. The team, its cards and its funds stay in the wallet. You
keep your own key file. Its history stays in the dashboard. It cannot be removed while a payment waits for
FoxLeague's confirmation. You can import it again later.

To only park the team for a while, use **Retire** instead: the agent stops and leaves the tabs, but its key stays,
so **Restore** brings it back without importing it again ([Retire and restore an
agent](/use/dashboard/#retire-and-restore-an-agent)).

To watch the team in the FoxLeague app, log in with your own PEM file or wallet, as before
([Watch your team play](/use/watch-your-team/)).
