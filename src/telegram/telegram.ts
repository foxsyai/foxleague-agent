// One Telegram bot per instance, talking only to the owner's chat (README "Telegram").
// Telegram's HTTP API over fetch: sendMessage for notifications, getUpdates long polling for commands,
// plain messages (the owner talking to the manager) and inline button presses (Apply / Cancel).
// Messages and buttons from any other chat are ignored.

import { sleep } from '../util/http.ts'

export type CommandHandler = (command: string, args: string[], rawArgs: string) => Promise<string>
export type Button = { label: string; data: string }
export type TextReply = { text: string; buttons?: Button[] }

export interface Handlers {
  command: CommandHandler
  /** A plain message (no leading slash). */
  text: (text: string) => Promise<TextReply>
  /** An inline button press, with its callback data; the answer is sent unless empty. */
  button: (data: string) => Promise<string>
}

const MAX_LEN = 4000

export class Telegram {
  private readonly base: string
  private readonly chatId: string
  private queue: Promise<void> = Promise.resolve()
  private offset = 0
  private stopped = false
  private readonly abort = new AbortController()

  constructor(token: string, chatId: string) {
    this.base = `https://api.telegram.org/bot${token}`
    this.chatId = chatId
  }

  /** Queued, at most about one message per second (Telegram's per-chat limit). */
  send(text: string, buttons?: Button[]): void {
    const chunks = split(text)
    chunks.forEach((chunk, n) => {
      const markup = buttons?.length && n === chunks.length - 1 ? { reply_markup: { inline_keyboard: [buttons.map(b => ({ text: b.label, callback_data: b.data }))] } } : {}
      this.queue = this.queue.then(async () => {
        // "Too many requests" (429), Telegram's own trouble (5xx) or no answer: the same message again after the
        // pause, up to 4 tries, so a warning or a top-up code is not lost when many agents report at once.
        let delivered = false
        for (let attempt = 1; attempt <= 4; attempt++) {
          try {
            const res = await fetch(`${this.base}/sendMessage`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ chat_id: this.chatId, text: chunk, disable_web_page_preview: true, ...markup }),
              signal: AbortSignal.timeout(15_000),
            })
            if (res.ok) {
              delivered = true
              break
            }
            if (res.status !== 429 && res.status < 500) {
              console.error(`telegram send failed: HTTP ${res.status}`)
              delivered = true // refused for good (a 4xx): another try would get the same answer
              break
            }
            const body = (await res.json().catch(() => ({}))) as { parameters?: { retry_after?: number } }
            await sleep(res.status === 429 ? Math.min(60, body.parameters?.retry_after ?? 5) * 1000 : 3000 * attempt)
          } catch (err) {
            console.error(`telegram send failed (try ${attempt} of 4):`, err instanceof Error ? err.message : err)
            if (attempt < 4) await sleep(3000 * attempt)
          }
        }
        // Without its text: a top-up offer holds a code that never goes to the log.
        if (!delivered) console.error(`telegram: a message of ${chunk.length} characters was dropped after 4 tries`)
        await sleep(1100)
      })
    })
  }

  /** The chat's "/" menu, set from the code at every start, so it always lists the commands this version knows. */
  setCommands(commands: { command: string; description: string }[]): void {
    this.call('setMyCommands', { commands })
  }

  /** Fire-and-forget API call (typing indicator, button acknowledgements). */
  private call(method: string, body: Record<string, unknown>): void {
    fetch(`${this.base}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) }).catch(
      err => console.error(`telegram ${method} failed:`, err instanceof Error ? err.message : err),
    )
  }

  /**
   * Obeys only the owner: the configured chat AND a sender whose user id is that chat id (a private
   * chat), so other members of a group cannot command the agent. Messages older than a few minutes before
   * polling started are not replayed. A 409 means a webhook took the bot token over: say so.
   */
  async startPolling(h: Handlers): Promise<void> {
    const fail = (err: unknown) => this.send(`error: ${err instanceof Error ? err.message : String(err)}`)
    const since = Math.floor(Date.now() / 1000) - 300
    let conflictSaid = false
    while (!this.stopped) {
      try {
        const res = await fetch(`${this.base}/getUpdates?timeout=50&offset=${this.offset}&allowed_updates=${encodeURIComponent('["message","callback_query"]')}`, {
          signal: AbortSignal.any([AbortSignal.timeout(60_000), this.abort.signal]),
        })
        const body = (await res.json()) as {
          ok: boolean
          result?: {
            update_id: number
            message?: { chat: { id: number }; from?: { id: number }; date?: number; text?: string } & ForwardMarkers
            callback_query?: { id: string; data?: string; from?: { id: number }; message?: { message_id: number; chat: { id: number } } }
          }[]
        }
        if (!body.ok) {
          if (res.status === 409 && !conflictSaid) {
            conflictSaid = true
            console.error('telegram: getUpdates answers 409 (a webhook or another poller uses this bot token)')
            this.send('Warning: another program (a webhook or a second copy of the agent) is reading this Telegram bot\'s messages. Commands may not reach me. If you did not set that up, create a new bot token with @BotFather.')
          }
          await sleep(10_000)
          continue
        }
        for (const u of body.result ?? []) {
          this.offset = u.update_id + 1
          const cq = u.callback_query
          if (cq) {
            if (!cq.message || String(cq.message.chat.id) !== this.chatId || String(cq.from?.id) !== this.chatId) continue
            this.call('answerCallbackQuery', { callback_query_id: cq.id })
            this.call('editMessageReplyMarkup', { chat_id: this.chatId, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } })
            h.button(cq.data ?? '').then(reply => reply && this.send(reply), fail)
            continue
          }
          const msg = u.message
          if (!msg?.text || String(msg.chat.id) !== this.chatId || String(msg.from?.id) !== this.chatId) continue
          if (typeof msg.date === 'number' && msg.date < since) continue
          // A forwarded message carries the owner as its sender, but the words are someone else's: never a command,
          // never a question for the manager. Say so, or the owner waits for an answer that never comes.
          if (isForwarded(msg)) {
            this.send(FORWARD_IGNORED)
            continue
          }
          const parsed = parseCommand(msg.text)
          if (parsed) {
            h.command(parsed.command, parsed.args, parsed.rawArgs).then(reply => reply && this.send(reply), fail)
          } else if (!msg.text.trim().startsWith('/')) {
            this.call('sendChatAction', { chat_id: this.chatId, action: 'typing' })
            h.text(msg.text.trim()).then(reply => this.send(reply.text, reply.buttons), fail)
          }
        }
      } catch {
        await sleep(5000)
      }
    }
  }

  /** Ends polling at once (a new token or chat from the admin panel takes over). */
  stop(): void {
    this.stopped = true
    this.abort.abort()
  }
}

export const FORWARD_IGNORED = "A forwarded message is not read, because its words are someone else's. To ask about it, type or paste it as your own message."

/** The fields Telegram sets on a forwarded message (the current and the legacy ones). */
export interface ForwardMarkers {
  forward_origin?: unknown
  forward_date?: unknown
  forward_from?: unknown
  forward_from_chat?: unknown
  forward_sender_name?: unknown
}

/**
 * True for a message whose words are not the owner's own: forwarded (any `forward_*` field, so a field Telegram adds
 * later is covered too), posted automatically from a linked channel, sent through a bot, or answering a message of
 * another chat (`external_reply`).
 */
export function isForwarded(message: object): boolean {
  const m = message as Record<string, unknown>
  if (Object.keys(m).some(k => k.startsWith('forward_') && m[k] !== undefined)) return true
  return m.is_automatic_forward === true || m.via_bot !== undefined || m.external_reply !== undefined
}

export function parseCommand(text: string): { command: string; args: string[]; rawArgs: string } | null {
  const m = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text.trim())
  if (!m) return null
  const rawArgs = (m[2] ?? '').trim()
  return { command: m[1]!.toLowerCase(), args: rawArgs ? rawArgs.split(/\s+/) : [], rawArgs }
}

function split(text: string): string[] {
  if (text.length <= MAX_LEN) return [text]
  const out: string[] = []
  let rest = text
  while (rest.length > MAX_LEN) {
    const cut = rest.lastIndexOf('\n', MAX_LEN) > MAX_LEN / 2 ? rest.lastIndexOf('\n', MAX_LEN) : MAX_LEN
    out.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^\n/, '')
  }
  if (rest) out.push(rest)
  return out
}
