// Talk to the manager (the agent review of PR #66): when the POST to /api/agents/N/advise fails for any reason (nginx
// gives up first, the connection drops), the page gave the message back and enabled Send, while the server kept the
// owner's line as pending and went on writing (and paying for) the answer. A second Send paid twice. The page keeps
// Send off while its conversation holds an owner's message still being answered, and the normal state refresh brings
// Send back when the answer is there. Seen failing on 0774eee: Send enabled and the message given back after a timeout.
// Since CO-1 (below) the server also turns a second message away while one is being answered.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import type { Config } from '../src/config.ts'
import type { ChatAnswer } from '../src/strategist/strategist.ts'
import { Sessions, hashPassword } from '../src/web/auth.ts'

const REPO = resolve(import.meta.dirname, '..')
const html = readFileSync(join(REPO, 'src/web/dashboard.html'), 'utf8')
const grab = (re: RegExp, what: string): string => {
  const found = html.match(re)?.[0]
  assert.ok(found, what)
  return found
}
const fn = (name: string): string => html.match(new RegExp(`\\n(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0] ?? ''

type Line = { from: string; text: string; at: string; pending?: boolean; source?: string }
type El = { disabled?: boolean; textContent?: string; value?: string; hidden?: boolean; onclick?: () => Promise<void> }
type Page = {
  els: Record<string, El>
  toasts: [string, boolean][]
  posts: string[]
  click(text: string): Promise<void>
  refresh(): Promise<void>
  render(): void
  setChat(chat: Line[]): void
}

/**
 * The page's Send handler and the functions it calls, run as they are written, around fakes: the server's answer to
 * the POST (`post`), what /api/state gives (`state`) and an element store for $(). The fake loadState does what the
 * real one does for the conversation (SEND-1 pins that below): it replaces S and draws the conversation again.
 */
function page(o: { post: (message: string) => Promise<unknown>; state: () => Promise<{ chat: Line[] }>; chat?: Line[] }): Page {
  const helpers = ['chatPending', 'chatAnswering', 'renderSend', 'chatOwn', 'chatFate', 'chatSettle'].map(fn).filter(Boolean).join('\n')
  const handler = grab(/\n\$\('adviceBtn'\)\.onclick = async \(\) => \{[\s\S]*?\n\}/, 'the Send handler')
  const body = `
    let S = { chat: env.chat || [] }, chatWaiting = null, chatUnsure = false, chatLost = null, sel = 0
    const els = {}
    const $ = id => els[id] || (els[id] = { disabled: false, textContent: id === 'adviceBtn' ? 'Send' : '', value: '', hidden: true })
    const toasts = [], posts = []
    const toast = (m, bad) => { toasts.push([String(m), Boolean(bad)]) }
    const stopSpeech = () => undefined
    const api = async (method, path, b) => { posts.push(b.message); return env.post(b.message) }
    const renderChat = () => { if (typeof renderSend === 'function') renderSend() }
    async function loadState() {
      try { S = await env.state(); chatUnsure = false; if (typeof chatSettle === 'function') chatSettle(); renderChat() } catch (e) { toast('Could not load state: ' + e.message, true) }
    }
    ${helpers}
    ${handler}
    return {
      els, toasts, posts,
      async click(text) { $('adviceText').value = text; if (!$('adviceBtn').disabled) await $('adviceBtn').onclick() },
      refresh: loadState,
      render: renderChat,
      setChat(chat) { S = { chat } },
    }`
  return new Function('env', body)(o) as Page
}

const at = '2026-11-13T12:00:00.000Z'
const waiting = (text: string, source = 'web UI, admin'): Line => ({ from: 'owner', text, at, pending: true, source })

test('SEND-1 Send stays off while an answer is on its way: after a failed POST the server may still be answering, so the message is not given back and a second Send cannot pay twice; the state refresh brings Send back', async () => {
  // An nginx timeout: the POST fails, the server still holds the message and goes on answering it.
  let server: Line[] = []
  const p = page({ post: async m => { server = [waiting(m)]; throw new Error('HTTP 504') }, state: async () => ({ chat: server }) })
  await p.click('how are we doing?')
  assert.deepEqual(p.posts, ['how are we doing?'])
  assert.equal(p.els.adviceBtn!.disabled, true, 'Send stays off while the server is still answering')
  assert.equal(p.els.adviceText!.value, '', 'the message is not given back: the server is answering it')
  assert.deepEqual(p.toasts, [['The manager is still answering. Its answer shows here when it is ready.', false]])
  assert.equal(p.els.adviceBusy!.hidden, false, 'a line says why Send is off')
  assert.match(p.els.adviceBusy!.textContent!, /^The manager is still answering\. Send comes back when its answer is here\.$/)
  // A second Send (Ctrl+Enter or a click that got through) asks nothing.
  p.els.adviceBtn!.disabled = false
  await p.click('hello again?')
  assert.deepEqual(p.posts, ['how are we doing?'], 'no second request while the first is answered')
  assert.equal(p.els.adviceBtn!.disabled, true)
  // The answer arrives: the next state refresh brings Send back.
  server = [{ from: 'owner', text: 'how are we doing?', at }, { from: 'manager', text: 'Fine.', at }]
  await p.refresh()
  assert.equal(p.els.adviceBtn!.disabled, false)
  assert.equal(p.els.adviceBtn!.textContent, 'Send')
  assert.equal(p.els.adviceBusy!.hidden, true)

  // The server gave up on it (the model failed): the message is not pending there, so it comes back and Send is on.
  const failed = page({ post: async () => { throw new Error('Anthropic API error 529: overloaded') }, state: async () => ({ chat: [] }) })
  await failed.click('plan the week')
  assert.equal(failed.els.adviceBtn!.disabled, false)
  assert.equal(failed.els.adviceText!.value, 'plan the week', 'given back to send again')
  assert.deepEqual(failed.toasts, [['Anthropic API error 529: overloaded', true]])

  // The page cannot reach the server at all: it cannot know whether the message is being answered. The message comes
  // back, Send stays off until a state refresh gets through and shows no answer on its way.
  let down = true
  const lost = page({ post: async () => { throw new Error('Failed to fetch') }, state: async () => { if (down) throw new Error('Failed to fetch'); return { chat: [] } } })
  await lost.click('anyone there?')
  assert.equal(lost.els.adviceBtn!.disabled, true, 'not known: off')
  assert.equal(lost.els.adviceText!.value, 'anyone there?')
  assert.match(lost.els.adviceBusy!.textContent!, /^The page could not reach the server\. Send comes back when it can see that the manager is not still answering\.$/)
  await lost.refresh()
  assert.equal(lost.els.adviceBtn!.disabled, true, 'still not known')
  down = false
  await lost.refresh()
  assert.equal(lost.els.adviceBtn!.disabled, false)

  // A message from Telegram or another tab that is still being answered keeps Send off here too, as the server shows it.
  const other = page({ post: async () => ({ chat: [] }), state: async () => ({ chat: [] }), chat: [waiting('from my phone', 'Telegram')] })
  other.render()
  assert.equal(other.els.adviceBtn!.disabled, true)
  other.setChat([])
  other.render()
  assert.equal(other.els.adviceBtn!.disabled, false)

  // A Send that works: Send is on again with the answer, as before.
  const fine = page({ post: async m => ({ chat: [{ from: 'owner', text: m, at }, { from: 'manager', text: 'Done.', at }] }), state: async () => ({ chat: [] }) })
  await fine.click('thanks')
  assert.equal(fine.els.adviceBtn!.disabled, false)
  assert.equal(fine.els.adviceBtn!.textContent, 'Send')
  assert.deepEqual(fine.toasts, [])

  // What the fakes above stand for, in the page itself: the state refresh clears "not known" once it has the server's
  // answer, and every drawing of the conversation sets Send before it may stop early.
  const load = fn('loadState')
  assert.ok(load.indexOf('chatUnsure = false') > load.indexOf("S = await api('GET'"), 'loadState clears it after the state was read')
  const chat = fn('renderChat')
  assert.ok(chat.indexOf('renderSend()') > 0 && chat.indexOf('renderSend()') < chat.indexOf('if (key === chatShown) return'), 'renderChat sets Send first')
  assert.match(html, /<button class="btn go" id="adviceBtn">Send<\/button><span id="adviceBusy" class="note" hidden><\/span>/)
  // The bubble of the box says it, in plain words.
  const tip = html.match(/\n {2}advice: \['Talk to the manager', `([^`]*)`\]/)?.[1] ?? ''
  const said = tip.match(/<p>While the manager is answering[^<]*<\/p>/)?.[0] ?? ''
  assert.match(said, /While the manager is answering a message \(sent from here, another tab or Telegram\), Send waits: the answer is written and paid for even when this page loses the connection, so a second Send would pay twice\./)
  assert.doesNotMatch(said, /—|, and |, or |\bbot\b/i)
})

test('R67A-2 after a failed Send the page keeps the message only when the server holds this very message as pending: another one still being answered (Telegram, another tab) does not swallow it, it comes back with its error and Send stays off meanwhile', async () => {
  // The owner wrote on Telegram; within the 15 s before the next refresh he presses Send here. The web message's
  // model call fails (529): the server drops that line and answers the error, while the Telegram line is still pending.
  const telegram = waiting('how much did we spend today?', 'Telegram')
  const p = page({ post: async () => { throw new Error('Anthropic API error 529: overloaded') }, state: async () => ({ chat: [telegram] }) })
  await p.click('skip boosters this week')
  assert.equal(p.els.adviceText!.value, 'skip boosters this week', 'given back: the server does not hold it')
  assert.deepEqual(p.toasts, [['Anthropic API error 529: overloaded', true]], 'with its own error')
  assert.equal(p.els.adviceBtn!.disabled, true, 'Send stays off while the Telegram message is answered')
  assert.match(p.els.adviceBusy!.textContent!, /^The manager is still answering\. Send comes back when its answer is here\.$/)
  // The very same words still pending, but written on Telegram: not this page's message either.
  const same = page({ post: async () => { throw new Error('Anthropic API error 529: overloaded') }, state: async () => ({ chat: [waiting('skip boosters this week', 'Telegram')] }) })
  await same.click('skip boosters this week')
  assert.equal(same.els.adviceText!.value, 'skip boosters this week')
  assert.deepEqual(same.toasts, [['Anthropic API error 529: overloaded', true]])
  // This page's own message still pending on the server (behind a timeout): kept, as SEND-1 pins.
  const mine = page({ post: async m => { throw Object.assign(new Error('HTTP 504'), { m }) }, state: async () => ({ chat: [telegram, waiting('skip boosters this week')] }) })
  await mine.click('skip boosters this week')
  assert.equal(mine.els.adviceText!.value, '')
  assert.deepEqual(mine.toasts, [['The manager is still answering. Its answer shows here when it is ready.', false]])
  // The review has its row.
  const review = readFileSync(join(REPO, 'docs/SECURITY-REVIEW.md'), 'utf8')
  assert.match(review.slice(review.indexOf('\n## Repeat shadow, chat Send and model output limits (2026-11-13)\n')), /\n\| R67A-2 \| low \(cost; agent review of PR #67\) \| [^\n]+ \| [^\n]+ \|\n/)
})

// ---- one manager message at a time (the owner, 2026-11-13) ----

const BUSY = 'The manager is still answering the last message. Send this one when its answer is in.'

function serviceConfig(dir: string): Config {
  return {
    mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-sonnet-5-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config
}

test('CO-1 the server answers one manager message at a time: a second one while another is answered is turned away before it is said or paid for (web 409, Telegram the reason as its reply); Clear, an answer and a failed answer let the next through, a restart holds nothing; /ask is not the conversation', async () => {
  const { Service } = await import('../src/service.ts')
  const web = await import('../src/web/server.ts')
  const cfg = serviceConfig(mkdtempSync(join(tmpdir(), 'foxagent-co1-')))
  const svc = new Service(cfg)
  svc.ensureAgents()
  ;(svc as unknown as { schedule: unknown }).schedule = () => undefined
  svc.notify = () => undefined
  // Each answer the model is asked for waits until the test releases it (or fails it), newest last.
  const calls: { resolve: (a: ChatAnswer) => void; reject: (e: Error) => void }[] = []
  const release = (a: ChatAnswer) => calls.at(-1)!.resolve(a)
  const fail = (e: Error) => calls.at(-1)!.reject(e)
  const asked: string[] = []
  svc.strategist = {
    model: 'claude-sonnet-5-5', effort: 'medium',
    discuss: (i: { message: string }) => (asked.push(i.message), new Promise<ChatAnswer>((resolve, reject) => void calls.push({ resolve, reject }))),
    ask: async () => ({ answer: 'fine', usd: 0 }),
  } as never
  // /ask reads a snapshot: offline here, every read fails at once (the snapshot then carries warnings).
  const offline = new Proxy({}, { get: () => async () => { throw new Error('offline in this test') } })
  Object.assign(svc as object, { chain: offline, fox: offline })
  const lines = () => svc.chatLines().map(l => [l.text, l.pending ?? false])
  // A call that would wait for a second answer is not waited for here: it shows as "still waiting".
  const within = <T>(q: Promise<T>) => Promise.race([q, new Promise<'still waiting'>(r => setTimeout(() => r('still waiting'), 200))])
  const usd = () => svc.store.getKv('model_usd_total') ?? '0'

  // A web message is being answered: one from Telegram is turned away with the reason as its reply, said nowhere,
  // asked of nobody; one more from the web is turned away as well.
  const first = svc.discuss('how is agent 1?', 'web UI, admin', [0])
  const telegram = await within((svc as unknown as { chatFromTelegram(t: string): Promise<{ text: string; buttons?: unknown }> }).chatFromTelegram('and agent 2?'))
  assert.deepEqual(telegram, { text: BUSY }, 'the owner gets the reason on Telegram, not a failure')
  await assert.rejects(within(svc.discuss('one more', 'web UI, admin', [0])), (err: Error) => err.message === BUSY)
  assert.deepEqual(asked, ['how is agent 1?'], 'the model was asked once')
  assert.deepEqual(lines(), [['how is agent 1?', true]], 'the turned-away messages are not in the conversation')

  // The web route: 409 with the reason; the server does not hold that message.
  const creds = { username: 'admin', passwordHash: hashPassword('correct-horse-battery'), secretKey: 'k'.repeat(64) }
  const server = web.startWeb(svc, creds, 0)
  if (!server.listening) await once(server, 'listening')
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const sessions = new Sessions(creds.secretKey, creds.passwordHash)
    const cookie = sessions.issue('admin')
    const res = await fetch(`${url}/api/agents/0/advise`, { method: 'POST', headers: { cookie: `foxagent_session=${cookie}`, origin: url, 'x-csrf-token': sessions.csrfFor(cookie), 'content-type': 'application/json' }, body: JSON.stringify({ message: 'from another tab' }) })
    assert.equal(res.status, 409)
    assert.deepEqual(await res.json(), { error: BUSY })
  } finally {
    server.close()
  }
  assert.deepEqual(asked, ['how is agent 1?'])

  // /ask is not the conversation: it is answered meanwhile.
  assert.equal(await svc.command('ask', ['how', 'are', 'we?'], 'how are we?'), 'agent 1: fine')

  // The answer is in: the next message goes through.
  release({ reply: 'fine', proposal: null, usd: 0.01 })
  await first
  assert.equal(usd(), '0.01', 'one answer paid for')
  const second = svc.discuss('and now?', 'Telegram')
  assert.deepEqual(asked, ['how is agent 1?', 'and now?'])
  // An answer that failed takes its line out: the next goes through.
  fail(new Error('model down'))
  await assert.rejects(second, /model down/)
  const third = svc.discuss('again?', 'Telegram')
  assert.equal(asked.length, 3)
  // Cleared while it is answered: the conversation starts fresh and the next message goes through.
  svc.clearChat('web UI, admin')
  const fourth = svc.discuss('fresh start', 'web UI, admin', [0])
  assert.equal(asked.length, 4)
  // A restart holds nothing: a waiting line is never saved.
  const after = new Service(cfg)
  after.strategist = { discuss: async () => ({ reply: 'here', proposal: null, usd: 0 }) } as never
  assert.deepEqual(await after.discuss('after a restart', 'Telegram'), { reply: 'here', proposal: null })
  for (const c of calls) c.resolve({ reply: 'late', proposal: null, usd: 0 })
  await Promise.all([third, fourth])

  // The page: a 409 is final, the server does not hold the message: it comes back with the reason, also when an
  // earlier message with the same words from this box is still being answered, and Send stays off meanwhile.
  const p = page({
    post: async () => { throw Object.assign(new Error(BUSY), { status: 409 }) },
    state: async () => ({ chat: [{ from: 'owner', text: 'skip boosters', at, pending: true, source: 'web UI, admin' }] }),
  })
  await p.click('skip boosters')
  assert.equal(p.els.adviceText!.value, 'skip boosters', 'given back: the server turned it away')
  assert.deepEqual(p.toasts, [[BUSY, true]])
  assert.equal(p.els.adviceBtn!.disabled, true)
  assert.match(fn('api'), /status: r\.status/, 'the page\'s api() keeps the status of a refused request')
})

test('CO-2 a failed Send whose answer was written meanwhile is not put back: the page finds it answered by the server\'s own times, at once or at the first state it can read; an edited box is left alone', async () => {
  const t = (minute: number) => `2026-11-13T12:${String(minute).padStart(2, '0')}:00.000Z`
  const earlier = [{ from: 'owner', text: 'skip boosters', at: t(1), source: 'web UI, admin' }, { from: 'manager', text: 'Done before.', at: t(2) }]
  const answered = [...earlier, { from: 'owner', text: 'skip boosters', at: t(5), source: 'web UI, admin' }, { from: 'manager', text: 'Done.', at: t(9) }]
  const ANSWERED = 'The manager answered while the page was away: its answer is in the conversation.'
  const lost = async (): Promise<unknown> => { throw new Error('Failed to fetch') }

  // The laptop slept: the answer was written and booked, the POST failed; the state read at once shows it answered.
  const a = page({ post: lost, state: async () => ({ chat: answered }), chat: earlier })
  await a.click('skip boosters')
  assert.equal(a.els.adviceText!.value, '', 'not given back: it was answered')
  assert.deepEqual(a.toasts, [[ANSWERED, false]])
  assert.equal(a.els.adviceBtn!.disabled, false, 'nothing is being answered: Send is on')

  // The same words answered before this Send (older than the newest line the page had) do not count.
  const old = page({ post: lost, state: async () => ({ chat: earlier }), chat: earlier })
  await old.click('skip boosters')
  assert.equal(old.els.adviceText!.value, 'skip boosters')
  assert.deepEqual(old.toasts, [['Failed to fetch', true]])

  // The state cannot be read either: the message comes back, Send stays off, and the first state that can be read
  // settles it. Answered meanwhile: the box is emptied and it says so.
  let down = true
  let chat: Line[] = answered
  const b = page({ post: lost, state: async () => { if (down) throw new Error('Failed to fetch'); return { chat } }, chat: earlier })
  await b.click('skip boosters')
  assert.equal(b.els.adviceText!.value, 'skip boosters')
  assert.equal(b.els.adviceBtn!.disabled, true)
  down = false
  await b.refresh()
  assert.equal(b.els.adviceText!.value, '', 'emptied once the server shows it answered')
  assert.deepEqual(b.toasts.at(-1), [ANSWERED, false])
  assert.equal(b.els.adviceBtn!.disabled, false)
  // Settled once: a later refresh says nothing more.
  const said = b.toasts.length
  await b.refresh()
  assert.equal(b.toasts.length, said)

  // Still being answered when the state can be read again: emptied, Send stays off.
  down = true
  chat = [...earlier, { from: 'owner', text: 'skip boosters', at: t(5), pending: true, source: 'web UI, admin' }]
  const c = page({ post: lost, state: async () => { if (down) throw new Error('Failed to fetch'); return { chat } }, chat: earlier })
  await c.click('skip boosters')
  down = false
  await c.refresh()
  assert.equal(c.els.adviceText!.value, '')
  assert.deepEqual(c.toasts.at(-1), ['The manager is still answering. Its answer shows here when it is ready.', false])
  assert.equal(c.els.adviceBtn!.disabled, true)

  // The owner changed the box meanwhile: it is left as he wrote it.
  down = true
  chat = answered
  const d = page({ post: lost, state: async () => { if (down) throw new Error('Failed to fetch'); return { chat } }, chat: earlier })
  await d.click('skip boosters')
  d.els.adviceText!.value = 'skip boosters and packs'
  down = false
  await d.refresh()
  assert.equal(d.els.adviceText!.value, 'skip boosters and packs')
  assert.notDeepEqual(d.toasts.at(-1), [ANSWERED, false])

  // The server never got it: the message stays in the box and Send comes back.
  down = true
  chat = earlier
  const e = page({ post: lost, state: async () => { if (down) throw new Error('Failed to fetch'); return { chat } }, chat: earlier })
  await e.click('skip boosters')
  down = false
  await e.refresh()
  assert.equal(e.els.adviceText!.value, 'skip boosters')
  assert.equal(e.els.adviceBtn!.disabled, false)

  // The page itself settles it in loadState, after the state was read.
  const load = fn('loadState')
  assert.ok(load.indexOf('chatSettle()') > load.indexOf('chatUnsure = false'), 'loadState settles a lost Send once the state was read')
})

test('CO-docs the guides and the review say that the manager answers one message at a time and what the page does after a failed Send; the review has its section, the last one, in the table format', () => {
  const read = (f: string) => readFileSync(join(REPO, f), 'utf8')
  const flat = (f: string) => read(f).replace(/\s+/g, ' ')
  const talk = flat('site/src/content/docs/use/talk-to-your-manager.md')
  for (const said of [
    /The manager answers one message at a time: one sent meanwhile, from Telegram or another tab, is turned away with that reason and costs nothing\. Send it again when the answer is in\./,
    /If the page lost the connection and the answer came meanwhile, the answer shows in the conversation and your message does not come back into the box\./,
    /While the manager is still answering an earlier message, it replies that it is and nothing is paid for: send yours again when the answer is in\./,
  ]) assert.match(talk, said)
  assert.match(flat('docs/SERVER.md'), /The server answers one manager message at a time: a second one meanwhile, from Telegram or another tab, is turned away with the reason \(the page shows it, Telegram replies with it\) and costs nothing\./)
  const tip = html.match(/\n {2}advice: \['Talk to the manager', `([^`]*)`\]/)?.[1] ?? ''
  assert.match(tip.replace(/\s+/g, ' '), /A message sent meanwhile from Telegram or another tab is turned away with that reason: send it again when the answer is in\./)
  for (const f of ['site/src/content/docs/use/talk-to-your-manager.md', 'docs/SERVER.md']) {
    const text = flat(f)
    for (const s of [text.indexOf('The manager answers one message at a time'), text.indexOf('While the manager is still answering an earlier message'), text.indexOf('The server answers one manager message at a time')].filter(i => i >= 0)) {
      assert.doesNotMatch(text.slice(s, text.indexOf('.', text.indexOf('.', s) + 1) + 1), /—|, and |, or |\bbot\b/i, f)
    }
  }

  const review = read('docs/SECURITY-REVIEW.md')
  const start = review.indexOf('\n## One manager message at a time (2026-11-13)\n')
  assert.ok(start > 0, 'the section is in the review')
  assert.ok(start > review.indexOf('\n## Repeat shadow, chat Send and model output limits (2026-11-13)\n'), 'after the section before it')
  assert.equal(review.indexOf('\n## ', start + 1), -1, 'the last section')
  const section = review.slice(start)
  assert.match(section, /\| Id \| Severity \| Finding \| Fix \|\n\|---\|---\|---\|---\|\n\| CO-1 \| low \(cost; the owner, 2026-11-13\) \|/)
  for (const id of ['CO-2', 'CO-3']) assert.match(section, new RegExp(`\\n\\| ${id} \\|`), id)
  for (const line of section.split('\n').filter(l => l.startsWith('| CO-'))) assert.equal(line.split(' | ').length, 4, line.slice(0, 40))
  assert.match(section.replace(/\s+/g, ' '), /The live server's nginx waits 1080 seconds since 13 Nov 2026/)
  assert.ok(section.includes('\nStays open:\n'))
  assert.doesNotMatch(section, /—|\bbot\b/i)
})
