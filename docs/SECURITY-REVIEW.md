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

## Where the limits live

`src/executor/rules.ts` (the constants at the top: `MAX_1V1_ELO_GAP`, `MAX_1V1_PER_OPPONENT_WEEK`,
`MAX_BIDS_PER_AUCTION`, `MAX_INHERITED_LOCK_HOURS`, `MIN_RESERVE_FOXSY`, `CORE_CARDS`, `XP_BOOSTER_RENEW_HOURS`), `src/executor/executor.ts`
(per-agent lock, booking before signing, swap allowance, price valuation), `src/executor/tx.ts` (`syncTx`),
`src/chain/gateway.ts` (EGLD price band), `src/snapshot/digest.ts` (`txt`), `src/telegram/telegram.ts`,
`src/web/server.ts` and `src/web/auth.ts`.
