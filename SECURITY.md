# Security

The FoxLeague Agent signs real MultiversX transactions with its owner's keys, so a security hole matters to every
owner. Thank you for telling us about one.

## Report it privately

Do not open a public issue. Use GitHub's private report instead:
[Report a vulnerability](https://github.com/foxsyai/foxleague-agent/security/advisories/new) (the Security tab of
this repository). Only the maintainers see it.

Tell us what you found, how to see it happen and which version you ran. Never send recovery words, keys or a `.env`
that are in use. If one of yours may have leaked, move the funds to a new wallet first.

Every fix comes with a test that fails before it and passes after it. It reaches owners as a signed release.

## Versions

Fixes go into the newest release. An installed agent offers it in the dashboard (Update now) and on Telegram
(`/upgrade`).

## What counts

- A way to make the agent pay past its owner's limits or sign without them.
- A way to read recovery words, keys or the dashboard password.
- A way for text written by other players to steer the agent.

Not a security hole: a game result, a choice the AI made inside the limits or a problem of FoxLeague's own servers
(tell FoxLeague). For those, [report a problem](https://github.com/foxsyai/foxleague-agent/issues/new/choose) or ask
in the [Foxsy AI community on Telegram](https://t.me/foxsyai).
