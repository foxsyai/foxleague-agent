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
#   FOXAGENT_DIR             another folder (empty, or an install of foxleague-agent)
#   FOXAGENT_RELEASES        another place that publishes the releases (a mirror, a test)
#   FOXAGENT_SOURCE          an archive (file or URL) to install as it is, with no checksum (tests)
#   FOXAGENT_ALLOW_DOWNGRADE=1  put an older version over a newer install (its newer settings and limits are not applied)
#   FOXAGENT_ALLOW_ROOT=1    run as root (not advised: see docs/SERVER.md for a server)
#
# What is trusted here: GitHub over https, as for this script itself. The updates that an installed agent takes
# later are checked against the maintainers' signature, with the key that came with the installed code.
#
# The whole script is one function, called on the last line. A download of this file that was cut short is then
# a script that does not parse, and nothing of it runs: never a half of it.
set -euo pipefail

main() {
  REPO=foxsyai/foxleague-agent
  DIR=${FOXAGENT_DIR:-$HOME/foxleague-agent}
  VERSION=${FOXAGENT_VERSION:-latest}
  RELEASES=${FOXAGENT_RELEASES:-https://github.com/$REPO/releases}

  say() { printf '\n\033[1;33m%s\033[0m\n' "$*"; }
  die() { printf '\n\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

  for tool in curl tar; do command -v "$tool" >/dev/null 2>&1 || die "$tool is needed and is not installed. Install it (on Ubuntu or Debian: sudo apt install $tool), then paste the line again."; done
  case "$(uname -s)" in
    Linux | Darwin) ;;
    *) die "run this on Linux or macOS. On Windows, install WSL2 (Ubuntu) and run it there." ;;
  esac
  if [ "$(id -u)" = 0 ] && [ "${FOXAGENT_ALLOW_ROOT:-0}" != 1 ]; then
    die "do not install the agent as root: create a user for it (adduser fox, then log in as fox and paste the line again), or follow docs/SERVER.md for a server. To install as root anyway, put FOXAGENT_ALLOW_ROOT=1 in front of bash."
  fi
  [ -n "$DIR" ] && [ "$DIR" != / ] || die "FOXAGENT_DIR must name a folder of its own"
  case "$DIR" in /*) ;; *) DIR="$PWD/$DIR" ;; esac
  [ ! -e "$DIR/.git" ] || die "$DIR is a git checkout. Update it there with: git pull && ./install.sh --update"
  # Root (FOXAGENT_ALLOW_ROOT=1) over a folder another user owns: root's files there would keep that user's agent from
  # starting again (INS-A8). "/." follows a link to the folder: stat does not follow one in the last part (R2I-1).
  if [ "$(id -u)" = 0 ] && [ -e "$DIR" ] && [ "$(stat -c %u "$DIR/." 2>/dev/null || stat -f %u "$DIR/." 2>/dev/null)" != 0 ]; then
    local who
    who=$(stat -c %U "$DIR/." 2>/dev/null || stat -f %Su "$DIR/." 2>/dev/null || true)
    die "$DIR belongs to ${who:-another user}, not to root: paste the line as ${who:-that user}, without sudo"
  fi

  # A download into a file. curl writes to its output and the shell puts that into the file: a curl that may not
  # write where it is told (the one of a snap has a /tmp of its own) still works that way.
  fetch() { curl -fsSL "$1" > "$2"; }
  sha256_of() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
  # One "key": "value" (or number) of the manifest, which is written one key per line.
  field() { sed -n "s/^ *\"$1\": *\"\{0,1\}\([^\",]*\)\"\{0,1\},\{0,1\} *\$/\1/p" "$2" | head -1; }
  named_foxleague() { [ -f "$1" ] && grep -q '"name": "foxleague-agent"' "$1"; }
  # True when version $1 is older than version $2 (both plain x.y.z, each part compared as a number).
  older_than() {
    local a b i
    IFS=. read -r -a a <<< "$1"
    IFS=. read -r -a b <<< "$2"
    for i in 0 1 2; do
      if [ "${a[$i]}" -lt "${b[$i]}" ]; then return 0; fi
      if [ "${a[$i]}" -gt "${b[$i]}" ]; then return 1; fi
    done
    return 1
  }
  # What is in $DIR: "install" (made by this script: versions/active), "flat" (an install made before releases
  # had their own folders: its package.json names foxleague-agent), "empty" (nothing, or only what a run of this
  # script that was interrupted left) or "other" (anything else: never written to and never removed from).
  folder_kind() {
    local e
    if [ ! -e "$DIR" ] && [ ! -L "$DIR" ]; then echo empty; return 0; fi
    if [ ! -d "$DIR" ]; then echo other; return 0; fi
    if [ -f "$DIR/versions/active" ]; then echo install; return 0; fi
    if named_foxleague "$DIR/package.json"; then echo flat; return 0; fi
    for e in "$DIR"/* "$DIR"/.[!.]* "$DIR"/..?*; do
      if [ ! -e "$e" ] && [ ! -L "$e" ]; then continue; fi
      if [ "$e" != "$DIR/versions" ] || [ ! -d "$e" ] || [ -L "$e" ]; then echo other; return 0; fi
    done
    for e in "$DIR/versions"/* "$DIR/versions"/.[!.]* "$DIR/versions"/..?*; do
      if [ ! -e "$e" ] && [ ! -L "$e" ]; then continue; fi
      case "${e##*/}" in
        .staging-get | .replaced-get | active.new) ;;
        v[0-9]*) if ! named_foxleague "$e/package.json"; then echo other; return 0; fi ;;
        *) echo other; return 0 ;;
      esac
    done
    echo empty
  }

  kind=$(folder_kind)
  [ "$kind" != other ] || die "$DIR is not empty and is not a foxleague-agent install: nothing was changed. Empty it, or name another folder with FOXAGENT_DIR."

  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  archive="$tmp/release.tar.gz"

  if [ -n "${FOXAGENT_SOURCE:-}" ]; then
    say "Installing foxleague-agent from $FOXAGENT_SOURCE into $DIR"
    if [ -f "$FOXAGENT_SOURCE" ]; then cp "$FOXAGENT_SOURCE" "$archive"; else fetch "$FOXAGENT_SOURCE" "$archive" || die "could not download $FOXAGENT_SOURCE"; fi
  elif [ "$VERSION" = main ]; then
    say "Downloading the untested main branch of foxleague-agent into $DIR"
    fetch "https://github.com/$REPO/archive/refs/heads/main.tar.gz" "$archive" || die "could not download the main branch"
  else
    if [ "$VERSION" = latest ]; then manifest_url="$RELEASES/latest/download/release.json"; else
      case "$VERSION" in v[0-9]*.[0-9]*.[0-9]*) ;; *) die "FOXAGENT_VERSION must look like v1.2.3" ;; esac
      manifest_url="$RELEASES/download/$VERSION/release.json"
    fi
    fetch "$manifest_url" "$tmp/release.json" || die "could not find the release at $manifest_url"
    ver=$(field version "$tmp/release.json")
    sum=$(field sha256 "$tmp/release.json")
    printf '%s' "$ver" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || die "the release manifest names no version"
    printf '%s' "$sum" | grep -Eq '^[0-9a-f]{64}$' || die "the release manifest names no checksum"
    [ "$VERSION" = latest ] || [ "$VERSION" = "v$ver" ] || die "asked for $VERSION, the server answered with v$ver"
    say "Downloading foxleague-agent $ver into $DIR"
    fetch "$RELEASES/download/v$ver/foxleague-agent-v$ver.tar.gz" "$archive" || die "could not download release $ver"
    [ "$(sha256_of "$archive")" = "$sum" ] || die "the download does not match the checksum of release $ver: nothing was installed. Try again; if it happens again, tell the maintainers."
    echo "  The download matches the release's checksum."
  fi

  # Looked at before it is unpacked. A release holds plain files and folders only: a link could point out of its
  # folder. And it never holds what belongs to an install (.env, data/, pem/, keys, node_modules, .node): an
  # archive that does was packed from a folder in use.
  listing=$(tar -tzf "$archive") || die "the download could not be read"
  verbose=$(tar -tvzf "$archive") || die "the download could not be read"
  # The first character of each line is the entry's kind, in GNU tar and bsdtar alike: - a file, d a folder.
  kinds=$(printf '%s\n' "$verbose" | cut -c1 | sort -u | tr -d '\n')
  case "$kinds" in
    '' | *[!d-]*) die "the download holds something that is not a plain file or folder (a link or a special file): nothing was installed" ;;
  esac
  if printf '%s\n' "$verbose" | grep -q -E ' (->|link to) '; then
    die "the download holds something that is not a plain file or folder (a link or a special file): nothing was installed"
  fi
  owned=$(printf '%s\n' "$listing" | sed 's|^[^/]*/||' | grep -E '(^|/)(\.env|\.node|node_modules)(/|$)|(^|/)\.env\.[^/]+(/|$)|^(data|pem|keys)(/|$)|\.pem(/|$)' | grep -v -E '(^|/)\.env\.example$' | head -3 | tr '\n' ' ' || true)
  [ -z "$owned" ] || die "the download holds files that belong to an install, not to a release (${owned% }): nothing was installed"

  # Unpack next to the releases, never over one: the folder is moved into place only when it is complete.
  made_dir=0
  made_versions=0
  [ -d "$DIR" ] || made_dir=1
  [ -d "$DIR/versions" ] || made_versions=1
  mkdir -p "$DIR/versions"
  staging="$DIR/versions/.staging-get"
  # Nothing of this run stays behind when it stops before the release is in place.
  give_up() {
    rm -rf "$staging"
    if [ "$made_versions" = 1 ]; then rmdir "$DIR/versions" 2>/dev/null || true; fi
    if [ "$made_dir" = 1 ]; then rmdir "$DIR" 2>/dev/null || true; fi
    die "$1"
  }
  rm -rf "$staging" && mkdir -p "$staging"
  tar -xzf "$archive" -C "$staging" --strip-components=1 || give_up "the download could not be unpacked"
  if [ ! -f "$staging/install.sh" ] || [ ! -f "$staging/run.sh" ] || ! named_foxleague "$staging/package.json"; then
    give_up "the download does not look like foxleague-agent"
  fi
  got=$(field version "$staging/package.json")
  printf '%s' "$got" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || give_up "the download names no version"
  if [ -n "${ver:-}" ] && [ "$got" != "$ver" ]; then give_up "the archive holds version $got, its manifest says $ver: nothing was installed"; fi
  name="v$got"

  # Never an older version over a newer install without the owner's word.
  installed=''
  if [ "$kind" = install ]; then
    cur=$(head -n 1 "$DIR/versions/active" 2>/dev/null || true)
    case "$cur" in '' | .* | *[!A-Za-z0-9._-]*) cur='' ;; esac
    if [ -n "$cur" ] && [ -f "$DIR/versions/$cur/package.json" ]; then installed=$(field version "$DIR/versions/$cur/package.json"); fi
  elif [ "$kind" = flat ]; then
    installed=$(field version "$DIR/package.json")
  fi
  if printf '%s' "$installed" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' && older_than "$got" "$installed"; then
    if [ "${FOXAGENT_ALLOW_DOWNGRADE:-0}" != 1 ]; then
      give_up "version $got is older than the $installed installed in $DIR: nothing was changed. An older version does not know the settings and limits added since, so limits you set would not be applied, and it may not read what the newer version saved. To go back anyway, put FOXAGENT_ALLOW_DOWNGRADE=1 in front of bash."
    fi
    echo "  Going back from $installed to $got because FOXAGENT_ALLOW_DOWNGRADE=1 says so."
    echo "  Settings and limits that $installed added are not applied by $got."
  fi

  if [ "$kind" = flat ]; then
    echo "  An older install was found there: its code is replaced once the installer has set up the new service; your wallet, keys and data are kept."
  elif [ "$kind" = install ]; then
    echo "  An existing install was found there: your wallet, keys and data are kept."
  fi
  # The installer asks its questions in a terminal. Without one (the line run over ssh without -t, or by a scheduled
  # job) it never ran, after the release it had no dependencies for was switched to (INS-A1): asked before anything
  # is changed.
  if [ "${FOXAGENT_NO_RUN:-0}" != 1 ] && ! { : < /dev/tty; } 2>/dev/null; then
    give_up "the installer asks its questions in a terminal and this line runs without one (over ssh without -t, or from a scheduled job): nothing was changed. Paste the line in a terminal (over SSH: log in first, or use ssh -t)."
  fi
  # Over an install, whose agent may be running, the new release gets Node.js and its dependencies here, in its
  # staging folder (its own install.sh --prepare, as an update from the dashboard does), and only a release that is
  # ready is put in place: a cut while npm runs (no network, a full disk, Ctrl-C, a closed window) leaves the agent as
  # it was (INS-A1, UPD-A5). The same holds for the version that runs: the line also repairs a damaged release folder,
  # so it is replaced, but only by a copy that has its dependencies. (A release from before the one-click update has
  # no --prepare: it is put in place as before and its installer gets the dependencies.)
  if [ "$kind" != empty ] && grep -q -e '--prepare)' "$staging/install.sh"; then
    echo "  Preparing it next to the installed version (Node.js and dependencies)"
    FOXAGENT_ROOT="$DIR" bash "$staging/install.sh" --prepare || give_up "version $got could not be prepared (see the lines above): nothing was changed and the agent runs as before. Check the connection, then paste the line again."
  fi
  # An install made before releases had their own folders keeps its code here for now: its background service starts
  # <folder>/src/service.ts by that path, until the installer writes the new service at its step 7 and removes the old
  # code (INS-U6). Cut before that (a closed window at a question), the old service still starts what it names.

  if [ -d "$DIR/versions/$name" ]; then
    rm -rf "$DIR/versions/.replaced-get"
    mv "$DIR/versions/$name" "$DIR/versions/.replaced-get"
  fi
  mv "$staging" "$DIR/versions/$name"
  rm -rf "$DIR/versions/.replaced-get"
  # Chosen by hand, so no undo note for the launcher.
  rm -f "$DIR/versions/pending" "$DIR/versions/rolled-back"
  # The release this one replaces is the spare that its first confirmed start keeps (versions/previous); without
  # this line an older spare was kept and the release that ran just before was deleted (W-11).
  if [ -n "${cur:-}" ] && [ "$cur" != "$name" ] && [ -d "$DIR/versions/$cur" ]; then
    printf '%s\n' "$cur" > "$DIR/versions/previous.new" && mv -f "$DIR/versions/previous.new" "$DIR/versions/previous"
  fi
  printf '%s\n' "$name" > "$DIR/versions/active.new" && mv -f "$DIR/versions/active.new" "$DIR/versions/active"

  if [ "${FOXAGENT_NO_RUN:-0}" = 1 ]; then echo "  Downloaded (FOXAGENT_NO_RUN=1: installer not started)."; exit 0; fi
  say "Starting the installer"
  rm -rf "$tmp"
  # The installer asks questions: read the answers from the terminal, not from this piped script.
  cd "$DIR"
  FOXAGENT_ROOT="$DIR" exec bash "$DIR/versions/$name/install.sh" </dev/tty
}

main "$@"; exit $?
