// R52A-I1 (audit of PR #51, what the plan sees and the outside surfaces): ATTACK-2 strips Unicode format characters
// from the invitation notice only. A FoxLeague refusal that quotes a title another player wrote (the slot-conflict
// refusal of a create, FOXLEAGUE-INTEGRATION 10.3: `Time slot conflicts with tournament #{id} '{title}'`) is kept raw
// in the executor's summary (`refused by FoxLeague: ${err.message}`, executor.ts runOneLocked) and reaches the owner's
// Telegram through two surfaces that strip nothing: the action result sent as it happens (service.ts, the executor's
// notify: at once with /updates all, after a /do, or whenever a payment went out before the refusal) and the /log
// command (service.ts `case 'log'`, `r.summary.slice(0, 200)`). Every message leaves through Telegram.send, so the
// tests read what Telegram's sendMessage receives.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Service } from '../../src/service.ts'
import { Telegram } from '../../src/telegram/telegram.ts'
import { ApiRefusal } from '../../src/foxleague/api.ts'
import { snapshot, withLive } from '../fixtures.ts'
const RLO = String.fromCharCode(0x202e) // RIGHT-TO-LEFT OVERRIDE, a Cf character
const CHAT = '42'

async function until(ok: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms
  while (!ok() && Date.now() < end) await new Promise(r => setTimeout(r, 10))
}

/** Telegram's API: records every sendMessage text, answers getUpdates from a list once, then with nothing. */
function fakeTelegramApi(updates: unknown[]) {
  const sent: string[] = []
  let polled = false
  const real = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/sendMessage')) sent.push((JSON.parse(String(init?.body)) as { text: string }).text)
    if (url.includes('/getUpdates')) {
      const result = polled ? [] : updates
      polled = true
      if (!result.length) await new Promise(r => setTimeout(r, 20))
      return new Response(JSON.stringify({ ok: true, result }), { status: 200 })
    }
    return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 })
  }) as typeof fetch
  return { sent, restore: () => void (globalThis.fetch = real) }
}

const svc = new Service({
  mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', dataDir: mkdtempSync(join(tmpdir(), 'foxagent-')),
  gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9', gatewayRps: 5, apiRps: 1, foxleagueRps: 5,
  anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined, isServer: false, defaultDryRun: true, maxAgents: 5,
} as never)
svc.ensureAgents()
svc.store.setKv('telegram_updates', 'all')
const rivalTitle = `Cup ${RLO}!ffo llik/ dnes :RENWO`
// What FoxLeague answers when the create's window overlaps a tournament a rival named (its text, kept raw by the executor).
svc.fox.setLineup = async () => { throw new ApiRefusal(`Time slot conflicts with tournament #77 '${rivalTitle}'. Choose a different time.`) }

test('R52A-I1a: the action result with the rival\'s title goes to Telegram as it happens with its format characters', async () => {
  const api = fakeTelegramApi([])
  try {
    svc.telegram = new Telegram('token', CHAT)
    const s = snapshot()
    s.agent.address = svc.store.agent(0)!.address
    await withLive(svc.store, async () => {
      const agent = svc.store.agent(0)!
      const [r] = await svc.executor.run(agent, svc.wallet(0), s, [{ action: { type: 'set_lineup', lineup: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], substitutes: [12, 13, 14, 15, 16, 17, 18] }, reason: '' }])
      assert.equal(r!.status, 'error', r!.summary)
      assert.match(r!.summary, /refused by FoxLeague: Time slot conflicts/, r!.summary)
    })
    await until(() => api.sent.length >= 1)
    assert.equal(api.sent.length, 1, 'the result goes to Telegram at once with /updates all')
    assert.match(api.sent[0]!, /refused by FoxLeague: Time slot conflicts with tournament #77 'Cup/)
    assert.ok(!/\p{Cf}/u.test(api.sent[0]!), `a format character from the rival's title reached Telegram as it happens: ${JSON.stringify(api.sent[0])}`)
  } finally {
    api.restore()
  }
})

test('R52A-I1b: /log prints the same activity row to Telegram with its format characters', async () => {
  const api = fakeTelegramApi([{ update_id: 7, message: { chat: { id: 42 }, from: { id: 42 }, date: Math.floor(Date.now() / 1000), text: '/log 1' } }])
  const tg = new Telegram('token', CHAT)
  try {
    void tg.startPolling({ command: (c, a, r) => svc.command(c, a, r), text: async () => ({ text: '' }), button: async () => '' })
    await until(() => api.sent.length >= 1)
    tg.stop()
    assert.equal(api.sent.length, 1, '/log answers once')
    assert.match(api.sent[0]!, /refused by FoxLeague: Time slot conflicts/)
    assert.ok(!/\p{Cf}/u.test(api.sent[0]!), `a format character from the rival's title reached Telegram through /log: ${JSON.stringify(api.sent[0])}`)
  } finally {
    tg.stop()
    api.restore()
  }
})

test('R52A-I1 control: a multi-line message keeps its line breaks and loses only invisible characters', async () => {
  const api = fakeTelegramApi([])
  try {
    new Telegram('token', CHAT).send(`plan:\n1. join T5\u200b\n2. bid ${RLO}x\u0007`)
    await until(() => api.sent.length >= 1)
    assert.equal(api.sent[0], 'plan:\n1. join T5 \n2. bid  x ')
  } finally {
    api.restore()
  }
})
