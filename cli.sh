#!/usr/bin/env bash
# foxleague-agent command line: ./cli.sh <command>   (./cli.sh alone lists the commands)
#
# Runs the command line of the release that is active (run.sh tells the layout), with the Node.js the installer
# chose, its private copy in .node/ included: no Node.js or npm of your own is needed. It uses this folder's
# .env and data/. It only reads versions/active; undoing an update that does not start is the launcher's work.
set -u

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# As root (sudo) on a folder another user owns: root's files in data/, versions/ or .env would keep the agent, which
# runs as that user, from starting again (INS-A8). An install that is root's own still runs.
if [ "$(id -u)" = 0 ] && [ "$(stat -c %u "$ROOT" 2>/dev/null || stat -f %u "$ROOT" 2>/dev/null)" != 0 ]; then
  who=$(stat -c %U "$ROOT" 2>/dev/null || stat -f %Su "$ROOT" 2>/dev/null)
  asked=''
  [ $# -eq 0 ] || printf -v asked ' %q' "$@"
  echo "foxleague-agent: this install belongs to ${who:-another user}, not to root: run it as ${who:-that user}, without sudo: cd $ROOT && ./cli.sh$asked" >&2
  exit 1
fi
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
# One path per line, the first one that is there wins (run.sh reads it the same way).
if [ -f "$ROOT/.node-path" ]; then
  while IFS= read -r n || [ -n "$n" ]; do
    if [ -n "$n" ] && [ -x "$n" ]; then NODE=$n; break; fi
  done < "$ROOT/.node-path"
fi
[ -n "$NODE" ] && [ -x "$NODE" ] || NODE="$ROOT/.node/bin/node"
[ -x "$NODE" ] || NODE=$(command -v node 2>/dev/null || true)
[ -n "$NODE" ] && [ -x "$NODE" ] || { echo "foxleague-agent: Node.js was not found; run ./install.sh again" >&2; exit 1; }

export FOXAGENT_ROOT="$ROOT"
export AGENT_ENV_FILE="${AGENT_ENV_FILE:-$ROOT/.env}"
export AGENT_DATA_DIR="${AGENT_DATA_DIR:-$ROOT/data}"
# The wallet of this install's .env, as its installer and its service use it: recovery words exported in this terminal
# would win over .env for Node.js and name another wallet (R2I-6).
unset AGENT_MNEMONIC
exec "$NODE" --disable-warning=ExperimentalWarning "$CODE/src/cli.ts" "$@"
