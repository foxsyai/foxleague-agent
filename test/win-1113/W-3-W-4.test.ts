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
// (The Windows page since 2026-11-15, when the Install page became the choice of a system.)
const WINDOWS = 'site/src/content/docs/start/install-windows.mdx'
const GUIDES = ['INSTALL.md', WINDOWS]

test('W-3 the guides say that the Ubuntu download can look stuck, why, and the welcome window', () => {
  for (const f of GUIDES) {
    assert.match(flat(f), /The download can look stuck at 0%: a click into the PowerShell window pauses it \(Windows then selects text\); Enter once lets it go on\. A window "Welcome to WSL" may open by itself: close it\./, f)
  }
})

test('W-4 the guides say that Ubuntu may ask "Help improve Ubuntu!" and that either answer is fine', () => {
  for (const f of GUIDES) assert.match(flat(f), /Ubuntu may also ask "Help improve Ubuntu!" \(Y\/n\/e\): either answer is fine for the agent\./, f)
})

test('W-1 the guides say how much free space the Windows line needs and that it checks it', () => {
  for (const f of GUIDES) {
    assert.match(flat(f), /\*\*About 4 GB free on drive C:\*\* when Ubuntu still has to be installed\. The line checks it before the download and stops below that\./, f)
  }
  assert.match(flat('README.md'), /Installing Ubuntu needs about 4 GB free on drive C:\./)
})
