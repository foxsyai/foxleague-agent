// UPD-A4: `sudo ./install.sh --update` on an ordinary user's install is not refused, and what root writes there
// keeps the agent from ever starting again.
//
// install.sh:91 stops root only in the guided install (`[ "$MODE" = install ] && [ "$(id -u)" = 0 ]`); --update goes
// on as root (kept on purpose for an install that itself runs as root, INSTALL-17). On a user's install the update
// then runs `cli update` as root, and src/update/install.ts writes as root:
//   versions/.staging-v<new> -> versions/v<new>   mkdirSync(..., mode 0o700)  (install.ts:238): root's, rwx------
//   versions/pending, versions/active             writeAtomic(..., mode 0o600) (install.ts:273): root's, rw-------
//   data/update                                   mkdirSync(..., mode 0o700)  (updater.ts:322): root's, rwx------
// The agent's own user can read none of them. At the agent's next start run.sh cannot read versions/active
// ("versions/active does not name a release; run the install line again", exit 1) and could not enter the release
// folder either: the agent stays down until someone knows to chown the folder. Under sudo HOME is root's on Ubuntu,
// so the update itself ends with "No background service is installed here: start the agent again", status 0: the
// owner restarts the agent as told and it is gone. A later dashboard update would also meet a data/update it may
// not write to (UPD-A1).
// A newcomer reaches for sudo by habit, and two of the agent's own messages send them to this command ("the agent
// may not write to its own folder: update it in a terminal with ./install.sh --update").
//
// Right: as root on an install that belongs to another user, --update stops before it writes anything and says to
// run it without sudo. (The scripts ask `id -u` for the user; the stand-in below answers 0, as INSTALL-17's test
// does. The install folder belongs to the user who runs this test, who is not root.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildRelease, publish, serve, tmp } from '../update-fixtures.ts'
import { KEY, realTree, running, sh, stubs } from '../audit-1111/install-helpers.ts'

test('UPD-A4: ./install.sh --update as root on a user\'s install stops before it writes anything', { timeout: 240_000, skip: process.getuid?.() === 0 ? 'this test needs an install that does not belong to root' : false }, async () => {
  const s = stubs()
  // `sudo ./install.sh --update`: the script's `id -u` says 0.
  writeFileSync(join(s.dir, 'id'), '#!/usr/bin/env bash\nif [ "${1:-}" = -u ]; then echo 0; else exec /usr/bin/id "$@"; fi\n', { mode: 0o755 })
  const inst = running(s)
  const out = tmp()
  buildRelease(out, realTree(tmp(), '3.2.0'), '3.2.0', KEY.privatePem, { notes: 'Medicine for injured cards.' })
  const web = await serve(publish(tmp(), [{ dir: out, version: '3.2.0' }], '3.2.0'))
  try {
    const before = readdirSync(join(inst.root, 'versions')).sort()
    const r = await sh(join(inst.root, 'install.sh'), ['--update'], inst.env(web.base))
    assert.equal(readFileSync(join(inst.root, 'versions', 'active'), 'utf8'), 'v3.1.0\n', `root put a release in place in a user's install:\n${r.out}`)
    assert.deepEqual(readdirSync(join(inst.root, 'versions')).sort(), before, 'nothing was written to versions/')
    assert.equal(existsSync(join(inst.root, 'data', 'update')), false, 'no data/update of root')
    assert.notEqual(r.status, 0, r.out)
    assert.match(r.out, /root|sudo/i, 'the refusal says why')
    assert.deepEqual(s.calls().filter(c => c.startsWith('npm ') || c.startsWith('systemctl ')), [], 'nothing was prepared and nothing restarted')
  } finally {
    await web.close()
  }
})
