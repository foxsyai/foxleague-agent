// The story of each video: what happens when, on which screen. Change a sentence in WORDS (the words the videos
// add) or a timing below, then run `npm run render` again.
//
// The words the videos add follow the owner's text rules: plain words, no em dashes, no Oxford comma and none of the
// words the owner keeps out of everything the project shows.

import { Timeline, seg } from './timeline.mjs'
import { texts, INSTALL_LINE_SH } from './text.mjs'
import { FONTS, PAGE, VALUES } from './values.mjs'

export const WORDS = {
  copy: 'Copy the line',
  paste: {
    windows: 'Open Windows PowerShell, paste the line and press Enter',
    mac: 'Open Terminal, paste the line and press Enter',
    linux: 'Open a terminal, paste the line and press Enter',
  },
  pasteKeys: { windows: ['Ctrl', 'V'], mac: ['Cmd', 'V'], linux: ['Ctrl', 'Shift', 'V'] },
  ready: 'Ubuntu comes next: Enter means yes',
  fewMinutes: 'A few minutes later',
  aMinute: 'A minute later',
  ubuntuUser: 'Ubuntu asks for its own username and password',
  ubuntuPass: 'Nothing shows while you type the password. That is normal.',
  exit: 'At the $ prompt, type exit and press Enter',
  words: 'Example words. Write your own 24 words on paper, then type yes',
  login: 'Choose a username and password for the dashboard',
  keys: 'Enter skips each key: add them later in the dashboard',
  dry: 'Agents start in dry run: nothing is signed until you press Go LIVE',
  done: 'Done: the dashboard address. Enter opens it.',
  signIn: 'Sign in with your dashboard username and password',
  guide: 'Getting started shows what is left to do',
  days: 'A few days later',
  update: 'A new version is out: Update now is one click',
  updated: 'The page comes back by itself with the new version',
  uninstall: {
    windows: 'To uninstall: one line in PowerShell',
    mac: 'To uninstall: two lines in Terminal',
    linux: 'To uninstall: two lines in a terminal',
  },
}

// Where things are on each desktop (px of the 1920x1080 frame).
const LAYOUT = {
  windows: { termY: 58, pad: 10, free: [0, 1920], browser: { x: 160, y: 44 }, captionBottom: 66, lineHeight: 1.17, clock: { time: '10:24 AM', date: '11/15/2026' } },
  mac: { termY: 54, pad: 8, free: [0, 1920], browser: { x: 160, y: 46 }, captionBottom: 92, lineHeight: 1.25, clock: { day: 'Sun 15 Nov', time: '10:24' } },
  linux: { termY: 62, pad: 8, free: [72, 1920], browser: { x: 196, y: 72 }, captionBottom: 46, lineHeight: 1.2, clock: { day: 'Nov 15', time: '10:24' } },
}
const CHROME_H = { windows: 32, mac: 30, linux: 46 }
const SITE_HOST = 'agent.foxleague.ai'
const DASH_HOST = `localhost:${VALUES.port}`
const TITLES = {
  windows: () => 'Windows PowerShell',
  mac: () => `${VALUES.user} · -zsh · ${FONTS.mac.cols}×${FONTS.mac.rows}`,
  linux: dir => `${VALUES.user}@${VALUES.hosts.linux}: ${dir}`,
}
const MDX = os => `site/src/content/docs/start/install-${os}.mdx`

/** Builds the timeline of one video. cw: the terminal font's advance (measured in the stage); boxes: capture.mjs. */
export function build(os, { cw, boxes, shotNames, shotBase, fav }) {
  const L = LAYOUT[os], F = FONTS[os]
  const font = { ...F, lineHeight: L.lineHeight }
  const lh = Math.round(F.monoSize * L.lineHeight)
  const w = Math.ceil(F.cols * cw + 2 * L.pad + (os === 'windows' ? 17 : 0))
  const h = CHROME_H[os] + F.rows * lh + 2 * L.pad
  const term = { x: Math.round(L.free[0] + (L.free[1] - L.free[0] - w) / 2), y: L.termY, w, h, pad: L.pad }
  const browser = { ...L.browser, w: PAGE.width, h: PAGE.height }
  const tl = new Timeline({ os, font, term, browser, clock: L.clock, shots: { base: shotBase, names: shotNames, fav }, captionBottom: L.captionBottom })
  const T = texts(os)
  const box = name => tl.pageBox(boxes[name])
  const caption = (key, dur) => {
    const prev = tl.tracks.caption.at(-1)
    if (prev && prev.t1 > tl.t) prev.t1 = tl.t
    tl.caption(typeof WORDS[key] === 'string' ? WORDS[key] : WORDS[key][os], dur)
  }
  const siteTab = { title: boxes.siteTitle, fav: 'site' }

  // ---------------- 1. the install page: copy the line ----------------
  tl.show('browser', false).front('browser').tabs([siteTab], 0, { host: SITE_HOST, rest: `/start/install-${os}/` }).page('site')
  tl.move(1250, 830, 0)
  tl.wait(0.4); caption('copy', 3.0)
  const code = box('siteCode'), copy = box('siteCopy')
  tl.cam(1.35, code.cx, code.cy + 60, 0.9)
  tl.wait(0.2).move(code.x + code.w * 0.55, code.cy + 10, 0.8).page('site-hover')
  tl.wait(0.15).move(copy.cx, copy.cy, 0.5).wait(0.15).click(0).page('site-copied')
  tl.wait(0.8).cam(1, 960, 540, 0.6).wait(0.5)

  // ---------------- 2. the terminal: paste, Enter ----------------
  const promptNow = os === 'windows' ? T.ps.prompt() : T.prompt('~')
  tl.title(os === 'linux' ? TITLES.linux('~') : TITLES[os]()).show('term').front('term')
  if (os === 'mac') tl.lines([[seg('Last login: Sun Nov 15 10:21:07 on ttys000', null, { ext: 'macOS Terminal' })]], 0)
  tl.out(promptNow)
  caption('paste', 2.9)
  const inTerm = tl.termPoint(0.62, 0.55)
  tl.wait(0.35).move(inTerm.x, inTerm.y, 0.5).click()
  tl.keys(WORDS.pasteKeys[os], 0.8).wait(0.15)
  if (os === 'windows') tl.out(T.ps.installLine())
  else tl.out(seg(INSTALL_LINE_SH, null, { f: MDX(os), l: 37, frags: [INSTALL_LINE_SH] }))
  tl.wait(0.75).enter(0.12)

  // ---------------- 3. Windows only: get.ps1's own steps, Ubuntu's first start ----------------
  if (os === 'windows') {
    tl.lines(T.ps.start()).wait(0.8).lines(T.ps.wslReady()).wait(0.3)
    tl.lines(T.ps.ubuntu()).out(T.ps.ready())
    caption('ready', 2.0)
    tl.wait(1.7).enter()
    tl.lines(T.ps.exitNote()).wait(0.2).lines(T.ps.wslDownload()).wait(0.3)
    tl.note(WORDS.fewMinutes, 1.3)
    tl.lines(T.ps.wslInstalled(), 0.12).out(T.ps.ubuntuUser())
    caption('ubuntuUser', 2.4)
    tl.wait(1.1).type(VALUES.user, 8).wait(0.15).enter()
    tl.out(T.ps.ubuntuPass())
    caption('ubuntuPass', 2.9)
    tl.wait(0.2).typeHidden(10).enter().out(T.ps.ubuntuRepeat()).wait(0.1).typeHidden(10).enter()
    // Ubuntu's own prompt inside the PowerShell window, in the Windows folder it was started from: ana@PC:/mnt/c/Users/ana$
    tl.lines(T.ps.ubuntuDone()).out(T.ps.ubuntuPrompt())
    caption('exit', 2.0)
    tl.wait(0.5).type('exit', 9).wait(0.2).enter()
    tl.lines(T.ps.ubuntuReady()).wait(0.35).lines(T.ps.settings()).wait(0.4).lines(T.ps.inner()).wait(0.2)
  }

  // ---------------- 4. get.sh and install.sh: the seven steps ----------------
  tl.lines(T.download())
  tl.note(WORDS.aMinute, 1.1)
  tl.lines(T.nodeDone()).wait(0.25)
  tl.lines(T.wallet()).out(T.wordsPrompt())
  caption('words', 3.6)
  const wordsAt = tl.t
  tl.wait(2.3).type('yes', 7).wait(0.15).enter(0.1)
  tl.clear().lines(T.afterYes()).wait(0.15)
  tl.lines(T.login()).out(T.loginUser())
  caption('login', 4.2)
  tl.wait(0.35).type(VALUES.user, 8).wait(0.1).enter()
  tl.out(T.loginPass()).typeHidden(11).enter().out(T.loginRepeat()).typeHidden(10).enter()
  tl.lines(T.loginSaved()).out(T.port()).wait(0.6).enter()
  tl.lines(T.keys()).out(T.keysNow())
  caption('keys', 3.7)
  tl.wait(1.0).enter()
  tl.lines(T.configure())
  for (const ask of T.keyAsk) tl.out(ask()).wait(0.3).enter(0.06)
  tl.lines(T.keysSaved())
  tl.wait(0.1).lines(T.settings()).out(T.allowLive())
  caption('dry', 2.9)
  tl.wait(1.8).enter()
  tl.lines(T.pem()).wait(0.15).lines(T.service()).wait(0.7).lines(T.running()).wait(0.15)
  tl.lines(T.done()).out(T.openBrowser())
  caption('done', 3.1)
  const posterAt = tl.t + 1.2
  tl.wait(2.0).enter(0.1)
  if (os === 'windows') tl.wait(0.2).lines(T.ps.keepAlive()).wait(0.3).lines(T.ps.done()).out(T.ps.prompt()).wait(0.5)
  else tl.out(T.prompt('~')).wait(0.3)

  // ---------------- 5. the browser: sign in ----------------
  const dashTabs = (title, rest) => tl.tabs([siteTab, { title, fav: 'dash' }], 1, { host: DASH_HOST, rest })
  tl.front('browser'); dashTabs('FoxLeague Agent: Sign in', '/login'); tl.page('login', 0.25)
  caption('signIn', 4.3)
  const u = box('loginUser'), p = box('loginPass'), s = box('loginSubmit')
  tl.cam(1.3, u.cx, (u.cy + s.cy) / 2 - 10, 0.8)
  tl.wait(0.3).move(u.x + u.w * 0.7, u.cy + 6, 0.6).click(0.05).page('login-u0')
  for (let i = 1; i <= VALUES.user.length; i++) tl.wait(0.13).page(`login-u${i}`)
  tl.wait(0.2).move(p.x + p.w * 0.7, p.cy + 6, 0.4).click(0.05).page('login-p0')
  for (let i = 3; i <= boxes.passwordLength; i += 3) tl.wait(0.09).page(`login-p${i}`)
  tl.wait(0.25).move(s.cx, s.cy, 0.35).wait(0.1).click(0.2)
  dashTabs('FoxLeague Agent', ''); tl.page('dash-guide', 0.3).cam(1, 960, 540, 0.7)

  // ---------------- 6. the dashboard right after the install ----------------
  caption('guide', 2.4)
  const close = box('guideClose')
  tl.wait(1.1).move(close.cx, close.cy, 0.5).wait(0.1).click(0.05).page('dash-fresh', 0.15).wait(0.6)

  // ---------------- 7. a few days later: the update ----------------
  const banner = box('upBanner'), upBtn = box('upBtn')
  const days = tl.t
  tl.note(WORDS.days, 1.3)
  tl.at(days + 0.5).page('dash-update', 0.4).at(days + 1.3)
  tl.cam(1.3, banner.cx, banner.cy + 120, 0.8)
  caption('update', 3.4)
  tl.wait(0.4).move(upBtn.cx - 10, upBtn.cy + 4, 0.7).page('dash-update-hover').wait(0.3).click(0.05).page('dash-installing', 0.1)
  tl.wait(1.0)
  const minute = tl.t
  tl.note(WORDS.aMinute, 1.2)
  tl.at(minute + 0.8).page('dash-updated', 0.3).at(minute + 1.2)
  caption('updated', 2.4)
  tl.wait(2.0).cam(1, 960, 540, 0.6).wait(0.5)

  // ---------------- 8. the uninstall ----------------
  tl.front('term')
  caption('uninstall', 5.0)
  const inTerm2 = tl.termPoint(0.9, 0.3)
  tl.move(inTerm2.x, inTerm2.y, 0.5).click()
  if (os === 'windows') {
    tl.keys(WORDS.pasteKeys.windows, 0.8).wait(0.15).out(T.ps.uninstallLine()).wait(0.6).enter()
    tl.lines(T.ps.uninstall()).out(T.ps.uninstallAsk()).wait(1.1).enter()
    tl.lines(T.ps.uninstallRun()).wait(0.3).lines(T.uninstall()).wait(0.2).lines(T.ps.uninstallEnd()).out(T.ps.prompt())
  } else {
    const [l1, l2] = os === 'mac' ? [133, 134] : [136, 137]
    tl.type(seg('cd ~/foxleague-agent', null, { f: MDX(os), l: l1, frags: ['cd ~/foxleague-agent'] }), 16).wait(0.1).enter(0.05)
    if (os === 'linux') tl.title(TITLES.linux('~/foxleague-agent'))
    tl.out(T.prompt('~/foxleague-agent')).wait(0.3)
    tl.type(seg('./install.sh --uninstall', null, { f: MDX(os), l: l2, frags: ['./install.sh --uninstall'] }), 16).wait(0.15).enter()
    tl.wait(0.2).lines(T.uninstall()).out(T.prompt('~/foxleague-agent'))
  }
  tl.wait(2.2)

  tl.posterAt = posterAt
  tl.wordsAt = wordsAt
  return tl
}
