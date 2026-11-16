// BEH-5: the scheduler drops a match the plan's window has room for. Each action gets a random moment of the window
// (service.ts scheduleActions); a second match must wait for its gate after the first (16 minutes after a ranked
// start, 13 after any match), and when the first one's draw falls late the second is pushed past the window and
// dropped ("the next plan can play it"), though both fit when the first runs earlier. An action with a deadline is
// already moved earlier for what comes after it; a match before another match is not.
// Production, 9 to 16 Nov: 37 matches dropped in 31 plans (27 ranked, 10 casual), 16 of those plans held only two
// ranked games; the live agents' window is 48 minutes (0.8 of a 60-minute tick), room for three ranked starts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scheduleActions } from '../../src/service.ts'
import { parseAction, type PlannedAction } from '../../src/executor/actions.ts'

const act = (raw: unknown): PlannedAction => ({ action: parseAction(raw), reason: '' })
const MIN = 60_000

test('BEH-5: two ranked games of one plan are both kept when the 48-minute window has room for both', () => {
  // The plan of agent 3 on 9 Nov 14:03 UTC, in short: free training first, then two ranked games.
  const plan = [
    act({ type: 'train', player_nonce: 1, attribute: 'speed' }),
    act({ type: 'train', player_nonce: 2, attribute: 'speed' }),
    act({ type: 'play_match', match_type: 'ranked' }),
    act({ type: 'play_match', match_type: 'ranked' }),
  ]
  // Draws any run can give: the four moments at 10, 30, 36 and 40 minutes of the 48 (sorted, so in the plan's order).
  const draws = [10 / 48, 30 / 48, 36 / 48, 40 / 48]
  let n = 0
  const r = scheduleActions(plan, { windowMs: 48 * MIN, gapMs: 30_000, random: () => draws[n++]!, lastMatchMs: null, lastRankedMs: null })
  // Room for both: the first ranked game at minute 30 or before leaves the second its 16 minutes inside the window.
  assert.deepEqual(r.dropped.map(d => d.reason), [], 'no match is dropped while the window has room for it')
  const ranked = r.kept.filter(k => k.p.action.type === 'play_match').map(k => k.offset)
  assert.equal(ranked.length, 2)
  assert.ok(ranked[1]! - ranked[0]! >= 15.5 * MIN, 'the ranked cooldown still holds between them')
  assert.ok(ranked[1]! <= 48 * MIN, 'and both start inside the window')
})
