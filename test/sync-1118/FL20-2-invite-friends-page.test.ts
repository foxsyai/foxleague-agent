// FL20-2 (FoxLeague mainnet a546f7279): FoxLeague's manual has a new page, mechanics/invite-friends (the referral
// programme). Under the mechanics folder it would go into the agents' manual whole, about 3k tokens of rules for a
// programme the agents take no part in (FL20-1), and every edit FoxLeague makes to it would make the copy "behind" and
// ask for a sync. It is left out on purpose, with its reason; the snapshot's Referral line gives the programme in short.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LEFT_OUT, undecidedPages } from '../../src/strategist/manual.ts'
import { MANUAL_FILE, RECORD_FILE } from '../../src/strategist/manual-watch.ts'

test('FL20-2 the Invite Friends page is left out of the agents\' manual on purpose, with its reason', () => {
  assert.match(LEFT_OUT['mechanics/invite-friends.mdx'] ?? '', /referral programme.*take no part/)
  assert.deepEqual(undecidedPages(['mechanics/invite-friends.mdx']), [])
})

test('FL20-2 the synced manual and its page record hold no Invite Friends page', () => {
  assert.doesNotMatch(readFileSync(MANUAL_FILE, 'utf8'), /^# Invite Friends$/m)
  const record = JSON.parse(readFileSync(RECORD_FILE, 'utf8')) as { pages: Record<string, string> }
  assert.equal(record.pages['mechanics/invite-friends'], undefined)
})
