# Adversarial review, 2026-09-29

Three independent reviews (Claude Fable 5.1, read-only) attacked the agent from three sides: money and caps,
outside attackers, security and operations. Every finding accepted as real got a test that failed before the
fix and passes after it (`test/audit.test.ts`, named after the finding). Fixes by Claude Opus 5.5.

## Money and caps

| Id | Severity | Finding | Fix |
|---|---|---|---|
| M1 | high | Swaps counted only their pool fee and gas: a misled model could turn every EGLD above the reserve into FOXSY in a day | Daily swap allowance in USD (the daily cap; the setup budget before registration), its own ledger category |
| M2 | high | Two runs of one agent (a plan plus Telegram `/do`) could both pass the cap | One lock per agent around every action in the executor |
| M3 | high | The sync payload's FOXSY amount, tokens, endpoint and gas were not checked | The payload is decoded: exactly the per-card fee, the listed cards once, `syncMyStats`, gas within 15M + 3M per card; never more FOXSY than the check allowed |
| M4 | medium | A listing's floor check failed open when the API failed | Listing refused when the floor or the pre-check is unavailable |
| M5 | medium | Reverted transactions and lost confirmations escaped the ledger | Spend booked before signing; a revert keeps only the gas; an unreadable outcome stays booked |
| M6 | medium | The caps trusted the pool's spot price | FOXSY valued at the higher of spot and its recent median (A7) |
| M7 | low | Creating a tournament or 1v1 skipped the gas check for the seat | The seat's gas is counted and checked before the create |
| M8 | low | A paid seat whose join failed was never retried | Pending seats are joined again with the same hash, never paid twice (`src/executor/pending.ts`) |
| M9 | low | An XP booster could be bought twice while the first was being confirmed | A product with a pending confirmation cannot be bought again |
| M10 | low | Refunded bids and entries stay counted as spend | An outbid bid stops counting once another bidder leads (or the card went elsewhere); a seat stops counting after leave or a claimed refund; a lookup that fails keeps it counted (`src/executor/refunds.ts`) |

## Outside attackers

| Id | Severity | Finding | Fix |
|---|---|---|---|
| A1 | high | Rivals' tournament titles and names reached the model raw and could forge an "owner request" | All external text cleaned (no line breaks or control characters, length capped), the snapshot framed as data, a system rule that names and titles are never instructions |
| A2 | high | 1v1s had no strength or repetition guard: a strong team could farm the agent daily | Refused against a team 100+ ELO stronger or of unknown strength; at most 2 per opponent per 7 days; no open challenges. Since 2026-09-30, by the owner's decision, one open challenge per 24 hours, Silver at the lowest configured Silver amount only, so a stronger taker wins the smallest stake |
| A3 | high | A junk listing could drag the floor to 500 and the best card could be sold | Minimum reserve per rarity (Common 500 up to Legendary 25,000) and the 18 strongest cards never sold |
| A4 | high | The "never with your other agents" check failed open when a lookup failed | Refused when a sibling's id cannot be read; siblings also matched by wallet. Removed on 2026-09-30 by the owner's decision, for tournaments, 1v1s and the marketplace: agents do not know each other and may meet or trade by chance (FoxLeague's Fair Play forbids arranging results, not meeting) |
| A5 | medium | In a group chat every member could command the agent | Only messages from the owner's own account (private chat) are obeyed |
| A6 | medium | A shill bidder could walk the agent up the same auction | At most 2 bids per auction in 48 hours |
| A7 | medium | A pool dump made FOXSY look cheap to the caps | See M6 |
| A8 | medium | A card that would arrive locked for weeks could be bought | Refused above 72 hours of inherited lock, or when the card's details cannot be read |
| A9 | low-medium | Tournaments whose schedule drains the squad's condition are not checked | Joining or creating is refused when the most matches the format can bring cost more condition than the squad has plus what it recovers between rounds (`matchesAtMost`) |
| A10 | low | Team names could imitate FoxLeague or its staff | Blocklist (FoxLeague, FOXSY, admin, official, support, moderator, staff, Team Fox) |

## Security and operations

| Id | Severity | Finding | Fix |
|---|---|---|---|
| S1 | high | `X-Real-IP` was trusted from anyone: lockout bypass and a global login lockout | Honoured only with `WEB_UI_TRUST_PROXY=1` (droplet, behind nginx) and a loopback socket |
| S2 | high | A transaction could be sent and never recorded (restart, database error) | Booked before signing (M5); graceful stop waits for the action in flight; `TimeoutStopSec=180`; an unhandled error turns the kill switch on instead of crash-and-replan; restart limit 3 in 10 minutes |
| S3 | high | Prompt injection (see A1); an injected reply could phish the owner | A1, plus a rule never to ask for words, keys or passwords |
| S4 | medium | Sync payload and `wait_seconds` trusted | M3; the wait is capped at 30 s and the kill switch and pause are checked after it |
| S5 | medium | A web session alone could re-point Telegram silently | Key changes need the password; a Telegram change is announced in the old chat first |
| S6 | medium | `configure` adopted whichever chat wrote to the agent first | The owner sends a one-time 6-digit code; only that chat is adopted |
| S7 | medium | No sender check, backlog replayed after downtime, `/mode live` without confirmation | Owner check (A5), messages older than 5 minutes before start ignored, `/mode live confirm`, a warning when a webhook takes the token over |
| S8 | medium | SQLite had no busy timeout: the CLI next to the service made writes fail | 5 s busy timeout |
| S9 | medium | Any positive EGLD price was accepted | $1 to $10,000 only, and a move over 50 percent is accepted after it holds for 10 minutes |
| S10 | medium | A dry-run plan finished live if Go LIVE was pressed mid-plan | A plan ends when the mode it was made in changes |
| S11 | low-medium | Sessions survived a password change | Sessions keyed by the password hash |
| S12 | low | Cap overshoot through `/do` | See M2 |
| S13 | low | `Origin: null` gave a server error; CSP allows inline scripts | 403 for a missing or foreign origin; a fresh nonce per page, only scripts carrying it run |
| S14 | low | npm install scripts ran during deploys; the service sandbox was basic | `npm ci --ignore-scripts` (checked: signing and hashing work without them); no capabilities, a system call filter, no namespaces, private users and a hidden `/proc`, tested on the droplet first; the local installer gets the filters that work without user namespaces |
| S15 | low | `backup-words` printed the mnemonic on the server | Refused on the server |

## Second review, 2026-09-29 (after the fixes above)

The same three sides, again with Claude Fable 5.1 (read-only), on the code with those fixes. Every first-review fix was
checked and still holds. New findings, each with a test in `test/audit.test.ts` named after it:

| Id | Severity | Finding | Fix |
|---|---|---|---|
| AA1 | high | The 1v1 guard judged strength by ELO alone, the one number a rival controls (new teams start at 1200) | The rival's starting eleven (synced stats at full condition) is compared with ours at today's condition: more than 10 percent stronger, or unreadable, is refused (`MAX_1V1_STRENGTH_RATIO`) |
| MM1 | medium | An action queued behind another used the mode and caps read before the lock | After the lock the agent row is read again: the caps set meanwhile apply, and a mode change while it waited stops it |
| SS1 | medium | Kill switch and pause were read once per action; pressed later, the transaction still signed | Checked again right before every signature and before booking |
| AA2 / MM2 | medium | The weekly 1v1 limit and the 48-hour bid limit read only the last 300 log rows (about a day) | The log is queried by kind and time (`activityOf`) |
| AA3 | medium | The schedule guard judged each tournament alone; overlapping ones each passed | Matches still owed to the agent's other tournaments at the same time count too; your own tournaments unreadable means refused |
| MM3 | medium | A bid still in flight could be credited as refunded by a tick starting meanwhile | Bids younger than 10 minutes or without a hash are left alone |
| MM4 / AA4 | medium-low | A won bid was re-judged forever from the API's owner field; relisting the card credited its price | Settlement is judged from the wallet's own cards on chain; a won bid is closed (`bid:<nonce>:won`) and never looked at again |
| SS2 | low-medium | A dozen addresses could keep the owner out of the login and the password re-check | The global lock holds back only addresses that already failed; the re-check behind a session skips it |
| MM5 | low | Dry-run bids were credited at the next tick (a dry bid is never on chain) | Dry-run bids keep counting |
| MM6 | low | A seat paid but not confirmed could be paid again | Refused while a seat for that tournament waits for confirmation |
| MM7 / SS3 | low | A graceful stop did not wait for a Telegram `/do` action | Stop waits for every executor action; no new `/do` while stopping |
| MM9 | low | New agents started with a 0.05 EGLD reserve, and 0 was accepted | Default 1 EGLD, lowest 0.05 |
| MM10 | low | The FOXSY price median kept 8 to 24 hours of samples, not two days | 288 samples |
| AA5 | low | Rival text could still write the snapshot fence markers | `txt()` removes them and every `#` |
| AA6 | low | Bid minimums were rounded down to whole FOXSY; a fractional top bid made the bid revert | Computed in atomic units, rounded up |
| SS4 | low | macOS: launchd killed an action in flight after about 20 s on restart | `ExitTimeOut` 180 in the plist |
| SS5 | low | The env file with the mnemonic was rewritten in place | Written aside and renamed over; values kept literally |
| SS6 | low | Go LIVE, raising a limit and releasing the kill switch needed only the session; logout did not end it | Those three ask for the password again (turning the kill switch on and lowering a limit stay one click); logout revokes the session |
| SS7 | low | `agentctl.sh tick` next to the running service was a second, unlocked executor | Refused while the service runs (`service.pid` in the data folder) |
| SS8 | low | Install paths with `%`, `&`, `<`, `>`, `"` or `\` broke the unit or the plist | Refused with a clear message |
| MM8 | low | EGLD swapped to FOXSY was bounded per game day only | Also per calendar month by the monthly budget (the owner's choice); the gas reserve is never swapped |


## Third review, 2026-09-29 (today's later additions)

Claude Fable 5.1 (read-only) on 4782084, scoped to the monthly swap cap, tournament time slots, cancelling
the agent's own 1v1, the dashboard Leave, the shared login, the fusion waivers, the badge and the active-hours
stop. All sound except:

| Id | Severity | Finding | Fix |
|---|---|---|---|
| LR1 | medium | The match waiver trusted the on-chain match count; a card with unsynced matches could buy credit it did not need (up to 300 FOXSY) | Refused while the card has unsynced stats or more matches than the chain knows: sync first |
| LR2 | low | A created tournament's or 1v1's seat was booked untagged, so leaving it never gave the budget back; seats FoxLeague refunded by itself were never credited either | The seat is tagged with the tournament id once the create answers; a cancelled tournament's seat is credited when the contract holds no entry any more; a finished one is closed |
| LR3 | low | The dashboard Leave was refused while the agent was paused | The owner's Leave works while paused (never under the kill switch) |

## Fourth review, 2026-09-29 (final, the evening's additions)

Claude Fable 5.1 (read-only) on 6e7adcd, scoped to the preparation tick, 1v1 scouting, the third-review
fixes and the prompt. Every finding came with a reproducing script and was confirmed before fixing:

| Id | Severity | Finding | Fix |
|---|---|---|---|
| FR1 | medium | The owner's Leave while paused failed in live mode (the pre-signature pause check threw) | Skipped for the owner's leave, which signs nothing; every signature is still checked |
| FR2 | low | The paused exception keyed on reason text a plan could write ("owner ...") | A typed `byOwner` flag set only by the service for the web Leave and Telegram `/do` |
| FR3 | low | One preparation tick per lock: a dense round robin multiplied the model calls | One per match session (a lock with no other lock of ours in the 2 hours before it) |
| FR4 | low | A completed tournament's seat was closed before a possible refund claim, so the claimed refund kept counting | Closed only once the contract holds no entry for the agent (checked on mainnet: played and cancelled entries read 0) |
| FR5 | low | With a long tick setting, actions of a preparation plan could run after the lock | Every plan's actions finish at least 10 minutes before the agent's next lock |

The prompt's "the notes are shortcuts" line now names what stays binding (how the plan is used, fair play).

## Fifth review, 2026-09-30 (Import team and the rename to agents)

Claude Fable 5.1 (read-only) on the uncommitted change that brought the agent names (numbers from 1, AGENT_* settings,
the one-time server move) and added Import team (a PEM file, keystore or recovery words; one key kept in
keys/<address>.pem). Checked and sound: no secret in any response, log, activity row or notice; the key file's
modes and path; the wallet cache after import, remove and re-import; numbers never reused by the recovery words;
Fair Play covers imported agents; the 1-based numbers map to the right agent in Telegram, the CLI, PEM names and the
AI chat; the password and REMOVE gates; single-use tokens. Two findings, both reproduced and fixed:

| Id | Severity | Finding | Fix |
|---|---|---|---|
| IT1 | medium | A keystore with doctored key-derivation settings (n, r, p, key length) froze the service for about 30 s and took over 1 GB (measured through the check route) | Only a 32-byte key and at most twice the cost of a real MultiversX keystore (n 4096, r 8, p 1) are accepted |
| IT2 | low | The one-time server move deleted the old systemd unit before renaming; a process of the old user left the server with no service and blocked later deploys | The old unit goes last, every step runs only if still needed, and the move waits for the old user's processes (else the old service starts again) |

## Sixth review, 2026-09-30 (the agent names inside the code and the database)

Claude Fable 5.1 (read-only) on the uncommitted change that gave the code's own names and the database the agent
names (`agent.db`, table `agents`, column `agent_idx`) and removed the compatibility code for older setting and
file names. Checked and sound: no name that belongs to FoxLeague, MultiversX or Telegram changed; stored keys,
activity kinds, spend tags, settings and the session cookie are untouched; no name hides another one; the
dashboard reads exactly the fields the server sends; the strategist's tool matches the code that parses it. One
finding in the code, reproduced and fixed:

| Id | Severity | Finding | Fix |
|---|---|---|---|
| DB1 | medium | Started on a data folder whose database has another file name, the service created an empty database next to it: no agents, default caps and an empty spend ledger | The store refuses to create a database in a folder that already holds another one |

## Seventh review, 2026-09-30 (the WEGLD swap path)

Claude Fable 5.1 (read-only) on the uncommitted change that lets a swap pay with the wallet's WEGLD: when it
covers the whole swap, one `ESDTTransfer` to the FOXSY/WEGLD pair (`swapTokensFixedOutput`, the transaction the
FoxLeague app signs), with no reserve kept of the WEGLD; otherwise the EGLD path as before. Checked and sound:
the data matches the app's pinned transaction; the caps, the daily and monthly swap allowances and the booking
treat both paths alike; nothing keys on the swap's receiver or value; a swap sized on a stale balance costs only
its gas; the booking counts the most the swap may pay, never less. No finding that loses money or breaks a cap.
Two low findings, both fixed:

| Id | Severity | Finding | Fix |
|---|---|---|---|
| WS1 | low | The live result of a swap did not say which coin had paid | It says "paid with WEGLD from the wallet" or "paid with EGLD", with the most it may pay |
| WS2 | low | A sentence in the plan request invited the model to size a swap to the WEGLD balance, against "swap only what the next actions need" | The sentence is gone |

## Eighth review, 2026-09-30 (everything built that day)

Two Claude Fable 5.1 reviewers (read-only) on all of the day's code: one on money, chain and model calls
(streamed calls and the room by effort, the WEGLD swap, the wallet value and top-up warning, the Guardian
check, the fix for FoxLeague answering a team's lineup to its own session only), one on the dashboard, the
owner chat and Telegram. A third pass checked every number and rule in the manual and the dashboard texts against
the code. Checked and sound: a cut or aborted stream is never parsed or executed; the WEGLD path, the caps and the
Guardian check; session, CSRF and owner-only Telegram on every new route; no markup injection in the page.
Findings:

| Id | Severity | Finding | Fix |
|---|---|---|---|
| TA1 | medium | With the agent's own team unreadable, a starter could be listed or fused (the squad check saw an empty lineup) | Card, lineup, match and condition actions are refused while the team cannot be read |
| TA2 | medium | The top-up warning counted the EGLD gas reserve: a wallet holding only its reserve cannot play, yet looked funded once EGLD is dear | The warning uses what the agent can play with (the reserve aside); the dashboard shows both values |
| TA3 | low | A rival's strength is now the best eleven of its public roster, a little above its real lineup | Accepted: stricter, never weaker (FoxLeague no longer shows a rival's lineup) |
| TA4 | low | The model cost of a call cut by its deadline is not booked | Accepted: rare, and the Anthropic spend limit still applies |
| TA5 | low | The Import team check logged into FoxLeague before checking that the wallet has a team | The public profile is read first; no login for a wallet without a team |
| TA6 | low | A value hovering around the top-up level could send a message at every dip | The warning re-arms only after a top-up to 20 percent above the level |
| CW1 | low | Clear left open a proposal whose line had already left the box (Telegram could still apply it) | Clear drops every open proposal; a line leaving the box takes its proposal with it |
| CW2 | medium | The dashboard downloaded the whole conversation every 15 seconds | The conversation comes only when it changed (a revision in the state) |
| CW3 | low | The owner's message was saved only once the answer came: lost on a reload, out of order, back after a Clear | It shows at once as waiting; a failed call removes it; an answer after a Clear is not written back |
| CW4 | low | Every open proposal said "Apply or Cancel below", though the box holds the newest one only | Only the newest says so |
| CW5 | low | A failed Apply or Cancel hid a proposal that was still open | It comes back into view |
| CW6 | low | A paused agent, or one outside its hours, never sent the low-funds message | Every fresh balance is checked |
| CW7 | low | Earlier chat lines were not framed in the prompt: a quoted title could pose as the owner's message | They sit in a framed, indented block |

## Ninth review, 2026-10-05 (open 1v1s, private tournaments, the ladder presets, level defaults)

One Claude Fable 5.1 reviewer (read-only) on everything built from 2026-09-30 evening to 2026-10-05: open 1v1
challenges, joining invited private tournaments, hidden 1v1 targets, the removal of the guards against the owner's
own agents, the AI cost per day, the spend-on-growth prompt rule and the ladder presets, the per-level default
limits and timing floors, Gold off, Sonnet 5.5. Checked and sound: an open 1v1 is always Silver at the lowest
amount; a private tournament is joined only on FoxLeague's own `user_can_join_private` for the agent's session
(fail closed); no money check relied on the removed guards (a trade or 1v1 between the owner's agents stays inside
every cap and costs the platform fee); the executor never reads the strategy text; the 10-minute tick floor holds
on every path; Gold off refuses joining and creating. Findings:

| Id | Severity | Finding | Fix |
|---|---|---|---|
| R9-1 | low | An open 1v1 whose seat payment reverted or whose join errored was not counted toward the one a day, so a second could follow | Failed and errored creates count too |
| R9-2 | low | Turning Gold back on, a shorter tick and longer active hours (more spending, more AI calls) went through without the password | They need the password like a higher cap, in the server and the dashboard |
| R9-n | note | The cost of /ask was not counted in the AI cost per day | Counted |

The same day, FoxLeague's Security S3 release (single-use login signatures, plain error wording) and its paging
release were checked against the agent: the tournament join and the registration now confirm again on FoxLeague's
`tx_pending` code (the wording "not confirmed on chain yet" no longer exists), a login never signs the same second
twice, the completed 1v1s are read page by page (one page held four of the seven days), and a bid never goes above
what the card costs from Common packs and fusion fees.

## Tenth review, 2026-10-06 (Retire and restore)

One adversarial reviewer tried to make a retired agent plan, sign, send, spend or come back unpaused through every
path (scheduler, plans in flight, the executor's lock, Telegram, the web UI, the CLI, proposals, the start, Import
team). None did: a retired agent's row is always paused, every pause check before a signature still reads it, and
only Restore (which keeps it paused) brings it back.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| R10-1 | medium | Retire paused the agent only after reading the wallet, so an action could still sign in those seconds and leave a payment waiting that no tick of a retired agent would confirm | Retire pauses first, reads the wallet, then refuses (agent left paused) while an action of that agent is still finishing or a payment waits |
| R10-2 | low | A stale Import team confirmation for the wallet of a retired imported agent deleted that agent's key file | The import checks retired agents too before it touches any key file |
| R10-3 | low | /ask with every agent retired paid a model call about a retired agent | It answers that every agent is retired |
| R10-4 | low | `cli check-words` (run by the installer) and `cli agents` (for the PEM files) skipped retired agents | Both include them |
| R10-5 | low | Retiring an agent with unsaved settings edits left the edits in the form under the next agent | The next agent's page opens with a fresh form |
| R10-6 | note | Spent today left out what a retired agent spent earlier that game day | Counted |

## Where the limits live

`src/executor/rules.ts` (the constants at the top: `MAX_1V1_ELO_GAP`, `MAX_1V1_PER_OPPONENT_WEEK`,
`MAX_BIDS_PER_AUCTION`, `MAX_INHERITED_LOCK_HOURS`, `MIN_RESERVE_FOXSY`, `CORE_CARDS`), `src/executor/executor.ts`
(per-agent lock, booking before signing, swap allowance, price valuation), `src/executor/tx.ts` (`syncTx`),
`src/chain/gateway.ts` (EGLD price band), `src/snapshot/digest.ts` (`txt`), `src/telegram/telegram.ts`,
`src/web/server.ts` and `src/web/auth.ts`.
