// R2I-7 (the owner's text rule on a new page sentence): round two's own wording pass (9b45909, "Plain words in the new
// lines of round two: no comma before a closing and") took the comma out of the Mac page's new sentence, "An agent you
// stopped stays stopped: the update says so and it starts with the new version at your next login." Its twin on the
// Linux page, added by the same change (UPD-U5), still has it: "A background service you stopped stays stopped: the
// update says so, and `systemctl --user start foxleague-agent` starts it with the new version."
// (get.ps1's own check holds every screen line to the same rule: no ", and " and no ", or ".)
// Right: the sentences round two added to the guides for UPD-U5 have no comma before a closing "and" or "or".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const TREE = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '')
const PAGES = ['site/src/content/docs/start/install-linux.mdx', 'site/src/content/docs/start/install-mac.mdx', 'site/src/content/docs/help/update.md', 'INSTALL.md']

test('R2I-7: the new "stays stopped" sentence of each guide has no comma before a closing and/or', () => {
  for (const f of PAGES) {
    const text = readFileSync(`${TREE}/${f}`, 'utf8').replace(/\s+/g, ' ')
    // From its first words to the full stop that ends it (a full stop followed by a space or the end).
    const sentences = [...text.matchAll(/[A-Z][^.]*you stopped stays stopped.*?\.(?= |$)/g)].map(m => m[0])
    assert.ok(sentences.length > 0, `${f}: the sentence is there`)
    for (const s of sentences) assert.doesNotMatch(s, /, (and|or) /, `${f}: ${s}`)
  }
})
