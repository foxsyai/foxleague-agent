// FIND: "Find my team" (the owner, 2026-11-22, before the public release). A player often has several wallets made
// from the same recovery words (xPortal and the web wallet derive account 0, 1, 2 ... from them) and the team may be on
// any of them, say account 4. Import team asked for the account number and checked that one account only, so a player
// who did not know the number tried them one by one. Find my team lists the first 20 accounts of the words, each with
// the FoxLeague team its wallet plays, like the account list of a wallet; a click on the one with the team fills in
// the number and runs the usual Check. It reads FoxLeague's public profiles only: no login, no transaction, nothing
// stored, and the answer holds addresses, never a key or the words.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { Mnemonic, UserPem, UserWallet } from '@multiversx/sdk-core'
import type { Config } from '../../src/config.ts'
import { addressOfKey } from '../../src/wallet/imported.ts'
import { Sessions, hashPassword } from '../../src/web/auth.ts'

const REPO = join(import.meta.dirname, '..', '..')
const read = (p: string) => readFileSync(join(REPO, p), 'utf8')
const TEAM_WORDS = Mnemonic.generate().toString()
const keyOf = (account: number, words = TEAM_WORDS) => Mnemonic.fromString(words).deriveKey(account)
const addressOf = (account: number, words = TEAM_WORDS) => addressOfKey(keyOf(account, words))

function testConfig(dir: string): Config {
  return {
    mnemonic: Mnemonic.generate().toString(), dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config
}

type Row = { account: number; address: string; team: string | null; unread?: boolean; agent?: string; own?: boolean }
type Found = { accounts: Row[] }
type FindService = { findImportAccounts(input: unknown, from?: unknown): Promise<Found> }

/** A service whose FoxLeague answers a team for the wallets in `teams` and no profile for any other. */
async function service(teams: Record<string, string>, fail: string[] = []) {
  const { Service } = await import('../../src/service.ts')
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-'))
  const svc = new Service(testConfig(dir))
  svc.ensureAgents()
  ;(svc as unknown as { schedule: unknown }).schedule = () => undefined
  const asked: string[] = []
  Object.assign(svc.fox, {
    user: async (a: string) => {
      asked.push(a)
      if (fail.includes(a)) throw new Error('FoxLeague answered 503')
      return teams[a] ? { team_name: teams[a] } : null
    },
    team: async () => assert.fail('no session is opened: the team is read from the public profile only'),
  })
  Object.assign(svc.chain, { account: async () => assert.fail('no chain read'), esdts: async () => assert.fail('no chain read'), guarded: async () => assert.fail('no chain read') })
  return { svc, dir, asked, find: (svc as unknown as FindService).findImportAccounts.bind(svc) }
}

test('FIND-1 the first 20 accounts of the recovery words, each with the team its wallet plays; nothing is stored and no secret is answered', async () => {
  const { svc, dir, asked, find } = await service({ [addressOf(4)]: 'Red Foxes' })
  const r = await find({ kind: 'words', words: `  ${TEAM_WORDS.toUpperCase()}\n` })
  assert.deepEqual(r.accounts.map(a => a.account), [...Array(20).keys()])
  assert.deepEqual(r.accounts.map(a => a.address), [...Array(20).keys()].map(n => addressOf(n)))
  assert.deepEqual(r.accounts.filter(a => a.team).map(a => [a.account, a.team]), [[4, 'Red Foxes']])
  assert.ok(r.accounts.every(a => a.team === null || a.account === 4))
  assert.equal(asked.length, 20, 'one public profile read a wallet')
  // The answer holds addresses only: no words, no key in any form.
  const text = JSON.stringify(r)
  // Two words in a row: one word alone may be in an address-free text by chance (see import.test.ts).
  assert.ok(!text.includes(TEAM_WORDS.split(' ').slice(0, 2).join(' ')), 'never two words in a row')
  assert.doesNotMatch(text, /PRIVATE KEY/)
  assert.ok(!text.includes(Buffer.from(keyOf(4).valueOf()).toString('hex')), 'no secret key hex')
  // Nothing stored: no agent added, no key file, no import waiting for the password.
  assert.deepEqual(svc.store.agents().map(b => b.index), [0])
  assert.equal(existsSync(join(dir, 'keys')), false)
  assert.equal((svc as unknown as { pendingImports: Map<string, unknown> }).pendingImports.size, 0)
})

test('FIND-2 a profile FoxLeague could not answer is unread, never "no team"', async () => {
  const { find } = await service({ [addressOf(4)]: 'Red Foxes' }, [addressOf(2)])
  const r = await find({ kind: 'words', words: TEAM_WORDS })
  assert.deepEqual(r.accounts[2], { account: 2, address: addressOf(2), team: null, unread: true })
  assert.equal(r.accounts[4]!.team, 'Red Foxes', 'the other accounts are still read')
  assert.equal(r.accounts[3]!.unread, undefined)
})

test('FIND-3 a keystore that holds words gives the same list; a key file is refused with "press Check"; the next 20 from any account', async () => {
  const { find } = await service({ [addressOf(23)]: 'Red Foxes' })
  const wordsKs = JSON.stringify(UserWallet.fromMnemonic({ mnemonic: TEAM_WORDS, password: 'pw' }).toJSON())
  const started = Date.now()
  const r = await find({ kind: 'keystore', keystore: wordsKs, password: 'pw' }, 20)
  assert.ok(Date.now() - started < 3000, 'the keystore is opened once, not once an account')
  assert.deepEqual(r.accounts.map(a => a.account), [...Array(20).keys()].map(n => n + 20))
  assert.deepEqual(r.accounts.filter(a => a.team).map(a => a.account), [23])
  await assert.rejects(find({ kind: 'keystore', keystore: wordsKs, password: 'wrong' }), /password is wrong/)
  const keyKs = JSON.stringify(UserWallet.fromSecretKey({ secretKey: keyOf(0), password: 'pw' }).toJSON())
  await assert.rejects(find({ kind: 'keystore', keystore: keyKs, password: 'pw' }), /holds one account: press Check/)
  await assert.rejects(find({ kind: 'pem', pem: new UserPem(addressOf(0), keyOf(0)).toText() }), /holds one account: press Check/)
  // Words that are not valid are refused without repeating them.
  const bad = TEAM_WORDS.split(' ').reverse().join(' ')
  await assert.rejects(find({ kind: 'words', words: bad }), (e: Error) => /not valid recovery words/.test(e.message) && !e.message.includes(bad.split(' ').slice(0, 2).join(' ')))
  // The accounts end at 999, as the account number does.
  assert.deepEqual((await find({ kind: 'words', words: TEAM_WORDS }, 990)).accounts.map(a => a.account), [...Array(10).keys()].map(n => n + 990))
  for (const from of [-1, 1000, 2.5, 'x']) await assert.rejects(find({ kind: 'words', words: TEAM_WORDS }, from), /0 to 999/, String(from))
})

test('FIND-4 accounts of this install\'s own words and wallets that are already an agent are named, not offered', async () => {
  const { svc, find } = await service({})
  const own = svc.cfg.mnemonic!
  const r = await find({ kind: 'words', words: own })
  // Agent 1 is account 0 of the install's own words; the next accounts are Add agent's.
  assert.deepEqual([r.accounts[0]!.agent, r.accounts[0]!.own], ['agent 1', true])
  assert.deepEqual([r.accounts[1]!.agent, r.accounts[1]!.own], [undefined, true])
})

test('FIND-5 over the web: only with the dashboard login, the answer holds no secret, one search at a time', async () => {
  const { Service } = await import('../../src/service.ts')
  const { startWeb } = await import('../../src/web/server.ts')
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-'))))
  svc.ensureAgents()
  ;(svc as unknown as { schedule: unknown }).schedule = () => undefined
  const waiting: (() => void)[] = []
  let hold = false
  Object.assign(svc.fox, { user: async (a: string) => { if (hold) await new Promise<void>(r => waiting.push(r)); return a === addressOf(4) ? { team_name: 'Red Foxes' } : null } })
  const pw = 'correct-horse-battery'
  const creds = { username: 'admin', passwordHash: hashPassword(pw), secretKey: 'k'.repeat(64) }
  const server = startWeb(svc, creds, 0)
  if (!server.listening) await once(server, 'listening')
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const sessions = new Sessions(creds.secretKey, creds.passwordHash)
  const cookie = sessions.issue('admin')
  const headers = { cookie: `foxagent_session=${cookie}`, origin: url, 'x-csrf-token': sessions.csrfFor(cookie), 'content-type': 'application/json' }
  const post = (body: unknown, h: Record<string, string> = headers) => fetch(`${url}/api/agents/import/find`, { method: 'POST', headers: h, body: JSON.stringify(body) })
  try {
    assert.ok([401, 403].includes((await post({ kind: 'words', words: TEAM_WORDS }, { 'content-type': 'application/json', origin: url })).status), 'no login, no search')
    const ok = await post({ kind: 'words', words: TEAM_WORDS })
    assert.equal(ok.status, 200)
    const text = await ok.text()
    assert.ok(!text.includes(TEAM_WORDS.split(' ').slice(0, 2).join(' ')))
    assert.doesNotMatch(text, /PRIVATE KEY/)
    assert.deepEqual((JSON.parse(text) as Found).accounts.filter(a => a.team).map(a => a.account), [4])
    assert.equal((await post({ kind: 'pem', pem: 'nope' })).status, 400)
    // A second search while one runs is refused, so a double click asks FoxLeague 20 times, not 40.
    hold = true
    const first = post({ kind: 'words', words: TEAM_WORDS })
    await new Promise(r => setTimeout(r, 50))
    const second = await post({ kind: 'words', words: TEAM_WORDS })
    assert.equal(second.status, 400)
    assert.match(((await second.json()) as { error: string }).error, /already searching/)
    hold = false
    for (const r of waiting.splice(0)) r()
    assert.equal((await first).status, 200)
  } finally {
    server.close()
  }
})

test('FIND-6 the dashboard offers Find my team beside the account number, and the guide says how it works', () => {
  const dash = read('src/web/dashboard.html')
  assert.match(dash, /<button class="btn" type="button" id="impFind">Find my team<\/button>/)
  assert.match(dash, /api\('POST', '\/api\/agents\/import\/find', body\)/)
  // A row with a team fills in its number and runs the usual Check.
  assert.match(dash, /\$\('impAccount'\)\.value = String\(a\.account\); \$\('impbox'\)\.requestSubmit\(\)/)
  assert.match(dash, /Show the next 20/)
  const page = read('site/src/content/docs/use/import-team.md').replace(/\s+/g, ' ')
  assert.match(page, /Not sure which account holds your team\? Press \*\*Find my team\*\*/)
  assert.match(page, /no login, no transaction and nothing stored/)
})
