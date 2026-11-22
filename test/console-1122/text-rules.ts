// The owner's two text rules for everything a user reads (TEXT-1, TEXT-2): no em dash and no comma right before
// "and" or "or" (an Oxford comma, or two clauses joined with a comma and "and"). One scan for both tests: what a user
// does not read (code, comments, a quotation of another party's words) is blanked out first, each line break kept,
// so that a hit is reported at its own line.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export const ROOT = join(import.meta.dirname, '..', '..')
export const read = (f: string) => readFileSync(join(ROOT, f), 'utf8')

const blank = (s: string) => s.replace(/[^\n]/g, ' ')
// Inline code stands as a word, so "Node.js, `npm start` and `npm test`" is not read as ", and".
const word = (s: string) => s.replace(/[^\n]/g, 'x')

/** A comma, then "and" or "or" after spaces, line breaks, HTML tags or markdown emphasis; or an em dash. */
const RULE = /,(?:\s|<\/?[a-zA-Z][^<>]*>|[*_])+(?:and|or)\b|—|&mdash;|\\u2014/g

/** Telegram's own rule, quoted word for word (test/no-word-bot.test.ts pins it): a quotation, not our sentence. */
const QUOTED = /Telegram requires the username to end in "bot"/g
const unquote = (s: string) => s.replace(QUOTED, blank)

/** Markdown and MDX: fenced code, HTML and MDX comments and MDX imports are not prose; inline code is a word. */
export function markdownText(src: string): string {
  let fence = ''
  const lines = src.split('\n').map(line => {
    const open = line.match(/^\s*(```|~~~)/)?.[1]
    if (fence) { if (open === fence) fence = ''; return blank(line) }
    if (open) { fence = open; return blank(line) }
    return line
  })
  return unquote(lines.join('\n')
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, blank)
    .replace(/^import .*$/gm, blank)
    .replace(/``[^`\n]+``|`[^`\n]+`/g, word))
}

/** The dashboard and the login page: HTML comments, CSS and JS block comments and JS line comments are not read. */
export function pageText(src: string): string {
  return unquote(src
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|\s)\/\/.*$/gm, (m: string, pre: string) => pre + blank(m.slice(pre.length))))
}

/** The installers and cli.sh: their comment lines are not printed (PowerShell's <# #> blocks neither). */
export function scriptText(src: string): string {
  return unquote(src.replace(/<#[\s\S]*?#>/g, blank).replace(/^[ \t]*#.*$/gm, blank))
}

/** Every hit of the two rules in a text the functions above prepared: its line (from 1) and that line, trimmed. */
export function ruleHits(text: string): { line: number, text: string }[] {
  const lines = text.split('\n')
  return [...text.matchAll(RULE)].map(m => {
    const line = text.slice(0, m.index).split('\n').length
    return { line, text: (lines[line - 1] ?? '').trim().replace(/\s+/g, ' ') }
  })
}

/** The files whose text a user reads, by kind (TEXT-2): the site's pages are found, not listed by hand. */
export function userFiles(): { file: string, text: (src: string) => string }[] {
  const docs = (readdirSync(join(ROOT, 'site/src/content/docs'), { recursive: true }) as string[])
    .filter(f => /\.mdx?$/.test(f)).sort().map(f => `site/src/content/docs/${f}`)
  return [
    ...['README.md', 'INSTALL.md', ...docs].map(file => ({ file, text: markdownText })),
    ...['src/web/dashboard.html', 'src/web/login.html'].map(file => ({ file, text: pageText })),
    ...['install.sh', 'get.sh', 'get.ps1', 'cli.sh'].map(file => ({ file, text: scriptText })),
  ]
}
