// Audit 2 of PR #51 (money paths), R52A-M1. OPEN-2 area: saveEleven / putBack.
// The put-back after a casual test is judged by a read-back that compares the formation and the eleven only
// (src/executor/executor.ts:600-601). A test that keeps the team's formation and eleven and changes the bench only
// (the agent may propose any test; the executor itself saves it when any of the three differs, line 935) leaves the
// read-back unable to tell "put back" from "not put back": after a lost answer on the put-back that FoxLeague did not
// apply, the team on FoxLeague still carries the TEST bench, putBack() returns null and the owner hears "4-4-2 put
// back". The next match that counts (a tournament, a 1v1 with a stake) plays with the test's bench.
// Expected: the read-back compares the substitutes too, so the put-back is retried and, failing that, the result says
// the test bench may still be saved (status error, "could not be put back").

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setup, snapshot, card, liveWallet, withLive } from '../fixtures.ts'

const XI = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const OWN_BENCH = [12, 13, 14, 15, 16, 17, 18]
const TEST_BENCH = [12, 13, 14, 15, 16, 17, 19] // #19 on the bench instead of #18

test('R52A-M1: a put-back whose answer is lost and that FoxLeague did not apply is declared "put back" when only the bench differs', async () => {
  const saves: { formation?: string; substitutes: number[] }[] = []
  // What FoxLeague holds.
  let onServer = { formation: '4-4-2', lineup: XI, substitutes: OWN_BENCH }
  const m = setup({
    fox: {
      setLineup: async (_w: unknown, lineup: number[], substitutes: number[], formation?: string) => {
        saves.push({ formation, substitutes })
        // The put-back's answer is lost on the way and FoxLeague never applied it (a 502 at the edge).
        if (substitutes.join(',') === OWN_BENCH.join(',')) throw new Error('fetch failed: socket hang up')
        onServer = { formation: formation ?? onServer.formation, lineup, substitutes }
        return { id: 1, user_id: 100, name: 'Agent', ...onServer, team_overall: 20, badge: null }
      },
      team: async () => ({ id: 1, user_id: 100, name: 'Agent', hidden: false, ...onServer, team_overall: 20, badge: null }),
      playMatch: async () => ({ match_id: 77 }),
    },
  })
  const s = snapshot([card(19, 'FWD', 'reserve')])
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, s, [{ action: { type: 'play_match', match_type: 'casual', test: { formation: '4-4-2', lineup: XI, substitutes: TEST_BENCH } }, reason: '' }])
    assert.equal(saves[0]!.substitutes.join(','), TEST_BENCH.join(','), 'the test bench was saved before the start')
    assert.equal(onServer.substitutes.join(','), TEST_BENCH.join(','), 'FoxLeague still holds the test bench: the put-back never applied')
    // Before the fix the put-back was asked once: its read-back (formation and eleven, both unchanged by this test)
    // passed at the first try. With the bench compared too it is asked again, as for any put-back not read back.
    assert.equal(saves.filter(x => x.substitutes.join(',') === OWN_BENCH.join(',')).length, 2, 'the put-back is tried twice when the bench read back is not the team\'s own')
    // The defect: the read-back saw the same formation and eleven and called it put back.
    assert.notEqual(r!.status, 'confirmed', `the team's own bench is not back on FoxLeague, so the result must not claim it is; got ${r!.status}: ${r!.summary}`)
    assert.match(r!.summary, /could not be put back|may still be saved/)
  })
})

test('R52A-M1 control: a short test bench that FoxLeague completed reads back as saved when every named card is on it', async () => {
  let onServer = { formation: '4-4-2', lineup: XI, substitutes: OWN_BENCH }
  let lost = true
  const m = setup({
    fox: {
      setLineup: async (_w: unknown, lineup: number[], substitutes: number[], formation?: string) => {
        // The test save lands with the bench completed by the server (FOXLEAGUE-INTEGRATION: fewer than 7 substitutes),
        // and its answer is lost; the put-back answers normally.
        onServer = { formation: formation ?? onServer.formation, lineup, substitutes: substitutes.length < 7 ? [...substitutes, 18, 17] : substitutes }
        if (lost) {
          lost = false
          throw new Error('fetch failed: socket hang up')
        }
        return { id: 1, user_id: 100, name: 'Agent', ...onServer, team_overall: 20, badge: null }
      },
      team: async () => ({ id: 1, user_id: 100, name: 'Agent', hidden: false, ...onServer, team_overall: 20, badge: null }),
      playMatch: async () => ({ match_id: 78 }),
    },
  })
  const s = snapshot([card(19, 'FWD', 'reserve')])
  await withLive(m.store, async () => {
    const [r] = await m.exec.run(m.agent(), liveWallet, s, [{ action: { type: 'play_match', match_type: 'casual', test: { formation: '4-4-2', lineup: XI, substitutes: [19, 12, 13, 14, 15] } }, reason: '' }])
    assert.equal(r!.status, 'confirmed', r!.summary)
    assert.match(r!.summary, /match #78 started \(casual\); 4-4-2 put back/)
    assert.equal(onServer.substitutes.join(','), OWN_BENCH.join(','))
  })
})
