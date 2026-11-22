// NUM-1 to NUM-4: the owner, 2026-11-22, before the public release. Every number a user reads checked against the code,
// FoxLeague's live settings and its manual: one derivation was wrong (NUM-1) and one count went stale (NUM-2). And, by
// the owner's standing rule, what a user reads gives general rules with examples: a market price of one day goes stale
// (NUM-3, NUM-4), so the pages say where the live value shows instead.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SETTINGS as D } from '../../src/store/settings.ts'
import { read, scriptText, userFiles } from './text-rules.ts'

const flat = (f: string) => read(f).replace(/\s+/g, ' ')
const LEVELS = 'site/src/content/docs/play/strategy-levels.md'
const n = (v: number) => v.toLocaleString('en-US')

test('NUM-1 the strategy levels page counts the limits per rarity from the Common the rule starts at (525), so its numbers follow', () => {
  // The page said "three times the one below plus 5 percent: 500 FOXSY for a Common ..., 1,650 for an Uncommon": three
  // times 500 plus 5 percent is 1,575. The code counts from a Common at 525 (a pack card's 500 plus 5 percent).
  const page = flat(LEVELS)
  assert.doesNotMatch(page, /plus 5 percent: 500 FOXSY for a Common/)
  const m = /each limit is three times the one below plus 5 percent, counted from a Common at ([\d,]+) \(a pack card's 500 plus 5 percent\) and rounded: ([\d,]+) for an Uncommon, ([\d,]+) for a Rare, ([\d,]+) for an Epic and ([\d,]+) for a Legendary\./.exec(page)
  assert.ok(m, 'the page names the Common the rule counts from')
  const [start, ...limits] = m.slice(1).map(x => Number(x.replace(/,/g, '')))
  assert.equal(start, D.maxBidCommonFoxsy * 1.05)
  assert.deepEqual(limits, [D.maxBidUncommonFoxsy, D.maxBidRareFoxsy, D.maxBidEpicFoxsy, D.maxBidLegendaryFoxsy])
  let chain = start!
  for (const limit of limits) {
    chain *= 3 * 1.05
    assert.ok(Math.abs(limit - chain) / chain < 0.01, `${n(limit)} is three times the one below plus 5 percent (${Math.round(chain)}), rounded`)
  }
  assert.match(page, new RegExp(`The limit for a Common itself is ${n(D.maxBidCommonFoxsy)} FOXSY \\(a pack card's price, so never more than the shop charges\\)`))
})

test('NUM-2 the README and the Safety page do not call the last review before the launch an audit of six reviewers', () => {
  // The audit of six reviewers (11 Nov) was followed by one of seven (16 Nov), its second round and a final pass.
  const record = read('docs/SECURITY-REVIEW.md')
  assert.match(record, /Six reviewers \(MONEY, ATTACK, EDGE, INTEG, INSTALL, DOCS\)/)
  assert.match(record, /\n## Audit of 16 Nov 2026: seven reviewers, five fixers/)
  assert.match(record, /\n## Final pass before the public release/)
  for (const f of ['README.md', 'site/src/content/docs/play/safety.md']) {
    const text = flat(f)
    assert.doesNotMatch(text, /six reviewers/, f)
    assert.match(text, /audits by teams of reviewers \(one area each\) and a final pass before the public launch/, f)
  }
})

test('NUM-3 nothing a user reads says how much EGLD buys the registration, a market price; the pages say where the live prices show', () => {
  for (const { file, text } of userFiles()) {
    assert.doesNotMatch(text(read(file)).replace(/\s+/g, ' '), /\d(\.\d+)? (EGLD )?buys the 5,000 FOXSY registration/, file)
  }
  assert.match(scriptText(read('install.sh')), /\n {5}part of it buys the 5,000 FOXSY registration, 1 stays as the gas reserve, the rest pays the first games\.\n/)
  assert.match(flat('site/src/content/docs/help/costs.md'), /About \*\*5 EGLD\*\*: part of it buys the 5,000 FOXSY registration \(the dashboard shows the live EGLD and FOXSY prices at the top\), 1 stays in the wallet as the gas reserve/)
})

test('NUM-4 the strategy levels page sizes the dollar limits without a FOXSY price of one day and says where the live price shows', () => {
  const page = flat(LEVELS)
  assert.doesNotMatch(page, /\$0\.00\d+|about \$13\.50|about \$54/)
  assert.match(page, /The dollar values have to hold the FOXSY amounts beside them at the price of the day, which the FOXSY total at the top of the dashboard shows; when that price moves a lot, adjust them:/)
  assert.match(page, /the daily cap covers the largest entry the level allows \(a climber's Gold entry of 5,000 FOXSY, a beast's of 20,000\)/)
})
