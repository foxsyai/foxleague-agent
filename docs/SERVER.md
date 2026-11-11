# Running FoxLeague Agent on a server

For most players the one-line local install in [INSTALL.md](../INSTALL.md) is the right choice. This guide is
for running your agents on your own Linux server (Ubuntu with systemd, on an x86-64 processor: `deploy/bootstrap.sh` installs the x64 Node.js), with the dashboard behind nginx and TLS.
The files are in `deploy/`.

## Layout

| What | Where |
|---|---|
| Service user | `foxleague-agent` (no shell) |
| Code | `/opt/foxleague-agent/app` |
| Node.js (private copy, checksum verified) | `/opt/foxleague-agent/node` |
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

`deploy/nginx-foxleague-agent.conf` is a template: replace `agent.example.com` with your domain, point its DNS at
the server, get a certificate (for example `certbot --nginx`) and reload nginx. The dashboard listens on
127.0.0.1:8870 only and sends its own security headers, including a per-page Content Security Policy.

## Everyday

| What | Command |
|---|---|
| Deploy a new version | `./deploy/deploy.sh` from your computer (restarts the service; check first that no plan is running, or its waiting actions are dropped) |
| Operator commands | `sudo /opt/foxleague-agent/app/deploy/agentctl.sh <command>`, agents numbered from 1: `agents`, `snapshot 1`, `log 1`, `mode dry`, `kill on`, `check-keys`, `shadow-report` |
| Keys | the dashboard's Keys panel (saved in `/var/lib/foxleague-agent/secrets.json`, mode 600) or `agentctl.sh configure` |
| Security score | `systemd-analyze security foxleague-agent` |

PEM files are written on your own computer, never on the server. Keep a copy of the repository with the same
recovery words in its `.env`, and run `./deploy/sync-pems.sh`: it asks the server which agents it runs, checks
that your words give the same addresses and writes each missing `pem/agentN.pem`. It also removes the file of an
agent the server deleted (Delete is only for a wallet that was never used), once the file names that wallet.
`deploy.sh` runs it at the end, and the dashboard reminds you when you add an agent. To delete never-used agents
from the server's command line: `sudo /opt/foxleague-agent/app/deploy/agentctl.sh delete-agent 11 12` (each one is
checked on chain and on FoxLeague first; a used one is kept and named).

## Shadow plans: trying another model without letting it play

Before you switch the strategist to another model, you can let that model plan in the shadow. Right after each real
plan the service sends the very same request to the second model and only records what it would have done. A shadow
plan is never carried out, the playing model never reads it and nothing the agents play by changes. Each one costs
what one plan costs on the shadow model, on top of the real plan. That cost is in the dashboard's AI spend.

It is off unless you switch it on here, on the server. There is no button for it in the dashboard and no Telegram
command, because it adds AI spend.

Switch it on in the database, as root. The service reads the setting before every plan, so nothing is restarted:

```
SET='const { DatabaseSync } = require("node:sqlite"); new DatabaseSync("/var/lib/foxleague-agent/agent.db", { timeout: 5000 }).prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(process.argv[1], process.argv[2])'
sudo -u foxleague-agent /opt/foxleague-agent/node/bin/node --disable-warning=ExperimentalWarning -e "$SET" shadow_model claude-haiku-5-5
sudo -u foxleague-agent /opt/foxleague-agent/node/bin/node --disable-warning=ExperimentalWarning -e "$SET" shadow_effort medium
```

Switch it off the same way, with `off` as the model:

```
sudo -u foxleague-agent /opt/foxleague-agent/node/bin/node --disable-warning=ExperimentalWarning -e "$SET" shadow_model off
```

- The model is one of the list (`claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-fable-5-2`) and
  not the one that plays. Anything else means off, and the log says why once (`journalctl -u foxleague-agent`).
- The effort is `low`, `medium`, `high`, `xhigh` or `max`; without one it is `medium`.
- `AGENT_SHADOW_MODEL` and `AGENT_SHADOW_EFFORT` in `/etc/foxleague-agent/env` do the same from the next start of
  the service. The database's setting wins, so `off` there switches it off whatever the env file says.

Read what came of it at any time, also while the service runs (it only reads):

```
sudo /opt/foxleague-agent/app/deploy/agentctl.sh shadow-report      # every agent
sudo /opt/foxleague-agent/app/deploy/agentctl.sh shadow-report 3    # agent 3
```

The report says how many shadow plans there are, how many answered with a valid plan, how many of their actions the
parser took, how often the shadow proposed the same kinds of action as the real plan of the same moment, the average
cost and time and the last pairs side by side. Each shadow plan is also a row in the agent's Activity, marked
"shadow plan, not carried out". The newest 2,000 are kept.

What it cannot tell you: which plan was the better one. A shadow plan's actions are never checked against the game
rules or your limits, so read the pairs yourself before you switch. A shadow request that gets no answer in 10
minutes is given up and never asked again.
