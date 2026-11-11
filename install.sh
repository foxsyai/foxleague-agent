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
  v=$(get_env AGENT_LIVE_ENABLED | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')
  case "$v" in
    1 | true) echo y ;;
    '') if [ "${FIRST_INSTALL:-0}" = 1 ]; then echo y; else echo n; fi ;;
    *) echo n ;;
  esac
}

# ---- Node.js: a recent one on the system or a private copy in .node/ ----
node_ok() { [ -x "$1" ] && "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)' 2>/dev/null; }
# Writes a file by rename, never in place: a script or a service that is reading the old one keeps it.
put_file() { # put_file <dest> <mode> ; content on stdin
  local tmp="$1.new.$$"
  cat > "$tmp"
  chmod "$2" "$tmp"
  mv -f "$tmp" "$1"
}
ensure_node() {
  if node_ok "$ROOT/.node/bin/node"; then
    NODE="$ROOT/.node/bin/node"
  elif command -v node >/dev/null 2>&1 && node_ok "$(command -v node)"; then
    NODE=$(command -v node)
  else
    info "Downloading Node.js $NODE_VERSION (a private copy, nothing is installed system-wide)"
    local tmp tarball
    tmp=$(mktemp -d)
    tarball="node-$NODE_VERSION-$PLATFORM-$NODE_ARCH.tar.gz"
    curl -fsSL -o "$tmp/$tarball" "https://nodejs.org/dist/$NODE_VERSION/$tarball"
    curl -fsSL -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
    if command -v sha256sum >/dev/null 2>&1; then
      (cd "$tmp" && grep " $tarball\$" SHASUMS256.txt | sha256sum -c - >/dev/null)
    else
      (cd "$tmp" && grep " $tarball\$" SHASUMS256.txt | shasum -a 256 -c - >/dev/null)
    fi || die "the Node.js download failed its checksum"
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
cli() { AGENT_ENV_FILE="$ENV_FILE" AGENT_DATA_DIR="$DATA_DIR" "$NODE" --disable-warning=ExperimentalWarning "$APP_DIR/src/cli.ts" "$@"; }
deps() { (cd "$APP_DIR" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error); }

# ---- the launcher: what the service starts. On an install made by get.sh it sits in ROOT with an install.sh
# that hands over to the active release; in a git checkout both are the checkout's own files. ----
install_launcher() {
  [ "$MANAGED" = 1 ] || return 0
  put_file "$ROOT/run.sh" 755 < "$APP_DIR/run.sh"
  [ -f "$APP_DIR/get.sh" ] && put_file "$ROOT/get.sh" 755 < "$APP_DIR/get.sh"
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
service_restart() {
  if [ "$PLATFORM" = linux ]; then systemctl --user restart "$SERVICE"; else launchctl kickstart -k "gui/$(id -u)/$PLIST_LABEL"; fi
}
install_service() {
  safe_path "$ROOT"; safe_path "$NODE"
  local bash_bin
  bash_bin=$(command -v bash)
  safe_path "$bash_bin"
  install_launcher
  if [ "$PLATFORM" = linux ]; then
    systemctl --user show-environment >/dev/null 2>&1 || die "systemd user services are not available here. On WSL2, enable systemd in /etc/wsl.conf; or run ./install.sh --no-service and start the agent with: ./run.sh"
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
    systemctl --user daemon-reload
    systemctl --user enable "$SERVICE" >/dev/null 2>&1
    systemctl --user restart "$SERVICE"
    # Keep it running after you log out (may need your password on some systems).
    loginctl enable-linger "$USER" >/dev/null 2>&1 || info "Note: the agent runs while you are logged in. To keep it running after logout: sudo loginctl enable-linger $USER"
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
    systemctl --user disable --now "$SERVICE" >/dev/null 2>&1 || true
    rm -f "$UNIT"
    systemctl --user daemon-reload >/dev/null 2>&1 || true
  else
    launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
    rm -f "$PLIST"
  fi
}
logs_hint() { if [ "$PLATFORM" = linux ]; then echo "journalctl --user -u $SERVICE -f"; else echo "tail -f $DATA_DIR/service.log"; fi; }

# ---- the three modes ----
if [ "$MODE" = uninstall ]; then
  say "Removing the background service"
  remove_service
  info "Stopped. Your folder, your wallet words (.env), your data and your PEM files are untouched."
  info "The agent wallets still hold their funds. Keep the backup words; delete the folder only when the wallets are empty."
  exit 0
fi

if [ "$MODE" = prepare ]; then
  # An update unpacked this release next to the running one and runs this before it switches. Only this
  # release's own folder and Node are touched: the running release, the database and the service are not.
  [ -n "${FOXAGENT_ROOT:-}" ] || die "--prepare is run by an update, not by hand"
  ensure_node
  deps
  exit 0
fi

if [ "$MODE" = update ]; then
  say "Updating foxleague-agent"
  if [ -d "$APP_DIR/.git" ]; then
    # A git checkout: git replaces files by new ones, so this script keeps reading the one it started from.
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
  if [ "$NO_SERVICE" = 0 ]; then
    if service_installed; then service_restart && info "Restarted."; else install_service && info "Installed and started."; fi
  else
    info "Start the agent again to run the new version."
  fi
  exit 0
fi

# Read before anything is written: later steps create the .env and may create the database.
FIRST_INSTALL=$(first_install)

say "foxleague-agent installer"
info "It sets up local agents that manage FoxLeague teams for you, with a dashboard on this machine."
info "Nothing is shared with anyone: your wallet words and keys stay in this folder."

say "1/7 Node.js and dependencies"
ensure_node
deps
install_launcher
mkdir -p "$DATA_DIR" && chmod 700 "$DATA_DIR"
[ -f "$ENV_FILE" ] || install -m 600 /dev/null "$ENV_FILE"

say "2/7 Your wallet"
had_words=$(get_env AGENT_MNEMONIC)
# The typed yes below is noted here. Until it exists every run shows the words and asks: a first run that ended
# before the yes (a closed terminal) must not leave an owner who never saw them again.
WORDS_CONFIRMED="$DATA_DIR/words-confirmed"
setup_rc=0
setup_out=$(cli setup 2>&1) || setup_rc=$?
printf '%s\n' "$setup_out" | grep -v 'backup-words' || true
[ "$setup_rc" = 0 ] || die "the wallet could not be set up (see the lines above). Nothing was created. Check AGENT_MNEMONIC in $ENV_FILE, then run the installer again."
if [ ! -f "$WORDS_CONFIRMED" ]; then
  info ""
  if [ -z "$had_words" ]; then
    info "A new wallet was created. Its recovery words are the ONLY way to get your funds back."
  else
    info "You have not confirmed yet that the recovery words of this wallet are written down."
    info "They are the ONLY way to get your funds back, so here they are again."
  fi
  info "Write them down on paper now. Never type them into a website, a chat or a screenshot."
  info ""
  cli backup-words
  info ""
  until [ "$(ask 'Type yes when the words are written down')" = yes ]; do :; done
  printf 'The owner typed yes at "Type yes when the words are written down" on %s.\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" | put_file "$WORDS_CONFIRMED" 600
  clear 2>/dev/null || true
  info "Good. The words stay in $ENV_FILE (readable only by you)."
  info "To see them again later, in this folder: ./cli.sh backup-words"
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
  cli set-web-password < "$TTY"
fi
port=$(get_env WEB_UI_PORT)
while :; do
  port=$(ask "Dashboard port on this machine" "${port:-8870}")
  [[ $port =~ ^[0-9]+$ ]] && [ "$port" -ge 1024 ] && [ "$port" -le 65535 ] && break
  info "Use a number from 1024 to 65535."
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
  Restart     $([ "$PLATFORM" = linux ] && echo "systemctl --user restart $SERVICE" || echo "launchctl kickstart -k gui/\$(id -u)/$PLIST_LABEL")
  Update      ./install.sh --update
  Uninstall   ./install.sh --uninstall

  Keep your recovery words safe. Anyone with them controls the agent wallets.
EOF
