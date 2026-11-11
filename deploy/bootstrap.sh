#!/usr/bin/env bash
# One-time (idempotent) server setup, run as root on the server: service user, Node for that user
# only (no system-wide install), directories, systemd unit. Does not start the service.
set -euo pipefail
NODE_VERSION=v22.22.0
# The SHA-256 of node-v22.22.0-linux-x64.tar.xz, read from https://nodejs.org/dist/v22.22.0/SHASUMS256.txt on
# 2026-11-11. Written here and not fetched with the download: a checksum list from the server that serves the
# archive proves nothing when that server hands out another program. Change it together with NODE_VERSION.
NODE_SHA256=9aa8e9d2298ab68c600bd6fb86a6c13bce11a4eca1ba9b39d79fa021755d7c37
BASE=/opt/foxleague-agent
# The repository copied to the server: the unit file is read from here, before the first deploy ships the code.
HERE="$(cd "$(dirname "$0")" && pwd)"

id foxleague-agent >/dev/null 2>&1 || useradd --system --home-dir "$BASE" --shell /usr/sbin/nologin foxleague-agent
install -d -o foxleague-agent -g foxleague-agent -m 755 "$BASE" "$BASE/app"
install -d -o foxleague-agent -g foxleague-agent -m 700 /var/lib/foxleague-agent
install -d -o root -g foxleague-agent -m 750 /etc/foxleague-agent
if [ ! -f /etc/foxleague-agent/env ]; then
  install -o foxleague-agent -g foxleague-agent -m 600 /dev/null /etc/foxleague-agent/env
fi

if [ "$("$BASE/node/bin/node" --version 2>/dev/null || true)" != "$NODE_VERSION" ]; then
  tmp=$(mktemp -d)
  tarball="node-$NODE_VERSION-linux-x64.tar.xz"
  curl -fsSL --proto '=https' --proto-redir '=https' -o "$tmp/$tarball" "https://nodejs.org/dist/$NODE_VERSION/$tarball"
  printf '%s  %s\n' "$NODE_SHA256" "$tmp/$tarball" | sha256sum -c - || { rm -rf "$tmp"; echo "The Node.js download is not the file this script expects: nothing was unpacked." >&2; exit 1; }
  rm -rf "$BASE/node" && mkdir -p "$BASE/node"
  tar -xJf "$tmp/$tarball" -C "$BASE/node" --strip-components=1
  chown -R root:root "$BASE/node"
  rm -rf "$tmp"
fi

install -m 644 "$HERE/foxleague-agent.service" /etc/systemd/system/foxleague-agent.service
systemctl daemon-reload
echo "bootstrap done: node $("$BASE/node/bin/node" --version); env file /etc/foxleague-agent/env ($(stat -c '%a %U' /etc/foxleague-agent/env))"
