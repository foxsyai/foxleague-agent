#!/usr/bin/env bash
# foxleague-agent: one-command install on your own machine (Linux with systemd or macOS).
#
#   curl -fsSL https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.sh | bash
#   (or: git clone https://github.com/foxsyai/foxleague-agent.git && cd foxleague-agent && ./install.sh)
#
# Re-run it any time: it keeps your wallet, login and keys. It only asks for what is missing.
#   ./install.sh --update      get the latest version, update dependencies, restart
#   ./install.sh --uninstall   stop and remove the background service (your files and wallet stay)
#   ./install.sh --no-service  set everything up but do not install the background service
set -euo pipefail

NODE_VERSION=v22.22.0
SERVICE=foxleague-agent
PLIST_LABEL=ai.foxleague.agent
APP_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ENV_FILE="$APP_DIR/.env"
DATA_DIR="$APP_DIR/data"
PEM_DIR="$APP_DIR/pem"
TTY=${FOXAGENT_TTY:-/dev/tty}

say() { printf '\n\033[1;33m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
die() { printf '\n\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }
ask() { local a; read -r -p "  $1${2:+ [$2]}: " a < "$TTY"; printf '%s' "${a:-${2:-}}"; }
yes_no() { local a; a=$(ask "$1 (y/n)" "$2"); [[ $a =~ ^[Yy] ]]; }
# Paths go into the systemd unit (% is a specifier, " and \ are quoting) and the launchd plist (XML).
safe_path() { case "$1" in *[%\&\<\>\"\\]*) die "the path $1 holds one of % & < > \" \\; move the agent to a plain folder and run ./install.sh again";; esac; }

usage() { sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0; }
MODE=install
NO_SERVICE=0
for arg in "$@"; do
  case "$arg" in
    --update) MODE=update ;;
    --uninstall) MODE=uninstall ;;
    --no-service) NO_SERVICE=1 ;;
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
set_env() {
  local tmp
  tmp=$(mktemp "$APP_DIR/.env.XXXXXX")
  { grep -v "^$1=" "$ENV_FILE" 2>/dev/null || true; printf '%s="%s"\n' "$1" "$2"; } > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
}
get_env() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true; }

# ---- Node.js: a recent one on the system or a private copy in .node/ ----
node_ok() { [ -x "$1" ] && "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)' 2>/dev/null; }
ensure_node() {
  if node_ok "$APP_DIR/.node/bin/node"; then
    NODE="$APP_DIR/.node/bin/node"
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
    rm -rf "$APP_DIR/.node" && mkdir -p "$APP_DIR/.node"
    tar -xzf "$tmp/$tarball" -C "$APP_DIR/.node" --strip-components=1
    rm -rf "$tmp"
    NODE="$APP_DIR/.node/bin/node"
  fi
  export PATH="$(dirname "$NODE"):$PATH"
  info "Node.js $("$NODE" --version) at $NODE"
}
cli() { AGENT_ENV_FILE="$ENV_FILE" AGENT_DATA_DIR="$DATA_DIR" "$NODE" --disable-warning=ExperimentalWarning "$APP_DIR/src/cli.ts" "$@"; }

# ---- background service: systemd user service on Linux, launchd agent on macOS ----
UNIT="$HOME/.config/systemd/user/$SERVICE.service"
PLIST="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"
service_installed() { if [ "$PLATFORM" = linux ]; then [ -f "$UNIT" ]; else [ -f "$PLIST" ]; fi; }
service_restart() {
  if [ "$PLATFORM" = linux ]; then systemctl --user restart "$SERVICE"; else launchctl kickstart -k "gui/$(id -u)/$PLIST_LABEL"; fi
}
install_service() {
  safe_path "$APP_DIR"; safe_path "$NODE"
  if [ "$PLATFORM" = linux ]; then
    systemctl --user show-environment >/dev/null 2>&1 || die "systemd user services are not available here. On WSL2, enable systemd in /etc/wsl.conf; or run ./install.sh --no-service and start the agent with: npm start"
    mkdir -p "$(dirname "$UNIT")"
    cat > "$UNIT" <<EOF
[Unit]
Description=foxleague-agent: AI team manager for FoxLeague
After=network-online.target
StartLimitIntervalSec=600
StartLimitBurst=3

[Service]
WorkingDirectory=$APP_DIR
Environment="AGENT_ENV_FILE=$ENV_FILE" "AGENT_DATA_DIR=$DATA_DIR"
ExecStart="$NODE" --disable-warning=ExperimentalWarning "$APP_DIR/src/service.ts"
Restart=on-failure
RestartSec=30
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
  <key>ProgramArguments</key><array><string>$NODE</string><string>--disable-warning=ExperimentalWarning</string><string>$APP_DIR/src/service.ts</string></array>
  <key>WorkingDirectory</key><string>$APP_DIR</string>
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

if [ "$MODE" = update ]; then
  say "Updating foxleague-agent"
  if [ -d "$APP_DIR/.git" ]; then
    git -C "$APP_DIR" pull --ff-only
  else
    # Installed with get.sh: download the latest code over it (wallet, keys and data are kept).
    FOXAGENT_DIR="$APP_DIR" FOXAGENT_NO_RUN=1 bash "$APP_DIR/get.sh"
  fi
  ensure_node
  (cd "$APP_DIR" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error)
  if [ "$NO_SERVICE" = 0 ]; then
    if service_installed; then service_restart && info "Restarted."; else install_service && info "Installed and started."; fi
  fi
  exit 0
fi

say "foxleague-agent installer"
info "It sets up local agents that manage FoxLeague teams for you, with a dashboard on this machine."
info "Nothing is shared with anyone: your wallet words and keys stay in this folder."

say "1/7 Node.js and dependencies"
ensure_node
(cd "$APP_DIR" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error)
mkdir -p "$DATA_DIR" && chmod 700 "$DATA_DIR"
[ -f "$ENV_FILE" ] || install -m 600 /dev/null "$ENV_FILE"

say "2/7 Your wallet"
had_words=$(get_env AGENT_MNEMONIC)
cli setup | grep -v 'backup-words' || true
if [ -z "$had_words" ]; then
  info ""
  info "A new wallet was created. Its recovery words are the ONLY way to get your funds back."
  info "Write them down on paper now. Never type them into a website, a chat or a screenshot."
  info ""
  cli backup-words
  info ""
  until [ "$(ask 'Type yes when the words are written down')" = yes ]; do :; done
  clear 2>/dev/null || true
  info "Good. The words stay in $ENV_FILE (readable only by you)."
else
  info "Your existing wallet is kept."
fi

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

  2. Telegram, optional (every action on your phone, talk to your manager):
     a. In Telegram, open BotFather:    https://t.me/BotFather
     b. Send /newbot, pick a name and a username ending in bot.
     c. Copy the token it sends you (it looks like 123456789:AAH...).
     d. The installer then shows a 6-digit code: send it to your new Telegram bot.

  3. CEX top-up, optional (automatic EGLD top-ups from an exchange, coming in a later version).
     The example is Binance:
     a. API Management:                 https://www.binance.com/en/my/settings/api-management
     b. Create API, System generated, name foxleague-agent, confirm with 2FA.
     c. Edit restrictions: only Enable Withdrawals, restricted to this computer's IP
        (your IP: https://api.ipify.org). Never tick trading.
     d. Whitelist the agent wallet on the MultiversX (EGLD) network:
                                        https://www.binance.com/en/my/security/address-management

  Nothing you paste is shown on screen. Press Enter at any key to skip it.

KEYS
if yes_no "Enter keys now?" y; then
  cli configure < "$TTY"
else
  info "Skipped. Add them any time in the dashboard: Keys."
fi

say "5/7 Settings"
[ -n "$(get_env AGENT_COUNT)" ] || set_env AGENT_COUNT 1
set_env AGENT_PEM_DIR "$PEM_DIR"
info "The agents start in DRY RUN: they plan and simulate, nothing is signed."
info "When you are happy, press Go LIVE in the dashboard. This machine still has to allow it:"
if yes_no "Allow this machine to sign real transactions once you press Go LIVE?" y; then
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
  info "Start the agent yourself with: npm start"
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
