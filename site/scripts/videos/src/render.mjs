// Step 2 of 2: the videos. Reads the screenshots of capture.mjs, builds each timeline (scenes.mjs), draws every
// frame in the stage (src/stage/) and hands the frames to ffmpeg.
//
//   node src/render.mjs                 all three, 30 frames a second
//   node src/render.mjs linux           one
//   node src/render.mjs mac --fps 10    a quick look (smaller, choppier)
//   node src/render.mjs mac --still 23.5,poster   single frames into build/stills/ (also --still all)
//   node src/render.mjs mac --encode-only --crf 26   the web file again from build/master-mac.mkv
//
// Output: out/install-<system>.mp4 (H.264, yuv420p, +faststart) and out/install-<system>.jpg (the poster frame).
// Also build/timeline-<system>.json (what was drawn) and build/quotes-<system>.json (what each video quotes).

import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { once } from 'node:events'
import { chromium } from 'playwright-core'
import { FONTS, SYSTEMS } from './values.mjs'
import { build } from './scenes.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome'
const args = process.argv.slice(2)
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt }
const FPS = Number(opt('--fps', 30))
const STILL = opt('--still', null)
// The quality: CRF 23 to start (sharp text); without --crf it goes up one step at a time until the file is under MAX_MB.
const CRF_GIVEN = opt('--crf', null)
const MAX_MB = Number(opt('--max-mb', 5.9))
// Seconds between forced keyframes (a cut of the scene makes one anyway). A screen full of text costs ~150 KB per keyframe.
const GOP_S = Number(opt('--gop', 20))
const ENCODE_ONLY = args.includes('--encode-only') // only the web file again, from build/master-<system>.mkv
const only = args.filter(a => SYSTEMS.includes(a))
const systems = only.length ? only : SYSTEMS
mkdirSync(join(ROOT, 'out'), { recursive: true })
mkdirSync(join(ROOT, 'build'), { recursive: true })

// The stage and its pictures over http (fonts from file:// pages are refused by the browser).
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' }
const server = createServer((req, res) => {
  const file = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)))
  if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const BASE = `http://127.0.0.1:${server.address().port}`

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--hide-scrollbars', '--font-render-hinting=none'] })

for (const os of systems) {
  const shotDir = join(ROOT, 'build', 'shots', os)
  if (!existsSync(join(shotDir, 'boxes.json'))) throw new Error(`no screenshots for ${os}: run node src/capture.mjs ${os} first`)
  const boxes = JSON.parse(readFileSync(join(shotDir, 'boxes.json'), 'utf8'))
  const shotNames = readdirSync(shotDir).filter(f => f.endsWith('.jpg')).map(f => f.slice(0, -4))
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
  page.on('pageerror', e => { console.error(`${os}: stage error: ${e.message}`); process.exitCode = 1 })
  await page.goto(`${BASE}/src/stage/stage.html`)
  const cw = await page.evaluate(([m, s]) => window.measure(m, s), [FONTS[os].mono, FONTS[os].monoSize])
  const tl = build(os, { cw, boxes, shotNames, shotBase: `/build/shots/${os}/`, fav: { site: '/build/shots/fav-site.png', dash: '/build/shots/fav-dash.png' } })
  const json = tl.toJSON()
  writeFileSync(join(ROOT, 'build', `timeline-${os}.json`), JSON.stringify(json))
  writeFileSync(join(ROOT, 'build', `quotes-${os}.json`), JSON.stringify(tl.quotes, null, 1))
  await page.evaluate(t => window.setup(t), json)
  console.log(`${os}: ${json.duration.toFixed(1)} s, terminal ${json.font.cols}x${json.font.rows} at ${json.font.monoSize}px ${json.font.mono}`)

  if (STILL !== null) {
    // --still 3,10.5,20 or --still all (one every 2 seconds); "poster" and "words" name those moments
    const times = STILL === 'all' ? Array.from({ length: Math.ceil(json.duration / 2) }, (_, i) => i * 2 + 0.5)
      : STILL.split(',').map(s => (s === 'poster' ? tl.posterAt : s === 'words' ? tl.wordsAt + 1 : Number(s)))
    for (const t of times) {
      await page.evaluate(x => window.frame(x), t)
      const file = join(ROOT, 'build', 'stills', `${os}-${t.toFixed(1).padStart(5, '0')}.jpg`)
      mkdirSync(join(ROOT, 'build', 'stills'), { recursive: true })
      await page.screenshot({ path: file, type: 'jpeg', quality: 90 })
    }
    console.log(`${times.length} stills in build/stills/`)
    await page.close()
    continue
  }

  // ---- every frame, into a lossless master (build/master-<system>.mkv) ----
  const master = join(ROOT, 'build', `master-${os}.mkv`)
  if (!ENCODE_ONLY) {
    const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
      '-c:v', 'libx264rgb', '-preset', 'ultrafast', '-qp', '0', master], { stdio: ['pipe', 'inherit', 'inherit'] })
    const done = once(ff, 'close')
    const frames = Math.round(json.duration * FPS)
    let lastSig = null, lastBuf = null, drawn = 0
    const started = Date.now()
    for (let i = 0; i < frames; i++) {
      const t = i / FPS
      const sig = await page.evaluate(x => window.frame(x), t)
      if (sig !== lastSig) { lastBuf = await page.screenshot({ type: 'png' }); lastSig = sig; drawn++ }
      if (!ff.stdin.write(lastBuf)) await once(ff.stdin, 'drain')
      if (i % (FPS * 10) === 0) process.stdout.write(`  ${os} ${t.toFixed(0)} s\r`)
    }
    ff.stdin.end()
    const [code] = await done
    if (code !== 0) throw new Error(`ffmpeg ended with ${code}`)
    console.log(`  ${os}: ${frames} frames (${drawn} drawn) in ${((Date.now() - started) / 1000).toFixed(0)} s`)
  }

  // ---- the web file: H.264, yuv420p, a keyframe at least every GOP_S seconds, the index at the front ----
  const out = join(ROOT, 'out', `install-${os}.mp4`)
  for (let crf = Number(CRF_GIVEN ?? 23); ; crf++) {
    const enc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', master,
      '-c:v', 'libx264', '-preset', 'veryslow', '-tune', 'animation', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.1',
      '-g', String(FPS * GOP_S), '-bf', '3', '-movflags', '+faststart', '-an', out], { stdio: ['ignore', 'inherit', 'inherit'] })
    const [ecode] = await once(enc, 'close')
    if (ecode !== 0) throw new Error(`ffmpeg ended with ${ecode}`)
    const mb = statSync(out).size / 1e6
    console.log(`  ${os}: ${out} (${mb.toFixed(2)} MB, crf ${crf})`)
    if (CRF_GIVEN !== null || mb <= MAX_MB || crf >= 32) break
  }

  // ---- the poster: the Done screen with the dashboard address ----
  await page.evaluate(x => window.frame(x), tl.posterAt)
  await page.screenshot({ path: join(ROOT, 'out', `install-${os}.jpg`), type: 'jpeg', quality: 88 })
  await page.close()
}

await browser.close()
server.close()
