// SYNC-3: FoxLeague's manual and API description of 21 Nov 2026 (main 237984579, promoted to mainnet at 17:36 UTC by
// #806). The running agent alerted at 20:50 UTC that two routes it calls changed shape (the statistics of a ranked or
// casual match and of a tournament match) and that nine pages of the manual changed. The routes gained one field,
// `injuries` (every player a match injured, #801); the agent reads only the formations and elevens there. The pages
// add what SYNC-2 already acts on (a card in an auction takes no Shop item and trains none, #752), the bans of #764 in
// the tournaments' refunds and screens of the app.
//
// The training page now says it in words: "A player that is in an auction cannot be trained." The executor refused a
// card the roster gave as listed, but four checks read a card whose auction state the roster did not give as "in the
// wallet": training, the squad a paid match or entry is played with, a saved eleven and a fusion's three cards.
// FoxLeague's API description requires `listed_for_sale` on every card, so this does not happen today; unknown is still
// never "not listed" (AGENTS.md rule 4), as for the Shop items since SYNC-2.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkAction, type RulesContext } from '../../src/executor/rules.ts'
import { API_RECORD_FILE } from '../../src/foxleague/api-routes.ts'
import { MANUAL_FILE, RECORD_FILE } from '../../src/strategist/manual-watch.ts'
import type { AgentSnapshot } from '../../src/snapshot/snapshot.ts'
import { TEST_SETTINGS, card, snapshot } from '../fixtures.ts'
import { fuse, spares } from '../foxleague-1113/mint-fixture.ts'

const ctx = (more: Partial<RulesContext> = {}): RulesContext => ({ settings: { ...TEST_SETTINGS }, now: new Date(), ...more })
const UNREAD = (n: number) => new RegExp(`whether #${n} is in an auction \\(listed for sale\\) could not be read: not acting blind`)

/** The snapshot with card `n`'s auction state left out, as a roster without listed_for_sale would give it. */
function unread(s: AgentSnapshot, n: number): AgentSnapshot {
  const p = s.players.find(x => x.nonce === n)!
  delete (p as { listed?: boolean }).listed
  return s
}

test('SYNC3-1 a card whose auction state could not be read is not trained, played, saved in an eleven or fused', () => {
  // Training: the fixture's starter #1.
  const train = { type: 'train' as const, player_nonce: 1, attribute: 'speed' as const }
  assert.equal(checkAction(train, snapshot(), ctx()).ok, true, checkAction(train, snapshot(), ctx()).refusal)
  assert.match(checkAction(train, unread(snapshot(), 1), ctx()).refusal ?? '', UNREAD(1))
  // A listed card keeps its refusal.
  const listed = snapshot()
  listed.players.find(p => p.nonce === 1)!.listed = true
  assert.match(checkAction(train, listed, ctx()).refusal ?? '', /#1 is listed for sale/)

  // The squad a match is played with: a ranked match with #1 among the saved 18.
  const ranked = { type: 'play_match' as const, match_type: 'ranked' as const }
  assert.equal(checkAction(ranked, snapshot(), ctx()).ok, true, checkAction(ranked, snapshot(), ctx()).refusal)
  assert.match(checkAction(ranked, unread(snapshot(), 1), ctx()).refusal ?? '', UNREAD(1))

  // A saved eleven: the fixture's own eleven and bench again.
  const base = snapshot()
  const save = { type: 'set_lineup' as const, lineup: [...base.team!.lineup], substitutes: [...base.team!.substitutes] }
  assert.equal(checkAction(save, base, ctx()).ok, true, checkAction(save, base, ctx()).refusal)
  assert.match(checkAction(save, unread(snapshot(), 1), ctx()).refusal ?? '', UNREAD(1))

  // A fusion's three cards (the fusion that mints its result).
  const f = checkAction(fuse, unread(spares(), 102), ctx())
  assert.equal(f.ok, false)
  assert.match(f.refusal!, UNREAD(102))
  // ...and the cards it leaves: 21 in the wallet, two of them unread, are 19 known, 17 after the fusion.
  assert.doesNotMatch(checkAction(fuse, spares(), ctx()).refusal ?? '', /would leave/, 'the fixture fuses past the count')
  assert.match(checkAction(fuse, unread(unread(spares(), 1), 2), ctx()).refusal ?? '', /fusion would leave 17 cards; a match needs 18/)

  // A sync pays for every dirty card it names: an unread one is not synced blind.
  const dirty = () => {
    const s = snapshot()
    s.players.find(p => p.nonce === 1)!.dirty = true
    return s
  }
  assert.equal(checkAction({ type: 'sync', nonce: 1 }, dirty(), ctx()).ok, true)
  assert.match(checkAction({ type: 'sync', nonce: 1 }, unread(dirty(), 1), ctx()).refusal ?? '', /#1 has nothing to sync/)

  // A listing: the card itself unread is refused before the market is asked.
  const spare = () => {
    const s = snapshot([card(201, 'MID', 'reserve', { competitiveMatches: 300 })])
    ;(s.config as Record<string, unknown>).auction_enabled = true
    return s
  }
  const list = { type: 'list_card' as const, nonce: 201, reserve_foxsy: 5000 }
  const market = ctx({ floorPrice: 0, canList: { can_list: false, reason: 'not listable' } as RulesContext['canList'] })
  assert.match(checkAction(list, spare(), market).refusal ?? '', /FoxLeague says not now/, 'the fixture reaches the market check')
  assert.match(checkAction(list, unread(spare(), 201), market).refusal ?? '', UNREAD(201))
})

test('SYNC3-2 the agents\' manual and the route record are FoxLeague\'s main of 21 Nov (237984579)', () => {
  const manual = readFileSync(MANUAL_FILE, 'utf8')
  assert.match(manual.split('\n', 3).join('\n'), / main at 237984579 2026-11-21\./)
  assert.match(manual, /A player that is in an auction cannot be trained/)
  assert.match(manual, /An \*\*Injuries\*\* list under the goals names every injured player of both teams/)
  // The busy-card rule of #748 is still there and still off (SYNC-2).
  assert.match(manual, /From a date still to be announced a player plays one match at a time/)
  const record = JSON.parse(readFileSync(RECORD_FILE, 'utf8')) as { synced: string; pages: Record<string, string> }
  assert.equal(record.synced, '237984579 2026-11-21')
  assert.equal(record.pages['legal/account-bans'], undefined, 'the bans page stays left out (SYNC-2)')
  const shapes = JSON.parse(readFileSync(API_RECORD_FILE, 'utf8')) as { synced: string; routes: Record<string, string | null> }
  assert.equal(shapes.synced, '237984579 2026-11-21')
  assert.equal(Object.keys(shapes.routes).length, 54)
  // The two statistics routes as FoxLeague describes them since #801 (the injuries list added).
  assert.equal(shapes.routes['GET /api/matches/{id}/stats'], '560a5f8e8ce4774973fd21bc455be6cba6b50175b949bdf13cae1ba5142560d4')
  assert.equal(shapes.routes['GET /api/public/tournament-match/{id}/stats'], 'ba56f4d3541a772014b573ea3a76f4cddd7d9310666708c825f352b2b0c2908f')
})
