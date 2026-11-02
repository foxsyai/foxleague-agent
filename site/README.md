# agent.foxleague.ai

The manual of the FoxLeague agent: install, keys, the dashboard, how it plays, safety, costs and help. The same
stack and look as docs.foxleague.ai (Astro 6 and Starlight 0.38, the FoxLeague brand styles).

```sh
cd site
npm install
npm run dev          # http://localhost:4321 while writing
npm run build        # static site in dist/
```

Pages are in `src/content/docs/`, the sidebar in `astro.config.mjs`. Screenshots of the dashboard come from a
throwaway demo install with made-up data; retake them after a dashboard change, from the repository root:

```sh
node --disable-warning=ExperimentalWarning site/scripts/screenshots.ts
```

`public/og.png` is the link preview (1200×630) and `src/assets/hero.png` the home image, both from the launch
media canvas.

## Serving it

agent.foxleague.ai runs on the FOXSY website droplet (134.209.228.52, next to foxsy.ai), served by its nginx as
static files. DNS: `A agent → 134.209.228.52` in the foxleague.ai zone.

First time, on the droplet (with sudo):

1. `sudo mkdir -p /var/www/agent.foxleague.ai`, `sudo touch /var/www/agent.foxleague.ai.deploys` and `sudo chown -R web:www-data` on both: the deploy runs as the deploy user `web`, which has no sudo. Then install `nginx/agent.foxleague.ai.http-only.conf` as
   `/etc/nginx/sites-available/foxleague-agent`, link it from `sites-enabled`, `sudo nginx -t` and reload. (The
   name sorts after `foxkeeper.foxsy.ai`, so the site that answers unknown hosts on 443 stays the same.)
2. Once the DNS answers the droplet's address everywhere:
   `sudo certbot certonly --webroot -w /var/www/html -d agent.foxleague.ai` (renewal runs from certbot's timer).
3. Replace the file with `nginx/agent.foxleague.ai.conf` (http redirect plus the https site), `sudo nginx -t`,
   reload.

Every deploy, from your computer:

```sh
SITE_HOST=user@134.209.228.52 ./site/deploy-site.sh     # or put user@host in site/.host
```

It builds the current commit from a fresh clone (never from the working folder, so nothing uncommitted or
secret can ship), refuses a build that holds a key-like file, copies `dist/` to `/var/www/agent.foxleague.ai/`
and logs the commit in `/var/www/agent.foxleague.ai.deploys`.

After the first deploy the FoxLeague owner submits `https://agent.foxleague.ai/sitemap-index.xml` in Google
Search Console. The `Dockerfile` and `nginx.conf` here are an alternative for a host that runs containers.

## Launch day

Until the repository is public, the install line and the repository address sit in an orange "Coming soon" frame
(`src/components/ComingSoon.astro`): it shows the real address, and a click opens Foxsy AI's GitHub page, never a
404. When the repository goes public:

1. Remove the `<ComingSoon>` frames (keep what they wrap) in `index.mdx`, `start/install.mdx` and `help/server.mdx`,
   and the `banner:` lines in `index.mdx` and `start/install.mdx`.
2. Point the GitHub icon in `astro.config.mjs` at `https://github.com/foxsyai/foxleague-agent`.
3. Deploy, then run the one-line install on a clean machine.

This folder is not part of the release downloads (`.gitattributes`) or the server deploys.
