# Install videos

The three videos at the top of the site's install pages, one per system, drawn by this script from the installers'
own texts on example values. A changed sentence is one edit and a re-run, never a redraw.

| Video and poster | Length, size | Shown on |
|---|---|---|
| `site/public/videos/install-windows.mp4` and `.jpg` | 53.7 s, 5.5 MB (CRF 27) | `site/src/content/docs/start/install-windows.mdx` |
| `site/public/videos/install-mac.mp4` and `.jpg` | 42.1 s, 5.3 MB (CRF 23) | `site/src/content/docs/start/install-mac.mdx` |
| `site/public/videos/install-linux.mp4` and `.jpg` | 42.1 s, 5.7 MB (CRF 23) | `site/src/content/docs/start/install-linux.mdx` |

1920x1080, 30 frames a second, H.264 High, yuv420p, no sound, the index at the front of the file (`+faststart`),
under 6 MB each. The poster is the installer's Done screen.

`test/install-videos.test.ts` (R71A-1) holds them with `npm test`: every install page names its own video and
poster, both files are there and the page says the video's length; every installer line the videos quote still
stands in its file; the script draws on example values only. What a frame shows cannot be read by a test: watch the
drafts before they replace the published files.

## What each video shows

1. The install page of the site with the line, the copy button pressed ("Copied!").
2. The terminal opens (Windows PowerShell 5.1, the Mac's Terminal, Ubuntu's terminal), the line is pasted and Enter.
3. Windows only: the window starts plain (only `PS C:\Users\ana>`), `get.ps1`'s steps 1/6 to 5/6, Ubuntu's download
   ("A few minutes later"), Ubuntu's own username (`ana`) and password (nothing shows while it is typed, twice),
   `usermod: no changes`, `exit` at Ubuntu's prompt `ana@PC:/mnt/c/Users/ana$`.
4. `get.sh` and the seven steps of `install.sh`: Node.js ("A minute later"), the recovery words screen with
   `word1` ... `word24` and `yes`, the screen cleared, the dashboard username `ana`, its password (nothing shows),
   Enter at the port, Enter at "Enter keys now?" and at each of the four keys, Enter at the live permission, the
   PEM file, "Running.".
5. Done with the dashboard address, Enter at "Open the dashboard in your browser now?". Windows then shows its own
   step 6/6 (the scheduled task) and its Done.
6. The browser: a new tab with the real login page, `ana` and the password typed (dots), Sign in, the real
   dashboard with its Getting started guide, the guide closed.
7. "A few days later": the notice "Version 1.0.1 is out. You run 1.0.0." with Update now, the click, "Installing
   version 1.0.1", "A minute later", the green "Updated from 1.0.0 to 1.0.1." and V1.0.1 in the header.
8. The uninstall: Windows pastes the `-Uninstall` line and presses Enter at its one question; the Mac and Linux
   type `cd ~/foxleague-agent` and `./install.sh --uninstall`.

## When to draw them again

- **An installer line the videos show changed.** `npm test` fails "R71A-1 every installer line the videos quote
  still stands in the repository" and names each line; `node site/scripts/videos/src/check-quotes.mjs` says
  CHANGED. The quotes come from `install.sh`, `get.sh`, `get.ps1`, `src/cli.ts` and the line of each install
  page. A line that only moved (something added above it) fails nothing: the check finds every line by its text,
  and the line number in `src/text.mjs` is a hint for people.
- **A screen the videos show changed**: the install page around "The line to paste", the login page, the
  dashboard's Getting started guide or its update notice. No test sees that: look at a few stills (below) after
  such a change.
- **The story changed**: a step of an installer, a question added or taken out.

Then:

1. Change the entry of that line in `src/text.mjs` to what the installer prints now, until
   `node site/scripts/videos/src/check-quotes.mjs` says 0 changed.
2. Draw them again (below), watch the three drafts in `out/` and copy them over the published ones. From this
   folder: `cp out/install-*.mp4 out/install-*.jpg ../../public/videos/`.
3. When a length changed, write its new whole seconds on its page twice (under the player and in the line below
   it): the test holds the page to the file.
4. `node site/scripts/videos/src/check-quotes.mjs --readme` writes the table of quotes below again.
5. Commit the videos, the posters, the pages and the changes of this folder, each file by name. `build/`, `out/`
   and `node_modules/` stay out (`.gitignore`).

## Draw them again

Needs Node 22, ffmpeg and Google Chrome (or Chromium: `CHROME=/path/to/chrome`). Also this repository with its
packages (`npm ci --ignore-scripts` at the root) and a built site
(`cd site && npm ci --ignore-scripts && npm run build`; or `FOXAGENT_SITE_DIST` names another build whose install
pages are current). Every install here skips the packages' install scripts (at the root, in the site and in this
folder): none of them needs one to work. The script finds the repository from where it sits and only reads it.

The packages of this folder (Playwright's core and two fonts, pinned in `package.json` and `package-lock.json` as
development packages) are for drawing the videos only. The agent, its releases and the site do not get them: they
are not in the root's or the site's `package.json`. The release downloads leave all of `site` out
(`.gitattributes`). `src/check-quotes.mjs` and the test need none of them.

```sh
cd site/scripts/videos
npm ci --ignore-scripts       # playwright-core and two fonts, for this folder only
node src/capture.mjs          # 1. screenshots of the real pages into build/shots/ (about a minute)
node src/render.mjs           # 2. the three videos into out/ (about two minutes each)
node src/check-quotes.mjs     # every quoted installer line against the repository (status 1 if one changed)
```

One system only: `node src/capture.mjs mac`, `node src/render.mjs mac`. Quick looks without a video:
`node src/render.mjs linux --still 12,poster,words` (or `--still all`, one frame every 2 seconds) writes JPEGs to
`build/stills/`. `--encode-only` makes the MP4 again from the lossless master in `build/` (for another `--crf`);
without `--crf` the encoder starts at CRF 23 and goes up one step until the file is under 5.9 MB.

### Where to change what

| To change | Edit |
|---|---|
| A sentence the video adds (captions, "A few minutes later", the key caps) | `WORDS` at the top of `src/scenes.mjs` |
| The order or timing of the story | `build()` in `src/scenes.mjs` (each step reads top to bottom) |
| What an installer prints (after the installer changed) | `src/text.mjs`, one entry per line with its file and line; then `node src/check-quotes.mjs` |
| The example values (user, address, versions, release notes, password) | `src/values.mjs` |
| The look of the desktops, terminals and browser | `src/stage/stage.css` |
| The dashboard's demo state or the pages captured | `src/capture.mjs` |

The words the videos add follow the owner's text rules: plain words, no em dashes, no Oxford comma and none of the
words the owner keeps out of the project. The installers' own lines are shown exactly as the installers print them.

### How it works

- `src/capture.mjs` starts the repository's own `Service` and web server the way `site/scripts/screenshots.ts`
  does: a throwaway wallet in a temporary folder, every network address pointed at `127.0.0.1:9`, no AI key, no
  Telegram. The login and the dashboard on screen are the real `src/web/login.html` and `dashboard.html`, driven by
  Playwright: the login is typed, the guide closed and Update now clicked for real. The updater is a stand-in whose
  messages are the real updater's (`src/update/updater.ts`). The install pages are `site/dist` as built; the
  "Coming soon" banner and frame are taken off in the browser only, so the page looks as it will after the release.
- The capture checks the text each screenshot shows for the word the owner keeps out of the project (BotFather, a
  name, is allowed) and lists any hit in `build/shots/<system>/boxes.json` and on the console.
- `src/stage/` draws one frame at any time t: a plain desktop (no logos), the terminal (text, wrapping at the
  window's width, the cursor), the browser (tabs, address, the screenshots), the pointer, captions and the camera.
- `src/render.mjs` builds each timeline (`src/scenes.mjs`, `src/timeline.mjs`, `src/text.mjs`), draws every frame
  in headless Chrome (a frame that did not change is not drawn again), writes a lossless master
  (`build/master-<system>.mkv`) and encodes the MP4 from it.
- The installers print their blocks at once (a heredoc, a run of `Write-FoxLine`), and so does the video: a block
  appears in one go, the time a step takes is a pause between blocks or a "later" note.

## Example values and privacy

- User `ana` everywhere: the Linux user, the Windows user (`C:\Users\ana`), the dashboard user, `ana@PC`,
  `ana@laptop`. The dashboard password is typed but never shown: dots in the browser, nothing in the terminal.
- The agent address `erd1gupzwzfxh2lk2gwk7s7lfa9jqtm98h88m6z0dsfg49d8552jlckacd4d5s` is made up and tagged
  EXAMPLE wherever it shows (terminal and dashboard). Its checksum is wrong on purpose (`Address.newFromBech32`
  refuses it), so it cannot receive funds. The throwaway wallet's real addresses are replaced in every answer of the
  dashboard's API before the page sees them.
- The recovery words are `word1` ... `word24`, with the caption "Example words".
- No API key is shown: the keys step is skipped with Enter. The later dashboard has a fake key set (never displayed)
  so that it is not stuck on "The AI key is missing".
- No IP address, no real host name, no real desktop. The team on the later dashboard is "Fox Demo XI", the demo
  team of the site's own screenshots.

## What was shortened

The line numbers are those of the commit the videos were drawn from.

- 4/7 Keys: the steps under "2. Telegram" and "3. CEX top-up" (`install.sh` lines 601 to 605 and 608 to 614) are
  left out; the AI key's steps and the three headings stay.
- Done: next steps 3 and 4 and the everyday commands (`install.sh` lines 677 to 689) are left out.
- The npm summary of step 1/7 and the time it takes are not shown (cut with "A minute later").

## What is not from the installer files

- The site's header on the install page shows the site's own links with the GitHub, X, Telegram and YouTube icons
  (the real page). For a video without them, `src/capture.mjs` can hide that row like it hides
  the "Coming soon" banner.
- The copy button of the site's code block sits over the end of the line, as on the real page at 1600 px.

- WSL's and Ubuntu's own lines on Windows are those of the real PC (Microsoft Store WSL 3.0.1.0, Ubuntu 26.04), with
  the example user: "Downloading: Ubuntu", "Installing: Ubuntu", "Distribution successfully installed. It can be
  launched via 'wsl.exe -d Ubuntu'", "Launching Ubuntu...", "Provisioning the new WSL instance Ubuntu", "This might
  take a while...", "Create a default Unix user account:", "New password:", "Retype new password:", "passwd:
  password updated successfully", "usermod: no changes" and the prompt `ana@PC:/mnt/c/Users/ana$` (Ubuntu's shell
  starts in the Windows folder the PowerShell window was in). No progress bar is drawn for the download.
- Windows 4/6 shows "systemd is already turned on in /etc/wsl.conf.", "systemd runs in Ubuntu." and "curl, tar and the
  certificates for https are there.", as on the real PC.
- The video shows a PC that already has WSL 2 ("WSL 2 is installed."): no administrator prompt and no restart.
- The PowerShell window starts plain, with only its prompt: no banner and no copyright line. The Mac's "Last
  login: ..." line and the shell prompts are the systems' own.
- The Mac Terminal title is written "ana · -zsh · 114×32": the real one has em dashes between the parts.
- The release notes of 1.0.1 ("Clearer messages on the dashboard and a few small fixes.") are made up.
- Fonts stand in for the systems' own: Inconsolata for Consolas, DejaVu Sans Mono for Menlo, Noto Sans for Segoe UI,
  Inter for the Mac's system font; Ubuntu's own fonts on Linux.

## Every quoted line

`node src/check-quotes.mjs --readme` rewrites this table. "ok": one line of that file still holds every quoted
piece; the line given is where it stands now.

<!-- quotes:start -->
Checked against commit a689a57 (2026-11-15): 132 quoted lines, 0 changed.

| Video | File:line | Text on screen | Check |
|---|---|---|---|
| windows | `get.ps1:99` | Ready? (Enter means yes, n means no): / Also stop the agent and remove its background service in Ubuntu? (Enter means yes, n means no): | ok |
| windows | `get.ps1:794` | Windows 1/6: checking this PC | ok |
| windows | `get.ps1:798` | 64-bit Windows, build 26100: new enough for WSL 2. | ok |
| windows | `get.ps1:808` | Windows 2/6: WSL, the part of Windows that runs Linux | ok |
| windows | `get.ps1:809` | Asking Windows about WSL (this can take a minute). | ok |
| windows | `get.ps1:811` | WSL 2 is installed. | ok |
| windows | `get.ps1:867` | Windows 3/6: Ubuntu, the Linux the agent runs in | ok |
| windows | `get.ps1:886` | Ubuntu is not installed yet. It is downloaded now with Microsoft's own command: wsl --install -d Ubuntu | ok |
| windows | `get.ps1:889` | - The download can look stuck at 0%. A click into this window pauses it (Windows then selects text): | ok |
| windows | `get.ps1:890` | press Enter once and it goes on. | ok |
| windows | `get.ps1:891` | - A window "Welcome to WSL" may open by itself: close it, the agent does not need it. | ok |
| windows | `get.ps1:892` | Then Ubuntu itself asks you to choose a Linux username and a password (here or in a window of its own). | ok |
| windows | `get.ps1:893` | - They are new and yours to choose: they are not your Windows login. | ok |
| windows | `get.ps1:894` | - Nothing shows while you type the password. That is normal. Type it, press Enter, type it again. | ok |
| windows | `get.ps1:895` | - Remember it: Ubuntu asks for it when a command starts with sudo. This installer never sees it. | ok |
| windows | `get.ps1:896` | - Ubuntu may also ask "Help improve Ubuntu!" (Y/n/e): either answer is fine for the agent. | ok |
| windows | `get.ps1:897` | - When Ubuntu then shows its own prompt (a line that ends with $), type  exit  and press Enter | ok |
| windows | `get.ps1:898` | to come back to this installer. | ok |
| windows | `get.ps1:902` | Ready? (Enter means yes, n means no): | ok |
| windows | `get.ps1:905` | When Ubuntu shows a line that ends with $, type  exit  and press Enter to come back here. | ok |
| windows | `get.ps1:917` | Ubuntu is installed and has a user of its own. | ok |
| windows | `get.ps1:957` | Windows 4/6: Ubuntu's settings (systemd, curl) | ok |
| windows | `get.ps1:968` | systemd is already turned on in /etc/wsl.conf. | ok |
| windows | `get.ps1:1005` | systemd runs in Ubuntu. | ok |
| windows | `get.ps1:1008` | curl, tar and the certificates for https are there. | ok |
| windows | `get.ps1:1018` | Windows 5/6: the agent's installer, inside Ubuntu | ok |
| windows | `get.ps1:1025` | From here on it is the same installer as on Linux, with its own seven steps. Its questions are answered here. | ok |
| windows | `get.ps1:1052` | Windows 6/6: keeping the agent running | ok |
| windows | `get.ps1:1062` | WSL stops Ubuntu a short while after its last window closes and does not start it with Windows. | ok |
| windows | `get.ps1:1070` | So a scheduled task of your Windows user is now there to keep it running: "FoxLeague Agent (WSL)" (started at logon and every 5 minutes). | ok |
| windows | `get.ps1:1071` | It keeps Ubuntu up while you are logged in to Windows. The agent does not play while the PC is off or asleep. | ok |
| windows | `get.ps1:1072` | To see the task: Start, Task Scheduler, Task Scheduler Library. To remove it, type: | ok |
| windows | `get.ps1:1073` | Unregister-ScheduledTask -TaskName 'FoxLeague Agent (WSL)' -Confirm:$false | ok |
| windows | `get.ps1:1083` | The task is running. | ok |
| windows | `get.ps1:1094` | Done | ok |
| windows | `get.ps1:1097` | Dashboard   http://localhost:8870 | ok |
| windows | `get.ps1:1099` | The agent runs inside Ubuntu, not in Windows itself. | ok |
| windows | `get.ps1:1100` | Its folder, from Windows Explorer: \\wsl$\Ubuntu\home\ana\foxleague-agent | ok |
| windows | `get.ps1:1101` | Updates are one click in the dashboard (Update now). | ok |
| windows | `get.ps1:1102` | The commands the installer listed above are typed inside Ubuntu. To open it: wsl -d Ubuntu --cd ~ | ok |
| windows | `get.ps1:1146` | Removing what the Windows installer added | ok |
| windows | `get.ps1:1160` | Removed the scheduled task "FoxLeague Agent (WSL)". That is all this installer added to Windows. | ok |
| windows | `get.ps1:1164` | Stopped the hidden wsl.exe that the task had started: it kept Ubuntu running. | ok |
| windows | `get.ps1:1175` | The agent itself runs inside Ubuntu. Your folder and wallet words stay there either way. | ok |
| windows | `get.ps1:1176` | Also stop the agent and remove its background service in Ubuntu? (Enter means yes, n means no): | ok |
| windows | `get.ps1:1196` | Running ./install.sh --uninstall in /home/ana/foxleague-agent inside Ubuntu: | ok |
| windows | `get.ps1:1199` | Done: the agent is stopped and its background service in Ubuntu is removed. | ok |
| windows | `get.ps1:1232` | WSL, Ubuntu and the line systemd=true in Ubuntu's /etc/wsl.conf are left as they are: | ok |
| windows | `get.ps1:1233` | other programs may use them. | ok |
| windows | `get.ps1:1234` | Ubuntu stops a short while after its last window closes. | ok |
| windows | `get.ps1:1238` | foxleague-agent installer for Windows | ok |
| windows | `get.ps1:1239` | The agent runs in Ubuntu, a Linux inside Windows (WSL 2). This installer sets that up and then starts the | ok |
| windows | `get.ps1:1240` | same guided installer as on Linux. It is safe to paste the line again at any time: it goes on where it stopped. | ok |
| windows, mac, linux | `get.sh:111` | Downloading foxleague-agent 1.0.0 into /home/ana/foxleague-agent / Downloading foxleague-agent 1.0.0 into /Users/ana/foxleague-agent | ok |
| windows, mac, linux | `get.sh:114` | The download matches the release's checksum. | ok |
| windows, mac, linux | `get.sh:201` | Starting the installer | ok |
| windows, mac, linux | `install.sh:205` | Downloading Node.js v22.22.0 (a private copy, nothing is installed system-wide) | ok |
| windows, mac, linux | `install.sh:231` | Node.js v22.22.0 at /home/ana/foxleague-agent/.node/bin/node / Node.js v22.22.0 at /Users/ana/foxleague-agent/.node/bin/node | ok |
| windows, mac, linux | `install.sh:411` | Removing the background service | ok |
| windows, mac, linux | `install.sh:413` | Stopped. Your folder, your wallet words (.env), your data and your PEM files are untouched. | ok |
| windows, mac, linux | `install.sh:416` | The agent wallets may still hold funds. Keep the recovery words; delete the folder | ok |
| windows, mac, linux | `install.sh:417` | only when the wallets are empty. | ok |
| windows, linux | `install.sh:421` | Background services of ana still start without a login (linger). | ok |
| windows, linux | `install.sh:422` | To turn that off: loginctl disable-linger ana | ok |
| windows, mac, linux | `install.sh:477` | foxleague-agent installer | ok |
| windows, mac, linux | `install.sh:478` | It sets up local agents that manage FoxLeague teams for you, with a dashboard on this machine. | ok |
| windows, mac, linux | `install.sh:479` | Nothing is shared with anyone: your wallet words and keys stay in this folder. | ok |
| windows, mac, linux | `install.sh:490` | 1/7 Node.js and dependencies | ok |
| windows, mac, linux | `install.sh:498` | 2/7 Your wallet | ok |
| windows, mac, linux | `install.sh:507` | (empty line) | ok |
| windows, mac, linux | `install.sh:510` | A new wallet was created. Its recovery words are the ONLY way to get your funds back. | ok |
| windows, mac, linux | `install.sh:515` | Write them down on paper now. Never type them into a website, a chat or a screenshot. | ok |
| windows, mac, linux | `install.sh:516` | (empty line) | ok |
| windows, mac, linux | `install.sh:518` | (empty line) | ok |
| windows, mac, linux | `install.sh:523` | Type yes when the words are written down: | ok |
| windows, mac, linux | `install.sh:532` | Good. The words stay in /home/ana/foxleague-agent/.env (readable only by you). / Good. The words stay in /Users/ana/foxleague-agent/.env (readable only by you). | ok |
| windows, mac, linux | `install.sh:533` | To see them again later: cd /home/ana/foxleague-agent && ./cli.sh backup-words / To see them again later: cd /Users/ana/foxleague-agent && ./cli.sh backup-words | ok |
| windows, mac, linux | `install.sh:540` | 3/7 Dashboard login | ok |
| windows, mac, linux | `install.sh:544` | Choose the username and password for the dashboard. | ok |
| windows, mac, linux | `install.sh:573` | Dashboard port on this machine [8870]: | ok |
| windows, mac, linux | `install.sh:590` | 4/7 Keys (you can skip any of them now and add it later in the dashboard: Getting started, then Keys) | ok |
| windows, mac, linux | `install.sh:593` | 1. AI key (Anthropic), needed for the agents to play. About 5 minutes: | ok |
| windows, mac, linux | `install.sh:594` | a. Sign up or log in:              https://platform.claude.com | ok |
| windows, mac, linux | `install.sh:595` | b. Add credit ($10, about a week): https://platform.claude.com/settings/billing | ok |
| windows, mac, linux | `install.sh:596` | c. Set a monthly limit ($60):      https://platform.claude.com/settings/limits | ok |
| windows, mac, linux | `install.sh:597` | d. Create a key, name it foxleague-agent, copy it (shown once): | ok |
| windows, mac, linux | `install.sh:598` | https://platform.claude.com/settings/keys | ok |
| windows, mac, linux | `install.sh:600` | 2. Telegram, optional (a morning summary of every agent, talk to your manager): | ok |
| windows, mac, linux | `install.sh:607` | 3. CEX top-up, optional (EGLD top-ups from an exchange, each one approved by you on Telegram). | ok |
| windows, mac, linux | `install.sh:616` | Nothing you paste is shown on screen. Press Enter at any key to skip it. | ok |
| windows, mac, linux | `install.sh:622` | Enter keys now? (y/n) [y]: | ok |
| windows, mac, linux | `install.sh:633` | 5/7 Settings | ok |
| windows, mac, linux | `install.sh:636` | A new install starts in DRY RUN: the agents plan and simulate, nothing is signed. | ok |
| windows, mac, linux | `install.sh:637` | When you are happy, press Go LIVE in the dashboard. This machine still has to allow it: | ok |
| windows, mac, linux | `install.sh:639` | Allow this machine to sign real transactions once you press Go LIVE? (y/n) [y]: | ok |
| windows, mac, linux | `install.sh:646` | 6/7 PEM files (to log into FoxLeague as your agents' teams and watch them) | ok |
| windows, mac, linux | `install.sh:649` | Each new agent you add in the dashboard gets its own pem/agentN.pem automatically. | ok |
| windows, mac, linux | `install.sh:656` | 7/7 Background service | ok |
| windows, mac, linux | `install.sh:662` | Running. | ok |
| windows, mac, linux | `install.sh:665` | Done | ok |
| windows, mac, linux | `install.sh:668` | Dashboard     http://localhost:8870   (user: ana) | ok |
| windows, mac, linux | `install.sh:669` | Open that address in your browser (in most terminals: hold Ctrl and click it; on a Mac, Cmd). | ok |
| windows, mac, linux | `install.sh:670` | Agent 1       erd1gupzwzfxh2lk2gwk7s7lfa9jqtm98h88m6z0dsfg49d8552jlckacd4d5s | ok |
| windows, mac, linux | `install.sh:671` | PEM files     /home/ana/foxleague-agent/pem / PEM files     /Users/ana/foxleague-agent/pem | ok |
| windows, mac, linux | `install.sh:673` | Next steps | ok |
| windows, mac, linux | `install.sh:674` | 1. Open the dashboard. Its Getting started guide walks you through the rest, step by step. | ok |
| windows, mac, linux | `install.sh:675` | 2. Send EGLD to agent 1's wallet above (MultiversX network). About 5 EGLD is a good start: | ok |
| windows, mac, linux | `install.sh:676` | 2.5 buys the 5,000 FOXSY registration, 1 stays as the gas reserve, the rest pays the first games. | ok |
| windows, mac, linux | `install.sh:691` | Keep your recovery words safe. Anyone with them controls the agent wallets. | ok |
| windows, mac, linux | `install.sh:697` | Open the dashboard in your browser now? (y/n) [y]: | ok |
| linux | `site/src/content/docs/start/install-linux.mdx:42` | curl -fsSL https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.sh \| bash | ok |
| linux | `site/src/content/docs/start/install-linux.mdx:140` | cd ~/foxleague-agent | ok |
| linux | `site/src/content/docs/start/install-linux.mdx:141` | ./install.sh --uninstall | ok |
| mac | `site/src/content/docs/start/install-mac.mdx:42` | curl -fsSL https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.sh \| bash | ok |
| mac | `site/src/content/docs/start/install-mac.mdx:133` | cd ~/foxleague-agent | ok |
| mac | `site/src/content/docs/start/install-mac.mdx:134` | ./install.sh --uninstall | ok |
| windows | `site/src/content/docs/start/install-windows.mdx:45` | irm https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.ps1 \| iex | ok |
| windows | `site/src/content/docs/start/install-windows.mdx:207` | & ([scriptblock]::Create((irm https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.ps1))) -Uninstall | ok |
| windows, mac, linux | `src/cli.ts:120` | New recovery words written to /home/ana/foxleague-agent/.env (mode 600). / New recovery words written to /Users/ana/foxleague-agent/.env (mode 600). | ok |
| windows, mac, linux | `src/cli.ts:121` | Agent 1 address: erd1gupzwzfxh2lk2gwk7s7lfa9jqtm98h88m6z0dsfg49d8552jlckacd4d5s | ok |
| windows, mac, linux | `src/cli.ts:142` | 1. word1 | ok |
| windows, mac, linux | `src/cli.ts:236` | Wrote /home/ana/foxleague-agent/pem/agent1.pem (mode 600). Keep it on this computer and never send it to anyone. / Wrote /Users/ana/foxleague-agent/pem/agent1.pem (mode 600). Keep it on this computer and never send it to anyone. | ok |
| windows, mac, linux | `src/cli.ts:419` | Writing to /home/ana/foxleague-agent/.env. Press Enter to keep a value unchanged. Nothing you type is shown. / Writing to /Users/ana/foxleague-agent/.env. Press Enter to keep a value unchanged. Nothing you type is shown. | ok |
| windows, mac, linux | `src/cli.ts:425` | Anthropic API key (sk-ant-...): | ok |
| windows, mac, linux | `src/cli.ts:426` | Telegram token from BotFather: | ok |
| windows, mac, linux | `src/cli.ts:456` | Binance API key (withdraw-only, IP-restricted): | ok |
| windows, mac, linux | `src/cli.ts:457` | Binance API secret: | ok |
| windows, mac, linux | `src/cli.ts:463` | Saved: nothing. | ok |
| windows, mac, linux | `src/cli.ts:475` | Dashboard username, your own choice (3 to 32 letters or digits): | ok |
| windows, mac, linux | `src/cli.ts:479` | Password (at least 12 characters): | ok |
| windows, mac, linux | `src/cli.ts:481` | Repeat the password: | ok |
| windows, mac, linux | `src/cli.ts:485` | Saved the web UI login for "ana" in /home/ana/foxleague-agent/.env. / Saved the web UI login for "ana" in /Users/ana/foxleague-agent/.env. | ok |

Lines that are not from the repository (the system's own words, written as they usually appear):

| Video | Source | Text on screen |
|---|---|---|
| windows | PowerShell prompt | PS C:\Users\ana> |
| windows | WSL, as on the real PC | Downloading: Ubuntu |
| windows | WSL, as on the real PC | Installing: Ubuntu |
| windows | WSL, as on the real PC | Distribution successfully installed. It can be launched via 'wsl.exe -d Ubuntu' |
| windows | WSL, as on the real PC | Launching Ubuntu... |
| windows | WSL, as on the real PC | Provisioning the new WSL instance Ubuntu |
| windows | WSL, as on the real PC | This might take a while... |
| windows | Ubuntu 26.04 first start, as on the real PC | Create a default Unix user account: |
| windows | Ubuntu 26.04 first start, as on the real PC | New password: |
| windows | Ubuntu 26.04 first start, as on the real PC | Retype new password: |
| windows | Ubuntu 26.04 first start, as on the real PC | passwd: password updated successfully |
| windows | Ubuntu 26.04 first start, as on the real PC | usermod: no changes |
| windows | bash prompt (Ubuntu) | ana@PC:/mnt/c/Users/ana$ |
| mac | macOS Terminal | Last login: Sun Nov 15 10:21:07 on ttys000 |
| mac | zsh prompt | ana@laptop ~ % |
| mac | zsh prompt | ana@laptop foxleague-agent % |
| linux | bash prompt (Ubuntu) | ana@laptop:~$ |
| linux | bash prompt (Ubuntu) | ana@laptop:~/foxleague-agent$ |
<!-- quotes:end -->

## Folders

- `src/`: the scripts and the scene data (`values.mjs`, `text.mjs`, `scenes.mjs`), the stage (`src/stage/`) and
  the quotes (`quotes.mjs`, used by `check-quotes.mjs` and by the test).
- `out/`: the three drafts and their posters, until they are copied to `site/public/videos/`. Not committed.
- `build/`: what can be made again: the screenshots (`build/shots/`), the timelines and quotes as JSON, the lossless
  masters (about 180 MB each, for `--encode-only`). Not committed; delete it at will, `npm run all` makes it again.
