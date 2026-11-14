// The record of the Windows real-PC re-test of 2026-11-14 (W-14 to W-17) and the guides that tell the same: the
// section of docs/SECURITY-REVIEW.md, its rows in the table format, what stays open, the walk-through and its lines
// file, INSTALL.md and the site's pages.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flat, raw } from './helpers.ts'

const IDS: [id: string, severity: RegExp][] = [['W-15', /^medium/], ['W-15b', /^low/], ['W-16', /^low/], ['W-14', /^low/], ['W-17', /^low/]]
const HEADING = '\n## Windows real-PC re-test (2026-11-14)\n'

function section(): string {
  const record = raw('docs/SECURITY-REVIEW.md')
  const from = record.indexOf(HEADING)
  assert.ok(from > 0, 'the section is in the record')
  assert.equal(record.split(HEADING).length, 2, 'once')
  // Right after the first check of the same PC; the section of PR #68 stays the last one (CO-docs).
  assert.ok(from > record.indexOf('\n## Windows real-PC check (2026-11-13)\n'), 'after the check of 13 Nov')
  assert.ok(from < record.indexOf('\n## One manager message at a time (2026-11-13)\n'), 'before the last section')
  const next = record.indexOf('\n## ', from + 1)
  return record.slice(from, next < 0 ? undefined : next)
}

test('W-DOC re-test: the record has one row per id in the table format, what passed and what stays open', () => {
  const s = section()
  assert.ok(s.includes('| Id | Severity | Finding | Fix |\n|---|---|---|---|\n'))
  for (const [id, severity] of IDS) {
    const rows = s.split('\n').filter(l => l.startsWith(`| ${id} |`))
    assert.equal(rows.length, 1, id)
    const cells = rows[0]!.split(/(?<!\\)\|/).slice(1, -1).map(c => c.trim())
    assert.equal(cells.length, 4, `${id} has four cells`)
    assert.match(cells[1]!, severity, id)
  }
  const text = s.replace(/\s+/g, ' ')
  assert.match(text, /67f1031/, 'the candidate that was tried')
  assert.match(text, /test\/win-1114\//)
  assert.match(text, /What passed on the PC/)
  const open = text.slice(text.indexOf('Stays open:'))
  assert.ok(text.includes('Stays open:'))
  // Not seen on the PC, so not claimed.
  assert.match(open, /Enter alone at Ubuntu's username question/)
  assert.match(open, /below 4 GB/)
  assert.match(open, /"Help improve Ubuntu!"/)
  assert.match(open, /"Welcome to WSL"/)
  assert.match(open, /None of these five fixes has run on the real PC yet/)
  assert.doesNotMatch(s, /[^\x00-\x7e]/, 'plain ASCII: no long dash')
  assert.doesNotMatch(text, /\bbots?\b/i)
})

test('W-DOC re-test: the lines file has one PowerShell line for the uninstall and marks every line typed inside Ubuntu', () => {
  const lines = raw('docs/WINDOWS-TEST-LINES.txt')
  assert.doesNotMatch(lines, /[^\x00-\x7e]/, 'plain ASCII')
  const all = lines.split('\n')
  const at = all.findIndex(l => l.startsWith('== Step 15'))
  assert.ok(at > 0)
  const end = all.findIndex((l, i) => i > at && l.startsWith('== '))
  const step = all.slice(at, end < 0 ? undefined : end)
  assert.match(step[0]!, /one line ==$/)
  // Before the first note: the folder and the one uninstall line, both in PowerShell.
  const first = step.slice(1, step.findIndex(l => l.startsWith('#')))
  assert.deepEqual(first, ["cd ([Environment]::GetFolderPath('Desktop'))", "& ([scriptblock]::Create((Get-Content -Raw .\\get.ps1))) -Uninstall"])
  assert.match(step.join('\n'), /# It asks one question: press Enter\./)
  assert.match(step.join('\n'), /Nothing has to be typed inside Ubuntu\./)
  // Every line typed inside Ubuntu, in the whole file, sits between the two marks; each block opens Ubuntu first.
  let inside = false
  const ubuntu = /^(systemd-run |printf |systemctl |sed |cd ~\/foxleague-agent|exit$)/
  for (const [i, l] of all.entries()) {
    if (l === '# >>> INSIDE UBUNTU, one line at a time:') {
      assert.equal(inside, false, `line ${i + 1}`)
      assert.equal(all[i - 1], 'wsl -d Ubuntu --cd ~', `line ${i + 1}: Ubuntu is opened right before`)
      inside = true
    } else if (l === '# <<< BACK IN POWERSHELL') {
      assert.equal(inside, true, `line ${i + 1}`)
      assert.equal(all[i - 1], 'exit', `line ${i + 1}: the block ends with exit`)
      inside = false
    } else if (ubuntu.test(l)) assert.ok(inside, `line ${i + 1} is typed inside Ubuntu and is not marked: ${l}`)
  }
  assert.equal(inside, false, 'every block is closed')
  assert.match(lines, /^Never paste several lines at once/m)
})

test('W-DOC re-test: the walk-through, INSTALL.md and the site tell the uninstall of one line, the notice and the old-install message', () => {
  const plan = flat('docs/WINDOWS-TEST.md')
  assert.match(plan, /\| 15 \| The uninstall: the one PowerShell line with `-Uninstall` and Enter at its one question \|/)
  assert.match(plan, /the question "Also stop the agent and remove its background service in Ubuntu\?"/)
  assert.match(plan, /Nothing is typed inside Ubuntu\./)
  assert.match(plan, /"Windows real-PC re-test \(2026-11-14\)"/)
  const question = '"Also stop the agent and remove its background service in Ubuntu?"'
  for (const f of ['INSTALL.md', 'site/src/content/docs/help/update.md']) {
    const page = flat(f)
    assert.match(page, /the uninstall is one line in PowerShell:/i, f)
    assert.ok(page.includes(question), `${f}: the question`)
    assert.match(page, /Enter means yes: it runs `\.\/install\.sh --uninstall` inside Ubuntu for you/, f)
    assert.ok(page.includes('wsl -d Ubuntu --cd ~'), `${f}: the line by hand that opens Ubuntu`)
    assert.ok(page.includes('cd ~/foxleague-agent && ./install.sh --uninstall'), `${f}: the line by hand inside Ubuntu`)
    assert.doesNotMatch(page, /two parts|names the step inside Ubuntu/, `${f}: the old two-part uninstall`)
  }
  // The question is the script's own.
  assert.ok(raw('get.ps1').includes("Confirm-Fox 'Also stop the agent and remove its background service in Ubuntu?' $true"))
  // The old-install message: the way into Ubuntu on Windows, and no button meanwhile.
  for (const f of ['INSTALL.md', 'site/src/content/docs/help/troubleshooting.md']) {
    const page = flat(f)
    assert.match(page, /On Windows, open Ubuntu first: `wsl -d Ubuntu --cd ~` in PowerShell, then `cd foxleague-agent`\./, f)
    assert.match(page, /offers no \*\*Update now\*\*: it would fail the same way/, f)
  }
  // The notice: only while the version it speaks of runs.
  const dash = flat('site/src/content/docs/use/dashboard.md')
  assert.match(dash, /only while the version it speaks of still runs: after you install another version by hand or from a terminal it goes/)
  assert.match(dash, /it then offers no \*\*Update now\*\*, which would fail the same way/)
})
