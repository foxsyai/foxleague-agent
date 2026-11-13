---
title: Talk to your manager
description: Ask the agent questions and change its strategy in plain words, from the dashboard or Telegram.
---

You steer the agent the way you would talk to a coach: in plain words.

## In the dashboard

Each agent's page has a **Talk to the manager** box. Write a question or advice:

- *"Why did you skip the Gold tournament today?"* gets an answer.
- *"This week focus on Silver tournaments, no boosters"* comes back as the complete revised strategy, with
  **Apply** and **Cancel**. Nothing changes until you press Apply.

Name other agents to include them: *"all agents"*, *"agent 2"* (*"team 2"* works too). The chat can change only the strategy text, never your
limits, dry run or live, pause, the kill switch or the model.

![Talk to the manager: your messages on the right, the manager's answers on the left](/screenshots/talk-to-the-manager.png)

The box keeps the conversation like a chat: your messages on the right, the manager's answers on the left, up
to 100 messages, together with the ones you sent on Telegram. A proposed strategy waits under the conversation
with **Apply** and **Cancel**, also when it was proposed on Telegram. **Ctrl+Enter** sends. While the manager is
answering, **Send** waits: the answer is written and paid for even when the page loses the connection, so a second
Send would pay twice. Send comes back when the answer is in the box. The manager answers one message at a time: one
sent meanwhile, from Telegram or another tab, is turned away with that reason and costs nothing. Send it again when
the answer is in. If the page lost the connection and the answer came meanwhile, the answer shows in the conversation
and your message does not come back into the box.

### What the manager remembers

The manager reads the **current conversation** with every message you send, so a follow-up question needs no
repeating. A conversation ends by itself after **an hour without a message**: your next message then starts a
new one. It never reads more than the last 50 messages (about 25 of yours with their answers). A thin line in the box shows where its memory starts;
what is above stays there for you to read back.

There is one conversation for all your agents, the same one on every agent's page and on Telegram: you have one
manager for all your teams. A message sent from an agent's page is about that agent unless you name others, and
the manager is told which agent each earlier message was about.

**Clear** (on Telegram: `/clear`) empties the conversation at once. Use it when you change the subject: the AI is
paid for what it reads, so a short conversation costs less and keeps the answers on the topic. One line costs a
fraction of a cent, so it counts in long discussions and with the dearer models. Clear drops a proposal that is
still waiting in the conversation; your strategies, settings and history are not touched.

### Speak instead of typing

Press **Speak** next to **Send** and talk: your words appear in the box. Press **Stop** when you are done, read
the text, correct it if needed and press **Send**. Nothing reaches the manager until you press Send.

Your browser turns the speech into text and asks for the microphone the first time. In Chrome, Edge and Safari
the sound goes to the browser maker's speech service for that. It listens in one language at a time: with several
languages set in your browser, pick the one you speak in the list next to the button. Browsers without speech to
text (Firefox) do not show the button.

## On Telegram

Once Telegram is linked ([Your keys](/start/keys/)), you get a **summary every morning** (09:00 by default) with
yesterday per agent: what it did, what it spent, its rating and what its wallet is worth. Plans and action results
wait for it, so many agents never flood your chat; `/updates all` sends every update as it happens again, and
`/updates daily` goes back. A low-funds warning waits for the summary too, unless it comes with a top-up proposal.
What you ask for yourself (`/do`, `/tick`) answers at once. Urgent messages always come at once: the kill switch, an internal error, a change of
mode or keys, plans failing for a problem with the AI account (its key, credit or limits) or three times in a row
for one agent, a payment whose outcome is unclear, top-up codes and a League + Knockout invitation. Any plain message goes to your manager, with the same Apply and Cancel buttons. While the manager is still answering an earlier message, it replies that it is and nothing is paid for: send yours again when the answer is in. Commands (agents are numbered from 1: `/pause 2` pauses agent 2):

| Command | What it does |
|---|---|
| `/status` | This install and every agent at a glance (retired agents in one line) |
| `/agents` | Balances and today's spend |
| `/plan [N]` | The latest plan |
| `/tick N` | Plan and run now, inside the agent's active hours (outside them it says so; `/do N request` runs anyway) |
| `/pause [N\|all]`, `/resume [N\|all]` | Pause or resume one agent or all |
| `/mode dry`, `/mode live confirm` | One mode for all agents |
| `/budget [N]` | Spend against the limits |
| `/ask [N] question` | A question to the manager about the team |
| `/strategy [N\|all]` | Show the strategy |
| `/strategy N\|all <preset or text>` | Replace it directly (presets: steady, climber, hunter, predator, beast, zeus). The limits stay as they are: set the level's limits in the dashboard |
| `/clear` | Start a new conversation with the manager |
| `/kill on\|off` | Stop every agent at once, or release |
| `/summary [today]` | Yesterday per agent, or today so far |
| `/updates [daily\|all]` | Daily: plans and action results wait for the morning summary; all: every update as it happens |
| `/topup N` | Propose an EGLD top-up from Binance for agent N, with a one-time code |
| `/topup <code> [EGLD]` | Approve it (with a smaller amount after the code, that much instead; more than proposed is refused) |
| `/help` | The full list |

Your Telegram bot answers only your own chat and ignores everyone else.
