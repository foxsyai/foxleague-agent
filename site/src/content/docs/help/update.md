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
to run.

Pasting the install line again also works: it downloads the newest version, checks it against the release's
checksum and runs the installer, which offers your earlier answers as the defaults. An older version is never put
over a newer one unless you add `FOXAGENT_ALLOW_DOWNGRADE=1`.

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
on that restart.

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
- **A folder the agent may not write to**: run `./install.sh --update` in a terminal.

### Switching the check off

Set `AGENT_UPDATE_CHECK=0` in the `.env` file and restart the agent. It then asks GitHub nothing and shows no
notice, and `/upgrade` answers that updates are switched off. `./install.sh --update` in a
terminal still updates.

## More agents

Press **+ Add agent** in the dashboard. The new agent gets the next wallet from the same recovery words, its own
PEM file in `pem/` (`agent2.pem` for agent 2), its own settings, strategy and budget. Fund it like the first one.
Each agent plays its own game as if it were alone and knows nothing of the others, so two of them may meet in a tournament or a 1v1, bid on the same card or buy a card from each other at auction, by chance: FoxLeague's Fair Play allows that (it forbids arranging results, not meeting). What they share is a pooled formation record with no team named, a league formation table built from public matches and the results of their casual tests.

Already playing FoxLeague? **Import team** gives an agent the team you have ([Import your team](/use/import-team/)).

## Uninstall

In the `foxleague-agent` folder:

```sh
./install.sh --uninstall
```

It stops the background service and leaves your folder, wallet and PEM files in place. Everything the install
added is in that folder, the download cache of npm included: about 240 MB, and about 280 MB once an update has
kept the release before it (kept so that the update can be undone). The agent wallets keep their funds. Delete the
folder only when the wallets are empty and your recovery words are safe.

On Linux the installer turned on linger, which lets background services of your user start without a login. The
uninstall leaves it on, because other services of yours may count on it: `loginctl disable-linger $USER` turns it
off.

### On Windows

The uninstall has two parts. Inside Ubuntu (open it with `wsl -d Ubuntu --cd ~` in PowerShell), go to the
`foxleague-agent` folder and run `./install.sh --uninstall` as above. In PowerShell, remove the scheduled task
that keeps Ubuntu running:

```powershell
Unregister-ScheduledTask -TaskName 'FoxLeague Agent (WSL)' -Confirm:$false
```

This line does the same: it removes that task and nothing else, then names the step inside Ubuntu.

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.ps1))) -Uninstall
```

The task is all the installer added to Windows. WSL, Ubuntu and the line `systemd=true` in Ubuntu's
`/etc/wsl.conf` stay, because other programs may use them. If the installer changed a file that was already
there, the file as it was is in `/etc/wsl.conf.before-foxleague`.

Your folder with the wallet words stays inside Ubuntu. Do not remove Ubuntu itself while the agent wallets hold
funds or the recovery words are not on paper: `wsl --unregister Ubuntu` deletes everything in it.
