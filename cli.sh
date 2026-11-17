#!/usr/bin/env bash
# foxleague-agent command line: ./cli.sh <command>   (./cli.sh alone lists the commands)
#
# Runs the command line of the release that is active (run.sh tells the layout), with the Node.js the installer
# chose, its private copy in .node/ included: no Node.js or npm of your own is needed. It uses this folder's
# .env and data/. It only reads versions/active; undoing an update that does not start is the launcher's work.
set -u

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# As root (sudo) on a folder another user owns: root's files in data/, versions/ or .env would keep the agent, which
# runs as that user, from starting again (INS-A8). An install that is root's own still runs, and so does one whose
# agent already runs as root there (a container with the host's install mounted, a system unit without User=, root's
# crontab): the launcher an update puts in place must start it wherever the one it replaces did (R2I-2). Its signs,
# any one of them (FI-1: the installer makes the database as its user, and root writing into it never makes it root's):
# the database is root's; versions/active is root's (the agent's own update and the launcher's undo write it by
# rename); or the start says FOXAGENT_SUPERVISED=1 (in the environment, else in .env, as the agent reads it) with no
# sudo and no terminal, as a service manager starts it. A mistaken `sudo ./run.sh` or `sudo ./cli.sh` has its SUDO_*
# variables and a terminal. "/." follows a link to the folder: stat does not follow one in the last part (R2I-1); a
# file is asked as it is, so a link to it is its maker's.
uid_of() { stat -c %u "$1" 2>/dev/null || stat -f %u "$1" 2>/dev/null || true; }
roots() { [ -f "$1" ] && [ ! -L "$1" ] && [ "$(uid_of "$1")" = 0 ]; }
supervised_said() {
  if [ -n "${FOXAGENT_SUPERVISED+set}" ]; then printf '%s' "$FOXAGENT_SUPERVISED"; return 0; fi
  LC_ALL=C grep -a -E '^FOXAGENT_SUPERVISED=' "${AGENT_ENV_FILE:-$ROOT/.env}" 2>/dev/null | tail -n 1 | tr -d '\r' | cut -d= -f2- | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//' || true
}
started_by_a_service() {
  [ "$(supervised_said | tr -d '[:space:]')" = 1 ] && [ -z "${SUDO_USER:-}${SUDO_UID:-}${SUDO_COMMAND:-}" ] && [ ! -t 0 ] && [ ! -t 1 ] && [ ! -t 2 ]
}
if [ "$(id -u)" = 0 ] && [ "$(uid_of "$ROOT/.")" != 0 ]; then
  if ! { roots "${AGENT_DATA_DIR:-$ROOT/data}/agent.db" || roots "$ROOT/versions/active" || started_by_a_service; }; then
    uid=$(uid_of "$ROOT/.")
    who=$(stat -c %U "$ROOT/." 2>/dev/null || stat -f %Su "$ROOT/." 2>/dev/null || true)
    # GNU stat says UNKNOWN for a user this machine has no name for (a container): the number then.
    if [ -n "$who" ] && [ "$who" != UNKNOWN ]; then owner=$who as=$who
    elif [ -n "$uid" ]; then owner="the user with number $uid (no name on this machine)" as="that user"
    else owner="another user" as="that user"; fi
    asked=''
    [ $# -eq 0 ] || printf -v asked ' %q' "$@"
    echo "foxleague-agent: this install belongs to $owner, not to root: run it as $as, without sudo: cd $ROOT && ./cli.sh$asked" >&2
    exit 1
  fi
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
# would win over .env for Node.js and name another wallet (R2I-6). A .env without words (a container that passes them
# in) takes the words given, as run.sh does (FI-6): only a .env that has words of its own, or one that cannot be read,
# drops them. Node.js reads .env as the agent does and prints nothing.
if [ -n "${AGENT_MNEMONIC:-}" ]; then
  rc=0
  if [ -f "$AGENT_ENV_FILE" ]; then
    env -u AGENT_MNEMONIC "$NODE" -e '
      try { process.loadEnvFile(process.argv[1]) } catch { process.exit(4) }
      process.exit((process.env.AGENT_MNEMONIC ?? "").trim() ? 0 : 5)' "$AGENT_ENV_FILE" > /dev/null 2>&1 || rc=$?
  else
    rc=5
  fi
  [ "$rc" = 5 ] || unset AGENT_MNEMONIC
fi
exec "$NODE" --disable-warning=ExperimentalWarning "$CODE/src/cli.ts" "$@"
