#!/usr/bin/env bash
# One-line install of foxleague-agent (Linux, macOS, Windows through WSL2):
#
#   curl -fsSL https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.sh | bash
#
# Downloads the newest release into ~/foxleague-agent (no git needed) and starts the guided installer. Run
# it again to update: the code is replaced, your wallet words (.env), data, PEM files and keys are kept.
#   FOXAGENT_VERSION=vX.Y.Z  a given release instead of the newest; FOXAGENT_VERSION=main for untested code
#   FOXAGENT_DIR              another folder; FOXAGENT_SOURCE another archive (tests, mirrors)
set -euo pipefail

REPO=foxsyai/foxleague-agent
DIR=${FOXAGENT_DIR:-$HOME/foxleague-agent}
VERSION=${FOXAGENT_VERSION:-latest}

say() { printf '\n\033[1;33m%s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

for tool in curl tar; do command -v "$tool" >/dev/null 2>&1 || die "$tool is needed. Install it and run this again."; done
case "$(uname -s)" in
  Linux | Darwin) ;;
  *) die "run this on Linux or macOS. On Windows, install WSL2 (Ubuntu) and run it there." ;;
esac

if [ -n "${FOXAGENT_SOURCE:-}" ]; then
  SRC=$FOXAGENT_SOURCE
elif [ "$VERSION" = main ]; then
  SRC="https://github.com/$REPO/archive/refs/heads/main.tar.gz"
else
  if [ "$VERSION" = latest ]; then
    VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1 || true)
    [ -n "$VERSION" ] || die "could not find the newest release of $REPO"
  fi
  SRC="https://github.com/$REPO/archive/refs/tags/$VERSION.tar.gz"
fi

say "Downloading foxleague-agent ${VERSION} into $DIR"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$SRC" | tar -xz -C "$tmp" --strip-components=1 || die "could not download $SRC"
[ -f "$tmp/install.sh" ] || die "the download does not look like foxleague-agent"

mkdir -p "$DIR"
if [ -f "$DIR/install.sh" ]; then
  echo "  An existing install was found there: its code is updated, your wallet, keys and data are kept."
  rm -rf "$DIR/src" "$DIR/deploy" "$DIR/test" "$DIR/docs"
fi
# The archive holds no .env, data/, pem/ or keys, so copying over never touches them.
cp -R "$tmp/." "$DIR/"
chmod +x "$DIR/install.sh" "$DIR/get.sh" 2>/dev/null || true

[ "${FOXAGENT_NO_RUN:-0}" = 1 ] && { echo "  Downloaded (FOXAGENT_NO_RUN=1: installer not started)."; exit 0; }
say "Starting the installer"
# The installer asks questions: read the answers from the terminal, not from this piped script.
cd "$DIR"
exec ./install.sh </dev/tty
