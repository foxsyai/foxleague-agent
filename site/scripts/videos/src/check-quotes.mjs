// Holds every installer line the videos quote against the repository this script sits in: each quoted line must
// still stand in its file, found by its text (src/quotes.mjs). A line that only moved is fine and said; a line that
// changed or is gone means the videos show old text and must be drawn again. Run it from the repository root after
// an installer changed (an audit, a release); `npm test` runs the same check (test/install-videos.test.ts).
//
//   node site/scripts/videos/src/check-quotes.mjs            the check; status 1 when a quoted line changed
//   node site/scripts/videos/src/check-quotes.mjs --readme   the same, and writes the table of quotes into README.md
//
// It needs no browser, no screenshots and none of the packages of package.json.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { findLine, quotedLines } from './quotes.mjs'

const ROOT = resolve(import.meta.dirname, '..') // site/scripts/videos
const REPO = resolve(ROOT, '..', '..', '..')
if (!existsSync(join(REPO, 'install.sh'))) throw new Error(`${REPO} is not the foxleague-agent repository`)

const files = new Map() // file -> its lines, or null when it is gone
const linesOf = f => {
  if (!files.has(f)) files.set(f, existsSync(join(REPO, f)) ? readFileSync(join(REPO, f), 'utf8').split('\n') : null)
  return files.get(f)
}

const { quoted, outside } = quotedLines()
let changed = 0, moved = 0
const rows = []
for (const e of quoted) {
  const lines = linesOf(e.f)
  const at = lines ? findLine(lines, e.frags, e.l) : 0
  if (!at) {
    changed++
    console.log(`CHANGED  ${e.f} (was line ${e.l})  ${lines ? 'no line has' : 'the file is gone, it had'}: ${e.frags.map(m => JSON.stringify(m)).join(', ')}`)
  } else if (at !== e.l) {
    moved++
    console.log(`moved    ${e.f}:${e.l} is now line ${at} (fine; the number in src/text.mjs is a hint)`)
  }
  rows.push(`| ${e.videos.join(', ')} | \`${e.f}:${at || e.l}\` | ${e.texts.map(t => t.replaceAll('|', '\\|')).join(' / ') || '(empty line)'} | ${at ? 'ok' : 'CHANGED'} |`)
}
console.log(`${quoted.length} quoted lines: ${changed} changed, ${moved} moved. ${outside.length} lines are not from the repository (listed in README.md).`)
if (changed) console.log('The videos show text the installers no longer print. Re-render them: README.md, "When to draw them again".')

if (process.argv.includes('--readme')) {
  let commit = 'the working tree'
  try { commit = `commit ${execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim()}` } catch {}
  const table = [
    `Checked against ${commit} (${new Date().toISOString().slice(0, 10)}): ${quoted.length} quoted lines, ${changed} changed.`,
    '',
    '| Video | File:line | Text on screen | Check |',
    '|---|---|---|---|',
    ...rows,
    '',
    'Lines that are not from the repository (the system\'s own words, written as they usually appear):',
    '',
    '| Video | Source | Text on screen |',
    '|---|---|---|',
    ...outside.map(e => `| ${e.videos.join(', ')} | ${e.why} | ${e.text.trim().replaceAll('|', '\\|') || '(empty)'} |`),
  ].join('\n')
  const readme = join(ROOT, 'README.md')
  const text = readFileSync(readme, 'utf8')
  const a = '<!-- quotes:start -->', b = '<!-- quotes:end -->'
  if (!text.includes(a) || !text.includes(b)) throw new Error('README.md has no quotes markers')
  writeFileSync(readme, text.slice(0, text.indexOf(a) + a.length) + '\n' + table + '\n' + text.slice(text.indexOf(b)))
  console.log('README.md: table of quotes written')
}
process.exit(changed ? 1 : 0)
