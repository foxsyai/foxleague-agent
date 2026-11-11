// Audit 2026-11-11 (Fable 5.2 reviewers at extra-high effort): DOCS-1, failing on the old text.
// DOCS: the Go live page, INSTALL.md, the installer's last screen and the dashboard's Getting started guide promised
// that a new wallet in dry run simulates its registration ("In dry run it only simulates these steps", "buy FOXSY,
// register a team, train, play. In dry run everything is simulated"). A dry run buys nothing, and every action of a
// plan runs against a fresh reading of the chain (service.ts, runPlan): the swap is simulated, the registration is
// refused because the wallet still holds no FOXSY, and later plans of the same game day may refuse the swap too,
// since the simulated one is counted in the dry-run ledger's daily swap allowance. The pages now say that.
//
// The first two tests hold what the executor does today (after EDGE-3: a simulated fee no longer blocks a later
// registration by the setup budget, but the registration itself still needs FOXSY that a dry run never buys). If the
// code ever keeps a dry plan's simulated balance, they fail and the sentences below have to be looked at again.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Store } from '../../src/store/db.ts'
import { Executor } from '../../src/executor/executor.ts'
import { ADDR, dryWallet, snapshot } from '../fixtures.ts'
import { numberToHex, wholeToAtomic } from '../../src/util/encoding.ts'
import type { PlannedAction } from '../../src/executor/actions.ts'

const ROOT = new URL('../../', import.meta.url)
const read = (f: string) => readFileSync(new URL(f, ROOT), 'utf8').replace(/\s+/g, ' ')

/** A new install: one agent at the defaults, in dry run, with 5 EGLD, no FOXSY and no team. */
function newInstall() {
  const store = new Store('', ':memory:')
  store.addAgent(0, ADDR)
  const b64 = (n: bigint) => Buffer.from(numberToHex(n), 'hex').toString('base64')
  const answers: Record<string, string[]> = {
    getState: [b64(1n)],
    getFirstTokenId: [Buffer.from('FOXSY-5d5f3e').toString('base64')],
    getSecondTokenId: [Buffer.from('WEGLD-bd4d79').toString('base64')],
    getReservesAndTotalSupply: [b64(wholeToAtomic(10_000_000)), b64(wholeToAtomic(6000)), b64(1n)],
    getAmountIn: [b64(wholeToAtomic(3) + wholeToAtomic(1) / 5n)], // 3.2 EGLD for 5,300 FOXSY
  }
  const chain = { simulate: async () => ({ ok: true, detail: 'success', raw: {} }), query: async (_sc: string, fn: string) => answers[fn]! }
  const fox = { user: async () => null, nameAvailable: async () => ({ available: true }) }
  const exec = new Executor({ cfg: {} as never, chain: chain as never, fox: fox as never, store })
  // What the chain says at every reading while nothing is signed: the dry run changes none of it.
  const fresh = () => {
    const s = snapshot()
    s.chain = { egld: wholeToAtomic(5), nonce: 0, foxsy: 0n, wegld: 0n, nftCount: 0 }
    s.prices = { egldUsd: 4.5, egldPerFoxsy: 0.0006, foxsyUsd: 0.0027 }
    s.registration = { ...s.registration, registered: false, teamName: null, feePaidOnChain: false }
    s.config!.relayer_addresses = [ADDR]
    s.profile = null
    s.team = null
    s.players = []
    s.auth = null
    return s
  }
  // One action at a time, each against a fresh snapshot, as the service runs a plan.
  const plan = async () => {
    const out = []
    for (const action of [{ type: 'swap_egld_for_foxsy', foxsy: 5300 }, { type: 'register', team_name: 'Lyon Rovers' }]) {
      const [r] = await exec.run(store.agent(0)!, dryWallet, fresh(), [{ action: action as PlannedAction['action'], reason: '' }])
      out.push(r!)
    }
    return out
  }
  return { plan, fee: fresh().config!.registration_fee_foxsy }
}

test('DOCS-1 the fact: a new wallet in dry run shows the simulated swap, then a registration refused for the FOXSY nothing bought', async () => {
  const { plan, fee } = newInstall()
  const [swap, register] = await plan()
  assert.equal(swap!.status, 'dry_run', swap!.summary)
  assert.equal(register!.status, 'refused', register!.summary)
  assert.match(register!.summary, new RegExp(`needs ${fee} FOXSY for the fee \\(swap first\\)`))
})

test('DOCS-1 the fact: a later plan of the same game day may refuse the swap too, by the daily swap allowance the simulated swap counts in', async () => {
  const { plan } = newInstall()
  await plan()
  const [swap, register] = await plan()
  assert.equal(swap!.status, 'refused', swap!.summary)
  assert.match(swap!.summary, /daily swap allowance/)
  // Never the setup budget (EDGE-3 closed that): the registration line is the same honest one as in the first plan.
  assert.match(register!.summary, /needs \d+ FOXSY for the fee \(swap first\)/)
})

const PLACES = ['site/src/content/docs/start/go-live.mdx', 'INSTALL.md', 'install.sh', 'src/web/dashboard.html']

test('DOCS-1 no page promises a simulated registration on a new wallet', () => {
  assert.doesNotMatch(read('site/src/content/docs/start/go-live.mdx'), /In dry run it only simulates these steps/)
  assert.doesNotMatch(read('INSTALL.md'), /In dry run everything is simulated and logged/)
  assert.doesNotMatch(read('install.sh'), /\(in dry run it only simulates\)/)
})

test('DOCS-1 the four places say what a new wallet shows in dry run: the simulated swap, then a registration that needs the fee', () => {
  const { fee } = newInstall()
  const shown = fee.toLocaleString('en-US') // 5,000 as the pages write it
  for (const f of PLACES) {
    const text = read(f)
    assert.match(text, /simulated (FOXSY )?swap/, `${f} does not name the simulated swap`)
    assert.ok(text.includes(`needs ${shown} FOXSY`), `${f} does not say that the registration line needs ${shown} FOXSY`)
    assert.match(text, /nothing (was|is) really bought/, `${f} does not say why`)
    assert.match(text, /registered (after|once) (you (press|go) )?(Go LIVE|live)/i, `${f} does not say when the team is registered`)
  }
})

test('DOCS-1 the Go live page also names the daily swap allowance a later plan may show', () => {
  assert.match(read('site/src/content/docs/start/go-live.mdx'), /daily swap allowance/)
})
