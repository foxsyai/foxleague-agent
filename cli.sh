#!/usr/bin/env bash
# foxleague-agent command line: ./cli.sh <command>   (./cli.sh alone lists the commands)
#
# Runs the command line of the release that is active (run.sh tells the layout), with the Node.js the installer
# chose, its private copy in .node/ included: no Node.js or npm of your own is needed. It uses this folder's
# .env and data/. It only reads versions/active; undoing an update that does not start is the launcher's work.
set -u

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
V="$ROOT/versions"
if [ -f "$V/active" ]; then
  active=$(head -n 1 "$V/active" 2>/dev/null || true)
  case "$active" in '' | .* | *[!A-Za-z0-9._-]*) echo "foxleague-agent: versions/active does not name a release; run the install line again" >&2; exit 1 ;; esac
  CODE="$V/$active"
else
  CODE="$ROOT"
fi
[ -f "$CODE/src/cli.ts" ] || { echo "foxleague-agent: no code in $CODE; run the install line again" >&2; exit 1; }

NODE=''
[ -f "$ROOT/.node-path" ] && NODE=$(head -n 1 "$ROOT/.node-path" 2>/dev/null || true)
[ -n "$NODE" ] && [ -x "$NODE" ] || NODE="$ROOT/.node/bin/node"
[ -x "$NODE" ] || NODE=$(command -v node 2>/dev/null || true)
[ -n "$NODE" ] && [ -x "$NODE" ] || { echo "foxleague-agent: Node.js was not found; run ./install.sh again" >&2; exit 1; }

export FOXAGENT_ROOT="$ROOT"
export AGENT_ENV_FILE="${AGENT_ENV_FILE:-$ROOT/.env}"
export AGENT_DATA_DIR="${AGENT_DATA_DIR:-$ROOT/data}"
exec "$NODE" --disable-warning=ExperimentalWarning "$CODE/src/cli.ts" "$@"
