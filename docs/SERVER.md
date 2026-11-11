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

## Everyday

| What | Command |
|---|---|
| Deploy a new version | `./deploy/deploy.sh` from your computer (restarts the service; check first that no plan is running, or its waiting actions are dropped) |
| A new release is out | The dashboard and Telegram tell you (about every 10 minutes the agent asks GitHub; `AGENT_UPDATE_CHECK=0` in the env file switches that off). A server set up this way does not update itself: there is no Update now button, and `/upgrade` answers that it is updated the way it was deployed. Take the release's tag in your copy and run `./deploy/deploy.sh` |
| Operator commands | `sudo /opt/foxleague-agent/app/deploy/agentctl.sh <command>`, agents numbered from 1: `agents`, `snapshot 1`, `log 1`, `mode dry`, `kill on`, `check-keys` |
| Keys | the dashboard's Keys panel (saved in `/var/lib/foxleague-agent/secrets.json`, mode 600) or `agentctl.sh configure` |
| Security score | `systemd-analyze security foxleague-agent` |

PEM files are written on your own computer, never on the server. Keep a copy of the repository with the same
recovery words in its `.env`, and run `./deploy/sync-pems.sh`: it asks the server which agents it runs, checks
that your words give the same addresses and writes each missing `pem/agentN.pem`. It also removes the file of an
agent the server deleted (Delete is only for a wallet that was never used), once the file names that wallet.
`deploy.sh` runs it at the end, and the dashboard reminds you when you add an agent. To delete never-used agents
from the server's command line: `sudo /opt/foxleague-agent/app/deploy/agentctl.sh delete-agent 11 12` (each one is
checked on chain and on FoxLeague first; a used one is kept and named).
