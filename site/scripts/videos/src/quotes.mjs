// Every installer line the videos quote, read from the timelines without a browser or screenshots (stand-in sizes).
// Used by src/check-quotes.mjs and by the repository's test/install-videos.test.ts.
//
// A quote holds while one line of its file still has every quoted piece. The line number in src/text.mjs is where
// the line stood when the videos were drawn: a hint for people, never part of the check, so a line that only moved
// (something added above it) does not count as a change.

import { SYSTEMS } from './values.mjs'
import { build } from './scenes.mjs'

// Stand-ins for what the capture measures: any box of a page, any screenshot name, any font width.
const anyBox = new Proxy({ passwordLength: 21, siteTitle: 'Install' }, { get: (o, k) => (k in o ? o[k] : { x: 0, y: 0, w: 10, h: 10 }) })
const anyName = { includes: () => true }

/** The timeline of each video, built with the stand-ins: what the terminal shows, when. */
export function timelines() {
  return Object.fromEntries(SYSTEMS.map(os => [os, build(os, { cw: 11, boxes: anyBox, shotNames: anyName, shotBase: '', fav: {} }).toJSON()]))
}

/**
 * quoted: one entry per quoted source line ({ f, l, frags, texts, videos }), sorted by file and line.
 * outside: the lines that are not from the repository (the systems' own words), with why they are there.
 */
export function quotedLines() {
  const quoted = new Map() // "file:line" -> entry
  const outside = new Map() // text -> { why, videos }
  for (const os of SYSTEMS) {
    const tl = build(os, { cw: 11, boxes: anyBox, shotNames: anyName, shotBase: '', fav: {} })
    for (const q of tl.quotes) {
      if (q.ext) {
        const e = outside.get(q.text) ?? { text: q.text, why: q.ext, videos: [] }
        if (!e.videos.includes(os)) e.videos.push(os)
        outside.set(q.text, e)
        continue
      }
      const key = `${q.f}:${q.l}`
      const e = quoted.get(key) ?? { f: q.f, l: q.l, frags: q.frags, texts: [], videos: [] }
      if (!e.texts.includes(q.text.trim())) e.texts.push(q.text.trim())
      if (!e.videos.includes(os)) e.videos.push(os)
      quoted.set(key, e)
    }
  }
  return {
    quoted: [...quoted.values()].sort((a, b) => a.f.localeCompare(b.f) || a.l - b.l),
    outside: [...outside.values()],
  }
}

/**
 * The number (from 1) of the line that holds every quoted piece, the one nearest the line it was drawn from when
 * several do, or 0 when none does. PowerShell doubles a ' inside a '...' string, so either form counts.
 */
export function findLine(lines, frags, near = 1) {
  let best = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!frags.every(fr => line.includes(fr) || line.includes(fr.replaceAll("'", "''")))) continue
    if (!best || Math.abs(i + 1 - near) < Math.abs(best - near)) best = i + 1
  }
  return best
}
