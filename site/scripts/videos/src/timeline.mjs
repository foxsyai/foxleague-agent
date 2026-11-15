// The timeline of one video: a clock (this.t) that the scene scripts move forward, and the tracks that the stage
// (src/stage/stage.js) reads to draw any frame. Every quoted installer line keeps its source (file and line) so that
// src/check-quotes.mjs and test/install-videos.test.ts can hold it against the repository after a change.

/** A piece of terminal text. c: its colour class (y yellow step title, r red, u link, pg/pb prompt, cmd/op/str
 *  PowerShell input, addr the made-up address with its "example" tag). q: where the text comes from. */
export const seg = (s, c = null, q = null) => ({ s, c, ...(q ? { q } : {}) })

/** A value put into a quoted line (a path, a version, the user): shown, not checked against the source line. */
export const V = (s, c = null) => ({ value: s, c })

/**
 * A quoted line: `parts` are literal pieces of line `l` of file `f` (each must be found in that line) and V(...)
 * values between them. `frag` may also be one string. Shell and JS variables named in `vars` are filled in.
 */
export function Q(f, l, parts, c = null, vars = {}) {
  const list = Array.isArray(parts) ? parts : [parts]
  const literal = list.filter(p => typeof p === 'string')
  const fill = s => s.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (m, n) => (n in vars ? vars[n] : m))
  // Each piece keeps its own colour: V('...', 'u') inside a line makes a link.
  return list.map(p => (typeof p === 'string' ? seg(fill(p), c) : seg(p.value, p.c ?? c))).map((g, i) => (i === 0 ? { ...g, q: { f, l, frags: literal } } : g))
}

/** Text that is not in the repository: the system's own (PowerShell's banner, WSL, Ubuntu, a shell prompt). */
export const X = (s, c = null, why = 'the system') => seg(s, c, { ext: why })

export class Timeline {
  constructor({ os, font, term, browser, clock, shots, captionBottom }) {
    this.os = os
    this.font = font
    this.termGeo = term
    this.browserGeo = browser
    this.clock = clock
    this.shots = shots
    this.captionBottom = captionBottom
    this.t = 0
    this.mouse = { x: 1500, y: 760 }
    this.tracks = {
      term: [], termTitle: [], vis: { term: [], browser: [] }, front: [], tabs: [], page: [],
      cursor: [{ t: 0, dur: 0, x: this.mouse.x, y: this.mouse.y }], clicks: [], caption: [], note: [], keys: [], cam: [], pointer: [],
    }
    this.quotes = []
  }

  wait(s) { this.t += s; return this }
  at(t) { this.t = t; return this }

  // ---------------- terminal ----------------
  _segs(items) {
    const out = [], qs = []
    for (const it of items.flat(Infinity)) {
      const g = typeof it === 'string' ? seg(it) : it.value !== undefined ? seg(it.value, it.c) : it
      if (g.q) qs.push(g.q)
      out.push({ s: g.s, c: g.c })
    }
    // Each source is listed with the whole line it is part of, as the screen shows it.
    const text = out.map(g => g.s).join('').replace(/\n/g, '')
    for (const q of qs) this.quotes.push({ ...q, text, at: +this.t.toFixed(2) })
    return out
  }
  /** Prints at once (no line end unless given). */
  out(...items) { this.tracks.term.push({ t: this.t, op: 'out', segs: this._segs(items) }); return this }
  /** One line per entry, `gap` seconds apart (0: the whole block at once, as a heredoc or a run of Write-Host
   *  prints it). An entry is a string or a list of segs. */
  lines(list, gap = 0) {
    for (const l of list) { this.out(l, '\n'); this.t += gap }
    return this
  }
  /** Typed by the user, `cps` characters a second. */
  type(text, cps = 13, c = null) {
    const segs = this._segs([typeof text === 'string' ? seg(text, c) : text])
    const n = segs.reduce((a, g) => a + g.s.length, 0)
    const dur = n / cps
    this.tracks.term.push({ t: this.t, op: 'type', segs, dur })
    this.t += dur
    return this
  }
  /** Keys pressed with nothing on the screen (a password): only the clock moves. */
  typeHidden(chars, cps = 11) { this.t += chars / cps; return this }
  enter(gap = 0.18) { this.keys(['Enter'], 0.5); this.out('\n'); this.t += gap; return this }
  clear() { this.tracks.term.push({ t: this.t, op: 'clear' }); return this }
  title(text) { this.tracks.termTitle.push({ t: this.t, text }); return this }

  // ---------------- words on the video ----------------
  keys(keys, dur = 0.7) { this.tracks.keys.push({ t0: this.t, t1: this.t + dur, keys }); return this }
  caption(text, dur) { this.tracks.caption.push({ t0: this.t, t1: this.t + dur, text }); return this }
  /** A pause in time ("A few minutes later"): shown for dur, and the clock moves on by dur. */
  note(text, dur = 1.3) { this.tracks.note.push({ t0: this.t, t1: this.t + dur, text }); this.t += dur; return this }

  // ---------------- pointer ----------------
  move(x, y, dur = 0.6) {
    this.tracks.cursor.push({ t: this.t, dur, x, y })
    this.mouse = { x, y }
    this.t += dur
    return this
  }
  click(after = 0.15) { this.tracks.clicks.push({ t: this.t, x: this.mouse.x, y: this.mouse.y }); this.t += after; return this }
  pointer(on) { this.tracks.pointer.push({ t: this.t, on }); return this }

  // ---------------- windows ----------------
  show(win, open = true) { this.tracks.vis[win].push({ t: this.t, on: true, open }); return this }
  hide(win) { this.tracks.vis[win].push({ t: this.t, on: false }); return this }
  front(win) { this.tracks.front.push({ t: this.t, win }); return this }
  tabs(tabs, active, url) { this.tracks.tabs.push({ t: this.t, tabs, active, url }); return this }
  page(name, fade = 0) {
    if (!this.shots.names.includes(name)) throw new Error(`no screenshot ${name} for ${this.os}`)
    this.tracks.page.push({ t: this.t, name, fade })
    return this
  }
  /** The camera: zoom z, centred on the desktop point x, y, reached in dur seconds (the clock does not move). */
  cam(z, x, y, dur = 0.8) { this.tracks.cam.push({ t: this.t, dur, z, x, y }); return this }

  // ---------------- geometry ----------------
  /** A box of a screenshot (page pixels) on the desktop. */
  pageBox(b) {
    const g = this.browserGeo
    return { x: g.x + b.x, y: g.y + 84 + b.y, w: b.w, h: b.h, cx: g.x + b.x + b.w / 2, cy: g.y + 84 + b.y + b.h / 2 }
  }
  termPoint(fx, fy) {
    const g = this.termGeo
    return { x: Math.round(g.x + g.w * fx), y: Math.round(g.y + g.h * fy) }
  }

  toJSON() {
    return {
      os: this.os, duration: +this.t.toFixed(3), font: this.font, term: this.termGeo, browser: this.browserGeo, clock: this.clock,
      shots: this.shots, captionBottom: this.captionBottom, tracks: this.tracks,
    }
  }
}
