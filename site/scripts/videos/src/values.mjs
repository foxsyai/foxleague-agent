// The example values every video uses. Nothing here is real: change a value, then run `npm run all`.
//
// - USER: the Linux user, the Windows user, the dashboard user and the start of the host names. An obvious example.
// - ADDRESS: made up for the videos. Its bech32 checksum is wrong on purpose (checked with @multiversx/sdk-core:
//   Address.newFromBech32 refuses it), so nobody can send funds to it. It is shown with an "example" tag.
// - NEXT_ADDRESS: the same, for the dashboard's "next agent" (not on screen; replaced so no derived address leaks).
// - WORDS: the recovery words screen shows word1 ... word24 (the installer prints 24 words).
// - The dashboard password is typed but never shown: only the dots of the login form and nothing in the terminal.

export const VALUES = {
  user: 'ana',
  hosts: { windows: 'PC', mac: 'laptop', linux: 'laptop' },
  homes: { windows: '/home/ana', mac: '/Users/ana', linux: '/home/ana' },
  windowsHome: 'C:\\Users\\ana',
  windowsBuild: 26100,
  dashPassword: 'example-password-2026',
  port: 8870,
  version: '1.0.0',
  nextVersion: '1.0.1',
  releaseNotes: 'Clearer messages on the dashboard and a few small fixes.',
  address: 'erd1gupzwzfxh2lk2gwk7s7lfa9jqtm98h88m6z0dsfg49d8552jlckacd4d5s',
  nextAddress: 'erd1sx22fp62qe6rkq9vjt2ths488m4g83egc4h456fu0v4kc927w0utp755pn',
  words: Array.from({ length: 24 }, (_, i) => `word${i + 1}`),
  teamName: 'Fox Demo XI',
}

// The browser window's page area, the same size on every system, so one set of screenshots per system fits it.
export const PAGE = { width: 1600, height: 860, scale: 2 }

// Fonts that stand in for each system's own (no system font of Windows or macOS is on this machine).
// mono: the terminal; ui: window titles, menus and the web pages.
export const FONTS = {
  windows: { mono: 'Inconsolata', ui: 'Noto Sans', monoSize: 23, cols: 118, rows: 31 },
  mac: { mono: 'DejaVu Sans Mono', ui: 'Inter', monoSize: 19, cols: 114, rows: 32 },
  linux: { mono: 'Ubuntu Sans Mono', ui: 'Ubuntu Sans', monoSize: 22, cols: 118, rows: 31 },
}

export const SYSTEMS = ['windows', 'mac', 'linux']
