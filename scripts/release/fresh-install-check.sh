#!/usr/bin/env bash
# The install as a newcomer meets it, replayed on a fresh Ubuntu: run it before every release.
#
#   scripts/release/fresh-install-check.sh [--keep]
#   FRESH_UBUNTU=26.04 scripts/release/fresh-install-check.sh [--keep]
#
# Run it on both. Ubuntu 26.04's tar resolves every path it unpacks with openat2, which a hardened service may
# refuse (W-9 of 2026-11-13: the one-click update did not install there). FRESH_UBUNTU names the release, 24.04
# without it.
#
# It builds a throwaway Ubuntu container (24.04, or the release FRESH_UBUNTU names) that runs systemd (no curl,
# no Node.js, one ordinary user with sudo), builds releases of THIS folder as it is now (tracked files, also changes
# that are not committed yet) the way a real release is built (scripts/release/release.ts), signed with a key that is made here and thrown away,
# and then does what the guide tells a newcomer, typing the answers on a terminal:
#   the pasted line without curl, with curl, with mistakes (Yes, a short password); the checks after "Done";
#   a reboot with nobody logged in; the line pasted again; ./install.sh again, six times in a row; the line as
#   root; a second user reached with su; a machine without systemd; an update from the dashboard (and a second
#   click before it is confirmed), one from a terminal, one that does not start and one that ends at once with
#   status 0 (both undone by the launcher), one whose archive was changed after signing and one where no
#   background service runs the agent (put in place; the agent plays on until its owner starts it again);
#   the uninstall.
# Every check prints ok or FAILED; the script ends with status 1 when one failed. --keep leaves the containers,
# the image and the work folder (with what was on screen at every step) for a look; without it they are removed
# when every check passed. A run takes about twelve minutes.
#
# Needs: docker (the user in the docker group), node 22.18 or later with `npm ci` done in this folder, python3, git.
# Nothing here signs a transaction or needs a key: the wallet is a new one inside the container and the agent
# stays in dry run. The agent does read public data (the chain, FoxLeague) as every new install does.
# Everything it creates in Docker is named fox-fresh*; nothing else is touched.
set -uo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
KEEP=0
[ "${1:-}" = --keep ] && KEEP=1
UBUNTU=${FRESH_UBUNTU:-24.04}
case "$UBUNTU" in 24.04 | 26.04) ;; *) echo "FRESH_UBUNTU must be 24.04 or 26.04"; exit 2 ;; esac
IMAGE=fox-fresh-ubuntu:$UBUNTU
C=fox-fresh
C2=fox-fresh-nosd
HOST_PORT=${FRESH_PORT:-8765}
PASSWORD=fresh-install-pass-1 # of the throwaway dashboard login
WORK=$(mktemp -d "${TMPDIR:-/tmp}/fox-fresh.XXXXXX")
LOGS=$WORK/logs
TOOLS=$WORK/tools
mkdir -p "$LOGS" "$TOOLS" "$WORK/image" "$WORK/rel"

PASSED=0
FAILED=()
T0=$(date +%s)
say() { printf '\n\033[1;33m== %s  (+%ss)\033[0m\n' "$*" "$(($(date +%s) - T0))"; }
ok() { PASSED=$((PASSED + 1)); printf '  ok      %s\n' "$*"; }
bad() { FAILED+=("$*"); printf '  \033[1;31mFAILED  %s\033[0m\n' "$*"; }
# check "<what>" <command...>: ok when the command succeeds.
check() { local what=$1; shift; if "$@" >/dev/null 2>&1; then ok "$what"; else bad "$what"; fi; }
has() { grep -Eq -- "$2" "$1"; }      # has <file> <regex>
hasnt() { ! grep -Eq -- "$2" "$1"; }
# No session of a person. systemd 258 and later list the service manager of a user with linger as a session of its
# own (class manager); 255 does not list it.
nobody_logged_in() { docker exec "$C" sh -c 'for s in $(loginctl list-sessions --no-legend | awk "{print \$1}"); do case "$(loginctl show-session "$s" -p Class --value)" in manager | manager-early) ;; *) exit 1 ;; esac; done'; }
# As the user inside a container, with the environment a login gives.
fx() { docker exec -u fox -e HOME=/home/fox -e USER=fox -e LOGNAME=fox -e XDG_RUNTIME_DIR=/run/user/1000 -w /home/fox "$C" "$@"; }
# until <seconds> <command...>: tries every 2 s.
until_ok() { local end=$(($(date +%s) + $1)); shift; while ! "$@" >/dev/null 2>&1; do [ "$(date +%s)" -lt "$end" ] || return 1; sleep 2; done; }
# type_in <container> <user> <transcript name> <step timeout> 'regex=>reply' ...: a login shell of that user on a terminal.
type_in() {
  local c=$1 user=$2 name=$3 timeout=$4
  shift 4
  python3 "$TOOLS/ptydrive.py" "$LOGS/$name.txt" "$timeout" "$@" -- docker exec -it "$c" su - "$user"
}

cleanup() {
  [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null
  if [ "$KEEP" = 1 ] || [ "${#FAILED[@]}" -gt 0 ]; then
    printf '\nLeft for a look: the containers %s and %s, the image %s and %s\n' "$C" "$C2" "$IMAGE" "$WORK"
    printf 'Remove them with: docker rm -f %s %s; docker rmi %s; rm -rf %s\n' "$C" "$C2" "$IMAGE" "$WORK"
  else
    docker rm -f "$C" "$C2" >/dev/null 2>&1
    docker rmi "$IMAGE" >/dev/null 2>&1
    rm -rf "$WORK"
  fi
}
trap cleanup EXIT

for tool in docker node python3 git; do command -v "$tool" >/dev/null 2>&1 || { echo "$tool is needed"; exit 2; }; done
[ -d "$REPO/node_modules" ] || { echo "run npm ci --ignore-scripts in $REPO first"; exit 2; }
if docker ps -a --format '{{.Names}}' | grep -Eq "^($C|$C2)\$"; then echo "a container named $C or $C2 exists: docker rm -f $C $C2"; exit 2; fi

# ---------------------------------------------------------------------------------------------------------------
# The tools of this check, written into the work folder.

# As close to a fresh Ubuntu as a container gets, with systemd as PID 1. No curl and no Node.js on purpose:
# Ubuntu Desktop ships without curl. polkitd is on every Ubuntu Server and Desktop (it lets a user turn on linger).
printf 'FROM ubuntu:%s\n' "$UBUNTU" > "$WORK/image/Dockerfile"
cat >> "$WORK/image/Dockerfile" <<'EOF'
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends systemd systemd-sysv dbus dbus-user-session libpam-systemd polkitd sudo ca-certificates adduser \
 && (systemctl mask getty.target getty@.service autovt@.service console-getty.service serial-getty@.service systemd-resolved.service || true) \
 && (userdel -r ubuntu 2>/dev/null || true) \
 && useradd -m -u 1000 -s /bin/bash -G sudo fox \
 && echo 'fox:fox-fresh-pass' | chpasswd
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
EOF

cat > "$TOOLS/ptydrive.py" <<'EOF'
#!/usr/bin/env python3
"""Types into a command on a pseudo-terminal the way a person would: waits for a text, then answers.

  ptydrive.py OUT STEP_TIMEOUT 'regex=>reply' ... -- command args

The steps are taken in order: each waits (up to STEP_TIMEOUT seconds) for its regex in what was printed since the
step before, then types its reply and Enter (`^C` sends Ctrl-C, an empty reply is Enter alone). After the last
step it waits for the command to end. What was on screen goes to OUT with the recovery words masked (lines like
` 3. word`), and OUT.times says when each step was reached. Exits with the command's status, 124 when a step
never came."""
import os, pty, re, select, signal, sys, time


def main():
    out_path, step_timeout = sys.argv[1], float(sys.argv[2])
    sep = sys.argv.index("--")
    steps = [(re.compile(r.split("=>", 1)[0]), r.split("=>", 1)[1]) for r in sys.argv[3:sep]]
    cmd = sys.argv[sep + 1:]
    pid, fd = pty.fork()
    if pid == 0:
        os.execvp(cmd[0], cmd)
    start = time.time()
    buf, pos, i, times, status, eof = "", 0, 0, [], None, False
    deadline = time.time() + step_timeout

    def mask(text):
        # A terminal's own sequences (the window title, a link) end with BEL or with ESC \: taken out, their text kept.
        text = re.sub(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)", "", text.replace("\r", ""))
        text = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", text)
        return re.sub(r"(?m)^(\s*\d{1,2}\. )[a-z]+[ \t]*$", r"\1****", text)

    while True:
        if i < len(steps):
            m = steps[i][0].search(buf, pos)
            if m:
                times.append("%7.1fs  step %d  /%s/" % (time.time() - start, i + 1, steps[i][0].pattern))
                pos = m.end()
                reply = steps[i][1]
                time.sleep(0.4)
                os.write(fd, b"\x03" if reply == "^C" else reply.encode() + b"\r")
                i += 1
                deadline = time.time() + step_timeout
                continue
        if eof:
            break
        if time.time() > deadline:
            times.append("%7.1fs  TIMEOUT waiting for %s" % (time.time() - start, "step %d /%s/" % (i + 1, steps[i][0].pattern) if i < len(steps) else "the end"))
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            status = 124
            break
        r, _, _ = select.select([fd], [], [], 0.2)
        if r:
            try:
                data = os.read(fd, 65536)
            except OSError:
                data = b""
            if not data:
                eof = True
                continue
            buf += data.decode("utf-8", "replace")
    try:
        _, st = os.waitpid(pid, 0)
        if status is None:
            status = os.waitstatus_to_exitcode(st)
    except ChildProcessError:
        status = status if status is not None else 1
    if i < len(steps) and status != 124:
        status = 125  # the command ended before every answer was asked for
    times.append("%7.1fs  ended with status %s%s" % (time.time() - start, status, "" if i >= len(steps) else " before step %d /%s/" % (i + 1, steps[i][0].pattern)))
    with open(out_path, "w") as f:
        f.write(mask(buf))
    with open(out_path + ".times", "w") as f:
        f.write("\n".join(times) + "\n")
    sys.exit(status if status >= 0 else 128 - status)


main()
EOF

cat > "$TOOLS/mkrel.ts" <<'EOF'
// Builds throwaway releases of the working tree the way the maintainers build real ones (scripts/release/release.ts),
// signed with a key made here.
//   mkrel.ts init <work>                         a scratch git repository of the tree, with a new key pinned
//   mkrel.ts release <work> <version> [--notes <text>] [--break-start] [--end-at-once] [--tamper]
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = process.env.FOX_REPO ?? process.cwd()
const { buildRelease, newKey } = await import(join(REPO, 'scripts/release/release.ts'))
const [cmd, work, version, ...rest] = process.argv.slice(2)
if (!cmd || !work) throw new Error('usage: mkrel.ts init <work> | release <work> <version> [--notes <text>] [--break-start] [--tamper]')
const repo = join(work, 'repo')
const site = join(work, 'site')
const git = (...args: string[]): string => execFileSync('git', ['-C', repo, '-c', 'user.name=fresh-install-check', '-c', 'user.email=check@localhost', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { encoding: 'utf8' })

if (cmd === 'init') {
  mkdirSync(repo, { recursive: true })
  // The tracked files as they are in the folder now (a fix that is not committed yet is tested too).
  const files = execFileSync('git', ['-C', REPO, 'ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(f => f && existsSync(join(REPO, f)))
  execFileSync('tar', ['-C', REPO, '--null', '-T', '-', '-cf', join(work, 'tree.tar')], { input: files.join('\0') })
  execFileSync('tar', ['-C', repo, '-xf', join(work, 'tree.tar')])
  const key = newKey()
  writeFileSync(join(work, 'key.pem'), key.privatePem, { mode: 0o600 })
  writeFileSync(join(repo, 'src', 'update', 'keys.ts'), `// A throwaway key of the fresh install check: never the maintainers'.\nexport const RELEASE_KEYS: readonly string[] = [${JSON.stringify(key.publicPem)}]\n`)
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  git('add', '-A')
  git('commit', '-q', '-m', 'the tree under test, with a throwaway release key')
} else if (cmd === 'release') {
  if (!version) throw new Error('give the version')
  const opt = (name: string): string | undefined => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined)
  for (const f of ['package.json', 'package-lock.json']) {
    const j = JSON.parse(readFileSync(join(repo, f), 'utf8'))
    j.version = version
    if (j.packages?.['']) j.packages[''].version = version
    writeFileSync(join(repo, f), JSON.stringify(j, null, 2) + '\n')
  }
  // --break-start: a release whose service ends at once, for the launcher to undo.
  const service = join(repo, 'src', 'service.ts')
  const mark = "throw new Error('fresh-install-check: this release does not start')\n"
  // --end-at-once: a release whose service ends at once with status 0, the way Node.js 23 ends this code.
  const clean = "console.log('fresh-install-check: this release ends at once with status 0')\nprocess.exit(0)\n"
  const text = readFileSync(service, 'utf8').replace(mark, '').replace(clean, '')
  writeFileSync(service, rest.includes('--break-start') ? mark + text : rest.includes('--end-at-once') ? clean + text : text)
  git('add', '-A')
  git('commit', '-q', '-m', `release ${version}`)
  git('tag', `v${version}`)
  const built = buildRelease({ repo, version, notes: opt('--notes') ?? `New in ${version}: a line of the fresh install check.`, privatePem: readFileSync(join(work, 'key.pem'), 'utf8'), out: join(work, 'out', `v${version}`) })
  const d = join(site, 'download', `v${version}`)
  const l = join(site, 'latest', 'download')
  mkdirSync(d, { recursive: true })
  mkdirSync(l, { recursive: true })
  for (const f of built.files as string[]) copyFileSync(f, join(d, f.split('/').pop()!))
  for (const f of ['release.json', 'release.json.sig']) copyFileSync(join(built.dir, f), join(l, f))
  copyFileSync(join(repo, 'get.sh'), join(site, 'get.sh'))
  chmodSync(join(site, 'get.sh'), 0o644)
  if (rest.includes('--tamper')) {
    // Changed after signing: the same size, one byte of the archive flipped.
    const a = join(d, `foxleague-agent-v${version}.tar.gz`)
    const b = readFileSync(a)
    b[b.length - 30]! ^= 0xff
    writeFileSync(a, b)
  }
} else throw new Error(`unknown command ${cmd}`)
EOF

cat > "$TOOLS/serve.mjs" <<'EOF'
// Serves a folder over plain http: serve.mjs <folder> <host> <port>
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, normalize } from 'node:path'
const [root, host, port] = process.argv.slice(2)
createServer((req, res) => {
  const file = join(root, normalize(new URL(req.url ?? '/', 'http://x').pathname))
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) return void res.writeHead(404).end('not found')
  res.writeHead(200).end(readFileSync(file))
}).listen(Number(port), host)
EOF

cat > "$TOOLS/fox-dash" <<'EOF'
#!/usr/bin/env bash
# Inside the container, as the user: the dashboard as a browser uses it (the real sign-in form, the session cookie
# and the CSRF token of the page).   fox-dash login <user> <password> | state | check | update | nocsrf
set -u
JAR=/tmp/fox-dash.jar
BASE=http://127.0.0.1:${FOX_DASH_PORT:-8870}
NODE=$HOME/foxleague-agent/.node/bin/node
csrf() { curl -sS -m 10 -b "$JAR" "$BASE/" | sed -n "s/^const CSRF = '\([^']*\)'.*/\1/p" | head -1; }
case "${1:-}" in
  login)
    rm -f "$JAR"
    curl -sS -m 10 -c "$JAR" -o /dev/null "$BASE/login"
    echo "login: $(curl -sS -m 20 -b "$JAR" -c "$JAR" -o /dev/null -w '%{http_code} -> %{redirect_url}' --data-urlencode "username=$2" --data-urlencode "password=$3" "$BASE/login")"
    echo "dashboard page: $(curl -sS -m 10 -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE/")"
    ;;
  state)
    curl -sS -m 10 -b "$JAR" "$BASE/api/state" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const i=JSON.parse(s).instance;console.log(JSON.stringify({update:i.update,liveMode:i.liveMode,killSwitch:i.killSwitch},null,1))})'
    ;;
  check) curl -sS -m 30 -b "$JAR" -X POST -H "x-csrf-token: $(csrf)" "$BASE/api/update/check"; echo ;;
  update) curl -sS -m 30 -b "$JAR" -X POST -H "x-csrf-token: $(csrf)" -w '\nhttp %{http_code}\n' "$BASE/api/update" ;;
  nocsrf) curl -sS -m 30 -b "$JAR" -X POST -w '\nhttp %{http_code}\n' "$BASE/api/update" ;;
  *) echo "usage: fox-dash login <user> <password> | state | check | update | nocsrf" >&2; exit 1 ;;
esac
EOF

mkrel() { FOX_REPO=$REPO node --disable-warning=ExperimentalWarning "$TOOLS/mkrel.ts" "$@"; }
# publish <version> [flags]: builds the release and puts the release folder into the container, for the server there.
publish() {
  mkrel release "$WORK/rel" "$@" || return 1
  docker exec "$C" rm -rf /srv/fox-releases && docker cp -q "$WORK/rel/site" "$C":/srv/fox-releases && docker exec "$C" chmod -R a+rX /srv/fox-releases
}
journal() { fx journalctl --user -u foxleague-agent --no-pager -o cat "$@" 2>/dev/null; }
journal_has() { journal | grep -Fq -- "$1"; }
state() { fx fox-dash state 2>/dev/null; }
state_has() { state | tr -d ' \n' | grep -Fq -- "$1"; }
# offered <version>: the dashboard's check (the round arrow), then the state, until the agent offers that version. The
# agent asks the release server at most once in 15 seconds (MIN_CHECK_GAP_MS, MAC-5): a check sooner than that after
# its last one (the replay's own or the agent's timed one) gets the last answer, and Update now installs what that
# answer offered. Polled with until_ok and a bound, so a step waits for the rule instead of racing it.
offered() { fx fox-dash check >/dev/null 2>&1; state_has "\"available\":{\"version\":\"$1\""; }
active_is() { [ "$(fx cat /home/fox/foxleague-agent/versions/active 2>/dev/null)" = "$1" ]; }
healthz() { [ "$(docker exec "${2:-$C}" curl -fsS -m 3 "http://127.0.0.1:${1:-8870}/healthz" 2>/dev/null)" = ok ]; }
wallet_mark() { fx bash -c 'cd ~/foxleague-agent && { grep "^AGENT_MNEMONIC=" .env; cat pem/agent1.pem; grep "^WEB_UI_PASSWORD_HASH=" .env; } | sha256sum | cut -c1-16'; }
PROMPT='fox@fresh:~\$ '
PROMPT_IN='fox@fresh:~/foxleague-agent\$ '

# ---------------------------------------------------------------------------------------------------------------
say "1. A fresh Ubuntu $UBUNTU with systemd, no curl, no Node.js"
docker build -q -t "$IMAGE" "$WORK/image" >/dev/null || { echo "the image could not be built"; exit 2; }
# --privileged with its own cgroup namespace: systemd needs to manage cgroups. Never --network host.
docker run -d --name "$C" --hostname fresh --privileged --cgroupns=private --tmpfs /run --tmpfs /run/lock "$IMAGE" /sbin/init >/dev/null || exit 2
until_ok 60 docker exec "$C" sh -c 'systemctl is-system-running | grep -Eq "running|degraded"'
check "systemd runs as PID 1 ($(docker exec "$C" systemctl is-system-running 2>&1))" docker exec "$C" sh -c 'systemctl is-system-running | grep -Eq "running|degraded"'
check "no curl and no node on the machine" docker exec "$C" sh -c '! command -v curl && ! command -v node'
docker cp -q "$TOOLS/fox-dash" "$C":/usr/local/bin/fox-dash
docker cp -q "$TOOLS/serve.mjs" "$C":/usr/local/bin/fox-serve.mjs
docker exec "$C" chmod 755 /usr/local/bin/fox-dash

say "2. Release 1.0.0 of this folder, signed with a throwaway key, served like GitHub serves releases"
mkrel init "$WORK/rel" && mkrel release "$WORK/rel" 1.0.0 --notes "The first release." || { echo "the release could not be built"; exit 2; }
GW=$(docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}')
BASE=http://$GW:$HOST_PORT
node "$TOOLS/serve.mjs" "$WORK/rel/site" "$GW" "$HOST_PORT" &
SERVER_PID=$!
sleep 1
LINE="curl -fsSL $BASE/get.sh | FOXAGENT_RELEASES=$BASE bash"
echo "  the pasted line: $LINE"

say "3. The line on a machine without curl (Ubuntu Desktop)"
type_in "$C" fox 03-no-curl 30 "$PROMPT=>$LINE" "$PROMPT=>exit"
check "bash says that curl is not there (the guide must tell: sudo apt install curl)" has "$LOGS/03-no-curl.txt" 'curl: command not found'
docker exec "$C" apt-get install -y -qq curl >/dev/null 2>&1
check "curl installed the way the guide tells (apt install curl)" docker exec "$C" sh -c 'command -v curl'

say "4. The pasted line, with a newcomer's mistakes: Yes with a capital, Enter at the username, a password that is too short"
type_in "$C" fox 04-first-paste 300 "$PROMPT=>$LINE" \
  'Type yes when the words are written down: =>ok' \
  'Type yes when the words are written down: =>Yes' \
  'Dashboard username, your own choice \(3 to 32 letters or digits\): =>' \
  'Dashboard username, your own choice \(3 to 32 letters or digits\): =>owner' \
  'Password \(at least 12 characters\): =>short' \
  'Dashboard username, your own choice \(3 to 32 letters or digits\): =>owner' \
  "Password \\(at least 12 characters\\): =>$PASSWORD" \
  "Repeat the password: =>$PASSWORD" \
  'Dashboard port on this machine \[8870\]: =>' \
  'Enter keys now\? \(y/n\) \[y\]: =>' \
  'Anthropic API key \(sk-ant-\.\.\.\): =>' \
  'Telegram bot token from @BotFather: =>' \
  'Binance API key [^:]*: =>' \
  'Binance API secret: =>' \
  'Allow this machine to sign real transactions once you press Go LIVE\? \(y/n\) \[y\]: =>' \
  "$PROMPT=>echo \"installer status \$?\"; exit"
F=$LOGS/04-first-paste.txt
check "every question came in the order of the guide ($(tail -1 "$F.times" | sed 's/^ *//'))" hasnt "$F.times" 'TIMEOUT|before step'
check "the download was checked against the release's checksum" has "$F" "The download matches the release's checksum"
check "a private Node.js was downloaded" has "$F" 'Downloading Node.js v'
check "no npm notice and no spinner between the installer's lines" hasnt "$F" 'npm notice|⠙|⠹'
check "an answer that is not yes is told what to type" has "$F" 'Type the word yes \(then Enter\)'
check "the words were shown and are masked in the transcript" has "$F" '^24\. \*\*\*\*$'
check "the short password was asked for again, the install went on" has "$F" 'Nothing was saved\. Try again'
check "the username has no default: Enter was refused and asked again (LOGIN-1)" sh -c "grep -q 'a username is needed: type one of your own' '$F' && ! grep -q 'username \\[admin\\]' '$F'"
check "no line written for a server (restart the service, check-keys, never copy it to the server)" hasnt "$F" 'Restart the service|check-keys|to the server'
check "step 7 says Running." has "$F" '^  Running\.$'
check "the last screen names the folder (cd /home/fox/foxleague-agent)" has "$F" '^ +cd /home/fox/foxleague-agent$'
check "the installer ended with status 0" has "$F" '^installer status 0'

say "5. After Done: what the guide promises"
check "the service is active and enabled" fx sh -c 'systemctl --user is-active foxleague-agent && systemctl --user is-enabled foxleague-agent'
check "linger is on for the user" sh -c "docker exec $C loginctl show-user fox -p Linger | grep -q Linger=yes"
check "http://127.0.0.1:8870/healthz answers ok" healthz
check "the sign-in page loads" fx sh -c 'curl -fsS -m 5 http://127.0.0.1:8870/login | grep -q "name=\"password\""'
check "the dashboard without a session sends to /login" fx sh -c '[ "$(curl -sS -m 5 -o /dev/null -w "%{http_code}" http://127.0.0.1:8870/)" = 303 ]'
check "the agent started in dry run" journal_has 'mode dry run'
check ".env is 600, data and pem are 700, the PEM file is 600" fx sh -c 'cd ~/foxleague-agent && [ "$(stat -c %a .env data pem pem/agent1.pem | tr "\n" " ")" = "600 700 700 600 " ]'
check "./cli.sh address 1 names agent 1's wallet" fx sh -c 'cd ~/foxleague-agent && ./cli.sh address 1 | grep -Eq "^agent 1: erd1[0-9a-z]{58}"'
check "the unit carries its hardening (NoNewPrivileges, a system call filter)" fx sh -c 'p=$(systemctl --user show foxleague-agent -p MainPID --value); grep -q "NoNewPrivs:.*1" /proc/$p/status && grep -q "Seccomp:.*2" /proc/$p/status'
fx fox-dash login owner "$PASSWORD" > "$LOGS/05-login.txt" 2>&1
check "the sign-in form takes the login chosen in the installer" has "$LOGS/05-login.txt" 'login: 303'
check "the dashboard says dry run (liveMode false)" state_has '"liveMode":false'
MARK=$(wallet_mark)

say "6. A reboot with nobody logged in"
docker restart "$C" >/dev/null
check "the agent is back by itself (linger)" until_ok 60 healthz
check "nobody is logged in (the service manager of a user with linger is no person)" nobody_logged_in

say "7. The line pasted again, then ./install.sh six times in a row (more starts than the unit allows in ten minutes)"
type_in "$C" fox 07-paste-again 300 "$PROMPT=>$LINE" \
  'A login is already set. Change it\? \(y/n\) \[n\]: =>' \
  'Dashboard port on this machine \[8870\]: =>' \
  'Enter keys now\? \(y/n\) \[n\]: =>' \
  'Allow this machine to sign real transactions once you press Go LIVE\? \(y/n\) \[y\]: =>' \
  "$PROMPT=>echo \"installer status \$?\"; exit"
F=$LOGS/07-paste-again.txt
check "the earlier answers are offered: login kept, port 8870, no at the keys, live permission y" hasnt "$F.times" 'TIMEOUT|before step'
check "Enter at the keys question of a later run skips the keys" has "$F" 'Skipped\. Add them any time in the dashboard: Keys\.'
check "the wallet is kept and its words are not shown again" sh -c "grep -q 'Your existing wallet is kept' '$F' && ! grep -q '^24\. ' '$F'"
check "it ends with Running. and status 0" sh -c "grep -q '^  Running\.\$' '$F' && grep -q '^installer status 0' '$F'"
for n in 1 2 3 4 5 6; do
  type_in "$C" fox "07-again-$n" 300 "$PROMPT=>cd ~/foxleague-agent && ./install.sh" \
    'A login is already set. Change it\? \(y/n\) \[n\]: =>' \
    'Dashboard port on this machine \[8870\]: =>' \
    'Enter keys now\? \(y/n\) \[n\]: =>' \
    'Allow this machine to sign real transactions once you press Go LIVE\? \(y/n\) \[y\]: =>' \
    "$PROMPT_IN=>echo \"installer status \$?\"; exit"
done
check "all six ended with Running. and status 0 (the start limit of the unit did not refuse one)" sh -c "for n in 1 2 3 4 5 6; do grep -q '^  Running\.\$' '$LOGS/07-again-'\$n.txt && grep -q '^installer status 0' '$LOGS/07-again-'\$n.txt || exit 1; done"
check "the agent runs" healthz
check "the wallet, its PEM file and the login are the same as after the first install" [ "$(wallet_mark)" = "$MARK" ]

say "8. The line as root"
type_in "$C" root 08-root 30 "root@fresh:~# =>$LINE" 'root@fresh:~# =>ls -A ~ | grep -c foxleague; exit'
check "it stops with its one sentence and writes nothing" sh -c "grep -q 'Error: do not install the agent as root' '$LOGS/08-root.txt' && grep -q '^0\$' '$LOGS/08-root.txt'"

say "9. A second user reached with su from root (a server newcomer after 'create a user')"
type_in "$C" root 09-su 300 'root@fresh:~# =>adduser --disabled-password --gecos "" sam >/dev/null && su - sam' \
  "sam@fresh:~\\\$ =>$LINE" \
  'Type yes when the words are written down: =>yes' \
  'Dashboard username, your own choice \(3 to 32 letters or digits\): =>sam' \
  "Password \\(at least 12 characters\\): =>$PASSWORD" \
  "Repeat the password: =>$PASSWORD" \
  'Dashboard port on this machine \[8870\]: =>' \
  'Dashboard port on this machine \[8871\]: =>' \
  'Enter keys now\? \(y/n\) \[y\]: =>n' \
  'Allow this machine to sign real transactions once you press Go LIVE\? \(y/n\) \[y\]: =>n' \
  'sam@fresh:~\$ =>echo "installer status $?"; cd ~/foxleague-agent && ./install.sh --uninstall; echo "uninstall status $?"; exit' \
  'root@fresh:~# =>exit'
F=$LOGS/09-su.txt
check "every question came ($(tail -1 "$F.times" | sed 's/^ *//'))" hasnt "$F.times" 'TIMEOUT|before step'
check "port 8870, which the first user's agent holds, was refused and 8871 offered" has "$F" 'Port 8870 is already used by another program'
check "the service started from a terminal opened with su: Running., status 0" sh -c "grep -q '^  Running\.\$' '$F' && grep -q '^installer status 0' '$F'"
check "its uninstall from that terminal stopped it and told about linger" sh -c "grep -q 'Stopped\. Your folder' '$F' && grep -q 'loginctl disable-linger sam' '$F' && grep -q '^uninstall status 0' '$F'"
check "nothing listens on 8871 any more; the first user's agent still runs" sh -c "! docker exec $C curl -fsS -m 3 http://127.0.0.1:8871/healthz >/dev/null 2>&1 && docker exec $C curl -fsS -m 3 http://127.0.0.1:8870/healthz >/dev/null"

say "10. A machine where systemd does not run (WSL2 before systemd is turned on, a plain container)"
docker run -d --name "$C2" --hostname nosd "$IMAGE" sleep infinity >/dev/null
docker exec "$C2" apt-get install -y -qq curl >/dev/null 2>&1
type_in "$C2" fox 10-nosd 300 "fox@nosd:~\\\$ =>$LINE" \
  'fox@nosd:~\$ =>echo "installer status $?"; cd ~/foxleague-agent && ./install.sh --no-service' \
  'Type yes when the words are written down: =>yes' \
  'Dashboard username, your own choice \(3 to 32 letters or digits\): =>owner' \
  "Password \\(at least 12 characters\\): =>$PASSWORD" \
  "Repeat the password: =>$PASSWORD" \
  'Dashboard port on this machine \[8870\]: =>' \
  'Enter keys now\? \(y/n\) \[y\]: =>n' \
  'Allow this machine to sign real transactions once you press Go LIVE\? \(y/n\) \[y\]: =>n' \
  'fox@nosd:~/foxleague-agent\$ =>echo "second status $?"; exit'
F=$LOGS/10-nosd.txt
check "the installer stopped before its first question, with the reason" sh -c "grep -q 'Error: this machine does not run systemd' '$F' && grep -q '^installer status 1' '$F' && [ \"\$(grep -c 'Type yes when' '$F')\" = 1 ]"
check "the command it names (cd ... && ./install.sh --no-service) goes through" sh -c "grep -q '7/7 Background service: skipped' '$F' && grep -q '^second status 0' '$F'"
docker exec -d -u fox -e HOME=/home/fox -w /home/fox/foxleague-agent "$C2" ./run.sh
check "./run.sh starts the agent there" until_ok 30 healthz 8870 "$C2"

say "11a. Update from the dashboard: 1.0.0 to 1.0.1 (the agent's own check, then Update now)"
publish 1.0.1 --notes "New in 1.0.1: a line that the fresh install check added."
docker exec -d -u fox "$C" /home/fox/foxleague-agent/.node/bin/node /usr/local/bin/fox-serve.mjs /srv/fox-releases 127.0.0.1 8899
# The agent takes plain http only from this machine itself, so its releases are served inside the container.
fx sh -c 'printf "AGENT_UPDATE_URL=\"http://127.0.0.1:8899\"\n" >> ~/foxleague-agent/.env && systemctl --user restart foxleague-agent'
until_ok 30 healthz
fx fox-dash login owner "$PASSWORD" >/dev/null 2>&1
check "the dashboard shows the notice by itself within two minutes (version and notes)" until_ok 150 state_has '"available":{"version":"1.0.1","notes":"Newin1.0.1'
check "the notice in the log names /upgrade" journal_has 'To install it: send /upgrade here, or press Update now in the dashboard.'
check "Update now without the CSRF token is refused (403)" sh -c "docker exec -u fox -e HOME=/home/fox $C fox-dash nocsrf | grep -q 'http 403'"
fx fox-dash update > "$LOGS/11a-update.txt" 2>&1
check "Update now is accepted" has "$LOGS/11a-update.txt" 'Installing 1\.0\.1'
check "the new release was prepared (npm ci under the unit's hardening) and switched to" until_ok 120 active_is v1.0.1
check "the agent is back on 1.0.1 after its restart through exit code 75" until_ok 120 state_has '"installed":"1.0.1"'
fx fox-dash update > "$LOGS/11a-second.txt" 2>&1
check "a second Update now before 1.0.1 has stayed up for 45 seconds is refused (409: try again in a minute)" sh -c "grep -q 'the last update is still being confirmed, try again in a minute' '$LOGS/11a-second.txt' && grep -q 'http 409' '$LOGS/11a-second.txt'"
check "it says so once it has stayed up: Updated from 1.0.0 to 1.0.1." until_ok 120 journal_has 'Updated from 1.0.0 to 1.0.1.'
check "the release that ran before is kept for an undo" docker exec "$C" test -d /home/fox/foxleague-agent/versions/v1.0.0
check "the wallet, its PEM file and the login are untouched by the update" [ "$(wallet_mark)" = "$MARK" ]

say "11b. Update from a terminal: ./install.sh --update to 1.0.2"
publish 1.0.2 --notes "New in 1.0.2: installed from a terminal."
type_in "$C" fox 11b-update 300 "$PROMPT=>cd ~/foxleague-agent && ./install.sh --update" "$PROMPT_IN=>echo \"update status \$?\"; exit"
F=$LOGS/11b-update.txt
check "signature checked, notes shown, prepared, in place, Restarted., status 0" sh -c "grep -q 'Version 1.0.2 is out (you run 1.0.1); its signature is good' '$F' && grep -q 'New in 1.0.2: installed from a terminal' '$F' && grep -q 'Version 1.0.2 is in place' '$F' && grep -q '^  Restarted\.\$' '$F' && grep -q '^update status 0' '$F'"
check "the agent runs 1.0.2 and confirms it: Updated from 1.0.1 to 1.0.2." until_ok 120 journal_has 'Updated from 1.0.1 to 1.0.2.'

say "11c. An update that does not start: 1.0.3 ends at once, the launcher puts 1.0.2 back"
# First the unit as an install from before 2026-11-11 has it, without FOXAGENT_SUPERVISED=1: the agent must still
# know that systemd starts it again (its output is the journal), or Update now would only put the release in place.
check "the unit the installer wrote says that the agent is started again, and restarts it after every exit" fx sh -c 'grep -q "\"FOXAGENT_SUPERVISED=1\"" ~/.config/systemd/user/foxleague-agent.service && grep -qx "Restart=always" ~/.config/systemd/user/foxleague-agent.service'
fx sh -c 'sed -i "s/ \"FOXAGENT_SUPERVISED=1\"//" ~/.config/systemd/user/foxleague-agent.service && systemctl --user daemon-reload && systemctl --user reset-failed foxleague-agent; systemctl --user restart foxleague-agent'
until_ok 30 healthz
check "the line is gone from the unit" fx sh -c '! grep -q "\"FOXAGENT_SUPERVISED=1\"" ~/.config/systemd/user/foxleague-agent.service'
check "under such a unit the agent still knows that systemd restarts it" until_ok 30 state_has '"restarts":true'
publish 1.0.3 --break-start --notes "New in 1.0.3: a release that does not start."
check "the agent offers 1.0.3 before Update now (it asks the release server at most once in 15 seconds)" until_ok 60 offered 1.0.3
fx fox-dash update > "$LOGS/11c-update.txt" 2>&1
check "Update now is accepted for 1.0.3, with a restart" has "$LOGS/11c-update.txt" 'Installing 1\.0\.3\. This takes a minute or two; the agent then restarts'
check "after two starts that failed the launcher is back on 1.0.2 (within the unit's start limit)" until_ok 240 journal_has 'foxleague-agent: the update to v1.0.3 did not start twice, back on v1.0.2'
check "the agent says so: The update to 1.0.3 did not start and was undone" until_ok 60 journal_has 'The update to 1.0.3 did not start and was undone: you run 1.0.2 as before.'
check "1.0.2 is active and answers; the dashboard shows the undo" sh -c "[ \"\$(docker exec $C cat /home/fox/foxleague-agent/versions/active)\" = v1.0.2 ] && docker exec $C curl -fsS -m 3 http://127.0.0.1:8870/healthz >/dev/null"
check "the dashboard shows the undo" until_ok 30 state_has '"kind":"undone","version":"1.0.3"'

say "11d. A release whose archive was changed after it was signed: 1.0.4 is refused"
publish 1.0.4 --tamper --notes "New in 1.0.4: its archive was changed after it was signed."
check "the agent offers 1.0.4 before Update now (it asks the release server at most once in 15 seconds)" until_ok 60 offered 1.0.4
fx fox-dash update > "$LOGS/11d-update.txt" 2>&1
check "the dashboard's update is refused, with the reason" until_ok 60 state_has 'thearchiveisnottheonethatwassigned(itsSHA-256differs):itwasrefused.Yourun1.0.2asbefore.'
type_in "$C" fox 11d-terminal 120 "$PROMPT=>cd ~/foxleague-agent && ./install.sh --update" "$PROMPT_IN=>echo \"update status \$?\"; exit"
check "./install.sh --update refuses it too and ends as an error" sh -c "grep -q 'No update: the archive is not the one that was signed' '$LOGS/11d-terminal.txt' && grep -q '^update status 1' '$LOGS/11d-terminal.txt'"
type_in "$C" fox 11d-paste 120 "$PROMPT=>$LINE" "$PROMPT=>exit"
check "the pasted line refuses it by its checksum" has "$LOGS/11d-paste.txt" 'does not match the checksum of release 1\.0\.4: nothing was installed'
check "1.0.2 keeps running" sh -c "[ \"\$(docker exec $C cat /home/fox/foxleague-agent/versions/active)\" = v1.0.2 ] && docker exec $C curl -fsS -m 3 http://127.0.0.1:8870/healthz >/dev/null"
check "no restart failed along the way (the unit is active, never start-limit-hit)" sh -c "docker exec -u fox -e XDG_RUNTIME_DIR=/run/user/1000 $C systemctl --user is-active foxleague-agent >/dev/null && ! docker exec -u fox -e XDG_RUNTIME_DIR=/run/user/1000 $C journalctl --user -u foxleague-agent --no-pager | grep -q start-limit-hit"

say "11e. An update that ends at once with status 0 (as Node.js 23 ends this code): started again by the unit, undone by the launcher"
# The undo of 11c used four of the five starts the unit allows in ten minutes, and this one needs three more. On an
# owner's machine two such updates are not minutes apart: the count is cleared the way the installer clears it.
fx systemctl --user reset-failed foxleague-agent
publish 1.0.5 --end-at-once --notes "New in 1.0.5: a release that ends at once with status 0."
# Seconds after the check of 11d for 1.0.4: a check at once would still offer 1.0.4.
check "the agent offers 1.0.5 before Update now (it asks the release server at most once in 15 seconds)" until_ok 60 offered 1.0.5
fx fox-dash update > "$LOGS/11e-update.txt" 2>&1
check "Update now is accepted for 1.0.5" has "$LOGS/11e-update.txt" 'Installing 1\.0\.5'
check "1.0.5 ran and ended with status 0" until_ok 180 journal_has 'fresh-install-check: this release ends at once with status 0'
check "the unit started it again after each clean exit, and after two starts the launcher is back on 1.0.2" until_ok 240 journal_has 'foxleague-agent: the update to v1.0.5 did not start twice, back on v1.0.2'
check "the agent says so: The update to 1.0.5 did not start and was undone" until_ok 60 journal_has 'The update to 1.0.5 did not start and was undone: you run 1.0.2 as before.'
check "1.0.2 is active and answers" sh -c "[ \"\$(docker exec $C cat /home/fox/foxleague-agent/versions/active)\" = v1.0.2 ] && docker exec $C curl -fsS -m 3 http://127.0.0.1:8870/healthz >/dev/null"
check "the unit is active, never start-limit-hit" sh -c "docker exec -u fox -e XDG_RUNTIME_DIR=/run/user/1000 $C systemctl --user is-active foxleague-agent >/dev/null && ! docker exec -u fox -e XDG_RUNTIME_DIR=/run/user/1000 $C journalctl --user -u foxleague-agent --no-pager | grep -q start-limit-hit"

say "11f. Update now where no background service runs the agent (the machine of step 10, started with ./run.sh)"
# Only this machine gets 1.0.6: the first one keeps 1.0.5 as its newest.
mkrel release "$WORK/rel" 1.0.6 --notes "New in 1.0.6: installed where nothing restarts the agent." || bad "release 1.0.6 could not be built"
fx2() { docker exec -u fox -e HOME=/home/fox -e USER=fox -e LOGNAME=fox -w /home/fox/foxleague-agent "$C2" "$@"; }
run2() { docker exec -d -u fox -e HOME=/home/fox -e USER=fox -e LOGNAME=fox -w /home/fox/foxleague-agent "$C2" sh -c './run.sh >> /home/fox/agent.log 2>&1'; }
down2() { ! docker exec "$C2" curl -fsS -m 3 http://127.0.0.1:8870/healthz >/dev/null 2>&1; }
stop2() { fx2 sh -c 'kill "$(cat data/service.pid)"'; until_ok 60 down2; }
state2_has() { fx2 fox-dash state 2>/dev/null | tr -d ' \n' | grep -Fq -- "$1"; }
offered2() { fx2 fox-dash check >/dev/null 2>&1; state2_has "\"available\":{\"version\":\"$1\""; }
active2_is() { [ "$(fx2 cat versions/active 2>/dev/null)" = "$1" ]; }
log2_has() { fx2 grep -Fq -- "$1" /home/fox/agent.log; }
same_process2() { [ -n "$PID2" ] && [ "$(fx2 cat data/service.pid 2>/dev/null)" = "$PID2" ] && healthz 8870 "$C2"; }
docker cp -q "$TOOLS/fox-dash" "$C2":/usr/local/bin/fox-dash
docker cp -q "$TOOLS/serve.mjs" "$C2":/usr/local/bin/fox-serve.mjs
docker exec "$C2" chmod 755 /usr/local/bin/fox-dash
docker cp -q "$WORK/rel/site" "$C2":/srv/fox-releases && docker exec "$C2" chmod -R a+rX /srv/fox-releases
docker exec -d -u fox "$C2" /home/fox/foxleague-agent/.node/bin/node /usr/local/bin/fox-serve.mjs /srv/fox-releases 127.0.0.1 8899
# The agent of step 10 is stopped, told where its releases are and started by hand again, the way its owner starts it.
stop2
fx2 sh -c 'printf "AGENT_UPDATE_URL=\"http://127.0.0.1:8899\"\n" >> .env'
run2
until_ok 60 healthz 8870 "$C2"
fx2 fox-dash login owner "$PASSWORD" >/dev/null 2>&1
check "the agent offers 1.0.6 before Update now (it asks the release server at most once in 15 seconds)" until_ok 60 offered2 1.0.6
check "the agent knows that nothing starts it again (no service manager started it)" state2_has '"restarts":false'
PID2=$(fx2 cat data/service.pid 2>/dev/null)
fx2 fox-dash update > "$LOGS/11f-update.txt" 2>&1
check "Update now is accepted and says that the new version runs from the next start" has "$LOGS/11f-update.txt" 'Installing 1\.0\.6\. This takes a minute or two\. No background service runs this agent'
check "the new release was prepared and put in place" until_ok 240 active2_is v1.0.6
check "the dashboard says that 1.0.6 waits for the next start" until_ok 60 state2_has '"waiting":{"version":"1.0.6","message":"Version1.0.6isinplaceandrunsfromthenextstart.'
check "the log names the command: stop the agent, then run ./run.sh again in its folder" log2_has 'then run ./run.sh again in /home/fox/foxleague-agent'
sleep 5
check "the agent was not ended: the same process still answers" same_process2
check "it still runs 1.0.0" state2_has '"installed":"1.0.0"'
fx2 fox-dash update > "$LOGS/11f-second.txt" 2>&1
check "a second Update now says the same and starts nothing" has "$LOGS/11f-second.txt" 'Version 1\.0\.6 is in place and runs from the next start'
# The owner does what the notice says.
stop2
run2
check "started again by hand, the agent runs 1.0.6" until_ok 120 state2_has '"installed":"1.0.6"'
check "and confirms it: Updated from 1.0.0 to 1.0.6." until_ok 120 log2_has 'Updated from 1.0.0 to 1.0.6.'

say "12. Uninstall as the guide says"
type_in "$C" fox 12-uninstall 120 "$PROMPT=>cd ~/foxleague-agent && ./install.sh --uninstall" "$PROMPT_IN=>echo \"uninstall status \$?\"; exit"
F=$LOGS/12-uninstall.txt
check "it says Stopped. and tells about linger, status 0" sh -c "grep -q 'Stopped\. Your folder' '$F' && grep -q 'loginctl disable-linger fox' '$F' && grep -q '^uninstall status 0' '$F'"
check "the service is gone: not active, no unit file, nothing on port 8870" sh -c "! docker exec -u fox -e XDG_RUNTIME_DIR=/run/user/1000 $C systemctl --user is-active foxleague-agent >/dev/null 2>&1 && ! docker exec $C test -e /home/fox/.config/systemd/user/foxleague-agent.service && ! docker exec $C curl -fsS -m 3 http://127.0.0.1:8870/healthz >/dev/null 2>&1"
check "the folder, the wallet words, the data and the PEM file are left as they were" [ "$(wallet_mark)" = "$MARK" ]

# ---------------------------------------------------------------------------------------------------------------
say "Result"
printf '  %s checks passed, %s failed, in %s s\n' "$PASSED" "${#FAILED[@]}" "$(($(date +%s) - T0))"
if [ "${#FAILED[@]}" -gt 0 ]; then
  printf '  FAILED: %s\n' "${FAILED[@]}"
  printf '  What was on screen at each step: %s\n' "$LOGS"
  exit 1
fi
[ "$KEEP" = 1 ] && printf '  What was on screen at each step: %s\n' "$LOGS"
exit 0
