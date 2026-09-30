#!/usr/bin/env bash
# Operator CLI on the server, as the service user with the server env file (agents are numbered from 1):
#   sudo /opt/foxleague-agent/app/deploy/agentctl.sh <command> [args]   (e.g. configure, check-keys, snapshot 1, log)
set -euo pipefail
exec sudo -u foxleague-agent env HOME=/opt/foxleague-agent AGENT_ENV_FILE=/etc/foxleague-agent/env AGENT_DATA_DIR=/var/lib/foxleague-agent AGENT_IS_SERVER=1 \
  /opt/foxleague-agent/node/bin/node --disable-warning=ExperimentalWarning /opt/foxleague-agent/app/src/cli.ts "$@"
