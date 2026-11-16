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
cd "$CODE" || exit 1
exec "$NODE" --disable-warning=ExperimentalWarning "$CODE/src/service.ts"
