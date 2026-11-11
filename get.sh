#!/usr/bin/env bash
# One-line install of foxleague-agent (Linux, macOS, Windows through WSL2):
#
#   curl -fsSL https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.sh | bash
#
# Downloads the newest release into ~/foxleague-agent (no git needed), checks it against the checksum in its
# release manifest and starts the guided installer. Pasting the line again on an existing install puts the
# newest release in place and runs the installer again: your wallet words (.env), data, PEM files and keys are kept.
# Day to day you do not need this line: the dashboard offers every new release with one click (Update now).
#   FOXAGENT_VERSION=vX.Y.Z  a given release instead of the newest; FOXAGENT_VERSION=main for untested code
#   FOXAGENT_DIR             another folder
#   FOXAGENT_RELEASES        another place that publishes the releases (a mirror, a test)
#   FOXAGENT_SOURCE          an archive (file or URL) to install as it is, with no checksum (tests)
#
# What is trusted here: GitHub over https, as for this script itself. The updates that an installed agent takes
# later are checked against the maintainers' signature, with the key that came with the installed code.
set -euo pipefail

REPO=foxsyai/foxleague-agent
DIR=${FOXAGENT_DIR:-$HOME/foxleague-agent}
VERSION=${FOXAGENT_VERSION:-latest}
RELEASES=${FOXAGENT_RELEASES:-https://github.com/$REPO/releases}

say() { printf '\n\033[1;33m%s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

for tool in curl tar; do command -v "$tool" >/dev/null 2>&1 || die "$tool is needed. Install it and run this again."; done
case "$(uname -s)" in
  Linux | Darwin) ;;
  *) die "run this on Linux or macOS. On Windows, install WSL2 (Ubuntu) and run it there." ;;
esac
[ -n "$DIR" ] && [ "$DIR" != / ] || die "FOXAGENT_DIR must name a folder of its own"
case "$DIR" in /*) ;; *) DIR="$PWD/$DIR" ;; esac
[ ! -e "$DIR/.git" ] || die "$DIR is a git checkout. Update it there with: git pull && ./install.sh --update"

sha256_of() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
# One "key": "value" (or number) of the manifest, which is written one key per line.
field() { sed -n "s/^ *\"$1\": *\"\{0,1\}\([^\",]*\)\"\{0,1\},\{0,1\} *\$/\1/p" "$2" | head -1; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
archive="$tmp/release.tar.gz"

if [ -n "${FOXAGENT_SOURCE:-}" ]; then
  say "Installing foxleague-agent from $FOXAGENT_SOURCE into $DIR"
  if [ -f "$FOXAGENT_SOURCE" ]; then cp "$FOXAGENT_SOURCE" "$archive"; else curl -fsSL -o "$archive" "$FOXAGENT_SOURCE" || die "could not download $FOXAGENT_SOURCE"; fi
elif [ "$VERSION" = main ]; then
  say "Downloading the untested main branch of foxleague-agent into $DIR"
  curl -fsSL -o "$archive" "https://github.com/$REPO/archive/refs/heads/main.tar.gz" || die "could not download the main branch"
else
  if [ "$VERSION" = latest ]; then manifest_url="$RELEASES/latest/download/release.json"; else
    case "$VERSION" in v[0-9]*.[0-9]*.[0-9]*) ;; *) die "FOXAGENT_VERSION must look like v1.2.3" ;; esac
    manifest_url="$RELEASES/download/$VERSION/release.json"
  fi
  curl -fsSL -o "$tmp/release.json" "$manifest_url" || die "could not find the release at $manifest_url"
  ver=$(field version "$tmp/release.json")
  sum=$(field sha256 "$tmp/release.json")
  printf '%s' "$ver" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || die "the release manifest names no version"
  printf '%s' "$sum" | grep -Eq '^[0-9a-f]{64}$' || die "the release manifest names no checksum"
  [ "$VERSION" = latest ] || [ "$VERSION" = "v$ver" ] || die "asked for $VERSION, the server answered with v$ver"
  say "Downloading foxleague-agent $ver into $DIR"
  curl -fsSL -o "$archive" "$RELEASES/download/v$ver/foxleague-agent-v$ver.tar.gz" || die "could not download release $ver"
  [ "$(sha256_of "$archive")" = "$sum" ] || die "the download does not match the checksum of release $ver: nothing was installed. Try again; if it happens again, tell the maintainers."
  echo "  The download matches the release's checksum."
fi

# Unpack next to the releases, never over one: the folder is moved into place only when it is complete.
mkdir -p "$DIR/versions"
staging="$DIR/versions/.staging-get"
rm -rf "$staging" && mkdir -p "$staging"
tar -xzf "$archive" -C "$staging" --strip-components=1 || { rm -rf "$staging"; die "the download could not be unpacked"; }
if [ ! -f "$staging/install.sh" ] || [ ! -f "$staging/run.sh" ] || ! grep -q '"name": "foxleague-agent"' "$staging/package.json" 2>/dev/null; then
  rm -rf "$staging"
  die "the download does not look like foxleague-agent"
fi
got=$(field version "$staging/package.json")
printf '%s' "$got" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || { rm -rf "$staging"; die "the download names no version"; }
if [ -n "${ver:-}" ] && [ "$got" != "$ver" ]; then rm -rf "$staging"; die "the archive holds version $got, its manifest says $ver: nothing was installed"; fi
name="v$got"

# An install made before releases had their own folders: its code goes, everything of yours stays
# (.env, data/, pem/, the private Node in .node/).
if [ -d "$DIR/src" ] && [ -f "$DIR/package.json" ] && [ ! -f "$DIR/versions/active" ]; then
  echo "  An older install was found there: its code is replaced, your wallet, keys and data are kept."
  for old in src deploy test docs site scripts node_modules .github package.json package-lock.json tsconfig.json README.md INSTALL.md AGENTS.md CLAUDE.md install.sh get.sh run.sh; do
    rm -rf "${DIR:?}/$old"
  done
elif [ -f "$DIR/versions/active" ]; then
  echo "  An existing install was found there: your wallet, keys and data are kept."
fi

if [ -d "$DIR/versions/$name" ]; then
  rm -rf "$DIR/versions/.replaced-get"
  mv "$DIR/versions/$name" "$DIR/versions/.replaced-get"
fi
mv "$staging" "$DIR/versions/$name"
rm -rf "$DIR/versions/.replaced-get"
# Chosen by hand, so no undo note for the launcher.
rm -f "$DIR/versions/pending" "$DIR/versions/rolled-back"
printf '%s\n' "$name" > "$DIR/versions/active.new" && mv -f "$DIR/versions/active.new" "$DIR/versions/active"

[ "${FOXAGENT_NO_RUN:-0}" = 1 ] && { echo "  Downloaded (FOXAGENT_NO_RUN=1: installer not started)."; exit 0; }
say "Starting the installer"
# The installer asks questions: read the answers from the terminal, not from this piped script.
cd "$DIR"
FOXAGENT_ROOT="$DIR" exec bash "$DIR/versions/$name/install.sh" </dev/tty
