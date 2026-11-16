// INS-A7: "A folder the agent may not write to: run ./install.sh --update in a terminal" (the Update page, under
// "Installs that do not update themselves"; the dashboard's notice and /upgrade say the same sentence). The
// terminal's update asks the same question first (selfUpdateRefusal in terminalUpdate) and answers with the same
// sentence: "No update: the agent may not write to its own folder: update it in a terminal with ./install.sh
// --update." The owner is sent in a circle and no place says what does help (make the folder yours again:
// sudo chown -R "$USER" on it). It is reached when the folder came back from a backup or from another machine
// through sudo or another account, the case INSTALL-20 already counts on for the modes.
// Safe: the command the notice and the page send the owner to never answers by naming itself as the way out.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildRelease, publish, serve } from '../update-fixtures.ts'
import { KEY, REPO, realTree, running, sh, stubs, tmp } from '../audit-1111/install-helpers.ts'

test('INS-A7: ./install.sh --update on a folder the user may not write to does not answer "update it in a terminal with ./install.sh --update"', { timeout: 240_000 }, async t => {
  if (process.getuid!() === 0) return t.skip('root may write everywhere')
  // Before the fix the page sent the owner to this very command ("**A folder the agent may not write to**: run
  // `./install.sh --update` in a terminal."). It now names what helps: the folder made the user's own again.
  const page = readFileSync(join(REPO, 'site/src/content/docs/help/update.md'), 'utf8').replace(/\s+/g, ' ')
  const row = page.slice(page.indexOf('**A folder the agent may not write to**'), page.indexOf('### Switching the check off'))
  assert.match(row, /make it yours again in a terminal, then update again/)
  assert.match(row, /sudo chown -R "\$USER" ~\/foxleague-agent && chmod -R u\+rwX ~\/foxleague-agent/)
  assert.doesNotMatch(row, /run `\.\/install\.sh --update` in a terminal/)
  const s = stubs()
  const i = running(s)
  const out = tmp()
  buildRelease(out, realTree(tmp(), '3.2.0'), '3.2.0', KEY.privatePem)
  const web = await serve(publish(tmp(), [{ dir: out, version: '3.2.0' }], '3.2.0'))
  chmodSync(join(i.root, 'versions'), 0o555)
  try {
    const r = await sh(join(i.root, 'install.sh'), ['--update'], i.env(web.base), { cwd: i.root })
    assert.notEqual(r.status, 0, r.out)
    assert.doesNotMatch(r.out, /update it in a terminal with \.\/install\.sh --update/, `the terminal's update names itself as the way out:\n${r.out}`)
    // And it names what helps, with this folder.
    assert.ok(r.out.includes(`chown -R`) && r.out.includes(`"${i.root}"`), r.out)
  } finally {
    chmodSync(join(i.root, 'versions'), 0o755)
    await web.close()
  }
})
