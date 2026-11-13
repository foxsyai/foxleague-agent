# Running FoxLeague Agent on a server

For most players the one-line local install in [INSTALL.md](../INSTALL.md) is the right choice. This guide is
for running your agents on your own Linux server (Ubuntu with systemd, on an x86-64 processor: `deploy/bootstrap.sh` installs the x64 Node.js), with the dashboard behind nginx and TLS.
The files are in `deploy/`.

## Layout

| What | Where |
|---|---|
| Service user | `foxleague-agent` (no shell) |
| Code | `/opt/foxleague-agent/app` |
| Node.js (private copy, checked against the SHA-256 written in `deploy/bootstrap.sh`) | `/opt/foxleague-agent/node` |
| Env file (recovery words, keys, login; mode 600) | `/etc/foxleague-agent/env` |
| Data (database, keys saved from the dashboard) | `/var/lib/foxleague-agent` |
| systemd unit (sandboxed) | `foxleague-agent.service` |

## First setup

1. Copy the repository to the server and run, as root: `deploy/bootstrap.sh`. It creates the user, the folders,
   the private Node.js and the systemd unit. It does not start anything.
2. From your computer, ship the code: `DEPLOY_HOST=root@your-server ./deploy/deploy.sh --no-restart`
   (or put `root@your-server` in `deploy/.host`, which git ignores, and run `./deploy/deploy.sh`).
3. On the server, as root:
   - `/opt/foxleague-agent/app/deploy/agentctl.sh setup` creates the wallet. Its recovery words are in the env
     file: read them once in your own SSH session (`sudo grep AGENT_MNEMONIC /etc/foxleague-agent/env`), write
     them on paper and never paste them anywhere. The agent refuses to print them on a server.
   - `agentctl.sh configure` asks for the keys (hidden input) and links your Telegram chat with a 6-digit code.
   - `agentctl.sh set-web-password` sets the dashboard login.
   - `agentctl.sh check-keys` tests them.
   - Behind nginx (below), add `WEB_UI_TRUST_PROXY=1` to `/etc/foxleague-agent/env`. Without it every visitor
     reaches the dashboard from nginx's own address, so they all share one login lockout: a stranger who types wrong
     passwords locks you out too.
4. Start it: `systemctl enable --now foxleague-agent`. Logs: `journalctl -u foxleague-agent -f`.

The service reads `/etc/foxleague-agent/env`. Useful entries (`.env.example` lists every setting):

- `AGENT_LIVE_ENABLED=1`: this server may sign real transactions once you press Go LIVE.
- `WEB_UI_TRUST_PROXY=1`: only behind your own nginx (it passes the client IP in `X-Real-IP`), and there always (step 3).
- `MVX_GATEWAY_URL`: a private MultiversX observing squad if you run one; the public gateway otherwise.

## Dashboard behind nginx

`deploy/nginx-foxleague-agent.conf` is a template with two server blocks. Its port 80 block only answers the certificate challenge and sends everything else to https.
Its port 443 block holds the certificate and passes the requests to the dashboard, which listens on 127.0.0.1:8870
only and sends its own security headers, including a per-page Content Security Policy. The dashboard is never
served on plain http, so the certificate comes first:

1. Point the DNS of your domain at the server.
2. Get the certificate, before the template is in place:
   `sudo certbot certonly --nginx -d agent.example.com --deploy-hook "systemctl reload nginx"`
   (certbot answers the challenge through the running nginx and changes none of your sites; the hook makes nginx
   read each renewed certificate).
3. Copy the template to `/etc/nginx/sites-available/foxleague-agent`, replace `agent.example.com` with your domain
   everywhere in it and link it: `sudo ln -s /etc/nginx/sites-available/foxleague-agent /etc/nginx/sites-enabled/`.
4. Check and reload: `sudo nginx -t && sudo systemctl reload nginx`. `http://your-domain` now redirects to https.

Do not run `certbot --nginx` on the template afterwards: it has its 443 block already.

The template also holds the sign-in page to 30 requests a minute from one address (nginx answers 429 beyond that);
the dashboard keeps its own lock on wrong passwords, per IPv4 address and per /64 for IPv6.

The template's `proxy_read_timeout 1080s` lets Talk to the manager wait for the whole answer at the highest effort (up
to 17 minutes). A server set up from an older template has 900 seconds: raise it to `1080s` and reload nginx, or a
long answer shows an error on the page while it is still being written and paid for. The page then keeps Send off
until the answer is in. The server answers one manager message at a time: a second one meanwhile, from Telegram or
another tab, is turned away with the reason (the page shows it, Telegram replies with it) and costs nothing.

## Everyday

| What | Command |
|---|---|
| Deploy a new version | `./deploy/deploy.sh` from your computer (restarts the service; check first that no plan is running, or its waiting actions are dropped) |
| A new release is out | The dashboard and Telegram tell you (about every 10 minutes the agent asks GitHub, and the round arrow next to the version (**Check for updates**) asks at once; `AGENT_UPDATE_CHECK=0` in the env file switches that off). A server set up this way does not update itself: there is no Update now button, and `/upgrade` answers that it is updated the way it was deployed. Take the release's tag in your copy and run `./deploy/deploy.sh` |
| Operator commands | `sudo /opt/foxleague-agent/app/deploy/agentctl.sh <command>`, agents numbered from 1: `agents`, `snapshot 1`, `log 1`, `mode dry`, `kill on`, `check-keys`, `shadow-report`, `model` |
| Keys | the dashboard's Keys panel (saved in `/var/lib/foxleague-agent/secrets.json`, mode 600) or `agentctl.sh configure` |
| Security score | `systemd-analyze security foxleague-agent` |

PEM files are written on your own computer, never on the server. Keep a copy of the repository with the same
recovery words in its `.env`, and run `./deploy/sync-pems.sh`: it asks the server which agents it runs, checks
that your words give the same addresses and writes each missing `pem/agentN.pem`. It also removes the file of an
agent the server deleted (Delete is only for a wallet that was never used), once the file names that wallet.
`deploy.sh` runs it at the end, and the dashboard reminds you when you add an agent. To delete never-used agents
from the server's command line: `sudo /opt/foxleague-agent/app/deploy/agentctl.sh delete-agent 11 12` (each one is
checked on chain and on FoxLeague first; a used one is kept and named).

## An agent's own model and effort

Every agent plays the model and effort of the dashboard's Strategist box unless it has its own. Give an agent its own
in the dashboard (its Settings, AI) or here, as root. The service reads it at the agent's next plan, so nothing is
restarted:

```
sudo /opt/foxleague-agent/app/deploy/agentctl.sh model                          # each agent: what it plays and its shadow plans
sudo /opt/foxleague-agent/app/deploy/agentctl.sh model 7 claude-opus-5-5 high    # agent 7 plays Opus 5.5 at high from its next plan
sudo /opt/foxleague-agent/app/deploy/agentctl.sh model 7 same high               # the all-agents model, its own effort
sudo /opt/foxleague-agent/app/deploy/agentctl.sh model 7 same same               # back to the Strategist box for both
```

For example, ten agents on three models, all at high effort:

```
sudo /opt/foxleague-agent/app/deploy/agentctl.sh model 7 claude-opus-5-5 high
sudo /opt/foxleague-agent/app/deploy/agentctl.sh model 6 claude-opus-5-5 high
sudo /opt/foxleague-agent/app/deploy/agentctl.sh model 10 claude-opus-5-5 high
sudo /opt/foxleague-agent/app/deploy/agentctl.sh model 1 claude-sonnet-5-5 high
sudo /opt/foxleague-agent/app/deploy/agentctl.sh model 5 claude-sonnet-5-5 high
sudo /opt/foxleague-agent/app/deploy/agentctl.sh model 4 claude-sonnet-5-5 high
sudo /opt/foxleague-agent/app/deploy/agentctl.sh model 9 claude-haiku-5-5 high
sudo /opt/foxleague-agent/app/deploy/agentctl.sh model 8 claude-haiku-5-5 high
sudo /opt/foxleague-agent/app/deploy/agentctl.sh model 2 claude-haiku-5-5 high
sudo /opt/foxleague-agent/app/deploy/agentctl.sh model 3 claude-haiku-5-5 high
```

This is a setting on the machine, so it asks for no password, like the others made here. In the dashboard a dearer
model or a higher effort for one agent asks for your password. Going back to "Same as all agents" there counts by the
model and effort it lands on. A model or effort the list does not have is refused here and in the dashboard; one
written into the database by hand is never used: the agent plays the all-agents one in its place and the log says why
once. A model that left the list runs its successor. An agent with its own model and effort is not moved by a switch
in the Strategist box, which still sets the manager chat and `/ask`. The dashboard shows an agent's own model on its
tab, Telegram `/status` lists it next to the agent and its Last plan names it in the cost line.

## Shadow plans: trying another model without letting it play

Before you switch the strategist to another model, you can let that model plan in the shadow. Right after each real
plan the service sends the very same request to the second model and only records what it would have done. A shadow
plan is never carried out, the playing model never reads it and nothing the agents play by changes. Each one costs
what one plan costs on the shadow model, on top of the real plan. That cost is in the dashboard's AI spend.

You can set several shadow models at once. Each gets the same request at the same moment and is recorded by itself.
Each adds its own cost to every plan.

It is off unless you switch it on here, on the server. There is no button for it in the dashboard and no Telegram
command, because it adds AI spend.

Switch it on in the database, as root. The service reads the setting before every plan, so nothing is restarted:

```
SET='const { DatabaseSync } = require("node:sqlite"); new DatabaseSync("/var/lib/foxleague-agent/agent.db", { timeout: 5000 }).prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(process.argv[1], process.argv[2])'
sudo -u foxleague-agent /opt/foxleague-agent/node/bin/node --disable-warning=ExperimentalWarning -e "$SET" shadow_model claude-haiku-5-5
sudo -u foxleague-agent /opt/foxleague-agent/node/bin/node --disable-warning=ExperimentalWarning -e "$SET" shadow_effort medium
```

Several models go into the one setting, separated by commas. Put the value in quotes if you write spaces after the
commas:

```
sudo -u foxleague-agent /opt/foxleague-agent/node/bin/node --disable-warning=ExperimentalWarning -e "$SET" shadow_model claude-haiku-5-5,claude-sonnet-5-5
```

Switch it off the same way, with `off` as the model:

```
sudo -u foxleague-agent /opt/foxleague-agent/node/bin/node --disable-warning=ExperimentalWarning -e "$SET" shadow_model off
```

- Each model is one of the list (`claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-fable-5-2`) and
  not the one that plays, or the word `same` (a repeat, below). An entry that is anything else is left out and the log says why once
  (`journalctl -u foxleague-agent`); the others still run. A model written twice counts once. `off` anywhere in the
  setting switches all of them off.
- A shadow model that is also the model that plays rests. When you later pick another playing model in the dashboard,
  its shadow plans start, so that switch asks for your dashboard password even when the new model is cheaper. With
  several shadow models set, the switch asks for it also when the model you pick is another one of them. It is
  weighed for each agent the switch moves: an agent with its own model and effort keeps them, so its shadow plans do
  not count. A retired agent counts like an active one, since Restore and Resume bring it back. An entry of the
  all-agents list counts in any case, since an agent you add follows it.
- The effort is `low`, `medium`, `high`, `xhigh` or `max`; without one it is `medium`. It is one effort for every
  shadow model. An entry written with its own effort runs at that effort instead.
- An entry may carry its own effort after a colon: `claude-opus-5-5:low`. An entry with an effort rests only while its
  model plays at that very effort; the same model at another effort runs. An entry without an effort rests while its
  model plays, at any effort, as before. A change of the playing effort that starts an entry asks for the password
  like a dearer model, also when the new effort is lower. An entry with an effort nobody knows is left out with its
  reason in the log. A model and effort written twice count once.
- `same` asks the real plan's own model and effort again: a repeat. It never rests: it follows the model and effort
  the agent plays, also after you change them. An entry that names the playing model and effort itself still rests,
  as before; with `same` beside it that pair runs once. `same` is written in small letters and takes no effort after a
  colon. A repeat costs what the real plan costs, on top of it. A switch between models of the list does not start
  it, so there it asks for no password of its own: a dearer model or a higher effort asks as always and raises the
  repeat too. The one place it cannot run is a playing model the list does not have (`AGENT_MODEL` in the env file may
  still name one, such as `claude-opus-4-8`): there `same` is left out and the log says why once. A switch from such a
  model to one of the list starts the repeat, so it asks for your password, also when the new model is not dearer.
- `AGENT_SHADOW_MODEL` (one model or several separated by commas) and `AGENT_SHADOW_EFFORT` in
  `/etc/foxleague-agent/env` do the same from the next start of the service. The database's setting wins, so `off`
  there switches it off whatever the env file says.

Read what came of it at any time, also while the service runs (it only reads):

```
sudo /opt/foxleague-agent/app/deploy/agentctl.sh shadow-report      # every agent
sudo /opt/foxleague-agent/app/deploy/agentctl.sh shadow-report 3    # agent 3
```

The report gives, for each shadow model, how many shadow plans there are, how many answered with a valid plan, how
many of their actions the parser took, how often the shadow proposed the same kinds of action as the real plan of the
same moment and the average cost and time. Then it lists the last real plans, each with the shadow plans made from
the same request below it. Each shadow plan is also a row in the agent's Activity, marked "shadow plan, not carried
out". The newest 2,000 are kept, those of all shadow models together.

What it cannot tell you: which plan was the better one. A shadow plan's actions are never checked against the game
rules or your limits, so read the plans yourself before you switch. A shadow request that gets no answer in 10
minutes is given up and never asked again. Until then a model that is still answering an agent's earlier request skips
that agent's next plan, while the other shadow models go on.

### Shadow plans for one agent

Each agent can have its own list: `shadow_model_agent_N`, with N as the agents are numbered in the dashboard and the
CLI (agent 1 is `shadow_model_agent_1`). It is written like `shadow_model`, with the same rules. It holds for that
agent only: an agent with its own list does not read the all-agents one. `off` there means none for that agent,
whatever the all-agents list says. Empty, it follows the all-agents list again. Deleting an agent removes its list.
`agentctl.sh model` shows each agent's shadow plans.

### The same model at other efforts, on three agents

To see what more or less thinking would change, let the model that plays also plan in the shadow at other efforts.
Here agents 7, 1 and 9 play Opus 5.5, Sonnet 5.5 and Haiku 5.5 at high (with `agentctl.sh model` above). The
all-agents list is switched off and each of the three gets its own model at low, medium and xhigh:

```
sudo -u foxleague-agent /opt/foxleague-agent/node/bin/node --disable-warning=ExperimentalWarning -e "$SET" shadow_model off
sudo -u foxleague-agent /opt/foxleague-agent/node/bin/node --disable-warning=ExperimentalWarning -e "$SET" shadow_model_agent_7 claude-opus-5-5:low,claude-opus-5-5:medium,claude-opus-5-5:xhigh
sudo -u foxleague-agent /opt/foxleague-agent/node/bin/node --disable-warning=ExperimentalWarning -e "$SET" shadow_model_agent_1 claude-sonnet-5-5:low,claude-sonnet-5-5:medium,claude-sonnet-5-5:xhigh
sudo -u foxleague-agent /opt/foxleague-agent/node/bin/node --disable-warning=ExperimentalWarning -e "$SET" shadow_model_agent_9 claude-haiku-5-5:low,claude-haiku-5-5:medium,claude-haiku-5-5:xhigh
```

Each of the three then makes four requests a plan, the real one and three shadow ones, each at its model's price; the
other seven make one. Read each agent's comparison:

```
sudo /opt/foxleague-agent/app/deploy/agentctl.sh shadow-report 7
sudo /opt/foxleague-agent/app/deploy/agentctl.sh shadow-report 1
sudo /opt/foxleague-agent/app/deploy/agentctl.sh shadow-report 9
```

The report gives the numbers once per model and effort, each block named like "Opus 5.5 (low)". Then it lists every
real plan with its model and effort ("real   Opus 5.5 (high)") and its shadow plans at the three efforts below it.

### The same model and effort again: a repeat

The same model at the same effort does not plan the same twice either. So "medium agreed with xhigh 6 times out of
10" says little until you know how often xhigh agrees with itself. Put `same` in an agent's list and the model that
plays plans once more in the shadow, at the very effort it plays: how often that repeat agrees with the real plan is
the baseline for the other efforts. Here agents 7 and 1 play Opus 5.5 and Sonnet 5.5 at xhigh and agent 9 plays Haiku
5.5 at high. Each keeps its three other efforts and gets `same` in front:

```
sudo -u foxleague-agent /opt/foxleague-agent/node/bin/node --disable-warning=ExperimentalWarning -e "$SET" shadow_model_agent_7 same,claude-opus-5-5:low,claude-opus-5-5:medium,claude-opus-5-5:high
sudo -u foxleague-agent /opt/foxleague-agent/node/bin/node --disable-warning=ExperimentalWarning -e "$SET" shadow_model_agent_1 same,claude-sonnet-5-5:low,claude-sonnet-5-5:medium,claude-sonnet-5-5:high
sudo -u foxleague-agent /opt/foxleague-agent/node/bin/node --disable-warning=ExperimentalWarning -e "$SET" shadow_model_agent_9 same,claude-haiku-5-5:low,claude-haiku-5-5:medium,claude-haiku-5-5:high
```

Agent 9's `claude-haiku-5-5:high` rests while it plays Haiku 5.5 at high, as before (the log says so once), and the
repeat runs at high. So agents 7 and 1 make five requests a plan (the real one, the repeat and three other efforts)
and agent 9 four. A repeat at xhigh costs what an xhigh plan costs. `agentctl.sh model` shows the entry as "same (the
real plan's model and effort again)".

In `agentctl.sh shadow-report 7` the repeats are a block of their own, named like "Opus 5.5 (xhigh), the real plan's
own model and effort again", with the same lines as the other blocks. Under each real plan its repeat is marked
"repeat" instead of "shadow". A shadow plan of another agent at the same model and effort, next to a real plan of
another effort, stays in a block of its own. In the Activity a repeat's row says "the real plan's own model and effort
again".
