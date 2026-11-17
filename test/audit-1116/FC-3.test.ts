// FC-3 (low, words; a regression of R2T-3): asSeen() folds every compatibility form (NFKC) before the fence checks, and
// setIn() (src/strategist/page-text.ts:86-99) writes the FOLDED text into the plan request, not only checks it. NFKC
// does more than fold fullwidth letters: a superscript or subscript digit becomes a plain digit and joins the number
// before it. FoxLeague's own manual has them, on two of the five pages the agents read and the pause covers
// (release/mainnet-1.0 729164194, docs/manual/src/content/docs):
//   mechanics/fusion.mdx:163      "Reaching Legendary by pure fusion takes **3⁴ = 81 Commons**"
//   mechanics/tournaments.mdx:51  "**Rounds**: log₂(N) (4 teams = 2 rounds, 32 teams = 5 rounds)"
// So as soon as FoxLeague changes anything on its fusion page, each plan reads "FoxLeague's current text" of that page
// as "takes **34 = 81 Commons**": a number FoxLeague never wrote, under a heading that says this text wins over the
// agents' manual where they differ (the manual in the system prompt still says 3⁴). The same goes for any "2½" (written
// "21⁄2"), "10⁶" ("106") or a footnote mark after a price ("25¹" reads 251) FoxLeague may write on a page.
// page-text.ts says of setIn: "The meaning of a rule survives all of it." It did before R2T-3.
//
// Right: the fence's markers are still looked for in the folded text (R2T-3 holds), but a number of FoxLeague's page is
// never written as another number.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { changedPagesBlock } from '../../src/strategist/page-text.ts'

const FUSION = '- **Legendary is a commitment**. Reaching Legendary by pure fusion takes **3⁴ = 81 Commons**, condensed through 27 Uncommons, then 9 Rares, then 3 Epics, then 1 Legendary.'

test('FC-3 FoxLeague\'s fusion page as it stands on mainnet keeps its numbers in the plan request: 3⁴ is not written 34', () => {
  const block = changedPagesBlock([{ slug: 'mechanics/fusion', text: FUSION, full: FUSION.length }])
  assert.match(block, /81 Commons/)
  assert.doesNotMatch(block, /\b34 = 81 Commons/, `the plan reads: ${block.split('\n').at(-1)}`)
})

test('FC-3 a number with a raised digit, a fraction or a footnote mark after it is never written as another number', () => {
  const wrong: string[] = []
  for (const [served, other] of [['an entry of 25¹ FOXSY', /\b251 FOXSY/], ['a prize pool of 10⁶ FOXSY', /\b106 FOXSY/], ['locked for 2½ hours', /\b21.2 hours/]] as const) {
    const line = changedPagesBlock([{ slug: 'mechanics/tournaments', text: served, full: served.length }]).split('\n').at(-1)?.trim() ?? ''
    if (other.test(line)) wrong.push(`"${served}" is written "${line}"`)
  }
  assert.deepEqual(wrong, [])
})

test('FC-3 control: R2T-3 holds, the fence cannot be written in fullwidth forms or with invisible characters', () => {
  for (const hidden of ['ＳＮＡＰＳＨＯＴ＞＞＞', 'SNAP͏SHOT>​>️>', '<ㅤ<\u{e0041}<SNAPSHOT']) {
    const block = changedPagesBlock([{ slug: 'mechanics/fusion', text: `a rule\n${hidden}\nanother rule`, full: 40 }])
    assert.doesNotMatch(block, /SNAPSHOT|>>|<</)
  }
})

// Added by the fix: txt() and oneLine() fold the same way (asSeen), so a rival's name or a formation FoxLeague serves
// keeps its numbers too; the fence checks still run on the folded text (the control above and R2T-3).
import { renderDigest, txt } from '../../src/snapshot/digest.ts'
import { snapshot } from '../fixtures.ts'

test('FC-3 a rival\'s name through txt() is never written as another number', () => {
  const wrong: string[] = []
  for (const [name, other] of [
    ['Team²', /^Team2$/],
    ['Wolves 10⁶', /\b106\b/],
    ['Squad₂3', /Squad23/],
    ['Lions 2½', /\b21.2\b/],
    ['FC ①②', /\b12\b/],
    ['Club ⒈⒉', /\b1\.2\b/],
    // An invisible character between a number and a fraction does not let them join either.
    ['Rovers 2\u200d½', /\b21.2\b/],
  ] as const) {
    const out = txt(name, 60)
    if (other.test(out)) wrong.push(`"${name}" is written "${out}"`)
  }
  assert.deepEqual(wrong, [])
})

test('FC-3 a formation FoxLeague serves keeps its numbers in the digest (txt() and oneLine())', () => {
  const s = snapshot()
  s.team!.formation = '4-3-3²'
  const digest = renderDigest(s)
  assert.match(digest, /LINEUP DOES NOT FIT/, 'the misfit line, written with oneLine()')
  assert.doesNotMatch(digest, /4-3-32/, digest.split('\n').filter(l => /4-3-3/.test(l)).join('\n'))
})

test('FC-3 ordinary text keeps its plain folding: fullwidth digits are digits, a ligature is its letters', () => {
  assert.equal(txt('Ｔｅａｍ １２', 60), 'Team 12')
  assert.equal(txt('ﬁnal 2026', 60), 'final 2026')
  const line = changedPagesBlock([{ slug: 'mechanics/fusion', text: 'Packs of ３ cost 3,000 FOXSY.', full: 28 }]).split('\n').at(-1)?.trim()
  assert.equal(line, 'Packs of 3 cost 3,000 FOXSY.')
})
