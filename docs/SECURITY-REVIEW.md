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

## Eleventh review, 2026-10-09 (EGLD top-ups from Binance, approved by code)

One adversarial reviewer tried to withdraw EGLD without the owner's code, twice for one code, to a wrong
address, in dry run, with the kill switch on or above the proposal, through races between offers and
approvals. None did: an approval claims its request before anything is awaited, the address is the agent's own
and checked again, and the code (a hash only is kept) reaches the owner's Telegram chat and nothing else.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| R11-1 | medium | A restart while a top-up was being sent left it 'sending' for good: its outcome was never looked up and that agent's top-ups stayed blocked | The start and /topup look such a request up on Binance by its order id (sent, failed, or never went out after 30 minutes); a stop waits for a top-up being sent |
| R11-2 | low | A lost answer later found as cancelled, rejected or failed on Binance was reported as sent | Only Binance's pending and completed states count as sent |
| R11-3 | low | A typed amount could be sent one rounding step higher, or raised to Binance's minimum without a word | Whole steps are kept as typed; under the minimum is refused and the code stays valid |
| R11-4 | low | A lost Telegram message with the code blocked a new code for an hour | /topup N replaces an open code with a new one |

Added the same day: a top-up goes only to a wallet on the Binance withdrawal whitelist, and Test keys shows which
agent wallets are not on it yet.

## Twelfth review, 2026-10-09 (the quiet Telegram, the morning summary, urgent messages, top-ups again)

One adversarial reviewer went through every Telegram message the agent sends, the morning summary, the agents
that wait for funds and the top-ups once more. The top-ups held: no EGLD leaves without the owner's code, twice
for one code, to another address or above the proposal, and the quiet mode cannot hold a code back.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| R12-1 | medium | A payment signed and handed to the network whose send then timed out (no hash) waited for the morning summary | A sent payment with an unclear outcome is told at once, with or without a hash; a paid registration keeps its fee's hash |
| R12-2 | medium | `/do N {json}` answered nothing in the quiet mode, so the owner might send it twice; owner-asked plans waited too | The answer is the result itself; a plan or action the owner asks for on Telegram is told at once |
| R12-3 | medium | A Telegram chat linked after the start never got the morning summary until a restart | Linking a chat arms the summary |
| R12-4 | medium | An agent already holding the 5,000 FOXSY fee, or whose fee state could not be read, was parked as waiting for funds | Only a fee known to be unpaid and too little to pay it parks an agent |
| R12-5 | low | The summary's waiting line hid plan errors, plans and paused agents | They get their own line |
| R12-6 | low | A summary that failed to build was marked sent and never came that day | It is marked sent only after it is sent |
| R12-7 | low | One shared cause (an outage) gave one urgent message per agent, up to 25 | One an hour per cause |
| R12-8 | low | `/topup N` on an agent that had just fallen low sent two codes, the first one dead | It reads the wallet without the low-funds check |
| R12-9 | low | Telegram's own 5xx dropped a message after one try | Retried like a lost connection; a final drop is logged, without the text |
| R12-10 | note | Summary bookkeeping: the AI cost is a UTC day, badges counted as actions, an unconfirmed payment counted as failed, an empty summary hour | Labelled, left out, not counted, defaults to 9 |

## Thirteenth review, 2026-10-10 (Zeus, the level window, the phone layout)

One adversarial reviewer went through Zeus (the win chance, the podium rule, private invites), the level proposal
window and the phone layout. Nothing high: a private tournament is checked by FoxLeague before anything is paid, so
a refused invite list never costs a seat, and only Zeus can create one.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| Z1 | medium | The owner's teams that were never noted (an agent retired before this version, a removed imported team, a failed first reading) could be invited | Every team this install ever ran counts, noted at each reading, at retire and at start |
| Z2 | low | A field that could not be read let Zeus pay into it | Refused; a team with an unread squad and a clearly higher ELO counts as stronger |
| Z3 | low | An open 1v1 skipped the 55 percent rule | Zeus plays a 1v1 only against a named team |
| Z4 | low | Refusals named the barred teams, so the AI could learn them | The owner's teams leave the invite list without a word |
| Z5 | low | "Matches in 3 days" could cover a week or one day | Counted against the reading nearest 3 days back, with the real span |
| Z6 | low | Extra FoxLeague calls on every reading and a burst at every join | A rival's squad is read at most every 20 minutes; the field only for an entry that could go through |
| Z7 | low | The level window: moving down proposed nothing, Accept saved other unsaved edits, no Escape, "null" with the AI off | It follows the direction, saves only the ticked rows, closes with Escape and says when the AI is off |
| Z8 | low | Agents with the older "of 5" texts showed as Custom | A level is recognised by its name |
| Z9 | low | An empty invite list refused the whole create | It is a public tournament |
| Z10 | low | A rewrite without the level name dropped Zeus mode | The manager keeps the level name |
| Z11 | note | The AI was not told the 55 percent threshold, and the strength units were unclear | Both stated |

## Fourteenth review, 2026-10-11 (an independent audit: money and chain, web and Telegram, orchestration and deployment)

Three Claude Fable 5.1 reviewers (read-only) went through the whole code in three areas, and each re-checked the earlier
fixes: every money and security id listed above still holds. Nothing high. Every finding accepted as real was read in the
code again before the fix and got a test that failed first (`test/audit-fable.test.ts`, `test/executor.test.ts`).

| Id | Severity | Finding | Fix |
|---|---|---|---|
| R-1 | medium | `register` read an unreadable fee state (`isRegistrationPaid` failed) as unpaid: with the profile read also failing, a registered team could pay the 5,000 FOXSY fee again | An unknown fee state is refused, nothing paid, the next plan retries |
| F-O1 | medium | The ESDT route failing became "0 FOXSY, 0 WEGLD": the model planned EGLD to FOXSY swaps for FOXSY the wallet held and a false low-funds warning | The chain section is unknown (null) when either balance route fails; the rules refuse blind |
| F-M2 / F-O4 | low | A failed profile read looked like an unregistered team: swaps moved to the setup allowance (up to the setup budget instead of the daily cap) and `register` was planned | `registration.profileUnreadable`; swaps and `register` are refused while the profile cannot be read |
| F-M1 | low | A created tournament or 1v1 whose seat was never paid (not on chain after 60 s) stayed booked until it ended | The booking is released (nothing was signed) |
| F-S1 | medium | The login hashed with `scryptSync` on the event loop, with no limit for addresses that had not failed yet: a flood stalls the executor, the kill-switch re-reads and Telegram (behind nginx) | Asynchronous scrypt through a queue: one at a time, at most 2 per client address and 32 in all, 429 beyond |
| F-S2 | low | `{"model":"constructor"}` passed `!MODELS[model]`, was saved and failed every plan | `isKnownModel` (own keys only), also on read |
| F-S3 | low | A forwarded message carries the owner as its sender and ran as a command (`/kill off`, `/do`) | Any `forward_*` field, `is_automatic_forward`, `via_bot` or `external_reply` is ignored |
| F-S4 | low | A malformed cookie (`%`) threw before authentication and logged a stack trace per request | The cookie is dropped |
| F-O5 | low | `/ask` sent the snapshot outside the data fence the plans use | Same fence |
| F-O6 | low | The preparation tick could undercut the 10-minute floor (5 minutes) | Uses `MIN_TICK_MINUTES` |
| F-O9 | low | The dashboard bind was fixed to 127.0.0.1, which forces `network_mode: host` in a container | `WEB_UI_HOST` (default 127.0.0.1) |

Open, not changed here: **F-M3** (low, plausible) `pending.ts` treats "Do NOT pay again" as done while
`docs/FOXLEAGUE-INTEGRATION.md` says the join must be retried without a hash: it needs FoxLeague's answer on whether the
seat is finalised by itself; **F-O7** (low) `cli plan N` and `cli dry-run N` insert an unpaused agent row;
**F-O8** (low, plausible) the 150 s stop budget can be used up inside a snapshot, after which an action starts.

Merged on 2026-10-13 onto 3e1774e (FoxLeague's 12 October switch; the starter stock it read is gone). Follow-ups at the
merge: a forwarded message gets a short reply saying it was not read (the owner was left waiting for an answer), and
`WEB_UI_HOST` is documented in `.env.example`. F-M3, F-O7 and F-O8 go to the whole-project review.

## CI and the agent review, 2026-10-13

CI and the agent review run when a maintainer adds the label merge-check to a pull request into main (nothing runs on
opening or updating one). An independent Fable 5.1 review of the workflows (W) and the agent's review of PR #5 (P5):

| Id | Severity | Finding | Fix |
|---|---|---|---|
| W1 | high | Required checks match by name: a workflow a pull request brings could post green checks named ci and claude-review | Both results are commit statuses (foxleague-agent/ci, foxleague-agent/review) of the project's GitHub App, required from that App only |
| W2 | medium | The review checked out the merge ref as it was at fetch time, not the head the result attaches to | The merge commit's second parent must be the labelled head, in CI and the review |
| W3 | medium | Nested CLAUDE.md, CLAUDE.local.md, .claude/ and .mcp.json of a pull request survived the clean-up and steer Claude Code | Removed at any depth before the review; the instruction files come from main |
| W4 | low | Triage access can add labels too | Documented: the repository gives no one outside the maintainers triage or write access |
| W5 | low | Scripts and instructions read from the event's base, which can be stale | Read from the merge commit's first parent (current main) |
| P5-1 | high | Running the pull request's code under pull_request_target put it in main's cache scope, which the review restores from (claude-code-action's Bun) | CI runs under pull_request again (its own cache scope, no secret); report-ci.yml posts its result as the App from main via workflow_run |
| P5-2 | medium | The App's key was a repository secret: a workflow on any branch could mint its token | The key is a secret of the environment "checks", usable from main only |
| P5-3 | low | The token action by a moving tag, its token not limited | Pinned to v2.2.2's commit, permission-statuses only |
| P5-4 | note | A pull request changing ci.yml is judged by its own copy | The review fails any change to .github/ or scripts/ci/: the maintainer checks it by hand |
| P5-5 | medium | report-ci posted the result of any CI run: a manual run on another branch, or a pull request into another branch whose own ci.yml was tested | Only pull request runs into main (the run's pull request, or for a fork an open pull request into main with that head) and pushes to main |
| P5-6 | low | A file renamed out of .github/ or scripts/ci/, or one with a quoted name, escaped the hand check | git diff --no-renames with a pathspec instead of a grep of the names |
| P5-7 | low | The fork fallback of report-ci also vouched for a run of a branch of this repository that named no pull request | Such a run is refused; only a fork's run uses the fallback |

Settings that go with it: the ruleset "main: changes through a pull request" requires foxleague-agent/ci and
foxleague-agent/review from the App FoxLeague Agent Checks (id 5301257); the App's key is a secret of the environment
"checks" (deployment branches: main only) and nowhere else; the App may only write commit statuses.

Open: someone with write access could still create a branch whose own ci.yml passes and open a fork pull request
into main from a head that also has that branch's run, which the fork path above cannot tell apart; the maintainer's
approval of every pull request by others is the gate for that. The same holds for a branch of this repository
that opens a pull request into another branch and closes it before its run ends, if GitHub then lists only the
pull request into main for the run (not verified). When the repository goes public, outside contributors'
workflows need the maintainer's approval to run (set on launch day).

## xExchange paused every pool, 2026-10-13

At 10:39 UTC xExchange's router admin paused about 700 pairs, FOXSY/WEGLD among them (swaps fail with "Swap is not
enabled"). The agent read no FOXSY price from a paused pair, so every paid action of every agent was refused.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| XP1 | medium | A paused pair left the snapshot without prices: no entry, sync or shop payment, even with FOXSY held | A paused pair cannot trade, so its reserves hold the last price: FOXSY is valued at it (still the higher of spot and the two-day median), swaps are refused with a plain reason and the plan is told (PR #3) |
| XP2 | low | Sampling the frozen price into the two-day median would let a price moved just before the pause set the caps after about a day | No samples while the pair is paused (agent review of PR #3) |

## Whole-project review, 2026-10-13

The owner's method: four Claude Fable 5.1 reviewers at max effort, read-only and in parallel, one per area: money
and limits (A), outside attackers, web, Telegram, install and CI (B), chain and FoxLeague integration (C), docs and
user text against the code (D). A finding counted only when its reviewer proved it with a test that failed on main
(5ab42c2); something no test could make fail was listed as unproven and not changed. The fixes were made by Claude
Opus 5.5 at extra-high effort, test first (each test seen failing, then passing), in four pull requests (#7 to #10),
each through CI and the agent review before the merge (#9, a change to the workflows, by hand). No phantom: every
finding's test failed first. Thirty findings, two high, none critical; no cap, signing gate or key was reachable.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| C1/A4 | high | FoxLeague's GET /api/shop/status sends the XP booster flat (`xp_booster_active`, `xp_booster_expires_at`; `shop.rs:56-72`), the agent read a nested `xp_booster` the server never sends: the "booster active" refusal never fired, the digest never said one ran, and buying again restarts the 24 h (`shop.rs:794-816`). Live: 20 boosters bought while one still ran, about 13,800 FOXSY of hours thrown away. An unreadable shop status or an active booster without an expiry also let a purchase through | The type, the rule, the digest and the effect after a purchase read and write the flat fields. A booster is refused when the shop status is unreadable or does not say whether one runs, when one is active with no readable expiry and while more than 2 h are left (`XP_BOOSTER_RENEW_HOURS`). The digest says "XP booster active until ..." or "status unknown" |
| A1 | medium | A paid seat was recorded as pending only after the outcome wait: a stop or crash inside it lost the hash and the next plan paid again | Pending right after the send, failed on a revert (#10) |
| A2 | medium | A stop during an action's snapshot could still prepare, sign and send it (F-O8) | runPlan re-checks the stop after the snapshot; the executor checks it before the booking and before signing (#10) |
| A3/C2 | medium | A 1v1 join or a created challenge paid with the agent's tournaments or upcoming matches unreadable (read as "none") | Refused while either cannot be read; the within-the-hour check refuses on unknown, so play_match too (#10) |
| A5 | medium | A seat FoxLeague refunded because the agent was never seated was closed as played and kept counting | Credited when the agent is not among the participants; unknown keeps counting (#10) |
| A9 | medium | A shop payment FoxLeague refunded was resolved as done but never credited | The FOXSY row (shop:product) is credited on a refund answer, the gas stays (#10) |
| A10 | medium | A definite broadcast refusal stayed booked like a timeout | Released only for a definite refusal whose locally computed hash the gateway does not know; nonce or duplicate answers, unknown wording, a known or unreadable transaction keep the booking (#10, after its agent review) |
| A6 | low | Fusion went ahead with FoxLeague's pre-check unreadable | Refused (#10) |
| A7 | low | An agent whose Binance top-up was sent but not landed could be deleted as never used | A sent top-up counts for an hour (#10) |
| A8 | low | A bid whose answer was lost after signing did not count toward two bids per auction | Error rows count when the bid was sent; errors before any signature do not (#10) |
| C3 | low | A won bid could be credited during the cross-shard settlement | Closed as won when FoxLeague names the agent as owner, credited only after 10 minutes when it names someone else, kept when unreadable (#10) |
| B2 | medium | A dearer AI model or a higher effort for every agent needed no password, while a shorter tick did | The password whenever a model price or the effort goes up; the dashboard asks once, also from the level dialog (#8) |
| B1 | low | cli dry-run N and cli plan N wrote an unpaused agent row past the agent limit (F-O7) | Refused for an agent that does not exist (#8) |
| B3 | low | agentctl configure and set-web-password failed on a server built by bootstrap.sh (no new file allowed next to the env file) | A durable in-place rewrite with a synced backup copy in the data directory first, removed after success (#8, after its agent review) |
| B4 | low | A non-numeric activity limit answered 500 with a stack trace | Floored, 100 when not a number (#8) |
| B5 | low | The workflow holding the review token used moving action tags | Every action pinned to its release commit, with a test (#9) |
| D1-D12 | medium to low | Docs and user text against the code: "every half hour" (2 hours by default), the prompt's old 20-match line, the safety page on private tournaments, the level dialog described as fill-and-save, low funds on Telegram in quiet mode, five presets, the README version, the review count, top-ups as "a later feature", the tick input's minimum, the removed starter stock route, eight Oxford commas; docs/SERVER.md now names WEB_UI_TRUST_PROXY=1 behind nginx | Corrected, most with a test that reads the text (#8) |

Open: FoxLeague itself reports a booster as inactive when its own booster query fails (`shop.rs:794-808`, logged
and defaulted to false), which the agent cannot tell from "none bought"; the pending shop payment guard (M9) and
the ledger cover only the agent's own recent purchases.

F-M3 is refuted: FoxLeague's answer "Do NOT pay again" means the fee is verified and its reconciler seats a paid
wallet from its standing escrow (tournament_reconcile.rs seat_unseated_escrow, on by default), so treating it as done
is right.

Also open, seen while fixing and not yet proven by a test: pending.ts resolves a shop payment as done on any answer
containing "refunded", which FoxLeague's timeout wording also contains; a won bid relisted before the won-close ran
could be credited; the booster rule could also check the agent's own last booster purchase in the ledger (agent
review of #7); Telegram's update offset lives in memory, so a command in the instant before a crash could run again
after the restart.

## Second review round, 2026-10-13

The same method on main 733a8d5, after the first round's fixes: three read-only reviewers in parallel, money and
limits (R2A), web, Telegram and install (R2B) and a fresh reviewer over the whole project (R2C). A finding counted
only when its reviewer proved it with a test that failed on 733a8d5. The fixes were made by Claude Opus 5.5, test
first: every test, adapted into `test/review2-money.test.ts` and `test/review2-web.test.ts`, was seen failing on
733a8d5 and passing after its fix. No phantom. The four items the first round left open as unproven are among them
(R2A-2, R2A-4, R2A-5, R2B-2).

| Id | Severity | Finding | Fix |
|---|---|---|---|
| R2A-1/R2C-2 | medium | The pending-payment retry never ran in routine operation. `retryPendingPayments` abandoned a row older than 25 minutes before any confirm, and its only caller, the tick, comes every 120 +-10 minutes (Zeus 60) and returns first outside the active hours, while paused, retired or under the kill switch. A shop payment or a seat whose confirm answered `tx_pending` was never confirmed again: the product was not delivered and A9's credit never ran | The service runs the retry on its own timer, about every minute from the start; only a stop ends it, since a confirm signs and pays nothing. One pass at a time, every agent with a pending row (retired ones too), under the executor's per-agent lock, so a hash is never confirmed while the action that sent it is mid-flight. Every row is confirmed once at any age (FoxLeague's answer for a known hash is final); a row is given up only when the answer is still not final (`tx_pending`, no answer, unknown wording) after 60 minutes, past FoxLeague's 30-minute shop grace and its 5-minute refund sweep. The alert gives the last answer and, for a seat, says FoxLeague may still seat the team or refund it |
| R2A-2 | medium | The final-answer wording checks also matched FoxLeague's `tx_pending` texts: the shop timeout ("after that it is refunded automatically"), the join's `retry_same_tx` ("If it was refunded ..., your FOXSY is already back") and `REFUND_IN_FLIGHT_ANSWER` ("do not pay again"). A payment FoxLeague asked to confirm again was resolved as done | An `ApiRefusal` with the `tx_pending` code keeps the row pending before any wording check |
| R2A-3 | medium | Regression of C3: a lost bid whose winner fused the card kept counting all month. FoxLeague deletes burned cards and answers "Player not found" (`players.rs`), which the refund check read as "owner unreadable" | "Player not found" for a settled auction whose card is not in the wallet counts like another owner (the grace, then the credit), unless the agent's own log holds a fusion of that card since the bid: a confirmed one closes the bid as won, one sent with an unknown outcome keeps it counting. No answer and a 5xx stay unknown |
| R2A-4 | low | A won card the agent listed again before the won-close ran made the bid look outbid (the agent is not the top bidder of its own auction), so it was credited | A live auction whose seller is the agent closes the bid as won |
| R2A-5 | low | The booster rule trusted `xp_booster_active` alone, which FoxLeague reports as false when its own booster query fails | The executor reads the agent's own booster purchases of the last 22 hours (24 less `XP_BOOSTER_RENEW_HOURS`; simulated ones in the dry-run ledger) that may have paid and the rule refuses: "an XP booster was bought n h ago". Unconfirmed rows count too (the pending retry may confirm one later while its log row stays unconfirmed), and so does one sent whose answer was lost, as for the bid limit; a refused, reverted or unsigned purchase does not (agent review of #12) |
| R2B-1 | low | The in-place env rewrite (B3) copied the env file, with the recovery words, to the data directory before it knew the file could be opened for writing: an env file the service user can read but not write left the copy behind and blocked every later rewrite | The env file is opened for writing first. The backup goes as soon as the new content is synced, before the mode change; a failing chmod says the file is saved |
| R2B-2 | low | Telegram's update offset lived in memory: a command dispatched just before a crash or a restart came back after it and a /do ran twice | Kept in the database per bot (kv `telegram_offset`, the bot's public number, never the token), read before the first poll and written after each batch before any of it is dispatched: at most once. An offset more than a day old is not used |
| R2C-1 | low | The README promised "never a 1v1 or trade between your own agents", a rule the owner removed on 2026-09-30 | The safety page's wording: the agents are never coordinated and may meet by chance |

Open, noted by the money reviewer as design observations: a shop payment whose broadcast got a nonce or an unknown
refusal (A10 keeps its booking) leaves no pending row, so no confirm is tried for it if it did go through; and when an
extension cuts a shop payment into pieces (`splitAction`, `src/extensions.ts`), a later piece of the same product is
refused while an earlier piece's confirm is `tx_pending` (the pending shop guard, M9) and the rest of the group is
dropped, so the next plan decides again.

## Third review round, 2026-10-13

One read-only reviewer on main d8ea6f5, after the second round's fixes (the always-on pending retry, the booster
rule, the env rewrite). A finding counted only when it was proven with a test that failed on d8ea6f5. The fixes were
made by Claude Opus 5.5, test first: both tests, adapted into `test/review3.test.ts`, were seen failing on d8ea6f5
and passing after the fix.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| R3-1 | low | A booster payment FoxLeague refunded held the next booster for 22 hours. R2A-5 reads the agent's booster rows in the activity log and counts `unconfirmed` ones on purpose, but when the pending retry hears "already refunded" it credits the ledger row (`shop:xp_booster:refunded`) and never touches the log row, which stays `unconfirmed`: nothing was delivered and the FOXSY came back, yet the rule refused "an XP booster was bought n h ago" | One store query (`refundedHashes`) reads the hashes of the agent's booster payments credited as refunded, and the rule skips a log row with one of them. Every other row counted before still counts |
| R3-T | hardening | The pending-retry timer's errors were not caught. The store calls of a pass (`pendingAgents`, `agent`) ran outside the per-agent catch and the timer had no `.catch`, so a store error (SQLITE_BUSY while a CLI command writes the same database) became an unhandled rejection, which `panic()` turns into the kill switch for every agent, again at every pass | A pass catches and logs its own error (as the morning summary's timer does) and the next pass asks again; this timer never reaches `panic()` |

Found sound by the reviewer's probes: the timer's pass and the tick's own retry for the same agent confirm a hash
exactly once (the executor's per-agent lock); `stop()` neither cuts a confirm in flight nor hangs, it waits for it
and returns; the env rewrite keeps the backup and names it when a write is cut halfway and the next rewrite refuses
until it is removed, leaves the words in exactly one place with mode 600 after a success and changes nothing when the
backup directory cannot be created.

Open, listed by the reviewer and not proven by a test: `stop()` waits for a confirm in flight up to the 150 s bound,
not longer; a failing Telegram kv write (the update offset) fetches the batch again without dispatching it; a
refunded seat answer resolves the pending row without crediting `join:<id>` until the tournament is closed; the order
of Retire's messages.

## Agent review of PR #14, 2026-10-15

The agent review (Claude Opus 5.5) of PR #14, which synced the game knowledge to FoxLeague's manual of 2026-10-15
(main ed129a895, rc.68 on mainnet), found two claims of the PR untrue. The fixes were made by Claude Opus 5.5, test
first: every finding test in `test/review14.test.ts` was seen failing before its fix (R14A-1 on 5bbe423, R14A-2 on
208c4f9) and passing after it; the play_match test is a control.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| R14A-1 | medium | FoxLeague's 1v1 busy gate changed on 2026-10-15 (#512, ad47adc58): the create and join gates read the play gate's rows (`matches.rs` `tournament_busy_rows_sql`): an own unrevealed match from 1 h before kickoff until its broadcast ends, however late; in `groups_knockout` every team of a group from 1 h before the group's last kickoff until the whole group has ended; in Swiss every team of a round from 1 h before its own match until the whole round has ended. The agent checked only its own matches from 1 h before to 15 min after kickoff, so it paid a 1v1 stake (join) that FoxLeague then refused: the gas lost, the refunded stake counted until credited | `oneVOneBusy` (`src/executor/rules.ts`) mirrors the three rows from the agent's own fixtures (the upcoming route now read with `group_name`, which FoxLeague already sends): an own match until its phase is finished; a group until an own knockout fixture is listed; a Swiss round until the next round is listed. It refuses where it cannot tell: no own fixture listed, no `group_name`, a format or status it does not know, a tournament of its own starting within the hour whose fixtures are not out yet, an upcoming list that fills FoxLeague's page of 50 (a row within the hour may be cut from it). A 1v1 join is also refused when FoxLeague's own answer, `viewer_blocked_tournament_window`, is true. play_match keeps its window (nothing is paid there) |
| R14A-2 | medium | The PR said an unknown format is estimated at its worst case and so never joined. Not so: `matchesAtMost` counts an unknown format as a league (`max_teams - 1` matches) and join_tournament had no format check, so a format the agent does not know, FoxLeague's admin-only `league_knockout` (36 teams, a league phase and two-legged knockout ties), was joined whenever that estimate fitted the squad's condition, for example with a daily round. A create of an unknown format reached `VALID_SIZES[format]!` and crashed (parseAction refuses it first, so only an action built another way got there) | `unsupportedFormat`: join_tournament and create_tournament refuse any format outside the four the agent knows ("format league_knockout is not supported yet: not joining blind"). knockout, groups_knockout, round_robin and swiss join as before |

Open: FoxLeague's play gate reads the same rows (unchanged on 2026-10-15), while play_match keeps the agent's
window of 1 h before to 15 min after kickoff, so FoxLeague may refuse a casual or ranked start the agent sends; it
costs nothing; play_match does not read the full page either. A group or round is held busy until the agent's
next fixture shows, so an agent out after the group stage, or past its last Swiss round, stays out of 1v1s until
the tournament completes (fail closed: its own fixtures cannot show the rest of the group or round). The prompt's line "no tournament match within the hour" (`src/strategist/prompt.ts`,
byte-stable) is FoxLeague's error text and stays.

## Formations, 2026-10-22

Nine of the ten agents played one formation in all of their last 50 matches (seven 4-4-2, one 4-3-3b, one 5-3-2);
the tenth played 5-3-2 three times on 14 October, then 4-4-2. Across those 483 matches (13 to 22 October) 4-4-2
scored 0.13 a match below what the strength of the two elevens predicted against the 4-3-3 family (a win counting 1
and a draw a half; 102 matches, about three times the noise). The agents could change formation, but they saw no
record of what each formation did against which, and the change itself was not safe. The fixes were made by Claude
Opus 5.5, test first: every test in `test/formations.test.ts` was seen failing before its fix (on 0267386; R15A-1 on
6bfdfbd, R15A-3 on ce0847c) and passing after it, except "the record is read only when asked", a control, and R15A-2's coverage.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| F1 | medium | A formation change ran as its own action, apart from the lineup it needs, and set_lineup is checked against the saved formation, so the lineup could only come later. The actions of a plan run at random moments over 80 percent of the cycle, so a ranked match or a strategy lock between the two could play the old eleven in the new shape (FoxLeague does not check positions: a midfielder in a forward's slot), and a refused lineup left it so until the next plan. It had not happened: the four switches so far (5 to 15 October) saved the lineup 36 s to 13 min after the formation, with no match or entry between | `set_formation` takes `lineup` and `substitutes` (both or neither), checked against the new formation; the executor saves the formation and then the lineup at once, and when the lineup is refused it saves the old formation back and says so. A formation the current eleven does not fit is refused without them |
| F2 | medium | Nothing stopped a match or an entry while the saved eleven did not fit the saved formation | `squadLegal` refuses it (ranked and casual matches, joins, created tournaments, 1v1s), and the digest says LINEUP DOES NOT FIT until it is fixed |
| F3 | low | New reads from FoxLeague: a team's match history and each match's public statistics (about 120 KB each) | Read only for the snapshot a plan is made from, never for the checks before each action: at most 10 new matches of the agent's own and 6 of its next rivals' per plan, each kept in `match_facts` (90 days) and never read twice. A failed or hidden read is "not read yet", never counted as a result. Formation names from the server pass through `txt()` |
| R15A-1 | medium | Agent review of PR #15: after a failed lineup save the old formation went back on any error, not only on FoxLeague's refusal. A timeout or a 502 after the backend had saved the new eleven left the old formation with the new eleven, out of position, and said "restored". The same held for a formation call that failed after its save: its lineup was never sent | Only FoxLeague's refusal (`ApiRefusal`) is taken as "not saved". Any other failure reads the team back: an eleven saved keeps its new formation (confirmed, "read back"); one not saved gets the old formation back; a team that cannot be read is left as it is, said so, and F2 holds every match the agent starts. A formation call that failed but read back saved goes on to its lineup |
| R15A-3 | low | Re-review of PR #15: a formation call that failed without a refusal, on a team that could not then be read back, ended in the bare error, while FoxLeague might hold the new formation with the old eleven. And an answer that is not FoxLeague's envelope ("unexpected answer", for example an empty 502 body) counted as a definite refusal, so a lineup saved behind it got the old formation back blind | The formation call's case saves the old formation again (its lineup was never sent, so the old formation fits the saved eleven either way) and says the state is unknown. Only FoxLeague's own refusal counts as "not saved"; an unexpected answer is read back like a timeout |
| R15A-2 | low | The test of F2 checked only play_match, not the entries that pay FOXSY | The same test refuses join_tournament and create_challenge (coverage: the code already refused them, so this test passed at once) |
| F4 | design | The owner chose (2026-10-22) that the agents learn from one table: an agent alone has only its own formations, so it learns what another does only by testing it | Each plan stores the agent's counted matches (`formation_results`, 30 days) and is shown the pooled record of the last 14 days of every team the install runs, its own included. It names no team, and a match between two of the install's teams is left out (it says nothing about the field). The agents still know nothing else of each other |

Open: the strength edge is the elevens as they played (synced stats and condition at the match), not today's. A
rival's formation is the one it played last, which it may change before the lock. A team that has not planned since
this change is not yet known as one of the install's, so a match against it counts in the pool until it plans.

## Squad growth, 2026-10-22

The owner's direction after the formation record went live: an agent whose record favoured the 4-3-3 family kept
4-4-2 because it had two strong forwards (two Legendaries, three Commons), and the Beast level sold every spare card
above 36 although spares are what a team fuses, grows and sells. Only the strategist's text changed (test first:
`test/squad-growth.test.ts`, each test seen failing before the change); no cap, limit or code path did.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| G1 | design | A card that would let the squad play the formation its record favours did not count as an upgrade: the agent judged a buy against the formation it already played | The prompt (every level) counts the missing player as part of the upgrade: a card of that position at a fair price (a Rare often the best strength per FOXSY, a Legendary only when its price pays) or a fusion into that position, within the level and the caps; until then the formation is tested in ranked |
| R16A-1 | low | Agent review of PR #16: the dashboard's help for the levels still said Beast sells spare cards above 36, and its Hunter sentence did not mention selling | The help says Hunter holds as many cards as it likes and sells a spare card when its price beats its use; Beast adds both fusion waivers. A test reads the dashboard for it |
| G2 | design | The Beast level listed every spare above 36 cards, and Hunter and Predator, which buy and fuse cards, were never told to sell one | No level counts cards: the prompt says there is no upper limit, and that a card outside the eleven and bench never moves toward its match gate (a spare reaches it by playing, or partly with match credit). Hunter (and so Predator and Beast) lists a spare when its price beats its use, as Zeus does. Steady and Climber still never bid (max bid 0) |

The executor's rules for a listing are unchanged: never one of the 18 strongest cards, 18 left, the match gate met,
synced stats, a reserve at least the floor and the rarity minimum. The texts of the levels reach an agent when its
level is chosen; the ten running agents are on Zeus, whose text already sold by value, so for them only the prompt
changed.

## Strength bands, 2026-10-23

The owner's direction after the formation record went live: a formation should be judged on matches between
elevens of like strength, since a much stronger or weaker squad wins or loses whatever it plays. Each row of the
record showed only the mean strength edge, which mixed lopsided matches with even ones: in the live pooled record of
2026-10-22, 4-4-2 against 4-3-3 read 15-5-18 over all matches but 0-2-10 within 10 percent strength. Test first:
the four tests under "strength bands" in `test/formations.test.ts` were seen failing before the change.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| S1 | design | A pairing's results were not split by strength, so an even matchup could not be told from a lopsided one | Each row (own and pooled record) carries its results in three bands: this team more than 10 percent stronger, within 10 percent (even), more than 10 percent weaker; a match whose strength is unknown is in none. The prompt calls the even band the fair test of a formation |
| S2 | design | A coming tournament or 1v1 rival showed its last formations but not its strength next to ours | Its Upcoming line compares its best eleven at full condition (the same public read as 1v1 scouting, kept 20 minutes) with the agent's eleven today, in percent, so the agent reads the band of the coming match; unknown when either cannot be read |
| R17A-1 | low | Agent review of PR #17 (coverage): no test held the guard that keeps the comparison unknown when the agent's own roster read fails (its lineup strength then reads 0, which would print "you are 100% weaker") | A test with a readable rival and a failing own roster expects "their strength: unknown". The guard was already there, so the test passed at once; with the guard removed it fails |

Nothing else changed: no new route, no money path. The rival's eleven is its strongest 11 cards at full condition, so
the comparison leans against the agent, as the 1v1 rule does.

## One challenger per rival, and buying power, 2026-10-23

Two findings from the live agents on 2026-10-23. Three of the owner's agents had 1v1 challenges out against the same
team at once ("Akeno"): each chose it on its own as a weaker, active opponent, but one manager faced three of the
owner's teams together and two of the stakes could only wait out their deadlines. And Sporting Ohrid, holding 199.6
EGLD and 770 FOXSY, wrote "the wallet holds about 770 FOXSY, so no entries, bids or recovery are possible": it judged
what it could afford on its FOXSY alone, while no limit stopped a swap ($744 of its $3,000 month used, $2.89 of $150
that day). Test first: `test/challenges-and-funds.test.ts`, each finding test seen failing before its fix; the test
that the new refusal is not taken for the sibling rule removed on 2026-09-30 is a control.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| C1 | low | Several of the owner's agents could challenge, or take the open 1v1 of, the same rival at the same time | `oneVOneOpponentRefusal` (create with a target, and join of a 1v1) refuses while another of the owner's agents has a 1v1 out against that rival: its create or join logged in the same ledger (a failed or errored create too, as it may have left a challenge), until its deadline (a join: at once) and an hour for the match have passed. The refusal names no team and does not read as the old sibling rule. Agents may still meet each other, as before |
| B1 | design | An agent judged what it could afford on the FOXSY it held, never counting the EGLD above its gas reserve | The plan request shows its buying power: the FOXSY held plus what the EGLD above the reserve (and any WEGLD) swaps into at the current price, next to the one-swap limit and what today's budget left buys; unknown without a price or a wallet read. The prompt says never to call something unaffordable on the FOXSY alone, and to swap earlier in the same plan when an action that pays needs it |
| R19A-1 | medium | Agent review of PR #19: C1 could be raced. Agents plan at the same time, the executor serializes only one agent's actions, and a live create is logged only after the create, the payment and the seat (minutes), so two agents that picked one rival in the same cycle could both pass | The shared executor claims the rival in memory in the same synchronous step as the check (no await between them), until the 1v1's deadline and an hour have passed; another agent's check sees the claim. A test runs two overlapping joins against one rival: one passes, one is refused |
| R19A-4 | medium | Re-review of PR #19: nothing released the claim of R19A-1. A refusal after the check (prices, the daily cap, the swap allowance, EGLD for gas: nothing was created) held the rival for up to 5 hours, and so did a dry-run claim from before Go LIVE for a live agent, with a false "already has a 1v1 out" | A refusal releases the claim its own action took (every refusal comes before any FoxLeague call or signature), and a claim made in dry run is not counted by a live check. Two tests: a refusal for gas frees the rival at once; a dry-run claim does not refuse a live agent |
| R19A-2 | low | Agent review of PR #19: while xExchange has paused the pair (`prices.frozen`), the buying power still counted the EGLD as FOXSY to come, though every swap is refused then | The line says no swap is possible while the pair is paused, so the FOXSY held is all there is |
| R19A-3 | low | Agent review of PR #19 (docs): the manual's safety page said the agents share nothing and listed the 1v1 protections without C1 | The page names the two things they share: the pooled formation record (no team named) and one 1v1 at a time per rival |

No cap or limit changed: every swap still meets the swap maximum, the gas reserve, the daily cap and the monthly
budget in the executor. Open: a create or join that failed or errored counts whatever mode its agent ran in, so a
dry-run agent's error can hold a live agent off that rival for up to 5 hours (it only refuses more); a rival that took
an agent's own open challenge is not seen by the others (FoxLeague's one active 1v1 per wallet keeps it from a second
until the first is over).

## Bid ceiling with the time a card takes, 2026-10-23

The owner's direction: the ceiling a bid may not pass counted only Common packs and fusion fees (a Rare 5,000 FOXSY,
an Epic 15,400, a Legendary 47,000), while Rares were listed at 9,000 to 17,500, so no agent could buy the third
forward its formation record asked for. Building a card also takes time, and time is money: the matches every input
must play to reach its gate, and the days a fused card must wait. A card at auction has already played its gate
(only such a card can be listed). Test first: `test/bid-ceiling.test.ts`, each test seen failing before the change.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| BC1 | design | The bid ceiling left out the time a card takes to build and to bring to its match gate, so it sat far under the market | `auctionCeiling` (`src/executor/rules.ts`): the Common packs and fusion fees, plus every competitive match an input or the card needs to reach its gate at the rarity's price for a bought match (a Common has none: the cheapest match price), plus every day of a fused input's cooldown at the price of a day bought off, whether or not that wait can be bought; all read from `/api/config`. Mainnet, 2026-10-23: Common 600, Uncommon 2,200, Rare 14,450, Epic 60,400, Legendary 225,650 FOXSY. Without the gate rows or the cooldown settings, the packs and fees alone (lower, so stricter); without those, no ceiling, as before |
| R20A-1 | medium | Agent review of PR #20: the formula also charged the card bought its own 14-day cooldown (1,050 FOXSY), though a card may be listed inside it and a Legendary is never a fusion input | Only the fused inputs carry their cooldown; the card bought is charged its matches to its gate alone (Rare 14,450 instead of 15,500) |
| R20A-2 | low | Agent review of PR #20 (docs): the strategy levels page still gave the old 5,000 / 15,400 / 47,000 and the comment on `bidCeilings` was stale | Both describe the new ceiling; a test also covers a missing rarity row (the packs and fees alone for every card that needs it) |

The owner's max bid (Zeus 47,000) still binds first, so an Epic or a Legendary is limited by it; the daily cap, the
monthly budget, the third-bid refusal and the inherited-lock refusal are unchanged. What the formula leaves out: the
wallet's limits (2 Common packs a week, one fusion every 20 hours) and the value of the matches as play (XP and ELO).

## Limits per rarity and the market price, 2026-10-23

The owner's direction: never pay more than the market. The 1,217 sales since mainnet (30 September to 23 October,
public at `/api/marketplace/recent-sales`) put a typical Rare at about 6,100 FOXSY, an Epic at 11,800 and a
Legendary at 31,200, measured as the median of the daily median sale prices of the last 30 days, so the sell-off of
13 October (about 170 cards that day at a third of the usual price) counts as one day. The build-cost ceiling of PR
#20 (Rare 14,450) sat well above that. The owner chose round limits from the market as defaults any owner may raise.
Test first: `test/rarity-bid-caps.test.ts`, each test seen failing before the change.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| M1 | design | Nothing held a bid to the market: the ceiling was the build cost, the only owner limit the max bid | Three settings, `maxBidRareFoxsy` 6,000, `maxBidEpicFoxsy` 12,000, `maxBidLegendaryFoxsy` 32,000 by default (agents made before them get the defaults); the bid rule refuses above the limit of the card's rarity, under the max bid and the build cost. They are limits like the others: raising one asks for the owner's password, lowering it does not, and choosing a level leaves them as they are |
| M2 | design | The plan judged a fair price only from the floors and the open listings, never from what cards really sold for | The planning snapshot keeps every public sale (`market_sales`, 120 days) and reads only the new pages, then gives each rarity its market price: the median of the daily median prices over 30 days with at least 5 trading days, else 60, else 90; with fewer, none (shown as unknown, never a guess). The plan sees the prices and each auction's, and is told to aim below them; the dashboard shows today's next to the limits. A failed read leaves the kept sales and a warning |
| R21A-1 | medium | Agent review of PR #21: a card whose rarity could not be read skipped both its limit and the build cost, so a Legendary could be bid up to the max bid | A bid on a card of unknown rarity (none read, or not one of the five) is refused: not bidding blind |
| R21A-2 | medium | Agent review of PR #21: the sales reader stopped at the first page holding a known sale, so a first read cut short (a failed page, offsets shifted by new sales) left the older sales unread for good | Until a first read has gone back to the end of the list (or 120 days), every plan reads it all (kv `market_sales_complete`); after it, a page whose oldest sale is kept ends the read |
| R21A-4 | medium | Re-review of PR #21: past 2,000 sales in 120 days (about 7 November 2026 at 53 a day), a first read filled its 20 pages without ever reaching the end or 120 days, so it never counted as complete and every plan of every agent read 20 pages again. An answer that was not a list counted as the end of the list | 20 full pages read without an error complete the first read (the newest 2,000 sales, over a month); an answer that is not a list is a failed read (a warning, the kept sales stay) |
| R21A-5 | low | Re-review of PR #21: the known-rarity check used `in`, which follows the prototype chain, so a rarity answered as `toString`, `constructor` or `__proto__` passed it and no limit per rarity applied | `Object.hasOwn` in the bid rule and in the build cost; the test tries those names |
| R21A-6 | low | Re-review of PR #21: after the first read, a catch-up cut short (over 100 new sales between two plans, then a failed page) left a gap the next plan never filled, as page 0's oldest row was kept by then | A failed page after page 0 marks the read incomplete again (`markSalesIncomplete`), so the next plan reads on past the kept sales |
| R21A-7 | low | Fifth review of PR #21, fixed in the next PR: the digest looked up an auction's market price through the prototype chain, so a listing of rarity `toString` or `constructor` threw and stopped the digest (no plan, so no spend) | `Object.hasOwn` in the digest; a test renders such listings |
| R22A-1 | medium | Agent review of PR #22 (display only): the market line under each limit per rarity left Max bid out, though the bid rule checks it first, so a Max bid of 0 (steady, climber) or under the limit (hunter's 4,000 for a Rare) still showed green | The line judges whichever limit binds: Max bid 0 says bids are off; a lower Max bid colours it and is named, with no button when the line is amber (the field for the rarity would not help; when red, the button still lowers it); it is drawn again when Max bid changes. Also the import test's random words: one word alone could appear in its error message by chance (about once in 300 runs, seen once in CI); it now checks two words in a row |
| R22A-2 | low | Review of PR #22 (display only), fixed in the next PR: applying a level sets Max bid from code, which fires no input event, so the market lines kept the old Max bid until a field was edited; and the settings page did not say what a Max bid of 0 or under the limit shows | `fillLevel` draws the lines again; the settings page names both messages |
| R21A-3 | low | Agent review of PR #21 (docs): three texts still said the max bid is usually the limit for an Epic or a Legendary | They say the limits per rarity usually bind first |

The market price guides; the owner's limits, the build cost and the max bid bind. Nothing else changed: the daily
cap, the monthly budget, the third-bid refusal and the inherited-lock refusal hold as before. Open: a price per card
quality (Legendaries sell for two to six times more at a higher rating) waits for enough sales.

## Audit of PRs #15 to #23, 2026-10-23

The owner's method: five read-only reviewers (Claude Fable 5.1, max effort) on main aae6935, one area each (A money
and limits; B data, caches and what reaches the prompt; C FoxLeague's changes from 2026-10-15 to 2026-10-23; D play
quality against 48 hours of the ten live agents' activity; E docs, dashboard and tests). Every finding came with a
proof test that failed on aae6935; none was a phantom. The fixes were made by Claude Opus 5.5 (extra high), test first:
`test/audit-money-data.test.ts`, `test/audit-play.test.ts`, `test/limit-hints.test.ts` (E3), each seen failing before
its fix. The game knowledge was synced to FoxLeague's manual of 2026-10-23 (565a902de) in the same round, and
FoxLeague's changes are in `docs/FOXLEAGUE-INTEGRATION.md` section 21 and `docs/ECONOMY-AND-RULES.md` section 19.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| D1 | high | A plan's actions ran at random moments over 80 percent of the tick, 30 s apart, so several casual or ranked matches collided with the 15-minute ranked cooldown and a match still running, and a refused action is never retried: 37 percent of play_match attempts refused in 48 h | `scheduleActions` (service.ts) keeps 11 min after any casual or ranked start and 16 min between ranked starts, counting the agent's last starts before the plan (`lastMatchStarts`, the helper the play_match check reads); later actions move back, a match that no longer fits is dropped with an info line, and before each match the start waits for the real gate (up to 2 min past the window) |
| D2 | high | The plan never saw the per-rival 1v1 count of the last 7 days, nor the rivals the owner's other agents held: 22 + 5 challenges refused in 48 h | `src/executor/rivals.ts` (`oneVOnesThisWeek`, `rivalsOutByOthers`, `weeklyFreeAt`) is read by the executor and the plan request alike, with one claim test (`claimBars`); the teams to challenge say "N of 2 1v1s against it this week (the limit), free again <date> UTC", and a rival another of the owner's agents holds shows only as "not available now" |
| D3 | high | Open tournaments showed only seated/max while the Zeus join rule judged the seated field at execution: 7 of 12 joins refused | Planning snapshots read the field of up to 4 open Silver or Gold tournaments the agent could join (16 seats each, 20-minute caches); the digest shows "field: N clearly stronger, N even, N clearly weaker, N unknown"; one helper (`judgeField`) serves the rule and the line |
| D4 | high | The schedule check used the squad's condition now, so a tournament days away was refused as if it started tonight (T2221 watched in 242 plans) | `conditionAtStart`: each card at the start is today's condition plus regeneration until then (half after age 30, at most 100), less an even share of what its matches owed to other tournaments before then cost; an unreadable or past start stays at today's; the system prompt says so |
| D5 | medium | The Zeus field test compared rivals at full condition with our eleven at today's condition, even for a start days away | For a tournament our eleven is taken at the start (`conditionAtStart`); a 1v1 stays at today's condition |
| D6 | low | Per-stat XP pools were read but never shown | Squad lines show a pool of 1,500 to 1,999 below the cap, e.g. `vis 20 (1990/2000)` |
| D7 | medium | parseAction dropped a sync's card nonce, so the 10 FOXSY one-card sync was out of reach (agents skipped useful syncs priced at about 180) | parseAction keeps an optional, validated nonce; the catalogue offers `{"type":"sync","nonce":N}` |
| D8 | medium | home_and_away and the round interval were unknown to the plan though the executor counts on them | Open tournament lines show "home and away (2 x (N-1) matches)" and "rounds every N min"; the create catalogue names `"home_and_away":true` for a round robin |
| D9 | medium | The XP booster (2,000 FOXSY) could be bought with no fixture of the agent's own; on 2026-10-23 a seat came back and left a booster with nothing to double | FoxLeague doubles the XP when a result is applied (`apply_match_results`, a purchase within the last 24 h), so buying once the fixture exists loses nothing: at the Zeus level a booster needs a Silver, Gold or 1v1 match of the agent's own (upcoming, locked or live) kicking off within 24 h; an unreadable fixture list refuses |
| D10 | medium | A target with its own open 1v1 cannot accept ours; the list did not say so | The entry says "has a 1v1 out until <deadline> UTC: cannot accept yours before" |
| A1 | low | A 1v1 that ended in an error before any FoxLeague call (a deploy, the kill switch or a pause before the signature) kept its rival claim and wrote an error row the rival check counted for up to 5 hours | The executor marks when FoxLeague is asked; an error before that releases the claim and its row says `untouched`, which the rival check and the open-challenge count skip |
| A2 | low | The rival check read the rows of the active agents only: after a restart a retired or removed team's 1v1 still out was ignored | It reads every agent row (`Store.agentIndexes`) |
| A3/B3 | low | The buying power line counted all the EGLD above the reserve as FOXSY and today's play room as swap room, while the executor holds swaps to their own daily and monthly allowances | The budget view carries what was swapped today and this month and what the allowances leave; the line counts the EGLD only up to that and says what was swapped |
| B1 | low | The pooled formation record knew the owner's teams only by their own recent rows, so a match against a retired or paused team of the owner could count | It also leaves out every user id the store keeps (`agent_user_id:N`) |
| B2 | low | A failed read of the agent's own match history also hid the pooled record | The pool reaches every planning snapshot with a profile |
| B-P1 | low | FoxLeague rebuilds a ranked or casual match's lineups in its statistics at read time from the cards' current stats and condition (tournament and 1v1 matches keep the lock snapshot), so a ranked match read days later put today's squads into its strength band | The read time is kept with the cached facts; a ranked or casual edge counts only from statistics read within 6 hours of the match's end; `formation_results` is emptied once (kv `formation_results_rebuilt_2026_10_23`) and rebuilt under the rule |
| C1 | low | FoxLeague sells a Legendary's match waiver (for its listing gate since 2026-10-16); the agent refused it as wasted | A Legendary's match waiver asks what list_card asks of the card (outside the lineup and bench, 18 cards left, not among the 18 strongest); the max shop payment and the exactly-the-missing-matches rule hold; the prompt says so |
| C2 | low | FoxLeague holds a Play up to 30 s for a match slot; the agent gave up after 20 s and logged an error for a match that may have started | `playMatch` waits 95 s; an answer lost on the way reads the active match back |
| C4 | low | The slot estimate had no league_knockout arm (108 minutes for 36 teams where FoxLeague counts 570) | The arm is added: (max_teams x 8 / 2 + 46) x 3 |
| E1 | low | The settings page and R22A-1 said the market line has no button whenever Max bid binds; in red it still offers one | Both say the button is left out only when the line is amber |
| E2 | medium | `test/formations.test.ts` hard-coded a match date that leaves the pool's 14-day window on 2026-11-03 and would turn CI red | Its matches end an hour before the test runs; an audit test runs the file under a clock of 2026-11-10 |
| E3 | low | The test that the market lines are drawn on load matched the Use button's own call and passed with the load call removed | It reads `fillForm` itself |
| E4 | low | README and the FAQ still said the agents know nothing of each other | They name the two things the agents share, as the safety page does |
| R24A-1 | medium | Agent review of PR #24: `conditionAtStart` capped at 100 only after taking off the matches owed before the start, so regeneration wasted at the cap paid for them (a squad at 90 with 7 matches ending an hour before a start in 24 h projected about 95, really about 59) and the forfeit guard and the Zeus field test judged too kindly | The squad rests (capped) up to the end of the earlier tournaments' matches, pays for them, then rests (capped) to the start (`otherMatches` returns that end); `test/audit-review24.test.ts` |
| R24A-2 | low | Agent review of PR #24: a match the scheduler drops from an owner's request was only an info row, where the executor's refusal used to reach the owner | The owner hears of it (Telegram), both when the plan is laid out and when the gate is read again just before the match (re-review); routine plans keep the info row |
| R24A-3 | low | Agent review of PR #24 (coverage): the `untouched` paths of a paid join had no test | A test: a broadcast definitely refused for an unknown transaction is untouched; an unclear send error is not and stays counted (a broken reset makes it fail) |

Left to the owner's decision: C3, reading League + Knockout invitations to tell the owner (never joining the format,
which stays refused); D11, counting only accepted 1v1s toward the weekly limit per rival. Both accepted and built on
2026-10-24 (section C3 and D11 below). The reviewers' proposals
(order of play, recovery before key matches, skipping the model call on empty plans, teams to invite for private
cups) wait for the owner as well.

Open: A1 rows logged before this change keep counting for the rest of their window; within the 6 hours a ranked edge
still uses the condition at read time; FoxLeague cancelling a Play whose client dropped is not verified; "kickoff
within 24 h" stands in for "result applied within 24 h of the purchase"; the D4 projection spreads earlier matches'
cost evenly and ignores casual, ranked and training before the start; D1 spaces casual and ranked starts only; D10
sees a rival's open challenge, not one it already plays; the join gas follows FoxLeague's 8,400,000 since the
contract's mainnet upgrade (section below, 2026-10-24); a seat paid while the contract is paused by its hot-key alarm
reverts (gas only). The F4 open items are corrected by B1 and B-P1.

## One team per card at auction, 2026-10-23

A finding from the live agents' first plans after the audit's deploy: agents 3 and 4 planned the same bid (1,456
FOXSY on #6226) in the same minute. Whichever bid second had to beat the first, so on a later plan the owner could
have paid more for one card by bidding against their own bid, and nothing stopped an agent from buying a card another of
the owner's teams had listed (the 10 percent sale fee to move a card between the owner's wallets, which agents never
do otherwise). The owner asked for the same rule as one challenger per rival. Test first:
`test/sibling-bids.test.ts`, each test seen failing before the fix (the release test passes without the rule and was
seen failing with the release removed).

| Id | Severity | Finding | Fix |
|---|---|---|---|
| SB1 | low | Two of the owner's agents could bid on the same card at auction, the second raising the price against the first | The bid rule refuses a card another of the owner's teams leads on chain (`highestBidder`) or has bid on in the last 48 hours (its log rows in the same ledger, a bid that errored after its signature too; a refused, reverted or unsigned one placed nothing), retired and removed teams included (`cardsBidByOthers`, `store.agentAddresses`). The shared executor claims the card in the same synchronous step as the check, until its auction ends (at least an hour), as for rivals (R19A-1); a bid that placed nothing releases it, and a dry-run claim does not hold a live agent off |
| SB2 | low | An agent could bid on a card another of the owner's teams sells | Refused: buying it would only move it between the owner's wallets and pay the 10 percent fee |
| SB3 | design | The plan did not know which cards were taken | The plan request marks those auctions "not available now", from the same helpers and claims, with no reason given and no team named; `src/strategist/prompt.ts` is unchanged (the prompt cache holds) |
| R25A-1 | low | Agent review of PR #25 (docs): INSTALL.md and the update page still said two agents may bid on the same card, and that the agents know nothing of each other | Both name the three things the agents share; a test reads every owner-facing page for the old wording |

No cap or limit changed and the rule only adds refusals. The README, the install guide, the FAQ, the update page and
the safety page name the third thing the agents share. Open: a card another team of the owner's bid on stays taken for 48 hours after that bid even when
the team was outbid or the card was listed again (it only refuses more); a team the owner runs from another install is
not in this install's table and is not seen.

## Limits for a Common and an Uncommon, 2026-10-24

The owner asked why agents bid on Commons when a Common pack gives 5 cards for 2,500 FOXSY. None had: the six bids of
the last three days were on five Uncommons (1,000 to 1,456) and a Rare (2,800). A Common could still go up to its build
cost (600), and an Uncommon up to 2,200, with no limit of the owner's below Rare. The owner set Common 500 (a pack
card's price, also the lowest listing price) and Uncommon 1,500 (about a third above its market price of 1,133 over
30 days, under the 1,600 it costs to build) as defaults, next to Rare 6,000, Epic 12,000 and Legendary 32,000. Test
first: `test/limits-common-uncommon.test.ts`, each test seen failing before the change.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| LC1 | design | No owner's limit for a bid on a Common or an Uncommon: only the build cost (600 and 2,200) and Max bid held | `maxBidCommonFoxsy` (500) and `maxBidUncommonFoxsy` (1,500) in the settings, validated 0 to 1,000,000; `rarityBidLimit` covers all five rarities; both are in `LIMITS` on the server and the dashboard, so raising one asks for the password and lowering it does not; an agent made before them gets the defaults |
| LC2 | design | The plan saw the limits and market prices of Rare, Epic and Legendary only | The plan request lists all five limits and the digest all five market prices |
| LC3 | low | The build-cost refusal read "a Epic", "a Uncommon" | It uses `aRarity`, as the other refusals do |
| R26A-1 | low | Agent review of PR #26: the plan saw all five limits but the build cost of Rare, Epic and Legendary only, so with a raised Uncommon (above 2,200) or Common (above 600) limit it could propose a bid the build-cost rule refuses (a wasted action, nothing signed) | The plan request lists the build cost of all five rarities |

The dashboard has both fields with their info bubbles and the coloured market line; the settings page and the strategy
levels page list the five limits. The rule only adds refusals: no other cap changed. Open: none.

## Bids per level and a manual without testing dates, 2026-10-24

The owner read the strategy levels page. Its tables matched the code, but the levels' max bids (4,000, 15,000, 40,000
and 47,000) no longer followed the limits per rarity, the hunter, predator and beast texts still said never to bid on a
Common or an Uncommon, and the manual, README and the dashboard's info bubbles told prices and events of our testing
("the round market price of October 2026", auction start prices, "a whole-project review on 13 October 2026", "the
review of the xExchange pause", "since 12 October"). The owner also wanted room to be outbid once and bid again. A bid
stops at the lowest of Max bid, its rarity's limit and the build cost, so that room has to be in the limits per rarity.
Test first: `test/levels-bids-manual.test.ts`, each test seen failing before the change (the tables test passed before
and failed once the code moved, until the page followed).

| Id | Severity | Finding | Fix |
|---|---|---|---|
| LB1 | design | The limits per rarity sat at the market price, leaving no room for a second bid after being outbid (an agent bids at most twice on one auction, 5 percent over the top each time) | Rare 7,000, Epic 14,000, Legendary 38,000 by default, about 20 percent over the market prices they were set from (5,650, 11,828, 31,240); Common 500 and Uncommon 1,500 stay. A saved limit wins over a default: an agent that never saved its limits gets the new ones at once (the owner's 10 live agents had saved none), an agent that saved its limits keeps them (the lower ones), and raising one by hand asks for the password |
| LB2 | design | The levels' max bids did not follow the limits per rarity | Each level's max bid is the limit of the dearest rarity it buys: hunter 1,500 (Uncommon), predator 7,000 (Rare), beast 14,000 (Epic), Zeus 38,000 (Legendary); each fits its daily cap at a FOXSY price of $0.0027. An agent keeps its saved max bid until its level is picked again |
| LB3 | low | The hunter, predator and beast texts said never to bid on a Common or an Uncommon (packs and fusion make those), though an Uncommon at auction costs less than building one | Each names the rarities it buys: hunter Commons and Uncommons, predator up to Rares, beast up to Epics, below the market price of their rarity. An agent keeps its text until its level is picked again |
| LB4 | low | The manual, README and the dashboard's info bubbles told dated prices and events of our testing | Written in general, with examples; a test reads every manual page, README, INSTALL.md and the info bubbles for a dated month, a day and month, the xExchange pause, the sell-off and "what agents spent" |
| LB5 | low | Nothing tied the manual's level tables to the code | A test compares every money row, the max bid rows, the tick and the recommended AI of the tables, and the settings page's five limits, with the code |
| R27A-1 | medium | Agent review of PR #27: LB1 and the PR said every agent on the defaults got the new limits at once, but an agent saves its whole settings (at creation since PR #21, and on every save), and a saved limit wins over a default | The record says which agents get them: one that never saved its limits gets the new ones, an agent that saved its limits keeps them; no stored value is raised (that would raise a cap without the password). A test shows both |
| R27A-2 | low | Agent review of PR #27: the dashboard's Strategy bubble still said a hunter bids on Rare, Epic and Legendary players, never Common or Uncommon | It names the rarities each level buys, as the texts do; a test reads every bubble and manual page for the old rule |
| R27A-3 | medium | Re-review of PR #27: the plan saw only the 15 strongest open auctions, and stats are capped per rarity, so with 15 stronger cards listed a hunter (Commons and Uncommons) had nothing to bid on (it fails toward not spending) | The snapshot also reads the listings sorted by price (one more read, limit 200) and the plan sees the 10 strongest, then the 3 cheapest of each rarity not among them, never our own (`auctionsShown`); a failed read leaves the other list. A test shows the cheapest Commons and Uncommons reach the plan |
| R27A-4 | low | Re-review of PR #27 (coverage): no test called `auctionsShown` with a failed read on either side | A test: the strongest list stands without the cheapest, the cheapest without the strongest (seen failing on a version that drops both) |

The internal records (this file, `docs/ECONOMY-AND-RULES.md`, `docs/FOXLEAGUE-INTEGRATION.md`) keep their dates: they
are the history. Unchanged: the agent's own lowest reserves for selling a card (`MIN_RESERVE_FOXSY`: Common 500,
Uncommon 1,500, Rare 4,000, Epic 10,000, Legendary 25,000). Open: none.

## The manual against the code, 2026-10-24

The owner asked that the manual be one to one with the deployed code, so a user knows from it exactly how the software
behaves. Three read-only reviewers read every manual page, README, INSTALL.md and the dashboard's info bubbles against
the code and checked every number; they found 31 points, all confirmed here. Test first: `test/manual-sync.test.ts`, one
test per group, each seen failing before the fix; where a number lives in the code (the field reads, the market
windows, the ranked cooldown, the previous plan's length, the Zeus tick) the test reads it from there.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| MS-C1 | medium | The AI cost said $0.20 to $0.50 a day per agent. The game manual is cached for an hour, and a single agent at the 2-hour tick finds it expired at every plan: measured on the server, a plan with the cache costs $0.08 on Opus 5.5 and $0.55 without, so about $0.05 and $0.28 on Sonnet 5, about $2 a day for one agent | Costs, Keys, INSTALL.md, README and the Getting started guide give about $2 a day for a single agent at the defaults (about $0.30 a plan) and about $0.40 a day each with three or more agents sharing the cache. Whether to change the cache or the default tick for a single agent is the owner's decision |
| MS-B3 | low | `/tick` and Plan now answered "started" outside the active hours (and while paused or busy), when nothing ran | `tickRefusal` holds the tick's own checks; both ask it first and answer the reason (Telegram adds that `/do N request` runs outside the hours; the dashboard shows it as an error) |
| MS-C2 | low | The server guide's first step, `deploy/bootstrap.sh`, read the service file from `/opt/foxleague-agent/app`, which exists only after the first deploy, and stopped with an error | It reads the file from its own folder, the repository copied to the server, as the guide says |
| MS-A1..A13 | low | How it plays, Strategy levels, Safety and the home page: every tournament's field read (4, up to 16 seats), a win chance for every team (the challenge list, up to 10), the 30-day market price (60 or 90 days when thin), the level proposal (both ways), open challenges at Zeus (never), the ranked cooldown (15, spaced 16), a preparation before every match (each session), "under" (at or under), the XP pools (within 500 XP), the random window (a shift either way), the previous plan in full (up to 2,000 characters), what needs the password (also the tick, hours, Gold, reserve) and going live (also the machine's permission) | Each page says what the code does |
| MS-B1..B10 | low | Settings, Dashboard, Talk to your manager and the info bubbles: the Zeus tick (60), `/topup` with an amount (less only), `/tick` (inside the active hours), the preparation per session, the top-up proposal (needs Telegram and LIVE, once a day), what needs the password, the level proposal's rows (no limits per rarity) and both directions, the Silver steps, a match dropped from a plan and the 12-action cap | Each page and bubble says what the code does |
| MS-C3..C8 | low | Server, FAQ, Update, INSTALL.md, Costs, Troubleshooting, Keys: the server's processor (x86-64), the fourth thing the agents share (a private tournament never invites your other teams), the low-funds warning on Telegram (in the morning summary), a quiet Telegram (the default), the Binance key (it reads too) and the top-up amount (less, the fee comes off it) | Each page says what the code does |
| R28A-1 | low | Agent review of PR #28: the Costs page still said a Binance key alone brings a top-up proposal | It names Telegram and LIVE and once a day per agent, as the other pages do; the test reads the Costs page too |

Not changed then: the Telegram key fields kept Telegram's own name, "bot token". Changed on 15 Nov 2026 (NO-BOT, the
owner's rule that no text a user reads says "bot"): the field is "Telegram token" and the account is "your agent's
Telegram account"; only Telegram's username rule is quoted (`test/no-word-bot.test.ts`). The cost of a single agent
at the 2-hour tick (MS-C1) is closed by CR1 below.

## The game manual cached only when it is read again, 2026-10-24

The owner chose option 1 of MS-C1: the game manual (about 61,000 tokens) is cached for an hour, a one-hour cache
write costs twice the input and a read a tenth, and a single agent at the 2-hour tick paid the write on every plan.
Test first: `test/cache-when-reused.test.ts`, each test seen failing before the change (the CLI's default, which keeps
caching, passed before and stays as a guard).

| Id | Severity | Finding | Fix |
|---|---|---|---|
| CR1 | design | A single agent at the 2-hour tick wrote the one-hour cache of the game manual on every plan (about $0.28 a plan on Sonnet 5, about $2 a day) and never read it | The manual carries the cache breakpoint only when the cache is warm (served or stored in the last 55 minutes, per model and effort) or the service's schedule has another call due within 55 minutes: an active agent's next tick (not paused, not waiting for funds, inside its active hours; the planning agent's own next one cycle on). Otherwise it goes uncached at the plain price: about $0.15 a plan, about $1 a day for one agent. Several agents keep the cache as before. Erring towards no cache costs at most the plain price twice; the CLI keeps caching |
| CR2 | low | The manual's Costs page, Keys, INSTALL.md, README and the Getting started guide gave the cost of the old caching | They give about $1 a day for a single agent and about $0.40 a day each with three or more agents |
| R29A-1 | low | Agent review of PR #29: an agent planning now was taken to plan again one shortest cycle on, but its next tick is set only after its plan's actions ran (up to 0.8 of its tick), so a lone Zeus agent (60 minutes) still wrote the cache on every plan | Its next counts from its plan window plus one shortest cycle; a test shows a lone Zeus agent sends the manual uncached |
| R29A-2 | low | Agent review of PR #29: the warm window counted from the end of the answer, but the cache is written when the request is processed; a long answer moved it past the real expiry | It counts from when the request was sent |

The prompt and manual bytes are unchanged, so the cache stays shared by all agents, ticks, chat and /ask. Open: a
preparation tick before a match session can come sooner than the planning agent's next cycle and is not counted (at
most a plain-price send where a cache read would have done).

## C3 and D11, decided by the owner, 2026-10-24

The audit of 2026-10-23 left two points to the owner's decision; the owner accepted both. Test first:
`test/c3-d11.test.ts`, each test seen failing before the change (the test that the agent still never joins the format
passed before and stays as a guard).

| Id | Severity | Finding | Fix |
|---|---|---|---|
| C3 | design | The agent refuses FoxLeague's League + Knockout format, and the owner never heard of an invitation to it | While FoxLeague has the format on (`league_knockout_enabled`) and the team is registered, each tick reads `GET /api/tournaments/invitations` with the team's login; each pending invitation not yet expired reaches the owner once, and once more if it becomes acceptable after a refusal: on Telegram at once the tournament, its title (shortened, one line), tier, entry fee, until when and, when FoxLeague says it cannot be accepted, why; the activity row, which the next plan reads, holds only our own values (no title, no refusal text). The agent still never joins the format. A failed read is quiet; the next tick reads again |
| D11 | design | A 1v1 nobody accepted counted toward the 2 a week against the same rival, so an unanswered challenge used a slot | `oneVOnesThisWeek` skips a 1v1 whose stake came back (`join:<tournament>:refunded` with the same transaction hash: FoxLeague cancelled it unaccepted, the agent closed it, or it never seated). One still open, played or unknown counts; dry run, which has no refunds, counts every 1v1 as before. The plan request reads the same count |
| R30A-1 | medium | Agent review of PR #30 (rule 6): the activity row held the invitation's title and FoxLeague's refusal (which can quote a title players wrote), and the next plan reads recent activity outside the framed snapshot | The activity row is built from our own values (tournament id, tier checked as a plain word, fee, until when); the title and the refusal go to Telegram only. A test renders the plan request and finds neither |
| R30A-2 | low | Agent review of PR #30: an invitation first read as not acceptable was never told again once it became acceptable | The told key carries the state: a refused invitation that turns acceptable is told once more |

The weekly limit is the agent's own rule against farming, not FoxLeague's. Open: a refund is credited at the start of
the next tick, so until then the cancelled 1v1 still counts (the stricter side).

## Champions FoxLeague (League + Knockout): the agent accepts invitations, 2026-10-24

The owner decided that the agent accepts a League + Knockout invitation by itself, at every level within the owner's
limits, with Zeus requiring a real chance of the knockout (fewer than 24 of the invited teams clearly stronger). FoxLeague
turns the format on about 2026-10-26; only its admin creates one and the first starts at the end of November. The
format's rules were read from FoxLeague's code (next-foxleague 75289fbbf, read only). Test first:
`test/champions-foxleague.test.ts`, each test seen failing before the change (the file did not load without
`scheduleSpanMinutes`).

| Id | Severity | Finding | Fix |
|---|---|---|---|
| LK1 | design | The format was refused outright, and `matchesAtMost` counted it as a 35-match league | An invited team may join it; `matchesAtMost` gives 17 (8 league matches, then up to 9 knockout ones) and `scheduleSpanMinutes` its 190 slots (144 league and 46 knockout matches, one per round interval), used by the schedule check and by every other tournament's condition projection |
| LK2 | design | Paying without being on the contract's invite list loses the gas | The executor reads the team's pending invitations again right before the payment: unreadable refuses ("not paying blind"), none refuses, FoxLeague's `can_accept` false refuses (its refusal text, which can quote a title others wrote, stays out of the logged refusal), and the last 30 minutes before `expires_at` refuse |
| LK3 | design | Up to 9 knockout matches come within 46 slots | The schedule check also judges the knockout stretch alone, from the squad's condition at the start: 9 matches x 11 starters x the match loss against the condition above the floor plus 45 slots of recovery |
| LK4 | design | While a League + Knockout runs FoxLeague refuses other standard tournaments (option C), after the seat is paid | The rules refuse joining or creating one while a League + Knockout of the team's has started and is not over (stricter than FoxLeague, which frees a team knocked out); 1v1s and ranked stay open |
| LK5 | design | Leaving closes the invitation for good, and after the seats lock it is refused | The agent never leaves one by itself (only an owner's leave, `byOwner`); it never creates one. Changed the same day by LK8: it may leave before the seats lock |
| LK6 | design | Zeus's top-three rule would refuse nearly every Champions FoxLeague | Zeus judges the invited teams (`GET /api/tournaments/{id}/invitations`, wallets and ELO from the leaderboard, lineups read as for other fields) and refuses with 24 or more clearly stronger, or when stronger plus unread reach 24 |
| LK7 | low | The C3 notice read invitations only while `league_knockout_enabled` was on, but that switch gates only creating one | Every planning snapshot reads the pending invitations; the plan sees them inside the framed snapshot (titles and refusals through `txt()`) and the owner hears of each once, now told that the agent decides within the limits |
| R31F-1 | medium | Fable review of PR #31: the 1v1 busy check knew no League + Knockout and refused every 1v1 for its whole run (days), while FoxLeague keeps 1v1s open (its busy rows count only the team's own fixtures) and the snapshot and the manual said so | `league_knockout` joins the formats busy only through the team's own fixtures; a test: a running one leaves a 1v1 open, its own fixture within the hour makes the team busy |
| R31F-2 | low | Fable review of PR #31: a completed League + Knockout (36 invited seats) lifted the create ceiling to 45 teams | `sizeCeiling` leaves it out: invitation-filled seats say nothing about open demand |
| R31F-3 | low | Fable review of PR #31: the knockout stretch was judged from the condition at the tournament's start, too kind at a short interval | It is judged from the condition after the league phase: rested over its slots (at most 100), less an even share of its 8 matches; a test refuses an old squad (half the regeneration) at 30 minutes and allows a young one |
| R31A-1 | medium | Agent review of PR #31: an empty invited field, or rows in states the code does not know, let Zeus accept a field it never judged (rule 4) | Declined and expired rows are left out, invited and accepted are judged, any other state counts as unread, and an empty field is unread (refused); executor tests through the invitations view and the leaderboard, both failing too |
| R31A-2 | low | Agent review and Fable review of PR #31: comments still said the agent never joins the format | Reworded |
| R31A-3 | low | Re-review of PR #31 (test): no executor test showed Zeus refusing a strong field read from the leaderboard | A test: 30 invited teams at ELO 3000 with strong lineups are refused as clearly stronger, expired and declined rows left out (seen failing with the ELO lookup broken) |

A League + Knockout leaves the open tournaments list (invitation only). The paid invitation endpoints are on FoxLeague's
testnet only until its mainnet tournaments contract is upgraded (it was, on 2026-10-24); Bronze editions need no contract. Open: a team knocked
out early stays barred from other tournaments until the whole tournament ends (the stricter side); FoxLeague's
refusal after a paid join can quote a title others wrote and reaches the next plan sanitised through recent activity
(as every FoxLeague error today); the first play-off
locks may come late (seats fill from aired results); FoxLeague's manual page for the format is synced when published.

## Champions FoxLeague: leaving before the seats lock, 2026-10-24

The owner decided that the agent may leave a League + Knockout it joined early once it sees no real chance of the top
24, as long as leaving costs nothing: before the seats lock, FoxLeague refunds the whole entry (next-foxleague
`routes/tournaments.rs:7201-7216`, `chain.rs:9161-9170`); from the lock on it refuses any leave
(`league_invitations.rs:1167-1175`). Test first: four tests in `test/champions-foxleague.test.ts`, each seen failing
before the change.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| LK8 | design | LK5 kept every League + Knockout seat until the end, even one the agent judged hopeless while leaving was still free | The agent may leave before the seats lock: the executor reads `seats_lock_at` from the invitations view right before the leave; unreadable refuses (leaving closes the invitation for good), within 30 minutes of the lock or after it refuses. The plan sees, for each League + Knockout seat not started, how many seats are taken and when they lock. The owner may leave as before |
| R31A-4 | low | Re-review of PR #31 (test): the expired rows could not change the Zeus test's outcome | 24 expired rows sit next to the 25 declined ones, so dropping either state from the field filter refuses |
| R32A-1 | medium | Agent review of PR #32: the agent could leave a seat the owner accepted in FoxLeague, closing the owner's invitation for good | It leaves only a seat it paid itself (its own join in its log, a paid one whose answer was lost too); one the owner took is refused ("only the owner leaves it") |
| R32A-2 | low | Agent review of PR #32: the plan was never told the owner's condition for leaving | Its seat line says to leave only a seat it joined itself, only with no real chance of the top 24, and that leaving closes the invitation for good |
| R32A-3 | low | Agent review of PR #32 (test): nothing tested how the snapshot builds the seat lines | A test: only League + Knockout seats, the lock time and seats taken read, a failed view unknown with a warning |
| R32A-4 | medium | Re-review of PR #32: a join the owner made through Telegram `/do` counted as the agent's own seat, so the agent could still leave a seat the owner chose | An owner's action keeps `byOwner` with its log row; a join with it (or with an owner reason, on rows from before) is the owner's seat, never left by the agent |

Open: whether the agent sees no real chance of the top 24 is the plan's judgement (the code holds only the timing and the
own seat); `seats_lock_at` on `GET /api/tournaments/{id}/invitations` is taken from next-foxleague, not yet seen on
mainnet (if it is missing, every leave by the agent refuses, the safe side).

## The join gas after the tournaments contract upgrade, 2026-10-24

FoxLeague's tournaments contract on mainnet now carries the League + Knockout invitations: `isInviteOnly` and
`getSponsorPrize` answer on chain (read-only queries, 2026-10-24). The larger contract makes every call about 830,000
gas dearer; FoxLeague's app signs a join with 8,400,000, 1.51 times the heaviest join measured (5,550,000,
`frontend/src/lib/gasLimits.ts`). The agent's 7,000,000 left 1.26 times; a join that runs out of gas reverts and loses
its fee. Test first: one test in `test/champions-foxleague.test.ts`, seen failing on 7,000,000.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| JG1 | low | The join's gas limit (7,000,000) had not followed FoxLeague's 8,400,000 after the mainnet upgrade | `GAS.joinTournament` is 8,400,000; unused gas is refunded, so it costs little. The other limits already match FoxLeague's app |
| R32A-5 | low | Re-review of PR #32 (docs): the internal docs did not say the agent leaves only a seat it paid itself | `docs/ECONOMY-AND-RULES.md` and `docs/FOXLEAGUE-INTEGRATION.md` say so |

Open: `claimRefund` keeps 6,500,000, as FoxLeague's app does, on the larger contract (a refund claim that runs out of gas
loses only its gas and can be retried).

## FoxLeague's manual of 2026-10-24 and the OVR range

FoxLeague published its Champions FoxLeague page and an OVR range for tournaments and 1v1s (manual at 688088787, synced
into `src/strategist/manual.md`). The page states the rules the agent already follows. The OVR range is not live on
mainnet yet; the agent is ready for it. Test first: `test/ovr-range.test.ts`, each test seen failing before the change.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| OR1 | design | A tournament or 1v1 can carry an OVR range, checked once at the join against the team's best XI OVR; outside it a paid entry is refunded and the gas lost | The executor reads the best XI OVR (`GET /api/teams/best-xi-ovr`) right before paying into a ranged tournament or 1v1; the rule refuses outside the range and when the value is unreadable; no read without a range |
| OR2 | design | The plan did not see ranges | Each open tournament and challenge shows its range, and the snapshot its best XI OVR |
| R33A-1 | low | Agent review of PR #33 (docs): the integration and economy notes still called the contract upgrade testnet only | They say it is on mainnet since 2026-10-24 |
| R33A-2 | low | Agent review of PR #33: its section had no open line | Added (`claimRefund` at 6,500,000) |
| R34A-1 | medium | Agent review of PR #34: the route is not live on mainnet yet, so the snapshot's best XI OVR read put "best XI OVR: Team not found" in every plan request and kept the dashboard dot off ok | The snapshot's read is quiet when it fails (its value is information only; the rule uses the executor's fresh read) |
| R34A-2 | low | Agent review of PR #34 (rule 4): a range value present but not a number counted as no range | Any value that is not null counts as a range: the executor reads the best XI OVR, and a value that is not a finite number refuses ("an OVR range the agent cannot read") |
| R34A-3 | low | Re-review of PR #34 (docs): `docs/ECONOMY-AND-RULES.md`, a mirror of the game rules, still said no manual page and had no OVR range rule | It names the page, the stricter "out of the edition" rule and the OVR range |

FoxLeague compares the best XI OVR rounded to one decimal (held in tenths, `ovr_range.rs`), the value its route answers,
so the agent's comparison is the same. Open: a team out of a Champions FoxLeague is free again at once in FoxLeague, while the agent waits until the edition
ends (the stricter side; the AI reads FoxLeague's rule in the manual, so it may propose a join the rule refuses).

## Creating with an OVR range, 2026-10-24

FoxLeague switched its OVR range on (the best XI OVR route answers on mainnet), and the owner asked that the agents use
it on what they create. Test first: `test/create-ovr-range.test.ts`, each test seen failing before the change.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| CR-OVR1 | design | The agents could not set an OVR range on a tournament or 1v1 they create, though it keeps stronger teams out of an open challenge | `create_tournament` and `create_challenge` take optional `ovr_min` and `ovr_max` (whole numbers 1 to 100, min <= max), sent in FoxLeague's create body; the prompt describes them |
| CR-OVR2 | design | FoxLeague refuses a creator who takes a seat outside their own range | The rule refuses a range that does not hold the team's best XI OVR, read right before the create; an unreadable value is no range. No read without a range |
| R35A-1 | medium | Agent review of PR #35: a range on a targeted challenge (or a private tournament) could only lock out the chosen team, whose best XI OVR the agent cannot read; the stake would sit unaccepted until the deadline and block other 1v1s | No range on a targeted challenge or a private tournament; the prompt says so |
| R35A-2 | low | Agent review of PR #35 (tests): the tournament body and the executor's fail-closed path had no test | A test: a ranged tournament create carries both bounds (seen failing with them removed), and a failed best XI OVR read refuses before FoxLeague is asked and before anything is booked |
| R35A-3 | low | Agent review of PR #35 (docs): the integration notes still said the agent never sets a range, and the economy notes had no create path | Both say what the agent does |
| CR-OVR3 | design | Owner, 2026-10-24: what the agent creates should carry a range by default | The snapshot suggests one about 10 percent either way around the best XI OVR (whole numbers, 1 to 100) and the prompt makes it the default on open challenges and open tournaments, wider when tournaments filled slowly; the agent decides, the rules are unchanged |

The range only narrows who may join: no cap, booking or signing changes. Open: the open challenge keeps its stake rule
(your lowest Silver amount, once a day) even with a maximum set; loosening it is the owner's call.

## Mainnet of 2026-10-26

The owner upgraded mainnet. Checked read-only: the players contract carries the refundable shop record, the one-signature
1v1 is switched on beside the usual flow, and FoxLeague's one team OVR (the best XI OVR) is on every team and leaderboard
row. Test first: `test/mainnet-2026-10-26.test.ts`, each test seen failing before the change.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| MN1 | low | A shop payment now writes the payer's refundable record (about 8.58M gas); the agent's 12,000,000 left 1.40x where FoxLeague's app signs 12,864,100 | `GAS.shopPay` is 12,864,100 (unused gas is refunded) |
| MN2 | low | FoxLeague dropped `team_overall` from the team answer, so the import preview read 0 | It shows `best_xi_ovr` |
| MN3 | design | The leaderboard now gives every team's best XI OVR (the read the owner asked for) | The plan sees each rival's best XI OVR, and how many leaderboard teams (and how many that accepted a 1v1 in 7 days) its suggested range lets in |

The one-signature 1v1 is not used: the usual flow stays open and costs the same. Open: widening a range when nobody joins
(FoxLeague's #542) is not used yet (done in the next section).

## Widening an OVR range, 2026-10-26

Owner, 2026-10-26: with a range by default (PR #36) an open challenge can sit unaccepted or a tournament unfilled.
FoxLeague lets the creator widen the range while it is open for joining (#542). Test first:
`test/widen-range.test.ts` and `test/mainnet-2026-10-26.test.ts`, each test seen failing before the change.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| WR1 | design | The agent could not widen the range of its own open tournament or challenge when too few joined | A new action `widen_range` (tournament id, `ovr_min` and/or `ovr_max`, a whole number 1 to 100 or `null` to remove that bound; at least one side). Nothing is paid, no transaction, dry run asks nothing |
| WR2 | design | A widen FoxLeague refuses is a wasted call; a narrower range could lock out a seated team | The rules apply FoxLeague's `widen_refusal` on the tournament read right before (a failed read refuses): only the creator, only while open and before the deadline, never on a League + Knockout or a developer tournament, never on a tournament without a range, never narrower, never a new bound, never the same range; an unreadable stored bound refuses |
| WR3 | low | A side left out must keep its bound at FoxLeague (a widen cannot be undone) | The body carries only the sides the plan named; `null` is sent as `null` |
| WR4 | design | The plan did not see which of its own creations carry a range or how full they are | A line per own open creation with a range: the range, seated of seats, the deadline; `/tournaments/my` has no seat count, so it comes from the public list (`?` when neither has it) |
| R38A-1 | medium | Agent review of PR #38: the creator check matched the team, so the agent could widen for good a range the owner set by hand with the same wallet; on a hand-made 1v1 a much stronger team could then take the owner's stake (the same class as R32A-1) | A live create keeps the id it made in its activity row (`createdTournamentId`); the agent widens only one of those (`ownCreations`, `src/executor/rivals.ts`), never one the owner asked for (Telegram /do, or an owner reason) or made in FoxLeague; the owner may widen as before. The plan's line lists only those |
| R38A-2 | low | Agent review of PR #38 (tests): WR2's fail-closed claims had no test; a widen answer that is not an object would log a widen that went through as an error | Tests: a failed read, a stored bound that is not a number and an unregistered team refuse; the answer is read only when it is an object |
| R37A-1 | low | Agent review of PR #37 (tests): the import preview's best XI OVR was tested by a search of the source | A test runs the preview: `best_xi_ovr` shown, the old field when the answer has none |
| R37A-2 | low | Agent review of PR #37 (docs): section 12.1 of the integration notes still gave the shop payment 12,000,000 gas | It gives 12,864,100 and the refundable record; a test reads the section |

Widening only lets more teams in: no cap, booking or signing changes. The integration notes and the economy notes now
also give PR #36's default range. Open: when to widen is the plan's judgment (the prompt says when too few joined to fill
it before the deadline); no code forces or limits how often. A create whose answer was lost, or that broke before its
row was written, keeps no id: the agent cannot widen that one (the safe side). Creations from before this change keep
no id either.

## The agents play alone, 2026-10-27

Owner, 2026-10-27: each agent plays as if it were alone, with no friends. It joins any tournament, takes a 1v1
against any team and bids on any card, whoever of the owner's other teams is in it, sells it or bids on it: if one
agent sells a player another one really needs, that one buys it. The owner keeps the pooled formation record (no team
named). FoxLeague's manual lists selling a card at auction and buying it back with another wallet of yours as a normal
route (anyone can outbid it), and its Fair Play forbids teams coordinated against other managers, which agents that
know nothing of each other cannot be. Test first: `test/agents-alone.test.ts`, each test seen failing before the
change.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| AL1 | design | One team per card (SB1 to SB3, 2026-10-23): an agent was refused a card another of the owner's teams sold, led or had bid on, and the plan saw it "not available now" | Removed: the bid rule, the executor's bid claims, `cardsBidByOthers` and the plan's marker. Two of the owner's agents may bid on the same card, and one may buy a card another sells (the 10 percent sale fee goes to FoxLeague) |
| AL2 | design | One of the owner's teams at a time per rival (C1, R19A-1, A1 and A2 of 2026-10-23): a 1v1 was refused while another of the owner's agents had one out against that rival | Removed: the refusal, the executor's rival claims, `rivalsOutByOthers` and the plan's marker. The agent's own limit per rival (two played 1v1s in 7 days) stays |
| AL3 | design | A Zeus private tournament left the owner's own teams out of its invites without a word (2026-10-10) | Removed: FoxLeague gets the plan's invite list. The agents still do not know which teams are the owner's |
| AL4 | low | Refusals of the removed rules stay in an agent's recent history and would keep steering its plans | The plan's "Earlier entries" note also matches "another of your owner's teams" and says the rules were removed (the first on 2026-09-30, the last on 2026-10-27) |
| AL5 | low | Docs: the README, the install guide, the FAQ, the update page, the safety page, the play page and the levels page described the removed rules | Each says the agent plays as if it were alone and that the one thing they share is the pooled formation record; a test reads every page |
| R39A-1 | low | Agent review of PR #39 (docs): the levels page still said no level ever moves cards between wallets, while one agent may now buy at auction a card another of the owner's agents listed | The page says no level sends a card straight from one wallet to another, and that buying at auction is not such a transfer. The Beast and Zeus presets keep "Never move cards between wallets" (since 2026-10-04): it means that transfer, which no action can make, and the agent cannot tell which wallets are the owner's |

No cap, budget, booking or signing changes: each agent stays within its own caps and limits, and the change only
removes refusals. The FoxLeague user ids the service notes (`agent_user_id:N`) now serve only the pooled record and
the refund checks. Open: two of the owner's agents may bid against each other on a card someone else sells and push
its price up, each within its own limits per rarity and its Max bid; a rival may face several of the owner's teams at
once, as on 2026-10-23 when three challenges went to one team and two of the stakes could only wait out their
deadlines.

## Where the limits live

`src/executor/rules.ts` (the constants at the top: `MAX_1V1_ELO_GAP`, `MAX_1V1_PER_OPPONENT_WEEK`,
`MAX_BIDS_PER_AUCTION`, `MAX_INHERITED_LOCK_HOURS`, `MIN_RESERVE_FOXSY`, `CORE_CARDS`, `XP_BOOSTER_RENEW_HOURS`), `src/executor/executor.ts`
(per-agent lock, booking before signing, swap allowance, price valuation), `src/executor/tx.ts` (`syncTx`),
`src/chain/gateway.ts` (EGLD price band), `src/snapshot/digest.ts` (`txt`), `src/telegram/telegram.ts`,
`src/web/server.ts` and `src/web/auth.ts`.

## FoxLeague rc.78 and the live K values, 2026-10-31

Checked against FoxLeague v1.0.0-rc.78 (`0931413e8`) and the live `/api/config`. FoxLeague #566 made the server keep the position rule and refuse a formation saved alone when the saved eleven does not fit it, so the agent's two saves (formation first, lineup after) were refused on mainnet: agent 6 on 2026-10-30 and 2026-10-31, and no change of lines went through after 2026-10-29.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| R78-1 | medium | `set_formation` with a lineup sent `POST /api/teams/formation` first; since rc.78 FoxLeague refuses that when the saved eleven does not fit, so a change of lines could not be saved at all. Nothing was paid; the team kept its old formation. | One save: `POST /api/teams/lineup` with `formation`. A refusal changed nothing, so the old put-back is gone; a timeout is still read back. Between formations of the same lines the formation still goes alone. |
| R78-2 | low | The prompt priced ranked ELO at K 24 and tournaments at K 12 and 18. Mainnet runs 9, 13 and 17 since 2026-10-30 20:15 UTC, so ranked looked like the largest ELO swing when it is now the smallest. | Prompt and docs state the live values and say the manual may lag: FoxLeague's main still printed the old K until its next promotion. |
| R78-3 | low | The manual was behind (4e42b94c9). | Synced to 4f82e988f. The prompt states the line-by-line auto-substitution at the lock. |
| R78-4 | low | The Zeus strategy text still said ranked moves ELO the most at K 24 (agent review of PR #40). All 10 live agents run Zeus, so their saved text says so until it is replaced. | The preset states K 9, 13 and 17. The live agents' saved text is the owner's to replace: re-pick Zeus, or have it replaced at the deploy. |

Stays open: the 9 November rules (ranked ticket, paid Bronze, levels, leave lock, organizer fees) are not in this change; they follow when FoxLeague's code reaches main. Ranked and casual starts refused by FoxLeague's round gate ("Round N is not finished yet") are not mirrored here: a start costs nothing today, so a refusal costs one planned match.

## The competition levels, the organizer fees and the leave lock, 2026-10-31

FoxLeague's rule change of 9 November 2026, 14:00 UTC, read on its testnet build. The agent follows the switches in `/api/config`, so nothing changes before them. New money paths: the ranked ticket, a paid Bronze seat and the organizer's payment.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| CL1 | high | A live ranked start needs a paid ticket, so without this change every ranked start is refused from the switch on. | The start is pressed first, so any other gate refuses with nothing paid; only `ranked_ticket_required` reaches one `shopPay` of the price read from FoxLeague, booked before the signature under `shop:ranked_ticket`, within Max shop payment. |
| CL2 | medium | A ticket payment confirmed late could be paid twice. | Pending from the send on (`ranked_ticket`), confirmed again with the same hash every minute; a ranked start is refused while one waits. Tickets that cannot be read refuse the start. |
| CL3 | high | A paid Bronze was taken as free: the executor would have asked for a seat without paying. | Any Bronze with a fee takes the paid path of Silver, within Max entry or stake. A free one seats as before. |
| CL4 | medium | A create owes a payment first, and booking it with the entry would have paid the seat with the deposit in it and credited the deposit when a seat came back. | Quote before the create (unread: refused), one `shopPay` with its own booking and row (`shop:organizer_fee`), its hash with the create, the seat for the entry alone. `tx_pending` sends the same hash again. |
| R41-1 | medium | A payment no create used was dropped, so the next plan paid a second one (agent review of PR #41). | The create is pressed first: FoxLeague runs its other checks before it asks, so a refusal costs nothing. The hash is pending from the send on and the next create of that amount sends it, as FoxLeague's own app does (`useOrganizerFee.ts`); another amount is refused until it is resolved. An answer that settles it forgets it and a refund stops it counting; after 60 minutes unused the owner is told. |
| R41-2 | low | The gas of a sent organizer transaction sat in the seat's row, so it stopped counting when no seat followed (agent review of PR #41, two rounds). | The organizer payment has its own gas row with its FOXSY row: a sent one keeps both, whatever becomes of the seat. |
| R41-3 | medium | A ticket or organizer payment whose broadcast answer was unclear (a gateway 5xx, a timeout) had no pending row, so the next plan paid again (agent review of PR #41). | Both are held from the signature on, under the hash computed locally; a broadcast the gateway definitely refused is released. |
| R41-4 | low | An error after a sent organizer payment was not marked `sent`, so the owner heard of it only in the daily summary (agent review of PR #41). | `finish` counts the organizer's booking too: it reaches Telegram at once. |
| R41-5 | medium | FoxLeague swapped the levels on 2026-10-31: ranked 25 FOXSY, a quarter of the XP, K 5; a paid Bronze half, K 9. The prompt called a ticket's XP "half-rate" and the docs and tests held the old numbers. | The code reads every number from the config, so the payment follows by itself; the prompt, the docs and the tests now agree with it. |
| R41-6 | low | With the per-game private fee at 0 the digest and the plan's note would have told of a "private fee 0". | Named only when FoxLeague serves one above 0; the quote's amount stays what is paid. |
| R41-7 | medium | A private tournament now pays 40/27/13 with a 20 percent platform fee, and the plan knew only the public split: it would have overrated the prize of what it creates or joins. | The digest states the split of a private tournament created now, and each invited row shows its own (`prize_split`), both only when they differ from the public one; the prompt says every team on the invite list shares the fee. |
| R41-8 | low | The Zeus text named K values, so it would have been wrong again at the switch. | No number in it; the prompt and the levels line carry the numbers. The 10 live agents' saved text replaced on 2026-10-31 at the owner's word (they said K 24). |
| R41-9 | medium | The plan was never told the owner's Bronze amounts, so a Bronze create was a guess the rules refused, and an empty list was not told as off (agent review of PR #41). | The plan request names them next to Silver and Gold, or says off. |
| R41-10 | low | FoxLeague settled the private prizes at 40/25/15 (`feat/private-fee`, merged to its release branch); R41-7, the fixtures and the integration notes said 40/27/13. | The digest prints what FoxLeague serves, so no payment or plan text changed; the fixtures and the notes follow. |
| R41-11 | low | FoxLeague's lowest deposit defaults to 0, so the plan would have read "at least 0". | Named only above 0. |
| R41-12 | low | A plan told one private platform fee could create at another once the setting moved between the plan and the action. | A paid private create sends `expected_platform_fee_percent`, as FoxLeague's page does; FoxLeague refuses another percent before anything is written, the booking is released and the next plan reads again. Omitted while FoxLeague serves no split. |
| R41-13 | medium | Each action reads a fresh snapshot, so R41-12 stated the percent read just before the create, and a fee raised between the plan and the action (a plan made before the switch, its create after it) went through (agent review of PR #41, sixth round). | The tick stamps each private create with the percent of the plan's own snapshot, a field only the service sets, never parsed from the model. An action no plan made states the percent read just then. |
| R41-14 | medium | A plan whose config served no private split, or could not be read, was told the public split and still created at the percent read later (agent review of PR #41, seventh round). | A plan told only the public split is stamped with its percent. A plan with an unread config makes no private create; the row says why and its other actions run. The field goes out only while FoxLeague serves a private split, so an older backend never sees it. |
| CL5 | low | The leave rule did not know the lock. | Refused at exactly `min_teams` while `leave_lock_live`; the digest marks the seat. |
| CL6 | medium | The condition check counted groups of 4; a flexible Groups + Knockout can draw groups of up to 6. | `matchesAtMost` mirrors `groups_knockout_most_matches` over the fields from `min_teams` up. `min_teams` from 6 is allowed. |
| CL7 | low | A Bronze the agent creates needs an amount the owner chose. | New setting `entryFeesBronze` (100 to 999, empty: none), created only while the levels are live. |

Stays open:
- A `buy` or a seat payment writes its pending row after the send, so an unclear broadcast leaves none for those two older paths. The XP booster and the bid count `sent` error rows instead; the other products and a seat do not. Not changed here, to keep this change to the new paths.
- The deposit that comes back after play, and an unused payment given up on after 60 minutes, stay counted in the budget: conservative, and only for that game day and month. A refund read could credit them later.
- The tournaments contract upgrade of `feat/private-fee` has not reached mainnet, and FoxLeague says no call changes. The agent signs only the seat's join on it (FoxLeague signs the create). FoxLeague measures about 115,000 gas more on every call and keeps the 8.4M limit, the agent's too; the real join on mainnet is unread until the upgrade: read it before the switch. (Done on 2026-11-02: see the tournaments contract upgrade section.)
- The prices and the routes come from FoxLeague's release branch (f6023eae6, 2026-11-01), not yet on its main. Check them again when they reach it; FoxLeague's open #579, #580 and #586 were read and ask nothing of the agent; `src/strategist/manual.md` syncs then, and the prompt's sentence on the manual's old K goes with it. (Done on 2026-11-02: see the next section.)
- Owner's decisions of 2026-10-31: ranked games alone do not unlock the Zeus booster; the Bronze amounts stay 100, 250 and 500. The owner confirmed on 2026-11-01 that the Steady level counts a ticket as a match fee.

## FoxLeague's promotion to its main, 2026-11-02

FoxLeague's release branch at `1e58023fc` goes to its main (next-foxleague PR #597), then to mainnet. Read before it merged: every commit from `f6023eae6`, the base of PR #41, to `1e58023fc`. That covers the external audit's fixes (login, tournaments, admin settings in safe ranges, the reveal gate), Connect Telegram, bug-report screenshots, deploy checks and the wording of FoxLeague's popup, create page and manual. No route, field or number the agent reads moved: the answers of the config, the organizer quote, the private fee, the ranked ticket and the tournaments are unchanged.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| P597-1 | low | The game manual was FoxLeague's of 30 October (K 24, 12 and 18, none of the 9 November rules), and the prompt told the model the manual had not caught up on K. | `src/strategist/manual.md` synced to `1e58023fc`, where every 9 November rule carries its date; the prompt's sentence on the manual's old K removed. |
| P597-2 | info | FoxLeague limits each wallet to 48 creates in 24 hours, 1v1s included (`tournament.creates_per_wallet_per_day`, not served by the config), refused before any payment. | None: an ordinary refusal, and the agents create far fewer. |
| P597-3 | info | The login no longer accepts the unbound `foxleague-auth-{ts}` message. | None: the agent signs `foxleague:chain=1:auth-{ts}`. |
| P597-4 | info | Flexible Groups + Knockout has no switch: it is live from FoxLeague's deploy. | None: the agent's rule has followed it since PR #41. |
| P597-5 | info | From the switch a forfeit moves no ELO, XP, condition or competitive matches, a ranked game the AI fills takes no ticket and no condition, and the deposit's free hour counts from the creation. | The rule docs say so. No code: the agent never deletes a tournament, presses a ranked start before it pays a ticket and reads FoxLeague's counts. |
| P597-6 | medium | FoxLeague serves `competition_levels.private_bronze_earns`, an admin lever: off, a private Bronze (an invite list) earns no XP, ELO or competitive match. The agent never read it, so with it off Zeus would buy the 2,000 FOXSY XP booster for a private paid Bronze fixture and create private Bronze tournaments that earn nothing (agent review of this change). Mainnet sets it on (FoxLeague's checklist, owner of FoxLeague 2026-10-30). | `paidBronzeEarns` follows FoxLeague's `level_of`: a public paid Bronze earns once the levels are live, a private one only while the flag is `true`; an unread flag or unread privacy is no. The booster gate and the private create use it; the digest's levels line says which way the flag stands. |

Stays open:
- The real gas of a seat's join on the upgraded tournaments contract: read it once the upgrade is on mainnet, before the switch. (Done on 2026-11-02: see the next section.)
- The manual was synced from the promotion's head (`bddced118`); its header names `1e58023fc`, the manual's last commit that FoxLeague's main shows after the merge. If the promotion changes before it merges, run `npm run cli -- manual-status` again.
- FoxLeague's Shop page (`mechanics/shop.mdx`, its first paragraph) still gives the ranked ticket as 100 FOXSY, from before FoxLeague set it to 25 on 2026-10-31; every other page says 25 (agent review of this change, low). No money depends on it: the executor pays only the price of FoxLeague's ticket read, within Max shop payment, and the manual's header and the prompt send the model to the snapshot's numbers. `manual.md` is FoxLeague's text and is not edited by hand: when FoxLeague corrects the page, sync again.
- FoxLeague's Tournaments page (`mechanics/tournaments.mdx`, Private) still says a private Bronze earns nothing "for now", even a paid one, from before FoxLeague's owner decided on 2026-10-30 that it earns like a public one (`rules.private_bronze_earns` 1, mainnet's value). The digest's levels line gives the live flag and the manual's header says the live value wins; sync again when FoxLeague corrects the page.

## The tournaments contract upgrade on mainnet, 2026-11-02

FoxLeague upgraded its tournaments contract on mainnet at 15:38 UTC on 2026-11-02 (tx `1cc0ffb840bc`, the private platform fee of `feat/private-fee`), and its config now names the switch: `competition_levels.live_from` and `organizer_fees.live_from` are both `2026-11-09T14:00:00Z`, still `live: false`. Read-only on chain and on `GET /api/config`; no route, field or number the agent reads moved otherwise.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| TU1 | info | The join gas on the upgraded contract. The first 11 joins after the upgrade used 7,012,205 to 7,237,267 gas; the 807 joins since the upgrade of 2026-10-26 used 6,784,431 to 7,189,293 (about 115,000 more, as FoxLeague measured). 8.4M is 1.16 times the heaviest. A join's gas does not grow with the seats or the invite list (`tournamentAllowed` is an `UnorderedSetMapper`, the writes are fixed), so the margin holds. 21 joins signed by other wallets at 7,000,000 ran out of gas after 2026-10-26; the agent has signed 8,400,000 since 2026-10-24. | None: `GAS.joinTournament` stays 8,400,000, FoxLeague's app signs the same. A join that runs out of gas reverts its payment and keeps only the gas. |
| TU2 | info | The upgrade alone leaves `privatePlatformFeePercent` empty: `getPrivatePlatformFeePercent` reads the global 10, and the config serves the private split 45/30/15/10, so the two agree and a paid private create is not refused. `setPrivatePlatformFee` takes effect at once, not at `live_from`. | None: the agent reads the private split from the config every plan and stamps a paid private create with it; while FoxLeague's setting and the contract disagree FoxLeague refuses the create before anything is paid. |

Stays open:
- FoxLeague still sets the private fee to 20 (the contract's `setPrivatePlatformFee` and its own setting together) and turns `leave_lock_live` on; the agent reads both and needs no change.
- The two stale lines of FoxLeague's manual of the previous section (Shop: ticket 100 FOXSY; Tournaments: private Bronze "for now"): sync again when FoxLeague corrects them.

## FoxLeague's promotion of 2026-11-03: the prize from FoxLeague for the top 24

FoxLeague's main moved from `d51552986` to `c339519ca` (next-foxleague PR #617, 20 commits). Its backend runs on mainnet since about 19:03 UTC on 2026-11-03 (its OpenAPI serves `prize_tiered`); the tournaments contract upgrade of #605 is not on mainnet yet (`getSponsorWeights` is an invalid function, the code hash is still that of 2026-11-02). Every commit read; the routes, fields and numbers the agent reads are unchanged except one new field. Read and asking nothing of the agent: #577 (a live board of the current 36 before the snapshot, a new route the agent does not need), #603 (an admin cancels an edition that holds a prize: every entry refunded), #604 and #606 (screens), #607, #609, #611, #612 and #613 (the login panel; the backend's login is unchanged), #599 (the leave lock's admin field), #590, #598, #600, #601, #602 and #616 (memory, CI, changelog, tests, the deploy record).

| Id | Severity | Finding | Fix |
|---|---|---|---|
| CT1 | low | The prize from FoxLeague of a Champions FoxLeague edition now goes to the top 24 by the round reached, 4 / 2 / 1 shares (56) to the 8 quarter-finalists, the 8 round-of-16 losers and the 8 play-off losers (#605 contract, #608 backend, owner of FoxLeague 2026-11-02). The plan was told every prize was "shared by the last 8", so it undervalued an invitation where a play-off or round-of-16 exit now earns. No money path reads the prize. | The invitation's `prize_tiered` (true only for a held prize on the tiered terms) picks the text: tiered, each group's amount per team, floored as the contract pays; false or absent (equal terms, an older FoxLeague), the 8 quarter-finalists' equal share. `src/strategist/manual.md` synced to `bc3379734`. |

Stays open:
- The tournaments contract upgrade of #605 on mainnet. Until it lands FoxLeague cannot set tiered terms, so `prize_tiered` stays false and the plan reads the equal split, as the contract would pay it. The agent signs no sponsor call, so no gas of its own changes. Done: on mainnet since 2026-11-04 (next section).
- The two stale lines of FoxLeague's manual (Shop: ticket 100 FOXSY; Tournaments: private Bronze "for now") are still in `bc3379734`.

## The tiered prize on the mainnet contract, 2026-11-04

FoxLeague upgraded its tournaments contract on mainnet at 11:46 UTC on 2026-11-04 (tx `f0c1c659cae7`, the #605 code that `c339519ca` already holds). FoxLeague's main moved on to `dd57cf4e7` (#615 permanent match records on Autonomys, #619, #620): one new field, `permanent_record`, on public match rows, which the agent does not read. `GET /api/config` is unchanged: the private split still 45/30/15/10, `leave_lock_live` false, both `live_from` `2026-11-09T14:00:00Z`. Read-only on chain, on FoxLeague's routes and in its code.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| TP1 | info | The tiered prize runs on mainnet. `getSponsorWeights` answers. Edition I (T4122) holds 168,000 FOXSY on the tiered terms: they were set at 12:01 UTC and the prize was deposited at 12:02 UTC. Edition I is Gold, 5,000 FOXSY entry, 36 seats, invitations from 2026-12-01 14:00 UTC. FoxLeague's prize route answers 12,000 / 6,000 / 3,000, the amounts the digest gives (floor of pool times weight over 56). FoxLeague sets `prize_tiered` when the prize is held and its weights are set, so that edition's invitations will carry true. | None: the digest reads `prize_tiered` since PR #46. |
| TP2 | info | The join gas on the new code. The first 10 joins used 7,200,119 to 7,448,067 gas; the 90 joins on the code of 2026-11-02 used 6,962,881 to 7,278,069. The rise, about 200,000 a join, comes with the larger contract code, not the seats: four joins of one tournament stayed within 50,000 of each other. 8.4M is 1.13 times the heaviest. #605 changes no join, refund or `getEntryAmount` code. | None: `GAS.joinTournament` stays 8,400,000, as FoxLeague's app signs (its `gasLimits.ts` comment still names a heaviest join of about 5.55M). Every upgrade that adds code eats some of the margin: read the join gas again after the next one. |

`src/strategist/manual.md` is synced to `6c7f26166`. The one new page, Permanent Match Records (`mechanics/permanent-records.mdx`), is taken in by the mechanics folder rule and holds no number the agent reads. The other changed page (`connect-ai.mdx`) stays left out.

Stays open:
- Before 2026-11-09 14:00 UTC FoxLeague still sets the private fee to 20 (the contract's `setPrivatePlatformFee` and its own setting together) and turns `leave_lock_live` on; the agent reads both and needs no change.
- The two stale lines of FoxLeague's manual (Shop: ticket 100 FOXSY; Tournaments: private Bronze "for now") are still in `6c7f26166`.

## The league formation table, 2026-11-04

The owner's direction after reading the formation results: every agent had moved to 4-3-3b from its own record and
the pooled one, and none had ever played plain 4-3-3 or 4-3-3w, so nothing told the plan what those do. FoxLeague's
public match history and statistics show what every team played. Test first: `test/league-formations.test.ts`, each
test seen failing before the change. No cap, limit, rule or money path changed; the executor never reads the table.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| LF1 | design | The agents learned only from formations their owner's teams had played, so a formation none of them tried was never weighed, and "what lifts a weaker team against a stronger one" had no sample beyond their own matches | Each planning snapshot reads the history of the next 3 of the leaderboard's top 100 by ELO, in turn, and at most 6 new match statistics (newest first, each match kept once). The table counts the last 14 days by formation pair, from both sides, with the strength bands and the results as the ELO underdog (more than 100 below the rival at kickoff, from the history's ELO at the match). The prompt names it in one sentence. |
| LF2 | info | What reaches the prompt is FoxLeague's formation names and numbers, never a team name: formations pass through `txt()` like the other records, and a match between a top team and one of the owner's teams is left out (their records hold it), also one of a team the store learns later | None needed beyond the design: no rival text is stored (`league_matches` keeps user ids, formations, scores, strengths and ELO). |
| LF3 | info | Load on FoxLeague: 3 history reads and at most 6 statistics reads (about 120 KB each) per plan, after the agent's own reads; with 10 agents planning hourly about 60 statistics an hour | The constants sit in `src/snapshot/formations.ts` (`LEAGUE_TEAMS_PER_TICK`, `LEAGUE_READS_PER_TICK`); a failed read is skipped and read again when its team comes round. |
| LF4 | info | Unknown is not a value: a ranked match read more than 6 hours after its end keeps its result but no strength (FoxLeague rebuilds a ranked match's elevens from today's cards), a missing ELO is no gap, AI and casual games are never counted | As in the formation record (`strengthAtKickoff`); a failed history or statistics read keeps nothing. |
| R48A-1 | low | Agent review of PR #48: the turn moved on by 3 teams even when a plan's 6 reads ran out inside the first one, so the teams after it waited a whole round of the top 100 and their history reads were spent for nothing | A plan whose reads run out stays on the team it could not finish and reads no further history. A match whose statistics did not answer waits 6 hours before it is tried again (within the process), so a match FoxLeague never answers cannot hold the turn. |
| R48A-2 | low | Agent review of PR #48 (note): the plans of different agents share the turn and may run at once, so two may read the same teams and statistics. Seen live after the deploy of 2026-11-04: all 10 agents planned within 22 seconds and read the same newest matches of the same first team (about 60 reads for 17 matches kept) | Fixed after the deploy (PR #50): plans that run at once take turns at the league reads within the process (`takeLeagueTurn`), so each reads on from the turn and the matches the one before left. A plan waits at most 60 seconds for its turn, then skips the league reads this time and never runs them later (the table is information only), so a hung read cannot hold up the plans. |

Stays open:
- The casual matches as a test bench (the AI opponent is built at the team's own OVR with a random formation), to be
  weighed once a ranked start costs a ticket (2026-11-09); results against the AI would need their own record. Done:
  the owner asked for it at once (next section).

## The casual test bench, 2026-11-04

The owner's direction: test every formation in casual games, 1 to 3 a day and never more than 4, whenever the condition
they cost is back before the matches that count, rotating through the formations so each one's sample grows evenly,
and weigh those results with the league formation table. FoxLeague plays a casual game against an AI built at the
team's own OVR with a random formation, with the formation, eleven and bench saved at the start; its statistics name the
formation from the launch record (next-foxleague `play_match`, `get_match_stats`). Test first:
`test/casual-bench.test.ts`, each test seen failing before the change. No cap, payment or signature changed: a casual
game costs no FOXSY, and the test is three calls to FoxLeague's API.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| CB1 | design | A formation test meant saving another formation for a while, and a plan's actions run at moments spread over the hour, so a tournament lock, a 1v1 capture or a ranked draw in between would have played the test formation | `play_match` casual takes a `test` (formation, eleven, bench); the executor saves it, starts the game and puts the team's own back at once, all in one action. A start FoxLeague refuses puts it back too; a put-back that fails twice is an error naming the formation still saved and the one to put back, which the next plan reads in its log. |
| CB2 | design | Casual costs condition, which a match that counts may need | Rules (code): at most 4 casual games a game day; every card that would play must be back to full condition before the next strategy lock of a tournament or 1v1 match (the appearance's cost rises with age to 3 times the base at 39; a card over 30 regains half as fast); none while a 1v1 of ours waits for an opponent (it can be accepted and played minutes later) or while a tournament of ours is under way with no next match listed; a calendar that cannot be read is no free time. The digest says whether a casual game is free now and why not. |
| CB3 | design | Results against the AI would have mixed into the formation record and the pooled one | A casual game goes to its own record, pooled over the owner's teams for 40 days (`casual_results`), shown by formation against the AI; a ranked game the AI filled goes into neither. The snapshot names the next formations to test: the ones the squad can field, the least tested first. |
| CB4 | info | A casual start takes one of the 5 daily starts it shares with ranked, and ranked is what moves ELO (the leaderboard that Champions FoxLeague invites from) | The prompt keeps enough ranked games for ELO until ranked costs a ticket, and calls casual the free way to test once it does. |
| R49A-1 | medium | Agent review of PR #49: a save of the test that failed without FoxLeague's refusal, followed by a put-back that failed twice, dropped the put-back's message, so the log did not say what to put back | The error now carries it: the test formation may still be saved, and the formation, eleven and bench to put back with set_formation. |
| R49A-2 | low | Agent review of PR #49: the check for starters at condition 0 read the saved eleven, so a test eleven with an exhausted card was saved before FoxLeague refused the start | The check reads the test eleven for a casual test. |
| R49A-3 | low | Agent review of PR #49: a tournament the team is out of keeps blocking casual games until the whole tournament ends, since the agent sees only its own fixtures | None: it fails closed (no casual game, never a cost to a match). The agent cannot tell from its own fixtures that it is out; a later change may read the bracket. |
| R49A-5 | low | Agent review of PR #49 (docs): the owner pages' Fair Play sentence named the pooled formation record and the league formation table as all the agents share, but the casual test bench is pooled over every agent of the install too | README, INSTALL and the site's FAQ, update and safety pages say they share a pooled formation record with no team named, a league formation table built from public matches and the results of their casual tests. |
| R49A-4 | info | Agent review of PR #49 (docs): the casual AI's random formation and the squad read at the start are in `docs/FOXLEAGUE-INTEGRATION.md` and `docs/ECONOMY-AND-RULES.md` but not in `src/strategist/manual.md` | None: `manual.md` is FoxLeague's own manual as synced, never edited by hand; its Casual section says the opponent is an AI-generated team, and the prompt gives the plan the rest. |

Stays open:
- A crash between saving the test formation and putting the team's own back (a restart in those seconds) leaves the test
  formation saved with no log line; the next plan sees the formation in its snapshot.
- R49A-3 above.

## Audit of PRs #29 to #50, 2026-11-04

The owner's request after the league formation table, the casual test bench and the read turns: an adversarial review of
everything since the last audits (PR #24 and PR #28). Five Claude Fable 5.1 reviewers at max effort, read-only, on a
frozen copy at `afc3238` (main and PR #50), one area each: money and limits; what the plan sees, prompt injection and
data; FoxLeague and chain integration (against next-foxleague `origin/main` and its contracts); outside attackers,
owner controls and secrets; docs, website and prompt against the code. A finding counted only with a test that fails
on the code; each of the 20 tests in `test/audit-1104/` failed on `main` (`9fd10de`) and passes after its fix. No
critical or high finding.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| MONEY-1 | medium | A seat payment (a join, or the seat of a create) and a shop payment were held as pending only after the broadcast answered, so a broadcast that may have gone out left no pending row and a later plan could pay the same seat (reverted on chain: gas lost) or the same product again (a second purchase until FoxLeague's net returns the first). The reviewer rated it low; the owner rated the same mechanism medium for the ticket and the organizer payment (R41-3) | Both are held from the signature on, under the hash computed before the broadcast, as the ticket and the organizer payment are; the pending retry confirms a shop row with the row's own hash. |
| INTEG-1 | medium | A create whose answer was lost after the organizer payment was declared "nothing created" and not asked again; FoxLeague may have created it, and a tournament that stays unfilled keeps the calendar deposit | One idempotency key for the whole action (FoxLeague replays a stored success for the same key and stores only successes); a create with no answer is asked again with it up to 3 times, 6 seconds apart; still no answer says FoxLeague may have created it and the next plan reads the agent's tournaments. |
| INPUT-4 | medium | "Their last formations" for an upcoming rival and in the 1v1 scouting counted the rival's casual games, tests against the AI that the owner's own agents now play every day, steering the formation for a match with a stake | Casual games are left out of a rival's last formations. |
| DOCS-1 | medium | The website's settings page explains every setting but had no row for the Bronze amounts the dashboard has (paid entries from 9 November) | A row, and the levels page names them among the settings every level shares. |
| DOCS-2 | medium | Max shop payment also caps the ranked ticket and the calendar deposit of a tournament the agent creates; its settings row and bubble did not say so, so an owner sizing it could not see it decides which tournaments the agent may create (at 500 a round robin of 8 owes 700 and is refused) | The row and the bubble say it, with examples and no dated price. |
| MONEY-2 | low | A casual start whose answer was lost and whose read-back failed too was not counted toward the 4 a day | Such a start is marked (`startUnknown`) and counts, in the daily count and the cooldowns alike (`maybeStarted`). |
| INTEG-2 | low | After a lost answer to the join, FoxLeague's "You are already in this tournament" (the seat holds) was read as "paid but not seated", with a refund promised to the owner | That answer settles the seat as confirmed. |
| INTEG-3 | low | A competitive daily cap of 0, FoxLeague's "no cap", was told to the plan as "at most 0 competitive matches a card a day" | 0 reads "no daily cap". |
| INPUT-1 | low | Games against the AI kept in the pooled record before the casual split stayed in it for up to 14 days as matches of the field | The pooled record counts only matches against a real team. |
| INPUT-2 | low | The 30-second match cooldown and the plan's match spacing did not see a casual start whose put-back failed (logged as an error), so the next start of the plan was refused once | The cooldowns read every start that may have happened, as the daily count does. |
| INPUT-3 | low | An unread roster showed as a lineup of 0 on the field lines and the 1v1 line, and a casual game as free, where the condition was unknown | Unknown says unknown; a card that cannot be read is no free card. |
| ATTACK-1 | low | A provider key in a configured base URL would be copied by an HTTP error into the snapshot warnings, the dashboard's state, the activity log and the prompt | An HTTP error names the host only. |
| ATTACK-2 | low | FoxLeague's refusal of a Champions FoxLeague invitation can quote a title another player wrote; its Unicode format characters (a right-to-left override) reached the owner's Telegram | The notice leaves them out, as `txt()` does. |
| DOCS-3 | low | The "In tournaments" bubble and the dashboard page promised that Leave always gives the seat back; once FoxLeague's leave lock is on, a tournament exactly at its minimum cannot be left, the owner's Leave included | Both say so. |
| DOCS-4 | low | The integration notes (9.3) gave the ELO K values of before 2026-10-30 (24, 12, 18) | The live 9, 13, 17, and 5 and 9 after the levels' switch. |
| DOCS-5 | low | The economy notes still said a Groups + Knockout needs its full field | It starts from min_teams 6, in groups of 3 to 6. |
| DOCS-6 | low | The prompt suggested an open challenge when no named opponent fits, which a Zeus agent (all ten live) is always refused (predates the window) | The prompt says never at the Zeus level. |
| R51A-1 | low | Agent review of PR #51: MONEY-2 missed the ranked start pressed again after a ticket was bought; with no answer and no read-back it was logged as refused and the ticket said to stay | It counts as a start that may have happened, and the ticket is not said to stay. |
| R51A-2 | medium | Agent review of PR #51: an empty or non-envelope 502/503/504 after the organizer payment reached the create as `ApiRefusal('unexpected answer ...')`, which the INTEG-1 retry took for a refusal: "nothing created", no second ask with the same key (nothing paid twice: the organizer row stayed pending, and OPEN-8 names an unseated creation) | An answer that is not FoxLeague's envelope is a lost answer there too, as elsewhere in the executor: asked again with the same key. |

The owner then asked for the open items below that are not hard to close (each test in `test/audit-1104/open-items.test.ts` failed on the branch before its fix):

| Id | Severity | Finding | Fix |
|---|---|---|---|
| OPEN-1 | low | A `condition_loss_per_match_ranked` of 0, missing or not a number, or a regeneration that is not a number, let the casual condition rule call a game free | With a match that counts ahead, a cost or a regeneration that cannot be read refuses the casual game; a result that is not a number is never "back to full". |
| OPEN-2 | low | The kill switch, a pause or a stop between saving a casual test formation and the start did not stop the start | Checked before the start: no game, and the team's own formation goes back. |
| OPEN-3 | low | The competition levels and organizer lines read nested config objects without a guard: a FoxLeague build without them would fail every plan | A missing number reads unknown. |
| OPEN-4 | low | A rival strength read that failed was kept as unknown for 20 minutes for every agent | A failed read is not kept; the next plan reads it again. |
| OPEN-5 | low | `activeHoursUtc` [24, 0] passed the validator and never planned | From 0 to 23 and to 1 to 24, as the dashboard's fields. |
| OPEN-6 | low | FoxLeague's "Do NOT pay again" was final for a pending seat in the retry, although it means the entry is verified and the seat not recorded yet | The retry asks for the seat without the hash, as FoxLeague's app and payAndJoin do, and keeps the row until the seat is there or the window ends. |
| OPEN-7 | low | The prompt did not say an organizer payment must fit Max shop payment, the plan did not see the invitation's 30-minute margin, and the levels page did not name the ranked ticket for the Steady level | The prompt's organizer sentence, the invitations line and the levels page say so. |
| OPEN-8 | low | A tournament the agent created but holds no seat in (a create whose answer stayed lost) was not named to the plan, so an unfilled one could keep the deposit | The snapshot reads the seats of an open tournament the agent created (at most two) and the plan's line says it holds no seat, take it with join_tournament, and, while organizer fees are live, that an unfilled one keeps the deposit. |

Stays open (reasoned by the reviewers, no failing test; none moves money), with the reason each stays:
- A Telegram /do in the seconds between a plan's snapshot and the per-agent lock can see a stale balance: the caps read
  the ledger fresh, so at most a reverted payment's gas.
- The kill switch is checked when an action starts, before every signature and (OPEN-2) between a casual test's save and
  its start; a free action (training, a free Bronze join, widening) whose checks were running when it was turned on
  still reaches FoxLeague: the window is the time of those reads, and none of them pays.
- The "Casual game now" line judges the saved eleven while the executor judges the test eleven: the line says so, and
  the executor binds.
- Casual bench rows never get a strength band: FoxLeague serves no lineup for the AI side.
- Two pending Champions FoxLeague invitations block each other at FoxLeague: its design; the owner can decline one.
- `home_elo_at_match` of a ranked game is stamped when the result applies, not strictly at kickoff: information only.
- Telegram links URLs in plain text, so a refusal quoting a player's title can carry a link: decided with R30A-1.
- The Bronze amounts default reaches agents saved before PR #41: the owner's amounts (CL7), within Max entry.
- R49A-3 (a tournament the team is out of blocks casual games until it ends): it fails closed; telling that the team is
  out needs the bracket.

## Audit of PR #51, 2026-11-05

The owner's request after PR #51: a second look at the fixes themselves, as the agent review of PR #51 had found a
medium (R51A-2) inside them and the paths that go live on 9 November (organizer deposit, ranked ticket, paid private
tournaments) have not run with real money yet. Two Claude Fable 5.1 reviewers at max effort, read-only, on a frozen copy
of `main` at `3ba4216`: the money paths (executor, pending payments, match starts, rules) and what the plan sees with the
outside surfaces (snapshot, digest, database, Telegram, HTTP errors, settings, prompt). A finding counted only with a test
that fails on the code; each test in `test/audit-1105/` failed on `main` (`3ba4216`) and passes after its fix. No
critical, high or medium finding, and none of the six lets a payment repeat.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| R52A-M1 | low | The put-back after a casual test was read back by formation and eleven only, so a test that changed only the bench and a put-back whose answer was lost (and not applied) were reported as "put back" while the test bench stayed for the next match with a stake | The read-back checks the bench too (every card named is on it, as FoxLeague completes a bench of fewer than 7); a bench that is not back is tried again and then told to the owner with what to put back. |
| R52A-M2a | low | The kill switch, a pause or a stop between the create after an organizer payment and the seat's signature ended the action with "nothing sent" and no created id on its row, although the payment went out and the tournament existed with no seat of the agent's | Anything after the create keeps the tournament's id on the row and says it was created, with the organizer payment, and waits with no seat (unfilled at its deadline it keeps the deposit). |
| R52A-M2b | low | The lost-answer retry of the create after an organizer payment (INTEG-1) did not look at the kill switch, a pause or a stop: FoxLeague was asked again, which could turn a payment its net refunds into a tournament with no seat and its deposit at risk | After the organizer payment no create is asked while one of them is on: the payment is left for the next create of that amount or FoxLeague's refund, and the action says so. |
| R52A-I1 | low | ATTACK-2 left out Unicode format characters from the invitation notice only; a FoxLeague refusal quoting a rival's title (the time slot conflict of a create) still reached the owner's Telegram with them, as an action result and through `/log` | Every message to Telegram leaves them out where it is sent; line breaks stay. |
| R52A-I2 | low | ATTACK-1 named the host only, but the error still quoted the server's answer, and an error page that echoes the request path ("Cannot GET /path") put a key of a configured base URL back into the warnings and the prompt | The request's own path is cut from the quoted answer. |
| R52A-I3 | low | OPEN-8 also named a 1v1 the agent created and a created tournament that filled up without it, both refused by the join rule: every plan was sent to a join that cannot happen | A 1v1 (no deposit, refunded in full at its deadline) and a tournament with no seat left are not named. |

Dropped: the same bench blind spot in `set_formation` with a lineup. It needs a new formation and FoxLeague saves
formation, eleven and bench in one call, so a read-back with the new formation means the whole save landed; the test
could not fail.

Stays open (reasoned by the reviewers, no failing test; none moves money), with the reason each stays:
- An organizer-only tournament created with the agent's team (only the owner can, from FoxLeague's app) never has a
  creator seat, so it would be named as unseated; neither `/tournaments/my` nor the executor can tell it apart today,
  and the join FoxLeague refuses would cost gas only.
- OPEN-8 reads the seats of at most two created tournaments, in FoxLeague's order: a third is not named, as before OPEN-8.
- A casual test bench of fewer than 7 is completed by FoxLeague; the condition rule judges only the cards named. Which
  cards FoxLeague adds, and whether a substitute who comes on costs condition before a staked match, is FoxLeague's.
- The pending retry's `/already/` also matches FoxLeague's other "already" gates; a hash-less retry refused by one marks
  the row done while the escrow is unseated, and FoxLeague's reconcile seats or refunds it; a later payment for the same
  seat reverts on chain (gas only).
- A future AI-side match type other than `casual` would count again in a rival's last formations: none is served.
- With an unread roster the Upcoming line says the rival's strength is unknown where it is the agent's: no decision reads it.

## FoxLeague's release of 2026-11-05 (rc.85), checked 2026-11-06

FoxLeague promoted three releases to its main after the agent was last checked against it (`fcd79a74a`, 2026-11-04):
#633, #644 and #649, live on mainnet with rc.85 (`16d9a455e`) from 23:51:59 UTC on 2026-11-05. Fourteen commits were
read against what the agent calls and reads, and three refused starts in the production log of 2026-11-05 ("Already in
match", 11 minutes 6 seconds after the agent's previous start) were traced to FoxLeague's in-match gate. Each test in
`test/foxleague-rc85.test.ts` failed on `main` (`7fdb427`) and passes after its fix. No payment is involved in any of
them: a refused start costs nothing and a ranked ticket is bought only when FoxLeague asks for it.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| R85-1 | low | A plan spaced its casual and ranked starts 11 minutes apart, but FoxLeague holds a team until the match's broadcast has aired: the simulation (about 1.5 minutes), the recording (about 615 s) and 30 s, so about 12 to 12.5 minutes after the start. A casual test after a ranked game (or the reverse) was refused and lost its place in the plan | The plan spaces any two casual or ranked starts 13 minutes apart (16 between two ranked ones, unchanged); a slower simulation is caught by the active match read before each start. |
| R85-2 | low | Since FoxLeague's #638 the broadcast starts by itself and `GET /api/matches/active` returns the previous match, `finished`, while it airs. After a start whose answer was lost, the read-back took that match for the new one: a start that never happened was logged as one (the day's count, the last start time) | The read-back counts an active match as the new start only when FoxLeague created it after the press (a minute allowed for the two clocks), or, without a readable time, while it is still being played. |
| R85-3 | low | Since FoxLeague's #647 the AI of a casual game plays at the OVR it is built at; before, every AI player played as a Common, at 30 at most. The casual test bench pooled 40 days of games, all of them against the weaker AI, with the new ones | The bench counts no casual game that ended before rc.85 went live (`CASUAL_AI_FULL_FROM`); the record grows again from the new games. |

Also in this release, with no change to the agent: the 1v1 "Pay now" route and its error code (#637, the agent creates
and joins in two steps); `/api/config` gains `google_login_preview`, `guest_explore_enabled` and `player_interest`
(switched off) and loses nothing; no contract or gas change; the ranked ticket, organizer deposit and private fee code
is untouched. The game manual is synced to `e4e8d99d3` (the interest signal on the marketplace page and the 1v1 "Pay
now" note).

Stays open, with the reason each stays:
- Yellow cards (#634, #640) are counted and shown only: FoxLeague's code says nothing is enforced yet. Its manual
  announces a ban from about 18 November (three yellow cards miss the team's next tournament match). The agent will need
  to read it and leave a banned player out once FoxLeague ships it; the page that says so (Getting started, Players) is
  not among the pages the agent's manual carries.
- The active match read ends 30 s before FoxLeague's gate, so a start in those 30 s is still refused by FoxLeague (no
  cost; the next plan plays it). With 13 minutes between starts this needs a simulation of more than about 2 minutes; a longer one is still shown
  by the read, and the agent's own check refuses the start without asking FoxLeague.

## Every level open to every part of the game (owner, 2026-11-06)

The production log of the week to 2026-11-06 showed the agents' 1v1s never played: the ten agents created 242
targeted challenges and 2 were played, 231 expired unaccepted (only gas lost, but the agent's one 1v1 slot held for
hours). FoxLeague's public list shows why: other players' targeted 1v1s were accepted 281 times out of 294, half of them
within 36 seconds of their creation, so they were arranged between the two teams first, and the snapshot's "accepted N
1v1s in 7 days" counted those; open challenges were taken 63 times out of 105, half within 11 minutes. Every agent plays
at the Zeus level, which could not post an open one. The owner asked that every level may use every part of FoxLeague,
the levels differing only in what they pay for and the caps. Each change has a test in `test/open-play.test.ts` that
failed on `main` (`b3e602c`) and passes after it.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| OP-1 | design | The challenge list counted a team's accepted 1v1s, most of them arranged, so the plan aimed at teams that never take a stranger's challenge | A targeted 1v1 started within 2 minutes of its creation counts as arranged and is left out; the list and the suggested range count only the 1v1s a team took that it had not arranged, and the prompt says a targeted challenge is taken almost only when arranged. |
| OP-2 | design | Zeus could not post an open challenge | Every level may post one. |
| OP-3 | design | An open challenge was Silver at the owner's lowest amount, at most one in 24 hours | Any configured stake, Silver or Gold (Gold only when on), within the max entry fee; FoxLeague's one active 1v1 is the only count. R9-1 (a failed open create counted toward the one a day) went with that limit. |
| OP-4 | design | Opening the stake opens the farming route A2 closed: anyone may take an open challenge | An open challenge must carry an OVR range whose maximum is at most the team's best XI OVR rounded up (read right before the create; unreadable refuses), so FoxLeague's own join check keeps every team stronger by OVR out. |
| R54A-1 | high | Agent review of PR #54: the best XI OVR ignores condition, so a fresh team at our own OVR could take an open challenge while our starters are tired (at condition 50 it is about a third stronger), past A2's 10 percent | The strongest team a range lets in plays at its top at full condition: an open challenge is refused while that top is more than 10 percent above our eleven at today's condition (each starter's card OVR, its synced stats averaged and rounded down, scaled by condition, over the eleven; unreadable refuses). The snapshot shows the eleven's OVR today and whether an open challenge must wait. |
| R54A-2 | medium | Agent review of PR #54: a starter's missing condition or synced stats made the eleven's OVR NaN, and the R54A-1 comparison then let the open challenge through (rule 4); the snapshot printed "OVR NaN" | The eleven's OVR is unread (null) when any starter's stats or condition is not a finite number: the open challenge is refused and the snapshot says no open challenge. |
| R54A-3 | medium | Agent review of PR #54: R54A-1 ran only at the create, while an open challenge waits up to 240 minutes; a ranked start (5 condition per starter), training a starter or a weaker eleven could push our eleven past the 10 percent before anyone takes it | While an open challenge of ours waits, a ranked start, training a starter (5 condition, more with age) and `set_lineup` or `set_formation` with an eleven are refused when the eleven after them would be more than 10 percent below the range's top; an unreadable range refuses; with our tournaments unread, refused while an open challenge created in the last 4 hours may still wait. |
| R54A-4 | medium | Third review pass: R54A-3 judged only the eleven after a change, so once the eleven was already below the bar (a tournament match during the wait, or a challenge the owner posted) a stronger eleven was refused too | A change that leaves the eleven at least as strong as now passes; a weaker one is still held to the bar. |
| R54A-5 | low | Third review pass: with the team unread, training skipped the R54A-3 check (the card counted as no starter) | Training with the team unread is checked as training a starter (the eleven after it is unread: refused while an open challenge waits). |
| R54A-6 | low | Third review pass: a waiting challenge of ours whose target field was absent was read as targeted and left unchecked | Only a number in `target_user_id` (or `targeted`) makes a challenge targeted; an absent field is checked as open. |
| R54A-7 | low | Fourth review pass: with a waiting open challenge of ours that has no top (one the owner posted by hand), even a stronger eleven was refused, since the range check came before R54A-4's skip | The skip comes first: a change that leaves the eleven at least as strong always passes; a weaker one is refused when the range cannot be read. |
| OP-5 | design | The agent could widen its own 1v1's range, which would let a stronger team in afterwards | The maximum of a 1v1's range is never raised or removed; its minimum may be lowered. |
| OP-6 | design | Only Zeus created private tournaments | Every level may. |
| OP-7 | design | Casual games had a count of their own (4 a game day) on top of FoxLeague's 5 daily starts | No count of their own; a casual game still runs only when every card that plays is back to full condition before the next match that counts. MONEY-2 keeps checking the day's count the plan sees; CB5 went with the cap. |
| OP-8 | design | The level texts named only some parts of the game, so a level could read a missing feature as forbidden | Every level's text says every part of FoxLeague is open and the level sets what it pays for and how much. |

Kept on purpose, after the owner was asked (2026-11-06): the farming guards of A2 on a targeted or joined 1v1 (a rival
100 or more ELO above, one whose eleven is more than 10 percent stronger or cannot be read, more than 2 a week against
one rival), Zeus's floors (a 1v1 from 55 percent, which is about where a 1v1 starts to pay, no tournament with three
clearly stronger seated teams, no Champions FoxLeague with 24), and A3's rule that the 18 strongest cards are never
listed. Also kept: one created tournament at a time (FoxLeague's own rule, `tournaments.rs` "You already have an active
tournament you are organizing"), the size ceiling from what recently filled (a tournament that does not fill keeps the
organizer's deposit once that switch is on), and every money limit.

Stays open, with the reason each stays:
- The saved strategy text of an agent does not change with the presets: the ten live agents keep their Zeus text until
  the owner picks Zeus again (or the text is replaced with the owner's go).
- An open challenge topped at the team's best XI OVR rounded up lets in a team up to 0.9 OVR above it (FoxLeague
  compares tenths; the creator must fit its own range). The win chance against whoever takes it is unknown before, and
  its ELO cannot be checked. A targeted 1v1 that waits has the gap R54A-3 closed for open ones (A2 checks only at its
  create); it is rarely taken (2 of 242 in the week to 2026-11-06). Zeus's 55 percent floor is not applied to it: against the strongest team the range lets in
  it can never reach 55 percent (that team is at least as strong as ours by OVR), so the floor would forbid what the owner
  asked for (Zeus posts open challenges, 2026-11-06); the strength test of R54A-1 holds it to A2's 10 percent instead.
- The player interest signal (FoxLeague rc.85, switched off) has no action yet.

## One brain for every level (owner, 2026-11-06)

The owner asked that every level play with Zeus's intelligence and differ only in money, like subscription tiers.
What was Zeus's code now holds at every level, every level reads the same strategy core, and the levels differ in
their caps, their largest payments, their bid limits, three new counts and how often they plan. Each change has a test
in `test/one-brain.test.ts`; the file could not load on `main` (`a7f2757`: the new exports were missing), and each test
asserts what the code there did not do.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| OB-1 | design | Only Zeus was held to a 55 percent win chance on a 1v1 against a known team; the other levels could stake on a 41 percent match | Every level. |
| OB-2 | design | Only Zeus read a tournament's seated field and stayed out of one with three clearly stronger teams (and a Champions FoxLeague with 24) | Every level's join reads the field; unread refuses. |
| OB-3 | design | Only Zeus bought the XP booster only once a competitive match of its own was drawn within its 24 hours | Every level. |
| OB-4 | design | Only Zeus's plans carried the win chance of each team on the challenge list | Every level's snapshot reads them (up to 10 rival reads a plan, cached 20 minutes). |
| OB-5 | design | Paid training had no count of its own (the level text said how many) | `paidTrainingPerDay` (0 to 10): a paid session over it is refused, and a slot purchase counts those used today and those banked. An unreadable training status refuses. |
| OB-6 | design | XP boosters had no count of their own | `boostersPerWeek` (0 to 7), from the agent's own purchases of the last 7 days (sent or answer-lost ones count, refunded ones do not); 0 refuses. |
| OB-7 | design | Common packs had no count of their own beyond FoxLeague's 2 a week | `packsPerWeek` (0 to 2), counted the same way. |
| OB-8 | design | New settings would have read the steady defaults for every agent saved before them, lowering the live agents' limits without the owner | A row without the counts reads FoxLeague's maximum (10, 7, 2); a new agent stores the steady level's. Raising a count asks for the password (`raisesLimit`, the dashboard's list). |
| OB-9 | design | Six different texts, some forbidding what a level could afford | One strategy core (Zeus's, within the level's limits) for every level; one recommended AI; the new defaults: steady bids up to 500, climber 1,500, hunter 7,000, predator 14,000 at a $50 daily cap; the largest shop payment 2,000 at climber (the booster), 9,000 at beast and Zeus (an Epic's match waivers); ticks 120, 120, 90, 90, 75, 60. |
| R55A-1 | low | Agent review of PR #55: the Boosters a week help said 3 sure matches while the code needs one competitive match of its own drawn within the 24 hours; the integration notes still said Zeus for the Champions FoxLeague field and the booster fixture | The help (dashboard and Settings page) and `docs/FOXLEAGUE-INTEGRATION.md` say what the code does. |
| R55A-2 | low | Agent review of PR #55: the executor's 7-day count of the agent's own boosters had no test of its own | A test of the count from the log: this mode only, this product only, a purchase sent or with its answer lost counts, a refunded one and one older than 7 days do not (it fails with the refund or the product filter taken out). |
| R55A-3 | low | Second review pass of PR #55 (rule 4): a training status without its used or banked numbers made the count NaN, and a paid session or a slot purchase went through unchecked | Both numbers must be read, or the paid session and the slot purchase are refused. |
| R55A-4 | low | Third review pass of PR #55 (docs): the Settings page still called a Max bid of 0 the Steady and Climber default | It says a Max bid of 0 turns bidding off; a test keeps every page and bubble free of the old default. |

The executor no longer reads the strategy text to decide anything (rule 2 of AGENTS.md): the Zeus check by text is gone.
Older tests that ran as a non-Zeus agent now meet these rules; they were changed to keep testing their own rule (a
rival 10 percent weaker by default, a fixture of its own for a booster, a seated field read for a join), not to drop a
check.

Stays open, with the reason each stays:
- The ten live agents keep their saved Zeus text and limits until the owner picks a level again; their counts read
  FoxLeague's maximum, so nothing changes for them except that the rules they already had now hold everywhere. The
  higher largest shop payment of Zeus (9,000, was 5,000) reaches a live agent only through the level proposal and the
  owner's password.
- Every agent now reads up to 10 rivals' squads a plan, as Zeus did: more FoxLeague reads per install.

## A targeted challenge with an OVR range, seen in production (2026-11-06)

After PR #54 and PR #55 went live, agents 7 and 1 each planned a targeted challenge with an OVR range ("OVR 1 to 100",
"OVR 1 to 38"). The executor refused both before any payment (only the chosen team can accept a targeted challenge, so
a range could only lock it out); the challenge was simply not sent. The test in `test/targeted-no-range.test.ts`
failed on `main` (`4351662`) and passes after the change.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| TR-1 | low | The prompt showed one `create_challenge` form with `"target_user_id":N|null` and the range fields together, and the snapshot offered "a range about 10 percent either way for what you create", so the plan put a range on a targeted challenge | Two forms in the prompt: a challenge to one named team with no range fields ("never ovr_min or ovr_max"), and an open one with them; the snapshot offers the 10 percent range for its own open tournament and says a targeted challenge or a private tournament takes none. The executor's refusal is unchanged. |

## Grand audit of 2026-11-06 (Fable 5.1 at max effort, PRs #53 to #56 and the manual against the code)

The owner asked for the manual to be an exact mirror of the agent as it runs, and for an adversarial review of
everything since the last audit. Five reviewers (MONEY, ATTACK, EDGE, INTEG, DOCS) worked read-only on the frozen
production tree `20ceea1`; INTEG also read FoxLeague's release of the same day (`01290ebaf`, live since 15:43 UTC) and
DOCS compared FoxLeague's numbers with the live `/api/config`. No critical or high finding. Each finding has a test in
`test/audit-1106/findings.test.ts` that failed on `20ceea1` and passes after its fix.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| ATTACK-1 | medium | A rival's strength was read from its synced stats only; a rival whose training is unsynced passed A2's 10 percent and the 55 percent floor, then synced before the match | `rivalStrength` takes each card at the stronger of its synced and its live stats (live unreadable: synced). The prompt and the digest say so. |
| EDGE-1 | medium | Our own squad strength with a starter's stats or condition unreadable was NaN, and an own ELO unreadable was 1200 or NaN: no rival or seated team was ever "stronger" than that | `squadLegal` refuses a squad whose stats or condition cannot be read (it runs before every match, entry and 1v1); an unreadable own ELO refuses a 1v1 and a field; the digest says "unknown", never NaN. |
| EDGE-2 | medium | A seated team whose ELO could not be read but whose lineup read counted as even, not unread | A seat known only in part and not already clearly stronger counts as unread (`judgeField`); three refuse. |
| DOCS-1 | medium | The levels page held the fusion fees to the Max shop payment (Steady: fees up to 400, the owner's table), while the code never did | The code follows the table: a fusion fee above the Max shop payment is refused; the Settings page and the shop bubble say so. |
| INTEG-1 | low | The level's paid sessions a day read FoxLeague's `premium_used_today`, which counts purchases in the last 24 hours, not sessions (`shop.rs:866-873`) | Paid sessions of the day = `used_today - daily_free` (both from the 14:00 UTC reset), for the session and for a slot purchase; the digest shows it. |
| EDGE-3 | low | With `used_today` or `daily_free` unreadable a session counted as free and skipped the level's count | Both must be read, or the session is refused. |
| MONEY-1 | low | The executor judged only the first 32 seated teams (EDGE-4 found the same) | Every seated team is read and judged. |
| INTEG-2 | low | After the organizer payment, FoxLeague's "creation could not be confirmed yet ... stays pending" (the tournament exists with the payment on it) was reported as "nothing created" and a refund to come | That answer settles the payment as used and says FoxLeague may have created the tournament; the next plan reads its tournaments (OPEN-8 shows one without a seat). |
| DOCS-2 | low | The Settings page's list of what a level proposes left out the three counts | Listed. |
| DOCS-3 | low | How it plays stated a higher private platform fee as today's rule; FoxLeague serves one split for both | Conditional: once FoxLeague charges it. |
| DOCS-4 | low | The manual never said the agent lists none of its 18 strongest cards nor leaves fewer than 18 | Said in How it plays. |
| DOCS-5 | low | The prompt's formation styles offered 4-4-2a, which no action accepts yet | Dropped from the styles line. |

Also done: the game manual copy synced to FoxLeague's `c355e04b3` (the ranked ticket 25 on the Shop page, like-for-like
substitution on, a paid private Bronze earning from the switch, a full Champions edition locking every seat at once,
the deposit of a late chain confirm); How it plays says the agent aims at 1 to 3 casual tests a day (no cap of its
own); `docs/FOXLEAGUE-INTEGRATION.md` section 24 records FoxLeague's release.

PR #57's review (low, two notes): reading every seated team (MONEY-1) could meet FoxLeague's rate limit (30 a second
per IP) in a big field. Checked: every FoxLeague call goes through the client's own limiter (`FoxLeague` in
`src/foxleague/api.ts`, `FOXLEAGUE_RPS`, 5 a second by default, one client shared by every agent), so a big field is
read slowly, never in a burst; no failing test, no change. The INTEG-2 test now also checks that the payment stays in
the ledger, that nothing is left pending, and that a `tx_pending` answer is asked again with the same hash first.

Stays open, with the reason each stays (no failing test, or a design limit):
- A rival listing its strongest cards (left out of the public roster read) to look weak, then cancelling the auction
  before the match: depends on FoxLeague's roster and auction behaviour; would need the listed cards added to the read.
- The takers of the agent's own open challenges are not counted in the 2-a-week limit per rival (unknown at the
  create; the owner's open-challenge design); the one-week review of the 1v1 limits (about 13 November) will look at it.
- The "unarranged" signal can be bought with a second account (a design limit; the stake still passes A2 and the 55
  percent floor, now on the stronger of synced and live stats).
- FoxLeague serves the leave lock's switch only as a boolean: a leave planned before 14:00 UTC on 9 November and run
  after it may be refused by FoxLeague (nothing paid or credited).
- A League + Knockout field is read up to 35 invited teams (36 seats, so all of them today).
- The read-back after a lost Play answer allows a minute for clock skew; a larger skew logs a start as an error (no
  payment). The casual bench cut-off reads the game's end, not its start (one 12-minute span).

## FoxLeague's mainnet of 9 November and its rules of 13 November: cards, injuries, medicine, forfeits (2026-11-10)

What mainnet runs since the competition levels' switch (FoxLeague `bbb1bfba7`, 32 commits after the agent's last
sync) and what its release branch ships next (`2913ee7df`) were read through git only, by two readers, each fact
checked against FoxLeague's code before it was built on. The agents ran through the switch of 9 November with no
error (ranked tickets, paid Bronze seats and 1v1s paid and confirmed), and nothing they did before needs a change.
From Friday 13 November 2026, 14:00 UTC (`/api/config` `card_bans.live_from`) FoxLeague counts yellow card bans and
injuries, sells medicine and takes ELO for a forfeit; the agent read none of the five discipline fields its cards
already carry. Each finding has a test in `test/cards-injuries.test.ts` that failed on `02824f0` and passes after its
fix. The rules and their sources: `docs/ECONOMY-AND-RULES.md` section 6a, `docs/FOXLEAGUE-INTEGRATION.md` section 25.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| CI-4 | medium | A 1v1's seat needs 11 match-fit players of the 18 and FoxLeague counts an injured card out, after the stake is paid (refunded, the gas lost). The agent counted condition and transfer cooldown only, and at the create of a challenge counted nothing | One count for the join and the create: condition, no transfer cooldown, not injured. |
| CI-3 | medium | Every strength the rules compare (the 55 percent floor, the 10 percent rule, the field of a tournament) is the saved eleven's, but FoxLeague replaces an injured starter with a bench card of its own choice | No match, 1v1 or entry while an injured card is in the saved eleven (`squadLegal`); the snapshot says so in capitals and the plan saves an eleven without it. |
| CI-5 | medium | Rule 4: once the bans are live, a card whose answer leaves its injury or ban out would have counted as healthy | Unknown from the switch on (`disciplineUnread`): it stops the eleven, counts as unfit, is no fusion input and takes no bid. Before the switch an older answer is the rules of before. |
| CI-14 | medium | A sale keeps a card's injury, and the agent could bid on a card out for 27 days without seeing it | The auction lines show injury, ban and yellow cards, and the bid's own check reads the card's record right before the bid: the injury goes into the bid's notes, and a card whose injury cannot be read takes no bid. Whether an injured card is worth its price is the plan's call, however long it is out (the owner, 2026-11-10; a first version refused one out for more than 72 hours). |
| CI-6 | low | An injured or suspended card cannot be fused in FoxLeague's app; its contract sees neither, and FoxLeague's own pre-check learns the rule only with its next release | The fusion rule refuses both, whatever the pre-check answers. |
| CI-8 | low | A tournament entry was judged on the squad as it is now, though its first lineup locks at its start | The injury check of an entry is taken at the tournament's start: a starter healed by then plays, one still out refuses. |
| CI-12 | low | The schedule's wear counted the condition of a card that plays none of it | A card injured past the tournament's last match adds none. |
| CI-7 | low | A casual test could name an injured card, which FoxLeague would replace: not the eleven under test | Refused; a saved eleven with an injured starter carries a note (saving is free, the next match may fall after the injury). |
| CI-1, CI-2 | low | The snapshot showed nothing of yellow cards, bans or injuries, nor the switch | Each card's marks (INJURED-until, SUSPENDED, yellow n/3), the "Cards and injuries" line with the switch, the injured starters and the suspended cards of the 18. |
| CI-9, CI-10 | new feature | Medicine is a new Shop product with a route of its own; `/shop/confirm` refuses it | `buy` product `medicine` for one injured card and whole days: priced only by FoxLeague's quote for exactly those days (unread or not matching: refused), within Max shop payment and the daily cap, booked before the signature, one `shopPay`, confirmed on `POST /api/shop/medicine`; `tx_pending` or no answer keeps the hash and the pending retry confirms it on the same route, never a second payment. No cap was raised. |
| MED-1 to MED-3 | design (the owner, 2026-11-10) | Medicine had no count of its own | `medicineDaysPerWeek`: the days of medicine in any 7 days over all cards, from the agent's own purchases (sent or answer-lost ones count, refunded ones do not; a purchase whose days cannot be read leaves the count unknown, which refuses). Per level 0, 2, 4, 6, 12, 18; 0 refuses. A raise asks for the password. An agent saved before it existed reads 0: it could buy no medicine before, so a count above 0 is the owner's to set. |
| CI-11, CI-13 | low | The prompt and the game manual copy held none of these rules (the manual's players page, which states the bans and the injuries, was left out with the app walkthroughs) | The prompt states them, with the forfeit penalty and the medicine action; the manual copy takes in the players page and is synced to FoxLeague's `e5e819e03`; the other getting-started pages stay out, each by name. |
| LIVE-1 | low | A 1v1 stake signed just before the team's busy hour reaches the join after it: refused, refunded, the gas lost. FoxLeague now serves the seconds until that hour (`viewer_tournament_window_opens_in_secs`) | A 1v1 join is refused when it opens within 120 seconds. |
| CI-15 | low | FoxLeague promoted its release to its main on 2026-11-10 (its #715): the manual copy of 9 November still said a fused card starts healthy and with no ban, next to a prompt that says an injured or suspended card cannot be fused, and gave a forfeit no ELO cost after 13 November | The manual copy is synced to FoxLeague's main at `2913ee7df`: fusing clears no injury and no ban, the Fusion tab refuses such a card, a forfeit costs the full K of its level from 13 November. No rule of the agent changed: its fusion rule refused these cards already |

PR #58's review (pass, two lows). R58A-1: LIVE-1 guarded only the join by FoxLeague's own count, which is absent for
a create and can be null for a join; the agent's own reading of the busy hour (`oneVOneBusy`) used exactly one hour, so
a stake signed in its last minutes was refused at the join gate (refunded, the gas lost). The same 120 seconds are now
added to that hour, for the create and the join. R58A-2 (tests only, no change of code): a tournament the agent
creates is judged at its start, and a final medicine refusal heard by the pending retry stops counting.

Stays open:
- The forfeit penalty's switch is not served in `/api/config`: the prompt states the rule as FoxLeague announced it.
  FoxLeague's fusion refusal and its forfeit penalty reached its main on 2026-11-10 08:39 UTC (its promotion #715 of
  the release branch at `2913ee7df`, the commit this review read), and the manual copy is synced to it (CI-15).
  One commit waits on its release branch after that (`582b06f5e`: a ban or an injury still owed to a fused card is
  carried on when that card is fused again), which asks nothing of the agent: it fuses no injured or suspended card.
- The MetaStaking discount on Shop prices (1 December 2026): FoxLeague's code only computes the percent so far and no
  payment check reads it. The agent pays list prices in exact amounts, and an amount FoxLeague does not take comes
  back whole. Read how a wallet's price is quoted before that date.
- Medicine was never bought on mainnet before the switch (no card can be injured until then): its first live
  purchase is the first real test of the route. A wrong amount, a healed card or too many days comes back whole.
- The most days a quote sells can fall by one between the quote and the confirm (a day served meanwhile): the payment
  is then refunded and the gas lost.
- A rival's lineup strength counts its injured and suspended cards as able to play: an overestimate, the safe side.
- The prompt still words the competition levels as a switch ("once the levels are live"); they are live since
  9 November and the snapshot says so. A rewrite is cosmetic.
- The formations offered for a casual test count injured cards as fieldable; a test eleven that names one is refused.


## The agent review on GitHub runs Claude Fable 5.2 at high effort (2026-11-10)

The owner's choice: the agent review of every pull request runs Claude Fable 5.2 at high effort. Until now it ran
Claude Opus 5.5 at extra-high effort. Nothing else of the review changes: the prompt, the tools it may use, the
workspace gate, the verdict script and the backup token are the same.

The audits run from the maintainer's machine change with it: the reviewers are Claude Fable 5.2 at extra-high effort
(they were Claude Fable 5.1 at max effort) and the fixes are made by Claude Fable 5.2 at high effort (they were made
by Claude Opus 5.5 at extra-high effort). The method stays: a finding counts only with a test that fails before its
fix and passes after it.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| REV-1 | design (the owner, 2026-11-10) | The review that gates `main` ran a model and an effort chosen in October | `.github/workflows/claude-review.yml` pins `--model claude-fable-5-2` and `--effort high` in the one place both tokens read; `AGENTS.md` names them; a test pins both |

Stays open:
- The first `merge-check` after this change is the first run of the new model in the workflow. A token that cannot
  reach it leaves no verdict, which is a red review and no merge (fail closed), never a pass.
- This pull request changes `.github/`, so the review fails it on purpose: the maintainer checks it by hand.


## The agent review before the repository goes public: the diff it reads and its working directory (2026-11-11)

The final audit before the launch (Claude Fable 5.2 reviewers at extra-high effort, read-only) read the review workflow
as a stranger's pull request will meet it once the repository is public. It found two gaps in the steps that prepare
the checkout for the reviewer. The fixes were made by Claude Fable 5.2 at high effort. The workflow cannot run outside
GitHub, so `test/review-workflow.test.ts` takes each step's own `run:` script from the YAML and runs it with bash in a
throwaway git repository shaped like the job's checkout (HEAD is the pull request merged onto `main`, HEAD^1 is `main`).
Each test failed on `main` (`5f88dc8`) and passes after its fix. Nothing else of the review changes: the permissions,
the secrets, the model and the effort, the tools, the workspace gate and the verdict are the same.

What was read for REV-2: Bun's and npm's documentation of where they look (Bun: the local `bunfig.toml` of the project
root and `.env`, `.env.local`, `.env.development`, `.env.production`, `.env.test` and their `.local` forms, with the
global `.bunfig.toml` in the home folder; npm: the `.npmrc` of the project root, not read in global mode), and the
source of the action at the pinned commit (`1d6de8c`, v1.0.248).

| Id | Severity | Finding | Fix |
|---|---|---|---|
| INSTALL-21 | low | The step that writes the diff the reviewer reads forced a text diff only for a list of text extensions. In any other file (`.astro`, `.mts`, `.cts`, `.service`, `.svg`, a file with no extension) one NUL byte, which is legal inside a JavaScript comment, made git print "Binary files differ": the code a pull request added there was neither in `pr.diff` nor in the file's own diff | Every file is diffed as text. Only the known binary kinds (png, jpg, jpeg, gif, webp, ico, woff, woff2, pdf, zip and gz, in any letter case) are left to git, whose diff still says that the file changed, without its bytes. Text under such a name is still shown. |
| REV-2 | low (hardening) | The clean-up before the review removed what steers Claude Code and left what steers the programs that run it: `bunfig.toml`, `.bunfig.toml`, `.npmrc`, `.env` and `.env.*` of the pull request stayed at the root of the checkout, which is the working directory of the action (a Bun program) with the review token and GITHUB_TOKEN in reach. A `bunfig.toml` can name code that runs first (`preload`) and a `.env` can point the review token at another host. The action as pinned starts Bun with `--no-env-file` and its own `--config`, so none of them was loaded: the protection was the action's, and a later version could drop it | The same step removes them at the root before the action runs. `.env.example` stays: a template that nothing loads, and the one `.env.*` this repository tracks. Neither Bun nor npm looks below the working directory, so the same names deeper in the tree stay readable. The prompt tells the reviewer which root files it cannot open and that a change to them is read through `gh pr diff` or `.review-diff/files/`, which are made from the commits and not from the folder. |

Stays open:
- The change itself could not be run on GitHub before the merge. A pull request that changes `.github/` fails the
  review on purpose and the maintainer checks it by hand, so the first `merge-check` after the merge is the first real
  run of both steps. The tests ran their shell with this machine's bash and git, with a stand-in for `gh`.
- A model's verdict is one gate beside the maintainer's own approval, never in place of it. The diff now shows every
  added line, and whether the reviewer weighs each one is still the model's reading.
- A file named as one of the binary kinds is left to git, so a NUL byte still hides text added under such a name.
  Nothing runs a file with such a name by itself, and the line that would load it is in the diff.
- A binary file of a kind that is not on the list (a font, a database, a video) now reaches `pr.diff` as raw bytes.
  That is noise for the reviewer and no way past it. The step sets no size limit on the diff, as before.
- `STAT.txt` still counts a text file that holds a NUL byte as "Bin": the summary is git's own and was left as it is.
- The action's own list of what it takes from the base branch also names `.claude.json`, `.gitmodules`, `.ripgreprc`
  and `.husky` at the root (read in its source at the pinned commit, not seen running). The workflow's clean-up does not
  remove these and relies on the action for them.
- Whether the Claude Code program that the action installs reads anything else from its working directory at start
  could not be checked from here.


## Shadow plans, Claude Haiku 5.5 and the model list of four (2026-11-11)

The owner wants to know how a cheaper model would manage the teams without letting it play and without disturbing
the model that plays. A **shadow plan** answers that: right after the service has made an agent's real plan, it sends
the very same request (the same system text and manual, the same user request word for word, the same tools) to a
second model and only records what that model would have done. A shadow plan is never carried out, never shown to the
playing model and changes nothing the agents play by. It is off by default and has no dashboard control and no
Telegram command: it adds AI spend, so it is switched on only on the machine itself (`docs/SERVER.md`).

On the same day the owner fixed the list of models to four (Haiku 5.5, Sonnet 5.5, Opus 5.5, Fable 5.2). The work was
done by Claude Fable 5.2 at high effort, test first: the tests are `test/model-list.test.ts`,
`test/shadow-plan.test.ts` and `test/shadow-readers.test.ts`. Each failed on `7f5d434` (the models) or before the
shadow code existed; where a test was written next to its guard, it was seen failing with the guard taken out again.
SHADOW-8 and SHADOW-9 passed from the start (a row of kind `shadow` matches no query by kind and has no transaction
hash): they pin that. The half of HAIKU-1 about the request passed from the start too (the strategist already sent
any model the same request and read a refusal before the content).

| Id | Severity | Finding | Fix |
|---|---|---|---|
| SHADOW-1 | design (the owner, 2026-11-11) | No way to see what another model would plan on the agents' real situations without letting it play | After the real plan's actions are handed to `runPlan` as before, the tick starts the shadow request and does not wait for it. It goes through a second `Strategist` object made for the shadow model (its own connection, cache decision and fallback memory; sent once, the connection's own retries off). What comes back is turned into plain frozen data (`recordPlan`): one activity row of kind `shadow`, status `info`, and one row of the new table `shadow_plans`. The executor gets exactly the real plan's actions; a bid only the shadow proposed is never run, booked or simulated (test (a)) |
| SHADOW-2 | design (the owner, 2026-11-11) | A second request per plan could fail, hang or answer nonsense and take the tick with it; a rejection nobody catches turns the kill switch on (`panic`) | Every failure stays inside the shadow code: an error, a refusal, a cut-off answer, an answer without the tool call and no answer within 10 minutes are each recorded in one line and never asked again. The tick's answer, the actions run, the rows written and the next tick are the same as without a shadow, and nothing reaches the panic handler (test (b), eight ways to fail). One shadow request per agent at a time |
| SHADOW-3 | design (the owner, 2026-11-11) | The next plan reads the agent's recent activity and its previous plan in full: a shadow row there would be another model's words passed off as the agent's own past | The plan request reads `Store.planHistory` (the activity without kind `shadow`, so it keeps its 20 real rows), and `renderPlanRequest` leaves such a row out once more whatever a caller passes. A shadow plan writes no `last_plan_N`, no chat and no kv. Seen failing first: the next request held the shadow's summary (test (c)) |
| SHADOW-4 | design (the owner, 2026-11-11) | A feature that doubles the requests must cost nothing while it is off | `shadow_model` and `shadow_effort` in kv, else `AGENT_SHADOW_MODEL` and `AGENT_SHADOW_EFFORT`; not set, empty or `off` means off. A model that is not on the list, or the model that plays, means off and is said once in the log. Off: one request per plan and nothing written (test (d)) |
| SHADOW-5 | design (the owner, 2026-11-11) | A deploy must not wait for a shadow request, and an answer that arrives during the stop must not write | The shadow is not among what `stop()` waits for; the stop cancels the open request, and the shadow code writes nothing once the service is stopping (test (e)) |
| SHADOW-6 | design (the owner, 2026-11-11) | Rule 1: no path from model text to a signature may be added | `src/strategist/shadow.ts` imports nothing of the executor, the wallets or the chain; the service's shadow code names no executor, wallet, `runPlan` or booking; a recorded action is a frozen copy with a type the compiler refuses where a planned action is asked for (test (f), with a `@ts-expect-error` line that the type check holds) |
| SHADOW-7 | low | The daily summary counted every kind outside a short list as an action: a shadow row with a status other than `info` would have counted as done, refused or failed | `shadow` is in the summary's list of kinds that are not actions, and it is not a plan either. Seen failing first with rows of every status |
| SHADOW-8 | pin | The executor's counts (1v1s per rival, own creations, match starts, boosters, packs, medicine, bids, own seats) read the activity by kind | No change needed: none asks for kind `shadow`. A test logs shadow rows whose detail looks like a purchase, a 1v1 and a bid, shows every count unchanged and shows that a real purchase does count |
| SHADOW-9 | pin | `everUsed` (may this agent be deleted) reads the activity for a transaction hash | A shadow row has none |
| SHADOW-10 | design (the owner, 2026-11-11) | See SHADOW-3 | `planHistory` and the filter in `renderPlanRequest`, each seen failing alone |
| SHADOW-11 | low | The dashboard's Actions filter showed every kind but plan, tick and control: a shadow row would have been listed as an action | A shadow row carries the mark "shadow plan, not carried out" in place of its status; the Plans, Actions and problems filters leave it out; a filter of its own appears while the list holds one; the Activity bubble says what it is |
| SHADOW-12 | design (the owner, 2026-11-11) | A record for later analysis must not grow without bound, and a database change must stay additive | The table `shadow_plans` is new and only the report reads it: an earlier version never looks at it. Each insert drops what is older than the newest 2,000. Deleting a never-used agent deletes its rows |
| SHADOW-13, SHADOW-14 | design (the owner, 2026-11-11) | The owner needs the numbers without reading the database | `cli shadow-report [N]`: how many, how many with a valid tool call, actions parsed, how often the same action types as the real plan of the same tick, average cost and time, the last pairs side by side. It opens the database read-only, so it runs next to the service and creates nothing |
| HAIKU-1 | design (the owner, 2026-11-11) | Claude Haiku 5.5 was not on the list. Its price has two rate cards chosen by the length of the prompt, which one price per model could not hold | `claude-haiku-5-5`, first on the list: $0.10 in and $0.50 out per million tokens when the prompt is 100,000 tokens or fewer, $0.50 and $2.50 when it is longer; cache reads 0.1 times and one-hour cache writes 2 times the input price of the card in force; the card is chosen per attempt. It takes the strategist's usual request (adaptive thinking, the model chooses the tool, the effort said, a refusal read before the content) and has no server-side fallback |
| LIST-1, LIST-8 | design (the owner, 2026-11-11) | The list offered six models, three of them replaced by a newer one of the same tier at the same price or less | The owner chooses among four: Haiku 5.5, Sonnet 5.5, Opus 5.5, Fable 5.2. `/api/strategist` accepts only these; the dashboard shows a greyed-out "Local model (free, coming soon)" above them that has no id and cannot be picked or sent (LOCAL-1) |
| LIST-2, LIST-3 | medium | One table served as the list and as the prices. With Sonnet 5, Opus 5 and Fable 5.1 off the list, a declined request that Anthropic re-runs on Opus 5, Opus 4.8 or Sonnet 5 would have been booked at the wrong price | `PRICES` holds every model a request can be served by (the four, Sonnet 5, Opus 5, Opus 4.8, Fable 5.1); `MODELS` is what can be chosen |
| LIST-4 | medium | `cost()` booked a model it had no price for at Sonnet 5's price without a word: an Opus 4.8 fallback at $2 in where it costs $5 (so on `main` too) | Such a model is booked at the price of the model that was asked for, or at the dearest price known when that one has none either, and the log says so. Never free, never an error |
| LIST-5, LIST-9 | design (the owner, 2026-11-11) | An install that saved Sonnet 5, Opus 5 or Fable 5.1 must keep working | Where the choice is read, a model that left the list becomes its successor (Sonnet 5.5, Opus 5.5, Fable 5.2: the same or less on every price). The dashboard's saved choice is saved again as the successor and said once, in the log and in the activity; `AGENT_MODEL` is said once per run |
| LIST-6, LIST-11 | design (the owner, 2026-11-11) | A new install played on Sonnet 5 | The default is Sonnet 5.5 (`src/config.ts`, `.env.example`); the pages that name the default or the list follow |
| LIST-7, LIST-10 | medium | The password rule compared the three prices of one card. With two cards a switch to Haiku 5.5 would have been judged by its cheaper card alone | Another model asks for the password when the highest of any of its prices over its cards is above the lowest of the current model's; the same model keeps its prices and only the effort decides; a current model that left the list counts as its successor and one without a price as dearer. The dashboard applies the same rule from the same numbers |

The agent review of pull request #63 (Claude Fable 5.2 at high effort, on 90270a3) passed it with two findings. Each
was fixed test first, the test seen failing before its fix:

| Id | Severity | Finding | Fix |
|---|---|---|---|
| R63A-1 | medium | Rule 7: a one-click switch to a cheaper playing model could wake a shadow model that rested because it was the model that plays. With `shadow_model` on Fable 5.2 and Fable 5.2 playing, a click on Haiku 5.5 made every plan cost Haiku plus a Fable 5.2 shadow plan: the AI bill rose with no password (`/api/strategist` answered 200) | `wakesShadow` in `src/web/server.ts`: a switch that starts shadow plans (a shadow model is set, it is the current playing model and the next one is another) asks for the password like a dearer model. The page is told which shadow model is set and applies the same rule, with a dialog that says why. Pinned: a shadow that runs before and after changes nothing, a switch to the shadow's own model is judged by the prices as before, the effort alone never wakes it, and `AGENT_SHADOW_MODEL` counts like the database's setting |
| R63A-2 | low | `prepareShadow` read the playing model and effort after the plan's answer had come. A switch of the strategist while the request was on its way put the new model and effort on the earlier model's plan, in `shadow_plans` and in `shadow-report`; the plan's own row called it a fallback for the same reason | `makePlan` reads the model and effort before it awaits the answer and carries them with the plan: the record, the choice whether a shadow runs and the "served by" note all use them. Tested with a switch made while the plan request was in flight |

Stays open:
- The reading of Haiku 5.5's two rate cards comes from Anthropic's wording, not from an invoice: "the prompt" is taken
  as every input token of the request (uncached input, cache reads and cache writes). The system text and the manual
  are about 276,000 characters, so a plan's prompt on Haiku's tokenizer can fall on either side of 100,000 tokens.
  Compare the first days with the Anthropic console.
- A shadow plan is judged by people or by `shadow-report`, not by the rules: its actions are parsed, never checked
  against the game rules, the caps or a fresh snapshot. "The same action types" says nothing about which plan was
  the better one.
- A shadow plan doubles the requests of a plan, at the shadow model's price, and the AI spend has no cap of its own.
  Its cost is in the dashboard's AI spend. A request that was cancelled (a stop, or no answer in 10 minutes) or that
  failed is billed by Anthropic for what it had produced and is not in that figure, as for a real plan that fails.
- The shadow answers the same words, not at the same moment: it starts when the real plan is made and may finish up
  to 10 minutes later. An owner's one-off request (Telegram `/do`) gets a shadow plan like any other plan.
- `AGENT_MODEL` may still name a model that is neither on the list nor has a successor (one newer than this version):
  it is asked as before and booked from `PRICES` or as LIST-4 says.
- How well Haiku 5.5 plays this game has not been measured: that is what the shadow plans are for.

## Several shadow models at once (2026-11-12)

Since the section above the service could send each real plan's request to one second model, the shadow model, and
record its answer. The owner wants to compare several cheaper models with the playing one on the same situations, at
the same moment. `shadow_model` (else `AGENT_SHADOW_MODEL`) now holds one model id or several separated by commas.
Each real plan gets one shadow request per shadow model that runs. Nothing else of a shadow plan changed: it is never
carried out and never shown to the playing model. It is still switched on only on the machine itself.

The work was done by Claude Fable 5.2 at high effort, test first. The tests are in `test/shadow-plan.test.ts`,
`test/shadow-readers.test.ts` and `test/model-list.test.ts`, named after the ids below. Each was seen failing
before the code it tests changed. Where a test of the section above pinned the single-model shape (the function
`shadowChoice`, the state field `shadowModel`, `wakesShadow` taking one model, "the last section of this file") or
the words "a second model", it was moved to the list shape and still proves what it proved.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| SHADOWS-1 | design (the owner, 2026-11-12) | One shadow model at a time: to compare two cheaper models with the playing one, the owner had to run them on different days, so on different situations | Each real plan leaves one job for every shadow model that runs. After the real plan's actions are handed to `runPlan`, as before, the tick starts all the shadow requests together and waits for none. Each goes through its own `Strategist` object, one per shadow model and kept by its model id (own connection, cache decision and fallback memory; sent once, the connection's own retries off). Each answer is one activity row of kind `shadow` and one row of `shadow_plans`, both next to the same recorded real plan. Its cost is added to the AI spend. The executor still gets exactly the real plan's actions |
| SHADOWS-2 | design (the owner, 2026-11-12) | The setting is typed by hand on the machine. A list invites a typing mistake, the same id twice and the playing model among the entries. One bad entry must not decide for the others | `shadowChoices` reads the entries: an id the list of models does not have is left out with its reason, the model that plays is left out (it rests), a repeated id counts once and the others run. Empty or `off` means none, as before. `off` anywhere among several switches all of them off, so a half-typed setting never costs anything. Only what a model id can hold reaches the log, at most 60 characters of an entry. No more than 16 entries are read. A single saved id behaves exactly as before. `shadow_effort` stays one effort for every shadow model |
| SHADOWS-3 | pin | The reason an entry does not run must be said once, not at every plan of every agent. The setting is read before every plan | The service keeps the line it said last: "shadow plans run by A, B only: ..." when some run and "shadow plans are off: ..." when none does (the words of the section above for a single id). A corrected setting takes effect at the next plan without a restart and without a word |
| SHADOWS-4 | design (the owner, 2026-11-12) | With several requests per plan, one that throws, is refused or never answers must not take the others, the tick or the kill switch with it (a rejection nobody catches reaches `panic`) | Each shadow request is started inside its own `try` and carries its own `catch`. One shadow model that throws, rejects or hangs past its 10 minutes is recorded as such in one line and the other's plan is recorded in full. The tick's answer, the actions run and the rows written are the same as without shadow plans. Nothing reaches the panic handler. Tested with either model written first |
| SHADOWS-5 | low | The guard "the earlier shadow request is still on its way, skip" was per agent. With two shadow models, one slow model would have held back the other model's next shadow plan too | The guard is per agent and per shadow model. A model that is still answering skips only its own next shadow plan of that agent; another model and another agent are not held back |
| SHADOWS-6 | pin | A stop must wait for no shadow request, however many are on their way. Nothing may be written after it | Unchanged code, tested with two requests in flight: each is cancelled with the stop and the stop does not wait. Answers that still arrive write no row, no cost and nothing else |
| SHADOWS-7 | pin | Two shadow rows per plan in the activity: the next plan's history must still hold none of them | Unchanged code (`Store.planHistory` and the filter in `renderPlanRequest`), tested with two shadow models: the next request holds nothing of either shadow plan; each shadow model is asked that next request word for word |
| SHADOWS-8 | low | A new Anthropic key from the dashboard was handed to the one shadow strategist. With one object per shadow model, any that was missed would keep asking with the old key until the next restart | `updateKeys` hands the new key to every shadow strategist |
| SHADOWS-9 | design (rule 7) | The password rule had to follow the setting. `wakesShadow` compared one shadow model with the playing one. Left as it was, no entry of a list would have counted: with `shadow_model` on Haiku 5.5 and Fable 5.2 while Fable 5.2 plays, a click on Sonnet 5.5 would wake the Fable 5.2 shadow with no password asked. From then on every plan would pay for a Fable 5.2 shadow plan. No version ran that way | `wakesShadow` takes the list (`shadowModelsSet`: the entries of the setting that the list of models has, each once, whatever model plays). It is true when the current playing model is one of them and the next model is another model. That holds when the next model is itself a shadow model: it goes to rest, but the one that played wakes. The rule does not weigh the two costs. `/api/state` sends `shadowModels` in place of `shadowModel`; the page applies the same rule (compared with the server's over every pair of models, with none, one, two, three and four shadow models set) and its dialog names the models. There is still no dashboard, Telegram or web path that writes `shadow_model` or `shadow_effort`: a test posts both to `/api/strategist` and reads every source file for such a write |
| SHADOWS-10 | design (the owner, 2026-11-12) | `shadow-report` summed every shadow plan into one block. That would mix the models it is meant to compare. It also printed the real plan once per shadow row | With several shadow models the numbers (count, valid tool calls, actions proposed and parsed, same action types as the real plan, average cost and time) are given once per model. "The last N" lists real plans, each with one line per shadow model below it. The rows of one real plan are found by what they hold: the same agent, the same recorded real plan, recorded within the time one tick's shadow plans can take, each model once. The database is not changed. With one shadow model the report reads as before |
| SHADOWS-11 | docs | The guides spoke of one second model | `docs/SERVER.md` (the command for several, what an entry that does not run means, the password rule with a list, the one effort, the report), `.env.example`, the CLI's help, the README, the costs, dashboard and server pages of the site and the dashboard's Activity bubble follow |

What was checked on the finished change:
- No path from a shadow answer to a signature. `src/strategist/shadow.ts` still imports nothing of the executor, the
  wallets or the chain. The service's shadow code (from `startShadow` to the end of `shadowPlan`) names no
  executor, wallet, `runPlan`, booking or plan's actions: SHADOW-6 of the section above reads the new code and
  passes. What is kept of an answer is still the frozen copy of `recordPlan`. With two shadow models that both
  propose a bid, the executor ran the real plan's two actions and nothing was booked (SHADOWS-1).
- The password rule with a list, on the route (403 without the password, 200 with it) and on the page, for every
  pair of models (SHADOWS-9). While the service runs, the playing model is switched only through `/api/strategist`.
- The cost of each shadow plan is booked: every shadow answer adds its own cost to the AI spend before its row is
  written and a shadow that failed adds nothing. The total of a plan with two shadow plans is the sum of the three
  (SHADOWS-1, SHADOWS-4).
- R63A-2 of the section above holds: the playing model and effort are read before the plan's answer is awaited;
  every shadow row of that plan carries them.

Stays open:
- Each shadow model adds its own cost to every plan of every agent, at that model's price. The AI spend has no
  cap of its own. Two shadow models make three requests of every plan. Each shadow model also keeps its own prompt
  cache of the manual.
- A shadow request that was cancelled (by a stop or after 10 minutes without an answer) or that failed may be billed
  by Anthropic for what it had produced and is not in the AI spend figure, as before. It can now happen once per
  shadow model.
- A switch between two models of the list asks for the password although one shadow model goes to rest as the other
  wakes. The rule is the careful one: it does not weigh what the two cost.
- All shadow requests of a plan start at the same moment and count against the same Anthropic rate limits as the
  real plans. A shadow request that is refused for the rate is recorded as an error and not asked again. Whether many
  shadow requests can slow the real plans of other agents was not measured.
- The report groups the shadow plans of one real plan by what the rows hold, not by an id. Two plans of one agent with
  the very same words, actions and cost, made within 11 minutes of each other, can stand under one real line. The
  numbers per model are not touched by it.
- `shadow_plans` keeps the newest 2,000 rows of all shadow models together, so with two models it reaches half as far
  back.
- The effort is one for every shadow model. A model that would need its own effort to be compared fairly cannot have
  it yet.
- What stays open in the section above stays open: a shadow plan is judged by reading it, never by the rules.

## Mac install check (2026-11-12)

The owner installed the release candidate on his MacBook Air (macOS 15.7.3 on arm64, no Node.js before) with the
pasted line, then updated and uninstalled it. Five findings, all low, none about money, keys or signing: MAC-1 to
MAC-4 from the check and MAC-5, the one item it left open, done on the owner's go of 2026-11-13. They were fixed test
first by Claude Opus 5.5. The tests are in `test/mac-check.test.ts` (and the route test of MAC-5 in
`test/update-service.test.ts`), named after the ids below; each was seen failing before its fix. The final audit
follows this section, and the sections of 2026-11-13 come after it.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| MAC-1 | low | The install left npm's cache outside the agent's folder. On the Mac `deps()` (`npm ci`) created `~/.npm` (5.8 MB: the download cache and a debug log); after `./install.sh --uninstall` and deleting the folder it stayed. An update's prepare runs the same npm | `deps()` runs npm with `npm_config_cache="$ROOT/.npm-cache"` in the install, in an update's prepare and in the update of a git checkout: npm's cache and its logs stay in the install's folder and go with it. A git checkout ignores `.npm-cache/`. No other script of an install runs npm. The Update page no longer says that `~/.npm` stays |
| MAC-2 | low | INSTALL.md and the Update page said that the folder takes about 190 MB. Measured on the Mac: Node.js (`.node`) 189 MB and 42 MB for each release folder, so about 231 MB after the install and 273 MB after an update (the running release and the one before it are kept for the undo) | Both say "about 240 MB, and about 280 MB once an update has kept the release before it", which counts npm's cache (about 6 MB) that MAC-1 moved into the folder. No other page, script or the dashboard states a size, and none says 190 MB |
| MAC-3 | low | After an update that did not start and was undone, the dashboard's notice gave the updater's message and then "Version 1.0.3 is out. You run 1.0.2." with the button **Update now**. The owner asked twice whether he had to press it to get back to 1.0.2 | When the release on offer is the very one that was just undone here, the notice says "Nothing has to be done: the agent keeps running 1.0.2." and the button reads **Try again**. A newer release keeps the usual words and **Update now**. The updater's message is unchanged (Telegram sends it). The info bubble and the Update, Dashboard and Troubleshooting pages say the same |
| MAC-4 | low | `./install.sh --uninstall` printed "The agent wallets still hold their funds. Keep the backup words" without reading a balance, so also for empty wallets | It prints "The agent wallets may still hold funds. Keep the recovery words; delete the folder only when the wallets are empty." The Windows uninstall (`get.ps1 -Uninstall`) and the Update page said "keep their funds" and now say "may still hold funds". No balance check was added |
| MAC-5 | low | The dashboard had no "check for updates now". The route `/api/update/check` existed, but the page never called it. A check comes 30 to 90 seconds after a start, then every 10 to 11 minutes; only a terminal asked at once (`./cli.sh update-check`). The check left it open as the owner's call; done on the owner's go on 2026-11-13 | **Check for updates**, a round arrow between the version and its info bubble, shown only where the agent checks for updates. Its title and aria-label name it and the version's bubble explains it. A link with a bubble of its own first made the header wrap at 1280 px, where it held one row before: the version, the arrow and the bubble now form one tight group and the brand's gap is 8 px (as on a phone), so the header is 3 px narrower than before at every width. It calls `POST /api/update/check` through the page's `api()` (session and CSRF token, no password: it installs nothing), puts the answer in the page's state, shows the notice at once and says the answer in a short message; for the release that was just undone here it says that nothing has to be done (MAC-3). An error that is not the updater's own (a full disk, for example) reads "an unexpected error (see the log)" and goes to the log, where the message said "The check failed: the check failed." before. It is off while it asks (the arrow turns) and while an update installs. The updater asks the release server at most once in 15 seconds (`MIN_CHECK_GAP_MS`): a check sooner than that after the last one, or while one runs, gets that check's answer, so a page or a stuck double click cannot hammer the server. The check every 10 to 11 minutes is unchanged. Tried in headless Chrome against a test service at 1280, 1440, 1470, 1512 and 390 px: one row at the four desktop widths, as before. The Update, Dashboard, Troubleshooting, FAQ and Safety pages, INSTALL.md, the README and docs/SERVER.md name it |
| MAC-5R | low (the release check only) | After MAC-5 the install replay (`scripts/release/fresh-install-check.sh`) failed four checks of step 11e: it published 1.0.5 four seconds after its check for 1.0.4, the dashboard's check gave the last answer (one ask in 15 seconds) and Update now installed 1.0.4 again. Steps 11c, 11d and 11f followed the same pattern, a check and then Update now, and 11c and 11d could meet the same race when the agent's own check came just before | Before each Update now the replay waits, bounded at 60 seconds, until the agent offers the version just published (`offered` and `offered2`: the dashboard's check, then the state). The test "MAC-5 and the install replay" reads the script and failed before the fix. The replay of 2026-11-13 passes: 92 checks, none failed. No code of the agent changed |

What passed on the Mac:
- The install on macOS 15.7.3 on arm64 with the system's bash 3.2 and without Xcode's command line tools, and the
  background service under launchd.
- The one-click update, found after the Mac had slept.
- The update from the terminal (`./install.sh --update`), with the oldest release folder removed.
- A release that does not start, undone in about 20 seconds under launchd.
- The uninstall, which left no service, no process and no port of the agent.

Stays open: nothing of this check. The item it left open is MAC-5 above.

## Final audit before the public launch (2026-11-11): six Claude Fable 5.2 reviewers at extra-high effort, the fixes by Claude Fable 5.2 at high effort

The last audit before the repository opens. Six reviewers (MONEY, ATTACK, EDGE, INTEG, INSTALL, DOCS) worked read-only,
one area each, on the frozen tree `ac8833f`; INTEG also read FoxLeague's main of that day (`9f65786f3`) and its live
`/api/config`, and INSTALL drove the real installer on a pseudo-terminal. A finding counted only with a proof that
fails while the defect exists. Three fixers and one for the pages then worked test-first: each proof was seen failing
before its fix, and the proofs are kept under `test/audit-1111/`.

No critical and no high finding, and no way past the hard caps: every loss of track that was found counts a payment
too much, never too little, and no path pays twice.

| Area | Findings | Medium | Low |
|---|---|---|---|
| MONEY | 4 | 2 | 2 |
| ATTACK | 8 | 2 | 6 |
| EDGE | 8 | 1 | 7 |
| INTEG | 6 | 0 | 6 |
| INSTALL | 21 | 5 | 16 |
| DOCS | 14 | 6 | 8 |
| All | 61 | 16 | 45 |

Some are one defect seen from two areas, and share a row below: EDGE-2 is ATTACK-3, EDGE-5 is INTEG-5, EDGE-7 is
INTEG-6, MONEY-3 is INTEG-4, DOCS-5 is INTEG-2, DOCS-2 is INSTALL-1 and INSTALL-15 is EDGE-8. The one-click update was
built while the audit ran, so the installer's findings about the old way of updating (INSTALL-1, INSTALL-2,
INSTALL-16, the first half of INSTALL-7) are closed by its design and held by regression tests; its own guarantees
are the rows named UPD-1 to UPD-20 and REL.

After the fixes the install was replayed the way a newcomer meets it, on a fresh Ubuntu 24.04 in a container that
runs systemd (`scripts/release/fresh-install-check.sh`, kept for every release: the pasted line, the mistakes, a
reboot, the updates, the undo and the uninstall). The owner also installed on a real Ubuntu desktop. That gave
fourteen more findings (FRESH-1 to FRESH-14, two medium and twelve low) and four in the updater and the service
(UPD-21 to UPD-24, two medium and two low). The agent review of pull request #61, which was merged into this
branch, gave R61A-1. They are not in the counts above and are the last rows. FRESH and UPD-21 to UPD-24 were fixed
test-first, with their tests under `test/audit-1111/` (`fresh-<n>`, `upd-<n>`); the test of R61A-1 is in
`test/review-web.test.ts`. The replay was then given a scenario for each of UPD-21 to UPD-24 under its real systemd
and run on the fixes on 2026-11-11: 88 checks, none failed.

The Windows one-line installer (`get.ps1`) was written after them, on the owner's decision that Windows stays on
WSL2 with one pasted PowerShell line. It is a new feature and not a finding, and WIN-1 is the last row.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| MONEY-1 | medium | A seated team counted as clearly stronger only when its ELO was more than 50 above ours and its lineup more than 5 percent above. A field of elevens twice as strong at our own ELO read "0 stronger" and the entry was paid | A lineup that was read decides alone once it is more than 10 percent above ours (`MAX_1V1_STRENGTH_RATIO`). Between 5 and 10 percent the ELO still has its say, and an unread lineup is judged on its ELO. The same count holds for Champions FoxLeague invitations. |
| MONEY-2 | medium (the owner's decision, 2026-11-11) | The 1v1 win chance averaged the ELO chance and the squad chance, so a rival whose eleven is 10 percent stronger (32 percent by the squads) read 56 percent once its ELO was about 250 below ours and passed the 55 percent floor | With both numbers read, the estimate is the smaller of their average and the squad-only chance: a rival's lower ELO may lower our chance, never lift it. With one number read nothing changes. The plan reads the same number. |
| MONEY-4 | low (not reachable today) | With Gold off, a join was refused only when the tier label read exactly `gold`. An unknown or missing tier with an entry far above the Silver ceiling passed | A tier that is not bronze, silver or gold is refused as unread, at any setting, and its label is not repeated. With Gold off, an entry or stake from the served `gold_min` up is refused whatever the label says, as is a paid entry while that bound cannot be read. |
| EDGE-1 | medium | The bid's inherited-lock guard and the plan's auction line read a moved card whose `transfer_cooldown_hours` is null as "no lock", although null is FoxLeague's default lock (504 hours, served in `/api/config`). A bid up to the rarity limit could go to a card that cannot play for about 21 days | One helper (`transferLockEnd`) for the wallet's cards, the auction line and the bid: the card's hours, else the served default, else 504. A move whose time cannot be parsed is unread and takes no bid. |
| INTEG-1 | low | The 1v1 match-fit count took any 11 fit cards of the 18. FoxLeague relieves a tired outfield starter only with a fit outfield bench card (the bench keeper never), holds injured bench cards out and refuses the join after the stake is paid (refunded, the gas lost) | `matchFit` counts the eleven shirts as FoxLeague fills them: an outfield shirt from the fit outfield bench cards, the keeper's from a fit bench keeper or an outfield card as the last resort. At a join and at a create. |
| INTEG-2 (DOCS-5) | low | The prompt and the manual copy stated an injury chance of 3 to 9 percent. FoxLeague runs 1 to 3 percent, made the chance and the days out Admin settings and serves the ones in force in `/api/config` `card_bans` | The snapshot's "Cards and injuries" line gives the chance and the days as served, and says so when they are missing. The prompt points at that line and names no number. The manual copy is synced to FoxLeague's manual at `89a1955d7`. |
| INTEG-3 | low (latent) | The bid's minimum raise was a 5 written in the agent. The contract reads a setting its owner may change from 1 to 50, served as `auction_min_increment_percent`. After a change every raise would revert and lose its gas, again at each plan | The rule reads the served percent (5 when the answer leaves it out, no raise when it is no whole number from 1 to 50 or the settings were not read). The refusal names it and the snapshot tells the plan. |
| INTEG-5, EDGE-5 | low | A paid join was refused only once the deadline had passed. FoxLeague checks it when `POST /join` arrives, so a payment signed seconds before it was refused and refunded with the gas lost. The pending retry then asked for an hour and raised an alarm for an entry already refunded | No paid entry and no 1v1 stake within 120 seconds of the deadline (`BUSY_OPENS_MARGIN_S`). A free seat needs none. A deadline that is no time is refused. The retry takes "Registration deadline has passed" as final when it answers the ask that carried the hash. |
| INTEG-6, EDGE-7 | low | A Common pack was refused only when the weekly quota read exactly 0. A shop status that failed, or an answer without the number, passed as "packs left", and 2,500 FOXSY were paid for a pack FoxLeague refuses at the confirm | Refused unless the number is finite and above 0. The snapshot tells the plan the packs left, or that they are unknown. |
| EDGE-6 | low | `GET /api/config` is read without the envelope and the client did not look at the HTTP status: a 403, 429 or 500 with a JSON body came back as a config object with none of its fields, past the rules' one guard | The raw path throws on a status outside 2xx without repeating the body. `config()` returns only an object that carries `registration_fee_wei` as an amount. The snapshot keeps `config` null with a warning and every rule refuses. |
| INTEG-4, MONEY-3 | low | Every refusal of the relay released the registration fee's booking, also FoxLeague's HTTP 500 after a failed broadcast and an answer that is not its envelope, although the signed transaction may have gone out | Only FoxLeague's own refusal with HTTP 403, 429 or 503 (its guards before the broadcast) releases it. The client carries the status on the refusal. Anything else keeps the fee booked. |
| EDGE-3 | low | A registration fee booked for a registration that never happened (a relay with no answer, or every dry run's simulated fee) refused each later registration by the one-time setup budget for good | A registration whose snapshot reads the fee as not paid leaves the earlier booking out of its setup-budget check and lets it go only once its own booking is kept. Refused, unsigned, turned away by a guard or reverted, the earlier booking stays: one booking always stands for the one fee the contract takes. The plan of a team that does not exist reads the setup budget without it. |
| EDGE-4 | low | A payment whose broadcast got no answer kept no hash on its ledger rows, although the hash was computed before the broadcast. Every refund check reads a row by its hash, so an outbid bid or a refunded shop payment kept counting | The rows are settled under the locally computed hash right after the signature, and the error row carries it. A row is credited only on the chain's or FoxLeague's own word about that hash, once. |
| ATTACK-2 | medium | A cross-site `POST /login` from any website the owner visits counted wrong passwords against the owner's own address and locked the owner out of the sign-in and of every password re-prompt. The plain Origin rule could not fix it: the dashboard's pages ask for no referrer, so a browser sends the dashboard's own form with `Origin: null` | Before the throttle is read, a sign-in from another site is refused uncounted (403). `Sec-Fetch-Site` decides where the browser sends it (only `same-origin` and `none` pass). Otherwise an Origin that names a host must be the request's Host, and `Origin: null` passes only with the sign-in page's own `SameSite=Strict` mark. A request with no Origin is judged by its password as before. Checked with Chrome against the real server |
| ATTACK-1 | medium | One IPv6 host was never locked out of the sign-in: the lock and the password queue counted the full address, and a host owns all addresses of its /64 | `LoginThrottle` and the queue count a client by `clientKey`: an IPv4 address, or the /64 of an IPv6 address. The nginx template holds `/login` to 30 requests a minute per address |
| ATTACK-6 | low | A logged-out session came back to life after a restart: the revocation lived only in memory | A keyed hash of each logged-out session and its expiry are kept in the store and loaded when the web starts. The session itself is never stored |
| ATTACK-3 | low | The 30 minutes of "unknown" for a top-up with a lost answer ran from the offer. An approval late in the code's hour was called "never went out" seconds later, and asking again sent a second withdrawal (also EDGE-2) | The time of the attempt is stored with the claim and again right before Binance is asked. The 30 minutes run from it; a row from an earlier version uses the end of its code hour |
| ATTACK-4 | low | A read slept for whatever an upstream's `Retry-After` said, up to days, inside a tick or under an agent's lock | A pause of up to 60 seconds is kept and is never shorter than the usual back-off. An upstream that asks for more is not asked again in that read: its answer comes back at once. A value that is no number and no date counts as none |
| ATTACK-5 | low | An upstream answer of any size was buffered whole before parsing: 256 MB cost about 780 MB of memory | The body is read as a stream and refused past 8 MB. A larger declared content-length is refused unread, and a compressed answer is counted by its unpacked size |
| ATTACK-7 | low | A tournament title written by the model had no impersonation check, unlike a team name | `parseAction` refuses a title that matches the same blocklist as a team name |
| ATTACK-8 | low | Link my Telegram read only the 20 earliest waiting messages: 20 lines from anyone hid the owner's code for a day, and an old line could match a new code | Every waiting message is read in pages of 100, and only one dated after the link was started counts. The offset moves only past a full page and only as far as the first message the service's own reader could still act on, so the owner's code and first commands stay waiting for it |
| EDGE-8 | low | A second copy of the service on the same data folder started, took the pid file and planned every agent a second time (also INSTALL-15) | `start()` refuses before writing the pid file when the pid in it is alive, is not its own and runs the service. A stale pid that now belongs to another program does not block a start, also when the server's unit cannot look at that process |
| INSTALL-5 | medium | `set_env` rebuilt `.env` with `grep -v ... \|\| true`. One NUL byte in the file made grep print nothing, so the new `.env` held only the line being set and the recovery words were gone. | `set_env` copies with `grep -a` under `LC_ALL=C`, treats a grep error as an error, counts the lines with `wc` before the new file replaces `.env` and stops when one would be lost. The file stays mode 600. |
| INSTALL-4 | medium | Enter at "Allow this machine to sign real transactions" turned signing on unless `.env` said exactly `AGENT_LIVE_ENABLED=0`. A line that was commented out, removed or set to false, off or no was offered as yes while the database could still say LIVE. | Enter means yes only when `.env` says 1 or true, or on a first install (no database and the setting nowhere in `.env`). Every other state offers no, also when a second line in another form decides what the agent reads. |
| INSTALL-8 | low | A first run that ended before the typed yes left the words in `.env`. Every later run said "Your existing wallet is kept" and never showed them again. | The typed yes is noted in `data/words-confirmed`. Until it exists every run of the installer shows the words and asks. INSTALL.md names `./cli.sh backup-words`. |
| INSTALL-13 | low | An empty `AGENT_MNEMONIC=` line, as `.env.example` ships it, counted as "words exist", so setup failed and the installer still said "A new wallet was created". | An empty line is filled in place and a line that holds anything is never replaced, an `export` line included. The installer stops with the setup's own message when no wallet was made. |
| INSTALL-14 | low | A system Node.js with no npm beside it was chosen and the installer stopped at `npm: command not found`. The version rule also accepted 23.x, 24.0 and 24.1, where the service loads and ends at once. | A system Node.js is used only when it is 22 from 22.18 or 24.2 and later and npm sits beside it. Otherwise the private copy is used. `engines` names the same range. |
| INSTALL-3B | medium | The private Node.js download was checked against a SHASUMS256.txt fetched from the same server. | The SHA-256 of the four archives of v22.22.0 is written in `install.sh` and the one of `deploy/bootstrap.sh` in that script. A download that differs is refused before it is unpacked. |
| INSTALL-6 | low | get.sh put an older version over a newer install without a word. The older code does not apply limits added since. | An older version is refused unless `FOXAGENT_ALLOW_DOWNGRADE=1`. The refusal names both versions and says that newer settings and limits would not be applied. |
| INSTALL-9 | low | get.sh took any folder with a `src` and a `package.json` for an older install and removed its src, docs and test. It also unpacked into a folder that held the owner's own files. | A folder is an older install only when its `package.json` names foxleague-agent. A folder that is neither an install nor empty is refused untouched. |
| INSTALL-10 | low | A download of get.sh that stopped part-way ran every complete line before the cut. On the new layout it could still move the running release away or remove a flat install's code and put nothing in place. | The body of get.sh is one function called on the last line. A cut script does not parse and nothing of it runs. |
| INSTALL-1 | medium | The update copied the new get.sh over the one bash was reading. | Closed by the release-folder layout. A regression test updates to a release whose get.sh and install.sh changed. |
| INSTALL-2 | medium | The update replaced the code before `npm ci` and had no way back. | Closed by the release-folder layout. A regression test fails the dependency install and checks that the running release still loads and is the one the launcher starts. |
| INSTALL-16 | low | The old get.sh copied the archive over the install, so an archive that held a `.env` replaced the recovery words. | Closed by the release-folder layout. In addition get.sh and the updater refuse, before unpacking, an archive that holds `.env`, `data`, `pem`, `keys`, `node_modules`, `.node` or a PEM file. |
| INSTALL-7B | low | An update whose restart failed ended with status 0 while the old version kept running. | A failed restart is an error that names the command to run. |
| INSTALL-15B | low | The first update of an install made with `--no-service` installed and started a background service beside the agent the owner runs by hand. | An update restarts a service only when one is installed and never installs one. The owner is told to start the agent again. |
| INSTALL-20 | low | Only the guided installer set the modes of `.env`, `data` and `pem`. An install copied to another machine was updated and started with the recovery words readable by every local account. | `--update` and `--prepare` set `.env` 600, `data` 700, `pem` 700 and `pem/*.pem` 600 when they exist. |
| UPD-strict | low | The updater checked the paths of an archive and not the kind of each entry. A symbolic link could point out of the release folder. | The updater and get.sh refuse, before unpacking, an archive that holds anything but plain files and folders. |
| INSTALL-17 | low | The installer ran as root without a word and set the agent up as a root user service. | As root the guided install and the pasted line stop with one sentence (create a user, or follow docs/SERVER.md) unless `FOXAGENT_ALLOW_ROOT=1`. |
| INSTALL-18 | low | On macOS the service's output went to `data/service.log` and nothing ever cut it. | The service keeps the file bounded at its start and once an hour: over 5 MB it keeps the last 1 MB, cut in place because launchd holds the file open. |
| INSTALL-12 | low | The site was built on the maintainer's computer with `npm ci` that ran the install scripts of its dependencies. | `npm ci --ignore-scripts` in `site/deploy-site.sh` and `site/Dockerfile`. A test holds every `npm ci` of the tracked scripts to it. |
| INSTALL-19 | low | The nginx template proxied the dashboard on port 80 until certbot had run, so a password could travel in clear. | Port 80 only answers the certificate challenge and redirects to https. The proxy is in the 443 block and the guide gets the certificate first. |
| INSTALL-11 | low | The update of a git checkout pulls its branch, which may hold commits that are in no release, while the guides promised the newest release. | The pull stays. The installer says before it that a checkout follows its branch and may hold code that is in no release yet, and the guides say the same. |
| DOCS-3 | medium | The guides told every owner to type `npm run cli -- X` and `npm start`. An install with the private Node.js has no npm on the PATH, so those failed, the way back to the recovery words included. | `cli.sh` sits next to `run.sh` and runs the active release's command line with the installer's Node.js. The installer, README.md and INSTALL.md show `./cli.sh` and `./run.sh`. |
| DOCS-1 | medium | The Go live page, INSTALL.md, the installer's last screen and the Getting started guide promised that a new wallet in dry run simulates its registration. A dry run buys nothing and every action of a plan runs against a fresh reading of the chain: the swap is simulated, the registration is refused ("needs 5000 FOXSY for the fee (swap first)") and later plans of the game day may refuse the swap too, by the daily swap allowance the simulated swap counts in | The four places say what a new wallet shows in dry run and that the team is registered after Go LIVE. A test runs the executor on a new wallet and holds the sentences to it. The code is as it was (see Stays open). |
| DOCS-4 | medium | The pages gave the AI about $1 a day and $0.15 a plan for a single agent, measured when the game manual was 143 KB, and suggested a monthly limit of $20 at Anthropic. The manual is 245 KB, nothing tied the sentence to it, and no page gave the cost of the Opus 5.5 at high effort that every level recommends | Measured again on the maintainer's server on 2026-11-11 from real plans: the rules and the manual are about 99,000 tokens and a plan reads about 111,000 in all. The pages say about $0.25 a plan and $1.50 a day for a single agent at the defaults (derived from those counts at Sonnet 5's list price) and what ten agents on Opus 5.5 at high effort measured ($0.15 a plan with the manual from the cache, $0.60 without). The example limit is $60. A test ties each number to the size of the text every plan sends, the list prices and the default tick and hours: a manual that grows fails it. |
| DOCS-6 | medium | Every page gives one line that starts with curl and none said that curl is needed. Ubuntu Desktop ships without it, and the snap that Ubuntu's hint names first cannot write the installer's Node.js download | The Install page, the home page, INSTALL.md, README.md and Troubleshooting give `sudo apt install curl` and say that it is the apt one. |
| DOCS-7 | medium | On Windows the agent is a systemd user service inside WSL2, which stops some time after its last terminal closes and does not start with Windows, while the pages said "keeps it running after a restart". On macOS the service starts at login and a sleeping Mac plays nothing | The pages say when the agent runs on each system, step 7 of the installer's table names all three and Troubleshooting has a row for each. No keep-alive for Windows is shipped (see Stays open). |
| DOCS-8 | low | The Max shop payment bubble said "At 2,500 the agent can buy anything in the shop", while medicine for a long injury and an Epic's match waiver cost up to 9,000 | The bubble says what 2,500 buys and what needs more, with the numbers of the levels and of the match gate. |
| DOCS-9 | low | "A day in the life" gave the XP booster's 7 stat points without the rate they belong to, and said the seated teams are compared for the open Silver or Gold tournaments, while the snapshot reads a paid Bronze too | The sentence names the full rate and that a level earning a share of the XP brings that share. The field read says Silver, Gold or paid Bronze, and the test that pinned the old sentence pins the new one. |
| DOCS-10 | low | Five lists in the dashboard, the Settings page and the Strategy levels page carried a comma before their last "and" | Reworded. |
| DOCS-11 (c) | low | `site/README.md`, the site's nginx files and its deploy script named the maintainers' website server (its address, its deploy user and another site on it), and comments in the sign-in page and the dashboard, sent to every browser, named two other private projects | Placeholders, with a sentence that the real values are kept outside the repository (`site/.host`, which git ignores, or `SITE_HOST`). The comments are gone, also in `src/web/auth.ts` and a test's title. A test searches the tracked files. |
| DOCS-12 | low | `setup` on a server told the owner to run `backup-words`, which a server refuses | On a server it says to read the words once from the env file in the owner's own SSH session, as the server guide does. On the owner's computer it names `./cli.sh backup-words`. |
| DOCS-3 (the messages) | low | The agent's own messages still named `npm run cli -- setup` after the guides were corrected | The command line, the service and `.env.example` name `./cli.sh`, or `agentctl.sh` on a server. The maintainers' `sync-manual` line keeps npm. |
| DOCS-13 | low | The manual's eleven screenshots dated from 2026-10-06 and showed a dashboard that no longer exists | Taken again with `site/scripts/screenshots.ts` on its demo agents (a throwaway wallet, demo keys, no upstream in reach). |
| DOCS-14 | low | The home page promised an agent that plays "around the clock", while a new agent plans 12 hours a day | "every day, inside the hours you choose". |
| DOCS-15 | low | Found while the update's pages were written: the notice of a new version said "send /update here". The command is `/upgrade`, and the agent answers `/update` with "unknown command" | The notice names `/upgrade`. A test asks the service every command the notice names. Only the words changed. |
| UPD-1 to UPD-5 | new feature | What an installed agent may take as an update had to be decided by something an attacker of GitHub, of the download or of the network cannot forge | A release is a small manifest signed with the maintainers' Ed25519 key, whose public half is pinned in the code already installed. The manifest is read strictly (its known fields only), it counts only with a signature of exactly its bytes, only a later plain version is newer (no downgrade, not the same version, nothing unreadable), and the archive is kept only when its size and SHA-256 are the signed ones. A build that pins no key refuses every update. |
| UPD-6 to UPD-11, GET-1, GET-2, INS-1, INS-2 | new feature | An update that fails half-way, or that does not start, must leave an agent that runs | Each release has a folder of its own under `versions/`, and the running one is never written to. The new release is unpacked next to it and prepares itself (`install.sh --prepare`: its own folder and Node.js only, without the agent's keys in its environment). The switch is one small file, written by rename with a note for the launcher. A release that has not stayed up for 45 seconds in two starts is undone by the launcher (`run.sh`), and the release that ran before tells the owner once. The launcher refuses a `versions/active` that names anything but a release folder. The pasted install line puts a release in its own folder only when the download matches its manifest, and keeps the wallet, the keys, the data and Node.js. |
| UPD-12 to UPD-20 | new feature | When an update is installed, and who may ask | The agent asks for the newest release about every 10 minutes (`AGENT_UPDATE_CHECK=0`: never) and tells the owner once per version, in the dashboard and on Telegram. Looking installs nothing. An update is installed only on the owner's ask (Update now, with the session and its CSRF token, or `/upgrade` from the owner's own chat), it is verified again at that moment, one at a time. The service then stops as for any restart and ends with exit code 75, on which the service manager starts it again. An update that cannot be installed changes nothing and says why; an install that cannot update itself (a git checkout, a server set up by hand) is told what to do instead. |
| REL-1, REL-2 | new feature | The maintainers' side of a release | `scripts/release/release.ts` packs a tag exactly as git holds it, writes the manifest and signs it on the maintainer's own computer. It refuses a release that agents would refuse (another version in the tag, no pinned key, a key the release before does not know) and never overwrites or prints the private key. `docs/RELEASING.md` has the steps. |
| FRESH-1 | medium | The unit's start limit (5 starts in 10 minutes, there to end a crash loop) also counted the restarts the owner asks for. After several runs of the installer, a restart and two updates in a row, systemd refused the next start ("Start request repeated too quickly"): the agent was left stopped, the update said "the old version is still the one running" and the command it named was refused the same way | The installer clears the unit's count (`systemctl --user reset-failed`) before a restart the owner asked for. A restart that still fails says what really runs and names `reset-failed` with the restart. Step 7 no longer ends the installer without a word when `daemon-reload`, `enable` or the restart fails. |
| FRESH-2 | low | systemd was looked for at step 7 of 7, after the newcomer had written down the words and typed a login and keys | It is looked for before the first question. The message says "this machine does not run systemd", with the WSL2 steps and `./install.sh --no-service`. |
| FRESH-3 | medium | A terminal opened with `su - user` has no bus of the user: the install ended at step 7, `--update` could not restart the agent and `--uninstall` said "Stopped." while the agent kept running | The installer finds the user's service manager itself (`loginctl enable-linger` for its own user, then `XDG_RUNTIME_DIR`). An uninstall that cannot reach or stop the service says so and removes nothing. It also says that linger stays on. |
| FRESH-4 | low | A dashboard password that was too short, or typed differently the second time, ended the installer | It is asked for again, up to five times. Ctrl-C still ends the installer. |
| FRESH-5 | low | The last screen listed `./install.sh --update`, `./cli.sh` and the uninstall without the folder they are typed in | It names the folder first (`cd <folder>`). |
| FRESH-6 | low | Without curl the Node.js download failed with "could not be downloaded. Check the connection" | "curl is needed and is not installed", with `sudo apt install curl`, before the first question. |
| FRESH-7 | low | The notice of a new release said "send /update here": DOCS-15, met again on the fresh install | `/upgrade`, by the same fix. |
| FRESH-8 | low | npm's own notice ("new version of npm available, to update run ...") and its spinner stood between the installer's lines, and a newcomer reads the notice as something to do | Both are switched off for the installer's `npm ci`. |
| FRESH-9 | low | "Yes" with a capital was not taken as the yes at the words question. A shell without `USER` broke the installer. The guided install printed lines written for a server ("Restart the service", `check-keys`) | yes counts in any case. The user's name is asked of the system (`id -un`). Under the installer the command line leaves the server's lines out (`FOXAGENT_GUIDED=1`). |
| FRESH-10 | low | The installer accepted a dashboard port that another program already listens on, and the agent then ended at every start | Step 3 refuses such a port and offers the next one. The port that this install's own running agent holds counts as its own. UPD-23 is the running agent's side. |
| FRESH-11 | low | The Node.js download was written by curl itself (`curl -o`) into a temporary folder, which a confined curl (the snap) cannot write to | curl writes to its output and the shell writes the file. By reasoning: not measured with a real snap, and the guides still name the apt one as the one the install is tested with. |
| FRESH-12 | low | A Telegram token that was refused, or Telegram not answering, saved none of the keys: the AI key typed just before was lost and the installer ended at step 4 | The token is left out and told, the other keys are saved and the install goes on. |
| FRESH-13 | low | From the owner's install on a real Ubuntu desktop: the dashboard address on the last screen was plain text among the other lines | It is a link where the terminal knows links (plain text when the output is no terminal) and the screen says how to open it. On a machine with a desktop the installer offers to open the dashboard in the browser, never on a server or in a pipe. |
| FRESH-14 | low | From the owner's install: when the installer was run again, Enter at "Enter keys now?" walked through all four key prompts whenever no AI key was set | Enter means yes only on a first install without an AI key. On every later run it skips the keys, and a typed y still opens them. |
| R61A-1 | low | The agent review of pull request #61 (Claude Fable 5.2 in the strategist's model list): the password gate with the new model prices had no test, and two pages said "at the same price" of Sonnet 5.5, whose cache reads cost less | Fixed in that pull request, with a test and the wording: every list price counts for the gate, the cache read too. Sonnet 5.5 back to Sonnet 5 asks for the password, Fable 5.2 asks for it from every Sonnet and Opus, and Fable 5.2 to Opus 5.5 is one click. No code changed. |
| UPD-21 | medium | On an install without a background service (`./install.sh --no-service`, the agent started with `./run.sh`) Update now and `/upgrade` put the release in place and ended the agent with exit code 75. Nothing starts such an agent again, so it stayed down while the dashboard said that the page comes back by itself | The agent knows whether a service manager started it (`src/update/supervised.ts`): the installer's unit and plist say so with `FOXAGENT_SUPERVISED=1`, launchd names its job, and a unit written before is known by `INVOCATION_ID` together with a `JOURNAL_STREAM` that names the agent's own output (a desktop terminal inherits `INVOCATION_ID`, so it alone proves nothing). Without a service manager the release is still verified, prepared and switched, and the agent does not end: the answer to the click, the dashboard notice and Telegram say that the new version runs from the next start, with the command. Asking again says the same and does nothing more. Whatever is not recognised counts as started by hand, so the mistake that is left is an agent that plays on, not one that stays down. |
| UPD-22 | low | The systemd user unit restarted the agent only after a failure (`Restart=on-failure`) and the launchd plist only after an exit that was not 0. A new release that ends at once with status 0, as Node.js 23 ends this code, was not started a second time, so the launcher's undo waited for the owner | `Restart=always` in the user unit and `KeepAlive` true in the plist. `RestartSec`, the start limit and the lines for exit code 75 are unchanged. A stop that is asked for (`systemctl --user stop`, the uninstall) is not restarted. The server's unit in `deploy/` is not part of this. |
| UPD-23 | medium | A dashboard port that another program holds (`EADDRINUSE` at listen) was an error nothing caught: it ended the whole agent. Under the unit it was started again until the start limit and then stayed stopped, although the agents do not need the dashboard to play | The failed listen is caught. The agent says once, in the log and on Telegram, which port it is, that the agents keep playing and how to set `WEB_UI_PORT`. It tries the port again every 60 seconds and says once when the dashboard is back. Any other error of the web server ends the process as before. |
| UPD-24 | low | For the first 45 seconds after a new release started, `versions/pending` still names it and the launcher may still undo it. A second Update now in that time was accepted: it replaced the note, so a release that had not proven that it starts became the one to go back to | Refused with one sentence: "the last update is still being confirmed, try again in a minute". Nothing is asked, downloaded or switched. |
| WIN-1 | new feature | On Windows the guide had the newcomer set up WSL2, Ubuntu, systemd and curl by hand in five steps, its systemd step could append a second `[boot]` to a file that already had one, and nothing kept Ubuntu running once its last window closed (DOCS-7). The owner decided: Windows stays on WSL2, with one pasted PowerShell line | `get.ps1` at the repository root, pasted with `irm` and `iex` like `get.sh` with curl and bash. It checks the PC (64-bit, build 19041 or later, virtualization where Windows tells it); when WSL 2 is missing it runs Microsoft's own `wsl --install --no-distribution` through the administrator prompt of Windows and, when Windows has to restart, says: restart, paste the same line again; it installs Ubuntu with `wsl --install -d Ubuntu`, where Ubuntu itself asks for the username and password; it turns systemd on in `/etc/wsl.conf` by the rules of WSL's own reader (the first `systemd` line counts, so the line that is there is corrected and a `[boot]` section is added only when the file has none; the old file is kept beside it and the new one is read back); it runs `get.sh` as the user's own Linux user in the same window; and it registers a scheduled task of the Windows user, "FoxLeague Agent (WSL)", that keeps one hidden `wsl.exe` attached to Ubuntu. The choices that keep it safe: nothing is downloaded and run on the Windows side except Microsoft's `wsl.exe`, started by its full path in the Windows folder; no code is built and run (no `Invoke-Expression`, no script block made from text), which the checks hold with the parser; the script is one function called on its last line, so a download cut short runs nothing, and it never ends the user's window; no password, key or recovery word passes through it (of `.env` only the digits of the dashboard port come back); the switches handed to `get.sh` are each held to their own shape and refused otherwise, and a `FOXAGENT_DIR` on the Windows disk is refused; only the distribution named Ubuntu is used and restarted (`wsl --terminate Ubuntu`, never `--shutdown`), the default distribution and version are left alone, and an Ubuntu that was already there is asked before its restart; the task runs with the user's ordinary rights, and `-Uninstall` removes that task and nothing else. Checked on Linux only: the PowerShell parser, PSScriptAnalyzer and the checks of `test/windows/get-ps1.checks.ps1` in PowerShell 7 with stand-ins for `wsl.exe` and Windows, run by `test/audit-1111/windows-1.test.ts` where Docker has the image. Since then it ran on a real Windows PC (13 Nov 2026): the section "Windows real-PC check (2026-11-13)" has what was found and fixed. `-Uninstall` also stops the hidden `wsl.exe` the task started (W-13) |

Decisions of the owner (2026-11-11):
- **Signed releases.** An installed agent takes an update only when it is signed with the release key. The key is
  made once on the owner's own computer, with a passphrase, and its private half never reaches GitHub, CI or a
  server (`docs/RELEASING.md`).
- **One click, and `/upgrade` on Telegram, with no password.** The installer's reviewer disagreed: it asked for the
  password on the click and for Telegram to announce only, because an update replaces the code that enforces the
  caps. The owner kept one click, because only a signed release that is newer than the running one can be
  installed, whoever asks.
- **MONEY-2.** The 1v1 win chance never stands above what the two starting elevens alone give. It is stricter play:
  a rival's lower ELO no longer lifts a weaker eleven over the 55 percent floor.

Stays open:
- The first install has no earlier version to check a signature with: it trusts GitHub over https and the release's
  checksum, as the install line itself does. `get.sh` does not pass `--proto '=https'` to curl for its GitHub
  downloads, and the tag ruleset on `v*` (only maintainers, no moving or deleting) is still to be asked of GitHub.
- `RELEASE_KEYS` in `src/update/keys.ts` was empty until the owner made the key (since then: pinned on 2026-11-20,
  in a section of its own): until a release pins it, no agent offers or takes an update from its dashboard.
- Nobody has run the installer or the update on macOS or on Windows (WSL2) yet (since then: the Mac check of
  2026-11-12 and the Windows real-PC check of 2026-11-13, each in a section of its own; the replay also runs on
  Ubuntu 26.04 since W-9). The fresh install was replayed on
  Ubuntu 24.04 in a container that runs systemd and done by the owner on a real Ubuntu desktop, nowhere else: not
  on an arm64 machine, not from a git clone, not with a snap's curl, not behind a slow network or on a full disk.
  The pages say what follows from how macOS and Windows work (a LaunchAgent starts at login; WSL stops with its
  last terminal and does not start with Windows). The Windows one-line installer (WIN-1) now makes a scheduled
  task that is meant to keep Ubuntu running; the next line says what is known of it.
- `get.ps1` ran on a real Windows PC on 13 Nov 2026: what was found, fixed and left open is in the section "Windows
  real-PC check (2026-11-13)". What this line said before that run: it was written on Linux, the PowerShell parser
  reads it and its decisions are checked in PowerShell 7 with stand-ins for `wsl.exe` and Windows. That says nothing of Windows
  PowerShell 5.1, of what the real `wsl.exe` answers on a PC without WSL, of the administrator prompt and the
  restart, of Ubuntu's first start, of whether an ordinary user may register the task, of whether
  `conhost.exe --headless` shows no window and of whether Ubuntu stays up with every window closed.
  `docs/WINDOWS-TEST.md` is the walk-through for the owner's PC. Until it is done, the guides say what the task
  is there for and not that it works. Also open there: `install.sh` asks about the browser itself inside WSL
  (through `explorer.exe`), so `get.ps1` asks only when the installer inside could not; a switch in `install.sh`
  would let the Windows side, which tries the address from Windows, own that question.
- A change of the unit or of the plist in a later release reaches an existing install only when its owner runs the
  installer again: an update replaces the code, not the service file (one exception since W-9 of 2026-11-14:
  `./install.sh --update` in a terminal takes the line `RestrictSUIDSGID=true` out of an older unit). The release notes have to say so. An install
  made before 2026-11-11 keeps `Restart=on-failure` until then; its agent still knows that systemd restarts it,
  because its output is the journal.
- Two updates that do not start, asked for within ten minutes of each other, need six starts. The unit allows
  five in ten minutes: the sixth, which would start the old release again, is refused and the agent stays stopped
  until `systemctl --user reset-failed foxleague-agent && systemctl --user restart foxleague-agent` (the installer
  runs both). Found by counting, not replayed; the start limit was left as it is.
- The SHA-256 values of the pinned Node.js v22.22.0 archives were read from nodejs.org on 2026-11-11; only the
  linux-x64 one was compared with a second source. A person should compare the five once more.
- The nginx template, merged from two fixers (the `/login` rate limit and the https-only layout), was not run through
  `nginx -t`, and the certbot steps of the server guide were not run on a real server.
- INSTALL-21 and the review job's clean-up are done in the next section (pull request #62, merged by hand on
  2026-11-11). Their two steps run on GitHub for the first time at the next `merge-check`, and `id-token: write`
  on the review job stays as it is.
- DOCS-11's launch-day items: the "Coming soon" banners and frames of the site, "Status: in internal testing" in the
  README, the GitHub link of the site and the version number (`0.11.0` until the first public release). The
  screenshots show the version label of the day they were taken: take them again after the version is set. (Since
  then: all done for v1.0.0, in the section "The public release, v1.0.0 (2026-11-23)".)
- DOCS-1 was closed in the text. A dry run of a new wallet still shows a refused registration, and from the second
  plan of a game day a refused swap: keeping a dry plan's simulated balance, and leaving an unregistered agent's
  dry swaps out of the allowance, is a change of the executor the owner may still want.
- The cost of Sonnet 5 at the defaults is derived from the measured token counts, not measured on a lone agent, and
  the FAQ still names Sonnet 5 as a good default while every level recommends Opus 5.5 at high effort.
- An agent that never ran the release in which a new release key was added refuses every release signed with it:
  its owner pastes the install line once. `docs/RELEASING.md` says to leave that release the newest for weeks.
- On macOS the launch agent has no limit on restarts (a `ThrottleInterval` needs a Mac to try), and `KeepAlive`
  true (UPD-22) was written from the meaning of the key, not tried on a Mac. `After=network-online.target` in the
  user unit does nothing there (harmless).
- The updater's reviewer also asked for a sequence number next to the version, a warning when no check has
  succeeded for days and a copy of the database before a migration. None is built. A schema version that the code
  refuses when it is newer was not taken, because it would block the undo: database changes stay additive instead.
- The service does not refuse an env file that others can read (the installer and every update put the modes back),
  and the installer does not set the mode back to dry run when its answer turns the live permission on while the
  database says LIVE.
- The sign-in: the owner of a /48 or /56 of IPv6 still gets five guesses for each /64. A browser that sends no
  Origin on a form post is counted as before, and over plain http a sibling subdomain passes. DNS rebinding reaches
  only `/healthz` and `/login` (there is no list of allowed Host names).
- A tournament title written with look-alike letters of another alphabet passes the impersonation check.
- Link my Telegram: a flood of more than 100 new messages after the link was started is read page by page and can
  still make the owner send the code again. After the link the reader takes the owner's 6-digit code as a chat
  message, as before.
- The second-copy check (EDGE-8) was not run under the server's real systemd sandbox, and `cli tick` still reads
  only the pid file.
- Noted by the money reviewer without a proof: a failed bid is unbooked without asking the contract whether it
  still names the agent as the top bidder, and the guard on the EGLD price is empty after a restart until the first
  reading.
- A session without the password can press Plan now and Talk to the manager as often as it likes: the AI spend has
  no cap of its own (by design; the limit is the one set at Anthropic). `cli log` prints summaries as they are, with
  any terminal escapes a rival's text holds.
- Check before Friday 13 November 2026, 14:00 UTC: once FoxLeague's card bans are live, a card whose answer leaves
  `injured_until` or `bans_pending` out counts as unread. If FoxLeague leaves out fields that are null, every card
  is unread and every match is refused (the safe side, but no play).
- The activity, spend and pending tables are never pruned (about 1 GB a year for ten agents).
- The agent buys at most 18 days of medicine a week while FoxLeague's settings may sell more (the stricter side).
- Not covered by this audit: the bytes of xExchange's `composeTasks`, FoxLeague's `tournament_slots.rs` against
  `slots.ts`, the insides of Champions FoxLeague and the manual pages the copy leaves out.
- `AGENTS.md` rules 7 and 8 do not name the Telegram commands that take no password (`/mode live confirm`,
  `/kill off`, `/resume`, `/upgrade`): only the owner's own chat is answered. The README and the Safety page say so.

## Per-agent models and shadow efforts (2026-11-13)

The owner's request of 2026-11-13: the ten live agents on three models (Opus 5.5, Sonnet 5.5 and Haiku 5.5, all at
high effort); on three test agents shadow plans by the model that plays at other efforts. Until then the model and
effort were one setting for every agent; the shadow list was one list for every agent with one effort. The AI
spend has no cap of its own, so every path that raises it is treated as a money path (rule 7). Each finding has a test
of the same name in `test/per-agent-model.test.ts` that failed on the branch before its fix for the reason given and
passes now.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| PAM-1 | design (the owner, 2026-11-13) | An agent needed its own model and effort, kept with its other settings, while an agent saved before plays exactly as before | `aiModel` and `aiEffort` in the agent settings, empty for "the same as all agents": the default and what an older row reads. The patch takes empty, a model id or one of the five efforts (one list, `AI_EFFORTS`, which the strategist's `EFFORTS` is); the web route also refuses a model the list does not have |
| PAM-2 | design (rule 4) | An unknown value could have become a model: an own model off the list, a name every object has (`constructor`) or an effort nobody knows, written by hand into the database. A fallback of both fields to the all-agents pair could also end on a dearer model than the agent's own (Haiku 5.5 with a bad effort under a Fable 5.2 all-agents pair) | `agentChoice` reads each field by itself. An own value it does not know is never used: the all-agents value stands in for that field only. `ignored` says why. An own model that left the list runs its successor, never a dearer one. Only what an id can hold reaches the log |
| PAM-3 | design | Planning had one strategist. A per-agent model needs its request sent to that model at that effort, with the spend booked at the price of the model that answered | One strategist per model (the all-agents one for its model, else one made with the first plan); the effort goes with each request. `usd` books each attempt at the model that served it. The plan's cost line names the model and effort where they are not the all-agents ones; the next request never reads that line |
| PAM-4 | design (rules 4 and 5) | A bad own value written by hand had to be refused and said, never decided on | The agent plays the all-agents value in its place and the log says why once, while the value stays the same |
| PAM-5 | low (cost) | The manual's cache decision counted any agent due within the hour. A cache belongs to one model. Anthropic's docs leave open, per model, whether a request at another effort can read the cached system prompt: an effort change is rendered with the thinking settings, which on some models come before the tools and the system prompt. Counting any agent would pay one-hour cache writes that nothing reads | Warmth and "another call due within the hour" are counted per model and effort. The strategist asks for the pair of each request; the service counts only the agents whose plan or shadow plans use that pair. Without a pair (a caller from before) it counts every agent, as before |
| PAM-6 | design (the owner, 2026-11-13) | The shadow setting took model ids only: one list and one effort for every agent | An entry may carry its effort (`claude-opus-5-5:low`); an agent may have its own list (kv `shadow_model_agent_N`, N from 1; blank follows the all-agents list, `off` means none). An entry with an effort rests only at that very model and effort; one without rests at its model at any effort as before, so a setting of before runs byte for byte (`shadowChoices` keeps its shape). An effort nobody knows leaves the entry out with its reason; a model and effort written twice count once; at most 16 entries are read |
| PAM-7 | design | The guard, the strategist and the record went per shadow model: three efforts of one model would have shared one guard key and been asked once | One shadow strategist per model, the effort sent with each request; the guard is per agent, model and effort; each shadow plan has its own row, record and cost at its model's price. The cache rule counts an agent's shadow pairs. Unchanged: no path from a shadow answer to the executor (SHADOW-6 reads the new code and passes) |
| PAM-8 | design (rule 7) | `wakesShadow` compared models only. With an entry at Opus 5.5 high resting while Opus 5.5 plays at high, a lower effort would start it with one click | `wakesShadow` reads model and effort with the rest rule of PAM-6; given models alone, as before, it reads as before |
| PAM-9 | design (rule 7) | Once the fields existed (PAM-1), the settings route judged a patch by `raisesLimit` only: on the branch before this fix the test saw 200 for Opus 5.5 on one agent without the password | `agentAiNeedsPassword`: from the pair the agent plays to the pair it would play (back to "Same as all agents" counts by the pair it lands on), a dearer model, a higher effort or a switch that starts one of its shadow plans needs the password. The route refuses a model off the list |
| PAM-10 | design (rule 7) | The all-agents switch weighed the all-agents shadow list against the all-agents model, whatever each agent plays | `allAgentsAiNeedsPassword`: a dearer all-agents pair asks as before (it is also the pair of the manager chat and of /ask). A switch that starts shadow plans is weighed for each agent the switch moves, so an agent with its own model and effort does not count |
| PAM-11 | pin | The page needs each agent's pair, its own values and its shadow entries to ask by the server's rule; a page of the version before must keep working | `/api/state` gives each agent `ai` (the pair, the own values in use, why a value is not used, the shadow entries and whether the list is its own) and the count `ownAi`. `shadowModels` stays the model ids of the all-agents list |
| PAM-12 | design (the owner, 2026-11-13) | `shadow-report` summed every effort of one model into one block | The numbers once per model and effort, each block named like "Opus 5.5 (low)" when a model planned at several efforts (by the model alone otherwise, as before). Each real plan is listed with its model and effort and its shadow plans at every effort below it. Rows of before read as before |
| PAM-13 | design | The owner needed a way to set an agent's own model and effort on the server | `cli model` (and `agentctl.sh model`): with no number every agent's pair and shadow entries, with a number one agent's, with a model and an effort (each or `same`) that agent's own from its next plan. A value off the list is refused and nothing is written; no agent is added. A setting on the machine, it asks for no password, like `shadow_model`. `cli plan N` asks the agent's own pair |
| PAM-14 | low | Telegram /status and the start message named one model for every agent | They name an agent's model and effort where they are not the all-agents ones |
| PAM-15 | low | An agent's own shadow list survived its deletion and would have been read by a new agent given its number | `deleteAgent` removes `shadow_model_agent_N` with the agent's other values |
| PAM-16 | design (rule 7) | The dashboard had no field for it. A page that asks by another rule than the server leaves the owner with a bare refusal | AI model and Effort in each agent's settings: "Same as all agents (...)" first, the four models with their list price, a bubble each and a line that says what the agent plays. The page's rules for one agent and for the all-agents switch are compared with the server's over every pair. The tab names an agent's own AI and the Strategist box counts the agents with their own. The level dialog does not offer the Strategist box to an agent it would not move |
| PAM-17 | docs | The guides spoke of one model and one shadow list | `docs/SERVER.md` (the `model` command with the owner's ten lines; per-agent shadow lists with efforts and the commands of the three-agent test, which the test runs as written), the README and the site's costs, dashboard, settings and server pages. SHADOWS-11 now finds its section by its heading, as SHADOW-15 did when its section stopped being the last |
| R65A-1 | low (rule 7, agent review of PR #65) | The all-agents switch weighed the active agents only. With every active agent on its own model and effort, a switch away from a resting shadow model asked for no password, while a retired agent that follows the all-agents pair would start that shadow plan after Restore and Resume, one click each. The test saw 200 where 403 belongs | The switch weighs the retired agents too, by the same rule. `/api/state` gives each retired agent its `ai`, which the page's own check reads, so the page asks where the server does |
| R65A-2 | low (correctness, agent review of PR #65) | The AI model field was filled from the saved id. An own model that left the list (it plays its successor) showed as "Same as all agents", so the next save of any setting wrote an empty model and moved the agent to the all-agents model: with the password asked for an unrelated save when that one is dearer, without a word when it is cheaper. The line under the fields also said the all-agents model played in its place | The fields show `ai.own`, the values in use: the successor for a model that left the list, "Same as all agents" for one nobody knows. Saved back unchanged, the agent plays the same pair and neither the server nor the page asks (checked over every saved value against the server's rule). The line says the model left the list and its successor plays |
| R65A-3 | missing test (agent review of PR #65) | No test showed a new Anthropic key reaching the strategists of the models agents play by their own choice; only the shadow strategists' were tested | The test, written and run: it passed on 17ef4e2 as it stood (`updateKeys` already hands the key to every per-model strategist), so this was a missing test, not a bug |
| R65A-4 | medium (correctness, no money or auth effect; re-review of PR #65) | With the strategist off (no AI key yet, a new install), `/api/state` sent the all-agents model and effort as null while each agent's `ai` held the saved pair. The page then saw a change on every save: a lowered cap opened the "Change this agent's AI" password dialog; the line under the fields read "After saving: null at null effort". The server's rule was right | The state also sends `aiAll`, the pair "Same as all agents" lands on: the strategist's, else the one saved for when there is one. `model` and `effort` stay null so the Strategist box, the last plan and the level hint still say the strategist is off. The page's per-agent rule, its line and its "Same as all agents" choices read `aiAll`: with no key an unchanged save and a lowered cap are one click. The page asks exactly when the server does (compared over every pair) |
| R65A-5 | low (rule 7; third review of PR #65) | The all-agents switch weighed the active and the retired agents, not an agent added afterwards. With every agent on its own model and effort (or no agent yet) and an all-agents shadow entry resting under the all-agents pair, a switch to a cheaper model was one click (403 on main, 200 here). + Add agent is one more click; the new agent pays that shadow plan on every plan | The switch weighs one more agent with no settings of its own, which follows the all-agents pair and the all-agents shadow list: an all-agents entry that the switch starts always asks. `/api/state` sends `shadowEntries` (the all-agents entries with their efforts) and the page's check weighs the same agent. PAM-10 and R65A-1 keep their "not moved" cases on agents' own lists |
| R65A-6 | low (dialog wording, no money or auth effect; third review of PR #65) | The Strategist box's password dialog chose its title and text with the model alone and named the all-agents list only. A lower effort that starts a resting `model:effort` entry asked for the password (rightly) under "Switch to a dearer AI"; a wake on one agent's own list said "every agent" | The dialog (and the level dialog's AI switch) takes the effort. Its text names each entry that would start and the agents it starts for, "any agent you add" for an entry of the all-agents list; a page without agents keeps the words of before. R63A-1's pinned Apply line now carries the effort |

What the change could get wrong and what guards it:
- A dearer model without the password: for one agent (PAM-9), for all agents (PAM-10), through a lower effort that
  wakes a shadow entry (PAM-8, PAM-9, PAM-10), on the page (PAM-16). The `model` command and the per-agent shadow keys
  ask for none on purpose: they are written on the machine, like `shadow_model`.
- An unknown value used as one: an own model or effort written by hand is never used (PAM-2, PAM-4); the routes and
  the CLI refuse one (PAM-1, PAM-9, PAM-13); a shadow entry with an effort nobody knows is left out (PAM-6).
- A shadow that never rests: an entry at the very model and effort that play rests (PAM-6). An entry without an effort
  rests at its model at any effort as before, so no setting of before starts costing more (PAM-6; SHADOW-4, SHADOWS-2
  and R63A-1 pass unchanged).
- Cost booked on the wrong price: each plan at the model that answered (PAM-3), each shadow plan at its own model
  (PAM-7); the cache decision per model and effort (PAM-5).

Stays open:
- The manager chat and `/ask` use the all-agents model. A dearer all-agents model still asks for the password when no
  agent follows it.
- Anthropic's docs say an effort change invalidates the messages cache on every model. It invalidates the tools and
  system caches too on the models that render the thinking settings ahead of them; the docs do not name those. The
  cache rule takes the careful reading (one cache per model and effort). If an effort change does not touch the system
  cache on these models, a request may pay the plain input price where a cache read would have done.
- Each shadow entry adds its own cost to every plan of its agent: three entries make four requests a plan on that
  agent. The AI spend has no cap of its own.
- `shadow_plans` keeps the newest 2,000 rows of all agents together: with three agents at three shadow entries and a
  plan an hour over 16 hours, that is about two weeks.
- The all-agents switch weighs the retired agents too (R65A-1), so it can ask for the password because of an agent
  that is retired and may never be restored. The rule is the careful one: it does not guess which agent comes back.
- A dashboard page of the version before, still open, reads only the all-agents shadow list and knows nothing of the
  retired agents' AI. With per-agent lists it can meet a bare refusal where the server asks for the password; a reload
  gets the new page.
- `cli plan N` asks the agent's own model and effort; no test covers it, because it reads the chain and FoxLeague.
- Test keys (and `check-keys`) asks Anthropic with the all-agents model only. An agent's own model the key cannot use
  shows as failed plans of that agent, not as a failed key test.
- A problem with the AI account is told on Telegram as "Plans are failing: ... Every agent waits until it is fixed",
  once an hour per message. With agents on several models, one model's access can fail while the others plan; the
  message does not name the model.
- A hand-written `shadow_model_agent_N` for an agent number no agent has yet is not weighed by the all-agents
  switch's password check: the switch weighs an agent added afterwards by the all-agents shadow list (R65A-5), while
  the agent that + Add agent makes with that number plays that list from its first plan (a note of the review of
  PR #65).
- What stays open in the two shadow sections before (2026-11-11 and 2026-11-12) stays open: a shadow plan is judged
  by reading it, never by the rules.

## Extra-high room (2026-11-13)

On 13 Nov 2026 agent 9's real plan on Haiku 5.5 at xhigh filled all of its 48,000 tokens and was cut off ("plan
truncated at max_tokens; nothing executed"); its next xhigh plan wrote about 42,300. On the same ticks Haiku 5.5 at
high wrote about 16,300 tokens, Sonnet 5.5 at xhigh about 26,200 and Opus 5.5 at xhigh about 13,700. The owner asked
for more room at xhigh. Each finding has a test of the same name in `test/strategist.test.ts` that failed on the branch
before its fix for the reason given and passes now. XROOM-2 comes from the fix of XROOM-1: on `main` its test passes.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| XROOM-1 | low (the owner, 2026-11-13) | The room of one answer was 3 times the base at xhigh and 4 times at max: a plan got 48,000 tokens at xhigh and Haiku 5.5 filled them. A cut-off plan runs nothing, so it is safe, but the agent stays idle until its next plan and the call is paid. The test saw 48,000 where 80,000 belongs | `ROOM_TIMES` xhigh 5 and max 6; low, medium and high stay. A plan gets 80,000 tokens at xhigh and 96,000 at max, the manager chat 40,000 and 48,000, /ask 20,000 and 24,000. Every room stays under the 128,000 tokens each of the four models can write (the test asks every model at every effort). The deadline formula stays: a minute to begin plus 50 tokens a second, about 27.7 minutes at 80,000 and 33 at 96,000 |
| XROOM-2 | low (cost; no money path or auth effect) | Talk to the manager waits for the whole answer inside one web request. After XROOM-1 a chat at max may take 1,020 seconds and the nginx template gave up after 900: the page showed an error and gave the message back with Send enabled while the answer was still being written and paid for, so a second Send paid for it twice | `proxy_read_timeout 1080s` in `deploy/nginx-foxleague-agent.conf`, which the test reads against the deadline of a chat at max. `docs/SERVER.md` and the site's server page tell a server set up from an older template to raise it |

What was checked and needs no change:
- The scheduler sets an agent's next plan only once its plan and actions have ended, so a longer call moves the next
  plan later and two plans of one agent never overlap; the 10-minute floor counts from that end. The plan lock has no
  time limit. Each action reads a fresh snapshot before it runs. The planning tick an hour before a match lock still
  leaves about 27 minutes after the longest plan; the actions' window ends 10 minutes before the lock as before.
- Plan now and Telegram /tick start the plan and answer at once. Telegram runs each command without waiting for the
  one before, so a long /ask never holds back /kill.
- The Anthropic client's 180-second timeout covers only the wait for the start of a streamed answer; the whole answer is
  bounded by `deadlineMs`.
- No code books, estimates or caps AI spend from the room. Each call is counted after it ends, from the tokens Anthropic
  reports, at the price of the model that answered (PAM-3). The AI spend is not in the ledger or the FOXSY and EGLD
  caps, so rules 3 and 4 have nothing to book here.

Stays open:
- A single plan at xhigh or max can now cost more. The most one plan request costs, with a prompt of about 120,000
  tokens at the plain input price and the whole room written (Haiku 5.5 on its card for a prompt over 100,000 tokens):
  Haiku 5.5 $0.26 at xhigh and $0.30 at max (before $0.18 and $0.22), Sonnet 5.5 $1.04 and $1.20 (before $0.72 and
  $0.88), Opus 5.5 $2.08 and $2.40 (before $1.44 and $1.76), Fable 5.2 $4.16 and $4.80 (before $2.88 and $3.52). A
  one-hour cache write of the manual adds its input price once more on that part. A request the server-side
  fallback runs again is paid per attempt. A shadow plan at xhigh or max has the same room; the chat and /ask grow by
  the same factor. The AI spend has no cap of its own.
- Choosing xhigh or max still asks for the owner's password, for one agent and for all agents (rule 7, PAM-9 and
  PAM-10), unchanged. The `model` command on the machine asks for none, as before.
- The live server's own nginx file is not the template: until its `proxy_read_timeout` is raised to 1080 seconds
  there, a chat at max effort that takes longer than 15 minutes ends as XROOM-2 says.
- A shadow plan is given up after 10 minutes (SHADOW-2), well before its deadline at xhigh or max: at the 50 tokens a
  second the deadline assumes, that is about 27,000 tokens. One given up is recorded as "no answer in time" and its
  tokens are not counted in the AI spend, like a real plan cut by its deadline (TA4).
- A plan at xhigh or max can keep its agent busy for up to 27.7 or 33 minutes. Delete and Remove answer "busy; try
  again in a minute" meanwhile. A deploy waits at most 150 seconds before the call ends unbooked (TA4; the server
  guide says to check first that no plan is running).

## Repeat shadow, chat Send and model output limits (2026-11-13)

The owner tests whether a lower effort plans almost the same as a higher one: three live agents plan for real at one
model and effort and shadow plans of the same model at other efforts get the real plan's request word for word. The
comparison had no baseline, since the same model at the same effort does not plan the same twice either. The owner
approved a repeat shadow for it. Two findings of the agent review of PR #66 (chat Send, the output limit per model)
are fixed with it. Each finding has a test of the same name (`test/repeat-shadow.test.ts`, `test/chat-send.test.ts`,
`test/strategist.test.ts`) that failed on `main` at 0774eee for the reason given and passes now. R67A-1 and R67A-2
come from the agent review of PR #67; their tests failed on the branch at 6fb4706, before their fix.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| RS-1 | design (the owner, 2026-11-13) | A shadow list could not ask the playing model and effort again: an entry at that pair rests by design (`rests`), so a list never pays for a copy by accident, and `same` was left out as "not a model on the list". "Medium agreed with xhigh 6 of 10" could not be read without knowing how often xhigh agrees with itself | `same` in a shadow list (an agent's own `shadow_model_agent_N` or the all-agents `shadow_model`) is a shadow plan by the pair the real plan was asked with: the `playing` pair of `prepareShadow`, after the per-agent fallback and the successor rule. It never rests and counts once. It is explicit, so the settings of before mean what they meant: an entry at the playing pair still rests, and with `same` beside it the pair runs once. Fail closed: `same:low`, another spelling, an unknown effort or a playing model the list does not have leave it out with its reason in the log, never at a guessed pair. `off` still switches every entry off |
| RS-2 | design (no money path) | A repeat must stay a shadow plan: never asked through the playing strategist, never carried out, booked like the others | In the service a repeat runs through the shadow strategist of its model (its own connection, no retries, nothing of the playing one shared), with the request word for word, its own activity row ("the real plan's own model and effort again"), its own `shadow_plans` row (shadow pair equal to the real pair) and its cost in the AI spend. The guard key is the agent, model and effort, as for any shadow. It follows the pair that plays: after the agent's effort changes, its repeat is at the new effort. Only the real plan's actions reach the executor |
| RS-3 | low | `shadow-report` grouped rows by shadow model and effort only: a repeat (agent 7's Opus 5.5 xhigh next to its own Opus 5.5 xhigh) and a shadow of another real pair (Opus 5.5 xhigh next to an Opus 5.5 high plan) would be one block, the baseline mixed into the comparison | A row whose shadow model and effort equal its real ones is a repeat. Repeats are a block of their own per model and effort, named "Opus 5.5 (xhigh), the real plan's own model and effort again", with the same lines as the others (valid tool call, actions, same action types as the real plan, cost, time); the head line says how many there are and one line says that a repeat is the baseline. Under each real plan a repeat is marked `repeat`. Rows without a repeat give the report as before, line for line (SHADOW-13, SHADOWS-10 and PAM-12 still pin it) |
| RS-4 | low | `cli model`, the log and the dashboard's line under an agent's AI fields would not show `same` or show it as a model; `/api/state` `shadowModels`, which an older page reads as model ids, would carry it | `cli model` and the log say "same (the real plan's model and effort again)", the dashboard "a repeat of the model and effort it plays". `/api/state` lists `same` among an agent's entries and `shadowEntries`, not among `shadowModels`. Between pairs of the list the password rule needs no change and the test pins it: `same` follows the pair that plays, so `wakesShadow` never starts it there (server and page), and `agentAiNeedsPassword` and `allAgentsAiNeedsPassword` answer with `same` set exactly as without it over every pair of the four models and five efforts. A repeat costs what the playing pair costs, so a dearer model or a higher effort, which already asks for the password (rule 7), raises the repeat too; a lower one is one click and lowers it. A playing model the list does not have was missed here: see R67A-1 |
| RS-5 | docs | The guides did not say what a repeat is or how to set it | `docs/SERVER.md` gives the three test agents' lists with `same` in front (the test runs them as written). It says what a repeat costs, that it never rests and counts once and how the report shows it. The site's costs, server and dashboard pages and `.env.example` say it in plain words, with no number, no model and no promise on the public pages |
| SEND-1 | low (cost; no money path or auth effect; agent review of PR #66) | When the POST to `/api/agents/N/advise` failed for any reason (nginx timeout, lost connection) the page gave the message back and enabled Send, while the server kept the owner's line as pending and went on writing and paying for the answer. The server does not refuse a second message while one is pending (`Service.discuss` has no such check), so a second Send paid twice | The page keeps Send off while a message is on its way from it, while its conversation shows an owner's message still being answered (also from another tab or Telegram) and while a failed Send has not been checked with the server. A failed Send reads the state at once: this very message, when the server still answers it, is not given back and a toast says the answer will show; otherwise it comes back with the error (R67A-2). The normal state refresh brings Send back when the answer is there. A line under Send and the box's bubble say why |
| LIM-1 | low (agent review of PR #66) | `roomFor` gave 80,000 tokens at xhigh and 96,000 at max on the assumption that every model of the list can write 128,000; a model added later with a lower limit would get its requests refused (400) | `MODELS` records each model's maximum output from Anthropic's model table: Fable 5.2, Opus 5.5, Sonnet 5.5 and Haiku 5.5 128,000 each. Every room is clamped to its model's limit where `max_tokens` is set: the plan and the shadow plans (`planFromRequest`), the manager chat and `/ask`. The deadline reads the clamped room. XROOM-1 checks the per-model limit instead of the literal 128,000 |
| R67A-1 | medium (rule 7; agent review of PR #67) | "`same` never rests, so it never wakes" held only while the playing model is on the list. Under one the list does not have, `shadowChoices` leaves `same` out, so a switch from it to a model of the list starts the repeat. `raisesAiSpend` covers that only when the old model has no price: with `AGENT_MODEL=claude-opus-4-8` (priced at 5, 25 and 0.5, not on the list, no successor), nothing saved in the dashboard and `shadow_model` holding `same`, each plan was one Opus 4.8 request; `POST /api/strategist` with Opus 5.5 at the same effort and no password answered 200, and from the next plan each tick paid two Opus 5.5 requests. The same held for an agent following that model that got Opus 5.5 of its own | `repeatRuns` in `src/strategist/shadow.ts` is the test `shadowChoices` makes (a model of the list with one of the five efforts). `wakesShadow` counts `same` as resting under a pair where it cannot run, so a switch from there to a pair it can run at wakes it; between pairs of the list nothing changes. `agentAiNeedsPassword` and `allAgentsAiNeedsPassword` go through `wakesShadow`, so both routes now answer 403 without the password (the test runs both). The page's own copy of the rule reads `same` the same way and names "a repeat of the model and effort that plays" in its dialog; it already asked for the password from a model it does not find on the list. The test also covers an unpriced unknown model and an agent with its own model of the list, which the switch does not move |
| R67A-2 | low (cost; agent review of PR #67) | After a failed Send the page took any pending owner line as its own. The owner writes on Telegram and within the 15 seconds before the next refresh (or from a second tab) presses Send here; the web message's model call fails (529), the server drops that line and answers the error while the Telegram line is still pending; the page found the Telegram line, said "The manager is still answering" and the web message was lost without its error | The page keeps the message only when the server holds this very message, sent from the web box (`from` owner, `pending`, the same `text`, a `source` that starts with "web UI"), as still being answered. Otherwise the message comes back with its error, and Send stays off through `renderSend` while the other message is answered. The same words still pending from Telegram do not count as this page's message |

What was checked and needs no change:
- The one-at-a-time guard (`agent:model:effort`): a repeat's key is the playing pair. An explicit entry at that pair
  rests in the same tick, so the two never run for one real plan. After a change of the playing pair, a repeat still
  on its way at the old pair holds back an explicit entry at that pair for one plan, as the guard means.
- The stored row: nothing that reads `shadow_plans` assumed a shadow pair differs from the real one, except the report
  (RS-3). The report's grouping of one tick still takes each shadow pair once: within one agent's real plan a repeat
  and another entry of the same pair cannot both run.
- The cost booking: a repeat is added to the AI spend before its row is written, at the price of the model that
  answered, like every shadow plan.
- The cache-warmth key is per strategist, model and effort. A repeat has the shadow strategist of its model, so it
  keeps its own memory of the cache, apart from the playing one. The cache rule already counts the playing pair, so a
  repeat adds no pair to it.
- `SHADOW_TIMEOUT_MS` stays 10 minutes, as the owner asked; the longest shadow plan so far took 99 seconds.
- `max_tokens` is set only in the strategist; nothing else asks a model for an answer.

Stays open:
- Each repeat adds one more plan at the playing model and effort to every plan of its agent: for agents 7 and 1 at
  xhigh, the cost of an xhigh plan each time (the most one can cost is under "Extra-high room"). Like every shadow list
  it is set on the machine only and asks for no password.
- When the playing strategist's cache of the manual is warm from its own last plan and the shadow strategist's is not,
  with no other call of that pair due within the hour, the repeat sends the manual uncached at its plain input price
  where the real plan read it at a tenth. The report then shows the repeat dearer than the real plan of the same tick;
  the plans themselves are not affected.
- A repeat at xhigh or max has the real plan's room but is given up after 10 minutes like every shadow plan, so a
  repeat of a real plan that took longer is recorded as "no answer in time".
- The server still accepts a second chat message while one is being answered: Telegram, an open page of the version
  before or a request made by hand still pay twice. Only this page keeps Send off. A refusal on the server would also
  turn away a Telegram message while a web answer is on its way, so it is left to the owner.
- A state refresh that the server answered before it received a Send that then failed can clear "not known" without
  the pending line; the next refresh, 15 seconds later, shows it and turns Send off again.
- A model of the list whose limit Anthropic lowers must be changed in `MODELS` by hand. A model the list does not have
  (`AGENT_MODEL` naming another one) has no known limit: its room is not clamped, and a request it cannot take is
  refused by Anthropic, so nothing of that plan runs.

## Windows real-PC check (2026-11-13)

The owner walked through `docs/WINDOWS-TEST.md` (section 4) on a real PC with the release candidate (ed8b41f) and
a throwaway release served from the maintainer's laptop: Windows 10 Home 22H2 (build 19045), Windows PowerShell 5.1,
the Microsoft Store WSL 3.0.1.0 already there and Ubuntu 26.04.1 LTS installed by `get.ps1` (systemd 259, GNU tar
1.35+dfsg-4ubuntu0.4). Thirteen findings of the installers, LOGIN-1 against the owner's decision of 12 Nov and eight
corrections of the walk-through. None is about money, keys or signing. The fixes are by Claude Opus 5.5, each test
first: the tests are in `test/win-1113/` (one file per id, `docs.test.ts` for the record and the walk-through) and
the PowerShell side in `test/windows/get-ps1.checks.ps1` (checks named after the ids, run in PowerShell 7 in a
container). Each was seen failing before its fix, except where the row says otherwise.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| W-9 | high | The one-click update never installed on that Ubuntu: "The update to 1.0.1 was not installed: the archive could not be unpacked". The agent runs `tar -xzf` inside its systemd user unit, which had `RestrictSUIDSGID=true`. Ubuntu's tar security update for CVE-2025-45582 (June 2026, in 24.04 and 26.04) resolves every path it unpacks with `openat2(RESOLVE_BENEATH)`; systemd's filter for that rule cannot look inside `openat2`'s arguments and answers it with ENOSYS. The 24.04 build of tar then falls back to `openat` (traced), the 26.04 one does not: "Cannot mkdir: Function not implemented", status 2. Reproduced with the 26.04 tar under `systemd-run --user -p RestrictSUIDSGID=true` on systemd 255 and in a 26.04 container with systemd 259; without the rule it unpacks. The same tar in a terminal (outside the unit) works. W-9b: pasting the line again rewrote the unit with the rule; an update never rewrites the unit | (a) The user unit that `install.sh` writes has no `RestrictSUIDSGID`, with a comment that says why. The agent runs as the owner's own user with `NoNewPrivileges`: a set-user-ID file it made would not raise what it may do; as the owner's user it could make one in other ways too. The rest of the sandbox stays. (c) An unpack that the unit refuses says so: "this system's tar cannot unpack inside the agent's background service as an older installer set it up (tar: ...). Run ./install.sh --update once in a terminal, in the agent's folder: that installs it and renews the service, so later updates are one click again". `./install.sh --update` (a terminal is outside the unit) takes exactly the line `RestrictSUIDSGID=true` out of an older unit, leaves the rest as it is and has systemd read it before the restart; pasting the line again writes the new unit. An update's `--prepare` still never writes to the service (the rule of `docs/RELEASING.md`, which names this one exception). Not (b), a tar reader of our own: a new parser is new attack surface; `--prepare` runs tar for a new Node.js inside the unit too. The droplet's system unit (`deploy/`) keeps the rule: a server set up by hand never updates itself, `deploy.sh` copies the code with rsync, nothing in that unit runs tar; there the agent runs as a user of its own. The install replay takes `FRESH_UBUNTU=26.04` (its image gets `adduser`; "nobody is logged in" no longer counts systemd 259's session of a user's service manager). Replayed on 26.04: the unfixed candidate failed step 11a with the PC's own message; the fixed tree passes it |
| W-10 | low | The log said only "the archive could not be unpacked"; tar's reason was found by running tar by hand | tar runs in the C language, the first lines of its errors go to the log ("the update's archive could not be unpacked; tar said: ...") and its first line into the message, without the program's path. The runner keeps the first 4 KB of a command's errors besides the tail |
| W-13 | medium | `get.ps1 -Uninstall` left Ubuntu running until Windows restarted. Stopping the task ended its `conhost.exe`; the `wsl.exe -d Ubuntu --cd ~ --exec /bin/sleep infinity` it had started (two processes on that PC) went on alone. The uninstall's own sentence "Without the task it stops a short while after the last Ubuntu window closes" was then wrong. Stopping those two by hand: no running distribution 75 seconds later | After the task, the uninstall stops the `wsl.exe` programs whose whole command line is the task's (a `wsl.exe` in any folder, quoted or not, with exactly the task's arguments) and says so. Nothing else is taken for it: another distribution, another command, a longer command line and a process whose command line Windows does not give are left. When Windows does not say which programs run, the uninstall says so and names `wsl --terminate Ubuntu`. A task of the same name that is not ours stays with its processes. The Update page and INSTALL.md say what the line and `Unregister-ScheduledTask` alone do |
| W-6 | medium (the first use) | "Open the dashboard in your browser now? (y/n) [y]: y" opened no browser, seen twice. `install.sh` started `explorer.exe` in the background and ended at once; WSL ended it with the session | On WSL the opener runs in the foreground (`explorer.exe` hands the address to Windows and returns at once, with status 1 even when it worked; the status is not an error). A Mac's `open` too. `xdg-open` stays in the background. `get.ps1` still asks only when the installer inside had no `explorer.exe`, so nobody is asked twice. The test ends the installer's process group the moment it ends, as WSL does |
| LOGIN-1 | low (the owner's decision of 2026-11-12) | Step 3/7 asked "Web UI username [admin]:" and Enter took admin: the PC's install was signed in as admin | The question offers no name, not even an earlier one: "Dashboard username, your own choice (3 to 32 letters or digits):". An empty answer saves nothing and the installer asks again. The install replay types its own names and checks that Enter is refused. INSTALL.md and the Install page say there is no default username |
| W-1 | low | `get.ps1` did not look at the free disk space; C: had 0.2 GB | Before Ubuntu is downloaded it needs 4 GB free on the drive of `%LOCALAPPDATA%` (where `wsl --install` puts a new distribution; the download goes to `%TEMP%` on it) and stops with how much is needed and where to free it. Measured on the PC: the download 0.42 GB and Ubuntu's disk 1.39 GB after its first start, the agent about 0.24 GB (0.28 GB with the release kept for an undo): about 2.1 GB at the peak; Ubuntu's disk grows and never shrinks by itself. With Ubuntu there, below 1 GB it warns before the installer. An amount Windows does not give is said, not refused. The guides name the 4 GB |
| W-2 | low | "You have System.Object[]" on a PC with no distribution. `@( )` around a function that returns its list as one value made a list of one list. Two other Ubuntus were joined without "and" | No `@( )` around the call. The check runs the whole install with none and with two other Ubuntus |
| W-3 | low | The Ubuntu download looked stuck at 0%: a click into the console window starts Windows' text selection, which pauses the program until Enter; WSL also opened its own "Welcome to WSL" window | Before the download `get.ps1` says both, with what to do (press Enter once; close the welcome window). The guides and Troubleshooting say the same. QuickEdit is not turned off |
| W-4 | low | Ubuntu's first start asked "Help improve Ubuntu! ... (Y/n/e)", which nothing had mentioned | `get.ps1` and the guides name the question: either answer is fine for the agent |
| W-5 | low | The installer's last screen printed the dashboard address in dark blue, a smudge on PowerShell's blue | Bold and underlined in the terminal's own text colour, still a hyperlink where the terminal knows them. FRESH-13's exact bytes follow |
| W-7 | cosmetic | After the inner installer the PowerShell window kept Ubuntu's title | `get.ps1` keeps the title it found and puts it back when the run ends, also when it stops |
| W-8 | low (checked first: a display bug) | Without an AI key the Strategist box showed no model and "effort medium" while the level recommends Opus 5.5 at high. The empty model is meant (the strategist is off); the effort was the page's own fallback whatever was saved, half of a pair nobody chose | The box shows, greyed out, the pair the agents start on once the key is set (the server's `aiAll`: Sonnet 5.5 at medium on a new install); the level's line names it next to the recommendation. The Strategist bubble and the Dashboard page say so. Which pair a new install starts on is not changed (see below) |
| W-11 | low | After the line was pasted again, the first confirmed start kept an older release (1.0.0) as the spare and deleted the one that ran just before (1.0.1): `get.sh` never named the release it replaced | `get.sh` writes `versions/previous` = the release it replaces (never the same one, nothing on a first install). The undo still reads `versions/pending` only |
| W-12 | cosmetic | Long lines of the uninstall broke words at the edge of the 120-column window ("hold f / unds"; the user name after `loginctl disable-linger` fell to a line of its own) | Every line of both uninstall screens fits in 100 columns, also with a Linux user name of 32 characters. The three existing checks that pinned the single long lines pin the same words across the line break |
| W-DOC-1 | docs | `Add-WindowsCapability ... OpenSSH.Server` failed: "The specified package is not valid Windows package" | The walk-through tries it and, when it fails, says to install Microsoft's Win32-OpenSSH MSI (server only, its SHA-256 compared with the release page), which worked |
| W-DOC-2 | docs | The setup script went on after the failed step and printed errors that hid the first one | It is one script block that stops at a failed step with one sentence; it can be pasted again |
| W-DOC-3 | docs | `scp` to the PC failed ("Connection closed", no working SFTP subsystem) | The PC fetches the files with `curl.exe` from the laptop's server, which also serves `get.ps1` and the lines file |
| W-DOC-4 | docs | The desktop was a folder of OneDrive | The lines use `[Environment]::GetFolderPath('Desktop')` |
| W-DOC-5 | docs | The installed agent asks GitHub for updates: `FOXAGENT_RELEASES` reaches `get.sh` only. Step 12 found no update until `AGENT_UPDATE_URL` was put in `.env` | Section 3 says so, with the line |
| W-DOC-6 | docs | The updater takes plain http only from a loopback address: the laptop's address was refused ("the release source must be https") | A relay inside Ubuntu (a transient user unit) passes `127.0.0.1:8765` on to the laptop, typed inside Ubuntu, not through PowerShell's quoting |
| W-DOC-7 | docs | Copying lines from the chat to the PC was the hard part | `docs/WINDOWS-TEST-LINES.txt` holds every line of the walk-through in order; the laptop fills its address in and serves it; one line from the chat puts it on the desktop and opens it in Notepad |
| W-DOC-8 | docs | Task Scheduler's last result `0x800710E0` ("refused") looked like an error; pasting the line again puts the newest release in place with no undo note, so a broken newest one stays | The walk-through and Troubleshooting say that `0x800710E0` is normal while the task runs; the walk-through publishes a release that starts before step 11 and has a step for an update that does not start. The table names what the first PC skipped (the prompt and the restart) |

What passed on the PC, as the notes of 13 Nov have it:
- The virtualization check (the PC had it off; on again after the BIOS change), the Store WSL found without an
  administrator prompt or a restart, Ubuntu's first user, `/etc/wsl.conf` with one `[boot]`, the seven steps, the
  task ("logon and every 5 minutes", running, no window), the dashboard in Chrome.
- Every window closed for 15 minutes: the agent kept running, no stop and start. A restart of Windows: the task
  started Ubuntu at log on and the agent was up within a minute. `wsl --shutdown`: back by the task's 5-minute
  trigger after 4 min 38 s.
- With the rule removed from that PC's unit by hand (the owner's word): the update 1.0.0 to 1.0.1 from the
  dashboard and an update that did not start (undone by the launcher in about 94 seconds).
- The line pasted again: one task, one `[boot]`, `.env` kept. The uninstall on both sides said what it did.

Stays open:
- None of these fixes has run on the real PC yet: W-9 was seen working there only with the line removed by hand,
  W-6, W-13 and LOGIN-1 not at all. The 26.04 replay runs in a container with systemd as PID 1, not in WSL. A
  second walk-through with this code is the proof.
- An install made from the release candidate before this fix keeps the old unit. On Ubuntu 26.04 its one-click
  update fails with "the archive could not be unpacked" (its code is older than the plain message):
  `./install.sh --update` once in a terminal (or the line pasted again) fixes it for good. No public install exists
  (no release key is pinned yet), so the PC and the Mac of the owner are the only ones.
- The droplet's system unit keeps `RestrictSUIDSGID`. If a later change ever runs tar inside it on Ubuntu 26.04,
  the same failure comes back.
- Ubuntu 24.04's tar falls back from `openat2` today; a later update of it could stop doing so. New units no longer
  have the rule, so only an older unit would meet it; it would get the plain message.
- W-1 reads the drive of `%LOCALAPPDATA%`. An Ubuntu that was moved to another drive (`wsl --manage --move`) is not
  looked for, which is why the check before the installer only warns.
- W-3 tells what to do; QuickEdit is not turned off for the run.
- W-8: a new install still starts on Sonnet 5.5 at medium (`AGENT_MODEL`'s default) while every level recommends
  Opus 5.5 at high. Changing that default raises the AI spend: the owner's call.
- W-13 knows the keep-alive by its exact command line, as seen with the Store WSL 3.0.1.0 (a `wsl.exe` in
  System32 that starts a second one with the same arguments). Another WSL that starts it otherwise would leave it
  running, and the uninstall would not say so.
- The PowerShell checks run in PowerShell 7 in a container, not in Windows PowerShell 5.1.
- `systemctl is-system-running` said degraded on the PC (some unit of Ubuntu failed); `get.ps1` counts that as
  running and nobody looked at which unit it was. Ubuntu's own prompt is dark blue on PowerShell's blue too.

## Windows real-PC re-test (2026-11-14)

The owner walked through `docs/WINDOWS-TEST.md` again on the same PC (Windows 10 Home 22H2, build 19045, Windows
PowerShell 5.1, the Microsoft Store WSL 3.0.1.0) with the release candidate at 67f1031 (every fix of 13 Nov) and
throwaway releases served from the maintainer's laptop. Ubuntu was removed first (`wsl --unregister
Ubuntu`, on the owner's word, with the old test wallet empty) and `get.ps1` installed Ubuntu 26.04.1 anew. Every fix
of 13 Nov that the walk-through reaches passed on the PC. Five findings, none about money, keys or signing. The
fixes are by Claude Opus 5.5, each test first: the tests are in `test/win-1114/` (one file per id, `docs.test.ts`
for this record and the guides) and the PowerShell side in `test/windows/get-ps1.checks.ps1` (checks named after
the ids). Each was seen failing before its fix. W-18, the last row, comes from the same PC on 15 Nov, after the
one-line uninstall of W-17 ran there (the release candidate at 3171260); its fix is by Claude Opus 5.5, test first
like the others.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| W-15 | medium (the owner's view) | After a one-click update that failed (1.0.2 on the older unit of W-9b), the dashboard kept "Installing version 1.0.2. The agent restarts in a minute or two and this page comes back by itself." for up to 20 minutes and hid the failure and what to do. The agent had been idle with the failure for 4 min 45 s; only a reload showed it. The page's own `updating`, set by the click, ended only when the new version ran or after 20 minutes | With the click the page keeps the time of the result the agent held then (the agent's own `at`, never the page's clock). As soon as the agent is idle with a newer result for that very version (not installed or undone after it started), `updating` ends and the notice shows it. A result from before the click or for another version does not end it. While the agent is away restarting no answer comes, so that minute stays quiet |
| W-15b | low | Next to the old-install message ("Run ./install.sh --update once in a terminal, in the agent's folder ...") the dashboard still offered Update now, which fails the same way again on that install: the cause is the service an older installer wrote, not the release. On Windows "a terminal, in the agent's folder" named no way into Ubuntu. Only installs made before the W-9 fix see it | `UpdateError` carries a flag, `terminal`, set only for that failure. The updater keeps it with the result (`last.terminal`): the dashboard reads the flag, not the words. While it stands the notice offers no button for that version or a newer one (a newer one fails the same way there) and shows the message alone; for a newer version it adds that `./install.sh --update` installs the newest. It stays while the version that told it runs, also after a day. Under WSL (the kernel's name says so: the agent's service has no `WSL_DISTRO_NAME`) the message adds "On Windows: open PowerShell and type wsl -d Ubuntu --cd ~ , then cd foxleague-agent", the folder named from Ubuntu's home. Telegram's `/upgrade` still tries and says the same again |
| W-16 | low | After the install line was pasted again (it installed 1.0.4), the dashboard still showed in red "The update to 1.0.3 did not start and was undone: you run 1.0.2 as before..." under a header that said V1.0.4. The last one-click result was shown for a day whatever ran since | Each result names the version that told it (`ran`). The updater gives it only while that version runs: a re-install by hand and an update from a terminal drop it at once (after a terminal update the new version's own "Updated from ... to ..." follows once it has stayed up). A result written before the field existed (only release-candidate installs have one) is shown as before |
| W-14 | low | At Ubuntu's own `$` prompt after its first user was made, nothing on the screen said to type `exit`: the note was printed before "Ready?", about 15 lines above, among nine others. The owner typed it only because the chat told him | The note is repeated as the last line before `wsl --install -d Ubuntu` starts, in the yellow of the step titles: "When Ubuntu shows a line that ends with $, type  exit  and press Enter to come back here." The note among the others stays. The guides and the walk-through's lines file say it at the same place |
| W-17 | low (the owner chose the design) | The uninstall took lines in two shells: the PowerShell line, then inside Ubuntu `wsl -d Ubuntu --cd ~`, `cd ~/foxleague-agent && ./install.sh --uninstall` and `exit`. Pasted together, bash got `wsl ...` ("command not found") and Windows PowerShell 5.1 got the `&&` (a parser error): harmless, but confusing | After the task and its hidden `wsl.exe` (the order of W-13) the PowerShell line asks one question, "Also stop the agent and remove its background service in Ubuntu?" (Enter means yes, as at the other questions of `get.ps1` where going on is the point). Then it runs the folder's own `install.sh --uninstall` as the Linux user: `wsl.exe -d Ubuntu --cd ~ --exec /bin/bash <folder>/install.sh --uninstall`, each argument on its own and no shell of the user reading the line, as every other call of `get.ps1`. The folder is the one Ubuntu names (`$HOME/foxleague-agent` or `FOXAGENT_DIR` set in the window, held to the install's rules); one that is not a plain absolute path is never run. No distribution called Ubuntu, Ubuntu out of reach as its user, no `install.sh`, no background service, a refused `FOXAGENT_DIR`, an uninstall that fails and `n` are each said; where it helps the lines by hand follow, each marked with the window it is typed in. It waits for every `wsl.exe` it starts and starts nothing that stays, so Ubuntu still stops by itself. WIN-1's guard against `wsl.exe`'s own `--uninstall` (which removes WSL) allows exactly this call, whose `--uninstall` goes after `--exec`. The walk-through has one PowerShell line for step 15. Its lines file marks every block typed inside Ubuntu |
| W-18 | low (cosmetic) | After `-Uninstall` ran the uninstall inside Ubuntu and it ended well, the window said two things twice, one under the other: that the folder, the wallet words (`.env`), the data and the PEM files stay, and that the agent wallets may still hold funds. `install.sh --uninstall` inside Ubuntu said them, then `get.ps1` said them again | After "Done: the agent is stopped and its background service in Ubuntu is removed." `get.ps1` adds only what the installer inside cannot know: WSL, Ubuntu and the line `systemd=true` in `/etc/wsl.conf` stay, and Ubuntu stops a short while after its last window closes. `install.sh` says the other two on every uninstall that ends with 0 (the check reads them there). The answer `n`, an uninstall inside that failed, a folder without a service or without `install.sh` and an Ubuntu out of reach keep the whole text, with the lines by hand where they help. The check "W-18 ..." failed before the fix, and so did the line of the W-17 check that held the old repeat |

What passed on the PC, as the notes of 14 Nov have it:
- W-2 (no "You have System.Object[]" on a PC with no distribution), W-3 and W-4 (the notes before "Ready?"),
  LOGIN-1 (no default username), W-5 (the address readable on PowerShell's blue), W-6 (Edge opened the dashboard,
  twice), W-7 (the window's own title back after Ubuntu and the installer set theirs).
- W-9 on the new unit: the one-click update 1.0.0 to 1.0.1, back in about 45 seconds. W-9b with the rule put back
  into the unit by hand: the plain message, with tar's lines in the log (W-10); `./install.sh --update` in a
  terminal installed 1.0.2 and took the line out; the next one-click update, on the renewed unit, installed 1.0.3.
- An update that did not start (1.0.3 made with `--break-start`): back on 1.0.2 in about 96 seconds. W-11: after
  the line was pasted again `versions/` held v1.0.2 and v1.0.4 and the spare was the release it replaced.
- The restart of Windows: the dashboard answered from Windows about a minute after the boot. systemd said running
  with no failed unit (degraded on 13 Nov).
- W-12 (no word broken at the window's edge) and W-13: right after `-Uninstall` no task and no keep-alive
  `wsl.exe` were left. Ubuntu stopped about a minute after its last window closed.

Stays open:
- W-14 has not run on the real PC: it shows only while a new Ubuntu is installed. The other four passed there on
  15 Nov (the release candidate at 3171260, installed over the Ubuntu of 14 Nov, test releases 2.0.0 and 2.0.1):
  W-15 showed the failed 2.0.1 by itself about 20 seconds after Update now, with no reload; W-15b offered no
  Update now and gave the line for Windows; after `./install.sh --update` in a terminal the page of W-16 turned to
  V2.0.1 with "Updated from 2.0.0 to 2.0.1" and the failure gone; W-17's PowerShell line and one Enter ran the
  uninstall inside Ubuntu ("Done: the agent is stopped ...") and Ubuntu stopped within about 30 seconds, with no
  task left. A result written by the build of 14 Nov, before `ran` existed, showed under V2.0.0 until the next
  result took its place, as W-16 says. W-18 has not run on the real PC.
- Not seen on the PC, so not claimed: Enter alone at Ubuntu's username question (the owner typed a name); the
  free-space stop below 4 GB (C: had 6.27 GB); "Help improve Ubuntu!" and the "Welcome to WSL" window (neither came
  the second time). Step 9 (15 minutes with every window closed) was not repeated: it passed on 13 Nov and the task
  is made the same way.
- W-15 tells this attempt's result from an earlier one by the agent's time of it. A page whose state was older than
  the agent's last result at the click (an update asked on Telegram in between) can show that earlier result for a
  moment, until this attempt's comes.
- W-15b holds back only the dashboard's button. `/upgrade` on Telegram tries again and fails with the same message.
- W-17 knows "no Ubuntu" from the table of `wsl -l -v`; a WSL that cannot list its distributions looks the same.
  The uninstall then says what WSL lists and looks no further. Without the task Ubuntu stops by itself once its last
  window closes, with any agent inside it.
- W-18's fix has not run on the real PC: the checks run it against the stand-in `wsl.exe`.
- The PowerShell checks run in PowerShell 7 in a container, not in Windows PowerShell 5.1.

## GitHub review of PR #69 (2026-11-15)

The agent review of PR #69 on GitHub (the release candidate, Claude Fable 5.2 at high effort) found one low finding,
about updates only: nothing about money, keys or signing. The fix is by Claude Opus 5.5, test first: the test
"R69A-1: ..." in `test/update.test.ts` failed on the branch at 4988b8f for the reason given and passes now.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| R69A-1 | low (agent review of PR #69; updates only, fails closed) | `stage()` in `src/update/install.ts` released `versions/update.lock` only in its refusals (`fail()`) and on success. A file call that threw outside them (a full disk, a folder that cannot be written) left the lock, and every update for the next 30 minutes was refused as "another update is being installed right now". The running release was untouched. The test made `mkdirSync` of the staging folder throw and saw the lock left behind | Every way out of `stage()` after the lock is taken releases it and removes the staging folder, in a `finally`: a refusal, a file call that throws and success alike. A staging folder that cannot be removed is said in the log and the lock goes anyway (the next update and the next confirmed start try the folder again). A lock held by an update that is running still refuses and is kept; one older than 30 minutes is still taken over. The test covers `mkdirSync` and `renameSync` of the staging folder, a step that throws with the release unpacked, a lock taken over and the next update after them |

Stays open:
- The lock belongs to the folder and is told by its age alone, as before: an update that runs for more than 30
  minutes by the clock (a laptop that sleeps in the middle of it) can be taken over by a second one, and whichever
  ends first removes the lock while the other still runs. Preparing takes at most 15 minutes.

## Actions with a deadline run before it (2026-11-15)

Seen live on agent 7 six times in seven days, fixed on the owner's word. Each point has a test of the same name in
`test/deadline-first.test.ts` that failed on the branch at dcac14b (the action ran at its random moment, 47.5 minutes
into the window) and passes now. Only the moment an action runs changes: the executor checks every action against a
fresh snapshot when it runs, as before, and nothing skips a check. The pin of the tick's `runPlan` call in
`test/shadow-plan.test.ts` names the new argument.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| DL-1 | low (a plan's aim lost; nothing paid: the executor refused each late action) | `runPlan` gave every action of a plan a random moment of its window (0.8 of the tick, 48 minutes at 60), sorted to keep the plan's order, and nothing looked at an action's own deadline. A plan at 10:32 UTC left its unanswered targeted 2,500 Silver 1v1 (T5976) "now", 12 minutes before it ran out at 10:44, to send a challenge to another team; the leave ran at 10:58 and was refused ("can only leave an open tournament before its deadline"). Leaves were refused the same way on other days. The test saw a leave whose deadline was 12 minutes ahead run at 47.5 minutes | `scheduleActions` (service.ts) takes each action's deadline, read by `actionDeadline` (`src/executor/deadlines.ts`) from the snapshot the plan was made from, which the tick now hands to `runPlan`. An action with a deadline runs at the latest 5 minutes before it (`DEADLINE_MARGIN_MS`): before it runs a fresh snapshot is read (tens of seconds), the action before it may run about a minute late and a payment must settle and reach FoxLeague in time. The test sees it run at 7 minutes |
| DL-2 | design | Moving one action earlier could undo what the plan's order holds: a lineup before its match, a swap before the bid it funds, a leave before the challenge that needs the free 1v1 slot | The order never changes. The actions before a deadline action move earlier with it, 90 s apart (`ACTION_RUN_MS`, what one action takes to run), so their own run time does not push it late; one whose draw is earlier keeps it and the actions after it keep their draws. The prompt's "Actions run in the order you list them" stays true |
| DL-3 | design | A deadline already past, or closer than the margin | It runs at once, at the first slot (after the actions before it, at the gap). A deadline that has passed is refused by the executor with its reason |
| DL-4 | design (rule 4: unknown is not "none") | A deadline that cannot be read must not be taken for no deadline: its tournament in no list of the snapshot, a deadline that is no time, no snapshot at all, an auction without an end or one the snapshot does not show | It runs early: at the start of the window, after the actions before it, never late |
| DL-5 | design | Actions without a deadline, the match gates and the drops | The drops are decided first, exactly as without deadlines, and only the kept actions are then placed with the deadlines (R70A-2): the same draws, the same gates (13 minutes after a match, 16 between ranked starts, the agent's starts before the plan included) and the same drops, with or without deadlines. No action runs later than it would without them; the actions before a deadline action may run earlier (DL-2). Test D1's cases pass as they were |
| DL-6 | low (as DL-1) | A bid on an auction that ends inside the window ran at a random moment, possibly after the end | It runs by the end less 5 minutes; a swap before it in the plan runs before it |
| DL-7 | design | Which actions have a time limit, and the executor's own margins | `join_tournament` (accepting a 1v1 too): the registration deadline (less the 120 s the executor keeps for a paid entry), its start when sooner and for a League + Knockout its invitation's expiry less 30 minutes. `leave_tournament`: the deadline and for a League + Knockout seat its seats lock less 30 minutes. `widen_range`: the deadline. `bid`: the auction's end. `cancel_listing`: unread (the market list leaves the agent's own auctions out), so early. The times come from the agent's own tournaments, the open ones, the 1v1s aimed at it and its invitations; the earliest copy counts. No other action has one; the next strategy lock still cuts the whole window in `runPlan` |
| R70A-1 | low (agent review of PR #70; tests only, no code changed) | Three behaviours of this change had no test that failed without them: a League + Knockout join whose invitation is not in the snapshot (the invitations unread, none pending or only another tournament's) is unread and runs early, not by its registration deadline hours away; the earliest copy of a tournament sets its deadline and an entry is free (no 120 s) only when every copy says a free Bronze; a gated match listed before a deadline action keeps the plan's order, the deadline action waiting behind it | Three tests "R70A-1: ..." in `test/deadline-first.test.ts`, one per behaviour. Each passes on the code as it is and was proved by breaking its behaviour for a moment, then restoring the code exactly: without the League + Knockout branch the join got its registration deadline less 120 s instead of unread; with `closes` taking the first copy the deadline came out 28 minutes late (the 40-minute copy over the 12-minute one); with "free when any copy says so" a Bronze copy with a fee lost the 120 s, and with "free by the first copy" a 1v1 aimed at this team lost it; with the deadline action no longer waiting on the match before it and the schedule sorted by time, the leave ran ahead of the ranked match (without the sort it ran at 0 instead of 11.5). No bug was found |
| R70A-2 | medium (correctness, no money at risk: the executor refuses a late action; re-review of PR #70) | Moving the actions before a deadline action earlier could keep a match that the schedule without deadlines dropped, and that match's gate then held the deadline action past its deadline, later than it ran before this change. Plan `[ranked, ranked, leave]`, a 48-minute window, a 30 s gap, the leave's deadline at 39 minutes, draws 33, 33 and 34: without deadlines the second ranked was gated to 49, past the window, so dropped, and the leave ran at 34; with them the first ranked moved to 31, the second was kept at 47 and the leave ran at 47.5, 8.5 minutes after its deadline. It flipped the other way too: with a casual match third in that plan, kept at 46 without deadlines, the second ranked was kept at 45.5 and the casual dropped. It made DL-5's "the same drops" and the open point's "as before" untrue | `scheduleActions` decides the drops first in a pass without deadlines (every latest moment at infinity, the schedule as it was before this change), then places the kept actions with the deadlines in a second pass that skips those drops and drops nothing more (`placeActions`). The latest moments are counted back over the kept actions only, as a dropped match takes no room. With the same matches kept, every gate starts from the same match at the same moment or earlier, so no action runs later than without deadlines. Three tests "R70A-2: ..." in `test/deadline-first.test.ts` failed on 90adee0 and pass now: the reviewer's case (nothing was dropped; now the second ranked is, the leave runs at 34 and the first ranked 90 s before it, at 32.5, by DL-2), the casual case (the casual was dropped in place of the second ranked; now it is kept at 44, 2 minutes sooner than without deadlines) and a property test over 600 seeded random plans, deadlines and draws (7 failed; now none: the same drops with the same reasons, no kept action later, the order and the gap held). A run of 200,000 such cases outside the suite found none either |

What was checked and needs no change:
- `src/strategist/prompt.ts` says "Actions run in the order you list them, spread over the next window. Every action is
  re-checked against fresh state right before it runs." That stays true, so it is not changed (it is byte-stable for
  the prompt cache). `src/strategist/manual.md` says nothing of when a plan's actions run.

Stays open:
- A match listed before a deadline action keeps its gates: when they hold it past its latest moment, it runs late and
  the executor refuses it. It never runs later than it would without deadlines (R70A-2: the same matches kept, each at
  the same moment or earlier), so a deadline action that ran in time before this change still does. The order is never
  changed to pass a match (test R70A-1). Dropping such a match, so that the deadline action after it runs in time, is
  a design choice for the owner (named in the re-review of PR #70) and is not made here: test R70A-2's casual case
  shows it.
- The schedule is planned, run times are not: actions before it that each take longer than 90 s (a slow snapshot, a
  transaction waiting for its confirmation) still push it later by what they take over 90 s, inside the 5-minute
  margin for a few of them.
- Pieces an extension cuts from an action (`src/extensions.ts`) queue behind it at the gap: a split action before a
  deadline action pushes it later by a gap a piece, and the later pieces of a split deadline action may run past it
  (the executor checks each).
- A race is no deadline: an open 1v1 another team accepts first is active whatever the moment (the join refused as
  "is active" 20 minutes after the plan chose it may have been that).
- A deadline that moves after the plan (a 1v1 that fills: its deadline becomes now) is seen by the executor when the
  action runs, not by the schedule.
- The 1v1 busy window FoxLeague serves (`viewer_tournament_window_opens_in_secs`) is read from the tournament's detail
  when the join runs; the schedule does not use it.
- `cancel_listing` runs early in every plan that has one.

## GitHub review of PR #71 (2026-11-15)

The agent review of PR #71 on GitHub (the install videos on the site, Claude Fable 5.2 at high effort) passed it with
one low finding, about the site's videos only: nothing about money, keys or signing. The fix is by Claude Opus 5.5,
test first: the five tests "R71A-1 ..." in `test/install-videos.test.ts` failed on the branch at a689a57 (the script
was not in the repository) and pass now. Its re-review after 22b2dae and 668e162 passed it with one more low finding
(R71A-2), about the maintainer's own computer only. The fix is by Claude Opus 5.5, test first: the test "R71A-2: ..."
in `test/audit-1111/install-12.test.ts` failed on the branch at 668e162 on the two lines named and passes now.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| R71A-1 | low (agent review of PR #71; tests and hygiene, the site only) | The three install videos at the top of the install pages (`site/public/videos/install-{windows,mac,linux}.{mp4,jpg}`) had no test and the script that draws them was not in the repository. A missing or misnamed video or poster failed no test, nor did a page that gives the wrong length. When an installer line the videos show changed (this pull request changed one, the Telegram question), the videos went stale and nobody but their author could draw them again | The script moves into `site/scripts/videos/`, next to `site/scripts/screenshots.ts`, with its README (how to draw the videos again and when) and its own pinned development packages (Playwright's core and two fonts; the agent and the site do not get them). It finds the repository from where it sits. `test/install-videos.test.ts` holds that every install page names its own video and poster, that every file in `site/public/videos` is shown on a page and that each MP4 is real, has its index at the front and the length its page says twice. It holds every one of the 132 installer lines the videos quote: each must still stand in its file, found by its text, so a line that only moved fails nothing; a changed one fails with the lines named and "Re-render the videos". It holds that the script draws on example values only: the user ana, word1 to word24, a made-up address with a wrong checksum that every terminal screen tags as an example, a throwaway wallet, no key, no env file, no upstream it could reach. `site/README.md` names the script |
| R71A-2 | low (agent re-review of PR #71; supply chain hygiene, the maintainer's computer only) | The steps to draw the install videos again (`site/scripts/videos/README.md:67`) built the site with `cd site && npm ci && npm run build`; the site's own README (`site/README.md:8`) said `npm install`. A maintainer who follows either page runs the install scripts of the site's dependency tree (esbuild, sharp and fsevents have one today) on their own computer, next to their SSH agent and GitHub login; CI never runs them, so nothing shows. INSTALL-12 closed that for `site/deploy-site.sh` and `site/Dockerfile`, but its test reads scripts only | Both pages say `npm ci --ignore-scripts`, the way `site/deploy-site.sh` builds: a clean clone of this branch installs the site that way and builds its 21 pages. The videos' own folder already did: its three packages have no install script (playwright-core downloads no browser; the README asks for Chrome on the machine). The test "R71A-2: ..." next to INSTALL-12 holds every `npm ci` or `npm install` of the READMEs, `AGENTS.md`, `INSTALL.md`, `docs/` and the site's manual to carry `--ignore-scripts` in the same command. `docs/SECURITY-REVIEW.md` is left out: its rows quote the old commands as the findings they were |

Stays open:
- What a frame shows cannot be read by a test: the tests hold the quoted lines, the files and the example values,
  not the pictures. The screens the videos take from the dashboard (the login, the Getting started guide, the update
  notice) and from the install page can change while every test stays green; the script's README says to look at a
  few stills after such a change.
- A short quote ("Done", "Running.", `cd ~/foxleague-agent`) holds while any line of its file has its words. A change
  to that one line while the same words stand elsewhere in the file is not seen.
- No video was drawn again: every quote holds on this branch. The line numbers in the script are hints for people;
  the eight lines of the install pages that the new video block moved down by five are updated.
- R71A-2 reads the pages it names, one line at a time, for `npm ci`, `npm install` and `npm i`. A command split over
  two lines, another package manager or a comment in a script is not seen: the header of
  `scripts/release/fresh-install-check.sh` says it needs "`npm ci` done in this folder" (the script itself asks for
  `npm ci --ignore-scripts` when the packages are missing).

## Daily check of FoxLeague's manual (2026-11-15)

On 15 Nov the agents' manual (`src/strategist/manual.md`, synced at FoxLeague's 89a1955d7 of 10 Nov) was five days
behind the manual FoxLeague serves (its main at 9ebcbc52d of 13 Nov, with a fusion change) and nobody was told:
`manual-status` needs a FoxLeague checkout and `deploy/deploy.sh` runs it only at a deploy, on the maintainer's
computer. The live server has no checkout. The owner said yes to a daily check on 15 Nov. It is about what the agents
know, not what they may pay: the code still checks every action against the game rules and the caps. Built by Claude
Opus 5.5, test first: each test of the same name in `test/manual-watch.test.ts` failed against a skeleton of the
module (its shape only: "current" with nothing read, no line, no notice) and passes now.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| MW-1 | low (the owner, 2026-11-15; game knowledge) | Nothing told the owner that FoxLeague's manual had moved ahead of the agents' copy | `src/strategist/manual-watch.ts` asks FoxLeague's public read-only MCP server (`https://foxleague.ai/mcp`, the tools `list_manual_pages` and `get_manual_page`) for the pages it serves and compares each page the agents take in with the fingerprint sync-manual recorded for it (sha256 of its body as FoxLeague's server builds it, whitespace folded). A changed page, a new one and one that went are named. The signal changes only when the manual changes, not with every FoxLeague deploy. Run once against the live server on 15 Nov: it named the seven pages that changed between 89a1955d7 and FoxLeague's main (players, sync, tournaments, permanent records, marketplace, fusion, economy map) and none of the five pages left out on purpose that changed too; a record built from FoxLeague's main came out current |
| MW-2 | with MW-1 | The check must not report a difference that is no change of the rules | Pages left out on purpose (`LEFT_OUT` in `manual.ts`: connect-ai, the World Cup preview, the terms and the others) are not compared. A change of line breaks or of a page's title alone is no change. "current" comes only from reading the list and every page compared |
| MW-3 | with MW-1 (rule 4) | A check that cannot read FoxLeague must never say "current" | Every failure ends the day's check as "unknown" with the reason in our own words, never FoxLeague's text: no network, an HTTP error, an answer that is not JSON-RPC, a tool error, an empty list, a slug that is no slug, a page other than the one asked, a request over 15 seconds or a check over 90. No page record, a record of another `manual.md` or a `manual.md` that cannot be read say so without asking FoxLeague |
| MW-4 | with MW-1 (polite) | The check must not load FoxLeague or send anything of the install | One request for the list and one per page the agents know (17 today), 0.6 seconds apart (FoxLeague's nginx allows 2 a second on `/mcp`), no retry. Each is a POST of a read-only tool call, the only way the MCP route answers, with a fixed client name and no cookie, key or address |
| MW-5 | with MW-1 | At most once a day | The day (in the summary's time zone) is written to the database before anything is asked: a second call, a call while one runs, a restart and a failed check ask nothing more that day. `AGENT_MANUAL_CHECK=0` switches it off; a service a test builds asks nobody |
| MW-6 | with MW-1 | The owner's Telegram is quiet on purpose | No message of its own: the morning summary carries one line, "FoxLeague's manual changed since the agents' copy (pages: ...). The maintainer runs sync-manual." or "Could not check FoxLeague's manual today: ...". It has none while the copy is current. The summary runs the day's check before it is built; `/summary` reads the same check |
| MW-7 | with MW-1 | Where Telegram is not linked the owner still has to see it | A notice under the dashboard's header with its info bubble, shown only when there is something to tell, set as plain text. Without Telegram the service runs the check from the summary's hour on, looked at every hour |
| MW-8 | with MW-1 | The comparison needs what the agents' copy was built from | `sync-manual` writes `src/strategist/manual-pages.json` next to `manual.md`: the commit, the sha256 of `manual.md` and a fingerprint per page, read from the same FoxLeague checkout (read only, after its fetch). The test holds that the committed record belongs to the committed `manual.md`. The record on this branch was built from 89a1955d7 without a fetch and matches `manual.md` byte for byte |
| MW-9 | with MW-1 | The maintainer needs the same answer without a checkout | `manual-check` runs the same check from the command line (`./cli.sh manual-check`, `agentctl.sh manual-check` on a server): exit code 0 current, 2 changed, 1 could not check. It writes nothing |
| MW-10 | with MW-1 (docs) | The guides must say what the line means and what to do | `docs/SERVER.md`, the Update, Troubleshooting, Safety, Dashboard and Talk pages of the site, README and `.env.example` |

Stays open:
- The page text is built at sync time by a copy of FoxLeague's `mcp/src/resources.ts` (front matter off, MDX imports
  and comments off). If FoxLeague changes how its server builds the pages, every page reads as changed and
  `sync-manual` does not clear the line: `servedBody` and `liveBody` in `manual-watch.ts` then follow FoxLeague's file.
  The check fails loud there, not silent.
- FoxLeague's MCP server serves the manual its container was built with. A manual deployed to docs.foxleague.ai
  without a new MCP server is not seen. On 15 Nov the server served FoxLeague's main.
- FoxLeague deploys a release branch before it promotes it to main (on 15 Nov `release/mainnet-1.0` held the
  MetaStaking Shop discount of 1 Dec, not served yet). `sync-manual` reads main, so a page FoxLeague serves before its
  main has it stays named after a sync until FoxLeague promotes it. The reverse (main ahead of what is served) is
  named too: the line says that the pages differ, not which side is newer.
- A page the agents take in that FoxLeague's server does not serve (a draft, a page outside the sidebar) is not
  compared; once FoxLeague serves it, it is named "(new)" until the next sync.
- The check runs from the hour of the morning summary: a change FoxLeague makes later that day is told the next
  morning.
- FoxLeague's server answers a tool call without an `initialize` first (stateless). If that changes, the line says
  "could not check" every day until the check sends one.
- Merge order with the sync branch (`foxleague-sync-1113`): whichever merges second, `sync-manual` runs once more with
  this code so that `manual-pages.json` follows the new `manual.md`. Until then the daily check says that the record
  is not the one of `manual.md` and MW-8 fails.

GitHub review of PR #72 (2026-11-15). The agent review of this pull request on GitHub (Claude Fable 5.2 at high
effort) passed it with two medium and three low findings, none about money, keys or signing. The fixes are by Claude
Opus 5.5, test first, in `test/manual-watch.test.ts`: the tests "R72A-1 ...", "R72A-2 ..." and "R72A-3 ..." each
failed on the branch before their fix and pass now. "R72A-4 ..." and "R72A-5 ..." add the cases that were missing:
they passed on the code as it was and were each seen failing on four breaks of the code they hold, restored after.
The re-review after those fixes (the same reviewer) passed the pull request with one new medium finding, R72A-6,
fixed the same way: "R72A-6 a slug longer than 120 characters ..." and "R72A-6 many pages ..." failed before the fix
and pass now.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| R72A-1 | medium (agent review of PR #72; memory of the process that signs) | `callTool` in `src/strategist/manual-watch.ts` read FoxLeague's answer whole with `res.text()` and compared its size only afterwards: the comment "An answer larger than this is not read" was not true. Whatever answers at `FOXLEAGUE_URL/mcp` (FoxLeague on a bad day, a proxy in front of it or a compressed answer that unpacks to gigabytes) could fill the memory of the process that books and signs, once a day. `src/util/http.ts` had closed this for every other FoxLeague read (ATTACK-5) | The answer is read with `readCapped`, now exported from `src/util/http.ts` with a cap per caller: 2 MB here, counted as it streams and cut off past it, a declared `content-length` over it refused unread, a compressed answer counted by what it unpacks to. Its refusal is an `AnswerTooLargeError`, which the check says as "FoxLeague's answer could not be read"; a timeout or a cut connection while reading is told as before. The test streams 64 MB: the old read took in all of it, the new one stops after at most 4 MB and cancels the stream. One that declares 64 MB is refused with nothing more read |
| R72A-2 | medium (agent review of PR #72; a notice that outlived its copy) | The stored check was kept by the day only. After an update or a deploy brought a new `manual.md` the same day, the dashboard and `/summary` kept saying "FoxLeague's manual changed since the agents' copy (pages: ...)" until the next morning, while `manual-check` said the copy matched. The same held for "the page record is not the one of the agents' manual.md" after the record was fixed and deployed | The stored check carries a key of the copy it compared: the sha256 of `manual.md` with its page record, as read. A check of another copy is not shown (the dashboard has no notice, the summary line says that it could not check) and the day's check runs again for the copy installed now. Still at most once a day per copy: another call or a restart on the same copy asks nothing more. A fixed record alone counts as a new copy. The test failed on the dashboard showing copy A's line to the service restarted on copy B |
| R72A-3 | low (agent review of PR #72; the dashboard) | While the day's check ran (about 10 seconds, up to 90) the dashboard showed its restart marker as a failed check: "Could not check FoxLeague's manual today: the check did not finish." The dashboard loads every 15 seconds, so on most days one load showed it, in place of the day before's notice | While a check runs, the dashboard and the summary line give the check before it (nothing on the very first check). The marker keeps its meaning where no check runs: a service that restarted while one was under way still says "the check did not finish". The test failed on the marker shown while FoxLeague held its answer |
| R72A-4 | low (agent review of PR #72; tests) | The path without Telegram (`armManualCheck` in `src/service.ts`: from the summary hour, every hour, cleared at stop) had no test, though MW-7 names it | The test holds it on mocked timers: the first look three minutes after a start then every hour, nothing asked before the summary hour, a start after the hour asks at its first look, nothing after a stop and nothing when switched off. It failed on each of four breaks: no hour condition, no hourly look, the timer kept at stop, armed when switched off |
| R72A-5 | low (agent review of PR #72; tests) | The `text/event-stream` branch of `callTool` and the refusals past the size cap and past `MAX_PAGES` had no case in MW-3 | The test holds that an answer sent as server-sent events is read from its last data line (alone or after a notification) and one with no data line is refused; that an answer of exactly the cap is read while one byte more is refused with nothing asked after it; that a list of 200 pages is compared while 201 are refused unread. It failed on each of four breaks: the stream branch not taken, the first data line read, no cap of its own, the page count off by one |
| R72A-6 | medium (agent re-review of PR #72; the owner's Telegram and the dashboard) | A slug had no length limit: `SLUG` in `src/strategist/manual-watch.ts` limits its characters and its five parts, not their length. One list answer under the 2 MB cap with long slugs (one of 1.9 MB or 196 of 10,000 characters) passed `SLUG` and `MAX_PAGES`, ended as "behind" and put about 2 MB of FoxLeague's text into the line of the morning summary: about 500 Telegram messages on the one send queue, holding urgent warnings, top-up codes and the answers to `/kill` back for 10 minutes or more, sent once more by `/summary`. The same text went into the stored check and into every `/api/state`, every 15 seconds per open dashboard | A slug longer than 120 characters (`MAX_SLUG`; the longest real one has 29) makes FoxLeague's list unreadable: "Could not check FoxLeague's manual today: FoxLeague's answer could not be read." (rule 4), with nothing asked after it. The page record takes the same cap. The owner's line names at most eight pages (`MAX_NAMED`) and counts the rest ("... and 188 more"), so a manual FoxLeague rebuilt with 200 pages stays a line of about 1,100 characters in a summary of one message. The stored check and `/api/state` keep the full list: at most 200 slugs of 120 characters. The first test failed on a slug of 121 characters taken as a new page; it refuses slugs of 121 characters, 10,000 characters and 1.9 MB as well as 196 of 10,000 unread, takes one of 120 and holds that a record with a long slug is no record. The second failed on nine pages all named; eight are all named, nine name eight "and 1 more" and 200 of the longest give a line under 1,500 characters. Error texts and titles: the third test (each of 1.5 MB: an HTTP error page, a JSON-RPC error, a tool refusal, an answer that is not JSON, a cut connection, a page of another slug as well as a title in the list) passed on the code as it was, since every reason the check gives is in our own words and titles are not read. It stays as a guard: it failed on two breaks, FoxLeague's error page in the reason and the network error's message in the reason, restored after |

Stays open after the review:
- Between a deploy of a new copy and its first check the dashboard shows no notice, as on a first start: a check is
  never shown for a copy it did not compare. Before the summary hour that lasts until the hour (the morning summary
  runs the check before it is sent, so it always carries the line of the copy installed).
- A copy rolled back and forward the same day is checked once per change: each deploy of another copy asks once
  more (one list and one request per page). It stays bounded by the deploys.
- The key of the copy is taken from `manual.md` (about 245 KB) and its record each time the dashboard loads its
  state (every 15 seconds while it is open): about a millisecond, nothing cached.
- A check a restart cut short still counts as made for that copy that day (MW-5): its line says that the check did
  not finish until the next day or the next copy.
- The line names the first eight pages in FoxLeague's order with the pages that went last (R72A-6): in a large
  change a changed page can be among those counted, not named. `sync-manual` shows the maintainer every page.
- The number of pages in the page record has no cap of its own: it is the maintainer's file, built by `sync-manual`
  from a FoxLeague checkout, not read from FoxLeague's server. The line names at most eight of them either way.

## FoxLeague mainnet of 13 Nov: fusion mint and the rest (2026-11-15)

FoxLeague's `origin/main` from `89a1955d7` (the last sync, 2026-11-10) to `56e5b9855` (its promotion #742 of
2026-11-13, manual `9ebcbc52d`), read through git only. On chain, read only: the players contract was upgraded on
mainnet at 2026-11-13 21:32:50 UTC to the fusionMint build (72,036 bytes, code hash `e628771c...`,
`getFusionMintVersion` 2) and `/api/config` serves `fusion_mint: {live: false, live_from: "2026-11-20T14:00:00Z",
paused: false}`. The agent's fusion was correct and safe on mainnet that day: until the switch the old fusion runs on
the upgraded contract, the agent's 21M gas was 1.38x of the 15.26M it now uses; from the switch FoxLeague's
pre-check (`can-fuse` with nonces answers an error) makes the agent refuse every fusion before anything is signed.
What it lacked: the switch itself (a fusion signed in the minute around it could revert, the gas lost) and the new
fusion (from the switch it could never fuse again). The fixes are by Claude Opus 5.5, test first: each test under
`test/foxleague-1113/` failed on `1a3dffb` for the reason given and passes now. `docs/FOXLEAGUE-INTEGRATION.md`
sections 1.7, 4.5, 13.5 and 26 and `docs/ECONOMY-AND-RULES.md` sections 8, 9, 10, 14, 17 and 20 carry the details.
R73A-1 and R73A-2 come from the GitHub review of PR #73 (two lows, no other finding). The tests of R73A-2 failed on the
branch at `f919d43` for the reason given; those of R73A-1 pass there, as the code was right, and each was seen failing
with the behaviour it pins broken in the source, which was then restored.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| FL13-1 | low (bookkeeping of the registration fee; FoxLeague #717) | FoxLeague's relay answers HTTP 409 in its own envelope for two new guards that run before anything is signed or sent: a relay of the wallet still in flight (G17) and another transaction of the wallet waiting in the pool (G16). The agent knew 403, 429 and 503 only, so a 409 kept the 5,000 FOXSY fee booked in the setup budget and told the owner the payment may have gone out | 409 joins the statuses that release the booking. The relay's 400 (the wallet address) stays on the careful side as MONEY-3 pins it |
| FL13-2 | low (gas; the players contract upgrade of 13 Nov) | Every call of the upgraded players contract uses about 834,300 gas more. The agent's limits fell to 1.27x to 1.38x of the gas used: still above 1x but under the owner's 1.4x to 1.8x band; the next upgrade adds as much again | FoxLeague's new limits: fusion 22.8M, waivers 17.5M, shopPay 14M, auction list 17.2M, bid 15.8M, cancel 13.9M, each about 1.5x; registerAndPay keeps 12M, bound by the relay ceiling as in FoxLeague's app. The test holds each one inside 1.4x to 1.8x of FoxLeague's measured gas on the 72,036-byte contract; the two tests that pinned the old fusion and shopPay limits pin the new ones |
| FL13-3 | low (gas only; fails closed) | The agent read none of FoxLeague's fusion switch. A plan's actions run over most of an hour, so a pre-check read just before `live_from` could send an old fusion that reaches the chain after it and reverts (FoxLeague's own pre-check reads its probe once a minute). `paused` (the contract and the server speak different fusion versions) and a config without the switch were no reason to stop | `fusionMode` (`src/foxleague/levels.ts`) reads the switch at the action's own time: no fusion while it cannot be read (a block that is not exactly `{live, live_from, paused}`), while `paused` or in the 10 minutes before `live_from`; the old fusion only before them. The fixture and the market test's config carry the switch as FoxLeague serves it |
| FL13-4 | medium (game rules; from 2026-11-20 14:00 UTC; nothing unsafe) | From the switch every fusion is FoxLeague's `fusionMint`: the server signs the inputs' live attributes and the new card (`POST /api/fusion/prepare`) and the wallet signs the data it serves with the gas limit it serves. The agent knew only the old fusion: from the switch its pre-check is an error and the pool is empty, so it could never fuse again | From the switch the executor asks the prepare (once more after FoxLeague's 2-second pace), takes its refusal as its word and an unanswered prepare as no "yes"; it signs the served data with the served gas only when it is exactly the fusion planned (`fusionMintTx` in `src/executor/tx.ts`): a self transfer of the fee of the rarity and nothing more (the cost the answer names too), the three planned cards in their order as transfers and as signed inputs, `fusionMint`, the position asked, an expiry 2 to 20 minutes ahead, a 64-byte signature, 26 parts, gas inside 24.3M to 48.6M as in FoxLeague's app. Its own card checks stay; no sync, can-fuse or pool from the switch. The notes name the card FoxLeague says it mints. A dry run simulates the same data |
| FL13-5 | low (words only) | `GET /api/fusion/can-fuse` serves the wallet spacing left as text (`"0d 19h"`); the agent divided it by 3,600 and its refusal said "NaN h left" | Text of that shape is read as it is, seconds as hours, anything else left out |
| FL13-6 | low (what the plan knows; from the switch) | The prompt said only that the contract draws a random card from the pool (so the result is never known) and that inputs need synced stats; the snapshot said nothing of the switch. From it the plan would weigh every fusion by a rule that no longer runs | The snapshot's Fusion line says which fusion runs and when it changes, with the rule. The prompt's fusion paragraph gives both fusions and the average rule with its floors and what it means (a stat reaches the new cap only when all three hold it; one trained card does not carry two untrained ones). Only that paragraph of the prompt changes: its rule is wrong from the switch |
| R73A-1 | low (tests; GitHub review of PR #73) | No test ran the branches of the executor's `prepareFusion`: FL13-4 handed `{ refusal }` and `null` to `checkAction` directly and stubbed only a prepare that answers. An edit that let the error leave `prepareFusion` (every fusion from the switch an executor error) or looped on the pace code (the wallet's lock held while it asks again and again) left every test green | `test/foxleague-1113/r73a-1-fusion-prepare-paths.test.ts` runs them live through the executor with mocked timers: FoxLeague's pace refusal (`fusion_prepare_pace`) is not asked again before 2.1 s, is asked once more at 2.1 s and never a third time, then signs or takes the refusal as FoxLeague's word; its refusal is refused in its words; a timeout, a plain error or an answer that is not its envelope is refused as unprepared. None of them books or signs anything. Seen failing with no retry, a 1-second wait, no bound on the retry, the refusal or the error leaving `prepareFusion` and an answer that is not the envelope read as FoxLeague's word |
| R73A-2 | low (hygiene, no money; GitHub review of PR #73) | From the switch the executor asked the prepare (`POST /api/fusion/prepare`, a write on FoxLeague: a new card signed for 10 minutes, one every 2 seconds a wallet, up to 45 s) while it read the context, before any check of its own, and in a dry run too. A fuse refused for what the agent already knew (a listed card, a card in its fusion cooldown, one on the bench, short of its gate, the fee above Max shop payment or the FOXSY for it, no prices, the daily cap, the EGLD for gas) still cost a prepare and that time under the wallet's lock; a dry run asked one for every fuse. The test saw a prepare asked for each of those nine, live and in a dry run | Until the executor asks, the rules see `FUSION_UNASKED` and allow a fusion that passes every other check as `unprepared`, with nothing to sign. Live, the caps and the EGLD for gas are then checked with the least a fusionMint that `fusionMintTx` would sign can cost (`fusionMintBound`: the band's floor, the shortest card data), so they refuse only what the served fusion could not pass; only then is the prepare asked (once more after the pace), and its answer goes through the rules, the caps and the EGLD check again. A missing or refused prepare refuses and the served data is checked exactly as before; only a prepared fusion is built to be signed. A dry run asks no prepare and simulates no fusionMint (the signature in it is FoxLeague's): it books the fee and the most a fusionMint's gas can be (the band's ceiling, the longest card data). This replaces the last sentence of FL13-4: a dry run no longer simulates the served data |

Also in this change: the game manual copy is synced to `9ebcbc52d` (16 pages, none left undecided). The rules with
the manual are now about 105,000 tokens: DOCS-4 asked for the stated size to be restated (the five places and MS-C
say so; the cost of a plan at the defaults stays about $0.25). The site's "How it plays" says how the agent fuses.

What was checked and needs no change:
- #701: at most 10 shop confirmations a wallet in 60 s (`/shop/confirm`, `/shop/medicine`, `/shop/ranked-ticket`,
  `/shop/waive-cooldown`). Past it FoxLeague answers HTTP 429 with code `tx_pending` and "Your payment is kept"; the
  agent reads `tx_pending` as "confirm the same hash again", never as refused or refunded. The request is unchanged.
- #717's free onboarding badges (10 a day per connection) count only the free draw of a wallet with no team; the
  agent's badge is a regeneration of a registered team, so many agents on one server are not affected.
- #731 (fusion notifications), #730 (a forfeit is not broadcast; no new phase or status), #737 (`permanent_replay`,
  ships off), #733 (My interests): nothing the agent reads changes.
- `docs/manual/openapi.json`: no route the agent calls moved or lost a field it reads.
- A sync's served gas limit is 18M + 3M a card since the upgrade; the agent signs up to 20M + 3M a card.

Stays open:
- The served fusionMint is checked for everything that moves money or cards. The new card itself (its face, name,
  country, shirt and stats) and the inputs' signed attributes are FoxLeague's, signed by its game server and checked
  by the contract, as a sync payload's are; the preview is shown in the notes, not compared with the agent's own sum.
- FoxLeague's served fusionMint gas is its estimate (21.4M of processing; its contract audit measured 21.2M to 24.3M
  on the Go VM); the first mainnet fusionMints will show it. The agent signs only inside FoxLeague's band.
- The plan gets the rule and each card's stats, not a computed result per candidate fusion: the model does the sum.
- Since R73A-2 a dry run does not hear FoxLeague's own checks of a fusion that mints (the wallet's 20-hour spacing, the
  cards on chain, a reserved face): it may show a fusion as done that FoxLeague would refuse live. Live, that refusal
  comes before anything is booked or signed.
- The relay's 400 stays on the careful side (MONEY-3); FoxLeague's app counts it as refused before the broadcast.
- The manual now documents that a wallet holding 18 cards registers without the fee (no starter squad). The agent
  pays the fee as before; a new agent's wallet holds no card, so it never meets the case.
- The rules and the manual are about 105,000 tokens by the measured ratio, above Haiku 5.5's 100,000-token card.
- Production was not read: agent 7's confirmed fusion of 13 Nov is from the owner's activity. Until this is deployed,
  the running agents fuse the old way until the switch and refuse every fusion from it (FoxLeague's pre-check); it has
  to be live before 2026-11-20 14:00 UTC for them to fuse after it.
- `sync-manual` and `manual-status` fetch in the FoxLeague checkout they are given. The FoxLeague checkout is read
  only here, so both ran against a scratch mirror of its `origin/main` at `56e5b9855`; run `manual-status` on the
  checkout itself before the deploy.

## A tournament start to the minute (2026-11-15)

Seen live at 17:09 UTC. Following the owner's new organizer line, agents 7 and 9 (Opus) each planned a public Silver
round robin in the only free gap of FoxLeague's calendar in the next 72 hours: 17 Nov 18:48 to 21:00 UTC. A tournament
books 1 hour before its start to 1 hour after its estimate (3 minutes a match), so only a 3-team round robin fits,
starting from 19:48 to 19:51. Both sent `"starts_in_hours": 50.7` and `parseAction` refused it ("starts_in_hours must
be an integer in [2, 72]"). No whole number of hours from the moment the create runs lands in a 3-minute window, so
the organizer feature could not use such a gap. Nothing was paid. The fix is by Claude Opus 5.5, test first: each
point has a test of the same name in `test/start-minutes.test.ts` that failed on the branch at f9ca5f0 and passes now.

The form chosen is an absolute `starts_at`, a whole UTC minute (`"starts_at":"2026-11-17T19:49Z"`). A plan's actions
run at moments spread over most of the tick after the plan (up to 48 minutes at 60), so a start counted from the run
(fractional `starts_in_hours` or a `starts_in_minutes`) moves by that delay and misses a narrow gap; a minute the plan
names is the minute FoxLeague is sent. The older `starts_in_hours` keeps working (Telegram `/do`, older plans): one of
the two, never both.

What FoxLeague's create takes (release/mainnet-1.0 fb820dd57, `tournament_slots.rs` and `create_tournament_inner`):
any instant in RFC 3339, neither rounded nor aligned; more than 1 hour from now; at most 90 days ahead; more than 5
minutes after the registration deadline; a booking `[start - 1 h, start + estimate + 1 h)` that overlaps no other,
half-open (one that ends where another starts does not overlap it). Only the calendar's proposal (`next_free`) is on
the quarter hour.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| SM-1 | low (a plan's aim lost; nothing paid: the parser refused it) | The live case: the create took only whole hours from the moment it runs, so the 3-team round robin of agents 7 and 9 could not be placed in the only gap of 72 hours (18:48 to 21:00 UTC two days ahead) | `create_tournament` takes `starts_at`, kept as the ISO minute it names. The rules check that instant against the time slots (the clash check and its blocking window), the schedule (`scheduleRefusal` and its condition at the start) and the squad at the start (`squadLegal`); the organizer quote is asked for it; FoxLeague is sent it, its deadline counted back from it. The test plans 19:49 in that calendar: parsed, through the slot check, FoxLeague and the quote are sent 19:49 |
| SM-2 | low (a wasted plan; nothing paid) | A clash named the first free start as whole hours from the refusal's moment (`starts_in_hours N`), stale by the next plan an hour later; it said "no free start in the next 72 hours" when only a start to the minute fit: the live calendar gave exactly that refusal in the test | It names `starts_at` of the first free minute (`firstFreeStart` in `slots.ts`: the first minute of the range or the first minute at or after a window's end plus the hour before a kickoff, as FoxLeague's `free_starts`). The test starts at 19:47 and 19:52, is refused by T901 and T902, is told 19:48 and creates there; 19:48 and 19:51 fit (half-open windows) |
| SM-3 | design | An absolute start is 2 to 72 hours ahead only at a given moment, which the parser does not know | The rules check it when the create runs: less than 2 hours or more than 72 hours from then is refused with its reason, as is a registration that would close within 30 minutes. `starts_in_hours` keeps its bounds at the parser |
| SM-4 | design (rule 4: unknown is not a value) | A start that is no minute must be refused, never guessed: another zone, seconds, 30 February or 24:00 (`Date.parse` rolls both over), a number or a text, both forms or neither. An action built without the parser and without a readable start ended in an error (a `RangeError` of an invalid date) | The parser takes `YYYY-MM-DDTHH:MMZ` with `:00` or `:00.000` seconds only and checks that the date reads back as written. The rules refuse a start they cannot read ("the start could not be read") before anything is asked or paid; the executor builds the create only from the start the rules checked |
| SM-5 | design | The older whole hours must keep working | Parsed as before, created that many hours after the run; a clash names the first free start as `starts_at` |
| SM-6 | low (the executor refuses a late action) | A create at a fixed minute has a time limit, which the schedule of PR #70 did not know: a start chosen a little over 2 hours ahead could run past it at its random moment | `actionDeadline` gives it the start less 2 hours (less its registration close and 30 minutes when that is earlier). Whole hours count from the run and keep no time limit |
| SM-7 | low (a wasted create; FoxLeague refuses it before any payment) | The snapshot cut each time to its minute: a window that ends at 18:47:30 read "18:47", so the gap seemed to start at 18:47 and a start at 19:47 seemed free. The gaps were given without the year, in another form than any field takes | The gaps are rounded inward to the minute in the form `starts_at` takes, each with the starts that fit it ("starts_at from 19:48 to 20:00 less the estimate"); a gap too short for the smallest tournament (3 matches) is left out. A taken window ends at its minute rounded up, in the list and in the refusal |
| SM-8 | design | The model must be told the new form | The prompt's create line shows `"starts_at":"YYYY-MM-DDTHH:MMZ"`: a UTC minute 2 to 72 hours after the action runs, its whole window inside one free gap of the snapshot. `src/strategist/prompt.ts` changed in that one line, so the prompt cache is rebuilt once at the deploy |
| SM-9 | low (an edge start could clash; FoxLeague refuses it before any payment) | With whole hours the slot check counted from the executor's moment but the create counted again from its own clock, after the reads before it (the organizer quote among them): FoxLeague was sent a later start than the one checked, 90 seconds later in the test | The rules hand the executor the instant they checked (`facts.startsAt`) and the create sends exactly that, in both forms; a create without it is not sent |
| R74A-1 | low (GitHub review of PR #74; a wasted plan, nothing paid) | When the calendar was free at the 2-hour floor, a clash named the first free start as `starts_at` 2 hours after the refusal. The next plan reads it in its activity log a tick or more later, when that minute is about 1 hour ahead: its create was refused with "less than 2 hours from now". The old `starts_in_hours 2` still worked there | The refusal searches from 2 hours plus `nextPlanLeadMs` (`slots.ts`): the rest of this plan's window (0.8 of a tick, as the refusal can come at its start), the tick and its jitter before the next plan, then that plan's own lead (`planLeadMs`, R74A-2). At a 60-minute tick with 10 minutes of jitter that is 181 minutes, so the start named is at least 5 h 1 min ahead. A stretch free now that is too short for a start that late is passed over for the next free start; when none is left it reads "no free start the next plan can still create in the next 72 hours". Two tests "R74A-1 ..." in `test/start-minutes.test.ts` failed on bf2f0c1 (the start named 2 hours ahead was refused 43 minutes later; a stretch free until 4 hours ahead was named) and pass now, one tick later and at the latest moment |
| R74A-2 | low (GitHub review of PR #74; a wasted create, nothing paid) | For a gap open now (the gaps are counted from 1 hour after the snapshot) the first `starts_at` of the hint was the gap's first minute plus the hour before a kickoff: exactly 2 hours after the snapshot was rendered. The create runs after the plan call and a fresh snapshot, so a model that took the first start offered was always refused by the 2-hour floor; the actions before it in the plan had moved earlier with its deadline for nothing | No start is given before 2 hours plus `planLeadMs` after the snapshot: the plan's window (0.8 of the agent's tick, which `renderPlanRequest` passes) plus 15 minutes for the plan call with a fresh snapshot, 63 minutes at a 60-minute tick. A gap open now begins its starts there; a gap too short from there for the smallest tournament (3 matches) is left out; every other gap keeps its first start. The line names that earliest start. A snapshot rendered without a plan (the CLI, the owner's chat) takes the longest tick the settings allow (240 minutes). Two tests "R74A-2 ..." failed on bf2f0c1 (the first start offered was refused 13 minutes later; a gap open until 3 h 30 min ahead was offered) and pass now |
| R74A-3 | low (GitHub re-review of PR #74; a test only, no product code) | SM-5 asked for `starts_in_hours: 50`, which lands in the test calendar's only free gap when the suite runs from 17:48 to 17:51 UTC: the create was not refused and the test failed, about one run in 480 | SM-5 asks for 24 hours, which always falls inside T901 (it runs to 18:48 on the test day, at least 42 hours ahead), so the clash and the first free start named stay the same at every hour |
| R74A-4 | low (GitHub re-review of PR #74; a wasted plan, nothing paid) | The next plan reads a refusal only as a line of its activity log, cut to 300 characters (`txt(r.summary, 300)` in `renderPlanRequest`). The clash refusal named the first free start last: after the action's description (a title of up to 60 characters, a private create's invited count, the start to the minute and an OVR range) and after the taken window. A long title cut the minute: from about 52 characters on a public 3-team round robin with an OVR range ("starts_at 2026-11-…" at 60), from about 42 on a private `groups_knockout` of 8 (no `starts_at` left at 60), fewer with a longer id or fee | The refusal names the first free start right after the tournament it clashes with and gives the taken window last, in its brackets: "time slot taken by T901; the first free start for this format and size is starts_at 2026-11-17T19:48Z (late enough for the next plan to create it; the taken window is ... UTC)". "No free start the next plan can still create in the next 72 hours" also comes before the window. With the longest description (a title of 60 characters, 63 invited or an OVR range, 64 teams, a fee of 5 digits, a 6-digit id) the minute ends by character 271, so a cut takes only the window. The test "R74A-4 ..." makes both creates with a 60-character title through the executor and reads the refusal from the plan request: it failed on 016bc07 ("2026-11-…" on the public one, nothing on the private one) and passes now |

The room for R74A-1 and R74A-2 is the agent's own delays rather than a fixed margin: a fixed one would be too short at
a 240-minute tick or hours too long at a 10-minute one. Each suggested start covers the latest moment the create that
takes it can run, so it does not lean on the deadline-first schedule of PR #70: match gates before the create can still
hold it to the end of its plan's window. The 15 minutes cover a plan call at high effort (given up after 11 min 40 s)
with a fresh snapshot; a longer call (xhigh) is covered by that schedule, since the create's deadline then falls inside
the window. A start later than needed costs only a later tournament: the next snapshot gives the nearer gaps again,
fresh. The window's share (0.8) is one constant now, `PLAN_WINDOW_SHARE`, read by `runPlan` too.

Changed tests: in `test/slots.test.ts` the two checks of `firstFreeStartHours` (gone) now pin `firstFreeStart` to the
exact minute (14:51, where whole hours gave 24 h: 15:37); the clash test reads `starts_at` instead of
`starts_in_hours` and checks the minute 2 hours ahead. The behaviour each one holds is the same, stated to the minute.
Since R74A-1 the clash test checks the minute 2 hours plus the next plan's lead ahead, where it held the 2-hour floor
itself (the finding); it is pinned to the minute as before.

What was checked and needs no change:
- `src/strategist/manual.md` describes FoxLeague's blocking window, not the agent's action: unchanged (FoxLeague's
  manual is synced on its own). `docs/ECONOMY-AND-RULES.md`: no FoxLeague rule changed.

Stays open:
- `slotWindows` leaves out a tournament whose status is `simulation_delayed`; FoxLeague keeps its booking since
  2026-10-01 (`tournament_slots.rs`). A start in such a window is refused by FoxLeague's create, which is asked before
  the organizer payment and before the seat, so only the action is lost. Not changed here: whether such a status
  reaches the lists the snapshot reads is FoxLeague's behaviour to confirm.
- The agent reads the public tournament lists, not FoxLeague's calendar (`GET /api/tournaments/availability`): a slot
  held by a tournament being created (the one-signature create, off today) is seen only when the create is refused.
- Another organizer may take the gap between the plan and the run; FoxLeague then refuses the create before any
  payment.
- A start chosen a little over 2 hours ahead runs by its deadline less the 5-minute margin, but the actions before it
  in the plan can still push it late (as for every deadline action of PR #70); the executor then refuses it. A start
  the snapshot or a refusal gives has room for that since R74A-1 and R74A-2; one the model picks nearer does not.
- The snapshot's last gap ends 72 hours after the snapshot, so its latest start there is on the safe side.
- A model that still sends whole hours (as in older plans of its activity log) is served as before.
- A registration that closes more than 90 minutes before the start puts the create's own floor (that close plus 30
  minutes) past 2 hours: the first start a gap gives cannot know the close the model will pick. The rules refuse such
  a create with their reason before anything is paid.
- A next plan that comes later than one cycle (outside active hours, after a failed plan call or a pause) can find a
  refusal's start too near; the floor refuses it then. That plan's own snapshot gives the gaps again, fresh.
- With no tournament on the calendar the snapshot names no gap (the slots line reads "none"), so no first start either:
  the model picks one from the prompt's rule (2 to 72 hours after the action runs). Not changed here: no suggestion is
  made in that case.
- The other refusals of a create were checked for the same cut with the longest description of R74A-4. Each keeps its
  reason and its key value: the configured fees, the OVR, the ids, the injured card and its date, both organizer
  amounts and the cap figures all stand in the first 130 characters of the refusal. Only the schedule's refusal can
  lose its figures: with matches still owed to other tournaments, "need ~X condition, the squad has ~Y" ends past the
  cut from a title of about 35 characters on a public round robin of 8 (about 21 with an OVR range, 15 with 7
  invited). Its reason ("the schedule would wear the squad down: up to N matches", with the matches here and those
  still owed) stays. It was so before this change (the start to the minute is 13 characters longer than "starts in
  24 h"), the snapshot gives the squad's condition and no start is copied from it. Not changed here, to keep R74A-4
  narrow.


## Audit of 16 Nov 2026: seven reviewers, five fixers (2026-11-16)

**Why and how.** The owner asked for a big adversarial audit of everything built since the last one: no spending
outside the owner's caps; nothing an outside actor can use; the update notice and the one-click update on Linux, macOS
and Windows; agents that follow the latest FoxLeague mainnet and use its rules smartly.

**The review.**
- Seven read-only reviewers by Claude Fable 5.2 at high effort, one area each: money and caps, outside attackers,
  the signed updater, the installers on three systems, chain and FoxLeague integration, the mainnet rules and a week
  of the live agents' own records (923 plans, 1,797 executor rows, read only from the owner's server, 9 to 16 Nov).
- They read a frozen copy of `a7e5668`, the code that runs on the owner's server since 22:02 UTC on 15 Nov, from
  `ac8833f` (the last audit) on: 264 files.

**What they found.**
- No critical and no high finding. No path signs past a daily, monthly, per-action, bid, shop-payment, medicine,
  stake or tournament cap, past the gas reserve or while dry run should hold. Nothing lets a release in that the
  owner's key did not sign. Every transaction builder matches FoxLeague's mainnet contracts.
- 39 findings: 13 medium and 26 low, two of them found twice (CHN-1 is MNT-2, UPD-A5 is INS-A1).

**The fixes.** Claude Opus 5.5 at extra-high effort, five fixers on their own branches, merged into one. The owner's
rule held for every finding: the reviewer's test, ported to `test/audit-1116/<Id>.test.ts`, failed on the untouched
branch for the reason given, and passes now. None was a phantom. The proposals the owner took have tests of their own,
named after them, which failed before and pass now.

**FoxLeague mainnet moved during the audit.** FoxLeague deployed `release/mainnet-1.0` at `729164194` at about 09:48
UTC on 16 Nov, 15 commits past the agents' copy (`9ebcbc52d`). Ten of the sixteen manual pages the agents read
changed. The daily check had said "current" at 07:00, before that deploy (MNT-5). The manual is synced to
`729164194` in this change, and every change on those pages was read against the code (MNT-1 to MNT-4, MNT-7, CHN-1).

**The owner's decisions of 16 Nov.**
- **Agents play alone: kept.** The audit priced the rule: in the week the owner's agents raised each other on 16
  cards, 10,208 FOXSY more. Asked whether to allow an exception for auctions or targeted 1v1s, the owner kept the
  rule as it is (proposals P1, P-F2, P-V5 not built).
- **Open 1v1s only when really needed, always with an OVR range** (OPEN-1V1).
- **Fewer plans in dead hours** (P6).
- **The organizer books up to 30 days ahead, each agent its own start** (P-O1, P-O2). The owner first chose 14
  days, then 30.

### Money, caps and FoxLeague's rules

| Id | Severity | Finding | Fix |
|---|---|---|---|
| MON-1 | medium | An unread upcoming-matches list read as 1 fixture left of a tournament under way, so a paid join or create the schedule rule refuses was allowed (rule 4) | `otherMatches` answers null when a started tournament is held and the list is unread; every caller refuses |
| MON-3 | low | A Swiss or knockout under way owed only its drawn rounds | Owed = at least the format's most matches less the finished ones listed (a round robin lists every fixture) |
| MON-2 | low | A 1v1 stake sent whose seat is unknown (error, sent) did not count toward 2 a week per rival | Such a row counts; a refunded one still does not |
| MNT-1 | medium | The schedule rule counted one round per interval; FoxLeague plays one match of the whole tournament per interval. It refused 34-match round robins (12 times in the week) and took a running one for over while its fixtures were listed | Span = all matches less one, times the interval; every field from min_teams up is judged; a tournament with a listed fixture is never over; each listed fixture counts by its own kickoff; the digest says "one match of the whole tournament every N min" |
| BEH-3 | low | The digest listed tournaments the schedule rule refuses with no mark | A "schedule: the executor refuses this join now: ..." line; an unread calendar is said once |
| MNT-2, CHN-1 | medium | From the MetaStaking Shop discount's switch (announced for 1 Dec 14:00 UTC) FoxLeague takes only the wallet's own price; the agent paid list prices (refused and refunded, the gas lost) and refused every discounted medicine quote | Pays the list price less the served rate (ticket `discount_bp`, shop status `metastaking_discount_bp`, medicine quote `discount_bp`), once on the total, checked against the served prices; an unread rate refuses once the switch is live or its time has passed; list price while it is off |
| CHN-2 | low | A relay refusal before broadcast was marked sent, and told to the owner at once as a payment with an unclear outcome | `booking.sent = false` in the guard branch |
| MNT-3 | low | The ELO pair cap (the same two teams move ELO in at most 3 meetings a game day, from 20 Nov 14:00 UTC) was told nowhere | A snapshot rule line with what a meeting past the cap still earns; while live, each rival's meetings today from GET /api/matches/elo-pair (at most 16 reads a planning snapshot, unread = unknown); no refusal |
| MNT-4 | low | The manual, prompt and snapshot stated the auction, pack-week and interests-day rules the old way | Manual synced; a capital "LISTED IN YOUR 18 ... forfeits" line; the pack week from Monday 14:00 UTC in the prompt; `common_pack_week_resets_at` on the pack line |
| MNT-7 | low | The prompt gave the rules from before the competition levels (ranked K 9, no XP, free Bronze) and the levels as "once live" | The live rules are stated; the numbers stay on the snapshot's line |
| BEH-4 | low | An open 1v1's one legal ovr_max was said as "at most" and the refusal named no value (Haiku sent the same refused action three times) | The refusal and the snapshot line name `ovr_max N, no other value`; the prompt says "exactly" |

### The schedule of a plan, 1v1s and bids

| Id | Severity | Finding | Fix |
|---|---|---|---|
| BEH-9 | medium | Leaving the agent's own unanswered 1v1 ran at a random moment of the window; on 12 Nov a team took T5747 26 minutes later and agent 7 lost 1,000 FOXSY | `actionDeadline` answers `'now'`; the scheduler moves that leave before everything else in the plan |
| BEH-10 | low | Taking another team's open 1v1 (first come, first served) ran at a random moment; 4 of 6 were taken by then | `'now'` deadline: runs at the start of the window, keeping the plan's order so a swap that funds it still comes first |
| BEH-2, P-V1 | medium | An unanswered targeted 1v1 left no trace (D11), so a rival that let five expire read like one never challenged: 158 targeted challenges in the week, 1 played; 89 went past the second unanswered one | `targetedRecord` (the agent's own log and ledger only) gives sent, accepted and expired per rival on the rival's line. New rule: no third targeted 1v1 to a rival that let 2 expire in 7 days; the refusal names when it frees |
| BEH-8 | low | Open challenges of other teams were not scouted while the agent's own 1v1 waited, yet the prompt says to leave it for a clearly better one | Scouted (4 at most) unless another team has already taken our 1v1 |
| BEH-7 | low | Matches were spaced 13 minutes apart; 7 of 17 second starts at 13.1 minutes were refused "already in match" | `MATCH_RUNS_MS` is 16 minutes (FoxLeague's slowest simulation is about 15.75; none of 36 starts from 14.16 minutes up was held) |
| BEH-5 | low | A first match drawn late pushed a second past a window that had room for both (37 matches dropped in 31 plans) | Each match gets a latest moment from the same backward pass as deadlines; drops are still decided before deadlines |
| BEH-6, P7 | low | After every start all agents planned within 25 s and each wrote the prompt cache again ($23.41 of the week's $190.81) | `firstPlanDelays`: per model and effort the first agent plans at once (5 to 25 s), the rest 3 to 6 minutes later, never later than their tick |
| BEH-1 | low | "Plans are failing" was keyed by the whole error text, which carries a new request id each time: every failed plan alerted (45 alerts in two API stops) | `alertKey` drops the request ids: one alert an hour per problem |
| P10 | proposal | During an account stop every agent took a full snapshot and asked the model | The agent that hit the error asks again at its tick; the other scheduled ticks skip the snapshot and the call (pending payments and refunds still run); a tick the owner starts always asks; "Plans work again" is said once |
| P6 | owner's decision | 392 of 923 plans in the week had no action ($59.23), 264 of them between 06:00 and 14:00 UTC | After a plan with no action the next comes after twice the tick, with its jitter, until a plan acts or the 14:00 UTC reset. Lowers spending only, so no password |
| P2 | proposal | 52 of 161 bids were refused below a minimum that moved after the snapshot | `bid` takes an optional `max_foxsy`; the executor bids the fresh minimum up to it, never below the amount planned; Max bid, rarity limit, build cost and FOXSY held are checked on that amount, which is what is booked and signed |
| OPEN-1V1 | owner's decision | Open challenges lost about 4,200 FOXSY in the week (26 played: 11 won, 13 lost, 2 drawn), mostly to stronger teams | The prompt: never the default 1v1, only when the squad needs competitive matches a targeted challenge, tournament or ranked cannot give. Code: an open create without both `ovr_min` and `ovr_max` is refused, naming the legal values |

### The organizer

| Id | Severity | Finding | Fix |
|---|---|---|---|
| P-O1 | owner's decision | The agents created only up to 72 hours ahead while FoxLeague's calendar was full that far but one gap: on 16 Nov four agents planned that gap and three were refused (at no cost). The agent read the free gaps only from the public lists, which miss a tournament being created | Horizon of 30 days in the parser and the rules. A planning snapshot reads `GET /api/tournaments/availability` (type built from `tournament_slots.rs` at `729164194`, 14 days a request: the next window is read only while fewer than 10 free starts were found) for a round robin of 3, a round robin of 8 and a Groups + Knockout of 16; a failed or malformed answer is unknown with a warning and offers no start. Every create check stays. Own creates are read back far enough for `widen_range` |
| P-O1b | owner's decision | The first build read 14 days (FoxLeague answers at most 14 days a request): on 16 Nov that held two free gaps, so the 10 agents shared two starts. The owner chose 30 days | `starts_in_hours` 2 to 720, "more than 30 days from now", the clash refusal, the free gaps line, the 31-day read-back of the agent's own creates and the prompt's create line. The calendar is read in up to three windows per shape (0 to 14, 14 to 28, 28 to 30 days), the next only while fewer than 10 starts were found; stretches free across two windows are joined; any failed or malformed window makes the shape unknown, never a partial list. A read on 16 Nov found free stretches on 26, 28 and 30 Nov, 2 to 4, 6 to 7 and 11 to 13 Dec |
| P-O2 | owner's decision | Every agent was given the same first minute | For each shape the plan reads "your start for this shape: starts_at ...; the next free ones (only if yours is refused): ...": agent n takes the (n mod k)-th of the free starts found. The pick reads only its own number and FoxLeague's public answer |

### Outside attackers and the watch on FoxLeague

| Id | Severity | Finding | Fix |
|---|---|---|---|
| ATK-4 | medium | `txt()` cut rival text by UTF-16 units: an emoji across the cut of a tournament title left half a character in the plan request, and Anthropic's API refuses such a body whole, so one title any player can write stopped every plan of every install | `cut()` (`src/util/text.ts`) never splits a character; `txt()`, the model's own texts, the chat, the plan log line and FoxLeague's answer in a pending payment use it; `Strategist.create()` makes every message well-formed where it leaves; Telegram's chunks do the same |
| ATK-1 | medium | The manual check ran a regular expression with three nested runs over FoxLeague's page text: a 9 KB page held the event loop past 15 s (kill switch, dashboard, Telegram, payment confirms) | `liveBody()` takes the title line off, trims the end and drops a last line that starts with the Source address, with no regular expression over the end of the page |
| ATK-2 | low | DNS rebinding: a page that pointed its own name at 127.0.0.1 could post wrong passwords to /login as the dashboard's own origin and lock the owner out | A request for a Host the dashboard is not served at is answered 421 before anything is read or counted: localhost names, an address in numbers, `WEB_UI_HOST` and the new `WEB_UI_HOSTNAMES`; behind nginx (`WEB_UI_TRUST_PROXY=1`) nginx's server_name is the filter |
| ATK-3 | low | `new URL()` threw for "GET // HTTP/1.1" and the like: 500 with a stack trace in the log for anyone | Answered 400 without a log line |
| MNT-5 | low | The manual check answered its stored result all day: a manual FoxLeague deployed after the morning check was told the next morning (16 Nov: current at 07:00, FoxLeague deployed at about 09:48) | A copy found current is checked again at the next hourly look once 55 minutes have passed; one found behind stays so for the day |
| MNT-6 | low | One failed request left "could not check" for 24 hours | Tried again at the hourly looks, at most 4 tries a day |
| P-W2 | proposal | `/api/config` was not watched | Every snapshot fingerprints it (the keys at every depth plus the rule values, without the counters that move with play). A key added or removed runs the manual check at once (at most once in 10 minutes, 6 a day) and is named, shaped and bounded like the slugs |
| P-W3 | proposal | A change waited for the next morning's summary | One urgent Telegram line for each change: the manual gone behind, the settings keys changed (at most every 6 hours), a switch the agents have no rule for with its `live_from` within 7 days |
| P-W5 | proposal | A plan went on quoting the manual copy while FoxLeague had changed | While behind, the plan request (never `prompt.ts`) carries a note written by the code: the changed slugs and keys only, and that the snapshot's live values and the executor's refusals win there |
| P-W6 | proposal | A new switch in `/api/config` reached no plan | A snapshot line for each block with `live` or `live_from` that no rule reads (not in `RULED_SWITCHES`): its key, where it stands and its numbers only |
| P-W8 | proposal | No record of what the copy and the rules were built against | `sync-manual` records the game settings' key set in `manual-pages.json` (`config`); a record without it is read as before |
| RULED-1 | low (found at the merge) | `elo_pair_cap` and `metastaking_discount` have rules since MNT-3 and MNT-2, but the watch still listed them as switches with no rule: two lines about each in every plan and a "no rule" Telegram line | Both are in `RULED_SWITCHES` |

### Installers and the updater

| Id | Severity | Finding | Fix |
|---|---|---|---|
| INS-A1, UPD-A5 | medium | Pasting the line over a running install moved `versions/active` to the new release (or swapped the folder of the version that runs) before `npm ci` had run there; running `./install.sh` again ran `npm ci` inside the running release. If npm was cut, or there was no terminal, the agent could not start again and nothing undid it | get.sh first checks that a terminal opens; over an install it runs the new release's own `install.sh --prepare` in a staging folder and changes nothing unless that ended well. The installer installs the dependencies of a release beside it, in `.deps-new`, and swaps them in once complete |
| INS-A2 | medium | `--uninstall` said "Stopped." for an agent it never stopped (sudo on Linux, a refused Mac bootout, an agent started with `./run.sh`); `sudo --update` said no service was installed | As root on another user's folder, `--uninstall` and `--update` stop with the right command; "No background service of <user> was found"; on a Mac the plist is removed only once launchd no longer lists the job; an agent still running ends the uninstall with how to stop it |
| UPD-A4 | medium | `sudo ./install.sh --update` wrote root-owned `versions/`, `active`, `pending` and `data/update`; the agent never started again | `--update` refuses when run as root on a folder another user owns, before it writes anything, and names the command without sudo |
| INS-A5 | medium | A second install for the same user rewrote the one unit or plist and stopped the first agent for good, while saying "Running." | The installer stops before the first question, names the other folder and the two ways on; `--uninstall` and `--update` leave another install's service alone |
| UPD-A1 | medium | The archive was written through a stream with no error listener: a full disk or an unwritable `data/update` ended the whole agent | Written through a `FileHandle`; every write or close error is an UpdateError with a sentence; the agent stays up |
| UPD-A2 | low | Two asks for an update while none was known both installed the same archive | The slot is taken before the await and given back on every refusal |
| UPD-A3 | low | A second `stop()` returned at once, so the restart for an update could exit while the first stop still waited for an action in flight | `stop()` returns one shared promise |
| UPD-A6 | low | The reason of a failed prepare reached Telegram and the dashboard with terminal colour codes | `stage()` strips control bytes and empty lines |
| INS-A3 | low | A `.env` with CR LF line ends: Enter at the port looped, Enter at the live permission wrote `AGENT_LIVE_ENABLED="0"` | `get_env` drops the CR |
| INS-A4 | low | A refused `launchctl bootstrap` ended the Mac install with no next step | Bootout by label, a wait for launchd, a sentence with what to do |
| INS-A6 | low | `.node-path` kept a per-shell Node.js path (fnm), gone after a reboot | `.node-path` names the program itself first; the launchers take the first path that exists |
| INS-A7 | low | The owner of an unwritable folder was sent to a command that answered the same sentence | The refusal and the Update page give the `chown` line, then update again |

**Changed tests.** Each one now pins the right behaviour, and its commit message says so.
- **MNT-1:** "D4 ... forfeit guard", R24A-1, AA3, A9 and the Champions knockout span.
- **BEH-4:** the OP-4 and AA2 refusal texts.
- **OPEN-1V1:** one open-challenge case of `create-ovr-range`.
- **BEH-9 and BEH-5:** DL-1 to DL-3, DL-5 and two R70A-2 cases.
- **BEH-7:** the D1 spacing.
- **P-O1:** SM-3, SM-4, SM-8 and SM-10 (72 hours to 30 days).
- **MNT-5 and MNT-6:** MW-5, R72A-2, MW-7, MW-8 and MW-10.
- **ATK-2:** `ATTACK-2` (2c) now sets `WEB_UI_TRUST_PROXY=1`, as nginx does.
- **INS-A2:** the third case of `install-17`.
- **INS-A6:** `install-14` A and B.
- **INS-A4:** the `launchctl` stand-in, which now answers `print` only between a bootstrap and a bootout.
- **RULED-1:** the examples of an unruled switch in P-W3 and P-W6 moved to a key with no rule.

**For a server behind nginx.** The dashboard now answers 421 to a Host name it is not served at.
`WEB_UI_TRUST_PROXY=1` must be set behind nginx, as `docs/SERVER.md` has asked since review S1. The owner's server
gets it with this deploy.

Stays open:
- **The watch.** P-W4 (fingerprints of FoxLeague's OpenAPI document) and P-W7 (holding the actions of a changed page
  until synced) are not built.
- **Local processes on the machine.** One can still send any Host header or, with `WEB_UI_TRUST_PROXY=1`, any
  `X-Real-IP`. ATK-2 stops a rebound browser page only.
- **FoxLeague words without `txt()`.** `tier`, `format`, `status` and the like are printed raw inside the snapshot
  fence. Players cannot write them; only FoxLeague's server could.
- **Mac.** The bootout by label, the waits and the `print` check were proven with stand-ins only, not on a real Mac.
  Whether bootout returns before the job is gone is unproven.
- **sudo.** `sudo ./cli.sh` and `sudo ./run.sh` are not refused.
- **The schedule rule.** MON-3 overcounts on the safe side: a team out of a knockout still counts its span, and
  FoxLeague lists finished matches for one day only. MNT-1 is still a total over the squad and the span, not match by
  match; rounds not drawn yet count as overlapping.
- **The MetaStaking price.** The plan weighs list prices while the executor pays the discounted one (MNT-2).
- **The pair cap.** Tournament opponents get no pair count: the upcoming list names them without a user id (MNT-3).
- **The digest.** It does not mark an open challenge whose OVR range shuts the agent out.
- **The 1v1 "takers" list.** It still counts a team that accepted pre-arranged challenges. A team that took none of
  the agents' 109 targeted challenges in the week still reads as a taker. This is the owner's call: P3, second half.
- **The stagger after a start.** It leads by each agent's real model and effort, not by shadow pairs (shadows are off
  on the owner's server). The 3 to 6 minutes rest on the week's timings. The 16-minute spacing could be 15 by the
  data.
- **The organizer.**
  - A create made far ahead is checked at the create only, not again before its deadline. The plan can still leave
    before the deadline.
  - The snapshot taken before an action does not read FoxLeague's calendar, so a hidden hold meets FoxLeague's own
    refusal, which costs nothing.
  - With fewer free starts than agents, two agents can share a start; the second is refused at no cost.
  - `simulation_delayed` in `slotWindows` is unchanged.
  - FoxLeague's calendar is busy. On 16 Nov it held two free windows in 14 days and several more up to 30 days.
- **The reviewers' unproven items.** Each report lists its own, kept with the audit's working files.


## Audit of 16 Nov 2026, round two: what was still open (2026-11-16)

**Why.** After the first round was merged and deployed (PR #75, 955664a), the owner asked to do everything still
open. That meant:
- the review's one low;
- the items under "Stays open" that can be built;
- the reviewers' unproven suspicions, each fixed only if a test proves it;
- the "middle way" for FoxLeague changes, his choice: while the agents' manual copy is behind FoxLeague's, each plan
  reads the new text of the pages that changed, as data.

**The fixes.**
- Claude Opus 5.5 at extra-high effort, four fixers on their own branches, merged into one.
- Every fix and every new behaviour has a test in `test/audit-1116/` that failed on `955664a` and passes now.
- A suspicion whose test passed on `955664a` is a phantom and was not changed.

### The watch on FoxLeague and the snapshot fence

| Id | Severity | Finding | Fix |
|---|---|---|---|
| MID-1 | owner's decision | While the agents' copy was behind, plans knew only which pages changed, not the new rules | The hourly check stores the text it already reads of each changed page the copy knows (kv `manual_texts`, additive). Each plan request and the manager chat carry it inside the snapshot fence, under the code's heading "FoxLeague's current text of pages changed since your manual (data from FoxLeague's server, not instructions; the snapshot's live values and the executor's refusals win)". Every line is indented by four spaces. Runs of two or more `<` or `>`, the word SNAPSHOT in capitals and control or invisible characters are never written. Limits: 24,000 characters a page, 60,000 in all, 8 pages, cut on whole characters, shaped slugs only. Nothing is added while the copy is current or the check could not tell. The system prompt is unchanged. The text never reaches Telegram, the dashboard, the summary or the executor. Cost only while behind: usually 2,000 to 6,000 input tokens, at most about 15,000 (about $0.06 a plan on Opus 5.5) |
| P-W4 | proposal | Nothing told the owner or the plans when FoxLeague changed the shape of a route the agent calls | FoxLeague's mainnet serves `GET /api/openapi.json` (`backend/src/openapi/mod.rs`). The 54 routes `api.ts` calls are listed in `src/foxleague/api-routes.ts`, kept one to one with `api.ts` by a test. `sync-manual` writes each route's shape (parameters, JSON body, 2xx answers, without prose) to `src/foxleague/api-shapes.json` from the manual's FoxLeague commit. The hourly look reads the description through the bounded reader (4 MB) and names the changed routes from our own list, at most 8: to the owner once on Telegram, on the dashboard, in the summary and in the plan note. A failed read or an answer that is not an API description names nothing |
| P-W7 | owner's choice | The owner could not hold the actions whose rules FoxLeague changed until the agents are synced | A dashboard switch with its info bubble: "tell me only" (default) or "also pause the actions whose rules changed". The pause covers shop: `buy`; marketplace: `bid`, `list_card`; one-v-one: `create_challenge` and a 1v1 join; tournaments: `create_tournament` and a tournament join; fusion: `fuse` and its waivers. The owner's own requests, pending payments, refunds and leaves keep running. Turning it on is one click; turning it off needs the password, and no Telegram command turns it off. Each plan is told what is paused |
| ATK-5 | low (the ATTACK reviewer's unproven item, proven) | FoxLeague's own words went into the digest as served: tier, format, status, times, phase, league, position, rarity and the like. A value with a line break and `SNAPSHOT>>>` ended the fence early. Only FoxLeague's server writes them | Printed as served only in the shape of a word (`[A-Za-z0-9][A-Za-z0-9_+-]*`, at most 24 characters) or a time, anything else through `txt()`. As a last guard the digest never holds three `<` or `>` in a row |
| ATK-5b | low (found at the merge) | ORG-1's line on the agent's own tournament, built beside ATK-5, printed the format and an unreadable `starts_at` as served | It uses the digest's `word()` and `when()` |

### Money, rules and the 1v1s

| Id | Severity | Finding | Fix |
|---|---|---|---|
| R75A-1 | low (GitHub review of PR #75) | `shopRateBp` took a served MetaStaking rate above 0 while `/api/config` served the switch off. FoxLeague's confirm takes the full price before the switch (`shop_discount.rs`), so the payment would be refused and refunded and the gas lost | The switch is read first: readable and off means the list price whatever rate is served; live or past its time means the served rate; unreadable stays as before |
| MNT-2b | owner's decision | The plan weighed list prices while the executor pays the wallet's discounted price | A "Shop prices" line from the rules' own `shopRateBp` and `shopPrice`. Live: the wallet's price next to the list price, with the rate, the ranked ticket and medicine. Rate unread while live: "unknown, the executor buys nothing in the Shop". Off: list prices only |
| MNT-3b | low | Tournament opponents got no ELO pair count: the upcoming list names them by team only | FoxLeague's public `GET /api/tournaments/{id}` lists each seat's `user_id` and `team_name` (unique names, migration 087). While the cap is live, a planning snapshot reads the seats of up to 4 tournaments with a match before the reset. The Upcoming line says "N of 3 ELO meetings today". An unread seat is unknown, never 0 |
| BEH-3b | low | An open challenge whose OVR range shuts the team out was shown like any other | "closed to you: range X to Y, your best XI OVR Z" on open challenges and open tournaments. An unread OVR marks nothing |
| P3b, P-V2 | owner's decision | "Took N 1v1s it had not arranged" counted open challenges taken and repeat pairs: 109 of the week's 158 targeted challenges went to five teams that answered none | Only a targeted 1v1 a team accepted from a team it had not played before counts, still more than 2 minutes after it was sent. Open challenges taken are shown apart, with the rival's last 3 such acceptances |
| MON-U2 | low (MONEY's unproven item, proven) | An unparseable `transferred_at` gave an invalid Date, read as "lock over" for the agent's own card | The lock reads unknown, which every check refuses |
| MON-U7 | low (rule 6) | FoxLeague's time-slot refusal quotes another player's title. A title with "refunded" made the agent forget a held organizer payment (the next create pays again), and "being refunded automatically" also booked it as back | Only FoxLeague's own answers, which open the refusal, settle the payment (`ORGANIZER_HASH_ANSWER`, `CREATE_STILL_PENDING`) |
| MON-U5 | low (words) | A create without an organizer payment still reported "1150 FOXSY + fees" | The text and cost name the seat only and say FoxLeague asked no organizer payment |
| CHN-U4 | low (gas) | The contract quotes the cooldown waiver's days at its own block: a waiver signed just before the quote dropped by a day reverted | Within 10 minutes of that drop one day less is named, which works either side; a last day about to end is not bought |
| MNT-1c | low | A team out of a knockout was still charged its rounds not yet drawn | A finished knockout match of ours with our score lower ends the count, except for at most a third-place match. A draw, a group match, a League + Knockout leg or anything unread is no exit |

### The organizer and the stagger

| Id | Severity | Finding | Fix |
|---|---|---|---|
| ORG-1 | low (open item of P-O1) | A tournament created up to 30 days ahead was judged only at the create | Each planning snapshot runs the create's checks again on every open tournament the agent created and holds a seat in: the schedule with the tournaments joined since and whether 11 of the 18 can play at its start. One line says it still fits; or NO LONGER FITS with the reason, until when it may be left and what comes back; or that it could not check (unknown is not a fit). Leaving it runs first in its plan, as BEH-9 |
| ORG-2 | low (open item of P-O1) | The check right before a create read no calendar, so a start held by a tournament being created met FoxLeague's own refusal | The create reads `GET /api/tournaments/availability` for its own shape and start. "Taken" refuses, naming the next free start the next plan can create (never a player's title). A failed read leaves the public-lists check as the last word, and says so |
| ORG-3 | phantom | `slotWindows` leaves out `simulation_delayed` | FoxLeague serves `simulation_delayed` and `simulating` as `active` in every public answer (`public_tournament_status`, 729164194), so the agent already counts them. Noted in the integration notes |
| ORG-4 | proposal, not built | With fewer free starts than agents, two agents can be offered the same start | `n mod k` is already the most even split possible from the agent's own number and FoxLeague's answer. The calendar line no longer promises other minutes, and no longer names the owner's other teams |
| BEH-6b | low (cost; shadows off on the owner's server) | With shadow plans on, two leaders that shared a shadow model each wrote its cache | `firstPlanDelays` puts each agent in the first wave where every model and effort it calls, real or shadow, is new or was led in an earlier wave. Without shadows it is BEH-6's stagger |

### Installers and the updater

| Id | Severity | Finding | Fix |
|---|---|---|---|
| INS-A8 | medium | `sudo ./cli.sh` and `sudo ./run.sh` ran as root on a folder another user owns and wrote root's files into `data/`, `versions/` and `.env`; with `FOXAGENT_ALLOW_ROOT=1` the guided install and the pasted line did too. The agent then did not start as its user | As root on another user's folder, `cli.sh`, `run.sh`, `install.sh` (every mode but `--prepare`) and `get.sh` stop before anything runs and name the command without sudo. An install that is root's own still runs |
| INS-U1 | low (proven with the launchctl stand-in) | Mac: the installer run again booted out a busy agent and loaded it again after 10 s; launchd answers 36 and keeps the job, so the agent stayed stopped | After a bootout answering 36 the installer waits up to 185 s, as the uninstall does |
| INS-U2 | low | get.ps1 on an Ubuntu that starts as root: Ubuntu was started 8 times, then the owner was sent to a Start menu that asks nothing | Ubuntu is started once. If still root, get.ps1 names the user Ubuntu has or says how to make one and make it the default. Then it stops |
| INS-U3 | low (words) | The virtualization tip named only systeminfo's "Virtualization Enabled In Firmware: Yes", not shown where a hypervisor already runs | The Windows page and INSTALL.md say "A hypervisor has been detected" means it is on |
| INS-U4 | low | With `AGENT_MNEMONIC` exported in the installing shell, the installer showed and wrote another wallet than the one in `.env` | The installer's command line runs without the shell's `AGENT_MNEMONIC` |
| INS-U5 | low | Every installer run reset `WEB_UI_INSECURE_COOKIE` to 1 without a word | Set only when missing; a value the owner set is kept and said |
| INS-U6 | low | get.sh removed the code of an install from before 11 Nov while its old service still pointed at it; an installer stopped at a question left that service pointing at nothing | The old code is removed at step 7, after the new service is written |
| UPD-U1 | low | `confirmStart` removed the release `versions/active` names when a terminal update put it there inside the 45 s before the confirm | That release and its note stay |
| UPD-U4 | low | `supervised()` counted any systemd unit with journal output as one that restarts the agent | Only the installer's own unit, read from the agent's cgroup; other units need `FOXAGENT_SUPERVISED=1`, as the guides say |
| UPD-U5 | low (design) | `./install.sh --update` started a service the owner had stopped, which may sign LIVE, and said "Restarted." | A stopped service stays stopped, and the screen gives the command that starts it; running and failed ones restart as before |

**Unproven, not changed.**
- **MON-U6:** a suspended starter is not modelled in an entry's strength. A ban costs one match, which can fall in
  another tournament, and the digest shows it.
- **CHN-U2:** the same nonce signed twice after an unread outcome. One of the two never runs and its spend stays
  booked, the safe side.
- **CHN-U3:** "Do NOT pay again" also matches the refund-in-flight texts. No wrong outcome was found.
- **CHN-U1:** claimRefund's 6.5M gas. It is FoxLeague's own limit and about 1.11 times today's estimate.
- **CHN-U5:** the manual's discount scale. It matches mainnet since the sync.
- **UPD-U2:** `--prepare` and the shared Node.js. The probe passes on today's code; the fix belongs to a release that
  raises the Node.js rule.

**Closed from round one's "Stays open".** `sudo ./cli.sh` and `sudo ./run.sh` (INS-A8). The Mac bootout race, as far
as the stand-in shows it (INS-U1). FoxLeague words without `txt()` (ATK-5). The MetaStaking price the plan weighs
(MNT-2b). Tournament opponents' pair count (MNT-3b). The digest's mark for a range that shuts the agent out (BEH-3b).
The takers list (P3b). The check before a far-ahead tournament's deadline (ORG-1). The calendar read before a create
(ORG-2). `simulation_delayed` (ORG-3, a phantom). The stagger's shadow pairs (BEH-6b). P-W4 and P-W7 are built.

**Changed tests.** Each one now pins the right behaviour, and its commit message says so.
- **P3b:** OP-1 and the takers test.
- **INS-A8:** INSTALL-17.
- **INS-U6:** GET-2, INSTALL-9 and INSTALL-10.
- **UPD-U4:** UPD-21.
- **UPD-U5:** INSTALL-1, INSTALL-11 and INS-2.
- **P-W7:** its pattern for the pause's refusal is now the refusal's own words, since ORG-2's calendar note says "held"
  too.

Stays open:
- **Outside the threat model:** a process already running on the owner's machine can send any Host or X-Real-IP
  header. It already controls the machine (R2-HOST).
- **The middle way (MID-1):** a page FoxLeague added ("new") is named, but its text is not read. Telegram `/ask` does
  not carry the page text.
- **The API watch (P-W4).**
  - The record is built from FoxLeague's `origin/main`, like the manual, so a route main changed before mainnet is
    named early.
  - Once the manual is found behind for the day, the API look waits too.
  - `GET /api/whitelist/check` is not in FoxLeague's API description: a maintainer should check that mainnet still
    serves it.
- **The pause (P-W7):** only five page families pause anything.
- **ATK-5:** number fields are still printed as served; the last guard keeps them from closing the fence.
- **The schedule rule.**
  - Rounds not drawn yet are not spread over their span: MON-3's test pins the careful count.
  - A knocked-out team is counted at the format's most again once FoxLeague stops listing the loss after a day.
- **The 1v1 takers list (P3b):** checked against the week's rows, not FoxLeague's own.
- **The pair cap (MNT-3b):** at most 4 tournaments and 16 pair reads a snapshot; a seat whose name does not match is
  unknown.
- **The Shop prices (MNT-2b):** the list prices written in `prompt.ts` stay; the snapshot line carries the wallet's.
- **A far-ahead tournament (ORG-1).**
  - A suspended card is counted out at the start, the careful side.
  - The line is information only: nothing leaves on its own.
  - A standard tournament's leave still does not check who paid the seat (only League + Knockout does).
- **The calendar read before a create (ORG-2):** it adds one read per create, and a hold that appears after it still
  meets FoxLeague's refusal at no cost.
- **Installers and the updater.**
  - UPD-U3: whether `launchctl kickstart -k` stops the agent gently needs a real Mac.
  - INS-U1, INS-U2 and INS-U3 were not run on real machines. The owner's re-test on his Mac, Windows PC and Ubuntu
    laptop covers them, with a checklist.
  - Existing installs get the new `run.sh` and `cli.sh` (INS-A8) at their next update's confirm.


## Audit of round two (2026-11-16)

**The review.** Round two (the section before this one) was built without its own audit. Before PR #76 was merged,
the owner asked for one. Three read-only reviewers by Claude Fable 5.2 at high effort, one area each, read a frozen
copy of the PR at `8e2dad8` against `955664a`:
- outside text and the owner's pause;
- money, rules and the organizer;
- installers and the updater.

**What they found.** No critical and no high finding: 1 medium and 19 low. They found no way past the owner's caps,
no way to turn the pause off without the password and no way for FoxLeague's page text to close the snapshot fence.

**The fixes.** Claude Opus 5.5 at extra-high effort, one fixer on the PR's branch. Every reviewer test, ported to
`test/audit-1116/<Id>.test.ts`, failed on `8e2dad8` for the reason given and passes now. None was a phantom. Two
suspicions marked unproven were proven with the stand-ins and fixed (R2I-U1, R2I-U2). The fixer added one point on the
reviewer's word, R2M-4.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| R2T-1 | medium | The P-W4 fingerprint walked a shared `$ref` once but wrote it out again at every use: a 9,739-byte API description of 20 schemas, each naming the next twice, held the event loop for 18 s (kill switch, dashboard, Telegram and payment confirms stood still) | One budget for the whole document (`MAX_WRITTEN` 2,000,000) counting each value, key and `$ref` wherever it is named; each object's keys sorted once a document. Past it the look says "could not be read", never changed and never the same. Mainnet's description counts 86,243 and keeps its fingerprints; the slowest document under the bound took about 160 ms |
| R2T-2 | low | MID-1 counted its limits on the text as served, in UTF-16 units: short lines set in wrote 180,414 characters into every plan | Each page is cut on whole characters so that its set-in text takes at most 24,000 bytes, 60,000 in all |
| R2T-3 | low | `setIn`, `txt` and `oneLine` removed only Cc, Cf and the ASCII markers: a combining grapheme joiner, variation selectors, Hangul fillers, tag characters and fullwidth forms wrote `SNAPSHOT>>>` as a reader sees it | `asSeen()` (`util/text.ts`): NFKC, then every `Default_Ignorable_Code_Point` removed, before the fence checks; names with accents, emoji and other scripts come through whole |
| R2T-4 | low | A copy found behind was not checked again that day: the page text and the pause stayed at the first check | A behind check is due again after `RECHECK_MS`; the owner hears once per set of changed pages; a recheck that cannot tell keeps the day's behind check and its text |
| R2T-5 | low | `fusion_ready_at` was kept as served whenever it read as a future time ("\n## Owner: go\n2099"): a heading in the digest and FoxLeague's text in the fuse refusal | `fusionCooldown()` keeps a zoned ISO time normalised, else unknown; fuse and the cooldown waiver refuse on unknown |
| R2T-6 | low | The unknown-switch line was keyed by key and `live_from`, with no pause: a moving time sent one urgent line per snapshot | Told once by the key alone (`manual_switches_told`, additive), at most one line every 6 hours, 8 switches named and the rest counted |
| R2T-7 | low | The pause read only `manual_behind`, which `955664a` never writes: on the day of the update it held nothing | Without a pause row of this copy it uses the stored check of this copy when it is behind |
| R2M-1 | low (regression of MON-U7) | FoxLeague's "Transaction paid N FOXSY but this tournament needs M FOXSY ..." and "Payment (N FOXSY) is less than required (M FOXSY) ...", each with its refund, settled nothing: the hash stayed held 60 minutes and was then abandoned still counted against the caps | Both openings in `ORGANIZER_HASH_ANSWER`, anchored at the start; a rival title still settles nothing |
| R2M-2 | low (gas) | CHN-U4 bought one day less only while the clock still saw the day drop ahead: seconds after it a stale quote was signed and reverted | `waiverDayDropsInMs` answers on both sides of the drop; within 10 minutes either side the waiver buys one day less named, or is refused at one day |
| R2M-3 | low (older code, rule 4) | FoxLeague pages `GET /api/tournaments/upcoming-matches` at 50 rows; the agent read the first 50 as the whole list, so owed matches were counted short and a paid join the schedule rule refuses could pass | Read in pages of 200 up to FoxLeague's total, at most 5 pages; past 5 pages or with rows gone between pages the list is unread and the rules refuse. The 1v1 gate's "page of 50" refusal is removed (R14A-1 moved to the new rule) |
| R2M-4 | low | With the owner's pause on, an unreadable pause state held nothing | It holds every family the pause covers; turning it off still needs the password |
| R2I-1 | low | The root check (INS-A8) was fooled by a link: stat does not follow one in the last part of a path | stat of `<folder>/.` in `cli.sh`, `run.sh`, `install.sh` and `get.sh` |
| R2I-2 | low | INS-A8 stopped an agent a service manager starts as root on another user's folder (a container with the host's install mounted), from the first start after an update's confirm: the launcher that undoes a bad update was the one refusing | `run.sh` and `cli.sh` go on when `data/agent.db` (not a link) is root's already; a mistaken `sudo ./run.sh` is still refused; GNU stat's unknown owner is named by number |
| R2I-3 | low (words) | Plain `sudo ./install.sh` in the owner's folder (and `curl ... \| sudo bash` on a Mac) never reached INS-A8's sentence: it was told to make another user or install as root anyway | The folder's owner is checked before the root check |
| R2I-4 | low | UPD-U4 took a system unit named `foxleague-agent.service` for the installer's unit | Only a unit under `user@<uid>.service` counts |
| R2I-5 | low | INS-U5 read `.env` with the installer's own reader: `export WEB_UI_INSECURE_COOKIE=0` was overwritten with 1, `=1 # note` was said to be https only | `agent_env()` asks Node's own `loadEnvFile` what the agent reads |
| R2I-6 | low | `cli.sh` and `run.sh` took the shell's `AGENT_MNEMONIC`, so they answered for another wallet than the installer showed | `cli.sh` unsets it; `run.sh` refuses when the terminal's words differ from `.env`'s (compared by Node, nothing printed) and uses the given words when `.env` has none |
| R2I-7 | low (words) | A comma before the closing "and" on the Linux page | Dropped |
| R2I-8 | low | `confirmStart` removed the staging folder of an update still being prepared | While a fresh `update.lock` is there it removes no release or staging folder; a lock older than 30 minutes does not keep them |
| R2I-9 | low | `--no-service` removed the old code that an old service still starts | The code stays while this user's service starts it; the screen says to run `--uninstall` first |
| R2I-10 | low | `./install.sh --update` restarted a service whose stop was under way ("deactivating") | It waits up to 185 s; a service that stopped stays stopped and the command that starts it is named |
| R2I-U1 | low (unproven INS-U1, proven with the stand-in) | On a Mac a bootout answering 0 or 37 while the job is still listed got 10 s, then the bootstrap failed | The installer waits whenever the job is still listed |
| R2I-U2 | low (unproven INS-U2, proven in the PowerShell checks) | With several Ubuntu users, `get.ps1` named the first user in passwd | It names the user whose home holds `foxleague-agent` |
| R76A-1 | low (GitHub review of PR #76) | An answer of `GET /api/tournaments/upcoming-matches` without a readable `X-Total-Count` was taken as the whole list when it held fewer than 200 rows. A server that pages lower would give a part of it; FoxLeague's own answer when its row read and its count both fail (an empty list with no header) read as no fixtures. Owed matches were then counted short and a paid join the schedule rule refuses could pass (rule 4) | Without a readable total the list is unread and the rules refuse. FoxLeague's mainnet code sends the total with every answer whose count it read (`0` with an empty list), so a team with no fixtures still reads its list; it sends none only when that count fails. R2M-3's test of a short page without a total now pins the refusal; its five-page case is served a total |
| MAC-1 | low (found on the owner's Mac, 16 Nov) | The launchd plist started `<bash> <folder>/run.sh`. macOS names a background item after the program its job starts when no app goes with it, so System Settings (General, Login Items & Extensions) listed the agent as "bash": a user cannot tell it for the agent and may switch it off as unknown | The plist starts `FoxLeague Agent` in the install's folder, a launcher of the agent's own (a plain file, mode 755, `#!/bin/bash`) that execs `/bin/bash run.sh` of its folder; the rest of the plist is unchanged (KeepAlive, RunAtLoad, `FOXAGENT_SUPERVISED`, the label, exit code 75). The installer writes it before the plist; `./install.sh --update` changes only the program's line of an older plist (the agent is restarted or left stopped as before); a confirmed update refreshes it where it is (`refreshLauncher`); the uninstall removes it with the plist. Linux and WSL are unchanged (`test/mac-login-item.test.ts`) |
| R78A-1 | low (GitHub review of PR #78) | `renew_plist` came after `if [ "$rc" = 3 ]; then exit 0; fi`: on an install that runs the newest release already, `./install.sh --update` ended there and the plist stayed on bash. And where it did change the plist, a kickstart restarted the job launchd holds, from the plist it read at its load: the new one waited for the next login | The newest release no longer ends the update before the service checks: after `service_installed` and `! service_of_other_install`, a Mac moves an older plist to the launcher in both cases (`mac_after_update`). A job that runs is loaded again from a changed plist (bootout, the wait of R2I-U1, bootstrap, INS-A4's words when it fails); with an unchanged plist it is restarted for a new release (kickstart, as before) and left alone on the newest one; a stopped one stays stopped (UPD-U5). Linux on the newest release does nothing, as before |
| R78A-2 | low (GitHub review of PR #78, the off switch kept) | An owner who switched the "bash" item off (System Settings, General, Login Items & Extensions, or `launchctl disable`) had its plist rewritten to a new program by `--update` and by the guided installer, which also loaded it again. To macOS that can look like a new background item, which may start at the next login without the owner's word, LIVE if the database says so | `mac_job_disabled` reads `launchctl print-disabled gui/<uid>` (`"ai.foxleague.agent" => disabled`, `=> true` on older macOS). A job that is off is never written to, loaded, restarted or switched on: the guided installer and `--update` leave its plist (and its absence) as they are, and the screen says that it stays off, keeps its old name and how to switch it on (`launchctl enable`, then `launchctl bootstrap`). When launchd cannot be asked, nothing is rewritten: the guided installer stops in words before it writes anything, `--update` keeps the plist and restarts as before. `refreshLauncher` never writes the plist or loads a job and rewrites the launcher only where it is, at the same path, so it needs no such check |
| R78A-3 | medium (GitHub re-review of PR #78) | `launchctl disable` alone marks the job off for its next load and leaves the one that runs loaded. For that job R78A-2 said "it stays off: nothing starts it" while the agent played on (LIVE or not, KeepAlive starting it again after every exit): `--update` no longer restarted it into the new release (it got a kickstart before), the guided installer did not say that the port and the live permission it had just written wait for the next start, and the advised `launchctl bootstrap` is refused for a label launchd still holds. The family of INS-A2: the screen told the owner otherwise | `mac_off_note` asks `mac_job_loaded` first. A job switched off that still runs is said to run now and not to start at the next login, and the advice is `launchctl enable` alone; one that is not loaded keeps R78A-2's words and `enable` plus `bootstrap`. `--update` restarts a running one into a new release with a kickstart, as before MAC-1 (it restarts the job launchd holds from the plist it read at its load: nothing is written or switched on); on the newest release it does nothing. The guided installer says that the port and the live permission just set apply from its next start and gives the kickstart. R78A-2 holds: the plist is never rewritten and the job never loaded or switched on |

**Changed tests.** Each one now pins the right behaviour, and its commit message says so.
- **R2T-4:** MW-5 ("a behind copy stays so for the day").
- **R2M-3:** R14A-1 ("a full page of 50 is refused").
- **R2I-3:** INSTALL-17's first run now stands in a root-owned folder.
- **R2I-U1:** the `launchctl` stand-in of INS-A4 now stands for a terminal without a GUI session; its assertion is
  unchanged.
- **R78A-1:** MAC-1's `--update` test: a running job whose plist changed is loaded again (bootout, bootstrap) where
  it was restarted with kickstart; an unchanged plist still gets the kickstart, now pinned too.
- **R78A-3:** the case of R78A-2's `--update` test for a job switched off that launchd still holds pinned "switched
  off" and no restart; it is now its own test with the right behaviour (runs now, a kickstart into the new release,
  `launchctl enable` alone), with a guided-installer case beside it.

**Two choices worth knowing.**
- **R2T-4:** a same-day recheck that cannot reach FoxLeague keeps the behind check and its page text.
- **R2I-6:** a setup that passes the words only with `-e` and has none in `.env` can no longer use `cli.sh` for wallet
  commands; `run.sh` still works there.

Stays open:
- **On a real Mac, by the owner's test:**
  - UPD-U5 for a job switched off with `launchctl disable` or `unload -w`: since R78A-2 the installer reads launchd's
    list of jobs switched off and leaves such a job as it is, shown with the stand-in only;
  - UPD-U5 in a terminal opened with su;
  - INS-A8 with HOME kept, `FOXAGENT_ALLOW_ROOT=1` and no install yet.
- **A service already "failed" at the first look** is restarted by `--update`, as UPD-U5 pins. One whose stop the
  script saw under way stays stopped.
- **R2T-4 across midnight:** a behind check from the day before is replaced by "could not check" when the new day's
  first check fails, as before.
- **R2I-2:** `./install.sh --update` as root on a host user's folder is refused in a container. The in-app update uses
  `--prepare`, which is exempt.
- **R2I-8:** a few milliseconds between `stage()` releasing its lock and `activate()` are not covered.
- **R2T-1:** the timings are from the maintainer's machine.
- **The TEXT reviewer's other unproven items:**
  - a dotted settings key that Telegram may turn into a link;
  - a request too large for a model's context window.
- **MAC-1, on a real Mac:**
  - the name rule is macOS's as described above, checked with the stand-ins only: the owner's Mac shows whether
    Login Items & Extensions lists "FoxLeague Agent";
  - whether Login Items & Extensions shows the new name as soon as `--update` loads the job again from the changed
    plist (R78A-1), and whether the old "bash" item stays listed;
  - R78A-2: that the item switched off in Login Items & Extensions is listed by `launchctl print-disabled` as the
    review says, and that a job switched on again with `launchctl enable` and `launchctl bootstrap` shows as on there;
  - R78A-3: that launchd takes `launchctl kickstart -k` for a job switched off with `launchctl disable` that still
    runs. If it refuses, `--update` ends in its existing words: the old version is still the one running, and the
    kickstart to type;
  - an install that updates in the app keeps "bash" until its next `./install.sh` or `./install.sh --update`: the
    in-app update does not write the plist. The first `--update` to this release is run by the installer of the
    release before it, which does not change the plist either: the next one does, and so does `./install.sh`;
  - `run.sh` is started with `/bin/bash` now, where the plist named the bash the installer found first on its PATH
    (Homebrew's, where it comes first). The update's `--prepare` already ran with `/bin/bash` under launchd.


## Final pass before the public release (2026-11-16)

**The review.** Before the repository goes public, the owner asked for one more short audit of everything no team of
reviewers had audited yet.
- **Who:** two read-only reviewers by Claude Fable 5.2 at high effort, one on the code and one on the installers and
  the updater.
- **What they read:** a frozen copy of main at `227ccdc` (live since PR #78), from `8e2dad8`, the copy audited in
  "Audit of round two". That is the fixes of round two's findings, R76A-1 (PR #77) and MAC-1 with R78A-1 to R78A-3
  (PR #78).
- **Result:** no critical and no high finding: 1 medium and 8 low.
  - No way past the owner's caps and no path from text to a signature.
  - The snapshot fence cannot be written.
  - The recovery words do not leak through R2I-6's compare.

**The fixes.** Claude Opus 5.5 at extra-high effort. Every reviewer test, ported to `test/audit-1116/<Id>.test.ts`,
failed on `227ccdc` for the reason given and passes now. Two of the installer reviewer's unproven items were proven
and fixed (FI-U3, FI-U5). No existing test changed.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| FC-1 | medium | `deref` and `resolve` (`src/foxleague/api-routes.ts`) followed a request body and every 2xx answer by `$ref`, up to 8 hops each, and spent nothing from R2T-1's budget: one `$ref` of 200,000 characters named from every body and answer held the event loop 79 s on a 418 KB document, and fingerprints still came back | Every `$ref` read spends its length, in `canon` and at each hop of `deref`; a `$ref` longer than `MAX_REF` (1,000 characters; mainnet's longest is 62) leaves the document not judged ("could not be read"). Mainnet's description at `729164194` still gives exactly the fingerprints `api-shapes.json` records |
| FC-2 | low | `upcomingMatches` took the list as whole once it held as many rows as the last page's total. FoxLeague reads the rows and the count as two queries on a live list: a tournament going active between them, or a finished game leaving between two pages, gave some fixtures twice and lost others. A kickoff 40 minutes away let a 1,000 FOXSY 1v1 pass the busy gate | The list is not read whole when a later page's total differs from the first page's, when a `tournament_match_id` repeats, when the rows pass the total or when a list of more than one page has a row with no id. A list that stands still reads as before |
| FC-3 | low (words) | `asSeen` folded every compatibility form (NFKC) and `setIn` wrote the folded text into the plan: FoxLeague's "3⁴ = 81 Commons" read "34 = 81 Commons", "25¹" read 251, "2½" read 21⁄2; `txt()` and `oneLine()` the same ("Team²" became Team2) | Before the folding, a raised run is written after `^` (3^4), a lowered one after `_` (log_2), a fraction with a plain slash and a character that folds to a digit is set off by a space from a number beside it (2 1/2). The fence checks still run on the folded text (R2T-3 holds) |
| FI-1 | low | R2I-2's sign (`data/agent.db` owned by root) never shows on an installer-made install: the installer creates the database as its user and root writing into it never changes its owner. A container or system unit without `User=` starting such an install as root still stopped at the first start after an update's confirm, while the guides said it "still starts" | `run.sh` and `cli.sh` go on as root on another user's folder when the database is root's, when `versions/active` is root's (the agent's own update writes it by rename; a link does not count) or when the start says `FOXAGENT_SUPERVISED=1` with no `SUDO_*` variable and no terminal. A mistaken `sudo ./run.sh` or `sudo ./cli.sh` and a root terminal are still refused. INSTALL.md and the troubleshooting page say when such an agent starts |
| FI-2 | low | The pasted line prepared in `versions/.staging-get` without `update.lock`; `confirmStart` runs at every agent start and removes every `.staging-*` folder, so a start during the paste's npm run removed the folder npm worked in. Between moving the folder into place and writing `versions/active` a start could also remove the new release (U4) | `get.sh` holds `versions/update.lock` from before it unpacks until `versions/active` names the new release, and releases it on every way out (give up, an error, INT, TERM, HUP); a fresh lock of another update stops the line before it changes anything; `update.lock` counts as a leftover in `folder_kind` |
| FI-3 | low | `plist_on_launcher` let its `*` span several `<string>` elements: a program line the owner extended (`caffeinate -i`, `nice`, `arch`, `env` before bash) was taken for the installer's and replaced by the launcher alone | Taken only when what `*` matched is not empty and holds no `<`; any other plist is left as it is |
| FI-4 | low (an agent the owner is stopping started again) | R2I-10's wait existed only on Linux. On a Mac launchd lists a job on its way out like a running one, so `./install.sh --update` after the owner's `launchctl bootout` loaded the job again or kickstarted it | The service writes `data/service.stopping` with its pid when its graceful stop begins and removes it with `data/service.pid` when the stop ends. `mac_after_update` first waits while that marker names the live agent (about 185 s at most), then reads launchd: a job launchd no longer lists stays stopped with UPD-U5's line |
| FI-5 | low (words) | PR #78's Mac screen lines and guide sentences had a comma before a closing "and" or "or" | Reworded: "switched off in System Settings (General, Login Items & Extensions) or with launchctl disable", "at your next login or now with" |
| FI-6 | low | `cli.sh` always dropped the environment's `AGENT_MNEMONIC`: where the words are given only by the environment, every wallet command said "run ./cli.sh setup first", setup wrote new words and `run.sh` then refused every start | `cli.sh` keeps the given words when `.env` has none, and drops them when `.env` has words (R2I-6 holds) or cannot be read |
| FI-U3 | low (the installer reviewer's unproven U3, proven) | Ctrl-C or a closed window during `mac_load`'s wait ended `--update` without a word, leaving the job booted out until the next login | A trap during the wait says the agent is not running now and gives the `launchctl bootstrap` that starts it, then exits with 130 |
| FI-U5 | low (unproven U5, proven) | An `update.lock` with a time in the future counted as fresh until the clock passed it, refusing every update meanwhile | A lock is fresh only within 30 minutes either side of now (`lockFresh`, `lock_fresh`); one further ahead is taken over like an old one |
| R79A-1 | medium (GitHub review of PR #79) | FI-2's `give_up` in `get.sh` began with `rm -rf "$staging"`. A pasted line that gave up behind another update's fresh `update.lock` removed `versions/.staging-get`, which is the other run's folder when that update is another pasted line: the other run then failed ("could not be prepared" or "mv: cannot stat") while this one said "nothing was changed" | `give_up` removes the staging folder only while this run holds the lock (`locked = 1`); a lock that cannot be taken over ends in words before anything is unpacked. FI-2's test keeps another run's `.staging-get` in the case of another update's fresh lock and checks that nothing of it changed (it fails on `d636f83`) |
| R79A-2 | low (documents, GitHub review of PR #79) | `docs/FOXLEAGUE-INTEGRATION.md` section 10.8 did not say what FC-2 made true and named a `match_id` that the rows of upcoming-matches do not carry | Section 10.8 names `tournament_match_id` and says when the list counts as read whole: the same total on every page, no `tournament_match_id` twice, no more rows than the total, no row without an id on a list of more than one page. It also says why the check may take `tournament_match_id` as unique per row, as read on FoxLeague's `release/mainnet-1.0` (`e3cee147b`): `tournament_matches.public_id` is NOT NULL with a unique index (migration 152); the query joins one participant per user and tournament and one team per user; the handler maps each row to one answer row |

`src/service.ts`'s comment on the manual check now says what R2T-4 made true (a copy found behind is looked at again
each hour).

Stays open:
- **On a real Mac (first thing at the next machine test).** Since macOS 13 the switch in System Settings (General,
  Login Items & Extensions) may be kept by Background Task Management (`sfltool dumpbtm`), not in
  `launchctl print-disabled`. If so, `mac_job_disabled` does not see that switch and R78A-2's protection covers only
  `launchctl disable`.
- **FI-4 starts working one update late.** The running agent writes the stop marker only from this release on, so
  the one update that brings it behaves as before on a Mac. It relies on the agent's own marker (not on launchd's
  `print` text) and on launchd letting go of a booted-out job within 5 seconds.
- **FC-2:** asking each later page one row early (to see a removal and an addition both before a page's edge) was
  not done; it changes the offsets R2M-3's test pins.
- **FI-1:** shown with stand-ins for `id` and `stat`, not as real root. The reviewer's container script is the way to
  check it.
- **Not taken up:**
  - U2: `mac_load` says "not running now" on any failed bootstrap.
  - U6: an owner's own user unit named `foxleague-agent.service` still counts as the installer's.
  - The code reviewer's unproven items: confusable letters are not folded; the digest grows with the list R2M-3 now
    reads whole; the pause with the manual check switched off.

## A chain check before every signature, Invite Friends and the unread field (2026-11-19)

Three changes the owner approved for one pull request, to be live before FoxLeague's referral programme, the ELO pair
cap and the fusion that mints its result go live (Fri 2026-11-20 14:00 UTC). The facts:
- **The network halt.** MultiversX mainnet produced no block on 2026-11-17 from 09:01 to about 15:00 UTC (FoxLeague's
  `ef2d402a3`, #778, names it). The agents sent nothing into it only because the EGLD price read failed at the same
  time ("prices unavailable"). The agent had no check of its own that the chain produces blocks: with a price still
  cached or readable it would have signed payments into a chain that confirmed nothing.
- **FoxLeague of 2026-11-18.** `origin/main` `6f9c969ac` (release `a546f7279`) serves a new switch, `referral` (Invite
  Friends, from 2026-11-20 14:00 UTC), and a new manual page. The running agent told the owner of a new settings key
  and of a switch the agents do not know (P-W2, P-W3), and each plan read the generic "a FoxLeague rule your
  instructions do not cover yet" line (P-W6).
- **Agent 1 (Haiku), 2026-11-18.** It planned to join two paid Bronze round robins (T5567, T5571, 18 teams each) and the
  executor refused both: "3 (4) seated teams are clearly stronger ... no real chance of the top three". The plan could
  not know: its snapshot read the field of only the 4 joinable tournaments with the nearest deadlines and said nothing
  of the others.

The fixes are by Claude Opus 5.5, test first: each test under `test/sync-1118/` named after its Id failed on `b853edb`
for the reason given and passes now (HALT-1 and HALT-2 because the read did not exist; HALT-10 and FL20-1's last test
are controls that pass on both). The existing tests that build a chain of their own gain the new read
(`producingBlocks` in `test/fixtures.ts`, a newest block under a second old) and nothing else: without it they meet
the check and are refused, which is the point of it.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| HALT-1 | medium (money; with HALT-3) | The agent read nothing that says whether MultiversX produces blocks | `Chain.newestBlockMs(shard)` (`src/chain/gateway.ts`) reads `GET {gateway}/network/status/{shard}`: `erd_block_timestamp_ms`, or `erd_block_timestamp` in seconds from a gateway that serves only those, kept 10 s. Two values that disagree by a second or more, a time before 2020, anything that is not a whole positive number, the gateway's error or no answer is a failed read, never a time, and a failed read is not kept. One more try at most, 10 s each |
| HALT-2 | medium (money; with HALT-3) | No rule said when the chain counts as halted | `chainHalt` reads the shards at once and refuses while one has no block for more than 60 s, while one cannot be read or while one is dated more than 60 s ahead of the computer's clock (the clock or the answer is wrong, so a halt cannot be told). The threshold: a round is 600 ms, so a shard's newest block is normally under a second old; 60 s is 100 rounds, far past a few missed rounds, an observer a little behind or a clock a few seconds off, and a halt (minutes to hours; six hours on 17 Nov) is seen within a minute. A kept reading can make a block look at most 10 s older, never fresher. The refusal says when the last block came, on which shard, how long ago, that nothing is signed and that the next plan tries again |
| HALT-3 | medium (money: payments signed into a chain that confirms nothing; they may execute hours later (after a deadline or an auction's end) or stay booked) | Every path that signs (`send` behind every payment and the registration relay) signed whatever the chain was doing. Only the price read stood in the way, by chance | Before anything is booked or prepared, every action that will sign (a transaction built, a seat to pay after a create, a fusion FoxLeague has still to prepare) reads the metachain, the signing wallet's shard and shard 1 and is refused on a halt. Which shards: the metachain notarizes every shard's blocks, so a payment that crosses shards and the finality the executor waits for need it; the wallet's own shard takes the nonce, the gas and the FOXSY; shard 1 is where every contract the agent pays executes (FoxLeague's players and tournaments contracts, xExchange's pair and its composable tasks contract, computed from `MAINNET`). Nothing is booked, asked or signed |
| HALT-4 | medium (money; rule 3) | A halt that begins between the check before the booking and the signature | `send` checks once more right before `signTransaction`, after the nonce is read and before the kill switch's last look; a halt throws, nothing is signed, and the caller's catch releases the booking (nothing pending is kept) |
| HALT-5 | medium (rules 4 and 5) | Unknown must not read as "producing blocks" | A status that cannot be read on any of the three shards refuses, and so does a chain client without the read at all |
| HALT-6 | (the rule's other side) | A healthy chain must not be refused | A fresh block on the three shards lets the payment through; the check asks exactly the metachain, the wallet's shard and shard 1 |
| HALT-7 | medium (money; rule 3) | The registration relay signs outside `send` | The same last check right before its signature: a halt releases the 5,000 FOXSY fee booked before it and nothing goes to the relay |
| HALT-8 | (coverage) | The owner's own actions | Telegram `/do`, the dashboard's actions and the owner's leave go through the same `Executor.run`, so the same check holds; a leave signs nothing and does not wait |
| HALT-9 | low (what a dry run tells) | A dry run would show "would pay" on a halted chain while live refuses | A dry run takes the same check before anything is booked, as it takes the same prices: it refuses as live would. It never reaches `send`, so the last check is live only |
| HALT-10 | (control) | An action that signs nothing must not wait on the chain | Lineups, training, casual games and a free seat read no network status (FoxLeague: matches go on during a halt) |
| FL20-1 | low (what the plan and the owner are told; no money) | FoxLeague's `referral` switch had no rule: the plan read the generic line and the owner was told the agents do not know it | The owner's rule: the agents take no part in Invite Friends (no invitation at registration, no invite link shared or used, no referral credit, the owner's teams never invite one another; it changes nothing in how they play). `referral` is in `RULED_SWITCHES`; the snapshot's Referral line says the programme exists, in short, and the rule. The agent calls no `/api/referral/*` route (a control pins it) and `POST /api/register` carries the team name and the wallet only |
| FL20-2 | low (cost of every plan) | FoxLeague's new page `mechanics/invite-friends` sits in the mechanics folder, so `sync-manual` would take it in whole: about 3,000 tokens of rules for a programme the agents take no part in, and each edit FoxLeague makes to it (a second one came the same day, #779) would make the copy behind | Left out on purpose in `LEFT_OUT` (`src/strategist/manual.ts`), with its reason; FL20-1's line gives the programme in short |
| FLD-1 | low (what the plan knows; the executor already refused) | A planning snapshot reads the seated field of only the `FIELD_TOURNAMENTS` (4) joinable tournaments with the nearest deadlines; the digest printed a field line for those only, so "not read" and "nothing to say" looked the same | Every other open tournament the field rule judges (the same filter, `fieldJudged` in `src/snapshot/snapshot.ts`), and that the team does not sit in, gets one short line: "field: not read in this snapshot; the executor reads it at the join and refuses it with 3 or more clearly stronger teams" (`FIELD_LIMIT`). A snapshot that reads no field (before each action, the CLI) adds none. `FIELD_TOURNAMENTS` stays 4: a field costs up to 16 seats of 2 or 3 FoxLeague reads each (cached 20 minutes), for every agent's plan |

Also in this change: the game manual copy is synced to FoxLeague's `origin/main` `6f9c969ac` (manual `99c47a4e6`; 16
pages, one sentence of Permanent Match Records changed), the settings record names `referral`, and the route record
(`src/foxleague/api-shapes.json`) was rewritten by the sync: of the 54 routes the agent calls only `GET /api/config`
changed shape (the `referral` block), and mainnet's live API description of 2026-11-19 gives exactly the recorded
fingerprints. `docs/ECONOMY-AND-RULES.md` sections 2, 17 and 22 and `docs/FOXLEAGUE-INTEGRATION.md` sections 1.5 and 28
carry the details; the site and the README say what the agent does during a halt and of the referral programme.

What was checked and needs no change:
- `signTransaction` is called in two places only, `send` and the registration relay, both in `src/executor/executor.ts`.
  The pending-payment confirms, the refund checks and the badge sign nothing. The install's private split extension
  (`src/local`, not in the repository) only splits an action into pieces that each run through the executor.
- Binance top-ups (`src/topup.ts`) are a withdrawal the exchange sends, not a signature of the agent: left out. On a
  halted chain Binance holds its own withdrawals.
- FoxLeague's own writes wait while its chain is not ready since #778 and #780, on `release/mainnet-1.0` only on
  2026-11-19; `GET /api/chain-status` answers 404 on mainnet. The agent depends on neither.

Stays open:
- **The window of a minute.** A transaction signed in the first 60 s of a halt still goes out; it waits in the pool or
  is dropped, and its booking stands as for any payment whose outcome is unclear (the pending retry confirms it once the
  chain is back, never paying again).
- **Other shards.** A halt of a shard that is neither the metachain, the wallet's own nor shard 1 is not seen. No
  payment of the agent executes there today; a contract of FoxLeague's moved to another shard would need its address in
  `MAINNET`, which the check reads.
- **The computer's clock.** A clock more than 60 s off refuses every signature until it is put right (behind: "ahead
  of this computer's clock"; ahead: "no block since"). The refusal names both times. A WSL clock after the host slept
  is the likely case.
- **The owner's gateway.** The check reads `MVX_GATEWAY_URL`. A proxy whose observers fall more than a minute behind
  refuses too, the safe side: its nonce and its broadcast would be as stale.
- **No snapshot line.** The planning snapshot does not say that the chain is halted (the optional part of the brief):
  each paid action of a plan is refused with the halt's words and the next plan reads them. A line would save the
  model's choices during a halt, not money.
- **The manual check after the deploy.** FoxLeague's MCP server still served the manual of `729164194` on 2026-11-19,
  so until FoxLeague deploys its manual the hourly check sees `mechanics/permanent-records` differ (the copy is ahead).
  The owner hears of one changed page; no action is held by it (it is no page of `HOLD_PAGES`).
- **`sync-manual` reads `origin/main`**, not `release/mainnet-1.0`: the header names `99c47a4e6`. The pages the agents
  take in and the route shapes are the same at `a546f7279`; the next sync after FoxLeague's next promotion moves it.
- Production was not read and nothing was deployed.

## Whose tournament it is, the game day's reset, organizer starts and FoxLeague of 19 Nov (2026-11-20)

Five changes for one pull request, from the agents' own production of 18 and 19 Nov, the GitHub review of PR #80 and
FoxLeague's changes of 19 Nov. The facts:
- **19 Nov, agent 4.** It was refused widening T6101, which it created itself on 16 Nov 14:05 UTC ("a tournament or
  challenge this agent did not create (the owner's)"). Its create row holds `createdTournamentId: 6101`, no `byOwner`,
  and the model's reason "Owner's organizer instruction. ...". T6211 (agent 9) and T6318 (agent 3) were in the same case.
- **18 and 19 Nov, agents 10, 1, 3 and 9 (Haiku and Opus).** Plans made from 13:27 to 13:58 UTC with the day's five free
  training sessions or five match starts used up ran their trainings and matches before the 14:00 UTC reset: "daily
  training exhausted (5 used, 0 paid slots banked)", "daily match limit reached (5/5)", one at 14:00:04 against counts
  read just before 14:00. The plans were right; the scheduler did not know the reset.
- **The GitHub review of PR #80 (R80A-1).** The seat of a created tournament is signed up to a minute after the
  organizer payment, so its chain check reads every shard afresh; one gateway blip left "created T..., its seat not paid".
- **19 Nov, agent 3.** It created a public Silver round robin, T6303, at 19:27 UTC on the first free start the snapshot
  offered, 05:26 the next morning. Nobody joined overnight; it was cancelled and the 150 FOXSY calendar deposit was lost.
  Every organizer tournament of the agents that filled was booked 6 to 15 days ahead.
- **FoxLeague of 19 Nov.** The running agent alerted at 09:03 UTC that FoxLeague's manual changed (the busy-card rule of
  #748). FoxLeague's release branch for mainnet holds more that its main has not taken yet: #752 (a card in an auction
  takes no paid action) and #764 (account bans and deletion, a new legal page).

The fixes are by Claude Opus 5.5, test first: each test under `test/fix-1120/` named after its Id failed on `62f06c0`
for the reason given and passes now, except the ones that pin what stays (OWN-1's `byOwner` test, OWN-1b's second
test, ORG-3's constant, its test of a 1v1 and the owner's create and the R80A-1 tests of a halt, which pass on both: the
reviewer asked for the coverage).

| Id | Severity | Finding | Fix |
|---|---|---|---|
| OWN-1 | medium (money: an unfilled organizer tournament keeps its deposit) | `ownCreations` (`src/executor/rivals.ts`) skipped a create row whose reason began with "owner". The reason is the model's own text: since the owner's strategy of every agent has an "Organizer:" line (15 Nov) the models write "Owner's organizer instruction ..." for the agent's own creates, which then counted as the owner's for good: `widen_range` refused them (AGENTS.md rule 2 in spirit: model text decided a rule) | Whose a creation is comes from what the executor wrote: `byOwner`, never a reason. No fallback is kept: `createdTournamentId` is written since `468fb2a` (R38A-1, PR #38, 26 Oct); every path that acts for the owner (Telegram `/do`, the owner's leave) writes `byOwner` since `8ceeb56` (R32A-4, PR #32, deployed 24 Oct 10:24 UTC), an ancestor of it, so no create row with a created id can lack it while made for the owner. R38A-1's test logged such a row; it now logs it as the executor does |
| OWN-1b | low (the agent could not leave a seat it paid itself) | The League + Knockout seat check (`executor.ts`) read the same reason: a seat the agent joined with a reason "Owner's ..." was the owner's | The reason counts only on a join row dated before 25 Oct 00:00 UTC (`BY_OWNER_KEPT_FROM_MS`, the night after `byOwner` was first kept), where a `/do` join can lack it; on a newer row only `byOwner` decides. The seat window is 60 days, so this ends by itself on 24 Dec |
| RESET-1 | low (refusals, and a plan's trainings and matches lost to the reset; no payment) | `scheduleActions` (`src/service.ts`) ran a plan's actions at random moments of its window, the game day's reset ignored, so a training or a match start the day had no room for ran before 14:00 and was refused | `newDayHolds` (`src/executor/new-day.ts`) reads the plan's own snapshot with the executor's own rules (`trainingDayRefusal`, `matchDayRefusal`, now shared with the `train` and `play_match` rules), counting the plan's earlier sessions and starts; it holds such an action until the first reset after the snapshot plus 2 minutes. The plan's order, the match gates and the deadlines hold; one the window ends before (or one that would push a later deadline action late) is dropped with the usual "dropped from this plan" line. An owner's request is not held. The margin: FoxLeague counts the day's sessions and starts at each request from the reset hour (shop.rs `used_today`, matches.rs `DAILY_MATCH_COUNT_SQL`); the fresh snapshot an action is checked against is read after its wait, so a read after the reset sees the new day; 14:00:04 was checked against counts read before 14:00. Two minutes cover that read and the two servers' clocks |
| R80A-1 | low (no money: the seat booking was released; an unfilled tournament may keep its deposit) | One gateway blip between the organizer payment and the seat's signature left a created tournament without its seat; no test covered a halt between the two signatures of one action | Tests of a halt and of an unreadable status between the organizer payment and the seat and between the ranked press and the ticket's signature, with what is booked, what is released and the row's text. `chainHaltCheck` tells an unreadable status from a stale block; right before a signature an unreadable one is read once more after 5 s (`HALT_REREAD_MS`), never more and never a stale block. Unknown still refuses, within a minute; the stop check still follows |
| ORG-3 | medium (money: 150 FOXSY on T6303) | The snapshot offered the first free start for a new tournament, hours away; the executor took any start 2 hours ahead | One constant, `ORGANIZER_START_MIN_MS` (3 days, `src/executor/actions.ts`): the snapshot (`calendarLines`, the gaps line, the calendar read's count) offers no start sooner than 3 days after the latest moment the plan's actions run and says why; the executor refuses the agent's own create starting sooner, naming the earliest start allowed; the free starts a clash names are searched from it. Private too: its seats fill only when the invited teams join; its deposit is lost the same way. Not affected: a 1v1 (no start of its own) and the owner's own create (`byOwner`, FoxLeague's 2 hours). A stricter check, never a looser one; the 30-day horizon and each agent's own pick stay |
| SYNC2-1 | medium (money: a payment kept for a card the marketplace contract holds; from #752 refunded whole with the gas lost) | The agent's condition recovery named any card of the wallet, one in an auction too. Before FoxLeague's #752 the confirm kept the payment and recovered the listed card; from it the whole payment is refunded (a bulk recovery that names it too), so no card is recovered and the gas is lost | A card-targeted Shop item for a card in an auction is refused before anything is booked: "card #N is in an auction (listed for sale): FoxLeague sells no Condition Recovery, Reduce Cooldown, Medicine or Fusion Match Waiver for it until the auction ends". The agent's recovery names its cards, so no listed card is counted (it never uses Recover All) |
| SYNC2-2 | low (rule 4) | Medicine and both fusion waivers refused a listed card, but a card whose auction state the roster did not give read as "in the wallet" | Unknown refuses these four items (recovery, medicine, both fusion waivers) only; the read is the agent's own roster, `listed_for_sale` per card |
| SYNC2-3 | low (what the plan knows) | The plan saw "LISTED" on a card line, not that such a card takes no Shop item | A snapshot line names the cards in an auction and says they take no Shop item and no training until the auction ends |
| SYNC2-4 | low (the manual sync would stop) | FoxLeague's new page `legal/account-bans` (release branch) was undecided | Left out of the agents' manual with its reason (`LEFT_OUT`): nothing a plan decides; a banned wallet cannot sign in, so every read that needs a session fails and the executor refuses |
| R81A-1 | medium (money: a training slot bought for nothing that day) | The GitHub review of PR #81: `newDayHolds` did not count a `buy` of `training_slot` earlier in the same plan, though the executor's `applyEffect` does. With the free sessions used and nothing banked, a routine plan `[buy training_slot 2, train, train]` dropped both trainings while the buy still spent the FOXSY; before RESET-1 they ran on the slots just bought | A slot bought earlier in the plan adds a paid session today, as `applyEffect` counts it (`slots_banked` plus the quantity, 1 when none is given). No other action adds room for the day: nothing buys match starts (a ranked ticket pays for a ranked game, not for a start). Its test (RESET-1, "a training slot bought earlier in the plan ...") failed on `89dc1ca` |

Also in this change: the game manual copy is synced to FoxLeague's `origin/main` `af825e955` (manual `1ab9de65d`, 16
pages; the busy-card rule on four). The route record and the game settings keys are unchanged.

What was checked and needs no change:
- The other reads of activity text in `src/executor`: `targetedRecord` reads `action.tournament_id`, the action the
  executor itself validated; `match-starts.ts` reads the `play_match` summaries the executor writes (validated fields
  only); the shop retry reads the chain's own failure reason ("new NFT data on sender"). `formatResult`, the shadow
  record and the plan lines only display a reason.
- The fresh snapshot right before each action reads FoxLeague's shop status and daily allowance afresh (no client cache;
  only the roster has a 30 s server cache), so after the hold it sees the new day's counts.
- The private split extension (`src/local`, not in the repository) cuts a recovery into one-card pieces that each run
  through the executor, so the new refusal holds for each piece.

Stays open:
- **The busy-card rule** (#748) ships off with no switch in `/api/config`: the manual copy carries it, the executor has
  no rule for it. It waits for its switch; the agent's config watch tells the owner when one appears.
- **#752 and #764 are on FoxLeague's release branch only** on 2026-11-20; whether mainnet runs them was not read. The
  agent's refusal holds either way. The next `sync-manual` after FoxLeague's next promotion takes #752's manual lines.
- **The prompt's create line** still says "2 hours to 30 days after the action runs" (`src/strategist/prompt.ts` is
  byte-stable for the prompt cache): the snapshot's lines and the executor's refusal carry the 3 days.
- **An earlier training or match start counts as run** (R81A-2, low, the GitHub review of PR #81). `newDayHolds`
  counts each earlier `train` and `play_match` of the plan as one that runs, as `applyEffect` counts a confirmed one;
  `runPlan` may still skip one (the action probability) or the executor refuse it; the one after it is then held or
  dropped though the day still had room. No money moves and the next plan plays it. A fix would read the day again
  before each held action, not at the schedule; a held action dropped at the schedule cannot come back. Left as it is.
- **Whose create keeps the 2 hours.** Only a create sent with `byOwner` (Telegram `/do`) keeps FoxLeague's 2 hours. A
  plan made from the owner's request in words and a CLI plan carry no `byOwner`, so the 3-day floor holds for them too
  (ORG-3); an owner's plan in words is not held for the reset either (RESET-1 holds routine plans only).
- **Other per-day limits at the reset.** RESET-1 holds trainings and match starts only. A paid action refused by the
  daily cap just before the reset (the cap is per game day too) is still refused, not held.
- **The private split extension**: a recovery piece for a card in an auction is now refused; the pieces after it in
  its group are dropped with it. The owner's local file now leaves listed cards out of the
  split (one condition in `src/local`, with its own test), so the other pieces run.
- Production was not read and nothing was deployed.

## The AI key in Anthropic's new console (2026-11-22)

The owner, setting up a key before the public release: Anthropic's console now asks "Where does your code run?" when
**Create key** is pressed (Your own machine, Cloud or Kubernetes, CI pipeline, Somewhere else), then offers an
expiry that defaults to 30 days, a linked account and a scope. The test `test/console-1122/APIKEY-1.test.ts` failed
on `4e4c375` and passes now; the GitHub reviews of PR #89 (each PASS) found the lows in the rows R89A-1 onward, all fixed in the same PR.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| APIKEY-1 | launch (the owner, 2026-11-22) | The steps said only "press Create key". **Your own machine** signs in the `ant` command line tool and makes no key the agent can use; the default expiry of 30 days stops every agent on that day (the agent tells the owner once, then waits) | The installer's 4/7 Keys help, INSTALL.md, the site's Keys page and the dashboard's guide say to choose **Somewhere else** (an API key), set Expires to **Never** and leave the linked account (yourself) and the scope (Default workspace) as they are. The installer's line keeps its number, so the install videos' quotes stay where they are |
| R89A-1 | low (record) | "Stays open" named only the install videos; the Getting started screenshot on the Keys page shows the old step too | Named |
| R89A-2 | low (test) | APIKEY-1 found the installer's line by its number, so a line added above it failed the test with the steps unchanged | The test finds the line by its text and checks the videos' quote at that line's own number |
| R89A-3 | low (record) | The record said the key is read only from `.env` or the Keys box; a key pasted in Keys rests in `data/secrets.json` | Named, with its mode and that it wins over `.env` |
| R89A-4 | low (dashboard) | The fourth review: Refresh was one state for every agent tab, so a refresh of agent 1 greyed out agent 2's button and dropped a press there | The state is per agent (`refreshing`, a set of the agents being read); a tab switch draws the button for the agent it opens |
| R89A-5 | low (test) | REFRESH-1 replaced the page's `act`, so "until the new reading is shown" rested on an unchecked comment | A test checks that the page's own `act` awaits `loadState()` before it returns |
| R89A-6 | low (record) | The record said the key is never shown back; Keys and `/keys` show a masked form | Named: the first 10 and the last 4 characters |
| HOURS-1 | spend (the owner, 2026-11-22) | A new agent planned from 08:00 to 20:00 UTC, 12 hours; the owner's own agents play 06:00 to 22:00 since 2026-10-27 (08:00 to midnight in Romania in winter) | The default is 06:00 to 22:00 UTC, 16 hours: 8 plans a day at the 2-hour tick, about $0.80 a day of AI at the defaults where it was $0.60; the five places that state the cost say so. An existing agent keeps its window: every agent row saves the whole defaults when it is created (`addAgent`, `addImportedAgent`) and only keys added later fall back to the defaults, so no agent's spending rises by itself on an update. A longer window chosen by the owner still asks for the password |
| BIDS-1 | spend (the owner, 2026-11-22) | The limits per rarity were set on 2026-10-24 from that day's market; on 2026-11-22 a Legendary sold near 46,000 while the default limit and Zeus's Max bid were 38,000, so a new Zeus agent could never buy one at market | The owner's rule: a card is three of the rarity below fused, so each limit is three times the one below plus 5 percent, from a Common at 525, rounded: Uncommon 1,650 (was 1,500), Rare 5,200 (7,000), Epic 16,400 (14,000), Legendary 51,700 (38,000); the Common stays at 500, a pack card's price. Against that day's market (Uncommon 1,300, Rare 4,800, Epic 11,700, Legendary 46,000) every limit holds a bid and one raise; an Epic and a Legendary also a second round. Each level's Max bid is still the limit of the dearest rarity it buys: Climber 1,650, Hunter 5,200, Predator and Beast 16,400, Zeus 51,700; a bid at the max still fits each level's daily cap. The Uncommon's 1,650 is above three pack Commons and the fusion fee but under the build ceiling with its matches (2,200). An agent that saved its limits keeps them (the owner's 10 agents saved 38,000 and the rest); one that never saved its limits per rarity (made before 2026-10-24 and never saved since) reads the new defaults at once, a rise on the Uncommon, the Epic and the Legendary without the password, still within its saved Max bid, the build cost and the daily cap (R89A-9). Zeus's Max bid (51,700) is above its Max swap (50,000): an agent that holds only EGLD funds a bid above 50,000 with two swaps, the first plan's one refused as "swap first" (fails closed, nothing overspent). A +10 percent rule was weighed and left: Predator's and Zeus's max bids would pass their daily caps |
| REMOVE-1 | medium (the owner's test of the release candidate: an imported team could not be removed) | Remove of a paused imported team refused "agent N is busy" for as long as the plan it had started waited for its next action (up to 0.8 of a tick, 48 minutes at Zeus) or while any other agent ran an action; the page then switched to agent 1 as if the team was gone | Remove refuses as Retire does: only while an action of this agent is still running (`idleFor`) or a payment waits. A plan that only waits stops at its next step, which reads the agent first (removed: it stops, before any snapshot or signature). The page switches away only when the agent is gone, as for Retire and Delete |
| R89A-9 | low (record, rule 7) | The tenth review: BIDS-1 recorded only that an agent with saved limits keeps them | The row says the other half: an agent that never saved its limits per rarity reads the new defaults at once, within its saved Max bid, the build cost and the daily cap |
| R89A-10 | low (what the owner reads) | The bubbles' shadow sentence counted the active agents' shadow plans, the password rule (wakesShadow) the retired ones too | `shadowsSet` counts the retired agents as well |
| R89A-11 | low (test) | The refusal at the default Legendary limit was not tested | Tested at 51,700 and 51,701 under a Max bid above it |
| R89A-12 | medium (the eleventh review: a removed team's number read as the install's own wallet; nothing signed) | With REMOVE-1, Remove went also while the tick was still making its plan (the snapshot, the AI), which never read the agent again; `wallet()` then found no row and fell back to the install's own recovery-words wallet at that number: it was read from the chain and FoxLeague, stored as that number's snapshot and the plan paid for. The executor refuses a row that is gone, so no transaction | Remove waits while the plan is still being made (`planning`, set from the start of the tick until its actions are handed to `runPlan`): "the plan it started is still being made: remove it in a minute". A removed imported team's number never yields a wallet (`wallet()` refuses it, never the install's own). Tests: a real tick refuses Remove until it is over; a plan that waited through Remove stops at its next step with no snapshot and no action |
| R89A-13 | low (test) | The twelfth review: R89A-12's real-tick test ran on the default hours (06:00 to 22:00 UTC), so between 22:00 and 06:00 the tick ended at once as outside its hours and the test failed: CI red 8 hours a day | The test sets all 24 hours and asserts the tick runs (`isBusy`) before it tries Remove |
| R89A-14 | low (fails closed: a false "tick failed" for a removed team) | A step of a waiting plan read its snapshot (tens of seconds, no lock held); Pause and Remove in that read: the reading was stored under the removed number, then `wallet()` threw and the tick logged an error and told Telegram | After a step's snapshot the plan ends quietly when its team is gone; `snapshot()` keeps nothing of a reading whose team was removed meanwhile |

A key that never expires is a long-lived secret (the console says so in red). What holds it: the agent reads it
from `.env` (mode 600) or, once pasted in the dashboard's Keys box (password), from `data/secrets.json` (mode 600),
which wins over `.env`; it shows back only a masked form (the first 10 and the last 4 characters, in Keys and Telegram's
`/keys`) and never sends it anywhere but Anthropic's API; the monthly spend limit of the step before caps what a leaked key could cost. The scope stays
the Default workspace, never Organization (which would also open the Admin API). The owner can revoke the key in
the console at any time and paste a new one in Keys.

Stays open:
- The install videos and the Getting started screenshot (`site/public/screenshots/getting-started.png`, shown on the
  Keys page above these steps) show the old step until they are rendered again with the launch PR (#85).

## Haiku 5.5 at high, the AI of a new install (2026-11-20)

The owner's decision of 2026-11-20. His ten live agents played Opus 5.5, Sonnet 5.5 and Haiku 5.5, all at high effort,
from 13 to 19 Nov: the same results (56 to 57 percent of competitive matches won, about the same ELO gain), Haiku at
about $0.51 an agent a day against $1.59 for Sonnet and $2.90 for Opus, and each of Haiku's slips refused by the code
before any money moved. It answers the open line of W-8 (Windows real-PC check of 2026-11-13: "Changing that default
raises the AI spend: the owner's call"): the owner decided it, and the new default lowers the AI spend.

The fixes are by Claude Opus 5.5, test first: the tests under `test/default-1120/` are named after their Id, and each
failed for the reason given (DEF-1 on `62f06c0`: Sonnet 5.5 at medium, Opus 5.5 recommended, the old pages; R82A-1 on
`9914141`: Opus 5.5 at high) and passes now. DEF-2 has no test of its own: its checks sit in DEF-1's first and third
tests, and the medium of a model named without an effort held before as well, so they guard it. The tests that pinned
the old default follow it: DOCS-4, MS-C, LIST-6, LOCAL-1, LIST-11, PAM-13, W-8 and the Zeus test.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| DEF-1 | design (the owner, 2026-11-20) | A new install played Sonnet 5.5 at medium (`AGENT_MODEL`'s default and the effort `strategistChoice` fell back to) while every level recommended Opus 5.5 at high | `DEFAULT_AI` (`src/store/settings.ts`): Haiku 5.5 at high. `AGENT_MODEL` falls back to it, `LEVEL_AI` recommends it for every level and `.env.example` names it. The pages, the guides and the dashboard say it, with one sentence on when Sonnet 5.5 (plans more carefully, acts less) or Opus 5.5 (the most active, the dearest of the three) fits. The cost of a day at the defaults is about $0.60 (about $0.10 a plan on Haiku's card for a prompt over 100,000 tokens, its answer at high included) and $10 of first credit lasts about two weeks. Sonnet 5.5, Opus 5.5 and Fable 5.2 stay choices |
| DEF-2 | design (rule 7) | The effort nobody chose: high for every install would raise one that named a model in `AGENT_MODEL` without an effort from medium to high on update, with no password | `strategistChoice`: the effort nobody chose (no effort saved in the dashboard, no `AGENT_MODEL_EFFORT`) is high only with the model nobody chose (no model saved, no `AGENT_MODEL`, `cfg.model` the default). A model named without an effort plays at medium, what earlier versions played it at. An effort that is not one of the five is medium. The password rule is unchanged: from the default a dearer model or a higher effort asks, the default itself never asks, and back to it from any model of the list at high or above is one click |
| R82A-1 | high (rule 7; the GitHub review of PR #82) | DEF-2 looked at the all-agents choice only. An agent with a model of its own and Effort "Same as all agents" took the all-agents effort (`agentChoice`). With nothing picked in the Strategist box and no `AGENT_MODEL*` (the installer writes neither), an agent saved as Opus 5.5 played Opus 5.5 at medium before the update and at high after it, with no password, the step the dashboard asks the password for. `cli model 2 claude-opus-5-5 same` reached it too | `inheritedEffort` (`src/strategist/strategist.ts`): an agent whose model is its own (one of the list, or the successor of one that left it) and that has no effort of its own plays the effort picked for all agents (the Strategist box, else `AGENT_MODEL_EFFORT`), else medium. The default pair's high goes only to the agents that play the default model, and the effort inherited is never above the all-agents one. The service's `allAi` carries it as `ownModelEffort`; the plan path, the dashboard's pairs, the CLI and the page (`aiAll`) read it. An agent whose own model is Haiku 5.5 plays medium too: its model was picked, and medium is what it played before. Applying a pair in the Strategist box saves its effort for all agents, so `allAgentsAiNeedsPassword` also weighs each agent's raise: Haiku 5.5 at high picked while such an agent plays at medium asks for the password, on the server and on the page. The page's "Same as all agents" reads "(high; medium with a model of its own)" and the Effort bubble and the Settings page say why. Nothing is written to the database |

What was checked and needs no change:
- The owner's live server: the Strategist box saves its model and its effort together (`setStrategist`), and that pair
  wins over `AGENT_MODEL`, `AGENT_MODEL_EFFORT` and the defaults; each agent's own model and effort win over the box.
  Where an effort was picked for all agents, R82A-1's rule gives the agents what they played before.
- No other reader of an agent's pair: `agentChoice` is called by the service (its pairs and the plan path, both through
  `allAi`), the password routes and the CLI; the page copies it in its three places.

Stays open:
- **Sonnet 5.5 at medium to Haiku 5.5 at high asks for the password.** `raisesAiSpend` weighs the effort by itself, and
  the pair cannot be shown cheaper on every plan: a plan's prompt is on Haiku's dearer card, only 4 times under
  Sonnet's, and Haiku at high writes about 16,300 tokens. Haiku 5.5 at medium is one click. Loosening it is the owner's
  call.
- **A shadow entry that rested.** An install made before this version that never picked a model and set a shadow entry
  for Sonnet 5.5 (it rested while Sonnet played) starts paying for it after the update. Shadow plans are set by hand on
  the server; no such install is known.
- **The installer's credit line.** `install.sh` still says "Add credit ($10, about a week)". The install videos quote
  it (`test/install-videos.test.ts`), so it changes with a re-render of `site/scripts/videos`. At the new default $10
  lasts about two weeks, as the pages say.
- **The screenshots and the videos** on the site show the Strategist box as they were captured; the capture scripts
  (`site/scripts/screenshots.ts`, `site/scripts/videos/src/capture.mjs`) use the new default for the next capture.
- Production was not read and nothing was deployed.

## Find my team (2026-11-22)

The owner, before the public release: a player often has several wallets made from the same recovery words (xPortal
and the web wallet derive account 0, 1, 2 ... from them) and the team may be on any of them. Import team checked one
account number at a time, so a player who did not know it tried them one by one. **Find my team**, beside the account
number in the import dialog, lists the first 20 accounts of the words (or of a keystore that holds words) with the
team each one plays, like the account list of a wallet; **Use this one** fills in the number and runs the usual
Check. The tests in `test/find-team/FIND.test.ts` failed before the change (no such search) and pass now; of the
GitHub review's findings, R88A-1 to R88A-3 failed on `c983590` and pass now, R88A-4 (a stronger test of what was
right) passes on both.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| FIND-1 | feature (the owner, 2026-11-22) | The account number had to be known: the check reads one account | `POST /api/agents/import/find` (dashboard login and CSRF as every write) answers the account numbers, addresses and team names of 20 accounts from `from` (0 to 999). `accountAddresses` (`src/wallet/imported.ts`) keeps only each address and drops its key at once; a keystore is opened once (`decryptMnemonic`) under the same KDF limit as the check. Nothing is stored and no session is opened: the team name comes from FoxLeague's public profile (`GET /api/users/{address}`), so no FoxLeague account is created for an empty wallet. The answer holds no key or word; errors never repeat what was pasted |
| FIND-2 | rule 4 | A profile FoxLeague could not answer would read as "no team" | It is `unread` ("could not be read, search again"), never "no team" |
| FIND-3 | hygiene | A double click would ask FoxLeague 40 times | One search at a time (a second one is refused until the first ends); a PEM file or a keystore with one key has one account and is sent to Check |
| FIND-4 | what the owner sees | A wallet that is already an agent (or one of this install's own accounts) would be offered for import, then refused by the check | Named in its row ("already agent 2", "this install's own account: use + Add agent") with no **Use this one** |
| R88A-1 | medium (rule 4, what the owner reads) | The GitHub review of PR #88: the list's first line counted accounts FoxLeague could not answer as "no team", so a failed read of the account with the team read "no team to import here" | `impFindHead` says "no team found yet; N could not be read, search again" (or the teams found, then the unread count); "no team to import here" only when every account was read |
| R88A-2 | low (a check of the wrong account; the Check and the password step still show the real team) | The list stayed when the words, the keystore file or its password changed; a search that answered after a change of the key type was shown too: **Use this one** then checked that number of the new key | Any change to the key or its type clears the list (`impListClear`); a search drops an answer that comes back after a change |
| R88A-3 | low (privacy, the owner's call) | One search tells FoxLeague that 20 addresses are asked together from one address, which the one-account Check never did | Said in the dialog ("FoxLeague sees the 20 addresses asked together.") and in the guide, with the way around it: type the account number instead |
| R88A-4 | low (tests) | FIND-3 timed the keystore search; 20 openings fit in its 3 s | The test counts the openings: one `decryptMnemonic`, no per-account `decrypt` |

What did not change: the check (`previewImport`) and the import itself, the password step, the one PEM file kept per
imported team, the Guardian refusal. The team name is player-written text: it reaches only the dashboard, as text
(`textContent`), never a prompt.

Stays open:
- FoxLeague sees the 20 addresses of a search asked together (R88A-3): the owner who minds types the account number.
- A team on an account past 999 is not found (the account number stops there too).
- The list shows the team name only; its overall, balances and Guardian come with the Check of the chosen account.

## GitHub review of PR #83 (2026-11-20)

PR #83 drew the launch media again from `ae5421e`: the installer's credit line ("$10, about two weeks"), the three
install videos and the site's screenshots. It closes two items the section "Haiku 5.5 at high, the AI of a new install
(2026-11-20)" left open: the credit line and the old Strategist box in the videos and the screenshots. The agent review
passed it with three low findings and no code of the agent in the change. R83A-1 has a test of the same name in
`test/install-videos.test.ts` that failed on the branch at cf14179 (on the empty lines, then on the two texts once the
empty lines were right) and passes now. The second review found two more of the same kind (R83A-3), held by the same test.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| R83A-1 | low (agent review of PR #83; hygiene, nothing a video shows) | Five line hints of `site/scripts/videos/src/text.mjs` named lines the videos do not show. The quote check finds a line by its text, so the three empty lines around the recovery words (`info ""`) matched any line and kept their old numbers (507, 516 and 518, lines of the systemd unit today). "Ready?" and "Ubuntu is installed and has a user of its own." stand twice in `get.ps1` and matched the occurrence nearest their old numbers: the other branch. The check said 0 moved | The hints name `install.sh` 889, 898 and 900 and `get.ps1` 977 and 993. The test holds every hint on a line that has its text, every empty quote on an `info ""` of `install.sh` and the two texts on the branch the video plays (the Ubuntu install). The README's table of quotes follows |
| R83A-2 | low (agent review of PR #83; a picture) | `agent-page.png` showed the lower half of Settings and an empty left column: the script scrolled the end of the settings form into view, which is taller than the column beside it. The site's caption says "An agent's plan, budget and settings" | `site/scripts/screenshots.ts` takes this one shot from the top of the page in a window 1700 pixels tall and sets the window back for the shots after it: the plan, the budget and the settings are in one picture. No test reads a picture: it was looked at, as the README of the videos says for a frame |
| R83A-3 | low (second agent review of PR #83; hygiene, nothing a video shows) | Two more hints matched a line that only holds their words: `say(1043, '7/7 Background service')` named the `--no-service` title ("7/7 Background service: skipped (--no-service)") and `psStep(1177, 'Done')` named `function Step-FoxDone`. R83A-1's test asked only that the line holds the text | The hints name `install.sh` 1052 and `get.ps1` 1179. R83A-1's test now also holds every step title of `install.sh` (`say`) and every line of `get.ps1` on the line that prints the whole text as one string; it failed on 4fe1ed6 for each of the two and passes now |

Stays open:
- The quote check itself still matches an empty quote anywhere; the test above holds the hints instead.
- Production was not read for this pull request and nothing was deployed: the site is published after the merge.

## FoxLeague of 21 Nov (2026-11-21)

The running agent alerted at 20:50 UTC that FoxLeague's manual changed (nine pages) and that two routes it calls
changed shape: FoxLeague promoted its release branch into `origin/main` (#806, `5eecea2aa`, manual `237984579`). The
routes are the statistics of a match, which gained `injuries` (#801); the agent reads only both formations and both
elevens there. The pages carry what SYNC-2 already acts on (#752, a card in an auction takes no paid action and is not
trained; #764, account bans) and screens of the app. FoxLeague's server changes since SYNC-2 read the release branch
(#792, #795, #796, #801, #802) touch no route the agent sends to. The game settings keys are unchanged.

The fix is by Claude Opus 5.5, test first: `test/sync-1121/SYNC-3.test.ts` failed on `6fb2ced` for the reason given
(each SYNC3-1 test, one per check; SYNC3-2 on the copy of 19 Nov) and passes now. The GitHub review of PR #87 (Claude
Fable 5.2 at high effort, PASS) found two lows: their tests (the two sync tests; the waiver and listing counts and ranks,
now one test each) failed on `f158a31` or `6fb2ced` and pass now.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| SYNC3-1 | low (rule 4; no refusal on a normal day: FoxLeague's API description requires `listed_for_sale` on every card) | SYNC-2 made the four card Shop items refuse a card whose auction state the roster did not give. The other checks in `rules.ts` still read such a card as in the wallet: `train`, the squad a paid match or entry is played with (`squadLegal`), a saved eleven (`lineupVerdict`), a fusion's three cards, the cards a fusion or a listing leaves toward 18, a `sync` and a `list_card` | One helper, `listedRefusal`: a card known not to be listed passes, a listed one keeps "#N is listed for sale", an unread one is refused with "whether #N is in an auction (listed for sale) could not be read: not acting blind". The counts toward 18 and a sync's cards count only a card known not to be listed |
| SYNC3-2 | low (the manual check warned on every plan) | The agents' manual copy and the route record were FoxLeague's of 19 Nov | Synced to `237984579` (16 pages, nine changed) with the two new route shapes; SYNC2-5 no longer pins the commit, SYNC3-2 does. The copy grew by 4 KB: the rules and the manual are about 111,700 tokens by the measured ratio, more than 5 percent above the 105,000 the five places stated (DOCS-4 failed on the synced copy), restated as about 112,000. The cost of a plan and of a day at the defaults ($0.10, $0.60) still holds |
| R87A-1 | low (rule 4, a wrong reason; no money moves: `checkedSync` throws before anything is booked) | `sync` left an unread dirty card out instead of refusing: `sync` of that card said "#N has nothing to sync" (that it was clean); a whole-wallet sync passed the rules at the known cards' fee; `applyEffect` still marked an unread card synced in the working snapshot | A sync that names a dirty card whose auction state was not read is refused with that reason; a listed one is left out as before. `applyEffect` marks only cards known not to be listed as synced |
| R87A-2 | low (tests) | The changed counts in `fusionBlocked`, `listingBlocked` and `list_card` (the cards left toward 18 and the strongest-18 rank) had no test that failed before the fix; SYNC3-1 was one test of seven cases | One test per check: train, squad, eleven, fusion inputs and count, the cooldown waiver's peers and count, the Legendary match waiver's count and rank, the listing, its count and rank, the sync and its effect |

Stays open:
- The busy-card rule of #748 is still off (its switch waits for FoxLeague's Terms); the agent has no rule of its own for
  it until the switch appears in `/api/config`.

## The owner's release key (2026-11-20)

Before the public release the owner made the release key on their own computer with `node scripts/release/release.ts
keygen` and a passphrase only they know. The private half is in `~/.config/foxleague-agent/release-key.pem` on that
computer (the guide asks for one offline backup); it was never shown to this session, to GitHub or to a server. The public half the tool
printed is pinned in `src/update/keys.ts`. The test `test/release-key/KEY-1.test.ts` failed on 176c6b4 (no key pinned)
and passes now.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| KEY-1 | launch (the owner, 2026-11-20) | `RELEASE_KEYS` was empty: an agent built from this tree refused every in-app update (fail closed). The release tool refuses to build a release whose tag pins no key, so no release could be signed | The owner's Ed25519 public key is the one entry of `RELEASE_KEYS`. The test holds exactly one Ed25519 public key, the same one the release tool reads from the file. No private key is in it |

Stays open:
- The key reaches installed agents with the first release that pins it (v1.0.0): an install of an earlier internal
  version has no key and takes no update from its dashboard; it updates by pasting the install line again.
- Rotating the key follows `docs/RELEASING.md` ("Rotating the key"): the new key goes in a release signed with this one.

## The public release, v1.0.0 (2026-11-23)

The pull request that makes the repository ready to be public, prepared on 2026-11-20 and merged on launch day. It
does DOCS-11's launch-day items. `test/launch-v1/LAUNCH-1.test.ts` failed on 50942e7 for each of them and passes now. R85A-1
is the finding of its agent review.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| LAUNCH-1 | launch (the owner, 2026-11-20) | Before the public release the site wrapped the install line in a "Coming soon" frame with a banner on five pages, its GitHub icon opened Foxsy AI's page instead of the repository, the README said "in internal testing" and the version was 0.11.0 | Version 1.0.0 in `package.json` and both places of `package-lock.json`. No banner or frame on any page; the frame's component is gone. The home page, "Run it on a server" and the GitHub icon link the repository. The FAQ answers "Is it open source?" (Apache License 2.0, PR #86). The README says "Status: released". The site's screenshots are taken again for the new version label. The line hints of the install videos follow the pages (0 moved) |
| R85A-1 | medium (agent review of PR #85; the release process, not a money path) | With the tree at 1.0.0, the fresh install check's first throwaway release, also 1.0.0, wrote its files back unchanged: `git commit` had nothing to commit and the check stopped at its step 2 ("the release could not be built"). The recipe of `docs/WINDOWS-TEST.md` uses the same tool | `mkrel.ts` in `scripts/release/fresh-install-check.sh` commits with `--allow-empty`, so a release of the version the tree has can be tagged. `test/launch-v1/FIC-1.test.ts` runs the tool as the script writes it, without Docker; it failed on 4948c2e ("nothing to commit") and passes now |
| R85A-2 | low (re-review of PR #85; the tests) | `FIC-1`, `LAUNCH-1` and `docs-record` pinned the version 1.0.0: the version pull request of the next release would fail them. Once edited, `FIC-1` would no longer cover the empty commit | `FIC-1` builds the version the tree has; `LAUNCH-1` and `docs-record` hold a version of 1.0.0 or later, the same in `package.json` and both places of `package-lock.json`. Checked with the tree set to 1.0.1 for a moment: the three pass and `FIC-1` still fails without `--allow-empty` |

Updated on 2026-11-22, after #87 to #89 reached `main` and the owner's test of the release candidate passed (Find my
team, Import by words and by PEM file, Remove, Retire and Restore): `main` merged in; the twelve screenshots taken again
(V1.0.0, the new AI key steps, the $0.80 cost line and the new texts) with a new one of Find my team
(`import-team-find.png`, on the import page, taken by `site/scripts/screenshots.ts` on throwaway words); the three install
videos rendered again, since the installer's AI key line changed (APIKEY-1; its number and every quote stay, 132 quoted
lines, 0 changed). The release notes name Find my team, the bid rule and the $0.80 a day.

Stays open:
- The release itself follows `docs/RELEASING.md`: this commit runs on the owner's server first, then the tag v1.0.0, the
  release built and signed with the owner's key (KEY-1) and published as the latest, the site from the same commit
  and an install from the release on a clean machine.
- The repository is made public by the owner on GitHub. Nothing in this pull request changes who can push or merge.
- Production was not read for this pull request and nothing was deployed.

## Pre-release audit (2026-11-22)

Before v1.0.0 five Claude Fable 5.2 reviewers at high effort, read-only and one area each (MONEY, LIFECYCLE, ATTACK,
INTEGRATION, RELEASE), went through `a7e5668..6b54f42` and the older code it rests on. The branch moved to `9d6abf3`
while they read (screenshots, videos, docs and one test; nothing under `src/`). None found a critical or a high finding:
one medium (INT-1) and thirteen lows (ATK-3 and REL-3 are the same history); MONEY proved nothing (about 200,000
random bids, 100,000 random schedules and every call of eight live flows failing in turn left no wrong booking or
signature). The owner decided to fix all of them before the release, except ATK-3 and REL-3, which the owner
accepted. The fixes are by Claude Opus 5.5 at extra-high effort, test first: each test in `test/audit-1122/` is named
after its finding, failed on `9d6abf3` for the reason the report gives and passes now. A case that holds right
behaviour (a control, an unread roster, a 401, the helper of REL-2) passed before too and says so in its name or
comment.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| INT-1 | medium (a forfeit 3-0 and the full K; nothing paid wrongly) | FoxLeague's own-session roster leaves out every card the marketplace contract holds (`roster_chain_view.rs`), so a card of the saved 18 the owner put in an auction came as no card at all: the MNT-4 line "LISTED IN YOUR 18" and the "In an auction" line never fired. The executor refused every match ("#15 in the squad is not in the wallet"), but the plan was never told to save a new 18, so the next locked tournament or 1v1 match was forfeited. The site page and two docs promised the line | When the roster was read, the snapshot names in one capital line every card of the saved lineup and bench it leaves out (sold, sent away or in an auction), with the forfeit and "save an 18 without it". An unread roster names none (rule 4). MNT-4's test uses the real state (the card left out) and keeps FoxLeague's fallback roster (a listed card) as a second case; `how-it-plays.md`, ECONOMY-AND-RULES and FOXLEAGUE-INTEGRATION corrected |
| INT-2 | low (information only) | The planning snapshot took the ELO pair meetings without reading the answer's `live`; FoxLeague answers `live: false, meetings: 0` when its own read of the switch fails; the plan read "0 of 3 ELO meetings today" | Only an answer whose `live` is true is a count; any other is unknown, as an unread one |
| INT-3 | low (information only; the leave rule reads the detail) | `participant_count` is null in `/tournaments/my` rows. BEH-2's seated set (`service.ts`) and the "seats locked" note of a joined tournament (`digest.ts`) read it there only: a taken targeted 1v1 read "0 accepted" and the note never printed | Both take the count from the public list row when the row has none, as `own-tournaments.ts` already did |
| ATK-1 | low (the log; no money path) | A request whose body was cut short (a client that reaches the port itself and closes the connection) ended as a 500 with "web UI error: Error: aborted" and its stack in the service log, once a request; `POST /login` reads its body before any password is weighed | `readBody` turns a stream error into a fixed 400 ("request cut short"), which is not logged; the 413 stays |
| ATK-2 | low (needs someone on the owner's network path) | The nginx template's 443 block sent no `Strict-Transport-Security`: a dashboard name typed without `https://` asked port 80 in clear, where a copy of the sign-in page could take the password | The 443 block sends `Strict-Transport-Security "max-age=31536000" always`; `docs/SERVER.md` tells the owner of a server set up from the older template to add the line. No server was touched |
| REL-1 | low (an agent down after a restart, without a word; the class of INS-A6) | An update's `install.sh --prepare` runs on the agent's own Node.js and rewrote `.node-path` to that one path, dropping the path the owner's shell found Node.js at: after a later `brew upgrade` (or snap refresh) the launcher found no Node.js | In `--prepare`, `.node-path` stays as it is when its first existing path passes `node_ok`; one that is gone or fails the release's Node.js rule is written again. Changed in place: the install videos' 132 quoted lines stand (0 changed, 0 moved) |
| REL-2 | low (the owner's rule DOCS-11c) | `test/audit-1111/docs-11c.test.ts` held the words it guards against (the first numbers of both server addresses, the owner's dashboard domain word, the deploy user, the hosting and the private project names) and left itself out of its own search; `test/` is packed into every release | The check hashes the words of each tracked text file (their dotted and dashed runs, the starts of addresses, the user names) and compares SHA-256 digests (`test/audit-1122/private-names.ts`); a hit is told by file, line and the start of its digest (never by the word). The file no longer leaves itself out |
| LIFE-1 | low (medium if Anthropic answers 403 for one model) | Every 403 counted as an account stop for the whole install: with a model per agent, a 403 for one agent's own model made it the prober, which renewed the stop at each tick, so the agents on other models never planned; the alert pointed to Keys or credit | A 403 keeps the prober's model and effort in the stop: only agents whose plan uses that model wait, only a plan on it ends the stop and the alert names it ("the API key may not use that model or the account refuses it"). A 401 or a billing, credit or limit error stays an account stop for every agent (P10) |
| LIFE-2 | low (each step was still checked on a fresh snapshot) | A plan that waited through Remove (or Retire) could run its next action after the team was imported again (or restored) under the same number and resumed | A per-agent generation, raised by Remove and Retire, read by `runPlan` at its start, before each step and after each step's snapshot: a changed value ends the plan quietly |
| LIFE-3 | low | `pause()` added its abort listener after the stop signal had fired, so a stop during a tick's snapshot still paid for the plan and `stop()` waited its full 150 s; each pause left its listener behind | `pause()` returns at once once the stop began and removes its listener when its timer fires; `tick()` returns after its snapshot (and again before the model call) while stopping |
| LIFE-4 | low (older code) | Telegram `/do N <words>` answered "planning ..." while paused, under the kill switch or with a plan running; the refusal was dropped. The loud wrapper removed the number from `loud` even when it had not added it, so a `/do` silenced a running `/tick` plan | `/do` in words answers `tickRefusal` first; the wrapper removes only what it added |
| LIFE-5 | low (older code, the CLI) | `./cli.sh address N` printed account N of the recovery words for an imported team's number (an owner funding it would send to a wallet no agent uses); `snapshot N` and `export-pem N` used the install's own account for a removed imported team's number | `address` prints an imported team's own address from the database; `address`, `snapshot` (and every `walletOf`) and `export-pem` refuse a removed imported team's number, as the service's `wallet()` does since R89A-12 |
| SHOT-FIND | low (ATTACK's note; nothing exposed) | `site/scripts/screenshots.ts` filled the words box of Find my team with 24 valid throwaway recovery words; `import-team-find.png` showed them on the public site | The box shows "example words only never use these as recovery words", which is no recovery phrase; the list's addresses still come from throwaway words never shown. The screenshots were taken again and only `import-team-find.png` kept |
| ATK-3 / REL-3 | low (owner's decision: accepted) | The git history (about 370 commits before `a681eaf`) and the tags `v0.10.0` and `v0.11.0` still hold what DOCS-11 (c) took out of the tree: the website server's address, its deploy user, another site on it and three project names. No secret: every ref was searched for keys, tokens, recovery words and password hashes | None: the owner publishes the repository with its history (see below) |

Stays open:
- ATK-3 / REL-3, accepted by the owner: making the repository public publishes its whole history and the tags
  `v0.10.0` and `v0.11.0`, with the website server's address, its deploy user and three project names. No secret.
- What MONEY could not prove from the code (no network by the rules of the review; the code fails closed on another
  answer): that the gateway's block timestamp stops advancing on a halted shard (HALT-1); that FoxLeague plays one
  match of a whole tournament per round interval (MNT-1); FoxLeague's rounding of the MetaStaking Shop price, live
  from 1 Dec (MNT-2).
- The release archive ships `test/`, `.github/`, `docs/` and `deploy/` by design: `.gitattributes` leaves out `site/`
  only (`docs/RELEASING.md`). Nothing in them is secret since REL-2.
- REL-2's digests hide the words from a reader, not from someone who tries every value: the two-number start of an
  address and a short user name can be found that way, the project and domain words only by guessing them.
- Two more readers of the seat count of `/tournaments/my` rows, not named by INT-3, still find none: `ownUnanswered`
  (`deadlines.ts`, which counts an own 1v1 with no count as not taken on purpose: a leave is never late) and the
  scouting gate `ownTaken` (`snapshot.ts`), which keeps scouting 1v1s while one of the agent's own is taken.
- Production was not read for this work and nothing was deployed.

## One manager message at a time (2026-11-13)

What stayed open after PR #67, fixed on the owner's word. Each finding has a test of the same name in
`test/chat-send.test.ts` (CO-3 is wording in `test/repeat-shadow.test.ts`) that failed on `main` at 3e881bf for the
reason given and passes now. R68A-1 comes from the agent review of PR #68; its test failed on the branch at e666c42,
before its fix. R68A-2 comes from its re-review: its test fails when the condition it pins is taken out of the code.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| CO-1 | low (cost; the owner, 2026-11-13) | The server accepted a second manager message while one was being answered: `Service.discuss` had no guard, so a message from Telegram, an open page of the version before or a request made by hand paid for a second answer. The test saw a Telegram message sent to the model while a web message was still answered | While the conversation (one for all agents) holds an owner's message still being answered, `discuss` turns another one away with `ChatBusyError` ("The manager is still answering the last message. Send this one when its answer is in.") before the line is said or the model is asked. The check comes before anything is awaited, so two messages that arrive together cannot both pass. The web route answers 409 with that reason; the page keeps the status of a refused request, gives the message back with the reason and keeps Send off while the other one is answered (a 409 is final: the server holds nothing of it, whatever an earlier message with the same words does). Telegram replies with the reason instead of "error: ...". An answer, a failed answer (its line is taken out) and Clear let the next message through; a waiting line is never saved, so a restart holds nothing. `/ask` is not the conversation and is answered meanwhile |
| CO-2 | low (cost; re-review of PR #67) | A failed Send whose answer had been written meanwhile came back with a red error. The owner sends a message, the laptop sleeps or the network drops, the server finishes and books the answer, the page wakes and the POST fails: the message was put back, the next refresh turned Send on and a second Send paid twice. The test saw the answered message given back | Before the POST the page keeps the time of the newest line it has, by the server's own clock (`at`, ISO strings compared as text, no page clock). After a failed Send it reads the state and looks for this very message from the web box: still being answered, it stays out of the box as before (R67A-2); answered after that time, it stays out and a toast says the answer is in the conversation; otherwise it comes back with its error. When the state cannot be read either, the message comes back, Send stays off and the first state that can be read settles it: held or answered by then, the box is emptied if it still holds exactly that message, and a toast says which |
| CO-3 | hygiene (re-review of PR #67) | The title and two comments of RS-4 still said that `same` never rests, so no switch starts it; that holds between the models of the list only (R67A-1) | Reworded; its checks are unchanged |
| R68A-1 | low (agent review of PR #68) | CO-1 made a waiting line that is never released a lock. The booking of an answer's cost (`addModelUsd`, a write to SQLite) ran outside the `try` and before the line stopped waiting: when the database refused it (a full disk, a lock held past the 5-second busy timeout by `cli plan N` or `cli dry-run N`), `discuss` failed (web 502, Telegram "error: ..."), the line stayed waiting and every later message was turned away as "still answering" until Clear or a restart. Saving the message's own line could leave it waiting the same way. The test saw the next Telegram message turned away after a refused booking | Every way out of `discuss` now releases the waiting line (`finally`, while no Clear came in between; then only this call's line can be waiting). The answer's cost is booked first and a refused booking no longer fails the answer: it goes to the owner and stays in the conversation. The log says which cost could not be booked, why and where it is missing: from the total and the day's figure, or only from the day's figure when the total was written first (the re-review of PR #68). When the database refuses to save the message or the answer, the call fails as before but releases the line; an answer that was written stays in the conversation and its cost is booked. The test runs each of the three with the next message on the web and on Telegram |
| R68A-2 | low (missing test; re-review of PR #68) | No test failed when the condition "no Clear came in between" was taken out of the new `finally`. It is what keeps an answer that comes or fails after Clear from releasing the next message's waiting line: A is being answered, Clear, B is sent and waits, A's answer comes or fails. Without it A's way out took B's line away. A third message then passed the one-at-a-time rule while B was still being answered and paid for. B's answer came in with no question above it | A test of both cases (A answered and A failed after Clear): B is still waiting, one more message is turned away without asking the model and B's answer comes in under its own question. Seen failing with the condition taken out ("B is still waiting for its answer": none was), passing with it. Two notes of the same review are fixed too. The comment above `chatAnswering()` in the page no longer says that the server takes a second message. The log line of a refused booking says where the cost is missing |

What was checked and needs no change:
- `Service.discuss` has two callers, the web route and Telegram's plain messages; both handle the refusal. Nothing else
  starts a manager answer. `/ask` and the plans use the strategist directly and are not refused.
- Clear empties the conversation, the waiting line with it: the next message goes through while the earlier answer is
  still written (it is not put back into the new conversation, as before).
- The live server's nginx waits 1080 seconds since 13 Nov 2026, raised by the owner's word: the open item of XROOM-2
  is done there.

Stays open:
- A message turned away is not kept to be sent later: the owner sends it again when the answer is in.
- After Clear the answer that was on its way is still written and paid for, and the next message is let through, so
  two answers can be paid for at once then. Clear is the owner's own act.
- CO-2 tells this message by its words and its web source: two tabs that send the very same words can be taken for
  each other. When the conversation was cleared or the line left the 100 kept before the page could read it again,
  the page cannot tell, and the message comes back with its error.
- The refusal holds in the service's memory, one conversation per install. Two services on one database are not
  supported and would each have their own.
- A cost the database refused to book is said in the log only (`journalctl -u foxleague-agent`): it is missing from
  the AI spend total and the day's figure, or from the day's figure only, and is not booked again later. The AI spend is not the ledger of the FOXSY and EGLD caps, so no
  cap misses it.
