// Audit 2026-11-11: the record of the final audit in docs/SECURITY-REVIEW.md, held to the audit itself. Every
// finding of the six areas is named in the section (in a row, in the paragraph that pairs the doubles or under
// Stays open), the counts add up, and the numbers the rows about the update give are the code's.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { CHECK_EVERY_MS, CONFIRM_AFTER_MS, RESTART_EXIT_CODE } from '../../src/update/updater.ts'
import { RELEASE_KEYS } from '../../src/update/keys.ts'

const ROOT = new URL('../../', import.meta.url)
const record = readFileSync(new URL('docs/SECURITY-REVIEW.md', ROOT), 'utf8')
const TITLE = '## Final audit before the public launch (2026-11-11): six Claude Fable 5.2 reviewers at extra-high effort, the fixes by Claude Fable 5.2 at high effort'
const section = record.slice(record.indexOf(TITLE))
const flat = section.replace(/\s+/g, ' ')
const AREAS: Record<string, [findings: number, medium: number, low: number]> = { MONEY: [4, 2, 2], ATTACK: [8, 2, 6], EDGE: [8, 1, 7], INTEG: [6, 0, 6], INSTALL: [21, 5, 16], DOCS: [14, 6, 8] }

test('the final audit is one section at the end of the record, with the method and one table in the file\'s format', () => {
  assert.equal(record.split(TITLE).length, 2, 'the section is there once')
  assert.equal(section.split('\n## ').length, 1, 'it is the last section')
  assert.match(flat, /on the frozen tree `ac8833f`/)
  assert.match(flat, /the proofs are kept under `test\/audit-1111\/`/)
  assert.match(flat, /No critical and no high finding/)
  assert.equal(section.split('| Id | Severity | Finding | Fix |').length, 2, 'one findings table')
  assert.ok(readdirSync(new URL('test/audit-1111/', ROOT)).filter(f => f.endsWith('.test.ts')).length >= 50)
})

test('the counts per area are the reviewers\' and add up', () => {
  let all = [0, 0, 0]
  for (const [area, [n, medium, low]] of Object.entries(AREAS)) {
    assert.equal(medium + low, n, area)
    assert.ok(section.includes(`| ${area} | ${n} | ${medium} | ${low} |`), `${area}: ${n} findings, ${medium} medium, ${low} low`)
    all = [all[0]! + n, all[1]! + medium, all[2]! + low]
  }
  assert.deepEqual(all, [61, 16, 45])
  assert.ok(section.includes('| All | 61 | 16 | 45 |'))
})

test('every finding of the six areas is named in the section', () => {
  const missing: string[] = []
  for (const [area, [n]] of Object.entries(AREAS)) {
    for (let i = 1; i <= n; i++) if (!new RegExp(`\\b${area}-${i}(?![0-9])`).test(section)) missing.push(`${area}-${i}`)
  }
  assert.deepEqual(missing, [])
})

test('every severity in the table is lower case, and every row has its four cells', () => {
  const rows = section.split('\n').filter(l => l.startsWith('| ') && !l.startsWith('| Id ') && !l.startsWith('| Area ') && !/^\| (MONEY|ATTACK|EDGE|INTEG|INSTALL|DOCS|All) \| \d/.test(l))
  assert.ok(rows.length >= 60, `${rows.length} rows`)
  for (const row of rows) {
    const cells = row.split(/(?<!\\)\|/).slice(1, -1)
    assert.equal(cells.length, 4, row.slice(0, 60))
    assert.match(cells[1]!.trim(), /^(medium|low|new feature)( \(|$)/, row.slice(0, 60))
    assert.ok(cells[2]!.trim().length > 20 && cells[3]!.trim().length > 5, row.slice(0, 60))
  }
})

test('the rows of the one-click update name what the design guarantees, with the code\'s numbers', () => {
  for (const id of ['UPD-1 to UPD-5', 'UPD-6 to UPD-11, GET-1, GET-2, INS-1, INS-2', 'UPD-12 to UPD-20', 'REL-1, REL-2']) assert.ok(section.includes(`| ${id} | new feature |`), id)
  assert.equal(CONFIRM_AFTER_MS / 1000, 45)
  assert.equal(CHECK_EVERY_MS / 60_000, 10)
  assert.equal(RESTART_EXIT_CODE, 75)
  for (const said of [
    'signed with the maintainers\' Ed25519 key', 'no downgrade', 'its size and SHA-256 are the signed ones', 'the running one is never written to',
    'prepares itself (`install.sh --prepare`', 'has not stayed up for 45 seconds in two starts is undone by the launcher', 'tells the owner once per version',
    'about every 10 minutes', 'only on the owner\'s ask', 'exit code 75',
  ]) assert.ok(flat.includes(said), said)
})

test('the owner\'s three decisions are recorded, with the reviewer\'s dissent on the password', () => {
  const decisions = flat.slice(flat.indexOf('Decisions of the owner (2026-11-11):'), flat.indexOf('Stays open:'))
  assert.match(decisions, /\*\*Signed releases\.\*\*/)
  assert.match(decisions, /with a passphrase/)
  assert.match(decisions, /\*\*One click, and `\/upgrade` on Telegram, with no password\.\*\*/)
  assert.match(decisions, /it asked for the password on the click and for Telegram to announce only, because an update replaces the code that enforces the caps/)
  assert.match(decisions, /only a signed release that is newer than the running one can be installed, whoever asks/)
  assert.match(decisions, /\*\*MONEY-2\.\*\*/)
})

test('what stays open is listed, and the list is true of the tree', () => {
  const open = flat.slice(flat.indexOf('Stays open:'))
  for (const said of [
    'trusts GitHub over https and the release\'s checksum', 'macOS or on Windows', 'Node.js v22.22.0', '`nginx -t`', 'INSTALL-21',
    'DOCS-11\'s launch-day items', '`RELEASE_KEYS` in `src/update/keys.ts` is empty', 'Friday 13 November 2026',
  ]) assert.ok(open.includes(said), said)
  // True today; when one of these changes, its line goes.
  assert.equal(RELEASE_KEYS.length, 0, 'the release key is pinned now: take the line out of Stays open')
  assert.match(readFileSync(new URL('install.sh', ROOT), 'utf8'), /^NODE_VERSION=v22\.22\.0$/m)
  assert.match(readFileSync(new URL('README.md', ROOT), 'utf8'), /Status: in internal testing/)
  assert.equal((JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8')) as { version: string }).version, '0.11.0')
  assert.ok(existsSync(new URL('docs/RELEASING.md', ROOT)))
  assert.doesNotMatch(readFileSync(new URL('get.sh', ROOT), 'utf8'), /--proto/)
})

// After the audit: the install replayed on a fresh Ubuntu and done by the owner (FRESH-1 to FRESH-14), the agent
// review of pull request #61 (R61A-1) and the four fixes in the updater and the service (UPD-21 to UPD-24).
const row = (id: string): string[] | null => {
  const line = section.split('\n').find(l => l.startsWith(`| ${id} |`))
  return line ? line.split(/(?<!\\)\|/).slice(1, -1).map(c => c.trim()) : null
}

test('the fresh install has its fourteen rows: FRESH-1 and FRESH-3 medium, the rest low, each with its test', () => {
  for (let n = 1; n <= 14; n++) {
    const cells = row(`FRESH-${n}`)
    assert.ok(cells, `no row FRESH-${n}`)
    assert.equal(cells[1], n === 1 || n === 3 ? 'medium' : 'low', `FRESH-${n}`)
    assert.ok(existsSync(new URL(`test/audit-1111/fresh-${n}.test.ts`, ROOT)), `fresh-${n}.test.ts`)
  }
  assert.match(row('FRESH-13')![3]!, /link/)
  assert.match(row('FRESH-13')![3]!, /browser/)
  assert.match(row('FRESH-14')![2]!, /Enter at "Enter keys now\?"/)
  assert.match(flat, /`scripts\/release\/fresh-install-check\.sh`/)
  assert.match(flat, /They are not in the counts above/)
})

test('the agent review of pull request #61 has its row', () => {
  const cells = row('R61A-1')
  assert.ok(cells, 'no row R61A-1')
  assert.equal(cells[1], 'low')
  assert.match(cells[2]!, /pull request #61/)
  assert.match(cells[2]!, /had no test/)
  assert.match(cells[2]!, /the same price/)
  assert.match(cells[3]!, /Fixed in that pull request/)
})

test('the four fixes after the walk-through have their rows, with the code\'s own words and numbers', async () => {
  const { LISTEN_RETRY_MS } = await import('../../src/web/server.ts')
  const installer = readFileSync(new URL('install.sh', ROOT), 'utf8')
  const ids: [string, string][] = [['UPD-21', 'medium'], ['UPD-22', 'low'], ['UPD-23', 'medium'], ['UPD-24', 'low']]
  for (const [id, severity] of ids) {
    const cells = row(id)
    assert.ok(cells, `no row ${id}`)
    assert.equal(cells[1], severity, id)
    assert.ok(existsSync(new URL(`test/audit-1111/${id.toLowerCase()}.test.ts`, ROOT)), `${id.toLowerCase()}.test.ts`)
  }
  assert.match(row('UPD-21')![3]!, /`FOXAGENT_SUPERVISED=1`/)
  assert.match(row('UPD-21')![3]!, /runs from the next start/)
  assert.match(installer, /"FOXAGENT_SUPERVISED=1"/)
  assert.match(row('UPD-22')![3]!, /`Restart=always`/)
  assert.match(installer, /^Restart=always$/m)
  assert.match(row('UPD-23')![3]!, /every 60 seconds/)
  assert.equal(LISTEN_RETRY_MS, 60_000)
  assert.match(row('UPD-24')![3]!, /the last update is still being confirmed, try again in a minute/)
  assert.match(row('UPD-24')![2]!, new RegExp(`${CONFIRM_AFTER_MS / 1000} seconds`))
})

test('what the walk-through fixed is no longer open, and what it left is', () => {
  const open = flat.slice(flat.indexOf('Stays open:'))
  // Fixed: FRESH-4, FRESH-12, FRESH-2 and UPD-22.
  assert.doesNotMatch(open, /the installer ends when the dashboard password is shorter/)
  assert.doesNotMatch(open, /a wrong Telegram token at the keys step ends it/)
  assert.doesNotMatch(open, /checks for systemd only at its last step/)
  assert.doesNotMatch(open, /is not started again by systemd/)
  assert.doesNotMatch(readFileSync(new URL('install.sh', ROOT), 'utf8'), /Restart=on-failure/)
  // Left.
  assert.match(open, /reaches an existing install only when its owner runs the installer again/)
  assert.match(open, /replayed on Ubuntu 24\.04 in a container/)
  assert.match(open, /by the owner on a real Ubuntu desktop/)
})
