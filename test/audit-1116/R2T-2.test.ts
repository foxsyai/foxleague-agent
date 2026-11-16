// R2T-2 (MID-1): the limits (24,000 characters a page, 60,000 in all) are counted on the text as FoxLeague serves it,
// before it is set in. Setting in adds four spaces to every line, and the count is in UTF-16 units, not bytes. So a
// page of short lines is written three times as long as the limit, and a page of three-byte characters three times as
// many bytes. The record promises "at most about 15,000 tokens (about $0.06 a plan)"; the AI spend has no cap of its
// own (service.ts: "no cap reads it"), and the text rides in every plan of every agent and every chat for the day.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PAGES_HEADING, PAGES_TEXT_MAX, changedPagesBlock } from '../../src/strategist/page-text.ts'
import { AT_0700, mcp, record, watch } from './watch-helpers.ts'

/** What the code itself adds: the heading and one "Page ... as FoxLeague serves it now" line a page (8 pages at most). */
const OWN_WORDS = PAGES_HEADING.length + 8 * 250

test('R2T-2 the changed pages are bounded as they are written into the request, not only as they were served (short lines)', async () => {
  // Three pages the copy knows, each 12,000 lines of one letter: 23,999 characters a page as served, inside every limit.
  const page = (letter: string) => Array.from({ length: 12_000 }, () => letter).join('\n')
  const pages: Record<string, string> = { 'mechanics/shop': page('a'), 'mechanics/matches': page('b'), 'mechanics/fusion': page('c') }
  const known = { ...record(), pages: Object.fromEntries(Object.keys(pages).map(slug => [slug, 'a'.repeat(64)])) }
  const w = watch(mcp(pages), { record: known })
  assert.equal((await w.today(AT_0700))?.state, 'behind')
  const kept = w.planPages()
  assert.ok(kept.reduce((n, p) => n + p.text.length, 0) <= PAGES_TEXT_MAX, 'as served, the texts are within the limit')
  const block = changedPagesBlock(kept)
  assert.ok(block.length <= PAGES_TEXT_MAX + OWN_WORDS, `the block written into every plan request is ${block.length.toLocaleString('en-US')} characters, the limit is ${PAGES_TEXT_MAX.toLocaleString('en-US')}`)
})

test('R2T-2 the changed pages are bounded in bytes too (three-byte characters)', () => {
  const pages = ['mechanics/shop', 'mechanics/matches', 'mechanics/fusion'].map(slug => ({ slug, text: '€'.repeat(20_000) }))
  const bytes = Buffer.byteLength(changedPagesBlock(pages))
  assert.ok(bytes <= PAGES_TEXT_MAX + OWN_WORDS, `the block is ${bytes.toLocaleString('en-US')} bytes for a limit of ${PAGES_TEXT_MAX.toLocaleString('en-US')} characters`)
})
