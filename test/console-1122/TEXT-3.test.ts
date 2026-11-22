// TEXT-3: the owner, 2026-11-22, before the public release. The two text rules TEXT-1 and TEXT-2 hold the pages to (no
// em dash, no comma right before "and" or "or") hold for the text the code itself shows a person too: Telegram's
// messages and replies, the morning summary, what the command line prints, the dashboard's answers, the Activity rows
// (refusals and results) and the updater's notices. The scan reads every string of src/**/*.ts with the TypeScript
// compiler (comments and identifiers left out), across the pieces of a template and of a `+` chain, so that
// `${a},${b ? ' and c' : ''}` is read as the sentence it prints. What only the AI reads is out of scope: the prompt
// (src/strategist/prompt.ts, byte-stable for the prompt cache, not scanned) and the strings listed in ALLOWED below.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { ROOT } from './text-rules.ts'

/** A comma, then "and" or "or" after spaces or line breaks; or an em dash. */
const RULE = /,\s+(?:and|or)\b|\u2014/

/**
 * Strings no person reads, by file and the words they start with. Every entry must still match a string (checked
 * below), so the list cannot outlive what it excuses.
 */
const ALLOWED: Record<string, string[]> = {
  // The snapshot (renderDigest and its lines): the plan request and the owner's chat carry it to the AI; `cli
  // snapshot` prints it as the AI reads it. The /agents reply shows only its first five lines, none of these.
  'src/snapshot/digest.ts': [
    'ELO pair cap: ',
    'Referral programme (Invite Friends): ',
    'My active tournament: T',
    'LISTED IN YOUR 18: ',
    'Your best XI OVR (what OVR ranges are checked against): ',
    '  (field lines: a seated team is clearly stronger',
    'A bid must reach the reserve, or the top bid plus ',
    'Win chances: the ELO expectation',
    'Teams to challenge (first the ones',
  ],
  // The plan request and the chat request: the AI reads them.
  'src/strategist/strategist.ts': [
    'Do not call submit_plan.',
    'Buying power: ',
    '## Earlier entries',
    '## Your previous plan (',
  ],
  // Why a page of FoxLeague's manual is left out of the agents' copy: a note for whoever maintains the list, nothing
  // prints it.
  'src/strategist/manual.ts': ["what an administrator does to a banned or an empty account"],
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`
    // src/local is the owner's private test feature; the prompt is the model's text (byte-stable).
    if (p === 'src/local' || p === 'src/strategist/prompt.ts') continue
    if (e.isDirectory()) out.push(...walk(p))
    else if (p.endsWith('.ts')) out.push(p)
  }
  return out.sort()
}

const MAX_VARIANTS = 64
const isText = (n: ts.Node) => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)
/** Whether an expression builds text: a string, a template or a choice or `+` chain that holds one. */
function textual(n: ts.Node): boolean {
  if (isText(n)) return true
  if (ts.isParenthesizedExpression(n)) return textual(n.expression)
  if (ts.isConditionalExpression(n)) return textual(n.whenTrue) || textual(n.whenFalse)
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) return textual(n.left) || textual(n.right)
  return false
}
const join2 = (a: string[], b: string[]) => [...new Set(a.flatMap(x => b.map(y => x + y)))].slice(0, MAX_VARIANTS)
/**
 * The texts an expression can print: each branch of a choice, each piece of a template and of a `+` chain in its place.
 * A value the code computes (a number, a name, a call) prints as X, a word: ", X and" is no comma before "and".
 */
function renderings(n: ts.Node): string[] {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return [n.text]
  if (ts.isTemplateExpression(n)) {
    let out = [n.head.text]
    for (const span of n.templateSpans) out = join2(out, renderings(span.expression).map(r => r + span.literal.text))
    return out
  }
  if (ts.isParenthesizedExpression(n)) return renderings(n.expression)
  if (ts.isConditionalExpression(n) && textual(n)) return [...new Set([...renderings(n.whenTrue), ...renderings(n.whenFalse)])]
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken && textual(n)) return join2(renderings(n.left), renderings(n.right))
  return ['X']
}
/** Whether a node is a piece of a larger text (read with it) rather than a text of its own. */
function inner(n: ts.Node): boolean {
  const p = n.parent
  return !!p && (ts.isTemplateSpan(p) || ts.isParenthesizedExpression(p) || (ts.isConditionalExpression(p) && p.condition !== n && textual(p))
    || (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.PlusToken && textual(p)))
}
/** The words a text starts with, as ALLOWED names it: its first piece (of each branch, for a choice). */
function starts(n: ts.Node): string[] {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return [n.text]
  if (ts.isTemplateExpression(n)) return [n.head.text]
  if (ts.isParenthesizedExpression(n)) return starts(n.expression)
  if (ts.isConditionalExpression(n)) return [...starts(n.whenTrue), ...starts(n.whenFalse)]
  if (ts.isBinaryExpression(n)) return starts(n.left)
  return []
}

/** What a list of texts is joined with when the code says (`.join(', ')`); null when it does not. */
function separator(list: ts.ArrayLiteralExpression): string | null {
  const call = list.parent
  if (!ts.isPropertyAccessExpression(call) || call.name.text !== 'join' || !ts.isCallExpression(call.parent)) return null
  const arg = call.parent.arguments[0]
  return arg === undefined ? ',' : ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg) ? arg.text : null
}

/** Every break of a rule in the texts of a source: the text's line, its first words and the words around the break. */
function textHits(file: string, source: string): { line: number; starts: string[]; at: string }[] {
  const src = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const out: { line: number; starts: string[]; at: string }[] = []
  const visit = (n: ts.Node) => {
    if (textual(n) && !inner(n)) {
      const line = src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1
      const seen = new Set<string>()
      for (const r of renderings(n)) {
        for (const m of r.matchAll(new RegExp(RULE.source, 'g'))) {
          const at = r.slice(Math.max(0, m.index - 50), m.index + 30).replace(/\s+/g, ' ')
          if (!seen.has(at)) out.push({ line, starts: starts(n), at })
          seen.add(at)
        }
      }
    }
    // Two texts of a list, as they are joined (with a space or a line break when the code does not say): "a," then
    // "and b" is a comma before "and" too. Each text on its own is read above.
    if (ts.isArrayLiteralExpression(n)) {
      const sep = separator(n) ?? ' '
      n.elements.forEach((b, i) => {
        const a = n.elements[i - 1]
        if (!a || !textual(a) || !textual(b)) return
        const joint = renderings(a).flatMap(ra => renderings(b).map(rb => [ra, rb] as const)).find(([ra, rb]) => !RULE.test(ra) && !RULE.test(rb) && RULE.test(ra + sep + rb))
        if (joint) out.push({ line: src.getLineAndCharacterOfPosition(b.getStart(src)).line + 1, starts: starts(a), at: `${joint[0].slice(-50)}${sep}${joint[1].slice(0, 30)}`.replace(/\s+/g, ' ') })
      })
    }
    ts.forEachChild(n, visit)
  }
  visit(src)
  return out
}

test('TEXT-3 no text the code shows a person holds an em dash or a comma before "and" or "or"', () => {
  // The scan itself: a template's pieces and a `+` chain are read together, a joined list and a computed value are not
  // a comma before "and", comments and identifiers are not read; an em dash is found.
  const sample = [
    'const a = `one,${x ? \' and two\' : \'\'}`', // 1: across the pieces of a template
    "const b = 'three,' +", // 2: across a + chain
    "  ' or four'",
    'const c = `one of ${list.join(\', \')} or same`', // 4: a joined list, then "or": no comma before it
    '// five, and six', // 5: a comment
    'const and_or = `${n}, ${m} and more`', // 6: a value between the comma and "and"
    "const d = 'seven \\u2014 eight'", // 7: an em dash, written as an escape
    "const e = cond ? 'nine' : 'ten, or eleven'", // 8: one branch of a choice
    "const f = ['twelve,', 'and thirteen'].join('\\n')", // 9: two lines of a list
    "const g = ['fourteen', 'or fifteen'].join(', ')", // 10: a list joined with a comma
    "const h = ['sixteen', 'and seventeen'].join(' ')", // 11: no comma between them
  ].join('\n')
  assert.deepEqual(textHits('sample.ts', sample).map(h => h.line), [1, 2, 7, 8, 9, 10])

  const files = walk('src')
  assert.ok(files.length > 60 && ['src/service.ts', 'src/cli.ts', 'src/executor/rules.ts', 'src/web/server.ts', 'src/update/updater.ts', 'src/summary.ts'].every(f => files.includes(f)), `${files.length} source files`)
  const used = new Set<string>()
  const found: string[] = []
  for (const file of files) {
    for (const h of textHits(file, readFileSync(join(ROOT, file), 'utf8'))) {
      const entry = (ALLOWED[file] ?? []).find(e => h.starts.some(s => s.startsWith(e)))
      if (entry) used.add(`${file}: ${entry}`)
      else found.push(`${file}:${h.line}: ...${h.at}...`)
    }
  }
  assert.deepEqual(found, [], `an em dash or a comma before "and" or "or" in text a person reads:\n${found.join('\n')}`)
  const stale = Object.entries(ALLOWED).flatMap(([file, entries]) => entries.map(e => `${file}: ${e}`)).filter(e => !used.has(e))
  assert.deepEqual(stale, [], 'every allowed string still exists and still needs its place on the list')
})
