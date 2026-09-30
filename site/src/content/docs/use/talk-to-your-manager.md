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
with **Apply** and **Cancel**, also when it was proposed on Telegram. **Ctrl+Enter** sends.

### What the manager remembers

The manager reads the **current conversation** with every message you send, so a follow-up question needs no
repeating. A conversation ends by itself after **an hour without a message**: your next message then starts a
new one. It never reads more than the last 40 lines. A thin line in the box shows where its memory starts; what
is above stays there for you to read back.

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

Once Telegram is linked ([Your keys](/start/keys/)), every action arrives on your phone, and any plain message
goes to your manager, with the same Apply and Cancel buttons. Commands (agents are numbered from 1: `/pause 2` pauses agent 2):

| Command | What it does |
|---|---|
| `/status` | This install and every agent at a glance |
| `/agents` | Balances and today's spend |
| `/plan [N]` | The latest plan |
| `/tick N` | Plan and run now |
| `/pause [N\|all]`, `/resume [N\|all]` | Pause or resume one agent or all |
| `/mode dry`, `/mode live confirm` | One mode for all agents |
| `/budget [N]` | Spend against the limits |
| `/ask [N] question` | A question to the manager about the team |
| `/strategy [N\|all] <text>` | Show or replace a strategy directly |
| `/clear` | Start a new conversation with the manager |
| `/kill on\|off` | Stop every agent at once, or release |
| `/help` | The full list |

Your Telegram bot answers only your own chat and ignores everyone else.
