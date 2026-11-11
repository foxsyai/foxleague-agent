// Audit 2026-11-11 (Fable 5.2 reviewers at extra-high effort): the proof of ATTACK-8, failing before its fix.
// "Link my Telegram" (and `cli configure`) looked for the owner's 6-digit code in getUpdates?limit=20 with no
// offset (src/setup/keys.ts). Telegram answers that with the 20 EARLIEST updates nobody confirmed yet, and before a
// chat is linked nothing confirms any (the service polls only once a chat is set). Anyone can find a Telegram bot
// by its username and write to it: 20 messages from a stranger (or the owner's own first 20 lines) filled that
// window for 24 hours, the owner's code was never seen, and the dashboard kept saying "the code was not found yet".
// The stranger's 20 lines were also the only 20 codes that could ever match.
// Safe behaviour: the code the owner just sent is found, whatever was written before it; only a message dated
// after the link was started counts; what the owner wrote stays waiting for the service's own reader.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '../../src/config.ts'
import { Service } from '../../src/service.ts'
import { pickOwnerChat, telegramRecentChats } from '../../src/setup/keys.ts'

const TEST_WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const TOKEN = '123456789:AAHaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const STRANGER = 666
const OWNER = 4242

type Update = { update_id: number; message: { chat: { id: number; type: string; first_name: string }; from: { id: number }; date: number; text: string } }

/**
 * A stand-in for api.telegram.org with getUpdates as Telegram documents it: the earliest unconfirmed updates first,
 * at most `limit` (100 at most), from `offset` on; asking with an offset confirms (forgets) everything before it; a
 * negative offset counts from the end and forgets the rest. No request leaves the process: the real fetch is never
 * put back in this file, because the service's Telegram sender keeps delivering its queue (one message a second)
 * after a test has ended, and those late sends must meet a stand-in too.
 */
function standInTelegram() {
  let backlog: Update[] = []
  let nextId = 1000
  /** What a long poll (the service's own reader, after the link) was handed. */
  const polled: string[] = []
  let failNext: string | null = null
  const write = (chat: number, text: string, agoS = 0) =>
    void backlog.push({ update_id: nextId++, message: { chat: { id: chat, type: 'private', first_name: `u${chat}` }, from: { id: chat }, date: Math.floor(Date.now() / 1000) - agoS, text } })
  globalThis.fetch = (async (input: unknown, init?: { signal?: AbortSignal }) => {
    const url = new URL(String(input))
    if (url.hostname !== 'api.telegram.org') throw new Error(`unexpected request to ${url.hostname}`)
    const method = url.pathname.split('/').pop()
    const answer = (result: unknown) => new Response(JSON.stringify({ ok: true, result }), { headers: { 'content-type': 'application/json' } })
    if (method === 'getMe') return answer({ username: 'myfox_manager_bot' })
    if (method === 'getUpdates') {
      if (failNext) {
        const description = failNext
        failNext = null
        return new Response(JSON.stringify({ ok: false, error_code: 409, description }), { status: 409, headers: { 'content-type': 'application/json' } })
      }
      const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') ?? 100)))
      const offset = Number(url.searchParams.get('offset') ?? 0)
      if (offset > 0) backlog = backlog.filter(u => u.update_id >= offset)
      if (offset < 0) backlog = backlog.slice(offset)
      const longPoll = url.searchParams.has('timeout')
      if (!backlog.length && longPoll) await new Promise(r => setTimeout(r, 100)) // a long poll with nothing new
      if (init?.signal?.aborted) throw new Error('aborted')
      const list = backlog.slice(0, limit)
      if (longPoll) polled.push(...list.map(u => u.message.text))
      return answer(list)
    }
    return answer({}) // sendMessage, setMyCommands and the like
  }) as typeof fetch
  return { write, polled, waiting: () => backlog.map(u => u.message.text), failOnce: (description: string) => void (failNext = description) }
}

async function service() {
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-a8-'))
  const env = { token: process.env.TELEGRAM_BOT_TOKEN, chat: process.env.TELEGRAM_CHAT_ID }
  process.env.TELEGRAM_BOT_TOKEN = TOKEN // as loaded from the env file in the real service
  delete process.env.TELEGRAM_CHAT_ID
  const svc = new Service({
    mnemonic: TEST_WORDS, dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: TOKEN, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config)
  svc.ensureAgents()
  ;(svc as unknown as { schedule: unknown }).schedule = () => undefined
  const finish = async () => {
    try {
      return await svc.finishTelegramLink('test')
    } catch (err) {
      return `refused: ${err instanceof Error ? err.message : String(err)}`
    }
  }
  const close = async () => {
    await svc.stop()
    if (env.token === undefined) delete process.env.TELEGRAM_BOT_TOKEN
    else process.env.TELEGRAM_BOT_TOKEN = env.token
    if (env.chat === undefined) delete process.env.TELEGRAM_CHAT_ID
    else process.env.TELEGRAM_CHAT_ID = env.chat
    rmSync(dir, { recursive: true, force: true })
  }
  return { svc, finish, close }
}
const until = async (ok: () => boolean, ms = 5_000): Promise<void> => {
  const end = Date.now() + ms
  while (!ok() && Date.now() < end) await new Promise(r => setTimeout(r, 25))
}

test('ATTACK-8 the owner links Telegram although a stranger wrote 25 messages to the Telegram bot first', async () => {
  const tg = standInTelegram()
  const { svc, finish, close } = await service()
  try {
    // A stranger found @myfox_manager_bot and wrote to it 25 times (any text; here, guesses at a code).
    for (let i = 0; i < 25; i++) tg.write(STRANGER, String(100_000 + i), 3600)
    // The owner presses Link my Telegram and sends the code from their own account.
    const { code } = await svc.startTelegramLink()
    tg.write(OWNER, code)
    const outcome = await finish()
    assert.match(outcome, /keys updated: Telegram chat id/, `the owner sent the right code from their own account and the link answered: ${outcome}`)
    assert.equal(svc.cfg.telegramChatId, String(OWNER))
  } finally {
    await close()
  }
})

test('ATTACK-8b hundreds of earlier messages are read through, and what the owner wrote around the code still reaches the service\'s own reader', async () => {
  const tg = standInTelegram()
  const { svc, finish, close } = await service()
  try {
    for (let i = 0; i < 199; i++) tg.write(STRANGER, `old line ${i}`, 7200)
    // The owner opened the chat two minutes ago (Telegram sends /start), as the 200th waiting update: the last of a full page.
    tg.write(OWNER, '/start', 120)
    const { code } = await svc.startTelegramLink()
    for (let i = 0; i < 30; i++) tg.write(STRANGER, `new line ${i}`)
    tg.write(OWNER, code)
    tg.write(OWNER, '/status') // the owner's first command, sent before pressing "I sent it"
    assert.match(await finish(), /keys updated: Telegram chat id/)
    assert.equal(svc.cfg.telegramChatId, String(OWNER))
    // Reading on confirmed only what nobody needs any more; the owner's lines were not confirmed away by the link.
    await until(() => tg.polled.includes('/status'))
    assert.ok(tg.polled.includes('/status'), `the first command reaches the reader that starts after the link (it was handed: ${tg.polled.slice(0, 5).join(', ')})`)
    assert.ok(tg.polled.includes('/start'), 'and the /start sent just before the link, which sat at the end of a full page')
    assert.ok(!tg.polled.includes('old line 0'), 'the stale lines read on the way are not kept')
  } finally {
    await close()
  }
})

test('ATTACK-8c only a message dated after the link was started counts: an old line with the same digits links nobody', async () => {
  const tg = standInTelegram()
  const { svc, finish, close } = await service()
  try {
    const { code } = await svc.startTelegramLink()
    // The same digits, but written an hour before this code existed (a guess left waiting), and nothing from the owner yet.
    tg.write(STRANGER, code, 3600)
    assert.match(await finish(), /refused: the code was not found yet/)
    assert.equal(svc.cfg.telegramChatId, undefined)
    // The owner sends it now: theirs is the only one that counts.
    tg.write(OWNER, code)
    assert.match(await finish(), /keys updated: Telegram chat id/)
    assert.equal(svc.cfg.telegramChatId, String(OWNER))
  } finally {
    await close()
  }
})

test('ATTACK-8d (unit) the code from two chats links nobody wherever the two messages wait, a flood after the link started is read through, an error is said', async () => {
  const tg = standInTelegram()
  {
    const since = Date.now()
    // Two chats sent the code, 250 updates apart (the first and the third page).
    tg.write(STRANGER, '654321')
    for (let i = 0; i < 250; i++) tg.write(777, `line ${i}`)
    tg.write(OWNER, '654321')
    const chats = await telegramRecentChats(TOKEN, since)
    assert.equal(chats.filter(c => c.text === '654321').length, 2, 'both are seen')
    assert.equal(pickOwnerChat(chats, '654321'), null, 'two chats sent the code: nobody is linked')
    // A flood of fresh lines before the code: read through; the code and what follows it stay waiting.
    const tg2since = Date.now()
    for (let i = 0; i < 150; i++) tg.write(STRANGER, `flood ${i}`)
    tg.write(OWNER, '111222')
    tg.write(OWNER, '/status')
    assert.equal(pickOwnerChat(await telegramRecentChats(TOKEN, tg2since), '111222'), String(OWNER))
    assert.ok(tg.waiting().includes('111222') && tg.waiting().includes('/status'), 'the end of the queue is never confirmed by the link')
    // Asking again reads the same end of the queue again: the answer does not change.
    assert.equal(pickOwnerChat(await telegramRecentChats(TOKEN, tg2since), '111222'), String(OWNER))
    // Seen from a link started an hour from now, nothing that waits counts.
    assert.deepEqual(await telegramRecentChats(TOKEN, Date.now() + 3600_000), [])
    // Telegram refuses the listing (another program reads this token's messages): said, never "no message yet".
    tg.failOnce('Conflict: terminated by other getUpdates request')
    await assert.rejects(telegramRecentChats(TOKEN, since), /Conflict/)
  }
})
