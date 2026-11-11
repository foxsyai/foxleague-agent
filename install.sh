#!/usr/bin/env bash
# foxleague-agent: one-command install on your own machine (Linux with systemd or macOS).
#
#   curl -fsSL https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.sh | bash
#   (or: git clone https://github.com/foxsyai/foxleague-agent.git && cd foxleague-agent && ./install.sh)
#
# Re-run it any time: it keeps your wallet, login and keys, and offers your earlier answers as the defaults.
#   ./install.sh --update      get the newest signed release, prepare it, restart into it
#   ./install.sh --uninstall   stop and remove the background service (your files and wallet stay)
#   ./install.sh --no-service  set everything up but do not install the background service
# (The dashboard's Update now and Telegram's /upgrade do what --update does, without a terminal.)
set -euo pipefail

NODE_VERSION=v22.22.0
SERVICE=foxleague-agent
PLIST_LABEL=ai.foxleague.agent
# APP_DIR: the code of this release. ROOT: the install's folder, with what is yours (.env, data/, pem/) and Node.
# An install made by get.sh keeps each release in ROOT/versions/<name> and names the running one in
# ROOT/versions/active (run.sh tells the whole layout); a git checkout is its own root.
APP_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
if [ -n "${FOXAGENT_ROOT:-}" ]; then
  [ -d "$FOXAGENT_ROOT" ] || { printf 'Error: FOXAGENT_ROOT is not a folder\n' >&2; exit 1; }
  ROOT=$(cd "$FOXAGENT_ROOT" && pwd)
elif [ "$(basename "$(dirname "$APP_DIR")")" = versions ] && [ -f "$(dirname "$APP_DIR")/active" ]; then
  ROOT=$(cd "$APP_DIR/../.." && pwd)
else
  ROOT=$APP_DIR
fi
MANAGED=0
[ "$ROOT" != "$APP_DIR" ] && MANAGED=1
ENV_FILE="$ROOT/.env"
DATA_DIR="$ROOT/data"
PEM_DIR="$ROOT/pem"
TTY=${FOXAGENT_TTY:-/dev/tty}
# The user's name, asked from the system: USER is not set in every shell (one started by a tool, a small container).
USER_NAME=$(id -un 2>/dev/null || printf '%s' "${USER:-}")
# Where systemd keeps its runtime folders (a test names another place).
RUN_DIR=${FOXAGENT_RUN:-/run}

say() { printf '\n\033[1;33m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
die() { printf '\n\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }
ask() { local a; read -r -p "  $1${2:+ [$2]}: " a < "$TTY"; printf '%s' "${a:-${2:-}}"; }
yes_no() { local a; a=$(ask "$1 (y/n)" "$2"); [[ $a =~ ^[Yy] ]]; }
# Paths go into the systemd unit (% is a specifier, " and \ are quoting) and the launchd plist (XML).
safe_path() { case "$1" in *[%\&\<\>\"\\]*) die "the path $1 holds one of % & < > \" \\; move the agent to a plain folder and run ./install.sh again";; esac; }

usage() { sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0; }
MODE=install
NO_SERVICE=0
for arg in "$@"; do
  case "$arg" in
    --update) MODE=update ;;
    --uninstall) MODE=uninstall ;;
    --no-service) NO_SERVICE=1 ;;
    --prepare) MODE=prepare ;; # run by an update, inside the new release, before the switch
    -h | --help) usage ;;
    *) die "unknown option $arg (see --help)" ;;
  esac
done

case "$(uname -s)" in
  Linux) PLATFORM=linux ;;
  Darwin) PLATFORM=darwin ;;
  *) die "unsupported system $(uname -s): use Linux or macOS (on Windows, WSL2)" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) NODE_ARCH=x64 ;;
  aarch64 | arm64) NODE_ARCH=arm64 ;;
  *) die "unsupported processor $(uname -m)" ;;
esac
[ -f "$APP_DIR/package.json" ] && grep -q '"name": "foxleague-agent"' "$APP_DIR/package.json" || die "run install.sh from inside the foxleague-agent folder"
# The guided install as root: the agent holds the recovery words, reads data from outside and serves a dashboard,
# so it gets a user of its own. (An update and --uninstall of an install that already runs as root still work.)
if [ "$MODE" = install ] && [ "$(id -u)" = 0 ] && [ "${FOXAGENT_ALLOW_ROOT:-0}" != 1 ]; then
  die "do not install the agent as root: create a user for it (adduser fox, then log in as fox and run this again), or follow docs/SERVER.md for a server. To install as root anyway, put FOXAGENT_ALLOW_ROOT=1 in front of the command."
fi

# ---- .env helpers: one KEY="value" per line, mode 600 ----
# The recovery words live in this file, so set_env never loses a line of it: every line but the key's own is
# copied to a new file, the lines are counted another way (wc, not grep) and only then the new file takes the
# place of .env. grep -a and LC_ALL=C: a NUL byte or a byte outside the locale (a line appended from Windows)
# must not make grep treat the file as binary and print nothing.
count_lines() { # lines of a file; a last line without its line end is a line too
  local n
  n=$(wc -l < "$1")
  if [ -s "$1" ] && [ "$(tail -c 1 "$1" | wc -l)" -eq 0 ]; then n=$((n + 1)); fi
  printf '%s' "$((n))"
}
set_env() {
  local tmp rc=0 had=0 gone=0 kept
  tmp=$(mktemp "$ROOT/.env.XXXXXX")
  chmod 600 "$tmp"
  if [ -e "$ENV_FILE" ]; then
    # grep ends with 0 (lines copied), 1 (none to copy: an empty file, or only this key) or 2 (an error).
    LC_ALL=C grep -a -v "^$1=" "$ENV_FILE" > "$tmp" || rc=$?
    if [ "$rc" -gt 1 ]; then rm -f "$tmp"; die "$ENV_FILE could not be read line by line: it was left as it is. Check the file, then run the installer again."; fi
    had=$(count_lines "$ENV_FILE")
    gone=$(LC_ALL=C grep -a -c "^$1=" "$ENV_FILE") || true
  fi
  kept=$(count_lines "$tmp")
  case "$gone" in '' | *[!0-9]*) gone=-1 ;; esac
  if [ "$kept" -ne $((had - gone)) ]; then rm -f "$tmp"; die "lines of $ENV_FILE would be lost: it was left as it is (it holds your recovery words). Check the file, then run the installer again."; fi
  printf '%s="%s"\n' "$1" "$2" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
}
get_env() { LC_ALL=C grep -a -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true; }

# The files that hold secrets, readable by the owner only. A folder that was copied to another machine or came
# back from a backup may have lost its modes; every run of this script puts them back. Nothing is created.
secure_modes() {
  local f loose=0
  mode_of() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1" 2>/dev/null || echo '?'; }
  if [ -f "$ENV_FILE" ]; then [ "$(mode_of "$ENV_FILE")" = 600 ] || loose=1; chmod 600 "$ENV_FILE"; fi
  for f in "$DATA_DIR" "$PEM_DIR"; do
    if [ -d "$f" ]; then [ "$(mode_of "$f")" = 700 ] || loose=1; chmod 700 "$f"; fi
  done
  if [ -d "$PEM_DIR" ]; then
    for f in "$PEM_DIR"/*.pem; do
      if [ -f "$f" ]; then [ "$(mode_of "$f")" = 600 ] || loose=1; chmod 600 "$f"; fi
    done
  fi
  if [ "$loose" = 1 ]; then info "Others on this machine could read your files: .env, data and pem are readable by you only again."; fi
}

# ---- the live permission: what Enter means at "Allow this machine to sign real transactions" ----
# A first install: no database yet and AGENT_LIVE_ENABLED nowhere in .env (not even commented out). A .env that
# cannot be searched counts as naming it: unknown is not absent.
first_install() {
  local rc=0
  if [ -e "$DATA_DIR/agent.db" ]; then echo 0; return 0; fi
  if [ -e "$ENV_FILE" ]; then
    LC_ALL=C grep -a -q 'AGENT_LIVE_ENABLED' "$ENV_FILE" || rc=$?
    if [ "$rc" != 1 ]; then echo 0; return 0; fi
  fi
  echo 1
}
# Yes only when .env already allows it (1 or true, what the agent itself accepts), or on a first install. Every
# other state (commented out, removed, false, off, no, 0) is off, and Enter keeps it off.
live_default() {
  local v
  # A line in another form (export, spaces around the name) is read by the agent and not by this script: with
  # one in the file, what the agent sees is not known here, so the answer is no.
  if LC_ALL=C grep -a -E '^[[:space:]]*(export[[:space:]]+)?AGENT_LIVE_ENABLED[[:space:]]*=' "$ENV_FILE" 2>/dev/null | LC_ALL=C grep -a -q -v '^AGENT_LIVE_ENABLED='; then echo n; return 0; fi
  v=$(get_env AGENT_LIVE_ENABLED | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')
  case "$v" in
    1 | true) echo y ;;
    '') if [ "${FIRST_INSTALL:-0}" = 1 ]; then echo y; else echo n; fi ;;
    *) echo n ;;
  esac
}

# ---- Node.js: one on the system that the agent runs on, or a private copy in .node/ ----
# The agent needs Node.js 22 from 22.18, or 24.2 and later: it runs TypeScript files as they are and starts
# through import.meta.main, which 23.x, 24.0 and 24.1 do not have (the service would load and end at once).
# package.json "engines" names the same range.
NODE_RULE='const [a,b]=process.versions.node.split(".").map(Number);process.exit((a===22&&b>=18)||(a===24&&b>=2)||a>24?0:1)'
node_ok() { [ -x "$1" ] && "$1" -e "$NODE_RULE" 2>/dev/null; }
# The SHA-256 of the four archives of NODE_VERSION, read from https://nodejs.org/dist/v22.22.0/SHASUMS256.txt on
# 2026-11-11. They are written here and not fetched with the download: a checksum list from the server that
# serves the archive proves nothing when that server, or the way to it, hands out another program.
# Change them together with NODE_VERSION.
node_sha256() {
  case "$PLATFORM-$NODE_ARCH" in
    linux-x64) echo c33c39ed9c80deddde77c960d00119918b9e352426fd604ba41638d6526a4744 ;;
    linux-arm64) echo 25ba95dfb96871fa2ef977f11f95ea90818c8fa15c0f2110771db08d4ba423be ;;
    darwin-x64) echo 5ea50c9d6dea3dfa3abb66b2656f7a4e1c8cef23432b558d45fb538c7b5dedce ;;
    darwin-arm64) echo 5ed4db0fcf1eaf84d91ad12462631d73bf4576c1377e192d222e48026a902640 ;;
    *) return 1 ;;
  esac
}
sha256_of() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
# Writes a file by rename, never in place: a script or a service that is reading the old one keeps it.
put_file() { # put_file <dest> <mode> ; content on stdin
  local tmp="$1.new.$$"
  cat > "$tmp"
  chmod "$2" "$tmp"
  mv -f "$tmp" "$1"
}
ensure_node() {
  local sys
  sys=$(command -v node 2>/dev/null || true)
  if node_ok "$ROOT/.node/bin/node"; then
    NODE="$ROOT/.node/bin/node"
  elif [ -n "$sys" ] && node_ok "$sys" && [ -x "$(dirname "$sys")/npm" ]; then
    # Only with npm beside it: some systems package npm apart, and the dependencies are installed with it.
    NODE=$sys
  else
    info "Downloading Node.js $NODE_VERSION (a private copy, nothing is installed system-wide)"
    local tmp tarball want got
    want=$(node_sha256) || die "no Node.js archive is known for $PLATFORM-$NODE_ARCH: install Node.js 22 (22.18 or later) with npm yourself and run this again"
    command -v curl >/dev/null 2>&1 || die "curl is needed and is not installed. Install it (on Ubuntu or Debian: sudo apt install curl), then run this again."
    tmp=$(mktemp -d)
    tarball="node-$NODE_VERSION-$PLATFORM-$NODE_ARCH.tar.gz"
    curl -fsSL --proto '=https' --proto-redir '=https' -o "$tmp/$tarball" "https://nodejs.org/dist/$NODE_VERSION/$tarball" || { rm -rf "$tmp"; die "Node.js could not be downloaded from nodejs.org. Check the connection and run this again."; }
    got=$(sha256_of "$tmp/$tarball")
    if [ "$got" != "$want" ]; then
      rm -rf "$tmp"
      die "the Node.js download is not the file this installer expects (SHA-256 $got, expected $want): nothing was unpacked. Try again; if it happens again, tell the maintainers."
    fi
    # Unpacked aside and moved in: a running agent keeps the Node it started with until its next start.
    rm -rf "$ROOT/.node.new" && mkdir -p "$ROOT/.node.new"
    tar -xzf "$tmp/$tarball" -C "$ROOT/.node.new" --strip-components=1
    rm -rf "$tmp" "$ROOT/.node.old"
    [ -d "$ROOT/.node" ] && mv "$ROOT/.node" "$ROOT/.node.old"
    mv "$ROOT/.node.new" "$ROOT/.node"
    rm -rf "$ROOT/.node.old"
    NODE="$ROOT/.node/bin/node"
  fi
  # The launcher (run.sh) reads which Node to start the agent with.
  printf '%s\n' "$NODE" | put_file "$ROOT/.node-path" 644
  export PATH="$(dirname "$NODE"):$PATH"
  info "Node.js $("$NODE" --version) at $NODE"
}
# FOXAGENT_GUIDED=1: the command line leaves out the lines that are written for a server set up by hand.
cli() { FOXAGENT_GUIDED=1 AGENT_ENV_FILE="$ENV_FILE" AGENT_DATA_DIR="$DATA_DIR" "$NODE" --disable-warning=ExperimentalWarning "$APP_DIR/src/cli.ts" "$@"; }
# Without npm's own chatter (its spinner and its "new version of npm available, to update run ..." notice):
# a newcomer reads that notice as something to do.
deps() { (cd "$APP_DIR" && npm_config_update_notifier=false npm_config_progress=false npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error); }

# ---- the launcher (run.sh: what the service starts) and the command line (cli.sh). On an install made by get.sh
# they sit in ROOT with an install.sh that hands over to the active release; in a git checkout all three are the
# checkout's own files. ----
install_launcher() {
  [ "$MANAGED" = 1 ] || return 0
  put_file "$ROOT/run.sh" 755 < "$APP_DIR/run.sh"
  if [ -f "$APP_DIR/cli.sh" ]; then put_file "$ROOT/cli.sh" 755 < "$APP_DIR/cli.sh"; fi
  if [ -f "$APP_DIR/get.sh" ]; then put_file "$ROOT/get.sh" 755 < "$APP_DIR/get.sh"; fi
  put_file "$ROOT/install.sh" 755 <<'SHIM'
#!/usr/bin/env bash
# foxleague-agent: runs the installer of the release that is active (./install.sh --update, --uninstall, --help).
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
active=$(head -n 1 "$ROOT/versions/active" 2>/dev/null || true)
case "$active" in '' | .* | *[!A-Za-z0-9._-]*) echo "foxleague-agent: versions/active does not name a release; paste the install line again" >&2; exit 1 ;; esac
FOXAGENT_ROOT="$ROOT" exec bash "$ROOT/versions/$active/install.sh" "$@"
SHIM
}

# ---- background service: systemd user service on Linux, launchd agent on macOS ----
UNIT="$HOME/.config/systemd/user/$SERVICE.service"
PLIST="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"
service_installed() { if [ "$PLATFORM" = linux ]; then [ -f "$UNIT" ]; else [ -f "$PLIST" ]; fi; }
# The user's own service manager (systemd --user) on Linux. It is reached through the user's runtime folder,
# /run/user/<uid>. A terminal opened with su or sudo has no XDG_RUNTIME_DIR, so systemctl --user finds nothing
# there although the manager runs, or would run with linger (which the installer turns on at its last step
# anyway, and which a user may turn on for themselves). `find_user_systemd start` may start it that way.
user_systemd() { systemctl --user show-environment >/dev/null 2>&1; }
find_user_systemd() {
  [ "$PLATFORM" = linux ] || return 0
  if user_systemd; then return 0; fi
  local dir _
  dir="$RUN_DIR/user/$(id -u)"
  if [ ! -d "$dir" ] && [ "${1:-}" = start ] && loginctl enable-linger "$USER_NAME" >/dev/null 2>&1; then
    for _ in 1 2 3 4 5 6 7 8 9 10; do if [ -d "$dir" ]; then break; fi; sleep 0.5; done
  fi
  [ -d "$dir" ] || return 1
  export XDG_RUNTIME_DIR="$dir"
  # A manager that linger has just started needs a moment before it answers.
  for _ in 1 2 3 4 5 6 7 8 9 10; do if user_systemd; then return 0; fi; sleep 0.5; done
  return 1
}
# Why there is no service manager to use, in words for the newcomer, with commands that exist.
no_user_systemd() {
  if [ -d "$RUN_DIR/systemd/system" ]; then
    die "the background services of the user $USER_NAME cannot be reached from this terminal. That happens in a terminal opened with su or sudo. Log in as $USER_NAME itself (a new terminal, or ssh $USER_NAME@this-machine) and run the installer again: cd $ROOT && ./install.sh"
  fi
  die "this machine does not run systemd, which keeps the agent running in the background. On Windows (WSL2): add the two lines [boot] and systemd=true to /etc/wsl.conf, run wsl --shutdown in PowerShell, open Ubuntu again and run the installer again: cd $ROOT && ./install.sh   Without systemd: cd $ROOT && ./install.sh --no-service   and start the agent yourself with ./run.sh"
}
# A restart that the owner asked for. The unit's start limit (5 starts in 10 minutes) is there to end a crash
# loop; systemd counts this restart against it too and, at the limit, stops the agent and refuses to start it.
# reset-failed clears that count first.
service_restart() {
  if [ "$PLATFORM" = linux ]; then
    systemctl --user reset-failed "$SERVICE" >/dev/null 2>&1 || true
    systemctl --user restart "$SERVICE"
  else
    launchctl kickstart -k "gui/$(id -u)/$PLIST_LABEL"
  fi
}
install_service() {
  safe_path "$ROOT"; safe_path "$NODE"
  local bash_bin
  bash_bin=$(command -v bash)
  safe_path "$bash_bin"
  install_launcher
  if [ "$PLATFORM" = linux ]; then
    find_user_systemd start || no_user_systemd
    mkdir -p "$(dirname "$UNIT")"
    cat > "$UNIT" <<EOF
[Unit]
Description=foxleague-agent: AI team manager for FoxLeague
After=network-online.target
StartLimitIntervalSec=600
StartLimitBurst=5

[Service]
WorkingDirectory=$ROOT
Environment="AGENT_ENV_FILE=$ENV_FILE" "AGENT_DATA_DIR=$DATA_DIR"
ExecStart="$bash_bin" "$ROOT/run.sh"
Restart=on-failure
RestartSec=30
# 75: the agent put an update in place and asks to be started again (run.sh then starts the new release).
SuccessExitStatus=75
RestartForceExitStatus=75
TimeoutStopSec=180
UMask=0077
NoNewPrivileges=true
LockPersonality=true
RestrictRealtime=true
RestrictSUIDSGID=true
RestrictNamespaces=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
SystemCallArchitectures=native
SystemCallFilter=@system-service
SystemCallFilter=~@privileged @resources
SystemCallErrorNumber=EPERM

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload || die "the background service could not be set up (systemctl --user daemon-reload failed, see the line above). Run the installer again: cd $ROOT && ./install.sh"
    systemctl --user enable "$SERVICE" >/dev/null 2>&1 || die "the background service could not be set to start by itself (systemctl --user enable $SERVICE failed). Run the installer again: cd $ROOT && ./install.sh"
    service_restart || die "the background service did not start. See why: journalctl --user -u $SERVICE -n 30   Then run the installer again: cd $ROOT && ./install.sh"
    # Keep it running after you log out (may need your password on some systems).
    loginctl enable-linger "$USER_NAME" >/dev/null 2>&1 || info "Note: the agent runs while you are logged in. To keep it running after logout: sudo loginctl enable-linger $USER_NAME"
  else
    mkdir -p "$(dirname "$PLIST")"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$PLIST_LABEL</string>
  <key>ProgramArguments</key><array><string>$bash_bin</string><string>$ROOT/run.sh</string></array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key><dict><key>AGENT_ENV_FILE</key><string>$ENV_FILE</string><key>AGENT_DATA_DIR</key><string>$DATA_DIR</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ExitTimeOut</key><integer>180</integer>
  <key>StandardOutPath</key><string>$DATA_DIR/service.log</string>
  <key>StandardErrorPath</key><string>$DATA_DIR/service.log</string>
</dict></plist>
EOF
    launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
  fi
}
remove_service() {
  if [ "$PLATFORM" = linux ]; then
    # Never "Stopped." for a service that could not be asked to stop: the agent would keep playing.
    if [ -f "$UNIT" ] && ! find_user_systemd; then
      die "the background service cannot be reached from this terminal, so it was not stopped and not removed. That happens in a terminal opened with su or sudo. Log in as $USER_NAME itself and run this again: cd $ROOT && ./install.sh --uninstall"
    fi
    systemctl --user disable --now "$SERVICE" >/dev/null 2>&1 || true
    if systemctl --user is-active --quiet "$SERVICE" 2>/dev/null; then
      die "the background service is still running: it did not stop. Stop it with: systemctl --user stop $SERVICE   then run this again: cd $ROOT && ./install.sh --uninstall"
    fi
    rm -f "$UNIT"
    systemctl --user daemon-reload >/dev/null 2>&1 || true
  else
    launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
    rm -f "$PLIST"
  fi
}
restart_hint() { if [ "$PLATFORM" = linux ]; then echo "systemctl --user restart $SERVICE"; else echo "launchctl kickstart -k gui/\$(id -u)/$PLIST_LABEL"; fi; }
# After a restart that failed: what runs now, and a command that systemd takes even at the unit's start limit.
after_failed_restart() {
  # Only a service manager that answers can say that nothing runs: one that cannot be reached stopped nothing.
  if [ "$PLATFORM" = linux ] && user_systemd && ! systemctl --user is-active --quiet "$SERVICE" 2>/dev/null; then
    echo "the agent is not running now. Start it yourself: systemctl --user reset-failed $SERVICE && systemctl --user restart $SERVICE"
  else
    echo "the old version is still the one running. Restart it yourself: $(restart_hint)"
  fi
}
logs_hint() { if [ "$PLATFORM" = linux ]; then echo "journalctl --user -u $SERVICE -f"; else echo "tail -f $DATA_DIR/service.log"; fi; }

# ---- the three modes ----
if [ "$MODE" = uninstall ]; then
  say "Removing the background service"
  remove_service
  info "Stopped. Your folder, your wallet words (.env), your data and your PEM files are untouched."
  info "The agent wallets still hold their funds. Keep the backup words; delete the folder only when the wallets are empty."
  # The installer turned linger on so the agent runs with nobody logged in. Other services of this user may
  # count on it by now, so it is told and not taken away.
  if [ "$PLATFORM" = linux ] && loginctl show-user "$USER_NAME" -p Linger 2>/dev/null | grep -q '^Linger=yes'; then
    info "Background services of the user $USER_NAME still start without a login (linger). To turn that off: loginctl disable-linger $USER_NAME"
  fi
  exit 0
fi

if [ "$MODE" = prepare ]; then
  # An update unpacked this release next to the running one and runs this before it switches. Only this
  # release's own folder and Node are touched: the running release, the database and the service are not.
  [ -n "${FOXAGENT_ROOT:-}" ] || die "--prepare is run by an update, not by hand"
  secure_modes
  ensure_node
  deps
  exit 0
fi

if [ "$MODE" = update ]; then
  say "Updating foxleague-agent"
  secure_modes
  if [ -d "$APP_DIR/.git" ]; then
    # A git checkout: git replaces files by new ones, so this script keeps reading the one it started from.
    info "This folder is a git checkout: it follows its branch ($(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)), which may hold code that is in no release yet."
    git -C "$APP_DIR" pull --ff-only
    ensure_node
    deps
    cli check-words || die "The agent was not restarted. Fix the recovery words as above, then run the update again."
  elif [ "$MANAGED" = 1 ]; then
    # The newest release is fetched, its signature and checksum are checked and it is prepared next to the
    # running one (by its own install.sh --prepare). Nothing of the running release is written to.
    ensure_node
    rc=0
    cli update || rc=$?
    if [ "$rc" = 3 ]; then exit 0; fi
    [ "$rc" = 0 ] || die "The update was not installed. The agent runs as before."
  else
    die "this folder was installed by an older installer. Paste the install line again once (your wallet, keys and data are kept); later updates are one click in the dashboard."
  fi
  # An update restarts the background service when there is one and never installs one: an install made with
  # --no-service is started by its owner, and a second agent beside it would use the same wallets.
  if [ "$NO_SERVICE" = 1 ] || ! service_installed; then
    info "No background service is installed here: start the agent again to run the new version ($ROOT/run.sh)."
    exit 0
  fi
  # A terminal opened with su or sudo: find the user's service manager first (see find_user_systemd).
  find_user_systemd || true
  service_restart || die "the new version is in place but the background service could not be restarted: $(after_failed_restart)"
  info "Restarted."
  exit 0
fi

# Read before anything is written: later steps create the .env and may create the database.
FIRST_INSTALL=$(first_install)

say "foxleague-agent installer"
info "It sets up local agents that manage FoxLeague teams for you, with a dashboard on this machine."
info "Nothing is shared with anyone: your wallet words and keys stay in this folder."

# What the install cannot do without, looked for before the first question: a newcomer who lacks it learns so
# here, not at step 7 after writing down the words and typing a login and keys. The launcher and ./install.sh go
# into the folder first, so that the commands these messages name exist.
install_launcher
for tool in curl tar; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is needed and is not installed. Install it (on Ubuntu or Debian: sudo apt install $tool), then run the installer again: cd $ROOT && ./install.sh"
done
if [ "$NO_SERVICE" != 1 ]; then find_user_systemd start || no_user_systemd; fi

say "1/7 Node.js and dependencies"
ensure_node
deps
install_launcher
mkdir -p "$DATA_DIR" && chmod 700 "$DATA_DIR"
[ -f "$ENV_FILE" ] || install -m 600 /dev/null "$ENV_FILE"
secure_modes

say "2/7 Your wallet"
# The typed yes below is noted here. Until it exists every run shows the words and asks: a first run that ended
# before the yes (a closed terminal) must not leave an owner who never saw them again.
WORDS_CONFIRMED="$DATA_DIR/words-confirmed"
setup_rc=0
setup_out=$(cli setup 2>&1) || setup_rc=$?
printf '%s\n' "$setup_out" | grep -v 'backup-words' || true
[ "$setup_rc" = 0 ] || die "the wallet could not be set up (see the lines above). Nothing was created. Check AGENT_MNEMONIC in $ENV_FILE, then run the installer again."
if [ ! -f "$WORDS_CONFIRMED" ]; then
  info ""
  # What the setup itself said, not what this script could read from .env.
  if printf '%s\n' "$setup_out" | grep -q '^New recovery words written'; then
    info "A new wallet was created. Its recovery words are the ONLY way to get your funds back."
  else
    info "You have not confirmed yet that the recovery words of this wallet are written down."
    info "They are the ONLY way to get your funds back, so here they are again."
  fi
  info "Write them down on paper now. Never type them into a website, a chat or a screenshot."
  info ""
  cli backup-words
  info ""
  # yes in any case is the yes (Yes, YES); every other answer is told what to type. Not for ever: a terminal
  # that cannot be read from answers nothing each time.
  asked=0
  while :; do
    case "$(ask 'Type yes when the words are written down')" in
      [Yy][Ee][Ss]) break ;;
    esac
    asked=$((asked + 1))
    [ "$asked" -lt 20 ] || die "no yes was typed. Run the installer again when you are ready to write the words down: cd $ROOT && ./install.sh"
    info "Type the word yes (then Enter) once the words are on paper. They are shown above."
  done
  printf 'The owner typed yes at "Type yes when the words are written down" on %s.\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" | put_file "$WORDS_CONFIRMED" 600
  clear 2>/dev/null || true
  info "Good. The words stay in $ENV_FILE (readable only by you)."
  info "To see them again later: cd $ROOT && ./cli.sh backup-words"
else
  info "Your existing wallet is kept."
fi
# Words changed in .env after the agents were made: say so here, not in a restart loop of the background service.
cli check-words || die "Fix the recovery words as above, then run the installer again."

say "3/7 Dashboard login"
if [ -n "$(get_env WEB_UI_PASSWORD_HASH)" ] && ! yes_no "A login is already set. Change it?" n; then
  info "Login kept."
else
  info "Choose the username and password for the dashboard."
  # A password that is too short or typed differently the second time is asked for again: it does not end the
  # install. Status 130 is Ctrl-C at the prompt, 2 a terminal that cannot be typed into: those end it.
  tries=0
  while :; do
    rc=0
    cli set-web-password < "$TTY" || rc=$?
    [ "$rc" != 0 ] || break
    [ "$rc" != 130 ] || exit 130
    tries=$((tries + 1))
    if [ "$rc" = 2 ] || [ "$tries" -ge 5 ]; then
      die "no dashboard login was saved. Run the installer again (your wallet is kept): cd $ROOT && ./install.sh"
    fi
    info "Nothing was saved. Try again: 3 to 32 letters or digits for the username, at least 12 characters for the password, typed the same both times."
  done
fi
# A port that another program already listens on is refused here: with it the agent would end at every start
# ("address already in use") until systemd gives up on it. bash opens the connection itself, no tool is needed.
# The port this install's own running agent holds (the one in .env, with its process alive) is its own.
port_taken() { (exec 3<> "/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
own_agent_runs() {
  local pid
  pid=$(head -n 1 "$DATA_DIR/service.pid" 2>/dev/null || true)
  case "$pid" in '' | *[!0-9]*) return 1 ;; esac
  kill -0 "$pid" 2>/dev/null
}
had_port=$(get_env WEB_UI_PORT)
port=$had_port
while :; do
  port=$(ask "Dashboard port on this machine" "${port:-8870}")
  if ! { [[ $port =~ ^[0-9]+$ ]] && [ "$port" -ge 1024 ] && [ "$port" -le 65535 ]; }; then
    info "Use a number from 1024 to 65535."
    continue
  fi
  if port_taken "$port" && ! { [ "$port" = "$had_port" ] && own_agent_runs; }; then
    info "Port $port is already used by another program on this machine. Choose another one."
    # The next one is offered as the default.
    if [ "$port" -lt 65535 ]; then port=$((port + 1)); fi
    continue
  fi
  break
done
set_env WEB_UI_PORT "$port"
# The dashboard listens on this machine only, over plain http, so the cookie cannot require https.
set_env WEB_UI_INSECURE_COOKIE 1

say "4/7 Keys (you can skip any of them now and add it later in the dashboard: Getting started, then Keys)"
cat <<'KEYS'

  1. AI key (Anthropic), needed for the agents to play. About 5 minutes:
     a. Sign up or log in:              https://platform.claude.com
     b. Add credit ($10 is plenty):     https://platform.claude.com/settings/billing
     c. Set a monthly limit ($20):      https://platform.claude.com/settings/limits
     d. Create a key, name it foxleague-agent, copy it (shown once):
                                        https://platform.claude.com/settings/keys

  2. Telegram, optional (a morning summary of every agent, talk to your manager):
     a. In Telegram, open BotFather:    https://t.me/BotFather
     b. Send /newbot, pick a name and a username ending in bot.
     c. Copy the token it sends you (it looks like 123456789:AAH...).
     d. The installer then shows a 6-digit code: send it to your new Telegram bot.

  3. CEX top-up, optional (EGLD top-ups from an exchange, each one approved by you on Telegram).
     The example is Binance:
     a. API Management:                 https://www.binance.com/en/my/settings/api-management
     b. Create API, System generated, name foxleague-agent, confirm with 2FA.
     c. Edit restrictions: only Enable Withdrawals, restricted to this computer's IP
        (your IP: https://api.ipify.org). Never tick trading.
     d. Whitelist the agent wallet on the MultiversX (EGLD) network:
                                        https://www.binance.com/en/my/security/address-management

  Nothing you paste is shown on screen. Press Enter at any key to skip it.

KEYS
# Keys already set: pressing Enter skips this step (they stay as they are).
if yes_no "Enter keys now?" "$([ -n "$(get_env ANTHROPIC_API_KEY)" ] && echo n || echo y)"; then
  cli configure < "$TTY"
else
  info "Skipped. Add them any time in the dashboard: Keys."
fi

say "5/7 Settings"
[ -n "$(get_env AGENT_COUNT)" ] || set_env AGENT_COUNT 1
set_env AGENT_PEM_DIR "$PEM_DIR"
info "A new install starts in DRY RUN: the agents plan and simulate, nothing is signed."
info "When you are happy, press Go LIVE in the dashboard. This machine still has to allow it:"
# A re-run offers what .env says now, so pressing Enter never turns live signing on by surprise.
if yes_no "Allow this machine to sign real transactions once you press Go LIVE?" "$(live_default)"; then
  set_env AGENT_LIVE_ENABLED 1
else
  set_env AGENT_LIVE_ENABLED 0
  info "Live signing stays off. Change AGENT_LIVE_ENABLED to 1 in .env and restart to allow it later."
fi

say "6/7 PEM files (to log into FoxLeague as your agents' teams and watch them)"
mkdir -p "$PEM_DIR" && chmod 700 "$PEM_DIR"
if [ -f "$PEM_DIR/agent1.pem" ]; then info "pem/agent1.pem already exists."; else cli export-pem 1 "$PEM_DIR/agent1.pem"; fi
info "Each new agent you add in the dashboard gets its own pem/agentN.pem automatically."

address=$(cli address 1 | sed -E 's/^agent 1: ([^ ]+).*/\1/')
if [ "$NO_SERVICE" = 1 ]; then
  say "7/7 Background service: skipped (--no-service)"
  info "Start the agent yourself with: $ROOT/run.sh"
else
  say "7/7 Background service"
  install_service
  for _ in $(seq 1 30); do
    curl -fsS "http://127.0.0.1:$port/healthz" >/dev/null 2>&1 && break
    sleep 1
  done
  curl -fsS "http://127.0.0.1:$port/healthz" >/dev/null 2>&1 && info "Running." || info "The dashboard is not answering yet. Check the log: $(logs_hint)"
fi

say "Done"
cat <<EOF

  Dashboard     http://localhost:$port   (user: $(get_env WEB_UI_USER))
  Agent 1       $address
  PEM files     $PEM_DIR

  Next steps
  1. Open the dashboard. Its Getting started guide walks you through the rest, step by step.
  2. Send EGLD to agent 1's wallet above (MultiversX network). About 5 EGLD is a good start:
     2.5 buys the 5,000 FOXSY registration, 1 stays as the gas reserve, the rest pays the first games.
  3. Agent 1 registers its team by itself once the EGLD arrives (in dry run it only simulates).
     Watch a few plans, set your caps and strategy, then press Go LIVE.

  Everyday commands
  Logs        $(logs_hint)
  Restart     $(restart_hint)
  The next three are typed in the agent's folder. Go there first:
              cd $ROOT
  Update      ./install.sh --update   (or press Update now in the dashboard)
  Uninstall   ./install.sh --uninstall
  Command line  ./cli.sh   (alone it lists the commands; ./cli.sh backup-words shows the recovery words)

  Keep your recovery words safe. Anyone with them controls the agent wallets.
EOF
