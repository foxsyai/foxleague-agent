# FoxLeague integration reference (mainnet)

How a self-hosted client that holds one player's own key can do, through the public HTTP API and
the MultiversX chain, everything the FoxLeague web app does for that player. It describes what
the web app does today; it adds no new interface.

- **Snapshot:** branch `origin/release/mainnet-1.0` at commit `0800dce5` (rc.31, 2026-09-28). Every
  `path:line` below points into that commit of the FoxLeague monorepo (see `SOURCES.md` for how to
  read it). Read the live values at runtime: most numbers are admin-tunable and several deployed
  values differ from code defaults (see `ECONOMY-AND-RULES.md`).
- **12 October 2026 switch** (`origin/main` at `4521c811`, players contract upgrade `86f38740`, live from
  16:30 UTC): the fusion, listing and match waiver sections below are brought to the match gate per
  rarity (`getRarityMatchGate(level)`, `/api/config` `rarity_match_gate`), the partial cooldown waiver
  and the random fusion draw; `GET /api/register/pool-status` is removed.
- **Network:** MultiversX mainnet, chain id `1`, throughout.
- **Scope:** public routes and the player-callable contract endpoints only. Admin routes, internal
  jobs and anything the game hides before a reveal are named in one line and not documented.

> **Read before you automate anything.** The Terms of Use prohibit "use of automated tools, bots or
> scripts not expressly allowed by Foxsy" (`docs/manual/src/content/docs/legal/terms.md:65`) and the
> Fair Play rules list "crafting, replaying or automating transactions, signatures or API calls that
> the FoxLeague interface does not offer" as a breach (`docs/manual/src/content/docs/legal/fair-play.md:20`).
> A tool published for all players needs that express allowance, in writing, in the Terms or the
> manual. Until then every section below describes what the interface offers, so a client that stays
> inside it does only what a player could do by hand.

**Notation.**

- Server error strings are quoted verbatim in backticks. Many backend strings still contain an em
  dash character (`CHANGELOG.md:17`: backend messages were not restyled in rc.31). This document never
  prints that character: it is written `{EM}` inside a quoted string. Match server errors on a
  distinctive substring that has no dash in it.
- `{x}` inside a quoted string is a value the server fills in. Quoted strings otherwise keep the
  server's own wording and punctuation.
- "Whole FOXSY" means a plain token count (5000). "Atomic" means the on-chain amount with 18
  decimals (5000 x 10^18).

---

## Contents

1. [Hosts, identifiers and conventions](#1-hosts-identifiers-and-conventions)
2. [Login and sessions](#2-login-and-sessions)
3. [Reading your own state](#3-reading-your-own-state)
4. [Registration](#4-registration)
5. [EGLD to FOXSY swap](#5-egld-to-foxsy-swap)
6. [Training](#6-training)
7. [Sync to chain](#7-sync-to-chain)
8. [Tactics: formation and lineup](#8-tactics-formation-and-lineup)
9. [Ranked and casual matches](#9-ranked-and-casual-matches)
10. [Tournaments](#10-tournaments)
11. [1v1 challenges](#11-1v1-challenges)
12. [Shop](#12-shop)
13. [Fusion](#13-fusion)
14. [Marketplace (auctions)](#14-marketplace-auctions)
15. [Leaderboard and match history](#15-leaderboard-and-match-history)
16. [Relayed transactions and the new-wallet bonus](#16-relayed-transactions-and-the-new-wallet-bonus)
17. [Rate limits](#17-rate-limits)
18. [Contract reference](#18-contract-reference)
19. [Routes a player client does not use](#19-routes-a-player-client-does-not-use)
20. [Open questions](#20-open-questions)
21. [Changes from 2026-10-15 to 2026-10-23](#21-changes-from-2026-10-15-to-2026-10-23)

---

## 1. Hosts, identifiers and conventions

### 1.1 Hosts

| What | URL | Source |
|---|---|---|
| FoxLeague API | `https://foxleague.ai/api/...` | domain `deploy/mainnet/inputs.example.env:9`; nginx proxies `/api/` to the backend (`deploy/mainnet/nginx/app.conf.template:106-110`) |
| FoxLeague WebSockets | `wss://foxleague.ai/ws/...` | `deploy/mainnet/nginx/app.conf.template:112-121` |
| MultiversX gateway | `https://gateway.multiversx.com` | `deploy/mainnet/chain.env:2` |
| MultiversX API | `https://api.multiversx.com` | `deploy/mainnet/chain.env:3` |
| Explorer | `https://explorer.multiversx.com` | `deploy/mainnet/chain.env:4` |
| Player manual | `https://docs.foxleague.ai` | `deploy/mainnet/nginx/docs.conf.template:5` |

During the preview week the web app lived under `https://foxleague.ai/new/`, but the API stayed at
the domain root in both layouts (`deploy/mainnet/nginx/app-preview.conf.template:124-132`). The
frontend client uses the relative base `/api` (`frontend/src/lib/api.ts:103-106`).

Only `/api/` and `/ws/` reach the backend. The backend's `/health` and `/healthz/*` routes
(`backend/src/routes/health.rs:13-22`) are not proxied at the edge; `GET /api/health` is.

### 1.2 Chain identifiers

| Name | Value | Source |
|---|---|---|
| Chain id | `1` | `deploy/mainnet/chain.env:5` |
| Players contract (registration, shop, sync, fusion, auctions) | `erd1qqqqqqqqqqqqqpgq0r72lj3ja9xj78zf52x0etdk3tvxqd3lutes0058um` | `deploy/mainnet/chain.env:6` |
| Players contract, hex (for `MultiESDTNFTTransfer` / `ESDTNFTTransfer` arguments) | `0000000000000000050078fcafca32e94d2f1c49a28cfcadb68ad860363fe2f3` | bech32-decoded from the line above |
| Tournaments contract (seat escrow, prizes, refunds) | `erd1qqqqqqqqqqqqqpgqfw3nadv3z7hj6c2x7alndtw03y5ang43utesz8nmg9` | `deploy/mainnet/chain.env:7` |
| FOXSY token | `FOXSY-5d5f3e`, 18 decimals; hex `464f5853592d356435663365` | `deploy/mainnet/chain.env:8`; decimals `contracts/foxleague-players/src/player_nft.rs:130`, `backend/src/chain_config.rs:21` |
| Player NFT collection | `FXLP-6f28e5`; hex `46584c502d366632386535` | `deploy/mainnet/chain.env:9` |
| Game server (signs sync payloads, distributes teams and prizes) | `erd1cnunps5g2x4crulxxn6fhje06yuwyepdtdm0pj2fps0s65jmcynqetfgz0` | `deploy/mainnet/chain.env:10` |
| xExchange FOXSY/WEGLD pair | `erd1qqqqqqqqqqqqqpgq5jnjpsukhl295ry3wjrd3gtff0amrgux2jpsz3reum` | `frontend/src/lib/dexSwapAddresses.ts:54-63` |
| xExchange Composable Tasks | `erd1qqqqqqqqqqqqqpgqsytkvnexypp7argk02l0rasnj57sxa542jpshkl7df` | same |
| Wrapped EGLD | `WEGLD-bd4d79` | same |

The registration relayer addresses are served live by `GET /api/config` (`relayer_addresses`) and are
not listed here on purpose.

### 1.3 HTTP conventions

- **Envelope.** Nearly every JSON route answers `ApiResponse {success, data?, error?, code?}`; absent
  fields are omitted, not null (`backend/src/models.rs:661-680`).
- **A refusal is HTTP 200 with `success:false`.** Business errors do not use 4xx codes
  (`backend/src/models.rs:692-694`). Always read `success`. Exceptions:
  - the auth extractor answers **401 with a plain-text body** (section 2);
  - `POST /api/onboarding/relay` uses real 4xx/5xx codes (section 4.4);
  - `POST /api/tournaments/{id}/delete` uses real codes (section 10.6);
  - `Idempotency-Key` header errors on tournament create are 400 (section 10.3);
  - some handlers answer a bare 500 on a database fault (for example `backend/src/routes/teams.rs:23-43`);
  - a malformed body fails JSON extraction before the handler runs (axum rejection, normally 4xx).
- **Raw JSON routes (no envelope):** `GET /api/config` (`backend/src/routes/config.rs:421`), the health
  routes (`backend/src/routes/health.rs`), `GET /api/public/match/{id}`
  (`backend/src/routes/matches.rs:612-791`). With no envelope only the HTTP status says such a route failed: the
  agent's client takes `/api/config` as the game settings only from a 2xx answer that carries `registration_fee_wei`
  as an amount, and throws for anything else (an error status with a JSON body, FoxLeague's own or an edge's), so the
  snapshot keeps `config` null with a warning and every rule refuses on "live config unavailable"
  (`src/foxleague/api.ts`, audit 2026-11-11, EDGE-6).
- **`code: "tx_pending"`** (`backend/src/models.rs:670-685`): the payment was NOT refused, it could not
  be verified yet (chain read timed out, throttled or chain not ready). Keep the transaction hash and
  confirm THAT hash again later. Never sign a second payment on a `tx_pending` answer.
- **Transaction hashes in request bodies** must be 64 hex characters; the server lower-cases them
  and rejects anything else with `a transaction hash is 64 hexadecimal characters`
  (`backend/src/tx_hash.rs:17-23`).
- **Chain not ready.** Chain-dependent routes refuse with
  `Chain is temporarily unavailable. Please retry shortly.` while the backend's liveness gate is
  closed (`backend/src/readiness.rs:10-50`). Back off and retry.
- **Wallet parameters.** Many bodies and queries carry `wallet_address`. Where a route checks it, it
  must equal the session wallet (`Wallet mismatch {EM} sign with the correct wallet` or
  `Wallet address mismatch`). Where a body struct declares it without reading it (formation, lineup,
  rename, match play), it is still **required** for JSON parsing (`backend/src/models.rs:1115-1135`,
  `backend/src/routes/matches.rs:793-797`). Send it everywhere the web app sends it.
- **Caching.** Every response carries `Cache-Control: no-store` unless a route sets its own, bodies
  are gzip-compressed on request and request bodies are capped at 5 MB by the backend
  (`backend/src/lib.rs:2194-2217`) and at 2 MB by nginx (`deploy/mainnet/nginx/foxleague-zones.conf:15`).

### 1.4 Transaction encoding conventions

The web app builds every data field by hand. The helpers are in `frontend/src/lib/tournamentTxData.ts:7-27`:

- a string argument is the hex of its UTF-8 bytes (`toHex`);
- a number argument is minimal big-endian hex, left-padded to an even length (`numberToHex`);
- a tournament id is a **16-character** zero-padded u64 (`idToHex64`, `tournamentTxData.ts:17-19`);
- whole FOXSY becomes atomic as `x * 10^18` (`foxyToSmallest`, `tournamentTxData.ts:22-27`);
- an NFT nonce is minimal hex with even length.

Useful literals (computed from the ids above):

| Value | Hex |
|---|---|
| `shopPay` | `73686f70506179` |
| `registerAndPay` | `7265676973746572416e64506179` |
| `syncMyStats` | `73796e634d795374617473` |
| `fusion` | `667573696f6e` |
| `payFusionCooldownWaiver` | `706179467573696f6e436f6f6c646f776e576169766572` |
| `payFusionMatchWaiver` | `706179467573696f6e4d61746368576169766572` |
| `auctionList` / `auctionBid` | `61756374696f6e4c697374` / `61756374696f6e426964` |
| `auctionCancel` / `auctionSettle` | `61756374696f6e43616e63656c` / `61756374696f6e536574746c65` |
| `joinTournament` / `claimRefund` | `6a6f696e546f75726e616d656e74` / `636c61696d526566756e64` |
| 10 / 20 / 100 FOXSY atomic | `8ac7230489e80000` / `01158e460913d00000` / `056bc75e2d63100000` |
| 500 / 1,000 / 2,000 FOXSY atomic | `1b1ae4d6e2ef500000` / `3635c9adc5dea00000` / `6c6b935b8bbd400000` |
| 2,500 / 5,000 FOXSY atomic | `878678326eac900000` / `010f0cf064dd59200000` |

**Four transaction shapes are used.** Getting the receiver wrong is the most common way to lose a
fee to a revert.

| Shape | Receiver | Used for |
|---|---|---|
| `ESDTTransfer@<token>@<amount>@<function>[@args]` | the contract | `registerAndPay`, `shopPay`, `auctionBid`, `joinTournament`, the WEGLD swap |
| `MultiESDTNFTTransfer@<contract hex>@<count>@<token>@<nonce>@<amount>...@<function>[@args]` | **your own address** | `syncMyStats`, `fusion`, both fusion waivers |
| `ESDTNFTTransfer@<collection>@<nonce>@01@<contract hex>@<function>[@args]` | **your own address** | `auctionList` |
| plain call `<function>@<args>` | the contract | `auctionCancel`, `auctionSettle`, `claimRefund` |

Common fields as the web app sets them: `value 0`, `gasPrice 1000000000`, `chainID "1"`. Version is
`1` for the players-contract calls (for example `frontend/src/lib/foxsyPaymentTx.ts:67-78`) and `2`
for the tournament calls (`frontend/src/lib/tournamentTx.ts:77-87`, `:195-205`), the relayed
registration (`frontend/src/pages/Onboarding.tsx:842-876`) and the swaps
(`frontend/src/lib/xexchangeSwapTx.ts:18-85`). Both versions are valid on mainnet.

### 1.5 Sending a transaction from a headless client

What the browser wallet does implicitly and an agent must do itself:

1. **Nonce.** Read the account nonce from `GET {gateway}/address/{addr}` (`data.account.nonce`),
   falling back to `GET {api}/accounts/{addr}` (`frontend/src/lib/chainBalance.ts:152-186`). The web
   app refreshes the account right before building every transaction
   (`frontend/src/pages/Onboarding.tsx:794-795`). Keep one transaction per nonce in flight.
2. **Sign** with the wallet's ed25519 key over the canonical transaction bytes (any official
   MultiversX SDK does this).
3. **Broadcast** with `POST {gateway}/transaction/send`, the same route the backend uses
   (`backend/src/chain.rs:5657`). The relayed registration is the exception: the backend broadcasts
   it (section 4.4).
4. **Wait for the outcome** (1.6), then call the backend confirm route of that flow, if it has one.

The agent books a payment before the signature and, right after the signature, puts the transaction's hash (computed
locally as the network computes it) on its ledger rows, before the broadcast (`send` in `src/executor/executor.ts`;
audit 2026-11-11, EDGE-4). A broadcast that gets no answer (a timeout, a 5xx, an unreadable body) may still have
reached the network: the payment stays booked under that hash, the activity row of the error carries it, and the
refund checks can still read what became of it (an outbid bid in `src/executor/refunds.ts`, a shop payment FoxLeague
returned in `src/executor/pending.ts`). A row is credited only on the chain's or FoxLeague's own word about that
hash, once; the gateway's own definite refusal of a transaction it does not know releases the booking as before.

**Is the chain producing blocks?** (HALT, the owner's rule after the MultiversX mainnet halt of 2026-11-17, 09:01 to
about 15:00 UTC.) `GET {gateway}/network/status/{shard}` answers `data.status.erd_block_timestamp_ms` (and
`erd_block_timestamp` in seconds): the time of that shard's newest block. Rounds last 600 ms on mainnet
(`GET {gateway}/network/config` `erd_round_duration`), so it is about a second old in normal running; the public gateway
and a MultiversX proxy both serve it (the metachain is shard `4294967295`). Before the agent signs anything it reads the
metachain, the signing wallet's shard and shard 1 (FoxLeague's players and tournaments contracts, xExchange's pair and
its composable tasks contract), at once, each kept 10 s (`Chain.newestBlockMs` and `chainHalt` in `src/chain/gateway.ts`). It signs nothing
while one of them has no block for more than 60 s (100 rounds), while one cannot be read or while one is dated more than
60 s ahead of the computer's clock, and says so ("the MultiversX network has produced no block since ... : nothing is
signed, the next plan tries again"). The check runs in the executor before anything is booked or prepared (a dry run
too) and once more right before each signature (`send`, the registration relay), where a refusal releases the booking.
An action that signs nothing (lineups, training, a casual game, a free seat) does not wait on the chain. FoxLeague's
own `GET /api/chain-status` (`{ready, paused_since}`, on `release/mainnet-1.0` since #780) answers 404 on mainnet on
2026-11-19 and is not read.

### 1.6 Deciding whether a transaction succeeded

This is load-bearing; the web app learned it through incidents (`frontend/src/lib/txFinality.ts:270-400`).

- **A reverted contract call can report `success`.** `GET {api}/transactions/{hash}` and
  `GET {gateway}/transaction/{hash}/status` report the network envelope. A revert on the contract's
  shard (the common case when your wallet is on another shard) shows up only in the node's
  **process status**. Live example cited in the source: a `payFusionMatchWaiver` from a shard-1 wallet
  to the shard-2 contract reverted while `/status` said `success` (`txFinality.ts:352-362`).
- **What the web app does** (`txFinality.ts:402-500`):
  1. poll `GET {api}/transactions/{hash}?fields=status` every 1.5 s and, after 3 s, also
     `GET {gateway}/transaction/{hash}/status`;
  2. on any `success`, require `GET {gateway}/transaction/{hash}/process-status` to answer
     `data.status == "success"`; `fail` or `invalid` is a failure and `data.reason` carries the
     contract's message;
  3. also scan `GET {gateway}/transaction/{hash}?withResults=true` for a `signalError` event: a revert
     message sits in `topics[1]` (base64), while `data` holds only the generic `user error`
     (`txFinality.ts:728-800`);
  4. foreground window 45 s, background window 120 s (`txFinality.ts:108`, `:117`). A timeout is
     "unconfirmed", not "failed": the chain may still settle and the backend reconciles.
- An unknown hash makes `/process-status` answer HTTP 500 "transaction not found" (`txFinality.ts:360-362`).
- The backend applies the same rule to every money path before crediting anything (`CHANGELOG.md:52-58`).

### 1.7 Gas limits the web app signs

The owner rule is about 1.5x the gas measured on mainnet, inside 1.1x to 1.8x. Above about 2x the
processing part, MultiversX keeps the whole limit (`frontend/src/lib/gasLimits.ts:1-14`).

| Transaction | Gas limit | Source |
|---|---|---|
| `fusion` (3 NFTs + FOXSY), the old fusion, only before the fusion switch | 22,800,000 (21,000,000 before the fusionMint upgrade of the players contract, mainnet 2026-11-13) | `gasLimits.ts` `FUSION_GAS_LIMIT` |
| `fusionMint` (from the fusion switch) | the `gas_limit` served by `POST /api/fusion/prepare` (50,000 + 1,500 a data byte + 1.5 x 21,400,000, about 33.5M), signed only between 24,300,000 and 48,600,000 | `gasLimits.ts` `fusionMintGasLimit`; `backend/src/fusion_mint.rs` `gas_limit` |
| `payFusionMatchWaiver`, `payFusionCooldownWaiver` | 17,500,000 (15,000,000 before 2026-11-13) | `gasLimits.ts` `FUSION_WAIVER_GAS_LIMIT` |
| `shopPay` (every shop product, the transfer-cooldown waiver, the paid badge) | 14,000,000 (12,864,100 from the upgrade of 2026-10-26 to 2026-11-13, 12,000,000 before) | `gasLimits.ts` `SHOP_PAY_GAS_LIMIT` |
| `joinTournament` (every tournament and 1v1 seat) | 8,400,000 (7,000,000 before the League + Knockout upgrade of the contract, live on mainnet 2026-10-24; a mainnet join used at most 7,278,069 after the private fee upgrade of 2026-11-02 and 7,448,067 after the tiered prize upgrade of 2026-11-04) | `gasLimits.ts:32` |
| `claimRefund` | 6,500,000 | `gasLimits.ts:34` |
| `auctionList` / `auctionBid` / `auctionSettle` / `auctionCancel` | 17,200,000 / 15,800,000 / 15,000,000 / 13,900,000 (15,000,000 / 13,500,000 / 13,500,000 / 12,000,000 before 2026-11-13) | `gasLimits.ts` `AUCTION_GAS` |
| `registerAndPay` (relayed) | `min(12,000,000, relayer_max_gas_limit)`: about 1.26x on the fusionMint contract, bound by the relay ceiling (12,500,000 served) | `gasLimits.ts` `registerAndPayGasLimit` |
| `syncMyStats` | served by `/api/sync/prepare` as `gas_limit`: 18,000,000 + 3,000,000 per player since the fusionMint upgrade (15,000,000 base before), at most 600,000,000; the agent signs at most 20,000,000 + 3,000,000 per player | `backend/src/routes/sync.rs` `SYNC_BASE_GAS` |
| EGLD path swap (`composeTasks`) / WEGLD path swap | 40,000,000 / 24,000,000 | `frontend/src/lib/xexchangeSwapTx.ts:18-85` |

Every contract upgrade adds about 100 gas per byte of wasm to every call, so these margins shrink
after an upgrade (`gasLimits.ts:9-11`). The players contract's fusionMint upgrade (mainnet 2026-11-13 21:32:50 UTC,
72,036 bytes, 63,693 before) adds about 834,300 to every players call; the limits above are FoxLeague's for it, each
about 1.5x of the gas used (`test/foxleague-1113/fl13-2-players-gas.test.ts` holds the agent's inside 1.4x to 1.8x). The settle limit was sized before any mainnet settle was
measured (`gasLimits.ts:36-41`).

### 1.8 Where live values come from

| Source | What it serves | Notes |
|---|---|---|
| `GET /api/config` (public, raw JSON) | Contract-mirrored prices and tunables (fusion, auctions, sync, shop, registration fee), registry values (splits, fee bounds, league floors, condition, aging, transfer cooldowns, pack), relayer and swap switches | `backend/src/routes/config.rs:36-360`, `:421-826`. Units are whole FOXSY unless the field ends in `_wei` (`config.rs:7-9`). Full field list in `ECONOMY-AND-RULES.md` |
| Contract views through `POST {gateway}/vm-values/query` with `{"scAddress", "funcName", "args": [hex...]}` | The binding on-chain values: prices, cooldowns, per-card fusion state, auctions, seat escrow | The web app does this for `isRegistrationPaid` (`frontend/src/pages/Onboarding.tsx:370-393`). A result of `"AQ=="` is `true`; an empty list is `false`/0 |
| `GET /api/shop/status` (auth) | Shop prices, booster state, training quota, pack quota | `backend/src/routes/shop.rs:730-910` |
| `GET /api/matches/daily-allowance` (auth) | Match count today, cap, reset hour | `backend/src/routes/matches.rs:527-570` |
| `GET /api/openapi.json` (public, raw JSON) | The API description, an OpenAPI 3.1 document of every route a player uses: paths, parameters, bodies and answers | `backend/src/openapi/mod.rs` (`SPEC_PATH`; served on chain `1` only, 404 elsewhere; cacheable 5 minutes); the same document as `docs/manual/openapi.json`, pinned by `the_committed_spec_is_the_generated_spec`. The agent's hourly look compares the shape of each route it calls (`src/foxleague/api-routes.ts`) with the record `sync-manual` writes (`src/foxleague/api-shapes.json`, audit 2026-11-16, P-W4). `GET /api/whitelist/check`, which the agent calls, is not in it |

Not public anywhere (the K values are 9 ranked, 13 Silver, 17 Gold since 2026-10-30, set by hand on mainnet): ELO K factors, ELO decay parameters, the per-card daily XP cap, the training
condition cost, the aging multiplier, the match and ranked cooldowns and the tournament strategy-lock
lead. Use the documented values and treat the server's refusal as the truth.

---

## 2. Login and sessions

**Purpose.** Exchange a signed message for an opaque session token (a UUID) used as a Bearer token.

**How the web app does it** (`frontend/src/lib/auth.ts:32-59`, `frontend/src/lib/authMessage.ts:16-18`):

1. `timestamp = floor(now_ms / 1000)` (Unix **seconds**).
2. Message text: `foxleague:chain=1:auth-{timestamp}` (`backend/src/auth.rs:421-423`).
3. Sign it as a **MultiversX signed message**: the signed bytes are
   `keccak256("\x17Elrond Signed Message:\n" + len(message) + message)`, where `len` is the decimal
   byte length (`backend/src/auth.rs:22-23`, `:438-469`). Any SDK's message signer produces this.
4. `POST /api/auth/verify` with `{"address": "erd1...", "timestamp": <int>, "signature": "<128 hex chars>"}`.
5. Response `{"success": true, "data": {"token": "<uuid>"}}` (`backend/src/routes/auth_routes.rs:279-281`).
6. Send `Authorization: Bearer <uuid>` on every authed request (`frontend/src/lib/api.ts:165-171`).

**A headless client does exactly the same** with its own key: no browser, captcha or origin check is
involved (CORS binds browsers only). The first successful verify creates the user row
(`is_whitelisted=false`, league from the seed ELO), so login is never gated on registration or on the
whitelist (`backend/src/routes/auth_routes.rs:158-205`).

**Rules.**

- The timestamp must be within **300 s** of server time, in either direction (`backend/src/auth.rs:48`, `:73-75`).
- Each signature is single-use inside that window (replay cache, `backend/src/routes/auth_routes.rs:84-96`).
  Sign a fresh message for every login.
- Session lifetime: `auth.session_ttl_seconds`, default 86,400 s, range 300 s to 30 days
  (`backend/src/routes/auth_routes.rs:252-259`). There is no refresh route: sign again on a 401.
  The web app re-signs once on a 401 and replays the request (`frontend/src/lib/api.ts:210-260`).
- The legacy message `foxleague-auth-{ts}` is still accepted but logged as a warning; do not use it
  (`backend/src/routes/auth_routes.rs:123-156`).

**Other auth routes.**

- `GET /api/auth/check` (auth) returns `{wallet_address}`: a cheap session ping (`auth_routes.rs:36-40`).
- `POST /api/auth/revoke` (auth) deletes the session of the presented token and returns `{revoked}`
  (`auth_routes.rs:24`, `:360-406`).

**Failures.**

| Where | Answer |
|---|---|
| verify, bad address | 200 `Invalid wallet address: {e}` (`auth_routes.rs:62-64`) |
| verify, stale timestamp | 200 `Auth token expired` (`auth_routes.rs:70-73`) |
| verify, reused signature | 200 `signature_replayed` (`auth_routes.rs:84-96`) |
| verify, bad signature | 200 `Signature verification failed` (`auth_routes.rs:140`) |
| verify, database | 200 `Internal error` / `Failed to create session` |
| any authed route | **401 plain text**: `Missing Authorization header`, `Invalid Authorization format`, `Invalid session token`, `Session expired or invalid` (`backend/src/auth.rs:233-291`) |
| any authed route, database | 500 `Session lookup failed` |

Routes that take an optional session (`Option<AuthenticatedWallet>`) treat a bad token as anonymous
without an error (`backend/src/auth.rs:392-412`).

---

## 3. Reading your own state

### 3.1 Are you registered? `GET /api/users/{address}`

Public (`backend/src/routes/leaderboard.rs:17`, `:437-477`). Returns `UserPublicProfileView`
(`backend/src/models.rs:797-837`):

| Field | Meaning |
|---|---|
| `id`, `wallet_address`, `username` | Identity |
| `elo_rating`, `league` | ELO (new teams start at 1200) and league (`Bronze` to `Diamond`) |
| `matches_won`, `matches_lost`, `matches_drawn` | Lifetime record |
| `team_name`, `badge` | **`team_name` null means not registered** (`frontend/src/App.tsx:304-313`) |
| `verified`, `tournament_wins`, `active_title`, `player_count` | Checkmark, titles, roster size |
| `is_developer`, `developer_team_name` | Developer-mode team, if any |

Errors: `User not found` (no login yet), `DB error`.

### 3.2 Your team: `GET /api/teams/{address}`

Since the mainnet release of 2026-09-30 the full `Team` goes to the team's own session only (send the
`Authorization` header of that wallet): everyone else gets `TeamPublicView`, the team without `formation`,
`lineup`, `substitutes` and `team_overall` (`backend/src/routes/teams.rs:109-135`, `backend/src/models.rs:240-270`).
A stale session is answered 401, never the public view. A rival's eleven can therefore no longer be read; its
roster (`GET /api/players/{address}`) still can. The address is matched exactly. `Team`
(`backend/src/models.rs:203-239`):

| Field | Meaning |
|---|---|
| `id`, `user_id`, `name`, `coach_name` | Identity |
| `formation` | One of the nine ids in section 8.1 |
| `lineup` | 11 NFT nonces; index 0 is the goalkeeper slot |
| `substitutes` | Up to 7 nonces (the server auto-fills to 7 on save) |
| `team_overall` | Average live OVR of the lineup, computed only when the lineup is saved, so it goes stale (`teams.rs:396-408`) |
| `badge`, `badge_ipfs_uri` | `ipfs://<cid>` (or a legacy base64 image) |
| `verified`, `created_at` | |

ELO, league and record live on the user (3.1), not on the team. Error: `Team not found`.

### 3.3 Your players: `GET /api/players/{address}`

Public (`backend/src/routes/players.rs:19`, `:35-49` via `backend/src/services/roster_chain_view.rs:170-187`).

- The roster is **your on-chain holdings intersected with the backend cache**: cards that left the
  wallet (including cards escrowed in an auction) are excluded; cards only on chain are imported
  lazily (`roster_chain_view.rs:125-140`, `:233-310`). If the chain read fails it falls back to the
  cache alone.
- **30 s server cache per wallet, never invalidated** (`roster_chain_view.rs:57`, `:175-186`). Right
  after a training, match or sync, read single cards with `GET /api/players/nonce/{nonce}`, which is
  fresh (`players.rs:20`, `:52-70`).
- Condition is regeneration-adjusted at read time (`roster_chain_view.rs:178-180`).

`PlayerCache` fields (`backend/src/models.rs:250-380`), grouped:

| Group | Fields | Notes |
|---|---|---|
| Identity | `nft_nonce`, `owner_address`, `name`, `position` (`GK`/`DEF`/`MID`/`FWD`), `rarity` (`Common`..`Legendary`), `shirt_number`, `country`, `portrait_uri` | |
| Live stats (off chain) | `speed`, `accuracy`, `defense`, `power`, `control`, `vision`, `stamina`; `level`, `experience`; per-stat XP pools `speed_xp` .. `stamina_xp` | Grown by training and match XP. A stat gains +1 when its pool reaches `training.xp_threshold_per_level` (2000 on mainnet) |
| Synced stats (on chain) | `*_synced`, `level_synced`, `experience_synced` | **Matches use only these**, capped by rarity (`backend/src/models.rs:508-531`) |
| Sync flag | `stats_dirty` | True while live values differ from the on-chain snapshot. Set by every training and every match appearance, recomputed after a sync (`backend/src/db.rs:57-140`, `:680-744`) |
| Condition | `condition` (0-100, already regenerated), `condition_updated_at` | Regeneration and drain in section 9.6 |
| Career | `matches_played`, `goals`, `assists`, `passes`, `tackles`, `shots_on_target`, `catches` | Every appearance |
| Fusion counters | `competitive_matches`, `fusion_match_credit`, `fusion_ready_at` (null = ready), `fused_at` | `competitive_matches` is what sync writes on chain as `matches_played` (section 7) |
| Market | `listed_for_sale`, `sale_price` (whole FOXSY) | |
| Transfers | `transferred_at`, `transfer_cooldown_hours` (null = the live default, 504) | The card cannot play until the cooldown ends |
| Age | `minted_at`, `acquired_at` | Age is not served: `18 + days_since(minted_at) / 52` (`backend/src/db.rs:514-521`) |

Whether a card is in your lineup is not a player field: derive it from `Team.lineup` and
`Team.substitutes`.

### 3.4 Balances and NFTs (read from the chain)

There is no player-facing balance route; the web app reads the chain directly
(`frontend/src/lib/chainBalance.ts:32-186`):

| What | Primary | Fallback |
|---|---|---|
| FOXSY | `GET {gateway}/address/{addr}/esdt/FOXSY-5d5f3e` then `data.tokenData.balance` | `GET {api}/accounts/{addr}/tokens/FOXSY-5d5f3e` then `balance` (404 "not found" means 0) |
| EGLD and nonce | `GET {gateway}/address/{addr}` then `data.account.balance` / `.nonce` | `GET {api}/accounts/{addr}` |
| Player NFTs (how the backend reads them) | `GET {gateway}/address/{addr}/esdt`, keys starting with `FXLP-6f28e5-` (`backend/src/chain.rs:5954`) | `GET {api}/accounts/{addr}/nfts?collection=FXLP-6f28e5&size=10000` (`backend/src/chain.rs:6124`) |

Both tokens have 18 decimals. The web app flags "low EGLD" under 0.01 EGLD
(`chainBalance.ts:22-23`, `:204-206`). It polls the header balance every 20 s and after every spend
(`frontend/src/components/Layout.tsx:53-211`).

### 3.5 Other own-state reads

| Route | Auth | Returns | Source |
|---|---|---|---|
| `GET /api/shop/status?wallet_address=` | auth, must match | booster state, flat (`xp_booster_active` bool, `xp_booster_expires_at` RFC 3339 or null; a failed booster query on the server reads as inactive, `shop.rs:794-816`), shop prices, training quota (`daily_free`, `premium_cap`, `used_today`, `premium_used_today`, `slots_banked`), Common pack quota | `backend/src/routes/shop.rs:52-142`, `:730-910` |
| `GET /api/matches/daily-allowance?wallet_address=` | auth, must match | `{today_count, daily_limit, reset_hour_utc}` | `backend/src/routes/matches.rs:527-570` |
| `GET /api/matches/active?wallet_address=` | auth, must match | the match you are in right now or `null`: `{match_id, is_home, home_team_name, away_team_name, status, tm_game_id, created_at, kind ("ranked"/"challenge"/"tournament"), tournament_id, tournament_title, opponent_badge}`; a ranked or casual match being played (`pending`, `simulating`) first, then one whose broadcast still airs (`finished`, since rc.85 for every such match: section 9.2) | `matches.rs:6340-6500` |
| `GET /api/tournaments/my` | auth | `{active[], completed[]}` tournaments you play in or created | `backend/src/routes/tournaments.rs:6652-6907` |
| `GET /api/tournaments/upcoming-matches` | auth | your scheduled tournament matches with `strategy_locks_at` (section 10.8) | `tournaments.rs:6320-6595` |
| `GET /api/tournaments/my-squad` | auth | your CURRENT squad as a tournament would snapshot it (`null` if you cannot field a legal 11 + 7) | `tournaments.rs:6597-6650` |
| `GET /api/shop/purchases?wallet_address=&limit=&offset=` | auth, must match | your shop history | `shop.rs:4004-4046` |
| `GET /api/marketplace/fusion-history?limit=&offset=` | auth | your fusions | `backend/src/routes/marketplace.rs:2213-2317` |
| `GET /api/notifications/challenges-for-me` | auth | open 1v1 challenges that target you | `backend/src/routes/leaderboard.rs:480-579` |
| `GET /api/notifications?limit=&before_id=`, `GET /api/notifications/unread-count`, `POST /api/notifications/read {ids?, all?}` | auth | your notification feed; `limit` default 30, max 100 | `backend/src/routes/notifications.rs:35-236` |
| `GET` / `PUT /api/notifications/preferences` | auth | per-category mute (`matches`, `challenges`, `tournaments`, `marketplace`, `fusion`, `transfers`) | `notifications.rs:39-42`, `:263-329` |
| `POST /api/notifications/ws-ticket` then `wss://.../ws/notifications?ticket=` | auth | push feed: `{"type":"connected"}`, then `{"type":"notification", id, kind, title, body, href, created_at, unread_count}`; the ticket is single-use with a 30 s TTL | `notifications.rs:343-372`; `backend/src/notifications.rs:478-514` |


---

## 4. Registration

**Purpose.** Pay the one-time fee on chain, create the team and receive an 18-card starter squad.

### 4.1 Cost and what you get

- **Fee: 5,000 FOXSY**, exact amount, once per wallet, **not refundable** once the team exists
  (`deploy/mainnet/chain-config.mainnet.env:15`; `docs/manual/src/content/docs/legal/terms.md:43`).
  Live: `/api/config` `registration_fee_wei` (contract view `getRegistrationFee`) and
  `registration_fee_foxsy_wei` (the relay's cross-check key). They must be equal
  (`backend/src/routes/config.rs:248-316`).
- **Gas: none.** Registration is the one relayed transaction: a FoxLeague relayer pays its network
  fee (section 16). The web app offers no self-paid registration (manual
  `mechanics/economy-map.mdx:58`). The contract itself would accept the same `registerAndPay` sent and
  paid by the wallet, but then the stock, whitelist and switch checks run only after the
  non-refundable fee has moved; the relay runs them before anything is spent.
- **Squad:** 18 cards drawn from a pre-minted pool: 10 Common, 4 Uncommon, 2 Rare, 1 Epic,
  1 Legendary; positions 2 GK, 6 DEF, 6 MID, 4 FWD (`backend/src/routes/registration.rs:1227`, `:1350-1396`).
  A missing rarity falls back to the next lower one. On chain one wallet gets one starter team,
  18 cards for life (`contracts/foxleague-players/src/player_nft.rs:133-141`, `:1510-1514`).

### 4.2 Preconditions and gates

| Gate | How to check before paying | Source |
|---|---|---|
| Not yet registered | `GET /api/users/{addr}` has `team_name` null | `backend/src/routes/leaderboard.rs:437-477` |
| Fee not already paid on chain | view `isRegistrationPaid(<pubkey hex>)` on the players contract | `frontend/src/pages/Onboarding.tsx:370-393` |
| Registration open | `/api/config` `relayer_v3_enabled` true and `relays_remaining_today` > 0 | `backend/src/routes/config.rs:558-607` |
| Starter stock | Not public since 2026-10-12: `GET /api/register/pool-status` was removed (audit, Low); the operator's numbers are admin-only. Registration answers itself when no squad is left | FoxLeague #420 |
| Whitelist | `GET /api/whitelist/check?wallet_address=` (public) returns `{is_whitelisted}`; always true when the whitelist switch is off | `backend/src/routes/admin.rs:148`, `:5902-5957` |
| FOXSY balance | at least the fee (section 3.4; buy it with section 5) | `Onboarding.tsx:818-830` |
| Team name | see 4.3 | |

The whitelist switch `registration.whitelist_required` defaults to `"true"` in code
(`backend/src/config_registry.rs:1835-1839`) and is not seeded; the owner planned to switch it off in
the admin panel for launch (`CHANGELOG.md:627-629`; launch moved to 28 September,
`frontend/src/lib/launch.ts:1-6`). Read `/api/whitelist/check` at runtime.

### 4.3 Team name rules and uniqueness

- **Server rules** (`backend/src/routes/registration.rs:341-344`): trimmed, **3 to 15 bytes** (bytes,
  not characters), Unicode letters or digits, space or `-`. An apostrophe is **refused** by the server
  even though the web form's regex allows it (`frontend/src/pages/Onboarding.tsx:560-575`).
  Safe choice: ASCII `[A-Za-z0-9 -]`, 3 to 15 long.
- **Uniqueness ignores case, spaces and hyphens**: the database index is
  `LOWER(REPLACE(REPLACE(name,' ',''),'-',''))` (`backend/migrations/087_team_name_normalized_unique.sql:13-14`).
  `Fox League` and `fox-league` collide.
- **No availability route exists.** `GET /api/users/search?q=` does a substring match on the raw name
  and does not normalise, so it can miss a collision (`leaderboard.rs:358-418`). The name is checked
  only by `POST /api/register`, **after** the fee is on chain.
- **A taken name after paying costs nothing extra:** the payment stays recorded on chain
  (`isRegistrationPaid`), so call `POST /api/register` again with another name. No second payment
  and no refund are needed (`registration.rs:383-395`, `:745`). A simultaneous insert that races the
  unique index answers HTTP 500 (`registration.rs:902-912`).
- Rename later with `POST /api/teams/rename {wallet_address, name}` (auth): same rules, free, no
  cooldown found (`backend/src/routes/teams.rs:459-541`). Errors: `Team name must be 3-15 characters`,
  `Only letters, numbers, spaces and hyphens allowed`, `That team name is already taken`.
- Coach name: `POST /api/teams/coach {coach_name}` (auth), at most 20 characters, letters, digits,
  space, `-` and `.`; empty clears it (`teams.rs:55-104`).

### 4.4 The sequence the web app runs

Source: `frontend/src/pages/Onboarding.tsx:629-968`.

1. `GET /api/config`: read `relayer_v3_enabled`, `relayer_addresses`, `relayer_max_gas_limit`,
   `registration_fee_foxsy_wei`, `registration_fee_wei`, `foxsy_token_id`.
2. (Optional) `POST /api/onboarding/generate-badge {team_name}` (4.6).
3. `GET /api/onboarding/check-eligibility` (auth, always 200):
   `{nft_count, can_skip_mint, nft_bypass_threshold: 18, has_existing_team, is_whitelisted, is_registration_paid}`
   (`backend/src/routes/onboarding.rs:735-900`). If `can_skip_mint` (the wallet already holds 18 or
   more `FXLP` cards and never paid), skip the payment and go to step 7: registration is free and no
   cards are drawn (`registration.rs:88`, `:413-667`).
4. Re-read `isRegistrationPaid`. If true, skip the payment and go to step 7 (`Onboarding.tsx:724-759`).
5. **Build and sign the relayed transaction** (`Onboarding.tsx:798-876`):

   | Field | Value |
   |---|---|
   | `sender` | your address |
   | `receiver` | players contract |
   | `value` | `0` |
   | `data` | `ESDTTransfer@464f5853592d356435663365@<fee atomic hex>@7265676973746572416e64506179` (no further arguments). At 5,000 FOXSY: `ESDTTransfer@464f5853592d356435663365@010f0cf064dd59200000@7265676973746572416e64506179` |
   | `gasLimit` | `min(12000000, relayer_max_gas_limit)`; 9,900,000 if the config has no ceiling (`frontend/src/lib/gasLimits.ts:51-69`) |
   | `gasPrice` | `1000000000` (the relay refuses anything else) |
   | `chainID`, `version`, `options` | `"1"`, `2`, `0` |
   | `nonce` | your own account nonce |
   | `relayer` | the `relayer_addresses` entry **on your shard** |

   Shard rule (3 shards) used on both sides: take the last byte `b` of the public key; `s = b & 0b11`;
   if `s > 2` then `s = b & 0b01` (`Onboarding.tsx:801-816`; `backend/src/relayer_pool.rs:183-203`).
   Error when none matches: `No relayer available for shard {n}. Please try again in a moment.`

6. `POST /api/onboarding/relay` (auth) with `{"signed_tx": <plain object>}`. Response
   `{success:true, data:{tx_hash, relayer_shard, relayer_address}}` (`onboarding.rs:1335-1345`, `:2462-2471`).
   The backend adds `relayerSignature` and broadcasts. Then wait for the outcome (1.6).
7. `POST /api/register` (auth) with `{"team_name": "...", "badge_ipfs_uri": "ipfs://..."}` (badge
   optional; alias `badge`). The web app also sends `wallet_address`, which is ignored
   (`backend/src/models.rs:1140-1149`; `frontend/src/lib/api.ts:383-397`). Response
   `{user_id, team_name, players, nonces[]}` (`models.rs:1154-1159`).
8. `GET /api/players/{addr}` to load the squad.

**The plain object for step 6.** The web app sends sdk-core's `toPlainObject()`; key order in the
backend's fixture is `nonce, value, receiver, sender, gasPrice, gasLimit, data, chainID, version,
relayer, signature, guardianSignature, relayerSignature`, with `gasPrice` and `gasLimit` as JSON
numbers, `value` as a string, `data` base64 and `signature` hex (`onboarding.rs:1539-1545`,
`:2947-2968`, fixture `:3761-3776`). The backend strips the three signature keys, serialises the rest
**in the order received** and signs those bytes (`onboarding.rs:2336-2379`; `backend/src/chain.rs:14-80`).
Build the object with an official SDK serializer, not by hand.

**`POST /api/register` blocks.** It waits until the wallet holds 18 cards, polling each second for up
to 30 s. It answers success even after that timeout (`registration.rs:1136-1197`). Give it an HTTP
timeout above 35 s; after a client timeout, re-check `GET /api/users/{addr}` before retrying. The
cards are delivered by the game server (`distributeTeam`) and the best eleven is picked in the
background (`registration.rs:931-957`).

### 4.5 Failure modes

**Relay** (`backend/src/routes/onboarding.rs`, guards in this order; body `{success:false, error}`):

| HTTP | `error` | Line |
|---|---|---|
| 503 | `Relayer V3 is disabled` | 1858-1883 |
| 503 | `Registration is currently disabled` | 1885-1937 |
| 503 | `No starter squads in stock right now: your fee was not taken. Please try again later.` | 1839 |
| 500 | `chain client unavailable` / `on-chain registration check failed: {e}` | 1959, 1982 |
| 403 | `G6: wallet already registered on-chain` | 2000 |
| 403 / 500 | `Wallet not whitelisted` / `could not check the whitelist right now; nothing was sent, please retry` | 2021, 2037 |
| 403 | `wallet holds {n} FOXSY but the registration fee is {m} FOXSY` | 2042-2090 |
| 429 | `G9: rate limit {EM} max {n} relay calls per {s}s per wallet` (default 3 per 600 s) | 2092-2146 |
| 503 | `G10: relayer daily cap {cap} reached` (default 5,000) | 2148-2193 |
| 409 | `Your registration payment is already on its way. Nothing new was sent. ...` (G17, a relay of the wallet still in flight; held until it is final, 300 s by default) | #717, `relay_registration` |
| 409 | `Your wallet has another transaction still being processed. Nothing was sent. ...` (G16, a transaction of the wallet waiting in the pool) | #717 |
| 403 | `The transaction does not carry your wallet's next transaction number. ...` (G16) and `Your last relayed registration failed on chain, so FoxLeague does not pay the network fee for this wallet for now. ...` (G18, 24 h by default) | #717 |
| 500 | `Could not check your wallet on chain. Nothing was sent...` (G16 read) and `Could not check your FOXSY balance on chain. Nothing was sent...` (G14 read, which let the relay through before #717) | #717 |
| 503 / 400 | `relayer pool not configured`, `bad wallet bech32: {e}`, `no relayer loaded for shard {s} (wallet shard)` | 2201-2215 |
| 503 | `registration fee is misconfigured {EM} relay unavailable` | 2221-2263 |
| 403 | `G2: tx sender {} != authenticated wallet {}` | 1727 |
| 403 | `G3: tx receiver {} != player NFT SC {}` | 1734 |
| 403 | `G4: invalid data payload {EM} {detail}` (exactly four `@` parts, `ESDTTransfer`, the FOXSY token, `registerAndPay`) | 1455-1490, 1740 |
| 403 | `G5: tx amount {} wei != canonical fee {} wei` | 1491-1506, 1745 |
| 403 | `G7: tx.relayer {} != shard-routed relayer {}` | 1752 |
| 403 | `G8: chainID {} != configured chain {}` | 1758 |
| 403 | `G11: gasPrice {:?} != canonical {} (the relayer pays this)` | 1767 |
| 403 | `G12: gasLimit {:?} exceeds max {}` | 1773 |
| 403 | `G13: value must be "0" for ESDTTransfer, got {:?}` | 1777 |
| 500 | `serialize inner tx failed: {e}`, `relayer sign failed: {e}`, `gateway broadcast failed: {e}` | 2374, 2403, 2432 |

A G9 slot is used as soon as a call reaches G9, even when a later guard refuses it; a G10 slot is
given back on every error (`onboarding.rs:2140-2144`, `:2181-2195`). Validate everything locally
before calling the relay.

**What the agent keeps booked after the relay** (audit 2026-11-11, INTEG-4, MONEY-3 and EDGE-3; `src/executor/executor.ts`,
the `register` case). The fee is booked in the one-time setup budget before the signature. After the relay's answer:

- FoxLeague's own refusal (its envelope) with HTTP 403, 409, 429 or 503 is a guard that runs before the broadcast
  (`routes/onboarding.rs` `relay_registration`; 409 since FoxLeague #717, mainnet 2026-11-11, FL13-1): nothing was sent
  and the booking is released. Its 400 (the wallet address) stays on the careful side (MONEY-3). The client carries the
  status on the refusal (`ApiRefusal.httpStatus`).
- Its HTTP 500 is also what a failed broadcast answers (`The registration could not be sent to the network...`), and a
  broadcast that failed for FoxLeague may still have reached the network. That, an answer that is not its envelope and
  no answer at all keep the fee booked.
- The contract takes the fee once per wallet (`Already paid registration`). So a later registration whose snapshot
  reads `isRegistrationPaid` false counts the fee once: the earlier booking is left out of its setup-budget check, and
  it is let go only when the new registration's own booking is kept (signed, and not released by a guard or a revert).
  From the first signature on, one booking always stands for the fee: an earlier payment that lands late is never
  left uncounted, and a registration that never happened no longer refuses the next one for good. The same holds in
  the dry-run ledger, where every simulated registration replaces the one before. The plan of a team that does not
  exist yet reads its setup budget without that booking (`budgetView` with `registered` false).

**Contract** (`registerAndPay`, `contracts/foxleague-players/src/player_nft.rs:1217-1259`):
`Contract is paused`, `Registration fee not set`, `Payment must be FOXSY`,
`FOXSY is a fungible token (nonce must be 0)`, `Payment must match registration fee exactly`,
`Already paid registration`, `This wallet already received its starter team`. A revert costs the
relayer's gas, not your FOXSY.

**Register** (`backend/src/routes/registration.rs`, in order): `Team name must be 3-15 characters` (341),
`Team name can only contain letters, numbers, spaces and hyphens` (344), `Already registered` (359),
`Registration is currently disabled` (368-375), `That team name is already taken` (383-395),
`Unable to verify your on-chain registration status right now. Please retry in a moment; no payment is needed.` (445),
`Wallet not whitelisted` (684), `Chain client unavailable; cannot verify on-chain registration payment.` (722),
`Registration fee not paid on-chain. Submit the registerAndPay transaction first, then retry registration.` (745),
`Unable to verify on-chain registration payment right now. Please retry in a moment.` (766),
`Not enough players in pool ({n} slots unfilled: {..})` (1590-1600).

A cross-shard registration can answer `Registration fee not paid on-chain...` for a few seconds after
the envelope said `success`. Wait for `/process-status` (1.6), then retry `/api/register`; never relay
a second payment (the relay answers `G6` and the contract `Already paid registration`).

### 4.6 Badge

- `POST /api/onboarding/generate-badge {team_name, payment_tx_hash?}` (auth) generates an AI badge,
  pins three JPEG sizes on FoxLeague's IPFS node and returns
  `{badge_ipfs_uri: "ipfs://<cid>", team_name, regenerations_used, regenerations_max}`
  (`backend/src/routes/onboarding.rs:245-709`). Free before registration; after registration the
  first 3 regenerations are free, then **1,000 FOXSY** each (`backend/src/config_registry.rs:1747-1754`).
  Rate limit: 3 per 10 min per wallet (`onboarding.rs:35-82`).
- When payment is due the route answers `success:false` with
  `data:{payment_required:true, cost_foxsy, free_regens, regen_count}` and
  `You've used your {n} free badge regenerations. The next one costs {c} FOXSY.` (`onboarding.rs:352-364`).
  Pay with the `shopPay` data field (section 12.1) for exactly `cost_foxsy`, wait for the outcome, then
  call again with `payment_tx_hash` (verified as `shopPay`, FOXSY, at least the cost, `onboarding.rs:929-965`).
  A `tx_pending` answer means retry with the same hash.
- Other errors: `Team name must be 1-15 characters`,
  `Too many badge generation requests. Please wait a few minutes.`, `Image generation failed: {e}`,
  `Badge upload failed: {e}. Please try again in a moment.`,
  `Badge service temporarily unavailable {EM} please retry.` (`onboarding.rs:254-492`).
- `POST /api/teams/badge {badge_ipfs_uri}` (auth) saves a URI that starts with `ipfs://`
  (`backend/src/routes/teams.rs:548-620`). There is no upload route for a custom image.

---

## 5. EGLD to FOXSY swap

**Purpose.** Buy the FOXSY a registration (or a top-up) needs, on xExchange's FOXSY/WEGLD pool, as
the onboarding "Card B" and the Dashboard swap do. It is an ordinary DEX trade signed and paid by the
user; FoxLeague is not a party to it.

**Gating.** The web app shows it only on a mainnet build with the committed DEX addresses and
`/api/config` `dex_swap_enabled` true (key `onboarding.dex_swap_enabled`, code default 0)
(`frontend/src/lib/onboardingSwapMode.ts:12-20`; `backend/src/config_registry.rs:2260-2261`). The pool
itself is public.

**Quote** (`frontend/src/lib/xexchangeQuote.ts:53-118`; `frontend/src/lib/xexchangeSwap.ts`), all by
`vm-values/query` on the pair:

1. `getState` must be 1 (active); `getFirstTokenId` / `getSecondTokenId` must be FOXSY / WEGLD.
2. `missing = fee - FOXSY balance` (atomic) (`xexchangeSwap.ts:149-151`).
3. `amountIn = getAmountIn(hex("FOXSY-5d5f3e"), hex(missing))`.
4. `maxIn = floor(amountIn * (10000 + bps) / 10000)`, `bps = dex_swap_slippage_bps` (default 100,
   clamped 10..300) (`xexchangeSwap.ts:38-40`, `:154-167`; `backend/src/routes/config.rs:840-853`).
5. Refuse when the quote is more than 5 percent above spot from `getReservesAndTotalSupply`
   (`xexchangeSwap.ts:186-189`). The pair fee is 0.3 percent (`xexchangeSwap.ts:65-67`).
6. Re-quote right before signing and abort if the fresh `amountIn > maxIn`
   (`frontend/src/components/FoxsySwapModal.tsx:332-351`).

**Path choice** (`xexchangeSwap.ts:214-230`): the WEGLD path when WEGLD >= `maxIn` and EGLD >= 0.001;
otherwise the EGLD path when EGLD >= `maxIn + 0.01`.

**Transactions** (`frontend/src/lib/xexchangeSwapTx.ts:18-85`; version 2, gasPrice 1e9, never relayed):

- **EGLD path**, receiver = Composable Tasks, `value = maxIn`, gas 40,000,000. Fixed input, minimum
  output = `missing`; any surplus arrives as FOXSY:
  `composeTasks@<nested(token out) + 0000000000000000 + nested(missing)>@@@02@<nested("swapTokensFixedInput") + nested(token out) + nested(missing)>`,
  where nested = 4-byte big-endian length + bytes (`xexchangeSwap.ts:112-124`). Mainnet example for
  5,000 FOXSY (`frontend/src/lib/xexchangeSwap.test.ts:63`):
  `composeTasks@0000000c464f5853592d35643566336500000000000000000000000a010f0cf064dd59200000@@@02@0000001473776170546f6b656e734669786564496e7075740000000c464f5853592d3564356633650000000a010f0cf064dd59200000`.
  The wrap to WEGLD happens inside the composer; no separate wrap transaction is sent.
- **WEGLD path**, receiver = the pair, value 0, gas 24,000,000. Exactly `missing` out; unused WEGLD
  is refunded:
  `ESDTTransfer@5745474c442d626434643739@<maxIn hex>@73776170546f6b656e7346697865644f7574707574@464f5853592d356435663365@<missing hex>`
  (example at `xexchangeSwap.test.ts:75`).

**Confirmation.** Wait for the outcome (1.6), then poll the FOXSY balance each second for up to 30 s
until it reaches the target; a cross-shard wallet receives it a few blocks later
(`FoxsySwapModal.tsx:101`, `:411-463`). A revert is atomic and costs only gas. The web app refuses to
start a second swap while one from the wallet to the composer or pair is pending
(`frontend/src/lib/pendingDexSwapOnChain.ts`).

**Limits.** The Dashboard top-up is capped at `dex_swap_max_foxsy` (default 50,000, clamped 1,000 to
1,000,000) (`frontend/src/components/DashboardFoxsySwap.tsx:1-16`; `config_registry.rs:2276-2279`).
The card or bank on-ramp is "coming soon" on mainnet; the app links to Ramp's public page and
xPortal only (`frontend/src/lib/community.ts:21`, `:30`).

---

## 6. Training

**Purpose.** Grow one stat of one player through its XP pool. Off chain; the result reaches matches
only after a sync (section 7).

**API.** `POST /api/training/train` (auth) with `{"player_nonce": <i64>, "attribute": "speed"|"accuracy"|"defense"|"power"|"control"|"vision"|"stamina"}`
(`backend/src/routes/training.rs:192-203`, `:207`, `:219`). The owner is always the session wallet.

**Gates, in order** (`training.rs`):

| Gate | Error | Source |
|---|---|---|
| One request per `training.cooldown_ms` (500 ms) per wallet | `Training too fast {EM} wait a moment` | 114-129, 251 |
| Attribute name | `Invalid attribute. Choose: speed, accuracy, defense, power, control, vision, stamina` | 258 |
| Registered, card exists | `Not registered`, `Player not found` | 266, 279 |
| You own the card (row locked) | `You don't own this player` | 285, 571 |
| Regenerated condition >= `min_field_condition` (30) | `Player needs to rest {EM} at least {min} condition is required to train. Condition recovers naturally over time.` | 25-33, 292-301 |
| At most 15 sessions per wallet per day (5 free + 10 paid) since 14:00 UTC | `Daily training cap reached ({used}/{max} for today). {banked} banked slots available {EM} try tomorrow.` | 320-354, 503-518 |
| Sessions 6 and later consume one banked paid slot | `Daily training limit reached ({used}/{free}). Buy slots in the shop or try again tomorrow.` | 579-621, 589-592 |

The cap is **per wallet**, not per player. Paid slots are bought in the shop (section 12.2 C), are
banked and never expire.

**Effect** (one database transaction, `training.rs:455-742`):

- XP earned = `round(20 * condition / 100)`, doubled (floor) by an active XP booster (`training.rs:357`,
  `:365-430`). Tournament XP rewards do not apply to training.
- The chosen stat's pool grows; at 2,000 XP the stat gains +1 and the excess carries over. XP on a stat
  already at its rarity cap (Common 30, Uncommon 55, Rare 75, Epic 90, Legendary 100) is discarded,
  but the session still costs condition and a slot (`training.rs:628-641`).
- Condition drops by the age-ramped training cost (base 5, up to 15 at age 39) after regeneration is
  applied (`training.rs:443-450`, `:660-670`).
- `stats_dirty` is set to true on every session, even without a stat bump (`training.rs:667`).
- Response: `{attribute, stats:{<attr>:{before, after, increased}}, any_increased, xp_gained, condition_after, slots_used, slots_max}`
  (`training.rs:745-765`).

Quota view: `GET /api/shop/status` `training` block (section 3.5). The handler's doc comment
(`training.rs:213-218`, base 50 XP) is stale; the code uses 20.

---

## 7. Sync to chain

**Purpose.** Write the live stats, level, XP, condition and the competitive-match counter of your
cards into their NFT attributes. Matches, tournament snapshots, fusion and listings read the on-chain
values, so training and competitive matches count only after a sync.

**Cost.** `getSyncCost` per card: **10 FOXSY** on mainnet (`deploy/mainnet/chain-config.mainnet.env:24`;
live `/api/config` `sync_cost_foxsy`). Plus network gas.

**Which cards.** `stats_dirty` cards (section 3.3). The flag is set by every training session and every
match appearance, even when no synced field would change; `prepare` charges for every dirty card.
Compare the live fields with the `*_synced` fields before paying if you only care about stats.

### 7.1 `GET /api/sync/prepare?wallet_address=<own>[&nonce=<n>]` (auth)

`backend/src/routes/sync.rs:288`. Without `nonce` it takes **every** dirty card of the wallet (lineup
or not) that is in the wallet on chain right now (listed cards are excluded); with `nonce`, only that
card. There is no subset option (`sync.rs:423-541`).

Response (`sync.rs:80-102`, `:697-706`):
`{sc_call_data, receiver, gas_limit, foxsy_cost (atomic decimal string), foxsy_token_id, nonces[], player_count, wait_seconds}`.

- `sc_call_data` is the complete data field (`sync.rs:596-642`):
  ```
  MultiESDTNFTTransfer@<players SC hex>@<N+1, 2 hex digits>
    @464f5853592d356435663365@00@<10 x N x 10^18 hex>
    @46584c502d366632386535@<nonce hex>@01          (once per card)
    @73796e634d795374617473@<timestamp, 16 hex>@<game-server signature, 64 bytes hex>
    @<nonce, 16 hex>@<encoded attributes hex>        (once per card)
  ```
  The game server signs `sc_address || collection || caller pubkey || timestamp || (nonce || attributes)*`
  with ed25519 (`sync.rs:543-590`); the contract rebuilds and checks it
  (`contracts/foxleague-players/src/player_nft.rs:1672-1702`). Do not modify the payload.
- `gas_limit` = 15,000,000 + 3,000,000 per card, capped at 600,000,000 (`sync.rs:36-38`, `:655`).
- `wait_seconds` (0 to 8): sleep this long before signing, so a card received moments ago has
  propagated across shards (`sync.rs:40-56`, `:658-693`).

Refusals: `Wallet address mismatch`, `Chain is temporarily unavailable. Please retry shortly.`,
`Stat sync is temporarily disabled: the chain and the contract disagree about time. Your stats are safe and nothing was charged. Please try again later.`,
`Player not found, not owned, or not dirty`, `No dirty players to sync`,
`All dirty NFTs you have are no longer in your wallet on-chain (likely transferred / fused / burned). Nothing to sync. Try refreshing your team.`,
`Signing service unavailable, try again` (`sync.rs:295-592`).

### 7.2 The transaction

As the web app builds it (`frontend/src/pages/Squad.tsx:246-256`): **sender = receiver = your own
address**, `value 0`, `data = sc_call_data` (raw ASCII), `gasLimit = gas_limit`, gasPrice 1e9,
chainID `1`, version 1. The contract endpoint is
`syncMyStats(timestamp: u64, signature: array64<u8>, updates: variadic<multi<u64, PlayerAttributes>>)`, payable
(`contracts/foxleague-players/output/foxleague-players.abi.json:965-987`).

Contract reverts (`player_nft.rs:1603-1784`): `Contract is paused`,
`Timestamp must be newer than last sync` (one prepared payload per wallet, in order),
`Sync timestamp too old (max 1 hour)`, `Sync timestamp too far in future`,
`Send FOXSY + at least 1 NFT`, `First payment must be FOXSY`, `Insufficient FOXSY for sync`,
`Wrong token sent`, `NFT nonce mismatch`, `Amount must be 1`, `Payments and updates count mismatch`,
`More updates than NFT payments`, `<Stat> exceeds cap`, `Condition exceeds 100`. On success the cards
come back with new attributes and excess FOXSY is refunded.

**Retry rule** (`frontend/src/lib/syncRevertRetry.ts:52-57`; `Squad.tsx:339-373`): on
`new NFT data on sender for token` or `Sync timestamp too far in future`, wait 5 s, **prepare again**
and sign the new payload. Re-signing the old payload fails the same way.

### 7.3 `POST /api/sync/confirm` (auth)

Body `{wallet_address, tx_hash, nonces:[...]}` (`sync.rs:710`). The backend polls the transaction to
finality, checks it reverted nothing, that the sender is you, that it reached the players contract
as `syncMyStats` and paid at least `sync_cost x nonces`, then promotes the attributes **decoded from
the transaction** into the `*_synced` mirror and recomputes `stats_dirty` (`sync.rs:744-1111`).
Response `{confirmed, players_synced}`. Replays are answered idempotently.

Errors: `tx_hash is required`, `nonces list is required and cannot be empty`,
`Transaction reverted on chain: {reason}`, `Transaction sender does not match your wallet`,
`Transaction is not a stat-sync call to the game contract. Refresh your team and sync again {EM} if your wallet was debited, contact support with this tx hash.`,
`Transaction still pending {EM} try again in a few seconds`, `Transaction failed: {e}` (`sync.rs:782-1180`).
If confirm is never called, the chain indexer promotes the same values from the on-chain event
(`backend/src/chain_indexer.rs:3469-3509`).

### 7.4 `GET /api/sync/repair?wallet_address=<own>` (auth)

Free chain-to-cache reconcile, no transaction: `{added_to_db, removed_from_db, marked_dirty, updated_from_chain, already_ok, details[]}`.
Limited to once per 30 s per wallet: `Sync from chain {EM} please wait a few seconds (limit: once every {n}s)`
(`sync.rs:1320-1366`).

---

## 8. Tactics: formation and lineup

### 8.1 Formation: `POST /api/teams/formation`

Body `{wallet_address, formation}` (auth; `wallet_address` required but unused). Valid ids
(`backend/src/formation_registry.rs:13-23`):

| Id | Style | Id | Style | Id | Style |
|---|---|---|---|---|---|
| `4-4-2` | Balanced | `4-3-3` | Attacking | `5-3-2` | Solid Defense |
| `4-3-3w` | Wide Play | `4-3-3b` | Balanced Attack | `4-4-2a` | All-Out Attack |
| `4-4-2o` | Offensive | `4-2-3-1` | Counter Attack | `5-2-3` | Wing Attack |

Errors: `Invalid formation`, `User not found` (`backend/src/routes/teams.rs:139-151`). There are no
other tactic parameters: the style belongs to the formation.

### 8.2 Lineup: `POST /api/teams/lineup`

Body `{wallet_address, lineup:[11 nonces], substitutes:[0..7 nonces]}` (auth).

- **Slot order matters.** Index 0 is the goalkeeper; the rest follow the formation's slot list
  (`frontend/src/lib/formations.ts:8-100`, for example `4-4-2`: GK, DEF x4, MID x4, FW x2). The match
  launches the eleven in this order (`backend/src/routes/matches.rs:1459-1460`).
- **The server checks positions since rc.78** (FoxLeague #566): a starter in a slot of another line is refused with
  the editor's words (`Card 10 is a FW. Slot requires DEF`) and nothing is saved. `POST /api/teams/lineup` takes an
  optional `formation`: both are written in one save or neither. `POST /api/teams/formation` alone refuses a shape the
  saved eleven does not fit (`<name> is a <line>. Slot requires <line> in <formation>. Save the formation together
  with a lineup that fits it.`); between formations of the same lines it still saves alone. The agent sends a change
  of lines as the one save (`set_formation` with `lineup` and `substitutes`) and starts no match or entry while the
  saved eleven does not fit the saved formation.
- Fewer than 7 substitutes: the server completes the bench position for position (1 goalkeeper plus 6 outfield
  players split like the formation's lines), from your eligible reserves (unlisted, not in a transfer cooldown).

Errors (`teams.rs:257-391`): `Lineup must have exactly 11 players`,
`Substitutes cannot exceed 7 players`,
`Team must have exactly 11 starters + 7 substitutes. You picked {k} sub(s) and have only {r} eligible reserve(s) {EM} acquire {x} more NFT(s) to complete the bench.`,
`Some players are not owned by you or are listed for sale` (also fires on a duplicate nonce),
`Cooldown active for recently-transferred players: {name} ({time}), ...`. Condition is not checked
here. The response is the saved `Team`.

### 8.3 Tournament strategy lock

- Each tournament and 1v1 match is simulated `tournament.match_sim_lead_minutes` (default **30**)
  before its kickoff. At that moment the server snapshots your **currently saved** formation, 11 + 7,
  synced stats and live condition (`backend/src/config_registry.rs:396-404`;
  `backend/src/tournament_simulator.rs:1197-1217`, `:1487-1512`).
- **No route refuses an edit during the lock.** An edit saved after a match locked applies to your next
  match (manual `mechanics/match-day-strategy.mdx:13-17`).
- At the lock: an incomplete or not fully owned 11 + 7 forfeits **3-0**; a starter below condition 30
  or inside a transfer cooldown is swapped for the best fit substitute; fewer than 11 fit starters
  forfeits 3-0 (`tournament_simulator.rs:2176-2231`; manual `match-day-strategy.mdx:45`).
- `GET /api/tournaments/upcoming-matches` (auth) gives, per match of yours, `strategy_locks_at`,
  `locked` and `phase` (`upcoming`/`locked`/`live`/`finished`) (section 10.8).
- A 1v1 locks right away: it is scheduled within the 30-minute lead as soon as it fills (section 11).

---

## 9. Ranked and casual matches

### 9.1 Start: `POST /api/matches/play`

Body `{wallet_address, match_type: "casual"|"ranked"}` (auth) (`backend/src/routes/matches.rs:431`,
`:793-797`, `:984`). Tournament and 1v1 matches are never started here.

**Gates, in order** (`matches.rs`):

| # | Gate | Error |
|---|---|---|
| 1 | Type | `Invalid match_type. Use: casual, ranked` (991) |
| 2 | Registered | `Not registered` |
| 3 | 18 unlisted cards (only when `match.gate_enabled` is "true"; code default "false", not seeded) | `You need at least 18 unlisted players to enter a match. ...` (370-423) |
| 4 | One request in flight per user | `A match is already being processed. Please wait.` (1021) |
| 5 | Not busy with a tournament: an unrevealed tournament or 1v1 match of yours from 1 h before kickoff until its broadcast ends, plus your group (`groups_knockout`) or your Swiss round until all of it has ended (`TOURNAMENT_BUSY_LEAD_HOURS`, `tournament_busy_rows_sql`; the same rows as the 1v1 gate of 10.4) | `Your squad is preparing for '{t}' {EM} next match in {m}m. ...`, `... is currently playing in the '{t}' tournament. ...`, `... is about to play in the '{t}' tournament. ...` (944-970) |
| 6 | Not already in a match (home or away; pending, simulating or inside its playback) | `Already in match #{id}. Wait for it to finish before starting another.` (1109-1133) |
| 7 | 30 s since the start of your last match of any kind (`match.cooldown_ms`) | `Match cooldown: wait {s} seconds` (1147-1173) |
| 8 | Ranked only: 15 min since your last ranked match, including ones you were drawn into (`match.ranked_cooldown_ms`) | `Ranked cooldown: your squad needs to rest {EM} wait {m}m ({s}s) before the next ranked match.` (1189-1228) |
| 9 | At most 5 casual + ranked matches **you start** since 14:00 UTC (`max_matches_per_day`) | `Daily match limit reached ({n}/{max}). Try again tomorrow.` (1233-1247) |
| 10 | Team and lineup | `No team found`, `Lineup must have 11 players. Set your lineup first.`, `Team must have exactly 7 substitutes (you have {n}). ...` (1268-1280) |
| 11 | All 18 on chain in your wallet, none listed | `{n} player(s) in your team are listed for sale and are held in marketplace escrow, so they cannot play. ...` (1393); `Your {lineup\|substitute bench\|...} contains {n} player(s) not yet confirmed on-chain. ...` (1441) |
| 12 | No starter at condition 0 (the 30 floor does not apply here) | `{name} has 0 condition {EM} cannot play. Rest or use recovery item.` (1480-1490) |
| 13 | None of the 18 in a transfer cooldown | `{name} was recently transferred {EM} cooldown {...} remaining` (1498-1525) |
| 14 | Platform capacity (`match.sim_max_concurrent`, 3) | `Servers are busy with other matches right now {EM} please try again in a few seconds.` (1667-1729) |

**Opponent** (`matches.rs:1531-1629`, `:7727-7840`): casual is always an AI team at your lineup's
average OVR, its players within a few points of it, with a formation drawn at random from the supported ones
(`play_match`: `formation_registry::supported_ids()`, next-foxleague main `dd57cf4e7`). The home side plays the
formation, eleven and bench saved when the game starts: `play_match` reads them and hands them to the match engine
(`MatchSetup`), and the statistics name the formation from the launch record (`get_match_stats`, rc.27), so a change
saved after the start touches neither the game nor its record. The agent's casual test bench (owner, 2026-11-04)
rests on both: it saves the test formation, starts the game and puts the team's own back at once. Ranked picks a random real team within 150 ELO, then 300, then 500 that has a full
11 + 7, at least 18 cards, no tournament match within 1 h and no match in flight; otherwise an AI
stands in (no ELO change against the AI).

**Response** (`matches.rs:2141-2149`): `{match_id, tm_game_id, home_team, away_team, status: "simulating", ws_url: "/ws/match/{id}", pre_match: {home, away, head_to_head}}`.

### 9.2 Learning the result

The simulation runs on the match runner (about 1.5 minutes, at least 45 s, polled for up to 5 minutes) and writes a
recording of 6000 frames plus stoppage time (6149 seen), which is broadcast at 10 frames a second (about 615 s); status
moves `pending`, `simulating`, `rcg_ready`, `finished` (or `error`) (`matches.rs:1929-2069`).

A ranked or casual match holds its team until its broadcast has aired: another start is refused ("Already in match")
until the latest of `rcg_ready_at`, `playback_started_at` and `finished_at` plus the recording's length plus 30 s
(`ACTIVE_MATCH_GATE_SQL`, `live_match_predicate`, `broadcast_holds_its_team_sql`; `matches.rs:251`, `:340`, `:411`):
about 12 to 12.5 minutes after the start's answer, up to about 16 with a slow simulation. Since rc.85 (2026-11-05, #638)
the broadcast starts by itself when the recording is ready, and `GET /api/matches/active` returns the match, `finished`,
while it airs (without the gate's 30 s). The agent spaces its casual and ranked starts 16 minutes apart (13 was
refused 7 times in 17 from 9 to 16 Nov, none of 36 from 14.16 minutes up: audit 2026-11-16, BEH-7) and reads the
active match before each start; after a lost start answer it takes an active match for its own only when it was created
after the press (R85-1, R85-2).

- `wss://foxleague.ai/ws/match/{id}` (no auth): `{match_id, status, home_score?, away_score?, error?}`.
  Scores are never sent before the reveal (`matches.rs:2162-2340`).
- `GET /api/matches/{id}` (public): `MatchDetailView` with `status`, `results_applied`,
  `home_score`/`away_score` (null until revealed), `home_elo_at_match`, `total_frames`
  (`matches.rs:4278-4333`; `backend/src/models.rs:868-897`).
- `GET /api/matches/active` (section 3.5) tells you when you are free again.

**You do not need to call the playback routes.** Results (ELO, W/D/L, XP, condition, career stats)
are deferred and applied by an abandoned-match sweep about 11 minutes after the match finishes
(the sweep runs every `cron.stuck_match_check_seconds`, 120 s; `matches.rs:232-237`, `:1888`;
`backend/src/lib.rs:1511-1537`).

- `POST /api/matches/{id}/playback-done` (auth, participant) applies them earlier, but only once the
  broadcast could have reached its last frame; an early call answers `{ok:true, applied:false}`
  (`matches.rs:2561-2665`).
- `POST /api/matches/{id}/playback-started` stamps the broadcast clock and moves the reveal later;
  `POST /api/matches/{id}/save-cycle` only stores a resume position (`matches.rs:2527-2552`, `:4074-4140`).
  An agent gains nothing from either.

### 9.3 Rewards and costs when results apply

Source: `apply_match_results`, `matches.rs:3074-4040`.

- **ELO** (standard Elo, 400 scale; `backend/src/db.rs:779-803`): ranked against a real team K = 9 (24 until
  2026-10-30), both sides move (the drawn-in opponent too). Casual and ranked against the AI: no ELO. Silver
  tournaments and 1v1s K = 13, Gold K = 17 (12 and 18 until 2026-10-30), Bronze none until the competition levels'
  switch, then K 5 for ranked and 9 for a paid Bronze, read from `/api/config` (`deploy/mainnet/seed.sh:83-85`,
  `competition_levels.rs`, `matches.rs:3589-3645`).
- **XP** only when the match is XP-eligible: a real opponent, not Bronze, not ranked while
  `xp.ranked_enabled` is 0 (the launch setting) and analyzer stats present (`matches.rs:3448-3451`).
  At launch **only Silver/Gold tournament and 1v1 matches awarded XP**; since the competition levels of 2026-11-09
  a ranked game (for the team that started it and paid its ticket) and a paid Bronze earn XP at their share too
  (`competition_levels.xp_factor_pct`). At most 3 XP-earning matches per card per day
  (`xp.max_matches_per_player_per_day`).
- **Competitive counter**: the same test increments `competitive_matches`, which sync writes on chain
  as `matches_played` and which fusion and listing read (`matches.rs:3868-3883`). Casual and ranked
  never counted at launch; since 2026-11-09 a ranked game the team started and paid for counts, casual never.
- **Condition**: every player who took the pitch (a substitute who came on too, not the unused bench)
  loses `condition_loss_per_match_ranked` (5) in casual and ranked, **initiator only**, or
  `condition_loss_per_match` (10) in tournaments and 1v1s, both sides; both ramp up to 3x with age
  (`matches.rs:2842-2877`, `:3886-3898`).
- **FOXSY**: none for casual or ranked. FOXSY moves only through tournament and 1v1 pools.
- **In-match strength** is the synced stat scaled by condition: `attr x (50 + condition/2) / 100`
  (`backend/src/attribute_mapping.rs:61-64`).
- `stats_dirty` becomes true for every card that played (`backend/src/db.rs:680-744`).

### 9.4 Pre-match card

`GET /api/matches/pre-match-data?home_user_id=&away_user_id=&match_id=` (auth, participant only;
`You are not a participant in this match` otherwise; `matches.rs:6797-6916`). `play_match` already
returns this card, so a client does not need the call.

### 9.5 Replays

`GET /api/replay/{match_id}` serves the raw `.rcg` file once the result is public (tournament: after
the reveal; ranked or casual: once applied, once aired out or to a participant)
(`matches.rs:5579-5589`, `:6246-6359`; `backend/src/visibility.rs:424-431`). `GET /api/live/{match_id}`
serves the growing file during the broadcast. Neither is needed to play.

### 9.6 Condition over time

- **Regeneration**: `min(100, condition + floor(elapsed_s x rate / 86400))`; rate
  `condition.regen_points_per_day` = **48 per day on mainnet** (code default 24) up to age 30, falling
  linearly to 24 at age 39 (`deploy/mainnet/seed.sh:99`, `:104`; `backend/src/db.rs:172`, `:556-565`;
  migration `126`).
- **Age**: `18 + days since mint / 52` (one in-game year per 52 real days); the cost ramp starts at 30
  (`backend/src/db.rs:514-521`, `:473-489`). A fresh card is years away from any age effect.
- **Floors**: 30 to train and to start a tournament or 1v1 match; casual and ranked refuse only 0.
- **Recovery**: the shop's condition recovery (section 12.2 A). No injuries exist; retirement is not
  shipped (manual `mechanics/aging.mdx:48-53`).

---

## 10. Tournaments

The backend owns the schedule and the brackets; the tournaments contract holds the seat fees in
escrow and pays prizes. The game server creates each paid tournament on chain; a player's only
transactions are `joinTournament` (pay a seat) and `claimRefund`.

### 10.1 Formats, tiers, sizes

| Format | `max_teams` | Notes | Source |
|---|---|---|---|
| `knockout` | 4, 8, 16, 32 (2 = a 1v1) | `min_teams` must equal `max_teams` | `backend/src/routes/tournaments.rs:38`, `:2028-2033` |
| `groups_knockout` | 8, 16, 32, 64 | `min_teams` must equal `max_teams`; groups of 4, top 2 advance | `tournaments.rs:46`, `:2039-2044` |
| `round_robin` | 3 to 20 | `home_and_away` allowed only here | `tournaments.rs:50`, `:2545` |
| `swiss` | 3 to 32 | | `tournaments.rs:54-56` |
| `league_knockout` | 36 | Since 2026-10-15: a league phase drawn from pots, then a play-off and two-legged knockout ties, a third place match and a final. Created by an admin only while `tournament.league_knockout_enabled` is 1 (it ships 0). The agent neither joins nor creates a format it does not know (`unsupportedFormat`, `src/executor/rules.ts`) | `tournaments.rs:62`, `:74`, `league_knockout_create_refusal` (FoxLeague c2b24727c) |

| Tier | Seat fee (mainnet) | Pool | ELO | XP and competitive count |
|---|---|---|---|---|
| `bronze` | 100 to 999 FOXSY since the competition levels of 2026-11-09 (free before; a free one earns nothing) | yes (a paid one) | K 9 (a paid one) | XP at 50 percent, competitive (a paid one) |
| `silver` | 1,000 to 4,999 FOXSY | yes | K 13 | yes |
| `gold` | 5,000 FOXSY and up | yes | K 17 | yes |

Fee bounds: `/api/config` `tournament_fee_bounds {silver_min, silver_max, gold_min}`. The effective
Silver top is `min(silver_max, gold_min - 1)` = 4,999, although `silver_max` is served as 5,000
(`tournaments.rs:481-514`; `deploy/mainnet/seed.sh:111`).

### 10.2 Listing and reading

| Route | Auth | What | Source |
|---|---|---|---|
| `GET /api/tournaments?status=&format=&tier=&kind=` | public | `Tournament[]`, featured first then newest start, at most 500, no paging. `kind=standard` (more than 2 teams) or `kind=challenge` (1v1) | `tournaments.rs:615-631`, `:1143-1464` |
| `GET /api/tournaments/{id}[?wallet_address=]` | public | `{tournament, participants[], rounds[], matches[], standings?, whitelist[], user_can_join_private?, user_is_participant?, ...}`; `matches` are reveal-gated | `tournaments.rs:1494-1788`; `backend/src/tournament_models.rs:389-465` |
| `GET /api/tournaments/{id}/lobby` | public | seated teams with the formation and OVR of their join snapshot | `tournaments.rs:5687-5799` |
| `GET /api/tournaments/{id}/standings` | public | `TournamentStanding[]` (played, won, drawn, lost, goals, points), revealed matches only | `tournaments.rs:5822`, `:5994-6018` |
| `GET /api/tournaments/{id}/entry-status` | auth | `{is_participant, has_escrow, entry_amount (atomic string), joinable}` | `tournaments.rs:6025-6089` |
| `GET /api/tournaments/hall-of-fame` | public | featured completed tournaments, at most 100 | `tournaments.rs:7009-7072` |
| `wss://foxleague.ai/ws/tournament/{id}` | none | `status_change`, `participant_joined`, `participant_left`, `tournament_started` pushes | `tournaments.rs:768`, `:7981-7992` |

`Tournament` fields (`backend/src/tournament_models.rs:16-203`): `id, creator_user_id, title,
description, format, tier, featured, max_teams, min_teams, entry_fee_foxsy (whole FOXSY), status,
deadline, starts_at, round_interval_minutes, has_third_place_match, sc_tournament_id,
winner_user_id, runner_up_user_id, third_place_user_id, created_at, started_at, completed_at,
cancelled_at, participant_count, target_user_id, challenge_deadline_minutes, is_private,
home_and_away, developer_mode` (plus team names, badges and the final score on 1v1 rows). The detail
route's `tournament` has no `participant_count`: count `participants`.

Statuses: `open`, `pending_sc` (paid tournament waiting for its on-chain create), `active`,
`simulating`, `completed`, `cancelled`, `simulation_delayed`
(`backend/migrations/020_tournaments.sql:14`). Every public answer (the list, the detail and My Tournaments) serves the
internal `simulating` and `simulation_delayed` as `active`, and the list's `status=active` lists them with it
(`routes/tournaments.rs` `public_tournament_status`, `PUBLIC_TOURNAMENT_STATUS_SQL`, release/mainnet-1.0 729164194), so
the agent's time slots count a delayed tournament as taken, as FoxLeague's booking rule does (`tournament_slots.rs`,
since 2026-10-01; checked in ORG-3, 16 Nov 2026).

**Completed tournaments' size and fee.** `GET /api/tournaments?status=completed&kind=standard` gives
`max_teams`, `participant_count`, `entry_fee_foxsy`, `tier` and the podium user ids. The pool is
`entry_fee_foxsy x seated teams` (`backend/src/tournament_simulator.rs:3775-3791`). On chain, the
`prizes_distributed(tid, seated_pool, total_distributed, total_royalty, platform_fee)` event records the
payout (`contracts/foxleague-tournaments/src/tournament_manager.rs:475-481`); after completion
`getTournamentPool` holds only unseated leftovers.

### 10.3 Create: `POST /api/tournaments/create`

Auth. Optional header `Idempotency-Key` (16 to 255 characters of `[A-Za-z0-9_-]`); a success is cached
24 h per user (`tournaments.rs:1790-1904`; `backend/src/idempotency.rs:30-46`).

Body `CreateTournamentRequest` (`backend/src/tournament_models.rs:302-356`): `title` (1-100 bytes),
`description?` (under 1000 bytes), `format`, `tier`, `max_teams`, `min_teams`, `entry_fee_foxsy?`
(whole FOXSY), `deadline` and `starts_at` (RFC 3339), `round_interval_minutes?`,
`has_third_place_match?`, `target_user_id?` and `challenge_deadline_minutes?` (1v1 only),
`whitelist_user_ids?` (private), `organizer_only?`, `home_and_away?`, `developer_mode?` (developer
binaries; out of scope).

**Rules and their errors** (`create_tournament_inner`, `tournaments.rs:1965-3184`):

- Format, tier, size: `Invalid format '{f}'. Valid: knockout, groups_knockout, round_robin, swiss`,
  `Invalid tier '{t}'. Valid: bronze, silver, gold`, `Invalid max_teams {n} for format '{f}'. Allowed: [...]`,
  `min_teams must be >= {m} for format '{f}'`, `min_teams cannot exceed max_teams` plus the
  knockout/groups "set min and max teams equal" messages.
- Schedule: `Deadline must be in the future`, `Tournament must start at least 1 hour from now`,
  `starts_at must be after the registration deadline` (at least 5 min after it),
  `Tournament cannot start more than 90 days from now` (`tournaments.rs:2250-2264`, `:2496-2499`).
  `starts_at` is any instant: create neither rounds it nor asks for a step; it must be more than 1 hour from now
  (`tournament_slots.rs` `far_enough`) and at most 90 days ahead (`too_far`). Only the calendar's proposal
  (`GET /api/tournaments/availability`, `next_free`) is on the quarter hour (release/mainnet-1.0 fb820dd57). The agent
  sends the start of its action (since 2026-11-15): `starts_at`, a whole UTC minute 2 hours to 30 days after the create
  runs (30 days since 2026-11-16, 72 hours before), or the older `starts_in_hours`, whole hours from that moment; the deadline is that start less
  `registration_closes_minutes_before`. The time slot, the schedule and the organizer quote are checked at that same
  instant.
- Round interval 30 to 1,440 minutes: `Round interval must be 30-1440 minutes` (`tournaments.rs:2421`, `:2482-2484`).
- **Platform-wide slot**: a standard tournament's window (`starts_at - 1 h` to the estimated end + 1 h,
  3 minutes per match) must not overlap any other live tournament's window:
  `Time slot conflicts with tournament #{id} '{title}'. Choose a different time.` (`tournaments.rs:774-827`, `:2295-2358`).
  The windows are half-open: one that ends exactly where another starts does not overlap it
  (`tournament_slots.rs` `overlaps`), so a 3-team round robin (9 minutes) fits a gap of exactly 2 h 9 min, at one start.
- **The calendar of free starts** (public, no session, the same answer for every caller):
  `GET /api/tournaments/availability?format={format}&teams={n}&from={RFC 3339}&days={1 to 14}` (also `home_and_away`
  and `developer_mode`; `from` defaults to now and is clamped to now up to 90 days ahead; `days` defaults to 7, 14 at
  most a read). The data is `{from, to, busy: [{tournament_id, title,
  start, end}], free: [{first, last}], from_refusal, conflict, next_free}`: `free` holds every start from `first` to
  `last`, both included, where a tournament of that format and size fits, by the rule create refuses a start with
  (more than 1 hour from now plus a 10-minute margin, at most 90 days, its booking overlapping none). It counts every
  booking, a tournament being created too, which the public lists do not show: `busy` answers it with a negative
  `tournament_id` and the title `A tournament being created`. `from_refusal` is `too_soon`, `taken`, `too_far` or
  null; `next_free` is on the quarter hour. A size the format does not offer is refused (`This format is not offered
  for that number of teams.`). (`routes/tournaments.rs` `tournament_availability`, `tournament_slots.rs` `availability`,
  release/mainnet-1.0 729164194.) The agent's planning snapshot reads it for a round robin of 3, a round robin of 8
  and a Groups + Knockout of 16 over its 30 days (since 2026-11-16) in up to three reads a shape: days 0 to 14, 14 to
  28 and 28 to 30 from the snapshot's moment, the next only while fewer than 10 free starts of that shape were found,
  so a calendar with room costs one read a shape. A stretch free across two reads is joined into one. Each agent is
  offered its own start for each shape: of up to 10 free starts a booking apart, agent n takes the (n mod k)-th, so
  two agents of one install do not plan the same minute; the pick reads only its own number and this public answer.
  Any failed or malformed read makes that shape unknown, never a partial list: no start is offered; the agent's own
  clash check (`slots.ts`, from the public lists) decides at the create.
  The create reads it as well (ORG-2, 16 Nov 2026): for its own format, size and `home_and_away`, from its own start,
  14 days. `from_refusal` judges that start as create does, every booking counted, so a start held by a tournament
  being created (create refuses it with `Time slot is held by a tournament that is being created. Choose a different
  time.`) is refused before anything is asked, naming the first free start listed after it that the next plan can
  still create; a player's title is never repeated. A failed or malformed read leaves the clash check from the public
  lists as the last word, and the action says so: FoxLeague refuses a taken start before any payment (the organizer
  payment is asked only after its other checks).
- **Creation cap**: at most 1 active tournament you created and play in, plus 1 you only organize
  (1v1s not counted): `You already have an active tournament you are playing in. Complete or cancel it before creating another.`
  / `... you are organizing. ...` (`tournaments.rs:2360-2409`).
- Fees: `Bronze tournaments cannot have an entry fee`, `Entry fee cannot be negative` plus the tier
  bound message `Silver: {min}-{top} FOXSY` / `Gold: >={gold_min} FOXSY` (`tournaments.rs:2412-2477`).
- Private: the invite list is capped at `max_teams`, every invitee must be registered and capacity must
  reach `min_teams` (`tournaments.rs:2505-2567`).
- Faults: `Could not create the tournament right now. Please retry.`

**What happens on chain.** For a paid tier the **game server** calls
`createTournament(tid, entry_fee_atomic, max_teams, allowed...)` and waits for finality; the row moves
from `pending_sc` to `open` with `sc_tournament_id = id` (`tournaments.rs:2740-2816`). Errors:
`Chain is temporarily unavailable. Please retry shortly.` (row removed),
`On-chain tournament creation failed: {e}`; an inconclusive result leaves `pending_sc`
(`On-chain tournament creation could not be confirmed yet. ... Please check the tournament list before retrying.`).
**The create response shows the row as inserted** (`pending_sc`, `sc_tournament_id: null`): read the
tournament again before joining.

**Joining your own tournament.** A free Bronze creator (not organizer-only) is seated server-side with
no transaction. A **paid** creator is not: the web app chains create, `joinTournament` and
`POST /join` (`frontend/src/pages/tournaments/TournamentCreate.tsx:507-571`); organizer-only skips the
join.

**Organizers earn nothing from the pool.** The "creator royalty" (2.5 percent of the pool, out of the
10 percent fee) goes to the provider of the match AI binary, not to the organizer
(`backend/src/royalty.rs:1-16`; manual `developer/royalties.mdx:17-27`).

### 10.4 Paid join (Silver and Gold)

1. (Optional) `GET /api/tournaments/{id}/entry-status`. The web app's plan (`frontend/src/lib/paidJoin.ts:27-60`):
   `is_participant` means done; `has_escrow && joinable` means an earlier payment is still in escrow,
   so `POST /join` **without** a hash; otherwise pay.
2. **Pay** (`frontend/src/lib/tournamentTx.ts:49-167`; `frontend/src/lib/tournamentTxData.ts:29-40`):
   receiver = tournaments contract, value 0, gas 8,400,000, version 2,
   `data = ESDTTransfer@464f5853592d356435663365@<fee atomic hex>@6a6f696e546f75726e616d656e74@<tid, 16 hex>`.
   Example, tournament 1234 at 1,000 FOXSY:
   `ESDTTransfer@464f5853592d356435663365@3635c9adc5dea00000@6a6f696e546f75726e616d656e74@00000000000004d2`.
   The amount must equal `entry_fee_foxsy x 10^18` exactly; the id is `sc_tournament_id ?? id`.
3. Wait for the outcome (1.6).
4. **`POST /api/tournaments/{id}/join`** with `{"tx_hash": "<64 hex>"}` (or `{}` for Bronze and for
   escrow recovery). Success: `{participant_id, condition_warning?}` (`tournaments.rs:633-638`, `:5211-5214`).
   Call it right after finality: a periodic sweep (every 15 minutes by default) refunds escrow that has
   no seat behind it (`backend/src/config_registry.rs:2776-2778`; `backend/src/tournament_reconcile.rs:1062-1071`).

**Join gates** (`tournaments.rs:3187-5215`). "(R)" = the backend refunds your escrow on chain in the
same request when you sent a hash and are not seated (`tournaments.rs:314-445`):

| Gate | Error |
|---|---|
| Registered, exists | `Not registered`, `Tournament not found` |
| Open (R) | `Tournament is not open for registration (status: {s})` |
| Paid tier with a fee | `This tournament has no entry fee on a paid tier and cannot take entries.` |
| Targeted 1v1 (R) | `This 1v1 challenge is locked to a specific opponent {EM} you cannot join it.` |
| Organizer-only creator (R) | `You created this tournament as organizer-only, ...` |
| Private (R) | `This tournament is private {EM} only invited teams can join.` |
| 1v1 creator seated first (R) | `Creator must join first {EM} slot 1 is reserved` |
| Before the deadline (R) | `Registration deadline has passed` |
| Legal squad (R) | `No team found. Set up your team first.`, `Lineup must have 11 players`, `Team must have exactly 7 substitutes to join a tournament (you have {n}). ...`, `Some players in your lineup are no longer owned by you or are listed for sale. ...` (`tournaments.rs:921-1039`) |
| 1v1: 11 match-fit players (R) | `Your squad isn't rested enough to play {EM} fewer than 11 players are match-fit (condition too low or in transfer cooldown). ...` |
| No card in a transfer cooldown (R) | `{name} was recently transferred {EM} cooldown {h}h {m}m remaining. Tournaments cannot be joined with a recently-rented NFT.` |
| 1v1: one active 1v1 (R) | `You already have an active 1v1. Finish it or cancel it first.` |
| 1v1: not busy with a tournament (R). Busy: from 1 h before one of your own unrevealed matches until its broadcast ends (no other end); in `groups_knockout` every team of a group from 1 h before the group's last kickoff until every group match has ended; in `swiss` every team of a round from 1 h before its own match in it until every match of the round has ended. The play gate's rows (`matches.rs` `tournament_busy_rows_sql`, `tournament_busy_now`) since #512 (2026-10-15); before, the tournament's whole `blocking_window`. A failed read answers "retry" here (fail closed) and is treated as free at create (fail open, nothing paid there). `GET /api/tournaments/{id}?wallet_address=` answers the same rows for a 1v1 in `viewer_blocked_tournament_window` (false on its own failed read) | `You have a tournament match within the hour. Finish it first.` |
| One seat, capacity | `You are already in this tournament`; `Tournament is full` (refund if paid) |

Payment verification (10 s budget; `backend/src/chain_verify.rs:316-347`, `tournaments.rs:4057-4495`):
`Transaction {status} on chain {EM} cannot confirm tournament entry`,
`Your payment isn't confirmed on chain yet {EM} it may still settle. Please retry the tournament entry in a moment.`,
`Transaction was rejected on chain ({msg}) and refunded {EM} tournament entry not confirmed`,
`Transaction sender does not match your wallet`, `Transaction was not sent to the tournament entry contract`,
`Transaction is not a tournament entry call`, `Entry fee payment is less than required`,
`This payment does not match the tournament's entry fee exactly. It stays refundable; please contact support.`,
`This payment was for a different tournament and can't be used to join this one.`,
`This entry payment was already used to join. If you left the tournament, pay again to rejoin.`,
`This entry payment was refunded (you left this tournament). Pay again to rejoin.`,
`Entry fee verification failed {EM} try again later`.

**Do not pay twice.** `Your entry payment is confirmed {EM} we're finalizing your seat and this page updates automatically. Do NOT pay again.`
(`tournaments.rs:4297-4353`) means the cross-shard proof is not attached yet: retry `/join` **without a
hash** (the web app retries 5 times, 6 s apart; `frontend/src/lib/paidJoin.ts:71-87`). A retry is not required:
the fee is verified, and FoxLeague's reconciler seats a paid wallet from its standing escrow on an open
tournament by itself (`tournament_reconcile.rs` `seat_unseated_escrow`, a quick pass every 60 s, on while
`tournament.seat_from_escrow_enabled` is 1, the default; checked on origin/main 2026-10-13). Only with that switch
off does the 15-minute sweep refund the escrow instead. The web app's retry loop only polls that recovery.

Contract reverts on the payment (atomic; `tournament_manager.rs:260-310`): `Contract is paused`,
`Must pay with FOXSY token`, `Payment must be > 0`, `Tournament is not open for joining`,
`Tournament terms not set`, `Payment must equal the entry fee`, `Tournament is full`,
`Not invited to this tournament`, `Already joined this tournament`.

**Limits.** No cap on how many standard tournaments you join; one seat each; one active 1v1.

### 10.5 Leave: `POST /api/tournaments/{id}/leave`

Auth, no body (`tournaments.rs:5218-5526`). Only while `open` and before the deadline. For a paid seat
the game server refunds your exact escrow (`refundEntries`) before the seat is removed; the answer is
`{message: "You have left the tournament.", refund_tx_hash}`. Leaving never cancels the tournament,
even when it empties (`tournaments.rs:5464-5468`). Errors:
`Cannot leave {EM} tournament is no longer open`, `Cannot leave {EM} registration deadline has passed`,
`You are not in this tournament`, `Failed to refund entry on chain: {e}. Please retry shortly.`,
`Refunds are unavailable right now: your seat and entry fee are untouched. Please retry shortly.`

### 10.6 Cancel and delete (creator)

- `POST /api/tournaments/{id}/cancel` (auth): creator only, while `open`, with **zero** participants
  (your own seat counts, so leave first). The game server closes it on chain; answer
  `{message: "Challenge cancelled.", refund_tx_hash: null}`. Errors:
  `Only the creator can cancel this challenge`,
  `Cannot cancel {EM} the challenge is no longer open for registration`,
  `Cannot cancel {EM} a player has already joined this challenge` (`tournaments.rs:531-547`, `:5528-5684`).
- `POST /api/tournaments/{id}/delete` (auth; the route is shared with admins, only the owner path is
  described): the creator may delete their own tournament while its status is `open`, whatever the
  seat count; every seat is refunded on chain (`backend/src/routes/admin.rs:8877-9328`). Real HTTP codes:
  403 `Not registered`, 404 `Tournament not found`, 400 `A completed tournament cannot be deleted`,
  400 `This has already started {EM} it can't be deleted while its match is running. Wait for it to finish.`,
  403 `Only the organizer or an admin can delete this tournament`,
  400 `You can only delete a tournament while it is still open (before its registration deadline)`,
  503 `Chain is temporarily unavailable. Please retry shortly.` Answer
  `{deleted: true, tournament_id, matches_deleted, refund_txs, refund_failed_addrs}` or, when escrow is
  not drained yet, `{deleted: false, deferred: true, status: "cancelled", reason: "escrow_not_drained", ...}`.

### 10.7 Not filled, cancelled, claim refund

- At the deadline a tournament with at least `min_teams` starts (`startTournament` on chain); otherwise
  it is cancelled and the game server refunds every paid seat and closes it
  (`backend/src/tournament_simulator.rs:167-230`, `:359-420`, `:637-900`).
- **`claimRefund(tid)`** is the self-service fallback (`tournament_manager.rs:318-341`): only when the
  contract status is cancelled (4) or completed (3), for the caller's own remaining escrow (on a
  completed tournament only an entry that was never seated). Transaction: receiver = tournaments
  contract, value 0, gas 6,500,000, version 2, `data = claimRefund@<tid, 16 hex>`
  (`frontend/src/lib/tournamentTx.ts:183-236`). Reverts:
  `Refund claims are only open on cancelled or completed tournaments`, `No entry to refund`,
  `Entry is not backed by the pool`. The web app offers it when `/entry-status` says
  `has_escrow && !is_participant` on a finished paid tournament
  (`frontend/src/components/tournament/ClaimEntryRefund.tsx:46-58`). Check first with the view
  `getEntryAmount(tid, address)`.

### 10.8 Match day: lock, reveal, results

- `GET /api/tournaments/upcoming-matches` (auth): `{lead_minutes, my_team_name, my_team_badge, matches:[...]}`,
  each with `tournament_id, tournament_title, round_label, group_name, is_home, opponent_name,
  opponent_badge, scheduled_at, strategy_locks_at, locked, formation, phase, tournament_match_id, is_watchable,
  home_score, away_score, my_lineup` (`tournaments.rs:6320-6595`). `tournament_match_id` is the match's public id
  (`tm.public_id`, the row's only handle since 2026-10-07); the row carries no `match_id`. `my_lineup` is your own
  per-match snapshot; the opponent is null until the game makes it public and scores are null until the reveal.
  It is paged: 50 rows when no `limit` is asked, at most 200, kickoff first with the last day's finished games at
  the front, the total in the header `X-Total-Count` (`UPCOMING_DEFAULT_LIMIT`, `UPCOMING_MAX_LIMIT`). The agent
  reads it whole, `limit=200` and `offset` until the total, at most 5 pages; a list it cannot read whole is unread:
  every rule that counts owed matches refuses (audit 2026-11-16, R2M-3). FoxLeague sends the total with every answer
  whose count it read, `0` with an empty list; when that count fails it sends none, and its row read may have failed
  too and answered an empty list. So an answer without a readable total is not read whole either (R76A-1).
  FoxLeague reads the rows and the total as two queries with no transaction around them and the list is live (the
  last day's finished games leave the front as they age out, a tournament going active lists all its fixtures, a
  knockout's next round is listed when the match before it ends). So the list counts as read whole only when every
  page carries the same total as the first, no `tournament_match_id` comes twice, the rows are not more than the
  total and every row of a list of more than one page has a `tournament_match_id`. Anything else is a list that
  moved while it was read and stays unread (audit 2026-11-16, FC-2). That check takes `tournament_match_id` as
  unique per row. FoxLeague's server makes it so (read on `release/mainnet-1.0` e3cee147b, 17 Nov 2026):
  `tournament_matches.public_id` is NOT NULL with a unique index (`migrations/152_tournament_matches_public_id.sql`);
  the query joins one participant per user and tournament (`UNIQUE(tournament_id, user_id)`, `020_tournaments.sql`)
  and one team per user (`teams.user_id UNIQUE`, `001_initial.sql`), so it gives one row per match; the handler maps
  each row to one answer row without adding or dropping any (`upcoming_matches_rows_sql`, `upcoming_matches`).
  Offsets cannot show a row removed and another added both before a page's edge; the checks above catch every
  other way a list read in pages moves.
- Strategy lock and forfeits: section 8.3. Casual and ranked are blocked from 1 h before any of your
  unrevealed tournament or 1v1 matches (section 9.1 gate 5).
- **Reveal rule.** Results, scores, ELO changes, later knockout pairings and opponents' per-match lineups
  become public only when the match is revealed at its scheduled time; the server blanks them before
  (`backend/src/visibility.rs:43-58`, `:271-367`). A tournament match id you read before the reveal
  answers `Match not found`.
- **Prizes** are paid by the game server in one `distributePrizes` transaction after the last reveal
  (`tournament_simulator.rs:3761-4265`). Split and roll-forward rules: `ECONOMY-AND-RULES.md` section 11.
- Standings tie-breakers: manual `mechanics/tournaments.mdx:89-108`. A mutual forfeit is a double loss
  with -1 point (`tournaments.rs:5809-5815`).
- Reactions: `POST /api/tournaments/{id}/matches/{mid}/react {emoji}` with `fire|goal|shock|target|skull`,
  one per 30 s per match (`tournaments.rs:6917-7006`).

---

## 11. 1v1 challenges

A 1v1 is a tournament with `max_teams = 2`: same routes, same contract calls.

**Create**: `POST /api/tournaments/create` with `format: "knockout"`, `max_teams: 2`, `min_teams: 2`,
`tier: "silver"|"gold"`, `entry_fee_foxsy` inside the tier bounds, `target_user_id` (a user id; null
for an open challenge) and `challenge_deadline_minutes` in `{30, 60, 120, 240}`. **Omitting the
deadline gives 60**; the web app preselects 30 (`tournaments.rs:62-63`, `:2082`;
`frontend/src/pages/tournaments/Create1v1Challenge.tsx:214-227`). `deadline` and `starts_at` are still
required by the body but the server sets deadline = now + minutes and start = deadline + 5 min
(`tournaments.rs:2241-2248`). A user id comes from `GET /api/users/search?q=` or `GET /api/users/{address}`.

Errors (`tournaments.rs:2055-2248`): `1v1 challenges (max_teams=2) require format=knockout`,
`1v1 challenges are Silver or Gold; Bronze is for developer challenges only`,
`1v1 challenges must have min_teams=2`,
`challenge_deadline_minutes must be one of [30, 60, 120, 240], got {n}`,
`You cannot challenge yourself {EM} choose a different opponent`,
`Targeted opponent not found {EM} they need to register on the platform first`,
`You already have an active 1v1. Finish it or cancel it first.` (one active 1v1 per wallet, created or
joined; `tournament.one_v_one_max_active_per_user`), `You have a tournament match within the hour. Finish it first.`
(busy with a tournament, the rows of the join gate in section 10.4).

**The creator pays first.** After create, the creator pays `joinTournament` and calls `/join` like any
joiner (`Create1v1Challenge.tsx:442-475`). Until then others get `Creator must join first {EM} slot 1 is reserved`.
An unjoined challenge can be removed with `/cancel`; after paying, withdraw with `/delete` (refund and
close) or `/leave` then `/cancel` (`frontend/src/lib/challengeCreateRecovery.ts:18-26`).

**List**: `GET /api/tournaments?kind=challenge` (the Challenges page, `frontend/src/pages/tournaments/Challenges.tsx:108`)
and `GET /api/notifications/challenges-for-me` (auth): `[{tournament_id, title, creator_user_id,
creator_team_name, entry_fee_foxsy, deadline}]`, up to 20 (`backend/src/routes/leaderboard.rs:480-579`).

**Accept** = the paid join of section 10.4 (same fee). A targeted challenge accepts only the creator and
the target; the contract enforces it through the `allowed` list (`tournament_manager.rs:290-295`).
There is no decline route: ignore it. Accepting needs 11 match-fit players, no card in a transfer
cooldown, no other active 1v1 and a team not busy with a tournament (section 10.4: an own match from 1 h before
kickoff until its broadcast ends, a group or a Swiss round until all of it has ended). The agent refuses the join
and the create while FoxLeague's `viewer_blocked_tournament_window` says so and wherever its own fixtures cannot
show that a group or round has ended (`oneVOneBusy`, `src/executor/rules.ts`).

**When it fills** the deadline becomes now and the match is scheduled 3 to 12 minutes later depending on
queue load, pushed past either side's busy windows (`tournaments.rs:4922-5147`;
`backend/src/config_registry.rs:365-384`). The squad snapshot is taken right away (section 8.3).

**Expiry**: unaccepted at the deadline, the challenge is cancelled and the creator refunded in full
(`refundEntries`), then closed; `claimRefund` recovers anything left (manual `mechanics/one-v-one.mdx:83-93`).

**Outcome**: no draws (extra time, then penalties). Winner 90 percent, platform 10 percent (seeded),
loser nothing; paid about 180 s after the reveal (`backend/src/tournament_engine.rs:490-521`;
`tournament_simulator.rs:3712-3748`). Condition cost 10 per appearance for both sides; ELO K 13 (Silver)
or 17 (Gold); counts as competitive. A 1v1 win does not count as a tournament win.

---

## 12. Shop

### 12.1 How every shop payment works

**One contract endpoint for every product.** `shopPay()` on the players contract accepts any positive
FOXSY amount and books it to the treasury (`contracts/foxleague-players/src/player_nft.rs:2274-2287`). It
does not know what you bought: the backend decides from your confirm call. Since the players contract upgrade (live
on mainnet 2026-10-26) it also writes the payer's refundable record, so a refund goes back to the payer within a
25-hour window.

- **Transaction** (`frontend/src/lib/foxsyPaymentTx.ts:35-79`): receiver = players contract, value 0,
  gas 12,864,100 (12,000,000 before the refundable record), version 1,
  `data = ESDTTransfer@464f5853592d356435663365@<amount atomic hex>@73686f70506179`, no arguments (no
  product id, no card nonce). Example, one Common pack:
  `ESDTTransfer@464f5853592d356435663365@878678326eac900000@73686f70506179`.
- Contract reverts: `Contract is paused`, `Pay with FOXSY`, `Must send FOXSY`.
- **Confirm**: `POST /api/shop/confirm` (auth) with
  `{wallet_address, tx_hash, product, player_nonce?, player_nonces?, quantity?}` where `product` is
  `condition_recovery`, `xp_booster`, `training_slot` or `common_pack` (`backend/src/routes/shop.rs:142-156`, `:188`).
  Response `{purchase_id, product, message}` (`shop.rs:166-170`).
- **Verification order** (`shop.rs:2170-3110`; `backend/src/chain_verify.rs:399-576`): wallet match,
  valid product, pack pre-checks, quantity, chain ready, not already used, price, then the transaction:
  final status, no `signalError`, sender = you, receiver = players contract, function `shopPay`, token
  FOXSY, amount. Every product except condition recovery must pay **exactly** `price x 10^18`
  (`shop.rs:414-445`).
- **Prices**: read `/api/shop/status` `prices` (or `/api/config` `shop_prices_foxsy`,
  `common_pack_price_foxsy`) right before signing. Condition, booster and training prices mirror the
  contract views `getShopConditionPrice`, `getShopXpBoosterPrice`, `getShopTrainingPrice`; pack, transfer
  waiver and badge prices come from the backend registry (`backend/src/chain_config.rs:194-204`,
  `:522-524`; `shop.rs:272-281`). The contract enforces no shop price; the backend confirm is the only gate.

**Confirm within 30 minutes.** A `shopPay` that settled but was never confirmed is **refunded, not
delivered**, after `shop.unconfirmed_refund_grace_secs` (1,800 s) by the reconcile sweep, which looks back
7 days (`backend/src/config_registry.rs:3039-3042`; `backend/src/shop_refund_reconcile.rs:1195-1230`,
`:1263-1264`, `:1536-1540`). The timeout message says so:
`Transaction verification timed out: {e}. The payment is not lost: it is recognized when this same transaction is confirmed again within {N} minutes; after that it is refunded automatically.`
(`shop.rs:2697-2717`).

**Recovering a pending confirm** (mirror `frontend/src/lib/pendingShopConfirm.ts`): store
`{hash, payload, savedAt}` per wallet and product as soon as the transaction is sent; before paying
again, re-check the stored hash: `success` or timeout means confirm it; `fail` or `invalid` means forget
it and pay again; "not found" older than 10 min means pay again, younger means wait. Forget a hash only
on a verdict: keep it on `tx_pending`, on a transport error and on any non-200. Entries expire after 24 h
(`pendingShopConfirm.ts:45-109`, `:248-331`).

**Automatic refunds.** A verified payment the backend cannot use (wrong amount, cap reached, sold out,
card gone) is refunded once per hash through `refundFromTreasury`, signed by the game server
(`backend/src/chain.rs:7214-7234`; `player_nft.rs:1007-1031`), at most 10 per wallet per hour (then held
for an operator) (`config_registry.rs:3051-3057`). The outcome is appended to the error:
` Your payment is being refunded automatically.`, ` Your refund has been queued and will be issued by our team.`,
` The automatic refund could not be issued {EM} our team has been notified and will return your payment.`
and others (`shop.rs:1316-1345`).

**Final refusals for a hash** (`shop.rs:1143-1159`): `Transaction already processed`,
`This payment was already refunded and cannot be used for a purchase.`,
`This transaction was already used for a badge regeneration.`,
`Our support team is handling this payment and will return it to you, so it cannot be used here.`
(`Could not verify the payment state right now. Please retry in a moment.` is `tx_pending`.)

**History**: `GET /api/shop/purchases?wallet_address=&limit=&offset=` (limit default 20, max 200):
`[{id, product, tx_hash, amount_foxsy, player_nonce, slots, verified_at}]` (`shop.rs:173-181`, `:4004-4046`).

### 12.2 Products

**A. Condition recovery** (`condition_recovery`)

- Restores condition points up to 100 on your cards (`shop.rs:2835-2848`).
- Price per card: `ceil(100 x (100 - condition) / 100)`, about **1 FOXSY per missing point**
  (`shop.rs:310-314`; `frontend/src/lib/conditionRecovery.ts:14-28`).
- Body: `player_nonce` or `player_nonces` (one is required). Pay any whole FOXSY amount of at least one
  point; it becomes a points budget spent on the cheapest cards first; unused points and overpayment are
  refunded automatically (`shop.rs:372-405`, `:2382-2397`, `:2904-2990`). The web app pays the exact total
  it quoted (`frontend/src/hooks/useConditionRecovery.ts:130-175`).
- Messages: `{n} player{s} condition recovered`,
  `Nothing to recover {EM} the selected players are already at full condition.`,
  `None of the {total} selected player{s} could be recovered {EM} ...`,
  `Could not price the recovery right now. Please retry in a moment.` (`tx_pending`) (`shop.rs:640-667`, `:2285`, `:2346`).

**B. XP booster** (`xp_booster`): **2,000 FOXSY**, exact. 2x training and match XP for 24 h from the
verified purchase; buying again restarts the clock (no stacking), so the agent buys another only when
`/api/shop/status` shows `xp_booster_active` false or at most 2 h to `xp_booster_expires_at`; the highest active multiplier wins
over the featured-tournament ones (`shop.rs:771-789`, `:3057-3080`; `config_registry.rs:738-744`). Useful
only with XP sources: training plus Silver/Gold tournament and 1v1 matches.

**C. Paid training slots** (`training_slot`): **20 FOXSY each**, pay exactly `20 x quantity`, `quantity`
at least 1 (`Invalid quantity {EM} training slots require a count of at least 1.`). Banked, never expire;
at most 10 used per day on top of the 5 free sessions (`shop.rs:224-247`, `:501-509`, `:2206-2209`). The
web app caps one purchase at 25 slots; the backend has no upper bound
(`frontend/src/pages/Marketplace.tsx:4382-4391`). Message: `Extra training slots purchased: +{slots}, balance now {n}`.

**D. Common pack** (`common_pack`): **2,500 FOXSY** for 5 Common cards, exact (the wallet's own price from the
MetaStaking discount's switch, section 27). At most 2 per wallet a week, from Monday 14:00 UTC (a rolling 7 days
before 2026-11-16; `common_pack_week_resets_at` says when the week starts again); platform budget 500 cards (100 packs)
in any 24 hours on chain; positions drawn 2/6/6/4 like a
starter squad (`backend/src/routes/shop_pack.rs:25-32`; `deploy/mainnet/chain-config.mainnet.env:50-52`).
Check `/api/shop/status` `common_pack_available`, `common_pack_remaining_this_week` and
`common_pack_epoch_remaining` before paying (the agent buys no pack unless `common_pack_remaining_this_week` reads as a
number above 0: a status that failed or an answer without it is unread, never "some left"; its plan is told the
number). Cards are delivered by the game server a minute or so later
(`distributePack`), with 0 competitive matches and no cooldown; a failed delivery is refunded
(`shop_pack.rs:647-745`). Refusals (the settled payment is refunded):
`The Common pack is not on sale right now.`,
`You already bought {cap} Common pack{s} in the last 7 days. The next pack unlocks when the oldest one leaves the window.`,
`The Common pack is sold out: fewer than 5 Common players are left in the pool. Try again once the pool is restocked.`,
`The Common pack budget for this epoch is exhausted. Packs are on sale again in the next epoch.` (`shop.rs:3140-3211`).
Success: `Common pack purchased: 5 players on the way (delivered by the game server within a few minutes).`

**E. Transfer-cooldown waiver ("Reduce Cooldown")**: shortens the lock on a card received wallet to
wallet (504 h for a card at its match gate) down to a 72 h floor. Since 2026-10-12 a card moved before
its gate is locked 504 h plus 6 h per missing match, and Reduce Cooldown does not apply to that lock
(each match waiver takes 6 h off instead).

1. `GET /api/shop/waive-cooldown/quote?player_nonce=` (auth):
   `{player_nonce, remaining_seconds, days_paid, cost_foxsy, price_per_day, floor_hours}` (`shop.rs:3553-3580`).
   Price per day by rarity: Common 25, Uncommon 75, Rare 200, Epic 500, Legendary 1,250 FOXSY; all
   remaining days above the floor, rounded up. Since 2026-10-12 `?days=N` (1 to `max_days`) quotes and
   buys only some of them; the answer adds `max_days`.
2. Pay `shopPay` with exactly `cost_foxsy`.
3. `POST /api/shop/waive-cooldown {wallet_address, player_nonce, tx_hash}` (auth); answer
   `{player_nonce, cost_foxsy, remaining_hours}` (`shop.rs:3387-3393`, `:3614-3990`).

Errors: `That player is not in your wallet.`, `This player has no active transfer cooldown.`,
`This player is already within the un-waivable {72}h floor.`,
`Transaction paid {paid} FOXSY but the waiver costs {cost} FOXSY.` (plus refund text),
`This transaction was already processed for a cooldown waiver.`,
`This player is no longer in your wallet {EM} the waiver was not applied.` (plus refund text). The quote
is recomputed at confirm and must match exactly, so confirm promptly.

**F. Badge regeneration**: section 4.6 (1,000 FOXSY after 3 free).

**G. Fusion waivers**: shown in the Shop but paid per card to the contract with no backend confirm
(section 13.4).

---

## 13. Fusion

### 13.1 What it does and its gates

**From FoxLeague's fusion switch** (`/api/config` `fusion_mint.live_from`, 2026-11-20 14:00 UTC on mainnet) the
fusion of 13.1 to 13.3 reverts and every fusion is a `fusionMint` (section 13.5). Before it, everything here holds.

Burns 3 cards of the same rarity plus a FOXSY fee and hands you 1 card of the next rarity: since 2026-10-12
a **random card** of the pre-minted pool for that rarity and the chosen input's position, drawn by the
contract (`player_nft.rs:2289-2531`, `:2461-2494`). Choosing the position does not choose the card.
Fees: Common 100, Uncommon 200, Rare 400, Epic 800 FOXSY (Legendary cannot be fused). Pay at least the
fee; excess is refunded. The binding on-chain gates, in the contract's order:

1. **The match gate of the input's rarity**, counting waived matches: `matches_played + fusionMatchCredit >= gate`, with `(gate, floor, price)` = `getRarityMatchGate(level)`: Common 5, Uncommon 15, Rare 45, Epic 135 on mainnet since 2026-10-12 (before: `getFusionMinMatches` = 20 for all).
2. **The gate's floor really played**: `matches_played >= floor`: Common 5, Uncommon 5, Rare 15, Epic 45 (before: 5 for all).
3. **Wallet spacing 20 h** since your last fusion (`getFusionCooldownSeconds` = 72,000 s), not waivable (`:2393-2411`).
4. **Per-card cooldown**: each input's `getFusionReadyAt(nonce) <= now`; every fusion output is stamped
   now + 14 days (`getFusionCardCooldownSeconds` = 1,209,600 s) (`:2413-2431`, `:2502-2506`).

`matches_played` on chain is the **competitive** count written by sync (section 7): **sync every input
first**: otherwise the contract sees an old count. Only Silver/Gold tournament and 1v1 matches count (section 9.3).
Off chain, the web app also excludes listed cards and cards under a transfer cooldown; a fused output
inherits the longest transfer cooldown of its inputs (`frontend/src/components/FusionTab.tsx:202`;
`backend/src/chain_indexer.rs:3646-3656`). Fusing leaves you 2 cards fewer; a match needs 18.

Pool stock: view `getFusionPoolCount(level 1..4, position 0 GK / 1 DEF / 2 MID / 3 FWD)`. An empty pool
reverts the fusion and nothing is burned.

### 13.2 Pre-check: `GET /api/fusion/can-fuse[?nonces=a,b,c]`

Auth, advisory (`backend/src/routes/marketplace.rs:2345-2525`). Answers
`{can_fuse:false, cooldown_remaining, cooldown_end}` (wallet spacing, read from the database),
`{can_fuse:false, reason:"dirty_stats", dirty_players}`,
`{can_fuse:false, reason:"card_cooldown"|"below_match_floor"|"insufficient_matches", blocked_players, min_matches_required, match_floor_required, cards}`
(each card `{nonce, name, competitive_matches, fusion_match_credit, fusion_ready_at, in_cooldown, below_match_floor, eligible}`)
or `{can_fuse:true, ...}`. The binding clock is the view `getLastFusionTimestamp(address)`.

### 13.3 The fusion transaction

As built at `frontend/src/components/FusionTab.tsx:377-420`: **receiver = your own address**, value 0,
gas 22,800,000 (21,000,000 before 2026-11-13), version 1:

```
MultiESDTNFTTransfer@0000000000000000050078fcafca32e94d2f1c49a28cfcadb68ad860363fe2f3@04
  @464f5853592d356435663365@00@<fee atomic hex>
  @46584c502d366632386535@<nonce1 hex>@01
  @46584c502d366632386535@<nonce2 hex>@01
  @46584c502d366632386535@<nonce3 hex>@01
  @667573696f6e@<position_choice>@<portrait_choice>
```

(one line, no spaces). FOXSY must be the first transfer. `position_choice` 0, 1 or 2 picks which
input's position the output takes; `portrait_choice` 0, 1 or 2 is required but unused on chain. The
web app encodes 0 as `00` (`numberToHex` of 0n gives `0`, padded to `00`).

Reverts (`player_nft.rs:2303-2491`): `Contract is paused`, `Contracts cannot fuse`, `Send FOXSY + 3 NFTs`,
`position_choice must be 0, 1, or 2`, `portrait_choice must be 0, 1, or 2`, `First payment must be FOXSY`,
`Wrong NFT collection`, `Send exactly 1 of each NFT`, `Duplicate NFT nonce`, `All 3 must be same rarity`,
`Cannot fuse Legendary`, `NFT #{i} has not played enough matches for fusion`,
`NFT #{i} is below the fusion match floor`, `Fusion cooldown active`, `Fusion cooldown active for NFT #{i}`,
`Fusion cost not set for this rarity`, `Insufficient FOXSY for fusion`,
`Fusion pool empty for this rarity/position. Try again later.`, `Nonce has an active marketplace listing`,
`Nonce has an active auction`. A revert is atomic: the cards come back. The protocol error
`new NFT data on sender` is a cross-shard race right after another update of the same card: wait about
45 s and retry (`frontend/src/lib/fusionTxOutcome.ts:1-40`).

**Confirm** (best effort): `POST /api/fusion/confirm {tx_hash, burned_nonces?}` (auth) answers
`{confirmed, indexed, message}`; the chain indexer processes fusions on its own either way
(`marketplace.rs:2606-2912`). Errors include
`Fusion didn't go through {EM} the transaction reverted on chain, so your input players are safe and were not consumed. You can simply try again.`
and `Fusion cooldown active {EM} {d}d {h}h remaining`. History: `GET /api/marketplace/fusion-history`
(section 3.5).

### 13.4 Waivers (per card, no backend confirm)

Both use the same custody shape as fusion (`frontend/src/lib/fusionWaivers.ts:248-290`): **receiver =
your own address**, gas 15,000,000 and the **exact** amount:

```
MultiESDTNFTTransfer@<players SC hex>@02@464f5853592d356435663365@00@<exact cost atomic hex>@46584c502d366632386535@<card nonce hex>@01@<endpoint hex>@<args>
```

The card goes to the contract and comes back in the same transaction. The chain indexer mirrors the
result (`backend/src/chain_indexer.rs:3867-3925`). A listed or auctioned card cannot be waived.

- **Cooldown waiver** `payFusionCooldownWaiver(nonce, days?)`, args `@<nonce hex>` for every quoted day or
  `@<nonce hex>@<days hex>` for 1 to the quoted days (since 2026-10-12; the ready time moves that many days
  earlier, never inside the floor; reverts `Cooldown waiver exceeds the floor` above the quote): 75 FOXSY
  per day down to a 3-day floor, at most 11 days (825 FOXSY) per card. Quote with the view
  `getFusionCooldownWaiverQuote(nonce)` returning `(days, cost)` (storage-only, any shard). Sign
  `fusion_cooldown_waiver_price_per_day_wei x days` from `/api/config`, never a rounded whole-FOXSY
  value (`player_nft.rs:2542-2631`, `:2951-2955`; `fusionWaivers.ts:266-279`). Reverts:
  `Fusion cooldown waiver disabled`, `Wrong waiver payment`, `Caller does not own this NFT`, `Nothing to waive`.
  The quote's days are ceil((readyAt - now - floor) / 1 day) at the block: within 10 minutes of the moment they drop by
  one, before it or after it by the agent's clock (the quote read from a block a little behind), the agent buys one day
  less, named, which the contract takes on either side of that moment; a last day about to end or just ended is not
  bought (audit 2026-11-16, CHN-U4 and R2M-2).
- **Match waiver** `payFusionMatchWaiver(nonce, matches)`, args `@<nonce hex>@<matches hex>`: since
  2026-10-12 priced by rarity, Uncommon 20 FOXSY per match (at most 10), Rare 100 (30), Epic 100 (90),
  Legendary 100 (270), none for a Common; the gate's floor must really be played. The credit stays on the
  card, also after a sale. Quote with `GET /api/players/nonce/{nonce}/match-waiver-quote` (auth, your card):
  `{max_purchasable, chain_played, credit, price_wei, rarity, gate, floor, price_per_match, meets_gate,
  row_set, transfer_lock}` (`backend/src/routes/players.rs`).
  Do not use the view `getFusionMatchWaiverQuote` from another shard: it answers `(0, price)` there
  (`player_nft.rs:2957-2988`). Reverts: `Fusion match waiver disabled`, `Wrong waiver payment`,
  `Failed to decode NFT`, `Match waiver exceeds the floor`.

### 13.5 From the fusion switch: `fusionMint` (FoxLeague #711 and #736)

The players contract carries `fusionMint` since its upgrade of 2026-11-13 21:32:50 UTC (code hash `e628771c...`,
`getFusionMintVersion` 2). Its switch is `getFusionMintLiveFrom`, served as `/api/config`
`fusion_mint: {live, live_from, paused}` (`backend/src/routes/config.rs`): `2026-11-20T14:00:00Z` on mainnet, read
2026-11-15. From it the old `fusion` and `loadFusionPool` refuse on chain, the pool is emptied (`clearAllFusionPools`)
and `GET /api/fusion/can-fuse` with nonces answers an error with code `fusion_mint_live` (without nonces:
`can_fuse:false, reason:"fusion_mint_live"`; the wallet spacing still answers first). `paused: true` is the version
mismatch of contract and server past the live time: no fusion of either kind can run, `can-fuse` and the prepare answer
code `fusion_updating`.

**Prepare:** `POST /api/fusion/prepare {nonces: [3], position_choice: 0..2}` (auth, a registered wallet;
`backend/src/routes/fusion_mint.rs`). It refuses before the live time, then checks the three cards (one rarity, not
Legendary, not listed, not injured, not suspended, the wallet spacing, each card's fusion cooldown, the match gate and
floor on the LIVE competitive matches plus credit, a cost set), that the wallet holds them on chain, reserves a new
face for the chosen position and output rarity, reads the floors (`getFusionMintFloor`), computes the stats and signs
it all (ed25519, message tag `fusionMint.v2`, valid 10 minutes). It answers `{sc_call_data, receiver, gas_limit, expiry,
cost_raw, foxsy_token_id, nonces, position_choice, preview: {position, rarity, ovr, stats[{stat, value, input_values,
scaled_value}]}}`. Asked again with more than 5 minutes left on its signature it answers the same signature; a new one
at most every 2 s a wallet (refusal code `fusion_prepare_pace`). No sync is needed: the server signs the cards' live
attributes (the sync encoding).

**The transaction:** receiver = your own address, value 0, version 1, data = `sc_call_data` byte for byte, gas =
the served `gas_limit` (FoxLeague's app signs nothing outside 24.3M to 48.6M):

```
MultiESDTNFTTransfer@<players contract hex>@04@<FOXSY hex>@00@<cost>
  @<FXLP hex>@<nonce1>@01 @<FXLP hex>@<nonce2>@01 @<FXLP hex>@<nonce3>@01
  @<"fusionMint" hex>@<position_choice>@<expiry>@<signature 64 bytes>@<new card>
  @<nonce1>@<attrs1>@<nonce2>@<attrs2>@<nonce3>@<attrs3>
```

(one line; numbers as minimal even-length hex, 0 the empty argument; `fusion_mint.rs` `call_data`, `call_arguments`).
The FOXSY leg is the fusion cost of the rarity, not signed; `cost_raw` names the same amount.

**The new card:** each of its 7 stats is `(a + b + c) x new cap / (3 x old cap)`, one integer division (caps 30, 55,
75, 90, 100), then the average floor (0, off) and the per-stat minimum of the output rarity (22, 30, 36, 40), at most
the new cap (`fusion_mint.rs` `mint_stats`; the contract's `fusion_mint_stats`). Level 1, no XP, condition 100, no
matches, 0 yellow cards, a new face, name, country and a random shirt; it carries an input's injury and ban as before.

**Confirm:** `POST /api/fusion/confirm {tx_hash, burned_nonces}` as for the old fusion; the indexer learns
`fusionMint` on its own.

**What the agent does** (`src/foxleague/levels.ts` `fusionMode`, `src/executor/rules.ts` `mintFusion`,
`src/executor/tx.ts` `fusionMintTx`): reads the switch from the snapshot's config at the action's own time; refuses any
fusion when the switch cannot be read, while `paused` and in the 10 minutes before `live_from`; before it, the old
fusion (13.3); from it, asks the prepare (once more after the pace refusal), takes FoxLeague's refusal as its word and
an unanswered prepare as no "yes"; it signs the served data with the served gas only when it is exactly the fusion
planned: the fee of the rarity and nothing more (the cost it names too), the three planned cards in their order as
transfers and as signed inputs, `fusionMint`, the position asked, an expiry 2 to 20 minutes ahead, a 64-byte
signature, gas inside 24.3M to 48.6M. Its own card checks stay (the gate on the live count, no listing, no transfer
lock, no fusion cooldown, no injury or ban, outside the 18, 18 cards left); the sync check, can-fuse and the pool are
not asked from the switch. The prepare is a write on FoxLeague, so the agent asks it only once every check of its own
has passed: the cards, the fee within Max shop payment and the FOXSY for it, the caps and the EGLD for gas, these two
counted with the least a fusionMint it would sign can cost (`fusionMintBound`). Its answer then goes through every
check again. A dry run asks no prepare: it checks the fusion the same way, counts its gas at the most a fusionMint can
take and simulates nothing, since the signature in it is FoxLeague's (GitHub review of PR #73, R73A-2).

---

## 14. Marketplace (auctions)

Every sale is a 24-hour English auction on the players contract; instant listing and instant buy
revert (`Instant listing disabled {EM} use auctionList`, `Instant buy disabled {EM} use auctionBid`;
`player_nft.rs:1825`, `:1863`). Mainnet tunables: reserve floor 500 FOXSY, increment 5 percent,
snipe window 300 s with 300 s extension, relist cooldown 48 h after a sale, fee 10 percent of the
winning bid paid by the seller, no royalty (`deploy/mainnet/chain-config.mainnet.env:25`, `:39-55`).
Live: `/api/config` `auction_*`, `marketplace_min_list_price_foxsy`, `marketplace_fee_percent`,
`auction_enabled`.

### 14.1 List

1. **Gate**: the card needs `matches_played + credit >= gate` and `matches_played >= floor` of its rarity on
   chain (since 2026-10-12: Common 5 / 5, Uncommon 15 / 5, Rare 45 / 15, Epic 135 / 45, Legendary 405 / 135;
   before: 20 / 5 for all), so sync first (`player_nft.rs:2650-2673`). Pre-check with `GET /api/marketplace/can-list?nonce=` (auth,
   advisory): `{can_list:false, reason:"below_match_floor"|"needs_competitive_matches", ...}` or
   `{can_list, can_relist_at, cooldown_remaining_seconds}` (`backend/src/routes/marketplace.rs:434-543`, `:698-734`).
2. **Transaction** (`frontend/src/pages/Marketplace.tsx:1099-1134`): **receiver = your own address**,
   value 0, gas 15,000,000, version 1:
   `ESDTNFTTransfer@46584c502d366632386535@<nonce hex>@01@<players SC hex>@61756374696f6e4c697374@<reserve atomic hex>`.
   Reserve in whole FOXSY, at least 500; the web app caps it at 1,000,000 (`Marketplace.tsx:198`).
3. **No backend call afterwards.** The indexer's `auction_listed` event creates the listing. Do not call
   `POST /api/marketplace/list`: it is the legacy fixed-price path (`backend/src/auction_settle_keeper.rs:17-23`).
   Wait until the card has left the wallet before listing another (the `new NFT data on sender` race,
   `Marketplace.tsx:1172-1196`).

Reverts (`player_nft.rs:2004-2071`): `Min price must be > 0`, `Whole FOXSY only`, `Min price too high`,
`Min price below the auction floor`, `Contracts cannot list`, `Wrong token`, `Must send exactly 1 NFT`,
`Already listed`, `Already auctioned`, `Player is below the competitive match floor`,
`Player needs more competitive matches to be listed`, `Relist cooldown active for this nonce`.

A listed card leaves your wallet (contract custody): it cannot play, sync, fuse or be waived. A
lineup that holds it fails the match gates.

### 14.2 Bid

Receiver = players contract, value 0, gas 13,500,000, version 1 (`Marketplace.tsx:1745-1761`):
`ESDTTransfer@464f5853592d356435663365@<bid atomic hex>@61756374696f6e426964@<nonce hex>`.

Rules (`player_nft.rs:2074-2152`): whole FOXSY; first bid at least the reserve; later bids at least
`top x 1.05` and above the top (the web app uses `max(ceil(top x 1.05), top + 1)`,
`frontend/src/lib/auctionRules.ts:146-155`); the previous top bidder is refunded at once; a bid with
less than 300 s left extends the end by 300 s, without limit. No backend call afterwards. Reverts:
`No auction`, `Contracts cannot bid`, `Seller cannot bid on own auction`, `Auction ended`,
`Pay with FOXSY`, `FOXSY is fungible (nonce 0)`, `Whole FOXSY only`, `Bid too high`, `Bid below reserve`,
`Bid must exceed current highest`, `Bid below minimum increment`.

Live auction state: view `getAuction(nonce)` returns
`Option<{seller, min_price, highest_bid (0 = none), highest_bidder, end_timestamp (seconds)}>`
(`player_nft.rs:150-167`, `:2989-2997`). The listing rows do not carry the top bidder.

### 14.3 Cancel and settle

- **Cancel** `auctionCancel(nonce)`: seller only, zero bids only. Receiver = players contract, gas
  12,000,000, `data = auctionCancel@<nonce hex>` (`Marketplace.tsx:1861-1873`; `player_nft.rs:2210-2230`).
  Reverts: `No auction`, `Only seller can cancel`, `Auction has bids {EM} cannot cancel`. Do not call
  `POST /api/marketplace/cancel` (it verifies the legacy `marketplaceCancel`); optionally call
  `POST /api/marketplace/reconcile {wallet_address}` (`marketplace.rs:1700-1968`).
- **Settle** `auctionSettle(nonce)`: anyone, after the end. Gas 13,500,000, `data = auctionSettle@<nonce hex>`.
  With a bid, the card goes to the top bidder and the seller gets 90 percent; without, the card returns
  to the seller (`player_nft.rs:2154-2205`). A backend keeper settles ended auctions every minute and
  pays the gas, so settling yourself is only a fallback (`backend/src/auction_settle_keeper.rs:1-7`;
  `config_registry.rs:3087-3088`). Reverts: `No auction`, `Auction not ended`.
- An auction win starts no transfer cooldown, but a lock the card already carries passes to the buyer
  (manual `mechanics/marketplace.mdx:58`).

### 14.4 Read routes (public)

| Route | Returns | Source |
|---|---|---|
| `GET /api/marketplace/listings?position=&rarity=&min_price=&max_price=&sort_by=price_asc\|price_desc\|overall_desc&limit=` | listing rows (card stats, `is_auction`, `min_price`, `highest_bid`, `ends_at`, `transferred_at`, `transfer_cooldown_hours`); limit default 50, max 200; prices whole FOXSY | `marketplace.rs:89-383` |
| `GET /api/marketplace/floor-prices` | `[{rarity, floor_price, count}]` (the reserve for auctions), cached 5 s | `marketplace.rs:547-587` |
| `GET /api/marketplace/recent-sales?limit=&offset=` | `MarketplaceSale[]` (`id, nft_nonce, player_name, position, rarity, overall, seller_address, buyer_address, price, tx_hash, sold_at`, newest first, price in whole FOXSY), limit default 20, max 100. The agent keeps every sale (`market_sales`) and reads only the new pages each plan, for the market price of each rarity (`src/snapshot/market.ts`) | `marketplace.rs:589-636` |
| `GET /api/marketplace/player-sales/{nonce}` | sales of one card | `marketplace.rs:638-673` |

---

## 15. Leaderboard and match history

| Route | Auth | Returns | Source |
|---|---|---|---|
| `GET /api/leaderboard?limit=&offset=&window=7d\|30d\|90d\|all` | public | `{users: UserPublicProfileView[], total, limit, offset, window}`; limit default 25, max 500; ordered by ELO; W/D/L windowed, ELO always lifetime | `backend/src/routes/leaderboard.rs:54-294` |
| `GET /api/users/search?q=&dev_only=` | public | up to 10 `{id, wallet_address, username, team_name, badge, elo_rating}`; `q` at least 2 characters | `leaderboard.rs:337-435` |
| `GET /api/users/{address}` | public | section 3.1 | `leaderboard.rs:437-477` |
| `GET /api/matches/history?wallet_address=&limit=&offset=` | public (any wallet) | `MatchHistoryView[]`, limit default 10, max 50; excludes errors, developer tests and unrevealed tournament matches; scores and `*_elo_after` null until revealed | `backend/src/routes/matches.rs:4658-4765`; `backend/src/models.rs:907-980` |
| `GET /api/matches/{id}` | public | section 9.2 | `matches.rs:4297-4331` |
| `GET /api/matches/{id}/stats` | public | before the reveal only `{gated: true, ...}`; after it the analysis, formations and lineups | `matches.rs:8392-8605` |
| `GET /api/public/tournament-match/{id}/stats` | public | the same for a tournament or 1v1 match by its public id (`tournament_match_id` of a history row, which has no `id`) | `matches.rs:10886` |
| `GET /api/public/match/{id}` | public, raw JSON | tournament and 1v1 matches only; names `TBD` and scores null while hidden | `matches.rs:612-791` |

The statistics (about 120 KB) carry `home_formation` and `away_formation` as played, and `home_lineup` /
`away_lineup` (`{lineup, players, formation, substitutes, wallet_address}`, each player with its seven stats,
`condition` and `is_starter` as fielded). The agent reads them for its formation record: its own last 50 revealed
matches and the last 3 of each of its next rivals, at most 16 new reads per plan, each match read once
(`src/snapshot/snapshot.ts`, `src/store/db.ts` `match_facts`).

The league formation table (owner, 2026-11-04) reads the same two routes for other teams. Each plan reads the history
(`GET /api/matches/history?wallet_address=...&limit=20`) of the next 3 of the leaderboard's top 100 by ELO, in turn
from plan to plan, and at most 6 new statistics; a plan whose reads run out stays on the team it could not finish,
and a match whose statistics did not answer waits 6 hours; plans that run at once take turns (each waits at most 60 seconds, then skips the league reads that time). It keeps only ranked and tournament matches between two real teams
(`match_type` `ranked` or `tournament`, both user ids set: no AI side, no casual game), never one of the owner's
teams, with `home_elo_at_match` and `away_elo_at_match` from the history row (`src/store/db.ts` `league_matches`, 30
days; the table counts 14). A ranked match's strengths are kept only when read within 6 hours of its end, as for the
formation record.

`Invalid window '{x}'. Use one of: 7d, 30d, 90d, all` for a bad window. Windowed records and recent form
count only revealed matches (`leaderboard.rs:149-166`).

---

## 16. Relayed transactions and the new-wallet bonus

- **Only `registerAndPay` is relayed.** The single relay call site is the onboarding
  (`frontend/src/pages/Onboarding.tsx:891`, via `frontend/src/lib/api.ts:2113-2117`). Every other
  transaction, swaps included, is signed and paid by the player in EGLD
  (manual `legal/terms.md:33`). Keep EGLD for gas.
- **Relayer choice**: by the sender's shard, from `/api/config` `relayer_addresses` (section 4.4).
- **Relay ceilings and limits**: `relayer_v3.max_gas_limit` (default 12,500,000, served as
  `relayer_max_gas_limit`), gas price exactly 1e9, 3 relay calls per wallet per 600 s (in memory),
  5,000 relays per day platform-wide (`backend/src/config_registry.rs:2080-2164`). `/api/config`
  `relays_remaining_today` shows what is left; the web app closes onboarding at 0.
- **New-wallet EGLD bonus** (`backend/src/routes/registration.rs:1016-1130`, `:1654-1710`;
  `backend/src/sync_worker.rs:1541-1643`):
  - paid only on the normal registration path (not the 18-card bypass);
  - only if the wallet holds **less than 0.01 EGLD** when `/api/register` runs
    (`relayer_v3.bonus_egld_balance_gate_wei`);
  - only while fewer than `onboarding.bonus_egld_max_recipients` distinct wallets have received it:
    **the first 100 wallets** on mainnet (252 until 2026-09-28; `deploy/mainnet/inputs.example.env:28-31`; manual
    `getting-started/onboarding.mdx:74`);
  - amount `onboarding.bonus_egld_send_wei` = **0.1 EGLD** (`inputs.example.env:27`; `deploy/mainnet/seed.sh:42`),
    sent later from the wallet-shard relayer, inside a rolling 24 h cap of 100 EGLD;
  - it is a promotion, not an entitlement (manual `legal/terms.md:35`). A client that already bought
    FOXSY with its own EGLD usually holds more than 0.01 EGLD and gets nothing. How many of the 100 are
    left is not public.

---

## 17. Rate limits

### 17.1 Edge (nginx, per client IP behind Cloudflare)

| Scope | Limit | Source |
|---|---|---|
| `/api/` | 30 requests/s, burst 50 (`nodelay`), HTTP 429 beyond | `deploy/mainnet/nginx/foxleague-zones.conf:3`, `:10`; `app.conf.template:106-110` |
| `/ws/` | 5 upgrades/s, burst 10; 300 s read timeout | `foxleague-zones.conf:4`; `app.conf.template:112-121` |
| Connections | 40 concurrent per IP | `app.conf.template:41` |
| Body size | 2 MB | `foxleague-zones.conf:15` |

The client IP is taken from `CF-Connecting-IP` (`foxleague-zones.conf:21-37`). Whether Cloudflare adds
automation challenges for non-browser clients is not in the repo.

### 17.2 Backend limits on player routes

| Route | Limit | Refusal | Source |
|---|---|---|---|
| `POST /api/matches/play` | 1 in flight per user; 30 s between match starts; 15 min between ranked; 5 per day; 3 simulations platform-wide | section 9.1 | `matches.rs:1020-1247`, `:1667-1729` |
| `POST /api/training/train` | 1 per 500 ms per wallet; 15 per day | `Training too fast {EM} wait a moment` | `training.rs:112-133` |
| `GET /api/sync/repair` | 1 per 30 s per wallet | `Sync from chain {EM} please wait a few seconds (limit: once every {s}s)` | `sync.rs:132-171`, `:1353-1366` |
| `POST /api/onboarding/relay` | 3 per 600 s per wallet (HTTP 429); 5,000 per day global (503) | section 4.5 | `onboarding.rs:2091-2193` |
| `POST /api/onboarding/generate-badge` | 3 per 10 min per wallet or paid hash | `Too many badge generation requests. Please wait a few minutes.` | `onboarding.rs:27-52` |
| `POST .../matches/{mid}/react` | 1 per 30 s per wallet per match | `Rate limit: wait up to 30s between reactions on the same match` | `tournaments.rs:6917-6960` |
| `GET /api/whitelist/check` | 30 per minute per IP, only while the whitelist is required | `Rate limit exceeded {EM} try again in 60 seconds` | `admin.rs:5876-5929` |
| `/ws/match/{id}` | 50 concurrent sockets per IP (HTTP 429) | empty body | `matches.rs:2162-2186` |
| `POST /api/events` | 10 per 60 s per IP (HTTP 429) | `{"ok":false}` | `backend/src/routes/events.rs:18-35` |
| Shop refunds | 10 automatic refunds per wallet per hour | refund held for an operator | `config_registry.rs:3051-3057` |

Freshness limits that behave like rate limits: the 30 s roster cache (section 3.3), the 300 s login
signature window plus the shop and join verification windows (10 s poll budget before `tx_pending`).

### 17.3 MultiversX limits

- **Public API quota**: the repo quotes the MultiversX documentation, "Mainnet: Maximum of 2 requests /
  IP / second" for `api.multiversx.com`; it notes the gateway documents no limit
  (`backend/src/config_registry.rs:2719-2727`).
- **The backend's own buckets**: gateway 5 requests/s (burst 5), API 1.8 requests/s (burst 2), keys
  `chain.gateway_rate_per_sec`, `chain.gateway_burst`, `chain.api_rate_per_sec`, `chain.api_burst`
  (`config_registry.rs:2711-2736`; `backend/src/lib.rs:866-976`). Transaction status polling starts at
  500 ms and backs off to 2 s (`config_registry.rs:2738-2742`).
- **The web app**: deduplicates identical in-flight reads and caches team and user reads for 5 s
  (`frontend/src/lib/sharedFetch.ts:56-95`; `frontend/src/lib/api.ts:88-101`); polls transaction status
  every 1.5 s with one shared read per hash (`frontend/src/lib/txFinality.ts:159-191`); reads balances
  gateway first, API second (`frontend/src/lib/chainBalance.ts:32-67`); polling intervals: active match
  5 s, notifications 60 s (300 s with the socket), dashboard 120 s, marketplace 15 s, upcoming 60 s,
  tournament detail 30 s, header balance 20 s.
- **For an agent**: stay at or under 2 API requests/s per IP, prefer the gateway for balances, nonces,
  views and transaction status. Back off on HTTP 429 from either FoxLeague or MultiversX.

---

## 18. Contract reference

### 18.1 Players contract (`contracts/foxleague-players/src/player_nft.rs`; ABI committed at `contracts/foxleague-players/output/foxleague-players.abi.json`)

**Player-callable endpoints**

| Endpoint | Payment | Shape (section) |
|---|---|---|
| `registerAndPay()` | exactly the fee in FOXSY | `ESDTTransfer` to the contract, relayed (4) |
| `shopPay()` | any positive FOXSY | `ESDTTransfer` to the contract (12) |
| `syncMyStats(timestamp, signature, updates...)` | FOXSY sync cost + the cards | `MultiESDTNFTTransfer` to self, payload from `/api/sync/prepare` (7) |
| `fusion(position_choice u8, portrait_choice u8)` | FOXSY fee + 3 cards | `MultiESDTNFTTransfer` to self (13) |
| `payFusionCooldownWaiver(nonce)` | exact FOXSY + the card | `MultiESDTNFTTransfer` to self (13.4) |
| `payFusionMatchWaiver(nonce, matches)` | exact FOXSY + the card | `MultiESDTNFTTransfer` to self (13.4) |
| `auctionList(min_price)` | the card | `ESDTNFTTransfer` to self (14.1) |
| `auctionBid(nonce)` | FOXSY | `ESDTTransfer` to the contract (14.2) |
| `auctionCancel(nonce)` | none | plain call (14.3) |
| `auctionSettle(nonce)` | none, anyone | plain call (14.3) |
| `marketplaceCancel(nonce)` | none | legacy fixed-price listings only |
| `marketplaceList`, `marketplaceBuy` | | always revert |

**Useful views** (`player_nft.rs:2712-3183`): `getRegistrationFee`, `isRegistrationPaid(address)`,
`getSyncCost`, `getLastSyncTimestamp(address)`, `getShopConditionPrice`, `getShopXpBoosterPrice`,
`getShopTrainingPrice`, `getFusionCost(level)`, `getFusionMinMatches`, `getFusionCooldownSeconds`,
`getFusionCardCooldownSeconds`, `getLastFusionTimestamp(address)`, `getFusionReadyAt(nonce)`,
`getFusionMatchCredit(nonce)`, `getFusionCooldownWaiverPricePerDay`, `getFusionCooldownWaiverFloorSeconds`,
`getFusionMatchWaiverPricePerMatch`, `getFusionMatchWaiverFloor`, `getFusionCooldownWaiverQuote(nonce)`,
`getFusionMatchWaiverQuote(owner, nonce)` (shard-dependent), `getFusionPoolCount(level, position)`,
`getAuction(nonce)`, `getLastPurchaseTimestamp(nonce)`, `getAuctionDurationSeconds`,
`getAuctionMinIncrementPercent`, `getAuctionSnipeWindowSeconds`, `getAuctionSnipeExtensionSeconds`,
`getAuctionRelistCooldownSeconds`, `getAuctionMinPrice`, `getMarketplaceFee`,
`getPackDistributionEpochCap`, `getPackDistributedThisEpoch`, `statCap(rarity)`. Do not use `levelFromXp`:
it is dead and disagrees with the game's level curve (`player_nft.rs:2770-2837`).

**Events**: `registration_paid`, `shop_paid`, `stats_synced`, `fusion`, `fusion_cooldown_waived`,
`fusion_matches_waived`, `auction_listed`, `auction_bid`, `auction_settled`, `auction_cancelled`,
`pack_distributed`, `treasury_refunded`.

**Owner or game server only** (not callable by a player): the setters and admin endpoints listed in the
ABI, plus `pause`, `refundFromTreasury`, `ownerSyncStats`, `distributeTeam`, `distributePack`,
`batchSetNewURIs`, `adminClearOrphanListings` (`Not authorized`, `player_nft.rs:3187-3196`).

**Pause**: every player endpoint reverts `Contract is paused` while paused (`player_nft.rs:1190`).

### 18.2 Tournaments contract (`contracts/foxleague-tournaments/src/tournament_manager.rs`; no ABI committed)

Statuses on chain: 0 none, 1 open, 2 active, 3 completed, 4 cancelled (`tournament_manager.rs:7-11`).

| Player endpoint | Payment | Section |
|---|---|---|
| `joinTournament(tournament_id: u64)` | exactly the entry fee in FOXSY | 10.4 |
| `claimRefund(tournament_id: u64)` | none | 10.7 |

Views (`tournament_manager.rs:642-711`): `getTournamentPool(u64)`, `getTournamentStatus(u64)` (u8),
`getEntryAmount(u64, address)`, `getTournamentEntryFee(u64)`, `getTournamentMaxEntries(u64)`,
`getTournamentAllowed(u64)` (address list, empty = open), `getTournamentEntryCount(u64)`,
`getFoxsyTokenId`, `getPlatformFeePercent`, `getMaxRoyaltyBps`, `isPaused`. The backend passes the id
as 16 hex characters in view queries (`backend/src/chain.rs:7259-7295`).

Events: `tournament_created`, `tournament_joined`, `prizes_distributed`, `royalty_paid`,
`entries_refunded`, `refund_claimed`.

Owner or game server only: `createTournament`, `setTournamentTerms`, `startTournament`,
`distributePrizes`, `refundEntries`, `closeTournament`, `clearCompletedEntries`, `pause`, the setters,
`withdrawPlatformFees`, `sweepUntracked`.

---

## 19. Routes a player client does not use

- `/api/admin/*`, `/api/dev/base-teams*`: admin-only.
- `/api/dev/teams*`: the developer mode (uploading your own AI binary); out of scope here.
- `/api/marketplace/list`, `/api/marketplace/sold`, `/api/marketplace/cancel`: legacy fixed-price flow;
  new sales are auctions (section 14).
- `/api/players/update`: kept but inert (player edits are disabled; `backend/src/routes/players.rs:26-32`).
- `/api/onboarding/testnet-faucet`, `/api/faucet`: testnet only (404 on mainnet).
- `/api/events`: client telemetry. `/api/push/*`: browser Web Push.
- `/healthz/*`: not reachable at the edge (section 1.1). `GET /api/health` answers
  `{status, db, tournament_manager, uptime_seconds}` (raw JSON).
- The match replay routes (`/api/replay`, `/api/live`, `/api/matches/{id}/log`) are for viewers.

---

## 21. Changes from 2026-10-15 to 2026-10-23

FoxLeague `origin/main` from `ed129a895` (the agent's last sync) to `9ddc0f911` (manual `565a902de`), read by the
audit of 2026-10-23. Paths are FoxLeague's at `origin/main`.

- **Registered wallets only.** Since the owner rule of 2026-10-20, create, train, sync prepare, the match waiver
  quote, notifications and push take `RegisteredWallet`: a wallet without a team gets HTTP 403 with the envelope
  "Register your team first." (`backend/src/auth.rs:466`, `:546`); the confirms and onboarding stay open. The agent
  calls those routes only when registered, and `call()` turns the envelope into an `ApiRefusal`.
- **Match slots.** `POST /api/matches/play` waits up to 30 s for one of the platform's match slots before it starts
  the match (`backend/src/routes/matches.rs:2268-2300`, `config_registry.rs:1341` `MATCH_SIM_SLOT_WAIT_MS 30_000`);
  the web app waits 90 s for the answer (`frontend/src/lib/api.ts:1114`).
- **League + Knockout ("Champions FoxLeague").** An admin-created format, off by default
  (`TOURNAMENT_LEAGUE_KNOCKOUT_ENABLED_DEFAULT 0`), seats by invitation in waves from the frozen leaderboard, one seat
  per team, a sponsor prize. Routes: `GET /api/tournaments/invitations` (own pending invitations: tournament_id,
  title, tier, entry_fee_foxsy, wave, expires_at, seats_lock_at, can_accept, refusal, prize_atomic, and since
  2026-11-03 prize_tiered: true when the held prize is on the tiered terms of #605/#608, 4 / 2 / 1 shares to the 8
  quarter-finalists, the 8 round-of-16 losers and the 8 play-off losers, false for equal shares among the 8
  quarter-finalists or no prize; `league_invitations.rs`), `GET /api/tournaments/{id}/invitations`, `POST /api/tournaments/{id}/invitation/decline`,
  `GET/POST /api/tournaments/{id}/prize[/deposit]`; accepting is the ordinary paid join through the invitation gate
  (`tournaments.rs:4881`). New join refusals (not invited, expired, declined, left, one seat, "still in <title>"),
  a leave refusal ("seats are locked since <time>") and create refusals (`snapshot_at`, `sponsor_prize_foxsy`,
  "Developer Mode needs an admin's approval"). Slot window: `(max_teams x 8 / 2 + 46) x 3` minutes
  (`tournaments.rs:1177-1181`). Since 2026-10-24 (owner) the agent accepts an invitation by itself
  (`join_tournament`: a pending invitation read again right before the payment with `can_accept` true and at least 30
  minutes to its `expires_at`, the entry within the owner's limits, the schedule check for 17 matches over its 190
  slots and the knockout's 9 matches in 46 slots, every level (Zeus only until 2026-11-06) with fewer than 24 clearly stronger invited teams read from
  `GET /api/tournaments/{id}/invitations`), never creates one (`unsupportedFormat`), leaves one only before its `seats_lock_at` (read again from
  `GET /api/tournaments/{id}/invitations`, 30 minutes of margin; leaving then refunds the whole entry) and only a seat
  it paid itself (never one the owner took, in FoxLeague or through Telegram `/do`), and
  refuses other standard tournaments while one of its own runs (FoxLeague's option C). Every planning snapshot reads
  `GET /api/tournaments/invitations` (FoxLeague's `league_knockout_enabled` gates only creating one) and the owner hears
  of each pending invitation once (`noticeInvitations`, `src/service.ts`). Facts from next-foxleague 75289fbbf:
  `tournament_engine.rs:1583-1648` (league phase), `:1817-1866` (knockout), `:1511-1546` (sequential schedule),
  `league_invitations.rs:1058-1062`, `:1339-1406` (refusals, one seat, option C), `:1167-1175` (seats lock). The paid
  invitation endpoints (`createInvitationTournament`, `addInvited`) are on the mainnet tournaments contract since
  2026-10-24 (`isInviteOnly` and `getSponsorPrize` answer on chain).
- **Fusion pre-check.** `can-fuse` gains the reasons `not_in_wallet` and `ownership_unreadable` and the refusal "A
  fusion takes at most 3 different card nonces." (`marketplace.rs:3486`, `:3512`); the agent refuses on any
  `can_fuse: false` with its reason.
- **Match waiver on the profile.** The match waiver is sold on the card's profile for every rarity with a waiver,
  Legendary included (for the listing gate; `frontend/src/components/CardMatchWaiver.tsx`, quote route
  `players.rs:1168-1170`, contract `pay_fusion_match_waiver` refuses only a 0 price).
- **Shop.** New confirm answers: "This payment is being refunded: the money has not been returned yet. It cannot be
  used for a purchase; if it does not arrive, contact support." (`shop.rs:1530`; the agent treats it as final and does
  not credit it, the conservative side), "Only a registered FoxLeague wallet can buy a Common pack ...", "Could not
  check your registration right now." (`tx_pending`), the pack "budget window" texts; the refundable record is
  consumed after delivery and a refund the contract refuses is handed to an operator (#503).
- **Sign-in budget.** `POST /api/auth/verify` answers 429 "Too many failed sign-in attempts" after 10 failed or
  replayed signatures per client or wallet in 60 s (5-minute lock); a fresh valid signature still passes.
- **Tournaments contract (on mainnet since 2026-10-24).** The upgrades of 2026-10-16/17/22/23 add invitation tournaments,
  sponsor prizes (settled after a 24-hour minimum run), royalties only to an approved provider or a seated
  participant, the owner's close while paused, and `joinTournament` refuses operator keys and contracts
  (`tournament_manager.rs:457`). Mainnet carries them since 2026-10-24 (read-only queries on chain). After the upgrade the web
  app's `JOIN_TOURNAMENT_GAS_LIMIT` is 8,400,000 (`frontend/src/lib/gasLimits.ts:32`; the heaviest join measured
  5,550,000): the agent followed to 8,400,000 once the upgrade was live on mainnet (2026-10-24: `isInviteOnly` and
  `getSponsorPrize` answer on chain).
- **What the agent does with them (audit 2026-10-23).** `playMatch` waits 95 s and reads `GET /api/matches/active`
  after a lost answer; a ranked or casual match's statistics (`/api/matches/{id}/stats`) carry the cards' current
  synced stats and `current_condition()` at read time (`launch_squad`), while `/api/public/tournament-match/{id}/stats`
  carries the lock snapshots, so the agent counts a ranked or casual strength edge only from statistics read within
  6 hours of `finished_at`; `league_knockout` slot window (max_teams x 8 / 2 + 46) x 3 in `src/executor/slots.ts`;
  a Legendary's match waiver is bought only for a spare it would list; the XP booster is applied when a match result
  is applied (`apply_match_results`, a purchase verified within the last 24 h; tournament and 1v1 results at the
  reveal), and every level (Zeus only until 2026-11-06) buys one only with such a fixture within 24 h, within its boosters a week. A planning snapshot also
  reads `GET /api/tournaments/{id}` (participants) for up to 4 open Silver or Gold tournaments and each seated team's
  players (and, when it is not on the leaderboard, its profile), with 20-minute caches. The one-card sync uses
  `/sync/prepare?wallet_address=&nonce=`.
- **Config.** `/api/config` adds `tournament_defaults.league_knockout_enabled`,
  `.league_knockout_min_invite_window_minutes` and `tx_signature_check_mode`; squads carry `shirt_number`; the upcoming
  route answers `is_home` false instead of null; notification kinds gain `match_ready` and `tournament_eliminated`.


## 22. FoxLeague's manual of 2026-10-24 (688088787) and the OVR range

- **Champions FoxLeague page** (`mechanics/champions-foxleague`), synced into `src/strategist/manual.md`: it states the
  rules the agent already follows (36 teams, 8 league matches, places 1 to 24 to the knockout, 190 matches one at a
  time, leaving until wave 3 with the entry refunded, no other standard tournament while it runs, one at a time,
  prizes 45/30/15 plus the prize from FoxLeague, for the top 24 in 4 / 2 / 1 shares since FoxLeague's main of
  2026-11-03, on the mainnet contract since 2026-11-04, synced at 6c7f26166). One difference: a team that is out is free
  again at once, while the agent's rule waits until the edition ends (the stricter side).
- **OVR range** (`ovr_min`, `ovr_max` on a tournament or a 1v1, whole numbers 1 to 100; next-foxleague
  `tournament_models.rs:241-252`, `ovr_range.rs`): checked once at the join against the team's best XI OVR (the average
  OVR of the strongest eleven it can field, to one decimal; `GET /api/teams/best-xi-ovr`, session). Outside it the join
  is refused and a paid entry refunded, the gas lost. Not live on mainnet on 2026-10-24 (no open tournament carries the
  fields; the route answers as the team route). The agent reads its best XI OVR right before paying into a ranged
  tournament or 1v1 and joins only inside the range (unreadable refuses); the plan sees each range and its own best XI OVR.
  An open tournament or challenge whose range shuts the team out says "closed to you: range X to Y, your best XI OVR Z"
  on its line (audit 2026-11-16, BEH-3b).
- **Smaller changes**: XP by the shirt worn (the keeper's shirt up to 910), ELO decay "at most once every 20 hours", a
  Fused mark on cards, a 1v1 can be created with an OVR range (the agent sets one only on what it creates, inside its own best XI OVR, since the
  same evening), and an unpaid challenge is
  cancelled after 20 minutes (the agent pays its seat right after creating, in the same action). FoxLeague compares
  the best XI OVR rounded to one decimal (held in tenths, `ovr_range.rs`), the same value its route answers.
- **Creating with a range** (owner, 2026-10-24, live on mainnet that evening: `GET /api/teams/best-xi-ovr` answers 401
  without a session): `create_tournament` and `create_challenge` take optional `ovr_min` and `ovr_max` (whole numbers 1
  to 100, min <= max, `parseAction`), sent in FoxLeague's create body. FoxLeague refuses a range on a League + Knockout or
  a developer tournament and a creator who takes a seat outside their own range (`ovr_range.rs` `validate`,
  `creator_check`, before any payment); the agent always takes its seat, so the rule refuses a range that does not hold
  its best XI OVR, read right before the create (unreadable: no range), and never sets one on a targeted challenge or a
  private tournament (it could only lock out the teams chosen). Since PR #36 the prompt makes a range the default on
  its own open tournament, about 10 percent either way around its best XI OVR (the snapshot suggests `ovr_min` and
  `ovr_max`); the plan may widen it when recent tournaments filled slowly. Since 2026-11-06 an open challenge, at every
  level, must carry a range whose maximum is at most its best XI OVR rounded up (FoxLeague's join check then keeps
  every team stronger by OVR out), and the maximum of a 1v1's range is never raised or removed.

## 23. Mainnet of 2026-10-26 (FoxLeague 4e42b94c9)

Checked read-only on 2026-10-26, after the owner upgraded mainnet:

- **Players contract upgraded** (refunds bound to the payer within a 25-hour window, owner-only stats and URIs, bounded
  budget windows; next-foxleague #543, #548): `getPackDistributedInWindow` and `getTreasuryRefundedInWindow` answer,
  `getTreasuryRefundedInEpoch` is gone. A shop payment writes the payer's refundable record (about 8.58M gas on
  testnet); FoxLeague's app signs it with 12,864,100 (#553), and so does the agent since this date.
- **One-signature 1v1** (#534): `tournament_defaults.challenge_create_and_join` is true and the tournaments contract's
  `getCreateAndJoinVersion` answers 1. The usual flow (`POST /api/tournaments`, then `joinTournament`) stays open and is
  the one the agent uses (the switch only offers `POST /api/tournaments/challenges/authorize` and `createAndJoin`).
- **One team OVR, the best XI OVR** (#541, #555): every team answer and leaderboard row carries `best_xi_ovr` (and
  `best_xi_formation`); `team_overall` is gone from the team answer (the client keeps it 0). The agent shows each rival's
  best XI OVR and counts how many leaderboard teams, and how many that took a 1v1 in 7 days they had not arranged (since 2026-11-06; since 2026-11-16 a stranger's 1v1 only, targeted or open, P3b), its suggested range lets
  in; the import preview shows the best XI OVR.
- **Widening a range** (#542, `POST /api/tournaments/{id}/ovr-range`, `ovr_range.rs` `widen_refusal`): the creator (or
  an admin) may widen the range of its open tournament or challenge while it is open for joining (status open, not past
  the deadline): lower the minimum or raise the maximum; a side left out keeps its bound, `null` removes it; never
  narrower, never a new bound on a side without one, never on a League + Knockout or a developer tournament; seated teams
  stay. Nothing is paid. Since 2026-10-26 the agent may widen its own (`widen_range`): the executor reads the tournament
  right before, the rules apply FoxLeague's checks, and the body carries only the sides the plan named. FoxLeague checks
  the team, so the agent widens only what it created itself (the id of a live create, kept in its activity row): a range
  the owner set with the same team, in FoxLeague or through Telegram /do, stays the owner's. The plan sees each of its
  own open creations with a range and how many joined (the seat count from the public list, since `/tournaments/my`
  carries none).
- **Manual** synced to 4e42b94c9: "when a match ends" wording, the best XI OVR on the leaderboard, the one-signature
  challenge, widening a range.

## The competition levels, the organizer fees and the leave lock (FoxLeague, from 9 November 2026, 14:00 UTC)

From FoxLeague's branches `feat/competition-levels`, `feat/organizer-fees`, `feat/private-fee`, `feat/leave-lock` and `feat/flexible-groups` (read 2026-10-31; only `feat/private-fee` changes a contract, the tournaments one). Read again on 2026-11-02 on FoxLeague's promotion to its main (next-foxleague PR #597, release at `1e58023fc`): no route, field or number below moved. Each follows its switch, served by `GET /api/config`; the agent reads the numbers from there and has none in its code. No block in the config (an older backend) is the rules of before.

- **`competition_levels`** `{live, live_from, ranked_ticket_price_foxsy, xp_factor_pct, elo_k, private_bronze_earns, competitive_daily_cap}`, `tournament_fee_bounds.bronze_min/_max`. Announced values (changed by FoxLeague on 2026-10-31): ticket 25 FOXSY; XP ranked 25, Bronze 50, Silver 75, Gold 100 percent; K 5, 9, 13, 17; 3 competitive matches a card a day, in the XP cap's window.
- **Ranked ticket.** `POST /api/matches/play` refuses a live ranked start without a ticket with `code: ranked_ticket_required`, after its other gates and before the draw, so the agent presses first and pays only then: one `shopPay` of the exact price, then `POST /api/shop/ranked-ticket {wallet_address, tx_hash}` (one ticket per hash; `tx_pending`: the same hash again, never a second payment; `Transaction already processed`: an earlier confirm recorded it), then the start again. `GET /api/shop/ranked-ticket` answers `{live, live_from, price_foxsy, tickets}`. The start answers `ranked_paid`: false means the AI filled it, free, the ticket kept (no condition and no XP either). A game that fails before its result gives its ticket back. No ticket is sold before the switch: such a payment stays for FoxLeague's refund net, so the agent never pays ahead.
- **Paid Bronze.** A fee from the band, escrowed and settled through the same contract endpoints as Silver (any tier with a fee is on chain: `needs_on_chain_escrow`). A Bronze created before the switch stays free and earns nothing. A private one (an invite list) earns only while `private_bronze_earns` is true (`rules.private_bronze_earns`, 1 on mainnet; `competition_levels.rs` `level_of`); the agent reads it for the XP booster and a private create, an unread flag being no.
- **Leave lock.** `tournament_defaults.leave_lock_live`. A leave that takes a tournament from its `min_teams` to one below is refused; above or below the minimum it goes through.
  The organizer leaves like any team (no creator exception in `leave_tournament_with`): the entry comes back and the organizer payment follows the tournament (`organizer_fees.rs` `refund_of`: the deposit back once it is played, kept when it is cancelled unfilled). Each planning snapshot checks again whether a tournament the agent created still fits its squad and schedule (ORG-1, 16 Nov 2026) and says until when it may leave one that no longer does; such a leave runs first in its plan.
- **Organizer fees.** `organizer_fees` `{live, live_from, private_match_fee_foxsy, calendar_deposit_per_match_foxsy, calendar_deposit_min_foxsy, calendar_deposit_grace_minutes}`, by default 25 a game and no lowest deposit (`calendar_deposit_min_foxsy` 0). `POST /api/tournaments/organizer-fee/quote {format, max_teams, home_and_away, has_third_place_match, private, developer_mode, starts_at}` answers `{owed, games, private_fee_foxsy, deposit_foxsy, total_foxsy, grace_minutes, no_free_cancel}`. Once live, a create without a hash is refused with `organizer_fee_required`, after FoxLeague's other checks, so the agent presses first and only then pays one `shopPay` of `total_foxsy`, its hash as `organizer_fee_tx_hash`. A create that does not settle the hash leaves it usable for the next create of that amount; FoxLeague's unconfirmed-payment net refunds one that stays unused (`useOrganizerFee.ts`, `verify_organizer_payment`). 1v1s, developer tournaments and admin events owe nothing. Deposit and fee come back by FoxLeague's refund after the last game (the fee of games played is spent); the deposit is kept on a cancel after the free time and when too few teams join by the deadline. The free time counts from the creation (`free_cancel_until`); a create in a time slot overlapping one the same wallet freed by a delete inside its free time in the last 24 hours has none (`no_free_cancel`). The agent never deletes a tournament (it cancels only its own 1v1).
- **Private tournaments pay through the platform fee (owner of FoxLeague, 2026-10-31).** `private_match_fee_foxsy` defaults to 0, so the quote's `private_fee_foxsy` is 0 and the organizer pays the deposit alone, counted on `max_teams`. The tournaments contract stamps each tournament's platform fee at creation: private (an allowed list and more than 2 seats) at `getPrivatePlatformFeePercent`, set with `setPrivatePlatformFee(20)`, anything else at the global percent. A targeted 1v1 and a League + Knockout stay public. A tournament from before the upgrade has no stamp and reads the global percent. `GET /api/config` serves `private_tournament_prize_split` (40/25/15, platform 20; equal to the public split until the setting is above 10) and a tournament's answer serves `prize_split` (null: the public split). A paid private create refuses with "Private tournaments with an entry fee are not available for a moment" while the setting and the contract disagree or cannot be read: an ordinary refusal, retried by a later plan. No call names a percent, and `createAndJoin` has no new field. A paid private create also carries `expected_platform_fee_percent`, the percent of that split the plan was told, as FoxLeague's page does (optional; another percent is refused before anything is written). FoxLeague's server signs the create, so the gas the agent signs here is the seat's `joinTournament`: FoxLeague measures about 115,000 more on every call of the new contract and keeps its limit at 8.4M, the agent's too. Read on mainnet after the upgrade (2026-11-02 15:38 UTC, tx `1cc0ffb840bc`): the first 11 joins used 7,012,205 to 7,237,267 gas, against 6,784,431 to 7,189,293 over the 807 joins since the upgrade of 2026-10-26, so 8.4M is 1.16 times the heaviest. A join's gas does not grow with the seats or the invite list (`tournamentAllowed` is an `UnorderedSetMapper`, the writes are fixed). The upgrade alone leaves `privatePlatformFeePercent` empty, so `getPrivatePlatformFeePercent` reads the global 10 until FoxLeague calls `setPrivatePlatformFee`; the call takes effect at once, not at a switch time.
- **Flexible Groups + Knockout.** `min_teams` from 6 to `max_teams`; groups of 3 to 6 (`flexible_group_count`), so a team can play more group games than in a full tournament. It has no switch: it is live from FoxLeague's deploy, and the agent's rule has followed it since PR #41.
- **Forfeits.** From the competition levels' switch a forfeit (by one team or both) and a match that could not be played move no ELO, XP, condition or competitive matches; only the result counts. FoxLeague keeps the counts and the agent reads them, so no rule of the agent depends on it.
- **Create budget.** At most `tournament.creates_per_wallet_per_day` creates in 24 hours per wallet, 1v1s included (default 48; not in `/api/config`), refused before any payment with "You have created as many tournaments as one wallet may in 24 hours". An ordinary refusal: the agents create far fewer.


## 24. FoxLeague's release of 2026-11-06 (01290ebaf, mainnet since 15:43 UTC)

Checked read-only in the grand audit of 2026-11-06 (INTEG reviewer, FoxLeague's main read through git only). Seven commits
since rc.85 (`16d9a455e`); the ones that touch the agent:

- **The leave lock binds the organizer** (`c355e04b3`): `leave_breaks_the_minimum` is "seats before the leave equal
  min_teams" (`tournaments.rs:3357-3363`), the agent's `participants.length === min_teams`; the organizer cannot delete
  a tournament at or above its minimum from the switch (`admin.rs` `organizer_delete_refusal`); the agent never calls
  `/delete`, and its `/cancel` of an own unaccepted 1v1 is never at the minimum (1 of 2).
- **Switch-day fixes** (`2d00b1f5a`): the leave lock's read fails closed (a 200 refusal the agent logs as an error,
  nothing credited); the reconcile opens a create that was left `pending_sc` with its organizer payment on it
  (`tournament_reconcile.rs` `open_with_its_payment`), and a late chain confirm keeps the deposit free
  (`organizer_fees.rs` `opened_by_the_reconcile`). After the payment, FoxLeague's answer "On-chain tournament creation
  could not be confirmed yet ... stays pending" means the tournament exists with the payment on it: since the audit
  (INTEG-2) the agent says so and settles the payment as used, instead of "nothing created" and a refund.
- **Docs** (`5af121732`): the manual says the rules the game runs (the ranked ticket 25 on the Shop page, like-for-like
  substitution on, a paid private Bronze earning from the switch, a full Champions edition locking every seat at
  once). The agent's game manual copy is synced to `c355e04b3`.
- **Shop status** (`shop.rs:126-132`, `:866-873`): `premium_used_today` counts `training_slot` purchases verified in
  the trailing 24 hours, not sessions. Since the audit (INTEG-1) the level's count of paid sessions a day reads the
  sessions past the free ones (`used_today - daily_free`, both from the 14:00 UTC reset).
- **Rival strength** (ATTACK-1, the agent's side): FoxLeague plays the synced stats at the lock and a rival may sync
  its training first, so the agent judges each rival card at the stronger of its synced and its live stats (the public
  roster carries both).

No other agent behaviour changes: the ranked ticket, paid Bronze, the organizer quote and payment, the OVR range and
the 1v1 flow read and pay as before; no hard-coded number differs from the live `/api/config`.

## 25. Mainnet of 2026-11-09 (bbb1bfba7) and the rules of 13 November (cards, injuries, medicine, forfeits)

Read on 2026-11-10 through git only: FoxLeague's `origin/main` from `01290ebaf` to `bbb1bfba7` (32 commits, what mainnet
runs since the competition levels' switch of 9 November 14:00 UTC) and its release branch `2913ee7df` (8 commits
ahead). No contract changed.

**Checked, nothing to change** (the agent ran through the switch with no error: ranked tickets, paid Bronze seats and
1v1s all paid and confirmed):

- The create of a tournament stays the two-step flow (`CreateMode::TwoStep`); `standard_create_and_join` and its 780 s
  floor concern only the one-signature create the agent does not use (`a2ca76885`).
- A private tournament invites at most its seats less the organizer's (`private_seats_refusal`, before any payment):
  the agent's own bound (`invites.length > max_teams - 1`).
- `organizer_fees.private_match_fee_foxsy` is 0: the agent pays the quote's total, never the config field.
- Every free Bronze that had not started was cancelled at the switch (`036834369`); the agent's snapshot already hides
  free Bronze from the plan.
- `POST /teams/lineup` drops a substitute listed for sale and fills its seat from the reserves (`0fc10806f`); the
  agent never lists a card of its 18.
- Gas limits: shopPay 12,864,100, join 8,400,000, claimRefund 6,500,000 unchanged.

**New on main, used by the agent since this sync:**

- `viewer_tournament_window_opens_in_secs` on a 1v1's detail (read with the wallet): the seconds until FoxLeague's busy
  gate turns on for the team. A stake signed inside the last minutes reaches the join after it and is refunded with
  the gas lost; the agent refuses a 1v1 join when it opens within 120 s (LIVE-1).
- The registration deadline has the same margin (audit 2026-11-11, INTEG-5): FoxLeague checks it when `POST /join`
  arrives, not when the payment landed (`routes/tournaments.rs`, "Validate deadline": `refund_failed_join(..,
  "deadline_passed")`, then `Registration deadline has passed`), so the agent signs no paid entry and no 1v1 stake
  within 120 s of the deadline (`BUSY_OPENS_MARGIN_S`); a free seat signs nothing and needs none, and a deadline that
  is no time is unread. For a payment already made, the pending retry takes that answer as final when it answers the
  ask that carried the payment's hash (the request in which FoxLeague refunds); the entry's ledger row keeps counting
  until the refund checks see it gone.
- The five discipline fields on every card and listing, `card_bans` in `/api/config`, the medicine routes (section 6a
  of `docs/ECONOMY-AND-RULES.md`).

**What the agent does from the switch of 13 November** (`src/foxleague/levels.ts` `cardBansLive`):

- Reads each card's `injured_until`, `bans_pending` and `ban_yellow_cards` (`disciplineOf` in `src/snapshot/snapshot.ts`).
  Once the switch is live a card whose answer leaves them out is unknown, never healthy.
- Starts no match, 1v1 or tournament entry while an injured card is in the saved eleven (`squadLegal`): every strength
  the rules compare is the saved eleven's, and FoxLeague would put a bench card of its own choice in the shirt. A
  tournament entry is judged at its start, a game or a 1v1 now. The plan saves an eleven without the card first.
- Counts the eleven shirts FoxLeague fills with a match-fit card of the 18 (condition, no transfer cooldown, not
  injured) before a 1v1 stake is paid, at the create too (the creator's own seat goes through the same join gate). It
  counts as FoxLeague's `auto_substitute` does (`matchFit` in `src/executor/rules.ts`): a tired outfield starter is
  relieved only by a fit outfield bench card, a tired keeper by a fit bench keeper or, as the last resort, by a fit
  outfield bench card, and an injured bench card is off the bench. Eleven fit cards among the 18 are not enough when
  the bench keeper is the one left for an outfield shirt.
- Leaves a card injured past a tournament's last match out of the condition its schedule is weighed against.
- Refuses an injured or suspended card as a fusion input, whatever FoxLeague's pre-check answers.
- Refuses a bid on a card whose injury cannot be read; an injured card may be bid on when its price deserves it (the
  owner, 2026-11-10), with the injury in the bid's notes; the auction lines show each card's injury, ban and yellow cards.
- Buys medicine as the shop product `medicine` (one card, whole days): `GET /api/shop/medicine/quote` for exactly
  those days, one `shopPay` of its `cost_foxsy` (within the level's medicine days a week, Max shop payment and the daily cap,
  booked before the signature), then `POST /api/shop/medicine` with the hash; `tx_pending` or no answer keeps the hash, and the pending
  retry confirms it on the same route. A wrong amount, a healed card or too many days is refunded whole by FoxLeague
  (`refund_whole_payment`), heard by the retry as for every shop payment.
- A suspended card needs no rule: the lock replaces it, and a 1v1 or a ranked game still takes it. The snapshot
  marks it, and the prompt asks for the plan's own choice in its place before a tournament lock.

**On FoxLeague's main since 2026-11-10 08:39 UTC** (its promotion #715 of the release branch at `2913ee7df`, the
commit read above): the fusion refusal in `can-fuse` and the forfeit penalty. The agent's manual copy is synced to it
(CI-15). The agent's own fusion rule did not wait for it. The forfeit penalty's switch is not in `/api/config`; the
prompt states the rule, and the agent's checks against a forfeit (a full 11 + 7, fit starters, the schedule's wear)
are the ones it already had.

**The injury numbers are Admin settings since 2026-11-10** (FoxLeague's main `9f65786f3`, read through its code
only for the audit of 2026-11-11, INTEG-2): the chance per called foul is 1% at condition 100 to 3% at condition 30 by
default (`card_injuries.rs:49-52`; 3% to 9% before), and `/api/config` `card_bans` serves the numbers in force:
`injury_chance_bp_full_condition`, `injury_chance_bp_condition_floor` (basis points) and `injury_days_out` (three
numbers of days; `routes/config.rs` `CardBansConfig`), next to `yellow_cards_per_ban`. The agent's plan reads them on
the snapshot's "Cards and injuries" line (`levelLines` in `src/snapshot/digest.ts`); the prompt names no chance and no
days of its own, and numbers the config leaves out are said to be unread. The manual copy is synced to FoxLeague's
manual at `89a1955d7`, which states the same.

**The MetaStaking discount on Shop prices** (from 1 December 2026): FoxLeague shipped the Shop side on its mainnet of
2026-11-16 and the agent pays the wallet's own price since then (section 27, MNT-2 and CHN-1).


## 26. Mainnet of 2026-11-13 (FoxLeague 56e5b9855, manual 9ebcbc52d): the fusion that mints its result and the rest

Read on 2026-11-15 through git only: FoxLeague's `origin/main` from `89a1955d7` to `56e5b9855` (its promotion #742 of
2026-11-13), and on chain read-only: the players contract was upgraded at 2026-11-13 21:32:50 UTC (tx `486df9ae...e05d`,
code hash `e628771cda233b50141950e0e79f6819835353bc668ebe8810823b9dce6cacc4`, the canonical fusionMint build of
72,036 bytes, `getFusionMintVersion` 2), and `/api/config` serves `fusion_mint: {live: false, live_from:
"2026-11-20T14:00:00Z", paused: false}`. FoxLeague's `contracts/deploys.yaml` on main has no row for that upgrade yet.

| FoxLeague change | Effect on the agent | What the agent does since this sync |
|---|---|---|
| #711, #736: fusionMint, a fusion that mints its result (each stat the average of the three, translated to the new rarity, floors 22/30/36/40), no sync needed, from the players contract's switch | Until the switch nothing changes: the old fusion runs (agent 7 fused that way on 13 Nov, confirmed). From it the old `fusion` reverts and can-fuse with nonces is an error, so the agent could never fuse again | Section 13.5: the switch read at the action's time, fusion refused while unread, paused or within 10 minutes of the switch; from it the prepared `fusionMint`, signed only when it is exactly the fusion planned (FL13-3, FL13-4). The snapshot's Fusion line and the prompt give both rules (FL13-6) |
| The same upgrade: every players call about 834,300 gas more | The agent's limits fell to 1.27x to 1.38x of the gas used (above 1x, under the owner's band) | FoxLeague's new limits (section 1.7, FL13-2) |
| #731: "Fusion complete" sent when the chain kept the fusion, "Fusion failed" otherwise | Notifications only | Nothing |
| #717: relay guards before the broadcast (G17 and G16 answer 409, G16's nonce and G18 answer 403, unreadable reads answer 500 before any send), free onboarding badges at 10 a day per connection | A 409 kept the fee booked and said the payment may have gone out. The badge budget counts only the free draw of a wallet with no team; the agent's badge is a regeneration of a registered team (`src/setup/badge.ts`), so many agents on one server are not affected | 409 releases the booking (FL13-1); 400 stays careful (MONEY-3) |
| #701: the shop confirm proves the payer before any strand alarm; at most 10 confirmations a wallet in 60 s across `/shop/confirm`, `/shop/medicine`, `/shop/ranked-ticket` and `/shop/waive-cooldown` | Past the budget: HTTP 429 with code `tx_pending` ("Your payment is kept"). The agent reads `tx_pending` as "confirm the same hash again", never as refused or refunded; its pending retry asks once a pass | Nothing to change |
| #730: a forfeit is announced at its kickoff and never airs | Upcoming matches go from `locked` to `finished` at the kickoff for a forfeit; no new phase or status value | Nothing to change |
| #737: the full replay on Autonomys (ships off), `permanent_replay` on tournament matches | Not read | Nothing |
| #733: My interests, `GET /api/players/interests/mine` | Not used | Nothing |
| `docs/manual/openapi.json` (about 900 lines) | No route the agent calls moved or lost a field it reads; `/api/config` gained `fusion_mint` (required); the relay gained 409, the shop confirms 429; tournament matches gained `permanent_replay` | Read as above |
| can-fuse's wallet spacing is text (`"0d 19h"`), not seconds | The refusal said "NaN h left" | Read as text (FL13-5) |

The game manual copy is synced to `9ebcbc52d` (16 pages, no page left undecided).


## 27. Mainnet of 2026-11-16 (FoxLeague 729164194, manual 729164194): the Shop discount, the ELO pair cap and the rest

Read on 2026-11-16 through git only: FoxLeague's `origin/release/mainnet-1.0` at `729164194` (promoted 2026-11-15 20:53
UTC, deployed about 09:48 UTC on 2026-11-16; its manual is byte-identical to `origin/main` `67d940ad2`), the 15 commits
after `9ebcbc52d`, and the live `/api/config` of 11:50 UTC. No contract changed and the gas limits equal FoxLeague's app
(`frontend/src/lib/gasLimits.ts`). No route the agent calls lost a field it reads.

| FoxLeague change | Effect on the agent | What the agent does since this change |
|---|---|---|
| #744, #749, #765: the MetaStaking Shop discount, switch `metastaking_discount.live_from` (null on 2026-11-16, announced for 2026-12-01 14:00 UTC). From it a wallet with FOXSY in MetaStaking pays `full - floor(full x bp / 10000)`, once per payment on its total, and the confirm takes only that price (its rate at the payment's chain time or quoted in the 15 minutes before); any other amount, the full price included, is refused and refunded whole | Every Shop payment of a wallet with a rate (an imported team whose owner stakes FOXSY) would be refused and refunded after it settled, the gas lost; every medicine quote of such a wallet was refused locally ("does not match") | The ticket at the ticket view's `discount_bp` (checked against `discounted_price_foxsy`); a booster, a pack, training slots and a recovery at the shop status' `metastaking_discount_bp`, once on the total (checked against `discounted_prices` and `common_pack_discounted_price_foxsy` when served); medicine at the quote's `cost_foxsy` when it is the days' full cost less the quote's `discount_bp`. A rate that cannot be read: nothing is paid once the switch is live, its time has passed or the block cannot be read; the list price while it is off or not set. While FoxLeague serves the switch off (live false, no time or a time still ahead) the list price is paid whatever rate is served, the only amount its confirm takes before the switch (R75A-1). The plan weighs the same prices: while the switch is live the snapshot's Shop prices line gives the wallet's own prices and rate next to the list prices, the ones the executor pays; it says "unknown" while the rate is unread; while it is off, the list prices only (MNT-2b). Fusion fees and the fusion waivers keep the contract's exact price (MNT-2, CHN-1). The executor reads the shop status, the ticket and the medicine quote right before each payment, inside FoxLeague's 15 minutes |
| #746, #751: the ELO pair cap, switch `elo_pair_cap.live_from` = 2026-11-20 14:00 UTC: the same two teams move ELO in at most `per_day` (3) meetings a game day, ranked, 1v1s and tournaments together; a later one earns everything else; `GET /api/matches/elo-pair/{user_id}` counts this team's meetings with that one | The plan was told nothing and could pay a stake "for ELO" that moves none | The snapshot's rule line; while live, a planning snapshot reads the pair count of the teams to challenge and the challengers (at most 16) and each rival's line says "N of 3 ELO meetings today", at the cap until when a game moves no ELO; unread is "unknown". No refusal (MNT-3). A tournament opponent of the game day counts too: the upcoming list names it by its team only, so its user id is the seat of that name in the tournament's public detail (`GET /api/tournaments/{id}` participants; FoxLeague's team names are unique, migration 087), read for at most 4 tournaments a planning snapshot; its Upcoming line carries its meetings, "unknown" when the seat could not be read (MNT-3b) |
| #757: every daily allowance at 14:00 UTC; the Common pack week from Monday 14:00 UTC (`common_pack_week_resets_at`) | The pack count is FoxLeague's own (`common_pack_remaining_this_week`): nothing refused wrongly; the texts were stale | The prompt and the snapshot's pack line (MNT-4) |
| #747: a card in an auction is held by the contract and does not play; one of the saved 18 at a lock forfeits the match 3-0 (it was replaced before); injury days are full 24 hours from the result | The agent lists none of its 18 and starts nothing with a listed card in it; the manual copy said the opposite | The snapshot says "LISTED IN YOUR 18: ... forfeits" in capitals when the owner lists one (MNT-4) |
| #740: ranked earns XP (texts) | The prompt still gave the rules of before the levels | The prompt states the levels as the standing rules, numbers on the snapshot's line (MNT-7) |
| #745, #750, #753, #760, #761, #766: recordings, Autonomys, the match server's seed; #759: Google login, Send refuses a non-erd1 address | Not used | Nothing |

Found on the way (audit of 2026-11-16, MNT-1): FoxLeague plays ONE match of the whole tournament every round interval,
in every format (`tournament_engine.rs` `reschedule_sequential`, `place_sequential`, `write_league_matchdays`; its own
`estimate_duration_minutes` says the real run is matches x interval). The schedule rule counted one round per
interval: it refused an 18-team home-and-away round robin (306 matches over 12.7 days) and took a running round robin
for over while its fixtures were still listed. It now counts the real span (all matches less one, times the interval),
judges every field from the minimum up and counts each listed fixture by its own kickoff; the digest says "one match of
the whole tournament every N min". A team out of a knockout owes it nothing more (MNT-1c): a knockout match of it that
FoxLeague lists as finished with our score below theirs, in a knockout or the knockout phase of a Groups + Knockout,
ends the count but for a third place match that may follow (one at most). A level score (penalties the list does not
show), a group match and a League + Knockout leg are no exit. FoxLeague lists a finished match for a day only; after
that the count is the format's most again, the safe side. Rounds not drawn yet still count as overlapping: spread over
their span, the Swiss of MON-3 would owe the new tournament none of them, which its test refuses on purpose.

The game manual copy is synced to `729164194` (16 pages, 10 changed, no page left undecided).

## 28. FoxLeague of 2026-11-18 (origin/main 6f9c969ac, release a546f7279, manual 99c47a4e6): Invite Friends and the network halt

Read on 2026-11-19 through git only (a scratch mirror of FoxLeague's repository) and FoxLeague's live `/api/config` and
`/api/openapi.json`. FoxLeague promoted `origin/release/mainnet-1.0` into `origin/main` on 2026-11-17 (`6f9c969ac`, its
#774); the release branch went on to `a546f7279`. `sync-manual` reads `origin/main`: the two differ only on two pages
the agents leave out (Invite Friends and the FAQ), and the shapes of the 54 routes the agent calls are the same at both
and in mainnet's live API description. No contract changed. FoxLeague's MCP server still served the manual of
`729164194` on 2026-11-19 (no Invite Friends page, the old Permanent Match Records sentence).

| FoxLeague change | Effect on the agent | What the agent does since this change |
|---|---|---|
| #755 (issue #429; #777 and #779 on the release branch since): Invite Friends, the referral programme. `/api/config` `referral {live, live_from}` (`live_from` 2026-11-20 14:00 UTC); `POST /api/referral/claim` stores an invitation code before a paid registration; `GET /api/referral/invites`; `POST /api/referral/credits/{id}/use`. A new team that pays its registration with a code gets free ranked tickets; the inviting team earns in-game credits only (a Recover All, an XP booster, a Common pack), never FOXSY; an existing team cannot use one; inviting yourself with a second wallet or arranging matches to qualify is abuse under Fair Play | The running agent told the owner of a new settings key and of a switch the agents do not know, and each plan read "a FoxLeague rule your instructions do not cover yet" | The owner's rule: the agents take no part. `referral` is in `RULED_SWITCHES`; the snapshot's Referral line says the programme exists, in short, and the rule (FL20-1). The agent calls no `/api/referral/*` route and `POST /api/register` carries the team name and the wallet only (`/api/register` takes no code: the code is claimed before it). The manual page is left out on purpose (FL20-2) |
| #778, #780 (on the release branch only on 2026-11-19): every FoxLeague chain write waits while its chain is not ready (a deadline cancel's refunds and close too) and goes on by itself once the network is back; `GET /api/chain-status` `{ready, paused_since}`; a banner after two minutes | FoxLeague's hold covers its own writes, not the agent's signatures. `GET /api/chain-status` answers 404 on mainnet on 2026-11-19 | The agent checks the chain itself before each signature (HALT, section 1.5) and does not depend on FoxLeague's route |
| #771: Continue with Google "coming soon", with buying EGLD by card or bank; #769: the replay file's kickoff minute; the Terms' referral paragraph | Not used | Nothing |

Found on the way (agent 1, 2026-11-18, FLD-1): a planning snapshot reads the seated field of only the 4 joinable
tournaments with the nearest deadlines. Every other tournament the field rule judges now says in the digest that its
field was not read and that the executor reads it at the join; `FIELD_TOURNAMENTS` stays 4 (a field costs up to 16
seats x 2 or 3 FoxLeague reads a tournament, cached 20 minutes).

The game manual copy is synced to `99c47a4e6` (16 pages, one sentence changed, Invite Friends left out).
