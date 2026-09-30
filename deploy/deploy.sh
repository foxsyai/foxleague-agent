#!/usr/bin/env bash
# Ship the working tree to your server and restart the service. Run from the repo root (see docs/SERVER.md).
# Never ships .env, data/, node_modules, git history, PEM files (pem/) or local agent settings (.claude/).
set -euo pipefail
# The server: DEPLOY_HOST=root@your-server, or that value in deploy/.host (git ignores it).
HOST=${DEPLOY_HOST:-$(cat "$(dirname "$0")/.host" 2>/dev/null || true)}
[ -n "$HOST" ] || { echo "Set DEPLOY_HOST=root@your-server or write it into deploy/.host" >&2; exit 1; }
SSH_OPTS=(-o ControlMaster=auto -o "ControlPath=$HOME/.ssh/cm-%r@%h-%p" -o ControlPersist=10m)

# The strategist's game knowledge follows FoxLeague's manual: say so when it is behind (only on a computer
# that has a FoxLeague checkout next to this folder). A reminder, never a stop.
if [ -d ../next-foxleague/.git ]; then npm run -s cli -- manual-status || true; fi

rsync -az --delete -e "ssh ${SSH_OPTS[*]}" \
  --exclude node_modules --exclude data --exclude '.env' --exclude '.env.*' --exclude .git --exclude '*.pem' --exclude pem --exclude .node --exclude .claude --exclude site \
  ./ "$HOST:/opt/foxleague-agent/app/"
RESTART=1
[ "${1:-}" = "--no-restart" ] && RESTART=0
ssh "${SSH_OPTS[@]}" "$HOST" "RESTART=$RESTART bash -s" <<'REMOTE'
set -e
chown -R foxleague-agent:foxleague-agent /opt/foxleague-agent/app
cd /opt/foxleague-agent/app
sudo -u foxleague-agent env PATH=/opt/foxleague-agent/node/bin:/usr/bin:/bin HOME=/opt/foxleague-agent npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error
# The systemd unit follows the repository's copy.
if ! cmp -s deploy/foxleague-agent.service /etc/systemd/system/foxleague-agent.service; then
  install -m 644 deploy/foxleague-agent.service /etc/systemd/system/foxleague-agent.service
  systemctl daemon-reload
fi
if [ "$RESTART" = 1 ]; then systemctl restart foxleague-agent; fi
systemctl --no-pager --lines=0 status foxleague-agent | head -3 || true
REMOTE
# Agents added in the server's dashboard get their PEM file here, on this computer (never on the server).
if grep -q '^AGENT_MNEMONIC=' .env 2>/dev/null; then "$(dirname "$0")/sync-pems.sh" || echo "PEM sync skipped (see above)"; fi
