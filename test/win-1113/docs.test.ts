// The record of the Windows real-PC check of 2026-11-13 and the guide corrections (W-DOC-1 to W-DOC-8): the section
// of docs/SECURITY-REVIEW.md, its rows in the table format, what stays open, the walk-through and its lines file.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO } from '../update-fixtures.ts'

const raw = (f: string): string => readFileSync(join(REPO, f), 'utf8')
const IDS = ['W-1', 'W-2', 'W-3', 'W-4', 'W-5', 'W-6', 'W-7', 'W-8', 'W-9', 'W-10', 'W-11', 'W-12', 'W-13', 'LOGIN-1',
  'W-DOC-1', 'W-DOC-2', 'W-DOC-3', 'W-DOC-4', 'W-DOC-5', 'W-DOC-6', 'W-DOC-7', 'W-DOC-8']

function section(): string {
  const record = raw('docs/SECURITY-REVIEW.md')
  const from = record.indexOf('\n## Windows real-PC check (2026-11-13)')
  assert.ok(from > 0, 'the section is in the record')
  const next = record.indexOf('\n## ', from + 1)
  return record.slice(from, next < 0 ? undefined : next)
}

test('W-DOC the record: one row per id in the table format, each with its severity, and what stays open', () => {
  const s = section()
  assert.ok(s.includes('| Id | Severity | Finding | Fix |\n|---|---|---|---|\n'))
  for (const id of IDS) {
    const rows = s.split('\n').filter(l => l.startsWith(`| ${id} |`))
    assert.equal(rows.length, 1, id)
    assert.equal(rows[0]!.split(/(?<!\\)\|/).slice(1, -1).length, 4, `${id} has four cells`)
  }
  const w9 = s.split('\n').find(l => l.startsWith('| W-9 |'))!
  for (const said of ['high', 'openat2', 'ENOSYS', 'CVE-2025-45582', 'RestrictSUIDSGID', '`./install.sh --update`', 'FRESH_UBUNTU=26.04']) assert.ok(w9.includes(said), said)
  assert.match(s, /\nStays open:\n/)
  assert.doesNotMatch(s, /[^\x00-\x7e]/, 'plain ASCII: no long dash')
})

test('W-DOC the walk-through: the OpenSSH MSI, a block that stops, curl.exe, OneDrive, AGENT_UPDATE_URL with a loopback relay, the lines file', () => {
  const plan = raw('docs/WINDOWS-TEST.md')
  const flat = plan.replace(/\s+/g, ' ')
  assert.match(flat, /`Add-WindowsCapability` failed with "The specified package is not valid Windows package"/)
  assert.match(plan, /^msiexec \/i \.\\OpenSSH-Win64-vX\.Y\.Z\.msi ADDLOCAL=Server \/qn$/m)
  assert.match(flat, /It is one script block: a step that fails ends it with one sentence/)
  assert.match(flat, /`scp` to the PC did not work on the first one/)
  assert.match(flat, /The desktop may be a folder of OneDrive/)
  assert.match(plan, /\[Environment\]::GetFolderPath\('Desktop'\)/)
  assert.match(flat, /the agent asks GitHub unless `AGENT_UPDATE_URL` in its `\.env` names another place\. It takes plain http only from this computer itself \(a loopback address\)/)
  assert.match(plan, /^printf 'AGENT_UPDATE_URL="http:\/\/127\.0\.0\.1:8765"\\n' >> ~\/foxleague-agent\/\.env$/m)
  assert.match(flat, /`0x800710E0` \("The operator or administrator has refused the request"\) is normal while the task runs/)
  assert.match(flat, /pasting the line again puts the newest release in place as chosen by hand, with no undo note/)
  assert.match(flat, /Every line typed at the PC is in one text file, `docs\/WINDOWS-TEST-LINES\.txt`/)
  const lines = raw('docs/WINDOWS-TEST-LINES.txt')
  assert.doesNotMatch(lines, /[^\x00-\x7e]/, 'the lines file is plain ASCII')
  for (const line of ['Get-Content -Raw .\\get.ps1 | iex', "& ([scriptblock]::Create((Get-Content -Raw .\\get.ps1))) -Uninstall", 'curl.exe -s http://localhost:8870/healthz', 'wsl -l --running', 'cd ~/foxleague-agent && ./install.sh --uninstall']) {
    assert.ok(lines.split('\n').includes(line), line)
  }
  assert.ok(plan.includes("sed 's/LAPTOP/<laptop address>/g' docs/WINDOWS-TEST-LINES.txt > /tmp/fox-win/site/lines.txt"), 'the laptop fills its address in')
})
