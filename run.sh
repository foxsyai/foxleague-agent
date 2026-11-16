#!/usr/bin/env bash
# foxleague-agent launcher: what the background service starts.
#
# An install made by get.sh keeps each release in its own folder:
#   <root>/versions/v1.2.3/      the code of one release (with its node_modules)
#   <root>/versions/active       one line: the folder that runs
#   <root>/versions/pending      "<from> <to> <tries>" while an update has not proven that it starts
#   <root>/versions/rolled-back  "<from> <to>" after an update was undone here
#   <root>/.env  data/  pem/  .node/   yours; no update touches them
# A git checkout has no versions/ folder: the code is the folder itself.
#
# An update that does not start is undone: the service removes versions/pending once it is up. When this
# launcher finds it still there after two starts, it points versions/active back at the release that ran
# before and starts that one. This file is kept small on purpose: it must work even when a release is broken.
set -u

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# As root (sudo) on a folder another user owns: root's files in data/, versions/ or .env would keep the agent, which
# runs as that user, from starting again (INS-A8). An install that is root's own still runs, and so does one whose
# agent already runs as root there, its database root's (a container with the host's install mounted, a system unit
# without User=): the launcher an update puts in place must start it wherever the one it replaces did (R2I-2). "/."
# follows a link to the folder: stat does not follow one in the last part (R2I-1); the database is asked as it is, so a
# link to it is its maker's.
uid_of() { stat -c %u "$1" 2>/dev/null || stat -f %u "$1" 2>/dev/null || true; }
if [ "$(id -u)" = 0 ] && [ "$(uid_of "$ROOT/.")" != 0 ]; then
  db="${AGENT_DATA_DIR:-$ROOT/data}/agent.db"
  if ! { [ -f "$db" ] && [ ! -L "$db" ] && [ "$(uid_of "$db")" = 0 ]; }; then
    uid=$(uid_of "$ROOT/.")
    who=$(stat -c %U "$ROOT/." 2>/dev/null || stat -f %Su "$ROOT/." 2>/dev/null || true)
    # GNU stat says UNKNOWN for a user this machine has no name for (a container): the number then.
    if [ -n "$who" ] && [ "$who" != UNKNOWN ]; then owner=$who as=$who
    elif [ -n "$uid" ]; then owner="the user with number $uid (no name on this machine)" as="that user"
    else owner="another user" as="that user"; fi
    echo "foxleague-agent: this install belongs to $owner, not to root: run it as $as, without sudo: cd $ROOT && ./run.sh" >&2
    exit 1
  fi
fi
V="$ROOT/versions"
name_ok() { case "$1" in '' | .* | *[!A-Za-z0-9._-]*) return 1 ;; *) return 0 ;; esac; }

if [ -f "$V/active" ]; then
  if [ -f "$V/pending" ]; then
    from='' to='' tries=''
    read -r from to tries < "$V/pending" || true
    case "$tries" in '' | *[!0-9]*) tries=0 ;; esac
    if [ "$tries" -ge 2 ]; then
      if name_ok "$from" && [ -f "$V/$from/src/service.ts" ]; then
        printf '%s\n' "$from" > "$V/active.tmp" && mv -f "$V/active.tmp" "$V/active"
        printf '%s %s\n' "$from" "$to" > "$V/rolled-back"
        echo "foxleague-agent: the update to $to did not start twice, back on $from"
      fi
      rm -f "$V/pending"
    else
      printf '%s %s %s\n' "$from" "$to" "$((tries + 1))" > "$V/pending.tmp" && mv -f "$V/pending.tmp" "$V/pending"
    fi
  fi
  active=$(head -n 1 "$V/active" 2>/dev/null || true)
  name_ok "$active" || { echo "foxleague-agent: versions/active does not name a release; run the install line again" >&2; exit 1; }
  CODE="$V/$active"
else
  CODE="$ROOT"
fi
[ -f "$CODE/src/service.ts" ] || { echo "foxleague-agent: no code in $CODE; run the install line again" >&2; exit 1; }

NODE=''
# .node-path names the Node.js to start, one path per line, and the first one that is there wins: the installer
# writes the program itself, then the path it found it at (a version manager's path may last one shell only).
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
# Recovery words exported in this terminal win over .env for Node.js: the agent would start with another wallet than
# the one of this install's .env, the one its installer showed and asked to fund (R2I-6). Node.js compares them and
# prints nothing; a .env without words (a container that passes them in) takes the words given.
if [ -n "${AGENT_MNEMONIC:-}" ] && [ -f "$AGENT_ENV_FILE" ]; then
  rc=0
  FOXAGENT_GIVEN_WORDS="$AGENT_MNEMONIC" env -u AGENT_MNEMONIC "$NODE" -e '
    const words = (s) => (s ?? "").trim().split(/\s+/).join(" ")
    const given = words(process.env.FOXAGENT_GIVEN_WORDS)
    delete process.env.FOXAGENT_GIVEN_WORDS
    try { process.loadEnvFile(process.argv[1]) } catch { process.exit(4) }
    const file = words(process.env.AGENT_MNEMONIC)
    process.exit(!file || file === given ? 0 : 3)' "$AGENT_ENV_FILE" > /dev/null 2>&1 || rc=$?
  if [ "$rc" = 3 ]; then
    echo "foxleague-agent: AGENT_MNEMONIC is set in this terminal and its recovery words are not the ones in $AGENT_ENV_FILE: the agent would start with another wallet than this install's. Remove it (unset AGENT_MNEMONIC), then start again." >&2
    exit 1
  elif [ "$rc" != 0 ]; then
    echo "foxleague-agent: AGENT_MNEMONIC is set in this terminal and could not be compared with the recovery words in $AGENT_ENV_FILE: remove it (unset AGENT_MNEMONIC), then start again." >&2
    exit 1
  fi
fi
cd "$CODE" || exit 1
exec "$NODE" --disable-warning=ExperimentalWarning "$CODE/src/service.ts"
