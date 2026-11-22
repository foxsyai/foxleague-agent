// What the installers print, line by line, with the file and line each one comes from. src/check-quotes.mjs and
// test/install-videos.test.ts find each line by its text in its file; the line number is where it stood when the
// videos were drawn, a hint for people (check-quotes.mjs says when one moved). Values that the installer fills in
// (paths, the version, the user) are V(...). Blocks marked SHORTENED leave lines out; nothing is ever added to what an
// installer says.
//
// Formats the lines below rely on:
//   install.sh:40 say  = an empty line, then the text in bold yellow     install.sh:41 info = two spaces, then the text
//   install.sh:59 ask  = "  question [default]: "                        install.sh:60 yes_no = ask "question (y/n)"
//   get.sh:30 say      = as install.sh's                                 get.ps1:86 Write-FoxStep = empty line, yellow
//   get.ps1:87 Write-FoxLine = two spaces, then the text                 get.ps1:89 Write-FoxNote = the same, yellow
//   get.ps1:96 Read-FoxLine  = Read-Host, which adds ": " to the question

import { Q, V, X, seg } from './timeline.mjs'
import { VALUES } from './values.mjs'

// The lines the install pages give (and the videos paste), as on those pages.
export const INSTALL_LINE_SH = 'curl -fsSL https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.sh | bash'
const PS_LINE = 'irm https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.ps1 | iex'
const PS_UNINSTALL = '& ([scriptblock]::Create((irm https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.ps1))) -Uninstall'

export function texts(os) {
  const home = VALUES.homes[os]
  const ROOT = `${home}/foxleague-agent`
  const vars = {
    ROOT, DIR: ROOT, ENV_FILE: `${ROOT}/.env`, envFile: `${ROOT}/.env`, PEM_DIR: `${ROOT}/pem`, NODE_VERSION: 'v22.22.0',
    ver: VALUES.version, USER_NAME: VALUES.user, address: VALUES.address,
  }
  const user = VALUES.user
  const host = VALUES.hosts[os]

  // ---- shorthand for the four sources ----
  const sh = (l, parts, c = null) => Q('install.sh', l, parts, c, vars)
  const say = (l, text) => ['', sh(l, text, 'y')]                      // a step title: empty line, yellow
  const info = (l, parts) => [V('  '), sh(l, parts)]
  const gs = (l, parts, c = null) => Q('get.sh', l, parts, c, vars)
  const cli = (l, parts, c = null) => Q('src/cli.ts', l, parts, c, vars)
  const ps = (l, parts, c = null) => Q('get.ps1', l, parts, c, vars)
  const psStep = (l, text) => ['', ps(l, text, 'y')]
  const psLine = (l, parts) => [V('  '), ps(l, parts)]
  const ask = (l, q, def) => [V('  '), sh(l, q), V(def === undefined ? ': ' : ` [${def}]: `)]
  const yesNo = (l, q, def) => [V('  '), sh(l, q), V(` (y/n) [${def}]: `)]

  // ---- the shell's own prompt (not in the repository) ----
  const prompt = (dir = '~') => os === 'mac' ? [X(`${user}@${host} ${dir === '~' ? '~' : dir.split('/').pop()} % `, null, 'zsh prompt')]
    : [X(`${user}@${host}`, 'pg', 'bash prompt (Ubuntu)'), seg(':'), seg(dir, 'pb'), seg('$ ')]

  return {
    vars, ROOT, prompt, INSTALL_LINE_SH,

    // ---------------- get.sh, then the start of install.sh ----------------
    download: () => [
      '', [gs(125, 'Downloading foxleague-agent $ver into $DIR', 'y')],
      [gs(128, "  The download matches the release's checksum.")],
      '', [gs(259, 'Starting the installer', 'y')],
      ...say(856, 'foxleague-agent installer'),
      info(857, 'It sets up local agents that manage FoxLeague teams for you, with a dashboard on this machine.'),
      info(858, 'Nothing is shared with anyone: your wallet words and keys stay in this folder.'),
      ...say(872, '1/7 Node.js and dependencies'),
      info(235, 'Downloading Node.js $NODE_VERSION (a private copy, nothing is installed system-wide)'),
    ],
    nodeDone: () => [info(270, ['Node.js ', V('v22.22.0'), ' at ', V(`${ROOT}/.node/bin/node`)])],

    // ---------------- 2/7 the wallet ----------------
    wallet: () => [
      ...say(880, '2/7 Your wallet'),
      [cli(133, 'New recovery words written to ${envFile} (mode 600).')],
      [cli(134, ['Agent 1 address: ', V(VALUES.address, 'addr')])],
      info(889, ''),
      info(892, 'A new wallet was created. Its recovery words are the ONLY way to get your funds back.'),
      info(897, 'Write them down on paper now. Never type them into a website, a chat or a screenshot.'),
      info(898, ''),
      // src/cli.ts:155 prints each word as "NN. word". Here: word1 ... word24, never real words.
      ...VALUES.words.map((w, i) => [seg(`${String(i + 1).padStart(2)}. ${w}`, null, i === 0 ? { f: 'src/cli.ts', l: 155, frags: ['${String(i + 1).padStart(2)}. ${w}'] } : null)]),
      info(900, ''),
    ],
    wordsPrompt: () => ask(905, 'Type yes when the words are written down'),
    afterYes: () => [
      info(914, 'Good. The words stay in $ENV_FILE (readable only by you).'),
      info(915, 'To see them again later: cd $ROOT && ./cli.sh backup-words'),
    ],

    // ---------------- 3/7 the dashboard login ----------------
    login: () => [...say(922, '3/7 Dashboard login'), info(926, 'Choose the username and password for the dashboard.')],
    loginUser: () => [cli(519, 'Dashboard username, your own choice (3 to 32 letters or digits): ')],
    loginPass: () => [cli(523, 'Password (at least 12 characters): ')],
    loginRepeat: () => [cli(525, 'Repeat the password: ')],
    loginSaved: () => [cli(529, ['Saved the web UI login for "', V(user), '" in ', V(vars.ENV_FILE), '.'])],
    port: () => ask(955, 'Dashboard port on this machine', VALUES.port),

    // ---------------- 4/7 the keys (SHORTENED: the steps of Telegram and of the CEX top-up are left out) ----------------
    keys: () => [
      ...say(980, '4/7 Keys (you can skip any of them now and add it later in the dashboard: Getting started, then Keys)'),
      '',
      [sh(983, '  1. AI key (Anthropic), needed for the agents to play. About 5 minutes:')],
      [sh(984, '     a. Sign up or log in:                 https://platform.claude.com')],
      [sh(985, '     b. Add credit ($10, about two weeks): https://platform.claude.com/settings/billing')],
      [sh(986, '     c. Set a monthly limit ($60):         https://platform.claude.com/settings/limits')],
      [sh(987, '     d. Create key (Somewhere else), name foxleague-agent, Expires Never, copy it (once):')],
      [sh(988, '                                           https://platform.claude.com/settings/keys')],
      '',
      [sh(990, '  2. Telegram, optional (a morning summary of every agent, talk to your manager):')],
      '',
      [sh(997, '  3. CEX top-up, optional (EGLD top-ups from an exchange, each one approved by you on Telegram).')],
      '',
      [sh(1006, '  Nothing you paste is shown on screen. Press Enter at any key to skip it.')],
      '',
    ],
    keysNow: () => yesNo(1012, 'Enter keys now?', 'y'),
    configure: () => [cli(463, 'Writing to ${envFile}. Press Enter to keep a value unchanged. Nothing you type is shown.')],
    keyAsk: [
      () => [cli(469, 'Anthropic API key (sk-ant-...)'), V(': ')],
      () => [cli(470, 'Telegram token from BotFather'), V(': ')],
      () => [cli(500, 'Binance API key (withdraw-only, IP-restricted)'), V(': ')],
      () => [cli(501, 'Binance API secret'), V(': ')],
    ],
    keysSaved: () => [cli(507, ['Saved: ', 'nothing', '.'])],

    // ---------------- 5/7 to 7/7 ----------------
    settings: () => [
      ...say(1023, '5/7 Settings'),
      info(1026, 'A new install starts in DRY RUN: the agents plan and simulate, nothing is signed.'),
      info(1027, 'When you are happy, press Go LIVE in the dashboard. This machine still has to allow it:'),
    ],
    allowLive: () => yesNo(1029, 'Allow this machine to sign real transactions once you press Go LIVE?', 'y'),
    pem: () => [
      ...say(1036, "6/7 PEM files (to log into FoxLeague as your agents' teams and watch them)"),
      [cli(256, ['Wrote ', V(`${vars.PEM_DIR}/agent1.pem`), ' (mode 600). ', 'Keep it on this computer and never send it to anyone.'])],
      info(1039, 'Each new agent you add in the dashboard gets its own pem/agentN.pem automatically.'),
    ],
    service: () => [...say(1052, '7/7 Background service')],
    running: () => [info(1065, 'Running.')],

    // ---------------- Done (SHORTENED: next steps 3 and 4 and the everyday commands are left out) ----------------
    done: () => [
      ...say(1069, 'Done'),
      '',
      [sh(1072, ['  Dashboard     ', V(`http://localhost:${VALUES.port}`, 'u'), '   (user: ', V(user), ')'])],
      [sh(1073, '                Open that address in your browser (in most terminals: hold Ctrl and click it; on a Mac, Cmd).')],
      [sh(1074, '  Agent 1       '), V(VALUES.address, 'addr')],
      [sh(1075, '  PEM files     $PEM_DIR')],
      '',
      [sh(1077, '  Next steps')],
      [sh(1078, '  1. Open the dashboard. Its Getting started guide walks you through the rest, step by step.')],
      [sh(1079, "  2. Send EGLD to agent 1's wallet above (MultiversX network), enough to cover this:")],
      [sh(1080, '     part of it buys the 5,000 FOXSY registration, 1 stays as the gas reserve, the rest pays the first games.')],
      '',
      [sh(1095, '  Keep your recovery words safe. Anyone with them controls the agent wallets.')],
    ],
    openBrowser: () => yesNo(1101, 'Open the dashboard in your browser now?', 'y'),

    // ---------------- ./install.sh --uninstall ----------------
    uninstall: () => [
      ...say(745, 'Removing the background service'),
      info(759, 'Stopped. Your folder, your wallet words (.env), your data and your PEM files are untouched.'),
      info(766, 'The agent wallets may still hold funds. Keep the recovery words; delete the folder'),
      info(767, 'only when the wallets are empty.'),
      ...(os === 'mac' ? [] : [
        info(771, 'Background services of $USER_NAME still start without a login (linger).'),
        info(772, 'To turn that off: loginctl disable-linger $USER_NAME'),
      ]),
    ],

    // ---------------- Windows: get.ps1 ----------------
    ps: {
      // A plain start: the window shows only PowerShell's prompt (no banner, no copyright line).
      prompt: () => [X(`PS ${VALUES.windowsHome}> `, null, 'PowerShell prompt')],
      // How PowerShell's line editor colours the line: the command yellow, the pipe and parameters grey.
      installLine: () => [seg('irm', 'cmd', { f: 'site/src/content/docs/start/install-windows.mdx', l: 40, frags: [PS_LINE] }), seg(' https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.ps1 '), seg('|', 'op'), seg(' '), seg('iex', 'cmd')],
      uninstallLine: () => [seg('&', 'op', { f: 'site/src/content/docs/start/install-windows.mdx', l: 201, frags: [PS_UNINSTALL] }), seg(' (['), seg('scriptblock'), seg(']::Create(('), seg('irm', 'cmd'), seg(' https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.ps1))) '), seg('-Uninstall', 'op')],
      start: () => [
        ...psStep(1323, 'foxleague-agent installer for Windows'),
        psLine(1324, 'The agent runs in Ubuntu, a Linux inside Windows (WSL 2). This installer sets that up and then starts the'),
        psLine(1325, 'same guided installer as on Linux. It is safe to paste the line again at any time: it goes on where it stopped.'),
        ...psStep(869, 'Windows 1/6: checking this PC'),
        psLine(873, ['64-bit Windows, build ', V(String(VALUES.windowsBuild)), ': new enough for WSL 2.']),
        ...psStep(883, 'Windows 2/6: WSL, the part of Windows that runs Linux'),
        psLine(884, 'Asking Windows about WSL (this can take a minute).'),
      ],
      wslReady: () => [psLine(886, 'WSL 2 is installed.')],
      ubuntu: () => [
        ...psStep(942, 'Windows 3/6: Ubuntu, the Linux the agent runs in'),
        psLine(961, "Ubuntu is not installed yet. It is downloaded now with Microsoft's own command: wsl --install -d Ubuntu"),
        psLine(964, '- The download can look stuck at 0%. A click into this window pauses it (Windows then selects text):'),
        psLine(965, '  press Enter once and it goes on.'),
        psLine(966, '- A window "Welcome to WSL" may open by itself: close it, the agent does not need it.'),
        psLine(967, 'Then Ubuntu itself asks you to choose a Linux username and a password (here or in a window of its own).'),
        psLine(968, '- They are new and yours to choose: they are not your Windows login.'),
        psLine(969, '- Nothing shows while you type the password. That is normal. Type it, press Enter, type it again.'),
        psLine(970, '- Remember it: Ubuntu asks for it when a command starts with sudo. This installer never sees it.'),
        psLine(971, '- Ubuntu may also ask "Help improve Ubuntu!" (Y/n/e): either answer is fine for the agent.'),
        psLine(972, '- When Ubuntu then shows its own prompt (a line that ends with $), type  exit  and press Enter'),
        psLine(973, '  to come back to this installer.'),
      ],
      ready: () => [V('  '), ps(977, 'Ready?'), V(' '), ps(99, '(Enter means yes, n means no)'), V(': ')],
      exitNote: () => [[V('  ', 'y'), ps(980, 'When Ubuntu shows a line that ends with $, type  exit  and press Enter to come back here.', 'y')]],
      // WSL's and Ubuntu's own lines (not in the repository): as the real PC printed them (Microsoft Store WSL
      // 3.0.1.0, Ubuntu 26.04), with the example user. After the password: "usermod: no changes", no sudo hint.
      wslDownload: () => [[X('Downloading: Ubuntu', null, 'WSL, as on the real PC')]],
      wslInstalled: () => [
        [X('Installing: Ubuntu', null, 'WSL, as on the real PC')],
        [X("Distribution successfully installed. It can be launched via 'wsl.exe -d Ubuntu'", null, 'WSL, as on the real PC')],
        [X('Launching Ubuntu...', null, 'WSL, as on the real PC')],
        [X('Provisioning the new WSL instance Ubuntu', null, 'WSL, as on the real PC')],
        [X('This might take a while...', null, 'WSL, as on the real PC')],
      ],
      ubuntuUser: () => [X('Create a default Unix user account: ', null, 'Ubuntu 26.04 first start, as on the real PC')],
      ubuntuPass: () => [X('New password: ', null, 'Ubuntu 26.04 first start, as on the real PC')],
      ubuntuRepeat: () => [X('Retype new password: ', null, 'Ubuntu 26.04 first start, as on the real PC')],
      ubuntuDone: () => [
        [X('passwd: password updated successfully', null, 'Ubuntu 26.04 first start, as on the real PC')],
        [X('usermod: no changes', null, 'Ubuntu 26.04 first start, as on the real PC')],
      ],
      // Ubuntu's shell starts in the Windows folder the PowerShell window was in (C:\Users\ana).
      ubuntuPrompt: () => prompt(`/mnt/c/Users/${user}`),
      ubuntuReady: () => [psLine(993, 'Ubuntu is installed and has a user of its own.')],
      settings: () => [
        ...psStep(1042, "Windows 4/6: Ubuntu's settings (systemd, curl)"),
        psLine(1053, 'systemd is already turned on in /etc/wsl.conf.'),
        psLine(1090, 'systemd runs in Ubuntu.'),
        psLine(1093, 'curl, tar and the certificates for https are there.'),
      ],
      inner: () => [
        ...psStep(1103, "Windows 5/6: the agent's installer, inside Ubuntu"),
        psLine(1110, 'From here on it is the same installer as on Linux, with its own seven steps. Its questions are answered here.'),
      ],
      keepAlive: () => [
        ...psStep(1137, 'Windows 6/6: keeping the agent running'),
        psLine(1147, 'WSL stops Ubuntu a short while after its last window closes and does not start it with Windows.'),
        psLine(1155, ['So a scheduled task of your Windows user is now there to keep it running: "', V('FoxLeague Agent (WSL)'), '" (started at ', V('logon and every 5 minutes'), ').']),
        psLine(1156, 'It keeps Ubuntu up while you are logged in to Windows. The agent does not play while the PC is off or asleep.'),
        psLine(1157, 'To see the task: Start, Task Scheduler, Task Scheduler Library. To remove it, type:'),
        psLine(1158, ["  Unregister-ScheduledTask -TaskName '", V('FoxLeague Agent (WSL)'), "' -Confirm:$false"]),
        psLine(1168, 'The task is running.'),
      ],
      done: () => [
        ...psStep(1179, 'Done'),
        psLine(1182, ['Dashboard   ', V(`http://localhost:${VALUES.port}`)]),
        psLine(1184, 'The agent runs inside Ubuntu, not in Windows itself.'),
        psLine(1185, ['Its folder, from Windows Explorer: ', V(`\\\\wsl$\\Ubuntu\\home\\${user}\\foxleague-agent`)]),
        psLine(1186, 'Updates are one click in the dashboard (Update now).'),
        psLine(1187, ['The commands the installer listed above are typed inside Ubuntu. To open it: wsl -d ', V('Ubuntu'), ' --cd ~']),
      ],
      uninstall: () => [
        ...psStep(1231, 'Removing what the Windows installer added'),
        psLine(1245, ['Removed the scheduled task "', V('FoxLeague Agent (WSL)'), '". That is all this installer added to Windows.']),
        psLine(1249, 'Stopped the hidden wsl.exe that the task had started: it kept Ubuntu running.'),
        psLine(1260, 'The agent itself runs inside Ubuntu. Your folder and wallet words stay there either way.'),
      ],
      uninstallAsk: () => [V('  '), ps(1261, 'Also stop the agent and remove its background service in Ubuntu?'), V(' '), ps(99, '(Enter means yes, n means no)'), V(': ')],
      uninstallRun: () => [psLine(1281, ['Running ./install.sh --uninstall in ', V(ROOT), ' inside Ubuntu:'])],
      uninstallEnd: () => [
        psLine(1284, 'Done: the agent is stopped and its background service in Ubuntu is removed.'),
        psLine(1317, "WSL, Ubuntu and the line systemd=true in Ubuntu's /etc/wsl.conf are left as they are:"),
        psLine(1318, 'other programs may use them.'),
        psLine(1319, 'Ubuntu stops a short while after its last window closes.'),
      ],
    },
  }
}
