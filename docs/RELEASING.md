# Releasing foxleague-agent

For the maintainers. A release is a tag on `main` with three files on its GitHub release: the archive, a small
manifest (`release.json`) and the manifest's signature (`release.json.sig`). The one-line installer downloads the
newest release, and every installed agent offers it to its owner (Update now in the dashboard, `/upgrade` on
Telegram). An installed agent takes an update only when the manifest is signed with a key pinned in the code it
already runs, the version is newer than its own and the archive is byte for byte the one the manifest names.

The tool is `scripts/release/release.ts`. It runs on a maintainer's own computer, never in CI.

## The release key (once)

1. In your own terminal: `node scripts/release/release.ts keygen`. It asks for a passphrase twice (at least 8
   characters) and writes the private half to `~/.config/foxleague-agent/release-key.pem`, readable only by you.
   It refuses to replace a key that is already there.
2. The private half stays on that computer, with one offline backup (a USB stick or paper in a safe place). It never
   reaches GitHub, CI, a server, a chat or an AI session. Type the passphrase yourself, at every release.
3. The tool prints the public half. Put it into `RELEASE_KEYS` in `src/update/keys.ts` as one string (a template
   string that holds the printed block as it is), through a pull request like any other change. An agent built without a key there refuses every update and says so.

Without the private key no installed agent can be updated from its dashboard: owners would have to paste the
install line again, which brings the code that pins a new key. Keep the backup.

## A release, step by step

1. **The commit.** It is on `main`, it passed both checks (`foxleague-agent/ci` and `foxleague-agent/review`) and it
   already ran on the maintainer's own server. Run `scripts/release/fresh-install-check.sh` on it: it replays the
   install, the updates, the undo and the uninstall on a fresh Ubuntu in a throwaway container (about twelve
   minutes, it needs Docker) and ends with status 1 when a check failed.
2. **The version.** In a pull request, set `version` in `package.json` and in `package-lock.json` (two places at the
   top) to `X.Y.Z`: plain numbers, higher than every release before. Merge it the usual way.
3. **The tag.** Tag that `main` commit `vX.Y.Z` and push the tag. A tag is never moved or deleted afterwards.
4. **The notes.** Write a file, for example `notes.txt`, that says in plain words what is new: at most 1,500
   characters, no em dashes, nothing only a developer understands. Every owner reads them in the dashboard and on
   Telegram before they update.
5. **Build and sign.** `node scripts/release/release.ts build X.Y.Z --notes notes.txt`. It packs the tag exactly as
   git holds it (the website's sources stay out), writes the manifest, asks for the passphrase and signs. The three
   files are in `dist/release/vX.Y.Z/`, a folder git ignores.
6. **Publish.** Run the `gh release create vX.Y.Z ...` line the tool prints, with exactly the three files it names:
   `foxleague-agent-vX.Y.Z.tar.gz`, `release.json` and `release.json.sig`. Publish it as the latest release, not
   as a draft or a pre-release: the installer and the agents read `releases/latest/download/`.
7. **The website.** Publish it from the same commit: `./site/deploy-site.sh`.
8. **Check from a clean machine.** The install line installs `X.Y.Z` and the dashboard shows that version. An
   install of the release before shows the notice, and Update now brings it to `X.Y.Z` and says so.

From the moment of step 6 every running agent sees the release within about 10 minutes and tells its owner once.

## What the tool refuses, and why

| It refuses | Because |
|---|---|
| A version that is not plain `major.minor.patch` | Agents compare versions as three numbers; anything else is never newer. |
| Notes that are empty or longer than 1,500 characters | They are shown to every owner, and an agent refuses a manifest with longer notes. |
| A tag `vX.Y.Z` that does not exist, or whose `package.json` holds another version | The archive is the tag, and an agent refuses an archive whose version differs from its manifest. |
| A tag that pins no key in `src/update/keys.ts` | Agents on that release could never update again. |
| An archive larger than 64 MB | Agents refuse a larger one. |
| A key that the tag itself does not pin | The release would be refused by its own code at the next update. |
| A key that the newest release before it does not pin | The agents that will be offered this release run that one and check with its keys. |

## Rotating the key

Over two releases, never in one:

1. Release N adds the new public key to `src/update/keys.ts`, next to the old one, and is signed with the **old** key.
2. Release N+1 is signed with the **new** key. The tool allows it because release N pins it.
3. A later release drops the old key from `src/update/keys.ts`.

An agent that never ran release N does not know the new key and refuses N+1 and everything after it: its owner
pastes the install line again once. So leave release N as the newest for long enough that owners take it (weeks,
not hours), and say in the notes of N that it should not be skipped. If the private key may have been read by
someone else, rotate at once and tell the owners.

## A release that has to be withdrawn

Agents never go back by themselves: an agent takes only a version that is newer than its own. Deleting the GitHub
release only stops new installs and new updates to it. So publish a higher version that fixes the problem, the
usual way. An owner who must go back at once can do it by hand, with
`curl -fsSL .../get.sh | FOXAGENT_VERSION=vX.Y.Z FOXAGENT_ALLOW_DOWNGRADE=1 bash`, knowing that the settings and limits
the newer version added are then not applied.

## Rules for every release

- **Database changes are additive.** An update that does not start is undone, and the older code then reads the
  same database: add tables, columns and keys, never rename or remove what an older release reads.
- **`run.sh` stays small and backward compatible.** While an update proves that it starts, the launcher in place is
  the one of the release before; the new one replaces it only after the new release is confirmed. It must keep
  reading `versions/active`, `versions/pending` and `versions/rolled-back` as they are written today.
- **`install.sh --prepare` touches only the new release's own folder and Node.js.** It is run by the old release
  before the switch, without the agent's keys in its environment: it never writes to the running release, the
  database or the service, and it has 15 minutes.
- **The service definition is not rewritten by an update.** The systemd unit and the macOS launch agent are written
  by the guided installer only. A release that needs a changed one says so in its notes (run `./install.sh` again).
  One exception, in a terminal only: `./install.sh --update` takes the line `RestrictSUIDSGID=true`, which the
  installers before 2026-11-14 wrote, out of the unit and leaves the rest of it as it is. Its filter refuses the
  `openat2` that Ubuntu 26.04's tar needs, so an update from the dashboard could not unpack there (W-9). Run
  `FRESH_UBUNTU=26.04 scripts/release/fresh-install-check.sh` as well as the 24.04 replay before a release. On a
  Mac it changes one line of a plist the installers before 2026-11-16 wrote: the program it starts, bash with
  `run.sh`, becomes the launcher `FoxLeague Agent` in the install's folder, the name Login Items & Extensions shows
  (MAC-1), also when the install runs the newest release already (R78A-1). A job that runs is then loaded again from
  it; a stopped one stays stopped. A job the owner switched off (`launchctl print-disabled`) is never written to,
  loaded or switched on, by `--update` or by the guided installer (R78A-2).
- **Exit code 75 keeps its meaning**: the agent put an update in place and asks to be started again.
- **No secrets and nothing of an install in the tree.** The installer and the agents refuse an archive that holds
  `.env`, `data`, `pem`, `keys`, `node_modules`, `.node` or a PEM file, and anything that is not a plain file or folder.

## One-time setting on GitHub

Ask GitHub for a tag ruleset on `v*`: only maintainers may create such a tag, and nobody may move or delete one.
The signature already protects installed agents; the ruleset protects the first install, which trusts GitHub over
https and the release's checksum.
