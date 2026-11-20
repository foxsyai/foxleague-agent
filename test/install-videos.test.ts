// R71A-1 (the GitHub review of PR #71): the install videos at the top of the three install pages had no test, and
// the script that draws them was not in the repository. A missing or misnamed video or poster failed no test, and
// when an installer's text changed the videos went stale with nothing to draw them again from.
// The script is now site/scripts/videos/ (next to the screenshots script). This file holds what can be read without
// watching a video: every page names its own video and poster and both are real files of the length the page says;
// every installer line the videos quote still stands in its file (found by its text, so an unrelated line shift
// does not fail it); and the script draws on example values only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Address } from '@multiversx/sdk-core'

const REPO = resolve(import.meta.dirname, '..')
const VIDEOS = join(REPO, 'site/scripts/videos')
const SYSTEMS = ['windows', 'mac', 'linux'] as const
const read = (p: string) => readFileSync(join(REPO, p), 'utf8')
/** A module of the script. Imported by a computed address: the script is plain JavaScript, not type-checked here. */
const script = async (p: string) => import(pathToFileURL(join(VIDEOS, 'src', p)).href)
const page = (os: string) => `site/src/content/docs/start/install-${os}.mdx`
const RERENDER = 'Re-render the videos (site/scripts/videos/README.md, "When to draw them again")'

type Quote = { f: string; l: number; frags: string[]; texts: string[]; videos: string[] }

/** The length of an MP4 in seconds (its movie header), and whether its index comes before the frames. */
function mp4(buf: Buffer): { seconds: number; indexFirst: boolean } {
  const box = (from: number, to: number, type: string): { start: number; end: number; at: number } | null => {
    for (let at = from; at + 8 <= to;) {
      let size = buf.readUInt32BE(at)
      let head = 8
      if (size === 1) { size = Number(buf.readBigUInt64BE(at + 8)); head = 16 } else if (size === 0) size = to - at
      if (size < head) return null
      if (buf.toString('latin1', at + 4, at + 8) === type) return { start: at + head, end: at + size, at }
      at += size
    }
    return null
  }
  const moov = box(0, buf.length, 'moov')
  const mdat = box(0, buf.length, 'mdat')
  assert.ok(moov && mdat, 'an MP4 with its index (moov) and its frames (mdat)')
  const mvhd = box(moov.start, moov.end, 'mvhd')
  assert.ok(mvhd, 'a movie header')
  const v = mvhd.start
  const seconds = buf[v] === 1 ? Number(buf.readBigUInt64BE(v + 24)) / buf.readUInt32BE(v + 20) : buf.readUInt32BE(v + 16) / buf.readUInt32BE(v + 12)
  return { seconds, indexFirst: moov.at < mdat.at }
}

/**
 * The quotes whose text no longer stands in their file. A quote holds when one line of its file has every quoted
 * piece (PowerShell doubles a ' inside a '...' string). The line number it was drawn from is not used.
 */
function staleQuotes(quoted: Quote[], readFile: (f: string) => string | null): string[] {
  const out: string[] = []
  for (const q of quoted) {
    const text = readFile(q.f)
    const holds = text !== null && text.split('\n').some(line => q.frags.every(fr => line.includes(fr) || line.includes(fr.replaceAll("'", "''"))))
    if (!holds) out.push(`${q.f} (was line ${q.l}, in the ${q.videos.join(', ')} video): ${q.texts.join(' / ') || '(empty line)'}`)
  }
  return out
}
const repoFile = (f: string) => (existsSync(join(REPO, f)) ? read(f) : null)

test('R71A-1 every install page shows its own video and poster: real files of the length the page says, drawn by the script', async () => {
  const files = readdirSync(join(REPO, 'site/public/videos')).sort()
  // Every /videos/ address any page of the manual names is a file there, and every file there is shown.
  const pages = (dir: string): string[] => readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? pages(`${dir}/${e.name}`) : /\.mdx?$/.test(e.name) ? [`${dir}/${e.name}`] : []))
  const named = new Set(pages('site/src/content/docs').flatMap(p => [...read(p).matchAll(/["(]\/videos\/([^"()\s]+)[")]/g)].map(m => m[1]!)))
  for (const n of named) assert.ok(files.includes(n), `${n} is named on a page and is not in site/public/videos`)
  assert.deepEqual(files, [...named].sort(), 'every file in site/public/videos is shown on a page')
  assert.deepEqual(files, SYSTEMS.flatMap(os => [`install-${os}.jpg`, `install-${os}.mp4`]).sort())

  for (const os of SYSTEMS) {
    const text = read(page(os))
    const intro = text.slice(0, text.indexOf('\n## '))
    assert.ok(intro.includes(`<video controls preload="none" poster="/videos/install-${os}.jpg" width="1920" height="1080"`), `${os}: the video with its poster, at the top of the page`)
    assert.ok(intro.includes(`<source src="/videos/install-${os}.mp4" type="video/mp4" />`), `${os}: its own video`)
    assert.ok(intro.includes(`<a href="/videos/install-${os}.mp4">The install video</a>`), `${os}: the link for a browser without video`)
    const video = readFileSync(join(REPO, `site/public/videos/install-${os}.mp4`))
    const poster = readFileSync(join(REPO, `site/public/videos/install-${os}.jpg`))
    assert.ok(video.length > 1_000_000 && video.toString('latin1', 4, 8) === 'ftyp', `${os}: an MP4 of more than 1 MB`)
    assert.ok(poster.length > 50_000 && poster[0] === 0xff && poster[1] === 0xd8 && poster[2] === 0xff, `${os}: a JPEG poster of more than 50 KB`)
    const { seconds, indexFirst } = mp4(video)
    assert.ok(indexFirst, `${os}: the index is at the front (+faststart), so the video starts before it is all downloaded`)
    // The page says the length twice, in whole seconds: under the player and in the line below it.
    const said = [...intro.matchAll(/(\d+) seconds/g)].map(m => Number(m[1]))
    assert.deepEqual(said, [Math.round(seconds), Math.round(seconds)], `${os}: the page says ${said.join(' and ')} seconds, the video is ${seconds.toFixed(1)}`)
  }

  // The script draws exactly these: one video and one poster per system, by these names.
  const { SYSTEMS: drawn } = await script('values.mjs')
  assert.deepEqual(drawn, [...SYSTEMS])
  const render = readFileSync(join(VIDEOS, 'src/render.mjs'), 'utf8')
  assert.ok(render.includes('`install-${os}.mp4`') && render.includes('`install-${os}.jpg`'), 'render.mjs writes install-<system>.mp4 and .jpg')
})

test('R71A-1 every installer line the videos quote still stands in the repository, found by its text in its file (not by its line number)', async () => {
  const { quotedLines } = await script('quotes.mjs')
  const { quoted }: { quoted: Quote[] } = quotedLines()
  // Every system quotes its installers, and the line it pastes from its own install page.
  for (const os of SYSTEMS) {
    const files = new Set(quoted.filter(q => q.videos.includes(os)).map(q => q.f))
    for (const f of ['install.sh', 'get.sh', 'src/cli.ts', page(os), ...(os === 'windows' ? ['get.ps1'] : [])]) assert.ok(files.has(f), `the ${os} video quotes ${f}`)
    assert.ok(quoted.filter(q => q.videos.includes(os)).length >= (os === 'windows' ? 120 : 70), `${os}: its quotes are all listed`)
  }
  const stale = staleQuotes(quoted, repoFile)
  assert.deepEqual(stale, [], `${stale.length} line(s) the videos show are no longer what the repository says. ${RERENDER}:\n${stale.join('\n')}`)
})

test('R71A-1 the quote check bites: a changed quoted line fails it and says to re-render, a line that only moved does not', async () => {
  const { quotedLines } = await script('quotes.mjs')
  const { quoted }: { quoted: Quote[] } = quotedLines()
  // The installer's Telegram question as this very pull request had it before: the videos would show the old one.
  const before = (f: string) => (f === 'src/cli.ts' ? read(f).replace("'Telegram token from BotFather'", "'Telegram bot token from @BotFather'") : repoFile(f))
  const stale = staleQuotes(quoted, before)
  assert.equal(stale.length, 1, stale.join('\n'))
  assert.match(stale[0]!, /^src\/cli\.ts \(was line \d+, in the windows, mac, linux video\): Telegram token from BotFather:$/)
  // Ten lines added at the top of every file: every quote has moved, none has changed.
  const shifted = (f: string) => { const t = repoFile(f); return t === null ? null : '\n'.repeat(10) + t }
  assert.deepEqual(staleQuotes(quoted, shifted), [])
  // A file that is gone fails every quote of it.
  assert.ok(staleQuotes(quoted, f => (f === 'get.ps1' ? null : repoFile(f))).length >= 50)
  // The check the script runs by hand finds the same lines the same way, and says to re-render.
  const { findLine } = await script('quotes.mjs')
  const cli = read('src/cli.ts').split('\n')
  const at = findLine(cli, ['Telegram token from BotFather'])
  assert.ok(at > 0 && cli[at - 1]!.includes("'Telegram token from BotFather'"), 'findLine gives the line number, from 1')
  assert.equal(findLine(['', ...cli], ['Telegram token from BotFather']), at + 1)
  assert.equal(findLine(cli, ['Telegram bot token from @BotFather']), 0)
  assert.equal(findLine(["  Write-FoxLine 'Ubuntu''s settings'"], ["Ubuntu's settings"]), 1, "PowerShell's doubled '")
  const check = readFileSync(join(VIDEOS, 'src/check-quotes.mjs'), 'utf8')
  assert.match(check, /findLine\(/)
  assert.match(check, /re-render/i)
})

test('R71A-1 the videos are drawn on example values only: the user ana, the words wordN, a made-up address tagged example, no key, wallet or env file of the machine', async () => {
  const { VALUES } = await script('values.mjs')
  assert.equal(VALUES.user, 'ana')
  assert.deepEqual(VALUES.words, Array.from({ length: 24 }, (_, i) => `word${i + 1}`))
  assert.deepEqual(Object.values(VALUES.homes), ['/home/ana', '/Users/ana', '/home/ana'])
  assert.equal(VALUES.windowsHome, 'C:\\Users\\ana')
  assert.match(VALUES.dashPassword, /^example-/)
  // Both addresses are made up with a wrong checksum: nobody can send funds to them.
  for (const a of [VALUES.address, VALUES.nextAddress]) assert.throws(() => Address.newFromBech32(a), `${a} is not a real address`)

  // On every terminal screen: the only address is the example one, always with its "example" tag (class addr), the
  // recovery words are word1 ... word24, and no key is ever shown.
  const { timelines } = await script('quotes.mjs')
  for (const [os, tl] of Object.entries(timelines() as Record<string, { tracks: { term: { segs?: { s: string; c: string | null }[] }[] } }>)) {
    const segs = tl.tracks.term.flatMap(e => e.segs ?? [])
    const addrs = segs.filter(g => /erd1[0-9a-z]{20,}/.test(g.s))
    assert.ok(addrs.length >= 2, `${os}: the address is on screen`)
    for (const g of addrs) assert.ok(g.s === VALUES.address && String(g.c).split(' ').includes('addr'), `${os}: ${g.s} shows tagged as an example`)
    const words = segs.map(g => /^ ?\d{1,2}\. (\S+)$/.exec(g.s)?.[1]).filter(Boolean)
    assert.deepEqual(words, VALUES.words, `${os}: the recovery words`)
    // The installer's own question names the key's start ("sk-ant-..."); a key itself never shows.
    assert.doesNotMatch(JSON.stringify(tl), /sk-ant-api\d|\d{6,}:AA[\w-]{20,}|BEGIN PRIVATE KEY|MNEMONIC=/, `${os}: no key on screen`)
  }
  assert.match(readFileSync(join(VIDEOS, 'src/stage/stage.css'), 'utf8'), /#term \.addr::after\{content:'example'/)

  // The dashboard on screen: the repository's own pages on a throwaway wallet, as the screenshots script does.
  const capture = readFileSync(join(VIDEOS, 'src/capture.mjs'), 'utf8')
  assert.match(capture, /const dir = mkdtempSync\(join\(tmpdir\(\), 'foxagent-video-'\)\)/)
  assert.match(capture, /mnemonic: Mnemonic\.generate\(\)\.toString\(\), dataDir: dir, gatewayUrl: 'http:\/\/127\.0\.0\.1:9', apiUrl: 'http:\/\/127\.0\.0\.1:9', foxleagueUrl: 'http:\/\/127\.0\.0\.1:9'/)
  assert.match(capture, /for \(const k of \['ANTHROPIC_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'BINANCE_API_KEY', 'BINANCE_API_SECRET'\]\) delete process\.env\[k\]/)
  assert.match(capture, /telegramToken: undefined, telegramChatId: undefined/)
  assert.match(capture, /process\.env\.ANTHROPIC_API_KEY = 'sk-ant-api03-EXAMPLE/)
  // Every address the throwaway wallet derives is replaced in every answer of the agent, and tagged on the page.
  assert.match(capture, /body\.replaceAll\(d\.real\[0\], VALUES\.address\)\.replaceAll\(d\.real\[1\], VALUES\.nextAddress\)/)
  assert.ok((capture.match(/await tagExample\(\)/g) ?? []).length >= 4, 'the example tag on every dashboard shot')
  // It never starts the service (no scheduler, no Telegram reader, no update check) and never loads an env file.
  assert.doesNotMatch(capture, /svc\.start\(\)|loadConfig\(|loadEnvFile\(|dotenv/)
})

test('R71A-1 the script is in the repository with its README, its own pinned packages for development only and nothing it builds', () => {
  for (const f of ['README.md', 'package.json', 'package-lock.json', '.gitignore', 'src/capture.mjs', 'src/render.mjs', 'src/scenes.mjs', 'src/text.mjs', 'src/timeline.mjs', 'src/values.mjs', 'src/quotes.mjs', 'src/check-quotes.mjs', 'src/stage/stage.html', 'src/stage/stage.css', 'src/stage/stage.js']) {
    assert.ok(existsSync(join(VIDEOS, f)) && statSync(join(VIDEOS, f)).size > 0, `site/scripts/videos/${f}`)
  }
  // Its packages are its own and for development only: the agent and the site do not get them.
  const pkg = JSON.parse(readFileSync(join(VIDEOS, 'package.json'), 'utf8'))
  assert.equal(pkg.private, true)
  assert.equal(pkg.dependencies, undefined)
  assert.deepEqual(Object.keys(pkg.devDependencies).sort(), ['@fontsource/inconsolata', '@fontsource/inter', 'playwright-core'])
  for (const v of Object.values(pkg.devDependencies) as string[]) assert.match(v, /^\d+\.\d+\.\d+$/, 'pinned')
  const lock = JSON.parse(readFileSync(join(VIDEOS, 'package-lock.json'), 'utf8'))
  assert.deepEqual(lock.packages[''].devDependencies, pkg.devDependencies)
  for (const [name, p] of Object.entries(lock.packages as Record<string, { dev?: boolean }>)) if (name) assert.equal(p.dev, true, `${name} is for development only`)
  for (const f of ['package.json', 'site/package.json']) assert.doesNotMatch(read(f), /playwright|fontsource/, f)
  // What it builds stays out of git: the screenshots, the masters, the drafts and its packages.
  const ignored = readFileSync(join(VIDEOS, '.gitignore'), 'utf8').split('\n')
  for (const d of ['build/', 'out/', 'node_modules/']) assert.ok(ignored.includes(d), `.gitignore: ${d}`)
  // It finds the repository from where it sits: no path of the machine it was written on.
  const src = readdirSync(join(VIDEOS, 'src'), { recursive: true, encoding: 'utf8' }).filter(f => /\.(mjs|js|css|html)$/.test(f))
  assert.ok(src.length >= 11)
  for (const f of [...src.map(f => `src/${f}`), 'README.md', 'package.json']) {
    assert.doesNotMatch(readFileSync(join(VIDEOS, f), 'utf8'), /\/home\/(?!ana\b)|\/tmp\/|(?<!\/mnt\/c)\/Users\/(?!ana\b)|FOXAGENT_REPO|scratchpad/, f)
  }
  // The README says how to draw them again and when; the site's README names it next to the screenshots.
  const readme = readFileSync(join(VIDEOS, 'README.md'), 'utf8')
  assert.match(readme, /## When to draw them again/)
  assert.match(readme, /node site\/scripts\/videos\/src\/check-quotes\.mjs/)
  assert.match(readme, /test\/install-videos\.test\.ts/)
  assert.match(read('site/README.md'), /site\/scripts\/videos\//)
  assert.doesNotMatch(readme + read('site/README.md'), /—|\bbots?\b/i)
})

test('R71A-1 the record has its row, in a section of its own before the last one', () => {
  const review = read('docs/SECURITY-REVIEW.md')
  const start = review.indexOf('\n## GitHub review of PR #71 (2026-11-15)\n')
  assert.ok(start > review.indexOf('\n## GitHub review of PR #69 (2026-11-15)\n'), 'after the review of PR #69')
  // Another section may come between it and the last one (test/chat-send.test.ts pins the last).
  const next = review.indexOf('\n## ', start + 1)
  assert.ok(next > start && next <= review.indexOf('\n## One manager message at a time (2026-11-13)\n'), 'before the last section')
  const section = review.slice(start, next)
  assert.match(section, /\| Id \| Severity \| Finding \| Fix \|\n\|---\|---\|---\|---\|\n\| R71A-1 \| low \(agent review of PR #71; [^|]+\) \| [^\n]+ \| [^\n]+ \|\n/)
  const row = section.split('\n').find(l => l.startsWith('| R71A-1 |'))!
  assert.equal(row.split(' | ').length, 4)
  assert.ok(section.includes('\nStays open:\n'))
  assert.doesNotMatch(section, /—|, and |\bbots?\b/i)
})

// Review of PR #83 (R83A-1, low): the quote check finds a line by its text, so an empty quote matched any line and a
// text that stands twice matched the occurrence nearest an old number. The hints are for people: they must name the
// line the video shows.
test('R83A-1 every line hint names the line the video shows: an empty line is an info "" of install.sh, a text that stands twice is the branch the video plays', async () => {
  const { quotedLines } = await script('quotes.mjs')
  const { quoted }: { quoted: Quote[] } = quotedLines()
  const lineOf = (q: Quote) => read(q.f).split('\n')[q.l - 1] ?? ''
  // Each hint stands on a line that holds its text (none merely "moved").
  for (const q of quoted) assert.ok(q.frags.every(fr => lineOf(q).includes(fr) || lineOf(q).includes(fr.replaceAll("'", "''"))), `${q.f}:${q.l} holds ${JSON.stringify(q.frags)}`)
  const empty = quoted.filter(q => q.frags.every(fr => fr.trim() === ''))
  assert.ok(empty.length >= 3, 'the empty lines around the recovery words are quoted')
  for (const q of empty) assert.match(lineOf(q), /^\s*info ""\s*$/, `${q.f}:${q.l} is an empty line the installer prints`)
  // A step title of install.sh (say) and every line of get.ps1 is printed from one string: the hint names the line that
  // prints the whole text, not a longer title that starts with it or a function named after it (second review of PR #83).
  const whole = (line: string, fr: string) => [fr, fr.replaceAll("'", "''")].some(t => line.includes(`"${t}"`) || line.includes(`'${t}'`))
  for (const q of quoted.filter(q => q.f === 'get.ps1' || /^\s*say /.test(lineOf(q)))) {
    for (const fr of q.frags.filter(fr => fr.trim())) assert.ok(whole(lineOf(q), fr), `${q.f}:${q.l} prints ${JSON.stringify(fr)} whole`)
  }
  // get.ps1 asks "Ready?" and says Ubuntu is installed in two branches; the video plays the Ubuntu install.
  const at = (text: string) => quoted.filter(q => q.f === 'get.ps1' && q.frags.includes(text)).map(lineOf)
  assert.deepEqual(at('Ready?').map(l => l.includes('Ubuntu was not installed')), [true], 'Ready? is the one before the Ubuntu install')
  assert.deepEqual(at('Ubuntu is installed and has a user of its own.').map(l => l.includes('return $fresh')), [true], 'the line after the Ubuntu install')
})
