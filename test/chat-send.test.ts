// Talk to the manager (the agent review of PR #66): when the POST to /api/agents/N/advise fails for any reason (nginx
// gives up first, the connection drops), the page gave the message back and enabled Send, while the server kept the
// owner's line as pending and went on writing (and paying for) the answer. A second Send paid twice. The server does
// not refuse a second message while one is pending (Service.discuss has no such check), so the page keeps Send off
// while its conversation holds an owner's message still being answered, and the normal state refresh brings Send back
// when the answer is there. Seen failing on 0774eee: Send enabled and the message given back after a timeout.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

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
  const helpers = ['chatPending', 'chatAnswering', 'renderSend'].map(fn).filter(Boolean).join('\n')
  const handler = grab(/\n\$\('adviceBtn'\)\.onclick = async \(\) => \{[\s\S]*?\n\}/, 'the Send handler')
  const body = `
    let S = { chat: env.chat || [] }, chatWaiting = null, chatUnsure = false, sel = 0
    const els = {}
    const $ = id => els[id] || (els[id] = { disabled: false, textContent: id === 'adviceBtn' ? 'Send' : '', value: '', hidden: true })
    const toasts = [], posts = []
    const toast = (m, bad) => { toasts.push([String(m), Boolean(bad)]) }
    const stopSpeech = () => undefined
    const api = async (method, path, b) => { posts.push(b.message); return env.post(b.message) }
    const renderChat = () => { if (typeof renderSend === 'function') renderSend() }
    async function loadState() {
      try { S = await env.state(); chatUnsure = false; renderChat() } catch (e) { toast('Could not load state: ' + e.message, true) }
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
