# Sources

Where the facts in `FOXLEAGUE-INTEGRATION.md` and `ECONOMY-AND-RULES.md` come from, as paths in a
FoxLeague checkout next to this repository (`../next-foxleague`, the default of `sync-manual`). Everything here is public: the FoxLeague source, the player
manual, the committed deploy configuration and the contract ABIs. No file listed here needs to be
opened for a secret; where a file also holds secrets, only its variable names are relevant.

Snapshot the docs were written against: branch `origin/release/mainnet-1.0` at commit `0800dce5`
(rc.31, 2026-09-28, the mainnet launch day). Every `path:line` in these docs refers to that commit.

## 1. The FoxLeague monorepo

`../next-foxleague`

**Read the release branch, not the working tree.** The working tree of this folder is checked out
on `develop`, which reaches mainnet only later. What runs on mainnet is the release branch:

```bash
git -C ../next-foxleague fetch -q origin
git -C ../next-foxleague show origin/release/mainnet-1.0:<path>
git -C ../next-foxleague grep -n <pattern> origin/release/mainnet-1.0 -- <paths>
git -C ../next-foxleague log --oneline -5 origin/release/mainnet-1.0 -- <path>
```

| Area | Path inside the repo | What it holds |
|---|---|---|
| HTTP router | `backend/src/lib.rs:2171-2231` | Merges every `routes/*.rs` router; body limit, gzip, `Cache-Control: no-store`, CORS |
| HTTP routes | `backend/src/routes/*.rs` | One file per area: `auth_routes`, `teams`, `players`, `training`, `sync`, `matches`, `tournaments`, `shop`, `shop_pack`, `marketplace`, `registration`, `onboarding`, `leaderboard`, `notifications`, `config`, `health` |
| Auth | `backend/src/auth.rs`, `backend/src/routes/auth_routes.rs` | Signed-message verification and the Bearer session extractor |
| Response envelope | `backend/src/models.rs:661-708` | `ApiResponse { success, data, error, code }` |
| Runtime config keys | `backend/src/config_registry.rs` | Every tunable key with its code default and range |
| Public config route | `backend/src/routes/config.rs` | What `GET /api/config` serves |
| Chain client | `backend/src/chain.rs`, `backend/src/chain_verify.rs`, `backend/src/chain_finality.rs` | How the backend reads and verifies transactions |
| Frontend API client | `frontend/src/lib/api.ts` | Every call the web app makes, with the auth interceptor |
| Generated response types | `frontend/src/types/generated/*.ts` | TypeScript types generated from the backend Rust structs (ts-rs) |
| Transaction builders | `frontend/src/lib/foxsyPaymentTx.ts`, `tournamentTx.ts`, `tournamentTxData.ts`, `xexchangeSwapTx.ts`, `gasLimits.ts`; pages `frontend/src/pages/Marketplace.tsx`, `Squad.tsx`, `Onboarding.tsx`; components `FusionTab.tsx`, `PlayerProfileModal.tsx`, `OnboardingSwap.tsx`; hook `frontend/src/hooks/useConditionRecovery.ts` | Receiver, data field, value, gas of each transaction |
| Transaction outcome | `frontend/src/lib/txFinality.ts` | How the app decides a transaction succeeded (process-status plus signalError scan) |
| Chain identifiers (frontend) | `frontend/src/lib/chainConfig.ts`, `chainEnvContract.ts`, `dexSwapAddresses.ts` | Token ids, contract addresses, DEX addresses per chain |
| Players contract | `contracts/foxleague-players/src/player_nft.rs` | Registration, shop payments, sync, fusion, waivers, auctions |
| Tournaments contract | `contracts/foxleague-tournaments/src/tournament_manager.rs` | Seat escrow, refunds, prize distribution |
| Contract deploy registry | `contracts/deploys.yaml` (section `mainnet:` from line 348) | Every mainnet deploy and upgrade: address, tx, code hash |
| Match runner | `rc/` | The rcssserver match runner (not needed by a client) |
| Changelog | `CHANGELOG.md` | Newest entry first; each release candidate explains what changed and why |

## 2. Contract ABIs

| Contract | Path | Notes |
|---|---|---|
| Players (`foxleague-players`) | `../next-foxleague/contracts/foxleague-players/output/foxleague-players.abi.json` (committed on the release branch: `git show origin/release/mainnet-1.0:contracts/foxleague-players/output/foxleague-players.abi.json`) | 115 endpoints and views; the names match `player_nft.rs` on the release branch exactly (checked 2026-09-28) |
| Tournaments (`foxleague-tournaments`) | NOT committed. A local build artifact exists at `../next-foxleague/contracts/foxleague-tournaments/output/foxleague-tournaments.abi.json` (dated 2026-09-11, gitignored) | Stale: it lacks the `getTournamentAllowed` view that the release source has (`tournament_manager.rs:668`). Use the source for argument types (or rebuild the ABI from the release branch) |
| Testnet faucet swap | `contracts/foxleague-testnet-faucet-swap/output/foxleague-testnet-faucet-swap.abi.json` | Testnet only; irrelevant on mainnet |

## 3. Mainnet deploy configuration (public values)

| Path | What it holds |
|---|---|
| `deploy/mainnet/chain.env` | Mainnet identity: gateway and API URLs, chain id `1`, both contract addresses, `FOXSY-5d5f3e`, `FXLP-6f28e5`, game server and owner addresses |
| `deploy/mainnet/chain-config.mainnet.env` | Contract setter values used at deploy: registration fee, shop prices, fusion costs and cooldowns, waiver prices, auction tunables, platform fee, royalty cap |
| `deploy/mainnet/seed.sh` | The `app_config` rows seeded on mainnet (the live values where they differ from code defaults) |
| `deploy/mainnet/inputs.example.env` | Example operator inputs (domain `foxleague.ai`, bonus pool sizing). The real inputs file on the box holds secrets; only the example is public |
| `deploy/mainnet/env.template` | Variable NAMES of the backend environment (values are secret on the box) |
| `deploy/mainnet/nginx/foxleague-zones.conf`, `app.conf.template`, `app-preview.conf.template` | Edge rate limits (`/api/` 30 r/s burst 50, `/ws/` 5 r/s burst 10, 40 connections per IP) |
| `deploy/mainnet/README.md` | Mainnet runbook: bootstrap, preview period under `/new/`, contract upgrades |
| `deploy/mainnet/TESTNET-REHEARSAL.md` | Step by step rehearsal of every chain operation, with the owner setters and their values |
| `docs/disaster-recovery.md` | Pause and rollback procedures (the contracts can be paused; a client must handle it) |

## 4. The player manual

Source (Astro Starlight, MDX): `../next-foxleague/docs/manual/src/content/docs/`
(release version: `git show origin/release/mainnet-1.0:docs/manual/src/content/docs/<page>`).
Served publicly at `https://docs.foxleague.ai` (`deploy/mainnet/nginx/docs.conf.template:5`).

Most useful pages for an agent, in reading order:

1. `mechanics/economy-map.mdx`: every cost, cap and cooldown in one table. Each row carries an MDX comment naming its source (seed key, chain-config line, contract line). Start here.
2. `mechanics/matches.mdx`, `mechanics/match-day-strategy.mdx`, `mechanics/tactics.md`
3. `mechanics/training.md`, `mechanics/sync.mdx`, `mechanics/aging.mdx`
4. `mechanics/tournaments.mdx`, `mechanics/one-v-one.mdx`, `mechanics/world-cup.mdx`
5. `mechanics/shop.mdx`, `mechanics/fusion.mdx`, `mechanics/marketplace.mdx`
6. `getting-started/onboarding.mdx`, `getting-started/wallet.mdx`, `getting-started/squad.md`, `getting-started/players.md`
7. `legal/terms.md` and `legal/fair-play.md`: **read before publishing an agent.** Terms section 6 (`legal/terms.md:65`) prohibits "use of automated tools, bots or scripts not expressly allowed by Foxsy" and the Fair Play rules (`legal/fair-play.md:20`) list "crafting, replaying or automating transactions, signatures or API calls that the FoxLeague interface does not offer" as a breach.
8. `reference/faq.md`, `reference/glossary.md`

A locally built copy of the manual (from `develop`, 2026-09-12) sits in
`../next-foxleague/docs/manual/dist/`; prefer the source or the live site.

## 5. Manual PDFs (newest first)

All in `../next-foxleague/`:

| File | Date |
|---|---|
| `FoxLeague-Manual-v1.0.0-rc.16-audited.pdf` | 2026-09-19 |
| `FoxLeague-Manual-v1.0.0-rc.16.pdf` | 2026-09-18 |
| `FoxLeague-Manual-v1.0.0-rc.15.pdf` | 2026-09-18 |
| `FoxLeague-Manual-v1.0.0-rc.14.pdf` | 2026-09-17 |
| `FoxLeague-Manual-v1.0.0-rc.13.pdf` | 2026-09-16 |
| `FoxLeague-Manual-v0.4.752.pdf` | 2026-08-24 |
| `FoxLeague-Manual-v0.4.695.pdf` | 2026-07-22 |

The newest PDF predates rc.17 to rc.31; several numbers changed since (for example the paid
training slot and the listing floor). The manual source on the release branch is newer than any PDF.

## 6. Design and audit notes worth reading (in the repo, `docs/`)

| Path | Why |
|---|---|
| `docs/tournament-onchain-lifecycle.md` | How a tournament moves through create, join, start, distribute, refund on chain |
| `docs/known-issues-tournaments.md`, `docs/known-issues-shop.md` | Known edge cases in the two money flows an agent touches most |
| `docs/2026-07-03-marketplace-auction-anti-abuse-design.md` | Why the auction rules (floor, increment, snipe window, relist cooldown) are what they are |
| `docs/2026-07-03-invisible-wallet-relayer-service-plan.md` | The relayer design behind the gas-free registration |
| `docs/2026-09-02-309-mainnet-gas-economics.md` | Gas sizing on mainnet |
| `docs/fusion-cross-shard-new-nft-data-on-sender.md` | Why a fusion or sync right after another NFT update can revert (and the retry) |
| `docs/architecture-chain-config.md` | How chain identifiers flow from `chain.env` into backend and frontend |
| `docs/admin-config-reference.md` | Reference of the runtime config keys (admin-side document; useful only to understand what a key means) |

## 7. Public endpoints to read live values from

| Endpoint | What it gives |
|---|---|
| `https://foxleague.ai/api/config` | Live app configuration served to the web app (prices mirrored from the contract, caps, splits, tier bounds) |
| `https://gateway.multiversx.com` | MultiversX gateway: account nonce, broadcast, `vm-values/query` for contract views, `transaction/<hash>/process-status` |
| `https://api.multiversx.com` | MultiversX API: token balances, NFTs of a wallet, transaction status |
| `https://explorer.multiversx.com` | Explorer, for humans |
| `https://docs.foxleague.ai` | The player manual |
