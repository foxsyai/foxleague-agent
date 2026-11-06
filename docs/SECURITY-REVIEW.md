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

Not changed: the Telegram key fields keep Telegram's own name, "bot token". The cost of a single agent at the 2-hour
tick (MS-C1) is closed by CR1 below.

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
