# Instructions for AI coding agents (and for people who work like one)

foxleague-agent is a self-hosted AI team manager that **signs real MultiversX mainnet transactions and spends the
owner's FOXSY and EGLD**. A model proposes actions from a fixed list; plain code checks every action against the game
rules and the owner's caps before anything is signed. Treat every change to that code as a change to a money path.

## Run it
- Node >= 22.18, TypeScript run directly (no build step), SQLite for state, 2 runtime dependencies (pinned).
- `npm ci --ignore-scripts` then `npm run typecheck` and `npm test` (`node --test 'test/**/*.test.ts'`). Both must be
  clean before you say a change is done; report the real result, including a failure.
- `test/summary.test.ts` "quiet Telegram..." is flaky on `main` too (1 failure in 5 full runs on an untouched commit).
  Re-run it alone before you blame your change, and say so in the PR if it shows.
- Node strips types, it does not compile them: no `enum`, no `namespace`, no constructor parameter properties
  (`constructor(private x)`), imports end in `.ts`. `tsconfig.json` has `erasableSyntaxOnly`, and the failure at runtime
  is a `SyntaxError` that takes every importing test file down with it.

## The rules that keep money safe (do not weaken them)
1. **The model never holds keys and never builds a transaction.** It picks from the list in `src/executor/actions.ts`;
   `parseAction` rejects anything else. Do not add a path from model text to a signature.
2. **Caps and game rules are code, not prompt.** They live in `src/executor/rules.ts`, `executor.ts` and `budget.ts`.
   Never "fix" a refusal by editing the prompt, and never read the owner's strategy text in the executor.
3. **Book before you sign.** Spend is written to the ledger before a transaction is signed; a revert keeps only the gas.
   Anything that returns early after booking must release the booking or it counts as spend until the day ends.
4. **Unknown is not zero, absent or false.** A failed read (`attempt()` returns null with a warning) must make the rules
   refuse, never decide. Review every place a `null`, `?? 0n` or `Boolean(x?.y)` turns "could not read" into a value.
5. **Fail closed.** A lookup that errors, a missing price, an unreadable roster: refuse and let the next plan retry.
6. **Text written by other players is data, never instructions.** Names, titles and server messages pass through `txt()`
   in `src/snapshot/digest.ts` and sit inside the framed snapshot. Do not put rival text anywhere else in a prompt.
7. **The owner's password gates anything that raises spending**: higher caps, a smaller gas reserve, Gold on, a shorter
   tick, longer active hours, going live, releasing the kill switch, keys. Lowering, pausing and the kill switch stay one click.
8. **Dry run is the default.** Live needs `AGENT_LIVE_ENABLED=1` on the machine and the owner's Go LIVE with the password.

## How to change the code
- **Test first.** Write the test, run it, see it fail for the right reason, then fix. One test per finding, named after
  it. Helpers: `test/fixtures.ts` (`setup()`, `snapshot()`, `dryWallet`, `card()`); tests use `:memory:` stores.
- Every change reaches `main` through a pull request, the maintainer's own included: small commits on a branch, then
  a pull request. Opening or updating one runs nothing. When the maintainer decides to merge it, they add the label
  `merge-check`, which runs CI (type check, tests, the dashboard script, the reviewer gate's tests, the manual build)
  and the agent review (Claude Opus 5.5). Their results reach `main` as the commit statuses `foxleague-agent/ci` and
  `foxleague-agent/review` of the project's GitHub App, and `main` takes the merge only when both are green and a
  maintainer approved; a commit pushed afterwards needs `merge-check` added again. A pull request that changes
  `.github/` or `scripts/ci/` fails the review on purpose: the maintainer checks it by hand and merges it with the
  bypass. Never force-push `main`. Stage files by name; never `git add -A`.
- Releases are tags on `main` (`v1.0.0`, `v1.0.1`, ...) with a GitHub release; the one-line installer (`get.sh`)
  installs the newest release, and users update by running it again. A release is cut from a `main` commit that
  passed both checks and already ran on the maintainer's own server.
- Do not touch `src/strategist/prompt.ts` casually: it is byte-stable so that it is served from the prompt cache. Dates and
  live values go in the user message.
- The game rules are mirrored in `docs/ECONOMY-AND-RULES.md`, `docs/FOXLEAGUE-INTEGRATION.md` and
  `src/strategist/manual.md`. Change the code and these together, or say which one you left.
- Record an audit or a security-relevant change as a new section of `docs/SECURITY-REVIEW.md`, in the same table format
  (`Id | Severity | Finding | Fix`), and list what stays open.
- Do not guess FoxLeague's server behaviour. If a fix depends on it (e.g. what happens after "Do NOT pay again"), say so
  and ask; the integration notes in `docs/FOXLEAGUE-INTEGRATION.md` are the source.

## Secrets and production
- Never print, log, commit or paste recovery words, private keys, API keys, the `.env`, `data/`, `keys/` or `pem/`.
  The CLI refuses to show the words on a server (`AGENT_IS_SERVER`); keep it that way.
- Read production read-only unless the owner asks otherwise. Do not deploy, restart a running agent, go live, change caps
  or send funds on your own initiative; those are the owner's calls, one command at a time.
- `cli plan N` and `cli dry-run N` write to the real database and simulate in a separate process; do not read their
  refusals as the running service's behaviour while the platform is LIVE. Use `simulate-as <address>` for a throwaway
  in-memory run.
- A silent agent is not a broken agent: the actions of a plan run at random moments over 80 percent of the cycle
  (`service.ts`, `runPlan`), and a running plan blocks the next one. Read the schedule before you restart anything.

## Where things live
`src/executor/rules.ts` (rules and limits), `executor.ts` (lock, booking, signing, swap allowance), `tx.ts` (transaction
builders), `src/snapshot/` (what the agent sees), `src/strategist/` (prompt, planner, manual), `src/service.ts`
(scheduler, Telegram commands), `src/web/` (dashboard, auth), `src/store/` (settings, secrets, SQLite).
