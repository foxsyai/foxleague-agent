# FoxLeague economy and rules (mainnet)

Every cost, reward, cap, cooldown and rule a team manager has to plan around, each with where the
number comes from and where a client can read the live value.

- **Snapshot:** `origin/release/mainnet-1.0` at `0800dce5` (rc.31, 2026-09-28). Paths are relative to
  the FoxLeague monorepo (`SOURCES.md`). **Updated for the 12 October 2026 switch** (`origin/main` at
  `4521c811`; players contract upgrade `86f38740`, gates live from 2026-10-12 16:30 UTC): the match gate
  per rarity, the per-rarity match waiver, the partial cooldown waiver, the transfer lock of a card moved
  under its gate, ranked pairs once per 24 hours, the removed `GET /api/register/pool-status`.
- **Deployed values can differ from code defaults.** The deploy seeds many registry keys over the code
  defaults and an admin can change any key at runtime. Section 15 lists every value where the code
  default and the mainnet value disagree. When a public endpoint serves a value, read it there.
- All FOXSY amounts are whole FOXSY unless marked atomic (x 10^18). Durations are wall-clock.
- **Daily allowances reset at a fixed 14:00 UTC**, not on a rolling 24 h window
  (`daily.reset_hour_utc` = 14; `backend/src/config_registry.rs:1130-1131`; `deploy/mainnet/seed.sh:79`;
  manual `mechanics/economy-map.mdx:11`).

**Source abbreviations used in the tables**

| Abbreviation | Path |
|---|---|
| EM | `docs/manual/src/content/docs/mechanics/economy-map.mdx` (the manual's one-page table; each of its rows carries a source comment) |
| Manual | `docs/manual/src/content/docs/` |
| CR | `backend/src/config_registry.rs` (runtime key and its code default) |
| SEED | `deploy/mainnet/seed.sh` (keys written on the mainnet box) |
| CC | `deploy/mainnet/chain-config.mainnet.env` (contract setter values at deploy) |
| PNFT | `contracts/foxleague-players/src/player_nft.rs` |
| TM | `contracts/foxleague-tournaments/src/tournament_manager.rs` |
| CFG | `GET https://foxleague.ai/api/config` (public, raw JSON) field |
| VIEW | a contract view read with `POST https://gateway.multiversx.com/vm-values/query` |

Source priority used by the manual itself (EM:13): SEED > CC > CR defaults > contract defaults.

---

## 1. Tokens and identifiers

| Item | Value | Source |
|---|---|---|
| FOXSY token | `FOXSY-5d5f3e`, **18 decimals** | `deploy/mainnet/chain.env:8`; PNFT:130 `ONE_FOXSY = 10^18`; `backend/src/chain_config.rs:21`; CFG `foxsy_decimals` (hardcoded 18, `backend/src/routes/config.rs:583`). The manual does not state the decimals |
| Player NFTs | collection `FXLP-6f28e5` (FoxLeaguePlayers) | `deploy/mainnet/chain.env:9`; CC:10-11 |
| Rarities and stat caps (per stat, 7 stats) | Common 30, Uncommon 55, Rare 75, Epic 90, Legendary 100 | EM:22; PNFT:42-50 (VIEW `statCap`); `backend/src/models.rs:30`; `frontend/src/lib/rarityCaps.ts:12-18` |
| Starting stats | rolled at 40 to 60 percent of the rarity cap | PNFT:52-61 |
| Positions | GK, DEF, MID, FWD | |
| Stats | speed, accuracy, defense, power, control, vision, stamina | `backend/src/routes/training.rs:258` |

---

## 2. Registration and team

| Rule | Mainnet value | Sources | Live value from |
|---|---|---|---|
| Registration fee | **5,000 FOXSY**, exact, once per wallet, not refundable once the team exists | EM:19; Manual `getting-started/onboarding.mdx:17`, `legal/terms.md:43`; CC:15; contract `registerAndPay` PNFT:1217-1259; relay cross-check key `relayer_v3.registration_fee_foxsy_wei` default 5000e18 (CR:2062-2064) | CFG `registration_fee_wei`, `registration_fee_foxsy`, `registration_fee_foxsy_wei`; VIEW `getRegistrationFee` |
| Registration gas | paid by a FoxLeague relayer (relayed v3) | EM:58; Manual `legal/terms.md:33` | CFG `relayer_v3_enabled`, `relayer_addresses`, `relayer_max_gas_limit` |
| Starter squad | 18 cards: 10 Common, 4 Uncommon, 2 Rare, 1 Epic, 1 Legendary; 2 GK, 6 DEF, 6 MID, 4 FWD. A missing rarity falls back to a lower one. The Legendary comes from the "Legends wall" first (`registration.wall_legend_max_nonce` = 6448) | EM:20; Manual `getting-started/players.md:11-15`; `backend/src/routes/registration.rs:1227`, `:1350-1396`; SEED:66 | `GET /api/register/pool-status` (stock) |
| One team per wallet | 18 cards delivered for life per wallet; nested rarity caps (at most 1 Legendary, 2 Epic or better, 4 Rare or better, 8 Uncommon or better) | PNFT:133-141, `:1510-1514` | |
| Free registration by holding cards | a wallet holding 18 or more `FXLP` cards that never paid registers free (no draw, no bonus) | `registration.rs:88`, `:413-667` | CFG `nft_bypass_threshold` (18); `GET /api/onboarding/check-eligibility` |
| Team name | 3 to 15 bytes, letters, digits, space, hyphen; unique ignoring case, spaces and hyphens; rename free | `registration.rs:341-395`; `backend/migrations/087_team_name_normalized_unique.sql:13-14`; `backend/src/routes/teams.rs:459-541`; Manual `getting-started/onboarding.mdx:86` | |
| Badge | first badge free; after registration 3 free re-rolls, then **1,000 FOXSY** each; 3 generations per 10 min | EM:53; Manual `mechanics/shop.mdx:28`; `badge.free_regens` 3 (CR:1747-1748), `badge.regen_cost_foxsy` 1000 (CR:1753-1754), not seeded | the generate route answers `payment_required` with `cost_foxsy` |
| Whitelist | code default: required; planned to be switched off for launch | `registration.whitelist_required` default `"true"` (CR:1835-1839), not seeded; `CHANGELOG.md:627-629` | `GET /api/whitelist/check?wallet_address=` |

---

## 3. Matches: types, caps and cooldowns

| Match type | Started by | Opponent | Counts toward the daily 5 | ELO | XP and competitive count | Condition cost | FOXSY |
|---|---|---|---|---|---|---|---|
| Casual | you | AI at your lineup's OVR | yes | no | no | 5, you only | none |
| Ranked | you | a real team within 150/300/500 ELO, else AI | yes | K 24 against a real team, none against AI | no while ranked XP is off (launch) | 5, initiator only | none |
| Bronze tournament | schedule | real | no | no | no | 10, both | none (free) |
| Silver / Gold tournament | schedule | real | no | K 12 / K 18 | yes | 10, both | pool prizes |
| 1v1 challenge (Silver / Gold) | schedule | real | no | K 12 / K 18 | yes | 10, both | winner takes 90 percent of the pool |
| Developer games | | | no | no | no | none | |

Sources: `backend/src/routes/matches.rs:990-991` (types), `:1531-1629` (opponents), `:3448-3451`
(XP eligibility), `:3589-3645` (K factors), `:2842-2877` (condition), `:3696` (developer games apply no
effects); Manual `mechanics/matches.mdx:11-54`.

| Rule | Mainnet value | Sources | Live value from |
|---|---|---|---|
| Casual + ranked matches you start per day | **5** (being drawn in as a ranked opponent, tournaments and 1v1s do not count) | EM:23; Manual `mechanics/matches.mdx:51`; `max_matches_per_day` default 5 (CR:1141-1142), SEED:105 | `GET /api/matches/daily-allowance` (auth): `today_count`, `daily_limit`, `reset_hour_utc` |
| Cooldown between match starts | **30 s** from the start of your previous match (any kind) | EM:24; `match.cooldown_ms` 30000 (CR:2499-2500), fallback `match_cooldown_seconds` 30 (CR:936-937) | not public |
| Ranked cooldown | **15 min** from the start of your last ranked game, started or drawn into | EM:24; `match.ranked_cooldown_ms` 900000 (CR:2513-2514) | not public |
| Ranked pair | the same two teams meet in ranked at most **once every 24 hours**, whoever started it (a game still being played counts); a team played in the last 24 h, or one whose eleven is not all match-fit, is not drawn, and the AI stands in when no other team fits; a second game of the pair inside 24 h records the result but moves no rating (since 2026-10-12) | Manual `mechanics/matches.mdx` | not public |
| Pre-match lockout | no casual or ranked from **1 h** before any of your unrevealed tournament or 1v1 matches; you are not drawn as a ranked opponent then either | Manual `mechanics/matches.mdx:54`, `mechanics/one-v-one.mdx:115`; const `TOURNAMENT_BUSY_LEAD_HOURS` (`matches.rs:331`) | not a key |
| Ranked matchmaking bands | 150, then 300, then 500 ELO, then an AI stand-in (ELO clamped to 150 of yours, no ELO change) | Manual `mechanics/matches.mdx:37-38`; `matchmaker.elo_tier_1/2/3` (CR:2437-2446) | not public |
| Squad needed to start | saved 11 + 7, all owned and unlisted, no starter at condition 0, none of the 18 in a transfer cooldown | `matches.rs:1268-1525`; Manual `mechanics/tactics.md` (Squad Readiness) | |
| 18-unlisted-cards gate | off (`match.gate_enabled` default `"false"`, not seeded) | CR:975-976 | not public |
| Platform capacity | 3 concurrent simulations | `match.sim_max_concurrent` (CR:1173-1174) | |
| Per-match FOXSY reward | **none**; FOXSY moves only through tournament and 1v1 pools | Manual `mechanics/matches.mdx:11-16` | |
| Result application | ranked and casual results apply when the replay ends or about 11 min after the match finishes (sweep) | `matches.rs:215-237`, `:2561-2665` | |
| In-match strength | synced stat x (50 + condition / 2) / 100: full at 100 condition, half at 0 | `backend/src/attribute_mapping.rs:61-64`; Manual `mechanics/tactics.md` ("What actually drives the match") | |

---

## 4. ELO, leagues, leaderboard

| Rule | Mainnet value | Sources | Live value from |
|---|---|---|---|
| Starting ELO | 1200 | EM:54; `backend/migrations/001_initial.sql:8` | |
| Formula | standard Elo, expected score `1/(1+10^((opp-me)/400))`, draw 0.5, each side rounded | `backend/src/db.rs:779-803` | |
| K ranked (vs a real team) | **24** | `elo.k_factor_ranked` (CR:453-454), SEED:82 | not public |
| K Silver tournament and Silver 1v1 | **12** | `elo.k_factor_tournament_silver` (CR:457-458), SEED:83; Manual `mechanics/one-v-one.mdx:103` | not public |
| K Gold tournament and Gold 1v1 | **18** | `elo.k_factor_tournament_gold` (CR:459-460), SEED:84 | not public |
| Bronze tournaments, casual, ranked vs AI | no ELO (the key `elo.k_factor_tournament_bronze` exists but is never read) | `matches.rs:3611-3645`; CR:455-456 | |
| Mutual forfeit | a loss for both (Silver/Gold: both lose ELO) | Manual `mechanics/match-day-strategy.mdx:45` | |
| League floors | Bronze below 1300, Silver 1300, Gold 1600, Platinum 2000, Diamond 2700 | EM:54; `league.*_min_elo` (CR:470-477); gold, platinum, diamond SEED:85-87 (silver runs on its default) | CFG `league_thresholds` |
| ELO decay | on: after 10 idle days, -5 every 20 h (about 6 a day), floor 1200. Only ranked vs a real team or a revealed Silver/Gold tournament match resets the idle clock | EM:55; `elo.decay_enabled` (CR:488-489), SEED:88; grace 10, step 5, floor 1200 (CR:490-495); guard 20 h (CR:519-520); `backend/src/elo_decay.rs` | not public |
| Leaderboard | one global list by ELO; W/D/L can be windowed 7/30/90 days, ELO is lifetime | `backend/src/routes/leaderboard.rs:54-294` | `GET /api/leaderboard` |
| Seasons | none in code | | |

---

## 5. XP, competitive matches and level

| Rule | Mainnet value | Sources | Live value from |
|---|---|---|---|
| What is **competitive** | Silver or Gold tournament matches and Silver or Gold 1v1s against a real opponent, with match stats recorded. Ranked never moves the match counter (it gives XP only while ranked XP is on, off on mainnet). Never casual, AI games, Bronze or developer games | EM:26; Manual `mechanics/fusion.mdx:32`; `matches.rs:3448-3451`, `:3868-3883` | |
| Ranked XP | off | `xp.ranked_enabled` default 0 (CR:1029-1030); `backend/migrations/104_economy_rebalance_keys.sql:7` | not public |
| Competitive counter | every competitive appearance increments `competitive_matches`; sync writes it on chain as the card's `matches_played`, which fusion and listing read. No daily cap on the counter | `matches.rs:3868-3883`; `backend/src/routes/sync.rs:1910-1979`; EM:25 | `GET /api/players/{address}` `competitive_matches` (off chain); on-chain attribute after sync |
| XP-earning matches per card per day | **3** (a 4th still counts for ELO, career stats and the competitive counter) | EM:25; `xp.max_matches_per_player_per_day` (CR:1036-1037), SEED:98 | not public |
| XP per competitive match | up to 900 per starter: nine match actions scored 0 to 100 against normalisers, spread over the 7 stats; a median game scores about half; independent of the result | EM:27; `backend/src/xp_progression.rs:302-373`; normalisers `xp.norm.*` (CR:1043-1060) | not public |
| XP per stat point | **2,000** XP in that stat's pool gives +1; surplus carries over unless the point lands on the cap; XP on a capped stat is lost | EM:29; `training.xp_threshold_per_level` (CR:1237-1238), SEED:74 | CFG `training_defaults.xp_threshold_per_level` |
| XP multipliers | shop booster 2x for 24 h; featured-tournament winner 2x for 48 h, runner-up 1.5x for 24 h; only the highest applies; training honours only the shop booster | EM:28; Manual `mechanics/shop.mdx:69`, `mechanics/tournaments.mdx:264`; CR:738-744, `:794-813` | `GET /api/shop/status` (booster state) |
| Player level | `floor(sqrt(total XP / 200))`, max 100; cosmetic (does not change match strength) | EM:30; `xp_progression.rs:15-24`, `:42`; `match.max_player_level` (CR:1224-1225) | CFG `level_xp_divisor` |

---

## 6. Condition, regeneration and aging

| Rule | Mainnet value | Sources | Live value from |
|---|---|---|---|
| Drain per tournament or 1v1 appearance | **10**, both sides; a substitute who comes on pays, the unused bench does not | EM:34; `condition_loss_per_match` (CR:988-989); migration `105_condition_loss_differentiated.sql:12` | CFG `condition_loss_per_match` |
| Drain per casual or ranked appearance | **5**, only the side that started the match | EM:34; `condition_loss_per_match_ranked` (CR:1000-1001); migration `105:18` | CFG `condition_loss_per_match_ranked` |
| Drain per training session | **5** | EM:33; `training_condition_loss` (CR:1109-1110), not seeded | not public |
| Regeneration | **48 per day (2 per hour)** up to age 30, falling linearly to 24 per day at 39 | EM:35; `condition.regen_points_per_day` default **24** (CR:1016-1017) but SEED:99 sets **48**; `aging_regen_min_points_per_day` 24 (CR:1099-1100, SEED:104); formula `backend/src/db.rs:172`, `:556-565`, migration `126` | CFG `condition_regen_points_per_day`, `aging_regen_min_points_per_day` |
| Minimum field condition | **30**: needed to train and to start in a tournament or 1v1 (below it the starter is auto-substituted; fewer than 11 fit forfeits 3-0). Casual and ranked refuse only a starter at 0 | EM:37; `min_field_condition` (CR:1007-1008), not seeded | CFG `min_field_condition` |
| Aging | minted at 18, **one in-game year per 52 real days**; from age 30 every condition cost ramps up to **3x at 39** (matches 10 to 30 and 5 to 15, training 5 to 15); regeneration falls to 24 a day. Stats never drop | EM:56; Manual `mechanics/aging.mdx:11-24`; `aging_starting_age` 18, `aging_maturity_age` 30, `aging_max_age` 39, `aging_condition_loss_multiplier_pct` 300 (CR:1064-1089; multiplier SEED:103); `backend/src/db.rs:473-565` | CFG `aging_starting_age`, `aging_maturity_age`, `aging_max_age` (the multiplier is not served) |
| Retirement, injuries | none | Manual `mechanics/aging.mdx:48-54` | |
| Condition recovery | **100 FOXSY for a full 0 to 100 restore**, about 1 FOXSY per missing point (rounded up) | EM:36; CC:16; `backend/src/routes/shop.rs:310-314` | CFG `shop_prices_foxsy.condition`; VIEW `getShopConditionPrice` |

A young card at 0 is back to 100 in about 2 days; at 3 competitive matches a day (30 condition) it
stays sustainable against 48 regenerated (EM paths (a) and (g)).

---

## 7. Training

| Rule | Mainnet value | Sources | Live value from |
|---|---|---|---|
| Free sessions | **5 per wallet per day** (not per player) | EM:31; `max_daily_trainings` default 5 (CR:1118-1119), SEED:76 (migration 065 had seeded 6) | `GET /api/shop/status` `training.daily_free` |
| Paid sessions | **20 FOXSY per slot**, at most **10 used per day** (15 sessions in total); slots are banked and never expire; the web app sells at most 25 per purchase | EM:32; CC:19 `SHOP_TRAINING_PRICE_FOXSY=20`; `training.premium_slots_cap` 10 (CR:1247-1248), SEED:75; `frontend/src/pages/Marketplace.tsx:4382-4391` | CFG `shop_prices_foxsy.training`; VIEW `getShopTrainingPrice`; `/api/shop/status` `training` |
| XP per session | `round(20 x condition / 100)`: 20 at full condition, 40 with the booster | EM:31; `training.rs:356-357` | |
| Minimum condition to train | 30 | `training.rs:292-301` | CFG `min_field_condition` |
| Request spacing | 500 ms per wallet | `training.cooldown_ms` (CR:1216-1217) | |
| Pace | one stat point = 100 sessions at full condition; at 15 sessions a day about 6.7 days per point on one stat (3.3 with the booster) | derived from the rows above | |

---

## 8. Sync

| Rule | Mainnet value | Sources | Live value from |
|---|---|---|---|
| Sync fee | **10 FOXSY per card**; excess refunded; goes to the treasury | EM:52; Manual `mechanics/sync.mdx:37`; CC:24; PNFT:1648-1664, `:1757-1767` | CFG `sync_cost_foxsy`; VIEW `getSyncCost` |
| What is written | the 7 stats (capped by rarity), level, experience, condition, the competitive count (as `matches_played`), goals, assists | `backend/src/routes/sync.rs:1900-1996`; PNFT:89-112 | |
| When needed | before fusion or listing (the contract reads on-chain values); matches use the last synced stats, so training counts only after a sync; not needed merely to play | Manual `mechanics/sync.mdx:54-65` | |
| Signed payload validity | one per wallet at a time, newer than the last sync, at most 1 h old, at most 60 s in the future | PNFT:1618-1636 | VIEW `getLastSyncTimestamp(address)` |
| What makes a card "dirty" | every training session and every match appearance, even with no synced field changed | `training.rs:667`; `backend/src/db.rs:680-744` | `GET /api/players/{address}` `stats_dirty` |

---

## 9. Shop

Every product is paid with `shopPay` into the players contract treasury and confirmed with
`POST /api/shop/confirm`; the backend applies it. Fixed-price products need the exact amount.

| Product | Mainnet value | Limits | Sources | Live value from |
|---|---|---|---|---|
| Common pack | **2,500 FOXSY** for 5 Common cards | **2 per wallet per rolling 7 days**; platform budget **500 cards (100 packs) per epoch**; sold out when fewer than 5 Commons are free; delivered about a minute later with 0 competitive matches and no cooldown | EM:21; Manual `mechanics/shop.mdx:21`, `:37-41`; `shop.common_pack_price_foxsy` 2500, `shop.common_pack_per_wallet_per_week` 2 (CR:767-772), SEED:114-116; `backend/src/routes/shop_pack.rs:25-32`; CC:50-52 `PACK_DISTRIBUTION_EPOCH_CAP=500` | CFG `common_pack_price_foxsy`, `common_pack_per_wallet_per_week`, `common_pack_epoch_remaining`, `common_pack_available`, `common_pack_unavailable_reason`; `/api/shop/status`; VIEW `getPackDistributionEpochCap`, `getPackDistributedThisEpoch` |
| XP booster | **2,000 FOXSY**: 2x XP for 24 h | one window at a time; buying again restarts the clock | EM:28; CC:17; CR:738-744 | CFG `shop_prices_foxsy.xp_booster`; VIEW `getShopXpBoosterPrice`; `/api/shop/status` |
| Training slot | **20 FOXSY** each | 10 used per day | section 7 | section 7 |
| Condition recovery | up to **100 FOXSY** per card, pro-rated | none beyond ownership | section 6 | section 6 |
| Reduce Cooldown (transfer waiver) | per day above a **72 h floor**, by rarity: **Common 25, Uncommon 75, Rare 200, Epic 500, Legendary 1,250 FOXSY**; whole days rounded up; all remaining days or nothing. The rate is the 10 percent marketplace fee on the rarity reference price (5,000 / 15,000 / 40,000 / 100,000 / 250,000) spread over 20 days | per card | EM:47; Manual `mechanics/shop.mdx:99-113`; `shop.cooldown_waiver_fee_multiple_pct` 100 (CR:702-703), `shop.cooldown_waiver_floor_hours` 72 (CR:758-759), both SEED:96-97; reference prices CR:1996-2005; `shop.rs:554-612` (SEED:93 `shop.cooldown_waiver_price_per_day 15000` is only the unused flat fallback) | `GET /api/shop/waive-cooldown/quote` (auth) |
| Badge re-roll | **1,000 FOXSY** after 3 free | | section 2 | |
| Fusion waivers | 75 FOXSY per day (every day or some); per match Uncommon 20, Rare to Legendary 100, none for Common | | section 10 | section 10 |
| Automatic refunds | a payment that cannot be delivered is refunded automatically; an unconfirmed settled payment is refunded after **30 min**; at most **10 automatic refunds per wallet per hour** (then by hand); contract cap 1,000,000 FOXSY per day for all refunds | | Manual `legal/terms.md:47`, `mechanics/shop.mdx:142`; `shop.unconfirmed_refund_grace_secs` 1800 (CR:3039-3042); `shop.refund_max_per_wallet_window` 10, `shop.refund_window_secs` 3600 (CR:3051-3057); CC:46-49 `TREASURY_REFUND_DAILY_CAP_FOXSY=1000000` | |

---

## 10. Fusion

| Rule | Mainnet value | Sources | Live value from |
|---|---|---|---|
| Inputs | 3 cards of the same rarity, synced, in the wallet, not listed; one output of the next rarity from a pre-minted pool (per rarity and position); inputs are burned | EM:38; Manual `mechanics/fusion.mdx:19-26`, `:84`; PNFT:2289-2531 | VIEW `getFusionPoolCount(level, position)` |
| Fee | **Common to Uncommon 100, Uncommon to Rare 200, Rare to Epic 400, Epic to Legendary 800 FOXSY**; at least the fee, excess refunded; returned with the cards if the fusion reverts; Legendary cannot be fused | EM:39; Manual `mechanics/fusion.mdx:44-49`; CC:20-23 `FUSION_COST_0..3` | CFG `fusion_costs_foxsy`; VIEW `getFusionCost(level)` |
| Competitive matches per input | **The match gate of its rarity** since 2026-10-12: Common **5**, Uncommon **15**, Rare **45**, Epic **135** (Legendary 405, for listing); waived matches count | EM:38; players contract `setRarityMatchGate` rows (deploys.yaml 2026-10-12) | CFG `rarity_match_gate.rarities[].gate`; VIEW `getRarityMatchGate(level)`. The old `fusion_min_matches` (20) is still served but no longer applies |
| Matches that must really be played | Common **5**, Uncommon **5**, Rare **15**, Epic **45**, Legendary **135** | EM:38; the same rows | CFG `rarity_match_gate.rarities[].floor` |
| Wallet spacing | **20 h** between two fusions of one wallet; not for sale | EM:41; CC:27-33 `FUSION_COOLDOWN_SECONDS=72000` (the contract default if unset would be 7 days, PNFT:2868-2875) | CFG `fusion_cooldown_seconds`; VIEW `getFusionCooldownSeconds`, `getLastFusionTimestamp(address)` |
| Card cooldown | **14 days** on every fusion output before it can be an input; travels with the card; does not block play or listing | EM:40; CC:34 `FUSION_CARD_COOLDOWN_SECONDS=1209600` | CFG `fusion_card_cooldown_seconds`; VIEW `getFusionReadyAt(nonce)` |
| Cooldown waiver | **75 FOXSY per waived day**, down to a **3-day floor**: at most 11 days and 825 FOXSY per card. Since 2026-10-12 any number of the quoted days can be bought (`payFusionCooldownWaiver(nonce, days)`, the ready time moves that many days earlier) | EM:40; CC:35-37 (price 75, floor 259,200 s); PNFT:2542-2631 | CFG `fusion_cooldown_waiver_price_per_day`, `_wei`, `fusion_cooldown_waiver_floor_seconds`; VIEW `getFusionCooldownWaiverQuote(nonce)` |
| Match waiver | Per waived match by rarity: Uncommon **20 FOXSY** (at most 10), Rare **100** (30), Epic **100** (90), Legendary **100** (270); **none for Common**; the floor of each gate stays; the credit stays on the card after a sale | EM:38; CC:36-38; PNFT:2641-2710 | CFG `fusion_match_waiver_price_per_match`, `_wei`; `GET /api/players/nonce/{nonce}/match-waiver-quote`; VIEW `getFusionMatchCredit(nonce)` |
| Transfer lock inheritance | a fusion output inherits the longest remaining transfer cooldown of its inputs | EM:38; `backend/src/chain_indexer.rs:3646-3656` | |

Worked paths (EM, section "How long and how much from A to B"): first Uncommon from the starter
squad in 7 days for 100 FOXSY (2 days for 1,000 FOXSY with match waivers); Common to Legendary is
40 fusions and 6,500 FOXSY in fees with an absolute floor of 32.5 days (39 spacing gaps of 20 h).

---

## 11. Tournaments

| Rule | Mainnet value | Sources | Live value from |
|---|---|---|---|
| Formats and sizes | knockout 4/8/16/32 (full bracket required); groups + knockout 8/16/32/64 (full); round robin 3 to 20 (optional home and away); swiss 3 to 32 | `backend/src/routes/tournaments.rs:35-66`; Manual `mechanics/tournaments.mdx:43-79` | CFG `tournament_defaults` (group size, minimums) |
| Tiers and seat fee | **Bronze free; Silver 1,000 to 4,999 FOXSY; Gold 5,000 and up** | EM:48; Manual `mechanics/tournaments.mdx:116-120`; `tournament.silver_entry_fee_min` default **100** (CR:421-422) but SEED:111 sets **1000**; silver max 5000 and gold min 5000 (CR:423-426); effective Silver top = min(silver max, gold min - 1) (`tournaments.rs:481-514`) | CFG `tournament_fee_bounds {silver_min, silver_max, gold_min}` (serves 5000 as `silver_max`; the effective top is 4,999) |
| Pool | seat fee x teams seated | `backend/src/tournament_simulator.rs:3775-3791` | event `prizes_distributed` |
| Prize split | **winner 45, runner-up 30, third 15, platform fee 10** percent of the pool; with no third-place finisher the 15 goes to the runner-up (45/45/10); no runner-up: to the winner | EM:49; Manual `mechanics/tournaments.mdx:247-260`; `tournament.prize_winner_percent` default **50** / runner-up 30 / third 15 / fee default **5** (CR:148-155); SEED:106, `:109-110` set 45 / 15 / 10; roll-forward `tournament_simulator.rs:3277-3369` | CFG `tournament_prize_split` |
| Contract bounds on payouts | prizes between (100 - fee - 5) and (100 - fee) percent of the seated pool, i.e. 85 to 90 percent; contract platform fee 10 (maximum 10) | CC:58 `TOURNAMENT_PLATFORM_FEE_PERCENT=10`; TM:16, `:35-44`, `:427-438` | VIEW `getPlatformFeePercent` |
| Creator royalty | **2.5 percent of the pool**, paid out of the 10 percent fee to the provider of the match AI binary (not the organizer); never reduces a prize; no royalty on marketplace sales | EM:46; Manual `developer/royalties.mdx:17-27`, `mechanics/tournaments.mdx:262`; `royalty.creator_share_percent` default **"0"** (CR:162-163) but SEED:52 sets 2.5; on-chain cap `setMaxRoyaltyBps 250` (`contracts/deploys.yaml:548-551`, TM:441-456) | VIEW `getMaxRoyaltyBps` |
| Organizer share | none: an organizer-only host pays no seat and earns nothing | EM:49 | |
| Creation cap | 1 active tournament you play in plus 1 you only organize (1v1s separate) | EM:51; `tournaments.rs:2360-2409` | |
| Schedule | start at least 1 h after creation, more than 5 min after the registration deadline, at most 90 days ahead; interval between rounds 30 min to 1 day; standard tournaments may not overlap platform-wide (window from 1 h before start to 1 h after the estimated end, 3 min per match) | Manual `mechanics/tournaments.mdx:176-177`; `tournaments.rs:774-827`, `:2250-2499` | |
| Strategy lock | **30 min** before each match your saved formation and 11 + 7 are captured | Manual `mechanics/tournaments.mdx:155`, `mechanics/match-day-strategy.mdx:13`; `tournament.match_sim_lead_minutes` 30 (CR:396-404), not seeded | `GET /api/tournaments/upcoming-matches` `lead_minutes`, `strategy_locks_at` |
| Forfeits | incomplete or unowned squad at the lock: 3-0 loss; unfit starter (condition below 30 or in a transfer cooldown) auto-substituted; fewer than 11 fit: 3-0; both teams failing: 0-0, a loss for both (-1 point in standings) | Manual `mechanics/match-day-strategy.mdx:45`, `mechanics/tournaments.mdx:222-226`; `tournaments.rs:5809-5815` | |
| Seat refund | leave before the registration deadline (exact refund); cancelled tournaments refunded by the game server; `claimRefund` as a fallback | Manual `mechanics/tournaments.mdx:274`; TM:318-341 | VIEW `getEntryAmount(tid, address)` |
| Not filled at the deadline | cancelled and refunded | `tournament_simulator.rs:167-230`, `:637-900` | |
| Featured tournaments | winner 2x XP for 48 h plus a badge and title, runner-up 1.5x for 24 h; no FOXSY | Manual `mechanics/tournaments.mdx:234`, `:264-266`; CR:794-813 | `GET /api/tournaments/hall-of-fame` |
| Bronze | no pool, no ELO, no XP, not competitive | Manual `mechanics/tournaments.mdx:266` | |

---

## 12. 1v1 challenges

| Rule | Mainnet value | Sources | Live value from |
|---|---|---|---|
| Stake per side | same tier bounds: **Silver 1,000 to 4,999, Gold 5,000 and up** (Bronze only for developer challenges) | EM:50; Manual `mechanics/one-v-one.mdx:20-21` | CFG `tournament_fee_bounds` |
| Split | **winner 90 percent, platform 10 percent**, loser nothing; the 2.5 percent royalty comes out of the fee | EM:50; Manual `mechanics/one-v-one.mdx:47-57`; `tournament.one_v_one_winner_percent` default **95** and `..._platform_fee_percent` default **5** (CR:181-185), SEED:107-108 set 90 / 10 | CFG `one_v_one_prize_split` |
| Accept window | 30, 60, 120 or 240 minutes; the API default is **60** when omitted, the web app preselects 30 | Manual `mechanics/one-v-one.mdx:23`; `tournaments.rs:62-63`; `tournament.deadline_grace_minutes` 30 (CR:297-298) | CFG `tournament_defaults.deadline_grace_minutes` |
| Active challenges per wallet | **1** open or running (created or joined) | EM:50; Manual `mechanics/one-v-one.mdx:97`; `tournament.one_v_one_max_active_per_user` 1 (CR:242-244) | CFG `tournament_defaults.one_v_one_max_active_per_user` |
| Kickoff | 3 to 12 min after it fills (queue-dependent), moved past either side's other matches | `tournaments.rs:4922-5147`; CR:253-270, `:365-384`; Manual `mechanics/one-v-one.mdx:61` | |
| Prize delivery | about **180 s** after the reveal | `tournament.one_v_one_prize_delivery_delay_seconds` 180 (CR:211-213) | CFG `tournament_defaults.one_v_one_prize_delivery_seconds` |
| Draws | none: extra time, then penalties | Manual `mechanics/one-v-one.mdx:66-73`, `:107` | |
| Unaccepted | full refund to the creator at the deadline | EM:50; Manual `mechanics/one-v-one.mdx:83-93` | |
| ELO, XP, condition | K 12 / 18; XP and competitive count; 10 condition per appearance | sections 3 to 6 | |

---

## 13. Marketplace and transfers

| Rule | Mainnet value | Sources | Live value from |
|---|---|---|---|
| Sale format | every sale is a **24 h English auction**; instant listing and buying are disabled on chain | EM:42; Manual `mechanics/marketplace.mdx:11`; CC:39 `AUCTION_DURATION_SECONDS=86400`; PNFT:1825, `:1863`; `marketplace.auction_enabled` SEED:56 | CFG `auction_enabled`, `auction_duration_seconds` |
| Reserve (minimum list price) | **500 FOXSY** floor, whole FOXSY; the web app caps at 1,000,000 | EM:42; Manual `mechanics/marketplace.mdx:22`; CC:44 `AUCTION_MIN_PRICE_FOXSY=500` (the mainnet deploy set 10,000, `contracts/deploys.yaml:491-495`; lowered to 500 by owner decision, `CHANGELOG.md:639-641`, EM:42 source comment); `frontend/src/pages/Marketplace.tsx:198` | CFG `marketplace_min_list_price_foxsy`; VIEW `getAuctionMinPrice` |
| Bid increment | at least **5 percent** over the top bid; first bid at least the reserve | EM:42; CC:40 | CFG `auction_min_increment_percent` |
| Anti-snipe | a bid in the last **300 s** extends the end by **300 s**, repeatedly | EM:42; CC:53-54 | CFG `auction_snipe_window_seconds`, `auction_snipe_extension_seconds` |
| Cancel | only while there are no bids | EM:42; PNFT:2210-2230 | |
| Fee | **10 percent** of the winning bid, paid by the seller, only on a sale; no royalty | EM:44; CC:25 `MARKETPLACE_FEE_PERCENT=10` (the contract's `init` value is 5, PNFT:183) | CFG `marketplace_fee_percent`; VIEW `getMarketplaceFee` |
| Relist cooldown | **48 h** after a sale (per card) | EM:45; CC:55 | CFG `auction_relist_cooldown_seconds`; VIEW `getLastPurchaseTimestamp(nonce)` |
| Listing gate | **The match gate of the card's rarity**: Common 5 (5 played), Uncommon 15 (5), Rare 45 (15), Epic 135 (45), Legendary 405 (135); waived credit counts, synced | EM:43; PNFT:2650-2673 | `GET /api/marketplace/can-list?nonce=` |
| Settlement | anyone can settle after the end; a backend keeper does it every minute and pays the gas | `backend/src/auction_settle_keeper.rs:1-7` | VIEW `getAuction(nonce)` |
| Transfer cooldown | a card received **wallet to wallet** cannot play or join tournaments for **21 days (504 h)**; since 2026-10-12, **21 days plus 6 hours for every missing match** if it moved before its match gate (each match waiver bought afterwards takes 6 hours off, never below 21 days plus 6 hours per match it must still really play; Reduce Cooldown does not apply to that lock); auction wins, fusion outputs and shop mints start none, but a running lock passes to a buyer | EM:47; Manual `mechanics/marketplace.mdx:68`, `legal/terms.md:67`; `match.transfer_cooldown_hours` 504 and `..._unplayed` 1512 (CR:656-677), SEED:89, `:92` | CFG `transfer_cooldown_hours`, `transfer_cooldown_hours_unplayed`; per card `transferred_at`, `transfer_cooldown_hours` |

---

## 14. Onboarding relayer and the new-wallet bonus

| Rule | Mainnet value | Sources | Live value from |
|---|---|---|---|
| Relayed registrations | **3 attempts per wallet per 10 min**; **5,000 per day** platform-wide; past the cap onboarding closes for the day | EM:58; `relayer_v3.rate_limit_per_wallet` 3, window 600 s, `relayer_v3.global_daily_cap` 5000 (CR:2080-2097); `relayer_v3.enabled` SEED:41 | CFG `relays_remaining_today`, `relayer_v3_enabled` |
| Relay gas ceiling | 12,500,000 default | `relayer_v3.max_gas_limit` (CR:2156-2164) | CFG `relayer_max_gas_limit` |
| EGLD bonus amount | **0.1 EGLD** per wallet | EM:57; Manual `getting-started/onboarding.mdx:74`; `onboarding.bonus_egld_send_wei` default **0.05 EGLD** (CR:2234-2235) but SEED:42 from `BONUS_EGLD_PER_WALLET=0.1` (`deploy/mainnet/inputs.example.env:27`) | not public |
| Who gets it | the **first 100 wallets** (252 until 2026-09-28) that register through the normal path holding **less than 0.01 EGLD** | EM:57; `onboarding.bonus_egld_max_recipients` default 0 = unlimited (CR:2246-2247), SEED:47 insert-once, set by hand per `seed.sh:44-46` (252 at launch, 100 since 2026-09-28, manual PR #263); `inputs.example.env:28-31`; gate `relayer_v3.bonus_egld_balance_gate_wei` 1e16 (CR:2072-2074); `backend/src/routes/registration.rs:1016-1130` | not public |
| Daily bonus cap | 100 EGLD per rolling 24 h | `onboarding.bonus_egld_daily_cap_wei` default **5 EGLD** (CR:2242-2248) but SEED:43 from `inputs.example.env:36` | not public |
| Nature | a promotion, not an entitlement; can change or end | Manual `legal/terms.md:35` | |

---

## 15. Where the code default and the mainnet value differ

A backend that lost a seeded row would fall back to the code default. These are the values to read
live rather than hardcode.

| Key or setting | Code default | Mainnet | Public check |
|---|---|---|---|
| `condition.regen_points_per_day` | 24 | 48 (SEED:99) | CFG `condition_regen_points_per_day` |
| Tournament split (winner / runner-up / third / fee) | 50 / 30 / 15 / 5 | 45 / 30 / 15 / 10 (SEED:106, `:109-110`) | CFG `tournament_prize_split` |
| 1v1 split (winner / fee) | 95 / 5 | 90 / 10 (SEED:107-108) | CFG `one_v_one_prize_split` |
| `tournament.silver_entry_fee_min` | 100 | 1000 (SEED:111) | CFG `tournament_fee_bounds.silver_min` |
| `royalty.creator_share_percent` | 0 | 2.5 (SEED:52) | VIEW `getMaxRoyaltyBps` (cap only) |
| `onboarding.bonus_egld_send_wei` | 0.05 EGLD | 0.1 EGLD | none |
| `onboarding.bonus_egld_daily_cap_wei` | 5 EGLD | 100 EGLD | none |
| `onboarding.bonus_egld_max_recipients` | 0 (unlimited) | 100 (set by hand; 252 until 2026-09-28) | none |
| `max_daily_trainings` | 5 (migration 065 seeded 6) | 5 (SEED:76) | `/api/shop/status` |
| `marketplace.auction_enabled` | false | true (SEED:56) | CFG `auction_enabled` |
| `relayer_v3.enabled` | false | true (SEED:41) | CFG `relayer_v3_enabled` |
| `registration.whitelist_required` | true | unknown (planned off for launch) | `/api/whitelist/check` |
| Contract marketplace fee | 5 (`init`, PNFT:183) | 10 (CC:25) | VIEW `getMarketplaceFee` |
| Contract fusion wallet spacing | 7 days if unset (PNFT:2868-2875) | 20 h (CC) | VIEW `getFusionCooldownSeconds` |
| Contract auction minimum price | 0 if unset | 500 (first deployed as 10,000) | VIEW `getAuctionMinPrice` |
| Silver maximum | served as 5,000 | effective 4,999 | derive `min(silver_max, gold_min - 1)` |

Keys that are **not seeded** and run on their code default unless an admin changed them: the match and
ranked cooldowns, `match.gate_enabled`, `xp.ranked_enabled`, `tournament.match_sim_lead_minutes`,
`min_field_condition`, `training_condition_loss`, ELO decay parameters other than the switch,
`league.silver_min_elo`, the badge prices, `relayer_v3.bonus_egld_balance_gate_wei`.

Stale comments in the source that contradict the code (the code is right): XP threshold 1500
(`backend/src/xp_progression.rs:8-11`; it is 2000), training base 50 XP (`training.rs:213-218`; it is 20),
ranked K 32 (`matches.rs:3590`; it is 24), Swiss minimum 4 (`backend/src/routes/config.rs:341-342`; it
is 3), the testnet token id in `config.rs:271-277`, `:579`.

---

## 16. Where FOXSY goes

Checked against both contracts:

1. **Registration fees** stay in the players contract (`registration_fees_balance`); the owner withdraws
   them (PNFT:619-630, `:1255-1262`).
2. **Treasury** (players contract): shop payments (packs, recovery, booster, slots, transfer waivers,
   badge re-rolls), sync fees, the 10 percent marketplace fee, fusion fees and both fusion waivers
   (PNFT:2283, `:1762`, `:2192`, `:2495`, `:2628`, `:2701`). The owner withdraws with `withdrawTreasury`;
   the game server refunds undeliverable payments through `refundFromTreasury` under a daily cap
   (PNFT:997-1031).
3. **Tournament and 1v1 seats** are escrowed per tournament in the tournaments contract.
   `distributePrizes` pays the winners 85 to 90 percent of the seated pool, the creator royalty (at
   most 2.5 percent) out of the fee; the rest goes to `accumulatedFees`, withdrawn by the owner
   (TM:372-481, `:569`).
4. **Nothing is burned** except the 3 input cards of a fusion (PNFT:2514). There is no per-match FOXSY
   emission: prizes are redistributed stakes.

---

## 17. `GET /api/config` field reference

Public, raw JSON (no envelope), whole FOXSY unless the field ends in `_wei`
(`backend/src/routes/config.rs:7-9`, `:36-360`, `:421-826`).

**Mirrored from the players contract** (read at boot and on setter changes; `backend/src/chain_config.rs:430-545`):
`registration_fee_foxsy`, `registration_fee_wei` (`registration_fee_egld` is a deprecated alias of the
FOXSY value), `fusion_costs_foxsy[4]`, `fusion_min_matches`, `fusion_cooldown_seconds`,
`fusion_card_cooldown_seconds`, `fusion_cooldown_waiver_price_per_day` (+ `_wei`),
`fusion_cooldown_waiver_floor_seconds`, `fusion_match_waiver_price_per_match` (+ `_wei`),
`fusion_match_waiver_floor`, `rarity_match_gate {rows_live, rules_live, live_from,
transfer_lock_hours_per_missing_match, rarities[{rarity, level, gate, floor, price_per_match (+ _wei),
waiver_enabled, row_set}]}` (since 2026-10-12; each row holds what the contract applies),
`marketplace_fee_percent`, `auction_duration_seconds`,
`auction_min_increment_percent`, `auction_snipe_window_seconds`, `auction_snipe_extension_seconds`,
`auction_relist_cooldown_seconds`, `marketplace_min_list_price_foxsy`, `sync_cost_foxsy`,
`shop_prices_foxsy {condition, xp_booster, training}`, `common_pack_epoch_remaining`.

**From the backend registry** (key, code default): `auction_enabled` (`marketplace.auction_enabled`),
`common_pack_price_foxsy`, `common_pack_per_wallet_per_week`, `common_pack_available`,
`common_pack_unavailable_reason`, `transfer_cooldown_hours`, `transfer_cooldown_hours_unplayed`,
`league_thresholds {silver_min, gold_min, platinum_min, diamond_min}`, `min_field_condition`,
`condition_regen_points_per_day`, `aging_regen_min_points_per_day`, `aging_starting_age`,
`aging_maturity_age`, `aging_max_age`, `condition_loss_per_match`, `condition_loss_per_match_ranked`,
`tournament_fee_bounds {silver_min, silver_max, gold_min}`,
`tournament_prize_split {winner_percent, runner_up_percent, third_percent, platform_fee_percent}`,
`one_v_one_prize_split {winner_percent, platform_fee_percent}`,
`tournament_defaults {match_stagger_minutes, deadline_grace_minutes, knockout_min_participants,
swiss_min_participants, groups_knockout_group_size, one_v_one_max_active_per_user,
one_v_one_prize_delivery_seconds}`, `training_defaults {xp_threshold_per_level}`,
`prematch_slide_durations_ms`, `relayer_v3_enabled`, `relayer_max_gas_limit`,
`registration_fee_foxsy_wei`, `relays_remaining_today`, `dex_swap_enabled`, `dex_swap_slippage_bps`,
`dex_swap_max_foxsy`.

**Constants**: `rarity_next`, `level_xp_divisor` (200), `nft_bypass_threshold` (18), `foxsy_decimals`
(18), `foxsy_token_id`, `relayer_addresses`.

---

## 18. World Cup (planned, not live)

The manual describes a planned community competition by nationality, targeted for 2027 with nothing
final (Manual `mechanics/world-cup.mdx:9-57`): players apply to coach a national team (with a minimum
standing such as a Gold league rating), the community votes (illustrative formula: voting power =
sqrt(FOXSY in Metastaking or Dual Farm) x ELO / 1000); the elected coach calls up to 20 players of
that nationality, whose owners may accept. A prize would be split roughly half to the coach and the rest
among the called-up players by contribution. Nothing of it exists in the code on the release branch.
