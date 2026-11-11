#!/usr/bin/env bash
# Builds agent.foxleague.ai from a fresh clone of one commit and ships it to the FOXSY website droplet.
#   ./site/deploy-site.sh [commit]        (default: the current commit)
# The host comes from SITE_HOST=web@host or site/.host (git ignores it). The deploy user needs no sudo.
# Never built from this working folder: Astro copies public/ as is, so a stray key there would be published.
# A clone holds only committed files. (Not git archive: .gitattributes keeps site/ out of archives.)
set -euo pipefail
REPO=$(cd "$(dirname "$0")/.." && pwd)
HOST=${SITE_HOST:-$(cat "$REPO/site/.host" 2>/dev/null || true)}
[ -n "$HOST" ] || { echo "Set SITE_HOST=web@your-website-server or write it into site/.host" >&2; exit 1; }
COMMIT=$(git -C "$REPO" rev-parse --verify "${1:-HEAD}^{commit}")
ROOT=/var/www/agent.foxleague.ai

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
git clone -q --no-hardlinks "$REPO" "$TMP/fb"
git -C "$TMP/fb" checkout -q "$COMMIT"
# --ignore-scripts: no install script of the site's dependencies runs on this computer (CI builds the same way).
(cd "$TMP/fb/site" && npm ci --ignore-scripts --no-audit --no-fund --loglevel=error && npm run build >/dev/null)
DIST=$TMP/fb/site/dist
[ -f "$DIST/index.html" ] && [ -f "$DIST/404.html" ] || { echo "The build has no index.html or 404.html: nothing shipped." >&2; exit 1; }
if find "$DIST" \( -iname '*.pem' -o -iname '.env*' -o -iname '*.key' -o -iname 'secrets*' \) | grep -q .; then
  echo "A key-like file is in the build: nothing shipped." >&2
  exit 1
fi

# The deploy user owns the site's folder and needs no sudo. The files stay readable by nginx.
rsync -rlptz --delete --no-owner --no-group --chmod=D755,F644 "$DIST/" "$HOST:$ROOT/"
ssh "$HOST" "printf '%s %s\n' '$(date -u +%FT%TZ)' '$COMMIT' >> $ROOT.deploys"
echo "agent.foxleague.ai now serves foxleague-agent $COMMIT (log: $ROOT.deploys on the server)"
