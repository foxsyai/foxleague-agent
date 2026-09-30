#!/usr/bin/env bash
# One-time (idempotent) server setup, run as root on the server: service user, Node for that user
# only (no system-wide install), directories, systemd unit. Does not start the service.
set -euo pipefail
NODE_VERSION=v22.22.0
BASE=/opt/foxleague-agent

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
  curl -fsSL -o "$tmp/$tarball" "https://nodejs.org/dist/$NODE_VERSION/$tarball"
  curl -fsSL -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
  (cd "$tmp" && grep " $tarball\$" SHASUMS256.txt | sha256sum -c -)
  rm -rf "$BASE/node" && mkdir -p "$BASE/node"
  tar -xJf "$tmp/$tarball" -C "$BASE/node" --strip-components=1
  chown -R root:root "$BASE/node"
  rm -rf "$tmp"
fi

install -m 644 "$BASE/app/deploy/foxleague-agent.service" /etc/systemd/system/foxleague-agent.service
systemctl daemon-reload
echo "bootstrap done: node $("$BASE/node/bin/node" --version); env file /etc/foxleague-agent/env ($(stat -c '%a %U' /etc/foxleague-agent/env))"
