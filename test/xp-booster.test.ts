// The XP booster guard against FoxLeague's real shop status (whole-project review, 2026-10-13, C1 and A4).
//
// C1: GET /api/shop/status answers the booster flat, `xp_booster_active: bool` and `xp_booster_expires_at:
// string | null` (FoxLeague backend/src/routes/shop.rs:56-72, :794-816). The agent read a nested `xp_booster`
// object the server never sends, so the "booster already active" refusal never fired: live, 20 boosters were
// bought while one still ran (buying again restarts the 24 h, the hours left are lost), about 13,800 FOXSY.
// A4: an unreadable shop status, or an active booster whose expiry is not given, is unknown, never "no booster"
// (AGENTS.md rule 4): the purchase is refused.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkAction } from '../src/executor/rules.ts'
import { applyEffect } from '../src/executor/executor.ts'
import { renderDigest } from '../src/snapshot/digest.ts'
import type { PlannedAction } from '../src/executor/actions.ts'
import type { AgentSnapshot } from '../src/snapshot/snapshot.ts'
import { setup, snapshot, dryWallet, TEST_SETTINGS } from './fixtures.ts'

type Shop = NonNullable<NonNullable<AgentSnapshot['auth']>['shop']>

/** The shop status exactly as mainnet serialises it (ShopStatus in shop.rs). */
function liveShopStatus(active: boolean, expiresAt: string | null): Shop {
  return {
    xp_booster_active: active,
    xp_booster_expires_at: expiresAt,
    xp_booster_duration_hours: 24,
    xp_booster_multiplier_pct: 200,
    cooldown_waiver_floor_hours: 72,
    prices: { condition_recovery: 100, xp_booster: 2000, training_slot: 20 },
    training: { daily_free: 5, premium_cap: 10, used_today: 0, premium_used_today: 0, slots_banked: 0 },
    common_pack_price_foxsy: 2500,
    common_pack_per_wallet_per_week: 2,
    common_pack_bought_this_week: 0,
    common_pack_remaining_this_week: 2,
    common_pack_epoch_remaining: 500,
    common_pack_available: true,
  } as Shop
}

const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()
const act = (action: unknown): PlannedAction[] => [{ action: action as PlannedAction['action'], reason: '' }]
const BUY = { type: 'buy', product: 'xp_booster' } as const

function withShop(shop: Shop | null): AgentSnapshot {
  const s = snapshot()
  s.auth!.shop = shop
  return s
}

test('C1 buying an XP booster while FoxLeague reports one active (its real flat fields) is refused', () => {
  const expiresAt = inHours(20)
  const v = checkAction(BUY, withShop(liveShopStatus(true, expiresAt)), { settings: TEST_SETTINGS, now: new Date() })
  assert.equal(v.ok, false, `expected a refusal while the booster runs until ${expiresAt}, got ok=${v.ok} refusal=${String(v.refusal)}`)
  assert.match(v.refusal ?? '', /XP booster active until/)
})

test('C1 the executor refuses the second booster with 20 h left and allows a renewal with 1 h left', async () => {
  const m = setup()
  const [running] = await m.exec.run(m.agent(), dryWallet, withShop(liveShopStatus(true, inHours(20))), act(BUY))
  assert.equal(running!.status, 'refused', running!.summary)
  assert.match(running!.summary, /XP booster active until/)
  const [ending] = await m.exec.run(m.agent(), dryWallet, withShop(liveShopStatus(true, inHours(1))), act(BUY))
  assert.equal(ending!.status, 'dry_run', ending!.summary)
  const n = setup()
  const [none] = await n.exec.run(n.agent(), dryWallet, withShop(liveShopStatus(false, null)), act(BUY))
  assert.equal(none!.status, 'dry_run', none!.summary)
})

test('C1 the digest tells the model that a booster is active (from the real flat fields)', () => {
  const expiresAt = inHours(20)
  assert.match(renderDigest(withShop(liveShopStatus(true, expiresAt))), new RegExp(`XP booster active until ${expiresAt}`))
  assert.match(renderDigest(withShop(null)), /XP booster: status unknown/)
})

test('C1 a purchase marks the booster active in the flat fields FoxLeague uses', () => {
  const s = withShop(liveShopStatus(false, null))
  applyEffect(BUY, { ok: true, foxsy: 0n, category: 'play', facts: {}, notes: [] }, s, { egldValue: 0n })
  const shop = s.auth!.shop!
  assert.equal(shop.xp_booster_active, true)
  const left = Date.parse(String(shop.xp_booster_expires_at)) - Date.now()
  assert.ok(left > 23 * 3600_000 && left <= 24 * 3600_000, `expiry ${String(shop.xp_booster_expires_at)}`)
  assert.equal('xp_booster' in shop, false, 'the nested shape FoxLeague never sends is not written')
})

test('C1 a second booster in the same plan is refused', async () => {
  const m = setup()
  const rs = await m.exec.run(m.agent(), dryWallet, withShop(liveShopStatus(false, null)), [...act(BUY), ...act(BUY)])
  assert.equal(rs[0]!.status, 'dry_run', rs[0]!.summary)
  assert.equal(rs[1]!.status, 'refused', rs[1]!.summary)
  assert.match(rs[1]!.summary, /XP booster active until/)
})

test('A4 no XP booster while the shop status could not be read', async () => {
  const m = setup()
  const [r] = await m.exec.run(m.agent(), dryWallet, withShop(null), act(BUY))
  assert.equal(r!.status, 'refused', `shop status unreadable, yet: ${r!.summary}`)
  assert.match(r!.summary, /XP booster status unknown/)
})

test('A4 no XP booster while one is active and its expiry is unknown', async () => {
  const m = setup()
  for (const expiry of [null, 'not a date']) {
    const [r] = await m.exec.run(m.agent(), dryWallet, withShop(liveShopStatus(true, expiry)), act(BUY))
    assert.equal(r!.status, 'refused', `active booster, expiry ${String(expiry)}, yet: ${r!.summary}`)
    assert.match(r!.summary, /expiry unknown/)
  }
})

test('A4 no XP booster when the shop status does not say whether one runs', async () => {
  const m = setup()
  const shop = liveShopStatus(false, null) as Record<string, unknown>
  delete shop.xp_booster_active
  const [r] = await m.exec.run(m.agent(), dryWallet, withShop(shop as Shop), act(BUY))
  assert.equal(r!.status, 'refused', `booster state missing, yet: ${r!.summary}`)
  assert.match(r!.summary, /XP booster status unknown/)
})
