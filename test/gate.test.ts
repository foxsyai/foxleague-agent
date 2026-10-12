// FoxLeague's match gate per rarity (live on mainnet from 2026-10-12 16:30 UTC) and the removed starter stock route.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aRarity, gateLine, matchGate } from '../src/foxleague/gate.ts'
import { checkAction, type RulesContext } from '../src/executor/rules.ts'
import { playerLine } from '../src/snapshot/digest.ts'
import { MAINNET_GATE, TEST_SETTINGS, card, snapshot } from './fixtures.ts'
import type { AgentSnapshot } from '../src/snapshot/snapshot.ts'
import type { Action } from '../src/executor/actions.ts'

const ctx = (more: Partial<RulesContext> = {}): RulesContext => ({ settings: { ...TEST_SETTINGS }, now: new Date(), ...more })
const why = (v: ReturnType<typeof checkAction>) => (v.ok ? '' : (v as { refusal: string }).refusal)

test('the gate of each rarity comes from the config rows; without them, the single gate of before', () => {
  const cfg = snapshot().config!
  assert.deepEqual(matchGate(cfg, 'Common'), { gate: 5, floor: 5, pricePerMatch: 0, waiver: false })
  assert.deepEqual(matchGate(cfg, 'Uncommon'), { gate: 15, floor: 5, pricePerMatch: 20, waiver: true })
  assert.deepEqual(matchGate(cfg, 'Rare'), { gate: 45, floor: 15, pricePerMatch: 100, waiver: true })
  assert.deepEqual(matchGate(cfg, 'legendary'), { gate: 405, floor: 135, pricePerMatch: 100, waiver: true }, 'any case')
  const old = { ...cfg, rarity_match_gate: undefined }
  assert.deepEqual(matchGate(old, 'Rare'), { gate: 20, floor: 5, pricePerMatch: 20, waiver: true })
  assert.deepEqual(matchGate({ ...old, fusion_min_matches: 20, fusion_match_waiver_floor: 5, fusion_match_waiver_price_per_match: 0 }, 'Rare').waiver, false)
  assert.match(gateLine(cfg), /^Common 5 \(5 played, no waiver\); Uncommon 15 \(5 played, the rest waivable at 20 FOXSY a match\); Rare 45 \(15 played, the rest waivable at 100 FOXSY a match\)/)
  assert.deepEqual(['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'].map(aRarity), ['a Common', 'an Uncommon', 'a Rare', 'an Epic', 'a Legendary'])
  assert.equal(MAINNET_GATE.rarities.length, 5)
})

test('fusion: three Commons fuse at 5 played (the 20 of before is gone); a Rare triplet needs 45 with 15 played', () => {
  const commons = (played: number) => snapshot([101, 102, 103].map(n => card(n, 'MID', 'reserve', { competitiveMatches: played })))
  const fuse: Action = { type: 'fuse', player_nonces: [101, 102, 103], position_of: 0 }
  assert.equal(checkAction(fuse, commons(5), ctx()).ok, true, why(checkAction(fuse, commons(5), ctx())))
  assert.match(why(checkAction(fuse, commons(4), ctx())), /#101 has played 4 competitive matches; a Common must really play 5 of its 5/)
  const rares = (played: number, credit = 0) => snapshot([101, 102, 103].map(n => card(n, 'MID', 'reserve', { rarity: 'Rare', competitiveMatches: played, fusionMatchCredit: credit })))
  assert.match(why(checkAction(fuse, rares(30), ctx())), /#101 has 30 of the 45 competitive matches a Rare needs for fusion/)
  assert.equal(checkAction(fuse, rares(15, 30), ctx()).ok, true, 'credit counts above the floor')
  assert.match(why(checkAction(fuse, rares(14, 31), ctx())), /a Rare must really play 15 of its 45/)
})

test('listing: the gate of the card\'s rarity, with the count it has in the refusal', () => {
  const list = (s: AgentSnapshot, nonce: number) => why(checkAction({ type: 'list_card', nonce, reserve_foxsy: 30_000 }, s, ctx({ floorPrice: 500, canList: { can_list: true } })))
  const s = snapshot([card(60, 'FWD', 'reserve', { rarity: 'Rare', competitiveMatches: 40, fusionMatchCredit: 4 }), card(61, 'MID', 'reserve', { competitiveMatches: 5, syncedTotal: 1 })])
  assert.match(list(s, 60), /#60 needs 45 competitive matches, 15 of them played, to be listed \(a Rare\); it has 40 played \+ 4 waived/)
  assert.equal(list(s, 61), '', 'a Common at 5 played lists')
})

test('registration no longer needs the starter stock FoxLeague stopped publishing', () => {
  const s = snapshot()
  s.registration = { registered: false, teamName: null, feePaidOnChain: false, whitelisted: true, relayerEnabled: true, relaysRemaining: 10 }
  const v = checkAction({ type: 'register', team_name: 'Varna Rovers' } as never, s, ctx())
  assert.doesNotMatch(why(v), /stock/)
})

test('the plan request shows each card against its gate, at-gate when it can be fused or listed', () => {
  const cfg = snapshot().config!
  const line = playerLine(card(7, 'DEF', 'reserve', { rarity: 'Uncommon', competitiveMatches: 6, fusionMatchCredit: 9 }), matchGate(cfg, 'Uncommon'))
  assert.match(line, /comp 6\+9 credit of 15/)
  assert.match(line, /at-gate/)
  assert.doesNotMatch(playerLine(card(8, 'DEF', 'reserve', { rarity: 'Rare', competitiveMatches: 14, fusionMatchCredit: 31 }), matchGate(cfg, 'Rare')), /at-gate/, 'under the floor')
})
