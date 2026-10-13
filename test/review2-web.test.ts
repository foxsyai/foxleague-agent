// Proof tests for the second review round of 2026-10-13 (web, Telegram, install, docs). Each test is named after its
// finding (R2B = the web reviewer, R2C = the fresh reviewer) and failed on main 733a8d5 before the fix; a "control"
// passed before and after.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Config } from '../src/config.ts'
import { setEnvValues } from '../src/setup/keys.ts'
import { Telegram, type Handlers } from '../src/telegram/telegram.ts'
import { checkAction } from '../src/executor/rules.ts'
import { wholeToAtomic } from '../src/util/encoding.ts'
import type { TournamentDetail } from '../src/foxleague/types.ts'
import { OTHER, TEST_SETTINGS, snapshot, tournament } from './fixtures.ts'

const TEST_WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const REPO = resolve(import.meta.dirname, '..')
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ---- R2B-1: a rewrite in place that cannot open the env file leaves no copy of the words behind ----

test('R2B-1 an env file that cannot be opened for writing leaves no backup behind, because nothing was written', () => {
  if (process.getuid?.() === 0) return // root ignores file modes
  const dir = mkdtempSync(join(tmpdir(), 'r2b-1-'))
  const data = mkdtempSync(join(tmpdir(), 'r2b-1-data-'))
  const file = join(dir, 'env')
  const backup = join(data, 'env.backup')
  const old = `AGENT_MNEMONIC="${TEST_WORDS}"\nWEB_UI_USER="old"\n`
  writeFileSync(file, old, { mode: 0o400 }) // readable, not writable by the service user
  chmodSync(dir, 0o500) // no new file next to it, as on a server built by deploy/bootstrap.sh
  try {
    assert.throws(() => setEnvValues(file, { WEB_UI_USER: 'admin' }, data), /EACCES/)
    assert.equal(readFileSync(file, 'utf8'), old, 'the env file was not touched')
    assert.equal(existsSync(backup), false, `nothing was written to ${file}, yet its content (the recovery words) now also sits in ${backup}, and the next rewrite is refused until the owner deletes it by hand`)
  } finally {
    chmodSync(dir, 0o700)
    chmodSync(file, 0o600)
  }
})

test('R2B-1 after the owner fixes the file mode, the rewrite works (no leftover backup blocks it)', () => {
  if (process.getuid?.() === 0) return
  const dir = mkdtempSync(join(tmpdir(), 'r2b-1-'))
  const data = mkdtempSync(join(tmpdir(), 'r2b-1-data-'))
  const file = join(dir, 'env')
  writeFileSync(file, `AGENT_MNEMONIC="${TEST_WORDS}"\nWEB_UI_USER="old"\n`, { mode: 0o400 })
  chmodSync(dir, 0o500)
  try {
    assert.throws(() => setEnvValues(file, { WEB_UI_USER: 'admin' }, data), /EACCES/)
    chmodSync(file, 0o600) // the owner gives the file back to the service user
    setEnvValues(file, { WEB_UI_USER: 'admin' }, data)
    assert.match(readFileSync(file, 'utf8'), /^WEB_UI_USER="admin"$/m)
  } finally {
    chmodSync(dir, 0o700)
    chmodSync(file, 0o600)
  }
})

test('R2B-1 the backup goes once the new content is synced, even when setting the mode fails afterwards', () => {
  if (process.getuid?.() === 0) return
  const dir = mkdtempSync(join(tmpdir(), 'r2b-1-'))
  const data = mkdtempSync(join(tmpdir(), 'r2b-1-data-'))
  const file = join(dir, 'env')
  const backup = join(data, 'env.backup')
  writeFileSync(file, `AGENT_MNEMONIC="${TEST_WORDS}"\nWEB_UI_USER="old"\n`, { mode: 0o600 })
  chmodSync(dir, 0o500)
  const notOwner = () => { throw Object.assign(new Error('EPERM: operation not permitted, chmod'), { code: 'EPERM' }) }
  try {
    assert.throws(() => setEnvValues(file, { WEB_UI_USER: 'admin' }, data, { chmod: notOwner }), (e: Error) => {
      assert.match(e.message, /saved/, `the error must say the new content is saved: ${e.message}`)
      return true
    })
    assert.match(readFileSync(file, 'utf8'), /^WEB_UI_USER="admin"$/m, 'the new content is on disk')
    assert.equal(existsSync(backup), false, 'the content was synced: the copy of the recovery words must not stay behind')
  } finally {
    chmodSync(dir, 0o700)
  }
})

// ---- R2B-2: a Telegram command is never run twice across a restart ----

const CHAT = '42'

/** A fake Telegram server with the real confirmation rule. `dead`: the agent process is gone, requests never arrive. */
function fakeTelegram(updates: { update_id: number; message: object }[]) {
  const state = { confirmedBelow: 0, dead: false, polls: [] as number[] }
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    if (!url.pathname.endsWith('/getUpdates')) return ok({ ok: true, result: true }) // sendMessage, setMyCommands...
    if (state.dead) return new Promise<Response>(() => undefined) // the process died: this request never reaches Telegram
    const offset = Number(url.searchParams.get('offset') ?? 0)
    state.polls.push(offset)
    if (offset > 0) state.confirmedBelow = Math.max(state.confirmedBelow, offset) // confirmed on arrival, as Telegram does
    const result = updates.filter(u => u.update_id >= Math.max(state.confirmedBelow, offset))
    if (!result.length) await sleep(15) // the long poll
    return ok({ ok: true, result })
  }) as typeof fetch
  return state
}

const handlers = (ran: string[], onRun?: () => void): Handlers => ({
  command: async (command, args) => {
    ran.push(`/${command} ${args.join(' ')}`.trim())
    onRun?.()
    return `${command} done`
  },
  text: async () => ({ text: '' }),
  button: async () => '',
})

async function until(pred: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms
  while (!pred() && Date.now() < end) await sleep(5)
}

/** What the service's kv keeps across a restart. */
function savedOffset() {
  let saved = 0
  return { read: () => saved, write: (n: number) => void (saved = n) }
}

test('R2B-2 a command dispatched in the instant before a crash does not run again after the restart', async () => {
  const realFetch = globalThis.fetch
  const ran: string[] = []
  const nowS = Math.floor(Date.now() / 1000)
  // The owner's /do with a shop payment, a minute before the restart (inside the 5-minute backlog cut).
  const updates = [{ update_id: 101, message: { chat: { id: 42 }, from: { id: 42 }, date: nowS - 60, text: '/do 3 {"type":"buy_xp_booster"}' } }]
  const tg = fakeTelegram(updates)
  const kv = savedOffset()
  try {
    // First life: the command is dispatched, then the process dies before its confirming getUpdates reaches Telegram.
    const first = new Telegram('token', CHAT, kv)
    void first.startPolling(handlers(ran, () => { tg.dead = true }))
    await until(() => ran.length === 1)
    assert.deepEqual(ran, ['/do 3 {"type":"buy_xp_booster"}'])
    first.stop()
    assert.equal(tg.confirmedBelow, 0, 'the update was never confirmed to Telegram')
    // Second life: systemd restarts the service.
    tg.dead = false
    const second = new Telegram('token', CHAT, kv)
    void second.startPolling(handlers(ran))
    await until(() => ran.length >= 2 || tg.polls.length >= 2, 1000)
    await sleep(50)
    second.stop()
    assert.equal(ran.length, 1, `the same /do ran ${ran.length} times across the restart: ${JSON.stringify(ran)}`)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('R2B-2 control: once the confirming getUpdates reached Telegram, a restart does not replay the command', async () => {
  const realFetch = globalThis.fetch
  const ran: string[] = []
  const nowS = Math.floor(Date.now() / 1000)
  const tg = fakeTelegram([{ update_id: 101, message: { chat: { id: 42 }, from: { id: 42 }, date: nowS - 60, text: '/kill off' } }])
  try {
    const first = new Telegram('token', CHAT)
    void first.startPolling(handlers(ran))
    await until(() => tg.confirmedBelow === 102)
    first.stop()
    await sleep(50)
    const second = new Telegram('token', CHAT)
    void second.startPolling(handlers(ran))
    await sleep(100)
    second.stop()
    assert.deepEqual(ran, ['/kill off'])
  } finally {
    globalThis.fetch = realFetch
  }
})

test('R2B-2 the service keeps the offset in its database, per bot: a new bot token starts from the beginning', async () => {
  const { Service } = await import('../src/service.ts')
  const dataDir = mkdtempSync(join(tmpdir(), 'foxagent-r2b-2-'))
  const cfg = (token: string) => ({
    mnemonic: TEST_WORDS, dataDir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9', gatewayRps: 5, apiRps: 1, foxleagueRps: 5,
    anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: token, telegramChatId: CHAT, isServer: false, defaultDryRun: true, maxAgents: 5,
  }) as Config
  type Offsets = { read: () => number; write: (n: number) => void }
  const offsetsOf = (svc: { telegram: unknown }) => (svc.telegram as { offsets?: Offsets }).offsets
  const a = new Service(cfg('111:secret'))
  assert.ok(offsetsOf(a), 'the service hands Telegram a place to keep the offset')
  assert.equal(offsetsOf(a)!.read(), 0)
  offsetsOf(a)!.write(102)
  assert.equal(new Service(cfg('111:secret')).store.getKv('telegram_offset') !== undefined, true, 'kept in the database (kv telegram_offset)')
  assert.equal(offsetsOf(new Service(cfg('111:secret')))!.read(), 102, 'the restarted service starts after the dispatched batch')
  assert.equal(offsetsOf(new Service(cfg('222:other')))!.read(), 0, 'another bot numbers its updates on its own')
  assert.doesNotMatch(a.store.getKv('telegram_offset')!, /secret/, 'the token itself is never stored')
  a.store.setKv('telegram_offset', JSON.stringify({ bot: '111', offset: 500, at: new Date(Date.now() - 2 * 86_400_000).toISOString() }))
  assert.equal(offsetsOf(a)!.read(), 0, 'an offset older than a day is not used (Telegram may number its updates anew after a quiet week)')
})

// ---- R2C-1: the README promises no rule the code does not have ----

test('R2C-1 the README does not promise a rule the executor does not have (agents know nothing of each other)', () => {
  const now = new Date()
  const sibling = 777 // the FoxLeague user id of the owner's other agent, which the service notes (kv agent_user_id:N)
  const oneVOne = tournament(5001, { max_teams: 2, min_teams: 2, creator_user_id: sibling, target_user_id: null }, [{ user_id: sibling, wallet_address: OTHER }]) as TournamentDetail
  const seat = checkAction({ type: 'join_tournament', tournament_id: 5001 }, snapshot(), {
    settings: TEST_SETTINGS, now, tournament: oneVOne, ownUserIds: [sibling],
    opponent: { userId: sibling, elo: 1200, strength: 1200 }, oneVOneWithOpponentThisWeek: 0,
  })
  const bid = checkAction({ type: 'bid', nonce: 4242, foxsy: 1000 }, snapshot(), {
    settings: TEST_SETTINGS, now, priorBids: 0, cardLock: { until: null },
    auction: { seller: OTHER, minPrice: wholeToAtomic(1000), highestBid: 0n, highestBidder: null, endsAt: new Date(now.getTime() + 3600_000) } as never,
  })
  assert.ok(seat.ok && bid.ok, 'the rules allow a 1v1 and a bid between the owner\'s own agents (the owner removed the sibling rule on 2026-09-30)')
  const readme = readFileSync(join(REPO, 'README.md'), 'utf8').replace(/\s+/g, ' ')
  assert.doesNotMatch(readme, /never a 1v1 or trade between your own agents/, 'README.md promises a check the executor does not have')
  assert.match(readme, /two of them may meet in a tournament or a 1v1, or bid on the same card, by chance/, 'the README says what the safety page says')
})
