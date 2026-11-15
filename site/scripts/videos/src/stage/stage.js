// Draws one frame of a video at time t from its timeline (made by src/timeline.mjs). Pure: the same t always
// gives the same picture, so frames can be rendered one by one and in any order.
//   await setup(timeline)   builds the desktop, loads fonts and pictures
//   frame(t)                draws the frame and returns a signature (equal signatures mean equal pictures)
'use strict'

let TL = null
const $ = s => document.querySelector(s)
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v))
const ease = p => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const ICON = {
  min: '<svg viewBox="0 0 12 12"><path d="M1 6h10"/></svg>',
  max: '<svg viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9"/></svg>',
  close: '<svg viewBox="0 0 12 12"><path d="M1.5 1.5l9 9M10.5 1.5l-9 9"/></svg>',
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>',
  wifi: '<svg viewBox="0 0 24 24"><path d="M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="19.5" r=".8"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4zM17 9a4 4 0 0 1 0 6"/></svg>',
  power: '<svg viewBox="0 0 24 24"><path d="M12 3v8M6.3 6.3a8 8 0 1 0 11.4 0"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
}
const btns = os => os === 'windows' ? `<div class="wbtns win10"><span>${ICON.min}</span><span>${ICON.max}</span><span>${ICON.close}</span></div>`
  : os === 'mac' ? '<div class="wbtns mac"><span></span><span></span><span></span></div>'
  : `<div class="wbtns gnome"><span>${ICON.min}</span><span>${ICON.max}</span><span>${ICON.close}</span></div>`
const glyph = (k, on) => `<div class="tbicon${on ? ' on' : ''}" data-k="${k}"><div class="glyph g-${k}">${k === 'term' ? '&gt;_' : k === 'web' ? ICON.globe : k === 'search' ? ICON.search : ''}</div></div>`
// The pointer of each system, drawn plainly: white with a dark edge on Windows, dark with a white edge elsewhere.
const POINTER = os => {
  const fill = os === 'windows' ? '#fff' : '#111', edge = os === 'windows' ? '#111' : '#fff'
  return `<svg viewBox="0 0 28 28"><path d="M5 2.5v19.5l5.2-4.9 3.4 7.8 3.4-1.5-3.4-7.6h7.2z" fill="${fill}" stroke="${edge}" stroke-width="1.6" stroke-linejoin="round"/></svg>`
}

function bars(os, clock) {
  if (os === 'windows') return `<div class="taskbar">${glyph('search')}${glyph('folder')}${glyph('web')}${glyph('term')}${glyph('text')}<div class="clock">${clock.time}<br>${clock.date}</div></div>`
  if (os === 'mac') return `<div class="menubar"><b class="app"></b><span>File</span><span>Edit</span><span>View</span><span>Window</span><span>Help</span><span class="clock">${clock.day}&nbsp;&nbsp;${clock.time}</span></div><div class="dock">${glyph('folder')}${glyph('web')}${glyph('term')}${glyph('text')}${glyph('gear')}</div>`
  return `<div class="topbar"><div class="ws"><i></i><i></i></div>${clock.day}&nbsp;&nbsp;${clock.time}<div class="sys">${ICON.wifi}${ICON.sound}${ICON.power}</div></div><div class="dock">${glyph('web')}${glyph('folder')}${glyph('term')}${glyph('text')}<div class="apps">${'<i></i>'.repeat(9)}</div></div>`
}

// ------------------------------------------------------------------------------------------------------------
async function setup(tl) {
  TL = tl
  const os = tl.os
  const scr = $('#screen')
  scr.className = 'os-' + os
  scr.style.setProperty('--ui', `'${tl.font.ui}', sans-serif`)
  scr.style.setProperty('--mono', `'${tl.font.mono}', monospace`)
  await document.fonts.load(`${tl.font.monoSize}px '${tl.font.mono}'`)
  await document.fonts.load(`700 ${tl.font.monoSize}px '${tl.font.mono}'`)
  await document.fonts.load(`16px '${tl.font.ui}'`)
  await document.fonts.load(`600 30px 'Inter'`)
  await document.fonts.load(`700 30px 'Inter'`)
  $('#bars').innerHTML = bars(os, tl.clock)
  $('#caption').style.bottom = tl.captionBottom + 'px'

  // ---- terminal geometry from the font's own advance ----
  const c = document.createElement('canvas').getContext('2d')
  c.font = `${tl.font.monoSize}px '${tl.font.mono}'`
  const cw = c.measureText('M'.repeat(200)).width / 200
  const lh = Math.round(tl.font.monoSize * tl.font.lineHeight)
  const pad = tl.term.pad, sbar = os === 'windows' ? 17 : 0
  const chromeH = os === 'windows' ? 32 : os === 'mac' ? 30 : 46
  const term = $('#term')
  term.style.setProperty('--cw', cw + 'px'); term.style.setProperty('--lh', lh + 'px')
  const w = Math.ceil(tl.font.cols * cw + 2 * pad + sbar), h = chromeH + tl.font.rows * lh + 2 * pad
  Object.assign(term.style, { left: tl.term.x + 'px', top: tl.term.y + 'px', width: w + 'px', height: h + 'px' })
  const rows = $('#term .rows')
  Object.assign(rows.style, { left: pad + 'px', top: pad + 'px', fontSize: tl.font.monoSize + 'px' })
  $('#term .tbody').style.height = (h - chromeH - 2) + 'px'
  $('#term .ctl-left').innerHTML = os === 'mac' ? btns('mac') : os === 'linux' ? `<div class="hbtn">${ICON.plus}</div>` : ''
  $('#term .ctl-right').innerHTML = os === 'windows' ? btns('windows') : os === 'linux' ? `<div style="display:flex;align-items:center"><div class="hbtn">${ICON.search}</div><div class="hbtn">${ICON.menu}</div>${btns('linux')}</div>` : ''
  TL._term = { cw, lh, w, h }

  // ---- browser ----
  const b = $('#browser')
  Object.assign(b.style, { left: tl.browser.x + 'px', top: tl.browser.y + 'px', width: tl.browser.w + 'px', height: (tl.browser.h + 84) + 'px' })
  $('#browser .page').style.height = tl.browser.h + 'px'
  $('#browser .ctl-left').innerHTML = os === 'mac' ? btns('mac') + '<span style="width:14px"></span>' : ''
  $('#browser .ctl-right').innerHTML = os === 'mac' ? '' : btns(os)
  const page = $('#browser .page')
  const loads = []
  for (const name of tl.shots.names) {
    const img = new Image()
    img.src = tl.shots.base + name + '.jpg'
    img.dataset.name = name
    page.append(img)
    loads.push(img.decode())
  }
  for (const f of Object.values(tl.shots.fav)) { const i = new Image(); i.src = f; loads.push(i.decode()) }
  await Promise.all(loads)
  $('#cursor').innerHTML = POINTER(os)
  return { term: { x: tl.term.x, y: tl.term.y, w, h, cw, lh, chromeH, pad } }
}

// ------------------------------------------------------------------------------------------------------------
// tracks: a keyframe {t, dur, ...values} moves from where the last one ended to its values in dur seconds.
function keyed(list, t, keys, start) {
  let cur = { ...start }
  for (const k of list) {
    if (t < k.t) break
    const p = k.dur > 0 ? clamp((t - k.t) / k.dur) : 1
    if (p < 1) {
      const e = ease(p), out = {}
      for (const n of keys) out[n] = cur[n] + (k[n] - cur[n]) * e
      out.p = p; out.from = cur; out.to = k
      return out
    }
    for (const n of keys) cur[n] = k[n]
  }
  return cur
}
const last = (list, t) => { let r = null; for (const e of list) { if (e.t <= t) r = e; else break } return r }
const within = (list, t) => list.find(e => t >= e.t0 && t < e.t1) || null
const fadeIO = (e, t, f = 0.25) => e ? Math.min(clamp((t - e.t0) / f), clamp((e.t1 - t) / f)) : 0

// ---- the terminal: the text printed and typed up to t, wrapped at the window's width ----
function termRows(t) {
  let lines = [[]]
  let typing = false, lastAt = -1
  const add = (c, s) => {
    const parts = s.split('\n')
    parts.forEach((p, i) => {
      if (i > 0) lines.push([])
      if (p) lines[lines.length - 1].push({ c, s: p })
    })
  }
  for (const e of TL.tracks.term) {
    if (e.t > t) break
    lastAt = e.t
    if (e.op === 'clear') { lines = [[]]; continue }
    if (e.op === 'out') { for (const g of e.segs) add(g.c, g.s); continue }
    if (e.op === 'type') {
      const total = e.segs.reduce((a, g) => a + g.s.length, 0)
      const n = e.dur > 0 ? Math.floor(clamp((t - e.t) / e.dur) * total + 1e-9) : total
      if (n < total) typing = true
      lastAt = Math.max(e.t, Math.min(t, e.t + e.dur))
      let left = n
      for (const g of e.segs) { if (left <= 0) break; add(g.c, g.s.slice(0, left)); left -= g.s.length }
    }
  }
  const cols = TL.font.cols, rows = []
  for (const line of lines) {
    const chars = []
    for (const g of line) for (const ch of g.s) chars.push([g.c, ch])
    if (!chars.length) { rows.push([]); continue }
    for (let i = 0; i < chars.length; i += cols) rows.push(chars.slice(i, i + cols))
  }
  // the cursor sits after the last character
  const shown = rows.slice(-TL.font.rows)
  const blinkOn = typing || t - lastAt < 0.6 || Math.floor((t - lastAt) / 0.53) % 2 === 0
  let html = ''
  shown.forEach((r, i) => {
    let out = '', cls = null, buf = ''
    const flush = () => { if (buf) out += cls ? `<span class="${cls.split(' ').map(x => x === 'addr' ? 'addr' : 't-' + x).join(' ')}">${esc(buf)}</span>` : esc(buf); buf = '' }
    for (const [c, ch] of r) { if (c !== cls) { flush(); cls = c } buf += ch }
    flush()
    if (i === shown.length - 1 && blinkOn && TL.tracks.cursorOn !== false) out += '<span class="cur"></span>'
    html += `<div class="row">${out}</div>`
  })
  return html
}

const shown = { term: '', tabs: '', title: '', page: '' }
function frame(t) {
  const tr = TL.tracks
  const sig = []
  // ---- camera ----
  const cam = keyed(tr.cam, t, ['z', 'x', 'y'], { z: 1, x: 960, y: 540 })
  const z = cam.z
  const cx = clamp(cam.x, 960 / z, 1920 - 960 / z), cy = clamp(cam.y, 540 / z, 1080 - 540 / z)
  $('#cam').style.transform = `translate(${(960 - cx * z).toFixed(2)}px,${(540 - cy * z).toFixed(2)}px) scale(${z.toFixed(4)})`
  sig.push(z.toFixed(4), cx.toFixed(1), cy.toFixed(1))

  // ---- windows: shown, opening, in front ----
  for (const win of ['term', 'browser']) {
    const el = $('#' + win)
    const vis = last(tr.vis[win], t)
    const on = vis ? vis.on : false
    el.classList.toggle('hidden', !on)
    let s = 1, o = 1
    if (on && vis.open) { const p = clamp((t - vis.t) / 0.3); s = 0.94 + 0.06 * ease(p); o = ease(p) }
    el.style.transform = `scale(${s})`; el.style.opacity = o
    sig.push(win, on, s.toFixed(3))
  }
  const front = last(tr.front, t)
  $('#term').style.zIndex = front && front.win === 'term' ? 3 : 2
  $('#browser').style.zIndex = front && front.win === 'term' ? 2 : 3
  sig.push(front && front.win)
  for (const k of document.querySelectorAll('.tbicon')) {
    const want = (k.dataset.k === 'term' && last(tr.vis.term, t)?.on) || (k.dataset.k === 'web' && last(tr.vis.browser, t)?.on)
    k.classList.toggle('on', Boolean(want))
  }
  const app = document.querySelector('.menubar .app')
  if (app) app.textContent = front && front.win === 'term' ? 'Terminal' : 'Browser'

  // ---- terminal ----
  const title = last(tr.termTitle, t)
  if (title && title.text !== shown.title) { $('#term .ttitle').textContent = title.text; shown.title = title.text }
  const html = termRows(t)
  if (html !== shown.term) { $('#term .rows').innerHTML = html; shown.term = html }
  sig.push(html.length, html.slice(-300), shown.title)

  // ---- browser: tabs, address and the page ----
  const tabs = last(tr.tabs, t)
  if (tabs) {
    const a = tabs.tabs.map((x, i) => `<div class="tab${i === tabs.active ? ' on' : ''}"><img src="${TL.shots.fav[x.fav]}"><span class="tt">${esc(x.title)}</span><span class="x">&#x2715;</span></div>`).join('')
    const b = `<span class="host">${esc(tabs.url.host)}</span><span class="rest">${esc(tabs.url.rest)}</span>`
    if (a + b !== shown.tabs) { $('#browser .tablist').innerHTML = a; $('#browser .url').innerHTML = b; shown.tabs = a + b }
    sig.push(a + b)
  }
  const pages = tr.page.filter(e => e.t <= t)
  const cur = pages[pages.length - 1], prev = pages[pages.length - 2]
  const p = cur && cur.fade ? clamp((t - cur.t) / cur.fade) : 1
  for (const img of document.querySelectorAll('#browser .page img')) {
    const n = img.dataset.name
    let o = 0, zi = 0
    if (cur && n === cur.name) { o = p; zi = 2 }
    else if (prev && n === prev.name && p < 1) { o = 1; zi = 1 }
    img.style.opacity = o; img.style.zIndex = zi
  }
  sig.push(cur && cur.name, prev && prev.name, p.toFixed(3))

  // ---- pointer and clicks ----
  const m = keyed(tr.cursor, t, ['x', 'y'], tr.cursor[0])
  let mx = m.x, my = m.y
  if (m.p !== undefined) { // a slight arc, as a hand moves
    const dx = m.to.x - m.from.x, dy = m.to.y - m.from.y, arc = Math.sin(Math.PI * m.p) * 0.08
    mx += -dy * arc; my += dx * arc
  }
  const click = tr.clicks.find(c => t >= c.t && t < c.t + 0.45)
  const press = tr.clicks.some(c => t >= c.t && t < c.t + 0.12)
  const cvis = last(tr.pointer, t)
  $('#cursor').style.display = cvis && cvis.on === false ? 'none' : 'block'
  $('#cursor').style.transform = `translate(${(mx - 5).toFixed(1)}px,${(my - 3).toFixed(1)}px) scale(${press ? 0.88 : 1})`
  const r = $('#ripple')
  if (click) {
    const q = (t - click.t) / 0.45
    Object.assign(r.style, { left: click.x + 'px', top: click.y + 'px', opacity: (1 - q).toFixed(3), transform: `scale(${(0.35 + q * 1.1).toFixed(3)})` })
  } else r.style.opacity = 0
  sig.push(mx.toFixed(1), my.toFixed(1), press, click ? ((t - click.t) / 0.45).toFixed(2) : '-', cvis && cvis.on)

  // ---- words on the video ----
  const capE = within(tr.caption, t)
  const cap = $('#caption')
  const co = fadeIO(capE, t)
  if (capE) cap.textContent = capE.text
  cap.style.opacity = co.toFixed(3)
  cap.style.transform = `translateX(-50%) translateY(${((1 - co) * 12).toFixed(1)}px)`
  sig.push(capE && capE.text, co.toFixed(2))
  const noteE = within(tr.note, t)
  const no = fadeIO(noteE, t, 0.2)
  const note = $('#note')
  if (noteE) { $('#note .ntext').textContent = noteE.text; note.style.setProperty('--hand', (250 + 360 * 1.5 * clamp((t - noteE.t0) / (noteE.t1 - noteE.t0))).toFixed(0) + 'deg') }
  note.style.opacity = no.toFixed(3)
  note.style.transform = `translateX(-50%) scale(${(0.9 + 0.1 * no).toFixed(3)})`
  sig.push(noteE && noteE.text, no.toFixed(2), noteE ? ((t - noteE.t0) * 6).toFixed(0) : '')
  const keyE = within(tr.keys, t)
  const ko = fadeIO(keyE, t, 0.12)
  const keysEl = $('#keys')
  const kh = keyE ? keyE.keys.map(k => `<span class="key">${esc(k)}</span>`).join('<span class="plus">+</span>') : ''
  if (keysEl.dataset.h !== kh) { keysEl.innerHTML = kh; keysEl.dataset.h = kh }
  keysEl.style.opacity = ko.toFixed(3)
  keysEl.style.transform = `translateY(${keyE && t - keyE.t0 < 0.1 ? 3 : 0}px)`
  sig.push(kh, ko.toFixed(2))
  const f = $('#fade')
  const fo = Math.max(clamp(1 - t / 0.35), clamp((t - (TL.duration - 0.45)) / 0.45))
  f.style.opacity = fo.toFixed(3)
  sig.push(fo.toFixed(2))
  return sig.join('~')
}

/** The advance of one character of a monospace font, in px (the timeline is laid out with it). */
async function measure(mono, size) {
  await document.fonts.load(`${size}px '${mono}'`)
  const c = document.createElement('canvas').getContext('2d')
  c.font = `${size}px '${mono}'`
  return c.measureText('M'.repeat(200)).width / 200
}

window.setup = setup
window.frame = frame
window.measure = measure
