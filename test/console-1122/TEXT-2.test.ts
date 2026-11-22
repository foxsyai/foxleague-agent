// TEXT-2: the owner, 2026-11-22, before the public release. The two text rules TEXT-1 holds the dashboard's info
// bubbles and guide to (no em dash, no comma right before "and" or "or") hold for everything else a user reads too: the
// README, INSTALL.md, every page of the site, the visible text of the dashboard and the login page and what the
// installers and cli.sh print. About 180 sentences, almost all two clauses joined by ", and", were written again.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { markdownText, pageText, read, ruleHits, scriptText, userFiles } from './text-rules.ts'

test('TEXT-2 nothing a user reads holds a comma before and or or', () => {
  // The scan itself: it finds the rule across a line break and a tag and skips code, comments and the quoted rule.
  assert.deepEqual(ruleHits(markdownText('One, and two.\nA `x, or y` b\n```\nc, and d\n```\nThree,\nor four.\n<!-- e, and f -->\nRun, `a` and `b`.')).map(h => h.line), [1, 6])
  assert.deepEqual(ruleHits(pageText('<b>a,</b> and b\n// c, and d\nx = 1 /* e, or f */\nt(\'g — h\')')).map(h => h.line), [1, 4])
  assert.deepEqual(ruleHits(scriptText('# a, and b\n  echo "c, or d"\n<# e, and f #>')).map(h => h.line), [2])
  assert.deepEqual(ruleHits(markdownText('Telegram requires the username to end in "bot", or else.')).length, 1, 'only the quotation is blanked')

  const files = userFiles()
  assert.ok(files.length >= 28 && files.some(f => f.file.endsWith('index.mdx')), 'every file a user reads is scanned')
  const found = files.flatMap(({ file, text }) => ruleHits(text(read(file))).map(h => `${file}:${h.line}: ${h.text}`))
  assert.deepEqual(found, [])
})
