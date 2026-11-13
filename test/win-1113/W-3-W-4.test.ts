// W-1, W-3 and W-4 (Windows real-PC check of 2026-11-13, low): the guides, next to what get.ps1 now says before the
// Ubuntu download (its own checks are in test/windows/get-ps1.checks.ps1, "W-1 ...", "W-3 ..." and "W-4 ...").
//   W-1: get.ps1 did not look at the free disk space; C: had 0.2 GB on the PC.
//   W-3: the download bar stood at 0% because a click into the console window starts Windows' text selection, which
//        pauses the program until Enter; and WSL opened its own "Welcome to WSL" window, which took the focus.
//   W-4: Ubuntu's first start asked one question nobody had mentioned: "Help improve Ubuntu! ... (Y/n/e)".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO } from '../update-fixtures.ts'

const flat = (f: string): string => readFileSync(join(REPO, f), 'utf8').replace(/\s+/g, ' ')
const GUIDES = ['INSTALL.md', 'site/src/content/docs/start/install.mdx']

test('W-3 the guides say that the Ubuntu download can look stuck, why, and the welcome window', () => {
  for (const f of GUIDES) {
    assert.match(flat(f), /The download can look stuck at 0%: a click into the PowerShell window pauses it \(Windows then selects text\), and Enter once lets it go on\. A window "Welcome to WSL" may open by itself: close it\./, f)
  }
})

test('W-4 the guides say that Ubuntu may ask "Help improve Ubuntu!" and that either answer is fine', () => {
  for (const f of GUIDES) assert.match(flat(f), /Ubuntu may also ask "Help improve Ubuntu!" \(Y\/n\/e\): either answer is fine for the agent\./, f)
})

test('W-1 the guides say how much free space the Windows line needs and that it checks it', () => {
  assert.match(flat('INSTALL.md'), /When Ubuntu still has to be installed it needs about 4 GB free on drive C: and checks that before the download\./)
  assert.match(flat('site/src/content/docs/start/install.mdx'), /When Ubuntu still has to be installed it also needs about 4 GB free on drive C: \(the line checks it before the download\)\./)
})
