#!/usr/bin/env bash
# Writes pem/agentN.pem on THIS computer for every agent your server runs, from the same recovery words
# (AGENT_MNEMONIC in this folder's .env). PEM files never go to the server. Run it after adding an agent in the
# server's dashboard; deploy.sh runs it at the end too. An existing file is never overwritten. An imported
# team's key is yours already, so it gets no file here.
set -euo pipefail
cd "$(dirname "$0")/.."
HOST=${DEPLOY_HOST:-$(cat deploy/.host 2>/dev/null || true)}
[ -n "$HOST" ] || { echo "Set DEPLOY_HOST=root@your-server or write it into deploy/.host" >&2; exit 1; }
SSH_OPTS=(-o ControlMaster=auto -o "ControlPath=$HOME/.ssh/cm-%r@%h-%p" -o ControlPersist=10m)

agents=$(ssh "${SSH_OPTS[@]}" "$HOST" /opt/foxleague-agent/app/deploy/agentctl.sh agents)
[ -n "$agents" ] || { echo "The server listed no agents." >&2; exit 1; }
mkdir -p pem && chmod 700 pem
while read -r num addr source; do
  [[ $num =~ ^[0-9]+$ && $addr =~ ^erd1[0-9a-z]{58}$ ]] || { echo "Unexpected line from the server: $num $addr" >&2; exit 1; }
  if [ "${source:-}" = imported ]; then
    echo "agent $num: an imported team (its key is the one you imported)"
    continue
  fi
  here=$(npm run -s cli -- address "$num" | awk '{print $3}')
  if [ "$here" != "$addr" ]; then
    echo "agent $num: this computer's recovery words give $here, the server runs $addr. Not the same words: nothing written." >&2
    exit 1
  fi
  if [ -f "pem/agent$num.pem" ]; then
    echo "agent $num: pem/agent$num.pem is here"
  else
    npm run -s cli -- export-pem "$num" "pem/agent$num.pem"
  fi
done <<< "$agents"
