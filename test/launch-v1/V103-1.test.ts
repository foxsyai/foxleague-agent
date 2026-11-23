// V103-1 (the owner, launch day 23 Nov 2026, after the announcement): the tab icon should be the transparent fox, not
// the fox on a dark round badge. The site's tab icon changed in BRAND-2; the agent's dashboard and its sign-in page
// carry the same picture inline. Now both pages carry exactly the site's favicon-32.png, so the two cannot drift apart.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..')
const SITE_ICON = readFileSync(join(ROOT, 'site/public/brand/favicon-32.png'))

test('V103-1 the dashboard and the sign-in page show the site\'s transparent fox as their tab icon', () => {
  for (const p of ['src/web/dashboard.html', 'src/web/login.html']) {
    const icons = [...readFileSync(join(ROOT, p), 'utf8').matchAll(/<link rel="icon" type="image\/png" href="data:image\/png;base64,([A-Za-z0-9+/=]+)">/g)]
    assert.equal(icons.length, 1, `${p}: one tab icon`)
    assert.ok(Buffer.from(icons[0]![1]!, 'base64').equals(SITE_ICON), `${p}: the tab icon is site/public/brand/favicon-32.png`)
  }
})
