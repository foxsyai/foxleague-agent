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
| P5-6 | low | A file renamed out of .github/ or scripts/ci/ escaped the hand check | git diff --no-renames |

Settings that go with it: the ruleset "main: changes through a pull request" requires foxleague-agent/ci and
foxleague-agent/review from the App FoxLeague Agent Checks (id 5301257); the App's key is a secret of the environment
"checks" (deployment branches: main only) and nowhere else; the App may only write commit statuses.

Open: someone with write access could still create a branch whose own ci.yml passes and open a fork pull request
into main from a head that also has that branch's run, which the fork path above cannot tell apart; the maintainer's
approval of every pull request by others is the gate for that. When the repository goes public, outside contributors'
workflows need the maintainer's approval to run (set on launch day).

## xExchange paused every pool, 2026-10-13

At 10:39 UTC xExchange's router admin paused about 700 pairs, FOXSY/WEGLD among them (swaps fail with "Swap is not
enabled"). The agent read no FOXSY price from a paused pair, so every paid action of every agent was refused.

| Id | Severity | Finding | Fix |
|---|---|---|---|
| XP1 | medium | A paused pair left the snapshot without prices: no entry, sync or shop payment, even with FOXSY held | A paused pair cannot trade, so its reserves hold the last price: FOXSY is valued at it (still the higher of spot and the two-day median), swaps are refused with a plain reason and the plan is told (PR #3) |
| XP2 | low | Sampling the frozen price into the two-day median would let a price moved just before the pause set the caps after about a day | No samples while the pair is paused (agent review of PR #3) |

## Where the limits live

`src/executor/rules.ts` (the constants at the top: `MAX_1V1_ELO_GAP`, `MAX_1V1_PER_OPPONENT_WEEK`,
`MAX_BIDS_PER_AUCTION`, `MAX_INHERITED_LOCK_HOURS`, `MIN_RESERVE_FOXSY`, `CORE_CARDS`), `src/executor/executor.ts`
(per-agent lock, booking before signing, swap allowance, price valuation), `src/executor/tx.ts` (`syncTx`),
`src/chain/gateway.ts` (EGLD price band), `src/snapshot/digest.ts` (`txt`), `src/telegram/telegram.ts`,
`src/web/server.ts` and `src/web/auth.ts`.
