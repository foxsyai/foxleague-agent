---
title: Update, uninstall, more agents
description: Keep the agent up to date, add agents or remove it.
---

## Update

The agent tells you when a new version is out and installs it when you say so. Nothing is ever installed by itself.

### The notice

About every 10 minutes the agent asks GitHub whether a newer release of foxleague-agent is out. When one is:

- the **dashboard** shows a notice under the header: the new version, the one you run and a few lines from the
  maintainers on what is new, with the **Update now** button;
- **Telegram** sends you the same lines, once for each version.

The version you run is always in the dashboard's header, next to the mode (for example `v1.0.0`), and in the
first line of `/status`, which also names a newer version when one is out.

To ask now instead of at the next check, press the round arrow next to the version, **Check for updates**. The
notice and a short message give the answer at once, and nothing is installed until you press **Update now**. Two
checks less than 15 seconds apart ask GitHub once: the second shows the answer of the first. In a terminal,
`./cli.sh update-check` in the `foxleague-agent` folder asks as well. Where the check is switched off the arrow is
not shown.

### One click

Press **Update now** in the dashboard, or send `/upgrade` on Telegram. No password is asked: whoever asks, only a
release that is signed by the foxleague-agent maintainers and newer than yours can be installed, so there is
nothing to steer. This is what happens:

1. The agent asks for that release again and checks its signature with the key that came with the version you run.
2. It downloads the release and checks that it is, byte for byte, the one that was signed.
3. It unpacks the new version into a folder of its own, next to the running version, and the new version prepares
   itself there (its Node.js and its dependencies). The running version is not written to: when a step fails, the
   agent runs on as before and tells you why.
4. The agent stops as for any restart. An action that is being signed finishes and is booked first. The other
   actions of a running plan that were still waiting are dropped, and the next plan takes them up from a fresh
   look at the game.
5. It starts again as the new version and tells you so, in the dashboard and on Telegram. All of it takes a minute
   or two. The dashboard is away for about half a minute, and its page comes back by itself.

The new version has to stay up for 45 seconds before the next update is taken. **Update now** or `/upgrade` in
that time answers "the last update is still being confirmed, try again in a minute".

Your wallet, keys, settings and history are not touched: `.env`, `data/` and `pem/` belong to your install, not to
a version.

### What the signature protects against

Every release comes with a small signed note that names its version and the exact size and checksum of its
download. The maintainers sign it with a key that never leaves their own computers: it is not on GitHub. Your
agent holds the public half of that key, which came with the version it already runs.

So an update is taken only when the signature is good, the version is newer than yours and the download is exactly
the one that was signed. Someone who took over the GitHub repository, the download or the network on the way
could not make your agent install their code, and could not push it back to an older version either. The first
install has no earlier version to check with: like the install line itself, it trusts GitHub over https and the
release's checksum.

### If the new version does not start

The agent keeps the version that ran before. A new version counts as started once the agent has been up for 45
seconds. When it has not come that far in two starts, the agent goes back by itself to the version that ran before
and tells you, in the dashboard and on Telegram: "The update to ... did not start and was undone: you run ... as
before." That takes about a minute and a half. Your wallet, settings and history are untouched, and it is safe to
try again later.

Nothing has to be done then: the agent keeps running the version it ran before. While the same new version is on
offer, the dashboard's notice says so and its button reads **Try again** instead of **Update now**: press it only
if you want to install that version once more. A version newer than the one that was undone is offered as usual,
with **Update now**.

The background service starts the agent again after every exit, also when a new version ends at once without an
error, so the undo does not wait for you. Stopping the agent yourself (`systemctl --user stop foxleague-agent`, or
the uninstall) stays a stop.

### From a terminal

In the `foxleague-agent` folder:

```sh
./install.sh --update
```

It does what the button does: it looks for the newest release, checks its signature, downloads it, prepares it
next to the running version and restarts the agent into it. If the restart fails it says so and names the command
to run. Type it as yourself, without sudo: as root on your install it stops before it changes anything and says
so, because root's files there would keep the agent from starting.

Pasting the install line again also works: it downloads the newest version, checks it against the release's
checksum, prepares it next to the installed one (Node.js and dependencies) and puts it in place only once that
ended well, then runs the installer, which offers your earlier answers as the defaults. If the preparing fails
(no network, for example), nothing was changed and the agent runs as before. The installer asks its questions in
a terminal: over SSH, log in first (or use `ssh -t`). An older version is never put over a newer one unless you
add `FOXAGENT_ALLOW_DOWNGRADE=1`.

### Without the background service

An install made with `--no-service` has no background service and an update does not add one: you start the agent
yourself with `./run.sh`. Nothing starts such an agent again, so an update does not end it. After **Update now**,
`/upgrade` or `./install.sh --update` the new version is put in place and the agent keeps playing on the version
it runs. The dashboard's notice then says "Version ... is in place and runs from the next start", with what to
do: stop the agent (Ctrl-C in its terminal) and run `./run.sh` again in the `foxleague-agent` folder. After
**Update now** or `/upgrade` Telegram says it too. Asking for the update a second time says the same and does
nothing more.

If you keep the agent running another way that starts it again after it ends (a service of your own, a container
that restarts), put `FOXAGENT_SUPERVISED=1` in `.env`: an update then ends the agent with exit code 75 and counts
on that restart. Without that line a service of your own counts as started by hand, whatever it says about
restarts: the agent cannot see that from inside, so the update is put in place and the agent keeps playing.

### When a release changes the background service

An update replaces the agent's code, not the service file that starts it (the unit on Linux, the launch agent on
macOS). When a release changes that file, its notes say so: run `./install.sh` again once in the `foxleague-agent`
folder and it is written anew. Your wallet, login and keys are kept.

### Installs that do not update themselves

These show the notice with what to do instead of the button:

- **A git checkout** (you installed with `git clone`): run `./install.sh --update` in a terminal. It pulls your
  branch: a git checkout follows its branch, which may hold code that is in no release yet.
- **A server set up by hand** ([Run it on a server](/help/server/)): update it the way it was deployed, with
  `deploy/deploy.sh` from your computer.
- **An install from before versions had folders of their own**: paste the install line again once. Later updates
  are one click.
- **A folder the agent may not write to** (another user owns part of it, for example after a command run with
  `sudo`, or it came back from a backup): make it yours again in a terminal, then update again. The notice gives
  the command with your folder, for example `sudo chown -R "$USER" ~/foxleague-agent && chmod -R u+rwX ~/foxleague-agent`.

### Switching the check off

Set `AGENT_UPDATE_CHECK=0` in the `.env` file and restart the agent. It then asks GitHub nothing and shows no
notice, and `/upgrade` answers that updates are switched off. `./install.sh --update` in a
terminal still updates.

### When FoxLeague's manual changes

Your agents play by FoxLeague's player manual: each version of the agent carries a copy of it. From the hour of the
morning summary the agent reads the manual FoxLeague serves and compares each page your agents read with that copy,
again every hour while they match. It asks FoxLeague's public read-only server and sends nothing of yours. Each
snapshot also compares FoxLeague's game settings with the ones the copy was built against: when FoxLeague adds or
removes a setting, the manual is checked at once.

When a page changed, a new one came or one went, Telegram tells you at once in one line, the morning summary says it
again and the dashboard shows the same line under the header:

> FoxLeague's manual changed since the agents' copy (pages: mechanics/fusion). The maintainer runs sync-manual.

It names up to eight pages; when more changed it names the first eight and says how many more. A changed setting is
named the same way ("FoxLeague's game settings changed since the agents' copy (keys: ...)"). A rule switch your
agents have no rule for yet is told once its start is a week away or less.

Your agents keep playing by their copy until a version of the agent brings the new one. Meanwhile each plan is told
which pages and settings changed and that the live values in its snapshot and the refusals of the executor win over
the manual there; a switch without a rule shows in the snapshot with its numbers. The maintainer runs
`sync-manual`, which builds the copy again from FoxLeague's manual, reads the pages it names and publishes a
version with it: update when the notice says it is out. The notice about the old copy goes with the update and the
agent checks the new copy the same day. On a server you deploy yourself
([Run it on a server](/help/server/)), run `sync-manual` on a computer with a FoxLeague checkout, commit the new
manual and deploy it.

When FoxLeague could not be read, the line says "Could not check FoxLeague's manual today" and why. That never
counts as up to date: the agent asks again each hour, up to four times a day, then the next day. In a terminal,
`./cli.sh manual-check` in the `foxleague-agent` folder asks at once. To switch the check off, set
`AGENT_MANUAL_CHECK=0` in `.env` and restart the agent.

## More agents

Press **+ Add agent** in the dashboard. The new agent gets the next wallet from the same recovery words, its own
PEM file in `pem/` (`agent2.pem` for agent 2), its own settings, strategy and budget. Fund it like the first one.
Each agent plays its own game as if it were alone and knows nothing of the others, so two of them may meet in a tournament or a 1v1, bid on the same card or buy a card from each other at auction, by chance: FoxLeague's Fair Play allows that (it forbids arranging results, not meeting). What they share is a pooled formation record with no team named, a league formation table built from public matches and the results of their casual tests.

Already playing FoxLeague? **Import team** gives an agent the team you have ([Import your team](/use/import-team/)).

## Uninstall

How to uninstall and what stays is on the page of your system, under "Uninstalling":
[Install on Windows](/start/install-windows/#uninstalling) (one line in PowerShell),
[Install on Mac](/start/install-mac/#uninstalling) and [Install on Linux](/start/install-linux/#uninstalling)
(`./install.sh --uninstall` in the `foxleague-agent` folder). In every case your folder with the recovery words
stays: the agent wallets may still hold funds.
