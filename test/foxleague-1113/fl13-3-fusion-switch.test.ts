// FoxLeague mainnet of 13 Nov 2026, FL13-3: the old fusion and FoxLeague's fusion switch.
// The players contract on mainnet carries fusionMint since 2026-11-13 21:32:50 UTC, and /api/config serves its switch:
// `fusion_mint: { live, live_from, paused }` (next-foxleague origin/main backend/src/routes/config.rs FusionMintConfig;
// live_from "2026-11-20T14:00:00Z" on mainnet, read 2026-11-15). From live_from the contract refuses the old `fusion`
// (contracts/foxleague-players/src/player_nft.rs: the old fusion and loadFusionPool refuse from fusionMintLiveFrom), and
// `paused` says the contract speaks another fusion version than FoxLeague's server, when no fusion can run at all
// (backend/src/fusion_mint.rs ProbeState::version_mismatch; the manual: "Fusion is being updated. No fusion can be made
// right now."). The agent read none of it: it signed the old fusion whatever the switch said, so a pre-check read just
// before the switch could send a fusion the contract reverts after it (the gas lost), and a paused fusion or a config
// without the switch was no reason to stop. Unknown is not "the old fusion" (AGENTS.md rule 4).
import test from 'node:test'
import assert from 'node:assert/strict'
import { checkAction, type RulesContext } from '../../src/executor/rules.ts'
import type { Action } from '../../src/executor/actions.ts'
import type { AgentSnapshot } from '../../src/snapshot/snapshot.ts'
import { TEST_SETTINGS, card, snapshot } from '../fixtures.ts'

const fuse: Action = { type: 'fuse', player_nonces: [101, 102, 103], position_of: 0 }
const ctx = (more: Partial<RulesContext> = {}): RulesContext => ({ settings: { ...TEST_SETTINGS }, now: new Date(), canFuse: { can_fuse: true }, fusionPool: 4, ...more })
const why = (v: ReturnType<typeof checkAction>) => (v.ok ? '' : (v as { refusal: string }).refusal)

function spares(fusionMint: unknown): AgentSnapshot {
  const s = snapshot([101, 102, 103].map(n => card(n, 'MID', 'reserve')))
  ;(s.config as Record<string, unknown>).fusion_mint = fusionMint
  return s
}
const at = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString()

test('FL13-3 (control): before a switch that is far away, or none set, the old fusion runs as before', () => {
  for (const f of [{ live: false, live_from: null, paused: false }, { live: false, live_from: at(5 * 24 * 60), paused: false }]) {
    const v = checkAction(fuse, spares(f), ctx())
    assert.equal(v.ok, true, `${JSON.stringify(f)}: ${why(v)}`)
  }
})

test('FL13-3: without FoxLeague\'s fusion switch in its settings the fusion is refused (unknown is not the old fusion)', () => {
  for (const f of [undefined, null, {}, { live: 'no', live_from: null, paused: false }, { live: false, live_from: 'soon', paused: false }, { live: false, live_from: null }]) {
    assert.match(why(checkAction(fuse, spares(f), ctx())), /could not be read/, JSON.stringify(f))
  }
})

test('FL13-3: while FoxLeague says fusion is being updated (paused) no fusion is signed', () => {
  assert.match(why(checkAction(fuse, spares({ live: false, live_from: null, paused: true }), ctx())), /being updated/)
})

test('FL13-3: in the last 10 minutes before the switch the old fusion is refused (it could reach the chain after it)', () => {
  for (const minutes of [9, 1]) {
    assert.match(why(checkAction(fuse, spares({ live: false, live_from: at(minutes), paused: false }), ctx())), /changes at .*: no fusion in the last 10 minutes before it/, `${minutes} min`)
  }
})

test('FL13-3: from the switch the old fusion is never signed, even with a config read before it that said not live', () => {
  // A plan's actions run over most of an hour after the snapshot's config read: the moment the switch names counts.
  const v = checkAction(fuse, spares({ live: false, live_from: at(-1), paused: false }), ctx())
  assert.equal(v.ok, false)
  assert.doesNotMatch(why(v), /^$/)
  assert.equal((v as { facts: Record<string, unknown> }).facts.positionChoice, undefined, 'no old fusion is built')
})
