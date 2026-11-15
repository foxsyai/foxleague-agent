// The owner's standing text rule, 2026-11-15: never the word "bot" in anything a user reads. Telegram calls what
// BotFather makes a bot; the agent calls it "your agent's Telegram account" and its token the "Telegram token".
// Allowed: Telegram's own names BotFather and /newbot (the user types them as they are; neither holds "bot" as a
// word) and Telegram's username rule, quoted once in each list of BotFather steps. Out of scope: code identifiers,
// API and environment variable names, comments for developers and the model's prompt (src/strategist/prompt.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import { KEY_FIELDS } from '../src/store/secrets.ts'

const REPO = resolve(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(REPO, p), 'utf8')
const BOT = /\bbots?\b/i
/** Telegram's rule for the username, the three letters quoted: said once where the BotFather steps need it. */
const RULE = 'Telegram requires the username to end in "bot"'
const RULE_RE = /Telegram\s+requires\s+the\s+username\s+to\s+end\s+in\s+"bot"/g
/** The lists of BotFather steps: the installer's 4/7 Keys help, INSTALL.md, the site's Keys page, the dashboard guide. */
const STEPS = ['install.sh', 'INSTALL.md', 'site/src/content/docs/start/keys.mdx', 'src/web/dashboard.html']

function walk(dir: string, keep: (p: string) => boolean, skip: readonly string[] = []): string[] {
  const out: string[] = []
  for (const e of readdirSync(join(REPO, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`
    if (skip.includes(p)) continue
    if (e.isDirectory()) out.push(...walk(p, keep, skip))
    else if (keep(p)) out.push(p)
  }
  return out.sort()
}

// What a user reads, file by file.
const SHELL = ['install.sh', 'get.sh', 'cli.sh', 'get.ps1']
const PAGES = [
  'README.md',
  'INSTALL.md',
  'docs/SERVER.md',
  '.env.example',
  'src/web/dashboard.html',
  'src/web/login.html',
  'site/astro.config.mjs',
  ...walk('site/src/content/docs', p => /\.mdx?$/.test(p)),
  ...walk('site/src/components', p => p.endsWith('.astro')),
]
// The service's Telegram messages and replies, the CLI's messages, the dashboard's API answers and key labels: every
// string in the code. The model's prompt is model text; src/local is the owner's private test feature.
const CODE = walk('src', p => p.endsWith('.ts'), ['src/local', 'src/strategist/prompt.ts'])

/** The strings of a TypeScript file with their line, comments and identifiers left out. */
function strings(file: string): { line: number; text: string }[] {
  const src = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true)
  const out: { line: number; text: string }[] = []
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      out.push({ line: src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1, text: n.text })
    }
    ts.forEachChild(n, visit)
  }
  visit(src)
  return out
}

/** The lines of an installer script without its comment lines, or every line of a page. */
function lines(file: string): { line: number; text: string }[] {
  // The quoted rule is taken out only in a list of BotFather steps; anywhere else it counts as the word.
  const text = STEPS.includes(file) ? read(file).replace(RULE_RE, m => m.replace('"bot"', '"..."')) : read(file)
  const all = text.split('\n').map((t, i) => ({ line: i + 1, text: t }))
  return SHELL.includes(file) ? all.filter(l => !l.text.trim().startsWith('#')) : all
}

test('NO-BOT the word bot is nowhere a user reads: installers, dashboard, Telegram, CLI, guides and the site', () => {
  assert.ok(CODE.length > 40 && CODE.includes('src/service.ts') && CODE.includes('src/cli.ts') && CODE.includes('src/telegram/telegram.ts'), `${CODE.length} source files`)
  assert.ok(PAGES.length > 20, `${PAGES.length} pages`)
  const hits: string[] = []
  for (const file of [...SHELL, ...PAGES]) {
    for (const l of lines(file)) if (BOT.test(l.text)) hits.push(`${file}:${l.line}: ${l.text.trim().slice(0, 160)}`)
  }
  for (const file of CODE) {
    for (const s of strings(file)) {
      // The Telegram Bot API's address is an API name, not a sentence.
      const text = s.text.replace(/api\.telegram\.org\/bot/g, 'api.telegram.org/')
      if (BOT.test(text)) hits.push(`${file}:${s.line}: ${text.trim().slice(0, 160)}`)
    }
  }
  for (const file of STEPS) {
    const n = read(file).match(RULE_RE)?.length ?? 0
    if (n > 1) hits.push(`${file}: Telegram's username rule is said ${n} times, once is enough`)
  }
  assert.deepEqual(hits, [], `the word bot where a user reads it:\n${hits.join('\n')}`)
})

test('NO-BOT Telegram\'s username rule is said, quoted, once in each list of BotFather steps', () => {
  for (const file of STEPS) {
    const text = read(file)
    assert.equal(text.match(RULE_RE)?.length ?? 0, 1, `${file}: ${RULE}`)
    // It belongs to the step that sends /newbot.
    const at = text.search(RULE_RE)
    assert.ok(at > text.indexOf('/newbot') && at - text.indexOf('/newbot') < 160, `${file}: the rule is said at /newbot`)
  }
})

test('NO-BOT one wording everywhere: the Telegram token from BotFather and your agent\'s Telegram account', () => {
  // The key's name in the dashboard, in /keys and in the Telegram notice of a change.
  assert.equal(KEY_FIELDS.find(f => f.key === 'TELEGRAM_BOT_TOKEN')!.label, 'Telegram token')
  // The installer's question (the real prompt is held in test/audit-1111/fresh-12.test.ts).
  assert.ok(read('src/cli.ts').includes("await ask('TELEGRAM_BOT_TOKEN', 'Telegram token from BotFather')"))
  const dash = read('src/web/dashboard.html')
  assert.ok(dash.includes("key_TELEGRAM_BOT_TOKEN: ['Telegram token', "), 'the info bubble has the label of the field')
  // The steps name the field as the dashboard labels it, and the account BotFather makes the same way.
  const flat = (f: string) => read(f).replace(/\s+/g, ' ')
  assert.match(flat('src/web/dashboard.html'), /paste it into Telegram token, type your password/)
  assert.match(flat('site/src/content/docs/start/keys.mdx'), /paste it into \*\*Telegram token\*\*, type your password/)
  assert.match(flat('INSTALL.md'), /in the dashboard: Keys, Telegram token, your password, Save\./)
  for (const f of [...STEPS, 'site/src/content/docs/use/talk-to-your-manager.md', 'site/src/content/docs/help/troubleshooting.md']) {
    assert.match(flat(f), /your agent's Telegram account/i, f)
  }
  // What the owner reads while linking the chat: the CLI, the dashboard's answer and Telegram's own refusal.
  assert.match(read('src/cli.ts'), /Your agent's Telegram account is @\$\{name\}\. From your own Telegram account, send it this code/)
  assert.match(read('src/service.ts'), /send exactly those 6 digits to your agent\\'s Telegram account/)
  assert.match(read('src/setup/keys.ts'), /Telegram did not list the messages sent to your agent's Telegram account/)
})
