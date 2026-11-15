# agent.foxleague.ai

The manual of the FoxLeague agent: install, keys, the dashboard, how it plays, safety, costs and help. The same
stack and look as docs.foxleague.ai (Astro 6 and Starlight 0.38, the FoxLeague brand styles).

```sh
cd site
npm ci --ignore-scripts   # no install script of a package runs on your computer
npm run dev               # http://localhost:4321 while writing
npm run build             # static site in dist/
```

Pages are in `src/content/docs/`, the sidebar in `astro.config.mjs`. Screenshots of the dashboard come from a
throwaway demo install with made-up data; retake them after a dashboard change, from the repository root:

```sh
node --disable-warning=ExperimentalWarning site/scripts/screenshots.ts
```

The install videos at the top of the three install pages (`public/videos/`) are drawn by `site/scripts/videos/`
from the installers' own texts, on example values. When an installer line they show changes, `npm test` says so
(`test/install-videos.test.ts`) and they are drawn again: `site/scripts/videos/README.md` says how.

`public/og.png` is the link preview (1200×630) and `src/assets/hero.png` the home image, both from the launch
media canvas.

## Serving it

agent.foxleague.ai is served as static files by the nginx of the maintainers' website server. The real address
and the deploy user are kept outside the repository: below, `<server address>` and `<deploy user>` stand for
them. DNS: `A agent → <server address>` in the foxleague.ai zone.

First time, on the server (with sudo):

1. `sudo mkdir -p /var/www/agent.foxleague.ai`, `sudo touch /var/www/agent.foxleague.ai.deploys` and
   `sudo chown -R <deploy user>:www-data` on both: the deploy runs as a user of its own, which has no sudo. Then
   install `nginx/agent.foxleague.ai.http-only.conf` as `/etc/nginx/sites-available/foxleague-agent`, link it from
   `sites-enabled`, `sudo nginx -t` and reload. (On a server with other sites, give the file a name that sorts
   after the site that should keep answering unknown hosts on 443.)
2. Once the DNS answers the server's address everywhere:
   `sudo certbot certonly --webroot -w /var/www/html -d agent.foxleague.ai` (renewal runs from certbot's timer).
3. Replace the file with `nginx/agent.foxleague.ai.conf` (http redirect plus the https site), `sudo nginx -t`,
   reload.

Every deploy, from your computer:

```sh
SITE_HOST=<deploy user>@<server address> ./site/deploy-site.sh
```

Or write `<deploy user>@<server address>` into `site/.host` once and run `./site/deploy-site.sh`: git ignores that
file, so it never leaves your computer.

It builds the current commit from a fresh clone (never from the working folder, so nothing uncommitted or
secret can ship), refuses a build that holds a key-like file, copies `dist/` to `/var/www/agent.foxleague.ai/`
and logs the commit in `/var/www/agent.foxleague.ai.deploys`.

After the first deploy the FoxLeague owner submits `https://agent.foxleague.ai/sitemap-index.xml` in Google
Search Console. The `Dockerfile` and `nginx.conf` here are an alternative for a host that runs containers.

## Launch day

Until the repository is public, the install line and the repository address sit in an orange "Coming soon" frame
(`src/components/ComingSoon.astro`): it shows the real address, and a click opens Foxsy AI's GitHub page, never a
404. When the repository goes public:

1. Remove the `<ComingSoon>` frames (keep what they wrap) in `index.mdx`, `start/install-windows.mdx`,
   `start/install-mac.mdx`, `start/install-linux.mdx` and `help/server.mdx`, and the `banner:` lines in `index.mdx`,
   `start/install.mdx` and the three `start/install-*.mdx` pages.
2. Point the GitHub icon in `astro.config.mjs` at `https://github.com/foxsyai/foxleague-agent`.
3. Deploy, then run the one-line install on a clean machine.

This folder is not part of the release downloads (`.gitattributes`) or the server deploys.
